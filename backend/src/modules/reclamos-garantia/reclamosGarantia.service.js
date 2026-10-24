// ─────────────────────────────────────────────────────────────────────────────
// GARANTÍAS CON PROVEEDORES — ver migrations/20261023_reclamos_garantia.sql
//
//   recibir (crear el caso) ──► con el cliente: cambio | reembolso | espera
//                          └──► con el proveedor: envío ──► repone | repara |
//                               nota crédito | devuelve plata | no lo cubre
//
// Reglas del negocio (23-oct-2026), y dónde viven:
//   · La unidad que viene de una venta o un préstamo VUELVE al inventario y
//     SALE a garantía (`_apartar`): un serial deja de estar vendido/prestado
//     pero queda bloqueado por el trigger; por cantidad las dos escrituras se
//     anulan y el stock no se toca. La que estaba en el inventario se descuenta.
//     En los dos casos NO cuenta en el stock vendible y el inventario lo avisa.
//   · Devolverle la plata al cliente DESHACE LA VENTA de esa línea
//     (`cantidad_devuelta`), así los reportes la sacan solos; en contado sale de
//     la caja de la sede; en crédito baja el crédito (el núcleo de la devolución
//     parcial de siempre, sin volver a mover la unidad).
//   · La unidad que se le entrega al cliente sale del stock vendible.
//   · Cuando el proveedor repone o repara, la unidad vuelve a salir normal, con
//     la garantía que se elija (la de la compra, N días o ninguna).
//   · El local de la red le devuelve a la bodega por la devolución que ya existe
//     y la bodega reclama desde su inventario: no hay origen «despacho».
//
// Doble clic: toda escritura toma UN candado (`bloquearOperacion`) como primera
// cosa de la transacción y recién entonces lee lo que va a decidir.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../config/db');
const repo = require('./reclamosGarantia.repository');
const { bloquearOperacion, errorDuplicado, VENTANA_DUPLICADO_SEG } = require('../../utils/idempotencia.util');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');
const { puedeVerCostos } = require('../../utils/costos.util');
const { buscarEnTecnico } = require('../../utils/serialEnTecnico.util');
const { revertirCostoPromedio } = require('../../utils/costoPromedio.util');
const { sqlSinTildes, patronLike, normalizarTexto } = require('../../utils/textoBusqueda.util');
const { hayReclamosFase2 } = require('../../config/columnas');

const METODOS_DEFECTO = 'Efectivo';
const ESTADO_GARANTIA_AVISO = 15; // días: «por vencer» en el semáforo de la procedencia

const _num = (v) => Number(v || 0);
const _texto = (v, max = 500) => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};
const _entero = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── Alcance ──────────────────────────────────────────────────────────────────
// La sede de quien trabaja: el supervisor y el vendedor, la suya; el admin, la
// de la cabecera (obligatoria para escribir: una garantía es de UNA sede).
const _sedeEscritura = (user, sucursalId) => {
  const sede = user.rol === 'admin_negocio' ? Number(sucursalId) || null : Number(user.sucursal_id) || null;
  if (!sede) throw { status: 400, code: 'SUCURSAL_REQUERIDA', message: 'Elige la sucursal en la que vas a trabajar' };
  return sede;
};
const _sedeLectura = (user, sucursalId) => (user.rol === 'admin_negocio'
  ? (Number(sucursalId) || null)
  : (Number(user.sucursal_id) || -1));

const _exigirSede = (user, sucursalDelDoc) => {
  if (user.rol === 'admin_negocio') return;
  if (Number(user.sucursal_id) !== Number(sucursalDelDoc)) {
    throw { status: 403, message: 'Esta garantía es de otra sucursal' };
  }
};

const _numeroDe = (r) => r?.numero ?? r?.id;

// ── Nodos de cantidad ────────────────────────────────────────────────────────
const _tablaNodo = ({ variante_id, atributo_id }) => (variante_id
  ? { tabla: 'variantes_atributo', id: Number(variante_id) }
  : atributo_id
    ? { tabla: 'atributos_producto', id: Number(atributo_id) }
    : null);

const _mismoNodo = (a, b) => Number(a.producto_id) === Number(b.producto_id)
  && Number(a.atributo_id || 0) === Number(b.atributo_id || 0)
  && Number(a.variante_id || 0) === Number(b.variante_id || 0);

/**
 * Lee un nodo de cantidad de la sede, con su stock y costo de la HOJA, y exige
 * que sea hoja cuando el negocio lleva variantes: el stock vive abajo y mover
 * el contenedor descuadraría el árbol (el mismo error de las remisiones).
 */
const _leerNodo = async (client, { producto_id, atributo_id = null, variante_id = null }, sucursalId, { bloquear = false } = {}) => {
  const forUpdate = bloquear ? 'FOR UPDATE OF p' : '';
  const { rows } = await client.query(`
    SELECT p.id AS producto_id, p.nombre, p.sucursal_id, p.stock AS stock_producto,
           p.costo_unitario AS costo_producto,
           a.id AS atributo_id, a.valor AS atributo_valor, a.stock AS stock_atributo,
           a.costo_unitario AS costo_atributo,
           v.id AS variante_id, v.valor AS variante_valor, v.stock AS stock_variante,
           v.costo_unitario AS costo_variante,
           (SELECT c.valor FROM config_negocio c JOIN sucursales s ON s.negocio_id = c.negocio_id
             WHERE s.id = p.sucursal_id AND c.clave = 'variantes_activo' LIMIT 1) AS variantes_activo,
           CASE WHEN $2::int IS NULL
                THEN EXISTS (SELECT 1 FROM atributos_producto x WHERE x.producto_id = p.id AND x.activo = true)
                WHEN $3::int IS NULL
                THEN EXISTS (SELECT 1 FROM variantes_atributo x WHERE x.atributo_id = $2 AND x.activo = true)
                ELSE false END AS tiene_hijos
    FROM productos_cantidad p
    LEFT JOIN atributos_producto a ON a.id = $2 AND a.producto_id = p.id
    LEFT JOIN variantes_atributo v ON v.id = $3 AND v.atributo_id = a.id
    WHERE p.id = $1
    ${forUpdate}
  `, [producto_id, atributo_id || null, variante_id || null]);
  const n = rows[0];
  if (!n || Number(n.sucursal_id) !== Number(sucursalId)) {
    throw { status: 404, message: 'El producto no existe en esta sucursal' };
  }
  if (atributo_id && !n.atributo_id) throw { status: 404, message: 'La variante elegida ya no existe' };
  if (variante_id && !n.variante_id) throw { status: 404, message: 'La variante elegida ya no existe' };
  if (n.variantes_activo === '1' && n.tiene_hijos) {
    throw {
      status: 400, code: 'VARIANTE_REQUERIDA',
      message: `"${n.nombre}" se maneja por variantes: elige cuál (talla, color…) es la unidad.`,
    };
  }
  const stock = n.variante_id ? n.stock_variante : n.atributo_id ? n.stock_atributo : n.stock_producto;
  const costo = n.variante_id
    ? (n.costo_variante ?? n.costo_atributo ?? n.costo_producto)
    : n.atributo_id ? (n.costo_atributo ?? n.costo_producto) : n.costo_producto;
  const varianteTexto = [n.atributo_valor, n.variante_valor].filter(Boolean).join(' / ') || null;
  return {
    producto_id: n.producto_id, atributo_id: n.atributo_id, variante_id: n.variante_id,
    nombre: n.nombre, variante_texto: varianteTexto,
    stock: _num(stock), costo: costo == null ? null : Number(costo),
  };
};

/**
 * Mueve el stock de un nodo HOJA con su historial (el mismo helper de las
 * retomas). Al entrar con costo, pondera el promedio; al salir, lo deja.
 */
const _moverStock = async (client, nodo, sucursalId, cantidad, { costo = null, tipo, nota = null }) => {
  const { ajustarStockConHistorialEnTx } = require('../prestamos/prestamos.repository');
  await ajustarStockConHistorialEnTx(client, {
    producto_id: nodo.producto_id, sucursal_id: sucursalId,
    atributo_id: nodo.atributo_id || null, variante_id: nodo.variante_id || null,
    cantidad, costo_unitario: cantidad > 0 ? costo : null, tipo, cliente_origen: nota,
  });
};

// ── Procedencia: de qué proveedor vino y hasta cuándo responde ───────────────
const _estadoGarantia = (hasta) => require('../procedencia/procedencia.service').estadoGarantia(hasta, ESTADO_GARANTIA_AVISO);

const _procedenciaSerial = async (executor, negocioId, imei, serialId) => {
  // Una unidad que ya entró por una REPOSICIÓN de garantía responde con esa:
  // es la más reciente y su garantía la eligió una persona.
  if (serialId) {
    const { rows: rep } = await executor.query(`
      SELECT r.proveedor_id, pr.nombre AS proveedor_nombre, COALESCE(r.numero, r.id) AS reclamo_numero,
             to_char(m.garantia_hasta, 'YYYY-MM-DD') AS garantia_hasta, m.fecha,
             l.compra_id, l.linea_compra_id
      FROM reclamos_garantia_movimientos m
      JOIN reclamos_garantia_lineas l ON l.id = m.linea_id
      JOIN reclamos_garantia r        ON r.id = m.reclamo_id
      LEFT JOIN proveedores pr        ON pr.id = r.proveedor_id
      WHERE m.serial_id = $1 AND m.tipo = 'reposicion' AND NOT m.anulado AND r.negocio_id = $2
      ORDER BY m.fecha DESC LIMIT 1
    `, [serialId, negocioId]);
    if (rep[0]) {
      return {
        via: 'reposicion', reclamo_numero: rep[0].reclamo_numero,
        proveedor_id: rep[0].proveedor_id, proveedor_nombre: rep[0].proveedor_nombre,
        compra_id: rep[0].compra_id, linea_compra_id: rep[0].linea_compra_id,
        garantia_hasta: rep[0].garantia_hasta, ..._estadoGarantia(rep[0].garantia_hasta),
      };
    }
  }
  const { rows } = await executor.query(`
    SELECT c.id AS compra_id, c.numero AS compra_numero, c.fecha AS compra_fecha,
           lc.id AS linea_compra_id, p.id AS proveedor_id, p.nombre AS proveedor_nombre,
           to_char(CASE WHEN lc.garantia_dias IS NOT NULL
                        THEN (c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias END,
                   'YYYY-MM-DD') AS garantia_hasta
    FROM lineas_compra lc
    JOIN compras c     ON c.id  = lc.compra_id
    JOIN proveedores p ON p.id  = c.proveedor_id
    JOIN sucursales su ON su.id = c.sucursal_id
    WHERE UPPER(BTRIM(lc.imei)) = UPPER(BTRIM($1)) AND su.negocio_id = $2 AND c.estado <> 'Cancelada'
    ORDER BY c.fecha DESC, lc.id DESC
    LIMIT 1
  `, [imei, negocioId]);
  if (rows[0]) return { via: 'compra', ...rows[0], ..._estadoGarantia(rows[0].garantia_hasta) };
  // Sin compra (retoma, importación): a lo sumo el proveedor anotado en la unidad.
  if (serialId) {
    const { rows: s } = await executor.query(`
      SELECT s.proveedor_id, p.nombre AS proveedor_nombre, s.cliente_origen
      FROM seriales s LEFT JOIN proveedores p ON p.id = s.proveedor_id WHERE s.id = $1
    `, [serialId]);
    if (s[0]?.proveedor_id) return { via: 'serial', proveedor_id: s[0].proveedor_id, proveedor_nombre: s[0].proveedor_nombre, garantia_hasta: null, ..._estadoGarantia(null) };
    if (s[0]?.cliente_origen) return { via: 'cliente', cliente_origen: s[0].cliente_origen, garantia_hasta: null, ..._estadoGarantia(null) };
  }
  return null;
};

