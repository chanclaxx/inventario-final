-- ─────────────────────────────────────────────────────────────────────────────
-- CÓDIGO ÚNICO DE PRODUCTO (tipo supermercado) para productos por cantidad.
--
-- El código es una LLAVE de búsqueda (EAN-13 del fabricante o código interno
-- que el negocio crea/homologa). Se escanea en el POS → resuelve al producto.
-- Feature opt-in por negocio vía config_negocio.codigo_producto_activo ('1'/'0');
-- ese flag NO requiere migración (config_negocio es clave-valor).
--
-- 100% ADITIVA e IDEMPOTENTE: se puede ejecutar varias veces sin efecto.
-- Columna nullable: los negocios que no activen la feature no notan el cambio.
--
-- Diseño:
--   * TEXT (nunca numérico): preserva ceros a la izquierda de códigos EAN/UPC.
--   * Unicidad por (sucursal_id, codigo) SOLO entre productos activos:
--     - un escaneo en una sucursal resuelve a un único producto;
--     - el mismo producto lógico (mismo nombre) en otras sucursales COMPARTE
--       el código — eso es correcto y deseado;
--     - un producto borrado (activo = false) libera su código.
--   * La regla "un código = un solo nombre de producto dentro del negocio"
--     se valida en productosCantidad.service.js (no es expresable como
--     constraint simple porque el producto lógico vive en N filas por sucursal).
--
-- Esta migración también se auto-aplica al arrancar el backend
-- (src/config/migrations.js).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS codigo TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_cantidad_codigo
  ON productos_cantidad (sucursal_id, codigo)
  WHERE codigo IS NOT NULL AND activo;

-- Rollback manual (si algún día se necesita):
--   DROP INDEX IF EXISTS uq_productos_cantidad_codigo;
--   ALTER TABLE productos_cantidad DROP COLUMN IF EXISTS codigo;
