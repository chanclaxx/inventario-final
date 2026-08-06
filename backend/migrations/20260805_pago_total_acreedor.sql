-- 20260805_pago_total_acreedor.sql
--
-- Un pago total a un acreedor se sigue repartiendo entre los cargos abiertos:
-- una fila de Abono por cargo, exactamente como hasta hoy. Esta columna solo
-- MARCA cuáles de esas filas salieron del mismo pago, para que el estado de
-- cuenta pueda mostrarlas como un único movimiento.
--
-- No guarda importes a propósito. El total que se muestra se DERIVA con SUM()
-- sobre las filas hijas, así que anular una compra (que borra sus abonos),
-- editar un abono o eliminarlo ajusta solo el pago mostrado y el saldo sigue
-- cuadrando. Un valor guardado aparte se descuadraría en esos tres casos.
--
-- 100% aditiva e idempotente. Sin esta columna el sistema funciona igual: los
-- pagos se ven repartidos, como antes.

CREATE SEQUENCE IF NOT EXISTS pago_total_acreedor_seq;

ALTER TABLE IF EXISTS movimientos_acreedor
  ADD COLUMN IF NOT EXISTS pago_total_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_mov_acreedor_pago_total
  ON movimientos_acreedor (pago_total_id) WHERE pago_total_id IS NOT NULL;

-- Backfill de los pagos totales ya registrados.
-- Las filas de un mismo pago se insertaron en UNA transacción, así que comparten
-- `fecha` al microsegundo (DEFAULT NOW() = inicio de transacción), acreedor,
-- método y la descripción que escribía registrarAbonoTotal. Que dos pagos
-- distintos coincidan en los cuatro campos al microsegundo no ocurre.
WITH grupos AS (
  SELECT acreedor_id, fecha, metodo,
         nextval('pago_total_acreedor_seq') AS nuevo_id
  FROM movimientos_acreedor
  WHERE tipo          = 'Abono'
    AND descripcion   = 'Pago total distribuido'
    AND pago_total_id IS NULL
  GROUP BY acreedor_id, fecha, metodo
)
UPDATE movimientos_acreedor m
SET pago_total_id = g.nuevo_id
FROM grupos g
WHERE m.tipo          = 'Abono'
  AND m.descripcion   = 'Pago total distribuido'
  AND m.pago_total_id IS NULL
  AND m.acreedor_id   = g.acreedor_id
  AND m.fecha         = g.fecha
  AND m.metodo        IS NOT DISTINCT FROM g.metodo;

-- Reversión:
--   ALTER TABLE movimientos_acreedor DROP COLUMN IF EXISTS pago_total_id;
--   DROP SEQUENCE IF EXISTS pago_total_acreedor_seq;
