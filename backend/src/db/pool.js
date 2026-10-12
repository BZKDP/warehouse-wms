const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  max: 25,
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000, // 30s — kill queries that hang too long
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Graceful shutdown — release connections on process exit
process.on('SIGINT', () => { pool.end(); process.exit(0); });
process.on('SIGTERM', () => { pool.end(); process.exit(0); });

module.exports = pool;
