const repo = require('./procedencia.repository');
const { getConfigOrdenes } = require('../../middlewares/ordenesCompra.middleware');

// ─────────────────────────────────────────────────────────────────────────────
// La procedencia NO está detrás de ningún flag: se calcula sobre historia que
// todos los negocios ya tienen registrada, y responde una pregunta que se hacen
// igual los que llevan órdenes de compra y los que no.
//
// Lo único que depende de configuración es el CHIP de garantía, y solo para
// decidir cuándo avisar — el dato crudo (garantia_dias) sale igual.
// ─────────────────────────────────────────────────────────────────────────────

// Días que faltan para una fecha, en días completos. La fecha llega como DATE
// (medianoche UTC) desde Postgres; se compara contra el hoy de Bogotá para que
// "vence hoy" no se vuelva "venció ayer" a las 7 p.m.
const _hoyBogota = () => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return new Date(`${fmt.format(new Date())}T00:00:00Z`);
};

const _diasHasta = (fecha) => {
  if (!fecha) return null;
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - _hoyBogota().getTime()) / 86400000);
};

/**
 * Estado de la garantía de una entrada, para el semáforo.
 *
 *   sin_garantia → nadie registró plazo (NULL). Gris: no es una alerta.
 *   vigente      → queda margen cómodo
 *   por_vencer   → dentro de la ventana de aviso
 *   vencida      → ya no hay reclamo posible
 *
 * Nunca bloquea nada: es información, no un control.
 */
const _estadoGarantia = (garantiaHasta, diasAviso) => {
  if (!garantiaHasta) return { estado: 'sin_garantia', dias_restantes: null };
  const dias = _diasHasta(garantiaHasta);
  if (dias == null) return { estado: 'sin_garantia', dias_restantes: null };
  if (dias < 0)          return { estado: 'vencida',    dias_restantes: dias };
  if (dias <= diasAviso) return { estado: 'por_vencer', dias_restantes: dias };
  return { estado: 'vigente', dias_restantes: dias };
};

const _decorar = (filas, diasAviso) => filas.map((f) => ({
  ...f,
  ...(_estadoGarantia(f.garantia_hasta, diasAviso)),
}));

/**
 * Procedencia de un producto por cantidad.
 *
 * `sucursalId` acota a la sede de quien pregunta; un admin_negocio que no manda
 * sucursal ve las de todo el negocio, que es como se comporta el resto del
 * módulo de proveedores (el historial de un proveedor es a nivel de negocio).
 */
const getPorProducto = async (negocioId, productoId, { sucursalId = null } = {}) => {
  const producto = await repo.productoDelNegocio(productoId, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  const { garantia_dias_aviso } = await getConfigOrdenes(negocioId);

  const [entradas, porProveedor] = await Promise.all([
    repo.porProducto(negocioId, productoId, {
      todasLasSucursales: sucursalId == null,
      sucursalId,
    }),
    repo.resumenPorProveedor(negocioId, productoId),
  ]);

  return {
    producto,
    entradas:     _decorar(entradas, garantia_dias_aviso),
    proveedores:  porProveedor,
  };
};

/**
 * Procedencia de una unidad con IMEI.
 *
 * `entradas` viene de la más reciente a la más vieja. La garantía VIGENTE es la
 * de la primera: un mismo IMEI puede haber entrado varias veces (retoma,
 * re-import correctivo) y las entradas viejas son historia, no garantías vivas.
 * Se resuelve aquí una sola vez para que ninguna pantalla tenga que acordarse.
 */
const getPorImei = async (negocioId, imeiCrudo) => {
  const imei = String(imeiCrudo || '').trim();
  if (!imei) throw { status: 400, message: 'IMEI requerido' };

  const { garantia_dias_aviso } = await getConfigOrdenes(negocioId);

  const [entradasCrudas, serial] = await Promise.all([
    repo.porImei(negocioId, imei),
    repo.estadoSerial(negocioId, imei),
  ]);

  if (!entradasCrudas.length && !serial) {
    throw { status: 404, message: `El IMEI ${imei} no aparece en el inventario de este negocio` };
  }

  const entradas = _decorar(entradasCrudas, garantia_dias_aviso);

  return {
    imei,
    serial,
    entradas,
    // La entrada que manda hoy. Null si el equipo llegó sin compra (una retoma,
    // por ejemplo): en ese caso no hay proveedor a quien reclamarle.
    entrada_vigente: entradas[0] || null,
  };
};

module.exports = { getPorProducto, getPorImei };
