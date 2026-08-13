-- 20260813_descripcion_pago_total.sql
--
-- Descripción escrita por el usuario para los dos "pagos totales" del sistema:
-- el abono total a préstamos/créditos de una persona y el pago total a un
-- acreedor. Los dos reparten un solo pago en FIFO, y hasta hoy el movimiento
-- resultante no podía decir POR QUÉ se hizo ("adelanto de nómina", "consignó
-- el hijo", "cierre de mes"). Es texto libre: no entra en ningún cálculo.
--
-- 100% aditiva e idempotente. Dos columnas nullable y SIN DEFAULT, así que no
-- reescriben una sola fila de las tablas —que en producción ya tienen datos de
-- clientes— y todo lo registrado antes queda exactamente igual (NULL = como
-- estaba, sin descripción). Sin estas columnas el sistema funciona como hoy.

-- ── Préstamos: la descripción vive en el registro maestro del abono total ─────
ALTER TABLE IF EXISTS abonos_totales
  ADD COLUMN IF NOT EXISTS descripcion TEXT;

-- ── Acreedores: el pago total NO tiene tabla maestra, es una marca compartida ─
-- (pago_total_id, ver 20260805_pago_total_acreedor.sql). La descripción se
-- repite en cada fila hija del mismo pago, igual que la marca, y la lectura la
-- colapsa con MIN(). Va en columna propia y NO en `descripcion`: esa columna es
-- la del abono individual —la edita el usuario desde el historial del cargo— y
-- además es la que usa el backfill de 20260805 para reconocer los pagos viejos.
ALTER TABLE IF EXISTS movimientos_acreedor
  ADD COLUMN IF NOT EXISTS pago_total_descripcion TEXT;

-- Reversión:
--   ALTER TABLE abonos_totales       DROP COLUMN IF EXISTS descripcion;
--   ALTER TABLE movimientos_acreedor DROP COLUMN IF EXISTS pago_total_descripcion;
