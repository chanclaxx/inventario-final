const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.env.DB_SSL = '1';
const { pool } = require('./src/config/db');
pool.options.ssl = { rejectUnauthorized: false };
const { runMigrations } = require('./src/config/migrations');
(async () => {
  const t0 = Date.now();
  await runMigrations();
  console.log(`runMigrations completo en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
})().catch(e => { console.error('FALLO:', e.code, e.message); process.exit(1); });
