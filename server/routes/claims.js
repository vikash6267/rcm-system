// Claims management routes
const express = require("express")
const { Database } = require("../lib/database")
const { auditLog } = require("../middleware/audit")
const AuthMiddleware = require("../middleware/auth")
const ClearinghouseService = require("../services/clearinghouse")
const Joi = require("joi")

const router = express.Router()

// Validation schemas
const claimSchema = Joi.object({
  patient_id: Joi.number().required(),
  primary_insurance_id: Joi.number().required(),
  secondary_insurance_id: Joi.number().optional(),
  provider_id: Joi.number().optional(),
  facility_id: Joi.number().optional(),
  claim_type: Joi.string().valid("PROFESSIONAL", "INSTITUTIONAL", "DENTAL", "VISION").required(),
  service_date_from: Joi.date().required(),
  service_date_to: Joi.date().required(),
  primary_diagnosis_code: Joi.string().max(20).required(),
  admission_date: Joi.date().optional(),
  discharge_date: Joi.date().optional(),
  place_of_service: Joi.string().max(10).required(),
  billing_provider_npi: Joi.string().max(20).required(),
  rendering_provider_npi: Joi.string().max(20).required(),
  line_items: Joi.array()
    .items(
      Joi.object({
        line_number: Joi.number().required(),
        procedure_code: Joi.string().max(20).required(),
        modifier1: Joi.string().max(5).optional(),
        modifier2: Joi.string().max(5).optional(),
        modifier3: Joi.string().max(5).optional(),
        modifier4: Joi.string().max(5).optional(),
        diagnosis_code_1: Joi.string().max(20).optional(),
        diagnosis_code_2: Joi.string().max(20).optional(),
        diagnosis_code_3: Joi.string().max(20).optional(),
        diagnosis_code_4: Joi.string().max(20).optional(),
        service_date: Joi.date().required(),
        units: Joi.number().min(1).default(1),
        charge_amount: Joi.number().precision(2).min(0).required(),
        place_of_service: Joi.string().max(10).optional(),
        rendering_provider_npi: Joi.string().max(20).optional(),
      }),
    )
    .min(1)
    .required(),
})

// Get all claims with filtering and pagination
router.get("/", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = "all",
      patient_search = "",
      date_from = "",
      date_to = "",
      claim_type = "all",
      sort_by = "created_at",
      sort_order = "DESC",
    } = req.query

    const offset = (page - 1) * limit
    const whereConditions = []
    const params = []

    // Build WHERE clause based on filters
    if (status !== "all") {
      whereConditions.push("c.claim_status = ?")
      params.push(status)
    }

    if (patient_search) {
      whereConditions.push("(p.first_name LIKE ? OR p.last_name LIKE ? OR c.claim_number LIKE ?)")
      params.push(`%${patient_search}%`, `%${patient_search}%`, `%${patient_search}%`)
    }

    if (date_from) {
      whereConditions.push("c.service_date_from >= ?")
      params.push(date_from)
    }

    if (date_to) {
      whereConditions.push("c.service_date_to <= ?")
      params.push(date_to)
    }

    if (claim_type !== "all") {
      whereConditions.push("c.claim_type = ?")
      params.push(claim_type)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    // Count total records
    const countSql = `
      SELECT COUNT(*) as total 
      FROM claims c
      JOIN patients p ON c.patient_id = p.id
      ${whereClause}
    `
    const [countResult] = await Database.query(countSql, params)
    const total = countResult.total

    // Get claims with patient info
    const sql = `
      SELECT 
        c.id, c.claim_number, c.claim_type, c.claim_status,
        c.service_date_from, c.service_date_to, c.total_charges,
        c.total_allowed, c.total_paid, c.patient_responsibility,
        c.submission_date, c.created_at,
        p.first_name, p.last_name, p.patient_id,
        pi.policy_number_encrypted as primary_policy,
        ip.payer_name as primary_payer
      FROM claims c
      JOIN patients p ON c.patient_id = p.id
      LEFT JOIN patient_insurance pi ON c.primary_insurance_id = pi.id
      LEFT JOIN insurance_providers ip ON pi.insurance_provider_id = ip.id
      ${whereClause}
      ORDER BY c.${sort_by} ${sort_order}
      LIMIT ? OFFSET ?
    `

    params.push(Number.parseInt(limit), Number.parseInt(offset))
    const claims = await Database.query(sql, params)

    await auditLog(req, "CLAIMS_VIEWED", "CLAIMS", null, {
      page,
      limit,
      filters: { status, patient_search, date_from, date_to, claim_type },
      total_results: claims.length,
    })

    res.json({
      success: true,
      data: claims,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error("Get claims error:", error)
    res.status(500).json({ error: "Failed to fetch claims" })
  }
})

