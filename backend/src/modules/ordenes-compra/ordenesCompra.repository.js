const { pool } = require('../../config/db');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');

// ─────────────────────────────────────────────────────────────────────────────
// ÓRDENES DE COMPRA
//
// El avance (recibido / pendiente) se DERIVA SIEMPRE de lineas_compra. No hay
// —ni puede haber— un contador guardado: cancelarCompra() revierte inventario y
// borra los movimientos del acreedor, y devolverCompra() regresa mercancía, pero
// ninguna de las dos iría a corregir un contador en la orden. Ese contador
// quedaría inflado contra recepciones que ya no existen, y la orden nunca
// volvería a pedir lo que se devolvió.
//
// Por eso `ordenes_compra.estado` solo guarda DECISIONES humanas
// (Borrador / Emitida / Cerrada / Anulada). Si está parcial o completa se
// calcula al leer, con la expresión de abajo.
// ─────────────────────────────────────────────────────────────────────────────

// Recibido por línea pedida.
//
// Tres detalles que parecen intercambiables y no lo son:
//
//   1. `c.estado <> 'Cancelada'` va en el JOIN y no en el WHERE: en el WHERE
//      convertiría el LEFT JOIN en INNER y las líneas sin recepciones
//      desaparecerían del avance.
//   2. Pero un LEFT JOIN que no empareja NO descarta la fila de lineas_compra:
//      solo deja `c.*` en NULL. Sin el FILTER, las recepciones canceladas
//      seguirían sumando y la orden se quedaría "completa" para siempre.
//   3. El FILTER va sobre `c.id IS NOT NULL`, no sobre el estado: es la forma de
//      preguntar "¿el JOIN encontró una compra viva?".
const AVANCE_POR_LINEA = `
  SELECT loc.id AS linea_id,
         loc.orden_id,
         COALESCE(
           SUM(lc.cantidad - COALESCE(lc.cantidad_devuelta, 0))
             FILTER (WHERE c.id IS NOT NULL),
           0
         ) AS recibida
  FROM      lineas_orden_compra loc
  LEFT JOIN lineas_compra lc ON lc.orden_linea_id = loc.id
  LEFT JOIN compras       c  ON c.id = lc.compra_id AND c.estado <> 'Cancelada'
  GROUP BY loc.id`;

// Totales por orden, ya agregados. Se usa en el listado, donde traer las líneas
// de cada orden sería N+1.
const AVANCE_POR_ORDEN = `
  SELECT a.orden_id,
         SUM(loc.cantidad_pedida)                                AS pedidas,
         SUM(LEAST(a.recibida, loc.cantidad_pedida))             AS recibidas,
         SUM(loc.cantidad_pedida * COALESCE(loc.precio_estimado, 0)) AS valor_pedido
  FROM (${AVANCE_POR_LINEA}) a
  JOIN lineas_orden_compra loc ON loc.id = a.linea_id
  GROUP BY a.orden_id`;

const _select = (extra = '') => `
  SELECT o.*,
         p.nombre   AS proveedor_nombre,
         p.telefono AS proveedor_telefono,
         p.nit      AS proveedor_nit,
         su.nombre  AS sucursal_nombre,
         u.nombre   AS usuario_nombre,
         COALESCE(av.pedidas, 0)     AS unidades_pedidas,
         COALESCE(av.recibidas, 0)   AS unidades_recibidas,
         COALESCE(av.valor_pedido, 0) AS valor_pedido,
         -- num_recepciones, y no "recepciones" a secas: la ficha de la orden
         -- añade la LISTA de recepciones bajo ese nombre, y si el contador se
         -- llamara igual el frontend recibiría un número en el listado y un
         -- arreglo en el detalle bajo la misma clave.
         (SELECT COUNT(*) FROM compras c2
          WHERE c2.orden_compra_id = o.id AND c2.estado <> 'Cancelada') AS num_recepciones,
         (SELECT COALESCE(SUM(c3.total), 0) FROM compras c3
          WHERE c3.orden_compra_id = o.id AND c3.estado <> 'Cancelada') AS total_recibido
         ${extra}
  FROM      ordenes_compra o
  JOIN      proveedores p  ON p.id  = o.proveedor_id
  JOIN      sucursales  su ON su.id = o.sucursal_id
  LEFT JOIN usuarios    u  ON u.id  = o.usuario_id
  LEFT JOIN (${AVANCE_POR_ORDEN}) av ON av.orden_id = o.id`;

