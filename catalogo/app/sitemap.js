import { getSlugs } from '../lib/api';

// Una entrada por vitrina activa. `getSlugs` nunca lanza, así que un backend
// caído devuelve un sitemap vacío en lugar de romper el despliegue.
export const revalidate = 3600;

export default async function sitemap() {
  const base  = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  if (!base) return [];

  const slugs = await getSlugs();
  return slugs.map((slug) => ({
    url:            `${base}/${slug}`,
    lastModified:   new Date(),
    changeFrequency: 'daily',
    priority:        0.8,
  }));
}
