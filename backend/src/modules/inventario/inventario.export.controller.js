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
    const data = await service.getInventarioCompleto(
      req.sucursal_id,
      req.user.negocio_id,  // ← pasar para segunda capa
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { exportarInventario };