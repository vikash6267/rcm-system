// Authentication routes
const express = require("express")
const bcrypt = require("bcryptjs")
const speakeasy = require("speakeasy")
const QRCode = require("qrcode")
const { Database } = require("../lib/database")
const AuthMiddleware = require("../middleware/auth")
const { auditLog } = require("../middleware/audit")
const Encryption = require("../lib/encryption")
const { validateLogin, validateRegister, validatePasswordReset } = require("../validators/auth")

const router = express.Router()

// Login endpoint
router.post("/login", async (req, res) => {
  try {
    const { error } = validateLogin(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    const { username, password, mfaCode } = req.body
    const result = await AuthMiddleware.login(username, password, mfaCode)

    if (!result.success) {
      await auditLog({ ...req, user: null }, "LOGIN_FAILED", "AUTH", null, { username, reason: result.error })
      return res.status(401).json({ error: result.error })
    }

    await auditLog({ ...req, user: result.user }, "LOGIN_SUCCESS", "AUTH", result.user.id, { username })

    res.json({
      success: true,
      token: result.token,
      user: result.user,
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

// Logout endpoint
router.post("/logout", AuthMiddleware.authenticate, async (req, res) => {
  try {
    // Invalidate session in Redis if using session storage
    const sessionId = req.headers["x-session-id"]
    if (sessionId) {
      await Database.cacheDel(`session:${sessionId}`)
    }

    await auditLog(req, "LOGOUT", "AUTH", req.user.id, {})

    res.json({ success: true, message: "Logged out successfully" })
  } catch (error) {
    console.error("Logout error:", error)
    res.status(500).json({ error: "Logout failed" })
  }
})

// Register new user (admin only)
router.post("/register", AuthMiddleware.authenticate, AuthMiddleware.authorize(["ADMIN"]), async (req, res) => {
  try {
    const { error } = validateRegister(req.body)
    if (error) {
      return res.status(400).json({ error: error.details[0].message })
    }

    const { username, email, password, firstName, lastName, role, department } = req.body

    // Check if user already exists
    const existingUser = await Database.findOne("users", { username })
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" })
    }

    const existingEmail = await Database.findOne("users", { email })
    if (existingEmail) {
      return res.status(400).json({ error: "Email already exists" })
    }

    // Hash password
    const saltRounds = 12
    const passwordHash = await bcrypt.hash(password, saltRounds)

    // Create user
    const userId = await Database.create("users", {
      username,
      email,
      password_hash: passwordHash,
      first_name: firstName,
      last_name: lastName,
      role,
      department,
      is_active: true,
      created_by: req.user.id,
    })

    await auditLog(req, "USER_CREATED", "USERS", userId, {
      username,
      email,
      role,
      department,
    })

    res.status(201).json({
      success: true,
      message: "User created successfully",
      userId,
    })
  } catch (error) {
    console.error("Registration error:", error)
    res.status(500).json({ error: "Registration failed" })
  }
})

// Get current user profile
router.get("/profile", AuthMiddleware.authenticate, async (req, res) => {
  try {
    const user = await Database.findById(
      "users",
      req.user.id,
      "id, username, email, first_name, last_name, role, department, last_login, mfa_enabled",
    )

    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    res.json({ user })
  } catch (error) {
    console.error("Profile fetch error:", error)
    res.status(500).json({ error: "Failed to fetch profile" })
  }
})

// Update user profile
router.put("/profile", AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body
    const updateData = {}

    if (firstName) updateData.first_name = firstName
    if (lastName) updateData.last_name = lastName
    if (email) updateData.email = email
    updateData.updated_by = req.user.id

    const success = await Database.update("users", req.user.id, updateData)

    if (!success) {
      return res.status(400).json({ error: "Failed to update profile" })
    }

    await auditLog(req, "PROFILE_UPDATED", "USERS", req.user.id, updateData)

    res.json({ success: true, message: "Profile updated successfully" })
  } catch (error) {
    console.error("Profile update error:", error)
    res.status(500).json({ error: "Failed to update profile" })
  }
})

// Change password
router.post("/change-password", AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new passwords are required" })
    }

    // Get current user with password hash
    const user = await Database.findById("users", req.user.id)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash)
    if (!isValidPassword) {
      return res.status(400).json({ error: "Current password is incorrect" })
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters long" })
    }

    // Hash new password
    const saltRounds = 12
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds)

    // Update password
    await Database.update("users", req.user.id, {
      password_hash: newPasswordHash,
      updated_by: req.user.id,
    })

    await auditLog(req, "PASSWORD_CHANGED", "USERS", req.user.id, {})

    res.json({ success: true, message: "Password changed successfully" })
  } catch (error) {
    console.error("Password change error:", error)
    res.status(500).json({ error: "Failed to change password" })
  }
})

