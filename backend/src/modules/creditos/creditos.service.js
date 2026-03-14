const { pool } = require('../../config/db');
const repo = require('./creditos.repository');

// Recibe negocioId para la vista global
const getCreditos = (sucursalId, negocioId) => repo.findAll(sucursalId, negocioId);

const getCreditoById = async (negocioId, id) => {
  const credito = await repo.findByIdYNegocio(id, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  const abonos = await repo.getAbonos(id);
  return { ...credito, abonos };
};

const registrarAbono = async (negocioId, creditoId, { usuario_id, valor, metodo, notas }) => {
  // ── Una sola query: ownership + datos del crédito ──
  const credito = await repo.findByIdYNegocio(creditoId, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  if (credito.estado === 'Saldado') throw { status: 400, message: 'El crédito ya está saldado' };
  if (valor <= 0) throw { status: 400, message: 'El valor del abono debe ser mayor a 0' };

  // ── Validar que el abono no supere el saldo pendiente ──
  const saldoPendiente = Number(credito.valor_total) - Number(credito.total_abonado);
  if (valor > saldoPendiente) {
    throw { status: 400, message: `El abono supera el saldo pendiente (${saldoPendiente.toFixed(2)})` };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await repo.insertarAbono(client, {
      credito_id: creditoId, usuario_id, valor, metodo: metodo || 'Efectivo', notas,
    });
    if (resultado.total_abonado >= resultado.valor_total) {
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


module.exports = { getCreditos, getCreditoById, registrarAbono };