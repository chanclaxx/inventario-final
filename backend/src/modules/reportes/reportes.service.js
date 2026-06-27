const { pool } = require('../../config/db');

const HOY_F = `DATE(f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') = (NOW() AT TIME ZONE 'America/Bogota')::date`;
const HOY   = `DATE(fecha   AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') = (NOW() AT TIME ZONE 'America/Bogota')::date`;

// Helper timezone: columnas "timestamp without time zone" almacenadas en UTC
const fechaBogota = (col) => `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date`;

// ── Helper: subquery de costo de serial anclada al negocio ───────────────────
const _costoPorImei = (imeiAlias, sucursalAlias) => `
  COALESCE(
    (
      SELECT s.costo_compra
      FROM seriales s
      JOIN productos_serial ps ON ps.id = s.producto_id
      WHERE s.imei = ${imeiAlias}
        AND ps.sucursal_id = ${sucursalAlias}
      LIMIT 1
    ),
    (
      SELECT AVG(s2.costo_compra)
      FROM seriales s2
      JOIN productos_serial ps2 ON ps2.id = s2.producto_id
      JOIN seriales s3 ON s3.imei = ${imeiAlias}
      WHERE s2.producto_id = s3.producto_id
        AND ps2.sucursal_id = ${sucursalAlias}
        AND s2.costo_compra IS NOT NULL
    ),
    0
  )
`;

const getDashboard = async (sucursalId) => {
  const [
    ventasHoy,
    facturasHoy,
    stockBajo,
    prestamosActivos,
    creditosActivos,
    pagosMethods,
    utilidadActivas,
    utilidadCreditos,
  ] = await Promise.all([

    pool.query(`
      SELECT COALESCE(SUM(l.subtotal), 0) AS total
      FROM lineas_factura l
      JOIN facturas f ON f.id = l.factura_id
      WHERE ${HOY_F} AND f.sucursal_id = $1 AND f.estado = 'Activa'
    `, [sucursalId]),

    pool.query(`
      SELECT COUNT(*) AS total
      FROM facturas
      WHERE ${HOY} AND sucursal_id = $1 AND estado != 'Cancelada'
    `, [sucursalId]),

    pool.query(`
      SELECT COUNT(*) AS total
      FROM productos_cantidad
      WHERE stock <= stock_minimo AND sucursal_id = $1 AND activo = true
    `, [sucursalId]),

    pool.query(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(valor_prestamo - total_abonado), 0) AS deuda_total
      FROM prestamos
      WHERE estado = 'Activo' AND sucursal_id = $1
    `, [sucursalId]),

    pool.query(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(valor_total - cuota_inicial - total_abonado), 0) AS deuda_total
      FROM creditos
      WHERE estado = 'Activo' AND sucursal_id = $1
    `, [sucursalId]),

    pool.query(`
      SELECT pf.metodo, COALESCE(SUM(pf.valor), 0) AS total
      FROM pagos_factura pf
      JOIN facturas f ON f.id = pf.factura_id
      WHERE ${HOY_F} AND f.sucursal_id = $1 AND f.estado != 'Cancelada'
      GROUP BY pf.metodo
      ORDER BY total DESC
    `, [sucursalId]),

    pool.query(`
      WITH retomas_por_factura AS (
        SELECT factura_id, COALESCE(SUM(valor_retoma), 0) AS total_retomas
        FROM retomas
        GROUP BY factura_id
      ),
      costo_por_linea AS (
        SELECT
          l.factura_id,
          SUM(
            l.subtotal
            - CASE
                WHEN l.imei IS NOT NULL THEN
                  ${_costoPorImei('l.imei', 'f.sucursal_id')}
                ELSE
                  COALESCE(
                    (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id),
                    (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id),
                    (SELECT pc.costo_unitario FROM productos_cantidad pc
                     WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id LIMIT 1),
                    0
                  ) * l.cantidad
              END
          ) AS utilidad_bruta
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE ${HOY_F} AND f.sucursal_id = $1 AND f.estado = 'Activa'
        GROUP BY l.factura_id
      )
      SELECT
        COALESCE(SUM(c.utilidad_bruta), 0)             AS utilidad_bruta,
        COALESCE(SUM(COALESCE(r.total_retomas, 0)), 0) AS total_retomas
      FROM costo_por_linea c
      LEFT JOIN retomas_por_factura r ON r.factura_id = c.factura_id
    `, [sucursalId]),

    // ── Utilidad de créditos saldados HOY ───────────────────────────────────
    // Fórmula: (cuota_inicial + total_abonado) - costo_productos
    pool.query(`
      WITH ultimo_abono_credito AS (
        SELECT ac.credito_id, MAX(ac.fecha) AS fecha_ultimo_abono
        FROM abonos_credito ac
        GROUP BY ac.credito_id
      ),
      creditos_saldados_hoy AS (
        SELECT
          cr.id          AS credito_id,
          cr.factura_id,
          (cr.cuota_inicial + cr.total_abonado) AS total_cobrado
        FROM creditos cr
        JOIN ultimo_abono_credito ua ON ua.credito_id = cr.id
        WHERE cr.sucursal_id = $1
          AND cr.estado = 'Saldado'
          AND DATE(ua.fecha_ultimo_abono AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')
              = (NOW() AT TIME ZONE 'America/Bogota')::date
      ),
      costo_por_factura AS (
        SELECT
          l.factura_id,
          SUM(
            CASE
              WHEN l.imei IS NOT NULL THEN
                ${_costoPorImei('l.imei', 'f.sucursal_id')}
              ELSE
                COALESCE(
                  (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id),
                  (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id),
                  (SELECT pc.costo_unitario FROM productos_cantidad pc
                   WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id LIMIT 1),
                  0
                ) * l.cantidad
            END
          ) AS costo_total
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE f.id IN (SELECT factura_id FROM creditos_saldados_hoy)
        GROUP BY l.factura_id
      )
      SELECT
        COALESCE(SUM(cs.total_cobrado - COALESCE(cp.costo_total, 0)), 0) AS utilidad_bruta,
        0 AS total_retomas
      FROM creditos_saldados_hoy cs
      LEFT JOIN costo_por_factura cp ON cp.factura_id = cs.factura_id
    `, [sucursalId]),
  ]);

  const uActiva  = utilidadActivas.rows[0];
  const uCredito = utilidadCreditos.rows[0];

  return {
    ventas_hoy:         ventasHoy.rows[0].total,
    facturas_hoy:       facturasHoy.rows[0].total,
    stock_bajo:         stockBajo.rows[0].total,
    utilidad_hoy:       Number(uActiva.utilidad_bruta)  - Number(uActiva.total_retomas),
    utilidad_pendiente: Number(uCredito.utilidad_bruta) - Number(uCredito.total_retomas),
    prestamos_activos: {
      cantidad:    prestamosActivos.rows[0].total,
      deuda_total: prestamosActivos.rows[0].deuda_total,
    },
    creditos_activos: {
      cantidad:    creditosActivos.rows[0].total,
      deuda_total: creditosActivos.rows[0].deuda_total,
    },
    pagos_hoy: pagosMethods.rows,
  };
};

