const { pool } = require('../../config/db');
const repo     = require('./inventario.export.repository');

const getInventarioCompleto = async (sucursalId, negocioId) => {
  // ── Segunda capa: verificar que sucursal pertenece al negocio ──
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursalId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  const [seriales, cantidad] = await Promise.all([
    repo.getSeriales(sucursalId),
    repo.getProductosCantidad(sucursalId),
  ]);

  const porProducto = {};
  for (const s of seriales) {
    if (!porProducto[s.producto]) porProducto[s.producto] = [];
    porProducto[s.producto].push(s);
  }

  return { porProducto, cantidad };
};

module.exports = { getInventarioCompleto };