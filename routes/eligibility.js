// Eligibility verification routes
const express = require("express")
const { Database } = require("../lib/database")
const { auditLog } = require("../middleware/audit")
const AuthMiddleware = require("../middleware/auth")

const router = express.Router()

// Real-time eligibility verification
router.post("/verify", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER"]), async (req, res) => {
  try {
    const { patient_id, insurance_id, service_date } = req.body

    if (!patient_id || !insurance_id || !service_date) {
      return res.status(400).json({ error: "Patient ID, insurance ID, and service date are required" })
    }

    // Get patient and insurance details
    const patient = await Database.findById("patients", patient_id)
    const insurance = await Database.findById("patient_insurance", insurance_id)

    if (!patient || !insurance) {
      return res.status(404).json({ error: "Patient or insurance not found" })
    }

    // TODO: Integrate with real eligibility service (e.g., Change Healthcare, Availity)
    // For now, simulate eligibility check
    const eligibilityResult = await simulateEligibilityCheck(patient, insurance, service_date)

    // Store verification result
    const verificationData = {
      patient_id,
      insurance_id,
      verification_date: new Date(),
      service_date,
      verification_type: "REAL_TIME",
      eligibility_status: eligibilityResult.status,
      benefits_active: eligibilityResult.benefits_active,
      copay_amount: eligibilityResult.copay_amount,
      deductible_amount: eligibilityResult.deductible_amount,
      deductible_remaining: eligibilityResult.deductible_remaining,
      out_of_pocket_max: eligibilityResult.out_of_pocket_max,
      out_of_pocket_remaining: eligibilityResult.out_of_pocket_remaining,
      coverage_level: eligibilityResult.coverage_level,
      plan_name: eligibilityResult.plan_name,
      group_number: eligibilityResult.group_number,
      verification_response: JSON.stringify(eligibilityResult),
      verified_by: req.user.id,
    }

    const verificationId = await Database.create("eligibility_verifications", verificationData)

    await auditLog(req, "ELIGIBILITY_VERIFIED", "ELIGIBILITY", verificationId, {
      patient_id,
      insurance_id,
      service_date,
      status: eligibilityResult.status,
    })

    res.json({
      success: true,
      data: {
        verification_id: verificationId,
        ...eligibilityResult,
      },
    })
  } catch (error) {
    console.error("Eligibility verification error:", error)
    res.status(500).json({ error: "Failed to verify eligibility" })
  }
})

// Get eligibility history for patient
router.get(
  "/patient/:patientId",
  AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]),
  async (req, res) => {
    try {
      const { patientId } = req.params
      const { limit = 10 } = req.query

      const sql = `
      SELECT ev.*, pi.policy_number_encrypted, ip.payer_name
      FROM eligibility_verifications ev
      JOIN patient_insurance pi ON ev.insurance_id = pi.id
      JOIN insurance_providers ip ON pi.insurance_provider_id = ip.id
      WHERE ev.patient_id = ?
      ORDER BY ev.verification_date DESC
      LIMIT ?
    `

      const verifications = await Database.query(sql, [patientId, Number.parseInt(limit)])

      await auditLog(req, "ELIGIBILITY_HISTORY_VIEWED", "ELIGIBILITY", null, {
        patient_id: patientId,
        results_count: verifications.length,
      })

      res.json({ success: true, data: verifications })
    } catch (error) {
      console.error("Get eligibility history error:", error)
      res.status(500).json({ error: "Failed to fetch eligibility history" })
    }
  },
)

// Batch eligibility verification
router.post("/batch-verify", AuthMiddleware.authorize(["ADMIN", "MANAGER"]), async (req, res) => {
  try {
    const { verifications } = req.body

    if (!Array.isArray(verifications) || verifications.length === 0) {
      return res.status(400).json({ error: "Verifications array is required" })
    }

    const results = []

    for (const verification of verifications) {
      try {
        const { patient_id, insurance_id, service_date } = verification

        const patient = await Database.findById("patients", patient_id)
        const insurance = await Database.findById("patient_insurance", insurance_id)

        if (patient && insurance) {
          const eligibilityResult = await simulateEligibilityCheck(patient, insurance, service_date)

          const verificationData = {
            patient_id,
            insurance_id,
            verification_date: new Date(),
            service_date,
            verification_type: "BATCH",
            eligibility_status: eligibilityResult.status,
            benefits_active: eligibilityResult.benefits_active,
            copay_amount: eligibilityResult.copay_amount,
            deductible_amount: eligibilityResult.deductible_amount,
            deductible_remaining: eligibilityResult.deductible_remaining,
            out_of_pocket_max: eligibilityResult.out_of_pocket_max,
            out_of_pocket_remaining: eligibilityResult.out_of_pocket_remaining,
            coverage_level: eligibilityResult.coverage_level,
            plan_name: eligibilityResult.plan_name,
            group_number: eligibilityResult.group_number,
            verification_response: JSON.stringify(eligibilityResult),
            verified_by: req.user.id,
          }

          const verificationId = await Database.create("eligibility_verifications", verificationData)

          results.push({
            patient_id,
            insurance_id,
            verification_id: verificationId,
            status: "SUCCESS",
            ...eligibilityResult,
          })
        } else {
          results.push({
            patient_id,
            insurance_id,
            status: "ERROR",
            error: "Patient or insurance not found",
          })
        }
      } catch (error) {
        results.push({
          patient_id: verification.patient_id,
          insurance_id: verification.insurance_id,
          status: "ERROR",
          error: error.message,
        })
      }
    }

    await auditLog(req, "BATCH_ELIGIBILITY_VERIFIED", "ELIGIBILITY", null, {
      total_verifications: verifications.length,
      successful: results.filter((r) => r.status === "SUCCESS").length,
      failed: results.filter((r) => r.status === "ERROR").length,
    })

    res.json({
      success: true,
      data: {
        total: verifications.length,
        successful: results.filter((r) => r.status === "SUCCESS").length,
        failed: results.filter((r) => r.status === "ERROR").length,
        results,
      },
    })
  } catch (error) {
    console.error("Batch eligibility verification error:", error)
    res.status(500).json({ error: "Failed to process batch eligibility verification" })
  }
})

// Simulate eligibility check (replace with real API integration)
async function simulateEligibilityCheck(patient, insurance, serviceDate) {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 500))

  // Simulate different eligibility scenarios
  const scenarios = [
    {
      status: "ACTIVE",
      benefits_active: true,
      copay_amount: 25.0,
      deductible_amount: 1000.0,
      deductible_remaining: 750.0,
      out_of_pocket_max: 5000.0,
      out_of_pocket_remaining: 4200.0,
      coverage_level: "INDIVIDUAL",
      plan_name: "Health Plus PPO",
      group_number: "GRP001",
    },
    {
      status: "ACTIVE",
      benefits_active: true,
      copay_amount: 35.0,
      deductible_amount: 2500.0,
      deductible_remaining: 2500.0,
      out_of_pocket_max: 7500.0,
      out_of_pocket_remaining: 7500.0,
      coverage_level: "FAMILY",
      plan_name: "Premium Care HMO",
      group_number: "GRP002",
    },
    {
      status: "INACTIVE",
      benefits_active: false,
      copay_amount: null,
      deductible_amount: null,
      deductible_remaining: null,
      out_of_pocket_max: null,
      out_of_pocket_remaining: null,
      coverage_level: null,
      plan_name: null,
      group_number: null,
    },
  ]

  // Return random scenario for simulation
  return scenarios[Math.floor(Math.random() * scenarios.length)]
}

module.exports = router
