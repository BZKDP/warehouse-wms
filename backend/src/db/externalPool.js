const { Pool } = require('pg');
const config = require('../config');

const externalPool = new Pool({
  host: config.externalDb.host,
  port: config.externalDb.port,
  database: config.externalDb.database,
  user: config.externalDb.user,
  password: config.externalDb.password,
  ssl: config.externalDb.ssl ? { rejectUnauthorized: false } : false,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

externalPool.on('error', (err) => {
  console.error('[ExtDB] Unexpected pool error:', err.message);
});

module.exports = externalPool;
