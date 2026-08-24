const { pool } = require('../../config/db');
const costoRed = require('../../utils/costoRed.util');

const HOY_F = `DATE(f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') = (NOW() AT TIME ZONE 'America/Bogota')::date`;
const HOY   = `DATE(fecha   AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') = (NOW() AT TIME ZONE 'America/Bogota')::date`;

// Helper timezone: columnas "timestamp without time zone" almacenadas en UTC
const fechaBogota = (col) => `(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date`;

// ── Costo de una unidad serial en un LOCAL de la red interna ─────────────────
//
// En un local, el costo real de un equipo consignado NO es `seriales.costo_compra`
// —esa es la verdad del costo de la BODEGA, que a propósito nunca se reescribe
// al remisionar— sino el `valor_interno` que la bodega le puso en la remisión:
// lo que el local tendrá que liquidarle cuando lo venda. Sin esto, el local
// vendía un equipo consignado y su utilidad salía contra el costo de la bodega
// —inflada— mientras que la de los accesorios salía bien: el mismo reporte
// midiendo con dos varas.
//
// La consulta vive en `utils/costoRed.util.js` porque la comparten los reportes
// y la valorización del inventario; el porqué de cada filtro está allá.
const _valorInternoSerial = costoRed.sqlValorInternoPorImei;
const _costoPorImei       = costoRed.sqlCostoPorImei;

// ── Devoluciones parciales (solo créditos): cantidad y subtotal EFECTIVOS ─────
// Tras una devolución parcial de crédito, la línea queda con cantidad_devuelta > 0
// pero su `cantidad`/`subtotal` originales no cambian. Los reportes deben contar
// solo lo NO devuelto. Para facturas de contado (Activa) cantidad_devuelta es
// siempre 0, por lo que estas expresiones no alteran esos casos.
// (Requiere que la tabla lineas_factura tenga alias `l`.)
const CANT_EFECTIVA     = `(l.cantidad - COALESCE(l.cantidad_devuelta, 0))`;
const SUBTOTAL_EFECTIVO = `(${CANT_EFECTIVA} * l.precio)`;

