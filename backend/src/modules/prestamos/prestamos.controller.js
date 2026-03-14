const service = require('./prestamos.service');

const getPrestamos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getPrestamos(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getPrestamoById = async (req, res, next) => {
  try {
    const data = await service.getPrestamoById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearPrestamo = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;

    if (!sucursal_id) {
      return res.status(400).json({
        ok: false,
        error: 'Debes indicar la sucursal donde se registra el préstamo',
      });
    }

    const data = await service.crearPrestamo({
      ...req.body,
      sucursal_id,
      usuario_id:  req.user.id,
      negocio_id:  req.user.negocio_id,   // ← agregar
    });
    res.status(201).json({ ok: true, data, message: 'Préstamo registrado correctamente' });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const { valor } = req.body;
    if (!valor || valor <= 0) {
      return res.status(400).json({ ok: false, error: 'El valor del abono debe ser mayor a 0' });
    }
    const data = await service.registrarAbono(req.user.negocio_id, req.params.id, valor);
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const devolverPrestamo = async (req, res, next) => {
  try {
    await service.devolverPrestamo(req.user.negocio_id, req.params.id);
    res.json({ ok: true, message: 'Préstamo marcado como devuelto' });
  } catch (err) { next(err); }
};

module.exports = {
  getPrestamos, getPrestamoById, crearPrestamo, registrarAbono, devolverPrestamo,
};