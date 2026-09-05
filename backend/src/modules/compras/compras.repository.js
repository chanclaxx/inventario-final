const { pool } = require('../../config/db');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');

const findAll = async (sucursalId, negocioId, proveedorIds = null) => {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (sucursalId) {
    conditions.push(`c.sucursal_id = $${idx++}`);
    params.push(sucursalId);
  } else {
    conditions.push(`su.negocio_id = $${idx++}`);
    params.push(negocioId);
  }

  if (proveedorIds && proveedorIds.length > 0) {
    conditions.push(`c.proveedor_id = ANY($${idx++}::int[])`);
    params.push(proveedorIds);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.numero, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
      c.sucursal_id, su.nombre AS sucursal_nombre,
      p.nombre AS proveedor_nombre,
      u.nombre AS usuario_nombre
    FROM compras c
    JOIN  sucursales  su ON su.id = c.sucursal_id
    JOIN  proveedores p  ON p.id  = c.proveedor_id
    LEFT JOIN usuarios u ON u.id  = c.usuario_id
    ${where}
    ORDER BY c.fecha DESC
  `, params);
  return rows;
};

const findById = async (id) => {
  const { rows } = await pool.query(`
    SELECT c.*, p.nombre AS proveedor_nombre,
           u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
    FROM compras c
    JOIN  sucursales  su ON su.id = c.sucursal_id
    JOIN  proveedores p  ON p.id  = c.proveedor_id
    LEFT JOIN usuarios u ON u.id  = c.usuario_id
    WHERE c.id = $1
  `, [id]);
  return rows[0] || null;
};

const perteneceAlNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.id FROM compras c
    JOIN sucursales s ON s.id = c.sucursal_id
    WHERE c.id = $1 AND s.negocio_id = $2
  `, [id, negocioId]);
  return rows.length > 0;
};

const getLineas = async (compraId) => {
  const { rows } = await pool.query(`
    SELECT lc.*,
      va.valor   AS variante_valor,
      tva.nombre AS variante_tipo_nombre,
      ap.valor   AS atributo_valor,
      tap.nombre AS atributo_tipo_nombre
    FROM lineas_compra lc
    LEFT JOIN variantes_atributo  va  ON va.id  = lc.variante_id
    LEFT JOIN tipos_caracteristica tva ON tva.id = va.tipo_id
    LEFT JOIN atributos_producto  ap  ON ap.id  = lc.atributo_id
    LEFT JOIN tipos_caracteristica tap ON tap.id = ap.tipo_id
    WHERE lc.compra_id = $1
  `, [compraId]);
  return rows;
};

const findByProveedor = async (proveedorId, sucursalId, negocioId) => {
  const filtro = sucursalId ? 'c.sucursal_id = $2' : 'su.negocio_id = $2';
  const param  = sucursalId ?? negocioId;

  const { rows } = await pool.query(`
    SELECT
      c.id, c.numero, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
      c.metodo, c.registrar_en_caja,
      c.sucursal_id, su.nombre AS sucursal_nombre,
      u.nombre AS usuario_nombre
    FROM compras c
    JOIN  sucursales  su ON su.id = c.sucursal_id
    LEFT JOIN usuarios u ON u.id  = c.usuario_id
    WHERE c.proveedor_id = $1 AND ${filtro}
    ORDER BY c.fecha DESC
  `, [proveedorId, param]);
  return rows;
};

