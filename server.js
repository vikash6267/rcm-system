 // Main Express server setup
const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const compression = require("compression")
const { AuditMiddleware } = require("./middleware/audit")
const AuthMiddleware = require("./middleware/auth")
require("dotenv").config()

const app = express()
const PORT = process.env.BACKEND_PORT || 3001

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
)

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
})
app.use("/api/", limiter)

// Body parsing middleware
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Compression
app.use(compression())

// Audit logging middleware
app.use("/api/", AuditMiddleware.middleware())

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  })
})

// API Routes (to be implemented in subsequent tasks)
app.use("/api/auth", require("./routes/auth"))
app.use("/api/patients", AuthMiddleware.authenticate, require("./routes/patients"))
app.use("/api/claims", AuthMiddleware.authenticate, require("./routes/claims"))
app.use("/api/payments", AuthMiddleware.authenticate, require("./routes/payments"))
app.use("/api/eligibility", AuthMiddleware.authenticate, require("./routes/eligibility"))
app.use("/api/denials", AuthMiddleware.authenticate, require("./routes/denials"))
app.use("/api/collections", AuthMiddleware.authenticate, require("./routes/collections"))
app.use("/api/reports", AuthMiddleware.authenticate, require("./routes/reports"))

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Server error:", error)

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === "development"

  res.status(error.status || 500).json({
    error: isDevelopment ? error.message : "Internal server error",
    ...(isDevelopment && { stack: error.stack }),
  })
})

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" })
})

// Start server
app.listen(PORT, () => {
  console.log(`RCM Server running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`)
})

module.exports = app
