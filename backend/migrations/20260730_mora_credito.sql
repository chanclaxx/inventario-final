-- ─────────────────────────────────────────────────────────────────────────────
-- MORA POR PAGO TARDÍO en créditos y préstamos — migración 100% ADITIVA e IDEMPOTENTE
--
-- Feature opt-in por negocio vía config_negocio.mora_activa ('1'/'0'); ese flag
-- NO requiere migración (config_negocio es clave-valor).
--
-- GARANTÍAS PARA PRODUCCIÓN:
--   • Solo ADD COLUMN IF NOT EXISTS (nullable, sin DEFAULT que reescriba filas)
--     y CREATE TABLE/INDEX IF NOT EXISTS → re-ejecutable sin efectos.
--   • Ninguna columna existente se modifica ni se renombra.
--   • `fecha_limite IS NULL` ⇒ el documento NO tiene mora. Jamás. Por eso los
--     créditos y préstamos que ya existen (1.793 préstamos activos al momento de
--     escribir esto) no cambian en nada al aplicar esta migración ni al activar
--     la feature.
--
-- POR QUÉ LA MORA VIVE EN SU PROPIA TABLA Y NO EN `total_abonado`:
--   Los reportes calculan la utilidad del producto como (abonado − costo)
--   —ver reportes.service.js— así que sumar la mora a `total_abonado` la contaría
--   como margen comercial e inflaría el margen, la proyección y el punto de
--   equilibrio. La mora es un ingreso FINANCIERO y se reporta aparte.
--
-- ROLLBACK manual:
--   DROP TABLE IF EXISTS movimientos_mora;
--   ALTER TABLE creditos  DROP COLUMN IF EXISTS fecha_limite, DROP COLUMN IF EXISTS mora_condicion;
--   ALTER TABLE prestamos DROP COLUMN IF EXISTS fecha_limite, DROP COLUMN IF EXISTS mora_condicion;
--   DELETE FROM config_negocio WHERE clave LIKE 'mora_%';
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Plazo y condición pactada en cada documento de crédito ────────────────
--
-- `mora_condicion` congela la condición que se pactó: {id, nombre, tipo, valor,
-- dias_gracia, tope_pct}. NO se lee la config actual al calcular — si el negocio
-- sube la tasa mañana, no puede aplicarla a lo ya otorgado (además de injusto,
-- sería inexigible).
ALTER TABLE IF EXISTS creditos  ADD COLUMN IF NOT EXISTS fecha_limite   DATE;
ALTER TABLE IF EXISTS creditos  ADD COLUMN IF NOT EXISTS mora_condicion JSONB;
ALTER TABLE IF EXISTS prestamos ADD COLUMN IF NOT EXISTS fecha_limite   DATE;
ALTER TABLE IF EXISTS prestamos ADD COLUMN IF NOT EXISTS mora_condicion JSONB;

-- Índices parciales: solo indexan los documentos que SÍ tienen plazo, así que
-- en un negocio sin la feature ocupan prácticamente nada.
CREATE INDEX IF NOT EXISTS idx_creditos_fecha_limite
  ON creditos (fecha_limite) WHERE fecha_limite IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prestamos_fecha_limite
  ON prestamos (fecha_limite) WHERE fecha_limite IS NOT NULL;

-- ── 2. Movimientos de mora (cobros y condonaciones) ─────────────────────────
--
-- La mora PENDIENTE no se guarda: se deriva como
--   causada(saldo, días, condición) − Σ Cobro − Σ Condonacion
-- Igual que la deuda de la red interna y los saldos de tesorería: un solo lado,
-- así que no hay nada que pueda desincronizarse. Si se cancela la factura o se
-- devuelve un producto y el saldo baja, la mora se corrige sola.
CREATE TABLE IF NOT EXISTS movimientos_mora (
  id               BIGSERIAL     PRIMARY KEY,
  negocio_id       INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
  sucursal_id      INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,

  -- Exactamente uno de los dos: el documento al que pertenece la mora.
  credito_id       INTEGER       REFERENCES creditos(id)  ON DELETE CASCADE,
  prestamo_id      INTEGER       REFERENCES prestamos(id) ON DELETE CASCADE,

  tipo             TEXT          NOT NULL,
  valor            NUMERIC(14,2) NOT NULL CHECK (valor > 0),

  -- Foto del cálculo al momento del movimiento: deja auditar por qué se cobró
  -- ese valor aunque después cambien el saldo o los días.
  dias_mora        INTEGER,
  saldo_base       NUMERIC(14,2),
  condicion        JSONB,

  metodo           TEXT,          -- solo para Cobro (Efectivo, Nequi, …)
  motivo           TEXT,          -- OBLIGATORIO para Condonacion (se valida en el service)

  -- Abono con el que se pagó esta mora, si vino dentro de un abono.
  abono_credito_id  INTEGER      REFERENCES abonos_credito(id)  ON DELETE SET NULL,
  abono_prestamo_id INTEGER      REFERENCES abonos_prestamo(id) ON DELETE SET NULL,

  usuario_id       INTEGER,
  fecha            TIMESTAMP     NOT NULL DEFAULT NOW(),
  anulado          BOOLEAN       NOT NULL DEFAULT FALSE,

  CONSTRAINT movimientos_mora_tipo_chk
    CHECK (tipo IN ('Cobro', 'Condonacion')),
  -- Un movimiento pertenece a un crédito O a un préstamo, nunca a los dos ni a
  -- ninguno: sin esto una fila huérfana quedaría fuera de todos los cálculos.
  CONSTRAINT movimientos_mora_un_origen_chk
    CHECK ((credito_id IS NOT NULL) <> (prestamo_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_mov_mora_credito
  ON movimientos_mora (credito_id)  WHERE credito_id  IS NOT NULL AND NOT anulado;
CREATE INDEX IF NOT EXISTS idx_mov_mora_prestamo
  ON movimientos_mora (prestamo_id) WHERE prestamo_id IS NOT NULL AND NOT anulado;
-- Para el grupo de caja y los reportes por rango de fechas.
CREATE INDEX IF NOT EXISTS idx_mov_mora_sucursal_fecha
  ON movimientos_mora (sucursal_id, fecha DESC) WHERE NOT anulado;
