const { pool } = require('../../config/db');
const costoRed  = require('../../utils/costoRed.util');
const obsequios = require('../../utils/obsequios.util');
const reportes  = require('./reportes.service');
const acreedoresRepo = require('../acreedores/acreedores.repository');

// ─────────────────────────────────────────────────────────────────────────────
// ANÁLISIS PARA ASESORÍA — las tablas con las que un asesor comercial revisa el
// negocio y saca conclusiones (pedido del usuario, 7-oct-2026; Reportes →
// Análisis → «Tablas para asesoría», y el Excel que las exporta).
//
// Las gráficas de Análisis dicen CUÁNTO se vendió. Esto responde lo que se
// pregunta quien tiene que decidir algo: ¿a qué proveedor le estoy pagando de
// más por lo mismo?, ¿qué mercancía compré y no se mueve?, ¿qué se me agota?,
// ¿qué producto deja plata y cuál solo ocupa el estante?, ¿quién me debe y desde
// cuándo?
//
// TRES REGLAS:
//
//   1. NO HAY UN COSTO NI UNA UTILIDAD NUEVOS. El costo de cada línea vendida
//      es `SQL_COSTO_LINEA` de reportes.service —el mismo de Ventas, Productos
//      y Vendedores— y lo que no tiene costo NO suma utilidad: se cuenta aparte.
//      El inventario se valora como en la pestaña Inventario; la deuda con
//      proveedores es la de la lista de Acreedores.
//
//   2. La utilidad de aquí es DESEMPEÑO DE VENTA (la de la pestaña Productos):
//      toda factura no cancelada del rango, por su fecha, cobrada o no. NO es
//      la «utilidad del período» de las gráficas, que cuenta un crédito cuando
//      se cobra. Son preguntas distintas —¿qué producto conviene vender? contra
//      ¿cuánta plata entró?— y por eso la pantalla las rotula distinto.
//
//   3. Las SEÑALES («No rota», «Más caro», «Agotado») son reglas con umbrales
//      escritos en `UMBRALES`, que viajan en la respuesta y se muestran. El
//      programa dice el hecho y el número; la decisión es del asesor.
//
// Alcance: una lista de sedes (la elegida, o todas las del negocio). Lo que es
// del NEGOCIO y no de una sede —la deuda con un proveedor— va siempre completo
// y se dice. Todo es de solo lectura: este archivo no escribe nada.
// ─────────────────────────────────────────────────────────────────────────────

const { CANT_EFECTIVA, SUBTOTAL_EFECTIVO, SQL_COSTO_LINEA } = reportes._sql;

const UMBRALES = {
  // «Margen bajo» se mide contra la LÍNEA del producto, no contra un número
  // fijo: un celular deja 9 % y un estuche 25 %, y con un solo listón o todos
  // los celulares salen marcados o ningún estuche. Un producto es de margen
  // bajo si deja menos de este % de lo que deja su línea.
  margen_bajo_vs_linea_pct:   60,
  margen_bajo_pct:            10,   // …y este listón fijo cuando la línea no da para comparar
  linea_minimo_productos:      3,   // productos vendidos para que una línea sirva de referencia
  por_agotarse_dias:           7,   // stock para menos de N días al ritmo del período
  sobrestock_dias:            90,   // stock para más de N días
  recien_comprado_dias:       15,   // con una compra tan reciente no se acusa de «No rota»
  concentracion_proveedor_pct: 40,  // un proveedor con más de esto de las compras
  devoluciones_pct:            5,   // unidades devueltas al proveedor sobre las compradas
  equipos_minimos:             5,   // equipos comprados para opinar de su rotación
  equipos_rotacion_pct:       30,   // menos de esto vendido = «Sus equipos no rotan»
  equipos_dias_minimos:       20,   // …y solo si los que quedan llevan al menos N días comprados
  dias_semana_minimos:         3,   // fechas de un día de la semana para compararlo con otro
  precio_mas_caro_pct:         5,   // por encima del mejor precio de otro proveedor
  equipo_viejo_dias:          60,   // equipo en inventario hace más de N días
  cartera_vieja_dias:         60,   // deuda de cliente con más de N días
  abc_a_pct:                  80,   // clase A: los productos que suman este % de la utilidad
  abc_b_pct:                  95,
};

const HOY_SQL = `(NOW() AT TIME ZONE 'America/Bogota')::date`;

