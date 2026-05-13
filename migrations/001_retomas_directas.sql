-- Migración: soporte para retomas directas (sin préstamo asociado)
-- Ejecutar en Railway una sola vez

ALTER TABLE retomas
  ADD COLUMN IF NOT EXISTS tipo_persona VARCHAR(20),
  ADD COLUMN IF NOT EXISTS persona_id   INTEGER,
  ADD COLUMN IF NOT EXISTS sucursal_id  INTEGER REFERENCES sucursales(id);

CREATE INDEX IF NOT EXISTS idx_retomas_persona
  ON retomas(tipo_persona, persona_id)
  WHERE tipo_persona IS NOT NULL;