// Por cantidad las unidades son fungibles: la sugerencia es la última compra del
// producto (preferida la de ese mismo nodo). Es una propuesta, no una verdad.
const _procedenciaCantidad = async (executor, negocioId, nodo) => {
  const { rows } = await executor.query(`
    SELECT c.id AS compra_id, c.numero AS compra_numero, c.fecha AS compra_fecha,
           lc.id AS linea_compra_id, p.id AS proveedor_id, p.nombre AS proveedor_nombre,
           to_char(CASE WHEN lc.garantia_dias IS NOT NULL
                        THEN (c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias END,
                   'YYYY-MM-DD') AS garantia_hasta
    FROM lineas_compra lc
    JOIN compras c     ON c.id  = lc.compra_id
    JOIN proveedores p ON p.id  = c.proveedor_id
    JOIN sucursales su ON su.id = c.sucursal_id
    WHERE lc.producto_id = $1 AND lc.imei IS NULL AND su.negocio_id = $2 AND c.estado <> 'Cancelada'
    ORDER BY (COALESCE(lc.variante_id, 0) = COALESCE($4::int, 0)
              AND COALESCE(lc.atributo_id, 0) = COALESCE($3::int, 0)) DESC,
             c.fecha DESC, lc.id DESC
    LIMIT 1
  `, [nodo.producto_id, negocioId, nodo.atributo_id || null, nodo.variante_id || null]);
  return rows[0] ? { via: 'compra', ...rows[0], ..._estadoGarantia(rows[0].garantia_hasta) } : null;
};

// ── Lo ya reclamado de un documento (para el tope) ───────────────────────────
const _yaReclamado = async (executor, { lineaFacturaId = null, prestamoId = null }) => {
  const { rows } = await executor.query(`
    SELECT COALESCE(SUM(l.cantidad), 0)::int AS n
    FROM reclamos_garantia_lineas l
    JOIN reclamos_garantia r ON r.id = l.reclamo_id
    WHERE NOT r.anulado
      AND (($1::int IS NOT NULL AND l.linea_factura_id = $1)
        OR ($2::int IS NOT NULL AND r.prestamo_id = $2))
  `, [lineaFacturaId, prestamoId]);
  return _num(rows[0]?.n);
};

const _garantiaAbiertaDe = async (executor, serialId) => {
  if (!serialId) return null;
  const { rows } = await executor.query(`
    SELECT COALESCE(r.numero, r.id) AS numero
    FROM reclamos_garantia_lineas l JOIN reclamos_garantia r ON r.id = l.reclamo_id
    WHERE l.serial_id = $1 AND NOT l.cerrada AND NOT r.anulado LIMIT 1
  `, [serialId]);
  return rows[0]?.numero ?? null;
};

const _enTransito = async (executor, serialId) => {
  if (!serialId) return null;
  const { rows: t } = await executor.query(`SELECT to_regclass('public.lineas_remision') AS t`);
  if (!t[0]?.t) return null;
  const { rows } = await executor.query(`
    SELECT COALESCE(rm.numero, rm.id) AS numero
    FROM lineas_remision lr JOIN remisiones rm ON rm.id = lr.remision_id
    WHERE lr.serial_id = $1 AND lr.estado_linea = 'Pendiente' AND rm.estado = 'En transito'
    LIMIT 1
  `, [serialId]);
  return rows[0]?.numero ?? null;
};

// ═════════════════════════════════════════════════════════════════════════════
// CANDIDATOS — «¿qué unidad es y de dónde salió?»
// ═════════════════════════════════════════════════════════════════════════════
//
// Una sola forma para todas las puertas (factura, préstamo, inventario, la
// búsqueda de la pestaña). El backend la vuelve a resolver al crear: lo que
// manda el navegador es solo QUÉ unidad, nunca su costo ni su estado.

const _candidatoSerial = async (executor, negocioId, sucursalId, serialId, { factura = null } = {}) => {
  const { rows } = await executor.query(`
    SELECT s.id, s.imei, s.vendido, s.prestado, s.costo_compra, s.precio, s.color,
           s.producto_id, ps.nombre, ps.sucursal_id
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales su       ON su.id = ps.sucursal_id
    WHERE s.id = $1 AND su.negocio_id = $2
  `, [serialId, negocioId]);
  const s = rows[0];
  if (!s) return null;
  if (sucursalId && Number(s.sucursal_id) !== Number(sucursalId)) return null;

  const base = {
    clave: `serial-${s.id}`, tipo: 'serial', serial_id: s.id, imei: s.imei,
    producto_id: s.producto_id, atributo_id: null, variante_id: null,
    nombre_producto: s.nombre, variante_texto: s.color || null,
    sucursal_id: s.sucursal_id, cantidad_max: 1,
    costo_unitario: s.costo_compra == null ? null : Number(s.costo_compra),
    precio_venta: null, linea_factura_id: null, factura: null, prestamo: null, cliente: null,
    bloqueo: null,
  };

  if (s.vendido) {
    // La venta: la última línea viva de ese IMEI en la sede (o la que se pidió).
    const { rows: lf } = await executor.query(`
      SELECT l.id, l.factura_id, l.precio, l.cantidad, COALESCE(l.cantidad_devuelta, 0) AS devuelta,
             f.numero, f.estado, f.fecha, f.nombre_cliente, f.cedula, f.celular
      FROM lineas_factura l JOIN facturas f ON f.id = l.factura_id
      WHERE UPPER(BTRIM(l.imei)) = UPPER(BTRIM($1)) AND f.sucursal_id = $2
        AND f.estado <> 'Cancelada'
        AND l.cantidad - COALESCE(l.cantidad_devuelta, 0) > 0
        AND ($3::int IS NULL OR l.factura_id = $3)
      ORDER BY f.fecha DESC, l.id DESC LIMIT 1
    `, [s.imei, s.sucursal_id, factura]);
    if (!lf[0]) return { ...base, origen_tipo: 'factura', bloqueo: 'Este equipo figura vendido pero no se encontró su factura en esta sucursal' };
    const l = lf[0];
    return {
      ...base, origen_tipo: 'factura', linea_factura_id: l.id,
      precio_venta: Number(l.precio),
      factura: { id: l.factura_id, numero: l.numero ?? l.factura_id, estado: l.estado, fecha: l.fecha, es_credito: l.estado === 'Credito' },
      cliente: { nombre: l.nombre_cliente, cedula: l.cedula, telefono: l.celular },
    };
  }
  if (s.prestado) {
    const { rows: p } = await executor.query(`
      SELECT id, numero, estado, fecha, prestatario, cedula, telefono, valor_prestamo, cantidad_prestada
      FROM prestamos
      WHERE UPPER(BTRIM(imei)) = UPPER(BTRIM($1)) AND sucursal_id = $2 AND estado = 'Activo'
      ORDER BY fecha DESC, id DESC LIMIT 1
    `, [s.imei, s.sucursal_id]);
    if (!p[0]) return { ...base, origen_tipo: 'prestamo', bloqueo: 'Este equipo figura prestado pero no se encontró su préstamo activo' };
    return {
      ...base, origen_tipo: 'prestamo',
      precio_venta: _num(p[0].valor_prestamo),
      prestamo: { id: p[0].id, numero: p[0].numero ?? p[0].id, estado: p[0].estado, fecha: p[0].fecha },
      cliente: { nombre: p[0].prestatario, cedula: p[0].cedula, telefono: p[0].telefono },
    };
  }
  return { ...base, origen_tipo: 'inventario' };
};

const _candidatoLineaFactura = async (executor, negocioId, sucursalId, lineaId) => {
  const { rows } = await executor.query(`
    SELECT l.id, l.factura_id, l.imei, l.producto_id, l.atributo_id, l.variante_id, l.nombre_producto,
           l.precio, l.cantidad, COALESCE(l.cantidad_devuelta, 0) AS devuelta,
           f.numero, f.estado, f.fecha, f.nombre_cliente, f.cedula, f.celular, f.sucursal_id
    FROM lineas_factura l
    JOIN facturas f    ON f.id = l.factura_id
    JOIN sucursales su ON su.id = f.sucursal_id
    WHERE l.id = $1 AND su.negocio_id = $2
  `, [lineaId, negocioId]);
  const l = rows[0];
  if (!l) return null;
  if (sucursalId && Number(l.sucursal_id) !== Number(sucursalId)) return null;
  if (l.estado === 'Cancelada') {
    return { clave: `lf-${l.id}`, bloqueo: 'La factura está cancelada', nombre_producto: l.nombre_producto };
  }
  if (l.imei) {
    const { rows: s } = await executor.query(`
      SELECT s.id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
      WHERE UPPER(BTRIM(s.imei)) = UPPER(BTRIM($1)) AND ps.sucursal_id = $2
      ORDER BY s.vendido DESC, s.id DESC LIMIT 1
    `, [l.imei, l.sucursal_id]);
    if (!s[0]) return { clave: `lf-${l.id}`, bloqueo: `El equipo ${l.imei} ya no está en el inventario de la sede`, nombre_producto: l.nombre_producto };
    const c = await _candidatoSerial(executor, negocioId, l.sucursal_id, s[0].id, { factura: l.factura_id });
    if (c && c.origen_tipo !== 'factura' && !c.bloqueo) {
      // El equipo ya volvió (otra garantía, una devolución): esta venta ya no lo tiene.
      return { ...c, bloqueo: 'Este equipo ya no está vendido en esta factura' };
    }
    return c;
  }
  if (!l.producto_id) {
    return { clave: `lf-${l.id}`, bloqueo: 'Esta línea no es un producto del inventario', nombre_producto: l.nombre_producto };
  }
  const nodo = { producto_id: l.producto_id, atributo_id: l.atributo_id, variante_id: l.variante_id };
  const { rows: costo } = await executor.query(`
    SELECT COALESCE(v.costo_unitario, a.costo_unitario, p.costo_unitario) AS costo,
           NULLIF(CONCAT_WS(' / ', a.valor, v.valor), '') AS variante_texto
    FROM productos_cantidad p
    LEFT JOIN atributos_producto a ON a.id = $2
    LEFT JOIN variantes_atributo v ON v.id = $3
    WHERE p.id = $1
  `, [nodo.producto_id, nodo.atributo_id || null, nodo.variante_id || null]);
  const neta = _num(l.cantidad) - _num(l.devuelta);
  const reclamado = await _yaReclamado(executor, { lineaFacturaId: l.id });
  const max = Math.max(0, neta - reclamado);
  return {
    clave: `lf-${l.id}`, tipo: 'cantidad', origen_tipo: 'factura', serial_id: null, imei: null,
    ...nodo, nombre_producto: l.nombre_producto, variante_texto: costo[0]?.variante_texto || null,
    sucursal_id: l.sucursal_id, cantidad_max: max,
    costo_unitario: costo[0]?.costo == null ? null : Number(costo[0].costo),
    precio_venta: Number(l.precio), linea_factura_id: l.id,
    factura: { id: l.factura_id, numero: l.numero ?? l.factura_id, estado: l.estado, fecha: l.fecha, es_credito: l.estado === 'Credito' },
    prestamo: null,
    cliente: { nombre: l.nombre_cliente, cedula: l.cedula, telefono: l.celular },
    bloqueo: max > 0 ? null : (reclamado > 0 ? 'Todas las unidades de esta línea ya están en garantía' : 'Esta línea ya fue devuelta'),
  };
};