const n   = (v) => (v === null || v === undefined ? null : Number(v));
const n0  = (v) => Number(v || 0);
const pct = (parte, total) => (total > 0 ? (parte / total) * 100 : null);
const r1  = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const claveProducto = (tipo, nombre) => `${tipo}|${String(nombre ?? '').trim().toLowerCase()}`;
const diasEntre = (desde, hasta) => {
  const a = Date.parse(`${desde}T00:00:00Z`), b = Date.parse(`${hasta}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86400000) + 1) : 1;
};

// Una consulta que puede faltar en una base a medio migrar (novedades del
// proveedor): el análisis sale sin esa columna en vez de no salir.
const _tolerante = async (etiqueta, fn, porDefecto) => {
  try { return await fn(); } catch (err) {
    console.warn(`[asesor] ${etiqueta} no disponible:`, err.message);
    return porDefecto;
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CONSULTAS — $1 sedes, $2 desde, $3 hasta
// ═════════════════════════════════════════════════════════════════════════════

const FILTRO_VENTA = `
  f.sucursal_id = ANY($1::int[])
  AND DATE(f.fecha) BETWEEN $2 AND $3
  AND f.estado != 'Cancelada'`;

// Lo vendido, por NODO (producto + talla + color). La identidad es el NOMBRE y
// el valor, no el id: el mismo producto vive en una fila por sede, y con varias
// sedes en el alcance tienen que sumar en una sola.
const _ventasPorNodo = async (sedes, desde, hasta) => {
  const { rows } = await pool.query(`
    WITH lin AS (
      SELECT
        CASE WHEN l.imei IS NOT NULL THEN 'serial' ELSE 'cantidad' END AS tipo,
        COALESCE(pc.nombre, l.nombre_producto)   AS nombre,
        COALESCE(ap.valor, apv.valor)            AS atributo,
        va.valor                                 AS variante,
        f.fecha,
        ${CANT_EFECTIVA}                         AS cantidad,
        ${SUBTOTAL_EFECTIVO}                     AS subtotal,
        ${SQL_COSTO_LINEA}                       AS costo,
        COALESCE(l.cantidad_devuelta, 0)         AS devueltas,
        ${obsequios.sqlEsObsequio('l')}          AS obsequio
      FROM lineas_factura l
      JOIN facturas f ON f.id = l.factura_id
      LEFT JOIN productos_cantidad pc  ON pc.id  = l.producto_id AND l.imei IS NULL
      LEFT JOIN atributos_producto ap  ON ap.id  = l.atributo_id
      LEFT JOIN variantes_atributo va  ON va.id  = l.variante_id
      LEFT JOIN atributos_producto apv ON apv.id = va.atributo_id
      WHERE ${FILTRO_VENTA}
    )
    SELECT tipo, nombre, atributo, variante,
           SUM(cantidad)                                             AS vendidas,
           SUM(subtotal)                                             AS ventas,
           SUM(costo)                                                AS costo,
           COALESCE(SUM(subtotal) FILTER (WHERE costo IS NOT NULL), 0) AS ventas_con_costo,
           COALESCE(SUM(cantidad) FILTER (WHERE costo IS NULL), 0)   AS unidades_sin_costo,
           SUM(devueltas)                                            AS devueltas,
           COALESCE(SUM(cantidad) FILTER (WHERE obsequio), 0)        AS obsequios,
           to_char(MAX(fecha), 'YYYY-MM-DD')                         AS ultima_venta
    FROM lin
    GROUP BY 1, 2, 3, 4
  `, [sedes, desde, hasta]);
  return rows;
};

// Lo que hay HOY, por nodo HOJA. Los mismos filtros que `getValorInventario`
// (la pestaña Inventario): si se separan, la suma de esta tabla dejaría de dar
// el «Costo total inventario» que el usuario ya conoce.
const _stockPorNodo = async (sedes) => {
  const { rows } = await pool.query(`
    SELECT tipo, nombre, atributo, variante,
           MAX(linea)                                                      AS linea,
           SUM(stock)::int                                                 AS stock,
           COALESCE(SUM(valor), 0)                                         AS valor_stock,
           COALESCE(SUM(uds_sin_costo), 0)::int                            AS stock_sin_costo,
           MAX(precio)                                                     AS precio
    FROM (
      SELECT 'cantidad' AS tipo, pc.nombre, NULL::text AS atributo, NULL::text AS variante,
             lp.nombre AS linea, pc.stock, pc.stock * pc.costo_unitario AS valor,
             CASE WHEN pc.costo_unitario IS NULL THEN GREATEST(pc.stock, 0) ELSE 0 END AS uds_sin_costo, pc.precio
      FROM productos_cantidad pc
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE pc.activo = true AND pc.sucursal_id = ANY($1::int[])
        AND NOT EXISTS (SELECT 1 FROM atributos_producto a WHERE a.producto_id = pc.id AND a.activo = true)

      UNION ALL
      SELECT 'cantidad', pc.nombre, ap.valor, NULL::text,
             lp.nombre, ap.stock, ap.stock * ap.costo_unitario,
             CASE WHEN ap.costo_unitario IS NULL THEN GREATEST(ap.stock, 0) ELSE 0 END, COALESCE(ap.precio, pc.precio)
      FROM atributos_producto ap
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE ap.activo = true AND pc.sucursal_id = ANY($1::int[])
        AND NOT EXISTS (SELECT 1 FROM variantes_atributo v WHERE v.atributo_id = ap.id AND v.activo = true)

      UNION ALL
      SELECT 'cantidad', pc.nombre, ap.valor, v.valor,
             lp.nombre, v.stock, v.stock * v.costo_unitario,
             CASE WHEN v.costo_unitario IS NULL THEN GREATEST(v.stock, 0) ELSE 0 END, COALESCE(v.precio, ap.precio, pc.precio)
      FROM variantes_atributo v
      JOIN atributos_producto ap ON ap.id = v.atributo_id AND ap.activo = true
      JOIN productos_cantidad pc ON pc.id = ap.producto_id AND pc.sucursal_id = ANY($1::int[])
      LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
      WHERE v.activo = true

      UNION ALL
      SELECT 'serial', ps.nombre, NULL::text, NULL::text,
             lp.nombre, COUNT(se.id)::int,
             SUM(COALESCE(vi.valor, se.costo_compra)),
             COUNT(se.id) FILTER (WHERE COALESCE(vi.valor, se.costo_compra) IS NULL)::int,
             MAX(ps.precio)
      FROM productos_serial ps
      LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
      LEFT JOIN seriales se ON se.producto_id = ps.id AND se.vendido = false AND se.prestado = false
      LEFT JOIN LATERAL (
        SELECT ${costoRed.sqlValorInternoEnStock('se.id', 'ps.sucursal_id')} AS valor
      ) vi ON TRUE
      WHERE ps.activo = true AND ps.sucursal_id = ANY($1::int[])
      GROUP BY ps.id, ps.nombre, lp.nombre
    ) hojas
    GROUP BY 1, 2, 3, 4
  `, [sedes]);
  return rows;
};

// Equipos (IMEI) que siguen en inventario: cuánto llevan ahí. La mercancía por
// cantidad no tiene fecha por unidad; la suya se mide con «No rota».
const _equiposEnStock = async (sedes) => {
  const { rows } = await pool.query(`
    SELECT nombre, MAX(linea) AS linea,
           COUNT(*)::int                                   AS unidades,
           COALESCE(SUM(costo), 0)                         AS valor,
           COUNT(*) FILTER (WHERE costo IS NULL)::int      AS sin_costo,
           ROUND(AVG(dias))::int                           AS dias_promedio,
           MAX(dias)::int                                  AS dias_max,
           COUNT(*) FILTER (WHERE dias <= 30)::int               AS d_0_30,
           COUNT(*) FILTER (WHERE dias BETWEEN 31 AND 60)::int   AS d_31_60,
           COUNT(*) FILTER (WHERE dias BETWEEN 61 AND 90)::int   AS d_61_90,
           COUNT(*) FILTER (WHERE dias > 90)::int                AS d_mas_90,
           COUNT(*) FILTER (WHERE dias > ${UMBRALES.equipo_viejo_dias})::int        AS unidades_viejas,
           COALESCE(SUM(costo) FILTER (WHERE dias > ${UMBRALES.equipo_viejo_dias}), 0) AS valor_viejo
    FROM (
      SELECT ps.nombre, lp.nombre AS linea,
             COALESCE(vi.valor, se.costo_compra) AS costo,
             GREATEST(0, ${HOY_SQL} - COALESCE(se.fecha_entrada, se.creado_en::date)) AS dias
      FROM seriales se
      JOIN productos_serial ps ON ps.id = se.producto_id
      LEFT JOIN lineas_producto lp ON lp.id = ps.linea_id
      CROSS JOIN LATERAL (
        SELECT ${costoRed.sqlValorInternoEnStock('se.id', 'ps.sucursal_id')} AS valor
      ) vi
      WHERE se.vendido = false AND se.prestado = false
        AND ps.activo = true AND ps.sucursal_id = ANY($1::int[])
    ) u
    GROUP BY nombre
  `, [sedes]);
  return rows;
};

// ── Compras ──────────────────────────────────────────────────────────────────
// «Viva» = no cancelada. Lo devuelto al proveedor se resta de lo comprado y se
// cuenta aparte: es la medida de calidad más directa que guarda el programa.
const FILTRO_COMPRA = `
  c.sucursal_id = ANY($1::int[])
  AND DATE(c.fecha) BETWEEN $2 AND $3
  AND c.proveedor_id IS NOT NULL`;
const NETA = `(lc.cantidad - COALESCE(lc.cantidad_devuelta, 0))`;

const _comprasPorProveedor = async (sedes, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT p.id AS proveedor_id, p.nombre, p.tipo, p.garantia_dias_default,
           COUNT(DISTINCT c.id) FILTER (WHERE c.estado <> 'Cancelada')::int AS compras,
           COUNT(DISTINCT c.id) FILTER (WHERE c.estado =  'Cancelada')::int AS compras_canceladas,
           COUNT(DISTINCT c.id) FILTER (WHERE c.estado <> 'Cancelada' AND c.metodo IN ('Credito', 'Fiado'))::int AS compras_credito,
           COALESCE(SUM(lc.cantidad) FILTER (WHERE c.estado <> 'Cancelada'), 0)::int AS unidades_compradas,
           COALESCE(SUM(COALESCE(lc.cantidad_devuelta, 0)) FILTER (WHERE c.estado <> 'Cancelada'), 0)::int AS unidades_devueltas,
           COALESCE(SUM(${NETA} * lc.precio_unitario) FILTER (WHERE c.estado <> 'Cancelada'), 0) AS valor,
           COALESCE(SUM(COALESCE(lc.cantidad_devuelta, 0) * lc.precio_unitario) FILTER (WHERE c.estado <> 'Cancelada'), 0) AS valor_devuelto,
           COUNT(DISTINCT lc.nombre_producto) FILTER (WHERE c.estado <> 'Cancelada')::int AS productos,
           to_char(MIN(c.fecha) FILTER (WHERE c.estado <> 'Cancelada'), 'YYYY-MM-DD') AS primera_compra,
           to_char(MAX(c.fecha) FILTER (WHERE c.estado <> 'Cancelada'), 'YYYY-MM-DD') AS ultima_compra,
           ROUND(AVG(lc.garantia_dias) FILTER (WHERE c.estado <> 'Cancelada' AND lc.garantia_dias IS NOT NULL))::int AS garantia_dias
    FROM compras c
    JOIN proveedores p   ON p.id = c.proveedor_id
    JOIN lineas_compra lc ON lc.compra_id = c.id
    WHERE ${FILTRO_COMPRA}
    GROUP BY p.id
  `, [sedes, desde, hasta]);
  return rows;
};

