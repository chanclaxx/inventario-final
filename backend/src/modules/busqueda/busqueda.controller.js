const service = require('./busqueda.service');

const buscarPorIMEI = async (req, res, next) => {
  try {
    const imei = req.params.imei?.trim();
    if (!imei) return res.status(400).json({ ok: false, error: 'IMEI requerido' });

    const { negocio_id, rol } = req.user;
    const resultado = await service.buscarPorIMEI(imei, negocio_id, rol);

    if (!resultado) {
      return res.status(404).json({ ok: false, error: 'IMEI no encontrado en este negocio' });
    }
    res.json({ ok: true, data: resultado });
  } catch (err) {
    next(err);
  }
};

const buscarProductos = async (req, res, next) => {
  try {
    const q = req.query.q?.trim();
    if (!q || q.length < 2) {
      return res.status(400).json({ ok: false, error: 'Ingresa al menos 2 caracteres' });
    }

    const { negocio_id, rol } = req.user;
    const resultado = await service.buscarProductos(q, negocio_id, req.sucursal_id, rol);
    res.json({ ok: true, data: resultado });
  } catch (err) {
    next(err);
  }
};

const buscarCompras = async (req, res, next) => {
  try {
    const q    = req.query.q?.trim();
    const modo = req.query.modo || 'nombre';
    if (!q || q.length < 2) {
      return res.status(400).json({ ok: false, error: 'Ingresa al menos 2 caracteres' });
    }
    const { negocio_id, rol } = req.user;
    const data = await service.buscarCompras(q, modo, negocio_id, req.sucursal_id, rol);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

const buscarPrestamos = async (req, res, next) => {
  try {
    const { q = '', estado = '', tipo = '', fechaDesde = '', fechaHasta = '' } = req.query;

    const tieneAlgunFiltro = q.trim() || estado || tipo || fechaDesde || fechaHasta;
    if (!tieneAlgunFiltro) return res.json({ ok: true, data: [] });

    const { negocio_id, rol } = req.user;
    const data = await service.buscarPrestamos(
      { q, estado, tipo, fechaDesde, fechaHasta },
      negocio_id, req.sucursal_id, rol,
    );
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

const getHistorialCantidad = async (req, res, next) => {
  try {
    const productoId = parseInt(req.params.productoId, 10);
    if (!productoId) return res.status(400).json({ ok: false, error: 'ID de producto requerido' });
    const { negocio_id } = req.user;
    const data = await service.getHistorialCantidad(productoId, negocio_id);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

module.exports = { buscarPorIMEI, buscarProductos, buscarCompras, buscarPrestamos, getHistorialCantidad };
