const { pool } = require('../../config/db');

const findAll = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.nombre, u.email, u.rol, u.activo,
           u.sucursal_id, u.creado_en, u.ultimo_acceso,
           u.modulos_permitidos, u.permisos_proveedores,
           u.permisos_edicion_productos, u.sucursales_vista,
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
           u.permisos_edicion_productos, u.sucursales_vista,
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
  permisos_edicion_productos, sucursales_vista,
}) => {
  const { rows } = await pool.query(`
    INSERT INTO usuarios(
      negocio_id, nombre, email, password_hash, rol,
      sucursal_id, password_temporal, modulos_permitidos, permisos_proveedores,
      permisos_edicion_productos, sucursales_vista
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::integer[])
    RETURNING id, nombre, email, rol, activo, sucursal_id,
              creado_en, modulos_permitidos, permisos_proveedores,
              permisos_edicion_productos, sucursales_vista
  `, [
    negocio_id, nombre, email, password_hash, rol,
    sucursal_id || null,
    password_temporal ?? false,
    modulos_permitidos || null,
    permisos_proveedores ? JSON.stringify(permisos_proveedores) : null,
    permisos_edicion_productos ? JSON.stringify(permisos_edicion_productos) : null,
    sucursales_vista || null,
  ]);
  return rows[0];
};

const update = async (negocioId, id, datos) => {
  const {
    nombre, email, rol, sucursal_id,
    modulos_permitidos, permisos_proveedores, permisos_edicion_productos,
    sucursales_vista,
  } = datos;
  const activoExplicito = typeof datos.activo === 'boolean';

  const modGuardar = (modulos_permitidos !== undefined && modulos_permitidos !== null)
    ? modulos_permitidos : null;
  const permGuardar = (permisos_proveedores !== undefined && permisos_proveedores !== null)
    ? JSON.stringify(permisos_proveedores) : null;
  const permEdicionGuardar = (permisos_edicion_productos !== undefined && permisos_edicion_productos !== null)
    ? JSON.stringify(permisos_edicion_productos) : null;
  const vistaGuardar = (sucursales_vista !== undefined && sucursales_vista !== null && sucursales_vista.length)
    ? sucursales_vista : null;

  let query, params;

  if (activoExplicito) {
    query = `
      UPDATE usuarios
      SET nombre = $1, email = $2, rol = $3, sucursal_id = $4,
          activo = $5, modulos_permitidos = $6::text[], permisos_proveedores = $7::jsonb,
          permisos_edicion_productos = $8::jsonb, sucursales_vista = $9::integer[]
      WHERE id = $10 AND negocio_id = $11
      RETURNING id, nombre, email, rol, activo, sucursal_id,
                modulos_permitidos, permisos_proveedores, permisos_edicion_productos, sucursales_vista
    `;
    params = [
      nombre, email, rol, sucursal_id || null,
      datos.activo, modGuardar, permGuardar, permEdicionGuardar, vistaGuardar,
      id, negocioId,
    ];
  } else {
    query = `
      UPDATE usuarios
      SET nombre = $1, email = $2, rol = $3,
          sucursal_id = $4, modulos_permitidos = $5::text[], permisos_proveedores = $6::jsonb,
          permisos_edicion_productos = $7::jsonb, sucursales_vista = $8::integer[]
      WHERE id = $9 AND negocio_id = $10
      RETURNING id, nombre, email, rol, activo, sucursal_id,
                modulos_permitidos, permisos_proveedores, permisos_edicion_productos, sucursales_vista
    `;
    params = [
      nombre, email, rol, sucursal_id || null,
      modGuardar, permGuardar, permEdicionGuardar, vistaGuardar,
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

// Mapeo de tipo UI → valor de tabla en auditoria
const TABLA_POR_TIPO = {
  venta:              'facturas',
  compra:             'compras',
  traslado:           'traslados',
  caja:               'caja',
  inventario_serial:  'productos_serial',
  inventario_cantidad:'productos_cantidad',
  servicio:           'servicios',
  credito:            'creditos',
  prestamo:           'prestamos',
  usuario:            'usuarios',
};

const getActividad = async (negocioId, { usuario_id, fecha_desde, fecha_hasta, tipo, limit = 50, offset = 0 } = {}) => {
  const params = [negocioId];
  let idx = 2;

  const filtroUsuario = usuario_id   ? `AND a.usuario_id = $${idx++}` : '';
  if (usuario_id)   params.push(Number(usuario_id));

  const filtroDesde = fecha_desde ? `AND a.fecha >= $${idx++}` : '';
  if (fecha_desde)  params.push(fecha_desde);

  const filtroHasta = fecha_hasta
    ? `AND a.fecha <= ($${idx++}::date + interval '1 day' - interval '1 second')` : '';
  if (fecha_hasta)  params.push(fecha_hasta);

  const filtroTabla = tipo && TABLA_POR_TIPO[tipo]
    ? `AND a.tabla = $${idx++}` : '';
  if (tipo && TABLA_POR_TIPO[tipo]) params.push(TABLA_POR_TIPO[tipo]);

  const idxLimit  = idx++;
  const idxOffset = idx++;
  params.push(limit);
  params.push(offset);

  const base = `
    FROM auditoria a
    JOIN usuarios u ON u.id = a.usuario_id
    LEFT JOIN sucursales s
      ON s.id = NULLIF((a.detalle::jsonb->>'sucursal_id'), '')::int
    WHERE a.negocio_id = $1
      ${filtroUsuario}
      ${filtroDesde}
      ${filtroHasta}
      ${filtroTabla}
  `;

  const sql = `
    SELECT
      a.id, a.fecha, a.accion, a.tabla, a.registro_id,
      a.detalle::jsonb   AS detalle,
      u.id               AS usuario_id,
      u.nombre           AS usuario_nombre,
      u.rol              AS usuario_rol,
      COALESCE(s.nombre, a.detalle::jsonb->>'sucursal') AS sucursal_nombre
    ${base}
    ORDER BY a.fecha DESC
    LIMIT $${idxLimit} OFFSET $${idxOffset}
  `;

  const countSql = `SELECT COUNT(*) AS total ${base}`;

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
