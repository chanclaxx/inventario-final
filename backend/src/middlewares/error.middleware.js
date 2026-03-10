const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.url} →`, err.message);

  // Error de validación de base de datos
  if (err.code === '23505') {
    return res.status(409).json({
      ok: false,
      error: 'Ya existe un registro con ese valor único',
    });
  }

  // Error de llave foránea
  if (err.code === '23503') {
    return res.status(400).json({
      ok: false,
      error: 'El registro referenciado no existe',
    });
  }

  res.status(err.status || 500).json({
    ok: false,
    error: err.message || 'Error interno del servidor',
  });
};

module.exports = { errorHandler };