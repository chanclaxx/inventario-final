-- ─────────────────────────────────────────────────────────────────────────────
-- RED INTERNA v3 — EL ENVÍO ES LA DEUDA
--
-- CAMBIO DE MODELO (decisión del cliente, agosto 2026):
--   ANTES (consignación): entregar mercancía no generaba deuda. La deuda nacía
--   cuando el local VENDÍA, y se derivaba de las ventas. El local pagaba solo
--   lo vendido.
--
--   AHORA (envío a crédito): el local paga TODO lo que la bodega le entrega,
--   esté vendido o no. Cada envío es un documento de deuda con su propio saldo
--   y sus propios abonos — igual que una factura a crédito de un cliente.
--   Que la unidad se haya vendido o no pasa a ser INFORMATIVO: se sigue
--   calculando y mostrando, pero ya no manda sobre el dinero.
--
-- POR QUÉ EL CAMBIO CIERRA AGUJEROS:
--   • Un equipo que desaparecía del local ('Sin ubicar') dejaba de cobrarse.
--     Ahora ya venía cobrado desde la entrega.
--   • Una devolución parcial de una venta a crédito seguía generando deuda
--     sobre un equipo que volvió a la vitrina. Ahora la venta no toca la cuenta.
--   • La deuda por accesorios se estimaba contra el stock GLOBAL del local: si
--     el local compraba el mismo accesorio a otro proveedor, la deuda bajaba
--     sola. Ahora un accesorio vale cantidad_recibida × valor_interno, exacto.
--
-- QUÉ SE DERIVA Y QUÉ SE ESCRIBE — la regla no cambió, cambió el hecho:
--   CARGO   se DERIVA de las líneas de la remisión en estado 'Recibida'.
--           No se guarda: una devolución marca la línea 'Devuelta' y el cargo
--           baja solo, sin contra-asiento que mantener sincronizado.
--   ABONO   se ESCRIBE, porque es una decisión de una persona: a QUÉ envío se
--           imputa el dinero. Eso no se puede derivar de ninguna otra tabla.
--
-- 100% ADITIVA e IDEMPOTENTE. Ningún ALTER sobre tablas existentes.
-- ROLLBACK: DROP TABLE abonos_remision deja el sistema como estaba.
-- El backfill de los negocios que ya venían operando va en el archivo
-- 20260822_red_interna_envios_backfill.sql, aparte y de una sola pasada.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Abonos imputados a un envío ──────────────────────────────────────────────
--
-- Una fila = "esta plata pagó ESTE envío". Un solo pago del local puede
-- repartirse entre varios envíos (FIFO): son varias filas que comparten
-- `remesa_id`, igual que un pago total a un acreedor comparte `pago_total_id`.
-- El importe del pago NO se guarda agregado en ninguna parte: se deriva con
-- SUM sobre las filas hijas, para que anular un envío no deje un total inflado.
--
-- ORIGEN — de dónde salió la plata:
--   'remesa'      el local envió dinero (el caso normal)
--   'gasto'       el local pagó algo por cuenta de la bodega
--   'ajuste'      la bodega le abonó a mano, o una devolución generó crédito
--   'saldo_favor' se consumió crédito que el local ya tenía a su favor
CREATE TABLE IF NOT EXISTS abonos_remision (
  id            BIGSERIAL     PRIMARY KEY,
  negocio_id    INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
  -- El LOCAL que debe. Se guarda aunque se pueda deducir de la remisión:
  -- todas las lecturas de la cuenta filtran por sucursal y sin esta columna
  -- cada una tendría que pasar por `remisiones`.
  sucursal_id   INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  remision_id   BIGINT        NOT NULL REFERENCES remisiones(id) ON DELETE CASCADE,
  origen        TEXT          NOT NULL,
  -- La plata de la que salió. CASCADE en los dos: si el documento del dinero
  -- desaparece, su imputación no puede sobrevivirle.
  remesa_id     BIGINT        REFERENCES remesas(id)                     ON DELETE CASCADE,
  movimiento_id BIGINT        REFERENCES movimientos_cuenta_interna(id)  ON DELETE CASCADE,
  valor         NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  fecha         TIMESTAMP     NOT NULL DEFAULT NOW(),
  usuario_id    INTEGER,
  notas         TEXT,
  anulado       BOOLEAN       NOT NULL DEFAULT FALSE,
  CONSTRAINT abonos_remision_origen_chk
    CHECK (origen IN ('remesa', 'gasto', 'ajuste', 'saldo_favor')),
  -- Un abono de remesa sin remesa sería plata que nadie envió.
  CONSTRAINT abonos_remision_fuente_chk
    CHECK ((origen = 'remesa' AND remesa_id IS NOT NULL)
        OR (origen IN ('gasto', 'ajuste') AND movimiento_id IS NOT NULL)
        OR  origen = 'saldo_favor')
);

CREATE INDEX IF NOT EXISTS idx_abonos_remision_remision
  ON abonos_remision (remision_id) WHERE NOT anulado;
CREATE INDEX IF NOT EXISTS idx_abonos_remision_local
  ON abonos_remision (negocio_id, sucursal_id, fecha DESC) WHERE NOT anulado;
CREATE INDEX IF NOT EXISTS idx_abonos_remision_remesa
  ON abonos_remision (remesa_id) WHERE remesa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_abonos_remision_movimiento
  ON abonos_remision (movimiento_id) WHERE movimiento_id IS NOT NULL;
