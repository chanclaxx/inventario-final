-- ============================================================================
-- Catálogo web público por sucursal
-- ----------------------------------------------------------------------------
-- 100% aditiva e idempotente. Crea 3 tablas nuevas y NINGÚN ALTER sobre tablas
-- existentes. El inventario no se toca: la marca, la descripción comercial y
-- las fotos son datos EXCLUSIVOS de la vitrina.
--
-- El catálogo es POR SUCURSAL: cada sucursal tiene su propio slug (su propia
-- URL) y publica sus propios productos. Como `productos_cantidad` y
-- `productos_serial` ya cuelgan de `sucursal_id`, la ficha se ata al id real
-- del producto y renombrarlo no rompe nada.
--
-- Esta migración también se aplica sola al arrancar el backend
-- (src/config/migrations.js). Este archivo es la copia de referencia.
-- ============================================================================

-- ── Vitrina de la sucursal ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogo_sucursal (
  id                     SERIAL      PRIMARY KEY,
  negocio_id             INTEGER     NOT NULL REFERENCES negocios(id)   ON DELETE CASCADE,
  sucursal_id            INTEGER     NOT NULL UNIQUE REFERENCES sucursales(id) ON DELETE CASCADE,
  slug                   TEXT        NOT NULL,
  activo                 BOOLEAN     NOT NULL DEFAULT FALSE,
  titulo                 TEXT,
  descripcion            TEXT,
  whatsapp               TEXT,
  direccion              TEXT,
  horario                TEXT,
  color_primario         TEXT,
  mostrar_precios        BOOLEAN     NOT NULL DEFAULT TRUE,
  mostrar_disponibilidad BOOLEAN     NOT NULL DEFAULT TRUE,
  ocultar_agotados       BOOLEAN     NOT NULL DEFAULT FALSE,
  creado_en              TIMESTAMP   NOT NULL DEFAULT NOW(),
  actualizado_en         TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- El slug es la URL pública: único en TODA la plataforma, no por negocio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_sucursal_slug
  ON catalogo_sucursal (LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_catalogo_sucursal_negocio
  ON catalogo_sucursal (negocio_id);

-- ── Ficha comercial del producto ────────────────────────────────────────────
-- Solo existe si alguien tocó el producto en la vitrina. `publicado` arranca en
-- FALSE: nada se hace público por accidente.
CREATE TABLE IF NOT EXISTS catalogo_items (
  id              BIGSERIAL     PRIMARY KEY,
  negocio_id      INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE CASCADE,
  sucursal_id     INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  tipo            TEXT          NOT NULL,
  producto_id     INTEGER       NOT NULL,
  publicado       BOOLEAN       NOT NULL DEFAULT FALSE,
  titulo          TEXT,          -- NULL ⇒ usar el nombre del inventario
  descripcion     TEXT,          -- descripción comercial (NO es `nota`, que es interna)
  marca           TEXT,          -- vive solo aquí; el inventario no se modifica
  precio_publico  NUMERIC(14,2), -- NULL ⇒ usar el precio de lista del inventario
  mostrar_precio  BOOLEAN       NOT NULL DEFAULT TRUE,
  destacado       BOOLEAN       NOT NULL DEFAULT FALSE,
  orden           INTEGER       NOT NULL DEFAULT 0,
  creado_en       TIMESTAMP     NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogo_items_tipo_chk CHECK (tipo IN ('serial', 'cantidad'))
);

-- Sin FK a productos_* porque el `tipo` decide la tabla destino; la validación
-- de pertenencia vive en el service.
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_items_producto
  ON catalogo_items (sucursal_id, tipo, producto_id);
CREATE INDEX IF NOT EXISTS idx_catalogo_items_publicados
  ON catalogo_items (sucursal_id, destacado DESC, orden, id) WHERE publicado;

-- ── Fotos ───────────────────────────────────────────────────────────────────
-- Los binarios NUNCA entran a Postgres: aquí solo va la ruta en el bucket
-- (necesaria para poder borrar) y la URL pública del CDN.
CREATE TABLE IF NOT EXISTS catalogo_imagenes (
  id           BIGSERIAL   PRIMARY KEY,
  item_id      BIGINT      NOT NULL REFERENCES catalogo_items(id) ON DELETE CASCADE,
  storage_path TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  alt          TEXT,
  bytes        INTEGER,
  orden        INTEGER     NOT NULL DEFAULT 0,   -- orden 0 = portada
  usuario_id   INTEGER,                          -- trazabilidad de quién subió
  creado_en    TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalogo_imagenes_item
  ON catalogo_imagenes (item_id, orden);
