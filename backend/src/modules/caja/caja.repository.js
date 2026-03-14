const { pool } = require('../../config/db');

const findCajaAbierta = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT c.*, u.nombre AS usuario_nombre
    FROM aperturas_caja c
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE c.sucursal_id = $1 AND c.estado = 'Abierta'
    ORDER BY c.fecha_apertura DESC
    LIMIT 1
  `, [sucursalId]);
  return rows[0] || null;
};

const findById = async (id) => {
  const { rows } = await pool.query(
    'SELECT * FROM aperturas_caja WHERE id = $1',
    [id]
  );
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.id FROM aperturas_caja c
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE c.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

const getMovimientos = async (cajaId) => {
  const { rows } = await pool.query(`
    SELECT m.*, u.nombre AS usuario_nombre
    FROM movimientos_caja m
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.caja_id = $1
    ORDER BY m.fecha ASC
  `, [cajaId]);
  return rows;
};

const abrirCaja = async ({ sucursal_id, usuario_id, monto_inicial }) => {
  const { rows } = await pool.query(`
    INSERT INTO aperturas_caja(sucursal_id, usuario_id, monto_inicial)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [sucursal_id, usuario_id, monto_inicial]);
  return rows[0];
};

const cerrarCaja = async (id, monto_cierre) => {
  const { rows } = await pool.query(`
    UPDATE aperturas_caja
    SET estado = 'Cerrada', fecha_cierre = NOW(), monto_cierre = $1
    WHERE id = $2
    RETURNING *
  `, [monto_cierre, id]);
  return rows[0];
};

const insertarMovimiento = async ({ caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo }) => {
  const { rows } = await pool.query(`
    INSERT INTO movimientos_caja(caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [caja_id, usuario_id, tipo, concepto, valor, referencia_id || null, referencia_tipo || null]);
  return rows[0];
};

const getResumenCaja = async (cajaId) => {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN valor ELSE 0 END), 0) AS total_ingresos,
      COALESCE(SUM(CASE WHEN tipo = 'Egreso'  THEN valor ELSE 0 END), 0) AS total_egresos,
      COUNT(*) AS total_movimientos
    FROM movimientos_caja
    WHERE caja_id = $1
  `, [cajaId]);
  return rows[0];
};

// ── Helpers internos ──────────────────────────────────────────────────────────

const _buildResumenDesdeDatos = ({ pf, ac, ap, cp, aa, mn }) => {
  const sum = (arr) => arr.reduce((s, r) => s + Number(r.valor), 0);

  const totalFacturas        = sum(pf);
  const totalAbonosCredito   = sum(ac);
  const totalAbonosPrestamo  = sum(ap);
  const totalCompras         = sum(cp);
  const totalAbonosAcreedor  = sum(aa);
  const totalManualesIngreso = mn.filter(m => m.tipo === 'Ingreso').reduce((s, m) => s + Number(m.valor), 0);
  const totalManualesEgreso  = mn.filter(m => m.tipo === 'Egreso').reduce((s, m) => s + Number(m.valor), 0);

  const totalIngresos = totalFacturas + totalAbonosCredito + totalAbonosPrestamo + totalManualesIngreso;
  const totalEgresos  = totalCompras + totalAbonosAcreedor + totalManualesEgreso;

  return {
    grupos: {
      facturas:       { tipo: 'Ingreso', label: 'Facturas del día',      items: pf, total: totalFacturas },
      abonosCredito:  { tipo: 'Ingreso', label: 'Abonos de créditos',    items: ac, total: totalAbonosCredito },
      abonosPrestamo: { tipo: 'Ingreso', label: 'Abonos de préstamos',   items: ap, total: totalAbonosPrestamo },
      compras:        { tipo: 'Egreso',  label: 'Compras a proveedores', items: cp, total: totalCompras },
      abonosAcreedor: { tipo: 'Egreso',  label: 'Abonos a acreedores',   items: aa, total: totalAbonosAcreedor },
      manuales:       { tipo: 'Mixto',   label: 'Movimientos manuales',  items: mn, totalIngreso: totalManualesIngreso, totalEgreso: totalManualesEgreso },
    },
    totales: {
      ingresos: totalIngresos,
      egresos:  totalEgresos,
      saldo:    totalIngresos - totalEgresos,
    },
  };
};

