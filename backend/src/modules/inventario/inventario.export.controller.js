const service = require('./inventario.export.service');

const exportarInventario = async (req, res, next) => {
  try {
    const data = await service.getInventarioCompleto(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { exportarInventario };