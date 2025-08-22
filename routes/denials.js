// Denial management routes
const express = require("express")
const { Database } = require("../lib/database")
const { auditLog } = require("../middleware/audit")
const AuthMiddleware = require("../middleware/auth")
const Joi = require("joi")

const router = express.Router()

// Get all denials with filtering and pagination
router.get("/", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "COLLECTOR"]), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = "all",
      category = "all",
      priority = "all",
      assigned_to = "all",
      date_from = "",
      date_to = "",
      sort_by = "created_at",
      sort_order = "DESC",
    } = req.query

    const offset = (page - 1) * limit
    const whereConditions = []
    const params = []

    // Build WHERE clause based on filters
    if (status !== "all") {
      whereConditions.push("d.resolution_status = ?")
      params.push(status)
    }

    if (category !== "all") {
      whereConditions.push("d.denial_category = ?")
      params.push(category)
    }

    if (priority !== "all") {
      whereConditions.push("d.priority = ?")
      params.push(priority)
    }

    if (assigned_to !== "all") {
      whereConditions.push("d.assigned_to = ?")
      params.push(assigned_to)
    }

    if (date_from) {
      whereConditions.push("d.denial_date >= ?")
      params.push(date_from)
    }

    if (date_to) {
      whereConditions.push("d.denial_date <= ?")
      params.push(date_to)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    // Count total records
    const countSql = `
      SELECT COUNT(*) as total 
      FROM denials d
      JOIN claims c ON d.claim_id = c.id
      JOIN patients p ON c.patient_id = p.id
      ${whereClause}
    `
    const [countResult] = await Database.query(countSql, params)
    const total = countResult.total

    // Get denials with claim and patient info
    const sql = `
      SELECT 
        d.*, c.claim_number, c.total_charges, c.service_date_from, c.service_date_to,
        p.first_name, p.last_name, p.patient_id,
        u.first_name as assigned_first_name, u.last_name as assigned_last_name
      FROM denials d
      JOIN claims c ON d.claim_id = c.id
      JOIN patients p ON c.patient_id = p.id
      LEFT JOIN users u ON d.assigned_to = u.id
      ${whereClause}
      ORDER BY d.${sort_by} ${sort_order}
      LIMIT ? OFFSET ?
    `

    params.push(Number.parseInt(limit), Number.parseInt(offset))
    const denials = await Database.query(sql, params)

    await auditLog(req, "DENIALS_VIEWED", "DENIALS", null, {
      page,
      limit,
      filters: { status, category, priority, assigned_to, date_from, date_to },
      total_results: denials.length,
    })

    res.json({
      success: true,
      data: denials,
      pagination: {
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error("Get denials error:", error)
    res.status(500).json({ error: "Failed to fetch denials" })
  }
})

// Get denial by ID
router.get("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "COLLECTOR"]), async (req, res) => {
  try {
    const sql = `
      SELECT 
        d.*, c.claim_number, c.total_charges, c.service_date_from, c.service_date_to,
        c.primary_diagnosis_code, c.place_of_service,
        p.first_name, p.last_name, p.patient_id, p.date_of_birth,
        u.first_name as assigned_first_name, u.last_name as assigned_last_name,
        creator.first_name as created_by_first_name, creator.last_name as created_by_last_name
      FROM denials d
      JOIN claims c ON d.claim_id = c.id
      JOIN patients p ON c.patient_id = p.id
      LEFT JOIN users u ON d.assigned_to = u.id
      LEFT JOIN users creator ON d.created_by = creator.id
      WHERE d.id = ?
    `

    const [denial] = await Database.query(sql, [req.params.id])

    if (!denial) {
      return res.status(404).json({ error: "Denial not found" })
    }

    await auditLog(req, "DENIAL_VIEWED", "DENIALS", req.params.id, {})

    res.json({ success: true, data: denial })
  } catch (error) {
    console.error("Get denial error:", error)
    res.status(500).json({ error: "Failed to fetch denial" })
  }
})

// Update denial status and assignment
router.put("/:id", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "COLLECTOR"]), async (req, res) => {
  try {
    const updateSchema = Joi.object({
      resolution_status: Joi.string()
        .valid("OPEN", "IN_PROGRESS", "APPEALED", "CORRECTED", "WRITTEN_OFF", "RESOLVED")
        .optional(),
      assigned_to: Joi.number().optional(),
      priority: Joi.string().valid("LOW", "MEDIUM", "HIGH", "URGENT").optional(),
      resolution_notes: Joi.string().max(1000).optional(),
      follow_up_date: Joi.date().optional(),
    })

    const { error, value } = updateSchema.validate(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    const existingDenial = await Database.findById("denials", req.params.id)
    if (!existingDenial) {
      return res.status(404).json({ error: "Denial not found" })
    }

    const updateData = { ...value }
    updateData.updated_by = req.user.id

    // Set resolution date if status is being changed to resolved
    if (value.resolution_status === "RESOLVED" && existingDenial.resolution_status !== "RESOLVED") {
      updateData.resolution_date = new Date()
    }

    const success = await Database.update("denials", req.params.id, updateData)

    if (!success) {
      return res.status(400).json({ error: "Failed to update denial" })
    }

    await auditLog(req, "DENIAL_UPDATED", "DENIALS", req.params.id, {
      previous_status: existingDenial.resolution_status,
      new_status: value.resolution_status,
      assigned_to: value.assigned_to,
    })

    res.json({ success: true, message: "Denial updated successfully" })
  } catch (error) {
    console.error("Update denial error:", error)
    res.status(500).json({ error: "Failed to update denial" })
  }
})

