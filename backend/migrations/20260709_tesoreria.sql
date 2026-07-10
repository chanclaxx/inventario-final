-- ─────────────────────────────────────────────────────────────────────────────
-- TESORERÍA: seguimiento del dinero por ubicación (efectivo, bancos,
-- billeteras, corresponsales) por sucursal.
--
-- 100% ADITIVA e IDEMPOTENTE: se puede ejecutar varias veces sin efecto.
-- No modifica ninguna tabla ni dato existente.
--
-- Diseño:
--   * cuentas_dinero    → ubicaciones del dinero. Cada método de pago del
--                         negocio se mapea a UNA cuenta por sucursal.
--   * movimientos_dinero→ SOLO los movimientos que hoy no existen en el
--                         sistema: traslados entre cuentas, consignaciones,
--                         retiros, gastos y ajustes de arqueo. Los ingresos y
--                         egresos operativos (ventas, abonos, compras…) NO se
--                         duplican aquí: el saldo se deriva de las tablas
--                         existentes mapeando método → cuenta.
--   * arqueos_cuenta    → anclas de saldo confirmado. El saldo de una cuenta
--                         se calcula como: último arqueo + delta desde el
--                         arqueo. Sin arqueo, desde cero.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Cuentas de dinero ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuentas_dinero (
  id                  SERIAL      PRIMARY KEY,
  negocio_id          INTEGER     NOT NULL,
  sucursal_id         INTEGER     NOT NULL,
  nombre              TEXT        NOT NULL,
  -- 'efectivo' | 'banco' | 'billetera' | 'corresponsal' | 'otro'
  tipo                TEXT        NOT NULL DEFAULT 'otro',
  -- Métodos de pago cuyos ingresos/egresos caen automáticamente en esta cuenta
  -- (p. ej. {'Efectivo'} o {'Nequi','Daviplata'}). Un método no puede estar en
  -- dos cuentas activas de la misma sucursal (lo valida el service).
  metodos_pago        TEXT[]      NOT NULL DEFAULT '{}',
  -- Comisión informativa (%) que cobra la entidad (corresponsal, datáfono…)
  porcentaje_comision NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- 'COP' | 'USD'. Las cuentas USD (divisa) llevan su saldo EN DÓLARES y no
  -- pueden tener métodos de pago asignados (las ventas/compras son en pesos).
  moneda              TEXT        NOT NULL DEFAULT 'COP',
  activa              BOOLEAN     NOT NULL DEFAULT TRUE,
  creada_en           TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cuentas_dinero_sucursal
  ON cuentas_dinero (negocio_id, sucursal_id) WHERE activa;

-- Evita duplicar la cuenta por nombre dentro de una sucursal (soporta el
-- auto-seed idempotente de la cuenta "Efectivo").
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuentas_dinero_nombre
  ON cuentas_dinero (negocio_id, sucursal_id, lower(nombre)) WHERE activa;

-- 2. Movimientos de tesorería ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS movimientos_dinero (
  id                 BIGSERIAL   PRIMARY KEY,
  cuenta_id          INTEGER     NOT NULL REFERENCES cuentas_dinero(id),
  -- 'entrada' | 'salida'
  tipo               TEXT        NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  -- 'traslado' | 'consignacion' | 'retiro' | 'gasto' | 'ingreso' | 'ajuste_arqueo'
  categoria          TEXT        NOT NULL,
  valor              NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  concepto           TEXT,
  -- Liga el par salida/entrada de un traslado (mismo UUID en ambas filas)
  grupo_traslado     UUID,
  usuario_id         INTEGER,
  -- Tasa COP por USD cuando el movimiento cruza monedas (compra de divisa)
  tasa_cambio        NUMERIC(12,4),
  fecha              TIMESTAMP   NOT NULL DEFAULT NOW(),
  activo             BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Idempotencia: si el cliente reintenta el mismo POST, el UNIQUE evita
  -- registrar el movimiento dos veces.
  clave_idempotencia TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_movimientos_dinero_idem
  ON movimientos_dinero (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_dinero_cuenta_fecha
  ON movimientos_dinero (cuenta_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_movimientos_dinero_grupo
  ON movimientos_dinero (grupo_traslado) WHERE grupo_traslado IS NOT NULL;

-- 3. Arqueos (anclas de saldo confirmado) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS arqueos_cuenta (
  id              BIGSERIAL     PRIMARY KEY,
  cuenta_id       INTEGER       NOT NULL REFERENCES cuentas_dinero(id),
  -- Saldo real contado/confirmado por el usuario. Es el ancla del cálculo.
  saldo           NUMERIC(14,2) NOT NULL,
  -- Saldo que el sistema calculaba en ese momento (para auditar el descuadre)
  saldo_calculado NUMERIC(14,2),
  diferencia      NUMERIC(14,2),
  usuario_id      INTEGER,
  notas           TEXT,
  fecha           TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arqueos_cuenta_fecha
  ON arqueos_cuenta (cuenta_id, fecha DESC);

-- 4. Auditoría de eliminaciones (si ya está instalada la papelera genérica) ───
-- Reutiliza fn_auditar_eliminacion() de 20260709_auditoria_eliminaciones.sql.
-- Si la función no existe todavía, este bloque no hace nada (seguro).
DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('fn_auditar_eliminacion()') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['cuentas_dinero', 'movimientos_dinero', 'arqueos_cuenta'] LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS trg_auditar_eliminacion ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_auditar_eliminacion
           BEFORE DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION fn_auditar_eliminacion()',
        t
      );
    END LOOP;
  END IF;
END $$;

-- Rollback manual (si algún día se necesita):
--   DROP TABLE IF EXISTS arqueos_cuenta;
--   DROP TABLE IF EXISTS movimientos_dinero;
--   DROP TABLE IF EXISTS cuentas_dinero;
