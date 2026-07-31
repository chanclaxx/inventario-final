const { pool } = require('./db');

// ── Detección de columnas opcionales ─────────────────────────────────────────
//
// Por qué existe esto: las consultas del inventario son la pantalla más usada
// del sistema. Si un `ALTER TABLE ... ADD COLUMN ubicacion` no llegara a
// aplicarse (permisos, BD antigua, migración fallida) y los repositorios ya
// pidieran `pc.ubicacion`, se caería el inventario COMPLETO para todos los
// negocios — incluidos los que no usan la feature.
//
// Se comprueba UNA vez al arrancar, después de runMigrations(), y se cachea en
// memoria. Con la bandera en falso los repositorios emiten exactamente el SQL
// de siempre y la feature se apaga sola: en el peor caso no aparece, nunca rompe.

const TABLAS_UBICACION = ['productos_cantidad', 'productos_serial'];

let _ubicacionDisponible = false;

const detectarColumnas = async () => {
  try {
    const { rows } = await pool.query(
      `SELECT table_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name  = 'ubicacion'
         AND table_name   = ANY($1::text[])`,
      [TABLAS_UBICACION]
    );
    const encontradas = new Set(rows.map((r) => r.table_name));
    // Se exige en AMBAS tablas: con una sola, media feature funcionaría y la
    // otra mitad reventaría — peor que tenerla apagada.
    _ubicacionDisponible = TABLAS_UBICACION.every((t) => encontradas.has(t));

    if (!_ubicacionDisponible) {
      console.warn('⚠️  Columna `ubicacion` ausente: la ubicación de productos queda desactivada.');
    }
  } catch (err) {
    // Ante la duda, apagada: es la opción que no puede romper nada.
    _ubicacionDisponible = false;
    console.error('⚠️  No se pudo verificar la columna `ubicacion` (feature desactivada):', err.message);
  }
  return _ubicacionDisponible;
};

const hayUbicacion = () => _ubicacionDisponible;

// Solo para pruebas: permite simular una BD sin la columna sin tocar la BD real.
const _setUbicacionDisponible = (valor) => { _ubicacionDisponible = !!valor; };

module.exports = { detectarColumnas, hayUbicacion, _setUbicacionDisponible };
