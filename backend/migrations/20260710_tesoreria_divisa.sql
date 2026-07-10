-- ─────────────────────────────────────────────────────────────────────────────
-- TESORERÍA — soporte de divisa (USD)
--
-- 100% ADITIVA e IDEMPOTENTE. Cubre los dos escenarios:
--   * Si 20260709_tesoreria.sql se aplicó ANTES de este cambio, agrega las
--     columnas que faltan.
--   * Si se aplica la versión actualizada de 20260709 (que ya las incluye),
--     este archivo no hace nada.
-- `IF EXISTS` evita errores si las tablas base aún no existen (aplicar
-- primero 20260709_tesoreria.sql).
-- ─────────────────────────────────────────────────────────────────────────────

-- Moneda de la cuenta: 'COP' (default) | 'USD'. Las cuentas USD llevan su
-- saldo EN DÓLARES y no pueden tener métodos de pago asignados.
ALTER TABLE IF EXISTS cuentas_dinero
  ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'COP';

-- Tasa COP por USD registrada cuando un movimiento cruza monedas
-- (compra/venta de divisa). Sirve de tasa de referencia para mostrar el
-- equivalente en pesos.
ALTER TABLE IF EXISTS movimientos_dinero
  ADD COLUMN IF NOT EXISTS tasa_cambio NUMERIC(12,4);

-- Rollback manual (si algún día se necesita):
--   ALTER TABLE cuentas_dinero    DROP COLUMN IF EXISTS moneda;
--   ALTER TABLE movimientos_dinero DROP COLUMN IF EXISTS tasa_cambio;
