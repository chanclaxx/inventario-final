const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// PEDIDOS INTERNOS — el local le pide a la bodega
//
// EL AVANCE SE DERIVA, NUNCA SE GUARDA. No hay —ni puede haber— un contador de
// "ya despachado" en la línea del pedido: a una línea de remisión le pueden
// pasar cuatro cosas después de salir, y ninguna iría a corregir ese contador.
//
//   • la remisión se ANULA         → r.estado = 'Anulada'
//   • al recibir no llegó          → lr.estado_linea = 'Faltante'
//   • el local la DEVUELVE (serial)→ lr.estado_linea = 'Devuelta'
//   • devuelve parte de un lote    → lr.cantidad_devuelta sube (cantidad)
//
// Con un contador guardado, el pedido se quedaría "completo" para siempre y
// nunca volvería a pedir lo que no llegó. Derivándolo, las cuatro reabren solas
// el pendiente. Es la misma regla —y por la misma razón— que rige el avance de
// una orden de compra, la deuda de un envío y el pendiente de mora.
// ─────────────────────────────────────────────────────────────────────────────

// Unidades despachadas por línea pedida.
//
// Tres detalles que parecen intercambiables y no lo son (los mismos que costó
// aprender en `ordenes_compra`):
//
//   1. Las condiciones sobre lo unido van en el JOIN y no en el WHERE: en el
//      WHERE convertirían el LEFT JOIN en INNER y las líneas que todavía no se
//      han despachado desaparecerían del avance.
//   2. Pero un LEFT JOIN que no empareja NO descarta la fila de la izquierda:
//      solo deja `r.*` en NULL. Sin el FILTER, una remisión ANULADA seguiría
//      sumando (su `lr` sí emparejó) y el pedido se quedaría completo.
//   3. El FILTER va sobre `r.id IS NOT NULL`, no sobre el estado: es la forma
//      de preguntar "¿el JOIN encontró una remisión viva?".
//
// Un serial cuenta 1 y una línea de cantidad cuenta lo RECIBIDO menos lo
// devuelto: `cantidad_recibida` es NULL mientras va en tránsito, y ahí lo que
// vale es `cantidad` — el local ya no tiene que volver a pedirlo.
const AVANCE_POR_LINEA = `
  SELECT lp.id AS linea_id,
         lp.pedido_id,
         COALESCE(SUM(
           CASE WHEN lr.tipo = 'cantidad'
                THEN GREATEST(COALESCE(lr.cantidad_recibida, lr.cantidad, 0)
                              - COALESCE(lr.cantidad_devuelta, 0), 0)
                ELSE 1 END
         ) FILTER (WHERE r.id IS NOT NULL), 0) AS despachada
  FROM      lineas_pedido_interno lp
  LEFT JOIN lineas_remision lr ON lr.pedido_linea_id = lp.id
                              AND lr.estado_linea IN ('Pendiente', 'Recibida')
  LEFT JOIN remisiones      r  ON r.id = lr.remision_id
                              AND r.estado <> 'Anulada'
  GROUP BY lp.id`;

// Totales por pedido, ya agregados. Se usa en los listados, donde traer las
// líneas de cada pedido sería N+1.
//
// `despachadas` se acota con LEAST a lo pedido: despachar de más es legítimo
// (la bodega manda 12 donde pedían 10) y sin el tope el pedido mostraría 120%.
const AVANCE_POR_PEDIDO = `
  SELECT a.pedido_id,
         SUM(lp.cantidad_pedida)                        AS pedidas,
         SUM(LEAST(a.despachada, lp.cantidad_pedida))   AS despachadas,
         COUNT(*)                                       AS lineas
  FROM (${AVANCE_POR_LINEA}) a
  JOIN lineas_pedido_interno lp ON lp.id = a.linea_id
  GROUP BY a.pedido_id`;

