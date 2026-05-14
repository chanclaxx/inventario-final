const service = require('./prestatarios.service');

const getPrestatarios = async (req, res, next) => {
  try {
    const data = await service.getPrestatarios(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearPrestatario = async (req, res, next) => {
  try {
    const data = await service.crearPrestatario({
      ...req.body,
      negocio_id: req.user.negocio_id,
    });
    res.status(201).json({ ok: true, data });
  } catch (err) { next(err); }
};

const getEmpleados = async (req, res, next) => {
  try {
    // ← agregar negocio_id
    const data = await service.getEmpleados(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearEmpleado = async (req, res, next) => {
  try {
    // ← agregar negocio_id
    const data = await service.crearEmpleado(req.user.negocio_id, {
      prestatario_id: req.params.id,
      nombre:         req.body.nombre,
    });
    res.status(201).json({ ok: true, data });
  } catch (err) { next(err); }
};

// ─── Cuenta corriente ────────────────────────────────────────────────────────

const getMovimientos = async (req, res, next) => {
  try {
    const data = await service.getMovimientos(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarMovimiento = async (req, res, next) => {
  try {
    // sucursal_id: admin pasa en body, vendedor/supervisor usa la del JWT
    const sucursal_id = req.todasSucursales
      ? req.body.sucursal_id
      : req.sucursal_id;
    const data = await service.registrarMovimiento(
      req.user.negocio_id,
      req.params.id,
      { ...req.body, sucursal_id },
      req.user.id
    );
    res.status(201).json({ ok: true, data });
  } catch (err) { next(err); }
};

const anularMovimiento = async (req, res, next) => {
  try {
    const data = await service.anularMovimiento(
      req.user.negocio_id,
      req.params.id,
      req.params.movId,
      req.user.id,
      req.body.motivo
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getSaldo = async (req, res, next) => {
  try {
    const saldo = await service.getSaldo(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data: { saldo } });
  } catch (err) { next(err); }
};

const getResumen = async (req, res, next) => {
  try {
    const data = await service.getResumen(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getPrestatarios, crearPrestatario, getEmpleados, crearEmpleado,
  getMovimientos, registrarMovimiento, anularMovimiento, getSaldo, getResumen,
};