// ─── getServiciosRango ────────────────────────────────────────────────────────

const getServiciosRango = async (sucursalId, desde, hasta) => {

  const { rows: cerradosRaw } = await pool.query(`
    SELECT
      os.id, os.estado, os.cliente_nombre,
      os.equipo_tipo, os.equipo_nombre, os.equipo_serial,
      os.falla_reportada, os.notas_tecnico, os.motivo_sin_reparar,
      os.precio_final, os.costo_real, os.total_abonado,
      os.precio_garantia, os.costo_garantia, os.garantia_cobrable,
      os.fecha_recepcion, os.fecha_entrega
    FROM ordenes_servicio os
    WHERE os.sucursal_id = $1
      AND os.estado IN ('Entregado', 'Pendiente_pago', 'Sin_reparar')
      AND ${fechaBogota('os.fecha_entrega')} BETWEEN $2 AND $3
    ORDER BY os.fecha_entrega DESC
  `, [sucursalId, desde, hasta]);

  const { rows: activosResumen } = await pool.query(`
    SELECT
      os.estado,
      COUNT(*)::int AS cantidad,
      COALESCE(SUM(
        CASE
          WHEN os.estado = 'Garantia' AND os.garantia_cobrable AND os.precio_garantia IS NOT NULL
          THEN os.precio_garantia - os.total_abonado
          WHEN os.estado IN ('Listo', 'Pendiente_pago')
          THEN COALESCE(os.precio_final, 0) - os.total_abonado
          ELSE 0
        END
      ), 0) AS saldo_pendiente
    FROM ordenes_servicio os
    WHERE os.sucursal_id = $1
      AND os.estado IN ('Recibido', 'En_reparacion', 'Listo', 'Garantia')
    GROUP BY os.estado
  `, [sucursalId]);

  const cerrados = cerradosRaw.map((os) => {
    const precioFinal    = Number(os.precio_final    || 0);
    const costoReal      = Number(os.costo_real      || 0);
    const totalAbonado   = Number(os.total_abonado   || 0);
    const precioGarantia = Number(os.precio_garantia || 0);
    const costoGarantia  = Number(os.costo_garantia  || 0);

    let categoria, ingresos, costo, utilidad, saldoPendiente;

    if (os.estado === 'Sin_reparar') {
      categoria      = 'diagnostico';
      ingresos       = precioFinal;
      costo          = 0;
      utilidad       = precioFinal;
      saldoPendiente = 0;
    } else if (precioGarantia > 0 && os.garantia_cobrable) {
      categoria      = 'garantia';
      ingresos       = totalAbonado;
      costo          = costoGarantia;
      utilidad       = costoGarantia > 0 ? precioGarantia - costoGarantia : null;
      saldoPendiente = precioGarantia - totalAbonado;
    } else if (os.estado === 'Pendiente_pago') {
      categoria      = 'pendiente';
      ingresos       = totalAbonado;
      costo          = costoReal;
      utilidad       = costoReal > 0 ? precioFinal - costoReal : null;
      saldoPendiente = precioFinal - totalAbonado;
    } else {
      categoria      = 'pagado';
      ingresos       = totalAbonado;
      costo          = costoReal;
      utilidad       = costoReal > 0 ? precioFinal - costoReal : null;
      saldoPendiente = 0;
    }

    return {
      id:                 os.id,
      estado:             os.estado,
      categoria,
      cliente_nombre:     os.cliente_nombre,
      equipo_nombre:      os.equipo_nombre || os.equipo_tipo || 'Equipo',
      falla_reportada:    os.falla_reportada,
      notas_tecnico:      os.notas_tecnico,
      motivo_sin_reparar: os.motivo_sin_reparar,
      precio_final:       precioFinal,
      costo_real:         costoReal,
      total_abonado:      totalAbonado,
      precio_garantia:    precioGarantia,
      costo_garantia:     costoGarantia,
      ingresos,
      costo,
      utilidad,
      saldo_pendiente:    saldoPendiente > 0 ? saldoPendiente : 0,
      fecha_recepcion:    os.fecha_recepcion,
      fecha_entrega:      os.fecha_entrega,
    };
  });

  const pagados      = cerrados.filter((s) => s.categoria === 'pagado');
  const pendientes   = cerrados.filter((s) => s.categoria === 'pendiente');
  const diagnosticos = cerrados.filter((s) => s.categoria === 'diagnostico');
  const garantias    = cerrados.filter((s) => s.categoria === 'garantia');

  const sumarUtilidad = (arr) => arr.reduce((s, o) => o.utilidad !== null ? s + o.utilidad : s, 0);
  const sumarIngresos = (arr) => arr.reduce((s, o) => s + o.ingresos, 0);
  const sumarSaldo    = (arr) => arr.reduce((s, o) => s + o.saldo_pendiente, 0);

  const totalActivos      = activosResumen.reduce((s, r) => s + r.cantidad, 0);
  const saldoTotalActivos = activosResumen.reduce((s, r) => s + Number(r.saldo_pendiente), 0);
  const activosPorEstado  = {};
  activosResumen.forEach((r) => { activosPorEstado[r.estado] = r.cantidad; });

  return {
    cerrados,
    resumen: {
      total_cerrados:       cerrados.length,
      utilidad_confirmada:  sumarUtilidad(pagados),
      utilidad_garantias:   sumarUtilidad(garantias),
      ingresos_diagnostico: sumarIngresos(diagnosticos),
      utilidad_pendiente:   sumarUtilidad(pendientes),
      saldo_por_cobrar:     sumarSaldo(pendientes) + sumarSaldo(garantias),
      total_ingresos:       sumarIngresos(cerrados),
      pagados:              pagados.length,
      pendientes_pago:      pendientes.length,
      diagnosticos:         diagnosticos.length,
      garantias_cobrables:  garantias.length,
    },
    activos: {
      total:           totalActivos,
      saldo_pendiente: saldoTotalActivos,
      por_estado:      activosPorEstado,
    },
  };
};

// ─── getVentasRango ───────────────────────────────────────────────────────────

