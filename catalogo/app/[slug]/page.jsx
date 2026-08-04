import { notFound } from 'next/navigation';
import { getCatalogo, getSlugs } from '../../lib/api';
import { Catalogo } from '../../components/Catalogo';

// ─────────────────────────────────────────────────────────────────────────────
// Página pública de una vitrina.
//
// ISR: la página se regenera sola cada 30 minutos. Nombre, precio y
// disponibilidad se leen en vivo del inventario en cada regeneración, así que
// no hay copia que sincronizar — solo un desfase máximo de media hora, que en
// un catálogo que no vende es irrelevante.
//
// A cambio, un enlace que se viralice en WhatsApp genera visitas contra el CDN
// y no contra el Postgres que corre la facturación (y que además está en el
// plan gratuito de Supabase, con cupo de salida compartido).
// ─────────────────────────────────────────────────────────────────────────────

// Next exige un literal aquí: analiza este valor estáticamente al compilar y no
// resuelve identificadores importados. Debe coincidir con REVALIDAR_SEGUNDOS de
// lib/api.js, que es el que gobierna la caché del fetch.
export const revalidate = 1800;
// Un slug nuevo no necesita redespliegue: se genera bajo demanda en su primera
// visita y a partir de ahí queda cacheado como los demás.
export const dynamicParams = true;

export async function generateStaticParams() {
  const slugs = await getSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const data = await getCatalogo(slug).catch(() => null);

  if (!data) return { title: 'Catálogo no encontrado' };

  const titulo      = data.vitrina.titulo;
  const descripcion = data.vitrina.descripcion
    || `Mira nuestro catálogo de ${data.total} producto${data.total === 1 ? '' : 's'}.`;
  // La portada del primer producto es la vista previa que aparece en WhatsApp.
  const portada = data.productos.find((p) => p.imagenes?.length)?.imagenes[0]?.url;

  return {
    title:       titulo,
    description: descripcion,
    openGraph: {
      title:       titulo,
      description: descripcion,
      type:        'website',
      locale:      'es_CO',
      ...(portada ? { images: [{ url: portada }] } : {}),
    },
    twitter: {
      card: portada ? 'summary_large_image' : 'summary',
      title: titulo,
      description: descripcion,
      ...(portada ? { images: [portada] } : {}),
    },
    // Sin catálogo activo no hay página, así que indexar lo que sí existe es
    // deseable: para muchos negocios pequeños esta será su única web.
    robots: { index: true, follow: true },
  };
}

export default async function PaginaCatalogo({ params }) {
  const { slug } = await params;
  const data = await getCatalogo(slug);

  if (!data) notFound();

  return <Catalogo data={data} />;
}
