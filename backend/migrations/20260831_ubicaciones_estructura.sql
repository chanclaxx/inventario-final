-- ─────────────────────────────────────────────────────────────────────────────
-- UBICACIONES COMO ENTIDAD — la ubicación deja de ser un atributo del producto
--
-- Extiende 20260730_ubicacion_producto.sql, que puso la ubicación como TEXT
-- libre en `productos_cantidad` y `productos_serial`. Aquel modelo responde
-- "¿en qué estante está esto?"; ahora se le pide lo contrario, "¿qué hay en
-- este estante?", y para eso el sitio tiene que existir como fila:
--
--   * Una ubicación derivada de los productos NO PUEDE ESTAR VACÍA — existe
--     solo mientras alguien la nombre. Un mapa que solo dibuja lo lleno no es
--     un mapa.
--   * Renombrar era un UPDATE masivo de texto libre, y un error de tecleo
--     bifurcaba el sitio en silencio: el MODE() del catálogo elegía una grafía
--     para MOSTRAR, pero el filtro de la pantalla compara exacto y dejaba las
--     otras fuera de su propio estante.
--   * Coordenadas, jerarquía, tipo y color no tienen dónde vivir en un TEXT.
--
-- 100% ADITIVA e IDEMPOTENTE: se puede ejecutar varias veces sin efecto.
-- NO se borran las columnas `ubicacion` de 20260730: quedan de respaldo y hacen
-- que el rollback sea apagar `ubicacion_activa`, como todo en este sistema.
-- `src/config/columnas.js` comprueba después si las tablas existen: si no, la
-- feature se apaga sola y el inventario sigue emitiendo el SQL de siempre.
--
-- Esta migración también se auto-aplica al arrancar el backend
-- (src/config/migrations.js). Escribir el .sql y olvidar el runner deja el
-- despliegue con el código nuevo contra una base vieja — ya pasó con
-- `abonos_remision`.
--
-- ── Qué contiene una ubicación ───────────────────────────────────────────────
-- CUALQUIER MEZCLA de nodos, y de productos distintos: el "Cajón B7" tiene la
-- correa talla 38MM (una variante) y los estuches (un producto entero) a la vez.
-- Por eso la asignación es una tabla puente con cinco FK nullable y un CHECK de
-- exactamente una — el mismo patrón de `abonos_remision`, que apunta a un envío
-- O a un cargo. Se prefiere sobre una FK polimórfica (tipo, item_id) porque
-- conserva las claves foráneas reales: borrar una variante borra su asignación
-- sola, sin dejar el mapa señalando a un nodo que ya no existe.
--
-- ── En qué NIVEL se asigna ───────────────────────────────────────────────────
-- En el que el usuario necesite. El código escaneable ya tuvo que bajar del
-- producto a los tres niveles del árbol (20260823_codigo_variantes.sql) porque
-- lo que se escanea es la talla 38MM, no "la correa"; aquí pasa lo mismo, con
-- una diferencia que importa: una remisión MUEVE stock y por eso exige el nodo
-- hoja (VARIANTE_REQUERIDA), mientras que la ubicación solo DESCRIBE. "Toda la
-- correa está en el Estante A" es verdad y es útil, y no descuadra nada. Así
-- que se asigna en cualquier nivel y se resuelve HACIA ABAJO: si el nodo no
-- dice dónde está, hereda del padre. Lo mismo con los seriales — la referencia
-- da el valor por defecto y cada IMEI puede sobrescribirlo cuando el negocio
-- necesita ese detalle (vitrina vs. caja fuerte). Eso hace la granularidad
-- personalizable sin ningún interruptor nuevo.
--
-- CUIDADO con la consulta INVERSA: si la referencia está en Vitrina pero un
-- IMEI concreto se movió a Caja Fuerte, listar Vitrina tiene que EXCLUIR ese
-- IMEI, o el mismo equipo aparece en dos sitios a la vez. La regla es que la
-- asignación propia gana sobre la heredada, en las dos direcciones.
--
-- ── Lo que NO cambia ─────────────────────────────────────────────────────────
-- El stock sigue viviendo donde vive. La ubicación describe, no contabiliza:
-- `cantidad` nace y se queda en NULL ("todo el stock del nodo"). Repartir
-- unidades entre sitios convertiría el stock en un derivado y obligaría a que
-- ventas, compras, entradas, remisiones, ajustes, importación y traslados
-- decidieran de qué sitio sale cada unidad — más un invariante nuevo que se
-- rompe en silencio, exactamente como pasó cuando el stock bajó a las variantes
-- y la red interna siguió moviendo el nivel de arriba. Cuando el negocio pida
-- contar por sitio, la fase 2 es quitar los índices únicos de abajo y hacer un
-- backfill, no un rediseño.
-- ─────────────────────────────────────────────────────────────────────────────

-- Idempotente y necesario aquí: el backfill del final lee estas columnas, y
-- este archivo se puede correr suelto sin haber pasado por 20260730.
ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS ubicacion TEXT;
ALTER TABLE IF EXISTS productos_serial   ADD COLUMN IF NOT EXISTS ubicacion TEXT;