const _select = () => `
  SELECT p.*,
         sl.nombre AS sucursal_nombre,
         sb.nombre AS bodega_nombre,
         u.nombre  AS usuario_nombre,
         uc.nombre AS usuario_cierre_nombre,
         COALESCE(av.pedidas, 0)     AS unidades_pedidas,
         COALESCE(av.despachadas, 0) AS unidades_despachadas,
         COALESCE(av.lineas, 0)      AS total_lineas,
         -- num_remisiones, y no "remisiones" a secas: la ficha del pedido añade
         -- la LISTA de remisiones bajo ese nombre, y con el mismo nombre el
         -- frontend recibiría un número en el listado y un arreglo en el
         -- detalle. Es el tropiezo que ya se evitó en ordenes_compra.
         (SELECT COUNT(*) FROM remisiones r2
          WHERE r2.pedido_id = p.id AND r2.estado <> 'Anulada') AS num_remisiones
  FROM      pedidos_internos p
  JOIN      sucursales sl ON sl.id = p.sucursal_id
  JOIN      sucursales sb ON sb.id = p.sucursal_bodega_id
  LEFT JOIN usuarios   u  ON u.id  = p.usuario_id
  LEFT JOIN usuarios   uc ON uc.id = p.usuario_cierre_id
  LEFT JOIN (${AVANCE_POR_PEDIDO}) av ON av.pedido_id = p.id`;

/**
 * Listado de pedidos.
 *
 * `soloConPendiente` es lo que hace que la bandeja de la bodega se vacíe sola:
 * un pedido despachado por completo deja de aparecer sin que nadie tenga que
 * marcarlo, y si después se anula la remisión o el local reporta un faltante,
 * vuelve. Eso es justo lo que se gana al derivar el avance en vez de guardarlo.
 */
const findAll = async (negocioId, {
  sucursalId = null, bodegaId = null, estado = null, estados = null,
  soloConPendiente = false, busqueda = null, limit = 50,
} = {}) => {
  const cond = ['p.negocio_id = $1'];
  const params = [negocioId];
  let i = 2;

  if (sucursalId) { cond.push(`p.sucursal_id = $${i++}`);        params.push(sucursalId); }
  if (bodegaId)   { cond.push(`p.sucursal_bodega_id = $${i++}`); params.push(bodegaId); }
  if (estado)     { cond.push(`p.estado = $${i++}`);             params.push(estado); }
  if (estados && estados.length) {
    cond.push(`p.estado = ANY($${i++}::text[])`);
    params.push(estados);
  }
  if (soloConPendiente) {
    cond.push('COALESCE(av.pedidas, 0) > COALESCE(av.despachadas, 0)');
  }
  if (busqueda) {
    cond.push(`(p.numero::text = $${i} OR p.notas ILIKE $${i}
                OR EXISTS (SELECT 1 FROM lineas_pedido_interno lx
                           WHERE lx.pedido_id = p.id AND lx.nombre_producto ILIKE $${i}))`);
    params.push(`%${busqueda}%`);
    i++;
  }
  params.push(limit);

  const { rows } = await pool.query(`
    ${_select()}
    WHERE ${cond.join(' AND ')}
    ORDER BY p.fecha DESC, p.id DESC
    LIMIT $${i}
  `, params);
  return rows;
};

const findById = async (negocioId, id, client = null) => {
  const { rows } = await (client || pool).query(
    `${_select()} WHERE p.negocio_id = $1 AND p.id = $2`,
    [negocioId, id]
  );
  return rows[0] || null;
};

/** La misma fila, bloqueada para escribir. Sin los JOIN: FOR UPDATE no admite
 *  agregados, y aquí solo hace falta el estado y a quién pertenece. */
