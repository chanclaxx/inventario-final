const { pool } = require('../../config/db');
const costoRed = require('../../utils/costoRed.util');
const obsequios = require('../../utils/obsequios.util');
const { hayObsequios } = require('../../config/columnas');

// ── Fechas: UNA sola convención ─────────────────────────────────────────────
//
// El pool corre `SET TIME ZONE 'America/Bogota'` en cada conexión, así que
// todo TIMESTAMP se guarda YA en hora de Bogotá: el día de una venta es
// `DATE(fecha)`, sin conversión. Hasta sep-2026 los reportes la leían como si
// fuera UTC (`AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'`) y la corrían 5
// horas hacia atrás: lo vendido entre las 00:00 y las 04:59 caía en el día
// anterior, mientras la mora (que nunca tuvo la conversión) caía en el día
// correcto — dos relojes en el mismo reporte. «Hoy» sí se calcula desde NOW(),
// que es un instante, y por eso ahí la zona sí va.
const HOY_F = `DATE(f.fecha) = (NOW() AT TIME ZONE 'America/Bogota')::date`;
const HOY   = `DATE(fecha) = (NOW() AT TIME ZONE 'America/Bogota')::date`;

// El día (en Bogotá) de una columna TIMESTAMP. Ver la nota de arriba.
const fechaBogota = (col) => `(${col})::date`;

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

// ─────────────────────────────────────────────────────────────────────────────
// EL COSTO DE UNA LÍNEA DE FACTURA — una sola definición para todo el módulo
//
// Antes cada reporte tenía la suya: Ventas buscaba el producto por id, el
// Dashboard, Análisis y Vendedores por NOMBRE, Productos-top también por nombre
// y además sin variantes; y lo que no tenía costo valía 0 en unos (margen del
// 100 %), el promedio del modelo en otros y «sin costo» en otros. El mismo
// producto salía con utilidades distintas según la pestaña.
//
// La regla ahora es una: el nodo exacto de la línea (IMEI → valor interno o
// costo de esa unidad; variante; atributo; producto por id; y solo si la línea
// no guarda id, el producto por nombre). Si no hay costo, NULL.
//
// Y NULL significa «sin costo»: esa línea NO suma utilidad (en SQL,
// `subtotal − NULL` es NULL y SUM la ignora) y el reporte lo cuenta aparte.
// Nunca se inventa una ganancia. Requiere los alias `l` (línea) y `f` (factura).
const SQL_COSTO_UNIT_LINEA = `
  CASE
    WHEN l.imei IS NOT NULL THEN
      ${_costoPorImei('l.imei', 'f.sucursal_id', 'f.fecha', 'f.id')}
    WHEN l.variante_id IS NOT NULL THEN
      (SELECT v.costo_unitario FROM variantes_atributo v WHERE v.id = l.variante_id)
    WHEN l.atributo_id IS NOT NULL THEN
      (SELECT ap.costo_unitario FROM atributos_producto ap WHERE ap.id = l.atributo_id)
    WHEN l.producto_id IS NOT NULL THEN
      (SELECT pc.costo_unitario FROM productos_cantidad pc WHERE pc.id = l.producto_id)
    ELSE
      (SELECT pc.costo_unitario FROM productos_cantidad pc
       WHERE pc.nombre = l.nombre_producto AND pc.sucursal_id = f.sucursal_id
       ORDER BY pc.activo DESC, pc.id
       LIMIT 1)
  END`;

// Costo de la línea por sus unidades EFECTIVAS (descontadas las devueltas).
const SQL_COSTO_LINEA = `((${SQL_COSTO_UNIT_LINEA}) * ${CANT_EFECTIVA})`;

// ─────────────────────────────────────────────────────────────────────────────
// EL COSTO DE UN CRÉDITO — una sola definición para Ventas, Análisis, Dashboard
// y la utilidad esperada
//
// La utilidad de un crédito es lo COBRADO menos el costo de sus productos. Dos
// errores que tenía:
//   · Ventas sacaba ese costo de las facturas HECHAS en el rango del reporte:
//     un crédito vendido en junio y saldado en julio aparecía en julio con
//     costo 0, o sea con todo lo cobrado como utilidad. Aquí el costo se lee
//     de las líneas de SU factura, sea de cuando sea.
//   · Si un producto no tenía costo, se restaba lo que hubiera y la utilidad
//     salía inflada. Ahora se cuenta solo la PARTE MEDIBLE: lo cobrado en
//     proporción al valor de las líneas que sí tienen costo, menos ese costo
//     (el mismo criterio de los envíos de la red: se mide por línea, no se bota
//     la operación entera). Sin ninguna línea con costo, la proporción es NULL
//     y toda cifra que la use sale NULL («sin costo»), nunca 0.
//
// `csSql` es el SELECT de los créditos a medir; debe traer `factura_id`.
// Devuelve sus columnas + `costo_total`, `lineas_sin_costo` y
// `proporcion_medible` (1 = todo tiene costo · NULL = nada lo tiene).
const _sqlCostoCreditos = (csSql) => `
  WITH cs AS (${csSql}),
  lin AS (
    SELECT l.factura_id,
           ${SUBTOTAL_EFECTIVO} AS subtotal,
           ${SQL_COSTO_LINEA}   AS costo
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
    WHERE l.factura_id IN (SELECT factura_id FROM cs)
  ),
  agg AS (
    SELECT factura_id,
           SUM(subtotal)                                  AS valor_lineas,
           SUM(subtotal) FILTER (WHERE costo IS NOT NULL) AS valor_medible,
           COALESCE(SUM(costo), 0)                        AS costo,
           COUNT(*) FILTER (WHERE costo IS NULL)::int     AS lineas_sin_costo,
           COUNT(*) FILTER (WHERE costo IS NOT NULL)::int AS lineas_con_costo
    FROM lin GROUP BY factura_id
  )
  SELECT cs.*,
         COALESCE(a.costo, 0)               AS costo_total,
         COALESCE(a.lineas_sin_costo, 0)    AS lineas_sin_costo,
         CASE
           WHEN COALESCE(a.lineas_sin_costo, 0) > 0 AND COALESCE(a.lineas_con_costo, 0) = 0 THEN NULL
           WHEN COALESCE(a.valor_lineas, 0) > 0 THEN COALESCE(a.valor_medible, 0) / a.valor_lineas
           ELSE 1
         END                                AS proporcion_medible
  FROM cs LEFT JOIN agg a ON a.factura_id = cs.factura_id`;

// Créditos SALDADOS en un rango ($1 sucursal, $2 desde, $3 hasta), con su
// utilidad ya calculada. La fecha de saldo es la del último abono VIGENTE (un
// abono anulado no cerró nada).
const SQL_CREDITOS_SALDADOS = `
  SELECT x.*, x.total_cobrado * x.proporcion_medible - x.costo_total AS utilidad
  FROM (${_sqlCostoCreditos(`
    SELECT cr.id AS credito_id, cr.factura_id, ua.fecha_saldo,
           cr.valor_total, cr.cuota_inicial, cr.total_abonado,
           (cr.cuota_inicial + cr.total_abonado) AS total_cobrado
    FROM creditos cr
    JOIN (
      SELECT ac.credito_id, MAX(ac.fecha) AS fecha_saldo
      FROM abonos_credito ac
      WHERE NOT ac.anulado
      GROUP BY ac.credito_id
    ) ua ON ua.credito_id = cr.id
    WHERE cr.sucursal_id = $1
      AND cr.estado = 'Saldado'
      AND DATE(ua.fecha_saldo) BETWEEN $2 AND $3
  `)}) x`;

// Hoy en Bogotá como 'YYYY-MM-DD', para las consultas que piden un rango.
const _hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

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

    // ── Utilidad de las ventas de CONTADO de hoy ────────────────────────────
    // Línea por línea con el costo único del módulo (SQL_COSTO_LINEA): una
    // línea sin costo no suma (subtotal − NULL = NULL) y se cuenta aparte.
    // La retoma NO se resta: es un medio de pago, no una pérdida.
    pool.query(`
      SELECT
        COALESCE(SUM(${SUBTOTAL_EFECTIVO} - ${SQL_COSTO_LINEA}), 0) AS utilidad_bruta,
        COUNT(*) FILTER (WHERE ${SQL_COSTO_LINEA} IS NULL)::int     AS lineas_sin_costo
      FROM lineas_factura l
      JOIN facturas f ON f.id = l.factura_id
      WHERE ${HOY_F} AND f.sucursal_id = $1 AND f.estado = 'Activa'
    `, [sucursalId]),

    // ── Utilidad de los créditos SALDADOS hoy ────────────────────────────────
    // La misma definición que Ventas y Análisis (SQL_CREDITOS_SALDADOS).
    pool.query(`
      SELECT COALESCE(SUM(cs.utilidad), 0) AS utilidad_bruta,
             COUNT(*) FILTER (WHERE cs.lineas_sin_costo > 0)::int AS con_costo_incompleto
      FROM (${SQL_CREDITOS_SALDADOS}) cs
    `, [sucursalId, _hoyIso(), _hoyIso()]),
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
    // Líneas de contado de hoy sin costo registrado: no suman a utilidad_hoy.
    utilidad_hoy_sin_costo: Number(uActiva.lineas_sin_costo || 0),
    // Nombre histórico: es la utilidad de los créditos SALDADOS hoy (así la
    // rotula la pantalla). Se conserva por compatibilidad.
    utilidad_pendiente: Number(uCredito.utilidad_bruta),
    utilidad_creditos_saldados_hoy: Number(uCredito.utilidad_bruta),
    // Lo que va a dejar lo que HOY se dio a plazo (créditos, préstamos,
    // despachos), si se paga completo. No es utilidad real: esa es la de arriba.
    utilidad_esperada_hoy: await _utilidadEsperadaHoy(sucursalId),
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
// Solo las cifras (sin el detalle de cada documento): el Dashboard es la
// primera pantalla del día y no carga listas. Nunca lanza.
const _utilidadEsperadaHoy = async (sucursalId) => {
  try {
    const hoy = _hoyIso();
    const u = await getUtilidadEsperadaRango(sucursalId, hoy, hoy);
    if (!u) return null;
    const corto = (b) => (b ? { cantidad: b.cantidad, esperada: b.esperada, sin_costo: b.sin_costo } : null);
    return { creditos: corto(u.creditos), prestamos: corto(u.prestamos), envios: corto(u.envios), total: u.total };
  } catch (err) {
    console.warn('[reportes] Utilidad esperada de hoy no disponible:', err.message);
    return null;
  }
};

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
      // La mora de los envíos vencidos (opt-in): aparte del saldo de la
      // mercancía, y sumada en `total_a_pagar`, que es lo que se entrega.
      mora_pendiente:      totales.mora_pendiente || 0,
      envios_vencidos:     totales.envios_vencidos || 0,
      dias_max_vencido:    totales.dias_max_vencido || 0,
      total_a_pagar:       totales.total_a_pagar ?? totales.saldo_por_liquidar,
      proximo_vencimiento: totales.proximo_vencimiento || null,
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

