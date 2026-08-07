const service = require('./ordenesCompra.service');
const audit   = require('../../utils/auditoria.util');

// Misma restricción que en compras: un usuario con lista de proveedores
// acotada solo ve las órdenes de los suyos.
const _proveedorIds = (user) => {
  if (user.rol === 'admin_negocio') return null;
  const p = user.permisos_proveedores;
  if (p && !p.ver_todos && Array.isArray(p.ver_lista) && p.ver_lista.length > 0) {
    return p.ver_lista;
  }
  return null;
};

const getOrdenes = async (req, res, next) => {
  try {
    const data = await service.listar(req.user.negocio_id, req.configOrdenes, {
      sucursalId:   req.todasSucursales ? null : req.sucursal_id,
      estado:       req.query.estado       || null,
      proveedorId:  req.query.proveedor_id || null,
      proveedorIds: _proveedorIds(req.user),
      busqueda:     req.query.q            || null,
      // Por defecto solo las vivas: una lista que arrastra años de órdenes
      // cerradas deja de servir para trabajar.
      soloAbiertas: req.query.todas !== '1',
      page:  Math.max(1, Number(req.query.page)  || 1),
      limit: Math.min(100, Number(req.query.limit) || 20),
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getOrdenById = async (req, res, next) => {
  try {
    const data = await service.obtener(req.user.negocio_id, req.configOrdenes, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearOrden = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) {
      return res.status(400).json({ ok: false, error: 'Debes indicar la sucursal de la orden' });
    }

    const data = await service.crear({
      ...req.body,
      negocio_id: req.user.negocio_id,
      sucursal_id,
      usuario_id: req.user.id,
    });

    audit.registrar(req.user.negocio_id, req.user.id, 'Orden de compra creada', 'ordenes_compra', data.id, {
      sucursal_id,
      proveedor_id: req.body.proveedor_id,
      valor:        Number(data.total_estimado ?? 0),
      estado:       data.estado,
    });
    res.status(201).json({ ok: true, data, message: 'Orden de compra creada' });
  } catch (err) { next(err); }
};

const editarOrden = async (req, res, next) => {
  try {
    const data = await service.editar(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuario_id: req.user.id,
    });
    res.json({ ok: true, data, message: 'Orden actualizada' });
  } catch (err) { next(err); }
};

const emitirOrden = async (req, res, next) => {
  try {
    const data = await service.emitir(req.user.negocio_id, req.params.id, { usuario_id: req.user.id });
    audit.registrar(req.user.negocio_id, req.user.id, 'Orden de compra emitida', 'ordenes_compra', data.id, {
      valor: Number(data.total_estimado ?? 0),
    });
    res.json({ ok: true, data, message: 'Orden emitida' });
  } catch (err) { next(err); }
};

const cerrarOrden = async (req, res, next) => {
  try {
    const data = await service.cerrar(req.user.negocio_id, req.params.id, {
      motivo:     req.body?.motivo,
      usuario_id: req.user.id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Orden de compra cerrada', 'ordenes_compra', data.id, {
      motivo: req.body?.motivo ?? null,
    });
    res.json({ ok: true, data, message: 'Orden cerrada' });
  } catch (err) { next(err); }
};

const anularOrden = async (req, res, next) => {
  try {
    const data = await service.anular(req.user.negocio_id, req.params.id, {
      motivo:     req.body?.motivo,
      usuario_id: req.user.id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Orden de compra anulada', 'ordenes_compra', data.id, {
      motivo: req.body?.motivo ?? null,
    });
    res.json({ ok: true, data, message: 'Orden anulada' });
  } catch (err) { next(err); }
};

module.exports = {
  getOrdenes, getOrdenById, crearOrden, editarOrden,
  emitirOrden, cerrarOrden, anularOrden,
};
