const service = require('./proveedores.service');

const getProveedores = async (req, res, next) => {
  try {
    // Sanitizar: solo valores válidos de tipo
    const tiposPermitidos = ['proveedor', 'cruce'];
    const tipo = tiposPermitidos.includes(req.query.tipo) ? req.query.tipo : null;
    const data = await service.getProveedores(req.user.negocio_id, tipo);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProveedorById = async (req, res, next) => {
  try {
    const data = await service.getProveedorById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearProveedor = async (req, res, next) => {
  try {
    const data = await service.crearProveedor(req.user.negocio_id, req.body);
    res.status(201).json({ ok: true, data, message: 'Proveedor creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarProveedor = async (req, res, next) => {
  try {
    const data = await service.actualizarProveedor(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Proveedor actualizado correctamente' });
  } catch (err) { next(err); }
};

const eliminarProveedor = async (req, res, next) => {
  try {
    await service.eliminarProveedor(req.user.negocio_id, req.params.id);
    res.json({ ok: true, message: 'Proveedor eliminado correctamente' });
  } catch (err) { next(err); }
};

module.exports = { getProveedores, getProveedorById, crearProveedor, actualizarProveedor, eliminarProveedor };