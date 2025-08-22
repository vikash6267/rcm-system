// Collections management routes
const express = require("express")
const { Database } = require("../lib/database")
const { auditLog } = require("../middleware/audit")
const AuthMiddleware = require("../middleware/auth")
const Joi = require("joi")

const router = express.Router()

// Validation schemas
const collectionSchema = Joi.object({
  patient_id: Joi.number().required(),
  claim_id: Joi.number().optional(),
  collection_type: Joi.string().valid("PATIENT_BALANCE", "COPAY", "DEDUCTIBLE", "COINSURANCE").required(),
  original_amount: Joi.number().precision(2).min(0).required(),
  current_balance: Joi.number().precision(2).min(0).required(),
  collection_notes: Joi.string().max(1000).optional(),
})

const paymentPlanSchema = Joi.object({
  patient_id: Joi.number().required(),
  collection_id: Joi.number().optional(),
  plan_amount: Joi.number().precision(2).min(0).required(),
  monthly_payment: Joi.number().precision(2).min(0).required(),
  start_date: Joi.date().required(),
  payment_day_of_month: Joi.number().min(1).max(28).default(1),
  notes: Joi.string().max(1000).optional(),
})

// Get all collections with filtering and pagination
router.get("/", AuthMiddleware.authorize(["ADMIN", "MANAGER", "COLLECTOR", "VIEWER"]), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = "all",
      type = "all",
      assigned_to = "all",
      aging = "all",
      sort_by = "created_at",
      sort_order = "DESC",
    } = req.query

    const offset = (page - 1) * limit
    const whereConditions = []
    const params = []

    // Build WHERE clause based on filters
    if (status !== "all") {
      whereConditions.push("c.collection_status = ?")
      params.push(status)
    }

    if (type !== "all") {
      whereConditions.push("c.collection_type = ?")
      params.push(type)
    }

    if (assigned_to !== "all") {
      whereConditions.push("c.assigned_to = ?")
      params.push(assigned_to)
    }

    if (aging !== "all") {
      switch (aging) {
        case "0-30":
          whereConditions.push("c.days_outstanding <= 30")
          break
        case "31-60":
          whereConditions.push("c.days_outstanding BETWEEN 31 AND 60")
          break
        case "61-90":
          whereConditions.push("c.days_outstanding BETWEEN 61 AND 90")
          break
        case "90+":
          whereConditions.push("c.days_outstanding > 90")
          break
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    // Count total records
    const countSql = `
      SELECT COUNT(*) as total 
      FROM collections c
      JOIN patients p ON c.patient_id = p.id
      ${whereClause}
    `
    const [countResult] = await Database.query(countSql, params)
    const total = countResult.total

    // Get collections with patient info
    const sql = `
      SELECT 
        c.*, p.first_name, p.last_name, p.patient_id as patient_number,
        p.phone, p.email,
        cl.claim_number,
        u.first_name as assigned_first_name, u.last_name as assigned_last_name
      FROM collections c
      JOIN patients p ON c.patient_id = p.id
      LEFT JOIN claims cl ON c.claim_id = cl.id
      LEFT JOIN users u ON c.assigned_to = u.id
      ${whereClause}
      ORDER BY c.${sort_by} ${sort_order}
      LIMIT ? OFFSET ?
    `

    params.push(Number.parseInt(limit), Number.parseInt(offset))
    const collections = await Database.query(sql, params)

    await auditLog(req, "COLLECTIONS_VIEWED", "COLLECTIONS", null, {
      page,
      limit,
      filters: { status, type, assigned_to, aging },
      total_results: collections.length,
    })

    res.json({
      success: true,
      data: collections,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error("Get collections error:", error)
    res.status(500).json({ error: "Failed to fetch collections" })
  }
})

// Get collection by ID
router.get("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "COLLECTOR", "VIEWER"]), async (req, res) => {
  try {
    const sql = `
      SELECT 
        c.*, p.first_name, p.last_name, p.patient_id as patient_number,
        p.phone, p.email, p.address_line1, p.city, p.state, p.zip_code,
        cl.claim_number, cl.service_date_from, cl.service_date_to,
        u.first_name as assigned_first_name, u.last_name as assigned_last_name
      FROM collections c
      JOIN patients p ON c.patient_id = p.id
      LEFT JOIN claims cl ON c.claim_id = cl.id
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.id = ?
    `

    const [collection] = await Database.query(sql, [req.params.id])

    if (!collection) {
      return res.status(404).json({ error: "Collection not found" })
    }

    // Get payment plan if exists
    const paymentPlan = await Database.findOne("payment_plans", { collection_id: req.params.id })

    const collectionData = {
      ...collection,
      payment_plan: paymentPlan,
    }

    await auditLog(req, "COLLECTION_VIEWED", "COLLECTIONS", req.params.id, {})

    res.json({ success: true, data: collectionData })
  } catch (error) {
    console.error("Get collection error:", error)
    res.status(500).json({ error: "Failed to fetch collection" })
  }
})

