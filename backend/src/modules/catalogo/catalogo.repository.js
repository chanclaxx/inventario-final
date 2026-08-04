const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Repositorio de ADMINISTRACIÓN del catálogo (rutas autenticadas).
//
// Ojo con la frontera: este archivo lo consumen usuarios con sesión, así que
// puede devolver stock y demás datos operativos. Lo que se publica hacia afuera
// sale EXCLUSIVAMENTE de catalogo.publico.repository.js, que tiene su propia
// lista blanca de columnas. Nunca mezclar las dos.
// ─────────────────────────────────────────────────────────────────────────────

// ── Vitrina de la sucursal ──────────────────────────────────────────────────

const getVitrina = async (sucursalId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT cs.id, cs.sucursal_id, cs.slug, cs.activo, cs.titulo, cs.descripcion,
            cs.whatsapp, cs.direccion, cs.horario, cs.color_primario,
            cs.mostrar_precios, cs.mostrar_disponibilidad, cs.ocultar_agotados,
            cs.creado_en, cs.actualizado_en,
            su.nombre AS sucursal_nombre
     FROM catalogo_sucursal cs
     JOIN sucursales su ON su.id = cs.sucursal_id
     WHERE cs.sucursal_id = $1 AND cs.negocio_id = $2`,
    [sucursalId, negocioId]
  );
  return rows[0] || null;
};

const listarVitrinas = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT cs.sucursal_id, cs.slug, cs.activo, su.nombre AS sucursal_nombre,
            (SELECT COUNT(*) FROM catalogo_items ci
             WHERE ci.sucursal_id = cs.sucursal_id AND ci.publicado) AS publicados
     FROM catalogo_sucursal cs
     JOIN sucursales su ON su.id = cs.sucursal_id
     WHERE cs.negocio_id = $1
     ORDER BY su.nombre`,
    [negocioId]
  );
  return rows;
};

// Slug de la vitrina de una sucursal. Es lo que necesita saber el refresco bajo
// demanda para purgar la ruta correcta en la app pública.
const slugDeSucursal = async (sucursalId) => {
  const { rows } = await pool.query(
    'SELECT slug FROM catalogo_sucursal WHERE sucursal_id = $1',
    [sucursalId]
  );
  return rows[0]?.slug || null;
};

const slugOcupado = async (slug, sucursalId) => {
  const { rows } = await pool.query(
    `SELECT sucursal_id FROM catalogo_sucursal
     WHERE LOWER(slug) = LOWER($1) AND sucursal_id <> $2
     LIMIT 1`,
    [slug, sucursalId]
  );
  return rows.length > 0;
};

const upsertVitrina = async (negocioId, sucursalId, datos) => {
  const { rows } = await pool.query(
    `INSERT INTO catalogo_sucursal
       (negocio_id, sucursal_id, slug, activo, titulo, descripcion, whatsapp,
        direccion, horario, color_primario, mostrar_precios,
        mostrar_disponibilidad, ocultar_agotados)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (sucursal_id) DO UPDATE SET
       slug                   = EXCLUDED.slug,
       activo                 = EXCLUDED.activo,
       titulo                 = EXCLUDED.titulo,
       descripcion            = EXCLUDED.descripcion,
       whatsapp               = EXCLUDED.whatsapp,
       direccion              = EXCLUDED.direccion,
       horario                = EXCLUDED.horario,
       color_primario         = EXCLUDED.color_primario,
       mostrar_precios        = EXCLUDED.mostrar_precios,
       mostrar_disponibilidad = EXCLUDED.mostrar_disponibilidad,
       ocultar_agotados       = EXCLUDED.ocultar_agotados,
       actualizado_en         = NOW()
     RETURNING *`,
    [
      negocioId, sucursalId, datos.slug, datos.activo,
      datos.titulo, datos.descripcion, datos.whatsapp,
      datos.direccion, datos.horario, datos.color_primario,
      datos.mostrar_precios, datos.mostrar_disponibilidad, datos.ocultar_agotados,
    ]
  );
  return rows[0];
};

