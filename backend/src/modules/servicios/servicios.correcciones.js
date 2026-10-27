// ─────────────────────────────────────────────────────────────────────────────
// Servicio técnico — corregir equivocaciones: ANULAR una orden y CAMBIAR sus
// valores (pedido del usuario, 26-oct-2026). Ver
// migrations/20261026_servicio_anulacion.sql.
//
// Decisiones del usuario:
//   · Anular se puede en cualquier estado (también entregada, pendiente o sin
//     reparar); si la orden generó su factura de servicio, esa factura queda
//     Cancelada con ella.
//   · La plata ya recibida se decide EN EL MOMENTO: «se le devuelve al cliente»
//     (una devolución que sale de la caja) o «fue un error» (se anulan sus
//     movimientos y la caja deja de contarlos).
//   · Se corrigen el precio que se cobra, el costo y el estimado. Si el precio
//     queda por debajo de lo abonado se devuelve la diferencia; si sube en una
//     orden ya entregada y pagada, vuelve a quedar con saldo (Pendiente de pago).
//     La factura de la orden se ajusta sola.
//   · Quién: el admin, o quien tenga autorizado el PIN (la ruta lleva
//     `requireAdminOPin`, que lo vuelve a verificar en el servidor).
//
// Nada se borra: la orden anulada guarda quién, cuándo, por qué y en qué estado
// estaba; las correcciones de valores dejan su antes y después en `auditoria`.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../config/db');
const { hayServicioAbonosV2, hayServicioAnulacion, hayReclamosFase2 } = require('../../config/columnas');
const repo = require('./servicios.repository');

const _cop = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
const _num = (v) => (v === null || v === undefined ? null : Number(v));
const _round = (v) => Math.round(Number(v) * 100) / 100;

const _exigirMigracion = () => {
  if (!hayServicioAnulacion()) {
    throw { status: 503, message: 'Falta la actualización de la base para corregir órdenes de servicio' };
  }
};

/**
 * ¿La factura de la orden es la SUYA (la que crea entregar)? Solo esa se toca:
 * una factura con productos (IMEI o producto) es una venta y no se cancela ni
 * se reescribe desde aquí.
 */
const _facturaDeServicio = async (client, facturaId) => {
  if (!facturaId) return null;
  const { rows } = await client.query(`
    SELECT f.id, f.estado,
      EXISTS (SELECT 1 FROM lineas_factura l WHERE l.factura_id = f.id
              AND (l.imei IS NOT NULL OR l.producto_id IS NOT NULL)) AS tiene_productos,
      (SELECT COUNT(*)::int FROM lineas_factura l WHERE l.factura_id = f.id) AS lineas
    FROM facturas f WHERE f.id = $1 FOR UPDATE
  `, [facturaId]);
  const f = rows[0];
  if (!f || f.tiene_productos || f.lineas !== 1) return null;
  return f;
};

/** Reescribe los pagos de la factura con lo que de verdad quedó (sin anulados, neto de devoluciones). */
const _rehacerPagosFactura = async (client, facturaId, ordenId) => {
  const v2 = hayServicioAbonosV2();
  // La factura es la de la reparación original: no cuenta lo cobrado en garantías.
  const { rows } = await client.query(v2 ? `
    SELECT metodo,
           SUM(valor) FILTER (WHERE tipo = 'abono')      AS abonos,
           SUM(valor) FILTER (WHERE tipo = 'devolucion') AS devoluciones
    FROM abonos_servicio
    WHERE orden_id = $1 AND NOT anulado AND (ciclo IS NULL OR ciclo = 0)
    GROUP BY metodo
  ` : `
    SELECT metodo, SUM(valor) AS abonos, 0 AS devoluciones
    FROM abonos_servicio WHERE orden_id = $1 GROUP BY metodo
  `, [ordenId]);
  await client.query('DELETE FROM pagos_factura WHERE factura_id = $1', [facturaId]);
  for (const p of repo.pagosNetos(rows)) {
    await client.query('INSERT INTO pagos_factura (factura_id, metodo, valor) VALUES ($1, $2, $3)',
      [facturaId, p.metodo, p.valor]);
  }
};

