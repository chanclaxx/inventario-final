-- ─────────────────────────────────────────────────────────────────────────────
-- INTERÉS CORRIENTE en créditos y préstamos — migración 100% ADITIVA e IDEMPOTENTE
--
-- Hermana de 20260730_mora_credito.sql. La mora sanciona el ATRASO; el interés
-- corriente cobra el PLAZO. Son independientes: se puede tener uno, el otro,
-- los dos o ninguno.
--
-- Feature opt-in por negocio vía config_negocio.interes_activa ('1'/'0'); ese
-- flag NO requiere migración (config_negocio es clave-valor).
--
-- GARANTÍAS PARA PRODUCCIÓN:
--   • Solo ADD COLUMN IF NOT EXISTS (nullable) y CREATE INDEX IF NOT EXISTS
--     → re-ejecutable sin efectos.
--   • La única columna con DEFAULT es `concepto`, y es un DEFAULT CONSTANTE:
--     desde PostgreSQL 11 eso NO reescribe la tabla. Las filas que ya existen
--     quedan marcadas como 'mora', que es exactamente lo que son.
--   • `interes_condicion IS NULL` ⇒ el documento NO causa interés. Jamás. Es la
--     misma regla que hace aditiva a la mora (`fecha_limite IS NULL`), y por eso
--     los 1.793 préstamos y 15 créditos existentes no cambian en nada, ni al
--     migrar ni al activar la feature.
--
-- POR QUÉ EL INTERÉS COMPARTE TABLA CON LA MORA:
--   Los dos cargos tienen el mismo ciclo de vida — se derivan (nunca se guarda
--   lo pendiente), se cobran, se condonan con motivo y PIN, se anulan en cascada
--   con el abono, y NUNCA entran en `total_abonado` porque los reportes calculan
--   la utilidad como (abonado − costo) y los contarían como margen comercial.
--   Una tabla con discriminador evita duplicar el repositorio, los grupos de
--   caja, el reporte por rango, los PDF y las alertas del cron.
--
-- ROLLBACK manual:
--   ALTER TABLE movimientos_mora DROP CONSTRAINT IF EXISTS movimientos_mora_concepto_chk;
--   ALTER TABLE movimientos_mora DROP COLUMN IF EXISTS concepto;
--   ALTER TABLE creditos  DROP COLUMN IF EXISTS interes_condicion, DROP COLUMN IF EXISTS interes_desde;
--   ALTER TABLE prestamos DROP COLUMN IF EXISTS interes_condicion, DROP COLUMN IF EXISTS interes_desde;
--   DELETE FROM config_negocio WHERE clave LIKE 'interes_%';
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. El pacto de interés, congelado en cada documento ─────────────────────
--
-- `interes_condicion` congela el plan que se pactó (periodicidad, tasa, base,
-- topes, qué hacer al vencer). NO se lee la config actual al calcular: si el
-- negocio sube la tasa mañana, no puede aplicarla a lo ya otorgado — además de
-- injusto, sería inexigible. Mismo criterio que `mora_condicion`.
--
-- `interes_desde` es el ancla temporal. Si viene NULL se usa la fecha de emisión
-- del documento; existe como columna propia para que una renegociación pueda
-- moverla sin tocar el resto del pacto.
ALTER TABLE IF EXISTS creditos  ADD COLUMN IF NOT EXISTS interes_condicion JSONB;
ALTER TABLE IF EXISTS creditos  ADD COLUMN IF NOT EXISTS interes_desde     DATE;
ALTER TABLE IF EXISTS prestamos ADD COLUMN IF NOT EXISTS interes_condicion JSONB;
ALTER TABLE IF EXISTS prestamos ADD COLUMN IF NOT EXISTS interes_desde     DATE;

-- Índices parciales: solo indexan los documentos que SÍ tienen interés pactado,
-- así que en un negocio sin la feature ocupan prácticamente nada.
CREATE INDEX IF NOT EXISTS idx_creditos_interes
  ON creditos (id) WHERE interes_condicion IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prestamos_interes
  ON prestamos (id) WHERE interes_condicion IS NOT NULL;

-- ── 2. Discriminador de concepto en los movimientos ─────────────────────────
--
-- 'mora'    → sanción por pagar tarde
-- 'interes' → precio del plazo
--
-- El DEFAULT deja las filas históricas como 'mora' sin tocarlas, que es lo que
-- efectivamente son: antes de esta migración no existía otro cargo.
ALTER TABLE IF EXISTS movimientos_mora
  ADD COLUMN IF NOT EXISTS concepto TEXT NOT NULL DEFAULT 'mora';

-- Los CHECK no admiten IF NOT EXISTS, así que se consulta el catálogo. Sin esto
-- la segunda ejecución de la migración fallaría.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_mora_concepto_chk'
  ) THEN
    ALTER TABLE movimientos_mora
      ADD CONSTRAINT movimientos_mora_concepto_chk
      CHECK (concepto IN ('mora', 'interes'));
  END IF;
END $$;

-- Caja y reportes agrupan por concepto dentro de un rango de fechas.
CREATE INDEX IF NOT EXISTS idx_mov_mora_concepto
  ON movimientos_mora (sucursal_id, concepto, fecha DESC) WHERE NOT anulado;
