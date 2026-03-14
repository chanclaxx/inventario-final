const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const CAMPOS_REQUERIDOS = ['id', 'negocio_id', 'rol'];

const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // ── Validar que el payload tiene la estructura esperada ──
    const faltantes = CAMPOS_REQUERIDOS.filter((c) => payload[c] == null);
    if (faltantes.length) {
      return res.status(401).json({ ok: false, error: 'Token con estructura inválida' });
    }

    // ── Verificar que el usuario sigue activo en DB ──────────
    // Solo para tokens de usuario de negocio (no superadmin)
    if (payload.negocio_id) {
      const { rows } = await pool.query(
        `SELECT activo FROM usuarios WHERE id = $1 AND negocio_id = $2 LIMIT 1`,
        [payload.id, payload.negocio_id]
      );
      if (!rows.length || !rows[0].activo) {
        return res.status(401).json({ ok: false, error: 'Usuario inactivo o no encontrado' });
      }
    }

    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
};

module.exports = { auth };