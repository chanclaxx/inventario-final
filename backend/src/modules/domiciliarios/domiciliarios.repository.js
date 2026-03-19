const { pool } = require('../../config/db');

// ── findAll ───────────────────────────────────────────────────────────────────
// Solo devuelve domiciliarios del negocio autenticado.

const findAll = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, telefono, activo, creado_en
     FROM domiciliarios
     WHERE negocio_id = $1
     ORDER BY nombre ASC`,
    [negocioId]
  );
  return rows;
};

// ── findById ──────────────────────────────────────────────────────────────────
// Valida negocio_id para impedir lectura cruzada entre negocios.

const findById = async (id, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, telefono, activo, creado_en
     FROM domiciliarios
     WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

// ── create ────────────────────────────────────────────────────────────────────

const create = async (client, { negocioId, nombre, telefono }) => {
  const { rows } = await client.query(
    `INSERT INTO domiciliarios(negocio_id, nombre, telefono)
     VALUES ($1, $2, $3)
     RETURNING id, nombre, telefono, activo, creado_en`,
    [negocioId, nombre, telefono || null]
  );
  return rows[0];
};

// ── update ────────────────────────────────────────────────────────────────────

const update = async (id, negocioId, { nombre, telefono, activo }) => {
  const { rows } = await pool.query(
    `UPDATE domiciliarios
     SET nombre = COALESCE($1, nombre),
         telefono = COALESCE($2, telefono),
         activo = COALESCE($3, activo)
     WHERE id = $4 AND negocio_id = $5
     RETURNING id, nombre, telefono, activo, creado_en`,
    [nombre || null, telefono || null, activo ?? null, id, negocioId]
  );
  return rows[0] || null;
};

// ── findEntregaById ───────────────────────────────────────────────────────────
// Incluye negocio_id en el WHERE para seguridad.

const findEntregaById = async (id, negocioId) => {
  const { rows } = await pool.query(
    `SELECT e.*,
            d.nombre  AS domiciliario_nombre,
            d.telefono AS domiciliario_telefono,
            f.nombre_cliente,
            f.celular AS cliente_celular,
            f.cedula  AS cliente_cedula,
            u.nombre  AS usuario_nombre
     FROM entregas_domicilio e
     JOIN domiciliarios d ON d.id = e.domiciliario_id
     JOIN facturas      f ON f.id = e.factura_id
     LEFT JOIN usuarios u ON u.id = e.usuario_id
     WHERE e.id = $1 AND e.negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

// ── findEntregaByFacturaId ────────────────────────────────────────────────────

const findEntregaByFacturaId = async (facturaId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT e.*,
            d.nombre  AS domiciliario_nombre,
            d.telefono AS domiciliario_telefono
     FROM entregas_domicilio e
     JOIN domiciliarios d ON d.id = e.domiciliario_id
     WHERE e.factura_id = $1 AND e.negocio_id = $2`,
    [facturaId, negocioId]
  );
  return rows[0] || null;
};

// ── findAllEntregas ───────────────────────────────────────────────────────────
// Vista de todas las entregas del negocio con filtro opcional por domiciliario.

const findAllEntregas = async (negocioId, { domiciliarioId, estado } = {}) => {
  const condiciones = ['e.negocio_id = $1'];
  const params = [negocioId];

  if (domiciliarioId) {
    params.push(domiciliarioId);
    condiciones.push(`e.domiciliario_id = $${params.length}`);
  }
  if (estado) {
    params.push(estado);
    condiciones.push(`e.estado = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT e.*,
            d.nombre  AS domiciliario_nombre,
            d.telefono AS domiciliario_telefono,
            f.nombre_cliente,
            f.celular AS cliente_celular,
            f.cedula  AS cliente_cedula,
            COALESCE(SUM(lf.subtotal), 0) AS subtotal_factura
     FROM entregas_domicilio e
     JOIN domiciliarios    d  ON d.id = e.domiciliario_id
     JOIN facturas         f  ON f.id = e.factura_id
     LEFT JOIN lineas_factura lf ON lf.factura_id = f.id
     WHERE ${condiciones.join(' AND ')}
     GROUP BY e.id, d.nombre, d.telefono, f.nombre_cliente, f.celular, f.cedula
     ORDER BY e.fecha_asignacion DESC`,
    params
  );
  return rows;
};

// ── createEntrega ─────────────────────────────────────────────────────────────
// Recibe un client de transacción porque se llama desde crearFactura().

const createEntrega = async (client, {
  facturaId, domiciliarioId, negocioId, usuarioId,
  valorTotal, direccionEntrega, notas,
}) => {
  const { rows } = await client.query(
    `INSERT INTO entregas_domicilio
       (factura_id, domiciliario_id, negocio_id, usuario_id,
        valor_total, direccion_entrega, notas)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      facturaId, domiciliarioId, negocioId, usuarioId || null,
      valorTotal, direccionEntrega || null, notas || null,
    ]
  );
  return rows[0];
};

// ── getAbonos ─────────────────────────────────────────────────────────────────

const getAbonos = async (entregaId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT a.*, u.nombre AS usuario_nombre
     FROM abonos_domicilio a
     LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.entrega_id = $1 AND a.negocio_id = $2
     ORDER BY a.fecha ASC`,
    [entregaId, negocioId]
  );
  return rows;
};

// ── registrarAbono ────────────────────────────────────────────────────────────
// Dentro de una transacción:
//   1. Inserta el abono.
//   2. Actualiza total_abonado en entregas_domicilio.
//   3. Si total_abonado >= valor_total, cambia estado a Entregado y fija fecha_entrega.
// Devuelve la entrega actualizada.

const registrarAbono = async (client, { entregaId, negocioId, usuarioId, valor, notas }) => {
  await client.query(
    `INSERT INTO abonos_domicilio(entrega_id, negocio_id, usuario_id, valor, notas)
     VALUES ($1, $2, $3, $4, $5)`,
    [entregaId, negocioId, usuarioId || null, valor, notas || null]
  );

  const { rows } = await client.query(
    `UPDATE entregas_domicilio
     SET total_abonado = total_abonado + $1,
         estado = CASE
           WHEN (total_abonado + $1) >= valor_total THEN 'Entregado'::estado_entrega
           ELSE estado
         END,
         fecha_entrega = CASE
           WHEN (total_abonado + $1) >= valor_total AND fecha_entrega IS NULL
             THEN now()
           ELSE fecha_entrega
         END
     WHERE id = $2 AND negocio_id = $3
     RETURNING *`,
    [valor, entregaId, negocioId]
  );
  return rows[0] || null;
};

// ── marcarNoEntregado ─────────────────────────────────────────────────────────
// Solo cambia el estado — la reversión de stock la hace facturas.service.

const marcarNoEntregado = async (client, entregaId, negocioId) => {
  const { rows } = await client.query(
    `UPDATE entregas_domicilio
     SET estado = 'No_entregado'::estado_entrega,
         fecha_entrega = now()
     WHERE id = $1 AND negocio_id = $2
     RETURNING *`,
    [entregaId, negocioId]
  );
  return rows[0] || null;
};

module.exports = {
  findAll,
  findById,
  create,
  update,
  findEntregaById,
  findEntregaByFacturaId,
  findAllEntregas,
  createEntrega,
  getAbonos,
  registrarAbono,
  marcarNoEntregado,
};