// Lo comprado por producto y proveedor: es la base del comparativo de precios.
// El precio promedio va PONDERADO por unidades: tres compras de 10 a $5.000 y
// una de 500 a $3.500 no promedian $4.625.
const _comprasPorProductoProveedor = async (sedes, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT
      CASE WHEN lc.imei IS NOT NULL THEN 'serial' ELSE 'cantidad' END AS tipo,
      COALESCE(pc.nombre, lc.nombre_producto) AS nombre,
      CASE WHEN va.id IS NOT NULL THEN CONCAT_WS(' / ', apv.valor, va.valor) ELSE ap.valor END AS nodo,
      p.id AS proveedor_id, p.nombre AS proveedor,
      COUNT(DISTINCT c.id)::int                    AS compras,
      SUM(${NETA})::int                            AS unidades,
      SUM(${NETA} * lc.precio_unitario)            AS valor,
      MIN(lc.precio_unitario)                      AS precio_min,
      MAX(lc.precio_unitario)                      AS precio_max,
      (array_agg(lc.precio_unitario ORDER BY c.fecha ASC,  lc.id ASC))[1]  AS precio_primero,
      (array_agg(lc.precio_unitario ORDER BY c.fecha DESC, lc.id DESC))[1] AS precio_ultimo,
      to_char(MAX(c.fecha), 'YYYY-MM-DD')          AS ultima_compra
    FROM compras c
    JOIN proveedores p    ON p.id = c.proveedor_id
    JOIN lineas_compra lc ON lc.compra_id = c.id
    LEFT JOIN productos_cantidad pc  ON pc.id  = lc.producto_id AND lc.imei IS NULL
    LEFT JOIN atributos_producto ap  ON ap.id  = lc.atributo_id
    LEFT JOIN variantes_atributo va  ON va.id  = lc.variante_id
    LEFT JOIN atributos_producto apv ON apv.id = va.atributo_id
    WHERE ${FILTRO_COMPRA}
      AND c.estado <> 'Cancelada'
    GROUP BY 1, 2, 3, p.id
    HAVING SUM(${NETA}) > 0
  `, [sedes, desde, hasta]);
  return rows;
};

// Qué pasó con los EQUIPOS (IMEI) que se le compraron a cada proveedor: cuántos
// ya se vendieron, en cuántos días y dejando cuánto. Un equipo es una unidad
// con nombre propio, así que esto es exacto; con la mercancía por cantidad no
// se puede saber de qué proveedor era la unidad que salió.
//
// La venta se busca en TODO el negocio (`$4`), no solo en las sedes del
// alcance: en una red, la bodega compra y el local vende. Es la PRIMERA venta
// posterior a la compra, con DISTINCT ON y no con un JOIN plano: un IMEI que se
// vendió, se retomó y se volvió a vender no puede contar dos veces.
const _equiposPorProveedor = async (sedes, desde, hasta, negocioId) => {
  const { rows } = await pool.query(`
    WITH comprados AS (
      SELECT lc.id, c.proveedor_id, lc.imei, lc.precio_unitario, c.fecha
      FROM lineas_compra lc
      JOIN compras c ON c.id = lc.compra_id
      WHERE ${FILTRO_COMPRA}
        AND c.estado <> 'Cancelada'
        AND lc.imei IS NOT NULL
        AND COALESCE(lc.cantidad_devuelta, 0) = 0
    ),
    vendidos AS (
      SELECT DISTINCT ON (k.id) k.id, l.precio, (f.fecha::date - k.fecha::date) AS dias
      FROM comprados k
      JOIN lineas_factura l ON l.imei = k.imei
      JOIN facturas f       ON f.id = l.factura_id AND f.estado <> 'Cancelada' AND f.fecha >= k.fecha
      JOIN sucursales sf    ON sf.id = f.sucursal_id AND sf.negocio_id = $4
      WHERE (l.cantidad - COALESCE(l.cantidad_devuelta, 0)) > 0
      ORDER BY k.id, f.fecha ASC
    )
    SELECT k.proveedor_id,
           COUNT(*)::int                                         AS equipos,
           COUNT(v.id)::int                                      AS equipos_vendidos,
           ROUND(AVG(v.dias))::int                               AS dias_para_vender,
           COALESCE(SUM(v.precio), 0)                            AS equipos_ventas,
           COALESCE(SUM(v.precio - k.precio_unitario), 0)        AS equipos_utilidad,
           COUNT(*) FILTER (WHERE v.id IS NULL)::int             AS equipos_sin_vender,
           COALESCE(SUM(k.precio_unitario) FILTER (WHERE v.id IS NULL), 0) AS valor_sin_vender,
           ROUND(AVG(${HOY_SQL} - k.fecha::date) FILTER (WHERE v.id IS NULL))::int AS dias_sin_vender
    FROM comprados k
    LEFT JOIN vendidos v ON v.id = k.id
    GROUP BY k.proveedor_id
  `, [sedes, desde, hasta, negocioId]);
  return rows;
};

const _novedadesPorProveedor = (negocioId, desde, hasta) => _tolerante('novedades de proveedor', async () => {
  const { rows } = await pool.query(`
    SELECT proveedor_id, tipo, COUNT(*)::int AS cuantas
    FROM novedades_proveedor
    WHERE negocio_id = $1 AND DATE(fecha) BETWEEN $2 AND $3
    GROUP BY 1, 2
  `, [negocioId, desde, hasta]);
  return rows;
}, []);

// ── Por mes: lo vendido, lo que costó y lo comprado ─────────────────────────
const _ventasPorMesYSede = async (sedes, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT to_char(date_trunc('month', f.fecha), 'YYYY-MM') AS mes,
           f.sucursal_id,
           COUNT(DISTINCT f.id)::int                                  AS facturas,
           COUNT(DISTINCT f.id) FILTER (WHERE f.estado = 'Credito')::int AS facturas_credito,
           SUM(${CANT_EFECTIVA})                                      AS unidades,
           SUM(${SUBTOTAL_EFECTIVO})                                  AS ventas,
           COALESCE(SUM(${SUBTOTAL_EFECTIVO}) FILTER (WHERE f.estado = 'Credito'), 0) AS ventas_credito,
           SUM(t.costo)                                               AS costo,
           COALESCE(SUM(${SUBTOTAL_EFECTIVO}) FILTER (WHERE t.costo IS NOT NULL), 0) AS ventas_con_costo
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
    CROSS JOIN LATERAL (SELECT ${SQL_COSTO_LINEA} AS costo) t
    WHERE ${FILTRO_VENTA}
    GROUP BY 1, 2
  `, [sedes, desde, hasta]);
  return rows;
};

const _comprasPorMes = async (sedes, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT to_char(date_trunc('month', c.fecha), 'YYYY-MM') AS mes,
           COUNT(DISTINCT c.id)::int        AS compras,
           SUM(${NETA})::int                AS unidades,
           SUM(${NETA} * lc.precio_unitario) AS valor,
           COALESCE(SUM(${NETA} * lc.precio_unitario) FILTER (WHERE c.metodo IN ('Credito', 'Fiado')), 0) AS valor_credito
    FROM compras c
    JOIN lineas_compra lc ON lc.compra_id = c.id
    WHERE ${FILTRO_COMPRA} AND c.estado <> 'Cancelada'
    GROUP BY 1
  `, [sedes, desde, hasta]);
  return rows;
};

// Cuándo se vende. Dos agrupaciones en una pasada (GROUPING SETS): por día de
// la semana y por hora. `dias` = cuántas fechas distintas hubo con ventas, para
// poder decir «un sábado promedio».
const _ventasPorDiaYHora = async (sedes, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT EXTRACT(ISODOW FROM f.fecha)::int AS dia,
           EXTRACT(HOUR   FROM f.fecha)::int AS hora,
           COUNT(DISTINCT f.id)::int         AS facturas,
           COUNT(DISTINCT DATE(f.fecha))::int AS dias,
           SUM(${SUBTOTAL_EFECTIVO})         AS ventas
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
    WHERE ${FILTRO_VENTA}
    GROUP BY GROUPING SETS ((EXTRACT(ISODOW FROM f.fecha)), (EXTRACT(HOUR FROM f.fecha)))
  `, [sedes, desde, hasta]);
  return rows;
};

// Clientes del período. La clave es la cédula y, sin ella, el nombre: la misma
// con la que la pestaña Créditos agrupa a una persona.
const _clientes = async (sedes, desde, hasta) => {
  const { rows } = await pool.query(`
    SELECT COALESCE(NULLIF(BTRIM(f.cedula), ''), LOWER(BTRIM(f.nombre_cliente)), '—') AS clave,
           MAX(f.nombre_cliente) AS nombre, MAX(f.cedula) AS cedula, MAX(f.celular) AS celular,
           COUNT(DISTINCT f.id)::int                                     AS facturas,
           COUNT(DISTINCT f.id) FILTER (WHERE f.estado = 'Credito')::int AS facturas_credito,
           COUNT(DISTINCT DATE(f.fecha))::int                            AS dias_de_compra,
           SUM(${SUBTOTAL_EFECTIVO})                                     AS total,
           to_char(MIN(f.fecha), 'YYYY-MM-DD')                           AS primera_compra,
           to_char(MAX(f.fecha), 'YYYY-MM-DD')                           AS ultima_compra
    FROM lineas_factura l
    JOIN facturas f ON f.id = l.factura_id
    WHERE ${FILTRO_VENTA}
    GROUP BY 1
  `, [sedes, desde, hasta]);
  return rows;
};

// Lo que deben los clientes HOY: créditos y préstamos activos. Solo CAPITAL
// (la mora y el interés los calcula `mora.service` y no caben en una suma).
// Fuera los «ajustes de deuda» (cédula AJUSTE), igual que en los reportes de
// empleado y de sede.
const _cartera = async (sedes) => {
  const { rows } = await pool.query(`
    SELECT 'credito' AS tipo,
           COALESCE('c' || cr.cliente_id, NULLIF(BTRIM(f.cedula), ''), LOWER(BTRIM(f.nombre_cliente)), '—') AS clave,
           f.nombre_cliente AS nombre, f.cedula, f.celular,
           (cr.valor_total - COALESCE(cr.total_abonado, 0)) AS saldo,
           cr.valor_total AS valor,
           GREATEST(0, ${HOY_SQL} - cr.creado_en::date)::int AS dias,
           CASE WHEN cr.fecha_limite < ${HOY_SQL} THEN (${HOY_SQL} - cr.fecha_limite)::int END AS dias_vencido
    FROM creditos cr
    JOIN facturas f ON f.id = cr.factura_id
    WHERE cr.sucursal_id = ANY($1::int[]) AND cr.estado = 'Activo'

    UNION ALL
    SELECT 'prestamo',
           COALESCE('c' || pr.cliente_id, 'p' || pr.prestatario_id, 'e' || pr.empleado_id,
                    LOWER(BTRIM(pr.prestatario)), '—'),
           pr.prestatario, pr.cedula, pr.telefono,
           (pr.valor_prestamo - COALESCE(pr.total_abonado, 0)),
           pr.valor_prestamo,
           GREATEST(0, ${HOY_SQL} - pr.fecha::date)::int,
           CASE WHEN pr.fecha_limite < ${HOY_SQL} THEN (${HOY_SQL} - pr.fecha_limite)::int END
    FROM prestamos pr
    WHERE pr.sucursal_id = ANY($1::int[]) AND pr.estado = 'Activo'
      AND COALESCE(pr.cedula, '') <> 'AJUSTE'
  `, [sedes]);
  return rows;
};

// ═════════════════════════════════════════════════════════════════════════════
// ARMADO — todo lo de aquí abajo es aritmética sobre las filas de arriba
// ═════════════════════════════════════════════════════════════════════════════

// Utilidad y margen de un grupo de líneas: SOLO sobre lo vendido con costo.
const _rentabilidad = (x) => {
  const conCosto = x.costo !== null && x.costo !== undefined;
  const utilidad = conCosto ? x.ventas_con_costo - x.costo : null;
  return {
    utilidad,
    margen_pct: utilidad !== null && x.ventas_con_costo > 0 ? r1((utilidad / x.ventas_con_costo) * 100) : null,
  };
};

const _suma = (acc, k, v) => { acc[k] = (acc[k] || 0) + n0(v); };
const _sumaCosto = (acc, v) => { if (v !== null && v !== undefined) acc.costo = (acc.costo ?? 0) + Number(v); };
const _mayorFecha = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

const _nuevoProducto = (tipo, nombre) => ({
  tipo, nombre, linea: null,
  vendidas: 0, ventas: 0, costo: null, ventas_con_costo: 0, unidades_sin_costo: 0,
  devueltas: 0, obsequios: 0, ultima_venta: null,
  stock: 0, valor_stock: 0, stock_sin_costo: 0, precio: null,
  comprado_unidades: 0, comprado_valor: 0, proveedores: 0, ultima_compra: null,
});