// Create new collection
router.post("/", AuthMiddleware.authorize(["ADMIN", "MANAGER", "COLLECTOR"]), async (req, res) => {
  try {
    const { error, value } = collectionSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    // Verify patient exists
    const patient = await Database.findById("patients", value.patient_id)
    if (!patient) {
      return res.status(404).json({ error: "Patient not found" })
    }

    // Calculate days outstanding
    const daysOutstanding = value.claim_id ? await calculateDaysOutstanding(value.claim_id) : 0

    const collectionData = {
      ...value,
      collection_status: "NEW",
      days_outstanding: daysOutstanding,
      created_by: req.user.id,
      updated_by: req.user.id,
    }

    const collectionId = await Database.create("collections", collectionData)

    await auditLog(req, "COLLECTION_CREATED", "COLLECTIONS", collectionId, {
      patient_id: value.patient_id,
      collection_type: value.collection_type,
      original_amount: value.original_amount,
    })

    res.status(201).json({
      success: true,
      message: "Collection created successfully",
      data: { id: collectionId },
    })
  } catch (error) {
    console.error("Create collection error:", error)
    res.status(500).json({ error: "Failed to create collection" })
  }
})

// Update collection
router.put("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "COLLECTOR"]), async (req, res) => {
  try {
    const existingCollection = await Database.findById("collections", req.params.id)
    if (!existingCollection) {
      return res.status(404).json({ error: "Collection not found" })
    }

    const updateSchema = Joi.object({
      collection_status: Joi.string()
        .valid("NEW", "IN_PROGRESS", "PAYMENT_PLAN", "COLLECTIONS_AGENCY", "WRITTEN_OFF", "PAID")
        .optional(),
      current_balance: Joi.number().precision(2).min(0).optional(),
      assigned_to: Joi.number().optional(),
      collection_notes: Joi.string().max(1000).optional(),
      last_contact_date: Joi.date().optional(),
      next_action_date: Joi.date().optional(),
    })

    const { error, value } = updateSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    const updateData = { ...value }
    updateData.updated_by = req.user.id

    // Update days outstanding
    if (existingCollection.claim_id) {
      updateData.days_outstanding = await calculateDaysOutstanding(existingCollection.claim_id)
    }

    const success = await Database.update("collections", req.params.id, updateData)

    if (!success) {
      return res.status(400).json({ error: "Failed to update collection" })
    }

    await auditLog(req, "COLLECTION_UPDATED", "COLLECTIONS", req.params.id, {
      previous_status: existingCollection.collection_status,
      new_status: value.collection_status,
      current_balance: value.current_balance,
    })

    res.json({ success: true, message: "Collection updated successfully" })
  } catch (error) {
    console.error("Update collection error:", error)
    res.status(500).json({ error: "Failed to update collection" })
  }
})