// ── Inventario de la sucursal + estado de publicación ───────────────────────
//
// Una fila por producto de la sucursal, con su ficha de catálogo si existe.
// El LEFT JOIN es lo que permite mostrar TODO el inventario y que el admin
// decida producto por producto, sin tener que crear fichas por adelantado.

const listarItemsCantidad = async (sucursalId) => {
  const { rows } = await pool.query(
    `SELECT
       'cantidad'::text AS tipo,
       pc.id            AS producto_id,
       pc.nombre,
       pc.precio,
       pc.stock,
       pc.unidad_medida,
       lp.nombre        AS linea,
       (pc.stock > 0)   AS disponible,
       ci.id            AS item_id,
       COALESCE(ci.publicado, false) AS publicado,
       ci.titulo, ci.descripcion, ci.marca,
       ci.precio_publico, ci.mostrar_precio, ci.destacado, ci.orden,
       COALESCE(img.total, 0) AS imagenes
     FROM productos_cantidad pc
     LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
     LEFT JOIN catalogo_items  ci
       ON ci.sucursal_id = pc.sucursal_id AND ci.tipo = 'cantidad' AND ci.producto_id = pc.id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS total FROM catalogo_imagenes im WHERE im.item_id = ci.id
     ) img ON true
     WHERE pc.sucursal_id = $1 AND pc.activo = true
     ORDER BY pc.nombre`,
    [sucursalId]
  );
  return rows;
};

const listarItemsSerial = async (sucursalId) => {
  const { rows } = await pool.query(
    `SELECT
       'serial'::text AS tipo,
       ps.id          AS producto_id,
       ps.nombre,
       ps.precio,
       ps.modelo,
       ps.marca       AS marca_inventario,
       lp.nombre      AS linea,
       COALESCE(disp.total, 0) AS stock,
       (COALESCE(disp.total, 0) > 0) AS disponible,
       ci.id          AS item_id,
       COALESCE(ci.publicado, false) AS publicado,
       ci.titulo, ci.descripcion, ci.marca,
       ci.precio_publico, ci.mostrar_precio, ci.destacado, ci.orden,
       COALESCE(img.total, 0) AS imagenes
     FROM productos_serial ps
     LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS total FROM seriales s
       WHERE s.producto_id = ps.id AND s.vendido = false AND s.prestado = false
     ) disp ON true
     LEFT JOIN catalogo_items ci
       ON ci.sucursal_id = ps.sucursal_id AND ci.tipo = 'serial' AND ci.producto_id = ps.id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS total FROM catalogo_imagenes im WHERE im.item_id = ci.id
     ) img ON true
     WHERE ps.sucursal_id = $1
     ORDER BY ps.nombre`,
    [sucursalId]
  );
  return rows;
};

// ── Validación de pertenencia del producto ──────────────────────────────────
// No hay FK (el `tipo` decide la tabla), así que la integridad se comprueba
// aquí antes de crear cualquier ficha.

const productoExisteEnSucursal = async (tipo, productoId, sucursalId) => {
  const sql = tipo === 'serial'
    ? `SELECT id FROM productos_serial   WHERE id = $1 AND sucursal_id = $2`
    : `SELECT id FROM productos_cantidad WHERE id = $1 AND sucursal_id = $2 AND activo = true`;
  const { rows } = await pool.query(sql, [productoId, sucursalId]);
  return rows.length > 0;
};

// ── Fichas ──────────────────────────────────────────────────────────────────

