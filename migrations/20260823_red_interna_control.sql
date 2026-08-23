-- ─────────────────────────────────────────────────────────────────────────────
-- RED INTERNA v4 — QUE NADIE CAMBIE LA CUENTA A ESPALDAS DEL OTRO
--
-- El módulo ya tenía una buena gramática para lo delicado: nada que mueva
-- mercancía o plata entre las dos partes queda firme hasta que la OTRA
-- confirma (el despacho lo confirma el local, la devolución y el pago los
-- confirma la bodega). Lo que faltaba era aplicar esa misma regla a lo que
-- toca la cuenta directamente:
--
--   • Un GASTO por cuenta de bodega bajaba la deuda del local al instante,
--     sin que nadie lo aprobara. Un local podía rebajarse la deuda solo y la
--     bodega se enteraba únicamente si entraba a mirar.
--   • Un gasto o un ajuste mal tecleado no se podía deshacer: la columna
--     `anulado` existía desde 20260725 y ningún código la ponía en TRUE.
--   • Una mercancía que nunca llegó, si el local ya había tocado "Recibí
--     todo", solo se arreglaba devolviendo algo que jamás tuvo.
--
-- 100% ADITIVA e IDEMPOTENTE. Los DEFAULT dejan las filas existentes exactamente
-- como estaban: todo lo ya registrado nace 'Aprobado', que es como se venía
-- comportando.
-- ROLLBACK: DROP de las tres columnas.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Aprobación de los movimientos de cuenta ───────────────────────────────
--
-- 'Aprobado' por DEFAULT y no 'Por aprobar': si fuera al revés, los gastos y
-- ajustes que ya existen quedarían en el limbo y la deuda de cada local
-- cambiaría al aplicar esta migración.
ALTER TABLE IF EXISTS movimientos_cuenta_interna
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'Aprobado';

ALTER TABLE IF EXISTS movimientos_cuenta_interna
  ADD COLUMN IF NOT EXISTS usuario_aprueba_id INTEGER;

ALTER TABLE IF EXISTS movimientos_cuenta_interna
  ADD COLUMN IF NOT EXISTS fecha_aprobacion TIMESTAMP;

-- El CHECK se agrega aparte y tolerante: si ya existe, no se toca.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mci_estado_chk'
  ) THEN
    ALTER TABLE movimientos_cuenta_interna
      ADD CONSTRAINT mci_estado_chk
      CHECK (estado IN ('Por aprobar', 'Aprobado', 'Rechazado'));
  END IF;
END $$;

-- Bandeja de la bodega: los que esperan visto bueno.
CREATE INDEX IF NOT EXISTS idx_mci_por_aprobar
  ON movimientos_cuenta_interna (negocio_id, estado)
  WHERE estado = 'Por aprobar' AND NOT anulado;

-- ── 2. Motivo de una remisión de devolución ──────────────────────────────────
--
-- Distingue "el local lo tuvo y lo regresó" de "nunca llegó". Las dos hacen lo
-- mismo con la cuenta (el cargo de su envío deja de contarlas) y con el
-- inventario (la unidad vuelve a la bodega), pero contarlo bien importa: un
-- faltante es un problema de despacho y una devolución no.
--
-- NULL = devolución normal, que es lo que era todo hasta ahora.
ALTER TABLE IF EXISTS remisiones
  ADD COLUMN IF NOT EXISTS motivo TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'remisiones_motivo_chk'
  ) THEN
    ALTER TABLE remisiones
      ADD CONSTRAINT remisiones_motivo_chk
      CHECK (motivo IS NULL OR motivo IN ('devolucion', 'faltante'));
  END IF;
END $$;