// Create payment plan
router.post("/:id/payment-plan", AuthMiddleware.authorize(["ADMIN", "MANAGER", "COLLECTOR"]), async (req, res) => {
  try {
    const collection = await Database.findById("collections", req.params.id)
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" })
    }

    const { error, value } = paymentPlanSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    // Calculate plan details
    const totalPayments = Math.ceil(value.plan_amount / value.monthly_payment)
    const endDate = new Date(value.start_date)
    endDate.setMonth(endDate.getMonth() + totalPayments)

    const nextPaymentDate = new Date(value.start_date)
    nextPaymentDate.setDate(value.payment_day_of_month)

    const paymentPlanData = {
      patient_id: collection.patient_id,
      collection_id: req.params.id,
      plan_amount: value.plan_amount,
      monthly_payment: value.monthly_payment,
      start_date: value.start_date,
      end_date: endDate,
      payment_day_of_month: value.payment_day_of_month,
      plan_status: "ACTIVE",
      total_payments: totalPayments,
      next_payment_date: nextPaymentDate,
      notes: value.notes,
      created_by: req.user.id,
    }

    const paymentPlanId = await Database.transaction(async (connection) => {
      // Create payment plan
      const [planResult] = await connection.execute(
        `INSERT INTO payment_plans (${Object.keys(paymentPlanData).join(", ")}) VALUES (${Object.keys(paymentPlanData)
          .map(() => "?")
          .join(", ")})`,
        Object.values(paymentPlanData),
      )

      const newPlanId = planResult.insertId

      // Update collection status
      await connection.execute("UPDATE collections SET collection_status = 'PAYMENT_PLAN' WHERE id = ?", [
        req.params.id,
      ])

      return newPlanId
    })

    await auditLog(req, "PAYMENT_PLAN_CREATED", "COLLECTIONS", req.params.id, {
      payment_plan_id: paymentPlanId,
      plan_amount: value.plan_amount,
      monthly_payment: value.monthly_payment,
      total_payments: totalPayments,
    })

    res.status(201).json({
      success: true,
      message: "Payment plan created successfully",
      data: { id: paymentPlanId },
    })
  } catch (error) {
    console.error("Create payment plan error:", error)
    res.status(500).json({ error: "Failed to create payment plan" })
  }
})

// Get payment plans
router.get("/payment-plans/active", AuthMiddleware.authorize(["ADMIN", "MANAGER", "COLLECTOR"]), async (req, res) => {
  try {
    const sql = `
      SELECT 
        pp.*, p.first_name, p.last_name, p.patient_id as patient_number,
        p.phone, p.email,
        c.collection_type, c.original_amount
      FROM payment_plans pp
      JOIN patients p ON pp.patient_id = p.id
      LEFT JOIN collections c ON pp.collection_id = c.id
      WHERE pp.plan_status = 'ACTIVE'
      ORDER BY pp.next_payment_date ASC
    `

    const paymentPlans = await Database.query(sql)

    await auditLog(req, "PAYMENT_PLANS_VIEWED", "COLLECTIONS", null, {
      active_plans_count: paymentPlans.length,
    })

    res.json({ success: true, data: paymentPlans })
  } catch (error) {
    console.error("Get payment plans error:", error)
    res.status(500).json({ error: "Failed to fetch payment plans" })
  }
})

