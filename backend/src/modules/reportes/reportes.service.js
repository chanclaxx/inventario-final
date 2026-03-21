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
             COALESCE(SUM(valor_total - total_abonado), 0) AS deuda_total
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
                    (SELECT pc.costo_unitario
                     FROM productos_cantidad pc
                     WHERE pc.nombre = l.nombre_producto
                       AND pc.sucursal_id = f.sucursal_id
                     LIMIT 1),
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
                    (SELECT pc.costo_unitario
                     FROM productos_cantidad pc
                     WHERE pc.nombre = l.nombre_producto
                       AND pc.sucursal_id = f.sucursal_id
                     LIMIT 1),
                    0
                  ) * l.cantidad
              END
          ) AS utilidad_bruta
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE ${HOY_F} AND f.sucursal_id = $1 AND f.estado = 'Credito'
        GROUP BY l.factura_id
      )
      SELECT
        COALESCE(SUM(c.utilidad_bruta), 0)             AS utilidad_bruta,
        COALESCE(SUM(COALESCE(r.total_retomas, 0)), 0) AS total_retomas
      FROM costo_por_linea c
      LEFT JOIN retomas_por_factura r ON r.factura_id = c.factura_id
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
      id:               os.id,
      estado:           os.estado,
      categoria,
      cliente_nombre:   os.cliente_nombre,
      equipo_nombre:    os.equipo_nombre || os.equipo_tipo || 'Equipo',
      falla_reportada:  os.falla_reportada,
      notas_tecnico:    os.notas_tecnico,
      motivo_sin_reparar: os.motivo_sin_reparar,
      precio_final:     precioFinal,
      costo_real:       costoReal,
      total_abonado:    totalAbonado,
      precio_garantia:  precioGarantia,
      costo_garantia:   costoGarantia,
      ingresos,
      costo,
      utilidad,
      saldo_pendiente:  saldoPendiente > 0 ? saldoPendiente : 0,
      fecha_recepcion:  os.fecha_recepcion,
      fecha_entrega:    os.fecha_entrega,
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
      total_cerrados:        cerrados.length,
      utilidad_confirmada:   sumarUtilidad(pagados),
      utilidad_garantias:    sumarUtilidad(garantias),
      ingresos_diagnostico:  sumarIngresos(diagnosticos),
      utilidad_pendiente:    sumarUtilidad(pendientes),
      saldo_por_cobrar:      sumarSaldo(pendientes) + sumarSaldo(garantias),
      total_ingresos:        sumarIngresos(cerrados),
      pagados:               pagados.length,
      pendientes_pago:       pendientes.length,
      diagnosticos:          diagnosticos.length,
      garantias_cobrables:   garantias.length,
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
      ${costoProductoCase}   AS costo_producto
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
      ${costoProductoCase} AS costo_producto
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
    };
  });

  const activos = activosRaw.map((p) => {
    const costo        = p.costo_producto !== null ? Number(p.costo_producto) : null;
    const totalAbonado = Number(p.total_abonado);
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
    return { facturas: [], resumen: null, prestamos, servicios };
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
      CASE
        WHEN l.imei IS NOT NULL THEN
          ${_costoPorImei('l.imei', 'f.sucursal_id')}
        ELSE
          (SELECT pc.costo_unitario
           FROM productos_cantidad pc
           WHERE pc.nombre = l.nombre_producto
             AND pc.sucursal_id = f.sucursal_id
           LIMIT 1)
      END AS costo_unitario_compra,
      CASE WHEN l.imei IS NOT NULL THEN 'serial' ELSE 'cantidad' END AS tipo_producto
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
    WHERE l.factura_id = ANY($1::int[])
    ORDER BY l.id ASC
  `, [facturaIds]);

  const lineasPorFactura = {};
  for (const linea of lineas) {
    const costoTotal = linea.costo_unitario_compra !== null
      ? Number(linea.costo_unitario_compra) * Number(linea.cantidad)
      : null;
    const utilidad = costoTotal !== null
      ? Number(linea.subtotal) - costoTotal
      : null;

    const item = {
      nombre_producto:       linea.nombre_producto,
      imei:                  linea.imei,
      cantidad:              Number(linea.cantidad),
      precio_venta:          Number(linea.precio),
      subtotal:              Number(linea.subtotal),
      costo_unitario_compra: linea.costo_unitario_compra !== null ? Number(linea.costo_unitario_compra) : null,
      costo_total:           costoTotal,
      utilidad,
      tipo_producto:         linea.tipo_producto,
    };

    if (!lineasPorFactura[linea.factura_id]) lineasPorFactura[linea.factura_id] = [];
    lineasPorFactura[linea.factura_id].push(item);
  }

  const facturasCompletas = facturas.map((f) => {
    const items         = lineasPorFactura[f.id] || [];
    const totalRetomas  = Number(f.total_retomas);
    const utilidadBruta = items.reduce(
      (acc, i) => (i.utilidad !== null ? acc + i.utilidad : acc), 0
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

  const resumen = {
    total_ventas:        facturasCompletas.reduce((s, f) => s + f.total_venta, 0),
    total_facturas:      facturasCompletas.length,
    total_retomas:       facturasCompletas.reduce((s, f) => s + f.total_retomas, 0),
    utilidad_neta_total: soloActivas.reduce((s, f) => s + f.utilidad_neta, 0),
    facturas_activas:    soloActivas.length,
    facturas_credito:    soloCreditos.length,
    utilidad_pendiente:  soloCreditos.reduce((s, f) => s + f.utilidad_neta, 0),
  };

  return { facturas: facturasCompletas, resumen, prestamos, servicios };
};

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
      CASE WHEN MAX(l.imei) IS NOT NULL THEN 'serial' ELSE 'cantidad' END AS tipo_producto
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
    };
  });
};

const getInventarioBajo = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT id, nombre, stock, stock_minimo, unidad_medida, costo_unitario
    FROM productos_cantidad
    WHERE stock <= stock_minimo AND sucursal_id = $1 AND activo = true
    ORDER BY stock ASC
  `, [sucursalId]);
  return rows;
};

