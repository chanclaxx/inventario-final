-- Migración: permisos granulares de proveedores por usuario
-- Ejecutar en la base de datos de producción (Railway)

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS permisos_proveedores JSONB DEFAULT NULL;

-- Estructura del JSON:
-- {
--   "ver":      true/false,   -- puede ver la lista/detalle
--   "ver_todos": true/false,  -- si ver=true, ve todos (true) o solo algunos (false)
--   "ver_lista": [1, 2, 5],   -- IDs de proveedores visibles si ver_todos=false
--   "crear":    true/false    -- puede crear proveedores
-- }
--
-- NULL = sin permisos (para admin_negocio se ignora, siempre tiene acceso total)
