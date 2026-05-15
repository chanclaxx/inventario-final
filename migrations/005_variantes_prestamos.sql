-- ──────────────────────────────────────────────
-- 005 Soporte de variantes en préstamos
-- Agrega referencia al nivel del árbol de variantes y etiquetas de texto
-- para mostrar la variante prestada (ej. "Talla M / Color Rojo")
-- ──────────────────────────────────────────────

ALTER TABLE prestamos
  ADD COLUMN IF NOT EXISTS atributo_id    INTEGER REFERENCES atributos_producto(id),
  ADD COLUMN IF NOT EXISTS variante_id    INTEGER REFERENCES variantes_atributo(id),
  ADD COLUMN IF NOT EXISTS atributo_label VARCHAR(200),
  ADD COLUMN IF NOT EXISTS variante_label VARCHAR(200);