const getVentasRango = async (sucursalId, desde, hasta) => {

  const { rows: facturas } = await pool.query(`
    WITH retomas_por_factura AS (
      SELECT factura_id, COALESCE(SUM(valor_retoma), 0) AS total_retomas
      FROM retomas
      GROUP BY factura_id
    )
    SELECT
      f.id, f.nombre_cliente, f.cedula, f.celular,
      f.fecha, f.estado, f.notas,
      COALESCE(SUM(l.subtotal), 0) AS total_venta,
      COALESCE(r.total_retomas, 0) AS total_retomas
    FROM facturas f
    LEFT JOIN lineas_factura l      ON l.factura_id = f.id
    LEFT JOIN retomas_por_factura r ON r.factura_id = f.id
    WHERE f.sucursal_id = $1
      AND DATE(f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
      AND f.estado != 'Cancelada'
    GROUP BY f.id, r.total_retomas
    ORDER BY f.fecha DESC
  `, [sucursalId, desde, hasta]);

  const costoProductoCase = `
    CASE
      WHEN p.imei IS NOT NULL THEN
        (SELECT s.costo_compra
         FROM seriales s
         JOIN productos_serial ps ON ps.id = s.producto_id
         WHERE s.imei = p.imei AND ps.sucursal_id = p.sucursal_id
         LIMIT 1)
      WHEN p.variante_id IS NOT NULL THEN
        (SELECT v.costo_unitario * p.cantidad_prestada
         FROM variantes_atributo v WHERE v.id = p.variante_id LIMIT 1)
      WHEN p.atributo_id IS NOT NULL THEN
        (SELECT ap.costo_unitario * p.cantidad_prestada
         FROM atributos_producto ap WHERE ap.id = p.atributo_id LIMIT 1)
      WHEN p.producto_id IS NOT NULL THEN
        (SELECT pc.costo_unitario * p.cantidad_prestada
         FROM productos_cantidad pc
         WHERE pc.id = p.producto_id
           AND pc.sucursal_id = p.sucursal_id
         LIMIT 1)
      ELSE NULL
    END
  `;

  const { rows: saldadosRaw } = await pool.query(`
    WITH prestamos_sucursal AS (
      SELECT id FROM prestamos WHERE sucursal_id = $1 AND estado = 'Saldado'
    ),
    ultimo_abono AS (
      SELECT
        ab.prestamo_id,
        MAX(ab.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') AS fecha_saldo
      FROM abonos_prestamo ab
      JOIN prestamos_sucursal ps ON ps.id = ab.prestamo_id
      GROUP BY ab.prestamo_id
    )
    SELECT
      p.id,
      p.nombre_producto,
      p.imei,
      p.prestatario,
      p.valor_prestamo,
      p.total_abonado,
      p.estado,
      p.fecha                AS fecha_prestamo,
      ua.fecha_saldo,
      ${costoProductoCase}   AS costo_producto,
      COALESCE(
        (SELECT lp.nombre FROM seriales s
         JOIN productos_serial ps ON ps.id = s.producto_id
         JOIN lineas_producto  lp ON lp.id = ps.linea_id
         WHERE s.imei = p.imei LIMIT 1),
        (SELECT lp.nombre FROM productos_cantidad pc
         JOIN lineas_producto lp ON lp.id = pc.linea_id
         WHERE pc.id = p.producto_id LIMIT 1)
      ) AS linea_nombre
    FROM prestamos p
    JOIN ultimo_abono ua ON ua.prestamo_id = p.id
    WHERE p.sucursal_id = $1
      AND p.estado      = 'Saldado'
      AND DATE(ua.fecha_saldo) BETWEEN $2 AND $3
    ORDER BY ua.fecha_saldo DESC
  `, [sucursalId, desde, hasta]);

  const { rows: activosRaw } = await pool.query(`
    SELECT
      p.id,
      p.nombre_producto,
      p.imei,
      p.prestatario,
      p.valor_prestamo,
      p.total_abonado,
      p.estado,
      p.fecha AS fecha_prestamo,
      ${costoProductoCase} AS costo_producto,
      COALESCE(
        (SELECT lp.nombre FROM seriales s
         JOIN productos_serial ps ON ps.id = s.producto_id
         JOIN lineas_producto  lp ON lp.id = ps.linea_id
         WHERE s.imei = p.imei LIMIT 1),
        (SELECT lp.nombre FROM productos_cantidad pc
         JOIN lineas_producto lp ON lp.id = pc.linea_id
         WHERE pc.id = p.producto_id LIMIT 1)
      ) AS linea_nombre
    FROM prestamos p
    WHERE p.sucursal_id = $1
      AND p.estado = 'Activo'
    ORDER BY p.fecha ASC
  `, [sucursalId]);

  const saldados = saldadosRaw.map((p) => {
    const costo        = p.costo_producto !== null ? Number(p.costo_producto) : null;
    const totalAbonado = Number(p.total_abonado);
    return {
      id:              p.id,
      nombre_producto: p.nombre_producto,
      imei:            p.imei,
      prestatario:     p.prestatario,
      valor_prestamo:  Number(p.valor_prestamo),
      total_abonado:   totalAbonado,
      costo_producto:  costo,
      fecha:           p.fecha_prestamo,
      fecha_saldo:     p.fecha_saldo,
      utilidad:        costo !== null ? totalAbonado - costo : null,
      linea_nombre:    p.linea_nombre || null,
    };
  });

  const activos = activosRaw.map((p) => {
    const costo         = p.costo_producto !== null ? Number(p.costo_producto) : null;
    const totalAbonado  = Number(p.total_abonado);
    const valorPrestamo = Number(p.valor_prestamo);
    return {
      id:                p.id,
      nombre_producto:   p.nombre_producto,
      imei:              p.imei,
      prestatario:       p.prestatario,
      valor_prestamo:    valorPrestamo,
      total_abonado:     totalAbonado,
      costo_producto:    costo,
      fecha:             p.fecha_prestamo,
      saldo_pendiente:   valorPrestamo - totalAbonado,
      utilidad_parcial:  costo !== null ? totalAbonado - costo : null,
      falta_para_cubrir: costo !== null ? Math.max(0, costo - totalAbonado) : null,
      linea_nombre:      p.linea_nombre || null,
    };
  });

  const utilidadConfirmada   = saldados.reduce((s, p) => p.utilidad         !== null ? s + p.utilidad         : s, 0);
  const utilidadParcialTotal = activos.reduce( (s, p) => p.utilidad_parcial !== null ? s + p.utilidad_parcial : s, 0);
  const porCubrirTotal       = activos.reduce( (s, p) => p.falta_para_cubrir !== null ? s + p.falta_para_cubrir : s, 0);

  const prestamos = {
    saldados,
    activos,
    resumen: {
      utilidad_confirmada:  utilidadConfirmada,
      utilidad_parcial:     utilidadParcialTotal,
      por_cubrir:           porCubrirTotal,
      total_saldados:       saldados.length,
      total_activos:        activos.length,
    },
  };

  const servicios = await getServiciosRango(sucursalId, desde, hasta);

  if (!facturas.length) {
    return {
      facturas: [],
      resumen:  null,
      prestamos,
      servicios,
      creditos: {
        saldados: [],
        activos:  { total: 0, saldo_pendiente: 0 },
        resumen:  { utilidad_confirmada: 0, total_saldados: 0 },
      },
    };
  }

  const facturaIds = facturas.map((f) => f.id);

  const { rows: lineas } = await pool.query(`
    SELECT
      l.factura_id,
      l.nombre_producto,
      l.imei,
      l.cantidad,
      l.precio,
      l.subtotal,
      l.producto_id,
      l.atributo_id,
      l.variante_id,
      CASE
        WHEN l.imei IS NOT NULL THEN
          ${_costoPorImei('l.imei', 'f.sucursal_id')}
        WHEN l.variante_id IS NOT NULL THEN
          (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id)
        WHEN l.atributo_id IS NOT NULL THEN
          (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id)
        WHEN l.producto_id IS NOT NULL THEN
          (SELECT pc.costo_unitario FROM productos_cantidad pc WHERE pc.id = l.producto_id)
        ELSE
          (SELECT pc.costo_unitario FROM productos_cantidad pc
           WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id LIMIT 1)
      END AS costo_unitario_compra,
      CASE WHEN l.imei IS NOT NULL THEN 'serial' ELSE 'cantidad' END AS tipo_producto,
      COALESCE(lps.nombre, lpc.nombre) AS linea_nombre
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
    LEFT JOIN seriales          s_r  ON s_r.imei  = l.imei
    LEFT JOIN productos_serial  ps_r ON ps_r.id   = s_r.producto_id AND ps_r.sucursal_id = f.sucursal_id
    LEFT JOIN lineas_producto   lps  ON lps.id    = ps_r.linea_id
    LEFT JOIN productos_cantidad pc_r ON pc_r.id  = l.producto_id AND l.imei IS NULL
    LEFT JOIN lineas_producto   lpc  ON lpc.id    = pc_r.linea_id
    WHERE l.factura_id = ANY($1::int[])
    ORDER BY l.id ASC
  `, [facturaIds]);

  const lineasPorFactura = {};
  for (const linea of lineas) {
    const costoUnitario = linea.costo_unitario_compra !== null ? Number(linea.costo_unitario_compra) : null;
    const costoTotal    = costoUnitario !== null ? costoUnitario * Number(linea.cantidad) : null;
    const utilidad      = costoTotal   !== null ? Number(linea.subtotal) - costoTotal : null;

    const item = {
      nombre_producto:       linea.nombre_producto,
      imei:                  linea.imei,
      cantidad:              Number(linea.cantidad),
      precio_venta:          Number(linea.precio),
      subtotal:              Number(linea.subtotal),
      producto_id:           linea.producto_id  ? Number(linea.producto_id)  : null,
      atributo_id:           linea.atributo_id  ? Number(linea.atributo_id)  : null,
      variante_id:           linea.variante_id  ? Number(linea.variante_id)  : null,
      costo_unitario_compra: costoUnitario,
      costo_total:           costoTotal,
      utilidad,
      tipo_producto:         linea.tipo_producto,
      linea_nombre:          linea.linea_nombre || null,
    };

    if (!lineasPorFactura[linea.factura_id]) lineasPorFactura[linea.factura_id] = [];
    lineasPorFactura[linea.factura_id].push(item);
  }

  const facturasCompletas = facturas.map((f) => {
    const items         = lineasPorFactura[f.id] || [];
    const totalRetomas  = Number(f.total_retomas);
    const utilidadBruta = items.reduce(
      (acc, i) => (i.utilidad !== null ? acc + i.utilidad : acc), 0,
    );
    return {
      id:                     f.id,
      nombre_cliente:         f.nombre_cliente,
      cedula:                 f.cedula,
      celular:                f.celular,
      fecha:                  f.fecha,
      estado:                 f.estado,
      notas:                  f.notas,
      total_venta:            Number(f.total_venta),
      total_retomas:          totalRetomas,
      utilidad_bruta:         utilidadBruta,
      utilidad_neta:          utilidadBruta - totalRetomas,
      tiene_costo_incompleto: items.some((i) => i.costo_unitario_compra === null),
      lineas:                 items,
    };
  });

  const soloActivas  = facturasCompletas.filter((f) => f.estado === 'Activa');
  const soloCreditos = facturasCompletas.filter((f) => f.estado === 'Credito');

  // ── Créditos activos en lista de facturas: utilidad = 0 ───────────────────
  // No se reconoce utilidad hasta que el crédito esté 100% saldado
  for (const fc of soloCreditos) {
    fc.utilidad_bruta         = 0;
    fc.utilidad_neta          = 0;
    fc.tiene_costo_incompleto = false;
    for (const linea of fc.lineas) {
      linea.utilidad = 0;
    }
  }

  // ── Créditos saldados en el rango ─────────────────────────────────────────
  // Utilidad = (cuota_inicial + total_abonado) - costo_total_productos
  // Se usa lo realmente cobrado, NO el precio de factura original
  const { rows: creditosSaldadosRango } = await pool.query(`
    WITH ultimo_abono_credito AS (
      SELECT ac.credito_id, MAX(ac.fecha) AS fecha_ultimo_abono
      FROM abonos_credito ac
      GROUP BY ac.credito_id
    )
    SELECT
      cr.id            AS credito_id,
      cr.factura_id,
      cr.valor_total,
      cr.cuota_inicial,
      cr.total_abonado,
      (cr.cuota_inicial + cr.total_abonado) AS total_cobrado,
      f.nombre_cliente,
      f.cedula,
      f.fecha          AS fecha_factura,
      ua.fecha_ultimo_abono AS fecha_saldo
    FROM creditos cr
    JOIN ultimo_abono_credito ua ON ua.credito_id = cr.id
    JOIN facturas f              ON f.id = cr.factura_id
    WHERE cr.sucursal_id = $1
      AND cr.estado = 'Saldado'
      AND DATE(ua.fecha_ultimo_abono AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')
          BETWEEN $2 AND $3
    ORDER BY ua.fecha_ultimo_abono DESC
  `, [sucursalId, desde, hasta]);

  const creditosSaldados = creditosSaldadosRango.map((cr) => {
    const lineasOrig   = lineasPorFactura[cr.factura_id] || [];
    const totalCobrado = Number(cr.total_cobrado);

    // Suma el costo de todos los productos; si alguno no tiene costo → dato incompleto
    let costoTotalProductos  = 0;
    let tieneCostoIncompleto = false;
    for (const linea of lineasOrig) {
      if (linea.costo_unitario_compra === null) {
        tieneCostoIncompleto = true;
      } else {
        costoTotalProductos += linea.costo_unitario_compra * linea.cantidad;
      }
    }

    // Si no hay ningún costo registrado → utilidad null (sin dato)
    // Si hay costo parcial → se calcula con lo disponible y se marca incompleto
    const utilidad = tieneCostoIncompleto && costoTotalProductos === 0
      ? null
      : totalCobrado - costoTotalProductos;

    return {
      credito_id:             cr.credito_id,
      factura_id:             cr.factura_id,
      nombre_cliente:         cr.nombre_cliente,
      cedula:                 cr.cedula,
      valor_total:            Number(cr.valor_total),
      cuota_inicial:          Number(cr.cuota_inicial),
      total_abonado:          Number(cr.total_abonado),
      total_cobrado:          totalCobrado,
      fecha_factura:          cr.fecha_factura,
      fecha_saldo:            cr.fecha_saldo,
      utilidad,
      tiene_costo_incompleto: tieneCostoIncompleto,
      productos: lineasOrig.map((l) => ({
        nombre:       l.nombre_producto,
        imei:         l.imei,
        precio:       l.precio_venta,
        costo:        l.costo_unitario_compra,
        linea_nombre: l.linea_nombre,
      })),
    };
  });

  const utilidadCreditosSaldados = creditosSaldados.reduce(
    (s, c) => c.utilidad !== null ? s + c.utilidad : s, 0,
  );

  // ── Créditos activos: detalle con utilidad parcial ────────────────────────
  // Utilidad parcial = MAX(0, cobrado - costo). Solo hay utilidad una vez
  // que lo cobrado (cuota_inicial + abonos) supera el costo de los productos.
  const { rows: creditosActivosRows } = await pool.query(`
    WITH activos AS (
      SELECT
        cr.id            AS credito_id,
        cr.factura_id,
        cr.valor_total,
        cr.cuota_inicial,
        cr.total_abonado,
        (cr.cuota_inicial + cr.total_abonado) AS total_cobrado,
        f.nombre_cliente,
        f.cedula
      FROM creditos cr
      JOIN facturas f ON f.id = cr.factura_id
      WHERE cr.sucursal_id = $1 AND cr.estado = 'Activo'
    ),
    costos AS (
      SELECT
        l.factura_id,
        SUM(
          CASE
            WHEN l.imei IS NOT NULL THEN
              ${_costoPorImei('l.imei', 'f.sucursal_id')}
            ELSE
              COALESCE(
                (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id),
                (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id),
                (SELECT pc.costo_unitario FROM productos_cantidad pc
                 WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id LIMIT 1),
                0
              ) * l.cantidad
          END
        ) AS costo_total
      FROM lineas_factura l
      JOIN facturas f ON f.id = l.factura_id
      WHERE l.factura_id IN (SELECT factura_id FROM activos)
      GROUP BY l.factura_id
    )
    SELECT
      a.credito_id,
      a.factura_id,
      a.nombre_cliente,
      a.cedula,
      a.valor_total,
      a.cuota_inicial,
      a.total_abonado,
      a.total_cobrado,
      COALESCE(c.costo_total, 0)                                AS costo_total,
      GREATEST(0, a.total_cobrado - COALESCE(c.costo_total, 0)) AS utilidad_parcial,
      GREATEST(0, COALESCE(c.costo_total, 0) - a.total_cobrado) AS falta_para_cubrir
    FROM activos a
    LEFT JOIN costos c ON c.factura_id = a.factura_id
    ORDER BY a.credito_id DESC
  `, [sucursalId]);

  const creditosActivos = creditosActivosRows.map((r) => ({
    credito_id:        Number(r.credito_id),
    factura_id:        Number(r.factura_id),
    nombre_cliente:    r.nombre_cliente,
    cedula:            r.cedula,
    valor_total:       Number(r.valor_total),
    cuota_inicial:     Number(r.cuota_inicial),
    total_abonado:     Number(r.total_abonado),
    total_cobrado:     Number(r.total_cobrado),
    costo_total:       Number(r.costo_total),
    utilidad_parcial:  Number(r.utilidad_parcial),
    falta_para_cubrir: Number(r.falta_para_cubrir),
    saldo_pendiente:   Math.max(0, Number(r.valor_total) - Number(r.cuota_inicial) - Number(r.total_abonado)),
  }));

  const creditosData = {
    saldados: creditosSaldados,
    activos: {
      total:             creditosActivos.length,
      saldo_pendiente:   creditosActivos.reduce((s, c) => s + c.saldo_pendiente, 0),
      utilidad_parcial:  creditosActivos.reduce((s, c) => s + c.utilidad_parcial, 0),
      falta_para_cubrir: creditosActivos.reduce((s, c) => s + c.falta_para_cubrir, 0),
      detalle:           creditosActivos,
    },
    resumen: {
      utilidad_confirmada: utilidadCreditosSaldados,
      total_saldados:      creditosSaldados.length,
    },
  };

  const resumen = {
    total_ventas:               facturasCompletas.reduce((s, f) => s + f.total_venta, 0),
    total_facturas:             facturasCompletas.length,
    total_retomas:              facturasCompletas.reduce((s, f) => s + f.total_retomas, 0),
    utilidad_neta_total:        soloActivas.reduce((s, f) => s + f.utilidad_neta, 0),
    facturas_activas:           soloActivas.length,
    facturas_credito:           soloCreditos.length,
    utilidad_pendiente:         0,
    utilidad_creditos_saldados: utilidadCreditosSaldados,
  };

  return { facturas: facturasCompletas, resumen, prestamos, servicios, creditos: creditosData };
};

