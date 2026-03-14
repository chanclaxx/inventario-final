const IS_PROD = process.env.NODE_ENV === 'production';

const errorHandler = (err, req, res, next) => {
  // Log completo siempre en servidor
  console.error(`[ERROR] ${req.method} ${req.url} →`, err);

  if (err.code === '23505') {
    return res.status(409).json({ ok: false, error: 'Ya existe un registro con ese valor único' });
  }

  if (err.code === '23503') {
    return res.status(400).json({ ok: false, error: 'El registro referenciado no existe' });
  }

  // ── En producción: nunca exponer err.message de errores inesperados ──
  const status = err.status || 500;
  const mensaje =
    err.status                            // error operacional conocido (lanzado con err.status)
      ? err.message
      : IS_PROD
        ? 'Error interno del servidor'
        : err.message;

  res.status(status).json({ ok: false, error: mensaje });
};

module.exports = { errorHandler };