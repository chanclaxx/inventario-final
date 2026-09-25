-- ─────────────────────────────────────────────────────────────────────────────
-- MORA EN LOS ENVÍOS DE LA RED INTERNA (bodega → locales)
--
-- 100% ADITIVA e IDEMPOTENTE. Se auto-aplica al arrancar el backend: el runner
-- (src/config/migrations.js) lee ESTE MISMO archivo dentro de su propio bloque
-- `migrar()`, así que un fallo aquí se anota y el servidor arranca igual.
--
-- ── El modelo en una frase ──────────────────────────────────────────────────
-- Desde agosto de 2026 cada ENVÍO es un documento de deuda, igual que una
-- factura a crédito de un cliente. Lo único que le faltaba para serlo del todo
-- era un PLAZO: el local podía deber un envío seis meses y nada lo distinguía
-- de uno de ayer. Esta migración le da al envío lo mismo que ya tienen
-- `creditos` y `prestamos` (20260730_mora_credito.sql): fecha límite, condición
-- congelada y un registro de cobros y condonaciones de mora.
--
-- ── Lo que se ESCRIBE y lo que se DERIVA ───────────────────────────────────
-- La mora CAUSADA no se guarda: se deriva del saldo del envío, sus abonos a
-- capital con su fecha y la condición pactada (el mismo motor de devengo que
-- créditos y préstamos). Solo se escribe lo que decide una persona: un COBRO
-- (parte de un pago que fue a mora) o una CONDONACIÓN (lo que se perdonó).
--
-- ── POR QUÉ UNA TABLA PROPIA y no una marca en `abonos_remision` ────────────
-- `abonos_remision` es lo que los reportes suman como "lo cobrado" de un envío
-- para medir la utilidad de la bodega (utilidad = cobrado − costo). Una fila de
-- mora ahí contaría como margen comercial: es la misma regla que manda la mora
-- de créditos a `movimientos_mora` y NUNCA a `total_abonado`. Separada por
-- construcción, ninguna consulta vieja puede sumarla por descuido.
--
-- ── Qué NO cambia ───────────────────────────────────────────────────────────
-- `fecha_limite IS NULL` ⇒ el envío no tiene mora. Jamás. Todos los envíos que
-- ya existen quedan así, y un negocio que no encienda
-- `red_interna_mora_activa` nunca llega a escribir una sola fila nueva.
--
-- ROLLBACK manual:
--   DROP TABLE IF EXISTS mora_envios;
--   ALTER TABLE remisiones DROP COLUMN IF EXISTS fecha_limite,
--     DROP COLUMN IF EXISTS mora_condicion, DROP COLUMN IF EXISTS mora_plazo_dias;
--   DELETE FROM config_negocio WHERE clave LIKE 'red_interna_mora_%';
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. El plazo del envío ────────────────────────────────────────────────────
--
-- `mora_plazo_dias` es lo que la bodega PACTA al despachar ("15 días"). La
-- `fecha_limite` no existe todavía en ese momento: nace al RECIBIR, que es
-- cuando nace la deuda. Si el envío se queda tres días en camino, el local no
-- pierde esos tres días de plazo.
--
-- `mora_condicion` congela la condición completa ({id, nombre, tipo, valor,
-- dias_gracia, tope_pct}). Subir la tasa en Ajustes no toca lo ya despachado.
ALTER TABLE IF EXISTS remisiones ADD COLUMN IF NOT EXISTS fecha_limite    DATE;
ALTER TABLE IF EXISTS remisiones ADD COLUMN IF NOT EXISTS mora_condicion  JSONB;
ALTER TABLE IF EXISTS remisiones ADD COLUMN IF NOT EXISTS mora_plazo_dias INTEGER;

-- Parcial: solo indexa los envíos que SÍ tienen plazo. En un negocio sin la
-- feature no ocupa prácticamente nada.
CREATE INDEX IF NOT EXISTS idx_remisiones_fecha_limite
  ON remisiones (negocio_id, sucursal_destino_id, fecha_limite)
  WHERE fecha_limite IS NOT NULL;

-- ── 2. Cobros y condonaciones de mora de un envío ────────────────────────────
--
-- COBRO — una parte de un pago del local que se fue a la mora de este envío.
--   Cuelga de la MISMA plata que un abono a capital (`remesa_id` o
--   `movimiento_id`) y sigue sus mismas reglas: una remesa en tránsito reserva
--   pero no cuenta, un gasto sin aprobar tampoco, y al anular la remesa o
--   rechazar el gasto el cobro se anula con ellos.
-- CONDONACIÓN — lo que la bodega decidió no cobrar. No es plata: no entra en
--   caja ni en el saldo a favor. Exige motivo (y PIN, en el service).
CREATE TABLE IF NOT EXISTS mora_envios (
  id             BIGSERIAL     PRIMARY KEY,
  negocio_id     INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
  -- El LOCAL que debe. Todas las lecturas de la cuenta filtran por él.
  sucursal_id    INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  remision_id    BIGINT        NOT NULL REFERENCES remisiones(id) ON DELETE CASCADE,
  tipo           TEXT          NOT NULL,
  -- De dónde salió la plata de un cobro. Mismo vocabulario que
  -- `abonos_remision.origen`: las dos tablas se leen con la misma regla.
  origen         TEXT,
  remesa_id      BIGINT        REFERENCES remesas(id)                    ON DELETE CASCADE,
  movimiento_id  BIGINT        REFERENCES movimientos_cuenta_interna(id) ON DELETE CASCADE,
  valor          NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  -- Foto del cálculo al momento del movimiento: deja auditar por qué se cobró
  -- ese valor aunque después cambien el saldo o los días.
  dias_mora      INTEGER,
  saldo_base     NUMERIC(14,2),
  condicion      JSONB,
  motivo         TEXT,
  usuario_id     INTEGER,
  fecha          TIMESTAMP     NOT NULL DEFAULT NOW(),
  anulado        BOOLEAN       NOT NULL DEFAULT FALSE,

  CONSTRAINT mora_envios_tipo_chk
    CHECK (tipo IN ('Cobro', 'Condonacion')),
  CONSTRAINT mora_envios_origen_chk
    CHECK (origen IS NULL OR origen IN ('remesa', 'gasto', 'ajuste', 'saldo_favor')),
  -- Un cobro sin la plata de la que salió sería mora pagada por nadie; una
  -- condonación sin motivo, una decisión de plata sin dueño.
  CONSTRAINT mora_envios_forma_chk
    CHECK ((tipo = 'Cobro' AND (
              (origen = 'remesa' AND remesa_id IS NOT NULL)
           OR (origen IN ('gasto', 'ajuste') AND movimiento_id IS NOT NULL)
           OR  origen = 'saldo_favor'))
        OR (tipo = 'Condonacion' AND origen IS NULL AND motivo IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_mora_envios_remision
  ON mora_envios (remision_id) WHERE NOT anulado;
CREATE INDEX IF NOT EXISTS idx_mora_envios_local
  ON mora_envios (negocio_id, sucursal_id, fecha DESC) WHERE NOT anulado;
CREATE INDEX IF NOT EXISTS idx_mora_envios_remesa
  ON mora_envios (remesa_id) WHERE remesa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mora_envios_movimiento
  ON mora_envios (movimiento_id) WHERE movimiento_id IS NOT NULL;
