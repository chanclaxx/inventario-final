-- ─────────────────────────────────────────────────────────────────────────────
-- SERVICIO TÉCNICO — abonos en cualquier etapa y el técnico que reparó
-- (pedido del usuario, 25-oct-2026)
--
-- 1. `abonos_servicio` deja de ser solo «plata que entró al final»:
--    · `tipo`  'abono' | 'devolucion'. Una devolución es plata que SALE
--      (precio final menor que lo abonado, o un «sin reparar» con anticipo).
--      El valor sigue siendo positivo (el CHECK de siempre).
--    · `etapa` el estado de la orden cuando se pagó («abonó al recibir»).
--    · `ciclo` a qué ciclo de la orden pertenece: 0 = la reparación, N = la
--      garantía N. Al abrir una garantía cobrable el abonado vuelve a 0, así que
--      anular un abono solo tiene sentido dentro del ciclo vigente. Los abonos
--      anteriores a esta migración quedan en NULL y no se pueden anular.
--    · anulación con motivo: nada se borra (criterio de los abonos de préstamos).
-- 2. `ordenes_servicio.ciclo` (sube al abrir una garantía) y `tecnico_id`.
-- 3. `tecnicos_servicio`: la lista de técnicos INTERNOS del negocio (como la de
--    vendedores). Opt-in con `servicios_tecnicos_activo` (ausente = apagado).
--    Los técnicos EXTERNOS siguen en su módulo (`tecnicos`); quién reparó una
--    orden que fue afuera se lee de `equipos_tecnico`, no se escribe dos veces.
--
-- Aditiva: sin esta migración Servicios funciona como siempre
-- (`hayServicioAbonosV2()` / `hayTecnicosServicio()` en falso no nombran nada
-- nuevo). El runner de arranque lee ESTE MISMO archivo.
--
-- Rollback:
--   DROP TABLE IF EXISTS tecnicos_servicio;
--   ALTER TABLE ordenes_servicio DROP COLUMN IF EXISTS tecnico_id, DROP COLUMN IF EXISTS ciclo;
--   ALTER TABLE abonos_servicio DROP COLUMN IF EXISTS tipo, DROP COLUMN IF EXISTS etapa,
--     DROP COLUMN IF EXISTS ciclo, DROP COLUMN IF EXISTS anulado,
--     DROP COLUMN IF EXISTS anulado_motivo, DROP COLUMN IF EXISTS anulado_por,
--     DROP COLUMN IF EXISTS anulado_en;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE abonos_servicio ADD COLUMN IF NOT EXISTS tipo           TEXT    NOT NULL DEFAULT 'abono';
ALTER TABLE abonos_servicio ADD COLUMN IF NOT EXISTS etapa          TEXT;
ALTER TABLE abonos_servicio ADD COLUMN IF NOT EXISTS ciclo          INTEGER;
ALTER TABLE abonos_servicio ADD COLUMN IF NOT EXISTS anulado        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE abonos_servicio ADD COLUMN IF NOT EXISTS anulado_motivo TEXT;
ALTER TABLE abonos_servicio ADD COLUMN IF NOT EXISTS anulado_por    INTEGER;
ALTER TABLE abonos_servicio ADD COLUMN IF NOT EXISTS anulado_en     TIMESTAMP;

DO $$
BEGIN
  ALTER TABLE abonos_servicio ADD CONSTRAINT abonos_servicio_tipo_check
    CHECK (tipo IN ('abono', 'devolucion'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS ciclo      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS tecnico_id INTEGER;

CREATE TABLE IF NOT EXISTS tecnicos_servicio (
  id           SERIAL PRIMARY KEY,
  negocio_id   INTEGER   NOT NULL,
  sucursal_id  INTEGER,                -- NULL = trabaja en todas las sedes
  nombre       TEXT      NOT NULL,
  usuario_id   INTEGER,                -- opcional: su usuario en la app
  activo       BOOLEAN   NOT NULL DEFAULT TRUE,
  creado_en    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Dos técnicos ACTIVOS con el mismo nombre en el negocio serían dos filas en el
-- reporte para la misma persona.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tecnicos_servicio_nombre
  ON tecnicos_servicio (negocio_id, LOWER(BTRIM(nombre))) WHERE activo;
CREATE INDEX IF NOT EXISTS idx_tecnicos_servicio_negocio ON tecnicos_servicio (negocio_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_servicio_tecnico
  ON ordenes_servicio (tecnico_id) WHERE tecnico_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_abonos_servicio_orden ON abonos_servicio (orden_id);
