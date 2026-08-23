-- ─────────────────────────────────────────────────────────────────────────────
-- CÓDIGO ÚNICO EN VARIANTES (atributos y sub-variantes de productos por cantidad)
--
-- Extiende 20260714_codigo_producto.sql. Aquel dejó el código en el PRODUCTO,
-- pero con la feature "Variantes" activa lo que el cliente escanea no es el
-- producto: es la talla 38MM de la correa, no "la correa". Un producto con 30
-- atributos tenía un solo código y el lector solo podía abrir el árbol para que
-- alguien eligiera a mano — justo lo que el código venía a evitar.
--
-- 100% ADITIVA e IDEMPOTENTE: se puede ejecutar varias veces sin efecto.
-- Columnas nullable y SIN backfill: un negocio que no las use no nota el cambio,
-- y los que ya tenían código en el producto siguen escaneando igual que ayer.
--
-- Diseño:
--   * TEXT (nunca numérico): preserva ceros a la izquierda de códigos EAN/UPC.
--   * atributos_producto: unicidad por (sucursal_id, codigo) entre activos,
--     idéntica a la del producto — tiene sucursal_id propio.
--   * variantes_atributo: NO tiene sucursal_id (cuelga de atributo_id), así que
--     su índice único es por (atributo_id, codigo). El alcance de sucursal y la
--     unicidad ENTRE los tres niveles —que no es expresable como constraint
--     porque son tres tablas— los impone src/utils/codigo.util.js, igual que ya
--     ocurría con la regla "un código = un solo nombre de producto".
--
-- Esta migración también se auto-aplica al arrancar el backend
-- (src/config/migrations.js). Escribir el .sql y olvidar el runner deja el
-- despliegue con el código nuevo contra una base vieja.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS atributos_producto ADD COLUMN IF NOT EXISTS codigo TEXT;
ALTER TABLE IF EXISTS variantes_atributo ADD COLUMN IF NOT EXISTS codigo TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_atributos_producto_codigo
  ON atributos_producto (sucursal_id, codigo)
  WHERE codigo IS NOT NULL AND activo;

CREATE UNIQUE INDEX IF NOT EXISTS uq_variantes_atributo_codigo
  ON variantes_atributo (atributo_id, codigo)
  WHERE codigo IS NOT NULL AND activo;

-- Rollback manual (si algún día se necesita):
--   DROP INDEX IF EXISTS uq_atributos_producto_codigo;
--   DROP INDEX IF EXISTS uq_variantes_atributo_codigo;
--   ALTER TABLE atributos_producto DROP COLUMN IF EXISTS codigo;
--   ALTER TABLE variantes_atributo DROP COLUMN IF EXISTS codigo;
