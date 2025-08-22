// Authentication validation schemas
const Joi = require("joi")

const validateLogin = (data) => {
  const schema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    password: Joi.string().min(6).required(),
    mfaCode: Joi.string()
      .length(6)
      .pattern(/^[0-9]+$/)
      .optional(),
  })

  return schema.validate(data)
}

const validateRegister = (data) => {
  const schema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    email: Joi.string().email().required(),
    password: Joi.string()
      .min(8)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        "string.pattern.base":
          "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
      }),
    firstName: Joi.string().min(1).max(100).required(),
    lastName: Joi.string().min(1).max(100).required(),
    role: Joi.string().valid("ADMIN", "MANAGER", "BILLER", "COLLECTOR", "VIEWER").required(),
    department: Joi.string().valid("BILLING", "COLLECTIONS", "MANAGEMENT", "IT", "CLINICAL").required(),
  })

  return schema.validate(data)
}

const validatePasswordReset = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
  })

  return schema.validate(data)
}

module.exports = {
  validateLogin,
  validateRegister,
  validatePasswordReset,
}
