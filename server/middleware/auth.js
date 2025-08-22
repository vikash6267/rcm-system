// Authentication and authorization middleware
const jwt = require("jsonwebtoken")
const { Database } = require("../lib/database")
const { auditLog } = require("./audit")
const bcrypt = require("bcryptjs")
const speakeasy = require("speakeasy")

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key"
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h"

class AuthMiddleware {
  static async authenticate(req, res, next) {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "")

      if (!token) {
        return res.status(401).json({ error: "Authentication token required" })
      }

      const decoded = jwt.verify(token, JWT_SECRET)
      const user = await Database.findById("users", decoded.userId)

      if (!user || !user.is_active) {
        return res.status(401).json({ error: "Invalid or inactive user" })
      }

      // Update last activity
      await Database.update("users", user.id, {
        last_login: new Date(),
      })

      req.user = user
      next()
    } catch (error) {
      console.error("Authentication error:", error)
      return res.status(401).json({ error: "Invalid authentication token" })
    }
  }

  static authorize(roles = []) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" })
      }

      if (roles.length > 0 && !roles.includes(req.user.role)) {
        auditLog(req, "UNAUTHORIZED_ACCESS", "AUTH", null, {
          attempted_action: req.method + " " + req.path,
          user_role: req.user.role,
          required_roles: roles,
        })

        return res.status(403).json({ error: "Insufficient permissions" })
      }

      next()
    }
  }

  static async login(username, password, mfaCode = null) {
    try {
      const user = await Database.findOne("users", { username })

      if (!user) {
        return { success: false, error: "Invalid credentials" }
      }

      if (!user.is_active) {
        return { success: false, error: "Account is inactive" }
      }

      // Check if account is locked
      if (user.account_locked_until && new Date() < new Date(user.account_locked_until)) {
        return { success: false, error: "Account is temporarily locked" }
      }

      // Verify password using bcrypt
      const isValidPassword = await bcrypt.compare(password, user.password_hash)

      if (!isValidPassword) {
        // Increment failed attempts
        const failedAttempts = (user.failed_login_attempts || 0) + 1
        const maxAttempts = 5

        const updateData = { failed_login_attempts: failedAttempts }

        if (failedAttempts >= maxAttempts) {
          updateData.account_locked_until = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
        }

        await Database.update("users", user.id, updateData)
        return { success: false, error: "Invalid credentials" }
      }

      // Check MFA if enabled
      if (user.mfa_enabled) {
        if (!mfaCode) {
          return { success: false, error: "MFA code required", requiresMFA: true }
        }

        const verified = speakeasy.totp.verify({
          secret: user.mfa_secret,
          encoding: "base32",
          token: mfaCode,
          window: 2,
        })

        if (!verified) {
          return { success: false, error: "Invalid MFA code" }
        }
      }

      // Reset failed attempts on successful login
      await Database.update("users", user.id, {
        failed_login_attempts: 0,
        account_locked_until: null,
        last_login: new Date(),
      })

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: user.id,
          username: user.username,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN },
      )

      return {
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          department: user.department,
          mfa_enabled: user.mfa_enabled,
        },
      }
    } catch (error) {
      console.error("Login error:", error)
      return { success: false, error: "Login failed" }
    }
  }

  static async verifyPassword(password, hash) {
    // Implement proper password verification
    // This is a placeholder - use bcrypt or similar in production
    return bcrypt.compare(password, hash)
  }

  static generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
  }

  static verifyToken(token) {
    return jwt.verify(token, JWT_SECRET)
  }
}

module.exports = AuthMiddleware
