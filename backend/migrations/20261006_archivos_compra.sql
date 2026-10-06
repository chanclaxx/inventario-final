-- ─────────────────────────────────────────────────────────────────────────────
-- ARCHIVOS DE UNA COMPRA — el manifiesto de importación y sus papeles (6-oct-2026)
--
-- Una compra guardaba el número de la factura del proveedor y nada más: el
-- manifiesto de importación, la declaración, la lista de empaque o la factura
-- escaneada vivían en el correo o en el celular de alguien, y al año no los
-- encontraba nadie. Esta tabla VINCULA esos archivos a la compra.
--
-- Aquí va solo la FICHA del archivo; el contenido vive en un almacenamiento
-- privado (ver src/modules/archivos/archivos.storage.js). Guardarlo en la base
-- —un BYTEA— inflaría el respaldo diario, que hace SELECT * de cada tabla.
--
-- TRES decisiones que sostienen «que no se pierda con el tiempo»:
--
--   1. NO HAY BORRADO. Un archivo que no corresponde se ANULA con su motivo
--      (quién, cuándo, por qué) y sigue guardado: mismo criterio que los abonos
--      y los pagos a técnicos. Ningún código del módulo hace DELETE.
--
--   2. La compra no se puede borrar mientras tenga archivos (ON DELETE
--      RESTRICT). Cancelar una compra es un ESTADO, no un borrado, así que sus
--      documentos se siguen viendo.
--
--   3. Cada ficha recuerda DÓNDE quedó su archivo (`proveedor_storage`,
--      `bucket`, `storage_path`) y su huella (`sha256`, `bytes`). Si mañana se
--      cambia de almacenamiento, lo viejo se sigue leyendo de donde se escribió;
--      y al descargar se comprueba que lo que vuelve es lo que se subió.
--
-- `negocio_id` va en la fila (y no solo por la compra) para que el alcance por
-- negocio no dependa de un JOIN que alguien pueda olvidar.
--
-- Idempotente. Sin esta tabla, `hayArchivosCompra()` queda en falso, las rutas
-- responden 404 y las compras siguen exactamente igual.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archivos_compra (
  id                BIGSERIAL PRIMARY KEY,
  negocio_id        INTEGER NOT NULL,
  compra_id         INTEGER NOT NULL REFERENCES compras(id) ON DELETE RESTRICT,

  -- Qué papel es. Texto con CHECK y no un catálogo aparte: son cinco valores
  -- y la lista vive también en el service y en la pantalla (la suite 73 vigila
  -- que las tres no se separen).
  tipo              TEXT NOT NULL DEFAULT 'manifiesto'
                    CHECK (tipo IN ('manifiesto', 'declaracion', 'factura', 'empaque', 'otro')),
  -- El número que trae el papel (el del manifiesto, el de la declaración…):
  -- es por lo que se busca años después. Opcional.
  numero_documento  TEXT,
  fecha_documento   DATE,
  nota              TEXT,

  -- El archivo
  nombre_original   TEXT    NOT NULL,
  mime              TEXT    NOT NULL,
  bytes             INTEGER NOT NULL CHECK (bytes > 0),
  sha256            TEXT    NOT NULL,
  proveedor_storage TEXT    NOT NULL,
  bucket            TEXT    NOT NULL,
  storage_path      TEXT    NOT NULL,

  subido_por        INTEGER,
  creado_en         TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Anulación: nunca se borra.
  anulado           BOOLEAN NOT NULL DEFAULT FALSE,
  anulado_por       INTEGER,
  anulado_en        TIMESTAMP,
  motivo_anulacion  TEXT
);

CREATE INDEX IF NOT EXISTS idx_archivos_compra_compra
  ON archivos_compra (compra_id);
CREATE INDEX IF NOT EXISTS idx_archivos_compra_negocio
  ON archivos_compra (negocio_id);

-- El MISMO archivo no se adjunta dos veces a la misma compra: es lo que deja un
-- doble clic o un reintento tras un corte. Parcial: anular uno permite volver a
-- subirlo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_archivos_compra_huella
  ON archivos_compra (compra_id, sha256) WHERE NOT anulado;
