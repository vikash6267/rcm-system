// Payment posting and management routes
const express = require("express")
const { Database } = require("../lib/database")
const { auditLog } = require("../middleware/audit")
const AuthMiddleware = require("../middleware/auth")
const ERAProcessor = require("../services/era-processor")
const Joi = require("joi")

const router = express.Router()

// Validation schemas
const paymentSchema = Joi.object({
  claim_id: Joi.number().required(),
  payment_type: Joi.string().valid("INSURANCE", "PATIENT", "ADJUSTMENT", "REFUND").required(),
  payment_method: Joi.string().valid("CHECK", "EFT", "CREDIT_CARD", "CASH", "ERA").required(),
  payment_amount: Joi.number().precision(2).min(0).required(),
  payment_date: Joi.date().required(),
  check_number: Joi.string().max(50).optional(),
  reference_number: Joi.string().max(100).optional(),
  payer_name: Joi.string().max(255).optional(),
  adjustment_reason_code: Joi.string().max(10).optional(),
  adjustment_reason_description: Joi.string().max(1000).optional(),
})

// Get all payments with filtering and pagination
router.get("/", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      payment_type = "all",
      payment_method = "all",
      date_from = "",
      date_to = "",
      patient_search = "",
      sort_by = "posted_at",
      sort_order = "DESC",
    } = req.query

    const offset = (page - 1) * limit
    const whereConditions = []
    const params = []

    // Build WHERE clause based on filters
    if (payment_type !== "all") {
      whereConditions.push("pp.payment_type = ?")
      params.push(payment_type)
    }

    if (payment_method !== "all") {
      whereConditions.push("pp.payment_method = ?")
      params.push(payment_method)
    }

    if (date_from) {
      whereConditions.push("pp.payment_date >= ?")
      params.push(date_from)
    }

    if (date_to) {
      whereConditions.push("pp.payment_date <= ?")
      params.push(date_to)
    }

    if (patient_search) {
      whereConditions.push("(p.first_name LIKE ? OR p.last_name LIKE ? OR c.claim_number LIKE ?)")
      params.push(`%${patient_search}%`, `%${patient_search}%`, `%${patient_search}%`)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    // Count total records
    const countSql = `
      SELECT COUNT(*) as total 
      FROM payment_postings pp
      JOIN claims c ON pp.claim_id = c.id
      JOIN patients p ON c.patient_id = p.id
      ${whereClause}
    `
    const [countResult] = await Database.query(countSql, params)
    const total = countResult.total

    // Get payments with claim and patient info
    const sql = `
      SELECT 
        pp.*, c.claim_number, c.total_charges,
        p.first_name, p.last_name, p.patient_id,
        u.first_name as posted_by_first_name, u.last_name as posted_by_last_name
      FROM payment_postings pp
      JOIN claims c ON pp.claim_id = c.id
      JOIN patients p ON c.patient_id = p.id
      LEFT JOIN users u ON pp.posted_by = u.id
      ${whereClause}
      ORDER BY pp.${sort_by} ${sort_order}
      LIMIT ? OFFSET ?
    `

    params.push(Number.parseInt(limit), Number.parseInt(offset))
    const payments = await Database.query(sql, params)

    await auditLog(req, "PAYMENTS_VIEWED", "PAYMENTS", null, {
      page,
      limit,
      filters: { payment_type, payment_method, date_from, date_to, patient_search },
      total_results: payments.length,
    })

    res.json({
      success: true,
      data: payments,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error("Get payments error:", error)
    res.status(500).json({ error: "Failed to fetch payments" })
  }
})