const _bloquear = async (client, negocioId, id) => {
  const { rows } = await client.query(
    'SELECT * FROM ordenes_servicio WHERE id = $1 AND negocio_id = $2 FOR UPDATE', [id, negocioId]);
  if (!rows.length) throw { status: 404, message: 'Orden no encontrada' };
  return rows[0];
};

/** Un reclamo de garantía con el proveedor colgado de la orden se anula primero. */
const _exigirSinReclamoAbierto = async (client, ordenId) => {
  if (!hayReclamosFase2()) return;
  const { rows } = await client.query(`
    SELECT COALESCE(numero, id) AS numero FROM reclamos_garantia
    WHERE orden_servicio_id = $1 AND NOT anulado LIMIT 1
  `, [ordenId]);
  if (rows.length) {
    throw {
      status: 409, code: 'ORDEN_CON_GARANTIA_PROVEEDOR',
      message: `Esta orden tiene la garantía con proveedor #${rows[0].numero}: anúlala primero en Proveedores → Garantías.`,
    };
  }
};

// ─── Anular ──────────────────────────────────────────────────────────────────

/**
 * Lo que entró y no se ha devuelto, en TODOS los ciclos de la orden (la
 * reparación y sus garantías): anular la orden la deshace entera.
 */
const _netoRecibido = async (client, ordenId) => {
  if (!hayServicioAbonosV2()) {
    const { rows } = await client.query(
      'SELECT COALESCE(SUM(valor), 0) AS neto FROM abonos_servicio WHERE orden_id = $1', [ordenId]);
    return Number(rows[0].neto);
  }
  const { rows } = await client.query(`
    SELECT COALESCE(SUM(CASE WHEN tipo = 'devolucion' THEN -valor ELSE valor END), 0) AS neto
    FROM abonos_servicio WHERE orden_id = $1 AND NOT anulado
  `, [ordenId]);
  return Number(rows[0].neto);
};

/**
 * @param {object} datos  { motivo, plata: 'devolver'|'anular_abonos', metodo, usuarioId }
 */
