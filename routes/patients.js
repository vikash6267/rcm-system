// Patient management routes
const express = require("express")
const { Database } = require("../lib/database")
const { auditLog } = require("../middleware/audit")
const AuthMiddleware = require("../middleware/auth")
const Encryption = require("../lib/encryption")
const Joi = require("joi")

const router = express.Router()

// Validation schemas
const patientSchema = Joi.object({
  patient_id: Joi.string().required(),
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().min(1).max(100).required(),
  date_of_birth: Joi.date().required(),
  ssn: Joi.string()
    .pattern(/^\d{9}$/)
    .optional(),
  gender: Joi.string().valid("M", "F", "O", "U").required(),
  phone: Joi.string().max(20).optional(),
  email: Joi.string().email().optional(),
  address_line1: Joi.string().max(255).optional(),
  address_line2: Joi.string().max(255).optional(),
  city: Joi.string().max(100).optional(),
  state: Joi.string().max(50).optional(),
  zip_code: Joi.string().max(20).optional(),
  emergency_contact_name: Joi.string().max(200).optional(),
  emergency_contact_phone: Joi.string().max(20).optional(),
})

// Get all patients with pagination and search
router.get("/", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", status = "all" } = req.query
    const offset = (page - 1) * limit

    let whereClause = ""
    const params = []

    if (search) {
      whereClause = "WHERE (first_name LIKE ? OR last_name LIKE ? OR patient_id LIKE ?)"
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }

    const countSql = `SELECT COUNT(*) as total FROM patients ${whereClause}`
    const [countResult] = await Database.query(countSql, params)
    const total = countResult.total

    const sql = `
      SELECT id, patient_id, first_name, last_name, date_of_birth, gender, 
             phone, email, city, state, created_at
      FROM patients 
      ${whereClause}
      ORDER BY last_name, first_name
      LIMIT ? OFFSET ?
    `

    params.push(Number.parseInt(limit), Number.parseInt(offset))
    const patients = await Database.query(sql, params)

    await auditLog(req, "PATIENTS_VIEWED", "PATIENTS", null, {
      page,
      limit,
      search,
      total_results: patients.length,
    })

    res.json({
      success: true,
      data: patients,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error("Get patients error:", error)
    res.status(500).json({ error: "Failed to fetch patients" })
  }
})

// Get patient by ID
router.get("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const patient = await Database.findById("patients", req.params.id)

    if (!patient) {
      return res.status(404).json({ error: "Patient not found" })
    }

    // Decrypt sensitive data
    if (patient.ssn_encrypted) {
      patient.ssn = Encryption.decrypt(JSON.parse(patient.ssn_encrypted))
      delete patient.ssn_encrypted
    }

    await auditLog(req, "PATIENT_VIEWED", "PATIENTS", req.params.id, {})

    res.json({ success: true, data: patient })
  } catch (error) {
    console.error("Get patient error:", error)
    res.status(500).json({ error: "Failed to fetch patient" })
  }
})

// Create new patient
router.post("/", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const { error, value } = patientSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    // Check if patient ID already exists
    const existingPatient = await Database.findOne("patients", { patient_id: value.patient_id })
    if (existingPatient) {
      return res.status(400).json({ error: "Patient ID already exists" })
    }

    // Encrypt SSN if provided
    const patientData = { ...value }
    if (patientData.ssn) {
      patientData.ssn_encrypted = JSON.stringify(Encryption.encrypt(patientData.ssn))
      delete patientData.ssn
    }

    patientData.created_by = req.user.id
    patientData.updated_by = req.user.id

    const patientId = await Database.create("patients", patientData)

    await auditLog(req, "PATIENT_CREATED", "PATIENTS", patientId, {
      patient_id: value.patient_id,
      name: `${value.first_name} ${value.last_name}`,
    })

    res.status(201).json({
      success: true,
      message: "Patient created successfully",
      data: { id: patientId },
    })
  } catch (error) {
    console.error("Create patient error:", error)
    res.status(500).json({ error: "Failed to create patient" })
  }
})

// Update patient
router.put("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const { error, value } = patientSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    const existingPatient = await Database.findById("patients", req.params.id)
    if (!existingPatient) {
      return res.status(404).json({ error: "Patient not found" })
    }

    // Encrypt SSN if provided
    const updateData = { ...value }
    if (updateData.ssn) {
      updateData.ssn_encrypted = JSON.stringify(Encryption.encrypt(updateData.ssn))
      delete updateData.ssn
    }

    updateData.updated_by = req.user.id

    const success = await Database.update("patients", req.params.id, updateData)

    if (!success) {
      return res.status(400).json({ error: "Failed to update patient" })
    }

    await auditLog(req, "PATIENT_UPDATED", "PATIENTS", req.params.id, {
      patient_id: value.patient_id,
      name: `${value.first_name} ${value.last_name}`,
    })

    res.json({ success: true, message: "Patient updated successfully" })
  } catch (error) {
    console.error("Update patient error:", error)
    res.status(500).json({ error: "Failed to update patient" })
  }
})

// Get patient insurance
router.get("/:id/insurance", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const sql = `
      SELECT pi.*, ip.payer_name, ip.payer_type
      FROM patient_insurance pi
      JOIN insurance_providers ip ON pi.insurance_provider_id = ip.id
      WHERE pi.patient_id = ? AND pi.is_active = true
      ORDER BY pi.priority
    `

    const insurance = await Database.query(sql, [req.params.id])

    // Decrypt policy numbers
    insurance.forEach((ins) => {
      if (ins.policy_number_encrypted) {
        ins.policy_number = Encryption.decrypt(JSON.parse(ins.policy_number_encrypted))
        delete ins.policy_number_encrypted
      }
    })

    await auditLog(req, "PATIENT_INSURANCE_VIEWED", "PATIENTS", req.params.id, {})

    res.json({ success: true, data: insurance })
  } catch (error) {
    console.error("Get patient insurance error:", error)
    res.status(500).json({ error: "Failed to fetch patient insurance" })
  }
})

// Add patient insurance
router.post("/:id/insurance", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const insuranceSchema = Joi.object({
      insurance_provider_id: Joi.number().required(),
      policy_number: Joi.string().required(),
      group_number: Joi.string().optional(),
      subscriber_id: Joi.string().optional(),
      subscriber_name: Joi.string().max(200).optional(),
      relationship_to_subscriber: Joi.string().valid("SELF", "SPOUSE", "CHILD", "OTHER").required(),
      effective_date: Joi.date().optional(),
      termination_date: Joi.date().optional(),
      copay_amount: Joi.number().precision(2).optional(),
      deductible_amount: Joi.number().precision(2).optional(),
      out_of_pocket_max: Joi.number().precision(2).optional(),
      priority: Joi.string().valid("PRIMARY", "SECONDARY", "TERTIARY").required(),
    })

    const { error, value } = insuranceSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    // Encrypt policy number
    const insuranceData = { ...value }
    insuranceData.patient_id = req.params.id
    insuranceData.policy_number_encrypted = JSON.stringify(Encryption.encrypt(insuranceData.policy_number))
    delete insuranceData.policy_number

    const insuranceId = await Database.create("patient_insurance", insuranceData)

    await auditLog(req, "PATIENT_INSURANCE_ADDED", "PATIENTS", req.params.id, {
      insurance_id: insuranceId,
      priority: value.priority,
    })

    res.status(201).json({
      success: true,
      message: "Insurance added successfully",
      data: { id: insuranceId },
    })
  } catch (error) {
    console.error("Add patient insurance error:", error)
    res.status(500).json({ error: "Failed to add patient insurance" })
  }
})

module.exports = router