const _candidatoPrestamo = async (executor, negocioId, sucursalId, prestamoId) => {
  const { rows } = await executor.query(`
    SELECT p.*, su.negocio_id
    FROM prestamos p JOIN sucursales su ON su.id = p.sucursal_id
    WHERE p.id = $1 AND su.negocio_id = $2
  `, [prestamoId, negocioId]);
  const p = rows[0];
  if (!p) return null;
  if (sucursalId && Number(p.sucursal_id) !== Number(sucursalId)) return null;
  const nombre = p.nombre_producto || 'Producto prestado';
  if (p.estado !== 'Activo') {
    return { clave: `pr-${p.id}`, bloqueo: p.estado === 'Saldado'
      ? 'El préstamo ya está saldado: abre la garantía desde la factura que generó'
      : `El préstamo está ${String(p.estado).toLowerCase()}`, nombre_producto: nombre };
  }
  if (p.imei) {
    const { rows: s } = await executor.query(`
      SELECT s.id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
      WHERE UPPER(BTRIM(s.imei)) = UPPER(BTRIM($1)) AND ps.sucursal_id = $2
      ORDER BY s.prestado DESC, s.id DESC LIMIT 1
    `, [p.imei, p.sucursal_id]);
    if (!s[0]) return { clave: `pr-${p.id}`, bloqueo: `El equipo ${p.imei} ya no está en el inventario`, nombre_producto: nombre };
    return _candidatoSerial(executor, negocioId, p.sucursal_id, s[0].id);
  }
  if (!p.producto_id) return { clave: `pr-${p.id}`, bloqueo: 'Este préstamo no es de un producto del inventario', nombre_producto: nombre };
  const nodo = { producto_id: p.producto_id, atributo_id: p.atributo_id, variante_id: p.variante_id };
  const { rows: costo } = await executor.query(`
    SELECT COALESCE(v.costo_unitario, a.costo_unitario, pc.costo_unitario) AS costo,
           NULLIF(CONCAT_WS(' / ', a.valor, v.valor), '') AS variante_texto
    FROM productos_cantidad pc
    LEFT JOIN atributos_producto a ON a.id = $2
    LEFT JOIN variantes_atributo v ON v.id = $3
    WHERE pc.id = $1
  `, [nodo.producto_id, nodo.atributo_id || null, nodo.variante_id || null]);
  const prestada = _num(p.cantidad_prestada ?? p.cantidad ?? 1);
  const reclamado = await _yaReclamado(executor, { prestamoId: p.id });
  const max = Math.max(0, prestada - reclamado);
  const cant = Math.max(prestada, 1);
  return {
    clave: `pr-${p.id}`, tipo: 'cantidad', origen_tipo: 'prestamo', serial_id: null, imei: null,
    ...nodo, nombre_producto: nombre, variante_texto: costo[0]?.variante_texto || null,
    sucursal_id: p.sucursal_id, cantidad_max: max,
    costo_unitario: costo[0]?.costo == null ? null : Number(costo[0].costo),
    precio_venta: _num(p.valor_prestamo) / cant, linea_factura_id: null, factura: null,
    prestamo: { id: p.id, numero: p.numero ?? p.id, estado: p.estado, fecha: p.fecha },
    cliente: { nombre: p.prestatario, cedula: p.cedula, telefono: p.telefono },
    bloqueo: max > 0 ? null : 'Todas las unidades de este préstamo ya están en garantía',
  };
};

const _candidatoNodo = async (executor, sucursalId, nodoPedido) => {
  const nodo = await _leerNodo(executor, nodoPedido, sucursalId);
  return {
    clave: `nodo-${nodo.producto_id}-${nodo.atributo_id || 0}-${nodo.variante_id || 0}`,
    tipo: 'cantidad', origen_tipo: 'inventario', serial_id: null, imei: null,
    producto_id: nodo.producto_id, atributo_id: nodo.atributo_id, variante_id: nodo.variante_id,
    nombre_producto: nodo.nombre, variante_texto: nodo.variante_texto,
    sucursal_id: Number(sucursalId), cantidad_max: Math.max(0, nodo.stock),
    costo_unitario: nodo.costo, precio_venta: null, linea_factura_id: null,
    factura: null, prestamo: null, cliente: null,
    bloqueo: nodo.stock > 0 ? null : 'No hay stock de este producto en la sucursal',
  };
};

// Las hojas activas debajo de un producto (o de una talla), en orden.
const _hojasDeProducto = async (executor, sucursalId, { producto_id, atributo_id = null }) => {
  const { rows } = await executor.query(`
    SELECT a.producto_id, a.id AS atributo_id, NULL::int AS variante_id, a.id AS o1, 0 AS o2
    FROM atributos_producto a
    WHERE a.producto_id = $1 AND a.activo AND ($2::int IS NULL OR a.id = $2) AND a.sucursal_id = $3
      AND NOT EXISTS (SELECT 1 FROM variantes_atributo v WHERE v.atributo_id = a.id AND v.activo)
    UNION ALL
    SELECT a.producto_id, a.id, v.id, a.id, v.id
    FROM variantes_atributo v JOIN atributos_producto a ON a.id = v.atributo_id
    WHERE a.producto_id = $1 AND a.activo AND v.activo AND ($2::int IS NULL OR a.id = $2) AND a.sucursal_id = $3
    ORDER BY 4, 5
    LIMIT 60
  `, [producto_id, atributo_id, sucursalId]);
  return rows.map(({ producto_id: p, atributo_id: a, variante_id: v }) => ({ producto_id: p, atributo_id: a, variante_id: v }));
};

/**
 * El equipo de una orden de servicio, como candidato. La orden guarda el
 * serial que escribió quien la recibió: si es un IMEI nuestro (vendido,
 * prestado o en inventario) se resuelve como cualquier otro; si no, se dice
 * por qué no hay a quién reclamarle. El candidato lleva la orden para ligarla.
 */
const _candidatoOrdenServicio = async (executor, negocioId, sucursalId, ordenId) => {
  const { rows } = await executor.query(`
    SELECT os.id, os.numero, os.sucursal_id, os.equipo_serial, os.equipo_nombre, os.equipo_tipo,
           os.cliente_nombre, os.cliente_cedula, os.cliente_telefono, os.factura_id, os.falla_reportada
    FROM ordenes_servicio os JOIN sucursales su ON su.id = os.sucursal_id
    WHERE os.id = $1 AND su.negocio_id = $2
  `, [ordenId, negocioId]);
  const os = rows[0];
  if (!os || (sucursalId && Number(os.sucursal_id) !== Number(sucursalId))) return null;
  const orden = { id: os.id, numero: os.numero ?? os.id, falla: os.falla_reportada || null };
  const nombre = [os.equipo_tipo, os.equipo_nombre].filter(Boolean).join(' ') || 'Equipo de la orden';
  const serial = String(os.equipo_serial || '').trim();
  if (!serial) {
    return { clave: `os-${os.id}`, nombre_producto: nombre, orden_servicio: orden,
      bloqueo: 'La orden no tiene el IMEI del equipo: escríbelo en la orden para saber de qué venta o compra salió' };
  }
  const { rows: s } = await executor.query(`
    SELECT s.id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
    WHERE UPPER(BTRIM(s.imei)) = UPPER(BTRIM($1)) AND ps.sucursal_id = $2
    ORDER BY s.vendido DESC, s.id DESC LIMIT 1
  `, [serial, os.sucursal_id]);
  if (!s[0]) {
    return { clave: `os-${os.id}`, nombre_producto: nombre, imei: serial, orden_servicio: orden,
      bloqueo: 'Ese equipo no salió de tu inventario (no está en tus ventas ni en tus compras): no hay proveedor a quien reclamarle' };
  }
  const c = await _candidatoSerial(executor, negocioId, os.sucursal_id, s[0].id, { factura: os.factura_id || null });
  if (!c) return null;
  // El cliente de la orden manda si la venta no lo trae (o es otro mostrador).
  return {
    ...c, clave: `os-${os.id}`, orden_servicio: orden,
    cliente: c.cliente || { nombre: os.cliente_nombre, cedula: os.cliente_cedula, telefono: os.cliente_telefono },
  };
};

// Completa un candidato con su procedencia y lo que lo bloquea hoy.
const _completar = async (executor, negocioId, c) => {
  if (!c || !c.tipo) return c;
  if (c.tipo === 'serial') {
    const enGarantia = await _garantiaAbiertaDe(executor, c.serial_id);
    if (enGarantia) c.bloqueo = `Ya está en la garantía #${enGarantia}`;
    const tec = await buscarEnTecnico(executor, c.serial_id);
    if (!c.bloqueo && tec) c.bloqueo = `Está donde el técnico ${tec.tecnico_nombre} (salida #${tec.salida_numero})`;
    const env = await _enTransito(executor, c.serial_id);
    if (!c.bloqueo && env) c.bloqueo = `Va en camino en el envío #${env}`;
    c.procedencia = await _procedenciaSerial(executor, negocioId, c.imei, c.serial_id);
  } else {
    c.procedencia = await _procedenciaCantidad(executor, negocioId, c);
  }
  return c;
};

/** El tope de un vendedor sin costos: el costo no viaja. */
const _recortarCosto = (obj, veCostos) => {
  if (veCostos || !obj) return obj;
  if (Array.isArray(obj)) return obj.map((o) => _recortarCosto(o, veCostos));
  const copia = { ...obj };
  if ('costo_unitario' in copia) copia.costo_unitario = null;
  if (Array.isArray(copia.lineas)) copia.lineas = copia.lineas.map((l) => ({ ...l, costo_unitario: null }));
  return copia;
};

/**
 * Busca las unidades que se pueden mandar a garantía.
 *   · por documento (desde una pantalla): linea_factura_id | prestamo_id |
 *     serial_id | producto_id (+ atributo_id, variante_id);
 *   · por texto (la pestaña): IMEI, número de factura o préstamo, nombre o
 *     código del producto.
 */
