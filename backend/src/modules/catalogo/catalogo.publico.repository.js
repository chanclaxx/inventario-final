const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Repositorio PÚBLICO del catálogo — sin autenticación.
//
// ⚠️ REGLA DURA DE ESTE ARCHIVO ⚠️
// Toda columna que salga de aquí la puede leer cualquier persona de internet.
// Por eso:
//   1. Lista blanca explícita de columnas. Prohibido `SELECT *`.
//   2. Prohibido reutilizar las consultas del inventario (traen costos, IMEI,
//      proveedor, ubicación y notas internas).
//   3. La disponibilidad sale como BOOLEANO, nunca como número: publicar el
//      stock exacto es regalarle inteligencia competitiva a la competencia.
//
// NUNCA se seleccionan: costo_unitario, costo_compra, imei, proveedor_id,
// cliente_origen, nota, ubicacion, codigo, stock_minimo, sucursal_id.
// ─────────────────────────────────────────────────────────────────────────────

// Estados de plan que apagan la vitrina. Misma lista que plan.middleware.js: si
// la app se bloquea para el negocio, su catálogo público también.
const PLANES_BLOQUEADOS = ['vencido', 'suspendido', 'pendiente'];

const getVitrinaPorSlug = async (slug) => {
  const { rows } = await pool.query(
    `SELECT cs.id, cs.sucursal_id, cs.slug,
            COALESCE(NULLIF(BTRIM(cs.titulo), ''), n.nombre) AS titulo,
            cs.descripcion, cs.whatsapp, cs.direccion, cs.horario,
            cs.color_primario, cs.mostrar_precios, cs.mostrar_disponibilidad,
            cs.ocultar_agotados
     FROM catalogo_sucursal cs
     JOIN sucursales su ON su.id = cs.sucursal_id
     JOIN negocios   n  ON n.id  = cs.negocio_id
     WHERE LOWER(cs.slug) = LOWER($1)
       AND cs.activo   = true
       AND su.activa   = true
       AND n.activo    = true
       -- COALESCE para reproducir EXACTAMENTE la regla de plan.middleware.js:
       -- allí un estado_plan nulo no bloquea, así que aquí tampoco debe apagar
       -- la vitrina. Sin el COALESCE, la comparación daría NULL y el catálogo
       -- moriría en silencio mientras la app funciona normal.
       AND COALESCE(n.estado_plan, '') <> ALL($2::text[])
     LIMIT 1`,
    [slug, PLANES_BLOQUEADOS]
  );
  return rows[0] || null;
};

// Productos publicados de una vitrina.
//
// El precio efectivo es `precio_publico` (override manual) o el precio de lista
// del inventario. NUNCA se calcula desde el costo: el sistema ya documenta que
// un precio derivado de tarifa permite despejar el costo dividiendo.
const getProductosPublicados = async (vitrina) => {
  const { rows } = await pool.query(
    `WITH items AS (
       -- ── Productos por cantidad ──────────────────────────────────────────
       SELECT
         ci.id,
         COALESCE(NULLIF(BTRIM(ci.titulo), ''), pc.nombre) AS nombre,
         ci.descripcion,
         ci.marca,
         lp.nombre AS linea,
         NULL::text AS modelo,
         pc.unidad_medida,
         CASE WHEN ci.mostrar_precio THEN COALESCE(ci.precio_publico, pc.precio) END AS precio,
         (pc.stock > 0) AS disponible,
         ci.destacado,
         ci.orden
       FROM catalogo_items ci
       JOIN productos_cantidad pc
         ON pc.id = ci.producto_id AND pc.sucursal_id = ci.sucursal_id AND pc.activo = true
       LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
       WHERE ci.sucursal_id = $1 AND ci.tipo = 'cantidad' AND ci.publicado = true

       UNION ALL

       -- ── Productos con serial ────────────────────────────────────────────
       SELECT
         ci.id,
         COALESCE(NULLIF(BTRIM(ci.titulo), ''), ps.nombre) AS nombre,
         ci.descripcion,
         -- La marca del catálogo manda; si no la escribieron, se usa la del
         -- inventario, que en serial sí existe.
         COALESCE(NULLIF(BTRIM(ci.marca), ''), ps.marca) AS marca,
         lp.nombre AS linea,
         ps.modelo,
         NULL::text AS unidad_medida,
         CASE WHEN ci.mostrar_precio THEN COALESCE(ci.precio_publico, ps.precio) END AS precio,
         (COALESCE(disp.total, 0) > 0) AS disponible,
         ci.destacado,
         ci.orden
       FROM catalogo_items ci
       JOIN productos_serial ps
         ON ps.id = ci.producto_id AND ps.sucursal_id = ci.sucursal_id
       LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS total FROM seriales s
         WHERE s.producto_id = ps.id AND s.vendido = false AND s.prestado = false
       ) disp ON true
       WHERE ci.sucursal_id = $1 AND ci.tipo = 'serial' AND ci.publicado = true
     )
     SELECT
       i.id, i.nombre, i.descripcion, i.marca, i.linea, i.modelo,
       i.unidad_medida, i.precio, i.disponible, i.destacado,
       COALESCE(img.imagenes, '[]'::json) AS imagenes
     FROM items i
     LEFT JOIN LATERAL (
       SELECT JSON_AGG(JSON_BUILD_OBJECT('url', im.url, 'alt', im.alt)
                       ORDER BY im.orden, im.id) AS imagenes
       FROM catalogo_imagenes im WHERE im.item_id = i.id
     ) img ON true
     WHERE ($2::boolean = false OR i.disponible = true)
     ORDER BY i.destacado DESC, i.orden, i.nombre`,
    [vitrina.sucursal_id, vitrina.ocultar_agotados]
  );
  return rows;
};

// Todos los slugs activos — alimenta el prerenderizado y el sitemap.
const listarSlugsActivos = async () => {
  const { rows } = await pool.query(
    `SELECT cs.slug
     FROM catalogo_sucursal cs
     JOIN sucursales su ON su.id = cs.sucursal_id
     JOIN negocios   n  ON n.id  = cs.negocio_id
     WHERE cs.activo = true AND su.activa = true AND n.activo = true
       AND COALESCE(n.estado_plan, '') <> ALL($1::text[])
     ORDER BY cs.slug`,
    [PLANES_BLOQUEADOS]
  );
  return rows.map((r) => r.slug);
};

module.exports = { getVitrinaPorSlug, getProductosPublicados, listarSlugsActivos };
