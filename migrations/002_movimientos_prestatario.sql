-- ============================================================
-- Migración 002: Cuenta corriente bilateral para prestatarios
-- SOLO ADITIVA — no modifica ni elimina nada existente
-- ============================================================

CREATE TABLE IF NOT EXISTS movimientos_prestatario (
    id                   SERIAL PRIMARY KEY,
    prestatario_id       INTEGER  NOT NULL REFERENCES prestatarios(id) ON DELETE RESTRICT,
    sucursal_id          INTEGER  NOT NULL REFERENCES sucursales(id),
    usuario_id           INTEGER  REFERENCES usuarios(id),
    fecha                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Clasificación del movimiento
    tipo                 VARCHAR(25) NOT NULL,
    -- 'entrega_producto'  → tú les das producto   (signo +1, te deben más)
    -- 'recibo_producto'   → ellos te dan producto  (signo -1, te deben menos)
    -- 'pago_recibido'     → ellos te pagan cash    (signo -1, te deben menos)
    -- 'pago_enviado'      → tú les pagas cash      (signo -1, reduces lo que te deben)
    -- 'ajuste_manual'     → corrección libre        (signo libre)

    signo                SMALLINT NOT NULL,
    -- Saldo = SUM(valor * signo)
    -- Positivo: el prestatario te debe a ti
    -- Negativo: tú le debes al prestatario

    valor                NUMERIC(12,2) NOT NULL,
    descripcion          TEXT,

    -- Campos de efectivo (solo para pago_recibido / pago_enviado)
    metodo               VARCHAR(50),
    registrar_en_caja    BOOLEAN NOT NULL DEFAULT false,

    -- Campos de producto (solo para entrega_producto / recibo_producto)
    nombre_producto      VARCHAR(150),
    imei                 VARCHAR(50),
    producto_serial_id   INTEGER REFERENCES productos_serial(id),
    producto_cantidad_id INTEGER REFERENCES productos_cantidad(id),
    cantidad             INTEGER DEFAULT 1,
    color                VARCHAR(50),
    ingreso_inventario   BOOLEAN,
    costo_producto       NUMERIC(12,2),

    -- Soft delete (auditoría — nunca hard delete)
    anulado              BOOLEAN NOT NULL DEFAULT false,
    anulado_en           TIMESTAMPTZ,
    anulado_por          INTEGER REFERENCES usuarios(id),
    motivo_anulacion     TEXT,

    creado_en            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_movpre_tipo CHECK (tipo IN (
        'entrega_producto', 'recibo_producto',
        'pago_recibido', 'pago_enviado', 'ajuste_manual'
    )),
    CONSTRAINT chk_movpre_signo CHECK (signo IN (1, -1)),
    CONSTRAINT chk_movpre_valor CHECK (valor > 0)
);

CREATE INDEX IF NOT EXISTS idx_movpre_prestatario ON movimientos_prestatario(prestatario_id);
CREATE INDEX IF NOT EXISTS idx_movpre_fecha        ON movimientos_prestatario(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_movpre_sucursal     ON movimientos_prestatario(sucursal_id);
CREATE INDEX IF NOT EXISTS idx_movpre_anulado      ON movimientos_prestatario(anulado) WHERE NOT anulado;

-- Columna auxiliar para tracking de migración (no afecta código existente)
ALTER TABLE prestatarios ADD COLUMN IF NOT EXISTS cc_migrado BOOLEAN DEFAULT false;
