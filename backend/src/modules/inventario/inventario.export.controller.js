const service = require('./inventario.export.service');

const exportarInventario = async (req, res, next) => {
  try {
    // ── Requerir sucursal específica — no tiene sentido exportar "todas" ──
    if (!req.sucursal_id) {
      return res.status(400).json({
        ok: false,
        error: 'Selecciona una sucursal para exportar su inventario',
      });
    }
    // `modo=lineas` trae solo lo que ese Excel pinta (mucho más rápido).
    // Sin el parámetro se responde completo: un frontend viejo cacheado por el
    // service worker sigue funcionando igual.
    const data = await service.getInventarioCompleto(
      req.sucursal_id,
      req.user.negocio_id,  // ← pasar para segunda capa
      req.query.modo,
      req.user.rol,         // ← decide qué costos viajan (ver _recortarCostos)
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const exportarInventarioNegocio = async (req, res, next) => {
  try {
    const data = await service.getInventarioPorLineasNegocio(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { exportarInventario, exportarInventarioNegocio };