const anularOrden = async (negocioId, id, { motivo, plata, metodo, usuarioId }) => {
  _exigirMigracion();
  const m = String(motivo ?? '').trim();
  if (m.length < 3) throw { status: 400, message: 'Escribe el motivo de la anulación' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const o = await _bloquear(client, negocioId, id);
    if (o.estado === 'Anulado') throw { status: 409, code: 'YA_ANULADA', message: 'Esta orden ya está anulada' };
    await _exigirSinReclamoAbierto(client, id);

    const neto = _round(await _netoRecibido(client, id));
    if (neto > 0.004) {
      if (plata === 'devolver') {
        await repo._insertarMovimiento(client, {
          ordenId: id, usuarioId, valor: neto, metodo: metodo || 'Efectivo', tipo: 'devolucion',
          orden: o, notas: `Devolución por anulación de la orden: ${m}`.slice(0, 300),
        });
      } else if (plata === 'anular_abonos') {
        await client.query(`
          UPDATE abonos_servicio
          SET anulado = TRUE, anulado_motivo = $2, anulado_por = $3, anulado_en = NOW()
          WHERE orden_id = $1 AND NOT anulado
        `, [id, `Orden anulada: ${m}`.slice(0, 300), usuarioId || null]);
      } else {
        throw {
          status: 409, code: 'PLATA_SIN_DECIDIR',
          message: `La orden tiene ${_cop(neto)} recibidos: indica si se le devuelven al cliente o si los abonos fueron un error.`,
          detalle: { neto },
        };
      }
    }

    // Su factura de servicio (si la generó) queda cancelada con ella.
    let facturaCancelada = null;
    const f = await _facturaDeServicio(client, o.factura_id);
    if (f && f.estado !== 'Cancelada') {
      await client.query("UPDATE facturas SET estado = 'Cancelada' WHERE id = $1", [f.id]);
      facturaCancelada = f.id;
    }

    const { rows } = await client.query(`
      UPDATE ordenes_servicio
      SET estado_anterior = estado, estado = 'Anulado', total_abonado = 0,
          anulado_motivo = $3, anulado_por = $4, anulado_en = NOW()
      WHERE id = $1 AND negocio_id = $2
      RETURNING *
    `, [id, negocioId, m, usuarioId || null]);
    await client.query('COMMIT');
    return { orden: rows[0], neto, plata: neto > 0.004 ? plata : null, factura_cancelada: facturaCancelada };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Corregir valores ────────────────────────────────────────────────────────

const ESTADOS_CON_PRECIO = ['Listo', 'Pendiente_pago', 'Entregado', 'Sin_reparar'];

/**
 * @param {object} datos  { precio?, costo?, costo_estimado?, motivo, ajuste?: {metodo}, usuarioId }
 *   `ajuste` responde al 409: cómo se devuelve lo que sobra (o, en un «sin
 *   reparar» cuyo diagnóstico sube, cómo paga el cliente la diferencia).
 * @returns {{ orden, antes, despues, movimiento }}
 */
const corregirValores = async (negocioId, id, datos) => {
  _exigirMigracion();
  const m = String(datos.motivo ?? '').trim();
  if (m.length < 3) throw { status: 400, message: 'Escribe por qué se corrige' };
  const vino = (k) => datos[k] !== undefined && datos[k] !== null && datos[k] !== '';
  for (const k of ['precio', 'costo', 'costo_estimado']) {
    if (vino(k) && (!Number.isFinite(Number(datos[k])) || Number(datos[k]) < 0)) {
      throw { status: 400, message: 'Los valores no pueden ser negativos' };
    }
  }
  if (!vino('precio') && !vino('costo') && !vino('costo_estimado')) {
    throw { status: 400, message: 'No hay ningún valor para corregir' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const o = await _bloquear(client, negocioId, id);
    if (o.estado === 'Anulado') throw { status: 409, code: 'ORDEN_ANULADA', message: 'Una orden anulada no se corrige' };

    const enG = repo.enGarantia(o) && o.estado !== 'Sin_reparar';
    // En un «sin reparar» el diagnóstico vive en precio_final, haya habido
    // garantía o no.
    const campoPrecio = enG ? 'precio_garantia' : 'precio_final';
    const campoCosto = enG ? 'costo_garantia' : 'costo_real';
    const set = {};
    const antes = {};
    const despues = {};
    let movimiento = null;

    if (vino('costo_estimado')) {
      antes.costo_estimado = _num(o.costo_estimado);
      set.costo_estimado = _round(datos.costo_estimado);
    }

    if (vino('costo')) {
      if (o.estado === 'Sin_reparar') throw { status: 409, message: 'Una orden sin reparar no tiene costo de reparación' };
      if (enG && !o.garantia_cobrable) throw { status: 409, message: 'Una garantía gratis no tiene costo que corregir' };
      antes[campoCosto] = _num(o[campoCosto]);
      set[campoCosto] = _round(datos.costo);
    }

    let nuevoEstado = o.estado;
    let total = Number(o.total_abonado || 0);
    if (vino('precio')) {
      if (!ESTADOS_CON_PRECIO.includes(o.estado)) {
        throw {
          status: 409, code: 'SIN_PRECIO',
          message: 'Esta orden todavía no tiene precio: corrige el estimado, o fija el precio al marcarla lista',
        };
      }
      if (enG && !o.garantia_cobrable) throw { status: 409, message: 'Una garantía gratis no cobra nada' };
      const nuevo = _round(datos.precio);
      antes[campoPrecio] = _num(o[campoPrecio]);
      set[campoPrecio] = nuevo;

      if (total > nuevo + 0.004) {
        // Sobra plata: se devuelve en esta misma transacción.
        const devolver = _round(total - nuevo);
        if (!datos.ajuste) {
          throw {
            status: 409, code: 'ABONADO_MAYOR_A_PRECIO',
            message: `El cliente ya pagó ${_cop(total)} y el valor queda en ${_cop(nuevo)}: hay que devolverle ${_cop(devolver)}.`,
            detalle: { abonado: total, precio: nuevo, devolver },
          };
        }
        movimiento = await repo._insertarMovimiento(client, {
          ordenId: id, usuarioId: datos.usuarioId, valor: devolver, metodo: datos.ajuste.metodo || 'Efectivo',
          tipo: 'devolucion', orden: o, notas: `Corrección de valor: ${m}`.slice(0, 300),
        });
        total = nuevo;
      } else if (nuevo > total + 0.004 && o.estado === 'Sin_reparar') {
        // El diagnóstico sube: la orden ya se cerró, así que se cobra ahora.
        const cobrar = _round(nuevo - total);
        if (!datos.ajuste) {
          throw {
            status: 409, code: 'COBRO_REQUERIDO',
            message: `El diagnóstico sube a ${_cop(nuevo)} y el cliente pagó ${_cop(total)}: indica cómo paga los ${_cop(cobrar)} que faltan.`,
            detalle: { abonado: total, precio: nuevo, cobrar },
          };
        }
        movimiento = await repo._insertarMovimiento(client, {
          ordenId: id, usuarioId: datos.usuarioId, valor: cobrar, metodo: datos.ajuste.metodo || 'Efectivo',
          orden: o, notas: `Corrección del diagnóstico: ${m}`.slice(0, 300),
        });
        total = nuevo;
      }

      // El estado sigue a la cuenta: una entregada que ahora debe vuelve a
      // Pendiente de pago, y una pendiente que ya quedó cubierta se entrega.
      if (o.estado === 'Entregado' && nuevo > total + 0.004) nuevoEstado = 'Pendiente_pago';
      if (o.estado === 'Pendiente_pago' && nuevo <= total + 0.004) nuevoEstado = 'Entregado';
    }

    const cols = Object.keys(set);
    const valores = cols.map((c) => set[c]);
    let sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
    sets += `${sets ? ', ' : ''}total_abonado = $${cols.length + 3}, estado = $${cols.length + 4}`;
    const { rows } = await client.query(`
      UPDATE ordenes_servicio SET ${sets}
      WHERE id = $1 AND negocio_id = $2 RETURNING *
    `, [id, negocioId, ...valores, total, nuevoEstado]);
    const actual = rows[0];

    // La factura de la orden sigue al precio de la reparación (no al de una garantía).
    if (vino('precio') && !enG && o.estado !== 'Sin_reparar') {
      if (actual.factura_id) {
        const f = await _facturaDeServicio(client, actual.factura_id);
        if (f && f.estado !== 'Cancelada') {
          await client.query('UPDATE lineas_factura SET precio = $2 WHERE factura_id = $1', [f.id, set.precio_final]);
          await _rehacerPagosFactura(client, f.id, id);
        }
      } else if (nuevoEstado === 'Entregado' && set.precio_final > 0) {
        await repo._crearFacturaPorServicio(client, actual, set.precio_final);
      }
    } else if (movimiento && actual.factura_id && !enG) {
      const f = await _facturaDeServicio(client, actual.factura_id);
      if (f && f.estado !== 'Cancelada') await _rehacerPagosFactura(client, f.id, id);
    }
    if (nuevoEstado !== o.estado && nuevoEstado === 'Entregado') {
      await client.query('UPDATE ordenes_servicio SET fecha_entrega = COALESCE(fecha_entrega, NOW()) WHERE id = $1', [id]);
    }

    for (const k of Object.keys(antes)) despues[k] = set[k];
    if (nuevoEstado !== o.estado) { antes.estado = o.estado; despues.estado = nuevoEstado; }
    await client.query('COMMIT');
    return { orden: actual, antes, despues, movimiento, motivo: m };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * `auditoria.detalle` es TEXT en producción (el fixture de pruebas la declara
 * JSONB): llega como cadena o como objeto según la base. Se lee igual en las dos.
 */
const leerDetalle = (v) => {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}'); } catch { return {}; }
};

/** Las correcciones de la orden (para el detalle), sacadas de `auditoria`. */
const historialCorrecciones = async (negocioId, ordenId) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.fecha, a.accion, a.detalle, u.nombre AS usuario_nombre
      FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.negocio_id = $1 AND a.tabla = 'servicios' AND a.registro_id = $2
        AND a.accion = 'Valores de servicio corregidos'
      ORDER BY a.fecha ASC
    `, [negocioId, ordenId]);
    return rows.map((r) => ({ ...r, detalle: leerDetalle(r.detalle) }));
  } catch {
    return []; // sin la tabla de auditoría el detalle sale igual, sin historial
  }
};

module.exports = { anularOrden, corregirValores, historialCorrecciones, leerDetalle, ESTADOS_CON_PRECIO };
