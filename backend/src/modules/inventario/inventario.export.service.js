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


// ─────────────────────────────────────────────────────────────────────────────
// Qué costos puede ver quien exporta.
//
// `costo_compra` es lo que el NEGOCIO le pagó a un proveedor externo. Con la red
// interna encendida, en un local ese número es el costo de la BODEGA:
// información comercial de la casa matriz que un local no tiene por qué
// conocer. Solo lo ve `admin_negocio`.
//
// `costo_local` (el valor interno de la remisión) sí es del local —es lo que
// debe— pero sigue mandando `red_interna_ocultar_costos`, activo por defecto:
// con esa opción puesta, un vendedor confirma entregas y remite dinero sin ver
// la valorización de la mercancía.
//
// El recorte va aquí, en el BACKEND: quitar la columna solo del Excel dejaría
// el dato viajando en el JSON de la respuesta.
// ─────────────────────────────────────────────────────────────────────────────
const _recortarCostos = (seriales, { rol, ocultarCostos }) => {
  const esAdmin = rol === 'admin_negocio';
  if (esAdmin) return seriales;

  return seriales.map((s) => {
    const { costo_compra, costo_local, ...resto } = s;
    return ocultarCostos ? resto : { ...resto, costo_local };
  });
};

const getInventarioCompleto = async (sucursalId, negocioId, modo, rol = null) => {
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

  // Ausente = activado: el default seguro es no mostrar costos al que no es admin.
  const ocultarCostos = configMap.red_interna_activa === '1'
    && configMap.red_interna_ocultar_costos !== '0';

  const variantesActivo = configMap.variantes_activo === '1';

  const [serialesCrudos, cantidad, variantesPorProducto] = await Promise.all([
    repo.getSeriales(sucursalId),
    repo.getProductosCantidad(sucursalId),
    variantesActivo ? repo.getVariantesPorSucursal(sucursalId) : Promise.resolve({}),
  ]);

  const seriales = _recortarCostos(serialesCrudos, { rol, ocultarCostos });

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