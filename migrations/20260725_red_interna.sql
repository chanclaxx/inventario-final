-- ─────────────────────────────────────────────────────────────────────────────
-- RED INTERNA (bodega → locales) — migración 100% ADITIVA e IDEMPOTENTE
--
-- Modelo: CONSIGNACIÓN.
--   La mercancía que la bodega remisiona a un local NO genera deuda al entregar.
--   La deuda nace cuando el local VENDE, y se DERIVA de las tablas existentes
--   (seriales + lineas_factura + creditos). Aquí solo se guarda:
--     • qué salió y a dónde  → remisiones / lineas_remision
--     • qué plata volvió     → remesas
--     • gastos autorizados, ajustes y cortes → movimientos_cuenta_interna
--
-- GARANTÍAS PARA PRODUCCIÓN:
--   • Ningún ALTER sobre tablas existentes. Ninguno.
--   • Solo CREATE TABLE/INDEX IF NOT EXISTS → re-ejecutable sin efectos.
--   • Todas las FK hacia tablas existentes son ON DELETE RESTRICT: estas tablas
--     jamás pueden borrar en cascada un dato viejo.
--   • Un negocio sin el flag `red_interna_activa` nunca escribe aquí.
--
-- ROLLBACK: DROP TABLE de las 4 tablas + DELETE de los flags en config_negocio
--           deja el sistema idéntico a como estaba.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Remisiones (documento valorizado de entrega) ──────────────────────────
CREATE TABLE IF NOT EXISTS remisiones (
  id                  BIGSERIAL     PRIMARY KEY,
  negocio_id          INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
  numero              INTEGER,
  tipo                TEXT          NOT NULL DEFAULT 'entrega',
  sucursal_origen_id  INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  sucursal_destino_id INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  traslado_id         INTEGER       REFERENCES traslados(id)           ON DELETE RESTRICT,
  estado              TEXT          NOT NULL DEFAULT 'En transito',
  valor_total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  usuario_emisor_id   INTEGER,
  usuario_receptor_id INTEGER,
  fecha_emision       TIMESTAMP     NOT NULL DEFAULT NOW(),
  fecha_recepcion     TIMESTAMP,
  clave_idempotencia  TEXT,
  notas               TEXT,
  CONSTRAINT remisiones_tipo_chk   CHECK (tipo   IN ('entrega', 'devolucion')),
  CONSTRAINT remisiones_estado_chk CHECK (estado IN ('En transito', 'Recibida', 'Parcial', 'Anulada')),
  CONSTRAINT remisiones_suc_distintas_chk CHECK (sucursal_origen_id <> sucursal_destino_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_remisiones_idem
  ON remisiones (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_remisiones_negocio_destino
  ON remisiones (negocio_id, sucursal_destino_id, estado);
CREATE INDEX IF NOT EXISTS idx_remisiones_origen
  ON remisiones (sucursal_origen_id, fecha_emision DESC);

-- ── 2. Líneas de remisión ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lineas_remision (
  id                  BIGSERIAL     PRIMARY KEY,
  remision_id         BIGINT        NOT NULL REFERENCES remisiones(id) ON DELETE CASCADE,
  tipo                TEXT          NOT NULL,
  serial_id           INTEGER       REFERENCES seriales(id)            ON DELETE RESTRICT,
  imei                TEXT,
  producto_origen_id  INTEGER,
  producto_destino_id INTEGER,
  cantidad            INTEGER       NOT NULL DEFAULT 1,
  cantidad_recibida   INTEGER,
  valor_interno       NUMERIC(14,2) NOT NULL DEFAULT 0,
  estado_linea        TEXT          NOT NULL DEFAULT 'Pendiente',
  nombre_producto     TEXT,
  CONSTRAINT lineas_remision_tipo_chk   CHECK (tipo IN ('serial', 'cantidad')),
  CONSTRAINT lineas_remision_estado_chk CHECK (estado_linea IN ('Pendiente', 'Recibida', 'Faltante', 'Devuelta'))
);

CREATE INDEX IF NOT EXISTS idx_lineas_remision_remision ON lineas_remision (remision_id);
CREATE INDEX IF NOT EXISTS idx_lineas_remision_serial   ON lineas_remision (serial_id) WHERE serial_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lineas_remision_producto ON lineas_remision (producto_destino_id) WHERE tipo = 'cantidad';

-- Una unidad serial no puede estar viva en dos remisiones a la vez.
-- (Se libera al devolverla o al marcarla faltante, por eso el WHERE parcial.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_lineas_remision_serial_viva
  ON lineas_remision (serial_id)
  WHERE serial_id IS NOT NULL AND estado_linea IN ('Pendiente', 'Recibida');

-- ── 3. Remesas (efectivo local → bodega) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS remesas (
  id                  BIGSERIAL     PRIMARY KEY,
  negocio_id          INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
  numero              INTEGER,
  sucursal_origen_id  INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  sucursal_destino_id INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  cuenta_origen_id    INTEGER,
  cuenta_transito_id  INTEGER,
  cuenta_destino_id   INTEGER,
  valor               NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  metodo              TEXT,
  estado              TEXT          NOT NULL DEFAULT 'En transito',
  mov_salida_id       BIGINT,
  mov_transito_id     BIGINT,
  mov_entrada_id      BIGINT,
  usuario_envia_id    INTEGER,
  usuario_recibe_id   INTEGER,
  fecha_envio         TIMESTAMP     NOT NULL DEFAULT NOW(),
  fecha_recepcion     TIMESTAMP,
  clave_idempotencia  TEXT,
  notas               TEXT,
  CONSTRAINT remesas_estado_chk CHECK (estado IN ('En transito', 'Recibida', 'Anulada'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_remesas_idem
  ON remesas (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_remesas_origen
  ON remesas (negocio_id, sucursal_origen_id, estado);
CREATE INDEX IF NOT EXISTS idx_remesas_destino
  ON remesas (negocio_id, sucursal_destino_id, estado);

-- ── 4. Movimientos de cuenta interna (gastos autorizados, ajustes, cortes) ───
-- NO guarda cargos por mercancía: esos se derivan de las ventas.
CREATE TABLE IF NOT EXISTS movimientos_cuenta_interna (
  id              BIGSERIAL     PRIMARY KEY,
  negocio_id      INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
  sucursal_id     INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  tipo            TEXT          NOT NULL,
  valor           NUMERIC(14,2) NOT NULL DEFAULT 0,
  saldo_congelado NUMERIC(14,2),
  mov_dinero_id   BIGINT,
  concepto        TEXT,
  usuario_id      INTEGER,
  fecha           TIMESTAMP     NOT NULL DEFAULT NOW(),
  anulado         BOOLEAN       NOT NULL DEFAULT FALSE,
  CONSTRAINT mci_tipo_chk CHECK (tipo IN ('GastoAutorizado', 'Ajuste', 'Corte'))
);

CREATE INDEX IF NOT EXISTS idx_mci_sucursal
  ON movimientos_cuenta_interna (negocio_id, sucursal_id, fecha DESC) WHERE NOT anulado;
