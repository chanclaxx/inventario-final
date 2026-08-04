# Análisis de implementación — Catálogo web público por sucursal

> **Estado:** **Fase 1 implementada** (3-ago-2026). Falta configuración de
> infraestructura para que quede en línea — ver §14.
> **Fecha del análisis:** 3-ago-2026.
>
> **Objetivo:** que cada sucursal pueda publicar automáticamente un catálogo web
> a partir de su inventario, compartible por enlace (WhatsApp), como **feature
> opt-in** y **100% aditiva** sobre el sistema actual.
>
> **No es** una tienda virtual: no hay pagos, no hay checkout, no hay descuento
> de stock. Es una vitrina de solo lectura.
>
> **Decisiones tomadas al implementar**, respecto a la propuesta original:
> - El catálogo es **por sucursal**, no por negocio (§3, duda A). Esto **elimina
>   por completo el riesgo R-1**: la ficha se ata al `producto_id` real, así que
>   renombrar un producto ya no rompe nada. Era el riesgo más serio del diseño.
> - **`marca` NO se agrega al inventario** (§3, duda B). La vitrina es
>   completamente independiente: marca, descripción y fotos viven solo en las
>   tablas del catálogo. `productos_cantidad` y `productos_serial` no cambian ni
>   una columna.
> - La configuración de la vitrina vive en su **propia tabla**
>   (`catalogo_sucursal`), no en `config_negocio`, porque es por sucursal y
>   `config_negocio` es por negocio.
> - Sin columnas nuevas en `negocios` ni en `sucursales`: la migración crea
>   **3 tablas y nada más**.

---

## 1. Cómo funciona hoy el inventario

### 1.1 Los dos tipos de producto no comparten tabla

El sistema tiene **dos modelos de producto completamente separados**, cada uno con su
módulo, su ruta y su repositorio:

| | `productos_serial` | `productos_cantidad` |
|---|---|---|
| Unidad de venta | una unidad identificada por IMEI | N unidades intercambiables |
| Tabla hija | `seriales` (una fila por IMEI) | — |
| Disponibilidad | `COUNT(seriales WHERE NOT vendido AND NOT prestado)` | columna `stock` |
| Borrado | **físico** (`DELETE`, con `forzar`) | **lógico** (`activo = false`) |
| Ruta | `/api/productos-serial` | `/api/productos-cantidad` |

Columnas relevantes hoy:

```
productos_serial   (id, nombre, marca, modelo, precio, sucursal_id,
                    proveedor_id, linea_id, nota, ubicacion)

seriales           (id, producto_id, imei, color, caracteristicas, costo_compra,
                    precio, fecha_entrada, fecha_salida, vendido, prestado,
                    proveedor_id, cliente_origen, nota)

productos_cantidad (id, nombre, stock, stock_minimo, unidad_medida, costo_unitario,
                    precio, cliente_origen, activo, sucursal_id, proveedor_id,
                    linea_id, creado_en, nota, codigo, ubicacion)
```

Referencias: [productosSerial.repository.js](backend/src/modules/productos/productosSerial.repository.js),
[productosCantidad.repository.js](backend/src/modules/productos/productosCantidad.repository.js).

### 1.2 Un producto "lógico" son N filas — una por sucursal

Esto es **el hallazgo más importante del análisis**, y define toda la arquitectura.

`productos_cantidad` y `productos_serial` cuelgan de `sucursal_id`, no de `negocio_id`.
El mismo producto vendido en tres sucursales son **tres filas distintas**, con precios y
stocks distintos, sin ninguna clave que las una formalmente.

El sistema ya resolvió esto de una manera concreta: **agrupa por `nombre`**.

