const service = require('./compras.service');
const audit   = require('../../utils/auditoria.util');

// Extrae la lista de proveedores permitidos para el usuario (null = sin restricción)
const _proveedorIds = (user) => {
  if (user.rol === 'admin_negocio') return null;
  const p = user.permisos_proveedores;
  if (p && !p.ver_todos && Array.isArray(p.ver_lista) && p.ver_lista.length > 0) {
    return p.ver_lista;
  }
  return null;
};

const getCompras = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getCompras(sucursalId, req.user.negocio_id, _proveedorIds(req.user));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getCompraById = async (req, res, next) => {
  try {
    const data = await service.getCompraById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarCompra = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales
      ? req.body.sucursal_id
      : req.sucursal_id;

    if (!sucursal_id) {
      return res.status(400).json({
        ok: false,
        error: 'Debes indicar la sucursal donde se registra la compra',
      });
    }

    const data = await service.registrarCompra({
      ...req.body,
      negocio_id:  req.user.negocio_id,
      sucursal_id,
      usuario_id:  req.user.id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Compra registrada', 'compras', data.id, {
      sucursal_id,
      valor:           Number(data.total ?? 0),
      proveedor_id:    req.body.proveedor_id,
      numero_factura:  req.body.numero_factura ?? null,
      metodo:          req.body.metodo ?? null,
      estado:          data.estado,
    });
    res.status(201).json({ ok: true, data, message: 'Compra registrada correctamente' });
  } catch (err) { next(err); }
};

const getComprasByProveedor = async (req, res, next) => {
  try {
    // Validar que el proveedor solicitado esté dentro de la lista permitida
    const ids = _proveedorIds(req.user);
    if (ids !== null && !ids.includes(Number(req.params.proveedorId))) {
      return res.status(403).json({ ok: false, error: 'Sin acceso a las compras de este proveedor' });
    }
    // El historial de un proveedor es a nivel de negocio, no de sucursal:
    // un supervisor debe ver TODAS las compras de sus proveedores asignados
    // independientemente de qué sucursal registró la compra.
    const data = await service.getComprasByProveedor(
      req.params.proveedorId,
      null,
      req.user.negocio_id,
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getComprasPaginadas = async (req, res, next) => {
  try {
    const ids = _proveedorIds(req.user);
    // Usuarios con ver_lista ven compras de sus proveedores en todo el negocio
    const sucursalId = ids !== null ? null : (req.todasSucursales ? null : req.sucursal_id);
    const { page, limit, busqueda, fechaDesde, fechaHasta, metodo, estado } = req.query;
    const data = await service.getComprasPaginadas(sucursalId, req.user.negocio_id, {
      page:         parseInt(page)  || 1,
      limit:        parseInt(limit) || 20,
      busqueda:     busqueda   || null,
      fechaDesde:   fechaDesde || null,
      fechaHasta:   fechaHasta || null,
      metodo:       metodo     || null,
      estado:       estado     || null,
      proveedorIds: ids,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const cancelarCompra = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ ok: false, error: 'ID de compra inválido' });
    }
    const data = await service.cancelarCompra(req.user.negocio_id, id);
    res.json({ ok: true, data, message: 'Compra cancelada correctamente' });
  } catch (err) { next(err); }
};

const devolverCompra = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ ok: false, error: 'ID de compra inválido' });
    }
    const data = await service.devolverCompra(req.user.negocio_id, id, {
      lineas:     req.body.lineas,
      motivo:     req.body.motivo,
      usuario_id: req.user.id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Devolución a proveedor', 'compras', id, {
      valor:   Number(data.valor_devuelto ?? 0),
      lineas:  data.detalle?.length ?? 0,
      motivo:  req.body.motivo ?? null,
    });
    res.json({ ok: true, data, message: 'Devolución registrada correctamente' });
  } catch (err) { next(err); }
};

module.exports = { getCompras, getCompraById, getComprasByProveedor, registrarCompra, getComprasPaginadas, cancelarCompra, devolverCompra };