// Clearinghouse integration service
const axios = require("axios")
const { Database } = require("../lib/database")

class ClearinghouseService {
  constructor() {
    this.baseURL = process.env.CLEARINGHOUSE_API_URL || "https://api.claimmd.com"
    this.apiKey = process.env.CLEARINGHOUSE_API_KEY
    this.timeout = 30000
  }

  async submitClaim(claimData) {
    try {
      const response = await axios.post(`${this.baseURL}/claims/submit`, this.formatClaimForSubmission(claimData), {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: this.timeout,
      })

      return {
        success: true,
        clearinghouse_id: response.data.claim_id,
        status: response.data.status,
        message: response.data.message,
      }
    } catch (error) {
      console.error("Claim submission error:", error)
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      }
    }
  }

  async checkClaimStatus(clearinghouseId) {
    try {
      const response = await axios.get(`${this.baseURL}/claims/${clearinghouseId}/status`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: this.timeout,
      })

      return {
        success: true,
        status: response.data.status,
        details: response.data.details,
      }
    } catch (error) {
      console.error("Claim status check error:", error)
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      }
    }
  }

  async verifyEligibility(patientData, insuranceData, serviceDate) {
    try {
      const eligibilityRequest = {
        patient: {
          first_name: patientData.first_name,
          last_name: patientData.last_name,
          date_of_birth: patientData.date_of_birth,
          gender: patientData.gender,
        },
        insurance: {
          payer_id: insuranceData.payer_id,
          policy_number: insuranceData.policy_number,
          group_number: insuranceData.group_number,
          subscriber_id: insuranceData.subscriber_id,
        },
        service_date: serviceDate,
      }

      const response = await axios.post(`${this.baseURL}/eligibility/verify`, eligibilityRequest, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: this.timeout,
      })

      return {
        success: true,
        eligibility: response.data,
      }
    } catch (error) {
      console.error("Eligibility verification error:", error)
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      }
    }
  }

  async downloadERA(eraId) {
    try {
      const response = await axios.get(`${this.baseURL}/era/${eraId}/download`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        responseType: "stream",
        timeout: this.timeout,
      })

      return {
        success: true,
        stream: response.data,
      }
    } catch (error) {
      console.error("ERA download error:", error)
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      }
    }
  }

  formatClaimForSubmission(claimData) {
    // Format claim data according to clearinghouse requirements
    return {
      claim_number: claimData.claim_number,
      patient: {
        id: claimData.patient_id,
        first_name: claimData.patient_first_name,
        last_name: claimData.patient_last_name,
        date_of_birth: claimData.patient_dob,
        gender: claimData.patient_gender,
        address: {
          line1: claimData.patient_address_line1,
          line2: claimData.patient_address_line2,
          city: claimData.patient_city,
          state: claimData.patient_state,
          zip: claimData.patient_zip,
        },
      },
      insurance: {
        primary: {
          payer_id: claimData.primary_payer_id,
          policy_number: claimData.primary_policy_number,
          group_number: claimData.primary_group_number,
          subscriber_id: claimData.primary_subscriber_id,
        },
        secondary: claimData.secondary_payer_id
          ? {
              payer_id: claimData.secondary_payer_id,
              policy_number: claimData.secondary_policy_number,
              group_number: claimData.secondary_group_number,
              subscriber_id: claimData.secondary_subscriber_id,
            }
          : null,
      },
      provider: {
        billing_npi: claimData.billing_provider_npi,
        rendering_npi: claimData.rendering_provider_npi,
        facility_npi: claimData.facility_npi,
      },
      claim_details: {
        type: claimData.claim_type,
        service_date_from: claimData.service_date_from,
        service_date_to: claimData.service_date_to,
        place_of_service: claimData.place_of_service,
        total_charges: claimData.total_charges,
        diagnosis_codes: [
          claimData.primary_diagnosis_code,
          claimData.secondary_diagnosis_code,
          claimData.tertiary_diagnosis_code,
        ].filter(Boolean),
      },
      line_items: claimData.line_items || [],
    }
  }
}

module.exports = new ClearinghouseService()
