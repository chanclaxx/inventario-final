const { pool } = require('../../config/db');
const repo = require('./creditos.repository');

// ── Listar créditos ──────────────────────────────────────────────────────────
const getCreditos = (sucursalId, negocioId) => repo.findAll(sucursalId, negocioId);

// ── Detalle con abonos ───────────────────────────────────────────────────────
const getCreditoById = async (negocioId, id) => {
  const credito = await repo.findByIdYNegocio(id, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  const abonos = await repo.getAbonos(id);
  return { ...credito, abonos };
};

// ── Registrar abono ──────────────────────────────────────────────────────────
const registrarAbono = async (negocioId, creditoId, { usuario_id, valor, metodo, notas }) => {
  const credito = await repo.findByIdYNegocio(creditoId, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  if (credito.estado === 'Saldado') throw { status: 400, message: 'El crédito ya está saldado' };
  if (valor <= 0) throw { status: 400, message: 'El valor del abono debe ser mayor a 0' };

  const saldoPendiente = Number(credito.valor_total) - Number(credito.cuota_inicial) - Number(credito.total_abonado);
  if (valor > saldoPendiente) {
    throw { status: 400, message: `El abono supera el saldo pendiente (${saldoPendiente.toFixed(0)})` };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resultado = await repo.insertarAbono(client, {
      credito_id: creditoId,
      usuario_id,
      valor,
      metodo: metodo || 'Efectivo',
      notas:  notas  || null,
    });

    // Si el saldo quedó en 0 → cerrar automáticamente
    const nuevoSaldo = Number(resultado.valor_total) - Number(resultado.cuota_inicial) - Number(resultado.total_abonado);
    if (nuevoSaldo <= 0) {
      await repo.updateEstado(client, creditoId, 'Saldado');
    }

    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Saldar manualmente (marcar como saldado sin abono) ───────────────────────
const saldarCredito = async (negocioId, creditoId) => {
  const credito = await repo.findByIdYNegocio(creditoId, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  if (credito.estado === 'Saldado') throw { status: 400, message: 'El crédito ya está saldado' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.updateEstado(client, creditoId, 'Saldado');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Cancelar crédito (cancela crédito + factura + devuelve stock) ─────────────
const cancelarCredito = async (negocioId, creditoId) => {
  const credito = await repo.findByIdYNegocio(creditoId, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  if (credito.estado === 'Cancelado') throw { status: 400, message: 'El crédito ya está cancelado' };

  // Reutilizar la lógica existente de cancelar factura
  const facturasService = require('../facturas/facturas.service');
  await facturasService.cancelarFactura(negocioId, credito.factura_id, false);

  // Marcar el crédito como cancelado
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.updateEstado(client, creditoId, 'Cancelado');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { getCreditos, getCreditoById, registrarAbono, saldarCredito, cancelarCredito };