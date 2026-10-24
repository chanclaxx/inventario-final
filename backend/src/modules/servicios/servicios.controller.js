const service = require('./servicios.service');
const audit   = require('../../utils/auditoria.util');

const getOrdenes = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getOrdenes(sucursalId, req.user.negocio_id, req.query);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getOrdenById = async (req, res, next) => {
  try {
    const data = await service.getOrdenById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getResumenHoy = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getResumenHoy(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearOrden = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });
    const data = await service.crearOrden({
      ...req.body,
      sucursal_id,
      negocio_id: req.user.negocio_id,
      usuario_id: req.user.id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Orden de servicio creada', 'servicios', data.id, {
      sucursal_id,
      cliente:    req.body.nombre_cliente ?? null,
      equipo:     req.body.equipo         ?? null,
      valor:      Number(data.valor_servicio ?? 0),
    });
    res.status(201).json({ ok: true, data, message: 'Orden creada correctamente' });
  } catch (err) { next(err); }
};

const enReparacion = async (req, res, next) => {
  try {
    const data = await service.enReparacion(req.user.negocio_id, req.params.id, req.body || {});
    audit.registrar(req.user.negocio_id, req.user.id, 'Orden pasada a reparación', 'servicios', Number(req.params.id), {
      sucursal_id: data.sucursal_id ?? null,
      cliente:     data.nombre_cliente ?? null,
      equipo:      data.equipo ?? null,
    });
    res.json({ ok: true, data, message: 'Orden en reparación' });
  } catch (err) { next(err); }
};

const marcarListo = async (req, res, next) => {
  try {
    const data = await service.marcarListo(req.user.negocio_id, req.params.id, { ...req.body, usuario_id: req.user.id });
    audit.registrar(req.user.negocio_id, req.user.id, 'Orden lista para entrega', 'servicios', Number(req.params.id), {
      sucursal_id: data.sucursal_id ?? null,
    });
    res.json({ ok: true, data, message: 'Orden marcada como lista' });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const data = await service.registrarAbono(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuarioId: req.user.id,
      cajaId:    req.caja_id || null,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Abono a servicio', 'servicios', Number(req.params.id), {
      sucursal_id: data.sucursal_id ?? null,
      monto:       Number(req.body.valor ?? 0),
      metodo:      req.body.metodo ?? null,
    });
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const anularAbono = async (req, res, next) => {
  try {
    const data = await service.anularAbono(req.user.negocio_id, req.params.id, req.params.abonoId, {
      motivo: req.body?.motivo, usuarioId: req.user.id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Abono de servicio anulado', 'servicios', Number(req.params.id), {
      sucursal_id: data.orden?.sucursal_id ?? null,
      abono_id:    Number(req.params.abonoId),
      valor:       Number(data.abono?.valor ?? 0),
      motivo:      req.body?.motivo ?? null,
    });
    res.json({ ok: true, data, message: 'Abono anulado' });
  } catch (err) { next(err); }
};

const asignarTecnico = async (req, res, next) => {
  try {
    const data = await service.asignarTecnico(req.user.negocio_id, req.params.id, req.body?.tecnico_id ?? null);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ─── Técnicos internos ───────────────────────────────────────────────────────

const getTecnicos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getTecnicos(req.user.negocio_id, {
      sucursalId, todos: req.query.todos === '1',
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearTecnico = async (req, res, next) => {
  try {
    const data = await service.crearTecnico(req.user.negocio_id, req.body || {});
    audit.registrar(req.user.negocio_id, req.user.id, 'Técnico de servicio creado', 'servicios', data.id, { nombre: data.nombre });
    res.status(201).json({ ok: true, data });
  } catch (err) { next(err); }
};

const actualizarTecnico = async (req, res, next) => {
  try {
    const data = await service.actualizarTecnico(req.user.negocio_id, Number(req.params.tecnicoId), req.body || {});
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const entregar = async (req, res, next) => {
  try {
    const data = await service.entregar(req.user.negocio_id, req.params.id);
    audit.registrar(req.user.negocio_id, req.user.id, 'Equipo de servicio entregado', 'servicios', Number(req.params.id), {
      sucursal_id:     data.sucursal_id ?? null,
      cliente:         data.nombre_cliente ?? null,
      equipo:          data.equipo ?? null,
      saldo_pendiente: Number(data.saldo_al_entregar ?? 0),
    });
    const msg = data.estado === 'Pendiente_pago'
      ? `Equipo entregado con saldo pendiente de $${Number(data.saldo_al_entregar || 0).toLocaleString('es-CO')}`
      : 'Equipo entregado correctamente';
    res.json({ ok: true, data, message: msg });
  } catch (err) { next(err); }
};

const sinReparar = async (req, res, next) => {
  try {
    const data = await service.sinReparar(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuario_id: req.user.id,
      caja_id:    req.caja_id || null,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Orden cerrada sin reparación', 'servicios', Number(req.params.id), {
      sucursal_id: data.sucursal_id ?? null,
      cliente:     data.nombre_cliente ?? null,
      equipo:      data.equipo ?? null,
    });
    res.json({ ok: true, data, message: 'Orden cerrada sin reparación' });
  } catch (err) { next(err); }
};

const abrirGarantia = async (req, res, next) => {
  try {
    const data = await service.abrirGarantia(req.user.negocio_id, req.params.id, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Garantía de servicio activada', 'servicios', Number(req.params.id), {
      sucursal_id: data.sucursal_id ?? null,
      cliente:     data.nombre_cliente ?? null,
      equipo:      data.equipo ?? null,
    });
    res.json({ ok: true, data, message: 'Garantía activada' });
  } catch (err) { next(err); }
};

const actualizarNotas = async (req, res, next) => {
  try {
    const data = await service.actualizarNotas(
      req.user.negocio_id, req.params.id, req.body.notas_tecnico
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getOrdenes, getOrdenById, getResumenHoy,
  crearOrden, enReparacion, marcarListo,
  registrarAbono, anularAbono, asignarTecnico, entregar, sinReparar,
  abrirGarantia, actualizarNotas,
  getTecnicos, crearTecnico, actualizarTecnico,
};