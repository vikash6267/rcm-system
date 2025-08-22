// HIPAA-compliant encryption utilities
const crypto = require("crypto")

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32)
const ALGORITHM = "aes-256-gcm"

class Encryption {
  static encrypt(text) {
    if (!text) return null

    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipher(ALGORITHM, ENCRYPTION_KEY)
    cipher.setAAD(Buffer.from("rcm-system", "utf8"))

    let encrypted = cipher.update(text, "utf8", "hex")
    encrypted += cipher.final("hex")

    const authTag = cipher.getAuthTag()

    return {
      encrypted: encrypted,
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
    }
  }

  static decrypt(encryptedData) {
    if (!encryptedData || !encryptedData.encrypted) return null

    try {
      const decipher = crypto.createDecipher(ALGORITHM, ENCRYPTION_KEY)
      decipher.setAAD(Buffer.from("rcm-system", "utf8"))
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, "hex"))

      let decrypted = decipher.update(encryptedData.encrypted, "hex", "utf8")
      decrypted += decipher.final("utf8")

      return decrypted
    } catch (error) {
      console.error("Decryption error:", error)
      return null
    }
  }

  static hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex")
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex")
    return { salt, hash }
  }

  static verifyPassword(password, salt, hash) {
    const hashVerify = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex")
    return hash === hashVerify
  }

  static generateApiKey() {
    return crypto.randomBytes(32).toString("hex")
  }

  static generateSessionId() {
    return crypto.randomBytes(24).toString("hex")
  }
}

module.exports = Encryption
