const { pool } = require('./db');

const runMigrations = async () => {
  const migrations = [
    // Soporte para variantes en líneas de factura (si aún no existe)
    `ALTER TABLE lineas_factura ADD COLUMN IF NOT EXISTS atributo_id INTEGER`,
    `ALTER TABLE lineas_factura ADD COLUMN IF NOT EXISTS variante_id INTEGER`,
    // Devolución parcial de líneas en créditos
    `ALTER TABLE lineas_factura ADD COLUMN IF NOT EXISTS cantidad_devuelta INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_devuelta >= 0)`,
  ];

  for (const sql of migrations) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.warn('[migrations] Error ejecutando migración:', err.message);
    }
  }

  console.log('✅ Migraciones ejecutadas');
};

module.exports = { runMigrations };
