// Reporting and analytics routes
const express = require("express")
const { Database } = require("../lib/database")
const { auditLog } = require("../middleware/audit")
const AuthMiddleware = require("../middleware/auth")

const router = express.Router()

// A/R Aging Report
router.get("/ar-aging", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const { date_as_of = new Date().toISOString().split("T")[0] } = req.query

    const sql = `
      SELECT 
        p.patient_id,
        p.first_name,
        p.last_name,
        p.phone,
        p.email,
        SUM(c.patient_responsibility) as total_balance,
        SUM(CASE WHEN DATEDIFF(?, c.service_date_to) <= 30 THEN c.patient_responsibility ELSE 0 END) as current_0_30,
        SUM(CASE WHEN DATEDIFF(?, c.service_date_to) BETWEEN 31 AND 60 THEN c.patient_responsibility ELSE 0 END) as days_31_60,
        SUM(CASE WHEN DATEDIFF(?, c.service_date_to) BETWEEN 61 AND 90 THEN c.patient_responsibility ELSE 0 END) as days_61_90,
        SUM(CASE WHEN DATEDIFF(?, c.service_date_to) BETWEEN 91 AND 120 THEN c.patient_responsibility ELSE 0 END) as days_91_120,
        SUM(CASE WHEN DATEDIFF(?, c.service_date_to) > 120 THEN c.patient_responsibility ELSE 0 END) as days_over_120,
        MAX(c.service_date_to) as last_service_date
      FROM patients p
      JOIN claims c ON p.id = c.patient_id
      WHERE c.patient_responsibility > 0
        AND c.claim_status IN ('PAID', 'CLOSED')
        AND c.service_date_to <= ?
      GROUP BY p.id, p.patient_id, p.first_name, p.last_name, p.phone, p.email
      HAVING total_balance > 0
      ORDER BY total_balance DESC
    `

    const params = [date_as_of, date_as_of, date_as_of, date_as_of, date_as_of, date_as_of]
    const arAging = await Database.query(sql, params)

    // Calculate summary totals
    const summary = arAging.reduce(
      (acc, row) => {
        acc.total_balance += row.total_balance
        acc.current_0_30 += row.current_0_30
        acc.days_31_60 += row.days_31_60
        acc.days_61_90 += row.days_61_90
        acc.days_91_120 += row.days_91_120
        acc.days_over_120 += row.days_over_120
        return acc
      },
      {
        total_balance: 0,
        current_0_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        days_91_120: 0,
        days_over_120: 0,
      },
    )

    await auditLog(req, "AR_AGING_REPORT_GENERATED", "REPORTS", null, {
      date_as_of,
      total_patients: arAging.length,
      total_balance: summary.total_balance,
    })

    res.json({
      success: true,
      data: {
        report_date: date_as_of,
        summary,
        details: arAging,
      },
    })
  } catch (error) {
    console.error("A/R Aging report error:", error)
    res.status(500).json({ error: "Failed to generate A/R Aging report" })
  }
})

