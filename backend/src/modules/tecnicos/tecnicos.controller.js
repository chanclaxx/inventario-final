const service = require('./tecnicos.service');
const audit   = require('../../utils/auditoria.util');
const { puedeTecnicos } = require('../../middlewares/role.middleware');

const _ok = (res, data, extra = {}) => res.json({ ok: true, data, ...extra });

const listarTecnicos = async (req, res, next) => {
  try {
    _ok(res, await service.listarTecnicos(req.user, req.sucursal_id, {
      incluirInactivos: req.query.inactivos === '1',
    }));
  } catch (err) { next(err); }
};

const crearTecnico = async (req, res, next) => {
  try {
    const data = await service.crearTecnico(req.user.negocio_id, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Técnico creado', 'tecnicos', data.id, { nombre: data.nombre });
    res.status(201).json({ ok: true, data, message: 'Técnico creado' });
  } catch (err) { next(err); }
};

const actualizarTecnico = async (req, res, next) => {
  try {
    const data = await service.actualizarTecnico(req.user.negocio_id, req.params.id, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Técnico editado', 'tecnicos', data.id, { nombre: data.nombre });
    _ok(res, data, { message: 'Técnico actualizado' });
  } catch (err) { next(err); }
};

const detalleTecnico = async (req, res, next) => {
  try { _ok(res, await service.detalleTecnico(req.user, req.params.id, req.sucursal_id)); } catch (err) { next(err); }
};

const listarEquipos = async (req, res, next) => {
  try { _ok(res, await service.listarEquipos(req.user, req.sucursal_id, req.query)); } catch (err) { next(err); }
};

const buscarDisponibles = async (req, res, next) => {
  try { _ok(res, await service.buscarDisponibles(req.user.negocio_id, req.sucursal_id, req.query.q)); } catch (err) { next(err); }
};

// Lo que el usuario puede hacer con plata dentro de otras operaciones (el
// anticipo al enviar, el pago al recibir) se decide aquí, con la misma llave
// que la ruta de pagos: si no, enviar con anticipo sería la puerta de atrás.
const _exigirPagarSiHayPlata = (req, ...campos) => {
  const hayPlata = campos.some((c) => req.body[c] && Number(req.body[c].valor) > 0);
  if (hayPlata && !puedeTecnicos(req.user, 'pagar')) {
    throw { status: 403, message: 'No tienes permiso para registrar pagos a técnicos' };
  }
};

const enviar = async (req, res, next) => {
  try {
    _exigirPagarSiHayPlata(req, 'anticipo');
    const data = await service.enviar(req.user, req.sucursal_id, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Equipos enviados a técnico', 'salidas_tecnico', data.salida.id, {
      sucursal_id: req.sucursal_id, tecnico: data.tecnico.nombre,
      equipos: data.equipos.map((e) => e.imei), anticipo: Number(data.anticipo?.valor ?? 0),
    });
    res.status(201).json({ ok: true, data, message: 'Equipos enviados al técnico' });
  } catch (err) { next(err); }
};

const enviarDesdeOrden = async (req, res, next) => {
  try {
    _exigirPagarSiHayPlata(req, 'anticipo');
    const data = await service.enviarDesdeOrden(req.user, req.params.ordenId, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Orden de servicio enviada a técnico', 'salidas_tecnico', data.salida.id, {
      orden_servicio_id: Number(req.params.ordenId), tecnico: data.tecnico.nombre,
    });
    res.status(201).json({ ok: true, data, message: 'Equipo enviado al técnico' });
  } catch (err) { next(err); }
};

const reclamarGarantia = async (req, res, next) => {
  try {
    const data = await service.reclamarGarantia(req.user, req.sucursal_id, req.params.id, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Garantía reclamada a técnico', 'equipos_tecnico', Number(req.params.id), {
      tecnico: data.tecnico.nombre, salida_id: data.salida.id,
    });
    res.status(201).json({ ok: true, data, message: 'Garantía reclamada: el equipo volvió al técnico' });
  } catch (err) { next(err); }
};

const recibir = async (req, res, next) => {
  try {
    const data = await service.recibir(req.user, req.sucursal_id, req.params.id, req.body, {
      puedePagar: puedeTecnicos(req.user, 'pagar'),
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Equipo recibido del técnico', 'equipos_tecnico', data.equipo.id, {
      resultado: data.equipo.estado, costo: Number(data.equipo.costo),
      aplicado_a: data.equipo.costo_aplicado_a, imei: data.equipo.imei,
    });
    _ok(res, data, { message: data.equipo.estado === 'Reparado' ? 'Equipo recibido reparado' : 'Equipo recibido sin reparar' });
  } catch (err) { next(err); }
};

const anularEquipo = async (req, res, next) => {
  try {
    const data = await service.anularEquipo(req.user, req.sucursal_id, req.params.id, req.body.motivo);
    audit.registrar(req.user.negocio_id, req.user.id, 'Envío a técnico anulado', 'equipos_tecnico', data.id, {
      motivo: data.anulado_motivo, imei: data.imei,
    });
    _ok(res, data, { message: 'Envío anulado' });
  } catch (err) { next(err); }
};

const registrarPago = async (req, res, next) => {
  try {
    const data = await service.registrarPago(req.user, req.sucursal_id, req.params.id, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, `Técnico: ${data.pago.tipo}`, 'pagos_tecnico', data.pago.id, {
      sucursal_id: data.pago.sucursal_id, valor: Number(data.pago.valor), metodo: data.pago.metodo,
    });
    res.status(201).json({ ok: true, data, message: 'Movimiento registrado' });
  } catch (err) { next(err); }
};

const pagarPorSucursales = async (req, res, next) => {
  try {
    const data = await service.pagarPorSucursales(req.user, req.params.id, req.body);
    for (const p of data.pagos) {
      audit.registrar(req.user.negocio_id, req.user.id, 'Técnico: Pago', 'pagos_tecnico', p.id, {
        sucursal_id: p.sucursal_id, valor: Number(p.valor), metodo: p.metodo, varias_sucursales: true,
      });
    }
    res.status(201).json({ ok: true, data, message: `${data.pagos.length} pago(s) registrados, uno por sucursal` });
  } catch (err) { next(err); }
};

const anularPago = async (req, res, next) => {
  try {
    const data = await service.anularPago(req.user, req.params.id, req.body.motivo, req.sucursal_id);
    audit.registrar(req.user.negocio_id, req.user.id, 'Pago a técnico anulado', 'pagos_tecnico', data.id, {
      valor: Number(data.valor), motivo: data.anulado_motivo,
    });
    _ok(res, data, { message: 'Pago anulado' });
  } catch (err) { next(err); }
};

const resumenPeriodo = async (req, res, next) => {
  try { _ok(res, await service.resumenPeriodo(req.user, req.sucursal_id, req.query)); } catch (err) { next(err); }
};

module.exports = {
  listarTecnicos, crearTecnico, actualizarTecnico, detalleTecnico,
  listarEquipos, buscarDisponibles,
  enviar, enviarDesdeOrden, reclamarGarantia, recibir, anularEquipo,
  registrarPago, pagarPorSucursales, anularPago, resumenPeriodo,
};