- La vista global de inventario hace `GROUP BY pc.nombre, pc.linea_id`
  ([productosCantidad.repository.js:80](backend/src/modules/productos/productosCantidad.repository.js#L80)).
- El código de barras usa `LOWER(pc.nombre) = LOWER($2)` para heredar y propagar el
  código entre sucursales (`codigoHeredado`, `sincronizarCodigoPorNombre`,
  [líneas 188-224](backend/src/modules/productos/productosCantidad.repository.js#L188-L224)).

**Conclusión:** la clave lógica de un producto dentro de un negocio es, hoy,
`LOWER(BTRIM(nombre))` — una clave natural y mutable.

> **Consecuencia de diseño:** un catálogo **por negocio** tendría que agrupar por
> ese nombre y heredaría su fragilidad (§2.4). Un catálogo **por sucursal** se
> ata al `producto_id`, que es estable. Fue la razón técnica de peso a favor de
> la decisión A (§3).

### 1.3 Jerarquía de tres niveles (variantes)

Para `productos_cantidad` existe una jerarquía opcional:

```
productos_cantidad  (stock = SUM de sus atributos activos)
   └── atributos_producto   (tipo_id → tipos_caracteristica, valor, stock, precio, costo)
          └── variantes_atributo (tipo_id, valor, stock, precio, costo)
```

El stock se recalcula en cascada hacia arriba (`sincronizarStockProducto`,
[variantes-producto.repository.js:204](backend/src/modules/variantes-producto/variantes-producto.repository.js#L204)).
`tipos_caracteristica` es un catálogo por negocio (`nombre`, `valores` JSONB, `orden`).

Ejemplo real: producto "Camiseta" → atributo "Talla: M" → variante "Color: Azul".

### 1.4 Clasificación disponible

| Concepto | Dónde vive | Alcance | ¿Sirve al catálogo? |
|---|---|---|---|
| **Línea** | `lineas_producto (id, negocio_id, nombre)` | **por negocio** | ✅ Es la categoría natural. Ya está lista. |
| **Marca** | `productos_serial.marca` | por fila | ⚠️ **Solo existe en serial.** Ver §2.1 |
| **Modelo** | `productos_serial.modelo` | por fila | ✅ |
| **Color / características** | `seriales.color`, `seriales.caracteristicas` | por unidad (IMEI) | ⚠️ Nivel equivocado. Ver §2.3 |
| **Atributos/variantes** | `atributos_producto`, `variantes_atributo` | por sucursal | ✅ (fase 2) |
| **Código** | `productos_cantidad.codigo` | por sucursal, opt-in | ⚠️ Nullable, solo cantidad |
| **Unidad de medida** | `productos_cantidad.unidad_medida` | por fila | ✅ |
| **Nota** | `*.nota` | por fila | ❌ **Es interna.** Ver §2.2 |

`lineas_producto` no tiene jerarquía (no hay subcategorías) ni orden explícito — se ordena
alfabéticamente. Al borrar una línea, los productos quedan con `linea_id = NULL`
([lineas.repository.js:52](backend/src/modules/lineas/lineas.repository.js#L52)).

### 1.5 De dónde sale el precio

Hay tres caminos, y el catálogo tiene que elegir uno explícitamente:

1. **Precio de lista.** `productos_cantidad.precio` / `productos_serial.precio`.
   **Puede ser NULL** — el `create` guarda `precio || null`. Esto encaja perfecto con el
   requisito "si un producto no tiene precio, igual debe aparecer".
2. **Precio por unidad.** En serial el precio efectivo es `COALESCE(s.precio, ps.precio)`:
   un IMEI concreto puede tener precio propio.
3. **Tarifas porcentuales** (opt-in, `tarifas_activo`). El precio se **calcula desde el
   costo** en el momento de la venta: `costo × (1 + p/100)`
   ([utils/tarifas.js](frontend/src/utils/tarifas.js)). El precio de lista puede quedar
   desactualizado o sin uso en esos negocios.

> ⚠️ **Riesgo de seguridad ya identificado en el sistema.** El propio código de tarifas
> documenta que mostrar el precio junto al porcentaje permite despejar el costo
> (`precio ÷ 1,05`). El sistema trata el costo como dato reservado
> (`red_interna_ocultar_costos` viene activo por defecto). **El catálogo público
> nunca debe publicar un precio derivado de tarifa.** Ver §9.

### 1.6 Multi-tenancy, auth y plan

Todas las rutas de negocio se montan con la misma cadena
([index.js:66](backend/src/index.js#L66)):

```js
const protegida = [auth, verificarPlan, resolveSucursal];
```

- `verificarPlan` bloquea `vencido`, `suspendido`, `pendiente` y marca vencido si pasó
  `fecha_vencimiento` ([plan.middleware.js](backend/src/middlewares/plan.middleware.js)).
- `resolveSucursal` resuelve `req.sucursal_id`: del token para supervisor/vendedor, del
  query param `?sucursal_id=` para `admin_negocio`.
- Rate limit **global de 60 req/min sobre todo `/api/`**, con `skip` solo para `/health`
  ([index.js:47](backend/src/index.js#L47)).
- CORS con whitelist estricta: `FRONTEND_URL` + `localhost:5173`.

`negocios` tiene hoy: `id, nombre, nit, telefono, direccion, email, plan, estado_plan,
fecha_vencimiento, activo, creado_en`. **No tiene slug, ni logo, ni identidad pública.**

### 1.7 Configuración por negocio

`config_negocio (negocio_id, clave, valor)` — key/value, **todos los valores son TEXT**
(los booleanos se guardan como `'1'`/`'0'`, las listas como JSON serializado).
Hay una lista de claves privadas que nunca salen en el `GET /config`
([config.repository.js:5](backend/src/modules/config/config.repository.js#L5)), y validación
por clave en el service. Este es el mecanismo estándar de feature-flag del sistema
(`tarifas_activo`, `mora_activa`, `codigo_producto_activo`, `ubicacion_activa`,
`red_interna_activa`…). El catálogo debe usarlo igual.

### 1.8 Migraciones e infraestructura

- Las migraciones **se auto-aplican al arrancar** (`runMigrations()`), son aditivas e
  idempotentes, y **cada bloque riesgoso va en su propio `try/catch`** para que un fallo
  deje sin feature a quien la use pero nunca sin servidor a los demás
  ([config/migrations.js](backend/src/config/migrations.js)).
- `config/columnas.js` detecta en runtime si una columna opcional existe, y apaga la
  feature si la migración no llegó (`hayUbicacion()`).
- Backend en Railway, frontend en Vercel (SPA + PWA), **BD PostgreSQL en Supabase**.
- El backend **ya tiene `@supabase/supabase-js`** (lo usa el módulo de backup con
  `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`) y **ya tiene `multer`** (importación de Excel,
  `memoryStorage`, límite 10 MB).

---

## 2. Problemas encontrados

### 2.1 No existe "marca" para productos por cantidad

`marca` solo está en `productos_serial`. Un negocio de ropa o ferretería, que trabaja
todo por cantidad, **no puede clasificar por marca hoy**. El catálogo la pide
explícitamente.

> **Resuelto sin tocar el inventario (decisión B, §3):** la marca vive en
> `catalogo_items.marca`, junto con la descripción y las fotos. En productos con
> serial se propone la marca del inventario como valor inicial del formulario,
> pero lo que se guarda y se publica es siempre el campo del catálogo. Sigue
> siendo cierto que el inventario interno no puede clasificar por marca en
> productos por cantidad; eso es una decisión aparte, para otro día.

### 2.2 No existe descripción comercial

Ninguna tabla tiene un campo de texto pensado para el cliente final. Existe `nota`, pero
es un **post-it operativo interno** (`PostItNota.jsx`, "el producto viene con el cargador
partido", "reservado para Juan"). Publicarlo sería una fuga de información. **`nota`
nunca debe salir al catálogo.**

### 2.3 Color y características viven al nivel equivocado

En serial, `color` y `caracteristicas` están en `seriales` — **por unidad física**. Un
catálogo muestra "iPhone 13, disponible en negro y azul", no una ficha por IMEI. Hay que
agregarlos (`DISTINCT` de los seriales disponibles), no listarlos.

Además, el fan-out de IMEI ya está documentado como trampa conocida del sistema: un IMEI
vive en varias filas de `seriales`. El catálogo **no debe hacer JOIN por IMEI**.

### 2.4 No hay identidad estable del producto lógico

Agrupar por `LOWER(nombre)` funciona, pero el nombre es mutable. Si alguien renombra
"iPhone 13 128GB" a "iPhone 13 (128 GB)", el vínculo con sus fotos se perdería en silencio.

> **Resuelto por la decisión A (§3):** al hacer el catálogo **por sucursal**, la
> ficha se ata al `producto_id` real y este problema desaparece. Era el riesgo
> más serio del diseño original y se eliminó sin mitigación ni código extra —
> simplemente dejó de existir.

### 2.5 Un catálogo público no cabe en la cadena de middlewares actual

`auth → verificarPlan → resolveSucursal` asume usuario autenticado y sucursal resuelta.
El catálogo no tiene ninguna de las dos cosas. Tiene que montarse **antes**, como ya se
hace con `/api/auth` y `/api/registro`, con su propio control de acceso.

### 2.6 El rate limit global mataría el catálogo (o el catálogo mataría a los demás)

60 req/min **por IP** sobre todo `/api/`. Dos escenarios malos:

- Si el catálogo se sirve con renderizado en servidor, todas las peticiones llegan desde
  unas pocas IPs de Vercel → se consume la cuota y el catálogo se cae.
- Si se sirve directo al navegador, un enlace que se viraliza en WhatsApp mete tráfico
  anónimo **contra la misma base de datos que corre el punto de venta**.

### 2.7 Las consultas de inventario actuales no sirven para el catálogo

`findAll` de cantidad hace un `LATERAL` contra `lineas_factura` + `facturas` por cada
producto para calcular la última venta. Es aceptable para una pantalla interna con
sesión; es inaceptable para tráfico público. El catálogo necesita **su propio repositorio
con su propia consulta**, no reutilizar estas.

### 2.8 La PWA cachea `/api/` durante 5 minutos

`NetworkFirst` con `maxAgeSeconds: 300` sobre todo `/api/` que no sea reportes/facturas/
dashboard/tesorería/inventario ([vite.config.js](frontend/vite.config.js)). Un catálogo
servido desde la misma app arrastraría el service worker, el bundle de auth y toda la
lógica de sesión sin necesitarla.

### 2.9 Nota menor: estados de plan inconsistentes en la documentación

`CLAUDE.md` lista los estados de facturación como `trial, mensual, premium, vencido,
suspendido`, pero `plan.middleware.js` trata `'activo'` como el estado vivo y bloquea
`vencido / suspendido / pendiente`. Para una superficie pública conviene **reusar
literalmente la misma regla del middleware** en vez de escribir una lista nueva, y
apoyarse en el flag `catalogo_activo` como puerta real.

---

## 3. Decisiones — cerradas

| # | Duda | Decisión tomada |
|---|---|---|
| A | ¿La unidad del catálogo es el producto por sucursal o el producto lógico del negocio? | **Por sucursal.** Cada sucursal tiene su propio slug y publica sus propias filas. La ficha se ata al `producto_id` real, así que **no hay clave por nombre que se pueda romper** — esto elimina el riesgo R-1, que era el más serio del diseño. |
| B | ¿Se agrega `marca` a `productos_cantidad`? | **No.** La marca vive solo en `catalogo_items`. El inventario queda intacto: cero `ALTER` sobre tablas existentes. |
| C | ¿Qué precio se publica? | **Lista, con override manual** (`precio_publico`). **Nunca** tarifa (§1.5). |
| D | Si el producto tiene precios distintos por sucursal, ¿cuál se muestra? | Ya no aplica: cada vitrina es de una sucursal y muestra el precio de esa sucursal. |
| E | ¿Se muestra el stock exacto? | **Nunca.** La disponibilidad viaja como booleano (`Disponible` / `Agotado`) y se puede apagar del todo. |
| F | ¿Qué pasa con los productos agotados? | **Se muestran como agotados**, con un toggle `ocultar_agotados` para esconderlos. |
| G | ¿Subdominio o ruta? | **Ruta** (`midominio.com/<slug>`) en fase 1; subdominio en fase 2. Ver §4.2. |
| H | ¿Quién puede publicar? | **Módulo `inventario` con nivel `supervisor`** o superior. Configurar la vitrina: solo `admin_negocio`. Ver el enlace público: **cualquiera del equipo**, porque compartirlo es el trabajo del vendedor. |
| I | ¿Se crea una clave nueva en `MODULOS`? | **No.** Publicar es una acción sobre el inventario y hereda su permiso, así que no cambian los permisos de ningún usuario existente. |

---

## 4. Arquitectura recomendada

### 4.1 Visión general

```
┌──────────────────────────────────────────────────────────────────────┐
│  App interna (Vercel)                    Catálogo público (Vercel)   │
│  frontend/  React 19 + Vite + PWA        catalogo/  Next.js (SSG/ISR)│
│  · sesión, carrito, facturación          · sin auth, sin PWA         │
│  · nueva pestaña "Catálogo"              · midominio.com/<slug>      │
│  · subida de fotos                       · HTML pre-renderizado      │
└────────────┬─────────────────────────────────────┬───────────────────┘
             │ Bearer + cookie                     │ fetch sin credenciales
             │ (rutas protegidas)                  │ (ISR cada 5 min)
             ▼                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Backend Express (Railway)                                           │
│                                                                      │
│  /api/*                       protegida = [auth, plan, sucursal]     │
│  /api/catalogo/*              ← admin del catálogo (protegida)       │
│  /api/publico/*               ← SIN auth, limiter propio, solo GET   │
└────────────┬─────────────────────────────────┬───────────────────────┘
             │                                 │
             ▼                                 ▼
    PostgreSQL (Supabase)            Cloudflare R2  (egress gratis)
    · tablas de inventario             bucket `catalogo`
    · catalogo_items                   negocio_<id>/item_<id>/<uuid>.webp
    · catalogo_imagenes                servido por dominio propio
```

### 4.2 Por qué una app separada y por qué ruta antes que subdominio

**App separada (`catalogo/`, Next.js App Router):**

| Criterio | Ruta dentro del SPA actual | App Next.js separada |
|---|---|---|
| SEO | ❌ CSR puro, sin HTML inicial | ✅ HTML pre-renderizado, metadata, OG, JSON-LD |
| Velocidad primera carga | ❌ arrastra bundle de auth, React Query, Zustand, PWA | ✅ bundle mínimo |
| Aislamiento | ❌ un bug del catálogo despliega junto al POS | ✅ despliegues independientes |
| Costo | ✅ cero | ✅ cero (segundo proyecto Vercel gratis) |
| Esfuerzo | ✅ menor | ⚠️ un framework nuevo en el repo |

La única desventaja real de Next.js es introducir un framework que hoy no está. A cambio
resuelve de una vez **SEO, velocidad y protección de la BD** (vía ISR), que son tres de
los seis criterios que pediste evaluar. **Recomiendo Next.js.**

**Ruta (`midominio.com/<slug>`) antes que subdominio:**

Los subdominios wildcard (`*.midominio.com`) en Vercel requieren plan de pago y un
certificado wildcard — conviene confirmar el precio vigente antes de comprometerse. La
ruta funciona en el plan gratuito, con el mismo dominio, y **se puede migrar a subdominio
después sin tocar los datos**: el `slug` ya está en la BD; solo cambia el `middleware.ts`
que lo lee del host en vez del path. Empezar por ruta no cierra ninguna puerta.

Enlace de fase 1: `https://midominio.com/videotienda-gafas`
Enlace de fase 2: `https://videotienda-gafas.midominio.com` (con redirección 301 desde la ruta).

### 4.3 La decisión central: el catálogo no es una copia

**El catálogo lee en vivo de las tablas de inventario.** Nombre, línea, marca, precio y
disponibilidad **no se copian a ninguna parte**. Solo se persiste la **capa comercial**
que hoy no existe: fotos, descripción, orden, destacado y el interruptor de publicación.

```
     inventario (fuente de verdad)          catalogo_items (capa comercial)
     ├── nombre        ─────────────┐       ├── publicado
     ├── linea_id                   ├──────►├── descripcion
     ├── precio                     │       ├── titulo (override, nullable)
     ├── stock / seriales           │       ├── precio_publico (override, nullable)
     └── marca / modelo  ───────────┘       ├── orden, destacado
                                            └── catalogo_imagenes (1:N)
```

Esto es exactamente el patrón que ya usa **Tesorería** (los saldos se *derivan* de las
tablas transaccionales, no se escriben) y **red interna** (la deuda se deriva de las
ventas). Es la convención de la casa.

**Consecuencia directa:** la pregunta "¿cómo mantengo sincronizado el catálogo con el
inventario?" desaparece. No hay nada que sincronizar. Solo hay que decidir **cuánto puede
tardar el HTML cacheado en reflejar un cambio** (§7).

---

## 5. Modelo de datos

**Tres tablas nuevas. Cero `ALTER` sobre tablas existentes.** El inventario no se
toca: la marca, la descripción comercial y las fotos son datos exclusivos de la
vitrina.

Archivo de referencia: [migrations/20260803_catalogo_publico.sql](migrations/20260803_catalogo_publico.sql).
También se auto-aplica al arrancar el backend.

### 5.1 `catalogo_sucursal` — la vitrina

```sql
CREATE TABLE catalogo_sucursal (
  id                     SERIAL    PRIMARY KEY,
  negocio_id             INTEGER   NOT NULL REFERENCES negocios(id)   ON DELETE CASCADE,
  sucursal_id            INTEGER   NOT NULL UNIQUE REFERENCES sucursales(id) ON DELETE CASCADE,
  slug                   TEXT      NOT NULL,     -- la URL pública
  activo                 BOOLEAN   NOT NULL DEFAULT FALSE,
  titulo, descripcion, whatsapp, direccion, horario, color_primario,
  mostrar_precios        BOOLEAN   NOT NULL DEFAULT TRUE,
  mostrar_disponibilidad BOOLEAN   NOT NULL DEFAULT TRUE,
  ocultar_agotados       BOOLEAN   NOT NULL DEFAULT FALSE,
  creado_en, actualizado_en
);
CREATE UNIQUE INDEX uq_catalogo_sucursal_slug ON catalogo_sucursal (LOWER(slug));
```

Toda la configuración de la vitrina vive aquí y **no** en `config_negocio`,
porque `config_negocio` es por negocio y esto es por sucursal.

El slug es único en **toda la plataforma**, no por negocio: es una URL.
Validación `^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$` más una lista de reservados
(`api`, `admin`, `www`, `login`, `_next`, `sitemap`…), en
`catalogo.service.js`.

### 5.2 `catalogo_items` — la ficha comercial

```sql
CREATE TABLE catalogo_items (
  id              BIGSERIAL     PRIMARY KEY,
  negocio_id      INTEGER       NOT NULL REFERENCES negocios(id),
  sucursal_id     INTEGER       NOT NULL REFERENCES sucursales(id),
  tipo            TEXT          NOT NULL,   -- 'serial' | 'cantidad'
  producto_id     INTEGER       NOT NULL,   -- id REAL del producto en esa sucursal
  publicado       BOOLEAN       NOT NULL DEFAULT FALSE,
  titulo          TEXT,          -- NULL ⇒ usar el nombre del inventario
  descripcion     TEXT,          -- comercial; NO es `nota`, que es interna
  marca           TEXT,          -- vive SOLO aquí
  precio_publico  NUMERIC(14,2), -- NULL ⇒ usar el precio de lista
  mostrar_precio  BOOLEAN       NOT NULL DEFAULT TRUE,
  destacado       BOOLEAN       NOT NULL DEFAULT FALSE,
  orden           INTEGER       NOT NULL DEFAULT 0,
  creado_en, actualizado_en
);
CREATE UNIQUE INDEX uq_catalogo_items_producto ON catalogo_items (sucursal_id, tipo, producto_id);
CREATE INDEX idx_catalogo_items_publicados
  ON catalogo_items (sucursal_id, destacado DESC, orden, id) WHERE publicado;
```

Notas de diseño:

- **`publicado` arranca en `FALSE`.** Nada se hace público por accidente. Con la
  BD de Supabase compartida por ~28 negocios reales, este default no es
  negociable.
- **La fila solo existe si alguien tocó el producto en la vitrina.** Un negocio
  sin catálogo no genera ni una fila.
- **No hay FK a `productos_*`** porque el `tipo` decide la tabla destino. La
  pertenencia se valida en el service (`productoExisteEnSucursal`) antes de
  crear cualquier ficha, incluso en la publicación masiva.
- **`producto_id` es el id real**, no una clave por nombre. Renombrar un producto
  no afecta su ficha ni sus fotos.

### 5.3 `catalogo_imagenes`

```sql
CREATE TABLE catalogo_imagenes (
  id           BIGSERIAL PRIMARY KEY,
  item_id      BIGINT    NOT NULL REFERENCES catalogo_items(id) ON DELETE CASCADE,
  storage_path TEXT      NOT NULL,   -- ruta en el bucket, para poder borrar
  url          TEXT      NOT NULL,   -- URL pública del CDN
  alt          TEXT,
  bytes        INTEGER,
  orden        INTEGER   NOT NULL DEFAULT 0,   -- orden 0 = portada
  usuario_id   INTEGER,                        -- quién la subió
  creado_en    TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Los binarios nunca entran a Postgres.** Máximo 6 imágenes por producto,
validado en el backend.

### 5.4 Migración

Un solo bloque en `runMigrations()`, **en su propio `try/catch`**, siguiendo el
patrón de red interna, mora y notificaciones push: si falla, el catálogo se
queda sin infraestructura pero el servidor arranca igual para todos los demás.

`hayCatalogo()` en `config/columnas.js` detecta al arrancar si existen las tres
tablas; si falta alguna, el middleware `requireCatalogo` responde **503** en vez
de reventar con `relation does not exist`.

---

## 6. Cambios en el backend

### 6.1 Módulo nuevo, patrón de la casa

```
backend/src/modules/catalogo/
  catalogo.routes.js          → admin (protegida): CRUD de fichas + subida de fotos
  catalogo.publico.routes.js  → público (sin auth): solo GET
  catalogo.controller.js
  catalogo.service.js
  catalogo.repository.js      → consultas de admin
  catalogo.publico.repository.js  → consulta pública, con lista blanca de columnas
  catalogo.storage.js         → subida/borrado en Cloudflare R2 (API S3)
```

### 6.2 Montaje en `index.js`

```js
// Público: ANTES del CORS con whitelist y del rate limiter global.
app.use('/api/publico/catalogo',
  cors({ origin: '*', credentials: false, methods: ['GET'] }),
  rateLimit({ windowMs: 60_000, max: 300, /* … */ }),
  require('./modules/catalogo/catalogo.publico.routes'));

// Admin: dentro de la cadena habitual [auth, verificarPlan, resolveSucursal]
app.use('/api/catalogo', protegida, require('./modules/catalogo/catalogo.routes'));
```

**El orden importa y es la parte fácil de romper.** El CORS con whitelist y el
limiter de 60 req/min se montan globalmente más abajo; si la ruta pública
quedara después, el CORS rechazaría al dominio del catálogo y el limiter
estrangularía al renderizador. Por eso va tan arriba, justo después de `helmet()`
y `compression()`.

### 6.3 Endpoints

**Públicos** (sin auth, solo `GET`, respuesta cacheable):

| Método | Ruta | Devuelve |
|---|---|---|
| `GET` | `/api/publico/catalogo/:slug` | vitrina (título, whatsapp, dirección, horario, color) + líneas + productos publicados con sus imágenes |
| `GET` | `/api/publico/catalogo/slugs` | slugs activos — alimenta el prerenderizado y el `sitemap.xml` |

La ficha de producto **no** tiene endpoint propio: el detalle se abre en el
cliente sobre el JSON ya cargado. Un catálogo de una sucursal son cientos de
productos, no millones, y así abrir una ficha no cuesta un viaje al servidor.

**Admin** (dentro de `protegida`):

| Método | Ruta | Acción | Nivel |
|---|---|---|---|
| `GET` | `/api/catalogo/vitrina` | vitrina de la sucursal activa + si el almacenamiento está configurado | `vendedor` |
| `GET` | `/api/catalogo/vitrinas` | todas las vitrinas del negocio | `admin_negocio` |
| `PUT` | `/api/catalogo/vitrina` | crea o actualiza la vitrina (upsert por `sucursal_id`) | `admin_negocio` |
| `GET` | `/api/catalogo/items` | inventario de la sucursal + estado de publicación | `supervisor` |
| `GET` | `/api/catalogo/items/:id` | ficha con las URLs de sus fotos | `supervisor` |
| `PUT` | `/api/catalogo/items` | crea o actualiza la ficha (upsert por `sucursal_id, tipo, producto_id`) | `supervisor` |
| `PATCH` | `/api/catalogo/items/publicar` | publicación / retiro masivo | `supervisor` |
| `POST` | `/api/catalogo/items/:id/imagenes` | subida (`multer` memoryStorage, 5 MB) | `supervisor` |
| `PATCH` | `/api/catalogo/items/:id/imagenes` | reordena / fija portada | `supervisor` |
| `DELETE` | `/api/catalogo/imagenes/:id` | borra del bucket y de la tabla | `supervisor` |

### 6.4 Rate limiting propio

El limiter global de 60 req/min por IP no aplica a `/api/publico`: se monta antes y con
su propia instancia, más permisiva y keyed por `slug + IP`. Con ISR el tráfico real
contra el backend es de ~1 petición cada 5 minutos por negocio, así que 300 req/min es
holgado y sigue frenando un abuso.

### 6.5 CORS

`/api/publico` responde con `Access-Control-Allow-Origin: *` — es contenido público de
solo lectura, sin cookies ni credenciales. **No se toca la whitelist existente**, que
debe seguir siendo estricta para el resto de `/api`.

### 6.6 La consulta pública

Regla dura: **lista blanca de columnas explícita, nunca `SELECT *`, nunca reutilizar
`findAll`.** Esquema:

```sql
SELECT
  ci.id, COALESCE(ci.titulo, rep.nombre) AS nombre,
  ci.descripcion, lp.nombre AS linea, rep.marca, rep.modelo,
  COALESCE(ci.precio_publico, rep.precio) AS precio,
  rep.disponible,                    -- booleano derivado, nunca el número
  img.imagenes
FROM catalogo_items ci
JOIN negocios n ON n.id = ci.negocio_id
LEFT JOIN LATERAL (
  -- fila representativa: sucursal vitrina, fallback a la de menor precio no nulo
  ...
) rep ON true
LEFT JOIN LATERAL ( SELECT JSON_AGG(...) FROM catalogo_imagenes ... ) img ON true
WHERE n.catalogo_slug = $1
  AND n.activo = true
  AND n.estado_plan NOT IN ('vencido', 'suspendido', 'pendiente')   -- misma regla que plan.middleware
  AND ci.publicado = true
ORDER BY ci.destacado DESC, ci.orden, nombre
```

Para `tipo = 'cantidad'` la disponibilidad es `SUM(stock) > 0` entre las sucursales
activas del negocio; para `'serial'`, `EXISTS` de un serial no vendido ni prestado.

---

## 7. Sincronización y frescura

### 7.1 Lo que no hay que sincronizar

Nombre, línea, marca, precio y stock salen en vivo de las tablas de inventario en cada
regeneración de la página. Si el vendedor cambia un precio, el catálogo lo refleja en la
siguiente revalidación. **No hay job, no hay cron, no hay tabla espejo, no hay deriva.**

### 7.2 Frescura

```
Venta / cambio de precio / foto nueva en el POS
        │
        └─ ISR: la página se regenera sola cada 300 s
```

Cinco minutos de desfase en un catálogo que ni siquiera vende es irrelevante
para el negocio, y a cambio el POS queda protegido.

**Deliberadamente NO se revalida en cada venta.** Un negocio con 200 ventas al
día generaría 200 regeneraciones y anularía el beneficio del caché.

> **Pendiente (fase 2):** un botón "Actualizar catálogo ya" que dispare la
> revalidación bajo demanda de Next.js. Hoy **no existe**: tras subir una foto
> hay que esperar hasta 5 minutos para verla en la página pública. Se decidió
> dejarlo fuera de la fase 1 porque exige un secreto compartido entre backend y
> app pública, y el desfase de 5 minutos no bloquea el uso real.

---

## 8. Cambios en el frontend

### 8.1 App interna (`frontend/`)

| Archivo | Cambio |
|---|---|
| `src/api/catalogo.api.js` | **nuevo** — único lugar que arma las URLs del catálogo |
| `src/utils/imagen.js` | **nuevo** — redimensionado y compresión en el navegador (§9.2) |
| `src/pages/inventario/TabCatalogo.jsx` | **nuevo** — rejilla con toggle por producto, búsqueda, filtro por línea y estado, selección y publicación masiva |
| `src/pages/inventario/ModalFichaCatalogo.jsx` | **nuevo** — título, descripción, marca, precio público, destacado y galería de fotos |
| `src/pages/configuracion/CatalogoWebConfig.jsx` | **nuevo** — slug, activo, presentación, WhatsApp, color y qué se muestra |
| `src/pages/inventario/InventarioPage.jsx` | tercera pestaña `Catálogo web`; oculta el carrito y las acciones de inventario en ella |
| `src/pages/configuracion/ConfigPage.jsx` | sección `Catálogo web` en el menú lateral |

**No se agrega una clave nueva a `MODULOS`.** Publicar vive dentro del permiso
`inventario`; la configuración vive en `/config`, que ya es solo
`admin_negocio`. Así no se toca `PERMISOS_BASE` ni los permisos de ningún
usuario existente.

> La sección de Ajustes se llama **«Catálogo web»** para no confundirla con la
> sección **«Catálogo»** que ya existía, que son los datos maestros (líneas,
> garantías, variantes, tarifas…).

### 8.2 App pública (`catalogo/`, nueva)

```
catalogo/
  package.json            → Next 15 + React 19, sin más dependencias
  next.config.mjs
  .env.example
  README.md
  app/
    layout.jsx            → html/body + globals.css
    globals.css           → CSS plano; el color de cada vitrina entra por --marca
    page.jsx              → raíz del dominio (página neutra, noindex)
    not-found.jsx
    [slug]/page.jsx       → la vitrina (ISR 300 s, generateMetadata + Open Graph)
    sitemap.js
    robots.js
  components/Catalogo.jsx → rejilla, búsqueda, filtro por línea, ficha, WhatsApp
  lib/api.js              → único punto de contacto con el backend público
```

Sin auth, sin PWA, sin service worker, sin Zustand, sin React Query, **sin
Tailwind**: CSS plano para no arrastrar un paso de build más en una app de dos
pantallas. Búsqueda y filtros se resuelven en el cliente sobre el JSON ya
renderizado, así que el HTML inicial se ve completo aunque el JavaScript no haya
cargado — que es lo que hace que abra rápido con mala señal.

Las fotos se sirven con `<img>` y no con `next/image`: ya llegan comprimidas a
WebP ~200 KB desde el navegador del vendedor, y así cambiar de proveedor de
almacenamiento no obliga a declarar hosts remotos ni a redesplegar.

---

## 9. Imágenes

### 9.1 Dónde alojarlas — y por qué NO en Supabase

> **Cambio de decisión (3-ago-2026).** La propuesta original decía Supabase
> Storage porque "no agrega infraestructura". Al revisar los límites reales del
> plan **gratuito** de Supabase, esa decisión resultó peligrosa. Se cambió a
> **Cloudflare R2**.

**El problema con Supabase Storage en plan gratuito:** el cupo de salida
(~5 GB/mes, conviene verificar el número vigente) es **compartido entre el
storage y la base de datos** — la misma base que corre la facturación de los
~28 negocios reales.

Las cuentas no cierran:

| | |
|---|---|
| Una visita al catálogo, con carga diferida | ~1,6 MB (8 fotos visibles) |
| Una visita con scroll por 50 productos | ~10 MB |
| Promedio realista | ~3 MB por visita |
| **5 GB ÷ 3 MB** | **~1.600 visitas/mes entre TODOS los negocios** |

Un vendedor que comparte el enlace en un grupo de 200 personas y la mitad lo
abre gasta ~300 MB en una tarde. Diez enlaces así se comen el mes.

**Y el riesgo no era el costo, era el punto de venta.** Al pasarse del cupo,
Supabase puede restringir el proyecto — y ese proyecto es el que factura para 28
negocios. Un catálogo viral no puede tener la capacidad de tumbar la operación.

**Comparativa:**

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| **Cloudflare R2** | **Egress gratis, sin tope.** 10 GB de almacenamiento en el free tier. API compatible con S3. El perfil exacto de esta feature: pocos archivos, muchas lecturas | Proveedor nuevo. La URL `r2.dev` viene limitada a propósito: para producción hace falta un dominio propio en Cloudflare | ✅ **Elegida** |
| Supabase Storage | Cero infraestructura nueva | Egress compartido con la BD del POS, en plan gratuito | ❌ Riesgo operativo |
| Cloudinary | Las mejores transformaciones | El free tier por créditos se agota rápido con varios negocios | Alternativa |
| Vercel Blob | Integración directa | Se paga almacenamiento **y** transferencia; el plan Hobby es solo no comercial | ❌ |
| S3 + CloudFront | Barato a escala grande | Cobra egress; mucha más plomería | ❌ para este tamaño |

**Bucket `catalogo`, rutas `negocio_<id>/item_<id>/<uuid>.webp`.** El nombre
lleva UUID, así que el archivo nunca cambia y se sirve con
`Cache-Control: immutable` a un año: las visitas repetidas no cuestan nada.

Cambiar de proveedor fue barato porque el módulo está aislado:
[catalogo.storage.js](backend/src/modules/catalogo/catalogo.storage.js) expone
solo `estaActivo()`, `subir()` y `borrar()`. El resto del sistema no sabe quién
guarda los archivos. **Si mañana R2 tampoco sirve, se cambia ese único archivo.**

### 9.2 Comprimir en el navegador, no en el servidor

El navegador redimensiona a máximo 1600 px de lado mayor y convierte a WebP con `canvas`
antes de subir (~150-250 KB por foto). Dos razones:

1. **Evita `sharp` en el backend.** Es una dependencia nativa pesada, con historial de
   problemas de build en contenedores, y la instalación en Railway ya es delicada
   (el backend usa pnpm con `--config.package-manager-strict=false`).
2. **Sube 10× más rápido en 4G colombiano**, que es la conexión real del vendedor que
   toma la foto con el celular.

El backend **igual valida**: magic bytes reales (no confiar en el `mimetype` que manda el
cliente), tamaño máximo 5 MB, máximo 6 imágenes por producto, y extensión forzada según
el tipo detectado.

### 9.3 Costos estimados

30 negocios × 200 productos × 3 fotos × 200 KB ≈ **3,6 GB**. El free tier de R2
son 10 GB de almacenamiento y **cero cobro por salida**, así que el costo
marginal de esta feature es **cero**, sin importar cuánto se compartan los
enlaces.

El consumo contra Supabase queda reducido a las consultas SQL de la
regeneración: con ISR de 30 minutos, una vitrina con tráfico constante genera
como mucho ~1.400 consultas/mes, con respuestas comprimidas con gzip. Es ruido
frente al cupo.

---

## 10. Riesgos

| # | Riesgo | Impacto | Cómo quedó |
|---|---|---|---|
| ~~R-1~~ | ~~Renombrar un producto rompe el vínculo con su ficha~~ | — | **Eliminado por diseño.** Al ser el catálogo por sucursal, la ficha se ata al `producto_id` real y no a una clave por nombre. Renombrar no afecta nada. |
| **R-2** | **Fuga de datos reservados** (costo, IMEI, proveedor, cliente origen, nota, ubicación, stock exacto) | **Crítico** | `catalogo.publico.repository.js` es un archivo aparte con lista blanca de columnas, sin `SELECT *` y sin reutilizar ninguna consulta del inventario. **Punto fijo de cualquier revisión de código sobre este módulo.** |
| **R-3** | El costo se despeja desde un precio de tarifa (§1.5) | Alto | El catálogo publica `precio_publico` o el precio de lista. Nunca uno calculado desde el costo. |
| **R-4** | Tráfico público contra la BD del POS | Alto | ISR 300 s + limiter propio de 300 req/min. El backend recibe ~1 petición cada 5 min por vitrina, no una por visitante. |
| **R-5** | Publicación accidental de todo el inventario | Alto (reputacional) | Doble opt-in: `catalogo_sucursal.activo` **y** `catalogo_items.publicado = FALSE` por defecto. Ninguna fila de ficha existe hasta que alguien la toca. |
| **R-6** | Un negocio con plan vencido deja su catálogo vivo | Medio | El estado del plan se evalúa en cada regeneración con la misma regla de `plan.middleware.js` (incluido el `COALESCE` para que un `estado_plan` nulo se comporte igual en ambos lados). Con ISR se apaga en ≤5 min. |
| **R-7** | Slugs colisionan o secuestran rutas | Medio | Índice único sobre `LOWER(slug)` + lista de reservados + validación en el service. |
| **R-8** | Fotos con contenido inapropiado | Medio | Fuera de alcance técnico. Trazabilidad: `catalogo_imagenes.usuario_id` registra quién subió cada una, y el superadmin puede apagar la vitrina. |
| **R-9** | Next.js es un framework nuevo en el repo | Bajo | Aislado en `catalogo/`, con su propio `package.json` y su propio despliegue. Descartarlo no toca nada del sistema actual. |
| **R-10** | Los productos serial se borran físicamente (§1.1) | Bajo | El `JOIN` de la consulta pública no encuentra el producto y la ficha simplemente deja de aparecer. La fila huérfana queda en `catalogo_items` sin efecto. |
| **R-11** | Sin el bucket de R2 creado, subir una foto falla | Bajo | El backend detecta la ausencia de credenciales y responde 503 con un mensaje explícito; la UI avisa antes de dejar intentar. Publicar sin fotos funciona igual. |

---

## 11. Estado de la implementación

### Fase 1 — MVP funcional · **hecha** (3-ago-2026)

**Backend**
- [x] Migración aditiva de 3 tablas, idempotente, en su propio `try/catch`
- [x] `hayCatalogo()` en `columnas.js` + middleware `requireCatalogo` (503 si falta la migración)
- [x] Módulo `catalogo/` completo (repo admin, repo público, service, controller, storage, middleware, rutas)
- [x] `catalogo.storage.js` contra Cloudflare R2 con validación por magic bytes
- [x] Ruta pública con CORS abierto, limiter propio y cabeceras de caché
- [x] Validación de slug (formato + reservados + unicidad) y de WhatsApp en el service
- [x] Auditoría de activación de vitrina y de publicación masiva

**Frontend interno**
- [x] `catalogo.api.js` y `utils/imagen.js` (compresión a WebP en el navegador)
- [x] Pestaña `Catálogo web` en Inventario con publicación individual y masiva
- [x] Modal de ficha con galería, portada y borrado de fotos
- [x] `CatalogoWebConfig` en Ajustes

**Catálogo público**
- [x] App Next.js en `catalogo/`, con ISR, metadata, Open Graph, sitemap y robots
- [x] Rejilla, búsqueda, filtro por línea, ficha con galería y botón de WhatsApp
- [x] `pnpm build` verificado

**Verificado:** `node --check` sobre todo el backend, `eslint` sobre los archivos
nuevos del frontend, `pnpm build` del frontend interno y `pnpm build` de la app
pública.

**No verificado todavía:** el recorrido completo contra la base de datos real.
Requiere la configuración de §14.

### Fase 2 — pendiente

- Botón "Actualizar catálogo ya" (revalidación bajo demanda, §7.2)
- Subdominios wildcard con 301 desde la ruta
- Logo del negocio en la cabecera de la vitrina
- JSON-LD `Product` + `Offer` para resultados enriquecidos
- Atributos y variantes en la ficha (tallas, colores)
- Métricas: vistas por producto

### Fase 3 — pendiente

- Carrito de **cotización** (no de venta) que llega por WhatsApp o como fila en
  una tabla que el vendedor convierte en factura
- Notificación push al vendedor cuando entra una cotización (el módulo ya existe)
- Dominio propio del negocio

---

## 12. Impacto en el rendimiento

| Componente | Impacto | Detalle |
|---|---|---|
| BD (escrituras del POS) | **Nulo** | Ninguna tabla existente cambia de forma. Dos tablas nuevas que solo escriben quienes usan la feature. |
| BD (lecturas) | **Bajo** | ~1 consulta cada 5 min por negocio con catálogo activo, con índices dedicados. Una sola consulta con `LATERAL`, sin el JOIN a `facturas` de la vista interna. |
| Backend Railway | **Bajo** | El tráfico público no escala con los visitantes, escala con los negocios. |
| App interna | **Nulo mientras esté apagada** | La pestaña Catálogo solo se monta con `catalogo_activo = '1'`. Un negocio sin la feature no descarga ni una línea extra. |
| Bundle del frontend interno | **+~15 KB** | La pestaña y el modal, con carga diferida. |
| Almacenamiento | **~3,6 GB** proyectado | Dentro de lo ya contratado (§9.3). |
| Catálogo público | **HTML estático** | Servido desde el CDN de Vercel. Objetivo: LCP < 1,5 s en 4G. |

**El riesgo de rendimiento real no está en el catálogo: está en no cachearlo.** Servir el
catálogo sin ISR significa que un enlace compartido en un grupo de WhatsApp golpea
directamente la base de datos que corre la facturación. Todo el diseño de §7 existe para
evitar eso.

---

## 13. Recomendaciones finales

1. **Cerrar §3 antes de codificar.** Las dudas A y B cambian el modelo de datos; el resto
   son ajustes.
2. **El catálogo lee, no copia.** Es la decisión que elimina la clase entera de bugs de
   sincronización, y es consistente con Tesorería y red interna.
3. **Doble opt-in, sin excepciones.** `catalogo_activo` a nivel de negocio y `publicado`
   a nivel de producto, ambos apagados por defecto. La BD es compartida por 28 negocios
   reales; no hay margen para una publicación accidental.
4. **Repositorio público separado con lista blanca de columnas.** Prohibido reutilizar
   `findAll`. Este es el control de seguridad más importante de toda la feature.
5. **Nunca publicar precios derivados de tarifa.** Deja despejar el costo.
6. **Cloudflare R2 para las fotos, nunca Supabase Storage** (§9.1). En plan
   gratuito el cupo de salida de Supabase es compartido con la base de datos que
   corre la facturación: un catálogo viral podría restringir el proyecto y con él
   el punto de venta. R2 no cobra salida. Comprimir en el navegador, porque evita
   `sharp` en Railway y porque el vendedor sube fotos desde 4G.
7. **Ruta antes que subdominio.** Migrar después cuesta un `middleware.ts`; empezar por
   wildcard cuesta plan de pago y certificados desde el día uno.
8. **Next.js aislado en `catalogo/`.** Si no convence, se descarta sin haber tocado el
   sistema que hoy funciona.
9. **Migración con `try/catch` propio y detección en `columnas.js`**, como red interna,
   mora y notificaciones push. Un fallo aquí no puede dejar sin servidor a 28 negocios.
10. **Empezar con un solo negocio de prueba** (VideoTiendaGafas, el negocio 4) antes de
    ofrecerlo. La feature es visible hacia afuera: un error aquí no lo ve el dueño, lo ven
    sus clientes.

---

## 14. Qué falta por configurar

Todo el código está escrito y compila. Para que el catálogo quede **en línea**
faltan cinco pasos de infraestructura, ninguno de código.

### 14.1 Crear el bucket en Cloudflare R2 · **obligatorio para fotos**

1. Cuenta en Cloudflare → **R2** → **Create bucket**, nombre `catalogo`.
2. **R2 → Manage API Tokens → Create API Token**, con permiso *Object Read &
   Write* sobre ese bucket. Anota `Access Key ID` y `Secret Access Key` (el
   secreto se muestra **una sola vez**).
3. Anota tu **Account ID** (aparece en el panel de R2).
4. **Exponer el bucket públicamente.** Los objetos de R2 no son públicos por sí
   solos. En **Settings del bucket → Public access → Custom domain**, conecta un
   subdominio, por ejemplo `fotos.tudominio.com`. Requiere que el dominio esté
   gestionado por Cloudflare.

> ⚠️ **No uses la URL `r2.dev`.** Cloudflare la limita a propósito y no está
> pensada para producción.

Sin esto, publicar productos funciona; subir fotos devuelve un 503 con un
mensaje explícito y la interfaz avisa antes de dejar intentarlo.

### 14.2 Variables de entorno del backend (Railway)

```
R2_ACCOUNT_ID=<tu account id de Cloudflare>
R2_ACCESS_KEY_ID=<del token de R2>
R2_SECRET_ACCESS_KEY=<del token de R2>
R2_PUBLIC_URL=https://fotos.tudominio.com    # ← tu dominio real, ver §14.6
R2_BUCKET=catalogo          # opcional, es el valor por defecto
```

Las cuatro primeras son obligatorias: si falta cualquiera, el módulo de imágenes
se apaga entero en vez de dejar fotos subidas que nadie puede ver.

> `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` **no** se usan para el catálogo. Siguen
> siendo del módulo de backup.

> ⚠️ **En todo este runbook, `tudominio.com` es un MARCADOR DE POSICIÓN.**
> No lo copies literal: es un dominio de otra persona. Sustitúyelo por tu dominio
> real, o usa la URL gratuita de Vercel — ver §14.6.

### 14.3 Desplegar la app pública en Vercel

Proyecto **nuevo**, distinto del frontend actual:

| Ajuste | Valor |
|---|---|
| Root Directory | `catalogo` |
| Framework Preset | Next.js (se detecta solo) |
| Install Command | `pnpm install` |
| Variables | `NEXT_PUBLIC_API_URL` = la URL del backend en Railway, **sin barra final** |
| | `NEXT_PUBLIC_SITE_URL` = el dominio donde quede esta app |

Luego apuntar el dominio que se vaya a compartir (`midominio.com`) a este
proyecto.

### 14.4 Variable del frontend interno (Vercel)

En el proyecto del frontend actual, agregar:

```
VITE_CATALOGO_URL=https://midominio.com
```

Es lo que arma el enlace para copiar en la pestaña Catálogo web y en Ajustes.
Sin ella todo funciona, pero la app muestra solo el slug y avisa que falta
configurarla.

### 14.5 Reiniciar el backend

La migración se aplica sola al arrancar. Al reiniciar, en los logs debe verse
que **no** aparece:

```
⚠️  Migración del catálogo público no aplicada …
⚠️  Tablas del catálogo ausentes: el catálogo web queda desactivado.
```

Si aparece alguna, el catálogo queda apagado (responde 503) y el resto del
sistema sigue normal. Habría que aplicar
`migrations/20260803_catalogo_publico.sql` a mano.

---

### 14.6 Si todavía no tienes dominio propio

No hace falta comprar nada para poner el catálogo a funcionar. Vercel asigna una
URL gratuita del tipo `<nombre-del-proyecto>.vercel.app`, y sirve igual para
compartir por WhatsApp.

En **Settings → Domains** del proyecto puedes reclamar cualquier subdominio
`.vercel.app` que esté libre, así que se puede dejar algo presentable
(`catalogo-minegocio.vercel.app`) en vez del nombre autogenerado.

Con eso, las variables quedan:

```
# Proyecto del catálogo
NEXT_PUBLIC_SITE_URL = https://catalogo-minegocio.vercel.app

# Proyecto del frontend interno  (y recuerda REDESPLEGAR)
VITE_CATALOGO_URL    = https://catalogo-minegocio.vercel.app
```

**El punto que sí queda cojo sin dominio son las FOTOS.** R2 necesita un dominio
propio en Cloudflare para servir el bucket públicamente; su URL de desarrollo
`pub-<hash>.r2.dev` está limitada por Cloudflare a propósito y no está pensada
para tráfico real. Dos salidas:

| Camino | Cuándo sirve |
|---|---|
| Publicar **sin fotos** por ahora | Funciona hoy, sin configurar nada. La ficha muestra nombre, precio, línea, marca y descripción. Es lo que recomiendo para empezar. |
| Usar la URL `r2.dev` en `R2_PUBLIC_URL` | Solo para probar el flujo de subida con unas pocas visitas. **No dejarlo así en producción.** |

Un dominio cuesta del orden de USD 10-12 al año y desbloquea las dos cosas a la
vez: una URL decente para el catálogo y el dominio de R2 para las fotos. Es la
inversión más rentable de esta feature — pero no es un requisito para arrancar.

### Cómo probarlo, en orden

1. Entrar como `admin_negocio`, elegir una sucursal.
2. **Ajustes → Catálogo web**: revisar la dirección sugerida, encender
   *Catálogo activo*, poner el WhatsApp y guardar.
3. **Inventario → Catálogo web**: seleccionar unos productos y pulsar *Publicar*.
4. Abrir uno, escribirle descripción y subirle una foto.
5. Copiar el enlace y abrirlo en el celular.

Recomendación: hacerlo primero con **VideoTiendaGafas (negocio 4)**, que es el
de pruebas. Esta feature es visible hacia afuera — un error aquí no lo ve el
dueño, lo ven sus clientes.

---

### Decisiones que quedan a tu criterio

| Tema | Estado | Nota |
|---|---|---|
| Dominio del catálogo | **Sin definir** | Hace falta para `NEXT_PUBLIC_SITE_URL` y `VITE_CATALOGO_URL`. Puede ser un subdominio del actual (`catalogo.tudominio.com`) mientras se decide. |
| Subdominios por sucursal | Fase 2 | En Vercel los dominios wildcard son de plan de pago; conviene confirmar el precio vigente antes de comprometerse. |
| ¿Se ofrece a todos los negocios o solo a algunos? | **Sin definir** | Hoy cualquier `admin_negocio` puede activarlo. Si se quiere restringir por plan, hay que meterlo en `ModuloGuard` / la verificación de plan. |
| Retención de fotos al borrar un producto | **Sin definir** | Hoy la ficha queda huérfana en `catalogo_items` y deja de aparecer en la vitrina. Las imágenes siguen en el bucket. No molesta a nadie, pero conviene una limpieza periódica si crece. |

---

## Anexo — Qué se publica y qué no

| Campo | ¿Público? | Origen |
|---|---|---|
| Nombre / título | ✅ | `productos_*.nombre` o `catalogo_items.titulo` |
| Descripción | ✅ | `catalogo_items.descripcion` (**campo nuevo**) |
| Línea / categoría | ✅ | `lineas_producto.nombre` |
| Marca | ✅ | `productos_serial.marca` (o campo nuevo — duda B) |
| Modelo | ✅ | `productos_serial.modelo` |
| Colores disponibles | ✅ | `DISTINCT seriales.color` de los no vendidos (fase 2) |
| Precio | ✅ opcional | lista o `precio_publico`; **nunca** tarifa |
| Disponibilidad | ✅ opcional | booleano derivado, **nunca el número** |
| Imágenes | ✅ | `catalogo_imagenes` (**tabla nueva**) |
| Unidad de medida | ✅ | `productos_cantidad.unidad_medida` |
| — | | |
| Costo | ❌ | `costo_unitario`, `costo_compra` |
| IMEI / seriales | ❌ | `seriales.imei` |
| Stock exacto | ❌ | `stock`, `COUNT(seriales)` |
| Proveedor | ❌ | `proveedores.nombre` |
| Cliente origen | ❌ | `cliente_origen` (dato de retoma) |
| Nota interna | ❌ | `nota` (post-it operativo) |
| Ubicación física | ❌ | `ubicacion` |
| Sucursal | ❌ | `sucursal_id`, `sucursales.nombre` |
| Código de barras | ❌ | `codigo` |
</content>
</invoke>