// Costo del producto de un préstamo (alias `p`). Un serial en un local de la
// red se mide contra su valor interno, igual que en ventas.
const SQL_COSTO_PRESTAMO = `
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

// El nombre de la línea de producto de una línea de factura. Subconsultas con
// LIMIT 1 y no JOINs: un IMEI tiene varias filas en `seriales` y un JOIN
// duplicaría la línea (y su utilidad).
const SQL_LINEA_NOMBRE = `
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
  END`;

const _n = (v) => (v == null ? null : Number(v));

/**
 * Los créditos de un período, con su utilidad: los SALDADOS en el rango (por la
 * fecha del último abono vigente) y los ACTIVOS hoy.
 *
 * Todo sale de `_sqlCostoCreditos`: el costo de cada crédito se lee de SU
 * factura, sea del período que sea (el error que tenía: tomarlo de las
 * facturas del rango y dar costo 0 a un crédito vendido el mes anterior).
 * Lo que no tiene costo se mide por la parte que sí lo tiene y se marca.
 */
const _creditosDelRango = async (sucursalId, desde, hasta) => {
  const [{ rows: saldadosRows }, { rows: activosRows }] = await Promise.all([
    pool.query(`
      SELECT cs.*, f.numero AS factura_numero, f.nombre_cliente, f.cedula, f.fecha AS fecha_factura
      FROM (${SQL_CREDITOS_SALDADOS}) cs
      JOIN facturas f ON f.id = cs.factura_id
      ORDER BY cs.fecha_saldo DESC
    `, [sucursalId, desde, hasta]),
    pool.query(`
      SELECT x.*, f.numero AS factura_numero, f.nombre_cliente, f.cedula
      FROM (${_sqlCostoCreditos(`
        SELECT cr.id AS credito_id, cr.factura_id,
               cr.valor_total, cr.cuota_inicial, cr.total_abonado,
               (cr.cuota_inicial + cr.total_abonado) AS total_cobrado
        FROM creditos cr
        WHERE cr.sucursal_id = $1 AND cr.estado = 'Activo'
      `)}) x
      JOIN facturas f ON f.id = x.factura_id
      ORDER BY x.credito_id DESC
    `, [sucursalId]),
  ]);

  // Los productos de cada crédito saldado, para el desglose de la pantalla.
  const ids = saldadosRows.map((r) => Number(r.factura_id));
  const { rows: productos } = ids.length
    ? await pool.query(`
        SELECT l.factura_id, l.nombre_producto, l.imei, l.precio,
               ${SQL_COSTO_UNIT_LINEA} AS costo,
               ${SQL_LINEA_NOMBRE}     AS linea_nombre
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE l.factura_id = ANY($1::int[])
        ORDER BY l.id
      `, [ids])
    : { rows: [] };
  const productosPor = new Map();
  for (const pr of productos) {
    const k = Number(pr.factura_id);
    if (!productosPor.has(k)) productosPor.set(k, []);
    productosPor.get(k).push({
      nombre: pr.nombre_producto, imei: pr.imei, precio: Number(pr.precio),
      costo: _n(pr.costo), linea_nombre: pr.linea_nombre || null,
    });
  }

  const saldados = saldadosRows.map((cr) => ({
    credito_id:             Number(cr.credito_id),
    factura_id:             Number(cr.factura_id),
    factura_numero:         cr.factura_numero,
    nombre_cliente:         cr.nombre_cliente,
    cedula:                 cr.cedula,
    valor_total:            Number(cr.valor_total),
    cuota_inicial:          Number(cr.cuota_inicial),
    total_abonado:          Number(cr.total_abonado),
    total_cobrado:          Number(cr.total_cobrado),
    fecha_factura:          cr.fecha_factura,
    fecha_saldo:            cr.fecha_saldo,
    // NULL = ningún producto tiene costo: no hay utilidad que decir.
    utilidad:               cr.utilidad == null ? null : Math.round(Number(cr.utilidad)),
    tiene_costo_incompleto: Number(cr.lineas_sin_costo) > 0,
    productos:              productosPor.get(Number(cr.factura_id)) || [],
  }));

  const activos = activosRows.map((r) => {
    const prop     = _n(r.proporcion_medible);
    const costo    = Number(r.costo_total);
    const cobrado  = Number(r.total_cobrado);
    const valor    = Number(r.valor_total);
    const medido   = prop == null ? null : cobrado * prop;
    return {
      credito_id:        Number(r.credito_id),
      factura_id:        Number(r.factura_id),
      factura_numero:    r.factura_numero,
      nombre_cliente:    r.nombre_cliente,
      cedula:            r.cedula,
      valor_total:       valor,
      cuota_inicial:     Number(r.cuota_inicial),
      total_abonado:     Number(r.total_abonado),
      total_cobrado:     cobrado,
      costo_total:       costo,
      // Solo hay utilidad una vez que lo cobrado supera el costo (de la parte
      // medible). NULL si ningún producto tiene costo.
      utilidad_parcial:  medido == null ? null : Math.round(Math.max(0, medido - costo)),
      falta_para_cubrir: medido == null ? null : Math.round(Math.max(0, costo - medido)),
      // Lo que dejará cuando se pague completo (informativa, no se suma a nada).
      utilidad_esperada: prop == null ? null : Math.round(valor * prop - costo),
      sin_costo:         Number(r.lineas_sin_costo) > 0,
      saldo_pendiente:   Math.max(0, valor - Number(r.cuota_inicial) - Number(r.total_abonado)),
    };
  });

  const suma = (arr, k) => arr.reduce((s, x) => (x[k] == null ? s : s + x[k]), 0);
  return {
    saldados,
    activos: {
      total:             activos.length,
      saldo_pendiente:   suma(activos, 'saldo_pendiente'),
      utilidad_parcial:  suma(activos, 'utilidad_parcial'),
      falta_para_cubrir: suma(activos, 'falta_para_cubrir'),
      utilidad_esperada: suma(activos, 'utilidad_esperada'),
      sin_costo:         activos.filter((c) => c.sin_costo).length,
      detalle:           activos,
    },
    resumen: {
      utilidad_confirmada: suma(saldados, 'utilidad'),
      total_saldados:      saldados.length,
      con_costo_incompleto: saldados.filter((c) => c.tiene_costo_incompleto).length,
    },
  };
};

/**
 * LA UTILIDAD DEL PERÍODO — una sola definición para Ventas, Análisis, el PDF y
 * la Proyección.
 *
 * Antes cada pantalla sumaba cosas distintas bajo la misma palabra: Análisis y
 * el PDF solo contado + créditos saldados; Ventas mostraba además préstamos,
 * servicios y despachos, pero sueltos. Ahora «utilidad del período» es:
 *
 *   contado (línea por línea) + créditos saldados + préstamos saldados
 *   + servicios (pagados y garantías cobrables) + lo COBRADO de los despachos
 *   a locales (utilidad realizada de la bodega)
 *
 * La mora y el interés NO entran: son ingreso financiero y van aparte. Lo que
 * no tiene costo no suma y se cuenta en `sin_costo`.
 */
const _utilidadDelPeriodo = ({ facturas, creditos, prestamos, servicios, redInterna }) => {
  const activas = facturas.filter((f) => f.estado === 'Activa');
  const partes = {
    contado:   activas.reduce((s, f) => s + Number(f.utilidad_neta || 0), 0),
    creditos:  Number(creditos?.resumen?.utilidad_confirmada || 0),
    prestamos: Number(prestamos?.resumen?.utilidad_confirmada || 0),
    servicios: Number(servicios?.resumen?.utilidad_confirmada || 0)
             + Number(servicios?.resumen?.utilidad_garantias || 0),
    despachos: Number(redInterna?.resumen?.utilidad_realizada || 0),
  };
  const sinCosto = {
    lineas_contado: activas.reduce(
      (n, f) => n + f.lineas.filter((l) => l.costo_unitario_compra === null).length, 0),
    creditos:  Number(creditos?.resumen?.con_costo_incompleto || 0),
    prestamos: (prestamos?.saldados || []).filter((p) => p.utilidad === null).length,
    servicios: (servicios?.cerrados || [])
      .filter((o) => (o.categoria === 'pagado' || o.categoria === 'garantia') && o.utilidad === null).length,
    despachos: Number(redInterna?.resumen?.envios_sin_costo || 0),
  };
  return {
    ...partes,
    total: Object.values(partes).reduce((s, v) => s + v, 0),
    sin_costo: { ...sinCosto, total: Object.values(sinCosto).reduce((s, v) => s + v, 0) },
  };
};

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
      AND DATE(f.fecha) BETWEEN $2 AND $3
      AND f.estado != 'Cancelada'
    GROUP BY f.id, r.total_retomas
    ORDER BY f.fecha DESC
  `, [sucursalId, desde, hasta]);

  // El costo de un préstamo vive a nivel de módulo: lo comparte la utilidad
  // esperada (getUtilidadEsperadaRango), y dos copias acabarían midiendo distinto.
  const costoProductoCase = SQL_COSTO_PRESTAMO;

  const { rows: saldadosRaw } = await pool.query(`
    WITH prestamos_sucursal AS (
      SELECT id FROM prestamos WHERE sucursal_id = $1 AND estado = 'Saldado'
    ),
    ultimo_abono AS (
      SELECT
        ab.prestamo_id,
        MAX(ab.fecha) AS fecha_saldo
      FROM abonos_prestamo ab
      JOIN prestamos_sucursal ps ON ps.id = ab.prestamo_id
      -- Un abono anulado no cerró nada: la fecha de saldo es la del último vigente.
      WHERE NOT ab.anulado
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
      // Lo que dejará cuando se pague COMPLETO. Informativa: la real sigue
      // siendo la de arriba, que solo cuenta lo cobrado.
      utilidad_esperada: costo !== null ? valorPrestamo - costo : null,
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
      utilidad_esperada:    activos.reduce((s, p) => (p.utilidad_esperada !== null ? s + p.utilidad_esperada : s), 0),
      total_saldados:       saldados.length,
      total_activos:        activos.length,
    },
  };

  const servicios = await getServiciosRango(sucursalId, desde, hasta);

  // Sin facturas en el período el reporte NO se corta: puede haber créditos
  // que se terminaron de pagar, préstamos, servicios o despachos a locales. El
  // atajo que había aquí devolvía todo eso vacío (o ni lo mandaba).

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
      -- Lo que se regaló con la venta. Su COSTO se calcula igual que el de
      -- cualquier otra línea (abajo), y como su subtotal es 0 la utilidad de la
      -- línea sale negativa por exactamente lo que costó: eso es lo que hace
      -- que el obsequio baje la utilidad de la factura sin ningún cálculo
      -- aparte. Aquí solo viaja la MARCA, para poder decirlo en pantalla.
      ${obsequios.selObsequio('l')},
      -- NULL = sin costo registrado (la línea no suma utilidad y se marca).
      ${SQL_COSTO_UNIT_LINEA} AS costo_unitario_compra,
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
      obsequio:              linea.obsequio === true,
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
      // Cuántas unidades se regalaron en esta factura. Sin costo, a propósito:
      // el apartado de obsequios no lleva cifras de costo para nadie. Lo que el
      // regalo costó ya está DENTRO de `utilidad_bruta` (su línea cobró 0).
      unidades_obsequio:      items.reduce((s2, i) => (i.obsequio ? s2 + i.cantidad : s2), 0),
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
  //
  // Antes de ponerla en 0 se guarda lo que DEJARÍA si se paga completo
  // (`utilidad_esperada`, precio − costo), para mostrarla al lado como un número
  // pequeño. Es informativa: ninguna suma la lee, y la utilidad real sigue en 0.
  // `en_credito` le dice a la pantalla que al editar un costo recalcule la
  // esperada y no la real.
  for (const fc of soloCreditos) {
    fc.utilidad_esperada      = fc.tiene_costo_incompleto && fc.utilidad_bruta === 0 ? null : fc.utilidad_bruta;
    fc.utilidad_bruta         = 0;
    fc.utilidad_neta          = 0;
    fc.tiene_costo_incompleto = false;
    for (const linea of fc.lineas) {
      linea.utilidad_esperada = linea.utilidad;
      linea.en_credito        = true;
      linea.utilidad          = 0;
    }
  }

  // ── Créditos: saldados en el rango y activos ──────────────────────────────
  // Se calculan con su propia consulta (_creditosDelRango), NO con las facturas
  // de arriba: un crédito se vende un mes y se termina de pagar otro, y su costo
  // está en SU factura, sea del período que sea.
  const creditosData = await _creditosDelRango(sucursalId, desde, hasta);
  const utilidadCreditosSaldados = creditosData.resumen.utilidad_confirmada;

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
    // Obsequios del período, en UNIDADES (el apartado no lleva costo para
    // nadie). Su costo ya está dentro de `utilidad_neta_total`.
    unidades_obsequio:          facturasCompletas.reduce((s2, f) => s2 + f.unidades_obsequio, 0),
    facturas_con_obsequio:      facturasCompletas.filter((f) => f.unidades_obsequio > 0).length,
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
  // La mora que la bodega le cobró a sus locales en el período: ingreso
  // FINANCIERO, nunca margen comercial. Va en su propio sub-bloque y no toca
  // `utilidad_realizada` (esa mide cobrado − costo con los abonos a capital).
  const moraRed = await getMoraEnviosRango(sucursalId, desde, hasta);
  const redInternaConMora = moraRed
    ? { ...(redInterna || { envios: [], resumen: null }), mora: moraRed }
    : redInterna;

  // Lo que se regaló en el período. Va en su propio bloque y NO se resta de
  // `resumen`: el costo de un obsequio YA está dentro de la utilidad de arriba
  // (su línea cobró 0 y costó lo que costó). Aquí se responde otra pregunta,
  // la de control: qué se regala, quién lo regala y cuánto cuesta.
  const obsequiosRango = await getObsequiosRango(sucursalId, desde, hasta);

  const utilidadPeriodo = _utilidadDelPeriodo({
    facturas: facturasCompletas, creditos: creditosData, prestamos, servicios, redInterna,
  });

  return {
    facturas: facturasCompletas,
    // Sin facturas no hay métricas de facturación que mostrar (la pantalla
    // esconde el bloque), pero todo lo demás sí viaja.
    resumen: facturasCompletas.length ? resumen : null,
    prestamos, servicios,
    creditos: creditosData, mora, red_interna: redInternaConMora,
    // LA utilidad del período, con la misma definición que Análisis, el PDF y
    // la Proyección: contado + créditos saldados + préstamos saldados +
    // servicios + lo cobrado de los despachos a locales.
    utilidad_periodo: utilidadPeriodo,
    // Lo que va a dejar lo otorgado a plazo en el período, si se paga completo.
    // Aparte, informativa: nunca se suma a la utilidad real.
    utilidad_esperada: await getUtilidadEsperadaRango(sucursalId, desde, hasta),
    obsequios: obsequiosRango,
  };
};

// ─── Obsequios del período (feature opt-in) ──────────────────────────────────
//
// «¿Qué se está regalando y quién lo regala?» Un obsequio cobra 0, así que no
// aparece en ninguna cifra de ingresos: sin este bloque, «¿alguien está
// regalando de más?» solo se podía responder abriendo factura por factura.
//
// **ESTE BLOQUE NO LLEVA NINGÚN COSTO, PARA NADIE** (decisión del negocio,
// sep-2026). Ni se calcula ni viaja en el JSON: lo que no sale de la base no se
// puede filtrar desde la consola del navegador. El control se hace con
// UNIDADES —qué producto, cuántas veces, quién lo dio, en qué factura— que es
// lo que de verdad dice si alguien regala de más. Lo que el regalo le costó al
// negocio ya está dentro de la utilidad de la venta (su línea cobra 0 y cuesta
// lo que cuesta), y ahí se queda. Si alguien agrega aquí un campo de costo,
// tiene que volver a preguntar.
//
// Devuelve `null` cuando no hay nada que contar (feature apagada, columna
// ausente, o un período sin un solo obsequio) y la pantalla no pinta nada. Es
// el mismo criterio del resumen de avisos: un panel que dice «no regalaste
// nada» entrena a la gente a ignorarlo.
//
// QUIÉN LO DIO: `facturas.usuario_id` — quién hizo la venta, que existe
// siempre. `vendedor_id` (feature opt-in de vendedores) viaja aparte en cada
// factura, para el negocio que además atribuye la venta a un vendedor: son dos
// preguntas distintas y la de control es la primera.
//
// TODO se deriva de las líneas: no hay un solo contador guardado que cancelar
// una factura o devolver un producto tendría que ir a corregir. Las facturas
// canceladas quedan fuera (la venta no existe) y la devolución parcial
// descuenta con `CANT_EFECTIVA`, igual que en el resto del reporte.
const getObsequiosRango = async (sucursalId, desde, hasta) => {
  if (!hayObsequios()) return null;

  // Una sola pasada por las líneas regaladas: de ahí salen los tres cortes
  // (por producto, por responsable y por factura). Agruparlo tres veces en SQL
  // costaría tres recorridos de la misma tabla para el mismo período.
  const { rows } = await pool.query(`
    SELECT
      f.id                AS factura_id,
      f.numero            AS factura_numero,
      f.fecha,
      f.nombre_cliente,
      f.usuario_id,
      u.nombre            AS usuario_nombre,
      v.nombre            AS vendedor_nombre,
      l.nombre_producto,
      l.imei,
      ${CANT_EFECTIVA}    AS cantidad
    FROM lineas_factura l
    JOIN facturas   f ON f.id = l.factura_id
    LEFT JOIN usuarios   u ON u.id = f.usuario_id
    LEFT JOIN vendedores v ON v.id = f.vendedor_id
    WHERE f.sucursal_id = $1
      AND DATE(f.fecha) BETWEEN $2 AND $3
      AND f.estado != 'Cancelada'
      AND l.obsequio = TRUE
      AND ${CANT_EFECTIVA} > 0
    ORDER BY f.fecha DESC, l.id ASC
  `, [sucursalId, desde, hasta]);

  if (!rows.length) return null;

  let unidades = 0;
  const porProducto    = new Map();
  const porResponsable = new Map();
  const porFactura     = new Map();

  for (const r of rows) {
    const cantidad = Number(r.cantidad);
    unidades += cantidad;

    const prod = porProducto.get(r.nombre_producto) || {
      nombre_producto: r.nombre_producto, unidades: 0, facturas: new Set(),
    };
    prod.unidades += cantidad;
    prod.facturas.add(r.factura_id);
    porProducto.set(r.nombre_producto, prod);

    const claveResp = r.usuario_id ?? 0;
    const resp = porResponsable.get(claveResp) || {
      usuario_id:     r.usuario_id ?? null,
      usuario_nombre: r.usuario_nombre || 'Sin usuario',
      unidades: 0, facturas: new Set(),
    };
    resp.unidades += cantidad;
    resp.facturas.add(r.factura_id);
    porResponsable.set(claveResp, resp);

    const fac = porFactura.get(r.factura_id) || {
      factura_id:      r.factura_id,
      factura_numero:  r.factura_numero,
      fecha:           r.fecha,
      nombre_cliente:  r.nombre_cliente,
      usuario_nombre:  r.usuario_nombre  || null,
      vendedor_nombre: r.vendedor_nombre || null,
      unidades: 0, lineas: [],
    };
    fac.unidades += cantidad;
    fac.lineas.push({ nombre_producto: r.nombre_producto, imei: r.imei || null, cantidad });
    porFactura.set(r.factura_id, fac);
  }

  const conConteo = (x) => ({ ...x, facturas: x.facturas.size });
  const porUnidades = (a, b) => b.unidades - a.unidades || b.facturas - a.facturas;

  return {
    resumen: {
      unidades,
      facturas:   porFactura.size,
      productos:  porProducto.size,
      // Cuánto se regala en una venta que lleva regalo. Sirve para comparar
      // personas y semanas sin tener que dividir a mano.
      unidades_por_factura: porFactura.size > 0 ? unidades / porFactura.size : 0,
    },
    productos:    [...porProducto.values()].map(conConteo).sort(porUnidades),
    responsables: [...porResponsable.values()].map(conConteo).sort(porUnidades),
    // Las facturas con más unidades regaladas primero: es por donde empieza la
    // revisión, no por lo que pasó ayer.
    facturas: [...porFactura.values()].sort((a, b) => b.unidades - a.unidades),
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
// CUÁNDO HAY UTILIDAD: cuando el local PAGA, no cuando recibe. Es una venta a
// crédito y se mide igual que un crédito a un cliente
// (`utilidad_parcial = MAX(0, cobrado − costo)`): lo que entra cubre primero el
// costo y solo el excedente es ganancia. Un envío entregado y no pagado no le
// ha dejado un peso a la bodega todavía, y decir lo contrario sería reportar
// una utilidad que está en la calle.
//
// QUÉ CUENTA COMO VENTA: exactamente lo que le genera CARGO al local — líneas
// `'Recibida'` de una entrega no anulada, descontando lo devuelto. La
// definición NO se copia: se importa de `redInterna.repository`
// (`SQL_ABONOS_EFECTIVOS`), porque dos versiones separadas acabarían diciendo
// que la bodega vendió algo que el local no debe. Un abono de una remesa EN
// TRÁNSITO no cuenta: reserva el envío, pero no baja la deuda hasta que la
// bodega confirma.
//
// QUÉ CUENTA COMO COSTO: lo que le costó A LA BODEGA. Para un serial se lee en
// vivo de `seriales.costo_compra` —así una corrección del admin se refleja
// sola— y para cantidad, el `costo_origen` congelado al despachar, porque el
// promedio ponderado del nodo ya se movió.
//
// La fecha es la de RECEPCIÓN: es cuando nace la deuda. Una remesa despachada
// el 30 y recibida el 2 es del mes siguiente, igual para las dos partes.
//
// Devuelve null cuando no hay nada — negocio sin red, sucursal que no es la
// bodega, o un período sin despachos — y el frontend no pinta nada.
const getVentasALocales = async (sucursalId, desde, hasta) => {
  const redRepo = require('../red-interna/redInterna.repository');

  // Una línea de envío: unidades efectivas (lo recibido menos lo devuelto), lo
  // que se le cobró al local y lo que le costó a la bodega.
  const SQL_LINEAS = `
    SELECT
      lr.id,
      lr.remision_id,
      lr.tipo,
      lr.nombre_producto,
      lr.imei,
      CASE WHEN lr.tipo = 'serial' THEN 1
           ELSE GREATEST(COALESCE(lr.cantidad_recibida, lr.cantidad, 0)
                          - COALESCE(lr.cantidad_devuelta, 0), 0) END AS unidades,
      lr.valor_interno,
      CASE WHEN lr.tipo = 'serial'
           THEN COALESCE(s.costo_compra, lr.costo_origen)
           ELSE lr.costo_origen END AS costo_unitario
    FROM lineas_remision lr
    LEFT JOIN seriales s ON s.id = lr.serial_id
    WHERE lr.estado_linea = 'Recibida'
  `;

  const { rows } = await pool.query(`
    WITH envios AS (
      SELECT r.id, r.numero, r.sucursal_destino_id,
             COALESCE(r.fecha_recepcion, r.fecha_emision) AS fecha
      FROM remisiones r
      WHERE r.sucursal_origen_id = $1
        AND r.tipo    = 'entrega'
        AND r.estado <> 'Anulada'
        AND DATE(COALESCE(r.fecha_recepcion, r.fecha_emision)
             ) BETWEEN $2 AND $3
    ),
    lin AS (SELECT * FROM (${SQL_LINEAS}) l WHERE l.remision_id IN (SELECT id FROM envios)),
    tot AS (
      SELECT
        l.remision_id,
        SUM(l.unidades)::int                            AS unidades,
        SUM(l.unidades * l.valor_interno)               AS valor,
        -- Los totales se arman con las líneas MEDIBLES: descartar un envío
        -- entero porque una de sus líneas no tiene costo botaría la utilidad
        -- de las que sí lo tienen.
        COALESCE(SUM(l.unidades * l.valor_interno)
          FILTER (WHERE l.costo_unitario IS NOT NULL), 0) AS valor_medible,
        COALESCE(SUM(l.unidades * l.costo_unitario)
          FILTER (WHERE l.costo_unitario IS NOT NULL), 0) AS costo,
        COALESCE(SUM(l.unidades * l.valor_interno)
          FILTER (WHERE l.costo_unitario IS NULL), 0)     AS valor_sin_costo,
        COUNT(*) FILTER (WHERE l.costo_unitario IS NULL)::int AS lineas_sin_costo
      FROM lin l
      WHERE l.unidades > 0
      GROUP BY l.remision_id
    ),
    abo AS (
      SELECT a.remision_id, SUM(a.valor) AS abonado
      FROM (${redRepo.SQL_ABONOS_EFECTIVOS}) a
      WHERE a.remision_id IN (SELECT id FROM envios)
      GROUP BY a.remision_id
    )
    SELECT
      e.id AS remision_id, e.numero, e.sucursal_destino_id, e.fecha,
      su.nombre AS sucursal_nombre,
      t.unidades, t.valor, t.valor_medible, t.costo, t.valor_sin_costo, t.lineas_sin_costo,
      COALESCE(ab.abonado, 0) AS abonado
    FROM envios e
    JOIN tot t         ON t.remision_id = e.id
    JOIN sucursales su ON su.id = e.sucursal_destino_id
    LEFT JOIN abo ab   ON ab.remision_id = e.id
    ORDER BY e.fecha DESC, e.id DESC
  `, [sucursalId, desde, hasta]);

  if (!rows.length) return null;

  // Desglose por producto. Va en una consulta aparte y no en un `json_agg`
  // dentro de la anterior para no arrastrar el detalle por los GROUP BY.
  const ids = rows.map((r) => Number(r.remision_id));
  const { rows: lineas } = await pool.query(`
    SELECT * FROM (${SQL_LINEAS}) l
    WHERE l.remision_id = ANY($1::bigint[]) AND l.unidades > 0
    ORDER BY l.remision_id, l.id
  `, [ids]);

  const porEnvio = new Map(ids.map((id) => [id, []]));
  for (const l of lineas) {
    const unidades = Number(l.unidades);
    const valorU   = Number(l.valor_interno);
    const costoU   = l.costo_unitario == null ? null : Number(l.costo_unitario);
    porEnvio.get(Number(l.remision_id))?.push({
      id:              Number(l.id),
      tipo:            l.tipo,
      nombre_producto: l.nombre_producto,
      imei:            l.imei,
      unidades,
      costo_unitario:  costoU,
      valor_unitario:  valorU,
      costo_total:     costoU == null ? null : costoU * unidades,
      valor_total:     valorU * unidades,
      utilidad:        costoU == null ? null : (valorU - costoU) * unidades,
    });
  }

  const envios = rows.map((r) => {
    const valor        = Number(r.valor);
    const costo        = Number(r.costo);
    const valorMedible = Number(r.valor_medible);
    const cobrado      = Number(r.abonado);
    const saldo        = Math.max(0, valor - cobrado);
    // Lo cobrado que corresponde a las líneas CON costo. Si una línea no tiene
    // costo, restar solo el de las demás contra todo lo cobrado inventaba
    // utilidad; se mide la parte medible, la misma regla de los créditos.
    const sinNingunCosto = r.lineas_sin_costo > 0 && valorMedible === 0;
    const cobradoMedible = valor > 0 ? cobrado * (valorMedible / valor) : cobrado;
    return {
      remision_id:      Number(r.remision_id),
      numero:           r.numero,
      sucursal_id:      Number(r.sucursal_destino_id),
      sucursal_nombre:  r.sucursal_nombre,
      fecha:            r.fecha,
      unidades:         Number(r.unidades),
      valor,
      costo,
      cobrado,
      saldo,
      pagado:             saldo === 0,
      // Lo que ya se ganó: el cobro cubre primero el costo (mismo criterio que
      // un crédito a un cliente) y solo lo que sobra es utilidad.
      utilidad_realizada: sinNingunCosto ? null : Math.round(Math.max(0, cobradoMedible - costo)),
      falta_para_cubrir:  sinNingunCosto ? null : Math.round(Math.max(0, costo - cobradoMedible)),
      // Lo que dejará cuando el local termine de pagar. Null si alguna línea no
      // tiene costo: presentar una utilidad parcial como si fuera la del envío
      // diría que la bodega gana menos de lo que gana.
      utilidad_total:   r.lineas_sin_costo > 0 ? null : valor - costo,
      utilidad_medible: valorMedible - costo,
      valor_sin_costo:  Number(r.valor_sin_costo),
      lineas_sin_costo: r.lineas_sin_costo,
      lineas:           porEnvio.get(Number(r.remision_id)) || [],
    };
  });

  // NULL (envío sin ningún costo) no suma: no hay utilidad que decir.
  const suma = (f) => envios.reduce((a, e) => a + (f(e) ?? 0), 0);
  const utilidadRealizada = suma((e) => e.utilidad_realizada);
  return {
    envios,
    resumen: {
      envios:             envios.length,
      unidades:           suma((e) => e.unidades),
      valor_total:        suma((e) => e.valor),
      costo_total:        suma((e) => e.costo),
      cobrado_total:      suma((e) => e.cobrado),
      por_cobrar:         suma((e) => e.saldo),
      // Ganancia ya hecha (el local pagó) contra la que falta por realizarse.
      utilidad_realizada: utilidadRealizada,
      utilidad_pendiente: Math.max(0, suma((e) => e.utilidad_medible) - utilidadRealizada),
      envios_pagados:     envios.filter((e) => e.pagado).length,
      // Lo que se despachó sin saber qué costó: no entra en la utilidad y hay
      // que decirlo, o el margen se lee como si fuera del total.
      valor_sin_costo:    suma((e) => e.valor_sin_costo),
      envios_sin_costo:   envios.filter((e) => e.lineas_sin_costo > 0).length,
    },
  };
};

// ─── Mora de los envíos de la red interna en un período ─────────────────────
//
// Solo para la BODEGA (la sucursal que despacha): cuánta mora le cobraron sus
// locales y cuánta perdonó, local por local. Se cuenta por la fecha del cobro
// EFECTIVO —el mismo SQL_MORA_EFECTIVOS de la cuenta: una remesa en camino no
// ha pagado nada todavía—.
//
// Devuelve null sin la migración o sin movimientos: la pantalla no pinta nada.
const getMoraEnviosRango = async (sucursalId, desde, hasta) => {
  const { hayMoraEnvios } = require('../../config/columnas');
  if (!hayMoraEnvios()) return null;
  const redRepo = require('../red-interna/redInterna.repository');
  try {
    const { rows } = await pool.query(`
      SELECT me.sucursal_id, su.nombre AS sucursal_nombre,
             COALESCE(SUM(me.valor) FILTER (WHERE me.tipo = 'Cobro'), 0)       AS cobrada,
             COALESCE(SUM(me.valor) FILTER (WHERE me.tipo = 'Condonacion'), 0) AS condonada,
             COUNT(DISTINCT me.remision_id)::int                               AS envios
      FROM (${redRepo.SQL_MORA_EFECTIVOS}) me
      JOIN remisiones r  ON r.id  = me.remision_id
      JOIN sucursales su ON su.id = me.sucursal_id
      WHERE r.sucursal_origen_id = $1
        AND DATE(me.fecha) BETWEEN $2 AND $3
      GROUP BY me.sucursal_id, su.nombre
      ORDER BY cobrada DESC
    `, [sucursalId, desde, hasta]);
    if (!rows.length) return null;
    const locales = rows.map((r) => ({
      sucursal_id: Number(r.sucursal_id), sucursal_nombre: r.sucursal_nombre,
      cobrada: Number(r.cobrada), condonada: Number(r.condonada), envios: r.envios,
    }));
    return {
      cobrada:   locales.reduce((s, l) => s + l.cobrada, 0),
      condonada: locales.reduce((s, l) => s + l.condonada, 0),
      locales,
    };
  } catch (err) {
    console.warn('[reportes] Mora de envíos no disponible:', err.message);
    return null;
  }
};

// ─── Utilidad ESPERADA de lo que se otorgó a plazo ───────────────────────────
//
// La utilidad REAL de un crédito, un préstamo o un envío a un local se cuenta
// cuando se COBRA (lo cobrado cubre primero el costo y solo el excedente es
// ganancia) y eso NO cambia: es lo único que de verdad entró.
//
// Esta es OTRA cifra, informativa: cuánto va a dejar cada operación a plazo
// que se hizo en el período SI se paga completa (valor − costo). Responde
// «¿cuánto negocio hice hoy?», que la utilidad real no puede responder: un día
// de puros créditos se ve en cero hasta que alguien pague.
//
// Se mide por la FECHA DE LA OPERACIÓN (la factura a crédito, el préstamo, el
// despacho), no por la del cobro. El contado no entra: su utilidad ya es real
// el mismo día. Nunca se suma a ninguna utilidad real.
//
// Mismo costo que el resto del reporte: `_costoPorImei` y el nodo en cantidad
// (créditos), `SQL_COSTO_PRESTAMO` (préstamos) y el costo de la bodega de cada
// línea del envío. Lo que no tiene costo se cuenta aparte (`sin_costo`) en
// vez de inventar una ganancia.
//
// Devuelve null si en el período no se otorgó nada a plazo.
const getUtilidadEsperadaRango = async (sucursalId, desde, hasta) => {
  const redRepo = require('../red-interna/redInterna.repository');

  const [creditos, prestamos, envios] = await Promise.all([
    // Créditos: facturas a crédito HECHAS en el período (no canceladas). El
    // costo, con la definición única de los créditos (_sqlCostoCreditos).
    pool.query(`
      SELECT x.* FROM (${_sqlCostoCreditos(`
        SELECT cr.id, cr.factura_id, f.numero, f.nombre_cliente, f.fecha, cr.estado,
               cr.valor_total, cr.cuota_inicial, cr.total_abonado
        FROM creditos cr JOIN facturas f ON f.id = cr.factura_id
        WHERE cr.sucursal_id = $1 AND cr.estado <> 'Cancelada' AND f.estado <> 'Cancelada'
          AND DATE(f.fecha) BETWEEN $2 AND $3
      `)}) x
      ORDER BY x.fecha DESC
    `, [sucursalId, desde, hasta]),

    // Préstamos HECHOS en el período.
    pool.query(`
      SELECT p.id, p.numero, p.prestatario, p.nombre_producto, p.fecha, p.estado,
             p.valor_prestamo, p.total_abonado, ${SQL_COSTO_PRESTAMO} AS costo
      FROM prestamos p
      WHERE p.sucursal_id = $1 AND p.estado IN ('Activo', 'Saldado')
        AND p.valor_prestamo > 0
        AND DATE(p.fecha) BETWEEN $2 AND $3
      ORDER BY p.fecha DESC
    `, [sucursalId, desde, hasta]),

    // Envíos DESPACHADOS en el período por esta sucursal (la bodega). Cuentan
    // también los que van en camino: ya salieron. Lo que no llegó (Faltante) o
    // volvió (Devuelta, cantidad_devuelta) no va a dejar nada y sale de la cuenta.
    pool.query(`
      WITH env AS (
        SELECT r.id, COALESCE(r.numero, r.id) AS numero, r.estado, r.fecha_emision AS fecha,
               su.nombre AS destino
        FROM remisiones r JOIN sucursales su ON su.id = r.sucursal_destino_id
        WHERE r.sucursal_origen_id = $1 AND r.tipo = 'entrega' AND r.estado <> 'Anulada'
          AND DATE(r.fecha_emision) BETWEEN $2 AND $3
      ),
      lin AS (
        SELECT lr.remision_id,
               CASE WHEN lr.tipo = 'serial' THEN 1
                    ELSE GREATEST(COALESCE(lr.cantidad_recibida, lr.cantidad, 0)
                                  - COALESCE(lr.cantidad_devuelta, 0), 0) END AS unidades,
               lr.valor_interno,
               CASE WHEN lr.tipo = 'serial' THEN COALESCE(s.costo_compra, lr.costo_origen)
                    ELSE lr.costo_origen END AS costo_u
        FROM lineas_remision lr LEFT JOIN seriales s ON s.id = lr.serial_id
        WHERE lr.remision_id IN (SELECT id FROM env)
          AND lr.estado_linea IN ('Pendiente', 'Recibida')
      ),
      tot AS (
        SELECT remision_id,
               SUM(unidades * valor_interno) AS valor,
               COALESCE(SUM(unidades * costo_u) FILTER (WHERE costo_u IS NOT NULL), 0) AS costo,
               COALESCE(SUM(unidades * valor_interno) FILTER (WHERE costo_u IS NOT NULL), 0) AS valor_medible,
               COUNT(*) FILTER (WHERE costo_u IS NULL)::int AS lineas_sin_costo
        FROM lin WHERE unidades > 0 GROUP BY remision_id
      ),
      abo AS (
        SELECT a.remision_id, SUM(a.valor) AS cobrado
        FROM (${redRepo.SQL_ABONOS_EFECTIVOS}) a
        WHERE a.remision_id IN (SELECT id FROM env)
        GROUP BY a.remision_id
      )
      SELECT env.*, t.valor, t.costo, t.valor_medible, t.lineas_sin_costo,
             COALESCE(abo.cobrado, 0) AS cobrado
      FROM env JOIN tot t ON t.remision_id = env.id
      LEFT JOIN abo ON abo.remision_id = env.id
      ORDER BY env.fecha DESC
    `, [sucursalId, desde, hasta]).catch((err) => {
      // Sin las tablas de la red interna, simplemente no hay envíos.
      if (err.code === '42P01' || err.code === '42703') return { rows: [] };
      throw err;
    }),
  ]);

  const n = (v) => Number(v || 0);
  // Utilidad REALIZADA hasta hoy de esa misma operación: la regla de siempre,
  // lo cobrado cubre primero el costo. Se muestra al lado para ver el avance.
  const realizada = (cobrado, costo) => Math.max(0, n(cobrado) - n(costo));

  const creditosDet = creditos.rows.map((c) => {
    const valor   = n(c.valor_total);
    const cobrado = n(c.cuota_inicial) + n(c.total_abonado);
    // La parte medible (productos con costo). NULL = ninguno tiene costo.
    const prop    = c.proporcion_medible == null ? null : n(c.proporcion_medible);
    return {
      id: Number(c.id), factura_id: Number(c.factura_id), numero: c.numero,
      persona: c.nombre_cliente, fecha: c.fecha, estado: c.estado,
      valor, costo: n(c.costo_total), cobrado,
      esperada:  prop == null ? null : Math.round(valor * prop - n(c.costo_total)),
      realizada: prop == null ? null : Math.round(realizada(cobrado * prop, c.costo_total)),
      sin_costo: c.lineas_sin_costo > 0,
    };
  });
  const prestamosDet = prestamos.rows.map((p) => {
    const costo = p.costo == null ? null : n(p.costo);
    return {
      id: Number(p.id), numero: p.numero, persona: p.prestatario, producto: p.nombre_producto,
      fecha: p.fecha, estado: p.estado,
      valor: n(p.valor_prestamo), costo, cobrado: n(p.total_abonado),
      // Sin costo no se inventa: la esperada queda en null y se cuenta aparte.
      esperada: costo == null ? null : n(p.valor_prestamo) - costo,
      realizada: costo == null ? null : realizada(p.total_abonado, costo),
      sin_costo: costo == null,
    };
  });
  const enviosDet = envios.rows.map((e) => ({
    id: Number(e.id), numero: e.numero, persona: e.destino, fecha: e.fecha, estado: e.estado,
    valor: n(e.valor), costo: n(e.costo), cobrado: n(e.cobrado),
    // Solo sobre las líneas con costo: presentar la de todo el envío como si
    // lo fuera diría que la bodega gana menos de lo que gana.
    esperada: e.lineas_sin_costo > 0 && n(e.valor_medible) === 0 ? null : n(e.valor_medible) - n(e.costo),
    // Lo cobrado que corresponde a las líneas con costo (misma regla que los
    // créditos y que la utilidad realizada de la bodega).
    realizada: e.lineas_sin_costo > 0 && n(e.valor_medible) === 0 ? null
      : Math.round(realizada(n(e.valor) > 0 ? n(e.cobrado) * n(e.valor_medible) / n(e.valor) : n(e.cobrado), e.costo)),
    en_camino: e.estado === 'En transito',
    sin_costo: e.lineas_sin_costo > 0,
  }));

  const grupo = (det) => {
    if (!det.length) return null;
    const suma = (k) => det.reduce((s, d) => s + (d[k] != null ? d[k] : 0), 0);
    return {
      cantidad:  det.length,
      valor:     suma('valor'),
      costo:     suma('costo'),
      esperada:  suma('esperada'),
      realizada: suma('realizada'),
      por_realizar: Math.max(0, suma('esperada') - suma('realizada')),
      sin_costo: det.filter((d) => d.sin_costo).length,
      detalle:   det,
    };
  };

  const bloques = {
    creditos:  grupo(creditosDet),
    prestamos: grupo(prestamosDet),
    envios:    grupo(enviosDet),
  };
  const presentes = Object.values(bloques).filter(Boolean);
  if (!presentes.length) return null;

  return {
    ...bloques,
    total: {
      operaciones:  presentes.reduce((s, b) => s + b.cantidad, 0),
      esperada:     presentes.reduce((s, b) => s + b.esperada, 0),
      realizada:    presentes.reduce((s, b) => s + b.realizada, 0),
      por_realizar: presentes.reduce((s, b) => s + b.por_realizar, 0),
    },
  };
};

// ─── getProductosTop ──────────────────────────────────────────────────────────

// El costo de cada línea es el MISMO de Ventas (SQL_COSTO_UNIT_LINEA: el
// valor interno o el costo de la fila del IMEI, la variante, el atributo o el
// producto de la línea). Antes aquí se buscaba por NOMBRE —el costo de HOY del
// producto, no el de la variante vendida— y un IMEI sin costo tomaba el
// promedio del modelo. Lo que no tiene costo no suma utilidad.
const getProductosTop = async (sucursalId, desde, hasta) => {
  const { rows } = await pool.query(`
    WITH lin AS (
      SELECT
        l.nombre_producto,
        l.imei,
        ${CANT_EFECTIVA}     AS cantidad,
        ${SUBTOTAL_EFECTIVO} AS subtotal,
        ${SQL_COSTO_LINEA}   AS costo,
        -- Cuántas de esas unidades se REGALARON. Sin esto, un accesorio que se
        -- entrega de obsequio con cada equipo encabeza «lo más vendido» sin
        -- haber dejado un peso, y el margen del producto sale hundido sin
        -- explicación.
        ${obsequios.sqlEsObsequio('l')} AS obsequio
      FROM lineas_factura l
      JOIN facturas f ON f.id = l.factura_id
      WHERE f.sucursal_id = $1
        AND DATE(f.fecha) BETWEEN $2 AND $3
        AND f.estado != 'Cancelada'
    )
    SELECT
      lin.nombre_producto,
      SUM(lin.cantidad) AS cantidad_vendida,
      SUM(lin.subtotal) AS total_ventas,
      SUM(lin.cantidad) FILTER (WHERE lin.obsequio) AS unidades_obsequio,
      SUM(lin.costo)                                            AS costo_total,
      SUM(lin.cantidad) FILTER (WHERE lin.costo IS NOT NULL)    AS cantidad_con_costo,
      SUM(lin.subtotal) FILTER (WHERE lin.costo IS NOT NULL)    AS ventas_con_costo,
      COALESCE(SUM(lin.cantidad) FILTER (WHERE lin.costo IS NULL), 0) AS unidades_sin_costo,
      CASE WHEN MAX(lin.imei) IS NOT NULL THEN 'serial' ELSE 'cantidad' END AS tipo_producto,
      COALESCE(
        (SELECT lp.nombre FROM lineas_producto lp
         JOIN productos_serial ps ON ps.linea_id = lp.id
         WHERE ps.nombre = lin.nombre_producto AND ps.sucursal_id = $1 LIMIT 1),
        (SELECT lp.nombre FROM lineas_producto lp
         JOIN productos_cantidad pc ON pc.linea_id = lp.id
         WHERE pc.nombre = lin.nombre_producto AND pc.sucursal_id = $1 LIMIT 1)
      ) AS linea_nombre
    FROM lin
    GROUP BY lin.nombre_producto
    ORDER BY cantidad_vendida DESC
    LIMIT 20
  `, [sucursalId, desde, hasta]);

  return rows.map((p) => {
    const conCosto   = p.costo_total !== null;
    const costoTotal = conCosto ? Number(p.costo_total) : null;
    const ventasMed  = Number(p.ventas_con_costo || 0);
    const cantMed    = Number(p.cantidad_con_costo || 0);
    // Utilidad y margen solo de las unidades con costo.
    const utilidad = conCosto ? ventasMed - costoTotal : null;
    const margen = utilidad !== null && ventasMed > 0 ? (utilidad / ventasMed) * 100 : null;
    return {
      nombre_producto:         p.nombre_producto,
      tipo_producto:           p.tipo_producto,
      cantidad_vendida:        Number(p.cantidad_vendida),
      total_ventas:            Number(p.total_ventas),
      costo_unitario_promedio: conCosto && cantMed > 0 ? costoTotal / cantMed : null,
      costo_total:             costoTotal,
      utilidad,
      margen_porcentaje:       margen,
      unidades_sin_costo:      Number(p.unidades_sin_costo),
      unidades_obsequio:       Number(p.unidades_obsequio || 0),
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
//   · utilidad      = lo vendido CON costo − su costo (SQL_COSTO_LINEA, el
//     mismo del resto del módulo). Una línea sin costo no suma y se cuenta en
//     lineas_sin_costo. La retoma NO se resta.
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


  const [aggResult, topResult] = await Promise.all([
    // ── Agregado por vendedor ────────────────────────────────────────────────
    pool.query(`
      WITH agg AS (
        SELECT
          f.vendedor_id,
          COUNT(DISTINCT f.id)                  AS num_facturas,
          COALESCE(SUM(${CANT_EFECTIVA}), 0)     AS unidades,
          COALESCE(SUM(${SUBTOTAL_EFECTIVO}), 0) AS total_vendido,
          -- El costo único del módulo. Una línea sin costo NO suma utilidad
          -- (antes contaba como costo 0 y era utilidad pura del vendedor).
          COALESCE(SUM(lc.costo), 0)             AS costo_total,
          COALESCE(SUM(${SUBTOTAL_EFECTIVO}) FILTER (WHERE lc.costo IS NOT NULL), 0) AS vendido_con_costo,
          COUNT(*) FILTER (WHERE lc.costo IS NULL)::int AS lineas_sin_costo,
          -- Cuantas unidades REGALO este vendedor. Solo unidades: el apartado
          -- de obsequios no lleva costo para nadie. Lo que costaron ya esta
          -- dentro de su costo total y por eso su utilidad sale mas baja.
          -- OJO: sin comillas invertidas aqui dentro — este SQL vive en un
          -- template literal y una sola lo cierra a media consulta.
          COALESCE(SUM(${CANT_EFECTIVA}) FILTER (WHERE ${obsequios.sqlEsObsequio('l')}), 0)
            AS unidades_obsequio
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        CROSS JOIN LATERAL (SELECT ${SQL_COSTO_LINEA} AS costo) lc
        WHERE f.sucursal_id = $1
          AND DATE(f.fecha) BETWEEN $2 AND $3
          AND f.estado != 'Cancelada'
        GROUP BY f.vendedor_id
      )
      SELECT
        a.vendedor_id,
        a.num_facturas,
        a.unidades,
        a.total_vendido,
        a.costo_total,
        a.vendido_con_costo,
        a.lineas_sin_costo,
        a.unidades_obsequio,
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
          AND DATE(f.fecha) BETWEEN $2 AND $3
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
    const conCosto     = Number(r.vendido_con_costo);
    const utilidad     = conCosto - costoTotal;
    return {
      vendedor_id:       r.vendedor_id,
      vendedor_nombre:   r.vendedor_nombre,
      vendedor_activo:   r.vendedor_activo,
      num_facturas:      numFacturas,
      unidades:          Number(r.unidades),
      total_vendido:     totalVendido,
      costo_total:       costoTotal,
      utilidad,
      // Sobre lo que tiene costo: lo demás no dice cuánto se ganó.
      margen_porcentaje: conCosto > 0 ? (utilidad / conCosto) * 100 : null,
      lineas_sin_costo:  Number(r.lineas_sin_costo || 0),
      ticket_promedio:   numFacturas > 0 ? totalVendido / numFacturas : 0,
      unidades_obsequio: Number(r.unidades_obsequio || 0),
      participacion:     totalVendedores > 0 ? (totalVendido / totalVendedores) * 100 : 0,
      top_productos:     topPorVendedor[r.vendedor_id] || [],
    };
  };

  const vendedores   = filasVendedor.map(mapFila);
  const sinVendRow   = aggResult.rows.find((r) => r.vendedor_id === null);
  const sin_vendedor = sinVendRow ? {
    num_facturas:  Number(sinVendRow.num_facturas),
    unidades:      Number(sinVendRow.unidades),
    unidades_obsequio: Number(sinVendRow.unidades_obsequio || 0),
    total_vendido: Number(sinVendRow.total_vendido),
    utilidad:      Number(sinVendRow.vendido_con_costo) - Number(sinVendRow.costo_total),
    lineas_sin_costo: Number(sinVendRow.lineas_sin_costo || 0),
  } : null;

  const totales = {
    total_vendido: totalVendedores,
    num_facturas:  filasVendedor.reduce((s, r) => s + Number(r.num_facturas), 0),
    unidades:      filasVendedor.reduce((s, r) => s + Number(r.unidades), 0),
    utilidad:      filasVendedor.reduce((s, r) => s + (Number(r.vendido_con_costo) - Number(r.costo_total)), 0),
    lineas_sin_costo: filasVendedor.reduce((s, r) => s + Number(r.lineas_sin_costo || 0), 0),
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

// El período ('YYYY-MM-DD') de una fecha, con el mismo corte que
// `date_trunc(unit, …)`: el día en Bogotá, el lunes de su semana o el 1.º del mes.
const _periodoDe = (fecha, unit) => {
  const dia = typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? fecha
    : new Date(fecha).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  if (unit === 'month') return `${dia.slice(0, 7)}-01`;
  if (unit === 'week') {
    const d = new Date(`${dia}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return dia;
};

const getAnalisis = async (sucursalId, desde, hasta, agrupacion) => {
  // Whitelist: nunca interpolar entrada del usuario directo en el SQL
  const unit = ({ dia: 'day', semana: 'week', mes: 'month' })[agrupacion] || 'month';

  // El período como TEXTO 'YYYY-MM-DD': las cinco fuentes se juntan por él, y
  // la Proyección lo compara como texto.
  const periodoDe = (col) => `to_char(date_trunc('${unit}', ${col}), 'YYYY-MM-DD')`;

  const [serieResult, despachosRango, ventasEstadoResult, serviciosIngResult, prestamosIngResult, metodosResult] = await Promise.all([

    // ── Serie temporal ──────────────────────────────────────────────────────
    //
    // La utilidad de cada período es LA MISMA de la pestaña Ventas y del PDF
    // (`_utilidadDelPeriodo`): contado + créditos saldados + préstamos
    // saldados + servicios + lo cobrado de los despachos (este último se suma
    // abajo, en JS). Antes aquí solo entraban contado y créditos, y la gráfica
    // decía una utilidad distinta a la de Ventas para el mismo mes.
    // Todo con el costo único del módulo: lo que no tiene costo no suma.
    pool.query(`
      WITH lin AS (
        SELECT ${periodoDe('f.fecha')} AS periodo, f.id AS factura_id, f.estado,
               ${SUBTOTAL_EFECTIVO} AS subtotal,
               ${SQL_COSTO_LINEA}   AS costo
        FROM lineas_factura l
        JOIN facturas f ON f.id = l.factura_id
        WHERE f.sucursal_id = $1
          AND DATE(f.fecha) BETWEEN $2 AND $3
          AND f.estado != 'Cancelada'
      ),
      fac AS (
        SELECT periodo,
               SUM(subtotal)                                             AS total_vendido,
               COUNT(DISTINCT factura_id)                                AS num_facturas,
               COALESCE(SUM(costo), 0)                                   AS costo,
               COALESCE(SUM(subtotal) FILTER (WHERE costo IS NOT NULL), 0) AS ventas_con_costo,
               -- La retoma NO se resta: es un medio de pago, no una pérdida.
               COALESCE(SUM(subtotal - costo) FILTER (WHERE estado = 'Activa'), 0) AS u_contado
        FROM lin GROUP BY periodo
      ),
      cred AS (
        SELECT ${periodoDe('x.fecha_saldo')} AS periodo, COALESCE(SUM(x.utilidad), 0) AS u
        FROM (${SQL_CREDITOS_SALDADOS}) x
        GROUP BY 1
      ),
      prest AS (
        SELECT ${periodoDe('ua.fecha_saldo')} AS periodo,
               COALESCE(SUM(p.total_abonado - (${SQL_COSTO_PRESTAMO})), 0) AS u
        FROM prestamos p
        JOIN (
          SELECT ab.prestamo_id, MAX(ab.fecha) AS fecha_saldo
          FROM abonos_prestamo ab
          WHERE NOT ab.anulado
          GROUP BY ab.prestamo_id
        ) ua ON ua.prestamo_id = p.id
        WHERE p.sucursal_id = $1 AND p.estado = 'Saldado'
          AND DATE(ua.fecha_saldo) BETWEEN $2 AND $3
        GROUP BY 1
      ),
      serv AS (
        -- Mismas categorías que getServiciosRango: cuentan los pagados y las
        -- garantías cobrables CON costo; diagnósticos y pendientes de pago no.
        SELECT ${periodoDe('os.fecha_entrega')} AS periodo,
               COALESCE(SUM(CASE
                 WHEN os.estado = 'Sin_reparar' THEN NULL
                 WHEN COALESCE(os.precio_garantia, 0) > 0 AND os.garantia_cobrable THEN
                   CASE WHEN COALESCE(os.costo_garantia, 0) > 0 THEN os.precio_garantia - os.costo_garantia END
                 WHEN os.estado = 'Pendiente_pago' THEN NULL
                 ELSE CASE WHEN COALESCE(os.costo_real, 0) > 0 THEN COALESCE(os.precio_final, 0) - os.costo_real END
               END), 0) AS u
        FROM ordenes_servicio os
        WHERE os.sucursal_id = $1
          AND os.estado IN ('Entregado', 'Pendiente_pago', 'Sin_reparar')
          AND ${fechaBogota('os.fecha_entrega')} BETWEEN $2 AND $3
        GROUP BY 1
      ),
      periodos AS (
        SELECT periodo FROM fac UNION SELECT periodo FROM cred
        UNION SELECT periodo FROM prest UNION SELECT periodo FROM serv
      )
      SELECT
        pe.periodo,
        COALESCE(fac.total_vendido, 0)    AS total_vendido,
        COALESCE(fac.num_facturas, 0)     AS num_facturas,
        COALESCE(fac.costo, 0)            AS costo,
        COALESCE(fac.ventas_con_costo, 0) AS ventas_con_costo,
        COALESCE(fac.u_contado, 0)        AS u_contado,
        COALESCE(cred.u, 0)               AS u_creditos,
        COALESCE(prest.u, 0)              AS u_prestamos,
        COALESCE(serv.u, 0)               AS u_servicios
      FROM periodos pe
      LEFT JOIN fac   ON fac.periodo   = pe.periodo
      LEFT JOIN cred  ON cred.periodo  = pe.periodo
      LEFT JOIN prest ON prest.periodo = pe.periodo
      LEFT JOIN serv  ON serv.periodo  = pe.periodo
      ORDER BY pe.periodo
    `, [sucursalId, desde, hasta]),

    // Los despachos a locales del período (solo la bodega tiene): la MISMA
    // función de la pestaña Ventas, así su utilidad realizada no se recalcula.
    getVentasALocales(sucursalId, desde, hasta).catch(() => null),

    // ── Composición: productos contado vs crédito ──────────────────────────
    pool.query(`
      SELECT
        f.estado,
        COALESCE(SUM(${SUBTOTAL_EFECTIVO}), 0) AS total
      FROM lineas_factura l
      JOIN facturas f ON f.id = l.factura_id
      WHERE f.sucursal_id = $1
        AND DATE(f.fecha) BETWEEN $2 AND $3
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
        WHERE NOT ab.anulado
        GROUP BY ab.prestamo_id
      )
      SELECT COALESCE(SUM(p.total_abonado), 0) AS total
      FROM prestamos p
      JOIN ultimo_abono ua ON ua.prestamo_id = p.id
      WHERE p.sucursal_id = $1
        AND p.estado = 'Saldado'
        AND DATE(ua.fecha_saldo) BETWEEN $2 AND $3
    `, [sucursalId, desde, hasta]),

    // ── Métodos de pago en el período ──────────────────────────────────────
    pool.query(`
      SELECT pf.metodo, COALESCE(SUM(pf.valor), 0) AS total
      FROM pagos_factura pf
      JOIN facturas f ON f.id = pf.factura_id
      WHERE f.sucursal_id = $1
        AND DATE(f.fecha) BETWEEN $2 AND $3
        AND f.estado != 'Cancelada'
      GROUP BY pf.metodo
      ORDER BY total DESC
    `, [sucursalId, desde, hasta]),
  ]);

  // Los despachos a locales se agrupan por el período de su recepción (la
  // fecha con la que salen en Ventas), con el mismo corte que date_trunc.
  const porPeriodo = new Map();
  for (const r of serieResult.rows) porPeriodo.set(r.periodo, r);
  const despachosPorPeriodo = new Map();
  for (const e of despachosRango?.envios || []) {
    const p = _periodoDe(e.fecha, unit);
    const acc = despachosPorPeriodo.get(p) || { u: 0, valor: 0, costo: 0, valor_medible: 0 };
    acc.u     += e.utilidad_realizada ?? 0;
    acc.valor += e.valor;
    if (e.utilidad_realizada !== null) { acc.costo += e.costo; acc.valor_medible += e.valor - e.valor_sin_costo; }
    despachosPorPeriodo.set(p, acc);
    if (!porPeriodo.has(p)) porPeriodo.set(p, { periodo: p });
  }

  const serie = [...porPeriodo.keys()].sort().map((p) => {
    const r = porPeriodo.get(p);
    const d = despachosPorPeriodo.get(p) || { u: 0, valor: 0, costo: 0, valor_medible: 0 };
    const totalVendido = Number(r.total_vendido || 0);
    const numFacturas  = Number(r.num_facturas || 0);
    const desglose = {
      contado:   Number(r.u_contado   || 0),
      creditos:  Number(r.u_creditos  || 0),
      prestamos: Number(r.u_prestamos || 0),
      servicios: Number(r.u_servicios || 0),
      despachos: Math.round(d.u),
    };
    return {
      periodo:          p,
      total_vendido:    totalVendido,
      // LA utilidad del período (la misma suma que Ventas y el PDF).
      utilidad:         Object.values(desglose).reduce((s, v) => s + v, 0),
      utilidad_desglose: desglose,
      costo:            Number(r.costo || 0),
      // Para la Proyección: el % de costo se mide solo sobre lo que tiene
      // costo, o las ventas sin costo lo diluyen y la utilidad sale inflada.
      ventas_con_costo: Number(r.ventas_con_costo || 0),
      // Lo despachado a locales (solo la bodega): también es venta.
      despachos_valor:         d.valor,
      despachos_costo:         d.costo,
      despachos_valor_medible: d.valor_medible,
      num_facturas:     numFacturas,
      ticket_promedio:  numFacturas > 0 ? totalVendido / numFacturas : 0,
    };
  });

  const ventasPorEstado = {};
  ventasEstadoResult.rows.forEach((r) => { ventasPorEstado[r.estado] = Number(r.total); });

  const composicion = [
    { fuente: 'Contado',   total: ventasPorEstado.Activa  || 0 },
    { fuente: 'Crédito',   total: ventasPorEstado.Credito || 0 },
    { fuente: 'Servicios', total: Number(serviciosIngResult.rows[0].total) },
    { fuente: 'Préstamos', total: Number(prestamosIngResult.rows[0].total) },
    { fuente: 'Despachos a locales', total: Number(despachosRango?.resumen?.valor_total || 0) },
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
             COALESCE(
               ${costoRed.sqlValorInternoEnStock('s.id', 'ps.sucursal_id')},
               -- Ya vendido: el reporte de la venta toma el valor de la entrega.
               ${costoRed.sqlValorInternoPorImei('s.imei', 'ps.sucursal_id')}
             ) AS valor_interno
      FROM seriales s
      JOIN productos_serial ps ON ps.id = s.producto_id
      WHERE s.imei = $1 AND ps.sucursal_id = $2
      -- La MISMA fila que lee el reporte (_costoPorImei): corregir otra dejaba
      -- la utilidad igual y el usuario repetía la corrección.
      ORDER BY ${costoRed.ORDEN_FILA_IMEI}
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
//   % costo histórico      = Σ costo / Σ ventas CON costo de los meses completos
//                            (ventas = facturas + despachos a locales)
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

  // Ventas del mes = facturas + lo despachado a locales (la bodega vende sin
  // factura; sin esto su proyección salía en 0). El % de costo se mide SOLO
  // sobre lo que tiene costo: dividir el costo conocido entre todas las ventas
  // hacía ver las ventas sin costo como utilidad pura.
  const ventasDe  = (s) => Number(s.total_vendido) + Number(s.despachos_valor || 0);
  const costoDe   = (s) => Number(s.costo) + Number(s.despachos_costo || 0);
  const medibleDe = (s) => Number(s.ventas_con_costo || 0) + Number(s.despachos_valor_medible || 0);
  const pctDe = (costo, medible) => (medible > 0 ? costo / medible : 0);

  const historial = completos.map((s) => {
    const ventas = ventasDe(s);
    const costo  = ventas * pctDe(costoDe(s), medibleDe(s));
    return { periodo: s.periodo, ventas, costo, utilidad_bruta: ventas - costo };
  });

  const mesesConDatos = historial.length;
  const sumVentas  = historial.reduce((a, m) => a + m.ventas, 0);
  const sumCosto   = completos.reduce((a, s) => a + costoDe(s), 0);
  const sumMedible = completos.reduce((a, s) => a + medibleDe(s), 0);

  const ventasMesActual = actual ? ventasDe(actual) : 0;

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
  const pctCosto = sumMedible > 0
    ? pctDe(sumCosto, sumMedible)
    : (actual ? pctDe(costoDe(actual), medibleDe(actual)) : 0);
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
  getVentasALocales, getMoraEnviosRango, getUtilidadEsperadaRango,
  getDashboard,
  getVentasRango,
  // Lo expone la prueba 57; la pantalla lo recibe dentro de getVentasRango.
  getObsequiosRango,
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