const findParaEscribir = async (client, negocioId, id) => {
  const { rows } = await client.query(
    `SELECT * FROM pedidos_internos WHERE id = $1 AND negocio_id = $2 FOR UPDATE`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const findPorClave = async (clave) => {
  const { rows } = await pool.query(
    `SELECT * FROM pedidos_internos WHERE clave_idempotencia = $1`, [clave]
  );
  return rows[0] || null;
};

/**
 * Líneas con su avance derivado. `pendiente` nunca es negativo: despachar de
 * más no puede producir un pedido que "debe" unidades negativas.
 *
 * La etiqueta del nodo se arma aquí (no en el service) porque las dos pantallas
 * —la del local que revisa su pedido y la de la bodega que lo despacha— tienen
 * que ver exactamente el mismo texto, y `nombre_producto` se congeló al pedir:
 * si después renombran el producto, la línea sigue diciendo lo que se pidió.
 */
const getLineas = async (pedidoId) => {
  const { rows } = await pool.query(`
    SELECT lp.*,
           COALESCE(a.despachada, 0)                                       AS despachada,
           GREATEST(lp.cantidad_pedida - COALESCE(a.despachada, 0), 0)     AS pendiente,
           ap.valor AS atributo_valor,
           va.valor AS variante_valor
    FROM      lineas_pedido_interno lp
    LEFT JOIN (${AVANCE_POR_LINEA}) a  ON a.linea_id = lp.id
    LEFT JOIN atributos_producto    ap ON ap.id = lp.atributo_id
    LEFT JOIN variantes_atributo    va ON va.id = lp.variante_id
    WHERE lp.pedido_id = $1
    ORDER BY lp.orden, lp.id
  `, [pedidoId]);
  return rows;
};

/**
 * Lo mismo, pero dentro de la transacción del despacho y solo lo que aún falta.
 * Es la lista contra la que se atribuye cada línea despachada a su línea
 * pedida. Ordenada por `orden, id` para que el reparto sea determinista.
 */
const getLineasPendientes = async (client, pedidoId) => {
  const { rows } = await client.query(`
    SELECT lp.id, lp.tipo, lp.producto_id, lp.atributo_id, lp.variante_id,
           lp.cantidad_pedida,
           GREATEST(lp.cantidad_pedida - COALESCE(a.despachada, 0), 0) AS pendiente
    FROM      lineas_pedido_interno lp
    LEFT JOIN (${AVANCE_POR_LINEA}) a ON a.linea_id = lp.id
    WHERE lp.pedido_id = $1
    ORDER BY lp.orden, lp.id
  `, [pedidoId]);
  return rows;
};

/** Remisiones que respondieron a este pedido. Las anuladas se incluyen (con su
 *  estado) porque la ficha cuenta la historia completa, pero ninguna suma al
 *  avance — de eso se encarga el FILTER de AVANCE_POR_LINEA. */
const getRemisiones = async (negocioId, pedidoId) => {
  const { rows } = await pool.query(`
    SELECT r.id, r.numero, r.estado, r.fecha_emision, r.fecha_recepcion,
           r.valor_total, r.notas,
           ue.nombre AS usuario_emisor_nombre,
           (SELECT COUNT(*) FROM lineas_remision lr
            WHERE lr.remision_id = r.id)::int AS total_items
    FROM      remisiones r
    LEFT JOIN usuarios ue ON ue.id = r.usuario_emisor_id
    WHERE r.pedido_id = $1 AND r.negocio_id = $2
    ORDER BY r.fecha_emision DESC, r.id DESC
  `, [pedidoId, negocioId]);
  return rows;
};

// ── Escritura ────────────────────────────────────────────────────────────────

const crear = async (client, {
  negocio_id, sucursal_id, sucursal_bodega_id, usuario_id,
  estado, prioridad, notas, clave_idempotencia,
}) => {
  const { rows } = await client.query(`
    INSERT INTO pedidos_internos
      (negocio_id, sucursal_id, sucursal_bodega_id, usuario_id,
       estado, prioridad, notas, clave_idempotencia, fecha_envio)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
            CASE WHEN $5 = 'Enviado' THEN NOW() END)
    RETURNING *
  `, [negocio_id, sucursal_id, sucursal_bodega_id, usuario_id,
      estado || 'Borrador', prioridad || 'normal', notas || null,
      clave_idempotencia || null]);
  return rows[0];
};

const insertarLinea = async (client, l) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_pedido_interno
      (pedido_id, tipo, producto_id, atributo_id, variante_id,
       nombre_producto, cantidad_pedida, notas, orden)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [l.pedido_id, l.tipo, l.producto_id || null,
      l.atributo_id || null, l.variante_id || null,
      l.nombre_producto, l.cantidad_pedida, l.notas || null, l.orden || 0]);
  return rows[0];
};

