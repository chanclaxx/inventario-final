const { pool } = require('../../config/db');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.nombre, u.email, u.rol, u.activo,
           u.sucursal_id, u.creado_en, u.ultimo_acceso,
           u.modulos_permitidos, u.permisos_proveedores,
           u.permisos_edicion_productos,
           s.nombre AS sucursal_nombre
    FROM usuarios u
    LEFT JOIN sucursales s ON s.id = u.sucursal_id
    WHERE u.negocio_id = $1
    ORDER BY u.nombre
  `, [negocioId]);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.nombre, u.email, u.rol, u.activo,
           u.sucursal_id, u.creado_en, u.ultimo_acceso,
           u.modulos_permitidos, u.permisos_proveedores,
           u.permisos_edicion_productos,
           s.nombre AS sucursal_nombre
    FROM usuarios u
    LEFT JOIN sucursales s ON s.id = u.sucursal_id
    WHERE u.id = $1 AND u.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

/**
 * Búsqueda global por email — alineada con el constraint usuarios_email_key (único global).
 * Acepta excludeId para no colisionar consigo mismo al editar.
 */
const findByEmail = async (email, excludeId = null) => {
  const { rows } = await pool.query(
    `SELECT id FROM usuarios
     WHERE LOWER(email) = LOWER($1)
       AND ($2::int IS NULL OR id <> $2)`,
    [email, excludeId]
  );
  return rows[0] || null;
};

const create = async ({
  negocio_id, nombre, email, password_hash, rol,
  sucursal_id, password_temporal, modulos_permitidos, permisos_proveedores,
  permisos_edicion_productos,
}) => {
  const { rows } = await pool.query(`
    INSERT INTO usuarios(
      negocio_id, nombre, email, password_hash, rol,
      sucursal_id, password_temporal, modulos_permitidos, permisos_proveedores,
      permisos_edicion_productos
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
    RETURNING id, nombre, email, rol, activo, sucursal_id,
              creado_en, modulos_permitidos, permisos_proveedores, permisos_edicion_productos
  `, [
    negocio_id, nombre, email, password_hash, rol,
    sucursal_id || null,
    password_temporal ?? false,
    modulos_permitidos || null,
    permisos_proveedores ? JSON.stringify(permisos_proveedores) : null,
    permisos_edicion_productos ? JSON.stringify(permisos_edicion_productos) : null,
  ]);
  return rows[0];
};

const update = async (negocioId, id, datos) => {
  const { nombre, email, rol, sucursal_id, modulos_permitidos, permisos_proveedores, permisos_edicion_productos } = datos;
  const activoExplicito = typeof datos.activo === 'boolean';

  const modGuardar = (modulos_permitidos !== undefined && modulos_permitidos !== null)
    ? modulos_permitidos
    : null;
  const permGuardar = (permisos_proveedores !== undefined && permisos_proveedores !== null)
    ? JSON.stringify(permisos_proveedores)
    : null;
  const permEdicionGuardar = (permisos_edicion_productos !== undefined && permisos_edicion_productos !== null)
    ? JSON.stringify(permisos_edicion_productos)
    : null;

  let query, params;

  if (activoExplicito) {
    query = `
      UPDATE usuarios
      SET nombre = $1, email = $2, rol = $3, sucursal_id = $4,
          activo = $5, modulos_permitidos = $6::text[], permisos_proveedores = $7::jsonb,
          permisos_edicion_productos = $8::jsonb
      WHERE id = $9 AND negocio_id = $10
      RETURNING id, nombre, email, rol, activo, sucursal_id,
                modulos_permitidos, permisos_proveedores, permisos_edicion_productos
    `;
    params = [
      nombre, email, rol, sucursal_id || null,
      datos.activo, modGuardar, permGuardar, permEdicionGuardar,
      id, negocioId,
    ];
  } else {
    query = `
      UPDATE usuarios
      SET nombre = $1, email = $2, rol = $3,
          sucursal_id = $4, modulos_permitidos = $5::text[], permisos_proveedores = $6::jsonb,
          permisos_edicion_productos = $7::jsonb
      WHERE id = $8 AND negocio_id = $9
      RETURNING id, nombre, email, rol, activo, sucursal_id,
                modulos_permitidos, permisos_proveedores, permisos_edicion_productos
    `;
    params = [
      nombre, email, rol, sucursal_id || null,
      modGuardar, permGuardar, permEdicionGuardar,
      id, negocioId,
    ];
  }

  const { rows } = await pool.query(query, params);
  return rows[0] || null;
};

const updatePassword = async (negocioId, id, password_hash) => {
  const { rowCount } = await pool.query(
    'UPDATE usuarios SET password_hash = $1 WHERE id = $2 AND negocio_id = $3',
    [password_hash, id, negocioId]
  );
  return rowCount > 0;
};

const findAdminByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, email, negocio_id
     FROM usuarios
     WHERE LOWER(email) = LOWER($1)
       AND rol = 'admin_negocio'
       AND activo = true
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
};

const crearTokenRecuperacion = async (usuarioId, tokenHash, expiraEn) => {
  await pool.query(
    `UPDATE tokens_recuperacion SET usado = true
     WHERE usuario_id = $1 AND usado = false`,
    [usuarioId]
  );
  const { rows } = await pool.query(
    `INSERT INTO tokens_recuperacion(usuario_id, token_hash, expira_en)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [usuarioId, tokenHash, expiraEn]
  );
  return rows[0];
};

