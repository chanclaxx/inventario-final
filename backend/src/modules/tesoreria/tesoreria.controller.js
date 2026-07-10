const service = require('./tesoreria.service');
const audit   = require('../../utils/auditoria.util');

const listarCuentas = async (req, res, next) => {
  try {
    const data = await service.listarCuentas(req.user.negocio_id, req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearCuenta = async (req, res, next) => {
  try {
    const data = await service.crearCuenta(req.user.negocio_id, req.sucursal_id, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Cuenta de dinero creada', 'tesoreria', data.id, {
      sucursal_id: req.sucursal_id,
      nombre:      data.nombre,
      tipo:        data.tipo,
    });
    res.status(201).json({ ok: true, data, message: 'Cuenta creada' });
  } catch (err) { next(err); }
};

const actualizarCuenta = async (req, res, next) => {
  try {
    const data = await service.actualizarCuenta(
      req.user.negocio_id, req.sucursal_id, Number(req.params.id), req.body
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Cuenta de dinero actualizada', 'tesoreria', data.id, {
      sucursal_id: req.sucursal_id,
      nombre:      data.nombre,
      activa:      data.activa,
    });
    res.json({ ok: true, data, message: 'Cuenta actualizada' });
  } catch (err) { next(err); }
};

const getSaldos = async (req, res, next) => {
  try {
    const data = await service.getSaldos(req.user.negocio_id, req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getExtracto = async (req, res, next) => {
  try {
    const data = await service.getExtracto(
      req.user.negocio_id, req.sucursal_id, Number(req.params.id),
      { desde: req.query.desde, hasta: req.query.hasta }
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarMovimiento = async (req, res, next) => {
  try {
    const data = await service.registrarMovimiento(
      req.user.negocio_id, req.sucursal_id, req.user.id, req.body
    );
    if (!data.repetido) {
      audit.registrar(req.user.negocio_id, req.user.id, 'Movimiento de tesorería', 'tesoreria', Number(data.id), {
        sucursal_id: req.sucursal_id,
        cuenta_id:   data.cuenta_id,
        tipo:        data.tipo,
        categoria:   data.categoria,
        monto:       Number(data.valor),
        concepto:    data.concepto ?? null,
      });
    }
    res.status(data.repetido ? 200 : 201).json({
      ok: true, data,
      message: data.repetido ? 'Movimiento ya registrado' : 'Movimiento registrado',
    });
  } catch (err) { next(err); }
};

const trasladar = async (req, res, next) => {
  try {
    const data = await service.trasladar(
      req.user.negocio_id, req.sucursal_id, req.user.id, req.body
    );
    const repetido = data.salida?.repetido === true;
    if (!repetido) {
      audit.registrar(req.user.negocio_id, req.user.id, 'Traslado de dinero', 'tesoreria', Number(data.salida.id), {
        sucursal_id: req.sucursal_id,
        origen_id:   req.body.origen_id,
        destino_id:  req.body.destino_id,
        monto:       Number(req.body.valor),
        concepto:    req.body.concepto ?? null,
      });
    }
    res.status(repetido ? 200 : 201).json({
      ok: true, data,
      message: repetido ? 'Traslado ya registrado' : 'Traslado registrado',
    });
  } catch (err) { next(err); }
};

const toggleMovimiento = async (req, res, next) => {
  try {
    const data = await service.toggleMovimiento(req.user.negocio_id, Number(req.params.id));
    audit.registrar(
      req.user.negocio_id, req.user.id,
      data.activo ? 'Movimiento de tesorería reactivado' : 'Movimiento de tesorería anulado',
      'tesoreria', Number(req.params.id),
      { sucursal_id: req.sucursal_id ?? null }
    );
    res.json({ ok: true, data, message: `Movimiento ${data.activo ? 'reactivado' : 'anulado'}` });
  } catch (err) { next(err); }
};

const arquear = async (req, res, next) => {
  try {
    const data = await service.arquear(
      req.user.negocio_id, req.sucursal_id, req.user.id, req.body
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Arqueo de cuenta', 'tesoreria', Number(data.id), {
      sucursal_id: req.sucursal_id,
      cuenta_id:   data.cuenta_id,
      saldo:       Number(data.saldo),
      diferencia:  Number(data.diferencia ?? 0),
    });
    res.status(201).json({ ok: true, data, message: 'Arqueo registrado' });
  } catch (err) { next(err); }
};

const getProveedores = async (req, res, next) => {
  try {
    const data = await service.getProveedores(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getComprasProveedor = async (req, res, next) => {
  try {
    const data = await service.getComprasProveedor(
      req.user.negocio_id, req.sucursal_id, Number(req.params.proveedorId)
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getResumenNegocio = async (req, res, next) => {
  try {
    const data = await service.getResumenNegocio(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  listarCuentas, crearCuenta, actualizarCuenta,
  getSaldos, getExtracto,
  registrarMovimiento, trasladar, toggleMovimiento,
  arquear, getResumenNegocio,
  getProveedores, getComprasProveedor,
};
