-- ─────────────────────────────────────────────────────────────────────────────
-- TESORERÍA — vínculo de pagos de mercancía con proveedor y compra
--
-- 100% ADITIVA e IDEMPOTENTE. Permite que "Pagué mercancía" quede asignado a
-- un proveedor y (opcionalmente) a una compra ya registrada, para bloquear
-- dobles pagos y poder consultar cuánto se le ha pagado a cada proveedor.
-- Aplicar después de 20260709_tesoreria.sql.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS movimientos_dinero
  ADD COLUMN IF NOT EXISTS proveedor_id INTEGER;

ALTER TABLE IF EXISTS movimientos_dinero
  ADD COLUMN IF NOT EXISTS compra_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_movimientos_dinero_compra
  ON movimientos_dinero (compra_id) WHERE compra_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_dinero_proveedor
  ON movimientos_dinero (proveedor_id) WHERE proveedor_id IS NOT NULL;

-- Rollback manual (si algún día se necesita):
--   ALTER TABLE movimientos_dinero DROP COLUMN IF EXISTS proveedor_id;
--   ALTER TABLE movimientos_dinero DROP COLUMN IF EXISTS compra_id;
