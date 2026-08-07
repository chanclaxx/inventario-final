const service = require('./acreedores.service');

// Proveedores que el usuario tiene permitido ver (null = sin restricción).
// Misma regla que en compras y órdenes: un usuario con la lista acotada no ve
// las facturas de proveedores que no le tocan.
const _proveedorIds = (user) => {
  if (user.rol === 'admin_negocio') return null;
  const p = user.permisos_proveedores;
  if (p && !p.ver_todos && Array.isArray(p.ver_lista) && p.ver_lista.length > 0) {
    return p.ver_lista;
  }
  return null;
};

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
      usuario_id:  req.user.id,
      sucursal_id: req.sucursal_id,
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
      sucursal_id:       req.sucursal_id,
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

// Facturas de proveedor con plazo. Solo lectura y solo agrega: si la feature
// está apagada la consulta devuelve la lista vacía porque ningún cargo tiene
// vencimiento, así que no hace falta candado extra aquí.
const getFacturasPorVencer = async (req, res, next) => {
  try {
    const data = await service.getFacturasPorVencer(req.user.negocio_id, {
      sucursalId:     req.todasSucursales ? null : req.sucursal_id,
      incluirPagadas: req.query.pagadas === '1',
      // Las que se registraron sin plazo, para poder ponérselo después.
      soloSinPlazo:   req.query.sin_plazo === '1',
      proveedorIds:   _proveedorIds(req.user),
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const ponerPlazoACargo = async (req, res, next) => {
  try {
    const data = await service.ponerPlazoACargo(
      req.user.negocio_id,
      Number(req.params.cargoId),
      req.body,
    );
    res.json({ ok: true, data, message: 'Plazo actualizado' });
  } catch (err) { next(err); }
};

module.exports = {
  getFacturasPorVencer, ponerPlazoACargo,
  getAcreedores, getAcreedoresCruces, getAcreedorById,
  crearAcreedor, registrarMovimiento, getCargosAbiertos,
  getComprasConSaldo, getAbonosPorCargo,
  getSaldoAFavor, aplicarSaldoAFavor,
  registrarAbonoTotal,
  editarAbono, eliminarAbono,
  eliminarAcreedor, getHistorial,
};