// Las señales de un producto (o de una variante). `dias` = días del período;
// `hoy` = 'YYYY-MM-DD'.
const _senalesProducto = (p, dias, hoy, margenLinea = null) => {
  const s = [];
  const ritmo = p.vendidas > 0 ? p.vendidas / dias : 0;
  const cobertura = ritmo > 0 ? p.stock / ritmo : null;
  const diasDesdeCompra = p.ultima_compra ? diasEntre(p.ultima_compra, hoy) - 1 : null;

  if (p.stock > 0 && p.vendidas === 0) {
    // Lo que acaba de llegar no ha tenido tiempo de venderse.
    if (diasDesdeCompra === null || diasDesdeCompra >= UMBRALES.recien_comprado_dias) s.push('sin_rotacion');
    else s.push('recien_comprado');
  }
  if (p.stock <= 0 && p.vendidas > 0) s.push('agotado');
  else if (cobertura !== null && cobertura < UMBRALES.por_agotarse_dias) s.push('por_agotarse');
  if (cobertura !== null && cobertura > UMBRALES.sobrestock_dias) s.push('sobrestock');
  if (p.utilidad !== null && p.utilidad < 0) s.push('perdida');
  else if (p.margen_pct !== null) {
    const liston = margenLinea !== null
      ? margenLinea * (UMBRALES.margen_bajo_vs_linea_pct / 100)
      : UMBRALES.margen_bajo_pct;
    if (p.margen_pct < liston) s.push('margen_bajo');
  }
  if (p.unidades_sin_costo > 0 || p.stock_sin_costo > 0) s.push('sin_costo');
  return {
    senales: s,
    cobertura_dias: cobertura === null ? null : Math.round(cobertura),
    venta_diaria: r1(ritmo),
    // Hace cuánto no se vende (dentro del período): un producto puede haber
    // vendido bien el primer mes y llevar cuarenta días quieto.
    dias_sin_vender: p.ultima_venta && p.stock > 0 ? diasEntre(p.ultima_venta, hoy) - 1 : null,
    margen_linea_pct: margenLinea,
  };
};

const _armarProductos = ({ ventas, stock, compras, dias, hoy }) => {
  const mapa = new Map();
  const nodos = new Map();   // tallas y colores, para la tabla de variantes
  const tomar = (tipo, nombre) => {
    const k = claveProducto(tipo, nombre);
    if (!mapa.has(k)) mapa.set(k, _nuevoProducto(tipo, nombre));
    return mapa.get(k);
  };
  const tomarNodo = (r) => {
    if (!r.atributo) return null;
    const k = `${claveProducto(r.tipo, r.nombre)}|${r.atributo}|${r.variante ?? ''}`.toLowerCase();
    if (!nodos.has(k)) {
      nodos.set(k, {
        ..._nuevoProducto(r.tipo, r.nombre),
        variante: r.variante ? `${r.atributo} / ${r.variante}` : r.atributo,
      });
    }
    return nodos.get(k);
  };

  for (const r of ventas) {
    for (const d of [tomar(r.tipo, r.nombre), tomarNodo(r)]) {
      if (!d) continue;
      _suma(d, 'vendidas', r.vendidas); _suma(d, 'ventas', r.ventas);
      _suma(d, 'ventas_con_costo', r.ventas_con_costo);
      _suma(d, 'unidades_sin_costo', r.unidades_sin_costo);
      _suma(d, 'devueltas', r.devueltas); _suma(d, 'obsequios', r.obsequios);
      _sumaCosto(d, r.costo);
      d.ultima_venta = _mayorFecha(d.ultima_venta, r.ultima_venta);
    }
  }
  for (const r of stock) {
    for (const d of [tomar(r.tipo, r.nombre), tomarNodo(r)]) {
      if (!d) continue;
      _suma(d, 'stock', r.stock); _suma(d, 'valor_stock', r.valor_stock);
      _suma(d, 'stock_sin_costo', r.stock_sin_costo);
      d.linea = d.linea || r.linea || null;
      d.precio = d.precio ?? n(r.precio);
    }
  }
  const provPorProducto = new Map();
  for (const r of compras) {
    const d = tomar(r.tipo, r.nombre);
    _suma(d, 'comprado_unidades', r.unidades); _suma(d, 'comprado_valor', r.valor);
    d.ultima_compra = _mayorFecha(d.ultima_compra, r.ultima_compra);
    const k = claveProducto(r.tipo, r.nombre);
    if (!provPorProducto.has(k)) provPorProducto.set(k, new Set());
    provPorProducto.get(k).add(r.proveedor_id);
  }
  for (const [k, set] of provPorProducto) mapa.get(k).proveedores = set.size;

  // El margen de cada línea, para medir contra él el de sus productos. Solo
  // sirve de referencia una línea con varios productos vendidos: con uno o dos,
  // la línea ES el producto.
  const porLinea = new Map();
  for (const p of mapa.values()) {
    if (p.costo === null || p.vendidas <= 0) continue;
    const k = p.linea || '';
    if (!porLinea.has(k)) porLinea.set(k, { ventas_con_costo: 0, costo: 0, productos: 0 });
    const l = porLinea.get(k);
    l.ventas_con_costo += p.ventas_con_costo; l.costo += p.costo; l.productos += 1;
  }
  const margenDeLinea = (linea) => {
    const l = porLinea.get(linea || '');
    if (!l || l.productos < UMBRALES.linea_minimo_productos || l.ventas_con_costo <= 0) return null;
    return r1(((l.ventas_con_costo - l.costo) / l.ventas_con_costo) * 100);
  };
  const lineaDe = new Map([...mapa.values()].map((p) => [claveProducto(p.tipo, p.nombre), p.linea]));

  const cerrar = (d) => {
    const rent = _rentabilidad(d);
    const fila = { ...d, ...rent, linea: d.linea ?? lineaDe.get(claveProducto(d.tipo, d.nombre)) ?? null };
    return { ...fila, ..._senalesProducto(fila, dias, hoy, margenDeLinea(fila.linea)) };
  };

  // Solo lo que cuenta algo: se vendió, hay en stock o se compró.
  const productos = [...mapa.values()]
    .filter((p) => p.vendidas > 0 || p.stock > 0 || p.comprado_unidades > 0)
    .map(cerrar);

  // ── Clase ABC por utilidad ────────────────────────────────────────────────
  // A = los productos que, sumados de mayor a menor, hacen el 80 % de la
  // utilidad; B el siguiente 15 %; C el resto. Lo que da pérdida o no tiene
  // costo no entra en el reparto.
  const conUtilidad = productos.filter((p) => p.utilidad !== null && p.utilidad > 0)
    .sort((a, b) => b.utilidad - a.utilidad);
  const totalUtilidad = conUtilidad.reduce((s, p) => s + p.utilidad, 0);
  let acumulado = 0;
  for (const p of conUtilidad) {
    const antes = acumulado;
    acumulado += p.utilidad;
    p.participacion_utilidad_pct = r1(pct(p.utilidad, totalUtilidad));
    // Entra en la clase el producto que EMPIEZA dentro del tramo: así el
    // primero siempre es A aunque él solo pase del 80 %.
    const inicio = pct(antes, totalUtilidad);
    p.clase = inicio < UMBRALES.abc_a_pct ? 'A' : inicio < UMBRALES.abc_b_pct ? 'B' : 'C';
  }
  const totalVentas = productos.reduce((s, p) => s + p.ventas, 0);
  for (const p of productos) {
    p.clase = p.clase ?? (p.vendidas > 0 ? 'C' : null);
    p.participacion_utilidad_pct = p.participacion_utilidad_pct ?? null;
    p.participacion_ventas_pct = r1(pct(p.ventas, totalVentas));
  }
  productos.sort((a, b) => (b.utilidad ?? -Infinity) - (a.utilidad ?? -Infinity) || b.ventas - a.ventas);

  const variantes = [...nodos.values()]
    .filter((v) => v.vendidas > 0 || v.stock > 0)
    .map(cerrar)
    .map(({ comprado_unidades, comprado_valor, proveedores, ultima_compra, ...v }) => v)
    .sort((a, b) => a.nombre.localeCompare(b.nombre) || b.vendidas - a.vendidas);

  return { productos, variantes };
};

const _armarLineas = (productos, dias) => {
  const mapa = new Map();
  for (const p of productos) {
    const k = p.linea || 'Sin línea';
    if (!mapa.has(k)) {
      mapa.set(k, {
        linea: k, productos: 0, productos_vendidos: 0, vendidas: 0, ventas: 0, costo: null,
        ventas_con_costo: 0, stock: 0, valor_stock: 0, comprado_valor: 0,
        productos_sin_rotacion: 0, valor_sin_rotacion: 0,
      });
    }
    const l = mapa.get(k);
    l.productos += 1;
    if (p.vendidas > 0) l.productos_vendidos += 1;
    l.vendidas += p.vendidas; l.ventas += p.ventas; l.ventas_con_costo += p.ventas_con_costo;
    _sumaCosto(l, p.costo);
    l.stock += p.stock; l.valor_stock += p.valor_stock; l.comprado_valor += p.comprado_valor;
    if (p.senales.includes('sin_rotacion')) { l.productos_sin_rotacion += 1; l.valor_sin_rotacion += p.valor_stock; }
  }
  const totalVentas = [...mapa.values()].reduce((s, l) => s + l.ventas, 0);
  const totalStock  = [...mapa.values()].reduce((s, l) => s + l.valor_stock, 0);
  return [...mapa.values()].map((l) => {
    const rent = _rentabilidad(l);
    // Cuántos días dura el inventario de la línea al ritmo al que se vende
    // (a costo contra costo: las dos cifras en la misma moneda).
    const costoDiario = l.costo ? l.costo / dias : 0;
    return {
      ...l, ...rent,
      participacion_ventas_pct: r1(pct(l.ventas, totalVentas)),
      participacion_stock_pct:  r1(pct(l.valor_stock, totalStock)),
      cobertura_dias: costoDiario > 0 ? Math.round(l.valor_stock / costoDiario) : null,
    };
  }).sort((a, b) => b.ventas - a.ventas);
};