// Get claim by ID with full details
router.get("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    // Get claim with patient and insurance info
    const claimSql = `
      SELECT 
        c.*,
        p.first_name, p.last_name, p.patient_id, p.date_of_birth,
        p.gender, p.phone, p.email, p.address_line1, p.city, p.state, p.zip_code,
        pi.policy_number_encrypted as primary_policy, pi.group_number as primary_group,
        ip.payer_name as primary_payer, ip.payer_id as primary_payer_id,
        si.policy_number_encrypted as secondary_policy, si.group_number as secondary_group,
        sp.payer_name as secondary_payer, sp.payer_id as secondary_payer_id
      FROM claims c
      JOIN patients p ON c.patient_id = p.id
      LEFT JOIN patient_insurance pi ON c.primary_insurance_id = pi.id
      LEFT JOIN insurance_providers ip ON pi.insurance_provider_id = ip.id
      LEFT JOIN patient_insurance si ON c.secondary_insurance_id = si.id
      LEFT JOIN insurance_providers sp ON si.insurance_provider_id = sp.id
      WHERE c.id = ?
    `

    const [claim] = await Database.query(claimSql, [req.params.id])

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" })
    }

    // Get claim line items
    const lineItemsSql = `
      SELECT * FROM claim_line_items 
      WHERE claim_id = ? 
      ORDER BY line_number
    `
    const lineItems = await Database.query(lineItemsSql, [req.params.id])

    // Get payment history
    const paymentsSql = `
      SELECT * FROM payment_postings 
      WHERE claim_id = ? 
      ORDER BY posted_at DESC
    `
    const payments = await Database.query(paymentsSql, [req.params.id])

    // Get denial history
    const denialsSql = `
      SELECT * FROM denials 
      WHERE claim_id = ? 
      ORDER BY created_at DESC
    `
    const denials = await Database.query(denialsSql, [req.params.id])

    const claimData = {
      ...claim,
      line_items: lineItems,
      payments,
      denials,
    }

    await auditLog(req, "CLAIM_VIEWED", "CLAIMS", req.params.id, {})

    res.json({ success: true, data: claimData })
  } catch (error) {
    console.error("Get claim error:", error)
    res.status(500).json({ error: "Failed to fetch claim" })
  }
})

