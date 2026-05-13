/**
 * @file lib/db.js
 * @description Standardized MySQL/MariaDB connection pool.
 */

import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // This is often required for modern MySQL/MariaDB versions
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

export default pool
