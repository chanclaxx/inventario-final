-- Agrega costo_unitario individual a atributos y variantes
-- Ejecutar una sola vez contra la base de datos de producción (Railway)

ALTER TABLE public.atributos_producto
  ADD COLUMN IF NOT EXISTS costo_unitario numeric(12,2);

ALTER TABLE public.variantes_atributo
  ADD COLUMN IF NOT EXISTS costo_unitario numeric(12,2);