// Create new claim
router.post("/", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const { error, value } = claimSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    // Generate claim number
    const claimNumber = await generateClaimNumber()

    // Calculate total charges from line items
    const totalCharges = value.line_items.reduce((sum, item) => sum + item.charge_amount, 0)

    // Create claim record
    const claimData = {
      claim_number: claimNumber,
      patient_id: value.patient_id,
      primary_insurance_id: value.primary_insurance_id,
      secondary_insurance_id: value.secondary_insurance_id,
      provider_id: value.provider_id,
      facility_id: value.facility_id,
      claim_type: value.claim_type,
      service_date_from: value.service_date_from,
      service_date_to: value.service_date_to,
      total_charges: totalCharges,
      primary_diagnosis_code: value.primary_diagnosis_code,
      admission_date: value.admission_date,
      discharge_date: value.discharge_date,
      place_of_service: value.place_of_service,
      billing_provider_npi: value.billing_provider_npi,
      rendering_provider_npi: value.rendering_provider_npi,
      claim_status: "DRAFT",
      created_by: req.user.id,
      updated_by: req.user.id,
    }

    const claimId = await Database.transaction(async (connection) => {
      // Insert claim
      const [claimResult] = await connection.execute(
        `INSERT INTO claims (${Object.keys(claimData).join(", ")}) VALUES (${Object.keys(claimData)
          .map(() => "?")
          .join(", ")})`,
        Object.values(claimData),
      )

      const newClaimId = claimResult.insertId

      // Insert line items
      for (const lineItem of value.line_items) {
        const lineItemData = {
          claim_id: newClaimId,
          ...lineItem,
        }

        await connection.execute(
          `INSERT INTO claim_line_items (${Object.keys(lineItemData).join(", ")}) VALUES (${Object.keys(lineItemData)
            .map(() => "?")
            .join(", ")})`,
          Object.values(lineItemData),
        )
      }

      return newClaimId
    })

    await auditLog(req, "CLAIM_CREATED", "CLAIMS", claimId, {
      claim_number: claimNumber,
      patient_id: value.patient_id,
      total_charges: totalCharges,
      line_items_count: value.line_items.length,
    })

    res.status(201).json({
      success: true,
      message: "Claim created successfully",
      data: { id: claimId, claim_number: claimNumber },
    })
  } catch (error) {
    console.error("Create claim error:", error)
    res.status(500).json({ error: "Failed to create claim" })
  }
})

// Update claim
router.put("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const existingClaim = await Database.findById("claims", req.params.id)
    if (!existingClaim) {
      return res.status(404).json({ error: "Claim not found" })
    }

    // Only allow updates if claim is in DRAFT or READY status
    if (!["DRAFT", "READY"].includes(existingClaim.claim_status)) {
      return res.status(400).json({ error: "Cannot update submitted claim" })
    }

    const { error, value } = claimSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    // Calculate total charges from line items
    const totalCharges = value.line_items.reduce((sum, item) => sum + item.charge_amount, 0)

    const updateData = {
      patient_id: value.patient_id,
      primary_insurance_id: value.primary_insurance_id,
      secondary_insurance_id: value.secondary_insurance_id,
      provider_id: value.provider_id,
      facility_id: value.facility_id,
      claim_type: value.claim_type,
      service_date_from: value.service_date_from,
      service_date_to: value.service_date_to,
      total_charges: totalCharges,
      primary_diagnosis_code: value.primary_diagnosis_code,
      admission_date: value.admission_date,
      discharge_date: value.discharge_date,
      place_of_service: value.place_of_service,
      billing_provider_npi: value.billing_provider_npi,
      rendering_provider_npi: value.rendering_provider_npi,
      updated_by: req.user.id,
    }

    await Database.transaction(async (connection) => {
      // Update claim
      await connection.execute(
        `UPDATE claims SET ${Object.keys(updateData)
          .map((key) => `${key} = ?`)
          .join(", ")} WHERE id = ?`,
        [...Object.values(updateData), req.params.id],
      )

      // Delete existing line items
      await connection.execute("DELETE FROM claim_line_items WHERE claim_id = ?", [req.params.id])

      // Insert new line items
      for (const lineItem of value.line_items) {
        const lineItemData = {
          claim_id: req.params.id,
          ...lineItem,
        }

        await connection.execute(
          `INSERT INTO claim_line_items (${Object.keys(lineItemData).join(", ")}) VALUES (${Object.keys(lineItemData)
            .map(() => "?")
            .join(", ")})`,
          Object.values(lineItemData),
        )
      }
    })

    await auditLog(req, "CLAIM_UPDATED", "CLAIMS", req.params.id, {
      total_charges: totalCharges,
      line_items_count: value.line_items.length,
    })

    res.json({ success: true, message: "Claim updated successfully" })
  } catch (error) {
    console.error("Update claim error:", error)
    res.status(500).json({ error: "Failed to update claim" })
  }
})

