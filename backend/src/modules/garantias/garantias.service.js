const repo = require('./garantias.repository');

const getGarantias = (negocioId) => repo.findAll(negocioId);

const getGarantiaById = async (negocioId, id) => {
  const g = await repo.findById(negocioId, id);
  if (!g) throw { status: 404, message: 'Garantía no encontrada' };
  return g;
};

// ── lineas[] viene del body — verificar que pertenecen al negocio ────────────
const _verificarLineas = async (lineas, negocioId) => {
  if (!lineas?.length) return;
  const { pool } = require('../../config/db');
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total FROM lineas_producto
     WHERE id = ANY($1::int[]) AND negocio_id = $2`,
    [lineas, negocioId]
  );
  if (Number(rows[0].total) !== lineas.length) {
    throw { status: 403, message: 'Una o más líneas no pertenecen a este negocio' };
  }
};

const crearGarantia = async (negocioId, datos) => {
  await _verificarLineas(datos.lineas, negocioId);
  return repo.create(negocioId, datos);
};

const actualizarGarantia = async (negocioId, id, datos) => {
  await _verificarLineas(datos.lineas, negocioId);
  const g = await repo.update(negocioId, id, datos);
  if (!g) throw { status: 404, message: 'Garantía no encontrada' };
  return g;
};

const eliminarGarantia = async (negocioId, id) => {
  const ok = await repo.eliminar(negocioId, id);
  if (!ok) throw { status: 404, message: 'Garantía no encontrada' };
};

const getGarantiasPorFactura = async (negocioId, facturaId) => {
  // ── Verificar que la factura pertenece al negocio ──
  const { pool } = require('../../config/db');
  const { rows } = await pool.query(
    `SELECT f.id FROM facturas f
     JOIN sucursales su ON su.id = f.sucursal_id
     WHERE f.id = $1 AND su.negocio_id = $2`,
    [facturaId, negocioId]
  );
  if (!rows.length) throw { status: 404, message: 'Factura no encontrada' };
  return repo.findPorFactura(facturaId);
};

module.exports = {
  getGarantias, getGarantiaById,
  crearGarantia, actualizarGarantia, eliminarGarantia,
  getGarantiasPorFactura,
};