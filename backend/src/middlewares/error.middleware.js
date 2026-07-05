const IS_PROD = process.env.NODE_ENV === 'production';

const errorHandler = (err, req, res, next) => {
  // Log completo siempre en servidor
  console.error(`[ERROR] ${req.method} ${req.url} →`, err);

  if (err.code === '23505') {
    return res.status(409).json({ ok: false, error: 'Ya existe un registro con ese valor único' });
  }

  if (err.code === '23503') {
    console.error('[FK 23503] table:', err.table);
  console.error('[FK 23503] constraint:', err.constraint);
  console.error('[FK 23503] detail:', err.detail);
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

  // Código de error operacional (ej. IMEI_PRESTADO) para que el frontend
  // pueda distinguir casos específicos. Solo en errores lanzados con err.status.
  const payload = { ok: false, error: mensaje };
  if (err.status && err.code) payload.code = err.code;
  if (err.status && err.detalle) payload.detalle = err.detalle;

  res.status(status).json(payload);
};

module.exports = { errorHandler };