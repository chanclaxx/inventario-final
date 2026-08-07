const service = require('./codigosProveedor.service');

const getCodigos = async (req, res, next) => {
  try {
    const data = await service.listar(req.user.negocio_id, Number(req.params.proveedorId));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const resolverCodigo = async (req, res, next) => {
  try {
    // La sucursal la manda el admin, o sale del token para los demás roles: la
    // resolución termina en un producto de UNA sede concreta.
    const sucursal_id = req.todasSucursales
      ? Number(req.query.sucursal_id) || null
      : req.sucursal_id;

    const data = await service.resolverCodigo(req.user.negocio_id, {
      proveedor_id: Number(req.query.proveedor_id),
      codigo:       req.query.codigo,
      sucursal_id,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const aprenderCodigo = async (req, res, next) => {
  try {
    const data = await service.aprender(req.user.negocio_id, {
      ...req.body,
      usuario_id: req.user.id,
    });
    res.status(201).json({ ok: true, data, message: 'Equivalencia guardada' });
  } catch (err) { next(err); }
};

const eliminarCodigo = async (req, res, next) => {
  try {
    await service.eliminar(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, message: 'Equivalencia eliminada' });
  } catch (err) { next(err); }
};

const getPorProducto = async (req, res, next) => {
  try {
    const data = await service.porCodigoInterno(req.user.negocio_id, req.params.codigoInterno);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getCodigos, resolverCodigo, aprenderCodigo, eliminarCodigo, getPorProducto,
};
