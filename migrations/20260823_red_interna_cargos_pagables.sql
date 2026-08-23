-- ─────────────────────────────────────────────────────────────────────────────
-- RED INTERNA v5 — UN CARGO TAMBIÉN ES UN DOCUMENTO QUE SE PAGA
--
-- EL PROBLEMA, reportado desde producción:
--
--     "Todos tus envíos están pagados.
--      Más $830.000 de cargos que no vienen de un envío.
--      Y $586.010 a tu favor para el próximo."
--
-- Deber y tener a favor al mismo tiempo no tiene sentido, y el motivo era un
-- agujero de diseño: un ajuste EN CONTRA (una rotura, un faltante que la bodega
-- le cobra al local) subía la deuda pero no era un documento — nadie le podía
-- imputar un abono. `_imputarFIFO` solo sabía repartir entre ENVÍOS.
--
-- Consecuencia: el cargo no se podía pagar NUNCA. Con los envíos al día, el
-- dinero que entraba no encontraba a dónde ir, se volvía saldo a favor, y el
-- cargo se quedaba ahí para siempre. Un callejón sin salida.
--
-- LA CORRECCIÓN: un abono ya no apunta solo a un envío, apunta a un DOCUMENTO,
-- que puede ser un envío o un cargo. Con eso:
--   • el cargo aparece en la pestaña de Envíos como una tarjeta más, con su
--     saldo y su botón de abonar — se ve qué se está pagando;
--   • el FIFO lo reparte junto con los envíos, del más viejo al más nuevo;
--   • el saldo a favor lo consume igual que a un envío.
--
-- INVARIANTE NUEVA: si hay saldo a favor, no hay deuda abierta. Las dos cifras
-- no pueden convivir, que es justo lo que se veía en pantalla.
--
-- 100% ADITIVA. `remision_id` pasa a admitir NULL (los abonos que ya existen la
-- tienen puesta y no cambian). El CHECK exige exactamente uno de los dos.
-- ROLLBACK: DROP de la columna + volver `remision_id` a NOT NULL.
-- ─────────────────────────────────────────────────────────────────────────────

-- Un abono a un cargo suelto no tiene envío al que apuntar.
ALTER TABLE IF EXISTS abonos_remision
  ALTER COLUMN remision_id DROP NOT NULL;

ALTER TABLE IF EXISTS abonos_remision
  ADD COLUMN IF NOT EXISTS cargo_id BIGINT
    REFERENCES movimientos_cuenta_interna(id) ON DELETE CASCADE;

-- Exactamente uno de los dos: o paga un envío, o paga un cargo. Nunca los dos,
-- nunca ninguno — un abono sin destino sería plata que no baja nada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'abonos_remision_destino_chk') THEN
    ALTER TABLE abonos_remision ADD CONSTRAINT abonos_remision_destino_chk
      CHECK ((remision_id IS NOT NULL AND cargo_id IS NULL)
          OR (remision_id IS NULL     AND cargo_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_abonos_remision_cargo
  ON abonos_remision (cargo_id) WHERE cargo_id IS NOT NULL AND NOT anulado;