// Record payment plan payment
router.post(
  "/:id/payment-plans/payment",
  AuthMiddleware.authorize(["ADMIN", "MANAGER", "COLLECTOR"]),
  async (req, res) => {
    try {
      const { payment_amount, payment_date } = req.body

      if (!payment_amount || !payment_date) {
        return res.status(400).json({ error: "Payment amount and date are required" })
      }

      const paymentPlan = await Database.findById("payment_plans", req.params.id)
      if (!paymentPlan) {
        return res.status(404).json({ error: "Payment plan not found" })
      }

      await Database.transaction(async (connection) => {
        // Update payment plan
        const newAmountPaid = (paymentPlan.amount_paid || 0) + Number.parseFloat(payment_amount)
        const newPaymentsMade = (paymentPlan.payments_made || 0) + 1

        // Calculate next payment date
        const nextPaymentDate = new Date(payment_date)
        nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1)
        nextPaymentDate.setDate(paymentPlan.payment_day_of_month)

        const updateData = {
          amount_paid: newAmountPaid,
          payments_made: newPaymentsMade,
          last_payment_date: payment_date,
          next_payment_date: nextPaymentDate,
          default_count: 0, // Reset default count on payment
        }

        // Check if plan is completed
        if (newAmountPaid >= paymentPlan.plan_amount || newPaymentsMade >= paymentPlan.total_payments) {
          updateData.plan_status = "COMPLETED"
          updateData.next_payment_date = null
        }

        await connection.execute(
          `UPDATE payment_plans SET ${Object.keys(updateData)
            .map((key) => `${key} = ?`)
            .join(", ")} WHERE id = ?`,
          [...Object.values(updateData), req.params.id],
        )

        // Update collection if plan is completed
        if (updateData.plan_status === "COMPLETED") {
          await connection.execute("UPDATE collections SET collection_status = 'PAID' WHERE id = ?", [
            paymentPlan.collection_id,
          ])
        }
      })

      await auditLog(req, "PAYMENT_PLAN_PAYMENT_RECORDED", "COLLECTIONS", paymentPlan.collection_id, {
        payment_plan_id: req.params.id,
        payment_amount,
        payment_date,
      })

      res.json({ success: true, message: "Payment recorded successfully" })
    } catch (error) {
      console.error("Record payment plan payment error:", error)
      res.status(500).json({ error: "Failed to record payment" })
    }
  },
)

// Get collections statistics
router.get("/stats/overview", AuthMiddleware.authorize(["ADMIN", "MANAGER", "COLLECTOR"]), async (req, res) => {
  try {
    // Get collection statistics
    const statsSql = `
      SELECT 
        COUNT(*) as total_collections,
        SUM(current_balance) as total_balance,
        SUM(CASE WHEN collection_status = 'NEW' THEN current_balance ELSE 0 END) as new_balance,
        SUM(CASE WHEN collection_status = 'IN_PROGRESS' THEN current_balance ELSE 0 END) as in_progress_balance,
        SUM(CASE WHEN collection_status = 'PAYMENT_PLAN' THEN current_balance ELSE 0 END) as payment_plan_balance,
        SUM(CASE WHEN days_outstanding <= 30 THEN current_balance ELSE 0 END) as balance_0_30,
        SUM(CASE WHEN days_outstanding BETWEEN 31 AND 60 THEN current_balance ELSE 0 END) as balance_31_60,
        SUM(CASE WHEN days_outstanding BETWEEN 61 AND 90 THEN current_balance ELSE 0 END) as balance_61_90,
        SUM(CASE WHEN days_outstanding > 90 THEN current_balance ELSE 0 END) as balance_over_90
      FROM collections 
      WHERE collection_status NOT IN ('PAID', 'WRITTEN_OFF')
    `

    const [stats] = await Database.query(statsSql)

    // Get payment plan statistics
    const planStatsSql = `
      SELECT 
        COUNT(*) as active_plans,
        SUM(plan_amount) as total_plan_amount,
        SUM(amount_paid) as total_paid_amount,
        SUM(plan_amount - amount_paid) as remaining_balance
      FROM payment_plans 
      WHERE plan_status = 'ACTIVE'
    `

    const [planStats] = await Database.query(planStatsSql)

    await auditLog(req, "COLLECTION_STATS_VIEWED", "COLLECTIONS", null, {})

    res.json({
      success: true,
      data: {
        collections: stats,
        payment_plans: planStats,
      },
    })
  } catch (error) {
    console.error("Get collection statistics error:", error)
    res.status(500).json({ error: "Failed to fetch collection statistics" })
  }
})

// Helper function to calculate days outstanding
async function calculateDaysOutstanding(claimId) {
  const claim = await Database.findById("claims", claimId, "service_date_to")
  if (!claim) return 0

  const serviceDate = new Date(claim.service_date_to)
  const today = new Date()
  const diffTime = Math.abs(today - serviceDate)
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return diffDays
}

module.exports = router
