const service = require('./acreedores.service');

const getAcreedores = async (req, res, next) => {
  try {
    const data = await service.getAcreedores(req.user.negocio_id, req.query.filtro);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Solo acreedores vinculados a cruces — para supervisores
const getAcreedoresCruces = async (req, res, next) => {
  try {
    const data = await service.getAcreedoresCruces(req.user.negocio_id, req.query.filtro);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getAcreedorById = async (req, res, next) => {
  try {
    const data = await service.getAcreedorById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearAcreedor = async (req, res, next) => {
  try {
    const data = await service.crearAcreedor(req.user.negocio_id, req.body);
    res.status(201).json({ ok: true, data, message: 'Acreedor creado correctamente' });
  } catch (err) { next(err); }
};

const registrarMovimiento = async (req, res, next) => {
  try {
    const data = await service.registrarMovimiento(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuario_id: req.user.id,
    });
    res.json({ ok: true, data, message: 'Movimiento registrado correctamente' });
  } catch (err) { next(err); }
};

const eliminarAcreedor = async (req, res, next) => {
  try {
    await service.eliminarAcreedor(req.user.negocio_id, req.params.id);
    res.json({ ok: true, message: 'Acreedor eliminado correctamente' });
  } catch (err) { next(err); }
};

module.exports = {
  getAcreedores, getAcreedoresCruces, getAcreedorById,
  crearAcreedor, registrarMovimiento, eliminarAcreedor,
};