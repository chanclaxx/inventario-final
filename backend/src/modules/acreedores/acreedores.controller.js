const service = require('./acreedores.service');

const getAcreedores = async (req, res, next) => {
  try {
    const { negocio_id, rol, permisos_proveedores } = req.user;
    const filtro = req.query.filtro;
    const data = rol === 'admin_negocio'
      ? await service.getAcreedores(negocio_id, filtro)
      : await service.getAcreedoresParaUsuario(negocio_id, permisos_proveedores, filtro);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

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

const getCargosAbiertos = async (req, res, next) => {
  try {
    const data = await service.getCargosAbiertos(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getComprasConSaldo = async (req, res, next) => {
  try {
    const data = await service.getComprasConSaldo(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getAbonosPorCargo = async (req, res, next) => {
  try {
    const data = await service.getAbonosPorCargo(req.user.negocio_id, req.params.id, req.params.cargoId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getSaldoAFavor = async (req, res, next) => {
  try {
    const data = await service.getSaldoAFavor(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const aplicarSaldoAFavor = async (req, res, next) => {
  try {
    await service.aplicarSaldoAFavor(
      req.user.negocio_id, req.params.id,
      Number(req.body.cargo_id), Number(req.body.valor),
    );
    res.json({ ok: true, message: 'Saldo a favor aplicado correctamente' });
  } catch (err) { next(err); }
};

const registrarAbonoTotal = async (req, res, next) => {
  try {
    const data = await service.registrarAbonoTotal(req.user.negocio_id, req.params.id, {
      valor:             req.body.valor,
      metodo:            req.body.metodo,
      registrar_en_caja: req.body.registrar_en_caja,
      usuario_id:        req.user.id,
    });
    res.json({ ok: true, data, message: 'Pago total registrado correctamente' });
  } catch (err) { next(err); }
};

const eliminarAcreedor = async (req, res, next) => {
  try {
    await service.eliminarAcreedor(req.user.negocio_id, req.params.id);
    res.json({ ok: true, message: 'Acreedor eliminado correctamente' });
  } catch (err) { next(err); }
};

const editarAbono = async (req, res, next) => {
  try {
    const data = await service.editarAbono(
      req.user.negocio_id, req.params.id, req.params.movId, req.body,
    );
    res.json({ ok: true, data, message: 'Abono actualizado correctamente' });
  } catch (err) { next(err); }
};

const eliminarAbono = async (req, res, next) => {
  try {
    await service.eliminarAbono(req.user.negocio_id, req.params.id, req.params.movId);
    res.json({ ok: true, message: 'Abono eliminado correctamente' });
  } catch (err) { next(err); }
};

const getHistorial = async (req, res, next) => {
  try {
    const data = await service.getHistorial(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getAcreedores, getAcreedoresCruces, getAcreedorById,
  crearAcreedor, registrarMovimiento, getCargosAbiertos,
  getComprasConSaldo, getAbonosPorCargo,
  getSaldoAFavor, aplicarSaldoAFavor,
  registrarAbonoTotal,
  editarAbono, eliminarAbono,
  eliminarAcreedor, getHistorial,
};