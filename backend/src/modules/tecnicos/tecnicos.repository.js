// ─────────────────────────────────────────────────────────────────────────────
// TÉCNICOS EXTERNOS — consultas. Ver migrations/20260918_tecnicos_externos.sql.
//
// Todas las consultas reciben el `negocio_id` y lo exigen en el WHERE: la base
// es compartida por 28 negocios y un id de otro negocio no puede resolver nada.
// Las que escriben reciben el `client` de la transacción del service.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../config/db');

// La fecha de vencimiento de la garantía se calcula AQUÍ y sale como texto:
// fecha_regreso es TIMESTAMP en hora de Bogotá, y sumar días en JavaScript
// sobre el Date que devuelve node-postgres corre el día (ver CLAUDE.md).
const COLS_EQUIPO = `
  e.id, e.salida_id, e.negocio_id, e.sucursal_id, e.tecnico_id, e.serial_id,
  e.imei, e.descripcion_equipo, e.trabajo, e.origen, e.estado,
  e.fecha_regreso, e.costo, e.garantia_dias, e.reclamo_de_id,
  e.costo_aplicado_a, e.costo_serial_anterior, e.costo_serial_nuevo,
  e.precio_anterior, e.precio_nuevo, e.factura_cargo_id, e.orden_servicio_id,
  e.notas_regreso, e.anulado_motivo,
  CASE WHEN e.estado = 'Reparado' AND e.garantia_dias IS NOT NULL
       THEN to_char(e.fecha_regreso::date + e.garantia_dias, 'YYYY-MM-DD')
  END AS garantia_hasta,
  CASE WHEN e.estado = 'Reparado' AND e.garantia_dias IS NOT NULL
       THEN (e.fecha_regreso::date + e.garantia_dias) >= (NOW() AT TIME ZONE 'America/Bogota')::date
       ELSE FALSE
  END AS en_garantia,
  CASE WHEN e.estado = 'En_tecnico'
       THEN ((NOW() AT TIME ZONE 'America/Bogota')::date - s.fecha::date)
  END AS dias_fuera,
  s.fecha                         AS fecha_salida,
  COALESCE(s.numero, s.id)        AS salida_numero,
  t.nombre                        AS tecnico_nombre,
  su.nombre                       AS sucursal_nombre,
  EXISTS (SELECT 1 FROM equipos_tecnico r
          WHERE r.reclamo_de_id = e.id AND r.estado <> 'Anulado') AS tiene_reclamo`;

const FROM_EQUIPO = `
  FROM equipos_tecnico e
  JOIN salidas_tecnico s ON s.id = e.salida_id
  JOIN tecnicos        t ON t.id = e.tecnico_id
  LEFT JOIN sucursales su ON su.id = e.sucursal_id`;

// ── Técnicos ─────────────────────────────────────────────────────────────────

const listarTecnicos = async (negocioId, { incluirInactivos = false } = {}) => {
  const { rows } = await pool.query(`
    SELECT t.*
    FROM tecnicos t
    WHERE t.negocio_id = $1 AND ($2::boolean OR t.activo)
    ORDER BY t.activo DESC, LOWER(t.nombre)
  `, [negocioId, incluirInactivos]);
  return rows;
};

const findTecnico = async (negocioId, id, client = pool) => {
  const { rows } = await client.query(
    'SELECT * FROM tecnicos WHERE id = $1 AND negocio_id = $2', [id, negocioId]);
  return rows[0] || null;
};

