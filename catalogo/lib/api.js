// ─────────────────────────────────────────────────────────────────────────────
// Único punto de contacto con el backend.
//
// Se habla SOLO con /api/publico/catalogo: rutas sin autenticación, de solo
// lectura, cuyo repositorio tiene lista blanca de columnas. Esta app no tiene
// token, ni cookies, ni forma de escribir nada.
//
// La caché (ISR) es lo que protege la base de datos: un enlace que se viralice
// en WhatsApp genera visitas contra el CDN, no contra el Postgres que corre la
// facturación.
//
// 30 minutos y no 5: la base de datos está en el plan gratuito de Supabase, con
// un cupo de salida compartido con el sistema de facturación. Seis veces menos
// regeneraciones son seis veces menos consultas contra ese cupo, y media hora de
// desfase en una vitrina que ni siquiera vende no le cambia la vida a nadie.
// ─────────────────────────────────────────────────────────────────────────────

const API = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');

export const REVALIDAR_SEGUNDOS = 1800;

const pedir = async (ruta, { revalidate = REVALIDAR_SEGUNDOS } = {}) => {
  if (!API) {
    throw new Error('Falta NEXT_PUBLIC_API_URL: la app no sabe a qué backend preguntar');
  }

  const res = await fetch(`${API}/api/publico/catalogo${ruta}`, {
    next: { revalidate },
    headers: { Accept: 'application/json' },
  });

  if (res.status === 404) return null;   // slug inexistente o vitrina apagada
  if (!res.ok) throw new Error(`El catálogo respondió ${res.status}`);

  const json = await res.json();
  return json?.data ?? null;
};

/** Catálogo completo de una vitrina. `null` si el slug no existe o está apagado. */
export const getCatalogo = (slug) => pedir(`/${encodeURIComponent(slug)}`);

/**
 * Slugs activos, para prerenderizar y para el sitemap.
 *
 * Nunca lanza: si el backend está caído durante el build, la app se despliega
 * igual y cada página se genera bajo demanda en la primera visita. Un backend
 * lento no puede tumbar un despliegue.
 */
export const getSlugs = async () => {
  try {
    return (await pedir('/slugs', { revalidate: 3600 })) || [];
  } catch (err) {
    console.warn('[catalogo] No se pudieron listar los slugs:', err.message);
    return [];
  }
};
