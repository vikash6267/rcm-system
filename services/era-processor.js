// ERA (Electronic Remittance Advice) processing service
const fs = require("fs").promises
const path = require("path")
const { Database } = require("../lib/database")

class ERAProcessor {
  constructor() {
    this.eraDirectory = process.env.ERA_DIRECTORY || "./era_files"
  }

  async processERAFile(filePath, fileName) {
    try {
      console.log(`Processing ERA file: ${fileName}`)

      const fileContent = await fs.readFile(filePath, "utf8")
      const eraData = this.parseERAFile(fileContent)

      // Store ERA record
      const eraId = await Database.create("eras", {
        era_number: eraData.era_number,
        payer_id: eraData.payer_id,
        payer_name: eraData.payer_name,
        check_number: eraData.check_number,
        check_date: eraData.check_date,
        check_amount: eraData.check_amount,
        era_file_path: filePath,
        processing_status: "PROCESSING",
      })

      // Process each claim in the ERA
      for (const claimDetail of eraData.claims) {
        await this.processERAClaim(eraId, claimDetail)
      }

      // Update ERA status
      await Database.update("eras", eraId, {
        processing_status: "POSTED",
        processed_at: new Date(),
      })

      console.log(`ERA ${eraData.era_number} processed successfully`)
      return { success: true, era_id: eraId }
    } catch (error) {
      console.error("ERA processing error:", error)
      return { success: false, error: error.message }
    }
  }

  async processERAClaim(eraId, claimDetail) {
    try {
      // Find matching claim in database
      const claim = await Database.findOne("claims", {
        claim_number: claimDetail.claim_number,
      })

      // Store ERA claim detail
      const eraClaimId = await Database.create("era_claim_details", {
        era_id: eraId,
        claim_id: claim ? claim.id : null,
        claim_number: claimDetail.claim_number,
        patient_name: claimDetail.patient_name,
        service_date_from: claimDetail.service_date_from,
        service_date_to: claimDetail.service_date_to,
        total_charge_amount: claimDetail.total_charge_amount,
        total_paid_amount: claimDetail.total_paid_amount,
        patient_responsibility: claimDetail.patient_responsibility,
        claim_status_code: claimDetail.claim_status_code,
        claim_status_description: claimDetail.claim_status_description,
      })

      if (claim) {
        // Auto-post payment if enabled
        const autoPostingEnabled = await this.isAutoPostingEnabled()

        if (autoPostingEnabled && claimDetail.total_paid_amount > 0) {
          await this.autoPostPayment(claim.id, eraId, claimDetail)
        }

        // Update claim status
        await Database.update("claims", claim.id, {
          claim_status: this.mapERAStatusToClaimStatus(claimDetail.claim_status_code),
          total_paid: claimDetail.total_paid_amount,
          patient_responsibility: claimDetail.patient_responsibility,
        })

        // Create denial record if claim was denied
        if (this.isClaimDenied(claimDetail.claim_status_code)) {
          await this.createDenialRecord(claim.id, claimDetail)
        }
      }

      return eraClaimId
    } catch (error) {
      console.error("ERA claim processing error:", error)
      throw error
    }
  }

  async autoPostPayment(claimId, eraId, claimDetail) {
    try {
      const paymentData = {
        claim_id: claimId,
        era_id: eraId,
        payment_type: "INSURANCE",
        payment_method: "ERA",
        payment_amount: claimDetail.total_paid_amount,
        payment_date: new Date(),
        reference_number: claimDetail.claim_number,
        payer_name: claimDetail.payer_name,
        posted_by: null, // System auto-posting
        posted_at: new Date(),
      }

      const paymentId = await Database.create("payment_postings", paymentData)
      console.log(`Auto-posted payment ${paymentId} for claim ${claimId}`)

      return paymentId
    } catch (error) {
      console.error("Auto-post payment error:", error)
      throw error
    }
  }

  async createDenialRecord(claimId, claimDetail) {
    try {
      const denialData = {
        claim_id: claimId,
        denial_date: new Date(),
        denial_reason_code: claimDetail.claim_status_code,
        denial_reason_description: claimDetail.claim_status_description,
        denial_category: this.categorizeDenial(claimDetail.claim_status_code),
        priority: this.getDenialPriority(claimDetail.claim_status_code),
        resolution_status: "OPEN",
        appeal_deadline: this.calculateAppealDeadline(),
        follow_up_date: this.calculateFollowUpDate(),
      }

      const denialId = await Database.create("denials", denialData)
      console.log(`Created denial record ${denialId} for claim ${claimId}`)

      return denialId
    } catch (error) {
      console.error("Create denial record error:", error)
      throw error
    }
  }

