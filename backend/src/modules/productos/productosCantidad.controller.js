const service = require('./productosCantidad.service');
const audit   = require('../../utils/auditoria.util');

const getProductos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    // ── lineaId opcional desde query param ──
    const lineaId = req.query.linea_id ? Number(req.query.linea_id) : null;
    const data = await service.getProductos(sucursalId, req.user.negocio_id, lineaId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProductoById = async (req, res, next) => {
  try {
    const data = await service.getProductoById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearProducto = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) {
      return res.status(400).json({ ok: false, error: 'Debes indicar la sucursal destino del producto' });
    }
    const data = await service.crearProducto(req.user.negocio_id, { ...req.body, sucursal_id });
    audit.registrar(req.user.negocio_id, req.user.id, 'Producto cantidad creado', 'productos_cantidad', data.id, {
      sucursal_id,
      producto: data.nombre,
      precio:   Number(data.precio_venta ?? 0),
    });
    res.status(201).json({ ok: true, data, message: 'Producto creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarProducto = async (req, res, next) => {
  try {
    const anterior = await service.getProductoById(req.user.negocio_id, req.params.id);
    const data     = await service.actualizarProducto(req.user.negocio_id, req.params.id, req.body);
    const cambios  = {};
    if (req.body.precio_venta !== undefined &&
        Number(req.body.precio_venta) !== Number(anterior.precio_venta)) {
      cambios.precio_anterior = Number(anterior.precio_venta);
      cambios.precio_nuevo    = Number(req.body.precio_venta);
    }
    audit.registrar(req.user.negocio_id, req.user.id, 'Producto cantidad editado', 'productos_cantidad', data.id, {
      sucursal_id: anterior.sucursal_id,
      producto:    data.nombre,
      ...cambios,
    });
    res.json({ ok: true, data, message: 'Producto actualizado correctamente' });
  } catch (err) { next(err); }
};

const ajustarStock = async (req, res, next) => {
  try {
    const {
      cantidad, costo_unitario, proveedor_id,
      cliente_origen, cedula_cliente, tipo, notas,
    } = req.body;

    if (cantidad === undefined) {
      return res.status(400).json({ ok: false, error: 'La cantidad es requerida' });
    }

    const data = await service.ajustarStock(
      req.user.negocio_id, req.params.id, cantidad,
      { costo_unitario, proveedor_id, cliente_origen, cedula_cliente, tipo, notas },
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Ajuste de stock', 'productos_cantidad', Number(req.params.id), {
      sucursal_id: data.sucursal_id ?? null,
      producto:    data.nombre ?? null,
      tipo:        tipo ?? null,
      cantidad:    Number(cantidad),
      notas:       notas ?? null,
    });
    res.json({ ok: true, data, message: 'Stock actualizado correctamente' });
  } catch (err) { next(err); }
};

const eliminarProducto = async (req, res, next) => {
  try {
    const prev = await service.getProductoById(req.user.negocio_id, req.params.id).catch(() => null);
    await service.eliminarProducto(req.user.negocio_id, req.params.id);
    audit.registrar(req.user.negocio_id, req.user.id, 'Producto cantidad eliminado', 'productos_cantidad', Number(req.params.id), {
      sucursal_id: prev?.sucursal_id ?? null,
      producto:    prev?.nombre      ?? null,
    });
    res.json({ ok: true, message: 'Producto eliminado correctamente' });
  } catch (err) { next(err); }
};

const getHistorialStock = async (req, res, next) => {
  try {
    const q    = req.query.q || '';
    const data = await service.getHistorialStock(req.user.negocio_id, q);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getProductos, getProductoById, crearProducto,
  actualizarProducto, ajustarStock, eliminarProducto, getHistorialStock,
};