// Submit claim to clearinghouse
router.post("/:id/submit", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const claim = await Database.findById("claims", req.params.id)
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" })
    }

    if (!["DRAFT", "READY"].includes(claim.claim_status)) {
      return res.status(400).json({ error: "Claim cannot be submitted in current status" })
    }

    // Validate claim before submission
    const validationResult = await validateClaimForSubmission(req.params.id)
    if (!validationResult.valid) {
      return res.status(400).json({
        error: "Claim validation failed",
        validation_errors: validationResult.errors,
      })
    }

    // Get full claim data for submission
    const claimData = await getFullClaimData(req.params.id)

    // Submit to clearinghouse
    const submissionResult = await ClearinghouseService.submitClaim(claimData)

    if (submissionResult.success) {
      // Update claim status
      await Database.update("claims", req.params.id, {
        claim_status: "SUBMITTED",
        submission_date: new Date(),
        clearinghouse_id: submissionResult.clearinghouse_id,
        clearinghouse_status: submissionResult.status,
        updated_by: req.user.id,
      })

      await auditLog(req, "CLAIM_SUBMITTED", "CLAIMS", req.params.id, {
        clearinghouse_id: submissionResult.clearinghouse_id,
        submission_status: submissionResult.status,
      })

      res.json({
        success: true,
        message: "Claim submitted successfully",
        clearinghouse_id: submissionResult.clearinghouse_id,
      })
    } else {
      await auditLog(req, "CLAIM_SUBMISSION_FAILED", "CLAIMS", req.params.id, {
        error: submissionResult.error,
      })

      res.status(400).json({
        error: "Claim submission failed",
        details: submissionResult.error,
      })
    }
  } catch (error) {
    console.error("Submit claim error:", error)
    res.status(500).json({ error: "Failed to submit claim" })
  }
})

// Check claim status with clearinghouse
router.post("/:id/check-status", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const claim = await Database.findById("claims", req.params.id)
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" })
    }

    if (!claim.clearinghouse_id) {
      return res.status(400).json({ error: "Claim has not been submitted to clearinghouse" })
    }

    const statusResult = await ClearinghouseService.checkClaimStatus(claim.clearinghouse_id)

    if (statusResult.success) {
      // Update claim status if changed
      if (statusResult.status !== claim.clearinghouse_status) {
        await Database.update("claims", req.params.id, {
          clearinghouse_status: statusResult.status,
          updated_by: req.user.id,
        })
      }

      await auditLog(req, "CLAIM_STATUS_CHECKED", "CLAIMS", req.params.id, {
        clearinghouse_status: statusResult.status,
      })

      res.json({
        success: true,
        status: statusResult.status,
        details: statusResult.details,
      })
    } else {
      res.status(400).json({
        error: "Failed to check claim status",
        details: statusResult.error,
      })
    }
  } catch (error) {
    console.error("Check claim status error:", error)
    res.status(500).json({ error: "Failed to check claim status" })
  }
})

// Delete claim (only if in DRAFT status)
router.delete("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER"]), async (req, res) => {
  try {
    const claim = await Database.findById("claims", req.params.id)
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" })
    }

    if (claim.claim_status !== "DRAFT") {
      return res.status(400).json({ error: "Only draft claims can be deleted" })
    }

    await Database.transaction(async (connection) => {
      // Delete line items first
      await connection.execute("DELETE FROM claim_line_items WHERE claim_id = ?", [req.params.id])

      // Delete claim
      await connection.execute("DELETE FROM claims WHERE id = ?", [req.params.id])
    })

    await auditLog(req, "CLAIM_DELETED", "CLAIMS", req.params.id, {
      claim_number: claim.claim_number,
    })

    res.json({ success: true, message: "Claim deleted successfully" })
  } catch (error) {
    console.error("Delete claim error:", error)
    res.status(500).json({ error: "Failed to delete claim" })
  }
})

