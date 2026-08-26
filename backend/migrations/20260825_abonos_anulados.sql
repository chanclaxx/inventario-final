-- ─────────────────────────────────────────────────────────────────────────────
-- Abonos anulados, con su motivo a la vista
--
-- Hasta ahora un abono solo podía existir o borrarse. Eso dejaba dos agujeros:
--
--   1. DEVOLUCIONES. Al devolver un producto, su cobro sale de la cuenta pero
--      los abonos se quedaban sin nada que pagar. El estado de cuenta los
--      seguía restando y daba POR DEBAJO de la deuda real — a 23 personas, y a
--      12 de ellas les daba negativa, como si el negocio les debiera plata.
--
--   2. PAGOS DUPLICADOS. Un doble clic en "guardar" registraba el mismo pago
--      dos veces. Solo en Cellsite hay 45 parejas por $106.887.760, la última
--      del 24-ago-2026. Al cliente se le borraba deuda que sí debía.
--
-- Borrar la fila arreglaría el número pero destruiría la evidencia: nadie
-- sabría después por qué la cuenta cambió. Anular con MOTIVO deja el movimiento
-- a la vista, explica por qué no cuenta, y hace que la cuenta cuadre por una
-- razón que se puede leer en pantalla.
--
-- 100% aditiva: `anulado` arranca en FALSE, así que todo lo que existe hoy
-- sigue contando exactamente igual.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE abonos_prestamo
  ADD COLUMN IF NOT EXISTS anulado          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS valor_anulado    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT,
  ADD COLUMN IF NOT EXISTS anulado_en       TIMESTAMPTZ;

ALTER TABLE abonos_credito
  ADD COLUMN IF NOT EXISTS anulado          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS valor_anulado    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT,
  ADD COLUMN IF NOT EXISTS anulado_en       TIMESTAMPTZ;

-- Los abonos vivos son la inmensa mayoría, así que el índice es PARCIAL sobre
-- los anulados: es el conjunto chico y es el que se consulta para explicar.
CREATE INDEX IF NOT EXISTS idx_abonos_prestamo_anulado
  ON abonos_prestamo (prestamo_id) WHERE anulado;
CREATE INDEX IF NOT EXISTS idx_abonos_credito_anulado
  ON abonos_credito (credito_id) WHERE anulado;
