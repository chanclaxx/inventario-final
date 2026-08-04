const { hayCatalogo } = require('../../config/columnas');

/**
 * Corta las peticiones del catálogo si su migración no llegó a aplicarse.
 *
 * Sin esto, una BD sin las tablas devolvería un 500 con
 * "relation catalogo_items does not exist" — feo por dentro y confuso por
 * fuera. Con esto la feature simplemente no existe todavía, que es la verdad,
 * y el resto del sistema sigue igual porque ninguna consulta del inventario
 * toca estas tablas.
 */
const requireCatalogo = (req, res, next) => {
  if (!hayCatalogo()) {
    return res.status(503).json({
      ok: false,
      error: 'El catálogo web no está disponible en este servidor todavía.',
      code:  'CATALOGO_NO_DISPONIBLE',
    });
  }
  next();
};

module.exports = { requireCatalogo };
