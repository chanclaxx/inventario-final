-- ─────────────────────────────────────────────────────────────────────────────
-- TRASLADOS ENTRE SEDES PROPIAS — un tercer tipo de remisión
--
-- Con la red interna encendida, la bodega solo podía DESPACHAR: cada envío es
-- una cuenta que el local paga. Tesla (oct-2026) surte también a su PROPIA
-- tienda, que no le debe nada a nadie: hasta hoy se «pagaba a sí misma» cada
-- envío para que la cuenta cuadrara.
--
-- Un traslado es una remisión de tipo 'traslado': reusa el documento, la
-- recepción con confirmación, los faltantes, el movimiento por NODO y la
-- reserva de lo que va en camino (los triggers de 20260926 no miran el tipo).
-- Lo que NO hace es generar cuenta: sus líneas van con `valor_interno = 0` y el
-- costo real en `costo_origen`, así que aunque un lector olvidara filtrar por
-- tipo, un traslado sumaría $0 de deuda.
--
-- 100 % aditiva: amplía el CHECK del tipo y agrega un índice de unicidad para
-- los IMEI que van en un traslado sin recibir. Ninguna fila existente cambia.
--
-- ROLLBACK (solo si no hay ningún traslado):
--   DROP INDEX IF EXISTS uq_lineas_remision_serial_trasladando;
--   ALTER TABLE remisiones DROP CONSTRAINT remisiones_tipo_chk;
--   ALTER TABLE remisiones ADD CONSTRAINT remisiones_tipo_chk CHECK (tipo IN ('entrega','devolucion'));
-- ─────────────────────────────────────────────────────────────────────────────

-- NOT VALID + VALIDATE: el ADD solo toma el candado un instante y la
-- validación corre con un candado que no frena las lecturas ni los despachos.
ALTER TABLE remisiones DROP CONSTRAINT IF EXISTS remisiones_tipo_chk;
ALTER TABLE remisiones ADD CONSTRAINT remisiones_tipo_chk
  CHECK (tipo IN ('entrega', 'devolucion', 'traslado')) NOT VALID;
ALTER TABLE remisiones VALIDATE CONSTRAINT remisiones_tipo_chk;

-- Un IMEI no puede ir en dos traslados sin recibir. Las entregas y las
-- devoluciones ya tienen el suyo; este solo mira los traslados PENDIENTES: un
-- traslado ya recibido no ata al equipo (puede volver a trasladarse o
-- despacharse), a diferencia de una entrega, que lo deja en la cuenta del local.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lineas_remision_serial_trasladando
  ON lineas_remision (serial_id)
  WHERE serial_id IS NOT NULL AND remision_tipo = 'traslado'
    AND estado_linea = 'Pendiente';
