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
  // Independiente de lo anterior: cada detección apaga solo su propia feature.
  await _detectarCatalogo();
  return _ubicacionDisponible;
};

const hayUbicacion = () => _ubicacionDisponible;

// ── Catálogo web público ─────────────────────────────────────────────────────
//
// Mismo criterio que la ubicación, pero a nivel de TABLA: si la migración del
// catálogo no llegó a aplicarse, la feature se apaga sola y sus rutas responden
// 503 en vez de reventar con "relation does not exist". El resto del sistema no
// se entera, porque ninguna consulta del inventario toca estas tablas.

const TABLAS_CATALOGO = ['catalogo_sucursal', 'catalogo_items', 'catalogo_imagenes'];

let _catalogoDisponible = false;

const _detectarCatalogo = async () => {
  try {
    const { rows } = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type   = 'BASE TABLE'
         AND table_name   = ANY($1::text[])`,
      [TABLAS_CATALOGO]
    );
    const encontradas = new Set(rows.map((r) => r.table_name));
    // Se exigen las TRES: con dos de ellas, media feature funcionaría y la otra
    // mitad reventaría — peor que tenerla apagada.
    _catalogoDisponible = TABLAS_CATALOGO.every((t) => encontradas.has(t));

    if (!_catalogoDisponible) {
      console.warn('⚠️  Tablas del catálogo ausentes: el catálogo web queda desactivado.');
    }
  } catch (err) {
    _catalogoDisponible = false;
    console.error('⚠️  No se pudieron verificar las tablas del catálogo (feature desactivada):', err.message);
  }
  return _catalogoDisponible;
};

const hayCatalogo = () => _catalogoDisponible;

// Solo para pruebas: permite simular una BD sin la columna sin tocar la BD real.
const _setUbicacionDisponible = (valor) => { _ubicacionDisponible = !!valor; };
const _setCatalogoDisponible  = (valor) => { _catalogoDisponible  = !!valor; };

module.exports = {
  detectarColumnas, hayUbicacion, _setUbicacionDisponible,
  hayCatalogo, _setCatalogoDisponible,
};
