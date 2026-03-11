const authService = require('./auth.service');

// ─────────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y contraseña son requeridos' });
    }

    const data = await authService.login(email, password);

    // Guardar refreshToken en cookie httpOnly (más seguro que localStorage)
    res.cookie('refreshToken', data.refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 días en ms
    });

    res.json({
      ok:          true,
      accessToken: data.accessToken,
      usuario:     data.usuario,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// POST /auth/refresh
// ─────────────────────────────────────────────
const refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ ok: false, error: 'No hay refresh token' });
    }

    const data = await authService.refreshAccessToken(refreshToken);
    res.json({ ok: true, accessToken: data.accessToken, usuario: data.usuario });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────
const logout = (req, res) => {
  res.clearCookie('refreshToken');
  res.json({ ok: true, message: 'Sesión cerrada correctamente' });
};

// ─────────────────────────────────────────────
// GET /auth/me
// ─────────────────────────────────────────────
const me = (req, res) => {
  res.json({ ok: true, data: req.user });
};

module.exports = { login, refresh, logout, me };