-- Migración: adaptar tabla retomas para soportar intercambios desde préstamos
-- Ejecutar una sola vez en la base de datos de producción

-- 1. factura_id ya no es obligatorio (puede ser un intercambio de préstamo sin factura)
ALTER TABLE retomas ALTER COLUMN factura_id DROP NOT NULL;

-- 2. referencia al préstamo que genera la retoma
ALTER TABLE retomas
  ADD COLUMN IF NOT EXISTS prestamo_id integer REFERENCES prestamos(id) ON DELETE SET NULL;

-- 3. tipo de producto retomado: 'serial' | 'cantidad'
ALTER TABLE retomas
  ADD COLUMN IF NOT EXISTS tipo_retoma character varying(20) DEFAULT 'serial';

-- 4. FKs opcionales al catálogo de productos
ALTER TABLE retomas
  ADD COLUMN IF NOT EXISTS producto_serial_id   integer REFERENCES productos_serial(id)   ON DELETE SET NULL;
ALTER TABLE retomas
  ADD COLUMN IF NOT EXISTS producto_cantidad_id integer REFERENCES productos_cantidad(id) ON DELETE SET NULL;

-- 5. costo de la retoma (para actualizar costo promedio si es cantidad)
ALTER TABLE retomas
  ADD COLUMN IF NOT EXISTS costo_retoma numeric(12,2) DEFAULT 0;

-- 6. color (útil para seriales)
ALTER TABLE retomas
  ADD COLUMN IF NOT EXISTS color character varying(50);