/**
 * Resumen del día para una sucursal específica.
 * Usa la fecha_apertura de la caja como referencia del día.
 */
const getResumenDia = async (cajaId, sucursalId, negocioId) => {
  const { rows: cajaRows } = await pool.query(
    'SELECT fecha_apertura FROM aperturas_caja WHERE id = $1',
    [cajaId]
  );
  const fechaApertura = cajaRows[0]?.fecha_apertura;
  if (!fechaApertura) return null;

  const diaInicio = new Date(fechaApertura); diaInicio.setHours(0, 0, 0, 0);
  const diaFin    = new Date(fechaApertura); diaFin.setHours(23, 59, 59, 999);

  const [pagosFactura, abonosCredito, abonosPrestamo, compras, abonosAcreedor, manuales] =
    await Promise.all([
      pool.query(`
        SELECT pf.id, pf.metodo, pf.valor, f.nombre_cliente, f.id AS factura_id, f.fecha
        FROM pagos_factura pf
        JOIN facturas f ON f.id = pf.factura_id
        WHERE f.sucursal_id = $1 AND f.estado != 'Cancelada'
          AND pf.metodo != 'Credito' AND f.fecha BETWEEN $2 AND $3
        ORDER BY f.fecha ASC
      `, [sucursalId, diaInicio, diaFin]),

      pool.query(`
        SELECT ac.id, ac.valor, ac.metodo, ac.fecha,
               f.nombre_cliente, c.id AS credito_id, f.id AS factura_id
        FROM abonos_credito ac
        JOIN creditos c ON c.id = ac.credito_id
        JOIN facturas f ON f.id = c.factura_id
        WHERE c.sucursal_id = $1 AND ac.fecha BETWEEN $2 AND $3
        ORDER BY ac.fecha ASC
      `, [sucursalId, diaInicio, diaFin]),

      pool.query(`
        SELECT ab.id, ab.valor, ab.fecha, p.prestatario, p.id AS prestamo_id
        FROM abonos_prestamo ab
        JOIN prestamos p ON p.id = ab.prestamo_id
        WHERE p.sucursal_id = $1 AND ab.fecha BETWEEN $2 AND $3
        ORDER BY ab.fecha ASC
      `, [sucursalId, diaInicio, diaFin]),

      pool.query(`
        SELECT c.id, c.total AS valor, c.fecha, c.numero_factura, pr.nombre AS proveedor
        FROM compras c
        LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
        WHERE c.sucursal_id = $1 AND c.estado != 'Cancelada'
          AND c.fecha BETWEEN $2 AND $3
        ORDER BY c.fecha ASC
      `, [sucursalId, diaInicio, diaFin]),

      // FIX: acreedores son del negocio — filtrar por negocio_id directo, sin JOIN a sucursales
      pool.query(`
        SELECT ma.id, ma.valor, ma.fecha, ma.descripcion, a.nombre AS acreedor
        FROM movimientos_acreedor ma
        JOIN acreedores a ON a.id = ma.acreedor_id
        WHERE ma.tipo = 'Abono'
          AND a.negocio_id = $1
          AND ma.fecha BETWEEN $2 AND $3
      `, [negocioId, diaInicio, diaFin]),

      pool.query(`
        SELECT m.*, u.nombre AS usuario_nombre
        FROM movimientos_caja m
        LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.caja_id = $1
        ORDER BY m.fecha ASC
      `, [cajaId]),
    ]);

  return _buildResumenDesdeDatos({
    pf: pagosFactura.rows,
    ac: abonosCredito.rows,
    ap: abonosPrestamo.rows,
    cp: compras.rows,
    aa: abonosAcreedor.rows,
    mn: manuales.rows,
  });
};

/**
 * Resumen global del día para todas las sucursales del negocio.
 * Solo para admin_negocio en vista general.
 * Usa la fecha actual como referencia.
 */
