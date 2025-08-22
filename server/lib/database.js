// Database connection and configuration
const mysql = require("mysql2/promise")
const Redis = require("redis")

// Database connection pool configuration
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "rcm_system",
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  ssl:
    process.env.NODE_ENV === "production"
      ? {
          rejectUnauthorized: false,
        }
      : false,
}

// Create MySQL connection pool
const pool = mysql.createPool(dbConfig)

// Redis client for caching
const redisClient = Redis.createClient({
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || "",
  db: 0,
  retry_strategy: (options) => {
    if (options.error && options.error.code === "ECONNREFUSED") {
      return new Error("Redis server connection refused")
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      return new Error("Redis retry time exhausted")
    }
    if (options.attempt > 10) {
      return undefined
    }
    return Math.min(options.attempt * 100, 3000)
  },
})

// Database utility functions
class Database {
  static async query(sql, params = []) {
    try {
      const [rows] = await pool.execute(sql, params)
      return rows
    } catch (error) {
      console.error("Database query error:", error)
      throw error
    }
  }

  static async transaction(callback) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await callback(connection)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  static async findById(table, id, columns = "*") {
    const sql = `SELECT ${columns} FROM ${table} WHERE id = ? LIMIT 1`
    const rows = await this.query(sql, [id])
    return rows[0] || null
  }

  static async findOne(table, conditions, columns = "*") {
    const whereClause = Object.keys(conditions)
      .map((key) => `${key} = ?`)
      .join(" AND ")
    const values = Object.values(conditions)
    const sql = `SELECT ${columns} FROM ${table} WHERE ${whereClause} LIMIT 1`
    const rows = await this.query(sql, values)
    return rows[0] || null
  }

  static async findMany(table, conditions = {}, options = {}) {
    let sql = `SELECT ${options.columns || "*"} FROM ${table}`
    const values = []

    if (Object.keys(conditions).length > 0) {
      const whereClause = Object.keys(conditions)
        .map((key) => `${key} = ?`)
        .join(" AND ")
      sql += ` WHERE ${whereClause}`
      values.push(...Object.values(conditions))
    }

    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`
    }

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`
      if (options.offset) {
        sql += ` OFFSET ${options.offset}`
      }
    }

    return await this.query(sql, values)
  }

  static async create(table, data) {
    const columns = Object.keys(data).join(", ")
    const placeholders = Object.keys(data)
      .map(() => "?")
      .join(", ")
    const values = Object.values(data)

    const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`
    const result = await this.query(sql, values)
    return result.insertId
  }

  static async update(table, id, data) {
    const setClause = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(", ")
    const values = [...Object.values(data), id]

    const sql = `UPDATE ${table} SET ${setClause} WHERE id = ?`
    const result = await this.query(sql, values)
    return result.affectedRows > 0
  }

  static async delete(table, id) {
    const sql = `DELETE FROM ${table} WHERE id = ?`
    const result = await this.query(sql, [id])
    return result.affectedRows > 0
  }

  // Cache utilities
  static async cacheGet(key) {
    try {
      const value = await redisClient.get(key)
      return value ? JSON.parse(value) : null
    } catch (error) {
      console.error("Cache get error:", error)
      return null
    }
  }

  static async cacheSet(key, value, ttl = 3600) {
    try {
      await redisClient.setex(key, ttl, JSON.stringify(value))
      return true
    } catch (error) {
      console.error("Cache set error:", error)
      return false
    }
  }

  static async cacheDel(key) {
    try {
      await redisClient.del(key)
      return true
    } catch (error) {
      console.error("Cache delete error:", error)
      return false
    }
  }
}

// Initialize Redis connection
redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err)
})

redisClient.on("connect", () => {
  console.log("Redis Client Connected")
})

module.exports = { Database, pool, redisClient }