const buscarCandidatos = async (user, sucursalId, params = {}) => {
  const negocioId = user.negocio_id;
  const sede = _sedeLectura(user, sucursalId);
  const sedeFiltro = sede && sede > 0 ? sede : null;
  if (user.rol !== 'admin_negocio' && !sedeFiltro) return [];
  const crudos = [];

  if (_entero(params.linea_factura_id)) {
    crudos.push(await _candidatoLineaFactura(pool, negocioId, sedeFiltro, Number(params.linea_factura_id)));
  } else if (_entero(params.prestamo_id)) {
    crudos.push(await _candidatoPrestamo(pool, negocioId, sedeFiltro, Number(params.prestamo_id)));
  } else if (_entero(params.serial_id)) {
    crudos.push(await _candidatoSerial(pool, negocioId, sedeFiltro, Number(params.serial_id)));
  } else if (_entero(params.producto_id)) {
    if (!sedeFiltro) throw { status: 400, code: 'SUCURSAL_REQUERIDA', message: 'Elige la sucursal' };
    const pedido = {
      producto_id: Number(params.producto_id),
      atributo_id: _entero(params.atributo_id), variante_id: _entero(params.variante_id),
    };
    try {
      crudos.push(await _candidatoNodo(pool, sedeFiltro, pedido));
    } catch (err) {
      // Desde la tarjeta de un producto con tallas: se ofrecen sus hojas para
      // elegir cuál es la unidad dañada, en vez de un error.
      if (err?.code !== 'VARIANTE_REQUERIDA') throw err;
      for (const h of await _hojasDeProducto(pool, sedeFiltro, pedido)) {
        try { crudos.push(await _candidatoNodo(pool, sedeFiltro, h)); } catch { /* nodo raro: se omite */ }
      }
    }
  } else if (_entero(params.orden_servicio_id)) {
    // Desde una orden de Servicios: el equipo del cliente resultó ser para el
    // proveedor. Se busca por su serial; sin él (o si no es nuestro) no hay
    // unidad que reclamar.
    const c = await _candidatoOrdenServicio(pool, negocioId, sedeFiltro, Number(params.orden_servicio_id));
    if (c) crudos.push(c);
  } else if (String(params.imei || '').trim().length >= 4) {
    const { rows } = await pool.query(`
      SELECT s.id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
      JOIN sucursales su ON su.id = ps.sucursal_id
      WHERE UPPER(BTRIM(s.imei)) = UPPER(BTRIM($1)) AND su.negocio_id = $2
        AND ($3::int IS NULL OR ps.sucursal_id = $3)
      ORDER BY s.vendido DESC, s.id DESC LIMIT 3`, [String(params.imei).trim(), negocioId, sedeFiltro]);
    for (const r of rows) crudos.push(await _candidatoSerial(pool, negocioId, sedeFiltro, r.id));
  } else if (_entero(params.factura_id)) {
    const { rows } = await pool.query(`
      SELECT l.id FROM lineas_factura l JOIN facturas f ON f.id = l.factura_id
      JOIN sucursales su ON su.id = f.sucursal_id
      WHERE f.id = $1 AND su.negocio_id = $2 AND ($3::int IS NULL OR f.sucursal_id = $3) ORDER BY l.id`,
    [Number(params.factura_id), negocioId, sedeFiltro]);
    for (const r of rows) crudos.push(await _candidatoLineaFactura(pool, negocioId, sedeFiltro, r.id));
  } else {
    const q = String(params.q || '').trim();
    if (q.length < 2) return [];
    if (!sedeFiltro) throw { status: 400, code: 'SUCURSAL_REQUERIDA', message: 'Elige la sucursal para buscar' };
    // IMEI (desde 4 caracteres: con menos sería media bodega).
    if (q.replace(/\s/g, '').length >= 4) {
      const { rows } = await pool.query(`
        SELECT s.id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
        WHERE ps.sucursal_id = $1 AND UPPER(BTRIM(s.imei)) LIKE '%' || UPPER(BTRIM($2))
        ORDER BY (UPPER(BTRIM(s.imei)) = UPPER(BTRIM($2))) DESC, s.vendido DESC, s.id DESC
        LIMIT 12`, [sedeFiltro, q]);
      for (const r of rows) crudos.push(await _candidatoSerial(pool, negocioId, sedeFiltro, r.id));
    }
    // Número de factura o de préstamo.
    if (/^\d{1,8}$/.test(q)) {
      const { rows: fs } = await pool.query(`
        SELECT l.id FROM lineas_factura l JOIN facturas f ON f.id = l.factura_id
        WHERE f.sucursal_id = $1 AND COALESCE(f.numero, f.id) = $2::int AND f.estado <> 'Cancelada'
        ORDER BY l.id LIMIT 20`, [sedeFiltro, q]);
      for (const r of fs) crudos.push(await _candidatoLineaFactura(pool, negocioId, sedeFiltro, r.id));
      const { rows: ps } = await pool.query(`
        SELECT id FROM prestamos WHERE sucursal_id = $1 AND COALESCE(numero, id) = $2::int AND estado = 'Activo'
        LIMIT 5`, [sedeFiltro, q]);
      for (const r of ps) crudos.push(await _candidatoPrestamo(pool, negocioId, sedeFiltro, r.id));
    }
    // Producto por cantidad del inventario (las hojas), por nombre o código.
    const termino = normalizarTexto(q);
    if (termino.length >= 2) {
      const { rows } = await pool.query(`
        WITH cfg AS (
          SELECT COALESCE((SELECT c.valor FROM config_negocio c JOIN sucursales s ON s.negocio_id = c.negocio_id
                           WHERE s.id = $1 AND c.clave = 'variantes_activo' LIMIT 1), '0') = '1' AS arbol
        ), prod AS (
          SELECT p.* FROM productos_cantidad p
          WHERE p.sucursal_id = $1 AND p.activo = true
            AND (${sqlSinTildes('p.nombre')} LIKE '%' || $2 || '%' OR UPPER(COALESCE(p.codigo, '')) = UPPER($3)
                 OR EXISTS (SELECT 1 FROM atributos_producto a WHERE a.producto_id = p.id AND a.activo
                              AND UPPER(COALESCE(a.codigo, '')) = UPPER($3))
                 OR EXISTS (SELECT 1 FROM variantes_atributo v JOIN atributos_producto a ON a.id = v.atributo_id
                              WHERE a.producto_id = p.id AND v.activo AND UPPER(COALESCE(v.codigo, '')) = UPPER($3)))
          LIMIT 15
        )
        SELECT p.id AS producto_id, NULL::int AS atributo_id, NULL::int AS variante_id
        FROM prod p, cfg
        WHERE NOT cfg.arbol OR NOT EXISTS (SELECT 1 FROM atributos_producto a WHERE a.producto_id = p.id AND a.activo)
        UNION ALL
        SELECT p.id, a.id, NULL FROM prod p JOIN atributos_producto a ON a.producto_id = p.id AND a.activo, cfg
        WHERE cfg.arbol AND NOT EXISTS (SELECT 1 FROM variantes_atributo v WHERE v.atributo_id = a.id AND v.activo)
        UNION ALL
        SELECT p.id, a.id, v.id FROM prod p
        JOIN atributos_producto a ON a.producto_id = p.id AND a.activo
        JOIN variantes_atributo v ON v.atributo_id = a.id AND v.activo, cfg
        WHERE cfg.arbol
        LIMIT 30`, [sedeFiltro, patronLike(termino), q]);
      for (const r of rows) {
        try { crudos.push(await _candidatoNodo(pool, sedeFiltro, r)); } catch { /* nodo raro: se omite */ }
      }
    }
  }

  const vistos = new Set();
  const lista = [];
  for (const c of crudos) {
    if (!c || vistos.has(c.clave)) continue;
    vistos.add(c.clave);
    lista.push(await _completar(pool, negocioId, c));
  }
  return _recortarCosto(lista, await puedeVerCostos(user));
};

// ═════════════════════════════════════════════════════════════════════════════
// CREAR EL CASO
// ═════════════════════════════════════════════════════════════════════════════

const _resolverOrigenEnTx = async (client, negocioId, sede, origen) => {
  const o = origen || {};
  let c = null;
  if (o.tipo === 'factura' && _entero(o.linea_factura_id)) {
    c = await _candidatoLineaFactura(client, negocioId, sede, Number(o.linea_factura_id));
  } else if (o.tipo === 'prestamo' && _entero(o.prestamo_id)) {
    c = await _candidatoPrestamo(client, negocioId, sede, Number(o.prestamo_id));
  } else if (o.tipo === 'inventario' && _entero(o.serial_id)) {
    c = await _candidatoSerial(client, negocioId, sede, Number(o.serial_id));
  } else if (o.tipo === 'inventario' && _entero(o.producto_id)) {
    c = await _candidatoNodo(client, sede, {
      producto_id: Number(o.producto_id), atributo_id: _entero(o.atributo_id), variante_id: _entero(o.variante_id),
    });
  } else {
    throw { status: 400, message: 'Indica de dónde sale el producto (factura, préstamo o inventario)' };
  }
  if (!c) throw { status: 404, message: 'No se encontró ese producto en esta sucursal' };
  c = await _completar(client, negocioId, c);
  if (c.bloqueo) throw { status: 409, code: 'NO_DISPONIBLE_GARANTIA', message: c.bloqueo };
  if (o.tipo !== c.origen_tipo) {
    throw { status: 409, message: 'El producto cambió de estado mientras lo revisabas. Vuelve a buscarlo.' };
  }
  return c;
};

const _clave = (o) => `${o?.tipo}:${o?.linea_factura_id || o?.prestamo_id || o?.serial_id
  || `${o?.producto_id}-${o?.atributo_id || 0}-${o?.variante_id || 0}`}`;

/**
 * Pone la unidad en garantía: vuelve al inventario (si venía de un cliente) y
 * sale de lo vendible. Devuelve lo que pisó, para poder deshacerlo.
 */
const _apartar = async (client, c, cantidad) => {
  if (c.tipo === 'serial') {
    if (c.origen_tipo === 'factura') {
      const { rows } = await client.query(
        'SELECT vendido, fecha_salida FROM seriales WHERE id = $1 FOR UPDATE', [c.serial_id]);
      await client.query('UPDATE seriales SET vendido = false, fecha_salida = NULL WHERE id = $1', [c.serial_id]);
      return { vendido: true, fecha_salida: rows[0]?.fecha_salida ?? null };
    }
    if (c.origen_tipo === 'prestamo') {
      await client.query('UPDATE seriales SET prestado = false WHERE id = $1', [c.serial_id]);
      return { prestado: true };
    }
    return {};
  }
  if (c.origen_tipo === 'inventario') {
    const nodo = await _leerNodo(client, c, c.sucursal_id, { bloquear: true });
    if (nodo.stock < cantidad) {
      throw { status: 409, message: `Solo hay ${nodo.stock} unidad(es) de ${nodo.nombre} en el inventario` };
    }
    await _moverStock(client, nodo, c.sucursal_id, -cantidad, { tipo: 'garantia', nota: 'Sale a garantía con el proveedor' });
    return { stock_descontado: cantidad };
  }
  // Por cantidad desde una venta o un préstamo: vuelve (+n) y sale (−n). Nada.
  return {};
};

