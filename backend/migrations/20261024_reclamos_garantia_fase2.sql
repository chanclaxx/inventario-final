-- ─────────────────────────────────────────────────────────────────────────────
-- GARANTÍAS CON PROVEEDORES — fase 2 (ver 20261023_reclamos_garantia.sql)
--
--   · `reclamos_garantia.orden_servicio_id`: la garantía que nace de una orden
--     de Servicios (el cliente trajo el equipo a reparar y resultó ser para el
--     proveedor) queda ligada a esa orden.
--   · `reclamos_garantia_archivos`: las FOTOS (y papeles) del producto dañado,
--     la prueba que pide el proveedor. Mismo almacenamiento PRIVADO y mismas
--     reglas que los documentos de las compras (`archivos/archivos.storage.js`):
--     nada tiene URL pública, el tipo lo decide el contenido, se guarda dónde
--     quedó y su huella, y NO HAY BORRADO — lo que sobra se anula con motivo.
--
-- Aditiva: sin esta migración la fase 1 sigue igual (`hayReclamosFase2()` en
-- falso apaga las fotos y no nombra la columna nueva). El runner de arranque
-- lee ESTE MISMO archivo.
--
-- Rollback:
--   DROP TABLE IF EXISTS reclamos_garantia_archivos;
--   ALTER TABLE reclamos_garantia DROP COLUMN IF EXISTS orden_servicio_id;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS orden_servicio_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_reclamos_garantia_orden
  ON reclamos_garantia (orden_servicio_id) WHERE orden_servicio_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reclamos_garantia_archivos (
  id                SERIAL PRIMARY KEY,
  negocio_id        INTEGER   NOT NULL,
  reclamo_id        INTEGER   NOT NULL REFERENCES reclamos_garantia(id) ON DELETE RESTRICT,
  nombre_original   TEXT      NOT NULL,
  mime              TEXT      NOT NULL,
  extension         TEXT      NOT NULL,
  tamano_bytes      INTEGER   NOT NULL CHECK (tamano_bytes > 0),
  sha256            TEXT      NOT NULL,
  proveedor_storage TEXT      NOT NULL,
  bucket            TEXT      NOT NULL,
  storage_path      TEXT      NOT NULL,
  nota              TEXT,
  usuario_id        INTEGER,
  fecha             TIMESTAMP NOT NULL DEFAULT NOW(),
  anulado           BOOLEAN   NOT NULL DEFAULT FALSE,
  anulado_motivo    TEXT,
  anulado_por       INTEGER,
  anulado_en        TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reclamos_archivos_reclamo ON reclamos_garantia_archivos (reclamo_id);
-- La misma foto dos veces en el mismo caso es lo que deja un doble clic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reclamos_archivos_huella
  ON reclamos_garantia_archivos (reclamo_id, sha256) WHERE NOT anulado;
