const repo = require('./inventario.export.repository');

const getInventarioCompleto = async (sucursalId) => {
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