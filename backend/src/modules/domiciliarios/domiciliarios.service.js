const { pool }        = require('../../config/db');
const repo            = require('./domiciliarios.repository');
const facturasRepo    = require('../facturas/facturas.repository');
// Importación de facturasService se hace de forma diferida en marcarDevolucion
// para evitar dependencia circular (ver comentario en esa función).

// ── _validarDomiciliario ──────────────────────────────────────────────────────

const _validarDomiciliario = async (domiciliarioId, negocioId) => {
  const domiciliario = await repo.findById(domiciliarioId, negocioId);
  if (!domiciliario) {
    throw { status: 403, message: 'El domiciliario no pertenece a este negocio' };
  }
  return domiciliario;
};

// ── _validarEntrega ───────────────────────────────────────────────────────────

const _validarEntrega = async (entregaId, negocioId) => {
  const entrega = await repo.findEntregaById(entregaId, negocioId);
  if (!entrega) {
    throw { status: 404, message: 'Entrega no encontrada' };
  }
  return entrega;
};

// ── getDomiciliarios ──────────────────────────────────────────────────────────

const getDomiciliarios = (negocioId) => repo.findAll(negocioId);

// ── crearDomiciliario ─────────────────────────────────────────────────────────

const crearDomiciliario = async (negocioId, { nombre, telefono }) => {
  if (!nombre?.trim()) {
    throw { status: 400, message: 'El nombre del domiciliario es requerido' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const domiciliario = await repo.create(client, { negocioId, nombre: nombre.trim(), telefono });
    await client.query('COMMIT');
    return domiciliario;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw { status: 409, message: 'Ya existe un domiciliario con ese nombre en este negocio' };
    }
    throw err;
  } finally {
    client.release();
  }
};

// ── actualizarDomiciliario ────────────────────────────────────────────────────

const actualizarDomiciliario = async (negocioId, id, datos) => {
  await _validarDomiciliario(id, negocioId);
  const actualizado = await repo.update(id, negocioId, datos);
  if (!actualizado) throw { status: 404, message: 'Domiciliario no encontrado' };
  return actualizado;
};

// ── getEntregas ───────────────────────────────────────────────────────────────

const getEntregas = (negocioId, filtros) => repo.findAllEntregas(negocioId, filtros);

// ── getEntregaById ────────────────────────────────────────────────────────────

const getEntregaById = async (entregaId, negocioId) => {
  const entrega = await _validarEntrega(entregaId, negocioId);
  const abonos  = await repo.getAbonos(entregaId, negocioId);
  return { ...entrega, abonos };
};

// ── crearEntregaEnTransaccion ─────────────────────────────────────────────────
// Llamado desde facturas.service dentro de su propia transacción.

const crearEntregaEnTransaccion = async (client, {
  facturaId, domiciliarioId, negocioId, usuarioId,
  valorTotal, direccionEntrega, notas,
}) => {
  const { rows: domRows } = await client.query(
    `SELECT id FROM domiciliarios WHERE id = $1 AND negocio_id = $2 AND activo = true`,
    [domiciliarioId, negocioId]
  );
  if (!domRows.length) {
    throw { status: 403, message: 'El domiciliario no pertenece a este negocio o está inactivo' };
  }
  return repo.createEntrega(client, {
    facturaId, domiciliarioId, negocioId, usuarioId,
    valorTotal, direccionEntrega, notas,
  });
};

// ── registrarAbono ────────────────────────────────────────────────────────────

const registrarAbono = async (negocioId, entregaId, { usuarioId, valor, notas }) => {
  const entrega = await _validarEntrega(entregaId, negocioId);

  if (entrega.estado !== 'Pendiente') {
    throw { status: 400, message: `No se pueden registrar abonos en una entrega con estado "${entrega.estado}"` };
  }

  const valorNumerico = Number(valor);
  if (!valorNumerico || valorNumerico <= 0) {
    throw { status: 400, message: 'El valor del abono debe ser mayor a 0' };
  }

  const saldoPendiente = Number(entrega.valor_total) - Number(entrega.total_abonado);
  if (valorNumerico > saldoPendiente) {
    throw { status: 400, message: `El abono (${valorNumerico}) supera el saldo pendiente (${saldoPendiente})` };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entregaActualizada = await repo.registrarAbono(client, {
      entregaId, negocioId, usuarioId, valor: valorNumerico, notas,
    });
    await client.query('COMMIT');
    return entregaActualizada;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── marcarDevolucion ──────────────────────────────────────────────────────────
// El domiciliario no entregó el pedido. Se cancela la factura completa.
//
// DISEÑO DELIBERADO — delegación a cancelarFactura():
//   Esta función NO reimplementa la lógica de cancelación. La delega
//   íntegramente a facturasService.cancelarFactura(), que ya maneja:
//     • Reversión de stock (seriales y cantidades)
//     • Egreso en caja (devolución del dinero al cliente si la caja está abierta)
//     • Cambio de estado de la factura a 'Cancelada'
//   Esto garantiza que caja y reportes se comportan exactamente igual
//   que una cancelación manual — sin doble reversión ni caja huérfana.
//
// IMPORTACIÓN DIFERIDA para romper dependencia circular:
//   facturas.service → domiciliarios.service (crearEntregaEnTransaccion)
//   domiciliarios.service → facturas.service (cancelarFactura)
//   Si ambos se importan en el top-level, Node.js resuelve uno de ellos
//   como un objeto vacío {} al arrancar. El require() dentro de la función
//   se evalúa en tiempo de ejecución, cuando ambos módulos ya están cargados.
//
// PROTECCIÓN ANTI-DOBLE-CANCELACIÓN:
//   Si la factura ya fue cancelada manualmente, cancelarFactura() lanza 400.
//   En ese caso la entrega permanece Pendiente — sin estado inconsistente.
//   El admin puede entonces marcar la entrega manualmente o investigar.

const marcarDevolucion = async (negocioId, entregaId) => {
  const entrega = await _validarEntrega(entregaId, negocioId);

  if (entrega.estado !== 'Pendiente') {
    throw {
      status: 400,
      message: `Solo se pueden devolver entregas en estado Pendiente. Estado actual: "${entrega.estado}"`,
    };
  }

  // Importación diferida — ver comentario arriba.
  const facturasService = require('../facturas/facturas.service');

  // Paso 1: cancelar la factura (stock + caja + estado factura).
  // eliminarRetoma = false: no revertimos retomas de la factura original.
  // _desdeDevolucion = true: indica que esta cancelación es iniciada por el
  // módulo de domiciliarios — se salta el bloqueo de entrega pendiente.
  await facturasService.cancelarFactura(negocioId, entrega.factura_id, false, true);

  // Paso 2: marcar la entrega como No_entregado.
  // Solo se ejecuta si cancelarFactura tuvo éxito — sin estado inconsistente.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.marcarNoEntregado(client, entregaId, negocioId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getDomiciliarios,
  crearDomiciliario,
  actualizarDomiciliario,
  getEntregas,
  getEntregaById,
  crearEntregaEnTransaccion,
  registrarAbono,
  marcarDevolucion,
};