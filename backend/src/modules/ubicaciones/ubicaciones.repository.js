const { pool } = require('../../config/db');
const { hayUbicacion } = require('../../config/columnas');

// ── Catálogo de ubicaciones usadas en una sucursal ───────────────────────────
//
// No hay tabla de ubicaciones: el catálogo se DERIVA de lo que los productos
// tienen escrito. Así no hay nada que mantener antes de empezar a usar la
// feature, y una ubicación deja de existir sola cuando ya no hay nada en ella.
//
// Une las dos familias de producto porque un estante guarda de todo: al
// bodeguero le sirve ver "Estante A-3: 12 productos" sin importar si son
// referencias con IMEI o productos por cantidad.
//
// Se agrupa por la forma normalizada (minúsculas, sin espacios extra) para que
// "Estante A-3" y "estante a-3" no salgan como dos sitios distintos, pero se
// muestra la variante más usada, que es como la escribe el negocio.

const listarPorSucursal = async (sucursalId, negocioId) => {
  // Sin la columna en la BD no hay catálogo posible: lista vacía, sin error.
  // El autocompletado simplemente no sugiere nada.
  if (!hayUbicacion()) return [];

  const { rows } = await pool.query(`
    WITH todas AS (
      SELECT pc.ubicacion, 1 AS unidades
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE pc.sucursal_id = $1
        AND su.negocio_id  = $2
        AND pc.activo      = true
        AND BTRIM(COALESCE(pc.ubicacion, '')) <> ''

      UNION ALL

      SELECT ps.ubicacion, 1 AS unidades
      FROM productos_serial ps
      JOIN sucursales su ON su.id = ps.sucursal_id
      WHERE ps.sucursal_id = $1
        AND su.negocio_id  = $2
        AND BTRIM(COALESCE(ps.ubicacion, '')) <> ''
    )
    SELECT
      MODE() WITHIN GROUP (ORDER BY ubicacion) AS ubicacion,
      COUNT(*)::int                            AS productos
    FROM todas
    GROUP BY LOWER(BTRIM(ubicacion))
    ORDER BY 1
  `, [sucursalId, negocioId]);

  return rows;
};

module.exports = { listarPorSucursal };