// ─── getProductosTop ──────────────────────────────────────────────────────────

const getProductosTop = async (sucursalId, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT
      l.nombre_producto,
      SUM(l.cantidad) AS cantidad_vendida,
      SUM(l.subtotal) AS total_ventas,
      CASE
        WHEN MAX(l.imei) IS NOT NULL THEN (
          SELECT AVG(
            COALESCE(
              s.costo_compra,
              (SELECT AVG(s2.costo_compra)
               FROM seriales s2
               JOIN productos_serial ps2 ON ps2.id = s2.producto_id
               WHERE s2.producto_id = s.producto_id
                 AND ps2.sucursal_id = $1
                 AND s2.costo_compra IS NOT NULL)
            )
          )
          FROM seriales s
          JOIN productos_serial ps ON ps.id = s.producto_id
          JOIN lineas_factura lf  ON lf.imei = s.imei
          JOIN facturas ff        ON ff.id = lf.factura_id
          WHERE lf.nombre_producto = l.nombre_producto
            AND ff.sucursal_id = $1
            AND ps.sucursal_id = $1
            AND DATE(ff.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
            AND ff.estado != 'Cancelada'
        )
        ELSE (
          SELECT pc.costo_unitario
          FROM productos_cantidad pc
          WHERE pc.nombre = l.nombre_producto
            AND pc.sucursal_id = $1
          LIMIT 1
        )
      END AS costo_unitario_promedio,
      CASE WHEN MAX(l.imei) IS NOT NULL THEN 'serial' ELSE 'cantidad' END AS tipo_producto,
      COALESCE(
        (SELECT lp.nombre FROM lineas_producto lp
         JOIN productos_serial ps ON ps.linea_id = lp.id
         WHERE ps.nombre = l.nombre_producto AND ps.sucursal_id = $1 LIMIT 1),
        (SELECT lp.nombre FROM lineas_producto lp
         JOIN productos_cantidad pc ON pc.linea_id = lp.id
         WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = $1 LIMIT 1)
      ) AS linea_nombre
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
    WHERE f.sucursal_id = $1
      AND DATE(f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
      AND f.estado != 'Cancelada'
    GROUP BY l.nombre_producto
    ORDER BY cantidad_vendida DESC
    LIMIT 20
  `, [sucursalId, desde, hasta]);

  return rows.map((p) => {
    const costoTotal = p.costo_unitario_promedio !== null
      ? Number(p.costo_unitario_promedio) * Number(p.cantidad_vendida)
      : null;
    const utilidad = costoTotal !== null
      ? Number(p.total_ventas) - costoTotal
      : null;
    const margen = utilidad !== null && Number(p.total_ventas) > 0
      ? (utilidad / Number(p.total_ventas)) * 100
      : null;
    return {
      nombre_producto:         p.nombre_producto,
      tipo_producto:           p.tipo_producto,
      cantidad_vendida:        Number(p.cantidad_vendida),
      total_ventas:            Number(p.total_ventas),
      costo_unitario_promedio: p.costo_unitario_promedio !== null ? Number(p.costo_unitario_promedio) : null,
      costo_total:             costoTotal,
      utilidad,
      margen_porcentaje:       margen,
      linea_nombre:            p.linea_nombre || null,
    };
  });
};

// ─── getAnalisis ──────────────────────────────────────────────────────────────
// Datos agregados para el tab "Análisis" (gráficas). Solo admin_negocio.
//   - serie:        tendencia temporal (día/semana/mes) de ventas y utilidad
//   - composicion:  ingresos por fuente (contado, crédito, servicios, préstamos)
//   - metodos_pago: total cobrado por método en el período
//
// La utilidad respeta exactamente las reglas del resto del módulo:
//   · facturas Activas → utilidad = subtotal − costo − retomas (por fecha factura)
//   · créditos saldados → utilidad = cobrado − costo (por fecha de saldo)

const getAnalisis = async (sucursalId, desde, hasta, agrupacion) => {
  // Whitelist: nunca interpolar entrada del usuario directo en el SQL
  const unit = ({ dia: 'day', semana: 'week', mes: 'month' })[agrupacion] || 'month';

  const periodoFactura = `date_trunc('${unit}', (f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::date`;

  // Costo por línea: misma lógica que getVentasRango
  const costoLineaCase = `
    CASE
      WHEN l.imei IS NOT NULL THEN
        ${_costoPorImei('l.imei', 'f.sucursal_id')}
      ELSE
        COALESCE(
          (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id),
          (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id),
          (SELECT pc.costo_unitario FROM productos_cantidad pc
           WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id LIMIT 1),
          0
        ) * l.cantidad
    END
  `;

  const [serieResult, ventasEstadoResult, serviciosIngResult, prestamosIngResult, metodosResult] = await Promise.all([

    // ── Serie temporal ──────────────────────────────────────────────────────
    pool.query(`
      WITH por_factura AS (
        SELECT
          ${periodoFactura}        AS periodo,
          f.id                     AS factura_id,
          f.estado                 AS estado,
          SUM(l.subtotal)          AS total_venta,
          SUM(${costoLineaCase})   AS costo_total,
          COALESCE((
            SELECT SUM(r.valor_retoma) FROM retomas r WHERE r.factura_id = f.id
          ), 0)                    AS retoma
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE f.sucursal_id = $1
          AND DATE(f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
          AND f.estado != 'Cancelada'
        GROUP BY periodo, f.id, f.estado
      ),
      ventas_periodo AS (
        SELECT
          periodo,
          SUM(total_venta)                                                          AS total_vendido,
          COUNT(*)                                                                  AS num_facturas,
          SUM(costo_total)                                                          AS costo,
          SUM(CASE WHEN estado = 'Activa' THEN total_venta - costo_total - retoma ELSE 0 END) AS utilidad_activas
        FROM por_factura
        GROUP BY periodo
      ),
      ultimo_abono_credito AS (
        SELECT ac.credito_id, MAX(ac.fecha) AS fecha_saldo
        FROM abonos_credito ac
        GROUP BY ac.credito_id
      ),
      creditos_saldados AS (
        SELECT
          cr.id          AS credito_id,
          cr.factura_id,
          date_trunc('${unit}', (ua.fecha_saldo AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::date AS periodo,
          (cr.cuota_inicial + cr.total_abonado) AS total_cobrado
        FROM creditos cr
        JOIN ultimo_abono_credito ua ON ua.credito_id = cr.id
        WHERE cr.sucursal_id = $1
          AND cr.estado = 'Saldado'
          AND DATE(ua.fecha_saldo AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
      ),
      costo_credito AS (
        SELECT
          l.factura_id,
          SUM(${costoLineaCase}) AS costo_total
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE l.factura_id IN (SELECT factura_id FROM creditos_saldados)
        GROUP BY l.factura_id
      ),
      creditos_periodo AS (
        SELECT
          cs.periodo,
          SUM(cs.total_cobrado - COALESCE(cc.costo_total, 0)) AS utilidad_creditos
        FROM creditos_saldados cs
        LEFT JOIN costo_credito cc ON cc.factura_id = cs.factura_id
        GROUP BY cs.periodo
      )
      SELECT
        COALESCE(v.periodo, c.periodo)                                      AS periodo,
        COALESCE(v.total_vendido, 0)                                        AS total_vendido,
        COALESCE(v.num_facturas, 0)                                         AS num_facturas,
        COALESCE(v.costo, 0)                                                AS costo,
        COALESCE(v.utilidad_activas, 0) + COALESCE(c.utilidad_creditos, 0)  AS utilidad
      FROM ventas_periodo v
      FULL OUTER JOIN creditos_periodo c ON c.periodo = v.periodo
      ORDER BY periodo
    `, [sucursalId, desde, hasta]),

    // ── Composición: productos contado vs crédito ──────────────────────────
    pool.query(`
      SELECT
        f.estado,
        COALESCE(SUM(l.subtotal), 0) AS total
      FROM lineas_factura l
      JOIN facturas f ON f.id = l.factura_id
      WHERE f.sucursal_id = $1
        AND DATE(f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
        AND f.estado IN ('Activa', 'Credito')
      GROUP BY f.estado
    `, [sucursalId, desde, hasta]),

    // ── Composición: ingresos de servicios técnicos (cobrado en el período) ─
    pool.query(`
      SELECT COALESCE(SUM(os.total_abonado), 0) AS total
      FROM ordenes_servicio os
      WHERE os.sucursal_id = $1
        AND os.estado IN ('Entregado', 'Pendiente_pago', 'Sin_reparar')
        AND ${fechaBogota('os.fecha_entrega')} BETWEEN $2 AND $3
    `, [sucursalId, desde, hasta]),

    // ── Composición: recuperado de préstamos saldados en el período ─────────
    pool.query(`
      WITH ultimo_abono AS (
        SELECT ab.prestamo_id, MAX(ab.fecha) AS fecha_saldo
        FROM abonos_prestamo ab
        GROUP BY ab.prestamo_id
      )
      SELECT COALESCE(SUM(p.total_abonado), 0) AS total
      FROM prestamos p
      JOIN ultimo_abono ua ON ua.prestamo_id = p.id
      WHERE p.sucursal_id = $1
        AND p.estado = 'Saldado'
        AND DATE(ua.fecha_saldo AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
    `, [sucursalId, desde, hasta]),

    // ── Métodos de pago en el período ──────────────────────────────────────
    pool.query(`
      SELECT pf.metodo, COALESCE(SUM(pf.valor), 0) AS total
      FROM pagos_factura pf
      JOIN facturas f ON f.id = pf.factura_id
      WHERE f.sucursal_id = $1
        AND DATE(f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
        AND f.estado != 'Cancelada'
      GROUP BY pf.metodo
      ORDER BY total DESC
    `, [sucursalId, desde, hasta]),
  ]);

  const serie = serieResult.rows.map((r) => {
    const totalVendido = Number(r.total_vendido);
    const numFacturas  = Number(r.num_facturas);
    return {
      periodo:         r.periodo,
      total_vendido:   totalVendido,
      utilidad:        Number(r.utilidad),
      costo:           Number(r.costo),
      num_facturas:    numFacturas,
      ticket_promedio: numFacturas > 0 ? totalVendido / numFacturas : 0,
    };
  });

  const ventasPorEstado = {};
  ventasEstadoResult.rows.forEach((r) => { ventasPorEstado[r.estado] = Number(r.total); });

  const composicion = [
    { fuente: 'Contado',   total: ventasPorEstado.Activa  || 0 },
    { fuente: 'Crédito',   total: ventasPorEstado.Credito || 0 },
    { fuente: 'Servicios', total: Number(serviciosIngResult.rows[0].total) },
    { fuente: 'Préstamos', total: Number(prestamosIngResult.rows[0].total) },
  ].filter((c) => c.total > 0);

  const metodos_pago = metodosResult.rows.map((r) => ({
    metodo: r.metodo,
    total:  Number(r.total),
  }));

  return { agrupacion: unit, serie, composicion, metodos_pago };
};

// ─── getInventarioBajo ────────────────────────────────────────────────────────

const getInventarioBajo = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT id, nombre, stock, stock_minimo, unidad_medida, costo_unitario
    FROM productos_cantidad
    WHERE stock <= stock_minimo AND sucursal_id = $1 AND activo = true
    ORDER BY stock ASC
  `, [sucursalId]);
  return rows;
};

// ─── actualizarCostoCompra ────────────────────────────────────────────────────

const actualizarCostoCompra = async (sucursalId, tipo, imei, nombreProducto, nuevoCosto, productoId, varianteId, atributoId) => {
  if (tipo === 'serial') {
    const { rows: check } = await pool.query(`
      SELECT s.id
      FROM seriales s
      JOIN productos_serial ps ON ps.id = s.producto_id
      WHERE s.imei = $1 AND ps.sucursal_id = $2
      LIMIT 1
    `, [imei, sucursalId]);

    if (!check.length) {
      throw Object.assign(new Error('Serial no encontrado en esta sucursal'), { status: 404 });
    }
    await pool.query(
      'UPDATE seriales SET costo_compra = $1 WHERE id = $2',
      [nuevoCosto, check[0].id],
    );
    return { tipo: 'serial', imei, nuevo_costo: nuevoCosto };
  }

  if (tipo === 'cantidad') {
    // Prioridad: variante → atributo → producto
    if (varianteId) {
      const { rows: check } = await pool.query(`
        SELECT v.id, ap.producto_id
        FROM variantes_atributo v
        JOIN atributos_producto ap ON ap.id = v.atributo_id
        WHERE v.id = $1 AND ap.sucursal_id = $2
      `, [varianteId, sucursalId]);
      if (!check.length) throw Object.assign(new Error('Variante no encontrada en esta sucursal'), { status: 404 });
      await pool.query('UPDATE variantes_atributo SET costo_unitario = $1 WHERE id = $2', [nuevoCosto, varianteId]);
      await pool.query('UPDATE productos_cantidad SET costo_unitario = $1 WHERE id = $2', [nuevoCosto, check[0].producto_id]);
      return { tipo: 'cantidad', variante_id: varianteId, nuevo_costo: nuevoCosto };
    }

    if (atributoId) {
      const { rows: check } = await pool.query(`
        SELECT ap.id, ap.producto_id
        FROM atributos_producto ap
        WHERE ap.id = $1 AND ap.sucursal_id = $2
      `, [atributoId, sucursalId]);
      if (!check.length) throw Object.assign(new Error('Atributo no encontrado en esta sucursal'), { status: 404 });
      await pool.query('UPDATE atributos_producto SET costo_unitario = $1 WHERE id = $2', [nuevoCosto, atributoId]);
      await pool.query('UPDATE productos_cantidad SET costo_unitario = $1 WHERE id = $2', [nuevoCosto, check[0].producto_id]);
      return { tipo: 'cantidad', atributo_id: atributoId, nuevo_costo: nuevoCosto };
    }

    let check;
    if (productoId) {
      ({ rows: check } = await pool.query(
        'SELECT id FROM productos_cantidad WHERE id = $1 AND sucursal_id = $2 AND activo = true',
        [productoId, sucursalId],
      ));
    } else {
      ({ rows: check } = await pool.query(
        `SELECT id FROM productos_cantidad
         WHERE nombre = $1 AND sucursal_id = $2 AND activo = true
         LIMIT 1`,
        [nombreProducto, sucursalId],
      ));
    }

    if (!check.length) {
      throw Object.assign(new Error('Producto no encontrado en esta sucursal'), { status: 404 });
    }
    await pool.query(
      'UPDATE productos_cantidad SET costo_unitario = $1 WHERE id = $2',
      [nuevoCosto, check[0].id],
    );
    return { tipo: 'cantidad', nombre_producto: nombreProducto, nuevo_costo: nuevoCosto };
  }

  throw Object.assign(
    new Error('Tipo de producto inválido. Use "serial" o "cantidad"'),
    { status: 400 },
  );
};

// ─── getValorInventario ───────────────────────────────────────────────────────

const getValorInventario = async (sucursalId) => {
  const [serialResult, sinVariantesResult, atributosResult, variantesResult, sinCostoResult] = await Promise.all([

    // Productos seriales: sin cambios
    pool.query(`
      SELECT
        COUNT(se.id)::int                                         AS unidades,
        COALESCE(SUM(se.costo_compra),   0)::numeric             AS costo_total,
        COALESCE(SUM(ps.precio),         0)::numeric             AS precio_venta_total,
        COUNT(CASE WHEN se.costo_compra IS NULL THEN 1 END)::int AS sin_costo
      FROM seriales        se
      JOIN productos_serial ps ON ps.id = se.producto_id
      WHERE se.vendido     = false
        AND se.prestado    = false
        AND ps.activo      = true
        AND ps.sucursal_id = $1
    `, [sucursalId]),

    // Productos cantidad SIN atributos activos (sin variantes) — comportamiento original
    pool.query(`
      SELECT
        COALESCE(SUM(pc.stock),                                                     0)::int     AS unidades,
        COALESCE(SUM(pc.stock * pc.costo_unitario),                                 0)::numeric AS costo_total,
        COALESCE(SUM(pc.stock * pc.precio),                                         0)::numeric AS precio_venta_total,
        COALESCE(SUM(CASE WHEN pc.costo_unitario IS NULL THEN pc.stock ELSE 0 END), 0)::int     AS sin_costo
      FROM productos_cantidad pc
      WHERE pc.activo      = true
        AND pc.stock       > 0
        AND pc.sucursal_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM atributos_producto ap
          WHERE ap.producto_id = pc.id AND ap.activo = true
        )
    `, [sucursalId]),

    // Atributos que son hoja (tienen stock propio, sin variantes debajo)
    pool.query(`
      SELECT
        COALESCE(SUM(ap.stock),                                                     0)::int     AS unidades,
        COALESCE(SUM(ap.stock * ap.costo_unitario),                                 0)::numeric AS costo_total,
        COALESCE(SUM(ap.stock * ap.precio),                                         0)::numeric AS precio_venta_total,
        COALESCE(SUM(CASE WHEN ap.costo_unitario IS NULL THEN ap.stock ELSE 0 END), 0)::int     AS sin_costo
      FROM atributos_producto ap
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      WHERE ap.activo      = true
        AND ap.stock       > 0
        AND pc.sucursal_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM variantes_atributo v
          WHERE v.atributo_id = ap.id AND v.activo = true
        )
    `, [sucursalId]),

    // Variantes que son hoja (nivel más profundo del árbol)
    pool.query(`
      SELECT
        COALESCE(SUM(v.stock),                                                      0)::int     AS unidades,
        COALESCE(SUM(v.stock * v.costo_unitario),                                   0)::numeric AS costo_total,
        COALESCE(SUM(v.stock * v.precio),                                           0)::numeric AS precio_venta_total,
        COALESCE(SUM(CASE WHEN v.costo_unitario IS NULL THEN v.stock ELSE 0 END),   0)::int     AS sin_costo
      FROM variantes_atributo v
      JOIN atributos_producto ap ON ap.id = v.atributo_id AND ap.activo = true
      JOIN productos_cantidad pc ON pc.id = ap.producto_id AND pc.sucursal_id = $1
      WHERE v.activo = true
        AND v.stock  > 0
    `, [sucursalId]),

    // Todos los nodos hoja sin costo, para listarlos en el reporte
    pool.query(`
      SELECT 'simple'::text   AS tipo,
             pc.id::int        AS producto_id,
             pc.nombre::text   AS nombre,
             lp.nombre::text   AS linea_nombre,
             NULL::int         AS atributo_id,
             NULL::text        AS atributo_valor,
             NULL::int         AS variante_id,
             NULL::text        AS variante_valor,
             pc.stock::int     AS stock,
             NULL::text        AS imei
      FROM productos_cantidad pc
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE pc.activo = true AND pc.stock > 0 AND pc.costo_unitario IS NULL
        AND pc.sucursal_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM atributos_producto ap
          WHERE ap.producto_id = pc.id AND ap.activo = true
        )

      UNION ALL

      SELECT 'atributo'::text,
             pc.id::int,
             pc.nombre::text,
             lp.nombre::text,
             ap.id::int,
             ap.valor::text,
             NULL::int,
             NULL::text,
             ap.stock::int,
             NULL::text
      FROM atributos_producto ap
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE ap.activo = true AND ap.stock > 0 AND ap.costo_unitario IS NULL
        AND pc.sucursal_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM variantes_atributo v
          WHERE v.atributo_id = ap.id AND v.activo = true
        )

      UNION ALL

      SELECT 'variante'::text,
             pc.id::int,
             pc.nombre::text,
             lp.nombre::text,
             ap.id::int,
             ap.valor::text,
             v.id::int,
             v.valor::text,
             v.stock::int,
             NULL::text
      FROM variantes_atributo v
      JOIN atributos_producto ap ON ap.id = v.atributo_id AND ap.activo = true
      JOIN productos_cantidad pc ON pc.id = ap.producto_id AND pc.sucursal_id = $1
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE v.activo = true AND v.stock > 0 AND v.costo_unitario IS NULL

      UNION ALL

      SELECT 'serial'::text,
             ps.id::int,
             ps.nombre::text,
             lp.nombre::text,
             NULL::int,
             NULL::text,
             NULL::int,
             NULL::text,
             1::int,
             se.imei::text
      FROM seriales se
      JOIN productos_serial ps ON ps.id = se.producto_id
      LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
      WHERE se.vendido = false AND se.prestado = false
        AND ps.activo = true AND ps.sucursal_id = $1
        AND se.costo_compra IS NULL

      ORDER BY nombre, atributo_valor NULLS FIRST, variante_valor NULLS FIRST, imei NULLS FIRST
    `, [sucursalId]),
  ]);

  const serial      = serialResult.rows[0];
  const sinVar      = sinVariantesResult.rows[0];
  const conAtrib    = atributosResult.rows[0];
  const conVariante = variantesResult.rows[0];

  const serialCosto = Number(serial.costo_total);
  const serialVenta = Number(serial.precio_venta_total);

  const cantidadUnidades = Number(sinVar.unidades)    + Number(conAtrib.unidades)    + Number(conVariante.unidades);
  const cantidadCosto    = Number(sinVar.costo_total) + Number(conAtrib.costo_total) + Number(conVariante.costo_total);
  const cantidadVenta    = Number(sinVar.precio_venta_total) + Number(conAtrib.precio_venta_total) + Number(conVariante.precio_venta_total);
  const cantidadSinCosto = Number(sinVar.sin_costo)   + Number(conAtrib.sin_costo)   + Number(conVariante.sin_costo);

  return {
    serial: {
      unidades:           serial.unidades,
      costo_total:        serialCosto,
      precio_venta_total: serialVenta,
      sin_costo:          serial.sin_costo,
    },
    cantidad: {
      unidades:           cantidadUnidades,
      costo_total:        cantidadCosto,
      precio_venta_total: cantidadVenta,
      sin_costo:          cantidadSinCosto,
    },
    totales: {
      unidades:           serial.unidades + cantidadUnidades,
      costo_total:        serialCosto     + cantidadCosto,
      precio_venta_total: serialVenta     + cantidadVenta,
    },
    sin_costo_items: sinCostoResult.rows,
  };
};

module.exports = {
  getDashboard,
  getVentasRango,
  getServiciosRango,
  getAnalisis,
  getProductosTop,
  getInventarioBajo,
  actualizarCostoCompra,
  getValorInventario,
};