# Catálogo web público

App independiente que sirve las vitrinas públicas: `midominio.com/<slug>`.

Está separada del frontend interno **a propósito**:

- No tiene sesión, ni cookies, ni service worker, ni el bundle de la PWA. Abre
  rápido en un celular con mala señal, que es como se consume.
- El HTML llega pre-renderizado, así que la vista previa de WhatsApp y Google
  ven el contenido real.
- Se despliega aparte: un error aquí no toca el punto de venta.

## Cómo funciona

```
navegador  →  CDN de Vercel (HTML cacheado, ISR 30 min)
     │             │  solo cuando la página caduca
     │             ▼
     │        GET <API>/api/publico/catalogo/<slug>
     │             │  sin auth, solo lectura, lista blanca de columnas
     │             ▼
     │        Postgres (el mismo del sistema)
     │
     └──→  Cloudflare R2 (las fotos, egress gratis)
```

El ISR de 30 minutos es lo que protege la base de datos: un enlace que se
viralice en un grupo de WhatsApp genera visitas contra el CDN, no contra el
Postgres que corre la facturación.

Las fotos **no** se sirven desde Supabase a propósito: en plan gratuito su cupo
de salida es compartido con la base de datos del punto de venta, y un catálogo
viral podría restringir el proyecto entero. R2 no cobra salida. Ver
`docs/ANALISIS_CATALOGO_PUBLICO.md` §9.1.

Nombre, precio y disponibilidad se leen **en vivo** del inventario en cada
regeneración. No hay copia que sincronizar.

## Variables de entorno

Copia `.env.example` a `.env.local`:

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend de Railway, sin barra final |
| `NEXT_PUBLIC_SITE_URL` | Dominio de esta app; solo lo usan `sitemap.xml` y `robots.txt` |

## Desarrollo

```bash
pnpm install
pnpm dev        # http://localhost:3002/<slug>
```

Necesita el backend corriendo y al menos una vitrina activa
(Ajustes → Catálogo web en la app interna).

## Despliegue en Vercel

Proyecto **nuevo**, separado del frontend:

- Root Directory: `catalogo`
- Framework: Next.js (se detecta solo)
- Variables: las dos de arriba
- Dominio: el que se vaya a compartir

## Qué NO sale nunca de aquí

Costos, IMEI, proveedores, cliente de origen, notas internas, ubicación física,
código de barras, sucursal y la cantidad exacta en stock. La disponibilidad se
publica como booleano, nunca como número.

Esa garantía la impone el backend en
`backend/src/modules/catalogo/catalogo.publico.repository.js`, con lista blanca
de columnas. Esta app solo pinta lo que ese archivo decide entregar.