// Revenue Forecasting Report
router.get("/revenue-forecast", AuthMiddleware.authorize(["ADMIN", "MANAGER", "VIEWER"]), async (req, res) => {
  try {
    const { months = 12 } = req.query

    // Historical revenue data
    const historicalSql = `
      SELECT 
        DATE_FORMAT(payment_date, '%Y-%m') as month,
        SUM(CASE WHEN payment_type = 'INSURANCE' THEN payment_amount ELSE 0 END) as insurance_revenue,
        SUM(CASE WHEN payment_type = 'PATIENT' THEN payment_amount ELSE 0 END) as patient_revenue,
        SUM(payment_amount) as total_revenue,
        COUNT(DISTINCT claim_id) as claims_paid
      FROM payment_postings
      WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        AND payment_type IN ('INSURANCE', 'PATIENT')
      GROUP BY DATE_FORMAT(payment_date, '%Y-%m')
      ORDER BY month DESC
    `

    const historicalData = await Database.query(historicalSql, [months])

    // Pending claims value
    const pendingSql = `
      SELECT 
        SUM(total_charges - total_paid) as pending_revenue,
        COUNT(*) as pending_claims
      FROM claims
      WHERE claim_status IN ('SUBMITTED', 'ACCEPTED')
        AND total_charges > total_paid
    `

    const [pendingData] = await Database.query(pendingSql)

    // Calculate forecast based on historical trends
    const forecast = calculateRevenueForecast(historicalData, 6) // 6 months forecast

    await auditLog(req, "REVENUE_FORECAST_GENERATED", "REPORTS", null, {
      historical_months: months,
      forecast_months: 6,
    })

    res.json({
      success: true,
      data: {
        historical: historicalData,
        pending: pendingData,
        forecast,
        generated_at: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("Revenue forecast error:", error)
    res.status(500).json({ error: "Failed to generate revenue forecast" })
  }
})

// Payer Performance Report
router.get("/payer-performance", AuthMiddleware.authorize(["ADMIN", "MANAGER", "VIEWER"]), async (req, res) => {
  try {
    const { date_from = "", date_to = "" } = req.query

    let whereClause = ""
    const params = []

    if (date_from && date_to) {
      whereClause = "WHERE c.service_date_from >= ? AND c.service_date_to <= ?"
      params.push(date_from, date_to)
    }

    const sql = `
      SELECT 
        ip.payer_name,
        ip.payer_id,
        COUNT(c.id) as total_claims,
        SUM(c.total_charges) as total_charges,
        SUM(c.total_paid) as total_paid,
        SUM(c.patient_responsibility) as patient_responsibility,
        AVG(DATEDIFF(pp.payment_date, c.submission_date)) as avg_days_to_pay,
        SUM(CASE WHEN c.claim_status = 'DENIED' THEN 1 ELSE 0 END) as denied_claims,
        (SUM(c.total_paid) / SUM(c.total_charges)) * 100 as payment_rate,
        (SUM(CASE WHEN c.claim_status = 'DENIED' THEN 1 ELSE 0 END) / COUNT(c.id)) * 100 as denial_rate
      FROM claims c
      JOIN patient_insurance pi ON c.primary_insurance_id = pi.id
      JOIN insurance_providers ip ON pi.insurance_provider_id = ip.id
      LEFT JOIN payment_postings pp ON c.id = pp.claim_id AND pp.payment_type = 'INSURANCE'
      ${whereClause}
      GROUP BY ip.id, ip.payer_name, ip.payer_id
      HAVING total_claims > 0
      ORDER BY total_paid DESC
    `

    const payerPerformance = await Database.query(sql, params)

    await auditLog(req, "PAYER_PERFORMANCE_REPORT_GENERATED", "REPORTS", null, {
      date_from,
      date_to,
      payers_analyzed: payerPerformance.length,
    })

    res.json({
      success: true,
      data: payerPerformance,
    })
  } catch (error) {
    console.error("Payer performance report error:", error)
    res.status(500).json({ error: "Failed to generate payer performance report" })
  }
})

// Denial Trends Report
router.get("/denial-trends", AuthMiddleware.authorize(["ADMIN", "MANAGER", "BILLER", "VIEWER"]), async (req, res) => {
  try {
    const { date_from = "", date_to = "", group_by = "month" } = req.query

    let whereClause = ""
    let groupByClause = ""
    const params = []

    if (date_from && date_to) {
      whereClause = "WHERE d.denial_date >= ? AND d.denial_date <= ?"
      params.push(date_from, date_to)
    }

    switch (group_by) {
      case "week":
        groupByClause = "DATE_FORMAT(d.denial_date, '%Y-%u')"
        break
      case "month":
        groupByClause = "DATE_FORMAT(d.denial_date, '%Y-%m')"
        break
      case "quarter":
        groupByClause = "CONCAT(YEAR(d.denial_date), '-Q', QUARTER(d.denial_date))"
        break
      default:
        groupByClause = "DATE_FORMAT(d.denial_date, '%Y-%m')"
    }

    const trendsSql = `
      SELECT 
        ${groupByClause} as period,
        COUNT(*) as total_denials,
        SUM(CASE WHEN d.denial_category = 'TECHNICAL' THEN 1 ELSE 0 END) as technical_denials,
        SUM(CASE WHEN d.denial_category = 'CLINICAL' THEN 1 ELSE 0 END) as clinical_denials,
        SUM(CASE WHEN d.denial_category = 'AUTHORIZATION' THEN 1 ELSE 0 END) as authorization_denials,
        SUM(CASE WHEN d.denial_category = 'ELIGIBILITY' THEN 1 ELSE 0 END) as eligibility_denials,
        SUM(CASE WHEN d.resolution_status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved_denials,
        AVG(DATEDIFF(COALESCE(d.resolution_date, CURDATE()), d.denial_date)) as avg_resolution_days
      FROM denials d
      JOIN claims c ON d.claim_id = c.id
      ${whereClause}
      GROUP BY ${groupByClause}
      ORDER BY period DESC
    `

    const trends = await Database.query(trendsSql, params)

    // Top denial reasons
    const reasonsSql = `
      SELECT 
        d.denial_reason_description,
        COUNT(*) as count,
        (COUNT(*) * 100.0 / (SELECT COUNT(*) FROM denials ${whereClause})) as percentage
      FROM denials d
      ${whereClause}
      GROUP BY d.denial_reason_description
      ORDER BY count DESC
      LIMIT 10
    `

    const topReasons = await Database.query(reasonsSql, params)

    await auditLog(req, "DENIAL_TRENDS_REPORT_GENERATED", "REPORTS", null, {
      date_from,
      date_to,
      group_by,
      periods_analyzed: trends.length,
    })

    res.json({
      success: true,
      data: {
        trends,
        top_reasons: topReasons,
      },
    })
  } catch (error) {
    console.error("Denial trends report error:", error)
    res.status(500).json({ error: "Failed to generate denial trends report" })
  }
})

// Collections Performance Report
router.get(
  "/collections-performance",
  AuthMiddleware.authorize(["ADMIN", "MANAGER", "COLLECTOR"]),
  async (req, res) => {
    try {
      const { date_from = "", date_to = "" } = req.query

      let whereClause = ""
      const params = []

      if (date_from && date_to) {
        whereClause = "WHERE c.created_at >= ? AND c.created_at <= ?"
        params.push(date_from, date_to)
      }

      // Collections summary
      const summarySql = `
      SELECT 
        COUNT(*) as total_collections,
        SUM(original_amount) as total_original_amount,
        SUM(current_balance) as total_current_balance,
        SUM(original_amount - current_balance) as total_collected,
        AVG(days_outstanding) as avg_days_outstanding,
        SUM(CASE WHEN collection_status = 'PAID' THEN 1 ELSE 0 END) as paid_collections,
        SUM(CASE WHEN collection_status = 'PAYMENT_PLAN' THEN 1 ELSE 0 END) as payment_plan_collections,
        SUM(CASE WHEN collection_status = 'WRITTEN_OFF' THEN 1 ELSE 0 END) as written_off_collections
      FROM collections c
      ${whereClause}
    `

      const [summary] = await Database.query(summarySql, params)

      // Collections by aging
      const agingSql = `
      SELECT 
        CASE 
          WHEN days_outstanding <= 30 THEN '0-30 days'
          WHEN days_outstanding <= 60 THEN '31-60 days'
          WHEN days_outstanding <= 90 THEN '61-90 days'
          WHEN days_outstanding <= 120 THEN '91-120 days'
          ELSE '120+ days'
        END as aging_bucket,
        COUNT(*) as count,
        SUM(current_balance) as total_balance
      FROM collections c
      ${whereClause}
      GROUP BY aging_bucket
      ORDER BY 
        CASE aging_bucket
          WHEN '0-30 days' THEN 1
          WHEN '31-60 days' THEN 2
          WHEN '61-90 days' THEN 3
          WHEN '91-120 days' THEN 4
          ELSE 5
        END
    `

      const aging = await Database.query(agingSql, params)

      // Payment plan performance
      const paymentPlanSql = `
      SELECT 
        COUNT(*) as total_plans,
        SUM(plan_amount) as total_plan_amount,
        SUM(amount_paid) as total_paid_amount,
        AVG(payments_made) as avg_payments_made,
        SUM(CASE WHEN plan_status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_plans,
        SUM(CASE WHEN plan_status = 'DEFAULTED' THEN 1 ELSE 0 END) as defaulted_plans
      FROM payment_plans pp
      JOIN collections c ON pp.collection_id = c.id
      ${whereClause.replace("c.created_at", "pp.created_at")}
    `

      const [paymentPlans] = await Database.query(paymentPlanSql, params)

      await auditLog(req, "COLLECTIONS_PERFORMANCE_REPORT_GENERATED", "REPORTS", null, {
        date_from,
        date_to,
        total_collections: summary.total_collections,
      })

      res.json({
        success: true,
        data: {
          summary,
          aging,
          payment_plans: paymentPlans,
        },
      })
    } catch (error) {
      console.error("Collections performance report error:", error)
      res.status(500).json({ error: "Failed to generate collections performance report" })
    }
  },
)

// Financial Dashboard Summary
router.get("/financial-summary", AuthMiddleware.authorize(["ADMIN", "MANAGER", "VIEWER"]), async (req, res) => {
  try {
    const { period = "month" } = req.query

    let dateFilter = ""
    switch (period) {
      case "week":
        dateFilter = "WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 1 WEEK)"
        break
      case "month":
        dateFilter = "WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)"
        break
      case "quarter":
        dateFilter = "WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)"
        break
      case "year":
        dateFilter = "WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)"
        break
      default:
        dateFilter = "WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)"
    }

    // Revenue metrics
    const revenueSql = `
      SELECT 
        SUM(payment_amount) as total_revenue,
        SUM(CASE WHEN payment_type = 'INSURANCE' THEN payment_amount ELSE 0 END) as insurance_revenue,
        SUM(CASE WHEN payment_type = 'PATIENT' THEN payment_amount ELSE 0 END) as patient_revenue,
        COUNT(DISTINCT claim_id) as claims_with_payments,
        AVG(payment_amount) as avg_payment_amount
      FROM payment_postings
      ${dateFilter}
        AND payment_type IN ('INSURANCE', 'PATIENT')
    `

    const [revenue] = await Database.query(revenueSql)

    // Claims metrics
    const claimsSql = `
      SELECT 
        COUNT(*) as total_claims,
        SUM(total_charges) as total_charges,
        SUM(total_paid) as total_paid,
        AVG(DATEDIFF(CURDATE(), submission_date)) as avg_days_pending,
        SUM(CASE WHEN claim_status = 'PAID' THEN 1 ELSE 0 END) as paid_claims,
        SUM(CASE WHEN claim_status = 'DENIED' THEN 1 ELSE 0 END) as denied_claims
      FROM claims
      WHERE submission_date >= DATE_SUB(CURDATE(), INTERVAL 1 ${period.toUpperCase()})
    `

    const [claims] = await Database.query(claimsSql)

    // Key performance indicators
    const kpis = {
      collection_rate:
        revenue.total_revenue && claims.total_charges ? (revenue.total_revenue / claims.total_charges) * 100 : 0,
      denial_rate: claims.total_claims ? (claims.denied_claims / claims.total_claims) * 100 : 0,
      days_in_ar: claims.avg_days_pending || 0,
      net_collection_rate:
        revenue.total_revenue && claims.total_charges
          ? (revenue.total_revenue / (claims.total_charges - claims.total_charges * 0.1)) * 100
          : 0, // Assuming 10% contractual adjustments
    }

    await auditLog(req, "FINANCIAL_SUMMARY_GENERATED", "REPORTS", null, { period })

    res.json({
      success: true,
      data: {
        period,
        revenue,
        claims,
        kpis,
        generated_at: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error("Financial summary error:", error)
    res.status(500).json({ error: "Failed to generate financial summary" })
  }
})

// Helper function to calculate revenue forecast
function calculateRevenueForecast(historicalData, forecastMonths) {
  if (historicalData.length < 3) {
    return [] // Need at least 3 months of data for meaningful forecast
  }

  // Simple linear regression for trend analysis
  const revenues = historicalData.map((d) => d.total_revenue).reverse()
  const n = revenues.length
  const sumX = (n * (n + 1)) / 2
  const sumY = revenues.reduce((a, b) => a + b, 0)
  const sumXY = revenues.reduce((sum, y, i) => sum + (i + 1) * y, 0)
  const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const intercept = (sumY - slope * sumX) / n

  // Generate forecast
  const forecast = []
  const lastMonth = new Date()

  for (let i = 1; i <= forecastMonths; i++) {
    const forecastDate = new Date(lastMonth)
    forecastDate.setMonth(forecastDate.getMonth() + i)

    const predictedRevenue = intercept + slope * (n + i)

    forecast.push({
      month: forecastDate.toISOString().slice(0, 7),
      predicted_revenue: Math.max(0, predictedRevenue),
      confidence: Math.max(0.5, 1 - i * 0.1), // Decreasing confidence over time
    })
  }

  return forecast
}

module.exports = router
