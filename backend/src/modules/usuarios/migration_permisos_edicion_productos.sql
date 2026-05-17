-- Agrega columna para permisos granulares de edición de productos por usuario
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS permisos_edicion_productos jsonb DEFAULT NULL;
