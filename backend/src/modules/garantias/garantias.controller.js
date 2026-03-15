const service = require('./garantias.service');

const getGarantias = async (req, res, next) => {
  try {
    const data = await service.getGarantias(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getGarantiaById = async (req, res, next) => {
  try {
    const data = await service.getGarantiaById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearGarantia = async (req, res, next) => {
  try {
    const data = await service.crearGarantia(req.user.negocio_id, req.body);
    res.status(201).json({ ok: true, data, message: 'Garantía creada correctamente' });
  } catch (err) { next(err); }
};

const actualizarGarantia = async (req, res, next) => {
  try {
    const data = await service.actualizarGarantia(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Garantía actualizada correctamente' });
  } catch (err) { next(err); }
};

const eliminarGarantia = async (req, res, next) => {
  try {
    await service.eliminarGarantia(req.user.negocio_id, req.params.id);
    res.json({ ok: true, message: 'Garantía eliminada correctamente' });
  } catch (err) { next(err); }
};

// ── Garantías aplicables a una factura específica ─────────────────────────────
const getGarantiasPorFactura = async (req, res, next) => {
  try {
    const data = await service.getGarantiasPorFactura(req.user.negocio_id, req.params.facturaId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getGarantias, getGarantiaById,
  crearGarantia, actualizarGarantia, eliminarGarantia,
  getGarantiasPorFactura,
};