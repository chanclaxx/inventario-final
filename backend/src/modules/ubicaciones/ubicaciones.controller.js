const service = require('./ubicaciones.service');

const getUbicaciones = async (req, res, next) => {
  try {
    // sucursal_id lo resuelve y valida el middleware resolveSucursal;
    // negocio_id sale del JWT. Ninguno se toma del body.
    const sucursalId = req.sucursal_id;
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });

    const data = await service.getUbicaciones(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { getUbicaciones };
