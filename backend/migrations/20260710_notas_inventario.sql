-- ─────────────────────────────────────────────────────────────────────────────
-- NOTAS / POST-IT DE INVENTARIO
--
-- Permite dejar un recordatorio tipo "post-it" en:
--   * un serial concreto (seriales.nota)  → ej. "está donde el técnico"
--   * un modelo serial     (productos_serial.nota)
--   * un producto cantidad (productos_cantidad.nota)
--
-- 100% ADITIVA e IDEMPOTENTE. Se auto-ejecuta también desde
-- src/config/migrations.js al arrancar el servidor, así que normalmente no
-- hace falta correrla a mano; queda aquí como referencia y por si se aplica
-- por separado.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS seriales           ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE IF EXISTS productos_serial   ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS nota TEXT;

-- Rollback manual (si algún día se necesita):
--   ALTER TABLE seriales           DROP COLUMN IF EXISTS nota;
--   ALTER TABLE productos_serial   DROP COLUMN IF EXISTS nota;
--   ALTER TABLE productos_cantidad DROP COLUMN IF EXISTS nota;
