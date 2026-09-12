const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Escritura de los precios de lista de un NODO.
//
// Cuatro niveles y una sola forma. El `precios` de cada tabla es la MISMA
// columna con el mismo significado, así que lo único que cambia entre niveles
// es de dónde cuelga la sucursal — y eso es justo lo que decide si el nodo es
// de este negocio o del de al lado.
//
// Las consultas van acotadas por `negocio_id` SIEMPRE, y dentro del propio
// UPDATE: comprobar la pertenencia en una consulta aparte y escribir en otra
// deja una ventana entre las dos. En una base compartida por 28 negocios eso no
// es teoría — `findSerialEnInventario` buscaba por IMEI a secas y podía alcanzar
// (y hacer borrar) la fila de otro.
// ─────────────────────────────────────────────────────────────────────────────

// Cada nivel: cómo se llega desde su tabla hasta la sucursal, y por tanto hasta
// el negocio. `$1` = precios (jsonb o null), `$2` = id del nodo, `$3` = negocio.
const UPDATES = {
  producto: `
    UPDATE productos_cantidad pc
    SET precios = $1::jsonb
    FROM sucursales su
    WHERE pc.id = $2 AND su.id = pc.sucursal_id AND su.negocio_id = $3
    RETURNING pc.id`,

  atributo: `
    UPDATE atributos_producto ap
    SET precios = $1::jsonb
    FROM sucursales su
    WHERE ap.id = $2 AND su.id = ap.sucursal_id AND su.negocio_id = $3
    RETURNING ap.id`,

  // `variantes_atributo` no tiene `sucursal_id` —cuelga de su atributo—, igual
  // que pasa con su índice de código único. El alcance de negocio sube por el
  // padre, nunca se asume.
  variante: `
    UPDATE variantes_atributo v
    SET precios = $1::jsonb
    FROM atributos_producto ap
    JOIN sucursales su ON su.id = ap.sucursal_id
    WHERE v.id = $2 AND ap.id = v.atributo_id AND su.negocio_id = $3
    RETURNING v.id`,

  serial: `
    UPDATE productos_serial ps
    SET precios = $1::jsonb
    FROM sucursales su
    WHERE ps.id = $2 AND su.id = ps.sucursal_id AND su.negocio_id = $3
    RETURNING ps.id`,
};

const NIVELES = Object.keys(UPDATES);

/**
 * Escribe los precios de un nodo. Devuelve true si la fila existía Y era de
 * este negocio; false en cualquier otro caso — el llamador decide si eso es un
 * error o una línea que se salta.
 */
const escribirPrecios = async (client, { nivel, id, precios }, negocioId) => {
  const sql = UPDATES[nivel];
  if (!sql) return false;
  const { rows } = await client.query(sql, [
    precios === null ? null : JSON.stringify(precios),
    id,
    negocioId,
  ]);
  return rows.length > 0;
};

/**
 * Los precios que hoy tiene cada nodo de un producto por cantidad, para poder
 * pintarlos en el editor sin que la pantalla tenga que rearmarlos desde tres
 * consultas distintas. El árbol ya viaja con ellos en la lista de inventario;
 * esto existe para el caso en que se edite un producto que no está en pantalla.
 */
const leerPreciosProductoCantidad = async (productoId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT 'producto' AS nivel, pc.id, pc.nombre AS etiqueta, pc.precios
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE pc.id = $1 AND su.negocio_id = $2

    UNION ALL

    SELECT 'atributo', ap.id, COALESCE(tc.nombre || ': ', '') || ap.valor, ap.precios
    FROM atributos_producto ap
    JOIN sucursales su ON su.id = ap.sucursal_id
    LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
    WHERE ap.producto_id = $1 AND ap.activo = true AND su.negocio_id = $2

    UNION ALL

    SELECT 'variante', v.id, COALESCE(tc.nombre || ': ', '') || v.valor, v.precios
    FROM variantes_atributo v
    JOIN atributos_producto ap ON ap.id = v.atributo_id
    JOIN sucursales su ON su.id = ap.sucursal_id
    LEFT JOIN tipos_caracteristica tc ON tc.id = v.tipo_id
    WHERE ap.producto_id = $1 AND ap.activo = true AND v.activo = true
      AND su.negocio_id = $2
  `, [productoId, negocioId]);
  return rows;
};

module.exports = { NIVELES, escribirPrecios, leerPreciosProductoCantidad, pool };