const getDashboard = async (sucursalId, negocioId = null) => {
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
                  ${_costoPorImei('l.imei', 'f.sucursal_id', 'f.fecha')}
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
                ${_costoPorImei('l.imei', 'f.sucursal_id', 'f.fecha')} * ${CANT_EFECTIVA}
              ELSE
                COALESCE(
                  (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id),
                  (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id),
                  (SELECT pc.costo_unitario FROM productos_cantidad pc
                   WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id LIMIT 1),
                  0
                ) * ${CANT_EFECTIVA}
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
    // La retoma NO se resta de la utilidad (medio de pago / activo recibido),
    // consistente con Ventas y Análisis.
    utilidad_hoy:       Number(uActiva.utilidad_bruta),
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
    // Cartera vencida (feature opt-in de mora). Se cuenta a partir de la fecha
    // límite en hora de Colombia; un documento sin plazo nunca cuenta, así que
    // un negocio sin la feature ve ceros. Los ingresos por mora del día van
    // aparte del margen de producto, nunca sumados a `utilidad_hoy`.
    cartera_vencida: await _getCarteraVencida(sucursalId),
    // Deuda con la bodega (feature opt-in de red interna). `null` para quien no
    // la tiene activa y para la bodega misma, que no se debe a sí misma.
    deuda_bodega: await _getDeudaBodega(sucursalId, negocioId),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// DEUDA CON LA BODEGA — para que el local la vea al entrar, sin buscarla.
//
// El saldo NO se recalcula aquí: se pide al service de red interna, que es
// donde vive la fórmula. Duplicarla sería tener dos verdades.
//
// Todo el bloque va en try/catch y devuelve `null` ante cualquier problema: el
// Dashboard es la primera pantalla del día y no puede caerse porque un negocio
// no tenga las tablas de la red interna instaladas.
// ─────────────────────────────────────────────────────────────────────────────
const _getDeudaBodega = async (sucursalId, negocioId) => {
  if (!negocioId || !sucursalId) return null;
  try {
    const { getConfigRed } = require('../../middlewares/redInterna.middleware');
    const config = await getConfigRed(negocioId);
    if (!config.activa || !config.bodega_id) return null;
    if (Number(config.bodega_id) === Number(sucursalId)) return null;

    const redInterna = require('../red-interna/redInterna.service');
    const { totales, por_estado } = await redInterna.getEstadoLocal(negocioId, sucursalId);
    return {
      // Lo que tiene que pagar, ya descontado su saldo a favor. Nunca negativo:
      // desde el cambio de modelo, si el crédito supera la deuda la bodega no
      // le queda debiendo plata sino mercancía (ver _armarSaldo).
      saldo:               totales.saldo_por_liquidar,
      saldo_a_favor:       totales.saldo_a_favor,
      remesas_en_transito: totales.remesas_en_transito,
      // Cuántos envíos sostienen esa deuda, para dar contexto al número.
      envios_abiertos:     totales.envios_abiertos,
      // Y cuántos equipos de esos ya se vendieron: de ahí sale la plata.
      unidades_vendidas:   (por_estado['Por liquidar']?.unidades || 0)
                         + (por_estado['En recaudo']?.unidades   || 0),
    };
  } catch {
    return null;
  }
};

// Documentos con el plazo ya pasado y saldo pendiente. Solo informativo para el
// Dashboard: no calcula la mora en pesos (eso lo hace mora.util por documento),
// solo cuántos hay y cuánto capital está vencido.
const _getCarteraVencida = async (sucursalId) => {
  const vacio = { creditos: 0, prestamos: 0, capital_vencido: 0 };
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM creditos c
          WHERE c.sucursal_id = $1 AND c.estado = 'Activo'
            AND c.fecha_limite IS NOT NULL
            AND c.fecha_limite < (NOW() AT TIME ZONE 'America/Bogota')::date
            AND (c.valor_total - c.cuota_inicial - c.total_abonado) > 0
        ) AS creditos,
        (SELECT COUNT(*)::int FROM prestamos p
          WHERE p.sucursal_id = $1 AND p.estado = 'Activo'
            AND p.fecha_limite IS NOT NULL
            AND p.fecha_limite < (NOW() AT TIME ZONE 'America/Bogota')::date
            AND (p.valor_prestamo - p.total_abonado) > 0
        ) AS prestamos,
        (
          COALESCE((SELECT SUM(c.valor_total - c.cuota_inicial - c.total_abonado) FROM creditos c
            WHERE c.sucursal_id = $1 AND c.estado = 'Activo'
              AND c.fecha_limite IS NOT NULL
              AND c.fecha_limite < (NOW() AT TIME ZONE 'America/Bogota')::date
              AND (c.valor_total - c.cuota_inicial - c.total_abonado) > 0), 0)
          +
          COALESCE((SELECT SUM(p.valor_prestamo - p.total_abonado) FROM prestamos p
            WHERE p.sucursal_id = $1 AND p.estado = 'Activo'
              AND p.fecha_limite IS NOT NULL
              AND p.fecha_limite < (NOW() AT TIME ZONE 'America/Bogota')::date
              AND (p.valor_prestamo - p.total_abonado) > 0), 0)
        )::numeric AS capital_vencido
    `, [sucursalId]);
    return {
      creditos:        Number(rows[0].creditos),
      prestamos:       Number(rows[0].prestamos),
      capital_vencido: Number(rows[0].capital_vencido),
    };
  } catch (err) {
    // La columna fecha_limite puede no existir si la migración no se aplicó.
    console.warn('[reportes] Cartera vencida no disponible:', err.message);
    return vacio;
  }
};

// ─── getServiciosRango ────────────────────────────────────────────────────────

const getServiciosRango = async (sucursalId, desde, hasta) => {

  const { rows: cerradosRaw } = await pool.query(`
    SELECT
      os.id, os.numero, os.estado, os.cliente_nombre,
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
      numero:             os.numero,
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

// ─── getMoraRango ─────────────────────────────────────────────────────────────
//
// Intereses de mora cobrados y mora condonada en el rango.
//
// IMPORTANTE: esto NO se mezcla con la utilidad del producto. La utilidad de
// créditos y préstamos se calcula como (abonado − costo) y la mora nunca entra
// en `total_abonado`; aquí se reporta aparte como ingreso financiero. Sumarla al
// margen comercial distorsionaría el margen %, la Proyección y el punto de
// equilibrio.
//
// La feature es opt-in y su migración va en try/catch, así que un negocio sin
// ella (o una base donde no se aplicó) recibe ceros en lugar de un error que
// tumbaría todo el reporte.
const getMoraRango = async (sucursalId, desde, hasta) => {
  const vacio = {
    detalle: [],
    resumen: {
      cobrada: 0, condonada: 0, cobros: 0, condonaciones: 0,
      interes_cobrado: 0, interes_condonado: 0,
    },
  };

  try {
    const { rows } = await pool.query(`
      SELECT
        mm.id, mm.concepto, mm.tipo, mm.valor, mm.metodo, mm.motivo, mm.fecha, mm.dias_mora,
        mm.credito_id, mm.prestamo_id,
        u.nombre AS usuario_nombre,
        COALESCE(f.nombre_cliente, p.prestatario) AS persona,
        f.numero AS factura_numero,
        p.numero AS prestamo_numero,
        p.nombre_producto
      FROM movimientos_mora mm
      LEFT JOIN usuarios  u ON u.id = mm.usuario_id
      LEFT JOIN creditos  c ON c.id = mm.credito_id
      LEFT JOIN facturas  f ON f.id = c.factura_id
      LEFT JOIN prestamos p ON p.id = mm.prestamo_id
      WHERE mm.sucursal_id = $1
        AND NOT mm.anulado
        AND mm.fecha::date BETWEEN $2 AND $3
      ORDER BY mm.fecha ASC
    `, [sucursalId, desde, hasta]);

    const detalle = rows.map((r) => ({
      id:              Number(r.id),
      // 'mora' | 'interes'. Las filas anteriores a la columna son de mora.
      concepto:        r.concepto || 'mora',
      tipo:            r.tipo,
      valor:           Number(r.valor),
      metodo:          r.metodo,
      motivo:          r.motivo,
      fecha:           r.fecha,
      dias_mora:       r.dias_mora != null ? Number(r.dias_mora) : null,
      persona:         r.persona,
      usuario_nombre:  r.usuario_nombre,
      // De dónde viene: una factura a crédito o un préstamo.
      origen:          r.credito_id != null ? 'credito' : 'prestamo',
      documento:       r.credito_id != null ? r.factura_numero : r.prestamo_numero,
      nombre_producto: r.nombre_producto || null,
    }));

    // Los dos cargos financieros viven en la misma tabla pero se reportan
    // aparte: la mora dice cuánto se cobró por pagar tarde, el interés cuánto
    // se cobró por financiar. Sumarlos escondería cuál de los dos negocios
    // está generando la plata.
    const suma = (t, concepto) => detalle
      .filter((d) => d.tipo === t && d.concepto === concepto)
      .reduce((s, d) => s + d.valor, 0);
    const cuenta = (t, concepto) => detalle
      .filter((d) => d.tipo === t && d.concepto === concepto).length;

    return {
      detalle,
      resumen: {
        // Se conservan los nombres históricos para la mora: los consumen el
        // resumen de reportes y el PDF.
        cobrada:           suma('Cobro', 'mora'),
        condonada:         suma('Condonacion', 'mora'),
        cobros:            cuenta('Cobro', 'mora'),
        condonaciones:     cuenta('Condonacion', 'mora'),
        interes_cobrado:   suma('Cobro', 'interes'),
        interes_condonado: suma('Condonacion', 'interes'),
      },
    };
  } catch (err) {
    console.warn('[reportes] Mora no incluida en el reporte:', err.message);
    return vacio;
  }
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
      f.id, f.numero, f.nombre_cliente, f.cedula, f.celular,
      f.fecha, f.estado, f.notas,
      COALESCE(SUM(${SUBTOTAL_EFECTIVO}), 0) AS total_venta,
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
        COALESCE(
          ${_valorInternoSerial('p.imei', 'p.sucursal_id', 'p.fecha')},
          (SELECT s.costo_compra
           FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           WHERE s.imei = p.imei AND ps.sucursal_id = p.sucursal_id
           LIMIT 1)
        )
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
    // Sin ventas puede haber igual cobros de mora de créditos viejos, así que la
    // mora se consulta también aquí y la forma del objeto se mantiene idéntica.
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
      mora: await getMoraRango(sucursalId, desde, hasta),
    };
  }

  const facturaIds = facturas.map((f) => f.id);

  const { rows: lineas } = await pool.query(`
    SELECT
      l.factura_id,
      l.nombre_producto,
      l.imei,
      ${CANT_EFECTIVA} AS cantidad,
      l.precio,
      ${SUBTOTAL_EFECTIVO} AS subtotal,
      l.producto_id,
      l.atributo_id,
      l.variante_id,
      CASE
        WHEN l.imei IS NOT NULL THEN
          ${_costoPorImei('l.imei', 'f.sucursal_id', 'f.fecha')}
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
      -- IMPORTANTE: se usan subconsultas con LIMIT 1 (no JOINs) para obtener el
      -- nombre de línea. Un mismo IMEI puede existir en varias filas de
      -- 'seriales' (constraint UNIQUE es por (imei, producto_id), no por imei),
      -- por lo que un JOIN duplicaría la línea de factura y contaría la utilidad
      -- 2 o 3 veces. La subconsulta garantiza exactamente una fila por línea.
      CASE
        WHEN l.imei IS NOT NULL THEN (
          SELECT lps.nombre
          FROM seriales s_r
          JOIN productos_serial ps_r ON ps_r.id = s_r.producto_id AND ps_r.sucursal_id = f.sucursal_id
          JOIN lineas_producto  lps  ON lps.id  = ps_r.linea_id
          WHERE s_r.imei = l.imei
          LIMIT 1
        )
        ELSE (
          SELECT lpc.nombre
          FROM productos_cantidad pc_r
          JOIN lineas_producto lpc ON lpc.id = pc_r.linea_id
          WHERE pc_r.id = l.producto_id
          LIMIT 1
        )
      END AS linea_nombre
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
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
      // La retoma NO se resta: se informa aparte (total_retomas). utilidad_neta
      // se mantiene por compatibilidad, igual a la utilidad bruta de productos.
      utilidad_neta:          utilidadBruta,
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
      f.numero         AS factura_numero,
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
      factura_numero:         cr.factura_numero,
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
        f.numero         AS factura_numero,
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
              ${_costoPorImei('l.imei', 'f.sucursal_id', 'f.fecha')} * ${CANT_EFECTIVA}
            ELSE
              COALESCE(
                (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id),
                (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id),
                (SELECT pc.costo_unitario FROM productos_cantidad pc
                 WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id LIMIT 1),
                0
              ) * ${CANT_EFECTIVA}
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
      a.factura_numero,
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
    factura_numero:    r.factura_numero,
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

  // ── Mora (feature opt-in) ─────────────────────────────────────────────────
  //
  // Va en su PROPIO renglón y NO se suma a la utilidad del producto. La utilidad
  // de créditos y préstamos se calcula como (abonado − costo); la mora nunca
  // entra en `total_abonado`, así que aquí solo se reporta como lo que es: un
  // ingreso financiero, más lo que se dejó de cobrar.
  const mora = await getMoraRango(sucursalId, desde, hasta);

  const resumen = {
    total_ventas:               facturasCompletas.reduce((s, f) => s + f.total_venta, 0),
    total_facturas:             facturasCompletas.length,
    total_retomas:              facturasCompletas.reduce((s, f) => s + f.total_retomas, 0),
    utilidad_neta_total:        soloActivas.reduce((s, f) => s + f.utilidad_neta, 0),
    facturas_activas:           soloActivas.length,
    facturas_credito:           soloCreditos.length,
    utilidad_pendiente:         0,
    utilidad_creditos_saldados: utilidadCreditosSaldados,
    // Ingresos financieros, separados del margen comercial a propósito y
    // separados entre sí: la mora es sanción por atraso, el interés es el
    // precio del plazo.
    ingresos_mora:              mora.resumen.cobrada,
    mora_condonada:             mora.resumen.condonada,
    ingresos_interes:           mora.resumen.interes_cobrado,
    interes_condonado:          mora.resumen.interes_condonado,
  };

  // Lo que la bodega le vendió a sus locales en el período. Va en su propio
  // bloque y NO se suma a `resumen`: son ventas sin factura y mezclarlas
  // rompería el cuadre entre el total y la lista de facturas de arriba. La
  // pantalla las muestra como un grupo aparte, igual que préstamos y servicios.
  const redInterna = await getVentasALocales(sucursalId, desde, hasta);

  return {
    facturas: facturasCompletas, resumen, prestamos, servicios,
    creditos: creditosData, mora, red_interna: redInterna,
  };
};

// ─── Ventas a los locales de la red (solo aplica a la BODEGA) ────────────────
//
// Con el modelo "el envío es la deuda", despachar ES vender: la bodega entrega
// mercancía a `valor_interno` y se la cobra al local. Esa operación no genera
// factura, así que no aparecía en ningún reporte — la bodega veía salir su
// inventario y su utilidad no se movía, mientras el local sí reportaba bien
// (su costo es ese mismo valor interno). El margen del grupo se perdía en el
// camino entre las dos sucursales.
//
// Qué cuenta como venta: exactamente lo que le genera CARGO al local — líneas
// `'Recibida'` de una entrega no anulada, descontando lo devuelto (un serial
// devuelto sale entero; de una línea de cantidad bajan solo las unidades que
// volvieron). Es la misma expresión que `SQL_CARGO_ENVIO`: si las dos se
// separan, la bodega reportaría una venta que el local no debe.
//
// Qué cuenta como costo: lo que le costó A LA BODEGA. Para un serial se lee en
// vivo de `seriales.costo_compra` —así una corrección del admin se refleja
// sola— y para cantidad, el `costo_origen` congelado al despachar, porque el
// promedio ponderado del nodo ya se movió.
//
// La fecha es la de RECEPCIÓN: es cuando nace la deuda. Una remesa despachada
// el 30 y recibida el 2 es venta del mes siguiente, igual para las dos partes.
//
// Devuelve null cuando no hay nada — negocio sin red, sucursal que no es la
// bodega, o un período sin despachos — y el frontend no pinta nada.
const getVentasALocales = async (sucursalId, desde, hasta) => {
  const { rows } = await pool.query(`
    WITH lineas AS (
      SELECT
        r.id                       AS remision_id,
        r.numero,
        r.sucursal_destino_id,
        COALESCE(r.fecha_recepcion, r.fecha_emision) AS fecha,
        CASE WHEN lr.tipo = 'serial' THEN 1
             ELSE GREATEST(COALESCE(lr.cantidad_recibida, lr.cantidad, 0)
                            - COALESCE(lr.cantidad_devuelta, 0), 0) END AS unidades,
        lr.valor_interno,
        CASE WHEN lr.tipo = 'serial'
             THEN COALESCE(s.costo_compra, lr.costo_origen)
             ELSE lr.costo_origen END AS costo_unitario
      FROM lineas_remision lr
      JOIN remisiones r ON r.id = lr.remision_id
      LEFT JOIN seriales s ON s.id = lr.serial_id
      WHERE r.sucursal_origen_id = $1
        AND r.tipo          = 'entrega'
        AND r.estado       <> 'Anulada'
        AND lr.estado_linea = 'Recibida'
        AND DATE(COALESCE(r.fecha_recepcion, r.fecha_emision)
              AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
    )
    SELECT
      l.remision_id,
      l.numero,
      l.sucursal_destino_id,
      su.nombre                                        AS sucursal_nombre,
      MIN(l.fecha)                                     AS fecha,
      SUM(l.unidades)::int                             AS unidades,
      SUM(l.unidades * l.valor_interno)                AS valor,
      -- Los totales se arman con las líneas MEDIBLES, no con el envío entero:
      -- descartar un envío completo porque una de sus líneas no tiene costo
      -- botaría la utilidad de las que sí lo tienen.
      COALESCE(SUM(l.unidades * l.valor_interno)
        FILTER (WHERE l.costo_unitario IS NOT NULL), 0)  AS valor_medible,
      COALESCE(SUM(l.unidades * l.costo_unitario)
        FILTER (WHERE l.costo_unitario IS NOT NULL), 0)  AS costo,
      COALESCE(SUM(l.unidades * l.valor_interno)
        FILTER (WHERE l.costo_unitario IS NULL), 0)      AS valor_sin_costo,
      COUNT(*) FILTER (WHERE l.costo_unitario IS NULL)::int AS lineas_sin_costo
    FROM lineas l
    JOIN sucursales su ON su.id = l.sucursal_destino_id
    WHERE l.unidades > 0
    GROUP BY l.remision_id, l.numero, l.sucursal_destino_id, su.nombre
    ORDER BY MIN(l.fecha) DESC
  `, [sucursalId, desde, hasta]);

  if (!rows.length) return null;

  const envios = rows.map((r) => {
    const valor          = Number(r.valor);
    const costo          = Number(r.costo);
    const valorMedible   = Number(r.valor_medible);
    const valorSinCosto  = Number(r.valor_sin_costo);
    return {
      remision_id:      Number(r.remision_id),
      numero:           r.numero,
      sucursal_id:      Number(r.sucursal_destino_id),
      sucursal_nombre:  r.sucursal_nombre,
      fecha:            r.fecha,
      unidades:         Number(r.unidades),
      valor,
      costo,
      // La fila muestra utilidad solo si TODAS sus líneas tienen costo: una
      // utilidad parcial presentada como la del envío diría que la bodega ganó
      // menos de lo que ganó. En los totales sí entra lo medible de esta fila.
      utilidad:         r.lineas_sin_costo > 0 ? null : valor - costo,
      utilidad_medible: valorMedible - costo,
      valor_sin_costo:  valorSinCosto,
      lineas_sin_costo: r.lineas_sin_costo,
    };
  });

  const suma = (f) => envios.reduce((a, e) => a + f(e), 0);
  return {
    envios,
    resumen: {
      envios:           envios.length,
      unidades:         suma((e) => e.unidades),
      valor_total:      suma((e) => e.valor),
      costo_total:      suma((e) => e.costo),
      utilidad_total:   suma((e) => e.utilidad_medible),
      // Lo que se despachó sin saber qué costó: no entra en la utilidad y hay
      // que decirlo, o el margen se lee como si fuera del total.
      valor_sin_costo:  suma((e) => e.valor_sin_costo),
      envios_sin_costo: envios.filter((e) => e.lineas_sin_costo > 0).length,
    },
  };
};

// ─── getProductosTop ──────────────────────────────────────────────────────────

const getProductosTop = async (sucursalId, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT
      l.nombre_producto,
      SUM(${CANT_EFECTIVA}) AS cantidad_vendida,
      SUM(${SUBTOTAL_EFECTIVO}) AS total_ventas,
      CASE
        WHEN MAX(l.imei) IS NOT NULL THEN (
          SELECT AVG(
            COALESCE(
              ${_valorInternoSerial('s.imei', '$1', 'ff.fecha')},
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

// ─── getVentasPorVendedor ─────────────────────────────────────────────────────
// Análisis de desempeño por vendedor (catálogo de vendedores por sucursal).
// Solo tiene sentido si el negocio activó `vendedores_activo`; si no, devuelve
// { activo:false } y el frontend muestra el aviso correspondiente.
//
// Semántica (igual que el tab "Productos" / "Análisis"):
//   · Se consideran TODAS las facturas no canceladas del rango (Activa + Credito)
//     por fecha de factura — es una vista de DESEMPEÑO de venta, no de caja.
//   · total_vendido = Σ subtotal efectivo (descuenta devoluciones parciales).
//   · utilidad      = total_vendido − costo (costo faltante se cuenta como 0,
//     idéntico a la utilidad del tab Análisis). La retoma NO se resta.
//   · Cada factura se atribuye a su vendedor_id. Las facturas sin vendedor
//     (histórico previo a activar la opción) se agrupan aparte en `sin_vendedor`.

const getVentasPorVendedor = async (sucursalId, desde, hasta) => {
  const { rows: cfg } = await pool.query(
    `SELECT cn.valor
     FROM config_negocio cn
     JOIN sucursales s ON s.negocio_id = cn.negocio_id
     WHERE s.id = $1 AND cn.clave = 'vendedores_activo'`,
    [sucursalId]
  );
  const activo = cfg[0]?.valor === '1';

  // Costo por línea: misma lógica que getAnalisis (faltante → 0).
  const costoLineaCase = `
    CASE
      WHEN l.imei IS NOT NULL THEN
        ${_costoPorImei('l.imei', 'f.sucursal_id', 'f.fecha')} * ${CANT_EFECTIVA}
      ELSE
        COALESCE(
          (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id),
          (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id),
          (SELECT pc.costo_unitario FROM productos_cantidad pc
           WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id LIMIT 1),
          0
        ) * ${CANT_EFECTIVA}
    END
  `;

  const [aggResult, topResult] = await Promise.all([
    // ── Agregado por vendedor ────────────────────────────────────────────────
    pool.query(`
      WITH agg AS (
        SELECT
          f.vendedor_id,
          COUNT(DISTINCT f.id)                  AS num_facturas,
          COALESCE(SUM(${CANT_EFECTIVA}), 0)     AS unidades,
          COALESCE(SUM(${SUBTOTAL_EFECTIVO}), 0) AS total_vendido,
          COALESCE(SUM(${costoLineaCase}), 0)    AS costo_total
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE f.sucursal_id = $1
          AND DATE(f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
          AND f.estado != 'Cancelada'
        GROUP BY f.vendedor_id
      )
      SELECT
        a.vendedor_id,
        a.num_facturas,
        a.unidades,
        a.total_vendido,
        a.costo_total,
        v.nombre AS vendedor_nombre,
        v.activo AS vendedor_activo
      FROM agg a
      LEFT JOIN vendedores v ON v.id = a.vendedor_id
      ORDER BY a.total_vendido DESC
    `, [sucursalId, desde, hasta]),

    // ── Top 5 productos por vendedor ─────────────────────────────────────────
    pool.query(`
      WITH base AS (
        SELECT
          f.vendedor_id,
          l.nombre_producto,
          SUM(${CANT_EFECTIVA})     AS cantidad,
          SUM(${SUBTOTAL_EFECTIVO}) AS total
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE f.sucursal_id = $1
          AND DATE(f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') BETWEEN $2 AND $3
          AND f.estado != 'Cancelada'
          AND f.vendedor_id IS NOT NULL
        GROUP BY f.vendedor_id, l.nombre_producto
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY vendedor_id ORDER BY cantidad DESC, total DESC) AS rn
        FROM base
      )
      SELECT vendedor_id, nombre_producto, cantidad, total
      FROM ranked
      WHERE rn <= 5
      ORDER BY vendedor_id, rn
    `, [sucursalId, desde, hasta]),
  ]);

  // Indexar top productos por vendedor
  const topPorVendedor = {};
  for (const r of topResult.rows) {
    (topPorVendedor[r.vendedor_id] ||= []).push({
      nombre_producto: r.nombre_producto,
      cantidad:        Number(r.cantidad),
      total:           Number(r.total),
    });
  }

  // Total atribuido SOLO a vendedores (excluye facturas sin vendedor).
  // Las participaciones y los totales del panel se calculan sobre esta base:
  // es una vista de desempeño de vendedores, no del total del negocio.
  const filasVendedor = aggResult.rows.filter((r) => r.vendedor_id !== null);
  const totalVendedores = filasVendedor.reduce((s, r) => s + Number(r.total_vendido), 0);

  const mapFila = (r) => {
    const totalVendido = Number(r.total_vendido);
    const costoTotal   = Number(r.costo_total);
    const numFacturas  = Number(r.num_facturas);
    const utilidad     = totalVendido - costoTotal;
    return {
      vendedor_id:       r.vendedor_id,
      vendedor_nombre:   r.vendedor_nombre,
      vendedor_activo:   r.vendedor_activo,
      num_facturas:      numFacturas,
      unidades:          Number(r.unidades),
      total_vendido:     totalVendido,
      costo_total:       costoTotal,
      utilidad,
      margen_porcentaje: totalVendido > 0 ? (utilidad / totalVendido) * 100 : null,
      ticket_promedio:   numFacturas > 0 ? totalVendido / numFacturas : 0,
      participacion:     totalVendedores > 0 ? (totalVendido / totalVendedores) * 100 : 0,
      top_productos:     topPorVendedor[r.vendedor_id] || [],
    };
  };

  const vendedores   = filasVendedor.map(mapFila);
  const sinVendRow   = aggResult.rows.find((r) => r.vendedor_id === null);
  const sin_vendedor = sinVendRow ? {
    num_facturas:  Number(sinVendRow.num_facturas),
    unidades:      Number(sinVendRow.unidades),
    total_vendido: Number(sinVendRow.total_vendido),
    utilidad:      Number(sinVendRow.total_vendido) - Number(sinVendRow.costo_total),
  } : null;

  const totales = {
    total_vendido: totalVendedores,
    num_facturas:  filasVendedor.reduce((s, r) => s + Number(r.num_facturas), 0),
    unidades:      filasVendedor.reduce((s, r) => s + Number(r.unidades), 0),
    utilidad:      filasVendedor.reduce((s, r) => s + (Number(r.total_vendido) - Number(r.costo_total)), 0),
  };

  return { activo, vendedores, sin_vendedor, totales };
};

// ─── getAnalisis ──────────────────────────────────────────────────────────────
// Datos agregados para el tab "Análisis" (gráficas). Solo admin_negocio.
//   - serie:        tendencia temporal (día/semana/mes) de ventas y utilidad
//   - composicion:  ingresos por fuente (contado, crédito, servicios, préstamos)
//   - metodos_pago: total cobrado por método en el período
//
// La utilidad respeta exactamente las reglas del resto del módulo:
//   · facturas Activas → utilidad = subtotal − costo (por fecha factura).
//     La retoma NO se resta: es un medio de pago / activo recibido, no una
//     pérdida. Coincide con la pantalla de Ventas.
//   · créditos saldados → utilidad = cobrado − costo (por fecha de saldo)

const getAnalisis = async (sucursalId, desde, hasta, agrupacion) => {
  // Whitelist: nunca interpolar entrada del usuario directo en el SQL
  const unit = ({ dia: 'day', semana: 'week', mes: 'month' })[agrupacion] || 'month';

  const periodoFactura = `date_trunc('${unit}', (f.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::date`;

  // Costo por línea: misma lógica que getVentasRango
  const costoLineaCase = `
    CASE
      WHEN l.imei IS NOT NULL THEN
        ${_costoPorImei('l.imei', 'f.sucursal_id', 'f.fecha')} * ${CANT_EFECTIVA}
      ELSE
        COALESCE(
          (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id),
          (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id),
          (SELECT pc.costo_unitario FROM productos_cantidad pc
           WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id LIMIT 1),
          0
        ) * ${CANT_EFECTIVA}
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
          SUM(${SUBTOTAL_EFECTIVO}) AS total_venta,
          SUM(${costoLineaCase})   AS costo_total
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
          -- La retoma NO se resta de la utilidad: es un medio de pago / activo
          -- recibido, no una pérdida. Coincide con la pantalla de Ventas.
          SUM(CASE WHEN estado = 'Activa' THEN total_venta - costo_total ELSE 0 END) AS utilidad_activas
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
        COALESCE(SUM(${SUBTOTAL_EFECTIVO}), 0) AS total
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
      SELECT s.id,
             ${costoRed.sqlValorInternoEnStock('s.id', 'ps.sucursal_id')} AS valor_interno
      FROM seriales s
      JOIN productos_serial ps ON ps.id = s.producto_id
      WHERE s.imei = $1 AND ps.sucursal_id = $2
      LIMIT 1
    `, [imei, sucursalId]);

    if (!check.length) {
      throw Object.assign(new Error('Serial no encontrado en esta sucursal'), { status: 404 });
    }
    // ── Una unidad consignada NO se corrige desde aquí ─────────────────────
    //
    // `costo_compra` es lo que el NEGOCIO le pagó a un proveedor externo: la
    // verdad de la bodega y la base del margen consolidado del grupo.
    // Escribirla desde el local hacía dos daños a la vez: pisaba ese dato y no
    // cambiaba una sola cifra de lo que el local ve —sus reportes toman el
    // `valor_interno`—, así que el usuario creía que no se había guardado y lo
    // repetía. Lo que hay que corregir es el valor de la línea de la remisión,
    // que tiene su propio circuito (la otra parte se entera).
    if (check[0].valor_interno != null) {
      throw Object.assign(
        new Error('Este equipo vino de la bodega: su costo es el valor de la remisión, no un costo de compra. Corrígelo desde Red interna → el envío → "Corregir valor de la línea".'),
        { status: 409, code: 'COSTO_DE_BODEGA' },
      );
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

    // ── Productos seriales ────────────────────────────────────────────────
    // En un LOCAL de la red, una unidad consignada no vale lo que le costó a la
    // bodega sino el `valor_interno` con el que se la entregaron: eso es lo que
    // el local tendrá que liquidar, y desde agosto/2026 lo debe desde que la
    // recibe. Valorarla al costo de la bodega subvalúa justo la mercancía que
    // ya es una deuda. En la bodega y en un negocio sin red el LATERAL da NULL
    // y manda `costo_compra`, como siempre.
    pool.query(`
      SELECT
        COUNT(se.id)::int                                             AS unidades,
        COALESCE(SUM(COALESCE(vi.valor, se.costo_compra)), 0)::numeric AS costo_total,
        COALESCE(SUM(ps.precio),         0)::numeric                  AS precio_venta_total,
        COUNT(CASE WHEN COALESCE(vi.valor, se.costo_compra) IS NULL THEN 1 END)::int AS sin_costo,
        -- Desglose para el local: cuánto de su vitrina es mercancía de bodega
        -- (que debe) y cuánto es suya (retomas, compras propias).
        COUNT(vi.valor)::int                                          AS unidades_bodega,
        COALESCE(SUM(vi.valor), 0)::numeric                           AS costo_bodega
      FROM seriales        se
      JOIN productos_serial ps ON ps.id = se.producto_id
      CROSS JOIN LATERAL (
        SELECT ${costoRed.sqlValorInternoEnStock('se.id', 'ps.sucursal_id')} AS valor
      ) vi
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
        -- Una unidad consignada SÍ tiene costo —el valor interno—, aunque la
        -- bodega no haya registrado el suyo. Listarla aquí mandaba al local a
        -- "arreglar" un costo que no está roto, y el arreglo escribía sobre el
        -- dato de la bodega.
        AND ${costoRed.sqlValorInternoEnStock('se.id', 'ps.sucursal_id')} IS NULL

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
      // Solo tienen valor en un local de la red; en la bodega y en un negocio
      // sin red son 0 y el frontend no pinta nada.
      unidades_bodega:    Number(serial.unidades_bodega || 0),
      costo_bodega:       Number(serial.costo_bodega    || 0),
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

// ─── PROYECCIÓN MENSUAL ────────────────────────────────────────────────────────
// Reporte "hacia adelante": estima cómo CERRARÁ el mes en curso combinando lo que
// ya se lleva vendido este mes con el ritmo histórico de los meses completos.
//
//   Promedio diario hist. = Σ ventas meses completos / (N meses × 30.44)
//   Ventas esperadas      = ventas del mes en curso + promedio diario × días restantes
//   % costo histórico      = Σ costo / Σ ventas de los meses completos
//   Costo esperado         = Ventas esperadas × % costo histórico
//   Utilidad bruta         = Ventas esperadas − Costo esperado
//   Gastos fijos           = Σ gastos_fijos activos de la sucursal (configurables)
//   Utilidad neta          = Utilidad bruta − Gastos fijos
//   Margen contrib.        = Utilidad bruta / Ventas esperadas
//   Punto equilibrio       = Gastos fijos / Margen contribución (ventas mínimas para no perder)
//
// La serie mensual reutiliza getAnalisis(agrupacion='mes'), por lo que respeta
// exactamente las reglas de utilidad del módulo (créditos, retomas, devoluciones).
// El mes en curso llega como la última fila de la serie (parcial) y se separa del
// histórico para no ensuciar el promedio, pero SÍ se usa para el run-rate.

const DIAS_MES_PROMEDIO = 30.44;

const getProyeccion = async (sucursalId, meses = 6) => {
  // Fechas ancla en hora Bogotá: ventana histórica + progreso del mes en curso.
  const { rows: [rango] } = await pool.query(`
    SELECT
      to_char(mstart - ($1 || ' months')::interval, 'YYYY-MM-DD')           AS desde,
      to_char(mstart - interval '1 day', 'YYYY-MM-DD')                      AS hasta,
      to_char(hoy, 'YYYY-MM-DD')                                            AS hoy,
      to_char(mstart, 'YYYY-MM-DD')                                         AS periodo_proyectado,
      extract(day FROM hoy)::int                                            AS dias_transcurridos,
      extract(day FROM (mstart + interval '1 month - 1 day'))::int          AS dias_mes
    FROM (
      SELECT (NOW() AT TIME ZONE 'America/Bogota') AS hoy,
             date_trunc('month', (NOW() AT TIME ZONE 'America/Bogota')) AS mstart
    ) t
  `, [meses]);

  const diasTranscurridos = Number(rango.dias_transcurridos);
  const diasMes           = Number(rango.dias_mes);
  const diasRestantes     = Math.max(0, diasMes - diasTranscurridos);

  // Serie mensual desde el inicio de la ventana hasta HOY (incluye el mes en curso
  // como última fila parcial). Misma semántica que el tab Análisis.
  const { serie } = await getAnalisis(sucursalId, rango.desde, rango.hoy, 'mes');

  // Separar meses completos (base del promedio) del mes en curso (parcial).
  const completos = serie.filter((s) => s.periodo < rango.periodo_proyectado);
  const actual    = serie.find((s) => s.periodo === rango.periodo_proyectado);

  const historial = completos.map((s) => ({
    periodo:        s.periodo,
    ventas:         Number(s.total_vendido),
    costo:          Number(s.costo),
    utilidad_bruta: Number(s.total_vendido) - Number(s.costo),
  }));

  const mesesConDatos = historial.length;
  const sumVentas = historial.reduce((a, m) => a + m.ventas, 0);
  const sumCosto  = historial.reduce((a, m) => a + m.costo,  0);

  const ventasMesActual = actual ? Number(actual.total_vendido) : 0;
  const costoMesActual  = actual ? Number(actual.costo)         : 0;

  // Promedio diario histórico; si no hay meses completos, se usa el ritmo del mes
  // en curso (run-rate puro). Si no hay nada, 0.
  const promedioDiarioHist = mesesConDatos > 0
    ? (sumVentas / mesesConDatos) / DIAS_MES_PROMEDIO
    : (diasTranscurridos > 0 ? ventasMesActual / diasTranscurridos : 0);

  // Ventas esperadas del cierre del mes = lo que ya va + lo que falta al ritmo histórico.
  const ventasEstimadas = ventasMesActual + promedioDiarioHist * diasRestantes;

  // Ritmo diario (para comparar el mes en curso contra lo normal) y escenarios.
  const ritmoActualDiario   = diasTranscurridos > 0 ? ventasMesActual / diasTranscurridos : 0;
  const promedioMensualHist = mesesConDatos > 0 ? sumVentas / mesesConDatos : 0;

  // % costo: de los meses completos; si no hay, del mes en curso.
  const pctCosto = sumVentas > 0
    ? sumCosto / sumVentas
    : (ventasMesActual > 0 ? costoMesActual / ventasMesActual : 0);
  const costoEstimado   = ventasEstimadas * pctCosto;
  const utilidadBruta   = ventasEstimadas - costoEstimado;

  // Gastos fijos configurados (activos) de la sucursal.
  const { rows: gastosFijos } = await pool.query(
    `SELECT id, nombre, valor
     FROM gastos_fijos
     WHERE sucursal_id = $1 AND activo
     ORDER BY creado_en ASC, id ASC`,
    [sucursalId],
  );
  const listaGastos     = gastosFijos.map((g) => ({ id: g.id, nombre: g.nombre, valor: Number(g.valor) }));
  const gastosFijosTotal = listaGastos.reduce((a, g) => a + g.valor, 0);

  const utilidadNeta      = utilidadBruta - gastosFijosTotal;
  const margenContribPct  = ventasEstimadas > 0 ? utilidadBruta / ventasEstimadas : 0;
  const margenNetoPct     = ventasEstimadas > 0 ? utilidadNeta  / ventasEstimadas : 0;
  // Ventas mínimas para cubrir los gastos fijos (no perder). Sin margen positivo
  // O sin gastos fijos configurados no hay punto de equilibrio útil (sería $0) → null.
  // El frontend/PDF lo muestran como "—" e invitan a configurar gastos.
  const puntoEquilibrio   = (margenContribPct > 0 && gastosFijosTotal > 0) ? gastosFijosTotal / margenContribPct : null;

  // Gastos reales registrados en Tesorería (informativo, chequeo cruzado).
  // Tesorería puede no estar instalada: si las tablas no existen, se omite.
  let gastosRealesProm = 0;
  const { rows: [tbl] } = await pool.query(`SELECT to_regclass('movimientos_dinero') AS t`);
  if (tbl.t) {
    const { rows: [g] } = await pool.query(`
      SELECT
        COALESCE(SUM(md.valor), 0) AS total,
        COUNT(DISTINCT date_trunc('month', ${fechaBogota('md.fecha')})) AS meses_con_gastos
      FROM movimientos_dinero md
      JOIN cuentas_dinero c ON c.id = md.cuenta_id
      WHERE c.sucursal_id = $1
        AND md.categoria = 'gasto'
        AND md.tipo      = 'salida'
        AND md.activo    = TRUE
        AND ${fechaBogota('md.fecha')} BETWEEN $2 AND $3
    `, [sucursalId, rango.desde, rango.hasta]);
    const nMeses = Number(g.meses_con_gastos);
    gastosRealesProm = nMeses > 0 ? Number(g.total) / nMeses : 0;
  }

  return {
    meses_historial:    meses,
    meses_con_datos:    mesesConDatos,
    // Se puede proyectar si hay meses completos O ya hay ventas este mes.
    puede_proyectar:    mesesConDatos > 0 || ventasMesActual > 0,
    rango:              { desde: rango.desde, hasta: rango.hasta },
    periodo_proyectado: rango.periodo_proyectado,
    mes_en_curso: {
      ventas:             ventasMesActual,
      dias_transcurridos: diasTranscurridos,
      dias_mes:           diasMes,
      dias_restantes:     diasRestantes,
      con_datos:          ventasMesActual > 0,
    },
    // Comparación de ritmo y escenarios de cierre (análisis del mes en curso).
    ritmo: {
      actual_diario:    ritmoActualDiario,
      historico_diario: promedioDiarioHist,
    },
    escenarios: {
      // Si el resto del mes va al ritmo de lo que llevas.
      a_este_ritmo: (diasTranscurridos > 0 && ventasMesActual > 0) ? ritmoActualDiario * diasMes : ventasEstimadas,
      // Recomendada: lo que llevas + resto al ritmo histórico.
      equilibrada:  ventasEstimadas,
      // Como un mes normal tuyo (promedio histórico).
      mes_normal:   promedioMensualHist,
    },
    historial,
    proyeccion: {
      ventas_estimadas:        ventasEstimadas,
      pct_costo:               pctCosto,
      costo_estimado:          costoEstimado,
      utilidad_bruta:          utilidadBruta,
      gastos_fijos:            gastosFijosTotal,
      utilidad_neta:           utilidadNeta,
      margen_contribucion_pct: margenContribPct,
      margen_neto_pct:         margenNetoPct,
      punto_equilibrio:        puntoEquilibrio,
    },
    gastos_fijos:       listaGastos,
    gastos_reales_prom: gastosRealesProm,
  };
};

// ─── CRUD de gastos fijos (por sucursal) ───────────────────────────────────────

const listarGastosFijos = async (sucursalId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre, valor
     FROM gastos_fijos
     WHERE sucursal_id = $1 AND activo
     ORDER BY creado_en ASC, id ASC`,
    [sucursalId],
  );
  return rows.map((g) => ({ id: g.id, nombre: g.nombre, valor: Number(g.valor) }));
};

const crearGastoFijo = async (sucursalId, nombre, valor) => {
  const { rows } = await pool.query(
    `INSERT INTO gastos_fijos (sucursal_id, nombre, valor)
     VALUES ($1, $2, $3)
     RETURNING id, nombre, valor`,
    [sucursalId, nombre.trim(), valor],
  );
  return { id: rows[0].id, nombre: rows[0].nombre, valor: Number(rows[0].valor) };
};

const actualizarGastoFijo = async (sucursalId, id, nombre, valor) => {
  const { rows } = await pool.query(
    `UPDATE gastos_fijos
     SET nombre = $3, valor = $4, actualizado_en = NOW()
     WHERE id = $1 AND sucursal_id = $2 AND activo
     RETURNING id, nombre, valor`,
    [id, sucursalId, nombre.trim(), valor],
  );
  if (!rows.length) {
    throw Object.assign(new Error('Gasto fijo no encontrado en esta sucursal'), { status: 404 });
  }
  return { id: rows[0].id, nombre: rows[0].nombre, valor: Number(rows[0].valor) };
};

// Borrado lógico (consistente con el resto del sistema).
const eliminarGastoFijo = async (sucursalId, id) => {
  const { rows } = await pool.query(
    `UPDATE gastos_fijos
     SET activo = FALSE, actualizado_en = NOW()
     WHERE id = $1 AND sucursal_id = $2 AND activo
     RETURNING id`,
    [id, sucursalId],
  );
  if (!rows.length) {
    throw Object.assign(new Error('Gasto fijo no encontrado en esta sucursal'), { status: 404 });
  }
  return { id: rows[0].id };
};

module.exports = {
  getVentasALocales,
  getDashboard,
  getVentasRango,
  getMoraRango,
  getServiciosRango,
  getAnalisis,
  getProyeccion,
  getVentasPorVendedor,
  getProductosTop,
  getInventarioBajo,
  actualizarCostoCompra,
  getValorInventario,
  listarGastosFijos,
  crearGastoFijo,
  actualizarGastoFijo,
  eliminarGastoFijo,
};