// Setup MFA
router.post("/mfa/setup", AuthMiddleware.authenticate, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `RCM System (${req.user.username})`,
      issuer: "RCM Healthcare System",
    })

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url)

    // Store temporary secret (don't enable MFA until verified)
    await Database.cacheSet(`mfa_setup:${req.user.id}`, secret.base32, 300) // 5 minutes

    res.json({
      success: true,
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32,
    })
  } catch (error) {
    console.error("MFA setup error:", error)
    res.status(500).json({ error: "Failed to setup MFA" })
  }
})

// Verify and enable MFA
router.post("/mfa/verify", AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { token } = req.body

    if (!token) {
      return res.status(400).json({ error: "MFA token is required" })
    }

    // Get temporary secret
    const secret = await Database.cacheGet(`mfa_setup:${req.user.id}`)
    if (!secret) {
      return res.status(400).json({ error: "MFA setup session expired. Please start over." })
    }

    // Verify token
    const verified = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token,
      window: 2,
    })

    if (!verified) {
      return res.status(400).json({ error: "Invalid MFA token" })
    }

    // Enable MFA for user
    await Database.update("users", req.user.id, {
      mfa_enabled: true,
      mfa_secret: secret,
      updated_by: req.user.id,
    })

    // Clear temporary secret
    await Database.cacheDel(`mfa_setup:${req.user.id}`)

    await auditLog(req, "MFA_ENABLED", "USERS", req.user.id, {})

    res.json({ success: true, message: "MFA enabled successfully" })
  } catch (error) {
    console.error("MFA verification error:", error)
    res.status(500).json({ error: "Failed to verify MFA" })
  }
})

// Disable MFA
router.post("/mfa/disable", AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { password } = req.body

    if (!password) {
      return res.status(400).json({ error: "Password is required to disable MFA" })
    }

    // Get current user
    const user = await Database.findById("users", req.user.id)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash)
    if (!isValidPassword) {
      return res.status(400).json({ error: "Invalid password" })
    }

    // Disable MFA
    await Database.update("users", req.user.id, {
      mfa_enabled: false,
      mfa_secret: null,
      updated_by: req.user.id,
    })

    await auditLog(req, "MFA_DISABLED", "USERS", req.user.id, {})

    res.json({ success: true, message: "MFA disabled successfully" })
  } catch (error) {
    console.error("MFA disable error:", error)
    res.status(500).json({ error: "Failed to disable MFA" })
  }
})

// Password reset request
router.post("/password-reset/request", async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: "Email is required" })
    }

    const user = await Database.findOne("users", { email })
    if (!user) {
      // Don't reveal if email exists
      return res.json({ success: true, message: "If the email exists, a reset link has been sent" })
    }

    // Generate reset token
    const resetToken = Encryption.generateApiKey()
    const resetExpires = new Date(Date.now() + 3600000) // 1 hour

    // Store reset token
    await Database.cacheSet(
      `password_reset:${resetToken}`,
      {
        userId: user.id,
        expires: resetExpires,
      },
      3600,
    )

    // TODO: Send email with reset link
    // await sendPasswordResetEmail(user.email, resetToken)

    await auditLog({ ...req, user: null }, "PASSWORD_RESET_REQUESTED", "AUTH", user.id, { email })

    res.json({ success: true, message: "If the email exists, a reset link has been sent" })
  } catch (error) {
    console.error("Password reset request error:", error)
    res.status(500).json({ error: "Failed to process password reset request" })
  }
})

// Password reset
router.post("/password-reset/confirm", async (req, res) => {
  try {
    const { token, newPassword } = req.body

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" })
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters long" })
    }

    // Get reset data
    const resetData = await Database.cacheGet(`password_reset:${token}`)
    if (!resetData) {
      return res.status(400).json({ error: "Invalid or expired reset token" })
    }

    if (new Date() > new Date(resetData.expires)) {
      await Database.cacheDel(`password_reset:${token}`)
      return res.status(400).json({ error: "Reset token has expired" })
    }

    // Hash new password
    const saltRounds = 12
    const passwordHash = await bcrypt.hash(newPassword, saltRounds)

    // Update password
    await Database.update("users", resetData.userId, {
      password_hash: passwordHash,
      failed_login_attempts: 0,
      account_locked_until: null,
    })

    // Clear reset token
    await Database.cacheDel(`password_reset:${token}`)

    await auditLog({ ...req, user: null }, "PASSWORD_RESET_COMPLETED", "AUTH", resetData.userId, {})

    res.json({ success: true, message: "Password reset successfully" })
  } catch (error) {
    console.error("Password reset error:", error)
    res.status(500).json({ error: "Failed to reset password" })
  }
})

// Refresh token
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token is required" })
    }

    // Verify refresh token
    const decoded = AuthMiddleware.verifyToken(refreshToken)
    const user = await Database.findById("users", decoded.userId)

    if (!user || !user.is_active) {
      return res.status(401).json({ error: "Invalid refresh token" })
    }

    // Generate new access token
    const newToken = AuthMiddleware.generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    })

    res.json({
      success: true,
      token: newToken,
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    })
  } catch (error) {
    console.error("Token refresh error:", error)
    res.status(401).json({ error: "Invalid refresh token" })
  }
})

module.exports = router