const findTokenRecuperacion = async (tokenHash) => {
  const { rows } = await pool.query(
    `SELECT tr.id, tr.usuario_id, tr.expira_en, tr.usado,
            u.email, u.negocio_id
     FROM tokens_recuperacion tr
     JOIN usuarios u ON u.id = tr.usuario_id
     WHERE tr.token_hash = $1
       AND tr.usado = false
       AND tr.expira_en > now()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
};

const invalidarTokenRecuperacion = async (tokenId) => {
  await pool.query(
    'UPDATE tokens_recuperacion SET usado = true WHERE id = $1',
    [tokenId]
  );
};

const getActividad = async (negocioId, { usuario_id, fecha_desde, fecha_hasta, tipo, limit = 50, offset = 0 } = {}) => {
  const params = [negocioId];
  let idx = 2;

  const filtroUsuario   = usuario_id   ? `AND u.id = $${idx++}`                  : '';
  if (usuario_id)   params.push(usuario_id);

  const filtroDesde     = fecha_desde  ? `AND fecha >= $${idx++}`                 : '';
  if (fecha_desde)  params.push(fecha_desde);

  const filtroHasta     = fecha_hasta  ? `AND fecha <= ($${idx++}::date + interval '1 day' - interval '1 second')` : '';
  if (fecha_hasta)  params.push(fecha_hasta);

  params.push(limit);
  params.push(offset);
  const idxLimit  = idx++;
  const idxOffset = idx++;

  const bloques = {
    venta: `
      SELECT 'venta' AS tipo, f.id, f.fecha,
             u.id AS usuario_id, u.nombre AS usuario_nombre, u.rol AS usuario_rol,
             s.nombre AS sucursal_nombre,
             'Venta a ' || COALESCE(f.nombre_cliente, 'cliente') AS descripcion,
             COALESCE(SUM(l.precio * (l.cantidad - COALESCE(l.cantidad_devuelta,0))), 0) AS valor
      FROM facturas f
      JOIN sucursales s ON s.id = f.sucursal_id
      JOIN usuarios   u ON u.id = f.usuario_id
      LEFT JOIN lineas_factura l ON l.factura_id = f.id
      WHERE s.negocio_id = $1 AND f.usuario_id IS NOT NULL
        ${filtroUsuario} ${filtroDesde} ${filtroHasta}
      GROUP BY f.id, u.id, u.nombre, u.rol, s.nombre`,

    compra: `
      SELECT 'compra' AS tipo, c.id, c.fecha,
             u.id AS usuario_id, u.nombre AS usuario_nombre, u.rol AS usuario_rol,
             s.nombre AS sucursal_nombre,
             'Compra registrada' AS descripcion,
             c.total AS valor
      FROM compras c
      JOIN sucursales s ON s.id = c.sucursal_id
      JOIN usuarios   u ON u.id = c.usuario_id
      WHERE s.negocio_id = $1 AND c.usuario_id IS NOT NULL
        ${filtroUsuario} ${filtroDesde} ${filtroHasta}`,

    apertura_caja: `
      SELECT 'apertura_caja' AS tipo, ac.id, ac.fecha_apertura AS fecha,
             u.id AS usuario_id, u.nombre AS usuario_nombre, u.rol AS usuario_rol,
             s.nombre AS sucursal_nombre,
             CASE ac.estado
               WHEN 'Cerrada' THEN 'Cierre de caja'
               ELSE 'Apertura de caja'
             END AS descripcion,
             ac.monto_inicial AS valor
      FROM aperturas_caja ac
      JOIN sucursales s ON s.id = ac.sucursal_id
      JOIN usuarios   u ON u.id = ac.usuario_id
      WHERE s.negocio_id = $1 AND ac.usuario_id IS NOT NULL
        ${filtroUsuario} ${filtroDesde} ${filtroHasta}`,

    traslado: `
      SELECT 'traslado' AS tipo, t.id, t.fecha,
             u.id AS usuario_id, u.nombre AS usuario_nombre, u.rol AS usuario_rol,
             so.nombre AS sucursal_nombre,
             'Traslado: ' || so.nombre || ' → ' || sd.nombre AS descripcion,
             NULL::numeric AS valor
      FROM traslados t
      JOIN sucursales so ON so.id = t.sucursal_origen_id
      JOIN sucursales sd ON sd.id = t.sucursal_destino_id
      JOIN usuarios   u  ON u.id  = t.usuario_id
      WHERE t.negocio_id = $1 AND t.usuario_id IS NOT NULL
        ${filtroUsuario} ${filtroDesde} ${filtroHasta}`,

    movimiento_caja: `
      SELECT 'movimiento_caja' AS tipo, mc.id, mc.fecha,
             u.id AS usuario_id, u.nombre AS usuario_nombre, u.rol AS usuario_rol,
             s.nombre AS sucursal_nombre,
             mc.tipo || ' de caja: ' || mc.concepto AS descripcion,
             mc.valor AS valor
      FROM movimientos_caja mc
      JOIN aperturas_caja ac ON ac.id = mc.caja_id
      JOIN sucursales     s  ON s.id  = ac.sucursal_id
      JOIN usuarios       u  ON u.id  = mc.usuario_id
      WHERE s.negocio_id = $1 AND mc.usuario_id IS NOT NULL AND mc.activo = true
        ${filtroUsuario} ${filtroDesde} ${filtroHasta}`,
  };

  const tiposActivos = (tipo && bloques[tipo]) ? [tipo] : Object.keys(bloques);
  const union = tiposActivos.map((t) => bloques[t]).join('\nUNION ALL\n');

  const sql = `
    SELECT * FROM (${union}) act
    ORDER BY fecha DESC
    LIMIT $${idxLimit} OFFSET $${idxOffset}
  `;

  const countSql = `SELECT COUNT(*) AS total FROM (${union}) act`;

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, params.slice(0, -2)),
  ]);

  return { actividad: rows, total: parseInt(countRows[0].total) };
};

module.exports = {
  findAll, findById, findByEmail,
  create, update, updatePassword,
  crearTokenRecuperacion, findAdminByEmail,
  findTokenRecuperacion, invalidarTokenRecuperacion,
  getActividad,
};
