const repo = require('./ubicaciones.repository');

// Catálogo de ubicaciones de la sucursal activa. Alimenta el autocompletado al
// escribir una ubicación y el filtro "ver todo lo del Estante A-3".
const getUbicaciones = (sucursalId, negocioId) =>
  repo.listarPorSucursal(sucursalId, negocioId);

module.exports = { getUbicaciones };
