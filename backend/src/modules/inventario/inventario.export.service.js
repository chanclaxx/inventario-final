const { pool }     = require('../../config/db');
const repo         = require('./inventario.export.repository');
const configRepo   = require('../config/config.repository');

// Agrupa seriales por línea, con "Sin Línea" para los que no tienen.
const agruparPorLinea = (seriales) => {
  const porLinea = {};
  for (const s of seriales) {
    const linea = s.linea || 'Sin Línea';
    if (!porLinea[linea]) porLinea[linea] = [];
    porLinea[linea].push(s);
  }
  return porLinea;
};

const getInventarioCompleto = async (sucursalId, negocioId, modo) => {
  // ── Segunda capa: verificar que sucursal pertenece al negocio ──
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursalId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  const configMap = await configRepo.getMap(negocioId);

  // ── Modo "líneas": solo seriales agrupados por línea ──
  // El Excel por líneas no usa los productos de cantidad, ni las variantes, ni el
  // detalle de ventas por IMEI. Pedir todo eso para descartarlo era lo que hacía
  // fallar la exportación por timeout en negocios con muchos seriales.
  if (modo === 'lineas') {
    const seriales = await repo.getSerialesLineas(sucursalId);
    return { porLinea: agruparPorLinea(seriales), configMap };
  }

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
  const porLinea = agruparPorLinea(seriales);

  // Adjuntar árbol de atributos/variantes a cada producto de cantidad
  const cantidadEnriquecida = cantidad.map((p) => ({
    ...p,
    atributos: variantesPorProducto[p.id] || [],
  }));

  return { porProducto, porLinea, cantidad: cantidadEnriquecida, configMap };
};

const getInventarioPorLineasNegocio = async (negocioId) => {
  const configMap = await configRepo.getMap(negocioId);
  const seriales  = await repo.getSerialesTodas(negocioId);

  return { porLinea: agruparPorLinea(seriales), configMap };
};

module.exports = { getInventarioCompleto, getInventarioPorLineasNegocio };