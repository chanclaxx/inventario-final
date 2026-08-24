-- ─────────────────────────────────────────────────────────────────────────────
-- LA UTILIDAD DE LA BODEGA: qué le costó a ELLA lo que despachó
--
-- Con el modelo "el envío es la deuda", la bodega le VENDE al local: le entrega
-- mercancía a `valor_interno` y se la cobra. Esa operación no deja factura, así
-- que hasta hoy no aparecía en ningún reporte: la bodega despachaba, su
-- inventario salía y su utilidad no subía un peso. El margen del grupo se
-- perdía entre las dos sucursales — el local reportaba bien (su costo es el
-- valor interno) y la bodega no reportaba nada.
--
-- Para calcularla hace falta el otro lado de la resta: lo que a la BODEGA le
-- costó esa unidad, congelado en el momento del despacho.
--
--   · SERIALES → no hace falta guardarlo: `seriales.costo_compra` es por unidad
--     y no cambia. Se lee por `serial_id`. Y si el admin corrige un costo mal
--     digitado, el reporte se corrige solo, que es lo correcto.
--   · CANTIDAD → sí hace falta. El costo del nodo es un PROMEDIO PONDERADO que
--     se mueve con cada compra: al mes siguiente ya no es el que tenía cuando
--     salió la mercancía, y no hay forma de reconstruirlo. Por eso se fotografía
--     aquí.
--
-- 100% aditiva. NULL en todo lo despachado antes de esta migración: el reporte
-- lo cuenta como "sin costo" y lo dice, en vez de inventar una cifra.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS lineas_remision
  ADD COLUMN IF NOT EXISTS costo_origen NUMERIC(14,2);

-- Reversa (no ejecutar salvo rollback deliberado):
--   ALTER TABLE lineas_remision DROP COLUMN IF EXISTS costo_origen;
