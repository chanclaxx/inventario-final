-- Migración: sistema de variantes configurables para productos por cantidad
-- Ejecutar en Railway una sola vez

-- ──────────────────────────────────────────────
-- 1. Tipos de característica configurables por negocio
--    Ejemplos: "Talla" (valores: S,M,L,XL), "Color" (valores: Rojo,Azul)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tipos_caracteristica (
  id          SERIAL PRIMARY KEY,
  negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre      VARCHAR(50) NOT NULL,
  valores     JSONB NOT NULL DEFAULT '[]',
  orden       INTEGER DEFAULT 0,
  activo      BOOLEAN DEFAULT true,
  creado_en   TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(nombre, negocio_id)
);

CREATE INDEX IF NOT EXISTS idx_tipos_caract_negocio
  ON tipos_caracteristica(negocio_id);

-- ──────────────────────────────────────────────
-- 2. Atributos de producto — Nivel 1 del árbol
--    Ejemplo: Camiseta → Talla M (stock: 20)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS atributos_producto (
  id           SERIAL PRIMARY KEY,
  producto_id  INTEGER NOT NULL REFERENCES productos_cantidad(id) ON DELETE CASCADE,
  sucursal_id  INTEGER NOT NULL REFERENCES sucursales(id),
  tipo_id      INTEGER REFERENCES tipos_caracteristica(id) ON DELETE RESTRICT,
  valor        VARCHAR(100) NOT NULL,
  stock        INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER DEFAULT 0,
  precio       NUMERIC(12,2),
  activo       BOOLEAN DEFAULT true,
  creado_en    TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(producto_id, sucursal_id, tipo_id, valor)
);

CREATE INDEX IF NOT EXISTS idx_atributos_prod_producto
  ON atributos_producto(producto_id);
CREATE INDEX IF NOT EXISTS idx_atributos_prod_sucursal
  ON atributos_producto(sucursal_id);

-- ──────────────────────────────────────────────
-- 3. Variantes de atributo — Nivel 2 del árbol
--    Ejemplo: Talla M → Color Rojo (stock: 10)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS variantes_atributo (
  id           SERIAL PRIMARY KEY,
  atributo_id  INTEGER NOT NULL REFERENCES atributos_producto(id) ON DELETE CASCADE,
  tipo_id      INTEGER REFERENCES tipos_caracteristica(id) ON DELETE RESTRICT,
  valor        VARCHAR(100) NOT NULL,
  stock        INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER DEFAULT 0,
  precio       NUMERIC(12,2),
  activo       BOOLEAN DEFAULT true,
  creado_en    TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(atributo_id, tipo_id, valor)
);

CREATE INDEX IF NOT EXISTS idx_variantes_atributo_atributo
  ON variantes_atributo(atributo_id);

-- ──────────────────────────────────────────────
-- 4. Extender historial_stock_cantidad con referencia opcional al nivel de árbol
--    Las columnas son nullable: registros existentes no se ven afectados
-- ──────────────────────────────────────────────
ALTER TABLE historial_stock_cantidad
  ADD COLUMN IF NOT EXISTS atributo_id INTEGER REFERENCES atributos_producto(id),
  ADD COLUMN IF NOT EXISTS variante_id INTEGER REFERENCES variantes_atributo(id);

-- ──────────────────────────────────────────────
-- 5. Extender lineas_factura para guardar referencia de nivel de árbol
--    Necesario para revertir stock correctamente en cancelaciones
-- ──────────────────────────────────────────────
ALTER TABLE lineas_factura
  ADD COLUMN IF NOT EXISTS atributo_id INTEGER REFERENCES atributos_producto(id),
  ADD COLUMN IF NOT EXISTS variante_id INTEGER REFERENCES variantes_atributo(id);
