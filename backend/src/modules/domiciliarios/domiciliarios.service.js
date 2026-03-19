const { pool }          = require('../../config/db');
const repo              = require('./domiciliarios.repository');
const facturasRepo      = require('../facturas/facturas.repository');


// ── _validarDomiciliario ──────────────────────────────────────────────────────
// Centraliza la validación de pertenencia al negocio.
// Lanza 403 si el domiciliario no pertenece al negocio del usuario.

const _validarDomiciliario = async (domiciliarioId, negocioId) => {
  const domiciliario = await repo.findById(domiciliarioId, negocioId);
  if (!domiciliario) {
    throw { status: 403, message: 'El domiciliario no pertenece a este negocio' };
  }
  return domiciliario;
};

// ── _validarEntrega ───────────────────────────────────────────────────────────
// Centraliza la validación de pertenencia de una entrega al negocio.

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
    const domiciliario = await repo.create(client, {
      negocioId, nombre: nombre.trim(), telefono,
    });
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
// Llamado DESDE facturas.service dentro de su propia transacción.
// No abre transacción propia — recibe el client existente.

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
// Cualquier rol puede registrar abonos.
// Valida que el abono no supere el saldo pendiente (protege contra doble pago).

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
    throw {
      status: 400,
      message: `El abono (${valorNumerico}) supera el saldo pendiente (${saldoPendiente})`,
    };
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
// Devolución = el domiciliario no entregó el pedido.
// Flujo:
//   1. Valida que la entrega esté Pendiente.
//   2. Cancela la factura (revierte stock de seriales y cantidades).
//   3. Marca la entrega como No_entregado.
// Todo en una sola transacción para garantizar atomicidad.

const marcarDevolucion = async (negocioId, entregaId) => {
  const entrega = await _validarEntrega(entregaId, negocioId);

  if (entrega.estado !== 'Pendiente') {
    throw {
      status: 400,
      message: `Solo se pueden devolver entregas en estado Pendiente. Estado actual: "${entrega.estado}"`,
    };
  }

  const factura = await facturasRepo.findByIdYNegocio(entrega.factura_id, negocioId);
  if (!factura) {
    throw { status: 404, message: 'Factura asociada no encontrada' };
  }

  if (factura.estado === 'Cancelada') {
    throw { status: 400, message: 'La factura ya está cancelada' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lineas = await facturasRepo.getLineas(entrega.factura_id);
    for (const linea of lineas) {
      if (linea.imei) {
        const { rows: serialRows } = await client.query(
          `SELECT s.id FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           JOIN facturas          f  ON f.sucursal_id = ps.sucursal_id
           WHERE s.imei = $1 AND f.id = $2`,
          [linea.imei, entrega.factura_id]
        );
        if (serialRows.length) {
          await client.query(
            'UPDATE seriales SET vendido = false, fecha_salida = NULL WHERE id = $1',
            [serialRows[0].id]
          );
        }
      } else if (linea.producto_id) {
        await facturasRepo.ajustarStockCantidad(client, linea.producto_id, linea.cantidad);
      }
    }

    await facturasRepo.cancelar(client, entrega.factura_id);
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