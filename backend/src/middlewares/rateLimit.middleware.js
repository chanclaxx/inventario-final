const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// ── Límite global de /api: POR USUARIO, no por IP ────────────────────────────
//
// Era 60 peticiones/min POR IP. Todos los celulares y computadores de un local
// salen por la MISMA IP del router, así que compartían esas 60: en un punto de
// venta con movimiento se agotaban, el servidor respondía 429 y lo que estaba
// cargando fallaba. El caso que costó (Tesla, 24–26 sep-2026): el árbol de
// variantes no cargaba, la pantalla lo pintaba como «sin atributos» y la venta
// o el préstamo salía sin talla, descuadrando el inventario.
//
// Con sesión válida se cuenta por USUARIO (una persona abriendo productos uno
// tras otro para armar una factura de cien líneas es uso normal, no abuso);
// sin sesión —login, refresco, token vencido o de superadmin— sigue contando
// por IP con el tope de siempre, que es lo que frena a quien prueba claves.
// El token se VERIFICA (no solo se decodifica): con `decode` bastaría inventar
// ids para repartir las peticiones entre claves y saltarse el límite.
const VENTANA_MS  = 60 * 1000;
const POR_USUARIO = 240;
const POR_IP      = 60;

/** `negocio:usuario` del token si es válido; null si no hay o no sirve. */
const usuarioDelToken = (req) => {
  if (req._limiteUsuario !== undefined) return req._limiteUsuario;
  let clave = null;
  const h = req.headers?.authorization;
  if (h && h.startsWith('Bearer ')) {
    try {
      const p = jwt.verify(h.slice(7), process.env.JWT_SECRET);
      if (p?.id != null) clave = `${p.negocio_id ?? '-'}:${p.id}`;
    } catch { clave = null; }
  }
  req._limiteUsuario = clave;
  return clave;
};

const claveLimite = (req) => {
  const u = usuarioDelToken(req);
  return u ? `u:${u}` : `ip:${ipKeyGenerator(req.ip || '')}`;
};

const limiteGlobal = rateLimit({
  windowMs:        VENTANA_MS,
  limit:           (req) => (usuarioDelToken(req) ? POR_USUARIO : POR_IP),
  keyGenerator:    claveLimite,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { ok: false, error: 'Demasiadas solicitudes. Espera unos segundos e intenta de nuevo.' },
  skip:            (req) => req.path === '/health',
});

module.exports = { limiteGlobal, claveLimite, usuarioDelToken, POR_USUARIO, POR_IP };
