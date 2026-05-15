const { pool }     = require('../../config/db');
const repo         = require('./inventario.export.repository');
const configRepo   = require('../config/config.repository');

const getInventarioCompleto = async (sucursalId, negocioId) => {
  // ── Segunda capa: verificar que sucursal pertenece al negocio ──
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursalId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  const configMap       = await configRepo.getMap(negocioId);
  const variantesActivo = configMap.variantes_activo === '1';

  const [seriales, cantidad, variantesPorProducto] = await Promise.all([
    repo.getSeriales(sucursalId),
    repo.getProductosCantidad(sucursalId),
    variantesActivo ? repo.getVariantesPorSucursal(sucursalId) : Promise.resolve({}),
  ]);

  const porProducto = {};
  for (const s of seriales) {
    if (!porProducto[s.producto]) porProducto[s.producto] = [];
    porProducto[s.producto].push(s);
  }

  // Adjuntar árbol de atributos/variantes a cada producto de cantidad
  const cantidadEnriquecida = cantidad.map((p) => ({
    ...p,
    atributos: variantesPorProducto[p.id] || [],
  }));

  return { porProducto, cantidad: cantidadEnriquecida };
};

module.exports = { getInventarioCompleto };