// Helper functions
async function generateClaimNumber() {
  const prefix = "CLM"
  const timestamp = Date.now().toString().slice(-8)
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")
  return `${prefix}${timestamp}${random}`
}

async function validateClaimForSubmission(claimId) {
  const errors = []

  try {
    // Get claim with required data
    const sql = `
      SELECT c.*, p.first_name, p.last_name, p.date_of_birth, p.gender,
             pi.policy_number_encrypted, ip.payer_id
      FROM claims c
      JOIN patients p ON c.patient_id = p.id
      JOIN patient_insurance pi ON c.primary_insurance_id = pi.id
      JOIN insurance_providers ip ON pi.insurance_provider_id = ip.id
      WHERE c.id = ?
    `
    const [claim] = await Database.query(sql, [claimId])

    if (!claim) {
      errors.push("Claim not found")
      return { valid: false, errors }
    }

    // Validate required fields
    if (!claim.billing_provider_npi) errors.push("Billing provider NPI is required")
    if (!claim.rendering_provider_npi) errors.push("Rendering provider NPI is required")
    if (!claim.primary_diagnosis_code) errors.push("Primary diagnosis code is required")
    if (!claim.place_of_service) errors.push("Place of service is required")

    // Validate patient data
    if (!claim.first_name || !claim.last_name) errors.push("Patient name is required")
    if (!claim.date_of_birth) errors.push("Patient date of birth is required")
    if (!claim.gender) errors.push("Patient gender is required")

    // Validate insurance
    if (!claim.policy_number_encrypted) errors.push("Insurance policy number is required")
    if (!claim.payer_id) errors.push("Insurance payer ID is required")

    // Validate line items
    const lineItems = await Database.query("SELECT * FROM claim_line_items WHERE claim_id = ?", [claimId])
    if (lineItems.length === 0) {
      errors.push("At least one line item is required")
    } else {
      lineItems.forEach((item, index) => {
        if (!item.procedure_code) errors.push(`Line ${index + 1}: Procedure code is required`)
        if (!item.charge_amount || item.charge_amount <= 0)
          errors.push(`Line ${index + 1}: Valid charge amount is required`)
        if (!item.service_date) errors.push(`Line ${index + 1}: Service date is required`)
      })
    }

    return { valid: errors.length === 0, errors }
  } catch (error) {
    console.error("Claim validation error:", error)
    return { valid: false, errors: ["Validation failed due to system error"] }
  }
}

async function getFullClaimData(claimId) {
  const sql = `
    SELECT 
      c.*,
      p.first_name as patient_first_name, p.last_name as patient_last_name,
      p.date_of_birth as patient_dob, p.gender as patient_gender,
      p.address_line1 as patient_address_line1, p.address_line2 as patient_address_line2,
      p.city as patient_city, p.state as patient_state, p.zip_code as patient_zip,
      pi.policy_number_encrypted as primary_policy_number, pi.group_number as primary_group_number,
      pi.subscriber_id as primary_subscriber_id, ip.payer_id as primary_payer_id,
      si.policy_number_encrypted as secondary_policy_number, si.group_number as secondary_group_number,
      si.subscriber_id as secondary_subscriber_id, sp.payer_id as secondary_payer_id
    FROM claims c
    JOIN patients p ON c.patient_id = p.id
    JOIN patient_insurance pi ON c.primary_insurance_id = pi.id
    JOIN insurance_providers ip ON pi.insurance_provider_id = ip.id
    LEFT JOIN patient_insurance si ON c.secondary_insurance_id = si.id
    LEFT JOIN insurance_providers sp ON si.insurance_provider_id = sp.id
    WHERE c.id = ?
  `

  const [claim] = await Database.query(sql, [claimId])
  const lineItems = await Database.query("SELECT * FROM claim_line_items WHERE claim_id = ? ORDER BY line_number", [
    claimId,
  ])

  return {
    ...claim,
    line_items: lineItems,
  }
}

module.exports = router