// Assign denial to user
router.post("/:id/assign", AuthMiddleware.authorize(["ADMIN", "MANAGER"]), async (req, res) => {
  try {
    const { assigned_to } = req.body

    if (!assigned_to) {
      return res.status(400).json({ error: "User ID is required" })
    }

    // Verify user exists and has appropriate role
    const user = await Database.findById("users", assigned_to)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    if (!["ADMIN", "MANAGER", "BILLER", "COLLECTOR"].includes(user.role)) {
      return res.status(400).json({ error: "User does not have permission to handle denials" })
    }

    const success = await Database.update("denials", req.params.id, {
      assigned_to,
      resolution_status: "IN_PROGRESS",
      updated_by: req.user.id,
    })

    if (!success) {
      return res.status(400).json({ error: "Failed to assign denial" })
    }

    await auditLog(req, "DENIAL_ASSIGNED", "DENIALS", req.params.id, {
      assigned_to,
      assigned_by: req.user.id,
    })

    res.json({ success: true, message: "Denial assigned successfully" })
  } catch (error) {
    console.error("Assign denial error:", error)
    res.status(500).json({ error: "Failed to assign denial" })
  }
})

// Bulk assign denials
router.post("/bulk-assign", AuthMiddleware.authorize(["ADMIN", "MANAGER"]), async (req, res) => {
  try {
    const { denial_ids, assigned_to } = req.body

    if (!Array.isArray(denial_ids) || denial_ids.length === 0) {
      return res.status(400).json({ error: "Denial IDs array is required" })
    }

    if (!assigned_to) {
      return res.status(400).json({ error: "User ID is required" })
    }

    // Verify user exists and has appropriate role
    const user = await Database.findById("users", assigned_to)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    if (!["ADMIN", "MANAGER", "BILLER", "COLLECTOR"].includes(user.role)) {
      return res.status(400).json({ error: "User does not have permission to handle denials" })
    }

    const results = []

    for (const denialId of denial_ids) {
      try {
        const success = await Database.update("denials", denialId, {
          assigned_to,
          resolution_status: "IN_PROGRESS",
          updated_by: req.user.id,
        })

        if (success) {
          results.push({ denial_id: denialId, status: "SUCCESS" })
          await auditLog(req, "DENIAL_BULK_ASSIGNED", "DENIALS", denialId, {
            assigned_to,
            assigned_by: req.user.id,
          })
        } else {
          results.push({ denial_id: denialId, status: "ERROR", error: "Update failed" })
        }
      } catch (error) {
        results.push({ denial_id: denialId, status: "ERROR", error: error.message })
      }
    }

    const successful = results.filter((r) => r.status === "SUCCESS").length
    const failed = results.filter((r) => r.status === "ERROR").length

    res.json({
      success: true,
      message: `Bulk assignment completed: ${successful} successful, ${failed} failed`,
      results,
    })
  } catch (error) {
    console.error("Bulk assign denials error:", error)
    res.status(500).json({ error: "Failed to bulk assign denials" })
  }
})

// Get denial statistics
router.get(
  "/stats/overview",
  AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "COLLECTOR"]),
  async (req, res) => {
    try {
      const { date_from = "", date_to = "" } = req.query

      let whereClause = ""
      const params = []

      if (date_from && date_to) {
        whereClause = "WHERE denial_date BETWEEN ? AND ?"
        params.push(date_from, date_to)
      }

      // Get denial statistics
      const statsSql = `
      SELECT 
        COUNT(*) as total_denials,
        SUM(CASE WHEN resolution_status = 'OPEN' THEN 1 ELSE 0 END) as open_denials,
        SUM(CASE WHEN resolution_status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress_denials,
        SUM(CASE WHEN resolution_status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved_denials,
        SUM(CASE WHEN priority = 'URGENT' THEN 1 ELSE 0 END) as urgent_denials,
        SUM(CASE WHEN priority = 'HIGH' THEN 1 ELSE 0 END) as high_priority_denials
      FROM denials 
      ${whereClause}
    `

      const [stats] = await Database.query(statsSql, params)

      // Get denial by category
      const categorySql = `
      SELECT denial_category, COUNT(*) as count
      FROM denials 
      ${whereClause}
      GROUP BY denial_category
      ORDER BY count DESC
    `

      const categoryStats = await Database.query(categorySql, params)

      // Get aging analysis
      const agingSql = `
      SELECT 
        SUM(CASE WHEN DATEDIFF(CURDATE(), denial_date) <= 30 THEN 1 ELSE 0 END) as denials_0_30_days,
        SUM(CASE WHEN DATEDIFF(CURDATE(), denial_date) BETWEEN 31 AND 60 THEN 1 ELSE 0 END) as denials_31_60_days,
        SUM(CASE WHEN DATEDIFF(CURDATE(), denial_date) BETWEEN 61 AND 90 THEN 1 ELSE 0 END) as denials_61_90_days,
        SUM(CASE WHEN DATEDIFF(CURDATE(), denial_date) > 90 THEN 1 ELSE 0 END) as denials_over_90_days
      FROM denials 
      ${whereClause}
    `

      const [agingStats] = await Database.query(agingSql, params)

      await auditLog(req, "DENIAL_STATS_VIEWED", "DENIALS", null, { date_from, date_to })

      res.json({
        success: true,
        data: {
          overview: stats,
          by_category: categoryStats,
          aging: agingStats,
        },
      })
    } catch (error) {
      console.error("Get denial statistics error:", error)
      res.status(500).json({ error: "Failed to fetch denial statistics" })
    }
  },
)

module.exports = router