-- ── La ubicación ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ubicaciones (
  id           BIGSERIAL PRIMARY KEY,
  sucursal_id  INTEGER NOT NULL REFERENCES sucursales(id),

  -- Jerarquía sin tablas nuevas: Bodega A → Estante 1 → Nivel 2 → Bin 3.
  -- Agregar un nivel es una fila más, no un cambio de estructura. La
  -- profundidad máxima y la guarda anti-ciclo las impone el service: no son
  -- expresables como constraint, igual que la unicidad del código entre los
  -- tres niveles del árbol de variantes.
  padre_id     BIGINT REFERENCES ubicaciones(id),

  nombre       TEXT NOT NULL,

  -- Etiqueta VISUAL (icono y color en el mapa), nunca comportamiento. En cuanto
  -- el tipo decide reglas, agregar "contenedor rodante" o "nevera" exige tocar
  -- código, que es lo contrario de lo que se pidió.
  tipo         TEXT,
  descripcion  TEXT,

  -- Geometría del mapa, OPCIONAL. En unidades relativas 0..1000 sobre el lienzo
  -- del padre, NUNCA píxeles: la misma bodega se ve en un celular de 360px y en
  -- un monitor, y guardar píxeles ata el mapa al aparato donde se dibujó.
  -- NULL = todavía sin dibujar; la pantalla la acomoda en cuadrícula. Que el
  -- mapa sea opcional es lo que permite usar ubicaciones desde el primer día.
  pos_x  NUMERIC,
  pos_y  NUMERIC,
  ancho  NUMERIC,
  alto   NUMERIC,
  color  TEXT,

  orden      INTEGER   DEFAULT 0,
  activo     BOOLEAN   DEFAULT TRUE,
  creado_en  TIMESTAMP DEFAULT NOW(),
  usuario_id INTEGER
);

-- Dos trampas en este índice, las dos ya mordieron:
--
-- 1. En Postgres NULL <> NULL, así que un índice único sobre `padre_id` a secas
--    NO agrupa las raíces y "Bodega A" se podría crear dos veces en el primer
--    nivel. El COALESCE es obligatorio, no cosmético.
--
-- 2. BTRIM quita los espacios de los EXTREMOS, no los de dentro: "Estante  A-3"
--    (dos espacios) y "Estante A-3" siguen siendo distintos para él. Pero
--    `utils/ubicacion.util.js` —que normaliza TODA escritura del módulo— sí los
--    colapsa. Con solo BTRIM aquí, el backfill podía crear un sitio cuyo nombre
--    la propia API es incapaz de reproducir, y el índice no lo veía duplicado.
--    Se colapsa con la clase POSIX [[:space:]] en vez de \s a propósito: este
--    mismo SQL vive replicado dentro de un template literal de JavaScript, y
--    ahí `\s` se come la barra invertida antes de llegar a Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ubicaciones_nombre
  ON ubicaciones (
    sucursal_id,
    COALESCE(padre_id, 0),
    LOWER(REGEXP_REPLACE(BTRIM(nombre), '[[:space:]]+', ' ', 'g'))
  )
  WHERE activo;

CREATE INDEX IF NOT EXISTS idx_ubicaciones_sucursal
  ON ubicaciones (sucursal_id) WHERE activo;

CREATE INDEX IF NOT EXISTS idx_ubicaciones_padre
  ON ubicaciones (padre_id) WHERE padre_id IS NOT NULL;

-- ── La asignación ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ubicaciones_items (
  id           BIGSERIAL PRIMARY KEY,
  ubicacion_id BIGINT NOT NULL REFERENCES ubicaciones(id) ON DELETE CASCADE,

  -- Exactamente una de las cinco. Los tres niveles del árbol por cantidad, la
  -- referencia con IMEI y la unidad suelta.
  producto_cantidad_id INTEGER REFERENCES productos_cantidad(id) ON DELETE CASCADE,
  atributo_id          INTEGER REFERENCES atributos_producto(id) ON DELETE CASCADE,
  variante_id          INTEGER REFERENCES variantes_atributo(id) ON DELETE CASCADE,
  producto_serial_id   INTEGER REFERENCES productos_serial(id)   ON DELETE CASCADE,
  serial_id            INTEGER REFERENCES seriales(id)           ON DELETE CASCADE,

  -- NULL = todo el stock del nodo. Fase 1: SIEMPRE NULL. Ver la cabecera.
  cantidad       INTEGER,

  usuario_id     INTEGER,
  actualizado_en TIMESTAMP DEFAULT NOW(),

  CONSTRAINT ubicaciones_items_uno_chk CHECK (
    (producto_cantidad_id IS NOT NULL)::int +
    (atributo_id          IS NOT NULL)::int +
    (variante_id          IS NOT NULL)::int +
    (producto_serial_id   IS NOT NULL)::int +
    (serial_id            IS NOT NULL)::int = 1
  )
);

-- La consulta caliente es "qué hay en esta ubicación".
CREATE INDEX IF NOT EXISTS idx_ubicaciones_items_ubicacion
  ON ubicaciones_items (ubicacion_id);

