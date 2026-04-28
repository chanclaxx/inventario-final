const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Forzar zona horaria de Colombia en todas las conexiones del pool.
// Esto corrige fechas generadas con NOW(), CURRENT_DATE y CURRENT_TIMESTAMP en SQL.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'America/Bogota'");
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
  process.exit(-1);
});

const connectDB = async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Conectado a PostgreSQL correctamente');
    client.release();
  } catch (err) {
    console.error('❌ Error al conectar a PostgreSQL:', err.message);
    process.exit(1);
  }
};

module.exports = { pool, connectDB };