const service = require('./reportes.service');

const getDashboard = async (req, res, next) => {
  try {
    const data = await service.getDashboard(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getVentasRango = async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Los parámetros desde y hasta son requeridos' });
    }
    const data = await service.getVentasRango(req.sucursal_id, desde, hasta);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProductosTop = async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Los parámetros desde y hasta son requeridos' });
    }
    const data = await service.getProductosTop(req.sucursal_id, desde, hasta);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getInventarioBajo = async (req, res, next) => {
  try {
    const data = await service.getInventarioBajo(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};
// ─────────────────────────────────────────────
// NUEVO HANDLER: actualizarCostoCompra
// Agrega este método al final de reportes.controller.js
// (antes del module.exports)
// ─────────────────────────────────────────────

/**
 * PATCH /api/reportes/costo-compra
 * Solo accesible por admin_negocio (protegido en el router)
 *
 * Body esperado:
 * {
 *   tipo:            'serial' | 'cantidad',
 *   imei:            string (solo si tipo === 'serial'),
 *   nombre_producto: string (solo si tipo === 'cantidad'),
 *   nuevo_costo:     number
 * }
 */
const actualizarCostoCompra = async (req, res, next) => {
  try {
    const { tipo, imei, nombre_producto, nuevo_costo } = req.body;

    // Validaciones básicas
    if (!tipo || nuevo_costo === undefined || nuevo_costo === null) {
      return res.status(400).json({
        ok: false,
        error: 'Los campos tipo y nuevo_costo son requeridos',
      });
    }

    if (Number(nuevo_costo) < 0) {
      return res.status(400).json({
        ok: false,
        error: 'El costo de compra no puede ser negativo',
      });
    }

    if (tipo === 'serial' && !imei) {
      return res.status(400).json({
        ok: false,
        error: 'El campo imei es requerido para productos de tipo serial',
      });
    }

    if (tipo === 'cantidad' && !nombre_producto) {
      return res.status(400).json({
        ok: false,
        error: 'El campo nombre_producto es requerido para productos de tipo cantidad',
      });
    }

    const data = await service.actualizarCostoCompra(
      req.sucursal_id,
      tipo,
      imei ?? null,
      nombre_producto ?? null,
      Number(nuevo_costo),
    );

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
const getValorInventario = async (req, res, next) => {
  try {
    const data = await service.getValorInventario(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────

module.exports = { getDashboard, getVentasRango, getProductosTop, getInventarioBajo, actualizarCostoCompra,getValorInventario };