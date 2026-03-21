const repo = require('./servicios.repository');

// ─── Lectura ──────────────────────────────────────────────────────────────────

const getOrdenes = (sucursalId, negocioId, filtros) =>
  repo.findAll(sucursalId, negocioId, filtros);

const getOrdenById = async (negocioId, id) => {
  const orden = await repo.findById(negocioId, id);
  if (!orden) throw { status: 404, message: 'Orden no encontrada' };
  const abonos = await repo.getAbonos(negocioId, id);
  return { ...orden, abonos };
};

const getResumenHoy = (sucursalId, negocioId) =>
  repo.getResumenHoy(sucursalId, negocioId);

// ─── Crear ────────────────────────────────────────────────────────────────────

const crearOrden = ({ sucursal_id, negocio_id, usuario_id, ...datos }) => {
  if (!datos.cliente_nombre?.trim())  throw { status: 400, message: 'El nombre del cliente es requerido' };
  if (!datos.falla_reportada?.trim()) throw { status: 400, message: 'La falla reportada es requerida' };
  return repo.create(negocio_id, sucursal_id, usuario_id, datos);
};

// ─── Transiciones de estado ───────────────────────────────────────────────────

const enReparacion = async (negocioId, id) => {
  const orden = await repo.marcarEnReparacion(negocioId, id);
  if (!orden) throw { status: 400, message: 'La orden no está en estado Recibido' };
  return orden;
};

const marcarListo = async (negocioId, id, datos) => {
  const esGarantia = datos.es_garantia === true;

  if (esGarantia) {
    // Garantía cobrable: necesita precio_garantia
    if (!datos.precio_garantia && datos.precio_garantia !== 0)
      throw { status: 400, message: 'El precio de la garantía es requerido' };
    if (Number(datos.precio_garantia) < 0)
      throw { status: 400, message: 'El precio no puede ser negativo' };

    const orden = await repo.marcarListo(negocioId, id, {
      esGarantia:      true,
      precio_garantia: Number(datos.precio_garantia),
      costo_garantia:  datos.costo_garantia != null ? Number(datos.costo_garantia) : null,
      notas_tecnico:   datos.notas_tecnico || null,
    });
    if (!orden) throw { status: 400, message: 'No se puede marcar como lista. Verifica el estado.' };
    return orden;
  }

  // Garantía gratis
  if (datos.es_garantia_gratis === true) {
    const orden = await repo.marcarListoGarantiaGratis(negocioId, id, datos.notas_tecnico || null);
    if (!orden) throw { status: 400, message: 'No se puede marcar como lista. Verifica el estado.' };
    return orden;
  }

  // Reparación normal
  if (datos.precio_final === undefined || datos.precio_final === null || datos.precio_final === '')
    throw { status: 400, message: 'El precio final es requerido' };
  if (Number(datos.precio_final) < 0)
    throw { status: 400, message: 'El precio final no puede ser negativo' };

  const orden = await repo.marcarListo(negocioId, id, {
    esGarantia:    false,
    costo_real:    datos.costo_real != null ? Number(datos.costo_real) : null,
    precio_final:  Number(datos.precio_final),
    notas_tecnico: datos.notas_tecnico || null,
  });
  if (!orden) throw { status: 400, message: 'No se puede marcar como lista. Verifica el estado.' };
  return orden;
};

const registrarAbono = (negocioId, ordenId, datos) => {
  const valor = Number(datos.valor);
  if (!valor || valor <= 0) throw { status: 400, message: 'El valor del abono debe ser mayor a 0' };
  return repo.registrarAbono(negocioId, ordenId, { ...datos, valor });
};

// Entrega: sin forzar — el repo decide si va a Entregado o Pendiente_pago
const entregar = (negocioId, id) =>
  repo.marcarEntregado(negocioId, id);

const sinReparar = (negocioId, id, datos) => {
  if (!datos.motivo) throw { status: 400, message: 'El motivo es requerido' };
  if (datos.precio_diagnostico != null && Number(datos.precio_diagnostico) < 0)
    throw { status: 400, message: 'El precio de diagnóstico no puede ser negativo' };
  return repo.marcarSinReparar(negocioId, id, {
    motivo:             datos.motivo,
    precio_diagnostico: datos.precio_diagnostico ? Number(datos.precio_diagnostico) : null,
    cajaId:             datos.caja_id   || null,
    usuarioId:          datos.usuario_id || null,
  });
};

const abrirGarantia = async (negocioId, id, datos) => {
  const orden = await repo.abrirGarantia(negocioId, id, {
    cobrable:      Boolean(datos.cobrable),
    notas_tecnico: datos.notas_tecnico || null,
  });
  if (!orden) throw { status: 400, message: 'Solo se puede abrir garantía en órdenes Entregadas o Pendiente_pago' };
  return orden;
};

const actualizarNotas = async (negocioId, id, notas_tecnico) => {
  const orden = await repo.actualizarNotas(negocioId, id, notas_tecnico);
  if (!orden) throw { status: 404, message: 'Orden no encontrada' };
  return orden;
};

module.exports = {
  getOrdenes, getOrdenById, getResumenHoy,
  crearOrden, enReparacion, marcarListo,
  registrarAbono, entregar, sinReparar,
  abrirGarantia, actualizarNotas,
};