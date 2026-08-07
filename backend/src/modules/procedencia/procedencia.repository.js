const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDENCIA — "salió un lote malo, ¿de quién vino?"
//
// La respuesta depende del tipo de producto, y el sistema los trata muy
// distinto:
//
//   · CON IMEI  → trazabilidad exacta. `seriales.proveedor_id` se escribe en
//     cada compra y `lineas_compra.imei` ata la unidad a su compra y su fecha.
//     Un equipo defectuoso identifica a su proveedor sin ambigüedad.
//
//   · POR CANTIDAD → las unidades son fungibles. El stock es un entero y el
//     costo es un promedio: el modelo NO puede saber de qué compra salió la
//     unidad 47, y rastrear lotes obligaría a romper el modelo de stock y de
//     costo con riesgo sobre el punto de venta.
//
// Lo que sí se puede —y es lo que de verdad se necesita— es responder la
// pregunta AL REVÉS. El proveedor marca físicamente las unidades, así que quien
// tiene el producto dañado en la mano ya sabe de quién es; lo que no sabe es
// cuándo lo compró, a qué precio, cuántas quedan de ese lote y si la garantía
// sigue viva. Eso se deriva de `lineas_compra`, que ya lleva años de historia.
//
// ── Lo que NO se debe leer ───────────────────────────────────────────────────
// `productos_cantidad.proveedor_id` NO sirve para esto y es peor que nada:
// registrarCompra() solo la escribe `WHERE proveedor_id IS NULL`, así que guarda
// el PRIMER proveedor de la historia y no se actualiza nunca. Un producto
// comprado a tres proveedores muestra el de hace dos años. Es a lo sumo el
// "proveedor habitual", jamás la procedencia de un lote.
//
// `historial_stock_cantidad` tampoco: tiene proveedor_id, pero compras.service
// nunca escribe en ella (solo la alimentan los ajustes manuales y las retomas).
// ─────────────────────────────────────────────────────────────────────────────

// El vencimiento de garantía se DERIVA, nunca se guarda.
//
// El AT TIME ZONE no es decorativo: `compras.fecha` es TIMESTAMP y se lee en
// Bogotá, mientras que la fecha resultante es DATE y se lee en UTC. Sin él, una
// compra registrada a las 8 p.m. produce una garantía que vence un día antes —
// es exactamente la confusión que ya costó dos veces en mora.service.
const GARANTIA_HASTA = `
  CASE WHEN lc.garantia_dias IS NOT NULL
       THEN (c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias
  END`;

// Campos comunes de una entrada de mercancía, para no repetirlos en las dos
// consultas y que no se desincronicen.
const SELECT_ENTRADA = `
  c.id                AS compra_id,
  c.numero            AS compra_numero,
  c.fecha             AS fecha,
  c.numero_factura,
  c.orden_compra_id,
  oc.numero           AS orden_numero,
  p.id                AS proveedor_id,
  p.nombre            AS proveedor_nombre,
  p.telefono          AS proveedor_telefono,
  su.id               AS sucursal_id,
  su.nombre           AS sucursal_nombre,
  lc.id               AS linea_id,
  lc.nombre_producto,
  lc.precio_unitario,
  lc.garantia_dias,
  ${GARANTIA_HASTA}   AS garantia_hasta`;

const FROM_ENTRADA = `
  FROM      lineas_compra lc
  JOIN      compras     c  ON c.id  = lc.compra_id
  JOIN      proveedores p  ON p.id  = c.proveedor_id
  JOIN      sucursales  su ON su.id = c.sucursal_id
  LEFT JOIN ordenes_compra oc ON oc.id = c.orden_compra_id`;

/**
 * Procedencia de un producto por cantidad: de qué proveedores entró, cuándo,
 * a qué precio y bajo qué garantía. Más reciente primero — quien busca un lote
 * malo casi siempre busca el último que llegó.
 *
 * El negocio se valida por la sucursal de la compra, no por el producto: el
 * mismo producto lógico vive en una fila por sucursal y las compras de todas
 * ellas son procedencia legítima del catálogo del negocio.
 */
