-- ─────────────────────────────────────────────────────────────────────────────
-- GASTOS FIJOS: costos operativos mensuales recurrentes por sucursal
-- (arriendo, nómina, servicios, internet…). Alimentan la Proyección mensual
-- del módulo de Reportes: utilidad neta y punto de equilibrio.
--
-- 100% ADITIVA e IDEMPOTENTE: se puede ejecutar varias veces sin efecto.
-- No modifica ninguna tabla ni dato existente.
--
-- Diseño:
--   * Un gasto fijo = un concepto recurrente con un valor mensual estimado.
--   * Es POR SUCURSAL (el arriendo/nómina cambian entre sucursales).
--   * Borrado LÓGICO (activo = FALSE) — consistente con el resto del sistema
--     y con la papelera de auditoría.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gastos_fijos (
  id          SERIAL        PRIMARY KEY,
  sucursal_id INTEGER       NOT NULL,
  nombre      TEXT          NOT NULL,
  valor       NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  activo      BOOLEAN       NOT NULL DEFAULT TRUE,
  creado_en   TIMESTAMP     NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gastos_fijos_sucursal
  ON gastos_fijos (sucursal_id) WHERE activo;

-- Auditoría de eliminaciones (si ya está instalada la papelera genérica).
-- Reutiliza fn_auditar_eliminacion() de 20260709_auditoria_eliminaciones.sql.
-- Si la función no existe todavía, este bloque no hace nada (seguro).
DO $$
BEGIN
  IF to_regprocedure('fn_auditar_eliminacion()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_auditar_eliminacion ON gastos_fijos;
    CREATE TRIGGER trg_auditar_eliminacion
      BEFORE DELETE ON gastos_fijos
      FOR EACH ROW EXECUTE FUNCTION fn_auditar_eliminacion();
  END IF;
END $$;

-- Rollback manual (si algún día se necesita):
--   DROP TABLE IF EXISTS gastos_fijos;