// El comparativo de precios: el mismo producto, comprado a varios proveedores.
const _armarPrecios = (compras) => {
  const grupos = new Map();
  for (const r of compras) {
    const k = `${claveProducto(r.tipo, r.nombre)}|${(r.nodo ?? '').toLowerCase()}`;
    if (!grupos.has(k)) grupos.set(k, []);
    const unidades = n0(r.unidades), valor = n0(r.valor);
    grupos.get(k).push({
      tipo: r.tipo, producto: r.nombre, variante: r.nodo || null,
      proveedor_id: r.proveedor_id, proveedor: r.proveedor || '(sin nombre)',
      compras: n0(r.compras), unidades, valor,
      precio_promedio: unidades > 0 ? valor / unidades : null,
      precio_min: n(r.precio_min), precio_max: n(r.precio_max),
      precio_primero: n(r.precio_primero), precio_ultimo: n(r.precio_ultimo),
      variacion_pct: n(r.precio_primero) > 0 ? r1(((n(r.precio_ultimo) - n(r.precio_primero)) / n(r.precio_primero)) * 100) : null,
      ultima_compra: r.ultima_compra,
    });
  }
  const filas = [];
  for (const g of grupos.values()) {
    const comparable = g.length > 1;
    const mejor = Math.min(...g.map((x) => x.precio_promedio ?? Infinity));
    const mejorProv = g.find((x) => x.precio_promedio === mejor);
    for (const x of g) {
      const dif = comparable && mejor > 0 ? ((x.precio_promedio - mejor) / mejor) * 100 : null;
      filas.push({
        ...x,
        proveedores_del_producto: g.length,
        comparable,
        mejor_precio: comparable ? mejor : null,
        mejor_proveedor: comparable ? mejorProv.proveedor : null,
        diferencia_pct: dif === null ? null : r1(dif),
        // Lo que se habría pagado de menos comprándole todo al más barato.
        sobrecosto: comparable ? Math.max(0, Math.round((x.precio_promedio - mejor) * x.unidades)) : 0,
        senales: comparable && dif > UMBRALES.precio_mas_caro_pct ? ['mas_caro']
          : comparable && x === mejorProv ? ['mejor_precio'] : [],
      });
    }
  }
  return filas.sort((a, b) => b.sobrecosto - a.sobrecosto || Number(b.comparable) - Number(a.comparable) || b.valor - a.valor);
};

const _armarProveedores = ({ compras, equipos, deudas, novedades, precios }) => {
  const totalValor = compras.reduce((s, c) => s + n0(c.valor), 0);
  const eq  = new Map(equipos.map((e) => [Number(e.proveedor_id), e]));
  const deu = new Map(deudas.map((d) => [Number(d.proveedor_id), d]));
  const nov = new Map();
  for (const x of novedades) {
    const id = Number(x.proveedor_id);
    nov.set(id, (nov.get(id) || 0) + n0(x.cuantas));
  }
  // De los productos que también vende otro proveedor: en cuántos sale más caro.
  const caro = new Map();
  for (const f of precios) {
    if (!f.comparable) continue;
    const id = Number(f.proveedor_id);
    if (!caro.has(id)) caro.set(id, { comparables: 0, mas_caro: 0, sobrecosto: 0 });
    const c = caro.get(id);
    c.comparables += 1;
    if (f.senales.includes('mas_caro')) { c.mas_caro += 1; c.sobrecosto += f.sobrecosto; }
  }

  return compras.map((c) => {
    const id = Number(c.proveedor_id);
    const e = eq.get(id), d = deu.get(id), k = caro.get(id);
    const compradas = n0(c.unidades_compradas), devueltas = n0(c.unidades_devueltas);
    const equiposN = n0(e?.equipos), vendidos = n0(e?.equipos_vendidos);
    const fila = {
      proveedor_id: id,
      proveedor: c.nombre || '(sin nombre)',
      tipo: c.tipo,
      compras: n0(c.compras),
      compras_canceladas: n0(c.compras_canceladas),
      compras_credito: n0(c.compras_credito),
      productos: n0(c.productos),
      unidades: compradas - devueltas,
      valor: n0(c.valor),
      participacion_pct: r1(pct(n0(c.valor), totalValor)),
      unidades_devueltas: devueltas,
      valor_devuelto: n0(c.valor_devuelto),
      devuelto_pct: r1(pct(devueltas, compradas)),
      novedades: nov.get(id) || 0,
      garantia_dias: n(c.garantia_dias) ?? n(c.garantia_dias_default),
      primera_compra: c.primera_compra,
      ultima_compra: c.ultima_compra,
      // Sus equipos (IMEI)
      equipos: equiposN,
      equipos_vendidos: vendidos,
      equipos_vendidos_pct: r1(pct(vendidos, equiposN)),
      dias_para_vender: n(e?.dias_para_vender),
      equipos_utilidad: e ? n0(e.equipos_utilidad) : null,
      equipos_margen_pct: e && n0(e.equipos_ventas) > 0 ? r1((n0(e.equipos_utilidad) / n0(e.equipos_ventas)) * 100) : null,
      equipos_sin_vender: n0(e?.equipos_sin_vender),
      valor_sin_vender: n0(e?.valor_sin_vender),
      dias_sin_vender: n(e?.dias_sin_vender),
      // Precios frente a los demás
      productos_comparables: k?.comparables || 0,
      productos_mas_caro: k?.mas_caro || 0,
      sobrecosto: k?.sobrecosto || 0,
      // La cuenta HOY (es del negocio, no del período ni de la sede)
      deuda: d ? Math.max(0, n0(d.saldo)) : 0,
      deuda_vencida: d ? n0(d.saldo_vencido) : 0,
    };
    const s = [];
    if (fila.participacion_pct !== null && fila.participacion_pct > UMBRALES.concentracion_proveedor_pct) s.push('concentracion');
    if (fila.devuelto_pct !== null && fila.devuelto_pct > UMBRALES.devoluciones_pct) s.push('devoluciones');
    if (fila.productos_mas_caro > 0) s.push('mas_caro');
    // Con la compra de ayer no hay nada que reprochar: se exige que lo que
    // queda lleve un tiempo comprado.
    if (equiposN >= UMBRALES.equipos_minimos
        && fila.equipos_vendidos_pct < UMBRALES.equipos_rotacion_pct
        && (fila.dias_sin_vender ?? 0) >= UMBRALES.equipos_dias_minimos) s.push('equipos_no_rotan');
    if (fila.equipos_utilidad !== null && vendidos > 0 && fila.equipos_utilidad < 0) s.push('perdida');
    if (fila.deuda_vencida > 0) s.push('deuda_vencida');
    if (fila.novedades > 0) s.push('novedades');
    return { ...fila, senales: s };
  }).sort((a, b) => b.valor - a.valor);
};

const _armarMeses = ({ ventasMes, comprasMes }) => {
  const mapa = new Map();
  const tomar = (mes) => {
    if (!mapa.has(mes)) {
      mapa.set(mes, {
        mes, facturas: 0, facturas_credito: 0, unidades_vendidas: 0, ventas: 0, ventas_credito: 0,
        costo: null, ventas_con_costo: 0,
        compras: 0, unidades_compradas: 0, comprado: 0, comprado_credito: 0,
      });
    }
    return mapa.get(mes);
  };
  for (const r of ventasMes) {
    const m = tomar(r.mes);
    m.facturas += n0(r.facturas); m.facturas_credito += n0(r.facturas_credito);
    m.unidades_vendidas += n0(r.unidades); m.ventas += n0(r.ventas); m.ventas_credito += n0(r.ventas_credito);
    m.ventas_con_costo += n0(r.ventas_con_costo);
    _sumaCosto(m, r.costo);
  }
  for (const r of comprasMes) {
    const m = tomar(r.mes);
    m.compras = n0(r.compras); m.unidades_compradas = n0(r.unidades);
    m.comprado = n0(r.valor); m.comprado_credito = n0(r.valor_credito);
  }
  return [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes)).map((m) => {
    const rent = _rentabilidad(m);
    return {
      ...m, ...rent,
      ticket_promedio: m.facturas > 0 ? Math.round(m.ventas / m.facturas) : null,
      // Comprado contra lo que costó lo vendido: por encima de 100 % el
      // inventario creció ese mes; por debajo, se vendió de lo que ya había.
      comprado_vs_costo_pct: m.costo ? r1((m.comprado / m.costo) * 100) : null,
    };
  });
};

const _armarSedes = (ventasMes, sedes) => {
  const nombre = new Map(sedes.map((s) => [Number(s.id), s.nombre]));
  const mapa = new Map();
  for (const r of ventasMes) {
    const id = Number(r.sucursal_id);
    if (!mapa.has(id)) mapa.set(id, { sede: nombre.get(id) || `Sede ${id}`, facturas: 0, unidades_vendidas: 0, ventas: 0, costo: null, ventas_con_costo: 0 });
    const m = mapa.get(id);
    m.facturas += n0(r.facturas); m.unidades_vendidas += n0(r.unidades);
    m.ventas += n0(r.ventas); m.ventas_con_costo += n0(r.ventas_con_costo);
    _sumaCosto(m, r.costo);
  }
  const total = [...mapa.values()].reduce((s, m) => s + m.ventas, 0);
  return [...mapa.values()].map((m) => ({
    ...m, ..._rentabilidad(m),
    ticket_promedio: m.facturas > 0 ? Math.round(m.ventas / m.facturas) : null,
    participacion_pct: r1(pct(m.ventas, total)),
  })).sort((a, b) => b.ventas - a.ventas);
};

