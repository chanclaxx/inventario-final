const service = require('./procedencia.service');
const costos  = require('../../utils/costos.util');

// La procedencia responde "de quién vino y a cuánto": es el dato reservado
// entero, no un objeto con un campo sensible. Recortarlo dejaría filas en
// blanco, así que con el candado puesto simplemente no existe para quien no
// puede ver costos, igual que hace `getCruceById` con un proveedor ajeno.
const _exigirCostos = async (req, res) => {
  if (await costos.puedeVerCostos(req.user)) return true;
  res.status(403).json({ ok: false, error: 'No tienes permiso para ver la procedencia' });
  return false;
};

const getPorProducto = async (req, res, next) => {
  try {
    if (!(await _exigirCostos(req, res))) return;
    // Un admin que mira "todas las sucursales" ve las compras de todo el
    // negocio: la mercancía de un proveedor entra por donde entre, y quien
    // rastrea un lote malo no quiere que se le esconda media historia.
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getPorProducto(
      req.user.negocio_id,
      Number(req.params.productoId),
      { sucursalId },
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getPorImei = async (req, res, next) => {
  try {
    if (!(await _exigirCostos(req, res))) return;
    const data = await service.getPorImei(req.user.negocio_id, req.params.imei);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { getPorProducto, getPorImei };
