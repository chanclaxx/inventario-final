-- ─────────────────────────────────────────────────────────────────────────────
-- RED INTERNA v2 — devoluciones auditables y corrección de valores
--
-- 100% ADITIVA e IDEMPOTENTE. Solo toca tablas que creó 20260725_red_interna.sql;
-- ninguna tabla del sistema original se modifica.
--
-- QUÉ RESUELVE:
--   1. La devolución se autoconfirmaba y no distinguía si el equipo venía de
--      bodega o era del local. La bodega recibía mercancía sin rastro ni
--      confirmación. Ahora cada línea guarda su ORIGEN y si genera saldo a favor.
--   2. No había forma de corregir el valor de una línea ya recibida sin
--      reescribir la historia. Ahora queda una nota de corrección trazable.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Origen de la unidad devuelta ─────────────────────────────────────────────
--   'bodega' → vino en una remisión: la devolución cancela la consignación
--   'propio' → es del local (retoma, compra propia, inventario inicial):
--              la bodega la recibe, y solo genera saldo a favor si se pide
ALTER TABLE IF EXISTS lineas_remision
  ADD COLUMN IF NOT EXISTS origen_unidad TEXT;

ALTER TABLE IF EXISTS lineas_remision
  ADD COLUMN IF NOT EXISTS genera_saldo_favor BOOLEAN NOT NULL DEFAULT FALSE;

-- Valor original antes de una corrección. NULL = nunca se corrigió.
ALTER TABLE IF EXISTS lineas_remision
  ADD COLUMN IF NOT EXISTS valor_original NUMERIC(14,2);

-- ── El índice de "unidad viva" debe distinguir entrega de devolución ────────
--
-- Antes: una sola línea viva por serial, sin importar el tipo de remisión. Eso
-- funcionaba cuando la devolución se autoconfirmaba (nacía terminal), pero al
-- volverla EN TRÁNSITO la línea de devolución convive con la de entrega —
-- ambas vivas — y chocaban.
--
-- Ahora el tipo viaja en la línea (no se puede referenciar otra tabla desde un
-- índice parcial) y hay una regla por tipo:
--   • entrega:    una unidad no puede estar en dos envíos activos a la vez
--   • devolución: una unidad no puede estar volviendo dos veces a la vez
ALTER TABLE IF EXISTS lineas_remision
  ADD COLUMN IF NOT EXISTS remision_tipo TEXT;

UPDATE lineas_remision lr
SET remision_tipo = r.tipo
FROM remisiones r
WHERE r.id = lr.remision_id AND lr.remision_tipo IS DISTINCT FROM r.tipo;

DROP INDEX IF EXISTS uq_lineas_remision_serial_viva;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lineas_remision_serial_viva
  ON lineas_remision (serial_id)
  WHERE serial_id IS NOT NULL
    AND remision_tipo = 'entrega'
    AND estado_linea IN ('Pendiente', 'Recibida');

CREATE UNIQUE INDEX IF NOT EXISTS uq_lineas_remision_serial_devolviendo
  ON lineas_remision (serial_id)
  WHERE serial_id IS NOT NULL
    AND remision_tipo = 'devolucion'
    AND estado_linea = 'Pendiente';

-- ── Correcciones de valor sobre una línea ya recibida ────────────────────────
-- No se reescribe `valor_interno` en silencio: queda el apunte con quién,
-- cuándo y por qué, y aparece en el extracto como un movimiento propio.
CREATE TABLE IF NOT EXISTS correcciones_remision (
  id             BIGSERIAL     PRIMARY KEY,
  negocio_id     INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
  sucursal_id    INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  linea_id       BIGINT        NOT NULL REFERENCES lineas_remision(id) ON DELETE CASCADE,
  valor_anterior NUMERIC(14,2) NOT NULL,
  valor_nuevo    NUMERIC(14,2) NOT NULL,
  diferencia     NUMERIC(14,2) NOT NULL,
  motivo         TEXT,
  usuario_id     INTEGER,
  fecha          TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correcciones_sucursal
  ON correcciones_remision (negocio_id, sucursal_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_correcciones_linea
  ON correcciones_remision (linea_id);

-- ── Método y cuenta de la remesa ─────────────────────────────────────────────
-- `metodo` ya existía; se documenta que ahora puede ser cualquier método del
-- negocio (Efectivo, Nequi, Transferencia…), no solo efectivo.
COMMENT ON COLUMN remesas.metodo IS
  'Método con el que el local envió el dinero. La cuenta de origen queda en cuenta_origen_id.';
