async function getPlanes(req, res, next) {
  try {
    const data = await svc.getPlanes();
    res.json({ ok: true, data });
  } catch (err) { next(err); }
}

async function renovarPlan(req, res, next) {
  try {
    const { plan, notas } = req.body;
    if (!plan) return res.status(400).json({ error: 'El plan es requerido' });
    const result = await svc.renovarPlan(
      Number(req.params.id),
      plan,
      req.user.id,
      notas
    );
    res.json({ ok: true, data: result });
  } catch (err) { next(err); }
}

module.exports = {
  login,
  getEstadisticas,
  getNegocios,
  aprobarNegocio,
  cambiarEstado,
  getPlanes,
  renovarPlan,
};