const porProducto = async (negocioId, productoId, { todasLasSucursales = false, sucursalId = null } = {}) => {
  const { rows } = await pool.query(`
    SELECT ${SELECT_ENTRADA},
           lc.cantidad,
           COALESCE(lc.cantidad_devuelta, 0)                      AS cantidad_devuelta,
           lc.cantidad - COALESCE(lc.cantidad_devuelta, 0)        AS cantidad_neta
    ${FROM_ENTRADA}
    WHERE lc.producto_id = $1
      AND su.negocio_id  = $2
      AND c.estado <> 'Cancelada'
      AND ($3::int IS NULL OR c.sucursal_id = $3)
    ORDER BY c.fecha DESC, lc.id DESC
  `, [productoId, negocioId, todasLasSucursales ? null : sucursalId]);
  return rows;
};

/**
 * Procedencia de una unidad con IMEI. Devuelve TODAS las entradas de ese IMEI
 * al inventario del negocio, la más reciente primero.
 *
 * Devolver todas y no solo una es deliberado: un mismo IMEI vive en varias
 * filas (re-import correctivo, un equipo vendido y retomado, reactivación de un
 * serial). Quien resuelva "bajo qué garantía está HOY" debe tomar la PRIMERA
 * fila, nunca hacer un JOIN plano por imei — eso multiplica filas y mezcla
 * garantías de compras viejas.
 */
const porImei = async (negocioId, imei) => {
  const { rows } = await pool.query(`
    SELECT ${SELECT_ENTRADA},
           lc.imei
    ${FROM_ENTRADA}
    WHERE UPPER(BTRIM(lc.imei)) = UPPER(BTRIM($1))
      AND su.negocio_id = $2
      AND c.estado <> 'Cancelada'
    ORDER BY c.fecha DESC, lc.id DESC
  `, [imei, negocioId]);
  return rows;
};

/**
 * Estado actual de un serial en el inventario: si sigue disponible, y de qué
 * proveedor quedó registrado. Complementa `porImei` con lo que dice el
 * inventario hoy, que puede no coincidir con la última compra (una retoma entra
 * sin compra, por ejemplo).
 */
const estadoSerial = async (negocioId, imei) => {
  const { rows } = await pool.query(`
    SELECT s.id, s.imei, s.vendido, s.prestado, s.fecha_entrada, s.costo_compra,
           s.proveedor_id, p.nombre AS proveedor_nombre,
           ps.nombre AS producto_nombre, ps.sucursal_id, su.nombre AS sucursal_nombre
    FROM      seriales s
    JOIN      productos_serial ps ON ps.id = s.producto_id
    JOIN      sucursales       su ON su.id = ps.sucursal_id
    LEFT JOIN proveedores      p  ON p.id  = s.proveedor_id
    WHERE UPPER(BTRIM(s.imei)) = UPPER(BTRIM($1))
      AND su.negocio_id = $2
    ORDER BY s.id DESC
    LIMIT 1
  `, [imei, negocioId]);
  return rows[0] || null;
};

/**
 * Resumen por proveedor de un producto: cuánto entró de cada uno y cuánto se le
 * devolvió. Es la cifra que sirve para decidir si se le sigue comprando.
 */
const resumenPorProveedor = async (negocioId, productoId) => {
  const { rows } = await pool.query(`
    SELECT p.id AS proveedor_id, p.nombre AS proveedor_nombre,
           COUNT(DISTINCT c.id)                              AS compras,
           SUM(lc.cantidad)                                  AS unidades,
           SUM(COALESCE(lc.cantidad_devuelta, 0))            AS devueltas,
           MAX(c.fecha)                                      AS ultima_compra,
           MIN(lc.precio_unitario)                           AS precio_min,
           MAX(lc.precio_unitario)                           AS precio_max
    FROM lineas_compra lc
    JOIN compras     c  ON c.id  = lc.compra_id
    JOIN proveedores p  ON p.id  = c.proveedor_id
    JOIN sucursales  su ON su.id = c.sucursal_id
    WHERE lc.producto_id = $1
      AND su.negocio_id  = $2
      AND c.estado <> 'Cancelada'
    GROUP BY p.id
    ORDER BY MAX(c.fecha) DESC
  `, [productoId, negocioId]);
  return rows;
};

/**
 * Verifica que un producto por cantidad pertenece al negocio.
 */
const productoDelNegocio = async (productoId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT pc.id, pc.nombre, pc.stock, pc.codigo, pc.sucursal_id, su.nombre AS sucursal_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE pc.id = $1 AND su.negocio_id = $2
  `, [productoId, negocioId]);
  return rows[0] || null;
};

module.exports = {
  porProducto, porImei, estadoSerial, resumenPorProveedor, productoDelNegocio,
};