/** Reemplaza las líneas de un borrador. Solo se llama sobre 'Borrador', donde
 *  nada cuelga todavía de ellas: una línea ya despachada no se puede borrar
 *  porque `lineas_remision.pedido_linea_id` es ON DELETE SET NULL y perderíamos
 *  el vínculo en silencio. El service lo impide antes de llegar aquí. */
const borrarLineas = async (client, pedidoId) => {
  await client.query(`DELETE FROM lineas_pedido_interno WHERE pedido_id = $1`, [pedidoId]);
};

const actualizarCabecera = async (client, pedidoId, { prioridad, notas }) => {
  const { rows } = await client.query(`
    UPDATE pedidos_internos
    SET prioridad = COALESCE($2, prioridad),
        notas     = $3
    WHERE id = $1
    RETURNING *
  `, [pedidoId, prioridad || null, notas ?? null]);
  return rows[0];
};

const marcarEnviado = async (client, pedidoId) => {
  const { rows } = await client.query(`
    UPDATE pedidos_internos
    SET estado = 'Enviado', fecha_envio = NOW()
    WHERE id = $1
    RETURNING *
  `, [pedidoId]);
  return rows[0];
};

const marcarCerrado = async (client, pedidoId, { estado, respuesta, usuarioId }) => {
  const { rows } = await client.query(`
    UPDATE pedidos_internos
    SET estado = $2, respuesta = $3, cerrado_en = NOW(), usuario_cierre_id = $4
    WHERE id = $1
    RETURNING *
  `, [pedidoId, estado, respuesta || null, usuarioId || null]);
  return rows[0];
};

/** Vuelve a abrir un pedido cerrado. No toca `respuesta`: el motivo por el que
 *  se cerró es historia y la ficha lo sigue mostrando. */
const reabrir = async (client, pedidoId) => {
  const { rows } = await client.query(`
    UPDATE pedidos_internos
    SET estado = 'Enviado', cerrado_en = NULL, usuario_cierre_id = NULL
    WHERE id = $1
    RETURNING *
  `, [pedidoId]);
  return rows[0];
};

/** ¿Este pedido ya movió mercancía? Cuenta remisiones vivas. Es lo que decide
 *  si el local todavía puede anularlo o editarlo. */
const tieneRemisionesVivas = async (client, pedidoId) => {
  const { rows } = await client.query(`
    SELECT 1 FROM remisiones
    WHERE pedido_id = $1 AND estado <> 'Anulada'
    LIMIT 1
  `, [pedidoId]);
  return rows.length > 0;
};

/** Lo mínimo para rotular "responde al pedido #N" desde la ficha de una
 *  remisión: sin los JOIN de avance, que ahí no se usan. */
const findEtiqueta = async (negocioId, pedidoId) => {
  const { rows } = await pool.query(`
    SELECT id, numero, estado FROM pedidos_internos
    WHERE id = $1 AND negocio_id = $2
  `, [pedidoId, negocioId]);
  return rows[0] || null;
};

/** Cuántos pedidos esperan a la bodega. Un solo número para el panel: contarlo
 *  trayendo la lista costaría el JOIN de avance en cada carga. */
const contarPendientes = async (negocioId, bodegaId) => {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS n
    FROM      pedidos_internos p
    LEFT JOIN (${AVANCE_POR_PEDIDO}) av ON av.pedido_id = p.id
    WHERE p.negocio_id = $1 AND p.sucursal_bodega_id = $2 AND p.estado = 'Enviado'
      AND COALESCE(av.pedidas, 0) > COALESCE(av.despachadas, 0)
  `, [negocioId, bodegaId]);
  return rows[0]?.n || 0;
};

module.exports = {
  findAll, findById, findParaEscribir, findPorClave,
  getLineas, getLineasPendientes, getRemisiones, findEtiqueta,
  crear, insertarLinea, borrarLineas, actualizarCabecera,
  marcarEnviado, marcarCerrado, reabrir,
  tieneRemisionesVivas, contarPendientes,
};
