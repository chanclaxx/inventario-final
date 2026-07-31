-- ─────────────────────────────────────────────────────────────────────────────
-- UBICACIÓN ESPACIAL DE PRODUCTOS (dónde está físicamente dentro de la sucursal)
--
-- Responde a la pregunta del bodeguero: "¿en qué estante está esto?". El sistema
-- ya sabía CUÁNTO hay y EN QUÉ SUCURSAL; esto agrega EN QUÉ PUNTO de la sucursal.
-- Feature opt-in por negocio vía config_negocio.ubicacion_activa ('1'/'0'); ese
-- flag NO requiere migración (config_negocio es clave-valor).
--
-- 100% ADITIVA e IDEMPOTENTE: se puede ejecutar varias veces sin efecto.
-- Columnas nullable: los negocios que no activen la feature no notan el cambio.
--
-- Diseño:
--   * TEXT libre ("Estante A-3", "Vitrina 2", "Bodega fondo"). El frontend
--     autocompleta con las ubicaciones ya usadas en la sucursal para que no
--     convivan "estante a3" y "Estante A-3" como si fueran sitios distintos.
--   * UNA ubicación por fila. Como productos_cantidad y productos_serial ya
--     tienen una fila por (producto, sucursal), la ubicación queda separada por
--     sucursal automáticamente, sin tabla puente.
--   * En serial la ubicación es de la REFERENCIA (productos_serial), no de cada
--     IMEI: un modelo vive en un estante, no cada unidad. La tabla `seriales`
--     no se toca.
--   * NO se hereda entre sucursales (a diferencia de `codigo`): describe un
--     lugar físico, y el "Estante A-3" de una sede no existe en otra.
--   * El stock NO se reparte entre ubicaciones. La "cantidad que debe haber
--     ahí" es el stock que el sistema ya lleva para esa fila.
--
-- Índices funcionales (LOWER+BTRIM) porque el filtro y el listado de
-- ubicaciones normalizan igual; un índice plano sobre `ubicacion` no aplicaría.
--
-- Esta migración también se auto-aplica al arrancar el backend
-- (src/config/migrations.js), y src/config/columnas.js comprueba después si las
-- columnas existen: si no, la feature se apaga sola y las consultas siguen
-- emitiendo el SQL de siempre.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS ubicacion TEXT;
ALTER TABLE IF EXISTS productos_serial   ADD COLUMN IF NOT EXISTS ubicacion TEXT;

CREATE INDEX IF NOT EXISTS idx_productos_cantidad_ubicacion
  ON productos_cantidad (sucursal_id, LOWER(BTRIM(ubicacion)))
  WHERE ubicacion IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_productos_serial_ubicacion
  ON productos_serial (sucursal_id, LOWER(BTRIM(ubicacion)))
  WHERE ubicacion IS NOT NULL;

-- Rollback manual (si algún día se necesita). Basta apagar el flag
-- `ubicacion_activa` para que la feature desaparezca de la vista sin perder datos:
--   DROP INDEX IF EXISTS idx_productos_cantidad_ubicacion;
--   DROP INDEX IF EXISTS idx_productos_serial_ubicacion;
--   ALTER TABLE productos_cantidad DROP COLUMN IF EXISTS ubicacion;
--   ALTER TABLE productos_serial   DROP COLUMN IF EXISTS ubicacion;