const crearTecnico = async (negocioId, d) => {
  const { rows } = await pool.query(`
    INSERT INTO tecnicos (negocio_id, nombre, telefono, cedula, especialidad, garantia_dias_default, notas)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [negocioId, d.nombre, d.telefono, d.cedula, d.especialidad, d.garantia_dias_default, d.notas]);
  return rows[0];
};

const actualizarTecnico = async (negocioId, id, d) => {
  const { rows } = await pool.query(`
    UPDATE tecnicos
    SET nombre = $3, telefono = $4, cedula = $5, especialidad = $6,
        garantia_dias_default = $7, notas = $8, activo = $9
    WHERE id = $1 AND negocio_id = $2
    RETURNING *
  `, [id, negocioId, d.nombre, d.telefono, d.cedula, d.especialidad,
      d.garantia_dias_default, d.notas, d.activo]);
  return rows[0] || null;
};

// ── Equipos y pagos (la materia prima de la cuenta) ──────────────────────────

const equiposDeTecnicos = async (negocioId, tecnicoIds = null) => {
  const { rows } = await pool.query(`
    SELECT ${COLS_EQUIPO}
    ${FROM_EQUIPO}
    WHERE e.negocio_id = $1
      AND ($2::int[] IS NULL OR e.tecnico_id = ANY($2::int[]))
    ORDER BY s.fecha DESC, e.id DESC
  `, [negocioId, tecnicoIds]);
  return rows;
};

const pagosDeTecnicos = async (negocioId, tecnicoIds = null, client = pool) => {
  const { rows } = await client.query(`
    SELECT p.*, u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre,
           COALESCE(s.numero, s.id) AS salida_numero,
           ua.nombre AS anulado_por_nombre
    FROM pagos_tecnico p
    LEFT JOIN usuarios        u  ON u.id  = p.usuario_id
    LEFT JOIN usuarios        ua ON ua.id = p.anulado_por
    LEFT JOIN sucursales      su ON su.id = p.sucursal_id
    LEFT JOIN salidas_tecnico s  ON s.id  = p.salida_id
    WHERE p.negocio_id = $1
      AND ($2::int[] IS NULL OR p.tecnico_id = ANY($2::int[]))
    ORDER BY p.fecha ASC, p.id ASC
  `, [negocioId, tecnicoIds]);
  return rows;
};

// La versión mínima para VALIDAR dentro de la transacción: solo lo que entra
// en el saldo, leído con el mismo client que va a escribir.
const materiaCuenta = async (client, negocioId, tecnicoId) => {
  const [{ rows: equipos }, { rows: pagos }] = await Promise.all([
    client.query(`
      SELECT id, salida_id, estado, costo, fecha_regreso
      FROM equipos_tecnico WHERE negocio_id = $1 AND tecnico_id = $2
    `, [negocioId, tecnicoId]),
    client.query(`
      SELECT id, tipo, valor, salida_id, anulado, fecha
      FROM pagos_tecnico WHERE negocio_id = $1 AND tecnico_id = $2
      ORDER BY fecha, id
    `, [negocioId, tecnicoId]),
  ]);
  return { equipos, pagos };
};

const listarEquipos = async (negocioId, { sucursalId = null, estado = null, tecnicoId = null,
  busqueda = null, ordenServicioId = null, serialId = null } = {}) => {
  const params = [negocioId];
  let where = 'e.negocio_id = $1';
  if (sucursalId)      where += ` AND e.sucursal_id = $${params.push(sucursalId)}`;
  if (estado)          where += ` AND e.estado = $${params.push(estado)}`;
  if (tecnicoId)       where += ` AND e.tecnico_id = $${params.push(tecnicoId)}`;
  if (ordenServicioId) where += ` AND e.orden_servicio_id = $${params.push(ordenServicioId)}`;
  if (serialId)        where += ` AND e.serial_id = $${params.push(serialId)}`;
  if (busqueda) {
    const n = params.push(`%${String(busqueda).toLowerCase().slice(0, 100)}%`);
    where += ` AND (LOWER(e.imei) LIKE $${n} OR LOWER(e.descripcion_equipo) LIKE $${n}
                    OR LOWER(e.trabajo) LIKE $${n} OR LOWER(t.nombre) LIKE $${n})`;
  }
  const { rows } = await pool.query(`
    SELECT ${COLS_EQUIPO}
    ${FROM_EQUIPO}
    WHERE ${where}
    ORDER BY (e.estado = 'En_tecnico') DESC, s.fecha DESC, e.id DESC
    LIMIT 500
  `, params);
  return rows;
};

const findEquipo = async (client, negocioId, id, { bloquear = false } = {}) => {
  const { rows } = await client.query(`
    SELECT e.*, COALESCE(s.numero, s.id) AS salida_numero, s.fecha AS fecha_salida,
           CASE WHEN e.estado = 'Reparado' AND e.garantia_dias IS NOT NULL
                THEN (e.fecha_regreso::date + e.garantia_dias) >= (NOW() AT TIME ZONE 'America/Bogota')::date
                ELSE FALSE END AS en_garantia,
           CASE WHEN e.estado = 'Reparado' AND e.garantia_dias IS NOT NULL
                THEN to_char(e.fecha_regreso::date + e.garantia_dias, 'YYYY-MM-DD') END AS garantia_hasta
    FROM equipos_tecnico e
    JOIN salidas_tecnico s ON s.id = e.salida_id
    WHERE e.id = $1 AND e.negocio_id = $2
    ${bloquear ? 'FOR UPDATE OF e' : ''}
  `, [id, negocioId]);
  return rows[0] || null;
};

// ── Seriales ─────────────────────────────────────────────────────────────────

// El serial con su referencia, bloqueado: entre validar y escribir nadie más
// puede venderlo ni mandarlo a otro técnico.
const serialParaEnviar = async (client, negocioId, serialId) => {
  const { rows } = await client.query(`
    SELECT s.id, s.imei, s.vendido, s.prestado, s.costo_compra, s.precio,
           ps.id AS producto_id, ps.nombre AS producto_nombre, ps.sucursal_id
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales su       ON su.id = ps.sucursal_id
    WHERE s.id = $1 AND su.negocio_id = $2
    FOR UPDATE OF s
  `, [serialId, negocioId]);
  return rows[0] || null;
};

const enRemisionActiva = async (client, serialId) => {
  const { rows } = await client.query(`
    SELECT 1 FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE lr.serial_id = $1 AND lr.estado_linea = 'Pendiente' AND r.estado = 'En transito'
    LIMIT 1
  `, [serialId]);
  return rows.length > 0;
};

// Equipos disponibles para mandar: sin vender, sin prestar y sin estar ya
// donde un técnico. Tope bajo: es un buscador, no un listado.
const buscarSerialesDisponibles = async (negocioId, sucursalId, q) => {
  const texto = `%${String(q || '').toLowerCase().slice(0, 100)}%`;
  const { rows } = await pool.query(`
    SELECT s.id, s.imei, s.color, ps.nombre AS producto_nombre, ps.sucursal_id
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales su       ON su.id = ps.sucursal_id
    WHERE su.negocio_id = $1 AND ps.sucursal_id = $2
      AND s.vendido = FALSE AND s.prestado = FALSE
      AND (LOWER(s.imei) LIKE $3 OR LOWER(ps.nombre) LIKE $3)
      AND NOT EXISTS (SELECT 1 FROM equipos_tecnico e
                      WHERE e.serial_id = s.id AND e.estado = 'En_tecnico')
    ORDER BY ps.nombre, s.imei
    LIMIT 30
  `, [negocioId, sucursalId, texto]);
  return rows;
};

// ¿Está este serial CONSIGNADO en su sucursal (llegó de la bodega por una
// remisión y no se ha vendido)? Misma regla que sqlValorInternoEnStock: ahí su
// costo es el valor interno y costo_compra es la verdad de la bodega.
const esConsignado = async (client, serialId, sucursalId) => {
  const { rows } = await client.query(`
    SELECT 1
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE lr.serial_id = $1
      AND r.sucursal_destino_id = $2
      AND r.tipo = 'entrega' AND r.estado <> 'Anulada'
      AND lr.estado_linea = 'Recibida' AND lr.valor_interno IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM lineas_factura lf JOIN facturas f ON f.id = lf.factura_id
        WHERE UPPER(TRIM(lf.imei)) = UPPER(TRIM(lr.imei))
          AND f.sucursal_id = r.sucursal_destino_id
          AND f.estado <> 'Cancelada' AND f.fecha >= r.fecha_emision)
    LIMIT 1
  `, [serialId, sucursalId]);
  return rows.length > 0;
};

// La venta más reciente de ese IMEI en el negocio: a ella se le carga la
// reparación si el usuario lo decide.
const ultimaFacturaDeImei = async (client, negocioId, imei) => {
  const { rows } = await client.query(`
    SELECT f.id, f.numero, f.fecha, f.nombre_cliente
    FROM lineas_factura lf
    JOIN facturas f    ON f.id = lf.factura_id
    JOIN sucursales su ON su.id = f.sucursal_id
    WHERE su.negocio_id = $1 AND f.estado <> 'Cancelada'
      AND UPPER(TRIM(lf.imei)) = UPPER(TRIM($2))
    ORDER BY f.fecha DESC, f.id DESC
    LIMIT 1
  `, [negocioId, imei]);
  return rows[0] || null;
};

// Para la orden de un cliente: la fila VENDIDA de ese IMEI en el negocio. Solo
// la vendida: si el IMEI coincide con un equipo disponible del inventario, esa
// orden no habla de él y bloquearlo sería sorprender a quien lo va a vender.
const serialVendidoPorImei = async (client, negocioId, imei) => {
  const { rows } = await client.query(`
    SELECT s.id, s.imei, ps.nombre AS producto_nombre, ps.sucursal_id
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales su       ON su.id = ps.sucursal_id
    WHERE su.negocio_id = $1 AND s.vendido = TRUE
      AND UPPER(TRIM(s.imei)) = UPPER(TRIM($2))
    ORDER BY s.fecha_salida DESC NULLS LAST, s.id DESC
    LIMIT 1
    FOR UPDATE OF s
  `, [negocioId, imei]);
  return rows[0] || null;
};

// ── Resumen por período (para Reportes) ──────────────────────────────────────

const resumenPeriodo = async (negocioId, sucursalId, desde, hasta) => {
  const params = [negocioId, desde, hasta];
  const filtroSuc = sucursalId ? `AND sucursal_id = $${params.push(sucursalId)}` : '';
  const [{ rows: [costos] }, { rows: [pagos] }] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'Reparado')::int     AS reparados,
        COUNT(*) FILTER (WHERE estado = 'Sin_reparar')::int  AS sin_reparar,
        COUNT(*) FILTER (WHERE reclamo_de_id IS NOT NULL)::int AS reclamos,
        COALESCE(SUM(costo) FILTER (WHERE costo_aplicado_a IN ('costo_compra', 'valor_interno')), 0) AS a_inventario,
        COALESCE(SUM(costo) FILTER (WHERE costo_aplicado_a = 'venta'), 0) AS a_ventas,
        COALESCE(SUM(costo) FILTER (WHERE costo_aplicado_a = 'orden'), 0) AS a_ordenes,
        COALESCE(SUM(costo), 0) AS total
      FROM equipos_tecnico
      WHERE negocio_id = $1 AND estado IN ('Reparado', 'Sin_reparar')
        AND fecha_regreso::date BETWEEN $2::date AND $3::date
        ${filtroSuc}
    `, params),
    pool.query(`
      SELECT
        COALESCE(SUM(valor) FILTER (WHERE tipo IN ('Anticipo', 'Pago')), 0) AS pagado,
        COALESCE(SUM(valor) FILTER (WHERE tipo = 'Devolucion'), 0)         AS devuelto
      FROM pagos_tecnico
      WHERE negocio_id = $1 AND NOT anulado
        AND fecha::date BETWEEN $2::date AND $3::date
        ${filtroSuc}
    `, params),
  ]);
  return { ...costos, ...pagos };
};

module.exports = {
  listarTecnicos, findTecnico, crearTecnico, actualizarTecnico,
  equiposDeTecnicos, pagosDeTecnicos, materiaCuenta,
  listarEquipos, findEquipo,
  serialParaEnviar, enRemisionActiva, buscarSerialesDisponibles, esConsignado,
  ultimaFacturaDeImei, serialVendidoPorImei,
  resumenPeriodo,
};