// `orden_compra_id` es NULL en la compra suelta de siempre —que es el único
// flujo que existe con las órdenes apagadas— y apunta a la orden cuando la
// compra es en realidad una RECEPCIÓN contra ella.
// `factura_confirmada` por defecto TRUE: una compra que registra administración
// con sus precios ya está confirmada. Solo una Entrada de bodega la manda en
// FALSE y se queda esperando la factura del proveedor.
const create = async (client, { sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas, registrar_en_caja, metodo, orden_compra_id, factura_confirmada = true, es_entrada = false }) => {
  const { rows } = await client.query(`
    INSERT INTO compras(sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas, registrar_en_caja, metodo, orden_compra_id, factura_confirmada, es_entrada)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas, registrar_en_caja !== false, metodo || null, orden_compra_id || null, factura_confirmada !== false, es_entrada === true]);
  rows[0].numero = await asignarNumeroDocumento(client, {
    tipo: 'compra', docId: rows[0].id, sucursalId: sucursal_id,
  });
  return rows[0];
};

// `orden_linea_id` ata la línea recibida a la pedida: es lo que hace DERIVABLE
// el avance de la orden, sin ningún contador guardado que pueda desfasarse.
// `garantia_dias` congela el plazo del proveedor en el momento de la entrada.
const insertarLinea = async (client, {
  compra_id, nombre_producto, imei, cantidad, precio_unitario,
  precio_usd, factor_conversion, valor_traida, variante_id, atributo_id, producto_id,
  orden_linea_id, garantia_dias,
}) => {
  const { rows } = await client.query(`
    INSERT INTO lineas_compra(
      compra_id, nombre_producto, imei, cantidad, precio_unitario,
      precio_usd, factor_conversion, valor_traida, variante_id, atributo_id, producto_id,
      orden_linea_id, garantia_dias
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `, [
    compra_id, nombre_producto, imei || null, cantidad, precio_unitario,
    precio_usd        || null,
    factor_conversion || null,
    valor_traida      || null,
    variante_id       || null,
    atributo_id       || null,
    producto_id       || null,
    orden_linea_id    || null,
    // ?? y no ||: una garantía de 0 días es "sin garantía", un dato válido que
    // no es lo mismo que "nadie lo registró" (NULL).
    garantia_dias     ?? null,
  ]);
  return rows[0];
};

const findByIdYNegocio = async (id, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.*, p.nombre AS proveedor_nombre,
           u.nombre AS usuario_nombre, su.nombre AS sucursal_nombre
    FROM compras c
    JOIN  sucursales  su ON su.id = c.sucursal_id
    JOIN  proveedores p  ON p.id  = c.proveedor_id
    LEFT JOIN usuarios u ON u.id  = c.usuario_id
    WHERE c.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const ajustarStockCantidad = async (client, productoId, cantidad) => {
  await client.query(
    'UPDATE productos_cantidad SET stock = stock + $1 WHERE id = $2',
    [cantidad, productoId]
  );
};

const actualizarCostoPromedio = async (client, productoId, costoPromedio) => {
  await client.query(
    'UPDATE productos_cantidad SET costo_unitario = $1 WHERE id = $2',
    [costoPromedio, productoId]
  );
};

const findAllPaginado = async (sucursalId, negocioId, { page = 1, limit = 20, busqueda, fechaDesde, fechaHasta, metodo, estado, proveedorIds } = {}) => {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (sucursalId) {
    conditions.push(`c.sucursal_id = $${idx++}`);
    params.push(sucursalId);
  } else {
    conditions.push(`su.negocio_id = $${idx++}`);
    params.push(negocioId);
  }

  if (proveedorIds && proveedorIds.length > 0) {
    conditions.push(`c.proveedor_id = ANY($${idx++}::int[])`);
    params.push(proveedorIds);
  }

  if (busqueda) {
    conditions.push(`(p.nombre ILIKE $${idx} OR c.numero_factura ILIKE $${idx})`);
    params.push(`%${busqueda}%`);
    idx++;
  }
  if (fechaDesde) {
    conditions.push(`c.fecha::date >= $${idx++}::date`);
    params.push(fechaDesde);
  }
  if (fechaHasta) {
    conditions.push(`c.fecha::date <= $${idx++}::date`);
    params.push(fechaHasta);
  }
  if (metodo) {
    conditions.push(`c.metodo = $${idx++}`);
    params.push(metodo);
  }
  if (estado) {
    conditions.push(`c.estado = $${idx++}`);
    params.push(estado);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(DISTINCT c.id) AS total
     FROM compras c
     JOIN sucursales su ON su.id = c.sucursal_id
     JOIN proveedores p  ON p.id  = c.proveedor_id
     ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0].total, 10);

  const offset = (page - 1) * limit;
  const dataParams = [...params, limit, offset];

  const { rows } = await pool.query(
    `SELECT
       c.id, c.numero, c.fecha, c.numero_factura, c.total, c.estado, c.notas,
       c.metodo, c.registrar_en_caja,
       c.sucursal_id, su.nombre AS sucursal_nombre,
       p.id AS proveedor_id, p.nombre AS proveedor_nombre, p.tipo AS proveedor_tipo,
       u.nombre AS usuario_nombre,
       COUNT(lc.id) AS num_lineas,
       c.factura_confirmada, c.es_entrada,
       -- Cuando vence la factura de ESTA compra, y como va su deuda. Sale del
       -- Cargo del acreedor, que es donde vive el plazo: la compra no lo guarda.
       cg.fecha_vencimiento,
       (cg.fecha_vencimiento - CURRENT_DATE)::int AS dias_para_vencer,
       GREATEST(COALESCE(cg.valor, 0) - COALESCE(cg.abonado, 0), 0) AS saldo,
       -- Garantia del proveedor: el plazo se congelo en la linea al entrar la
       -- mercancia y el vencimiento se DERIVA. El AT TIME ZONE no es
       -- decorativo: compras.fecha es TIMESTAMP en Bogota y el resultado es
       -- DATE en UTC; sin el, una compra de las 8 p.m. vence un dia antes.
       MAX(lc.garantia_dias) AS garantia_dias,
       MAX((c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias) AS garantia_hasta
     FROM compras c
     JOIN sucursales su ON su.id = c.sucursal_id
     JOIN proveedores p  ON p.id  = c.proveedor_id
     LEFT JOIN usuarios u   ON u.id  = c.usuario_id
     LEFT JOIN lineas_compra lc ON lc.compra_id = c.id
     LEFT JOIN LATERAL (
       SELECT m.valor, m.fecha_vencimiento,
              (SELECT COALESCE(SUM(ab.valor), 0) FROM movimientos_acreedor ab
               WHERE ab.cargo_id = m.id AND ab.tipo = 'Abono') AS abonado
       FROM movimientos_acreedor m
       WHERE m.compra_id = c.id AND m.tipo = 'Cargo'
       LIMIT 1
     ) cg ON TRUE
     ${where}
     GROUP BY c.id, su.nombre, p.id, p.nombre, p.tipo, u.nombre,
              cg.valor, cg.abonado, cg.fecha_vencimiento
     ORDER BY c.fecha DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    dataParams
  );

  return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
};

const marcarCancelada = async (client, compraId) => {
  await client.query(
    `UPDATE compras SET estado = 'Cancelada' WHERE id = $1`,
    [compraId]
  );
};

// -- Lo que la bodega puede recibir hoy --------------------------------------
//
// El bodeguero NO tiene el modulo de proveedores, asi que no puede pedirle nada
// a /ordenes-compra. Esta consulta le da lo mismo pero recortado en origen: ni
// proveedor, ni precio estimado, ni total. Solo que llego que pedir y cuanto
// falta.
//
// El pendiente se DERIVA de lineas_compra, igual que en el resto del modulo: no
// hay contador guardado que pueda desfasarse cuando se cancela una recepcion.
// El FILTER es lo que descuenta las recepciones canceladas; con un WHERE, una
// linea cuyas recepciones se cancelaron TODAS se caeria del resultado y dejaria
// de poder recibirse, que es justo lo contrario de lo que se quiere.
const findOrdenesParaRecibir = async (sucursalId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT o.id, o.numero, o.fecha_emision, o.fecha_esperada, o.notas,
           json_agg(
             json_build_object(
               'orden_linea_id', loc.id,
               'producto_id',    loc.producto_id,
               'nombre',         loc.nombre_producto,
               'tipo',           loc.tipo,
               'variante_id',    loc.variante_id,
               'atributo_id',    loc.atributo_id,
               -- El ROTULO del nodo pedido, no solo su id. Sin esto el bodeguero
               -- ve que la linea baja a una variante pero no cual, que es peor
               -- que no bajar: sabe que tiene que fijarse en algo y no en que.
               -- Se resuelve aqui y no en el frontend porque el arbol se pide
               -- por producto y esto vendria a costar una peticion por linea.
               'variante_valor', loc.variante_valor,
               'atributo_valor', loc.atributo_valor,
               'pedida',         loc.cantidad_pedida,
               'recibida',       loc.recibida,
               'pendiente',      loc.cantidad_pedida - loc.recibida
             ) ORDER BY loc.orden, loc.id
           ) AS lineas
    FROM ordenes_compra o
    JOIN LATERAL (
      SELECT l.id, l.producto_id, l.nombre_producto, l.tipo, l.orden,
             l.variante_id, l.atributo_id, l.cantidad_pedida,
             -- Se concatena el tipo aqui (Potencia: 25W) para que el frontend no
             -- tenga que decidir el formato: la misma etiqueta se pinta en la
             -- orden, en la recepcion y en la entrada, y tres formatos distintos
             -- para el mismo nodo se leen como tres cosas distintas.
             CASE WHEN va.id IS NOT NULL
                  THEN COALESCE(tva.nombre || ': ', '') || va.valor END AS variante_valor,
             CASE WHEN ap.id IS NOT NULL
                  THEN COALESCE(tap.nombre || ': ', '') || ap.valor END AS atributo_valor,
             COALESCE(SUM(lc.cantidad - COALESCE(lc.cantidad_devuelta, 0))
               FILTER (WHERE c.id IS NOT NULL), 0)::int AS recibida
      FROM      lineas_orden_compra l
      LEFT JOIN lineas_compra lc ON lc.orden_linea_id = l.id
      LEFT JOIN compras       c  ON c.id = lc.compra_id AND c.estado <> 'Cancelada'
      LEFT JOIN variantes_atributo   va  ON va.id  = l.variante_id
      LEFT JOIN tipos_caracteristica tva ON tva.id = va.tipo_id
      LEFT JOIN atributos_producto   ap  ON ap.id  = l.atributo_id
      LEFT JOIN tipos_caracteristica tap ON tap.id = ap.tipo_id
      WHERE l.orden_id = o.id
      GROUP BY l.id, va.id, tva.nombre, ap.id, tap.nombre
    ) loc ON TRUE
    JOIN sucursales su ON su.id = o.sucursal_id
    WHERE o.estado = 'Emitida'
      AND o.negocio_id = $2
      AND ($1::int IS NULL OR o.sucursal_id = $1)
    GROUP BY o.id
    HAVING SUM(GREATEST(loc.cantidad_pedida - loc.recibida, 0)) > 0
    ORDER BY o.fecha_esperada NULLS LAST, o.id
  `, [sucursalId, negocioId]);
  return rows;
};

// ── La bandeja de administración ────────────────────────────────────────────
// Lo más viejo primero: la ventana entre recibir y confirmar es justo lo que
// hay que mantener corta (mientras tanto se vende con el costo provisional).
const findPorConfirmar = async (sucursalId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.numero, c.fecha, c.total, c.proveedor_id, c.orden_compra_id,
           c.numero_factura, c.notas, c.sucursal_id,
           su.nombre AS sucursal_nombre,
           u.nombre  AS recibida_por,
           p.nombre  AS proveedor_nombre,
           oc.numero AS orden_numero,
           (CURRENT_DATE - c.fecha::date)::int AS dias_esperando,
           COALESCE(SUM(lc.cantidad), 0)::int  AS unidades,
           COUNT(lc.id)::int                   AS lineas,
           -- Qué llegó, en una línea. Sin esto la lista solo muestra un número
           -- de documento y hay que abrirlas una por una para saber qué es.
           (SELECT string_agg(x.txt, ' · ')
              FROM (SELECT DISTINCT l2.nombre_producto AS txt
                    FROM lineas_compra l2 WHERE l2.compra_id = c.id LIMIT 4) x
           ) AS resumen,
           -- Cómo va la deuda de ESTA entrada. Misma definición que usa
           -- acreedores.getComprasConSaldo (cargo − abonos por cargo_id): si
           -- se calculara distinto, la bandeja y el estado de cuenta del
           -- proveedor dirían cifras diferentes para la misma compra.
           cg.id                                        AS cargo_id,
           cg.valor                                     AS cargo_valor,
           COALESCE(cg.abonado, 0)                      AS abonado,
           GREATEST(COALESCE(cg.valor, 0) - COALESCE(cg.abonado, 0), 0) AS saldo,
           CASE
             WHEN cg.id IS NULL                             THEN 'Sin cargo'
             WHEN cg.valor - COALESCE(cg.abonado, 0) <= 0   THEN 'Saldada'
             WHEN COALESCE(cg.abonado, 0)            >  0   THEN 'Parcial'
             ELSE 'Pendiente'
           END AS estado_pago
    FROM compras c
    JOIN sucursales su ON su.id = c.sucursal_id
    LEFT JOIN usuarios       u  ON u.id  = c.usuario_id
    LEFT JOIN proveedores    p  ON p.id  = c.proveedor_id
    LEFT JOIN ordenes_compra oc ON oc.id = c.orden_compra_id
    LEFT JOIN lineas_compra  lc ON lc.compra_id = c.id
    LEFT JOIN LATERAL (
      SELECT m.id, m.valor,
             (SELECT COALESCE(SUM(a.valor), 0) FROM movimientos_acreedor a
              WHERE a.cargo_id = m.id AND a.tipo = 'Abono') AS abonado
      FROM movimientos_acreedor m
      WHERE m.compra_id = c.id AND m.tipo = 'Cargo'
      LIMIT 1
    ) cg ON TRUE
    WHERE c.factura_confirmada = FALSE
      AND c.estado <> 'Cancelada'
      AND ($1::int IS NULL OR c.sucursal_id = $1)
      AND su.negocio_id = $2
    GROUP BY c.id, su.nombre, u.nombre, p.nombre, oc.numero, cg.id, cg.valor, cg.abonado
    ORDER BY c.fecha ASC
  `, [sucursalId, negocioId]);
  return rows;
};

// Lo que ve el bodeguero de sus propias entradas. Sin una sola cifra de dinero:
// el recorte de `costos.util` actúa sobre la respuesta, pero además aquí ni
// siquiera se selecciona el total.
const findEntradas = async (sucursalId, negocioId, limit = 30) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.numero, c.fecha, c.factura_confirmada, c.estado,
           c.orden_compra_id, oc.numero AS orden_numero,
           u.nombre AS recibida_por,
           COALESCE(SUM(lc.cantidad), 0)::int AS unidades,
           COUNT(lc.id)::int                  AS lineas,
           -- Garantía del proveedor. El AT TIME ZONE no es decorativo:
           -- compras.fecha es TIMESTAMP leído en Bogotá y el resultado es DATE
           -- leído en UTC; sin él una entrada de las 8 p.m. vence un día antes.
           MAX(lc.garantia_dias)              AS garantia_dias,
           MAX((c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias)
                                              AS garantia_hasta,
           -- Qué llegó, en una línea. Sin esto la lista solo muestra un número
           -- de documento y hay que abrirlas una por una para saber qué es.
           (SELECT string_agg(x.txt, ' · ')
              FROM (SELECT DISTINCT l2.nombre_producto AS txt
                    FROM lineas_compra l2 WHERE l2.compra_id = c.id LIMIT 4) x
           ) AS resumen
    FROM compras c
    JOIN sucursales su ON su.id = c.sucursal_id
    LEFT JOIN usuarios       u  ON u.id  = c.usuario_id
    LEFT JOIN ordenes_compra oc ON oc.id = c.orden_compra_id
    LEFT JOIN lineas_compra  lc ON lc.compra_id = c.id
    WHERE ($1::int IS NULL OR c.sucursal_id = $1)
      AND su.negocio_id = $2
      -- Solo lo que entró por bodega. Una compra registrada desde Proveedores,
      -- con su proveedor y sus precios, no es una Entrada.
      AND c.es_entrada = TRUE
    GROUP BY c.id, oc.numero, u.nombre
    ORDER BY c.fecha DESC
    LIMIT $3
  `, [sucursalId, negocioId, limit]);
  return rows;
};

// Detalle de una Entrada para el bodeguero. Deliberadamente SIN dinero: lleva
// que llego, cuanto, de que variante, con que IMEI y hasta cuando responde el
// proveedor. El recorte de costos actua ademas sobre la respuesta, pero lo
// importante es que aqui ni siquiera se selecciona un precio.
const findEntradaDetalle = async (compraId, negocioId) => {
  const { rows: cab } = await pool.query(`
    SELECT c.id, c.numero, c.fecha, c.factura_confirmada, c.estado, c.notas,
           c.orden_compra_id, oc.numero AS orden_numero,
           c.es_entrada,
           -- La sucursal, para que la pantalla de correccion pueda pedir el
           -- arbol de variantes del producto que se va a corregir. Es un id, no
           -- una cifra: el detalle sigue sin seleccionar un solo precio.
           c.sucursal_id,
           u.nombre AS recibida_por, su.nombre AS sucursal_nombre
    FROM compras c
    JOIN sucursales su ON su.id = c.sucursal_id
    LEFT JOIN usuarios       u  ON u.id  = c.usuario_id
    LEFT JOIN ordenes_compra oc ON oc.id = c.orden_compra_id
    -- Sin filtrar por es_entrada: la bandeja de administracion tampoco lo
    -- hace, y tres consultas que muestran el mismo documento no pueden estar en
    -- desacuerdo sobre cual existe. Si la lista o la bandeja te lo enseñan, el
    -- detalle tiene que poder abrirlo. No filtra dinero porque no lo selecciona.
    WHERE c.id = $1 AND su.negocio_id = $2
  `, [compraId, negocioId]);
  if (!cab.length) return null;

  const { rows: lineas } = await pool.query(`
    SELECT lc.id, lc.nombre_producto, lc.imei, lc.cantidad, lc.cantidad_devuelta,
           lc.garantia_dias, lc.orden_linea_id,
           -- Los IDS del nodo, ademas de sus rotulos: corregir necesita saber
           -- DONDE esta la linea hoy para poder moverla, y el rotulo no sirve
           -- para eso. Tampoco son dinero.
           lc.producto_id, lc.variante_id, lc.atributo_id,
           va.valor   AS variante_valor,  tva.nombre AS variante_tipo,
           ap.valor   AS atributo_valor,  tap.nombre AS atributo_tipo,
           s.color, s.caracteristicas,
           (c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias AS garantia_hasta
    FROM lineas_compra lc
    JOIN compras c ON c.id = lc.compra_id
    LEFT JOIN variantes_atributo   va  ON va.id  = lc.variante_id
    LEFT JOIN tipos_caracteristica tva ON tva.id = va.tipo_id
    LEFT JOIN atributos_producto   ap  ON ap.id  = lc.atributo_id
    LEFT JOIN tipos_caracteristica tap ON tap.id = ap.tipo_id
    LEFT JOIN LATERAL (
      SELECT se.color, se.caracteristicas
      FROM seriales se
      JOIN productos_serial ps ON ps.id = se.producto_id
      WHERE lc.imei IS NOT NULL
        AND UPPER(TRIM(se.imei)) = UPPER(TRIM(lc.imei))
        AND ps.sucursal_id = c.sucursal_id
      ORDER BY se.id DESC LIMIT 1
    ) s ON TRUE
    WHERE lc.compra_id = $1
    ORDER BY lc.id
  `, [compraId]);

  return { ...cab[0], lineas };
};

const marcarConfirmada = async (client, compraId) => {
  await client.query(
    'UPDATE compras SET factura_confirmada = TRUE WHERE id = $1',
    [compraId]
  );
};

const asignarProveedor = async (client, compraId, proveedorId) => {
  await client.query(
    'UPDATE compras SET proveedor_id = $1 WHERE id = $2 AND proveedor_id IS NULL',
    [proveedorId, compraId]
  );
};

module.exports = {
  findOrdenesParaRecibir, findPorConfirmar, findEntradaDetalle, findEntradas, marcarConfirmada, asignarProveedor,
  findAll, findById, findByIdYNegocio,
  perteneceAlNegocio, findByProveedor,
  getLineas, create, insertarLinea,
  ajustarStockCantidad, actualizarCostoPromedio,
  findAllPaginado, marcarCancelada,
};