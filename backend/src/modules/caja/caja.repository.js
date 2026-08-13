const { pool } = require('../../config/db');

// Convierte un JS Date (UTC) al string de hora local Bogotá (UTC-5) sin zona horaria,
// para usarlo como parámetro en queries contra columnas TIMESTAMP WITHOUT TIME ZONE.
const _toBogotaStr = (d) => {
  const local = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 23).replace('T', ' ');
};

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

// Congela el resumen calculado al cerrar la caja. Se guarda como JSON para que
// las consultas posteriores de una caja cerrada devuelvan exactamente lo que
// había al cierre, sin recalcular en vivo (evita retroactividad).
const guardarResumenCierre = async (id, resumen) => {
  await pool.query(
    `UPDATE aperturas_caja SET resumen_cierre = $1 WHERE id = $2`,
    [JSON.stringify(resumen), id]
  );
};

const insertarMovimiento = async ({
  caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo, metodo,
}) => {
  const { rows } = await pool.query(`
    INSERT INTO movimientos_caja(caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo, metodo)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [caja_id, usuario_id, tipo, concepto, valor, referencia_id || null, referencia_tipo || null, metodo || null]);
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

// Historial de cajas (abiertas y cerradas) de una sucursal, más recientes primero.
// Para cajas cerradas con foto (resumen_cierre) se devuelven los totales ya
// congelados; para las demás, totales = null (el detalle se calcula al abrir).
const getHistorial = async (sucursalId, negocioId, limit, offset) => {
  const { rows } = await pool.query(`
    SELECT ac.id, ac.fecha_apertura, ac.fecha_cierre, ac.estado,
           ac.monto_inicial, ac.monto_cierre,
           u.nombre AS usuario_nombre,
           ac.resumen_cierre->'totales' AS totales
    FROM aperturas_caja ac
    JOIN      sucursales s ON s.id = ac.sucursal_id
    LEFT JOIN usuarios   u ON u.id = ac.usuario_id
    WHERE ac.sucursal_id = $1 AND s.negocio_id = $2
    ORDER BY ac.fecha_apertura DESC
    LIMIT $3 OFFSET $4
  `, [sucursalId, negocioId, limit, offset]);
  return rows;
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

// ── Movimientos de mora para el resumen de caja ──────────────────────────────
//
// La mora es una feature opt-in y su migración va en try/catch, así que puede no
// estar aplicada en una base vieja. Si la tabla no existe se devuelve vacío en
// lugar de tumbar TODO el resumen de caja, que es la pantalla del día a día.
//
// Filtra por sucursal o por negocio según lo que reciba, para servir a los dos
// resúmenes (el del día por sucursal y el global).
const _moraDeCaja = async ({ sucursalId = null, negocioId = null, inicio, fin }) => {
  try {
    return await pool.query(`
      SELECT
        mm.id, mm.concepto, mm.tipo, mm.valor, mm.metodo, mm.motivo, mm.fecha, mm.dias_mora,
        mm.credito_id, mm.prestamo_id,
        u.nombre  AS usuario_nombre,
        su.nombre AS sucursal_nombre,
        COALESCE(f.nombre_cliente, p.prestatario) AS nombre_cliente,
        f.numero AS factura_numero,
        p.numero AS prestamo_numero
      FROM movimientos_mora mm
      JOIN sucursales su ON su.id = mm.sucursal_id
      LEFT JOIN usuarios  u ON u.id = mm.usuario_id
      LEFT JOIN creditos  c ON c.id = mm.credito_id
      LEFT JOIN facturas  f ON f.id = c.factura_id
      LEFT JOIN prestamos p ON p.id = mm.prestamo_id
      WHERE NOT mm.anulado
        AND ($1::int IS NULL OR mm.sucursal_id  = $1)
        AND ($2::int IS NULL OR su.negocio_id   = $2)
        AND mm.fecha BETWEEN $3 AND $4
      ORDER BY mm.fecha ASC
    `, [sucursalId, negocioId, inicio, fin]);
  } catch (err) {
    console.warn('[caja] Mora no incluida en el resumen:', err.message);
    return { rows: [] };
  }
};

const _buildResumen = ({ pf, ac, ap, cp, aa, mn, rt, dv, ad, sv, fd = [], mo = [] }) => {
  const sum = (arr) => arr
    .filter((r) => r.activo !== false)
    .reduce((s, r) => s + Number(r.valor || 0), 0);

  // ── Mora (feature opt-in) ────────────────────────────────────────────────
  // El COBRO de mora es dinero que entró: suma a ingresos y al método de pago,
  // pero en un grupo propio para no confundirlo con los abonos a capital.
  // La CONDONACIÓN no mueve plata: queda informativa, para saber cuánto se dejó
  // de cobrar. Ninguna de las dos toca la utilidad del producto.
  // `movimientos_mora` guarda los dos cargos financieros. Se separan aquí para
  // que el cajero vea de dónde viene cada peso: la mora es sanción por atraso,
  // el interés corriente es el precio del plazo. Las filas anteriores a la
  // columna `concepto` son de mora (es lo único que existía).
  const esInteres = (r) => r.concepto === 'interes';
  const moraCobros         = mo.filter((r) => r.tipo === 'Cobro'       && !esInteres(r));
  const moraCondonadas     = mo.filter((r) => r.tipo === 'Condonacion' && !esInteres(r));
  const interesCobros      = mo.filter((r) => r.tipo === 'Cobro'       &&  esInteres(r));
  const interesCondonados  = mo.filter((r) => r.tipo === 'Condonacion' &&  esInteres(r));
  const totalMoraCobrada      = sum(moraCobros);
  const totalMoraCondonada    = sum(moraCondonadas);
  const totalInteresCobrado   = sum(interesCobros);
  const totalInteresCondonado = sum(interesCondonados);

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

  // Informativo: dinero de domicilios aún en poder del domiciliario (no cobrado).
  // NO entra en ingresos/egresos — solo se muestra como "por rendir".
  const totalPendienteDomicilios = fd
    .reduce((s, r) => s + Number(r.valor || 0), 0);

  const totalIngresosBruto = totalFacturas + totalAbonosCredito + totalAbonosPrestamo
    + totalAbonosDomicilio + totalAbonosServicio + totalManualesIngreso
    + totalMoraCobrada + totalInteresCobrado;
  // Las retomas NO se restan: los pagos de factura ya vienen NETOS de retoma
  // (el cliente paga total − retoma, y eso es lo que registra pagos_factura).
  // Restarlas aquí descontaba dos veces. El grupo queda solo informativo.
  const totalIngresos      = totalIngresosBruto;
  const totalEgresos       = totalCompras + totalAbonosAcreedor + totalManualesEgreso + totalDevoluciones;

  // ── Resumen por método de pago (entradas + salidas) ────────────────────
  const metodoMap = {};

  const sumarAlMetodo = (metodo, valor, tipo) => {
    if (!metodo || !valor) return;
    const v = Number(valor);
    if (v <= 0) return;
    if (!metodoMap[metodo]) metodoMap[metodo] = { ingresos: 0, egresos: 0 };
    if (tipo === 'ingreso') metodoMap[metodo].ingresos += v;
    if (tipo === 'egreso')  metodoMap[metodo].egresos  += v;
  };

  // Ingresos por método
  pf.filter((r) => r.activo !== false).forEach((r) => sumarAlMetodo(r.metodo, r.valor, 'ingreso'));
  ac.filter((r) => r.activo !== false).forEach((r) => sumarAlMetodo(r.metodo, r.valor, 'ingreso'));
  ap.filter((r) => r.activo !== false).forEach((r) => sumarAlMetodo(r.metodo, r.valor, 'ingreso'));
  sv.filter((r) => r.activo !== false).forEach((r) => sumarAlMetodo(r.metodo, r.valor, 'ingreso'));
  ad.filter((r) => r.activo !== false).forEach((r) => sumarAlMetodo(r.metodo, r.valor, 'ingreso'));
  moraCobros.forEach((r) => sumarAlMetodo(r.metodo, r.valor, 'ingreso'));
  interesCobros.forEach((r) => sumarAlMetodo(r.metodo, r.valor, 'ingreso'));

  // Egresos por método
  cp.filter((r) => r.activo !== false).forEach((r) => sumarAlMetodo(r.metodo, r.valor, 'egreso'));
  aa.filter((r) => r.activo !== false).forEach((r) => sumarAlMetodo(r.metodo, r.valor, 'egreso'));

  // Compatibilidad: metodosPago plano (solo ingresos) para no romper nada existente
  const metodosPago = {};
  for (const [metodo, datos] of Object.entries(metodoMap)) {
    if (datos.ingresos > 0) metodosPago[metodo] = datos.ingresos;
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
      // Informativo: la retoma ya está descontada en el pago de la factura
      // (pagos_factura es neto). No suma ni resta en los totales de caja.
      retomas: {
        tipo:  'Informativo',
        label: 'Retomas (ya descontadas en la factura)',
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
      // Informativo (no suma a ingresos): pedidos a domicilio pendientes de rendir.
      facturasDomicilio: {
        tipo:  'Informativo',
        label: 'Pedidos en domicilio',
        items: fd,
        total: totalPendienteDomicilios,
      },
      // Mora cobrada: dinero que entró, pero es ingreso FINANCIERO, no venta.
      // Grupo aparte para que no se confunda con los abonos a capital.
      moraCobrada: {
        tipo:  'Ingreso',
        label: 'Intereses de mora cobrados',
        items: moraCobros,
        total: totalMoraCobrada,
      },
      // Informativo: lo que el administrador decidió no cobrar.
      moraCondonada: {
        tipo:  'Informativo',
        label: 'Mora condonada (no se cobró)',
        items: moraCondonadas,
        total: totalMoraCondonada,
      },
      // Interés corriente: también ingreso financiero, pero va en su propio
      // grupo porque es otra cosa. La mora sanciona el atraso; esto es lo que
      // se cobró por financiar. Mezclarlos impediría saber cuánto del ingreso
      // vino de clientes que pagaron mal y cuánto del negocio de prestar.
      interesCobrado: {
        tipo:  'Ingreso',
        label: 'Intereses de financiación cobrados',
        items: interesCobros,
        total: totalInteresCobrado,
      },
      interesCondonado: {
        tipo:  'Informativo',
        label: 'Interés condonado (no se cobró)',
        items: interesCondonados,
        total: totalInteresCondonado,
      },
    },
    metodosPago,
    metodosPagoDetalle: metodoMap,
    totales: {
      ingresosBruto:       totalIngresosBruto,
      retomas:             totalRetomas,
      ingresos:            totalIngresos,
      egresos:             totalEgresos,
      saldo:               totalIngresos - totalEgresos,
      pendienteDomicilios: totalPendienteDomicilios,
      // Van aparte a propósito: la mora cobrada ya está dentro de `ingresos`,
      // pero se expone sola para poder mostrarla como ingreso financiero.
      moraCobrada:         totalMoraCobrada,
      interesCobrado:      totalInteresCobrado,
      interesCondonado:    totalInteresCondonado,
      moraCondonada:       totalMoraCondonada,
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
  // Para caja abierta el tope superior debe ser el reloj de la BASE DE DATOS,
  // no el del servidor de la app (new Date()): si la app va unos ms/seg detrás
  // de la DB, un abono recién registrado (fecha = now() de la DB) quedaría
  // apenas después del tope y no aparecería en la caja del día hasta refrescar.
  let finDate;
  if (caja.estado === 'Cerrada' && caja.fecha_cierre) {
    finDate = caja.fecha_cierre;
  } else {
    const { rows: nowRows } = await pool.query('SELECT now() AS ahora');
    finDate = nowRows[0].ahora;
  }
  return {
    inicio: _toBogotaStr(caja.fecha_apertura),
    fin:    _toBogotaStr(finDate),
  };
};

// ─── getResumenDia ────────────────────────────────────────────────────────────

const getResumenDia = async (cajaId, sucursalId, negocioId) => {
  const rango = await _getRangoCaja(cajaId);
  if (!rango) return null;
  const { inicio, fin } = rango;

  const [pf, ac, ap, cp, aa, mn, dv, rt, ad, sv, fd, mo] = await Promise.all([

    pool.query(`
      SELECT pf.id, pf.metodo, pf.valor, f.nombre_cliente, f.id AS factura_id,
             f.numero AS factura_numero, f.fecha,
             (SELECT STRING_AGG(lf.nombre_producto, ', ')
              FROM lineas_factura lf WHERE lf.factura_id = f.id) AS productos
      FROM pagos_factura pf
      JOIN facturas f ON f.id = pf.factura_id
      WHERE f.sucursal_id = $1
        AND f.estado != 'Cancelada'
        AND pf.metodo != 'Credito'
        AND f.fecha BETWEEN $2 AND $3
        AND NOT EXISTS (
          SELECT 1 FROM entregas_domicilio ed
          WHERE ed.factura_id = f.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM ordenes_servicio os
          WHERE os.factura_id = f.id
        )
        AND (f.notas IS NULL OR f.notas NOT LIKE 'Factura generada por saldo de préstamo #%')
      ORDER BY f.fecha ASC
    `, [sucursalId, inicio, fin]),

    pool.query(`
      SELECT ac.id, ac.valor, ac.metodo, ac.fecha,
             f.nombre_cliente, c.id AS credito_id, f.id AS factura_id,
             f.numero AS factura_numero,
             (SELECT STRING_AGG(lf.nombre_producto, ', ')
              FROM lineas_factura lf WHERE lf.factura_id = f.id) AS productos
      FROM abonos_credito ac
      JOIN creditos c ON c.id = ac.credito_id
      JOIN facturas f ON f.id = c.factura_id
      WHERE c.sucursal_id = $1 AND ac.fecha BETWEEN $2 AND $3
        AND f.estado != 'Cancelada'
      ORDER BY ac.fecha ASC
    `, [sucursalId, inicio, fin]),

    pool.query(`
      SELECT ab.id, ab.valor, ab.metodo, ab.fecha, p.prestatario, p.id AS prestamo_id,
             p.numero AS prestamo_numero,
             NULL::text AS descripcion
      FROM abonos_prestamo ab
      JOIN prestamos p ON p.id = ab.prestamo_id
      WHERE p.sucursal_id = $1 AND ab.fecha BETWEEN $2 AND $3
        AND ab.metodo NOT IN ('Intercambio', 'Saldo a favor')
        AND ab.abono_total_id IS NULL
      UNION ALL
      SELECT at.id, at.valor_total AS valor, at.metodo, at.fecha,
             COALESCE(pr.nombre, cl.nombre) AS prestatario,
             NULL AS prestamo_id,
             NULL::integer AS prestamo_numero,
             NULLIF(BTRIM(at.descripcion), '') AS descripcion
      FROM abonos_totales at
      JOIN sucursales su ON su.id = at.sucursal_id
      LEFT JOIN prestatarios pr ON pr.id = at.persona_id AND at.tipo_persona = 'prestatario'
      LEFT JOIN clientes     cl ON cl.id = at.persona_id AND at.tipo_persona = 'cliente'
      WHERE su.id = $1 AND at.fecha BETWEEN $2 AND $3
        AND at.metodo NOT IN ('Intercambio', 'Saldo a favor')
      ORDER BY fecha ASC
    `, [sucursalId, inicio, fin]),

    pool.query(`
      SELECT c.id, c.total AS valor, c.fecha, c.numero_factura, c.metodo,
             pr.nombre AS proveedor, pr.tipo AS tipo_proveedor,
             (SELECT STRING_AGG(lc.nombre_producto, ', ')
              FROM lineas_compra lc WHERE lc.compra_id = c.id) AS productos
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

    // Pagos a acreedores atribuidos a ESTA sucursal. Se prefiere ma.sucursal_id
    // (registrado al crear el movimiento) y, si falta, se deriva por compra
    // (compra_id directo o vía el cargo). Sin esto, como movimientos_acreedor no
    // distinguía sucursal, un pago se contaba en la caja de TODAS las sucursales.
    pool.query(`
      SELECT ma.id, ma.valor, ma.fecha, ma.descripcion, ma.metodo,
             a.nombre AS acreedor, pr.tipo AS tipo_proveedor
      FROM movimientos_acreedor ma
      JOIN acreedores a        ON a.id = ma.acreedor_id
      LEFT JOIN movimientos_acreedor cargo ON cargo.id = ma.cargo_id
      LEFT JOIN compras comp   ON comp.id = COALESCE(ma.compra_id, cargo.compra_id)
      LEFT JOIN proveedores pr ON pr.id = a.proveedor_id
      WHERE ma.tipo = 'Abono' AND a.negocio_id = $1 AND ma.fecha BETWEEN $2 AND $3
        AND ma.registrar_en_caja = TRUE
        AND COALESCE(ma.sucursal_id, comp.sucursal_id) = $4
    `, [negocioId, inicio, fin, sucursalId]),

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
             f.nombre_cliente, f.id AS factura_id, f.numero AS factura_numero, f.fecha
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

    pool.query(`
      SELECT ab.id, ab.valor, ab.metodo, ab.fecha,
             os.id AS orden_id, os.numero AS orden_numero, os.cliente_nombre,
             os.equipo_nombre, os.equipo_tipo,
             u.nombre AS usuario_nombre
      FROM abonos_servicio ab
      JOIN ordenes_servicio os ON os.id = ab.orden_id
      LEFT JOIN usuarios u ON u.id = ab.usuario_id
      WHERE os.sucursal_id = $1 AND ab.fecha BETWEEN $2 AND $3
      ORDER BY ab.fecha ASC
    `, [sucursalId, inicio, fin]),

    // Informativo: pedidos a domicilio pendientes de rendir en esta sucursal
    // (dinero aún en poder del domiciliario). No suma a caja.
    pool.query(`
      SELECT e.id, e.factura_id, f.numero AS factura_numero, f.nombre_cliente,
             (e.valor_total - e.total_abonado) AS valor,
             e.fecha_asignacion AS fecha, d.nombre AS domiciliario_nombre
      FROM entregas_domicilio e
      JOIN facturas      f ON f.id = e.factura_id
      JOIN domiciliarios d ON d.id = e.domiciliario_id
      WHERE f.sucursal_id = $1
        AND e.estado = 'Pendiente'
        AND (e.valor_total - e.total_abonado) > 0
      ORDER BY e.fecha_asignacion ASC
    `, [sucursalId]),

    // Mora (feature opt-in). Un negocio que no la usa no tiene filas aquí, así
    // que la consulta devuelve vacío y el grupo queda en cero.
    // El LEFT JOIN a la tabla se hace con to_regclass para no reventar si la
    // migración de mora aún no se aplicó en una base vieja.
    _moraDeCaja({ sucursalId, inicio, fin }),
  ]);

  return _buildResumen({
    pf: pf.rows, ac: ac.rows, ap: ap.rows, cp: cp.rows,
    aa: aa.rows, mn: mn.rows, dv: dv.rows, rt: rt.rows,
    ad: ad.rows, sv: sv.rows, fd: fd.rows, mo: mo.rows,
  });
};

