-- ─────────────────────────────────────────────────────────────────────────────
-- TESORERÍA ⇄ ACREEDORES: abono espejo
--
-- La cuenta del acreedor (Cargo − Abonos) es la fuente de verdad del estado
-- de pago de una compra. Un pago de mercancía hecho desde Tesorería crea un
-- Abono espejo con registrar_en_caja = FALSE:
--   * salda la deuda del acreedor (la compra deja de "deber"),
--   * NO descuenta en caja ni en tesorería (ambas derivaciones exigen
--     registrar_en_caja = TRUE) — el descuento va por movimientos_dinero.
--
-- 100% ADITIVA e IDEMPOTENTE. Aplicar después de
-- 20260710_tesoreria_pago_compra.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Vínculo del abono espejo con su movimiento de tesorería ──────────────────
ALTER TABLE IF EXISTS movimientos_acreedor
  ADD COLUMN IF NOT EXISTS mov_dinero_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_movimientos_acreedor_mov_dinero
  ON movimientos_acreedor (mov_dinero_id) WHERE mov_dinero_id IS NOT NULL;

-- 2. Backfill: crear el abono espejo de los pagos de tesorería ya registrados
--    que quedaron vinculados a una compra con cargo de acreedor.
--    Idempotente: NOT EXISTS evita duplicar en re-ejecuciones.
INSERT INTO movimientos_acreedor
  (acreedor_id, usuario_id, tipo, descripcion, valor, cargo_id, metodo,
   registrar_en_caja, sucursal_id, mov_dinero_id, fecha)
SELECT
  cargo.acreedor_id,
  md.usuario_id,
  'Abono',
  'Pago desde Tesorería (mov #' || md.id || ')',
  ROUND(CASE WHEN cu.moneda = 'USD'
             THEN md.valor * COALESCE(md.tasa_cambio, 0)
             ELSE md.valor END, 2),
  cargo.id,
  'Tesorería',
  FALSE,
  cu.sucursal_id,
  md.id,
  md.fecha
FROM movimientos_dinero md
JOIN cuentas_dinero cu ON cu.id = md.cuenta_id
JOIN LATERAL (
  SELECT m.id, m.acreedor_id FROM movimientos_acreedor m
  WHERE m.compra_id = md.compra_id AND m.tipo = 'Cargo'
  ORDER BY m.id LIMIT 1
) cargo ON TRUE
WHERE md.compra_id IS NOT NULL
  AND md.tipo = 'salida'
  AND md.activo IS NOT FALSE
  AND NOT EXISTS (
    SELECT 1 FROM movimientos_acreedor e WHERE e.mov_dinero_id = md.id
  );

-- Rollback manual (si algún día se necesita):
--   DELETE FROM movimientos_acreedor WHERE mov_dinero_id IS NOT NULL;
--   ALTER TABLE movimientos_acreedor DROP COLUMN IF EXISTS mov_dinero_id;
