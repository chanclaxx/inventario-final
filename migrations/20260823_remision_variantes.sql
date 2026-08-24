-- ─────────────────────────────────────────────────────────────────────────────
-- LA LÍNEA DE REMISIÓN APUNTA A UN NODO, NO SOLO AL PRODUCTO
--
-- La red interna se diseñó cuando el stock de un producto por cantidad vivía en
-- `productos_cantidad.stock`. La feature "Variantes" lo bajó un nivel —a
-- `atributos_producto` y `variantes_atributo`— y la red interna no se enteró:
-- seguía moviendo stock y costo en el nivel del producto.
--
-- El daño era silencioso y grave para un catálogo por variantes:
--   · no se podía despachar "5 de la talla 38MM", solo "5 de 360 NEGRO";
--   · tras recibir, `producto.stock` decía 5 y la suma de sus variantes 0;
--   · el costo (el valor interno) se escribía en el producto, nunca en la
--     variante, así que la tarifa del local no encontraba base y el vendedor
--     tenía que poner el precio a mano;
--   · y la primera operación normal sobre CUALQUIER variante de ese producto
--     disparaba `sincronizarStockProducto`, que recalcula
--     producto.stock = Σ variantes y BORRABA lo recibido — mientras el local
--     seguía debiendo esa mercancía.
--
-- Es el mismo error que tuvo el código escaneable (20260823_codigo_variantes):
-- vivía solo en el producto y hubo que bajarlo a los tres niveles.
--
-- 100% ADITIVA e IDEMPOTENTE. Columnas nullable: las remisiones ya existentes
-- quedan con NULL, que significa exactamente lo que significaba antes —"la
-- línea es del producto entero"— y se siguen leyendo igual.
--
-- Esta migración también se auto-aplica al arrancar el backend
-- (src/config/migrations.js).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS atributo_origen_id  INT;
ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS variante_origen_id  INT;
ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS atributo_destino_id INT;
ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS variante_destino_id INT;

-- Buscar las líneas que movieron un nodo concreto (el extracto y el historial).
CREATE INDEX IF NOT EXISTS idx_lineas_remision_atributo_origen
  ON lineas_remision (atributo_origen_id) WHERE atributo_origen_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lineas_remision_atributo_destino
  ON lineas_remision (atributo_destino_id) WHERE atributo_destino_id IS NOT NULL;

-- El historial de stock ya tenía estas dos columnas para los ajustes normales;
-- el traslado de la red interna no las llenaba. Se aseguran por si alguna base
-- viene de antes de que existieran.
ALTER TABLE IF EXISTS historial_stock_cantidad ADD COLUMN IF NOT EXISTS atributo_id INT;
ALTER TABLE IF EXISTS historial_stock_cantidad ADD COLUMN IF NOT EXISTS variante_id INT;

-- Rollback manual (si algún día se necesita):
--   DROP INDEX IF EXISTS idx_lineas_remision_atributo_origen;
--   DROP INDEX IF EXISTS idx_lineas_remision_atributo_destino;
--   ALTER TABLE lineas_remision DROP COLUMN IF EXISTS atributo_origen_id;
--   ALTER TABLE lineas_remision DROP COLUMN IF EXISTS variante_origen_id;
--   ALTER TABLE lineas_remision DROP COLUMN IF EXISTS atributo_destino_id;
--   ALTER TABLE lineas_remision DROP COLUMN IF EXISTS variante_destino_id;