const getResumenGlobal = async (negocioId) => {
  const hoy       = new Date();
  const diaInicio = new Date(hoy); diaInicio.setHours(0, 0, 0, 0);
  const diaFin    = new Date(hoy); diaFin.setHours(23, 59, 59, 999);

  const [pagosFactura, abonosCredito, abonosPrestamo, compras, abonosAcreedor, manuales] =
    await Promise.all([
      pool.query(`
        SELECT pf.id, pf.metodo, pf.valor, f.nombre_cliente,
               f.id AS factura_id, f.fecha, su.nombre AS sucursal_nombre
        FROM pagos_factura pf
        JOIN facturas   f  ON f.id  = pf.factura_id
        JOIN sucursales su ON su.id = f.sucursal_id
        WHERE su.negocio_id = $1 AND f.estado != 'Cancelada'
          AND pf.metodo != 'Credito' AND f.fecha BETWEEN $2 AND $3
        ORDER BY f.fecha ASC
      `, [negocioId, diaInicio, diaFin]),

      pool.query(`
        SELECT ac.id, ac.valor, ac.metodo, ac.fecha,
               f.nombre_cliente, c.id AS credito_id, f.id AS factura_id,
               su.nombre AS sucursal_nombre
        FROM abonos_credito ac
        JOIN creditos   c  ON c.id  = ac.credito_id
        JOIN facturas   f  ON f.id  = c.factura_id
        JOIN sucursales su ON su.id = c.sucursal_id
        WHERE su.negocio_id = $1 AND ac.fecha BETWEEN $2 AND $3
        ORDER BY ac.fecha ASC
      `, [negocioId, diaInicio, diaFin]),

      pool.query(`
        SELECT ab.id, ab.valor, ab.fecha, p.prestatario, p.id AS prestamo_id,
               su.nombre AS sucursal_nombre
        FROM abonos_prestamo ab
        JOIN prestamos  p  ON p.id  = ab.prestamo_id
        JOIN sucursales su ON su.id = p.sucursal_id
        WHERE su.negocio_id = $1 AND ab.fecha BETWEEN $2 AND $3
        ORDER BY ab.fecha ASC
      `, [negocioId, diaInicio, diaFin]),

      pool.query(`
        SELECT c.id, c.total AS valor, c.fecha, c.numero_factura,
               pr.nombre AS proveedor, su.nombre AS sucursal_nombre
        FROM compras c
        JOIN  sucursales  su ON su.id = c.sucursal_id
        LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
        WHERE su.negocio_id = $1 AND c.estado != 'Cancelada'
          AND c.fecha BETWEEN $2 AND $3
        ORDER BY c.fecha ASC
      `, [negocioId, diaInicio, diaFin]),

      pool.query(`
        SELECT ma.id, ma.valor, ma.fecha, ma.descripcion, a.nombre AS acreedor
        FROM movimientos_acreedor ma
        JOIN acreedores a ON a.id = ma.acreedor_id
        WHERE ma.tipo = 'Abono'
          AND a.negocio_id = $1
          AND ma.fecha BETWEEN $2 AND $3
      `, [negocioId, diaInicio, diaFin]),

      pool.query(`
        SELECT m.*, u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
        FROM movimientos_caja m
        JOIN aperturas_caja ac ON ac.id = m.caja_id
        JOIN sucursales     su ON su.id = ac.sucursal_id
        LEFT JOIN usuarios   u ON u.id  = m.usuario_id
        WHERE su.negocio_id = $1
          AND m.fecha BETWEEN $2 AND $3
        ORDER BY m.fecha ASC
      `, [negocioId, diaInicio, diaFin]),
    ]);

  return _buildResumenDesdeDatos({
    pf: pagosFactura.rows,
    ac: abonosCredito.rows,
    ap: abonosPrestamo.rows,
    cp: compras.rows,
    aa: abonosAcreedor.rows,
    mn: manuales.rows,
  });
};
const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.*, u.nombre AS usuario_nombre
    FROM aperturas_caja c
    JOIN sucursales s      ON s.id = c.sucursal_id
    LEFT JOIN usuarios u   ON u.id = c.usuario_id
    WHERE c.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

// También agregar al módulo exports
module.exports = {
  findCajaAbierta, findById, findByIdYNegocio,   // ← agregar findByIdYNegocio
  perteneceAlNegocio,                             // ← mantener por compatibilidad
  getMovimientos, abrirCaja, cerrarCaja,
  insertarMovimiento, getResumenCaja,
  getResumenDia, getResumenGlobal,
};

