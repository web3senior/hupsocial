/**
 * @file lib/db.js
 * @description Standardized MySQL/MariaDB connection pool.
 */

import mysql from 'mysql2/promise'

const createPool = () =>
  mysql.createPool({
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
    // DATE columns (no time component) must stay as plain 'YYYY-MM-DD' strings —
    // parsing them into JS Date objects applies local-timezone midnight, which
    // can shift the calendar date by a day once serialized back to JSON/UTC.
    dateStrings: ['DATE'],
  })

// Cached on globalThis so hot reloads reuse the pool instead of opening another ten connections
// each time a route importing this module is edited — a dev session of ordinary edits was enough
// to exhaust MariaDB's max_connections.
const globalForDb = globalThis
const pool = globalForDb.__hupDbPool ?? createPool()
if (process.env.NODE_ENV !== 'production') globalForDb.__hupDbPool = pool

export default pool
