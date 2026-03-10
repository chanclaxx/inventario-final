const { pool } = require('../../config/db');
const repo = require('./creditos.repository');

const getCreditos = (sucursalId) => repo.findAll(sucursalId);

const getCreditoById = async (negocioId, id) => {
  const valido = await repo.perteneceAlNegocio(id, negocioId);
  if (!valido) throw { status: 404, message: 'Crédito no encontrado' };
  const credito = await repo.findById(id);
  const abonos  = await repo.getAbonos(id);
  return { ...credito, abonos };
};

const registrarAbono = async (negocioId, creditoId, { usuario_id, valor, metodo, notas }) => {
  const valido = await repo.perteneceAlNegocio(creditoId, negocioId);
  if (!valido) throw { status: 404, message: 'Crédito no encontrado' };

  const credito = await repo.findById(creditoId);
  if (credito.estado === 'Saldado') throw { status: 400, message: 'El crédito ya está saldado' };
  if (valor <= 0) throw { status: 400, message: 'El valor del abono debe ser mayor a 0' };

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