const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const _armarCuando = (filas) => {
  const porDia = filas.filter((f) => f.dia !== null).map((f) => ({
    orden: f.dia, dia: DIAS[f.dia], dias_con_ventas: n0(f.dias), facturas: n0(f.facturas), ventas: n0(f.ventas),
    promedio_por_dia: n0(f.dias) > 0 ? Math.round(n0(f.ventas) / n0(f.dias)) : null,
    facturas_por_dia: n0(f.dias) > 0 ? r1(n0(f.facturas) / n0(f.dias)) : null,
  })).sort((a, b) => a.orden - b.orden);
  const totalDia = porDia.reduce((s, d) => s + d.ventas, 0);
  porDia.forEach((d) => { d.participacion_pct = r1(pct(d.ventas, totalDia)); });

  const porHora = filas.filter((f) => f.hora !== null).map((f) => ({
    orden: f.hora, hora: `${String(f.hora).padStart(2, '0')}:00`,
    facturas: n0(f.facturas), ventas: n0(f.ventas),
  })).sort((a, b) => a.orden - b.orden);
  const totalHora = porHora.reduce((s, h) => s + h.ventas, 0);
  porHora.forEach((h) => { h.participacion_pct = r1(pct(h.ventas, totalHora)); });
  return { por_dia: porDia, por_hora: porHora };
};

// «Cliente genérico»: la venta de mostrador sin nombre. No es un cliente, así
// que no puede encabezar el ranking ni contar como «recurrente».
const _esGenerico = (c) => /^0+$/.test(String(c.cedula ?? '').trim())
  || /^2{6,}$/.test(String(c.cedula ?? '').trim())
  || /cliente\s+gen[eé]ric|consumidor\s+final|cliente\s+general|^\s*—?\s*$/i.test(String(c.nombre ?? ''));

const TOPE_CLIENTES = 300;
const _armarClientes = (filas) => {
  const todos = filas.map((c) => ({
    cliente: c.nombre || '(sin nombre)', cedula: c.cedula || null, celular: c.celular || null,
    generico: _esGenerico(c),
    facturas: n0(c.facturas), facturas_credito: n0(c.facturas_credito), dias_de_compra: n0(c.dias_de_compra),
    total: n0(c.total),
    ticket_promedio: n0(c.facturas) > 0 ? Math.round(n0(c.total) / n0(c.facturas)) : null,
    primera_compra: c.primera_compra, ultima_compra: c.ultima_compra,
  })).sort((a, b) => b.total - a.total);

  const total = todos.reduce((s, c) => s + c.total, 0);
  const reales = todos.filter((c) => !c.generico);
  const totalReales = reales.reduce((s, c) => s + c.total, 0);
  todos.forEach((c) => {
    c.participacion_pct = r1(pct(c.total, total));
    c.senales = c.generico ? ['generico'] : c.dias_de_compra >= 2 ? ['recurrente'] : [];
  });
  const recurrentes = reales.filter((c) => c.dias_de_compra >= 2);
  return {
    resumen: {
      clientes: reales.length,
      recurrentes: recurrentes.length,
      recurrentes_pct: r1(pct(recurrentes.length, reales.length)),
      ventas_recurrentes_pct: r1(pct(recurrentes.reduce((s, c) => s + c.total, 0), total)),
      ventas_sin_identificar: total - totalReales,
      ventas_sin_identificar_pct: r1(pct(total - totalReales, total)),
      top10_pct: r1(pct(reales.slice(0, 10).reduce((s, c) => s + c.total, 0), total)),
      listados: Math.min(todos.length, TOPE_CLIENTES),
      total_en_el_periodo: todos.length,
    },
    filas: todos.slice(0, TOPE_CLIENTES),
  };
};

const TRAMOS_CARTERA = [
  { clave: '0_30',   etiqueta: '0 a 30 días',  desde: 0,  hasta: 30 },
  { clave: '31_60',  etiqueta: '31 a 60 días', desde: 31, hasta: 60 },
  { clave: '61_90',  etiqueta: '61 a 90 días', desde: 61, hasta: 90 },
  { clave: 'mas_90', etiqueta: 'Más de 90 días', desde: 91, hasta: Infinity },
];
const TOPE_DEUDORES = 300;
const _armarCartera = (filas) => {
  const docs = filas.map((d) => ({ ...d, saldo: n0(d.saldo), dias: n0(d.dias), dias_vencido: n(d.dias_vencido) }))
    .filter((d) => d.saldo > 0);
  const total = docs.reduce((s, d) => s + d.saldo, 0);

  const antiguedad = TRAMOS_CARTERA.map((t) => {
    const en = docs.filter((d) => d.dias >= t.desde && d.dias <= t.hasta);
    const saldo = en.reduce((s, d) => s + d.saldo, 0);
    return {
      tramo: t.etiqueta,
      documentos: en.length,
      creditos: en.filter((d) => d.tipo === 'credito').length,
      prestamos: en.filter((d) => d.tipo === 'prestamo').length,
      saldo, participacion_pct: r1(pct(saldo, total)),
      senales: t.desde > UMBRALES.cartera_vieja_dias && saldo > 0 ? ['cartera_vieja'] : [],
    };
  });

  const personas = new Map();
  for (const d of docs) {
    if (!personas.has(d.clave)) {
      personas.set(d.clave, {
        cliente: d.nombre || '(sin nombre)', cedula: d.cedula || null, celular: d.celular || null,
        documentos: 0, creditos: 0, prestamos: 0, saldo: 0, saldo_vencido: 0, dias_mas_antiguo: 0, dias_vencido: null,
      });
    }
    const p = personas.get(d.clave);
    p.documentos += 1;
    p[d.tipo === 'credito' ? 'creditos' : 'prestamos'] += 1;
    p.saldo += d.saldo;
    p.dias_mas_antiguo = Math.max(p.dias_mas_antiguo, d.dias);
    if (d.dias_vencido !== null) {
      p.saldo_vencido += d.saldo;
      p.dias_vencido = Math.max(p.dias_vencido ?? 0, d.dias_vencido);
    }
  }
  const deudores = [...personas.values()].map((p) => ({
    ...p,
    participacion_pct: r1(pct(p.saldo, total)),
    senales: [
      ...(p.saldo_vencido > 0 ? ['vencido'] : []),
      ...(p.dias_mas_antiguo > UMBRALES.cartera_vieja_dias ? ['cartera_vieja'] : []),
    ],
  })).sort((a, b) => b.saldo - a.saldo);

  const viejo = docs.filter((d) => d.dias > UMBRALES.cartera_vieja_dias).reduce((s, d) => s + d.saldo, 0);
  const vencido = docs.filter((d) => d.dias_vencido !== null).reduce((s, d) => s + d.saldo, 0);
  return {
    resumen: {
      por_cobrar: total,
      documentos: docs.length,
      deudores: deudores.length,
      en_creditos: docs.filter((d) => d.tipo === 'credito').reduce((s, d) => s + d.saldo, 0),
      en_prestamos: docs.filter((d) => d.tipo === 'prestamo').reduce((s, d) => s + d.saldo, 0),
      vencido, vencido_pct: r1(pct(vencido, total)),
      viejo, viejo_pct: r1(pct(viejo, total)),
      sin_plazo: docs.filter((d) => d.dias_vencido === null).length,
      top5_pct: r1(pct(deudores.slice(0, 5).reduce((s, p) => s + p.saldo, 0), total)),
      total_deudores: deudores.length,
    },
    antiguedad,
    deudores: deudores.slice(0, TOPE_DEUDORES),
  };
};

const _armarEquipos = (filas) => filas.map((e) => ({
  producto: e.nombre, linea: e.linea || null,
  unidades: n0(e.unidades), valor: n0(e.valor), sin_costo: n0(e.sin_costo),
  dias_promedio: n(e.dias_promedio), dias_max: n(e.dias_max),
  d_0_30: n0(e.d_0_30), d_31_60: n0(e.d_31_60), d_61_90: n0(e.d_61_90), d_mas_90: n0(e.d_mas_90),
  unidades_viejas: n0(e.unidades_viejas), valor_viejo: n0(e.valor_viejo),
  senales: n0(e.unidades_viejas) > 0 ? ['equipo_viejo'] : [],
})).sort((a, b) => b.valor_viejo - a.valor_viejo || b.dias_max - a.dias_max);

// ── Los hallazgos: lo que un asesor diría primero ────────────────────────────
//
// Cada uno es un HECHO con su número, sacado de las tablas de abajo, y dice de
// qué tabla sale para que se pueda ir a comprobar. `nivel`: 'alerta' (cuesta
// plata hoy), 'atencion' (vale la pena mirar), 'dato' (contexto).
const $ = (v) => `$${Math.round(n0(v)).toLocaleString('es-CO')}`;
const plural = (k, uno, varios) => `${k} ${k === 1 ? uno : varios}`;

