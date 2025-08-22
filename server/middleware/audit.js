// HIPAA-compliant audit logging middleware
const { Database } = require("../lib/database")

class AuditMiddleware {
  static middleware() {
    return async (req, res, next) => {
      // Store original res.json to capture response
      const originalJson = res.json
      let responseData = null

      res.json = function (data) {
        responseData = data
        return originalJson.call(this, data)
      }

      // Store original res.end to capture final response
      const originalEnd = res.end
      res.end = function (chunk, encoding) {
        // Log the audit entry
        setImmediate(() => {
          auditLog(req, res, responseData)
        })

        return originalEnd.call(this, chunk, encoding)
      }

      next()
    }
  }
}

async function auditLog(req, res, responseData = null) {
  try {
    const user = req.user || null
    const patientId = extractPatientId(req)

    const auditData = {
      user_id: user ? user.id : null,
      action: `${req.method} ${req.path}`,
      resource_type: extractResourceType(req.path),
      resource_id: extractResourceId(req),
      patient_id: patientId,
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.get("User-Agent"),
      request_data: sanitizeRequestData(req),
      response_status: res.statusCode,
      session_id: req.sessionID || null,
      timestamp: new Date(),
    }

    await Database.create("audit_logs", auditData)
  } catch (error) {
    console.error("Audit logging error:", error)
    // Don't throw - audit failures shouldn't break the application
  }
}

function extractPatientId(req) {
  // Extract patient ID from various sources
  if (req.params.patientId) return req.params.patientId
  if (req.body.patient_id) return req.body.patient_id
  if (req.query.patient_id) return req.query.patient_id

  // Check if this is a patient-related endpoint
  const patientMatch = req.path.match(/\/patients\/(\d+)/)
  if (patientMatch) return patientMatch[1]

  return null
}

function extractResourceType(path) {
  const segments = path.split("/").filter(Boolean)
  if (segments.length > 0) {
    return segments[0].toUpperCase()
  }
  return "UNKNOWN"
}

function extractResourceId(req) {
  if (req.params.id) return req.params.id

  const pathSegments = req.path.split("/").filter(Boolean)
  const lastSegment = pathSegments[pathSegments.length - 1]

  if (/^\d+$/.test(lastSegment)) {
    return lastSegment
  }

  return null
}

function sanitizeRequestData(req) {
  const sensitiveFields = [
    "password",
    "ssn",
    "social_security_number",
    "credit_card",
    "bank_account",
    "token",
    "secret",
  ]

  const data = {
    params: req.params,
    query: req.query,
    body: { ...req.body },
  }

  // Remove sensitive data
  function sanitizeObject(obj) {
    if (typeof obj !== "object" || obj === null) return obj

    const sanitized = {}
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase()
      if (sensitiveFields.some((field) => lowerKey.includes(field))) {
        sanitized[key] = "[REDACTED]"
      } else if (typeof value === "object") {
        sanitized[key] = sanitizeObject(value)
      } else {
        sanitized[key] = value
      }
    }
    return sanitized
  }

  return sanitizeObject(data)
}

module.exports = { AuditMiddleware, auditLog }
