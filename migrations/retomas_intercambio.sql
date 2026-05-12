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

-- 5. color (útil para seriales)
ALTER TABLE retomas
  ADD COLUMN IF NOT EXISTS color character varying(50);

-- 6. usuario que registró el abono / intercambio
ALTER TABLE abonos_prestamo
  ADD COLUMN IF NOT EXISTS usuario_id integer REFERENCES usuarios(id) ON DELETE SET NULL;
