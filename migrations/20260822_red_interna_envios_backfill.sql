-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL del cambio de modelo — de consignación a "el envío es la deuda"
--
-- Los negocios que ya venían operando tienen envíos y pagos hechos bajo la
-- regla vieja (el local solo pagaba lo vendido). Este script imputa esos pagos
-- a los envíos con la regla nueva, para que la cuenta quede coherente de punta
-- a punta en vez de arrancar con un saldo de apertura sin historia detrás.
--
-- CÓMO IMPUTA — el mismo FIFO que usará el sistema de aquí en adelante:
--   Recorre los pagos del local en orden cronológico (remesas confirmadas,
--   gastos autorizados y ajustes positivos) y va tapando los envíos del más
--   viejo al más nuevo. Lo que sobre queda SIN imputar y se lee como saldo a
--   favor — que es exactamente lo que es.
--
-- CONSECUENCIA ESPERADA Y QUERIDA: la deuda de cada local SUBE, porque ahora
-- incluye la mercancía que sigue en vitrina. Ese es el cambio de regla.
--
-- IDEMPOTENTE: cada local se salta si ya tiene abonos imputados. Correrlo dos
-- veces no duplica nada. Requiere que 20260822_red_interna_envios.sql ya esté
-- aplicado.
--
-- SEGURO: solo INSERTA en `abonos_remision`. No toca ninguna otra tabla, así
-- que revertirlo es `DELETE FROM abonos_remision WHERE origen <> 'saldo_favor'`
-- (o directamente el DROP TABLE de la migración de esquema).
-- ─────────────────────────────────────────────────────────────────────────────

DO $backfill$
DECLARE
  v_local  RECORD;
  v_pago   RECORD;
  v_envio  RECORD;
  v_resto  NUMERIC(14,2);
  v_aplica NUMERIC(14,2);
  v_locales INTEGER := 0;
  v_filas   INTEGER := 0;
BEGIN
  FOR v_local IN
    SELECT DISTINCT r.negocio_id, r.sucursal_destino_id AS sucursal_id
    FROM remisiones r
    JOIN config_negocio c
      ON c.negocio_id = r.negocio_id
     AND c.clave = 'red_interna_activa'
     AND c.valor = '1'
    WHERE r.tipo = 'entrega'
      AND r.estado <> 'Anulada'
      -- Ya migrado: no volver a imputar.
      AND NOT EXISTS (
        SELECT 1 FROM abonos_remision a
        WHERE a.negocio_id = r.negocio_id
          AND a.sucursal_id = r.sucursal_destino_id
      )
    ORDER BY 1, 2
  LOOP
    v_locales := v_locales + 1;

    -- Pagos del local en orden cronológico. El orden importa: define a qué
    -- envío llegó cada peso.
    FOR v_pago IN
      SELECT * FROM (
        SELECT 'remesa'::text AS origen,
               r.id           AS ref_id,
               r.valor        AS valor,
               COALESCE(r.fecha_recepcion, r.fecha_envio) AS fecha
        FROM remesas r
        WHERE r.negocio_id = v_local.negocio_id
          AND r.sucursal_origen_id = v_local.sucursal_id
          AND r.estado = 'Recibida'

        UNION ALL

        SELECT CASE WHEN m.tipo = 'GastoAutorizado' THEN 'gasto' ELSE 'ajuste' END,
               m.id, m.valor, m.fecha
        FROM movimientos_cuenta_interna m
        WHERE m.negocio_id = v_local.negocio_id
          AND m.sucursal_id = v_local.sucursal_id
          AND NOT m.anulado
          AND m.tipo IN ('GastoAutorizado', 'Ajuste')
          -- Un ajuste NEGATIVO sube la deuda; no es un pago y aquí no se imputa.
          AND m.valor > 0
      ) p
      ORDER BY p.fecha, p.origen, p.ref_id
    LOOP
      v_resto := v_pago.valor;

      -- Envíos con saldo, del más viejo al más nuevo. La consulta se reevalúa
      -- en cada vuelta del pago, así que ve los abonos ya insertados.
      FOR v_envio IN
        SELECT r.id,
               (cargo.total - COALESCE(ab.total, 0)) AS saldo
        FROM remisiones r
        JOIN LATERAL (
          SELECT COALESCE(SUM(
            lr.valor_interno * CASE WHEN lr.tipo = 'serial'
                                    THEN 1
                                    ELSE COALESCE(lr.cantidad_recibida, lr.cantidad, 0) END
          ), 0) AS total
          FROM lineas_remision lr
          WHERE lr.remision_id = r.id AND lr.estado_linea = 'Recibida'
        ) cargo ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(a.valor), 0) AS total
          FROM abonos_remision a
          WHERE a.remision_id = r.id AND NOT a.anulado
        ) ab ON TRUE
        WHERE r.negocio_id = v_local.negocio_id
          AND r.sucursal_destino_id = v_local.sucursal_id
          AND r.tipo = 'entrega'
          AND r.estado <> 'Anulada'
          AND (cargo.total - COALESCE(ab.total, 0)) > 0
        ORDER BY COALESCE(r.fecha_recepcion, r.fecha_emision), r.id
      LOOP
        EXIT WHEN v_resto <= 0;

        v_aplica := LEAST(v_resto, v_envio.saldo);
        IF v_aplica > 0 THEN
          INSERT INTO abonos_remision
            (negocio_id, sucursal_id, remision_id, origen,
             remesa_id, movimiento_id, valor, fecha, notas)
          VALUES (
            v_local.negocio_id, v_local.sucursal_id, v_envio.id, v_pago.origen,
            CASE WHEN v_pago.origen = 'remesa' THEN v_pago.ref_id END,
            CASE WHEN v_pago.origen <> 'remesa' THEN v_pago.ref_id END,
            v_aplica, v_pago.fecha,
            'Imputado al migrar al modelo de envío a crédito'
          );
          v_resto := v_resto - v_aplica;
          v_filas := v_filas + 1;
        END IF;
      END LOOP;
      -- Lo que sobró queda sin imputar: es saldo a favor del local y el
      -- sistema lo deriva solo (remesas recibidas − abonos imputados).
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Backfill red interna: % local(es), % abono(s) imputado(s)', v_locales, v_filas;
END
$backfill$;