-- Fase 1: un nodo, un sitio. Un índice por columna — el CHECK polimórfico no
-- admite uno compuesto. QUITAR ESTOS CINCO es lo que abre la fase 2 (cantidad
-- por ubicación); no hace falta tocar nada más del modelo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ubicaciones_items_producto_cantidad
  ON ubicaciones_items (producto_cantidad_id) WHERE producto_cantidad_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ubicaciones_items_atributo
  ON ubicaciones_items (atributo_id)          WHERE atributo_id          IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ubicaciones_items_variante
  ON ubicaciones_items (variante_id)          WHERE variante_id          IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ubicaciones_items_producto_serial
  ON ubicaciones_items (producto_serial_id)   WHERE producto_serial_id   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ubicaciones_items_serial
  ON ubicaciones_items (serial_id)            WHERE serial_id            IS NOT NULL;

-- ── Backfill desde el texto libre ────────────────────────────────────────────
--
-- Usa EXACTAMENTE el mismo criterio que el catálogo derivado de hoy (agrupar
-- por LOWER(BTRIM(...)) y mostrar la grafía más usada con MODE): lo que el
-- usuario ve esta tarde en el desplegable "Todas las ubicaciones" es el
-- conjunto de tarjetas que encuentra mañana. Sin sitios nuevos ni perdidos.
--
-- CORRE UNA SOLA VEZ POR SUCURSAL, y la condición es "esta sucursal todavía no
-- tiene ninguna ubicación". Sin esa guarda, un negocio que renombre "Estante
-- A-3" volvería a ver aparecer el nombre viejo en cada arranque (las columnas
-- TEXT siguen diciendo lo de antes), y peor: un producto que alguien quitó de
-- una ubicación a propósito volvería solo. Una migración de datos que se pelea
-- con las decisiones del usuario es peor que no tenerla.
--
-- Todo en UNA sentencia con CTEs que escriben: así las dos asignaciones ven las
-- ubicaciones recién creadas y la atomicidad es del motor, no del orden.

-- La normalización es la MISMA que aplica `utils/ubicacion.util.js` a toda
-- escritura del módulo (recortar extremos y colapsar espacios internos). Si no
-- coincidieran, el backfill sembraría nombres que la API no sabe reproducir.
WITH nuevas AS (
  INSERT INTO ubicaciones (sucursal_id, nombre)
  SELECT
    t.sucursal_id,
    REGEXP_REPLACE(BTRIM(MODE() WITHIN GROUP (ORDER BY t.ubicacion)), '[[:space:]]+', ' ', 'g')
  FROM (
    SELECT sucursal_id, ubicacion FROM productos_cantidad
     WHERE activo = true AND BTRIM(COALESCE(ubicacion, '')) <> ''
    UNION ALL
    SELECT sucursal_id, ubicacion FROM productos_serial
     WHERE BTRIM(COALESCE(ubicacion, '')) <> ''
  ) t
  WHERE NOT EXISTS (
    SELECT 1 FROM ubicaciones u WHERE u.sucursal_id = t.sucursal_id
  )
  GROUP BY t.sucursal_id, LOWER(REGEXP_REPLACE(BTRIM(t.ubicacion), '[[:space:]]+', ' ', 'g'))
  ON CONFLICT DO NOTHING
  RETURNING id, sucursal_id, nombre
),
asignar_cantidad AS (
  INSERT INTO ubicaciones_items (ubicacion_id, producto_cantidad_id)
  SELECT n.id, pc.id
  FROM productos_cantidad pc
  JOIN nuevas n
    ON n.sucursal_id = pc.sucursal_id
   AND LOWER(REGEXP_REPLACE(BTRIM(n.nombre),      '[[:space:]]+', ' ', 'g'))
     = LOWER(REGEXP_REPLACE(BTRIM(pc.ubicacion), '[[:space:]]+', ' ', 'g'))
  WHERE pc.activo = true AND BTRIM(COALESCE(pc.ubicacion, '')) <> ''
  ON CONFLICT DO NOTHING
  RETURNING 1
)
INSERT INTO ubicaciones_items (ubicacion_id, producto_serial_id)
SELECT n.id, ps.id
FROM productos_serial ps
JOIN nuevas n
  ON n.sucursal_id = ps.sucursal_id
 AND LOWER(REGEXP_REPLACE(BTRIM(n.nombre),      '[[:space:]]+', ' ', 'g'))
   = LOWER(REGEXP_REPLACE(BTRIM(ps.ubicacion), '[[:space:]]+', ' ', 'g'))
WHERE BTRIM(COALESCE(ps.ubicacion, '')) <> ''
ON CONFLICT DO NOTHING;

-- Rollback manual (si algún día se necesita). Basta apagar `ubicacion_activa`
-- para que la feature desaparezca de la vista sin perder nada:
--   DROP TABLE IF EXISTS ubicaciones_items;
--   DROP TABLE IF EXISTS ubicaciones;
-- Las columnas TEXT de 20260730 siguen intactas, así que el modelo viejo
-- vuelve a funcionar tal cual estaba.