// Get payment by ID
router.get("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const sql = `
      SELECT 
        pp.*, c.claim_number, c.total_charges, c.service_date_from, c.service_date_to,
        p.first_name, p.last_name, p.patient_id,
        u.first_name as posted_by_first_name, u.last_name as posted_by_last_name,
        e.era_number, e.check_number as era_check_number
      FROM payment_postings pp
      JOIN claims c ON pp.claim_id = c.id
      JOIN patients p ON c.patient_id = p.id
      LEFT JOIN users u ON pp.posted_by = u.id
      LEFT JOIN eras e ON pp.era_id = e.id
      WHERE pp.id = ?
    `

    const [payment] = await Database.query(sql, [req.params.id])

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" })
    }

    await auditLog(req, "PAYMENT_VIEWED", "PAYMENTS", req.params.id, {})

    res.json({ success: true, data: payment })
  } catch (error) {
    console.error("Get payment error:", error)
    res.status(500).json({ error: "Failed to fetch payment" })
  }
})

// Manual payment posting
router.post("/", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const { error, value } = paymentSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    // Verify claim exists
    const claim = await Database.findById("claims", value.claim_id)
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" })
    }

    // Create payment posting
    const paymentData = {
      ...value,
      posted_by: req.user.id,
      posted_at: new Date(),
    }

    const paymentId = await Database.transaction(async (connection) => {
      // Insert payment
      const [paymentResult] = await connection.execute(
        `INSERT INTO payment_postings (${Object.keys(paymentData).join(", ")}) VALUES (${Object.keys(paymentData)
          .map(() => "?")
          .join(", ")})`,
        Object.values(paymentData),
      )

      const newPaymentId = paymentResult.insertId

      // Update claim totals
      await updateClaimTotals(connection, value.claim_id)

      return newPaymentId
    })

    await auditLog(req, "PAYMENT_POSTED", "PAYMENTS", paymentId, {
      claim_id: value.claim_id,
      payment_type: value.payment_type,
      payment_amount: value.payment_amount,
      payment_method: value.payment_method,
    })

    res.status(201).json({
      success: true,
      message: "Payment posted successfully",
      data: { id: paymentId },
    })
  } catch (error) {
    console.error("Post payment error:", error)
    res.status(500).json({ error: "Failed to post payment" })
  }
})

// Update payment
router.put("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const existingPayment = await Database.findById("payment_postings", req.params.id)
    if (!existingPayment) {
      return res.status(404).json({ error: "Payment not found" })
    }

    // Don't allow editing ERA auto-posted payments
    if (existingPayment.payment_method === "ERA" && !existingPayment.posted_by) {
      return res.status(400).json({ error: "Cannot edit auto-posted ERA payments" })
    }

    const { error, value } = paymentSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    await Database.transaction(async (connection) => {
      // Update payment
      await connection.execute(
        `UPDATE payment_postings SET ${Object.keys(value)
          .map((key) => `${key} = ?`)
          .join(", ")} WHERE id = ?`,
        [...Object.values(value), req.params.id],
      )

      // Update claim totals
      await updateClaimTotals(connection, value.claim_id)
    })

    await auditLog(req, "PAYMENT_UPDATED", "PAYMENTS", req.params.id, {
      claim_id: value.claim_id,
      payment_amount: value.payment_amount,
    })

    res.json({ success: true, message: "Payment updated successfully" })
  } catch (error) {
    console.error("Update payment error:", error)
    res.status(500).json({ error: "Failed to update payment" })
  }
})

// Delete payment
router.delete("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER"]), async (req, res) => {
  try {
    const payment = await Database.findById("payment_postings", req.params.id)
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" })
    }

    // Don't allow deleting ERA auto-posted payments
    if (payment.payment_method === "ERA" && !payment.posted_by) {
      return res.status(400).json({ error: "Cannot delete auto-posted ERA payments" })
    }

    await Database.transaction(async (connection) => {
      // Delete payment
      await connection.execute("DELETE FROM payment_postings WHERE id = ?", [req.params.id])

      // Update claim totals
      await updateClaimTotals(connection, payment.claim_id)
    })

    await auditLog(req, "PAYMENT_DELETED", "PAYMENTS", req.params.id, {
      claim_id: payment.claim_id,
      payment_amount: payment.payment_amount,
    })

    res.json({ success: true, message: "Payment deleted successfully" })
  } catch (error) {
    console.error("Delete payment error:", error)
    res.status(500).json({ error: "Failed to delete payment" })
  }
})

// Get payments for a specific claim
router.get("/claim/:claimId", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const sql = `
      SELECT 
        pp.*, u.first_name as posted_by_first_name, u.last_name as posted_by_last_name,
        e.era_number, e.check_number as era_check_number
      FROM payment_postings pp
      LEFT JOIN users u ON pp.posted_by = u.id
      LEFT JOIN eras e ON pp.era_id = e.id
      WHERE pp.claim_id = ?
      ORDER BY pp.posted_at DESC
    `

    const payments = await Database.query(sql, [req.params.claimId])

    await auditLog(req, "CLAIM_PAYMENTS_VIEWED", "PAYMENTS", null, {
      claim_id: req.params.claimId,
      payments_count: payments.length,
    })

    res.json({ success: true, data: payments })
  } catch (error) {
    console.error("Get claim payments error:", error)
    res.status(500).json({ error: "Failed to fetch claim payments" })
  }
})

// Bulk payment posting
router.post("/bulk", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const { payments } = req.body

    if (!Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: "Payments array is required" })
    }

    const results = []

    for (const paymentData of payments) {
      try {
        const { error, value } = paymentSchema.validate(paymentData)
        if (error) {
          results.push({
            claim_id: paymentData.claim_id,
            status: "ERROR",
            error: error.details[0].message,
          })
          continue
        }

        // Verify claim exists
        const claim = await Database.findById("claims", value.claim_id)
        if (!claim) {
          results.push({
            claim_id: value.claim_id,
            status: "ERROR",
            error: "Claim not found",
          })
          continue
        }

        const paymentPostData = {
          ...value,
          posted_by: req.user.id,
          posted_at: new Date(),
        }

        const paymentId = await Database.transaction(async (connection) => {
          // Insert payment
          const [paymentResult] = await connection.execute(
            `INSERT INTO payment_postings (${Object.keys(paymentPostData).join(", ")}) VALUES (${Object.keys(
              paymentPostData,
            )
              .map(() => "?")
              .join(", ")})`,
            Object.values(paymentPostData),
          )

          const newPaymentId = paymentResult.insertId

          // Update claim totals
          await updateClaimTotals(connection, value.claim_id)

          return newPaymentId
        })

        results.push({
          claim_id: value.claim_id,
          payment_id: paymentId,
          status: "SUCCESS",
        })

        await auditLog(req, "BULK_PAYMENT_POSTED", "PAYMENTS", paymentId, {
          claim_id: value.claim_id,
          payment_amount: value.payment_amount,
        })
      } catch (error) {
        results.push({
          claim_id: paymentData.claim_id,
          status: "ERROR",
          error: error.message,
        })
      }
    }

    const successful = results.filter((r) => r.status === "SUCCESS").length
    const failed = results.filter((r) => r.status === "ERROR").length

    res.json({
      success: true,
      message: `Bulk payment posting completed: ${successful} successful, ${failed} failed`,
      data: {
        total: payments.length,
        successful,
        failed,
        results,
      },
    })
  } catch (error) {
    console.error("Bulk payment posting error:", error)
    res.status(500).json({ error: "Failed to process bulk payments" })
  }
})

// Process ERA file upload
router.post("/era/upload", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const { file_path, file_name } = req.body

    if (!file_path || !file_name) {
      return res.status(400).json({ error: "File path and name are required" })
    }

    // Process ERA file
    const result = await ERAProcessor.processERAFile(file_path, file_name)

    if (result.success) {
      await auditLog(req, "ERA_FILE_PROCESSED", "PAYMENTS", result.era_id, {
        file_name,
        file_path,
      })

      res.json({
        success: true,
        message: "ERA file processed successfully",
        era_id: result.era_id,
      })
    } else {
      await auditLog(req, "ERA_FILE_PROCESSING_FAILED", "PAYMENTS", null, {
        file_name,
        error: result.error,
      })

      res.status(400).json({
        error: "ERA file processing failed",
        details: result.error,
      })
    }
  } catch (error) {
    console.error("ERA upload error:", error)
    res.status(500).json({ error: "Failed to process ERA file" })
  }
})

// Get ERA processing history
router.get("/era/history", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const { page = 1, limit = 20, status = "all" } = req.query
    const offset = (page - 1) * limit

    let whereClause = ""
    const params = []

    if (status !== "all") {
      whereClause = "WHERE processing_status = ?"
      params.push(status)
    }

    // Count total records
    const countSql = `SELECT COUNT(*) as total FROM eras ${whereClause}`
    const [countResult] = await Database.query(countSql, params)
    const total = countResult.total

    // Get ERA history
    const sql = `
      SELECT 
        e.*, 
        COUNT(ecd.id) as claims_count,
        SUM(ecd.total_paid_amount) as total_paid_amount
      FROM eras e
      LEFT JOIN era_claim_details ecd ON e.id = ecd.era_id
      ${whereClause}
      GROUP BY e.id
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `

    params.push(Number.parseInt(limit), Number.parseInt(offset))
    const eras = await Database.query(sql, params)

    await auditLog(req, "ERA_HISTORY_VIEWED", "PAYMENTS", null, {
      page,
      limit,
      status,
      total_results: eras.length,
    })

    res.json({
      success: true,
      data: eras,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error("Get ERA history error:", error)
    res.status(500).json({ error: "Failed to fetch ERA history" })
  }
})

// Get payment statistics
router.get("/stats/overview", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const { date_from = "", date_to = "" } = req.query

    let whereClause = ""
    const params = []

    if (date_from && date_to) {
      whereClause = "WHERE payment_date BETWEEN ? AND ?"
      params.push(date_from, date_to)
    }

    // Get payment statistics
    const statsSql = `
      SELECT 
        COUNT(*) as total_payments,
        SUM(payment_amount) as total_amount,
        SUM(CASE WHEN payment_type = 'INSURANCE' THEN payment_amount ELSE 0 END) as insurance_payments,
        SUM(CASE WHEN payment_type = 'PATIENT' THEN payment_amount ELSE 0 END) as patient_payments,
        SUM(CASE WHEN payment_type = 'ADJUSTMENT' THEN payment_amount ELSE 0 END) as adjustments,
        SUM(CASE WHEN payment_method = 'ERA' THEN payment_amount ELSE 0 END) as era_payments,
        SUM(CASE WHEN payment_method = 'CHECK' THEN payment_amount ELSE 0 END) as check_payments,
        SUM(CASE WHEN payment_method = 'EFT' THEN payment_amount ELSE 0 END) as eft_payments
      FROM payment_postings 
      ${whereClause}
    `

    const [stats] = await Database.query(statsSql, params)

    // Get daily payment trends
    const trendSql = `
      SELECT 
        DATE(payment_date) as payment_date,
        COUNT(*) as payment_count,
        SUM(payment_amount) as daily_amount
      FROM payment_postings 
      ${whereClause}
      GROUP BY DATE(payment_date)
      ORDER BY payment_date DESC
      LIMIT 30
    `

    const trends = await Database.query(trendSql, params)

    await auditLog(req, "PAYMENT_STATS_VIEWED", "PAYMENTS", null, { date_from, date_to })

    res.json({
      success: true,
      data: {
        overview: stats,
        trends,
      },
    })
  } catch (error) {
    console.error("Get payment statistics error:", error)
    res.status(500).json({ error: "Failed to fetch payment statistics" })
  }
})

// Helper function to update claim totals
async function updateClaimTotals(connection, claimId) {
  const sql = `
    SELECT 
      SUM(CASE WHEN payment_type IN ('INSURANCE', 'PATIENT') THEN payment_amount ELSE 0 END) as total_paid,
      SUM(CASE WHEN payment_type = 'ADJUSTMENT' THEN payment_amount ELSE 0 END) as total_adjustments
    FROM payment_postings 
    WHERE claim_id = ?
  `

  const [totals] = await connection.execute(sql, [claimId])

  const totalPaid = totals.total_paid || 0
  const totalAdjustments = totals.total_adjustments || 0

  // Get claim charges
  const [claim] = await connection.execute("SELECT total_charges FROM claims WHERE id = ?", [claimId])

  if (claim) {
    const patientResponsibility = Math.max(0, claim.total_charges - totalPaid - totalAdjustments)

    await connection.execute("UPDATE claims SET total_paid = ?, patient_responsibility = ? WHERE id = ?", [
      totalPaid,
      patientResponsibility,
      claimId,
    ])
  }
}

module.exports = router
