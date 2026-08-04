// ─────────────────────────────────────────────────────────────────────────────
// Aviso a la app pública para que refresque una vitrina AL INSTANTE.
//
// El catálogo público cachea su HTML 30 minutos (ISR). Eso protege la base de
// datos del tráfico anónimo, pero deja al negocio esperando media hora para ver
// su propio cambio. Este módulo cierra ese hueco: después de publicar, editar o
// subir una foto, el backend le pide a la app pública que purgue esa ruta.
//
// REGLA DE ORO — igual que en notificaciones.service.enviar(): esto NUNCA lanza.
// Que el catálogo tarde en refrescarse es un inconveniente; que falle el guardado
// de un producto porque la app pública está caída sería un desastre. Todo va en
// try/catch y con timeout.
//
// Sin CATALOGO_URL / CATALOGO_REVALIDATE_SECRET queda apagado y el catálogo
// simplemente se comporta como antes, refrescándose solo cada 30 minutos.
// ─────────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 4000;

const estaActivo = () => Boolean(
  process.env.CATALOGO_URL && process.env.CATALOGO_REVALIDATE_SECRET
);

/**
 * Purga una o varias vitrinas en la app pública.
 *
 * @param {string|string[]} slugs
 * @returns {Promise<boolean>} true si la app pública confirmó el refresco.
 */
const revalidar = async (slugs) => {
  const lista = (Array.isArray(slugs) ? slugs : [slugs])
    .filter((s) => typeof s === 'string' && s.trim());

  if (!lista.length || !estaActivo()) return false;

  try {
    const base = process.env.CATALOGO_URL.replace(/\/+$/, '');
    const res  = await fetch(`${base}/api/revalidar`, {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'x-revalidate-secret': process.env.CATALOGO_REVALIDATE_SECRET,
      },
      body:   JSON.stringify({ slugs: lista }),
      // Sin timeout, una app pública que no responde dejaría colgada la
      // petición del vendedor que acaba de guardar un producto.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`⚠️  El catálogo público respondió ${res.status} al revalidar`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('⚠️  No se pudo refrescar el catálogo público:', err.message);
    return false;
  }
};

/**
 * Versión "dispara y olvida" para los caminos donde el usuario no está esperando
 * la respuesta del refresco (guardar ficha, subir foto, publicar en bloque).
 * No devuelve promesa a propósito: nadie debe poder await-earla por accidente y
 * meterle 4 segundos de latencia a un guardado.
 */
const revalidarEnSegundoPlano = (slugs) => {
  revalidar(slugs).catch(() => {});
};

module.exports = { estaActivo, revalidar, revalidarEnSegundoPlano };