const _hallazgos = (d) => {
  const h = [];
  const poner = (nivel, tabla, titulo, detalle) => h.push({ nivel, tabla, titulo, detalle });
  const { productos, proveedores, precios_compra: precios, meses, cartera, equipos_stock: equipos,
    clientes, cuando, lineas, resumen } = d;

  // — Proveedores —
  // En la mercancía por cantidad el artículo es EL MISMO, así que la diferencia
  // de precio es plata. En un equipo puede ser el estado de esa unidad: se
  // informa aparte y sin llamarlo sobrecosto.
  const caros = precios.filter((p) => p.sobrecosto > 0);
  const deMercancia = caros.filter((p) => p.tipo === 'cantidad');
  const deEquipos   = caros.filter((p) => p.tipo === 'serial');
  const caso = (p) => `«${p.producto}${p.variante ? ` (${p.variante})` : ''}»: ${p.proveedor} a ${$(p.precio_promedio)} y ${p.mejor_proveedor} a ${$(p.mejor_precio)} `
    + `(${p.diferencia_pct} % más, ${$(p.sobrecosto)} en ${plural(p.unidades, 'ud', 'uds')})`;
  const productosDe = (l) => new Set(l.map((p) => `${p.producto}|${p.variante ?? ''}`)).size;
  if (deMercancia.length) {
    poner('alerta', 'precios_compra',
      `El mismo artículo te costó ${$(deMercancia.reduce((s, p) => s + p.sobrecosto, 0))} más según a quién se lo compraste`,
      `${plural(productosDe(deMercancia), 'producto se compró', 'productos se compraron')} a más de un proveedor a precios distintos. `
      + `Comprándole cada uno al más barato esa plata no habría salido. El caso más grande: ${caso(deMercancia[0])}.`);
  }
  if (deEquipos.length) {
    poner('atencion', 'precios_compra',
      `El mismo modelo de equipo se compró con ${$(deEquipos.reduce((s, p) => s + p.sobrecosto, 0))} de diferencia entre proveedores`,
      `${plural(productosDe(deEquipos), 'modelo', 'modelos')}. En equipos la diferencia puede ser el estado de cada unidad, así que hay que mirarlo caso por caso. El mayor: ${caso(deEquipos[0])}.`);
  }
  const top = proveedores[0];
  if (top && top.participacion_pct > UMBRALES.concentracion_proveedor_pct && proveedores.length > 1) {
    poner('atencion', 'proveedores', `${top.proveedor} concentra el ${top.participacion_pct} % de lo que compras`,
      `Le compraste ${$(top.valor)} de ${$(resumen.comprado)}. Depender tanto de uno solo deja al negocio sin alternativa si falla o sube precios.`);
  }
  for (const p of proveedores.filter((x) => x.senales.includes('equipos_no_rotan')).slice(0, 3)) {
    poner('alerta', 'proveedores', `Los equipos de ${p.proveedor} no se están vendiendo`,
      `De ${p.equipos} equipos comprados se han vendido ${p.equipos_vendidos} (${p.equipos_vendidos_pct} %). `
      + `Quedan ${p.equipos_sin_vender} por ${$(p.valor_sin_vender)}, con ${p.dias_sin_vender ?? 0} días en promedio desde la compra.`);
  }
  for (const p of proveedores.filter((x) => x.senales.includes('devoluciones')).slice(0, 3)) {
    poner('atencion', 'proveedores', `A ${p.proveedor} le devolviste el ${p.devuelto_pct} % de lo comprado`,
      `${plural(p.unidades_devueltas, 'unidad devuelta', 'unidades devueltas')} por ${$(p.valor_devuelto)}. Por encima del ${UMBRALES.devoluciones_pct} % conviene revisar la calidad de lo que entrega.`);
  }
  const vencida = proveedores.filter((p) => p.deuda_vencida > 0);
  if (vencida.length) {
    poner('alerta', 'proveedores', `Tienes ${$(vencida.reduce((s, p) => s + p.deuda_vencida, 0))} vencidos con ${plural(vencida.length, 'proveedor', 'proveedores')}`,
      `${vencida.slice(0, 4).map((p) => `${p.proveedor} (${$(p.deuda_vencida)})`).join(', ')}. Una factura vencida es la forma más rápida de perder el crédito y el buen precio.`);
  }

  // — Compras contra ventas —
  if (resumen.comprado > 0 && resumen.costo_vendido > 0) {
    const ratio = r1((resumen.comprado / resumen.costo_vendido) * 100);
    if (ratio > 130) {
      poner('atencion', 'meses', `Compraste ${ratio} % de lo que costó lo que vendiste`,
        `Entró mercancía por ${$(resumen.comprado)} y salió mercancía que costó ${$(resumen.costo_vendido)}: el inventario creció ${$(resumen.comprado - resumen.costo_vendido)} en el período. Esa diferencia es plata quieta en el estante.`);
    } else if (ratio < 70) {
      poner('dato', 'meses', `Vendiste más de lo que repusiste (${ratio} %)`,
        `Compraste ${$(resumen.comprado)} y lo vendido costó ${$(resumen.costo_vendido)}. El inventario bajó: revisa que no falte lo que más se vende.`);
    }
  }

  // — Productos —
  const sinRot = productos.filter((p) => p.senales.includes('sin_rotacion'));
  if (sinRot.length) {
    const valor = sinRot.reduce((s, p) => s + p.valor_stock, 0);
    const mayores = [...sinRot].sort((a, b) => b.valor_stock - a.valor_stock).slice(0, 3);
    poner(valor > 0 && pct(valor, resumen.inventario) > 15 ? 'alerta' : 'atencion', 'productos',
      sinRot.length === 1 ? '1 producto tiene stock y no vendió ni una unidad'
        : `${sinRot.length} productos tienen stock y no vendieron ni una unidad`,
      `Suman ${$(valor)} en costo${resumen.inventario > 0 ? ` (${r1(pct(valor, resumen.inventario))} % del inventario)` : ''}. `
      + `Los más pesados: ${mayores.map((p) => `${p.nombre} (${p.stock} uds, ${$(p.valor_stock)})`).join('; ')}.`);
  }
  const agotados = productos.filter((p) => p.senales.includes('agotado')).sort((a, b) => b.ventas - a.ventas);
  if (agotados.length) {
    poner('alerta', 'productos', `${plural(agotados.length, 'producto que se vende está agotado', 'productos que se venden están agotados')}`,
      `Vendieron ${$(agotados.reduce((s, p) => s + p.ventas, 0))} en el período y hoy no hay ninguno. `
      + `Los que más vendían: ${agotados.slice(0, 4).map((p) => `${p.nombre} (${p.vendidas} uds)`).join('; ')}.`);
  }
  const porAgotar = productos.filter((p) => p.senales.includes('por_agotarse')).sort((a, b) => b.ventas - a.ventas);
  if (porAgotar.length) {
    poner('atencion', 'productos', `${plural(porAgotar.length, 'producto tiene', 'productos tienen')} stock para menos de ${UMBRALES.por_agotarse_dias} días`,
      `Al ritmo del período: ${porAgotar.slice(0, 4).map((p) => `${p.nombre} (quedan ${p.stock}, ${p.cobertura_dias} días)`).join('; ')}.`);
  }
  const perdida = productos.filter((p) => p.senales.includes('perdida')).sort((a, b) => a.utilidad - b.utilidad);
  if (perdida.length) {
    poner('alerta', 'productos', `${plural(perdida.length, 'producto se vendió', 'productos se vendieron')} por debajo del costo`,
      `Pérdida de ${$(Math.abs(perdida.reduce((s, p) => s + p.utilidad, 0)))}. ${perdida.slice(0, 3).map((p) => `${p.nombre} (${$(p.utilidad)})`).join('; ')}. Puede ser un precio mal puesto o un costo mal registrado: vale revisar los dos.`);
  }
  const claseA = productos.filter((p) => p.clase === 'A');
  const conVenta = productos.filter((p) => p.vendidas > 0);
  if (claseA.length && conVenta.length > 5) {
    poner('dato', 'productos', `${plural(claseA.length, 'producto hace', 'productos hacen')} el ${UMBRALES.abc_a_pct} % de la utilidad`,
      `De ${conVenta.length} que se vendieron. Son los que no pueden faltar: ${claseA.slice(0, 5).map((p) => p.nombre).join('; ')}.`);
  }
  if (resumen.unidades_sin_costo > 0) {
    poner('atencion', 'productos', `${plural(resumen.unidades_sin_costo, 'unidad vendida no tiene', 'unidades vendidas no tienen')} costo registrado`,
      `Ventas por ${$(resumen.ventas - resumen.ventas_con_costo)} a las que no se les puede medir la utilidad. Sin costo, ninguna tabla puede decir si ese producto conviene.`);
  }
  const lineasMedibles = lineas.filter((l) => l.margen_pct !== null && l.ventas > 0);
  if (lineasMedibles.length > 1) {
    const orden = [...lineasMedibles].sort((a, b) => b.margen_pct - a.margen_pct);
    const mejor = orden[0], peor = orden[orden.length - 1];
    poner('dato', 'lineas', `«${mejor.linea}» deja ${mejor.margen_pct} % de margen y «${peor.linea}» ${peor.margen_pct} %`,
      `La línea que más vende es «${lineas[0].linea}» (${lineas[0].participacion_ventas_pct} % de las ventas, margen ${lineas[0].margen_pct ?? '—'} %).`);
  }

  // — Inventario de equipos —
  const viejos = equipos.filter((e) => e.unidades_viejas > 0);
  if (viejos.length) {
    poner('atencion', 'equipos_stock', `${plural(viejos.reduce((s, e) => s + e.unidades_viejas, 0), 'equipo lleva', 'equipos llevan')} más de ${UMBRALES.equipo_viejo_dias} días en inventario`,
      `${$(viejos.reduce((s, e) => s + e.valor_viejo, 0))} en costo. Un equipo pierde valor cada mes: ${viejos.slice(0, 3).map((e) => `${e.producto} (${e.unidades_viejas} uds, hasta ${e.dias_max} días)`).join('; ')}.`);
  }

  // — Cartera —
  const c = cartera.resumen;
  if (c.por_cobrar > 0) {
    if (c.viejo > 0) {
      poner(c.viejo_pct > 30 ? 'alerta' : 'atencion', 'cartera_antiguedad',
        `${$(c.viejo)} de lo que te deben tiene más de ${UMBRALES.cartera_vieja_dias} días`,
        `Es el ${c.viejo_pct} % de los ${$(c.por_cobrar)} por cobrar (${c.documentos} documentos de ${c.deudores} personas). Lo que más se demora es lo que menos se recupera.`);
    }
    if (c.vencido > 0) {
      poner('alerta', 'cartera_deudores', `${$(c.vencido)} ya pasaron de su fecha límite`,
        `El ${c.vencido_pct} % de lo que te deben. ${c.sin_plazo > 0 ? `Además, ${plural(c.sin_plazo, 'documento no tiene', 'documentos no tienen')} fecha límite: sin plazo nunca aparecen como vencidos.` : ''}`.trim());
    } else if (c.sin_plazo === c.documentos) {
      poner('atencion', 'cartera_deudores', 'Nada de lo que te deben tiene fecha límite',
        `${$(c.por_cobrar)} en ${c.documentos} documentos sin plazo. Sin una fecha no hay cómo saber qué está atrasado ni a quién cobrarle primero.`);
    }
    if (c.top5_pct > 50 && c.deudores > 5) {
      poner('atencion', 'cartera_deudores', `Cinco personas deben el ${c.top5_pct} % de la cartera`,
        `${cartera.deudores.slice(0, 5).map((p) => `${p.cliente} (${$(p.saldo)})`).join('; ')}.`);
    }
  }

  // — Ventas y clientes —
  if (resumen.ventas > 0 && resumen.ventas_credito_pct > 40) {
    poner('atencion', 'meses', `El ${resumen.ventas_credito_pct} % de lo vendido fue a crédito`,
      `${$(resumen.ventas_credito)} de ${$(resumen.ventas)}. Esa plata no ha entrado: la utilidad de lo vendido es mayor que la que de verdad se ha cobrado.`);
  }
  if (cuando.por_dia.length >= 5) {
    const orden = [...cuando.por_dia]
      .filter((x) => x.promedio_por_dia !== null && x.dias_con_ventas >= UMBRALES.dias_semana_minimos)
      .sort((a, b) => b.promedio_por_dia - a.promedio_por_dia);
    const mejor = orden[0], peor = orden[orden.length - 1];
    if (mejor && peor && mejor !== peor && peor.promedio_por_dia > 0) {
      poner('dato', 'ventas_dia', `El ${mejor.dia.toLowerCase()} vende ${r1(mejor.promedio_por_dia / peor.promedio_por_dia)} veces lo que el ${peor.dia.toLowerCase()}`,
        `Un ${mejor.dia.toLowerCase()} promedio: ${$(mejor.promedio_por_dia)}; un ${peor.dia.toLowerCase()}: ${$(peor.promedio_por_dia)}. Sirve para decidir turnos, promociones y qué día recibir mercancía.`);
    }
  }
  const cl = clientes.resumen;
  if (cl.clientes > 0) {
    if (cl.ventas_sin_identificar_pct > 30) {
      poner('dato', 'clientes', `El ${cl.ventas_sin_identificar_pct} % de las ventas no tiene cliente`,
        `${$(cl.ventas_sin_identificar)} facturados como cliente genérico. De esa parte no se puede saber quién vuelve ni a quién ofrecerle algo.`);
    }
    poner('dato', 'clientes', `${cl.recurrentes} de ${cl.clientes} clientes compraron más de un día`,
      `El ${cl.recurrentes_pct ?? 0} % volvió, y hacen el ${cl.ventas_recurrentes_pct ?? 0} % de las ventas. Los 10 mayores suman el ${cl.top10_pct ?? 0} %.`);
  }

  const peso = { alerta: 0, atencion: 1, dato: 2 };
  return h.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
};