  parseERAFile(fileContent) {
    // Parse X12 835 ERA file format
    // This is a simplified parser - in production, use a proper X12 parser
    const lines = fileContent.split("\n")
    const eraData = {
      era_number: "",
      payer_id: "",
      payer_name: "",
      check_number: "",
      check_date: null,
      check_amount: 0,
      claims: [],
    }

    let currentClaim = null

    for (const line of lines) {
      const segments = line.split("*")
      const segmentId = segments[0]

      switch (segmentId) {
        case "BPR": // Beginning Segment for Payment Order/Remittance Advice
          eraData.check_amount = Number.parseFloat(segments[2])
          eraData.check_date = this.parseX12Date(segments[16])
          break

        case "TRN": // Trace
          eraData.era_number = segments[2]
          break

        case "N1": // Name
          if (segments[1] === "PR") {
            // Payer
            eraData.payer_name = segments[2]
          }
          break

        case "CLP": // Claim Payment Information
          if (currentClaim) {
            eraData.claims.push(currentClaim)
          }
          currentClaim = {
            claim_number: segments[1],
            claim_status_code: segments[2],
            total_charge_amount: Number.parseFloat(segments[3]),
            total_paid_amount: Number.parseFloat(segments[4]),
            patient_responsibility: Number.parseFloat(segments[5]),
            claim_status_description: this.getClaimStatusDescription(segments[2]),
          }
          break

        case "NM1": // Individual or Organizational Name
          if (currentClaim && segments[1] === "QC") {
            // Patient
            currentClaim.patient_name = `${segments[4]} ${segments[3]}`
          }
          break

        case "DTM": // Date/Time Reference
          if (currentClaim && segments[1] === "232") {
            // Statement From Date
            currentClaim.service_date_from = this.parseX12Date(segments[2])
          }
          if (currentClaim && segments[1] === "233") {
            // Statement To Date
            currentClaim.service_date_to = this.parseX12Date(segments[2])
          }
          break
      }
    }

    if (currentClaim) {
      eraData.claims.push(currentClaim)
    }

    return eraData
  }

  parseX12Date(dateString) {
    if (!dateString || dateString.length !== 8) return null

    const year = dateString.substring(0, 4)
    const month = dateString.substring(4, 6)
    const day = dateString.substring(6, 8)

    return new Date(`${year}-${month}-${day}`)
  }

  getClaimStatusDescription(statusCode) {
    const statusMap = {
      1: "Processed as Primary",
      2: "Processed as Secondary",
      3: "Processed as Tertiary",
      4: "Denied",
      19: "Processed as Primary, Forwarded to Additional Payer(s)",
      20: "Processed as Secondary, Forwarded to Additional Payer(s)",
      21: "Processed as Tertiary, Forwarded to Additional Payer(s)",
      22: "Reversal of Previous Payment",
      23: "Not Our Claim, Forwarded to Additional Payer(s)",
      25: "Predetermination Pricing Only - No Payment",
    }

    return statusMap[statusCode] || "Unknown Status"
  }

  mapERAStatusToClaimStatus(eraStatusCode) {
    const statusMap = {
      1: "PAID",
      2: "PAID",
      3: "PAID",
      4: "DENIED",
      19: "PAID",
      20: "PAID",
      21: "PAID",
      22: "PAID",
      23: "REJECTED",
      25: "ACCEPTED",
    }

    return statusMap[eraStatusCode] || "SUBMITTED"
  }

  isClaimDenied(statusCode) {
    return ["4", "23"].includes(statusCode)
  }

  categorizeDenial(reasonCode) {
    // Categorize denial based on reason code
    const technicalCodes = ["16", "18", "26", "27"]
    const clinicalCodes = ["11", "12", "13", "14", "15"]
    const authorizationCodes = ["52", "53", "54", "55", "56"]
    const eligibilityCodes = ["27", "29", "30", "31"]

    if (technicalCodes.includes(reasonCode)) return "TECHNICAL"
    if (clinicalCodes.includes(reasonCode)) return "CLINICAL"
    if (authorizationCodes.includes(reasonCode)) return "AUTHORIZATION"
    if (eligibilityCodes.includes(reasonCode)) return "ELIGIBILITY"

    return "OTHER"
  }

  getDenialPriority(reasonCode) {
    const highPriorityCodes = ["11", "12", "27", "29"]
    const urgentCodes = ["16", "18"]

    if (urgentCodes.includes(reasonCode)) return "URGENT"
    if (highPriorityCodes.includes(reasonCode)) return "HIGH"

    return "MEDIUM"
  }

  calculateAppealDeadline() {
    // Most payers allow 90 days for appeals
    const deadline = new Date()
    deadline.setDate(deadline.getDate() + 90)
    return deadline
  }

  calculateFollowUpDate() {
    // Follow up in 14 days
    const followUp = new Date()
    followUp.setDate(followUp.getDate() + 14)
    return followUp
  }

  async isAutoPostingEnabled() {
    const setting = await Database.findOne("system_settings", {
      setting_key: "era_auto_posting_enabled",
    })
    return setting ? setting.setting_value === "true" : false
  }
}

module.exports = new ERAProcessor()
