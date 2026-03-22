const service = require('./traslados.service');

const buscarEquivalentes = async (req, res, next) => {
  try {
    const { sucursal_destino_id, items } = req.body;

    if (!sucursal_destino_id) {
      return res.status(400).json({ ok: false, error: 'Sucursal destino requerida' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'Debes enviar al menos un producto' });
    }

    const data = await service.buscarEquivalentes(
      req.user.negocio_id, Number(sucursal_destino_id), items
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const ejecutarTraslado = async (req, res, next) => {
  try {
    const { sucursal_origen_id, sucursal_destino_id, notas, lineas } = req.body;

    if (!sucursal_origen_id || !sucursal_destino_id) {
      return res.status(400).json({ ok: false, error: 'Sucursales origen y destino requeridas' });
    }
    if (!lineas || !Array.isArray(lineas) || lineas.length === 0) {
      return res.status(400).json({ ok: false, error: 'Debes incluir al menos un producto' });
    }

    const data = await service.ejecutarTraslado(
      req.user.negocio_id, req.user.id,
      { sucursal_origen_id: Number(sucursal_origen_id), sucursal_destino_id: Number(sucursal_destino_id), notas, lineas }
    );
    res.status(201).json({ ok: true, data, message: 'Traslado completado correctamente' });
  } catch (err) { next(err); }
};

const getTraslados = async (req, res, next) => {
  try {
    const data = await service.getTraslados(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getTrasladoById = async (req, res, next) => {
  try {
    const data = await service.getTrasladoById(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { buscarEquivalentes, ejecutarTraslado, getTraslados, getTrasladoById };