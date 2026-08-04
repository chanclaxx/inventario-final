/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Las fotos ya llegan comprimidas desde el navegador del vendedor (WebP,
  // ~200 KB, máx 1600 px — ver frontend/src/utils/imagen.js), así que se sirven
  // tal cual desde el CDN de Supabase con <img>. Sin next/image no hay que
  // declarar hosts remotos aquí: cambiar de proveedor de almacenamiento no
  // obliga a tocar esta configuración ni a redesplegar.
  poweredByHeader: false,
};

export default nextConfig;