const findAll = async (negocioId, {
  sucursalId = null, estado = null, proveedorId = null, proveedorIds = null,
  busqueda = null, soloAbiertas = false, page = 1, limit = 20,
} = {}) => {
  const cond = ['o.negocio_id = $1'];
  const params = [negocioId];
  let i = 2;

  if (sucursalId)  { cond.push(`o.sucursal_id = $${i++}`);  params.push(sucursalId); }
  if (estado)      { cond.push(`o.estado = $${i++}`);       params.push(estado); }
  if (proveedorId) { cond.push(`o.proveedor_id = $${i++}`); params.push(proveedorId); }
  if (proveedorIds && proveedorIds.length) {
    cond.push(`o.proveedor_id = ANY($${i++}::int[])`);
    params.push(proveedorIds);
  }
  if (soloAbiertas) cond.push(`o.estado IN ('Borrador', 'Emitida')`);
  if (busqueda) {
    cond.push(`(p.nombre ILIKE $${i} OR o.numero_factura ILIKE $${i} OR o.numero::text = $${i})`);
    params.push(`%${busqueda}%`);
    i++;
  }

  const where = `WHERE ${cond.join(' AND ')}`;

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS total
     FROM ordenes_compra o JOIN proveedores p ON p.id = o.proveedor_id
     ${where}`,
    params
  );
  const total = Number(countRows[0].total);

  const { rows } = await pool.query(
    `${_select()} ${where}
     ORDER BY o.fecha_emision DESC, o.id DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, (page - 1) * limit]
  );

  return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(
    `${_select()} WHERE o.negocio_id = $1 AND o.id = $2`,
    [negocioId, id]
  );
  return rows[0] || null;
};

/**
 * Líneas de la orden con su avance derivado. `pendiente` nunca es negativo:
 * una devolución posterior a completar la orden vuelve a abrir el pendiente,
 * pero recibir de más (que la validación impide) no debería producir números
 * raros si algún día entra por otra vía.
 */
const getLineas = async (ordenId) => {
  const { rows } = await pool.query(`
    SELECT loc.*,
           COALESCE(a.recibida, 0)                                        AS recibida,
           GREATEST(loc.cantidad_pedida - COALESCE(a.recibida, 0), 0)     AS pendiente,
           va.valor   AS variante_valor,
           tva.nombre AS variante_tipo_nombre,
           ap.valor   AS atributo_valor,
           tap.nombre AS atributo_tipo_nombre
    FROM      lineas_orden_compra loc
    LEFT JOIN (${AVANCE_POR_LINEA}) a ON a.linea_id = loc.id
    LEFT JOIN variantes_atributo   va  ON va.id  = loc.variante_id
    LEFT JOIN tipos_caracteristica tva ON tva.id = va.tipo_id
    LEFT JOIN atributos_producto   ap  ON ap.id  = loc.atributo_id
    LEFT JOIN tipos_caracteristica tap ON tap.id = ap.tipo_id
    WHERE loc.orden_id = $1
    ORDER BY loc.orden, loc.id
  `, [ordenId]);
  return rows;
};

/**
 * Recepciones de la orden: las compras que colgaron de ella. Las canceladas se
 * incluyen (con su estado) porque la ficha muestra la historia completa, pero
 * ninguna suma al avance.
 */
