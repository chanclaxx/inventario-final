const { pool } = require('../../config/db');

// ─── Queries básicas ──────────────────────────────────────────────────────────

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

const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.*, u.nombre AS usuario_nombre
    FROM aperturas_caja c
    JOIN      sucursales s ON s.id = c.sucursal_id
    LEFT JOIN usuarios   u ON u.id = c.usuario_id
    WHERE c.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
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

const insertarMovimiento = async ({
  caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo,
}) => {
  const { rows } = await pool.query(`
    INSERT INTO movimientos_caja(caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [caja_id, usuario_id, tipo, concepto, valor, referencia_id || null, referencia_tipo || null]);
  return rows[0];
};

const toggleMovimiento = async (movimientoId, negocioId) => {
  const { rows: check } = await pool.query(`
    SELECT m.id, m.activo
    FROM movimientos_caja m
    JOIN aperturas_caja   ac ON ac.id = m.caja_id
    JOIN sucursales       su ON su.id = ac.sucursal_id
    WHERE m.id = $1 AND su.negocio_id = $2
  `, [movimientoId, negocioId]);

  if (!check.length) throw { status: 404, message: 'Movimiento no encontrado' };

  const nuevoEstado = !check[0].activo;
  const { rows } = await pool.query(
    'UPDATE movimientos_caja SET activo = $1 WHERE id = $2 RETURNING *',
    [nuevoEstado, movimientoId]
  );
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

// ─── _buildResumen ────────────────────────────────────────────────────────────

const _buildResumen = ({ pf, ac, ap, cp, aa, mn, rt, dv, ad, sv }) => {
  const sum = (arr) => arr
    .filter((r) => r.activo !== false)
    .reduce((s, r) => s + Number(r.valor || 0), 0);

  const totalFacturas          = sum(pf);
  const totalAbonosCredito     = sum(ac);
  const totalAbonosPrestamo    = sum(ap);
  const totalCompras           = sum(cp);
  const totalAbonosAcreedor    = sum(aa);
  const totalRetomas           = sum(rt);
  const totalAbonosServicio    = sum(sv);
  const totalDevoluciones      = dv
    .filter((d) => d.activo !== false)
    .reduce((s, d) => s + Number(d.valor || 0), 0);

  const totalManualesIngreso = mn
    .filter((m) => m.activo !== false && m.tipo === 'Ingreso')
    .reduce((s, m) => s + Number(m.valor || 0), 0);
  const totalManualesEgreso = mn
    .filter((m) => m.activo !== false && m.tipo === 'Egreso')
    .reduce((s, m) => s + Number(m.valor || 0), 0);

  const totalAbonosDomicilio = sum(ad);

  const totalIngresosBruto = totalFacturas + totalAbonosCredito + totalAbonosPrestamo
    + totalAbonosDomicilio + totalAbonosServicio + totalManualesIngreso;
  const totalIngresos      = totalIngresosBruto - totalRetomas;
  const totalEgresos       = totalCompras + totalAbonosAcreedor + totalManualesEgreso + totalDevoluciones;

  const METODOS = ['Efectivo', 'Nequi', 'Daviplata', 'Transferencia', 'Tarjeta'];
  const metodosPago = {};
  for (const metodo of METODOS) {
    const totalMetodo =
      pf.filter((p) => p.metodo === metodo).reduce((s, p) => s + Number(p.valor || 0), 0) +
      ac.filter((a) => a.metodo === metodo).reduce((s, a) => s + Number(a.valor || 0), 0);
    if (totalMetodo > 0) metodosPago[metodo] = totalMetodo;
  }

  return {
    grupos: {
      facturas: {
        tipo:  'Ingreso',
        label: 'Facturas del día',
        items: pf,
        total: totalFacturas,
      },
      abonosCredito: {
        tipo:  'Ingreso',
        label: 'Abonos de créditos',
        items: ac,
        total: totalAbonosCredito,
      },
      abonosPrestamo: {
        tipo:  'Ingreso',
        label: 'Abonos de préstamos',
        items: ap,
        total: totalAbonosPrestamo,
      },
      abonosServicio: {
        tipo:  'Ingreso',
        label: 'Servicio técnico',
        items: sv,
        total: totalAbonosServicio,
      },
      abonosDomicilio: {
        tipo:  'Ingreso',
        label: 'Abonos domiciliarios',
        items: ad,
        total: totalAbonosDomicilio,
      },
      retomas: {
        tipo:  'Egreso',
        label: 'Retomas',
        items: rt,
        total: totalRetomas,
      },
      compras: {
        tipo:  'Egreso',
        label: 'Compras a proveedores',
        items: cp,
        total: totalCompras,
      },
      abonosAcreedor: {
        tipo:  'Egreso',
        label: 'Abonos a acreedores',
        items: aa,
        total: totalAbonosAcreedor,
      },
      devoluciones: {
        tipo:  'Egreso',
        label: 'Devoluciones por cancelación',
        items: dv,
        total: totalDevoluciones,
      },
      manuales: {
        tipo:         'Mixto',
        label:        'Movimientos manuales',
        items:        mn,
        totalIngreso: totalManualesIngreso,
        totalEgreso:  totalManualesEgreso,
      },
    },
    metodosPago,
    totales: {
      ingresosBruto: totalIngresosBruto,
      retomas:       totalRetomas,
      ingresos:      totalIngresos,
      egresos:       totalEgresos,
      saldo:         totalIngresos - totalEgresos,
    },
  };
};

// ─── Helper rango ─────────────────────────────────────────────────────────────

const _getRangoCaja = async (cajaId) => {
  const { rows } = await pool.query(
    'SELECT fecha_apertura, fecha_cierre, estado FROM aperturas_caja WHERE id = $1',
    [cajaId]
  );
  const caja = rows[0];
  if (!caja) return null;
  return {
    inicio: caja.fecha_apertura,
    fin:    caja.estado === 'Cerrada' && caja.fecha_cierre ? caja.fecha_cierre : new Date(),
  };
};

// ─── getResumenDia ────────────────────────────────────────────────────────────

const getResumenDia = async (cajaId, sucursalId, negocioId) => {
  const rango = await _getRangoCaja(cajaId);
  if (!rango) return null;
  const { inicio, fin } = rango;

  const [pf, ac, ap, cp, aa, mn, dv, rt, ad, sv] = await Promise.all([

    pool.query(`
      SELECT pf.id, pf.metodo, pf.valor, f.nombre_cliente, f.id AS factura_id, f.fecha
      FROM pagos_factura pf
      JOIN facturas f ON f.id = pf.factura_id
      WHERE f.sucursal_id = $1
        AND f.estado != 'Cancelada'
        AND pf.metodo != 'Credito'
        AND f.fecha BETWEEN $2 AND $3
        AND NOT EXISTS (
          SELECT 1 FROM entregas_domicilio ed
          WHERE ed.factura_id = f.id AND ed.estado = 'Pendiente'
        )
      ORDER BY f.fecha ASC
    `, [sucursalId, inicio, fin]),

    pool.query(`
      SELECT ac.id, ac.valor, ac.metodo, ac.fecha,
             f.nombre_cliente, c.id AS credito_id, f.id AS factura_id
      FROM abonos_credito ac
      JOIN creditos c ON c.id = ac.credito_id
      JOIN facturas f ON f.id = c.factura_id
      WHERE c.sucursal_id = $1 AND ac.fecha BETWEEN $2 AND $3
      ORDER BY ac.fecha ASC
    `, [sucursalId, inicio, fin]),

    pool.query(`
      SELECT ab.id, ab.valor, ab.fecha, p.prestatario, p.id AS prestamo_id
      FROM abonos_prestamo ab
      JOIN prestamos p ON p.id = ab.prestamo_id
      WHERE p.sucursal_id = $1 AND ab.fecha BETWEEN $2 AND $3
      ORDER BY ab.fecha ASC
    `, [sucursalId, inicio, fin]),

    // Compras: solo las marcadas como registrar_en_caja = TRUE
    pool.query(`
      SELECT c.id, c.total AS valor, c.fecha, c.numero_factura, pr.nombre AS proveedor
      FROM compras c
      LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
      WHERE c.sucursal_id = $1
        AND c.estado != 'Cancelada'
        AND c.fecha BETWEEN $2 AND $3
        AND c.registrar_en_caja = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM movimientos_acreedor ma
          WHERE ma.compra_id = c.id AND ma.tipo = 'Cargo' AND ma.valor >= c.total
        )
      ORDER BY c.fecha ASC
    `, [sucursalId, inicio, fin]),

    pool.query(`
      SELECT ma.id, ma.valor, ma.fecha, ma.descripcion, a.nombre AS acreedor
      FROM movimientos_acreedor ma
      JOIN acreedores a ON a.id = ma.acreedor_id
      WHERE ma.tipo = 'Abono' AND a.negocio_id = $1 AND ma.fecha BETWEEN $2 AND $3
        AND ma.registrar_en_caja = TRUE
    `, [negocioId, inicio, fin]),

    // Manuales: excluir tipos con grupo propio
    pool.query(`
      SELECT m.*, u.nombre AS usuario_nombre
      FROM movimientos_caja m
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.caja_id = $1
        AND (m.referencia_tipo IS NULL
          OR m.referencia_tipo NOT IN ('factura_cancelada', 'abono_domicilio', 'servicio'))
      ORDER BY m.fecha ASC
    `, [cajaId]),

    pool.query(`
      SELECT m.*, u.nombre AS usuario_nombre
      FROM movimientos_caja m
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.caja_id = $1 AND m.referencia_tipo = 'factura_cancelada'
      ORDER BY m.fecha ASC
    `, [cajaId]),

    pool.query(`
      SELECT r.id, r.valor_retoma AS valor, r.descripcion,
             r.imei, r.nombre_producto, r.ingreso_inventario,
             f.nombre_cliente, f.id AS factura_id, f.fecha
      FROM retomas r
      JOIN facturas f ON f.id = r.factura_id
      WHERE f.sucursal_id = $1
        AND f.estado != 'Cancelada'
        AND f.fecha BETWEEN $2 AND $3
      ORDER BY f.fecha ASC
    `, [sucursalId, inicio, fin]),

    pool.query(`
      SELECT m.*, u.nombre AS usuario_nombre
      FROM movimientos_caja m
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.caja_id = $1 AND m.referencia_tipo = 'abono_domicilio'
      ORDER BY m.fecha ASC
    `, [cajaId]),

    // Servicios técnicos: query directa a abonos_servicio
    pool.query(`
      SELECT ab.id, ab.valor, ab.metodo, ab.fecha,
             os.id AS orden_id, os.cliente_nombre,
             os.equipo_nombre, os.equipo_tipo,
             u.nombre AS usuario_nombre
      FROM abonos_servicio ab
      JOIN ordenes_servicio os ON os.id = ab.orden_id
      LEFT JOIN usuarios u ON u.id = ab.usuario_id
      WHERE os.sucursal_id = $1 AND ab.fecha BETWEEN $2 AND $3
      ORDER BY ab.fecha ASC
    `, [sucursalId, inicio, fin]),
  ]);

  return _buildResumen({
    pf: pf.rows, ac: ac.rows, ap: ap.rows, cp: cp.rows,
    aa: aa.rows, mn: mn.rows, dv: dv.rows, rt: rt.rows,
    ad: ad.rows, sv: sv.rows,
  });
};

// ─── getResumenGlobal ─────────────────────────────────────────────────────────

const getResumenGlobal = async (negocioId) => {
  const hoy    = new Date();
  const inicio = new Date(hoy); inicio.setHours(0, 0, 0, 0);
  const fin    = new Date(hoy); fin.setHours(23, 59, 59, 999);

  const [pf, ac, ap, cp, aa, mn, dv, rt, ad, sv] = await Promise.all([

    pool.query(`
      SELECT pf.id, pf.metodo, pf.valor, f.nombre_cliente,
             f.id AS factura_id, f.fecha, su.nombre AS sucursal_nombre
      FROM pagos_factura pf
      JOIN facturas   f  ON f.id  = pf.factura_id
      JOIN sucursales su ON su.id = f.sucursal_id
      WHERE su.negocio_id = $1
        AND f.estado != 'Cancelada'
        AND pf.metodo != 'Credito'
        AND f.fecha BETWEEN $2 AND $3
        AND NOT EXISTS (
          SELECT 1 FROM entregas_domicilio ed
          WHERE ed.factura_id = f.id AND ed.estado = 'Pendiente'
        )
      ORDER BY f.fecha ASC
    `, [negocioId, inicio, fin]),

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
    `, [negocioId, inicio, fin]),

    pool.query(`
      SELECT ab.id, ab.valor, ab.fecha, p.prestatario, p.id AS prestamo_id,
             su.nombre AS sucursal_nombre
      FROM abonos_prestamo ab
      JOIN prestamos  p  ON p.id  = ab.prestamo_id
      JOIN sucursales su ON su.id = p.sucursal_id
      WHERE su.negocio_id = $1 AND ab.fecha BETWEEN $2 AND $3
      ORDER BY ab.fecha ASC
    `, [negocioId, inicio, fin]),

    // Compras global: solo las marcadas como registrar_en_caja = TRUE
    pool.query(`
      SELECT c.id, c.total AS valor, c.fecha, c.numero_factura,
             pr.nombre AS proveedor, su.nombre AS sucursal_nombre
      FROM compras c
      JOIN      sucursales  su ON su.id = c.sucursal_id
      LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
      WHERE su.negocio_id = $1
        AND c.estado != 'Cancelada'
        AND c.fecha BETWEEN $2 AND $3
        AND c.registrar_en_caja = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM movimientos_acreedor ma
          WHERE ma.compra_id = c.id AND ma.tipo = 'Cargo' AND ma.valor >= c.total
        )
      ORDER BY c.fecha ASC
    `, [negocioId, inicio, fin]),

    pool.query(`
      SELECT ma.id, ma.valor, ma.fecha, ma.descripcion, a.nombre AS acreedor
      FROM movimientos_acreedor ma
      JOIN acreedores a ON a.id = ma.acreedor_id
      WHERE ma.tipo = 'Abono' AND a.negocio_id = $1 AND ma.fecha BETWEEN $2 AND $3
        AND ma.registrar_en_caja = TRUE
    `, [negocioId, inicio, fin]),

    pool.query(`
      SELECT m.*, u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
      FROM movimientos_caja m
      JOIN aperturas_caja ac ON ac.id = m.caja_id
      JOIN sucursales     su ON su.id = ac.sucursal_id
      LEFT JOIN usuarios   u ON u.id  = m.usuario_id
      WHERE su.negocio_id = $1
        AND m.fecha BETWEEN $2 AND $3
        AND (m.referencia_tipo IS NULL
          OR m.referencia_tipo NOT IN ('factura_cancelada', 'abono_domicilio', 'servicio'))
      ORDER BY m.fecha ASC
    `, [negocioId, inicio, fin]),

    pool.query(`
      SELECT m.*, u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
      FROM movimientos_caja m
      JOIN aperturas_caja ac ON ac.id = m.caja_id
      JOIN sucursales     su ON su.id = ac.sucursal_id
      LEFT JOIN usuarios   u ON u.id  = m.usuario_id
      WHERE su.negocio_id = $1
        AND m.fecha BETWEEN $2 AND $3
        AND m.referencia_tipo = 'factura_cancelada'
      ORDER BY m.fecha ASC
    `, [negocioId, inicio, fin]),

    pool.query(`
      SELECT r.id, r.valor_retoma AS valor, r.descripcion,
             r.imei, r.nombre_producto, r.ingreso_inventario,
             f.nombre_cliente, f.id AS factura_id, f.fecha,
             su.nombre AS sucursal_nombre
      FROM retomas r
      JOIN facturas   f  ON f.id  = r.factura_id
      JOIN sucursales su ON su.id = f.sucursal_id
      WHERE su.negocio_id = $1
        AND f.estado != 'Cancelada'
        AND f.fecha BETWEEN $2 AND $3
      ORDER BY f.fecha ASC
    `, [negocioId, inicio, fin]),

    pool.query(`
      SELECT m.*, u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
      FROM movimientos_caja m
      JOIN aperturas_caja ac ON ac.id = m.caja_id
      JOIN sucursales     su ON su.id = ac.sucursal_id
      LEFT JOIN usuarios   u ON u.id  = m.usuario_id
      WHERE su.negocio_id = $1
        AND m.fecha BETWEEN $2 AND $3
        AND m.referencia_tipo = 'abono_domicilio'
      ORDER BY m.fecha ASC
    `, [negocioId, inicio, fin]),

    // Servicios técnicos global: query directa a abonos_servicio
    pool.query(`
      SELECT ab.id, ab.valor, ab.metodo, ab.fecha,
             os.id AS orden_id, os.cliente_nombre,
             os.equipo_nombre, os.equipo_tipo,
             u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
      FROM abonos_servicio ab
      JOIN ordenes_servicio os ON os.id = ab.orden_id
      JOIN sucursales       su ON su.id = os.sucursal_id
      LEFT JOIN usuarios     u ON u.id  = ab.usuario_id
      WHERE su.negocio_id = $1 AND ab.fecha BETWEEN $2 AND $3
      ORDER BY ab.fecha ASC
    `, [negocioId, inicio, fin]),
  ]);

  return _buildResumen({
    pf: pf.rows, ac: ac.rows, ap: ap.rows, cp: cp.rows,
    aa: aa.rows, mn: mn.rows, dv: dv.rows, rt: rt.rows,
    ad: ad.rows, sv: sv.rows,
  });
};

module.exports = {
  findCajaAbierta, findById, findByIdYNegocio,
  perteneceAlNegocio,
  getMovimientos, abrirCaja, cerrarCaja,
  insertarMovimiento, getResumenCaja,
  toggleMovimiento,
  getResumenDia, getResumenGlobal,
};