-- ─────────────────────────────────────────────────────────────────────────────
-- CUPO EXTRA DE SUCURSALES POR NEGOCIO (9-oct-2026)
--
-- El límite de sucursales vive en `negocios.max_sucursales`, y
-- `superadmin.renovarPlan` lo REESCRIBE con el valor del plan en cada
-- renovación. Subirle el número a un negocio a mano (Tesla pidió 8 con el plan
-- pro, que trae 4) duraba hasta el siguiente pago.
--
-- `sucursales_extra` es lo que se le concede al negocio ENCIMA de su plan, y
-- la renovación no la toca: el límite efectivo es
-- `max_sucursales + sucursales_extra`. Cambiar de plan sigue moviendo la base,
-- y el extra se mantiene.
--
-- DEFAULT 0: los negocios sin cupo extra quedan exactamente igual.
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS negocios
  ADD COLUMN IF NOT EXISTS sucursales_extra INTEGER NOT NULL DEFAULT 0;