const getRecepciones = async (ordenId) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.numero, c.fecha, c.total, c.estado, c.numero_factura, c.metodo,
           u.nombre AS usuario_nombre,
           (SELECT COALESCE(SUM(lc.cantidad - COALESCE(lc.cantidad_devuelta, 0)), 0)
            FROM lineas_compra lc WHERE lc.compra_id = c.id) AS unidades
    FROM      compras  c
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE c.orden_compra_id = $1
    ORDER BY c.fecha DESC, c.id DESC
  `, [ordenId]);
  return rows;
};

const create = async (client, {
  negocio_id, sucursal_id, proveedor_id, usuario_id, estado,
  fecha_esperada, numero_factura, fecha_factura, dias_plazo, fecha_vencimiento,
  total_estimado, notas, clave_idempotencia,
}) => {
  const { rows } = await client.query(`
    INSERT INTO ordenes_compra(
      negocio_id, sucursal_id, proveedor_id, usuario_id, estado,
      fecha_esperada, numero_factura, fecha_factura, dias_plazo, fecha_vencimiento,
      total_estimado, notas, clave_idempotencia
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `, [
    negocio_id, sucursal_id, proveedor_id, usuario_id, estado || 'Borrador',
    fecha_esperada || null, numero_factura || null, fecha_factura || null,
    dias_plazo ?? null, fecha_vencimiento || null,
    total_estimado || 0, notas || null, clave_idempotencia || null,
  ]);

  // El consecutivo se asigna al CREAR, no al emitir: un borrador que ya tiene
  // número es más fácil de nombrar por teléfono, y el hueco por un borrador
  // descartado no le importa a nadie (no es un documento fiscal).
  rows[0].numero = await asignarNumeroDocumento(client, {
    tipo: 'orden_compra', docId: rows[0].id, negocioId: negocio_id,
  });
  return rows[0];
};

const insertarLinea = async (client, {
  orden_id, tipo, producto_id, nombre_producto, variante_id, atributo_id,
  cantidad_pedida, precio_estimado, garantia_dias, notas, orden,
}) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_orden_compra(
      orden_id, tipo, producto_id, nombre_producto, variante_id, atributo_id,
      cantidad_pedida, precio_estimado, garantia_dias, notas, orden
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
  `, [
    orden_id, tipo, producto_id || null, nombre_producto,
    variante_id || null, atributo_id || null,
    cantidad_pedida, precio_estimado ?? null,
    // ?? y no ||: 0 días es "sin garantía", un dato válido distinto de NULL
    // ("nadie lo registró").
    garantia_dias ?? null,
    notas || null, orden || 0,
  ]);
  return rows[0];
};

const borrarLineas = async (client, ordenId) => {
  await client.query('DELETE FROM lineas_orden_compra WHERE orden_id = $1', [ordenId]);
};

const actualizarCabecera = async (client, id, campos) => {
  const permitidos = [
    'fecha_esperada', 'numero_factura', 'fecha_factura', 'dias_plazo',
    'fecha_vencimiento', 'total_estimado', 'notas', 'estado',
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of permitidos) {
    if (campos[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(campos[k]);
    }
  }
  if (!sets.length) return null;
  params.push(id);
  const { rows } = await client.query(
    `UPDATE ordenes_compra SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  );
  return rows[0] || null;
};

/**
 * Bloquea la orden para leerla con garantías de exclusión. Se usa antes de
 * cualquier cambio de estado: sin el lock, dos usuarios podrían emitir o cerrar
 * la misma orden a la vez.
 */
const findParaActualizar = async (client, negocioId, id) => {
  const { rows } = await client.query(
    `SELECT * FROM ordenes_compra WHERE id = $1 AND negocio_id = $2 FOR UPDATE`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const cerrar = async (client, id, { motivo, usuario_id }) => {
  const { rows } = await client.query(`
    UPDATE ordenes_compra
    SET estado = 'Cerrada', motivo_cierre = $1, cerrada_en = NOW(), usuario_cierre_id = $2
    WHERE id = $3
    RETURNING *
  `, [motivo || null, usuario_id || null, id]);
  return rows[0];
};

const anular = async (client, id, { motivo, usuario_id }) => {
  const { rows } = await client.query(`
    UPDATE ordenes_compra
    SET estado = 'Anulada', motivo_cierre = $1, cerrada_en = NOW(), usuario_cierre_id = $2
    WHERE id = $3
    RETURNING *
  `, [motivo || null, usuario_id || null, id]);
  return rows[0];
};

/**
 * ¿Tiene recepciones vivas? Determina si una orden se puede anular o editar:
 * una orden con mercancía recibida ya movió inventario y deuda, y borrarla
 * dejaría esas compras huérfanas.
 */
const tieneRecepciones = async (client, ordenId) => {
  const { rows } = await client.query(
    `SELECT 1 FROM compras WHERE orden_compra_id = $1 AND estado <> 'Cancelada' LIMIT 1`,
    [ordenId]
  );
  return rows.length > 0;
};

const cargoDeLaOrden = async (client, ordenId) => {
  const { rows } = await client.query(
    `SELECT id, acreedor_id, valor FROM movimientos_acreedor
     WHERE orden_compra_id = $1 AND tipo = 'Cargo' LIMIT 1`,
    [ordenId]
  );
  return rows[0] || null;
};

module.exports = {
  findAll, findById, getLineas, getRecepciones,
  create, insertarLinea, borrarLineas, actualizarCabecera,
  findParaActualizar, cerrar, anular, tieneRecepciones, cargoDeLaOrden,
};