// ─── getResumenGlobal ─────────────────────────────────────────────────────────

const getResumenGlobal = async (negocioId) => {
  const ahora      = new Date();
  const bogotaHoy  = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  const yyyy = bogotaHoy.getUTCFullYear();
  const mm   = String(bogotaHoy.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(bogotaHoy.getUTCDate()).padStart(2, '0');
  const inicio = `${yyyy}-${mm}-${dd} 00:00:00.000`;
  const fin    = `${yyyy}-${mm}-${dd} 23:59:59.999`;

  const [pf, ac, ap, cp, aa, mn, dv, rt, ad, sv, fd, mo] = await Promise.all([

    pool.query(`
      SELECT pf.id, pf.metodo, pf.valor, f.nombre_cliente,
             f.id AS factura_id, f.numero AS factura_numero, f.fecha,
             su.nombre AS sucursal_nombre,
             (SELECT STRING_AGG(lf.nombre_producto, ', ')
              FROM lineas_factura lf WHERE lf.factura_id = f.id) AS productos
      FROM pagos_factura pf
      JOIN facturas   f  ON f.id  = pf.factura_id
      JOIN sucursales su ON su.id = f.sucursal_id
      WHERE su.negocio_id = $1
        AND f.estado != 'Cancelada'
        AND pf.metodo != 'Credito'
        AND f.fecha BETWEEN $2 AND $3
        AND NOT EXISTS (
          SELECT 1 FROM entregas_domicilio ed
          WHERE ed.factura_id = f.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM ordenes_servicio os
          WHERE os.factura_id = f.id
        )
        AND (f.notas IS NULL OR f.notas NOT LIKE 'Factura generada por saldo de préstamo #%')
      ORDER BY f.fecha ASC
    `, [negocioId, inicio, fin]),

    pool.query(`
      SELECT ac.id, ac.valor, ac.metodo, ac.fecha,
             f.nombre_cliente, c.id AS credito_id, f.id AS factura_id,
             f.numero AS factura_numero,
             su.nombre AS sucursal_nombre,
             (SELECT STRING_AGG(lf.nombre_producto, ', ')
              FROM lineas_factura lf WHERE lf.factura_id = f.id) AS productos
      FROM abonos_credito ac
      JOIN creditos   c  ON c.id  = ac.credito_id
      JOIN facturas   f  ON f.id  = c.factura_id
      JOIN sucursales su ON su.id = c.sucursal_id
      WHERE su.negocio_id = $1 AND ac.fecha BETWEEN $2 AND $3
        AND f.estado != 'Cancelada'
      ORDER BY ac.fecha ASC
    `, [negocioId, inicio, fin]),

    pool.query(`
      SELECT ab.id, ab.valor, ab.metodo, ab.fecha, p.prestatario, p.id AS prestamo_id,
             p.numero AS prestamo_numero,
             su.nombre AS sucursal_nombre,
             NULL::text AS descripcion
      FROM abonos_prestamo ab
      JOIN prestamos  p  ON p.id  = ab.prestamo_id
      JOIN sucursales su ON su.id = p.sucursal_id
      WHERE su.negocio_id = $1 AND ab.fecha BETWEEN $2 AND $3
        AND ab.metodo NOT IN ('Intercambio', 'Saldo a favor')
        AND ab.abono_total_id IS NULL
      UNION ALL
      SELECT at.id, at.valor_total AS valor, at.metodo, at.fecha,
             COALESCE(pr.nombre, cl.nombre) AS prestatario,
             NULL AS prestamo_id,
             NULL::integer AS prestamo_numero,
             su.nombre AS sucursal_nombre,
             NULLIF(BTRIM(at.descripcion), '') AS descripcion
      FROM abonos_totales at
      JOIN sucursales su ON su.id = at.sucursal_id
      LEFT JOIN prestatarios pr ON pr.id = at.persona_id AND at.tipo_persona = 'prestatario'
      LEFT JOIN clientes     cl ON cl.id = at.persona_id AND at.tipo_persona = 'cliente'
      WHERE su.negocio_id = $1 AND at.fecha BETWEEN $2 AND $3
        AND at.metodo NOT IN ('Intercambio', 'Saldo a favor')
      ORDER BY fecha ASC
    `, [negocioId, inicio, fin]),

    pool.query(`
      SELECT c.id, c.total AS valor, c.fecha, c.numero_factura, c.metodo,
             pr.nombre AS proveedor, pr.tipo AS tipo_proveedor,
             su.nombre AS sucursal_nombre,
             (SELECT STRING_AGG(lc.nombre_producto, ', ')
              FROM lineas_compra lc WHERE lc.compra_id = c.id) AS productos
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
      SELECT ma.id, ma.valor, ma.fecha, ma.descripcion, ma.metodo,
             a.nombre AS acreedor, pr.tipo AS tipo_proveedor,
             su_a.nombre AS sucursal_nombre
      FROM movimientos_acreedor ma
      JOIN acreedores a ON a.id = ma.acreedor_id
      LEFT JOIN proveedores pr ON pr.id = a.proveedor_id
      LEFT JOIN (
        SELECT DISTINCT ON (prv.id) prv.id AS prov_id, su.nombre
        FROM proveedores prv
        JOIN compras c2 ON c2.proveedor_id = prv.id
        JOIN sucursales su ON su.id = c2.sucursal_id
        WHERE prv.negocio_id = $1
        ORDER BY prv.id, c2.fecha DESC
      ) su_a ON su_a.prov_id = a.proveedor_id
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
             f.nombre_cliente, f.id AS factura_id, f.numero AS factura_numero, f.fecha,
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

    pool.query(`
      SELECT ab.id, ab.valor, ab.metodo, ab.fecha,
             os.id AS orden_id, os.numero AS orden_numero, os.cliente_nombre,
             os.equipo_nombre, os.equipo_tipo,
             u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
      FROM abonos_servicio ab
      JOIN ordenes_servicio os ON os.id = ab.orden_id
      JOIN sucursales       su ON su.id = os.sucursal_id
      LEFT JOIN usuarios     u ON u.id  = ab.usuario_id
      WHERE su.negocio_id = $1 AND ab.fecha BETWEEN $2 AND $3
      ORDER BY ab.fecha ASC
    `, [negocioId, inicio, fin]),

    // Informativo: pedidos a domicilio pendientes de rendir en el negocio
    // (dinero aún en poder del domiciliario). No suma a caja.
    pool.query(`
      SELECT e.id, e.factura_id, f.numero AS factura_numero, f.nombre_cliente,
             (e.valor_total - e.total_abonado) AS valor,
             e.fecha_asignacion AS fecha,
             d.nombre AS domiciliario_nombre, su.nombre AS sucursal_nombre
      FROM entregas_domicilio e
      JOIN facturas      f  ON f.id  = e.factura_id
      JOIN sucursales    su ON su.id = f.sucursal_id
      JOIN domiciliarios d  ON d.id  = e.domiciliario_id
      WHERE su.negocio_id = $1
        AND e.estado = 'Pendiente'
        AND (e.valor_total - e.total_abonado) > 0
      ORDER BY e.fecha_asignacion ASC
    `, [negocioId]),

    _moraDeCaja({ negocioId, inicio, fin }),
  ]);

  return _buildResumen({
    pf: pf.rows, ac: ac.rows, ap: ap.rows, cp: cp.rows,
    aa: aa.rows, mn: mn.rows, dv: dv.rows, rt: rt.rows,
    ad: ad.rows, sv: sv.rows, fd: fd.rows, mo: mo.rows,
  });
};

module.exports = {
  findCajaAbierta, findById, findByIdYNegocio,
  perteneceAlNegocio,
  getMovimientos, abrirCaja, cerrarCaja, guardarResumenCierre,
  getHistorial,
  insertarMovimiento, getResumenCaja,
  toggleMovimiento,
  getResumenDia, getResumenGlobal,
};