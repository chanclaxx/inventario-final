const repo = require('./servicios.repository');
const tecnicosSrv = require('./servicios.tecnicos');
const { pool } = require('../../config/db');
const { hayTecnicos } = require('../../config/columnas');

// Una orden cuyo equipo está donde un técnico externo no puede darse por lista,
// entregarse ni cerrarse: el equipo no está en el local. Sin las tablas de
// técnicos no hay nada que mirar.
const _exigirEquipoEnLocal = async (negocioId, ordenId) => {
  if (!hayTecnicos()) return;
  const { rows } = await pool.query(`
    SELECT t.nombre FROM equipos_tecnico e JOIN tecnicos t ON t.id = e.tecnico_id
    WHERE e.orden_servicio_id = $1 AND e.negocio_id = $2 AND e.estado = 'En_tecnico'
    LIMIT 1
  `, [ordenId, negocioId]);
  if (rows.length) {
    throw {
      status: 409, code: 'EQUIPO_EN_TECNICO',
      message: `El equipo de esta orden está donde el técnico ${rows[0].nombre}. Recíbelo primero en Servicios → Técnicos.`,
    };
  }
};

const METODO_MAX = 30; // abonos_servicio.metodo es varchar(30)
const _metodo = (m) => {
  const v = String(m ?? '').trim();
  if (!v) return 'Efectivo';
  if (v.length > METODO_MAX) throw { status: 400, message: 'Método de pago inválido' };
  return v;
};

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
  let abono = null;
  if (datos.abono_inicial && datos.abono_inicial.valor !== undefined && datos.abono_inicial.valor !== null
      && datos.abono_inicial.valor !== '') {
    const valor = Number(datos.abono_inicial.valor);
    if (!Number.isFinite(valor) || valor < 0) throw { status: 400, message: 'El abono inicial no es válido' };
    if (valor > 0) {
      abono = {
        valor: Math.round(valor * 100) / 100,
        metodo: _metodo(datos.abono_inicial.metodo),
        notas: datos.abono_inicial.notas ? String(datos.abono_inicial.notas).slice(0, 300) : null,
      };
    }
  }
  return repo.create(negocio_id, sucursal_id, usuario_id, { ...datos, abono_inicial: abono });
};

// ─── Transiciones de estado ───────────────────────────────────────────────────

const enReparacion = async (negocioId, id, datos = {}) => {
  const orden = await repo.marcarEnReparacion(negocioId, id, { tecnico_id: datos.tecnico_id });
  if (!orden) throw { status: 400, message: 'La orden no está en estado Recibido' };
  return orden;
};

const asignarTecnico = (negocioId, id, tecnicoId) => repo.asignarTecnico(negocioId, id, tecnicoId);

/** `{ metodo }` de la devolución, si la pantalla la confirmó. */
const _devolucion = (d) => (d && typeof d === 'object'
  ? { metodo: _metodo(d.metodo), notas: d.notas ? String(d.notas).slice(0, 300) : null }
  : null);

const marcarListo = async (negocioId, id, datos) => {
  await _exigirEquipoEnLocal(negocioId, id);
  const esGarantia = datos.es_garantia === true;
  const comunes = {
    notas_tecnico: datos.notas_tecnico || null,
    tecnico_id:    datos.tecnico_id,
    devolucion:    _devolucion(datos.devolucion),
    usuarioId:     datos.usuario_id || null,
  };

  if (esGarantia) {
    // Garantía cobrable: necesita precio_garantia
    if (!datos.precio_garantia && datos.precio_garantia !== 0)
      throw { status: 400, message: 'El precio de la garantía es requerido' };
    if (Number(datos.precio_garantia) < 0)
      throw { status: 400, message: 'El precio no puede ser negativo' };

    const orden = await repo.marcarListo(negocioId, id, {
      ...comunes,
      esGarantia:      true,
      precio_garantia: Number(datos.precio_garantia),
      costo_garantia:  datos.costo_garantia != null ? Number(datos.costo_garantia) : null,
    });
    if (!orden) throw { status: 400, message: 'No se puede marcar como lista. Verifica el estado.' };
    return orden;
  }

  // Garantía gratis
  if (datos.es_garantia_gratis === true) {
    const orden = await repo.marcarListo(negocioId, id, { ...comunes, esGarantiaGratis: true });
    if (!orden) throw { status: 400, message: 'No se puede marcar como lista. Verifica el estado.' };
    return orden;
  }

  // Reparación normal
  if (datos.precio_final === undefined || datos.precio_final === null || datos.precio_final === '')
    throw { status: 400, message: 'El precio final es requerido' };
  if (Number(datos.precio_final) < 0)
    throw { status: 400, message: 'El precio final no puede ser negativo' };

  const orden = await repo.marcarListo(negocioId, id, {
    ...comunes,
    esGarantia:    false,
    costo_real:    datos.costo_real != null ? Number(datos.costo_real) : null,
    precio_final:  Number(datos.precio_final),
  });
  if (!orden) throw { status: 400, message: 'No se puede marcar como lista. Verifica el estado.' };
  return orden;
};

const registrarAbono = (negocioId, ordenId, datos) => {
  const valor = Number(datos.valor);
  if (!valor || valor <= 0) throw { status: 400, message: 'El valor del abono debe ser mayor a 0' };
  return repo.registrarAbono(negocioId, ordenId, {
    ...datos, valor: Math.round(valor * 100) / 100, metodo: _metodo(datos.metodo),
  });
};

const anularAbono = (negocioId, ordenId, abonoId, { motivo, usuarioId }) => {
  const m = String(motivo ?? '').trim();
  if (m.length < 3) throw { status: 400, message: 'Escribe el motivo de la anulación' };
  return repo.anularAbono(negocioId, Number(ordenId), Number(abonoId), { motivo: m.slice(0, 300), usuarioId });
};

// Entrega: sin forzar — el repo decide si va a Entregado o Pendiente_pago
const entregar = async (negocioId, id) => {
  await _exigirEquipoEnLocal(negocioId, id);
  return repo.marcarEntregado(negocioId, id);
};

const sinReparar = async (negocioId, id, datos) => {
  await _exigirEquipoEnLocal(negocioId, id);
  if (!datos.motivo) throw { status: 400, message: 'El motivo es requerido' };
  if (datos.precio_diagnostico != null && Number(datos.precio_diagnostico) < 0)
    throw { status: 400, message: 'El precio de diagnóstico no puede ser negativo' };
  return repo.marcarSinReparar(negocioId, id, {
    motivo:             datos.motivo,
    precio_diagnostico: datos.precio_diagnostico ? Number(datos.precio_diagnostico) : null,
    usuarioId:          datos.usuario_id || null,
    metodo:             _metodo(datos.metodo),
    metodo_devolucion:  datos.metodo_devolucion ? _metodo(datos.metodo_devolucion) : null,
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

// ─── Técnicos internos ───────────────────────────────────────────────────────

const getTecnicos = async (negocioId, { sucursalId, todos }) => ({
  activa: await tecnicosSrv.activos(negocioId),
  tecnicos: await tecnicosSrv.listar(negocioId, { sucursalId, todos }),
});

module.exports = {
  getOrdenes, getOrdenById, getResumenHoy,
  crearOrden, enReparacion, marcarListo, asignarTecnico,
  registrarAbono, anularAbono, entregar, sinReparar,
  abrirGarantia, actualizarNotas,
  getTecnicos,
  crearTecnico: tecnicosSrv.crear,
  actualizarTecnico: tecnicosSrv.actualizar,
};
