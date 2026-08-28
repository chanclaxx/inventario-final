const service = require('./productosSerial.service');
const audit   = require('../../utils/auditoria.util');
const costos = require('../../utils/costos.util');

const getProductos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const lineaId    = req.query.linea_id ? Number(req.query.linea_id) : null;
    const data = await service.getProductos(sucursalId, req.user.negocio_id, lineaId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProductoById = async (req, res, next) => {
  try {
    const data = await service.getProductoById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearProducto = async (req, res, next) => {
  try {
    const data = await service.crearProducto(req.user.negocio_id, {
      ...req.body,
      sucursal_id: req.sucursal_id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Producto serial creado', 'productos_serial', data.id, {
      sucursal_id: req.sucursal_id,
      producto:    data.nombre,
      marca:       data.marca   ?? null,
      modelo:      data.modelo  ?? null,
      precio:      Number(data.precio_venta ?? 0),
    });
    res.status(201).json({ ok: true, data, message: 'Producto creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarProducto = async (req, res, next) => {
  try {
    const anterior = await service.getProductoById(req.user.negocio_id, req.params.id);
    const data     = await service.actualizarProducto(req.user.negocio_id, req.params.id, req.body);
    const cambios  = {};
    if (req.body.precio_venta !== undefined &&
        Number(req.body.precio_venta) !== Number(anterior.precio_venta)) {
      cambios.precio_anterior = Number(anterior.precio_venta);
      cambios.precio_nuevo    = Number(req.body.precio_venta);
    }
    audit.registrar(req.user.negocio_id, req.user.id, 'Producto serial editado', 'productos_serial', data.id, {
      sucursal_id: anterior.sucursal_id,
      producto:    data.nombre,
      ...cambios,
    });
    res.json({ ok: true, data, message: 'Producto actualizado correctamente' });
  } catch (err) { next(err); }
};

const eliminarProductoSerial = async (req, res, next) => {
  try {
    const forzar = req.body?.forzar === true;
    const id     = Number(req.params.id);
    const prev   = await service.getProductoById(req.user.negocio_id, id).catch(() => null);
    await service.eliminarProductoSerial(req.user.negocio_id, id, forzar);
    audit.registrar(req.user.negocio_id, req.user.id, 'Producto serial eliminado', 'productos_serial', id, {
      sucursal_id: prev?.sucursal_id ?? null,
      producto:    prev?.nombre      ?? null,
    });
    res.json({ ok: true, message: 'Producto eliminado correctamente' });
  } catch (err) {
    if (err.code === 'SERIALES_COMPROMETIDOS' || err.code === 'SERIALES_DISPONIBLES') {
      return res.status(409).json({
        ok:      false,
        code:    err.code,
        error:   err.message,
        detalle: err.detalle,
      });
    }
    next(err);
  }
};

const getSeriales = async (req, res, next) => {
  try {
    const vendido = req.query.vendido !== undefined ? req.query.vendido === 'true' : null;
    const data    = await service.getSeriales(req.user.negocio_id, req.params.id, vendido);
    // `SELECT s.*` arrastra costo_compra y proveedor_id de cada unidad.
    res.json({ ok: true, data: await costos.recortarSiToca(req.user, data) });
  } catch (err) { next(err); }
};

const agregarSerial = async (req, res, next) => {
  try {
    const data = await service.agregarSerial(req.user.negocio_id, req.params.id, req.body);
    audit.registrar(
      req.user.negocio_id, req.user.id,
      data.reactivado ? 'Equipo reactivado en inventario' : 'Equipo agregado al inventario',
      'productos_serial', data.id,
      {
        sucursal_id: data.sucursal_id ?? req.sucursal_id ?? null,
        producto:    data.producto_nombre ?? null,
        imei:        data.imei ?? null,
      }
    );
    res.status(201).json({ ok: true, data, message: 'IMEI agregado correctamente' });
  } catch (err) { next(err); }
};

const actualizarSerial = async (req, res, next) => {
  try {
    const data = await service.actualizarSerial(req.user.negocio_id, req.params.id, req.body);
    const cambios = {};
    if (req.body.imei !== undefined && req.body.imei && req.body.imei !== data.imei_anterior) {
      cambios.imei_anterior = data.imei_anterior;
    }
    if (req.body.precio !== undefined &&
        Number(req.body.precio ?? 0) !== Number(data.precio_anterior ?? 0)) {
      cambios.precio_anterior = data.precio_anterior != null ? Number(data.precio_anterior) : null;
      cambios.precio_nuevo    = req.body.precio      != null ? Number(req.body.precio)      : null;
    }
    audit.registrar(req.user.negocio_id, req.user.id, 'Equipo editado', 'productos_serial', data.id, {
      sucursal_id: data.sucursal_id ?? null,
      producto:    data.producto_nombre ?? null,
      imei:        data.imei ?? null,
      ...cambios,
    });
    res.json({ ok: true, data, message: 'Serial actualizado correctamente' });
  } catch (err) { next(err); }
};

const eliminarSerial = async (req, res, next) => {
  try {
    const serial = await service.eliminarSerial(req.user.negocio_id, req.params.id);
    audit.registrar(req.user.negocio_id, req.user.id, 'Equipo eliminado del inventario', 'productos_serial', Number(req.params.id), {
      sucursal_id: serial?.sucursal_id ?? null,
      producto:    serial?.producto_nombre ?? null,
      imei:        serial?.imei ?? null,
    });
    res.json({ ok: true, message: 'Serial eliminado correctamente' });
  } catch (err) { next(err); }
};

const verificarImei = async (req, res, next) => {
  try {
    const { imei } = req.params;
    if (!imei || imei.trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'IMEI inválido' });
    }
    const data = await service.verificarImei(imei.trim(), req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getComprasCliente = async (req, res, next) => {
  try {
    const q    = req.query.q || '';
    const data = await service.getComprasCliente(req.user.negocio_id, q);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const buscarPorImei = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ ok: true, data: [] });
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.buscarPorImei(q, sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getProductos, getProductoById, crearProducto, actualizarProducto,
  eliminarProductoSerial,
  getSeriales, agregarSerial, actualizarSerial, eliminarSerial,
  verificarImei, getComprasCliente, buscarPorImei,
};