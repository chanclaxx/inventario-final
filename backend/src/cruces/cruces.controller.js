const service = require('../proveedores/proveedores.service');

const getCruces = async (req, res, next) => {
  try {
    const data = await service.getProveedores(req.user.negocio_id, 'cruce');
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getCruceById = async (req, res, next) => {
  try {
    const data = await service.getProveedorById(req.user.negocio_id, req.params.id);
    // Si no es cruce, devolver 404 para no revelar existencia de proveedores sensibles
    if (data.tipo !== 'cruce') {
      return res.status(404).json({ ok: false, message: 'Cruce no encontrado' });
    }
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearCruce = async (req, res, next) => {
  try {
    // Forzar tipo cruce sin importar lo que envíe el body
    const datos = { ...req.body, tipo: 'cruce' };
    const data = await service.crearProveedor(req.user.negocio_id, datos);
    res.status(201).json({ ok: true, data, message: 'Cruce creado correctamente' });
  } catch (err) { next(err); }
};

module.exports = { getCruces, getCruceById, crearCruce };