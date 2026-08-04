import { revalidatePath } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Invalidación bajo demanda.
//
// El ISR de 30 minutos es el piso de frescura: protege la base de datos cuando
// nadie toca nada. Pero cuando el negocio publica un producto, le cambia el
// precio o le sube una foto, esperar media hora para verlo es inaceptable.
//
// Esta ruta la llama el backend (nunca el navegador) justo después de cada
// cambio, y purga el HTML cacheado de esa vitrina para que la siguiente visita
// lo regenere con datos frescos.
//
// Sin REVALIDATE_SECRET la ruta queda apagada y el catálogo sigue funcionando
// con el ISR de siempre — igual que el resto de features opcionales.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs';        // timingSafeEqual no existe en edge
export const dynamic = 'force-dynamic'; // nunca cachear la invalidación misma

const json = (cuerpo, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Comparación en tiempo constante. Con `===` el tiempo de respuesta varía según
 * cuántos caracteres coinciden, y eso permite adivinar el secreto carácter por
 * carácter a punta de mediciones.
 */
const secretoValido = (enviado, esperado) => {
  if (typeof enviado !== 'string' || enviado.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(enviado), Buffer.from(esperado));
};

export async function POST(request) {
  const esperado = process.env.REVALIDATE_SECRET;
  if (!esperado) {
    return json({ ok: false, error: 'Revalidación no configurada en esta app' }, 503);
  }

  if (!secretoValido(request.headers.get('x-revalidate-secret'), esperado)) {
    return json({ ok: false, error: 'No autorizado' }, 401);
  }

  const { slugs } = await request.json().catch(() => ({}));
  const lista = (Array.isArray(slugs) ? slugs : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim().toLowerCase())
    .slice(0, 20);   // tope defensivo: nadie necesita purgar 500 rutas de un golpe

  if (!lista.length) {
    return json({ ok: false, error: 'No se indicó ninguna vitrina' }, 400);
  }

  for (const slug of lista) {
    // Purga el HTML de la ruta y, con él, la caché de datos de sus fetch.
    revalidatePath(`/${slug}`);
  }
  // La lista de slugs alimenta el sitemap: si se activó o apagó una vitrina,
  // también hay que refrescarlo.
  revalidatePath('/sitemap.xml');

  return json({ ok: true, revalidados: lista });
}
