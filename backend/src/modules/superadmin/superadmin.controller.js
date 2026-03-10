const svc = require('./superadmin.service');

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
    const result = await svc.loginSuperadmin(email, password);
    res
      .cookie('refreshToken', result.refreshToken, {
        httpOnly: true, sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .json({ ok: true, accessToken: result.accessToken, usuario: result.usuario });
  } catch (err) { next(err); }
}

async function getEstadisticas(req, res, next) {
  try {
    const data = await svc.getEstadisticas();
    res.json({ ok: true, data });
  } catch (err) { next(err); }
}

async function getNegocios(req, res, next) {
  try {
    const { estado, busqueda } = req.query;
    const data = await svc.getNegocios({ estado, busqueda });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
}

async function aprobarNegocio(req, res, next) {
  try {
    await svc.aprobarNegocio(Number(req.params.id));
    res.json({ ok: true, message: 'Negocio aprobado correctamente' });
  } catch (err) { next(err); }
}

async function cambiarEstado(req, res, next) {
  try {
    const negocio = await svc.cambiarEstadoNegocio(Number(req.params.id), req.body.estado);
    res.json({ ok: true, data: negocio });
  } catch (err) { next(err); }
}

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