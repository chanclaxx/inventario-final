const service = require('./procedencia.service');

const getPorProducto = async (req, res, next) => {
  try {
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
    const data = await service.getPorImei(req.user.negocio_id, req.params.imei);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { getPorProducto, getPorImei };
