-- Migración: agregar campo fecha a tabla retomas
-- Ejecutar en Railway una sola vez

ALTER TABLE retomas
  ADD COLUMN IF NOT EXISTS fecha TIMESTAMPTZ DEFAULT NOW();

-- Los registros existentes quedan con la fecha de ejecución de la migración
-- Los nuevos registros usarán el DEFAULT automáticamente