// ═════════════════════════════════════════════════════════════════════════════
// ENTRADA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @param {number}   negocioId
 * @param {object}   o
 * @param {number[]} o.sucursalIds  sedes del alcance (ya validadas contra el negocio)
 * @param {string}   o.desde        'YYYY-MM-DD'
 * @param {string}   o.hasta        'YYYY-MM-DD'
 * @param {boolean}  [o.todoElNegocio]
 */
const getAnalisisAsesor = async (negocioId, { sucursalIds, desde, hasta, todoElNegocio = false }) => {
  const ids = [...new Set((sucursalIds || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length) throw { status: 400, message: 'Elige una sede para el análisis' };

  // El alcance se valida contra el negocio AQUÍ, no se confía en quien llama:
  // una sede ajena en la lista sería el inventario y las ventas de otro negocio.
  const { rows: sedes } = await pool.query(
    'SELECT id, nombre FROM sucursales WHERE negocio_id = $1 AND id = ANY($2::int[]) ORDER BY id',
    [negocioId, ids]
  );
  if (sedes.length !== ids.length) throw { status: 403, message: 'Alguna de las sedes no es de tu negocio' };
  const sedeIds = sedes.map((s) => Number(s.id));

  const { rows: [{ hoy }] } = await pool.query(`SELECT to_char(${HOY_SQL}, 'YYYY-MM-DD') AS hoy`);
  const dias = diasEntre(desde, hasta);

  // Por tandas y no las doce de golpe: el pool es de diez conexiones para todos
  // los negocios, y esto lo dispara una persona abriendo una pestaña.
  const [ventas, stock, compras] = await Promise.all([
    _ventasPorNodo(sedeIds, desde, hasta),
    _stockPorNodo(sedeIds),
    _comprasPorProductoProveedor(sedeIds, desde, hasta),
  ]);
  const [comprasProv, equiposProv, novedades, saldos] = await Promise.all([
    _comprasPorProveedor(sedeIds, desde, hasta),
    _equiposPorProveedor(sedeIds, desde, hasta, negocioId),
    _novedadesPorProveedor(negocioId, desde, hasta),
    acreedoresRepo.findSaldosPorProveedor(negocioId),
  ]);
  const [ventasMes, comprasMes, diaHora, clientesFilas] = await Promise.all([
    _ventasPorMesYSede(sedeIds, desde, hasta),
    _comprasPorMes(sedeIds, desde, hasta),
    _ventasPorDiaYHora(sedeIds, desde, hasta),
    _clientes(sedeIds, desde, hasta),
  ]);
  const [carteraFilas, equiposFilas] = await Promise.all([
    _cartera(sedeIds),
    _equiposEnStock(sedeIds),
  ]);

  const { productos, variantes } = _armarProductos({ ventas, stock, compras, dias, hoy });
  const lineas          = _armarLineas(productos, dias);
  const precios_compra  = _armarPrecios(compras);
  const proveedores     = _armarProveedores({ compras: comprasProv, equipos: equiposProv, deudas: saldos, novedades, precios: precios_compra });
  const meses           = _armarMeses({ ventasMes, comprasMes });
  const sedesTabla      = _armarSedes(ventasMes, sedes);
  const cuando          = _armarCuando(diaHora);
  const clientes        = _armarClientes(clientesFilas);
  const cartera         = _armarCartera(carteraFilas);
  const equipos_stock   = _armarEquipos(equiposFilas);

  const sum = (lista, k) => lista.reduce((s, x) => s + n0(x[k]), 0);
  const ventasTotal = sum(meses, 'ventas');
  const conCosto    = sum(meses, 'ventas_con_costo');
  const costoVend   = meses.some((m) => m.costo !== null) ? sum(meses, 'costo') : null;
  const facturas    = sum(meses, 'facturas');
  const resumen = {
    ventas: ventasTotal,
    ventas_con_costo: conCosto,
    costo_vendido: costoVend ?? 0,
    utilidad: costoVend === null ? null : conCosto - costoVend,
    margen_pct: costoVend !== null && conCosto > 0 ? r1(((conCosto - costoVend) / conCosto) * 100) : null,
    facturas,
    ticket_promedio: facturas > 0 ? Math.round(ventasTotal / facturas) : null,
    ventas_credito: sum(meses, 'ventas_credito'),
    ventas_credito_pct: r1(pct(sum(meses, 'ventas_credito'), ventasTotal)),
    unidades_vendidas: sum(meses, 'unidades_vendidas'),
    unidades_sin_costo: sum(productos, 'unidades_sin_costo'),
    comprado: sum(meses, 'comprado'),
    proveedores: proveedores.length,
    inventario: sum(productos, 'valor_stock'),
    inventario_unidades: sum(productos, 'stock'),
    productos_con_stock: productos.filter((p) => p.stock > 0).length,
    productos_vendidos: productos.filter((p) => p.vendidas > 0).length,
    por_cobrar: cartera.resumen.por_cobrar,
    deuda_proveedores: saldos.reduce((s, d) => s + Math.max(0, n0(d.saldo)), 0),
    deuda_proveedores_vencida: saldos.reduce((s, d) => s + n0(d.saldo_vencido), 0),
  };

  const datos = {
    alcance: {
      negocio_id: negocioId, todo_el_negocio: Boolean(todoElNegocio),
      sedes: sedes.map((s) => ({ id: Number(s.id), nombre: s.nombre })),
      desde, hasta, dias, hoy,
    },
    umbrales: UMBRALES,
    resumen,
    proveedores, precios_compra, meses,
    productos, variantes, lineas,
    sedes: sedesTabla,
    cuando,
    clientes, cartera, equipos_stock,
  };
  return { ...datos, hallazgos: _hallazgos(datos) };
};

module.exports = {
  getAnalisisAsesor, UMBRALES,
  // Para la prueba: la aritmética, sin base de datos.
  _armarProductos, _armarPrecios, _armarCartera, _armarClientes, _hallazgos, _esGenerico,
};
