-- ─────────────────────────────────────────────────────────────────────────────
-- CUÁNTO SE LE ACREDITÓ AL LOCAL POR UNA LÍNEA DE DEVOLUCIÓN
--
-- Con los lotes FIFO (20260823_lotes_cantidad.sql) el cargo de cada envío baja
-- solo al escribir `cantidad_devuelta`, sin contra-asiento — igual que cuando la
-- línea de un serial pasa a 'Devuelta'.
--
-- Pero el EXTRACTO no se enteraba. Su nota crédito solo contaba seriales (los
-- accesorios se acreditaban antes con un `Ajuste`, que este modelo eliminó por
-- duplicado), así que el extracto mostraba el cargo entero y ningún movimiento
-- que explicara la baja: la deuda cambiaba sola y el saldo del extracto dejaba
-- de cuadrar con `deuda_total`. Reportado desde producción como "lo veo
-- desincronizado y no sale ningún movimiento por devolución".
--
-- `valor_acreditado` guarda el crédito REAL de esa línea — la suma del reparto
-- FIFO, cada tramo al valor de su lote. No se puede derivar del
-- `valor_interno` de la línea de devolución: ese es solo el valor que se ofreció
-- al crearla, y una devolución que cruza dos lotes se acredita a dos precios.
--
-- 100% ADITIVA e IDEMPOTENTE. NULL en las líneas viejas, que es lo que
-- significaban: crédito no calculado por lotes.
--
-- Se auto-aplica al arrancar el backend (src/config/migrations.js).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS lineas_remision
  ADD COLUMN IF NOT EXISTS valor_acreditado NUMERIC(14,2);

-- Rollback manual:
--   ALTER TABLE lineas_remision DROP COLUMN IF EXISTS valor_acreditado;
