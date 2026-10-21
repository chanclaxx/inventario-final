-- ─────────────────────────────────────────────────────────────────────────────
-- CENTRO DE GASTOS (20-oct-2026) — Reportes → pestaña «Gastos»
--
-- Lo que el negocio gasta en OPERAR y que no es mercancía: arriendo, nómina,
-- servicios, transporte, publicidad… Las compras a proveedores NO son gasto
-- (son costo de lo vendido) y no entran aquí. Decisiones del usuario:
--   * opt-in por negocio (`config_negocio.gastos_activo`, ausente = apagado);
--   * se agrupa por MES CONTABLE, que por defecto es el mes de la fecha (el
--     arriendo de octubre pagado el 3 de noviembre es de octubre);
--   * hay gastos FIJOS y VARIABLES;
--   * los «gastos fijos» que tenía Proyección (`gastos_fijos`) se convierten en
--     gastos recurrentes de aquí y Proyección lee de aquí. La conversión la hace
--     el servicio (gastos.service.asegurarCatalogo), idempotente por
--     `origen_gasto_fijo_id`; la tabla vieja no se toca ni se borra.
--
-- Nada se borra: un gasto mal registrado se ANULA con motivo (criterio de los
-- abonos). Una categoría o un recurrente se desactivan.
--
-- `usuarios.permisos_gastos` ({ "registrar": true } o NULL): quién, además del
-- admin, puede registrar gastos. Nace con la feature: ausente = no.
--
-- 100% aditiva e idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categorias_gasto (
  id          SERIAL      PRIMARY KEY,
  negocio_id  INTEGER     NOT NULL,
  nombre      TEXT        NOT NULL,
  tipo        TEXT        NOT NULL DEFAULT 'variable' CHECK (tipo IN ('fijo', 'variable')),
  color       TEXT,
  icono       TEXT,
  orden       INTEGER     NOT NULL DEFAULT 0,
  activa      BOOLEAN     NOT NULL DEFAULT TRUE,
  creada_en   TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_gasto_nombre
  ON categorias_gasto (negocio_id, lower(nombre)) WHERE activa;

-- Plantillas: lo que llega cada mes (arriendo el 5, internet el 15…). Generan
-- la lista de pendientes del mes; confirmar una crea el gasto.
CREATE TABLE IF NOT EXISTS gastos_recurrentes (
  id                    SERIAL        PRIMARY KEY,
  negocio_id            INTEGER       NOT NULL,
  sucursal_id           INTEGER       NOT NULL,
  categoria_id          INTEGER       NOT NULL REFERENCES categorias_gasto(id),
  nombre                TEXT          NOT NULL,
  valor                 NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  tipo                  TEXT          NOT NULL DEFAULT 'fijo' CHECK (tipo IN ('fijo', 'variable')),
  dia_pago              SMALLINT      CHECK (dia_pago BETWEEN 1 AND 31),
  tercero               TEXT,
  medio_pago            TEXT,
  activo                BOOLEAN       NOT NULL DEFAULT TRUE,
  -- De qué fila de `gastos_fijos` (Proyección) salió: la conversión no se repite.
  origen_gasto_fijo_id  INTEGER       UNIQUE,
  creado_en             TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gastos_recurrentes_sucursal
  ON gastos_recurrentes (sucursal_id) WHERE activo;

CREATE TABLE IF NOT EXISTS gastos (
  id                 BIGSERIAL     PRIMARY KEY,
  negocio_id         INTEGER       NOT NULL,
  sucursal_id        INTEGER       NOT NULL,
  categoria_id       INTEGER       NOT NULL REFERENCES categorias_gasto(id),
  -- Congelado al registrar: cambiar la categoría de fija a variable no
  -- reescribe los meses ya cerrados.
  tipo               TEXT          NOT NULL CHECK (tipo IN ('fijo', 'variable')),
  fecha              DATE          NOT NULL,
  -- Siempre el día 1 del mes al que pertenece.
  mes_contable       DATE          NOT NULL CHECK (EXTRACT(DAY FROM mes_contable) = 1),
  nombre             TEXT,
  descripcion        TEXT,
  tercero            TEXT,
  numero_soporte     TEXT,
  cantidad           NUMERIC(14,3),
  unidad             TEXT,
  valor_unitario     NUMERIC(14,2),
  subtotal           NUMERIC(14,2),
  iva                NUMERIC(14,2),
  retenciones        NUMERIC(14,2),
  valor_total        NUMERIC(14,2) NOT NULL CHECK (valor_total > 0),
  medio_pago         TEXT,
  observaciones      TEXT,
  recurrente_id      INTEGER       REFERENCES gastos_recurrentes(id),
  usuario_id         INTEGER,
  creado_en          TIMESTAMP     NOT NULL DEFAULT NOW(),
  actualizado_en     TIMESTAMP,
  anulado            BOOLEAN       NOT NULL DEFAULT FALSE,
  anulado_motivo     TEXT,
  anulado_por        INTEGER,
  anulado_en         TIMESTAMP,
  -- Un reintento o un doble clic no registran el gasto dos veces.
  clave_idempotencia TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gastos_idempotencia
  ON gastos (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;

-- Un recurrente se paga UNA vez por mes contable (anular lo libera).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gastos_recurrente_mes
  ON gastos (recurrente_id, mes_contable) WHERE recurrente_id IS NOT NULL AND NOT anulado;

CREATE INDEX IF NOT EXISTS idx_gastos_sucursal_mes
  ON gastos (sucursal_id, mes_contable) WHERE NOT anulado;

ALTER TABLE IF EXISTS usuarios
  ADD COLUMN IF NOT EXISTS permisos_gastos JSONB;
