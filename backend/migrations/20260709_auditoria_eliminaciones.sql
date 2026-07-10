-- ─────────────────────────────────────────────────────────────────────────────
-- Auditoría de eliminaciones — papelera de seguridad ante borrados por error.
--
-- 100% ADITIVO: crea una tabla nueva + triggers BEFORE DELETE que guardan una
-- copia JSON completa de cada fila antes de borrarse. NO modifica ninguna
-- tabla existente, NO cambia el comportamiento de la app (los DELETE siguen
-- funcionando igual) y es IDEMPOTENTE: se puede ejecutar varias veces.
--
-- La función atrapa cualquier error interno con EXCEPTION: si la auditoría
-- fallara por lo que sea, el DELETE del usuario NUNCA se bloquea.
--
-- Notas:
--  * TRUNCATE no dispara triggers por fila (la app no usa TRUNCATE).
--  * Los DELETE en cascada (ON DELETE CASCADE) SÍ disparan el trigger en las
--    tablas hijas que lo tengan — esas filas también quedan auditadas.
--
-- Aplicar manualmente en el SQL Editor de Supabase (proyecto de la BD),
-- igual que las demás migraciones de esta carpeta.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabla de auditoría ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria_eliminaciones (
  id           BIGSERIAL   PRIMARY KEY,
  tabla        TEXT        NOT NULL,
  registro_id  TEXT,                      -- id de la fila borrada (si la tabla tiene columna id)
  datos        JSONB       NOT NULL,      -- fila completa tal como estaba antes del DELETE
  eliminado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_elim_tabla_fecha
  ON auditoria_eliminaciones (tabla, eliminado_en DESC);

CREATE INDEX IF NOT EXISTS idx_auditoria_elim_registro
  ON auditoria_eliminaciones (tabla, registro_id);

-- 2. Función genérica de auditoría ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_auditar_eliminacion()
RETURNS trigger AS $$
BEGIN
  BEGIN
    INSERT INTO auditoria_eliminaciones (tabla, registro_id, datos)
    VALUES (TG_TABLE_NAME, to_jsonb(OLD) ->> 'id', to_jsonb(OLD));
  EXCEPTION WHEN OTHERS THEN
    -- La auditoría jamás debe impedir la operación del usuario
    RAISE WARNING 'auditoria_eliminaciones falló en %: %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 3. Triggers en las tablas de negocio importantes ────────────────────────────
-- Solo se crean si la tabla existe (to_regclass) — seguro en cualquier entorno.
DO $$
DECLARE
  t TEXT;
  tablas TEXT[] := ARRAY[
    'facturas', 'lineas_factura', 'pagos_factura', 'retomas',
    'creditos', 'abonos_credito',
    'prestamos', 'abonos_prestamo', 'empleados_prestatario',
    'compras', 'lineas_compra',
    'seriales', 'historial_stock_cantidad',
    'productos_serial', 'productos_cantidad',
    'clientes', 'proveedores', 'acreedores', 'prestatarios',
    'garantias', 'movimientos_caja', 'aperturas_caja', 'movimientos_acreedor',
    'traslados', 'lineas_traslado', 'vendedores'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_auditar_eliminacion ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_auditar_eliminacion
           BEFORE DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION fn_auditar_eliminacion()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Consultas útiles:
--
--   Ver lo último eliminado:
--     SELECT tabla, registro_id, eliminado_en, datos
--     FROM auditoria_eliminaciones ORDER BY eliminado_en DESC LIMIT 50;
--
--   Recuperar una factura borrada (los datos completos están en `datos`):
--     SELECT datos FROM auditoria_eliminaciones
--     WHERE tabla = 'facturas' AND registro_id = '123';
--
-- Rollback completo (si algún día se quiere quitar la auditoría):
--
--   DO $$
--   DECLARE r RECORD;
--   BEGIN
--     FOR r IN SELECT event_object_table AS tabla FROM information_schema.triggers
--              WHERE trigger_name = 'trg_auditar_eliminacion' LOOP
--       EXECUTE format('DROP TRIGGER trg_auditar_eliminacion ON %I', r.tabla);
--     END LOOP;
--   END $$;
--   DROP FUNCTION IF EXISTS fn_auditar_eliminacion();
--   -- DROP TABLE auditoria_eliminaciones;  -- solo si no se necesita el historial
-- ─────────────────────────────────────────────────────────────────────────────