const actualizarCostoCompra = async (sucursalId, tipo, imei, nombreProducto, nuevoCosto) => {
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
      [nuevoCosto, check[0].id]
    );
    return { tipo: 'serial', imei, nuevo_costo: nuevoCosto };
  }

  if (tipo === 'cantidad') {
    const { rows: check } = await pool.query(`
      SELECT id FROM productos_cantidad
      WHERE nombre = $1 AND sucursal_id = $2 AND activo = true
      LIMIT 1
    `, [nombreProducto, sucursalId]);

    if (!check.length) {
      throw Object.assign(new Error('Producto no encontrado en esta sucursal'), { status: 404 });
    }
    await pool.query(
      'UPDATE productos_cantidad SET costo_unitario = $1 WHERE id = $2',
      [nuevoCosto, check[0].id]
    );
    return { tipo: 'cantidad', nombre_producto: nombreProducto, nuevo_costo: nuevoCosto };
  }

  throw Object.assign(new Error('Tipo de producto inválido. Use "serial" o "cantidad"'), { status: 400 });
};

// CAMBIO: ahora filtra por sucursal_id en vez de negocio_id
// Cada sucursal ve solo su propio inventario
const getValorInventario = async (sucursalId) => {
  const [serialResult, cantidadResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(se.id)::int                                         AS unidades,
        COALESCE(SUM(se.costo_compra),   0)::numeric             AS costo_total,
        COALESCE(SUM(ps.precio),         0)::numeric             AS precio_venta_total,
        COUNT(CASE WHEN se.costo_compra IS NULL THEN 1 END)::int AS sin_costo
      FROM seriales        se
      JOIN productos_serial ps ON ps.id = se.producto_id
      WHERE se.vendido    = false
        AND se.prestado   = false
        AND ps.activo     = true
        AND ps.sucursal_id = $1
    `, [sucursalId]),

    pool.query(`
      SELECT
        COALESCE(SUM(pc.stock),                                                       0)::int     AS unidades,
        COALESCE(SUM(pc.stock * pc.costo_unitario),                                   0)::numeric AS costo_total,
        COALESCE(SUM(pc.stock * pc.precio),                                           0)::numeric AS precio_venta_total,
        COALESCE(SUM(CASE WHEN pc.costo_unitario IS NULL THEN pc.stock ELSE 0 END),   0)::int     AS sin_costo
      FROM productos_cantidad pc
      WHERE pc.activo      = true
        AND pc.stock       > 0
        AND pc.sucursal_id = $1
    `, [sucursalId]),
  ]);

  const serial   = serialResult.rows[0];
  const cantidad = cantidadResult.rows[0];

  const serialCosto   = Number(serial.costo_total);
  const serialVenta   = Number(serial.precio_venta_total);
  const cantidadCosto = Number(cantidad.costo_total);
  const cantidadVenta = Number(cantidad.precio_venta_total);

  return {
    serial: {
      unidades:           serial.unidades,
      costo_total:        serialCosto,
      precio_venta_total: serialVenta,
      sin_costo:          serial.sin_costo,
    },
    cantidad: {
      unidades:           cantidad.unidades,
      costo_total:        cantidadCosto,
      precio_venta_total: cantidadVenta,
      sin_costo:          cantidad.sin_costo,
    },
    totales: {
      unidades:           serial.unidades   + cantidad.unidades,
      costo_total:        serialCosto       + cantidadCosto,
      precio_venta_total: serialVenta       + cantidadVenta,
    },
  };
};

module.exports = {
  getDashboard,
  getVentasRango,
  getServiciosRango,
  getProductosTop,
  getInventarioBajo,
  actualizarCostoCompra,
  getValorInventario,
};