const crear = async (user, sucursalId, body = {}) => {
  const negocioId = user.negocio_id;
  const sede = _sedeEscritura(user, sucursalId);
  const falla = _texto(body.falla, 500);
  if (!falla) throw { status: 400, message: 'Escribe qué falla tiene el producto' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bloquearOperacion(client, `garantia:origen:${negocioId}:${_clave(body.origen)}`);

    const c = await _resolverOrigenEnTx(client, negocioId, sede, body.origen);
    const cantidad = c.tipo === 'serial' ? 1 : _entero(body.cantidad) || 1;
    if (cantidad > c.cantidad_max) {
      throw { status: 400, message: `Puedes mandar a garantía hasta ${c.cantidad_max} unidad(es) de ${c.nombre_producto}` };
    }

    // El mismo caso enviado dos veces (doble clic que pasó el candado).
    const { rows: gemelo } = await client.query(`
      SELECT 1 FROM reclamos_garantia_lineas l JOIN reclamos_garantia r ON r.id = l.reclamo_id
      WHERE r.negocio_id = $1 AND r.usuario_id IS NOT DISTINCT FROM $2 AND NOT r.anulado
        AND r.fecha > NOW() - ($3 || ' seconds')::interval
        AND l.producto_id = $4 AND l.cantidad = $5
        AND COALESCE(l.serial_id, 0) = COALESCE($6::int, 0)
        AND COALESCE(l.linea_factura_id, 0) = COALESCE($7::int, 0)
        AND r.origen_tipo = $8
      LIMIT 1
    `, [negocioId, user.id, String(VENTANA_DUPLICADO_SEG), c.producto_id, cantidad,
      c.serial_id || null, c.linea_factura_id || null, c.origen_tipo]);
    if (gemelo.length && c.tipo === 'cantidad') throw errorDuplicado('caso de garantía');

    // ¿Viene de una orden de Servicios? Se valida que sea de esta sede y del
    // mismo equipo; la fase 2 guarda la liga (sin la migración, se ignora).
    let ordenServicioId = null;
    if (_entero(body.origen?.orden_servicio_id) && hayReclamosFase2()) {
      const oc = await _candidatoOrdenServicio(client, negocioId, sede, Number(body.origen.orden_servicio_id));
      if (!oc || (oc.serial_id && Number(oc.serial_id) !== Number(c.serial_id))) {
        throw { status: 409, message: 'La orden de servicio no corresponde a este equipo' };
      }
      ordenServicioId = oc.orden_servicio.id;
    }

    let proveedorId = _entero(body.proveedor_id);
    if (proveedorId) {
      const { rows } = await client.query(
        'SELECT id FROM proveedores WHERE id = $1 AND negocio_id = $2', [proveedorId, negocioId]);
      if (!rows.length) throw { status: 400, message: 'El proveedor no es de este negocio' };
    }
    const cli = body.cliente || {};
    const accesorios = Array.isArray(body.accesorios)
      ? body.accesorios.map((a) => _texto(a, 60)).filter(Boolean).slice(0, 20) : null;

    const { rows: [rec] } = await client.query(`
      INSERT INTO reclamos_garantia
        (negocio_id, sucursal_id, proveedor_id, origen_tipo, factura_id, prestamo_id,
         cliente_nombre, cliente_cedula, cliente_telefono, falla, estado_fisico, accesorios, notas, usuario_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
      RETURNING *
    `, [negocioId, c.sucursal_id, proveedorId, c.origen_tipo, c.factura?.id || null, c.prestamo?.id || null,
      _texto(cli.nombre, 150) ?? c.cliente?.nombre ?? null,
      _texto(cli.cedula, 40) ?? c.cliente?.cedula ?? null,
      _texto(cli.telefono, 40) ?? c.cliente?.telefono ?? null,
      falla, _texto(body.estado_fisico, 300), accesorios ? JSON.stringify(accesorios) : null,
      _texto(body.notas, 500), user.id]);
    rec.numero = await asignarNumeroDocumento(client, { tipo: 'reclamo_garantia', docId: rec.id, negocioId });
    if (ordenServicioId) {
      await client.query('UPDATE reclamos_garantia SET orden_servicio_id = $2 WHERE id = $1', [rec.id, ordenServicioId]);
      rec.orden_servicio_id = ordenServicioId;
    }

    const estadoAnterior = await _apartar(client, c, cantidad);
    const proc = c.procedencia?.via === 'compra' || c.procedencia?.via === 'reposicion' ? c.procedencia : null;
    const { rows: [linea] } = await client.query(`
      INSERT INTO reclamos_garantia_lineas
        (reclamo_id, negocio_id, sucursal_id, tipo, serial_id, imei, producto_id, atributo_id, variante_id,
         nombre_producto, variante_texto, cantidad, costo_unitario, precio_venta, linea_factura_id,
         compra_id, linea_compra_id, garantia_proveedor_hasta, estado_anterior)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::date,$19::jsonb)
      RETURNING *
    `, [rec.id, negocioId, c.sucursal_id, c.tipo, c.serial_id || null, c.imei || null, c.producto_id,
      c.atributo_id || null, c.variante_id || null, c.nombre_producto, c.variante_texto || null, cantidad,
      c.costo_unitario, c.precio_venta, c.linea_factura_id || null,
      proc?.compra_id || null, proc?.linea_compra_id || null, proc?.garantia_hasta || null,
      JSON.stringify(estadoAnterior)]);

    let movimientoCliente = null;
    const rc = body.resolucion_cliente;
    if (rc && (rc.tipo === 'cambio' || rc.tipo === 'reembolso')) {
      movimientoCliente = await _resolverClienteEnTx(client, user, rec, linea, { ...rc, cantidad: rc.cantidad || cantidad });
    }

    await client.query('COMMIT');
    return { reclamo: rec, linea, movimiento_cliente: movimientoCliente };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CON EL CLIENTE
// ═════════════════════════════════════════════════════════════════════════════

const _lineaParaEscribir = async (client, user, lineaId) => {
  const { rows } = await client.query(`
    SELECT l.*, r.negocio_id AS r_negocio, r.anulado AS r_anulado, r.origen_tipo, r.factura_id,
           r.prestamo_id, r.proveedor_id, r.cliente_nombre, COALESCE(r.numero, r.id) AS reclamo_numero
    FROM reclamos_garantia_lineas l JOIN reclamos_garantia r ON r.id = l.reclamo_id
    WHERE l.id = $1 FOR UPDATE OF l
  `, [lineaId]);
  const l = rows[0];
  if (!l || Number(l.r_negocio) !== Number(user.negocio_id)) throw { status: 404, message: 'Garantía no encontrada' };
  _exigirSede(user, l.sucursal_id);
  if (l.r_anulado) throw { status: 409, message: 'Esta garantía está anulada' };
  return l;
};

const _insertarMovimiento = async (client, l, user, m) => {
  const { rows: [mov] } = await client.query(`
    INSERT INTO reclamos_garantia_movimientos
      (linea_id, reclamo_id, negocio_id, sucursal_id, lado, tipo, destino, cantidad, valor, metodo,
       serial_id, imei, producto_id, atributo_id, variante_id, nombre_producto, garantia_hasta,
       movimiento_acreedor_id, rastro, notas, usuario_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::date,$18,$19::jsonb,$20,$21)
    RETURNING *
  `, [l.id, l.reclamo_id, l.negocio_id, l.sucursal_id, m.lado, m.tipo, m.destino || null, m.cantidad,
    m.valor || 0, m.metodo || null, m.serial_id || null, m.imei || null, m.producto_id || null,
    m.atributo_id || null, m.variante_id || null, m.nombre_producto || null, m.garantia_hasta || null,
    m.movimiento_acreedor_id || null, m.rastro ? JSON.stringify(m.rastro) : null, _texto(m.notas, 500), user.id]);
  // Un DATE llega como objeto Date (y en JSON con hora UTC): se devuelve tal
  // como se escribió, 'YYYY-MM-DD', igual que lo lee el detalle con to_char.
  mov.garantia_hasta = m.garantia_hasta || null;
  return mov;
};

const _movimientoDeCaja = async (client, { sucursalId, usuarioId, tipo, concepto, valor, metodo, refTipo, refId }) => {
  const cajaRepo = require('../caja/caja.repository');
  const caja = await cajaRepo.findCajaAbierta(sucursalId);
  if (!caja) {
    throw { status: 409, code: 'CAJA_CERRADA', message: 'Abre la caja de la sucursal: el dinero tiene que quedar registrado en ella' };
  }
  const { rows } = await client.query(`
    INSERT INTO movimientos_caja (caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo, metodo)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
  `, [caja.id, usuarioId, tipo, concepto, valor, refId, refTipo, metodo || METODOS_DEFECTO]);
  return rows[0].id;
};

/**
 * La respuesta al cliente, dentro de la transacción de quien llame.
 *   · cambio:    se le entrega otra unidad, que sale del stock vendible.
 *   · reembolso: se deshace la venta de esa línea (solo facturas).
 */
const _resolverClienteEnTx = async (client, user, rec, l, body = {}) => {
  const origen = rec.origen_tipo;
  if (origen === 'inventario') {
    throw { status: 400, message: 'Esta unidad estaba en tu inventario: no hay un cliente a quien responderle' };
  }
  const pendiente = _num(l.cantidad) - _num(l.cantidad_cliente);
  const cantidad = l.tipo === 'serial' ? 1 : (_entero(body.cantidad) || pendiente);
  if (pendiente <= 0) throw { status: 409, message: 'Con el cliente ya se resolvió todo en esta garantía' };
  if (cantidad > pendiente) throw { status: 400, message: `Al cliente le faltan ${pendiente} unidad(es) por resolver` };
  const numero = rec.numero ?? rec.reclamo_numero ?? rec.id;
  const cliente = rec.cliente_nombre || 'el cliente';

  let mov;
  if (body.tipo === 'cambio') {
    const u = body.unidad || {};
    if (l.tipo === 'serial') {
      const serialId = _entero(u.serial_id);
      if (!serialId) throw { status: 400, message: 'Escanea o elige el equipo que le entregas al cliente' };
      if (Number(serialId) === Number(l.serial_id)) throw { status: 400, message: 'Es el mismo equipo que está en garantía' };
      const { rows } = await client.query(`
        SELECT s.id, s.imei, s.vendido, s.prestado, s.producto_id, ps.nombre, ps.sucursal_id
        FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
        WHERE s.id = $1 FOR UPDATE OF s
      `, [serialId]);
      const s = rows[0];
      if (!s || Number(s.sucursal_id) !== Number(l.sucursal_id)) throw { status: 404, message: 'Ese equipo no está en esta sucursal' };
      if (s.vendido || s.prestado) throw { status: 409, message: `El equipo ${s.imei} no está disponible (${s.vendido ? 'vendido' : 'prestado'})` };
      let rastro = null;
      if (origen === 'factura') {
        await client.query('UPDATE seriales SET vendido = true, fecha_salida = CURRENT_DATE WHERE id = $1', [s.id]);
      } else {
        const { rows: p } = await client.query(
          `SELECT id, imei, producto_id, nombre_producto, estado FROM prestamos WHERE id = $1 FOR UPDATE`, [rec.prestamo_id]);
        if (!p[0] || p[0].estado !== 'Activo') throw { status: 409, message: 'El préstamo ya no está activo' };
        await client.query('UPDATE seriales SET prestado = true WHERE id = $1', [s.id]);
        await client.query(`
          UPDATE prestamos SET imei = $2, nombre_producto = $3,
                 producto_id = CASE WHEN producto_id IS NULL THEN NULL ELSE $4::int END
          WHERE id = $1`, [p[0].id, s.imei, s.nombre, s.producto_id]);
        rastro = { prestamo: { id: p[0].id, imei: p[0].imei, producto_id: p[0].producto_id, nombre_producto: p[0].nombre_producto } };
      }
      mov = await _insertarMovimiento(client, l, user, {
        lado: 'cliente', tipo: 'cambio', cantidad: 1, serial_id: s.id, imei: s.imei,
        producto_id: s.producto_id, nombre_producto: s.nombre, rastro, notas: body.notas,
      });
    } else {
      const pedido = _entero(u.producto_id)
        ? { producto_id: Number(u.producto_id), atributo_id: _entero(u.atributo_id), variante_id: _entero(u.variante_id) }
        : { producto_id: l.producto_id, atributo_id: l.atributo_id, variante_id: l.variante_id };
      if (origen === 'prestamo' && !_mismoNodo(pedido, l)) {
        throw { status: 400, message: 'En un préstamo se entrega el mismo producto (y la misma variante) que se prestó' };
      }
      const nodo = await _leerNodo(client, pedido, l.sucursal_id, { bloquear: true });
      if (nodo.stock < cantidad) throw { status: 409, message: `Solo hay ${nodo.stock} unidad(es) de ${nodo.nombre} para entregar` };
      await _moverStock(client, nodo, l.sucursal_id, -cantidad, { tipo: 'garantia_cambio', nota: `Garantía #${numero}: entregado a ${cliente}` });
      mov = await _insertarMovimiento(client, l, user, {
        lado: 'cliente', tipo: 'cambio', cantidad, producto_id: nodo.producto_id, atributo_id: nodo.atributo_id,
        variante_id: nodo.variante_id, nombre_producto: [nodo.nombre, nodo.variante_texto].filter(Boolean).join(' · '),
        notas: body.notas,
      });
    }
  } else if (body.tipo === 'reembolso') {
    if (origen !== 'factura' || !l.linea_factura_id) {
      throw { status: 400, message: 'La devolución de dinero es para ventas. En un préstamo activo usa «Devolver» en el préstamo.' };
    }
    const { rows: f } = await client.query(`
      SELECT f.id, f.numero, f.estado, f.sucursal_id, f.nombre_cliente,
             l.precio, l.cantidad, COALESCE(l.cantidad_devuelta, 0) AS devuelta
      FROM facturas f JOIN lineas_factura l ON l.factura_id = f.id
      WHERE f.id = $1 AND l.id = $2 FOR UPDATE OF f
    `, [rec.factura_id, l.linea_factura_id]);
    const fac = f[0];
    if (!fac) throw { status: 404, message: 'No se encontró la factura' };
    if (fac.estado === 'Cancelada') throw { status: 409, message: 'La factura está cancelada' };
    const neta = _num(fac.cantidad) - _num(fac.devuelta);
    if (neta < cantidad) throw { status: 409, message: `En la factura solo quedan ${neta} unidad(es) sin devolver` };
    const tope = Number(fac.precio) * cantidad;
    let valor = tope;
    let rastro = null;
    if (fac.estado === 'Credito') {
      const { devolverLineasCreditoEnTx } = require('../facturas/facturas.service');
      const res = await devolverLineasCreditoEnTx(client, fac,
        [{ linea_id: Number(l.linea_factura_id), cantidad_devolver: cantidad }], { restaurarStock: false });
      rastro = { credito: true, resultado: res };
    } else {
      if (body.valor != null && body.valor !== '') {
        valor = Number(body.valor);
        if (!Number.isFinite(valor) || valor < 0 || valor > tope + 0.001) {
          throw { status: 400, message: `El valor a devolver va de $0 a lo que se cobró por la línea (${tope})` };
        }
      }
      const { rowCount } = await client.query(`
        UPDATE lineas_factura SET cantidad_devuelta = COALESCE(cantidad_devuelta, 0) + $2
        WHERE id = $1 AND cantidad - COALESCE(cantidad_devuelta, 0) >= $2`, [l.linea_factura_id, cantidad]);
      if (!rowCount) throw { status: 409, message: 'La línea de la factura cambió: vuelve a intentarlo' };
      rastro = { credito: false };
    }
    mov = await _insertarMovimiento(client, l, user, {
      lado: 'cliente', tipo: 'reembolso', cantidad, valor, metodo: fac.estado === 'Credito' ? 'Crédito' : (body.metodo || METODOS_DEFECTO),
      rastro, notas: body.notas,
    });
    if (fac.estado !== 'Credito' && valor > 0) {
      const cajaId = await _movimientoDeCaja(client, {
        sucursalId: l.sucursal_id, usuarioId: user.id, tipo: 'Egreso', valor, metodo: body.metodo || METODOS_DEFECTO,
        concepto: `Garantía #${numero} — devolución a ${cliente} (factura #${String(fac.numero ?? fac.id).padStart(6, '0')})`,
        refTipo: 'garantia_cliente', refId: mov.id,
      });
      await client.query('UPDATE reclamos_garantia_movimientos SET movimiento_caja_id = $2 WHERE id = $1', [mov.id, cajaId]);
      mov.movimiento_caja_id = cajaId;
    }
  } else {
    throw { status: 400, message: 'Elige qué se hizo con el cliente: entregarle otra unidad o devolverle el dinero' };
  }

  await client.query(
    'UPDATE reclamos_garantia_lineas SET cantidad_cliente = cantidad_cliente + $2 WHERE id = $1', [l.id, cantidad]);
  return mov;
};

const resolverCliente = async (user, lineaId, body = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bloquearOperacion(client, `garantia:linea:${Number(lineaId)}`);
    const l = await _lineaParaEscribir(client, user, Number(lineaId));
    const rec = { id: l.reclamo_id, numero: l.reclamo_numero, origen_tipo: l.origen_tipo,
      factura_id: l.factura_id, prestamo_id: l.prestamo_id, cliente_nombre: l.cliente_nombre };
    const mov = await _resolverClienteEnTx(client, user, rec, l, body);
    await client.query('COMMIT');
    return mov;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ENVÍOS AL PROVEEDOR
// ═════════════════════════════════════════════════════════════════════════════

const crearEnvio = async (user, sucursalId, body = {}) => {
  const negocioId = user.negocio_id;
  const sede = _sedeEscritura(user, sucursalId);
  const proveedorId = _entero(body.proveedor_id);
  if (!proveedorId) throw { status: 400, message: 'Elige a qué proveedor le envías' };
  const ids = [...new Set((body.linea_ids || []).map(_entero).filter(Boolean))];
  if (!ids.length) throw { status: 400, message: 'Elige al menos un producto para enviar' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bloquearOperacion(client, `garantia:envio:${negocioId}:${sede}`);
    const { rows: prov } = await client.query(
      'SELECT id, nombre FROM proveedores WHERE id = $1 AND negocio_id = $2', [proveedorId, negocioId]);
    if (!prov.length) throw { status: 400, message: 'El proveedor no es de este negocio' };

    const { rows: lineas } = await client.query(`
      SELECT l.id, l.reclamo_id, r.proveedor_id, l.nombre_producto
      FROM reclamos_garantia_lineas l JOIN reclamos_garantia r ON r.id = l.reclamo_id
      WHERE l.id = ANY($1::int[]) AND r.negocio_id = $2 AND l.sucursal_id = $3
        AND NOT r.anulado AND NOT l.cerrada AND l.envio_id IS NULL
      FOR UPDATE OF l
    `, [ids, negocioId, sede]);
    if (lineas.length !== ids.length) {
      throw { status: 409, message: 'Algún producto ya se envió, se anuló o es de otra sucursal. Actualiza la lista.' };
    }
    const ajeno = lineas.find((l) => l.proveedor_id && Number(l.proveedor_id) !== proveedorId);
    if (ajeno) throw { status: 409, message: `${ajeno.nombre_producto} es de otro proveedor` };

    const { rows: [envio] } = await client.query(`
      INSERT INTO envios_garantia (negocio_id, sucursal_id, proveedor_id, transportadora, guia, notas, usuario_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [negocioId, sede, proveedorId, _texto(body.transportadora, 120), _texto(body.guia, 120), _texto(body.notas, 500), user.id]);
    envio.numero = await asignarNumeroDocumento(client, { tipo: 'envio_garantia', docId: envio.id, negocioId });

    await client.query('UPDATE reclamos_garantia_lineas SET envio_id = $2 WHERE id = ANY($1::int[])', [ids, envio.id]);
    // Un caso que aún no tenía proveedor queda con el de este envío.
    await client.query(`
      UPDATE reclamos_garantia SET proveedor_id = $2
      WHERE id = ANY($1::int[]) AND proveedor_id IS NULL`, [[...new Set(lineas.map((l) => l.reclamo_id))], proveedorId]);

    await client.query('COMMIT');
    return { ...envio, proveedor_nombre: prov[0].nombre, lineas: ids.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const anularEnvio = async (user, envioId, motivo) => {
  const texto = _texto(motivo, 300);
  if (!texto || texto.length < 3) throw { status: 400, message: 'Escribe por qué anulas el envío' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bloquearOperacion(client, `garantia:envio-id:${Number(envioId)}`);
    const { rows } = await client.query(
      'SELECT * FROM envios_garantia WHERE id = $1 AND negocio_id = $2 FOR UPDATE', [envioId, user.negocio_id]);
    const e = rows[0];
    if (!e) throw { status: 404, message: 'Envío no encontrado' };
    _exigirSede(user, e.sucursal_id);
    if (e.anulado) throw { status: 409, message: 'El envío ya está anulado' };
    const { rows: resp } = await client.query(`
      SELECT 1 FROM reclamos_garantia_movimientos m JOIN reclamos_garantia_lineas l ON l.id = m.linea_id
      WHERE l.envio_id = $1 AND m.lado = 'proveedor' AND NOT m.anulado LIMIT 1`, [e.id]);
    if (resp.length) {
      throw { status: 409, message: 'El proveedor ya respondió por algo de este envío: anula primero esas respuestas' };
    }
    await client.query(`
      UPDATE envios_garantia SET anulado = true, anulado_motivo = $2, anulado_por = $3, anulado_en = NOW()
      WHERE id = $1`, [e.id, texto, user.id]);
    await client.query('UPDATE reclamos_garantia_lineas SET envio_id = NULL WHERE envio_id = $1', [e.id]);
    await client.query('COMMIT');
    return { ...e, anulado: true, anulado_motivo: texto };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// RESPUESTA DEL PROVEEDOR
// ═════════════════════════════════════════════════════════════════════════════

const TIPOS_PROVEEDOR = ['reposicion', 'reparacion', 'nota_credito', 'reembolso_proveedor', 'rechazo'];
// Lo que deja la unidad dañada fuera de nuestro inventario para siempre.
const SALE_LA_UNIDAD = new Set(['reposicion', 'nota_credito', 'reembolso_proveedor', 'baja']);

const _garantiaNueva = async (client, l, g = {}) => {
  const modo = g.modo || 'original';
  if (modo === 'ninguna') return null;
  if (modo === 'dias') {
    const dias = Number(g.dias);
    if (!Number.isInteger(dias) || dias < 0 || dias > 3650) throw { status: 400, message: 'Los días de garantía van de 0 a 3650' };
    const { rows } = await client.query(`SELECT to_char(CURRENT_DATE + $1::int, 'YYYY-MM-DD') AS f`, [dias]);
    return rows[0].f;
  }
  return l.garantia_proveedor_hasta
    ? String(l.garantia_proveedor_hasta instanceof Date
      ? l.garantia_proveedor_hasta.toISOString().slice(0, 10) : l.garantia_proveedor_hasta).slice(0, 10)
    : null;
};

const _acreedorDelProveedor = async (client, negocioId, proveedorId) => {
  const { rows } = await client.query(
    'SELECT id FROM acreedores WHERE negocio_id = $1 AND proveedor_id = $2 ORDER BY id LIMIT 1', [negocioId, proveedorId]);
  if (rows[0]) return rows[0].id;
  const { rows: p } = await client.query('SELECT nombre, nit, telefono FROM proveedores WHERE id = $1', [proveedorId]);
  const { rows: nuevo } = await client.query(`
    INSERT INTO acreedores (negocio_id, nombre, cedula, telefono, proveedor_id)
    VALUES ($1,$2,$3,$4,$5) RETURNING id
  `, [negocioId, p[0]?.nombre, p[0]?.nit || `prov-${proveedorId}`, p[0]?.telefono || '', proveedorId]);
  return nuevo[0].id;
};

/**
 * La nota crédito va a la cuenta del proveedor como un ABONO (no toca caja):
 * contra el cargo de la compra de la que vino la unidad mientras tenga saldo,
 * y lo que sobre queda a favor del negocio — la misma lectura de la devolución
 * de mercancía de siempre.
 */
const _notaCredito = async (client, { negocioId, l, proveedorId, valor, numero, usuarioId }) => {
  const desc = `Garantía #${numero} — nota crédito por ${l.nombre_producto}${l.imei ? ` (${l.imei})` : ''}`;
  let cargo = null;
  if (l.compra_id) {
    const { rows } = await client.query(`
      SELECT ma.id, ma.acreedor_id, ma.valor FROM movimientos_acreedor ma
      JOIN acreedores a ON a.id = ma.acreedor_id
      WHERE ma.compra_id = $1 AND ma.tipo = 'Cargo' AND a.negocio_id = $2 LIMIT 1`, [l.compra_id, negocioId]);
    cargo = rows[0] || null;
  }
  const ids = [];
  let restante = valor;
  if (cargo) {
    const { rows: ab } = await client.query(
      `SELECT COALESCE(SUM(valor), 0) AS ab FROM movimientos_acreedor WHERE cargo_id = $1 AND tipo = 'Abono'`, [cargo.id]);
    const saldo = Math.max(0, _num(cargo.valor) - _num(ab[0].ab));
    const alCargo = Math.min(restante, saldo);
    if (alCargo > 0) {
      const { rows } = await client.query(`
        INSERT INTO movimientos_acreedor (acreedor_id, usuario_id, tipo, valor, descripcion, compra_id, cargo_id, metodo, registrar_en_caja, sucursal_id)
        VALUES ($1,$2,'Abono',$3,$4,$5,$6,'Garantía',false,$7) RETURNING id
      `, [cargo.acreedor_id, usuarioId, alCargo, desc, l.compra_id, cargo.id, l.sucursal_id]);
      ids.push(rows[0].id);
      restante -= alCargo;
    }
  }
  if (restante > 0.0001) {
    const acreedorId = cargo?.acreedor_id || await _acreedorDelProveedor(client, negocioId, proveedorId);
    const { rows } = await client.query(`
      INSERT INTO movimientos_acreedor (acreedor_id, usuario_id, tipo, valor, descripcion, compra_id, cargo_id, metodo, registrar_en_caja, sucursal_id)
      VALUES ($1,$2,'Abono',$3,$4,$5,NULL,'Garantía',false,$6) RETURNING id
    `, [acreedorId, usuarioId, restante, `${desc} (saldo a favor)`, l.compra_id || null, l.sucursal_id]);
    ids.push(rows[0].id);
  }
  return ids;
};

const resolverProveedor = async (user, lineaId, body = {}) => {
  const tipo = body.tipo;
  if (!TIPOS_PROVEEDOR.includes(tipo)) throw { status: 400, message: 'Elige qué respondió el proveedor' };
  const destino = tipo === 'rechazo' ? body.destino : null;
  if (tipo === 'rechazo' && !['reingreso', 'baja'].includes(destino)) {
    throw { status: 400, message: 'Si el proveedor no lo cubrió, elige si la unidad vuelve al inventario o se da de baja' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bloquearOperacion(client, `garantia:linea:${Number(lineaId)}`);
    const l = await _lineaParaEscribir(client, user, Number(lineaId));
    if (!l.envio_id) throw { status: 409, code: 'SIN_ENVIO', message: 'Primero registra el envío de esta unidad al proveedor' };
    const pendiente = _num(l.cantidad) - _num(l.cantidad_resuelta);
    if (pendiente <= 0) throw { status: 409, message: 'El proveedor ya respondió por todas las unidades' };
    const cantidad = l.tipo === 'serial' ? 1 : (_entero(body.cantidad) || pendiente);
    if (cantidad > pendiente) throw { status: 400, message: `Quedan ${pendiente} unidad(es) por resolver con el proveedor` };
    const numero = l.reclamo_numero;
    const costo = l.costo_unitario == null ? null : Number(l.costo_unitario);

    // Primero la línea: con ella cerrada el candado ya deja mover el serial.
    const cierra = _num(l.cantidad_resuelta) + cantidad >= _num(l.cantidad);
    await client.query(`
      UPDATE reclamos_garantia_lineas SET cantidad_resuelta = cantidad_resuelta + $2, cerrada = $3 WHERE id = $1
    `, [l.id, cantidad, cierra]);

    const m = { lado: 'proveedor', tipo, destino, cantidad, notas: body.notas, rastro: {} };
    const u = body.unidad || {};

    if (tipo === 'reposicion' || tipo === 'reparacion') {
      m.garantia_hasta = await _garantiaNueva(client, l, body.garantia);
    }

    if (tipo === 'reposicion') {
      if (l.tipo === 'serial') {
        const imei = _texto(u.imei, 60);
        if (!imei) throw { status: 400, message: 'Escribe o escanea el IMEI de la unidad que llegó' };
        const { rows: existe } = await client.query(`
          SELECT s.id, s.vendido, ps.sucursal_id FROM seriales s
          JOIN productos_serial ps ON ps.id = s.producto_id JOIN sucursales su ON su.id = ps.sucursal_id
          WHERE UPPER(BTRIM(s.imei)) = UPPER(BTRIM($1)) AND su.negocio_id = $2 LIMIT 1`, [imei, user.negocio_id]);
        if (existe.length) throw { status: 409, code: 'IMEI_EXISTE', message: `El IMEI ${imei} ya está en el inventario del negocio` };
        const productoId = _entero(u.producto_id) || l.producto_id;
        const { rows: ps } = await client.query(
          'SELECT id, nombre, sucursal_id FROM productos_serial WHERE id = $1', [productoId]);
        if (!ps[0] || Number(ps[0].sucursal_id) !== Number(l.sucursal_id)) {
          throw { status: 404, message: 'La referencia elegida no es de esta sucursal' };
        }
        const { rows: viejo } = await client.query('SELECT precio, color FROM seriales WHERE id = $1', [l.serial_id]);
        const { rows: [nuevo] } = await client.query(`
          INSERT INTO seriales (producto_id, imei, costo_compra, precio, proveedor_id, color, fecha_entrada)
          VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE) RETURNING id, imei
        `, [productoId, imei, costo, viejo[0]?.precio ?? null, l.proveedor_id || null,
          _texto(u.color, 60) ?? viejo[0]?.color ?? null]);
        Object.assign(m, { serial_id: nuevo.id, imei: nuevo.imei, producto_id: productoId, nombre_producto: ps[0].nombre });
      } else {
        const pedido = _entero(u.producto_id)
          ? { producto_id: Number(u.producto_id), atributo_id: _entero(u.atributo_id), variante_id: _entero(u.variante_id) }
          : { producto_id: l.producto_id, atributo_id: l.atributo_id, variante_id: l.variante_id };
        const nodo = await _leerNodo(client, pedido, l.sucursal_id, { bloquear: true });
        await _moverStock(client, nodo, l.sucursal_id, cantidad, { costo, tipo: 'garantia_reposicion', nota: `Garantía #${numero}: repuesto por el proveedor` });
        Object.assign(m, { producto_id: nodo.producto_id, atributo_id: nodo.atributo_id, variante_id: nodo.variante_id,
          nombre_producto: [nodo.nombre, nodo.variante_texto].filter(Boolean).join(' · ') });
      }
    } else if ((tipo === 'reparacion' || (tipo === 'rechazo' && destino === 'reingreso')) && l.tipo === 'cantidad') {
      const nodo = await _leerNodo(client, l, l.sucursal_id, { bloquear: true });
      await _moverStock(client, nodo, l.sucursal_id, cantidad, {
        costo, tipo: tipo === 'reparacion' ? 'garantia_reparacion' : 'garantia_reingreso',
        nota: `Garantía #${numero}: ${tipo === 'reparacion' ? 'vuelve reparado' : 'vuelve sin cubrir'}`,
      });
      Object.assign(m, { producto_id: nodo.producto_id, atributo_id: nodo.atributo_id, variante_id: nodo.variante_id });
    } else if (tipo === 'nota_credito') {
      if (!l.proveedor_id) throw { status: 409, message: 'Esta garantía no tiene proveedor' };
      const valor = body.valor != null && body.valor !== '' ? Number(body.valor) : _num(costo) * cantidad;
      if (!Number.isFinite(valor) || valor <= 0) throw { status: 400, message: 'Escribe el valor de la nota crédito' };
      m.valor = valor;
      const ids = await _notaCredito(client, {
        negocioId: user.negocio_id, l, proveedorId: l.proveedor_id, valor, numero, usuarioId: user.id,
      });
      m.movimiento_acreedor_id = ids[0];
      m.rastro.acreedor_ids = ids;
      if (l.tipo === 'serial' && l.linea_compra_id) {
        const { rowCount } = await client.query(`
          UPDATE lineas_compra SET cantidad_devuelta = COALESCE(cantidad_devuelta, 0) + 1
          WHERE id = $1 AND cantidad - COALESCE(cantidad_devuelta, 0) >= 1`, [l.linea_compra_id]);
        m.rastro.linea_compra_devuelta = rowCount > 0;
      }
    } else if (tipo === 'reembolso_proveedor') {
      const valor = Number(body.valor);
      if (!Number.isFinite(valor) || valor <= 0) throw { status: 400, message: 'Escribe cuánto dinero devolvió el proveedor' };
      m.valor = valor;
      m.metodo = body.metodo || METODOS_DEFECTO;
    }

    // La unidad dañada que se quedó el proveedor (o que se dio de baja) sale
    // del inventario. Su fila NO se borra: es su historia.
    if (l.tipo === 'serial' && SALE_LA_UNIDAD.has(tipo === 'rechazo' ? destino : tipo)) {
      await client.query('UPDATE seriales SET vendido = true, fecha_salida = CURRENT_DATE WHERE id = $1', [l.serial_id]);
    }

    const mov = await _insertarMovimiento(client, l, user, m);
    if (tipo === 'reembolso_proveedor') {
      const cajaId = await _movimientoDeCaja(client, {
        sucursalId: l.sucursal_id, usuarioId: user.id, tipo: 'Ingreso', valor: m.valor, metodo: m.metodo,
        concepto: `Garantía #${numero} — el proveedor devolvió el dinero de ${l.nombre_producto}`,
        refTipo: 'garantia_proveedor', refId: mov.id,
      });
      await client.query('UPDATE reclamos_garantia_movimientos SET movimiento_caja_id = $2 WHERE id = $1', [mov.id, cajaId]);
      mov.movimiento_caja_id = cajaId;
    }

    await client.query('COMMIT');
    return mov;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ANULAR — todo error tiene salida, nada se borra (salvo lo que el propio
// movimiento creó y nadie más tocó: la unidad repuesta sin vender).
// ═════════════════════════════════════════════════════════════════════════════

const _devolverStockSinCosto = async (client, nodo, sucursalId, cantidad, nota) => {
  // Sacar lo que entró con su costo: el promedio se reconstruye si se puede
  // (revertirCostoPromedio devuelve null cuando no hay cómo, y entonces se deja).
  const tabla = _tablaNodo(nodo) || { tabla: 'productos_cantidad', id: Number(nodo.producto_id) };
  const { rows } = await client.query(`SELECT stock, costo_unitario FROM ${tabla.tabla} WHERE id = $1 FOR UPDATE`, [tabla.id]);
  if (!rows[0] || _num(rows[0].stock) < cantidad) {
    throw { status: 409, message: 'Esas unidades ya no están en el inventario (se vendieron o se movieron)' };
  }
  await _moverStock(client, nodo, sucursalId, -cantidad, { tipo: 'garantia_anulada', nota });
  return rows[0];
};

const anularMovimiento = async (user, movId, motivo) => {
  const texto = _texto(motivo, 300);
  if (!texto || texto.length < 3) throw { status: 400, message: 'Escribe por qué anulas este movimiento' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: pre } = await client.query(
      'SELECT linea_id FROM reclamos_garantia_movimientos WHERE id = $1 AND negocio_id = $2', [movId, user.negocio_id]);
    if (!pre[0]) throw { status: 404, message: 'Movimiento no encontrado' };
    await bloquearOperacion(client, `garantia:linea:${pre[0].linea_id}`);
    const l = await _lineaParaEscribir(client, user, pre[0].linea_id);
    const { rows: mv } = await client.query('SELECT * FROM reclamos_garantia_movimientos WHERE id = $1 FOR UPDATE', [movId]);
    const m = mv[0];
    if (m.anulado) throw { status: 409, message: 'Ese movimiento ya está anulado' };
    const nota = `Garantía #${l.reclamo_numero}: anulado`;
    const rastro = m.rastro || {};
    const qty = _num(m.cantidad);

    if (m.lado === 'proveedor') {
      if (m.tipo === 'reposicion' && l.tipo === 'serial') {
        const { rows: s } = await client.query('SELECT vendido, prestado FROM seriales WHERE id = $1 FOR UPDATE', [m.serial_id]);
        if (s[0] && (s[0].vendido || s[0].prestado)) {
          throw { status: 409, message: `El equipo repuesto ${m.imei} ya se ${s[0].vendido ? 'vendió' : 'prestó'}: no se puede anular` };
        }
        if (s[0]) await client.query('DELETE FROM seriales WHERE id = $1', [m.serial_id]);
      } else if (['reposicion', 'reparacion'].includes(m.tipo) && l.tipo === 'cantidad'
          || (m.tipo === 'rechazo' && m.destino === 'reingreso' && l.tipo === 'cantidad')) {
        const nodo = { producto_id: m.producto_id || l.producto_id, atributo_id: m.producto_id ? m.atributo_id : l.atributo_id,
          variante_id: m.producto_id ? m.variante_id : l.variante_id };
        const antes = await _devolverStockSinCosto(client, nodo, l.sucursal_id, qty, nota);
        const previo = revertirCostoPromedio(antes.stock, antes.costo_unitario, qty, l.costo_unitario);
        const tabla = _tablaNodo(nodo) || { tabla: 'productos_cantidad', id: Number(nodo.producto_id) };
        if (previo != null) await client.query(`UPDATE ${tabla.tabla} SET costo_unitario = $1 WHERE id = $2`, [previo, tabla.id]);
      } else if (m.tipo === 'nota_credito') {
        if (Array.isArray(rastro.acreedor_ids) && rastro.acreedor_ids.length) {
          await client.query('DELETE FROM movimientos_acreedor WHERE id = ANY($1::int[])', [rastro.acreedor_ids]);
        }
        if (rastro.linea_compra_devuelta && l.linea_compra_id) {
          await client.query(`UPDATE lineas_compra SET cantidad_devuelta = GREATEST(COALESCE(cantidad_devuelta, 0) - 1, 0)
                              WHERE id = $1`, [l.linea_compra_id]);
        }
      } else if (m.tipo === 'reembolso_proveedor' && m.movimiento_caja_id) {
        await client.query('UPDATE movimientos_caja SET activo = false WHERE id = $1', [m.movimiento_caja_id]);
      }
      if (l.tipo === 'serial') {
        // La unidad dañada vuelve a estar en garantía: tiene que seguir aquí.
        const { rows: s } = await client.query('SELECT vendido, prestado FROM seriales WHERE id = $1 FOR UPDATE', [l.serial_id]);
        const sale = SALE_LA_UNIDAD.has(m.tipo === 'rechazo' ? m.destino : m.tipo);
        if (!sale && s[0] && (s[0].vendido || s[0].prestado)) {
          throw { status: 409, message: `El equipo ${l.imei} ya se ${s[0].vendido ? 'vendió' : 'prestó'}: no se puede reabrir la garantía` };
        }
        if (sale) await client.query('UPDATE seriales SET vendido = false, fecha_salida = NULL WHERE id = $1', [l.serial_id]);
      }
      // Recién ahora se reabre: con la línea abierta el candado ya no dejaría
      // tocar el serial.
      await client.query(`
        UPDATE reclamos_garantia_lineas SET cantidad_resuelta = cantidad_resuelta - $2, cerrada = false WHERE id = $1
      `, [l.id, qty]);
    } else {
      if (m.tipo === 'cambio') {
        if (l.tipo === 'serial') {
          if (rastro.prestamo) {
            await client.query('UPDATE seriales SET prestado = false WHERE id = $1', [m.serial_id]);
            await client.query('UPDATE prestamos SET imei = $2, producto_id = $3::int, nombre_producto = $4 WHERE id = $1',
              [rastro.prestamo.id, rastro.prestamo.imei, rastro.prestamo.producto_id, rastro.prestamo.nombre_producto]);
          } else {
            await client.query('UPDATE seriales SET vendido = false, fecha_salida = NULL WHERE id = $1', [m.serial_id]);
          }
        } else {
          const nodo = await _leerNodo(client, { producto_id: m.producto_id, atributo_id: m.atributo_id, variante_id: m.variante_id },
            l.sucursal_id, { bloquear: true });
          await _moverStock(client, nodo, l.sucursal_id, qty, { tipo: 'garantia_anulada', nota });
        }
      } else if (m.tipo === 'reembolso') {
        if (rastro.credito) {
          throw { status: 409, message: 'La devolución en un crédito no se anula aquí: el crédito ya se ajustó. Corrígelo editando la factura.' };
        }
        const { rowCount } = await client.query(`
          UPDATE lineas_factura SET cantidad_devuelta = cantidad_devuelta - $2
          WHERE id = $1 AND COALESCE(cantidad_devuelta, 0) >= $2`, [l.linea_factura_id, qty]);
        if (!rowCount) throw { status: 409, message: 'La línea de la factura cambió: no se puede anular' };
        if (m.movimiento_caja_id) await client.query('UPDATE movimientos_caja SET activo = false WHERE id = $1', [m.movimiento_caja_id]);
      }
      await client.query(
        'UPDATE reclamos_garantia_lineas SET cantidad_cliente = cantidad_cliente - $2 WHERE id = $1', [l.id, qty]);
    }

    await client.query(`
      UPDATE reclamos_garantia_movimientos SET anulado = true, anulado_motivo = $2, anulado_por = $3, anulado_en = NOW()
      WHERE id = $1`, [m.id, texto, user.id]);
    await client.query('COMMIT');
    return { ...m, anulado: true, anulado_motivo: texto };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const anularReclamo = async (user, reclamoId, motivo) => {
  const texto = _texto(motivo, 300);
  if (!texto || texto.length < 3) throw { status: 400, message: 'Escribe por qué anulas esta garantía' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bloquearOperacion(client, `garantia:reclamo:${Number(reclamoId)}`);
    const { rows } = await client.query(
      'SELECT * FROM reclamos_garantia WHERE id = $1 AND negocio_id = $2 FOR UPDATE', [reclamoId, user.negocio_id]);
    const r = rows[0];
    if (!r) throw { status: 404, message: 'Garantía no encontrada' };
    _exigirSede(user, r.sucursal_id);
    if (r.anulado) throw { status: 409, message: 'La garantía ya está anulada' };
    const { rows: movs } = await client.query(
      'SELECT 1 FROM reclamos_garantia_movimientos WHERE reclamo_id = $1 AND NOT anulado LIMIT 1', [r.id]);
    if (movs.length) {
      throw { status: 409, message: 'Esta garantía ya tiene movimientos (con el cliente o el proveedor): anúlalos primero' };
    }
    const { rows: lineas } = await client.query('SELECT * FROM reclamos_garantia_lineas WHERE reclamo_id = $1 FOR UPDATE', [r.id]);

    // Primero se cierra (el candado suelta el serial), después se restaura.
    await client.query(`
      UPDATE reclamos_garantia SET anulado = true, anulado_motivo = $2, anulado_por = $3, anulado_en = NOW() WHERE id = $1
    `, [r.id, texto, user.id]);
    await client.query('UPDATE reclamos_garantia_lineas SET cerrada = true, envio_id = NULL WHERE reclamo_id = $1', [r.id]);

    for (const l of lineas) {
      const prev = l.estado_anterior || {};
      if (l.tipo === 'serial') {
        if (prev.vendido) {
          await client.query('UPDATE seriales SET vendido = true, fecha_salida = $2 WHERE id = $1', [l.serial_id, prev.fecha_salida || null]);
        } else if (prev.prestado) {
          await client.query('UPDATE seriales SET prestado = true WHERE id = $1', [l.serial_id]);
        }
      } else if (prev.stock_descontado) {
        const nodo = await _leerNodo(client, l, l.sucursal_id, { bloquear: true });
        await _moverStock(client, nodo, l.sucursal_id, _num(prev.stock_descontado), {
          tipo: 'garantia_anulada', nota: `Garantía #${_numeroDe(r)} anulada: vuelve al inventario`,
        });
      }
    }
    await client.query('COMMIT');
    return { ...r, anulado: true, anulado_motivo: texto };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// LECTURAS
// ═════════════════════════════════════════════════════════════════════════════

const listar = async (user, sucursalId, query = {}, cfg = {}) => {
  const sede = _sedeLectura(user, sucursalId);
  const sedeFiltro = sede && sede > 0 ? sede : (user.rol === 'admin_negocio' ? null : -1);
  const [items, resumen] = await Promise.all([
    repo.listarLineas(user.negocio_id, sedeFiltro, {
      vista: query.vista, proveedorId: _entero(query.proveedor_id), q: query.q, limite: query.limite,
    }),
    repo.resumen(user.negocio_id, sedeFiltro, cfg.dias_demora || 15),
  ]);
  const veCostos = await puedeVerCostos(user);
  if (!veCostos) resumen.valor_afuera = null;
  return {
    items: _recortarCosto(items, veCostos),
    resumen,
    dias_demora: cfg.dias_demora || 15,
  };
};

const detalle = async (user, id) => {
  const r = await repo.findReclamo(user.negocio_id, id);
  if (!r) throw { status: 404, message: 'Garantía no encontrada' };
  _exigirSede(user, r.sucursal_id);
  const [lineas, movimientos, extra] = await Promise.all([
    repo.lineasDeReclamo(r.id), repo.movimientosDeReclamo(r.id), repo.extraFase2(r.id),
  ]);
  const veCostos = await puedeVerCostos(user);
  return { ...r, ...extra, lineas: _recortarCosto(lineas, veCostos), movimientos, costos_ocultos: !veCostos };
};

const getEnvio = async (user, id) => {
  const e = await repo.findEnvio(user.negocio_id, id);
  if (!e) throw { status: 404, message: 'Envío no encontrado' };
  _exigirSede(user, e.sucursal_id);
  const lineas = await repo.lineasDeEnvio(e.id);
  const veCostos = await puedeVerCostos(user);
  return { ...e, lineas: _recortarCosto(lineas, veCostos), costos_ocultos: !veCostos };
};

/**
 * Estado de cuenta de las garantías con UN proveedor: todo lo que se le ha
 * mandado en el período (por la fecha del caso) más lo que siga abierto de
 * antes — lo que tiene nuestro hoy no puede quedarse fuera por la fecha. Cada
 * línea con su respuesta, y un resumen: qué tiene, qué devolvió, cuánto se
 * recuperó y qué no cubrió. El costo solo viaja a quien ve costos.
 */
const estadoCuentaProveedor = async (user, sucursalId, proveedorId, { desde = null, hasta = null } = {}) => {
  const { rows: prov } = await pool.query(
    'SELECT id, nombre, nit, telefono FROM proveedores WHERE id = $1 AND negocio_id = $2', [proveedorId, user.negocio_id]);
  if (!prov[0]) throw { status: 404, message: 'Proveedor no encontrado' };
  const sede = _sedeLectura(user, sucursalId);
  const sedeFiltro = sede && sede > 0 ? sede : (user.rol === 'admin_negocio' ? null : -1);
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
  const lineas = await repo.lineasDeProveedor(user.negocio_id, sedeFiltro, Number(proveedorId), {
    desde: fecha(desde), hasta: fecha(hasta),
  });
  const veCostos = await puedeVerCostos(user);
  const r = {
    casos: new Set(lineas.map((l) => l.reclamo_id)).size, unidades: 0, por_enviar: 0, afuera: 0,
    repuestas: 0, reparadas: 0, no_cubiertas: 0, nota_credito: 0, dinero: 0,
    valor_afuera: 0, valor_no_cubierto: 0, dias_respuesta: null,
  };
  const dias = [];
  for (const l of lineas) {
    const abiertas = _num(l.cantidad) - _num(l.cantidad_resuelta);
    r.unidades += _num(l.cantidad);
    if (!l.cerrada && !l.envio_id) r.por_enviar += abiertas;
    if (!l.cerrada && l.envio_id) r.afuera += abiertas;
    r.valor_afuera += !l.cerrada ? abiertas * _num(l.costo_unitario) : 0;
    r.repuestas += _num(l.uds_repuestas);
    r.reparadas += _num(l.uds_reparadas);
    r.no_cubiertas += _num(l.uds_no_cubiertas);
    r.valor_no_cubierto += _num(l.uds_baja) * _num(l.costo_unitario);
    r.nota_credito += _num(l.valor_nota_credito);
    r.dinero += _num(l.valor_dinero);
    if (l.dias_respuesta != null) dias.push(Number(l.dias_respuesta));
  }
  r.dias_respuesta = dias.length ? Math.round(dias.reduce((s, x) => s + x, 0) / dias.length) : null;
  r.recuperado = r.nota_credito + r.dinero;
  if (!veCostos) { r.valor_afuera = null; r.valor_no_cubierto = null; }
  return {
    proveedor: prov[0], desde: fecha(desde), hasta: fecha(hasta),
    resumen: r, lineas: _recortarCosto(lineas, veCostos), costos_ocultos: !veCostos,
  };
};

const enInventario = async (user, sucursalId) => {
  const sede = user.rol === 'admin_negocio' ? Number(sucursalId) || null : Number(user.sucursal_id) || null;
  if (!sede) return { seriales: [], nodos: [] };
  return repo.enInventario(user.negocio_id, sede);
};

module.exports = {
  buscarCandidatos, crear, resolverCliente, crearEnvio, anularEnvio, resolverProveedor,
  anularMovimiento, anularReclamo, listar, detalle, getEnvio, enInventario, estadoCuentaProveedor,
  // Para las pruebas.
  _leerNodo, _procedenciaSerial, TIPOS_PROVEEDOR,
};