const getItem = async (itemId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT ci.*,
            COALESCE(img.imagenes, '[]'::json) AS imagenes
     FROM catalogo_items ci
     LEFT JOIN LATERAL (
       SELECT JSON_AGG(JSON_BUILD_OBJECT(
         'id', im.id, 'url', im.url, 'alt', im.alt, 'orden', im.orden
       ) ORDER BY im.orden, im.id) AS imagenes
       FROM catalogo_imagenes im WHERE im.item_id = ci.id
     ) img ON true
     WHERE ci.id = $1 AND ci.negocio_id = $2`,
    [itemId, negocioId]
  );
  return rows[0] || null;
};

const upsertItem = async (negocioId, sucursalId, tipo, productoId, datos) => {
  const { rows } = await pool.query(
    `INSERT INTO catalogo_items
       (negocio_id, sucursal_id, tipo, producto_id, publicado, titulo,
        descripcion, marca, precio_publico, mostrar_precio, destacado, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (sucursal_id, tipo, producto_id) DO UPDATE SET
       publicado      = EXCLUDED.publicado,
       titulo         = EXCLUDED.titulo,
       descripcion    = EXCLUDED.descripcion,
       marca          = EXCLUDED.marca,
       precio_publico = EXCLUDED.precio_publico,
       mostrar_precio = EXCLUDED.mostrar_precio,
       destacado      = EXCLUDED.destacado,
       orden          = EXCLUDED.orden,
       actualizado_en = NOW()
     RETURNING *`,
    [
      negocioId, sucursalId, tipo, productoId,
      datos.publicado, datos.titulo, datos.descripcion, datos.marca,
      datos.precio_publico, datos.mostrar_precio, datos.destacado, datos.orden,
    ]
  );
  return rows[0];
};

// Publicación masiva. Crea las fichas que falten en un solo statement: sin esto
// el admin tendría que abrir producto por producto solo para encenderlo.
const publicarMasivo = async (negocioId, sucursalId, tipo, productoIds, publicado) => {
  const { rows } = await pool.query(
    `INSERT INTO catalogo_items (negocio_id, sucursal_id, tipo, producto_id, publicado)
     SELECT $1, $2, $3, pid, $5
     FROM unnest($4::int[]) AS pid
     ON CONFLICT (sucursal_id, tipo, producto_id) DO UPDATE SET
       publicado      = EXCLUDED.publicado,
       actualizado_en = NOW()
     RETURNING id`,
    [negocioId, sucursalId, tipo, productoIds, publicado]
  );
  return rows.length;
};

// ── Imágenes ────────────────────────────────────────────────────────────────

const contarImagenes = async (itemId) => {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS total FROM catalogo_imagenes WHERE item_id = $1',
    [itemId]
  );
  return rows[0].total;
};

const crearImagen = async (itemId, { storage_path, url, alt, bytes, usuario_id }) => {
  const { rows } = await pool.query(
    `INSERT INTO catalogo_imagenes (item_id, storage_path, url, alt, bytes, orden, usuario_id)
     VALUES ($1,$2,$3,$4,$5,
       COALESCE((SELECT MAX(orden) + 1 FROM catalogo_imagenes WHERE item_id = $1), 0),
       $6)
     RETURNING id, url, alt, orden`,
    [itemId, storage_path, url, alt || null, bytes || null, usuario_id || null]
  );
  return rows[0];
};

const getImagen = async (imagenId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT im.id, im.item_id, im.storage_path
     FROM catalogo_imagenes im
     JOIN catalogo_items ci ON ci.id = im.item_id
     WHERE im.id = $1 AND ci.negocio_id = $2`,
    [imagenId, negocioId]
  );
  return rows[0] || null;
};

const eliminarImagen = async (imagenId) => {
  const { rowCount } = await pool.query(
    'DELETE FROM catalogo_imagenes WHERE id = $1',
    [imagenId]
  );
  return rowCount > 0;
};

// Reordena en bloque. El índice del array es el nuevo orden, así que la portada
// es simplemente el primer id que mande el frontend.
const reordenarImagenes = async (itemId, idsEnOrden) => {
  await pool.query(
    `UPDATE catalogo_imagenes im
     SET orden = nuevo.pos
     FROM (SELECT id, (ord - 1) AS pos FROM unnest($2::bigint[]) WITH ORDINALITY AS t(id, ord)) nuevo
     WHERE im.id = nuevo.id AND im.item_id = $1`,
    [itemId, idsEnOrden]
  );
};

module.exports = {
  getVitrina, listarVitrinas, slugOcupado, slugDeSucursal, upsertVitrina,
  listarItemsCantidad, listarItemsSerial, productoExisteEnSucursal,
  getItem, upsertItem, publicarMasivo,
  contarImagenes, crearImagen, getImagen, eliminarImagen, reordenarImagenes,
};
