const service = require('./productosCantidad.service');

const getProductos = async (req, res, next) => {
  try {
    // Vista global si admin pidió "todas", vista sucursal en cualquier otro caso
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getProductos(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProductoById = async (req, res, next) => {
  try {
    // ← agregar negocio_id
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
    // ← agregar negocio_id al service
    const data = await service.crearProducto(req.user.negocio_id, { ...req.body, sucursal_id });
    res.status(201).json({ ok: true, data, message: 'Producto creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarProducto = async (req, res, next) => {
  try {
    const data = await service.actualizarProducto(req.user.negocio_id, req.params.id, req.body);
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
      req.user.negocio_id,
      req.params.id,
      cantidad,
      { costo_unitario, proveedor_id, cliente_origen, cedula_cliente, tipo, notas },
    );
    res.json({ ok: true, data, message: 'Stock actualizado correctamente' });
  } catch (err) { next(err); }
};
 

const eliminarProducto = async (req, res, next) => {
  try {
    await service.eliminarProducto(req.user.negocio_id, req.params.id);
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
  actualizarProducto, ajustarStock, eliminarProducto,getHistorialStock
};