-- ─────────────────────────────────────────────────────────────────────────────
-- HISTORIAL DE MOVIMIENTOS DE UBICACIÓN — "¿quién movió esto, y de dónde?"
--
-- Extiende 20260831_ubicaciones_estructura.sql. Aquella dejó `ubicaciones_items`
-- con `actualizado_en` y `usuario_id`, que dicen quién tocó por ÚLTIMA vez pero
-- no de dónde vino ni qué pasó antes. En una bodega con tres personas esa es
-- justo la pregunta que aparece cuando algo no está donde debería.
--
-- 100% ADITIVA e IDEMPOTENTE. Tabla nueva, nada existente cambia.
--
-- ── El log NUNCA puede tumbar el movimiento ─────────────────────────────────
-- Mover mercancía de estante es la operación diaria del bodeguero; anotarlo es
-- un extra. Si esta tabla no existiera (migración no aplicada, permisos), el
-- INSERT abortaría la transacción y **el movimiento fallaría por culpa de su
-- propia bitácora**. Por eso `src/config/columnas.js` la detecta aparte y, si
-- falta, el módulo simplemente no registra: se mueve igual. Es la misma regla
-- que `notificaciones.service.enviar()`, que nunca lanza porque un aviso
-- fallido no puede tumbar la venta que lo disparó.
--
-- ── Por qué se guardan los nombres, y no solo los ids ───────────────────────
-- `etiqueta`, `desde_nombre` y `hacia_nombre` están DENORMALIZADOS a propósito,
-- por dos razones distintas:
--
--   1. Pintar el historial con ids obligaría a un UNION de cinco ramas para el
--      nodo más dos JOIN para las ubicaciones, en cada carga de una lista que
--      crece sin tope. Con los nombres congelados es un solo escaneo.
--   2. NULL en `desde_id` es AMBIGUO: significa "venía de ningún sitio" y
--      también "la ubicación de origen ya no existe". Con el nombre al lado, la
--      línea sigue contando la verdad — "de Estante A-3 a Vitrina 2" — aunque
--      el estante se haya dado de baja después.
--
-- Es el mismo criterio con el que `lineas_remision.costo_origen` congela el
-- costo al despachar: el promedio ponderado del nodo se mueve con la siguiente
-- compra y después no hay forma de reconstruir lo que valía ese día.
--
-- Esta migración también se auto-aplica al arrancar el backend
-- (src/config/migrations.js). Escribir el .sql y olvidar el runner deja el
-- despliegue con el código nuevo contra una base vieja.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS movimientos_ubicacion (
  id          BIGSERIAL PRIMARY KEY,
  sucursal_id INTEGER NOT NULL REFERENCES sucursales(id),

  -- El nodo que se movió. Mismas cinco FK con CHECK de exactamente una que
  -- `ubicaciones_items`: los tres niveles del árbol por cantidad, la referencia
  -- con IMEI y la unidad suelta.
  --
  -- CASCADE, no SET NULL: si el producto se borra, su rastro de estantes ya no
  -- le sirve a nadie, y una fila que no puede decir QUÉ se movió es ruido en
  -- una lista que se lee con prisa. Esto es una bitácora operativa, no una
  -- auditoría legal — para eso está `auditoria_eliminaciones`.
  producto_cantidad_id INTEGER REFERENCES productos_cantidad(id) ON DELETE CASCADE,
  atributo_id          INTEGER REFERENCES atributos_producto(id) ON DELETE CASCADE,
  variante_id          INTEGER REFERENCES variantes_atributo(id) ON DELETE CASCADE,
  producto_serial_id   INTEGER REFERENCES productos_serial(id)   ON DELETE CASCADE,
  serial_id            INTEGER REFERENCES seriales(id)           ON DELETE CASCADE,

  -- NULL = "sin ubicar" en ese extremo. Es un valor legítimo en los dos: sacar
  -- algo de un estante y devolverlo a la bandeja también es un movimiento.
  desde_id     BIGINT REFERENCES ubicaciones(id) ON DELETE SET NULL,
  hacia_id     BIGINT REFERENCES ubicaciones(id) ON DELETE SET NULL,

  etiqueta     TEXT,
  desde_nombre TEXT,
  hacia_nombre TEXT,

  usuario_id   INTEGER,
  fecha        TIMESTAMP DEFAULT NOW(),

  CONSTRAINT movimientos_ubicacion_uno_chk CHECK (
    (producto_cantidad_id IS NOT NULL)::int +
    (atributo_id          IS NOT NULL)::int +
    (variante_id          IS NOT NULL)::int +
    (producto_serial_id   IS NOT NULL)::int +
    (serial_id            IS NOT NULL)::int = 1
  )
);

-- La consulta de la pantalla es "lo último de esta sucursal", así que el índice
-- lleva la fecha DESC dentro de la propia sucursal: sin eso, Postgres ordena
-- toda la tabla para devolver 50 filas.
CREATE INDEX IF NOT EXISTS idx_movimientos_ubicacion_sucursal
  ON movimientos_ubicacion (sucursal_id, fecha DESC);

-- Y "qué ha pasado en este estante", que mira los DOS extremos: lo que entró y
-- lo que salió. Son dos índices porque una condición OR sobre dos columnas no
-- puede usar uno solo.
CREATE INDEX IF NOT EXISTS idx_movimientos_ubicacion_hacia
  ON movimientos_ubicacion (hacia_id, fecha DESC) WHERE hacia_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_ubicacion_desde
  ON movimientos_ubicacion (desde_id, fecha DESC) WHERE desde_id IS NOT NULL;

-- Rollback manual (si algún día se necesita). El módulo sigue funcionando sin
-- la tabla: deja de registrar y ya.
--   DROP TABLE IF EXISTS movimientos_ubicacion;
