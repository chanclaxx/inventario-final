const service = require('./caja.service');

const getCajaActiva = async (req, res, next) => {
  try {
    const data = await service.getCajaActiva(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const abrirCaja = async (req, res, next) => {
  try {
    const data = await service.abrirCaja({
      ...req.body,
      sucursal_id: req.sucursal_id,
      usuario_id:  req.user.id,
    });
    res.status(201).json({ ok: true, data, message: 'Caja abierta correctamente' });
  } catch (err) { next(err); }
};

const cerrarCaja = async (req, res, next) => {
  try {
    const data = await service.cerrarCaja(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Caja cerrada correctamente' });
  } catch (err) { next(err); }
};

const getMovimientos = async (req, res, next) => {
  try {
    const data = await service.getMovimientos(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getResumenDia = async (req, res, next) => {
  try {
    const data = await service.getResumenDia(req.user.negocio_id, req.params.id, req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarMovimiento = async (req, res, next) => {
  try {
    const data = await service.registrarMovimiento(req.user.negocio_id, req.params.id, {
      ...req.body,
      usuario_id: req.user.id,
    });
    res.status(201).json({ ok: true, data, message: 'Movimiento registrado' });
  } catch (err) { next(err); }
};

module.exports = { getCajaActiva, abrirCaja, cerrarCaja, getMovimientos, getResumenDia, registrarMovimiento };