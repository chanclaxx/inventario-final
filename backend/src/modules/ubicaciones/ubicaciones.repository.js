const { pool } = require('../../config/db');
const { hayUbicacion, hayUbicaciones, hayMovimientosUbicacion } = require('../../config/columnas');

// ─────────────────────────────────────────────────────────────────────────────
// UBICACIONES — la ubicación es una fila, los productos se le cuelgan
//
// Ver migrations/20260831_ubicaciones_estructura.sql para el porqué del modelo.
// Aquí solo hace falta recordar tres reglas, que son las que explican cada
// consulta de este archivo:
//
//   1. Una ubicación contiene CUALQUIER MEZCLA de nodos y de productos
//      distintos: el "Cajón B7" tiene la correa talla 38MM (una variante) y los
//      estuches (un producto entero). Por eso el listado es un UNION ALL de
//      cinco ramas y no una consulta sobre una tabla de productos.
//
//   2. La asignación PROPIA gana sobre la HEREDADA, en las dos direcciones. Si
//      la referencia "iPhone 13" está en Vitrina y un IMEI concreto se movió a
//      Caja Fuerte, listar Vitrina tiene que EXCLUIR ese IMEI o el mismo equipo
//      aparece en dos sitios a la vez.
//
//   3. Este módulo NO SELECCIONA NINGÚN COSTO. Una ubicación dice dónde está la
//      mercancía, no cuánto costó, así que queda fuera del alcance de
//      `costos_solo_admin` sin necesitar recorte propio — igual que las
//      etiquetas. Si alguna vez hace falta el costo aquí, tiene que pasar por
//      `recortarSiToca` ANTES de salir: pintarlo solo en pantalla deja el dato
//      viajando en el JSON, visible desde la consola del navegador.
//
// El `precio` sí viaja: es precio de venta, no costo, y es lo que el bodeguero
// necesita para reconocer lo que tiene en la mano.
// ─────────────────────────────────────────────────────────────────────────────

// ── Catálogo plano (COMPATIBILIDAD) ──────────────────────────────────────────
//
// Sigue devolviendo [{ ubicacion, productos }], que es lo que consumen
// `InputUbicacion` (autocompletado) y el desplegable "Todas las ubicaciones"
// del inventario. Esas pantallas NO se tocan en este despliegue, así que esta
// forma no puede cambiar.
//
// Lee de las DOS fuentes y las mezcla: las ubicaciones nuevas y —solo si no
// tienen ya una fila equivalente— los valores de texto que quedaron en las
// columnas de 20260730. Con eso, un negocio cuyo backfill no haya corrido
// todavía sigue viendo exactamente sus sugerencias de siempre. Es la lectura
// dual que permite invertir el modelo sin tocar ninguna pantalla el día del
// despliegue.

const _catalogoLegacy = async (sucursalId, negocioId) => {
  // Sin la columna en la BD no hay catálogo legado posible: lista vacía, sin
  // error. El autocompletado simplemente no sugiere de esta fuente.
  if (!hayUbicacion()) return [];

  const { rows } = await pool.query(`
    WITH todas AS (
      SELECT pc.ubicacion
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE pc.sucursal_id = $1
        AND su.negocio_id  = $2
        AND pc.activo      = true
        AND BTRIM(COALESCE(pc.ubicacion, '')) <> ''

      UNION ALL

      SELECT ps.ubicacion
      FROM productos_serial ps
      JOIN sucursales su ON su.id = ps.sucursal_id
      WHERE ps.sucursal_id = $1
        AND su.negocio_id  = $2
        AND BTRIM(COALESCE(ps.ubicacion, '')) <> ''
    )
    SELECT
      MODE() WITHIN GROUP (ORDER BY ubicacion) AS ubicacion,
      COUNT(*)::int                            AS productos
    FROM todas
    GROUP BY LOWER(BTRIM(ubicacion))
    ORDER BY 1
  `, [sucursalId, negocioId]);

  return rows;
};

// Conteo por ubicación en UNA agregación, nunca con una subconsulta
// correlacionada por fila: la base la comparten 28 negocios y ya hubo un caso
// donde una correlacionada se comió el 96 % del CPU.
const _catalogoNuevo = async (sucursalId, negocioId) => {
  if (!hayUbicaciones()) return [];

  const { rows } = await pool.query(`
    SELECT u.nombre AS ubicacion, COALESCE(c.items, 0)::int AS productos
    FROM ubicaciones u
    JOIN sucursales su ON su.id = u.sucursal_id
    LEFT JOIN (
      SELECT ubicacion_id, COUNT(*)::int AS items
      FROM ubicaciones_items
      GROUP BY ubicacion_id
    ) c ON c.ubicacion_id = u.id
    WHERE u.sucursal_id = $1
      AND su.negocio_id  = $2
      AND u.activo       = true
    ORDER BY u.nombre
  `, [sucursalId, negocioId]);

  return rows;
};

const listarCatalogo = async (sucursalId, negocioId) => {
  const [nuevas, legado] = await Promise.all([
    _catalogoNuevo(sucursalId, negocioId),
    _catalogoLegacy(sucursalId, negocioId),
  ]);

  // La fila real manda sobre el texto suelto: si "Estante A-3" ya existe como
  // ubicación, su conteo es el bueno y el del texto sobra.
  //
  // La clave colapsa los espacios INTERNOS, no solo los de los extremos: el
  // texto legado trae grafías como "Estante  A-3 " que la fila nueva ya guardó
  // normalizada, y comparando con un simple trim se colarían las dos como
  // sitios distintos — que es justo lo que este rediseño viene a cerrar. Es la
  // misma normalización de utils/ubicacion.util.js y del backfill.
  const clave = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const vistas = new Set(nuevas.map((u) => clave(u.ubicacion)));

  return [...nuevas, ...legado.filter((u) => !vistas.has(clave(u.ubicacion)))]
    .sort((a, b) => String(a.ubicacion).localeCompare(String(b.ubicacion), 'es'));
};

// ── Árbol de ubicaciones de la sucursal ──────────────────────────────────────
//
// Devuelve la lista PLANA con el conteo directo de cada una; el service la
// arma en árbol y suma los descendientes. Se resuelve en JS y no con un
// WITH RECURSIVE porque la lista de sitios de una sucursal es corta por
// naturaleza (son lugares físicos) y así el conteo agregado sigue siendo una
// sola pasada.

const listarArbol = async (sucursalId, negocioId) => {
  if (!hayUbicaciones()) return [];

  const { rows } = await pool.query(`
    SELECT
      u.id, u.padre_id, u.nombre, u.tipo, u.descripcion,
      u.pos_x, u.pos_y, u.ancho, u.alto, u.color, u.orden, u.creado_en,
      COALESCE(c.items, 0)::int AS items
    FROM ubicaciones u
    JOIN sucursales su ON su.id = u.sucursal_id
    LEFT JOIN (
      SELECT ubicacion_id, COUNT(*)::int AS items
      FROM ubicaciones_items
      GROUP BY ubicacion_id
    ) c ON c.ubicacion_id = u.id
    WHERE u.sucursal_id = $1
      AND su.negocio_id  = $2
      AND u.activo       = true
    ORDER BY u.orden, LOWER(u.nombre)
  `, [sucursalId, negocioId]);

  return rows;
};

// ── Una ubicación, validando que sea del negocio ─────────────────────────────
// Todo lo que recibe un :id pasa primero por aquí. Así el resto de las
// consultas puede tomar `ubicacion_id` a secas sin volver a unir `sucursales`.

const getById = async (id, negocioId) => {
  if (!hayUbicaciones()) return null;

  const { rows } = await pool.query(`
    SELECT
      u.id, u.sucursal_id, u.padre_id, u.nombre, u.tipo, u.descripcion,
      u.pos_x, u.pos_y, u.ancho, u.alto, u.color, u.orden, u.activo, u.creado_en,
      su.nombre AS sucursal_nombre
    FROM ubicaciones u
    JOIN sucursales su ON su.id = u.sucursal_id
    WHERE u.id = $1 AND su.negocio_id = $2
  `, [id, negocioId]);

  return rows[0] || null;
};

// Migas de pan: Sucursal › Bodega A › Estante 1. Una animación dice cómo
// llegaste, no dónde estás.
const getRuta = async (id) => {
  const { rows } = await pool.query(`
    WITH RECURSIVE ruta AS (
      SELECT id, padre_id, nombre, 0 AS nivel
      FROM ubicaciones WHERE id = $1
      UNION ALL
      SELECT u.id, u.padre_id, u.nombre, r.nivel + 1
      FROM ubicaciones u
      JOIN ruta r ON r.padre_id = u.id
    )
    SELECT id, nombre FROM ruta ORDER BY nivel DESC
  `, [id]);

  return rows;
};

// Los descendientes de una ubicación, ella incluida. Sostiene dos cosas: la
// guarda anti-ciclo al mover de padre (nadie puede colgar de su propia hija) y
// el conteo "esta bodega tiene N cosas contando sus estantes".
const getDescendientes = async (id) => {
  const { rows } = await pool.query(`
    WITH RECURSIVE descendientes AS (
      SELECT id FROM ubicaciones WHERE id = $1
      UNION ALL
      SELECT u.id FROM ubicaciones u
      JOIN descendientes d ON u.padre_id = d.id
    )
    SELECT id FROM descendientes
  `, [id]);

  return rows.map((r) => Number(r.id));
};

// ── Escritura ────────────────────────────────────────────────────────────────

const crear = async ({ sucursal_id, padre_id, nombre, tipo, descripcion, color, orden, usuario_id }) => {
  const { rows } = await pool.query(`
    INSERT INTO ubicaciones (sucursal_id, padre_id, nombre, tipo, descripcion, color, orden, usuario_id)
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0), $8)
    RETURNING *
  `, [sucursal_id, padre_id ?? null, nombre, tipo ?? null, descripcion ?? null,
      color ?? null, orden ?? null, usuario_id ?? null]);

  return rows[0];
};

// Semántica de tres estados por campo, igual que `codigo`, `nota` y la propia
// `ubicacion` de 20260730:
//   undefined → no tocar (un cliente que no envía el campo no lo borra)
//   null / '' → limpiar
//   valor     → escribir
// El `CASE WHEN $n::boolean` es lo que distingue "no vino" de "vino vacío".
const actualizar = async (id, campos) => {
  const { rows } = await pool.query(`
    UPDATE ubicaciones SET
      nombre      = CASE WHEN $2::boolean  THEN $3  ELSE nombre      END,
      tipo        = CASE WHEN $4::boolean  THEN $5  ELSE tipo        END,
      descripcion = CASE WHEN $6::boolean  THEN $7  ELSE descripcion END,
      color       = CASE WHEN $8::boolean  THEN $9  ELSE color       END,
      orden       = CASE WHEN $10::boolean THEN $11 ELSE orden       END,
      padre_id    = CASE WHEN $12::boolean THEN $13 ELSE padre_id    END
    WHERE id = $1
    RETURNING *
  `, [
    id,
    campos.nombre      !== undefined, campos.nombre      ?? null,
    campos.tipo        !== undefined, campos.tipo        ?? null,
    campos.descripcion !== undefined, campos.descripcion ?? null,
    campos.color       !== undefined, campos.color       ?? null,
    campos.orden       !== undefined, campos.orden       ?? null,
    campos.padre_id    !== undefined, campos.padre_id    ?? null,
  ]);

  return rows[0] || null;
};

// Baja LÓGICA. Nunca un DELETE: una ubicación con historia detrás es un sitio
// real de un negocio real, y el CASCADE de `ubicaciones_items` desasignaría su
// contenido en silencio. El service exige vaciarla antes.
const desactivar = async (id) => {
  const { rows } = await pool.query(
    `UPDATE ubicaciones SET activo = false WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows[0] || null;
};

// Geometría en lote: se guarda al SOLTAR en el editor, no por píxel arrastrado.
// El UPDATE ... FROM (VALUES ...) hace las N filas en un solo viaje.
const guardarGeometria = async (sucursalId, negocioId, posiciones) => {
  if (!posiciones.length) return 0;

  const valores = posiciones
    .map((_, i) => `($${i * 5 + 3}::bigint, $${i * 5 + 4}::numeric, $${i * 5 + 5}::numeric, $${i * 5 + 6}::numeric, $${i * 5 + 7}::numeric)`)
    .join(', ');

  const params = [sucursalId, negocioId];
  for (const p of posiciones) {
    params.push(p.id, p.pos_x ?? null, p.pos_y ?? null, p.ancho ?? null, p.alto ?? null);
  }

  // El WHERE re-valida sucursal y negocio en la misma sentencia: el id de una
  // ubicación ajena simplemente no actualiza nada, sin necesidad de una consulta
  // de comprobación aparte que además dejaría una ventana entre leer y escribir.
  const { rowCount } = await pool.query(`
    UPDATE ubicaciones u
    SET pos_x = v.pos_x, pos_y = v.pos_y, ancho = v.ancho, alto = v.alto
    FROM (VALUES ${valores}) AS v(id, pos_x, pos_y, ancho, alto)
    WHERE u.id = v.id
      AND u.sucursal_id = $1
      AND EXISTS (
        SELECT 1 FROM sucursales su
        WHERE su.id = u.sucursal_id AND su.negocio_id = $2
      )
  `, params);

  return rowCount;
};

// ── Contenido de una ubicación ───────────────────────────────────────────────
//
// Cinco ramas unidas por UNION ALL, una por tipo de nodo. Se castea el tipo de
// TODAS las columnas en la primera rama y se respeta el orden en las demás: un
// UNION con NULLs sin castear ya tumbó una pantalla entera antes
// (`UNION types bytea and text cannot be matched`).
//
// `parcial` responde "parte de esto no está realmente aquí": el nodo está
// asignado a esta ubicación pero alguno de sus hijos tiene asignación propia en
// OTRO sitio. Es la mitad visible de la regla 2 de la cabecera — la otra mitad,
// la que de verdad evita contar dos veces, es el NOT EXISTS del stock de la
// rama de referencias.

const SQL_ITEMS = `
  -- 1. Producto por cantidad (sin variantes, o con variantes que lo siguen)
  SELECT
    ui.id                                        AS item_id,
    'cantidad'::text                             AS tipo,
    'producto'::text                             AS nivel,
    pc.id::int                                   AS nodo_id,
    pc.id::int                                   AS producto_id,
    pc.nombre::text                              AS nombre,
    NULL::text                                   AS detalle,
    pc.codigo::text                              AS codigo,
    NULL::text                                   AS imei,
    COALESCE(pc.stock, 0)::int                   AS stock,
    COALESCE(pc.stock_minimo, 0)::int            AS stock_minimo,
    pc.precio::numeric                           AS precio,
    (CASE WHEN COALESCE(pc.stock, 0) <= 0                          THEN 'agotado'
          WHEN COALESCE(pc.stock, 0) <= COALESCE(pc.stock_minimo, 0) THEN 'bajo'
          ELSE 'ok' END)::text                   AS estado,
    EXISTS (
      SELECT 1 FROM atributos_producto ap2
      JOIN ubicaciones_items ui2 ON ui2.atributo_id = ap2.id
      WHERE ap2.producto_id = pc.id AND ap2.activo = true
        AND ui2.ubicacion_id <> ui.ubicacion_id
      UNION ALL
      SELECT 1 FROM variantes_atributo va2
      JOIN atributos_producto ap3 ON ap3.id = va2.atributo_id
      JOIN ubicaciones_items ui3 ON ui3.variante_id = va2.id
      WHERE ap3.producto_id = pc.id AND va2.activo = true
        AND ui3.ubicacion_id <> ui.ubicacion_id
    )                                            AS parcial,
    ui.actualizado_en                            AS actualizado_en
  FROM ubicaciones_items ui
  JOIN productos_cantidad pc ON pc.id = ui.producto_cantidad_id
  WHERE ui.ubicacion_id = $1 AND pc.activo = true

  UNION ALL

  -- 2. Atributo (la talla 38MM de la correa)
  SELECT
    ui.id, 'cantidad'::text, 'atributo'::text,
    ap.id::int, ap.producto_id::int,
    pc.nombre::text,
    (COALESCE(tc.nombre || ': ', '') || ap.valor)::text,
    COALESCE(ap.codigo, pc.codigo)::text,
    NULL::text,
    COALESCE(ap.stock, 0)::int,
    COALESCE(ap.stock_minimo, 0)::int,
    COALESCE(ap.precio, pc.precio)::numeric,
    (CASE WHEN COALESCE(ap.stock, 0) <= 0                            THEN 'agotado'
          WHEN COALESCE(ap.stock, 0) <= COALESCE(ap.stock_minimo, 0) THEN 'bajo'
          ELSE 'ok' END)::text,
    EXISTS (
      SELECT 1 FROM variantes_atributo va2
      JOIN ubicaciones_items ui2 ON ui2.variante_id = va2.id
      WHERE va2.atributo_id = ap.id AND va2.activo = true
        AND ui2.ubicacion_id <> ui.ubicacion_id
    ),
    ui.actualizado_en
  FROM ubicaciones_items ui
  JOIN atributos_producto ap ON ap.id = ui.atributo_id
  JOIN productos_cantidad pc ON pc.id = ap.producto_id
  LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
  WHERE ui.ubicacion_id = $1 AND ap.activo = true

  UNION ALL

  -- 3. Variante (el color Negro dentro de la talla 38MM)
  SELECT
    ui.id, 'cantidad'::text, 'variante'::text,
    va.id::int, ap.producto_id::int,
    pc.nombre::text,
    (COALESCE(tca.nombre || ': ', '') || ap.valor || ' · '
      || COALESCE(tcv.nombre || ': ', '') || va.valor)::text,
    COALESCE(va.codigo, ap.codigo, pc.codigo)::text,
    NULL::text,
    COALESCE(va.stock, 0)::int,
    COALESCE(va.stock_minimo, 0)::int,
    COALESCE(va.precio, ap.precio, pc.precio)::numeric,
    (CASE WHEN COALESCE(va.stock, 0) <= 0                            THEN 'agotado'
          WHEN COALESCE(va.stock, 0) <= COALESCE(va.stock_minimo, 0) THEN 'bajo'
          ELSE 'ok' END)::text,
    false,
    ui.actualizado_en
  FROM ubicaciones_items ui
  JOIN variantes_atributo va ON va.id = ui.variante_id
  JOIN atributos_producto ap ON ap.id = va.atributo_id
  JOIN productos_cantidad pc ON pc.id = ap.producto_id
  LEFT JOIN tipos_caracteristica tca ON tca.id = ap.tipo_id
  LEFT JOIN tipos_caracteristica tcv ON tcv.id = va.tipo_id
  WHERE ui.ubicacion_id = $1 AND va.activo = true

  UNION ALL

  -- 4. Referencia con IMEI. El stock que se muestra son las unidades que
  --    HEREDAN de la referencia: las que tienen asignación propia salen como
  --    su propia fila (aquí o en otro sitio), y contarlas otra vez pondría el
  --    mismo equipo en dos ubicaciones a la vez.
  SELECT
    ui.id, 'serial'::text, 'referencia'::text,
    ps.id::int, ps.id::int,
    ps.nombre::text,
    NULLIF(BTRIM(COALESCE(ps.marca, '') || ' ' || COALESCE(ps.modelo, '')), '')::text,
    NULL::text,
    NULL::text,
    (SELECT COUNT(*) FROM seriales s2
      WHERE s2.producto_id = ps.id
        AND s2.vendido  = false
        AND s2.prestado = false
        AND NOT EXISTS (SELECT 1 FROM ubicaciones_items uix WHERE uix.serial_id = s2.id)
    )::int,
    0::int,
    ps.precio::numeric,
    (CASE WHEN (SELECT COUNT(*) FROM seriales s3
                 WHERE s3.producto_id = ps.id
                   AND s3.vendido = false AND s3.prestado = false
                   AND NOT EXISTS (SELECT 1 FROM ubicaciones_items uiy WHERE uiy.serial_id = s3.id)) = 0
          THEN 'agotado' ELSE 'ok' END)::text,
    EXISTS (
      SELECT 1 FROM seriales s4
      JOIN ubicaciones_items ui4 ON ui4.serial_id = s4.id
      WHERE s4.producto_id = ps.id AND ui4.ubicacion_id <> ui.ubicacion_id
    ),
    ui.actualizado_en
  FROM ubicaciones_items ui
  JOIN productos_serial ps ON ps.id = ui.producto_serial_id
  WHERE ui.ubicacion_id = $1

  UNION ALL

  -- 5. Unidad suelta: este IMEI vive aquí, diga lo que diga su referencia.
  SELECT
    ui.id, 'serial'::text, 'unidad'::text,
    s.id::int, ps.id::int,
    ps.nombre::text,
    NULLIF(BTRIM(COALESCE(s.color, '')), '')::text,
    NULL::text,
    s.imei::text,
    1::int,
    0::int,
    ps.precio::numeric,
    (CASE WHEN s.vendido  THEN 'vendido'
          WHEN s.prestado THEN 'prestado'
          ELSE 'disponible' END)::text,
    false,
    ui.actualizado_en
  FROM ubicaciones_items ui
  JOIN seriales s          ON s.id  = ui.serial_id
  JOIN productos_serial ps ON ps.id = s.producto_id
  WHERE ui.ubicacion_id = $1
`;

const listarItems = async (ubicacionId, { q = null, limit = 200, offset = 0 } = {}) => {
  if (!hayUbicaciones()) return [];

  const { rows } = await pool.query(`
    SELECT * FROM (${SQL_ITEMS}) x
    WHERE ($2::text IS NULL
       OR x.nombre  ILIKE '%' || $2 || '%'
       OR x.detalle ILIKE '%' || $2 || '%'
       OR x.codigo  ILIKE '%' || $2 || '%'
       OR x.imei    ILIKE '%' || $2 || '%')
    ORDER BY x.nombre, x.detalle NULLS FIRST, x.item_id
    LIMIT $3 OFFSET $4
  `, [ubicacionId, q, limit, offset]);

  return rows;
};

const contarItems = async (ubicacionId) => {
  if (!hayUbicaciones()) return 0;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ubicaciones_items WHERE ubicacion_id = $1`,
    [ubicacionId]
  );
  return rows[0]?.total ?? 0;
};

const contarHijasActivas = async (ubicacionId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ubicaciones WHERE padre_id = $1 AND activo = true`,
    [ubicacionId]
  );
  return rows[0]?.total ?? 0;
};

// ── Sin asignar — la bandeja de entrada ──────────────────────────────────────
//
// Un negocio que enciende esto tiene cientos de nodos sin sitio y nadie los va a
// escribir a mano. Si esta lista no existe, el mapa queda decorativo: es el
// mismo papel que cumple la generación masiva de códigos en las etiquetas.
//
// Solo se listan nodos HOJA sin ubicación propia NI heredada. Un producto con
// atributos activos es un contenedor —"la correa" no está en el estante,
// están la 38MM y la 42MM—, así que aparece por sus hojas, no por sí mismo.
// Las unidades con IMEI tampoco aparecen: heredan de su referencia, y solo se
// separan cuando el negocio decide bajar a ese detalle.

const listarSinAsignar = async (sucursalId, negocioId, { q = null, limit = 200, offset = 0 } = {}) => {
  if (!hayUbicaciones()) return [];

  const { rows } = await pool.query(`
    SELECT * FROM (
      -- Productos por cantidad sin atributos activos
      SELECT
        'cantidad'::text AS tipo, 'producto'::text AS nivel,
        pc.id::int AS nodo_id, pc.id::int AS producto_id,
        pc.nombre::text AS nombre, NULL::text AS detalle,
        pc.codigo::text AS codigo, NULL::text AS imei,
        COALESCE(pc.stock, 0)::int AS stock
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE pc.sucursal_id = $1 AND su.negocio_id = $2 AND pc.activo = true
        AND NOT EXISTS (SELECT 1 FROM atributos_producto a
                         WHERE a.producto_id = pc.id AND a.activo = true)
        AND NOT EXISTS (SELECT 1 FROM ubicaciones_items ui
                         WHERE ui.producto_cantidad_id = pc.id)

      UNION ALL

      -- Atributos sin variantes activas, cuyo producto tampoco tiene sitio
      SELECT
        'cantidad'::text, 'atributo'::text,
        ap.id::int, ap.producto_id::int,
        pc.nombre::text,
        (COALESCE(tc.nombre || ': ', '') || ap.valor)::text,
        COALESCE(ap.codigo, pc.codigo)::text, NULL::text,
        COALESCE(ap.stock, 0)::int
      FROM atributos_producto ap
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
      WHERE ap.sucursal_id = $1 AND su.negocio_id = $2
        AND ap.activo = true AND pc.activo = true
        AND NOT EXISTS (SELECT 1 FROM variantes_atributo v
                         WHERE v.atributo_id = ap.id AND v.activo = true)
        AND NOT EXISTS (SELECT 1 FROM ubicaciones_items ui WHERE ui.atributo_id = ap.id)
        AND NOT EXISTS (SELECT 1 FROM ubicaciones_items ui WHERE ui.producto_cantidad_id = pc.id)

      UNION ALL

      -- Variantes cuyo atributo y producto tampoco tienen sitio
      SELECT
        'cantidad'::text, 'variante'::text,
        va.id::int, ap.producto_id::int,
        pc.nombre::text,
        (COALESCE(tca.nombre || ': ', '') || ap.valor || ' · '
          || COALESCE(tcv.nombre || ': ', '') || va.valor)::text,
        COALESCE(va.codigo, ap.codigo, pc.codigo)::text, NULL::text,
        COALESCE(va.stock, 0)::int
      FROM variantes_atributo va
      JOIN atributos_producto ap ON ap.id = va.atributo_id
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      LEFT JOIN tipos_caracteristica tca ON tca.id = ap.tipo_id
      LEFT JOIN tipos_caracteristica tcv ON tcv.id = va.tipo_id
      WHERE ap.sucursal_id = $1 AND su.negocio_id = $2
        AND va.activo = true AND ap.activo = true AND pc.activo = true
        AND NOT EXISTS (SELECT 1 FROM ubicaciones_items ui WHERE ui.variante_id = va.id)
        AND NOT EXISTS (SELECT 1 FROM ubicaciones_items ui WHERE ui.atributo_id = ap.id)
        AND NOT EXISTS (SELECT 1 FROM ubicaciones_items ui WHERE ui.producto_cantidad_id = pc.id)

      UNION ALL

      -- Referencias con IMEI sin sitio (sus unidades heredan de ellas)
      SELECT
        'serial'::text, 'referencia'::text,
        ps.id::int, ps.id::int,
        ps.nombre::text,
        NULLIF(BTRIM(COALESCE(ps.marca, '') || ' ' || COALESCE(ps.modelo, '')), '')::text,
        NULL::text, NULL::text,
        (SELECT COUNT(*) FROM seriales s
          WHERE s.producto_id = ps.id AND s.vendido = false AND s.prestado = false)::int
      FROM productos_serial ps
      JOIN sucursales su ON su.id = ps.sucursal_id
      WHERE ps.sucursal_id = $1 AND su.negocio_id = $2
        AND NOT EXISTS (SELECT 1 FROM ubicaciones_items ui WHERE ui.producto_serial_id = ps.id)
    ) x
    WHERE ($3::text IS NULL
       OR x.nombre  ILIKE '%' || $3 || '%'
       OR x.detalle ILIKE '%' || $3 || '%'
       OR x.codigo  ILIKE '%' || $3 || '%')
    ORDER BY x.nombre, x.detalle NULLS FIRST
    LIMIT $4 OFFSET $5
  `, [sucursalId, negocioId, q, limit, offset]);

  return rows;
};

// ── "¿Dónde está esto?" — la pregunta inversa ────────────────────────────────
//
// El módulo entero se construyó para responder "¿qué hay en este estante?".
// Pero en una bodega grande la pregunta que más se hace es la contraria, y
// hasta ahora no tenía respuesta desde esta pantalla: había que recorrer el
// espacio a ojo.
//
// Devuelve nodos HOJA (lo que de verdad se va a buscar al estante) con su
// ubicación YA RESUELTA hacia arriba: si la talla 38MM no tiene sitio propio
// pero la correa sí, la respuesta es el sitio de la correa, marcada como
// heredada. Es la misma regla de herencia del resto del módulo, aplicada aquí
// para que la respuesta nunca sea "no sé".
//
// El nombre y la ruta de la ubicación NO se resuelven aquí: la pantalla ya
// tiene el árbol en memoria y los saca de ahí. Un WITH RECURSIVE por fila para
// pintar migas de pan sería justo el tipo de consulta correlacionada que ya se
// comió el 96 % del CPU de esta base una vez.

const SQL_UBI_PRODUCTO  = `(SELECT ui.ubicacion_id FROM ubicaciones_items ui
                             WHERE ui.producto_cantidad_id = pc.id)`;
const SQL_UBI_ATRIBUTO  = `(SELECT ui.ubicacion_id FROM ubicaciones_items ui
                             WHERE ui.atributo_id = ap.id)`;
const SQL_UBI_VARIANTE  = `(SELECT ui.ubicacion_id FROM ubicaciones_items ui
                             WHERE ui.variante_id = va.id)`;
const SQL_UBI_REFERENCIA = `(SELECT ui.ubicacion_id FROM ubicaciones_items ui
                             WHERE ui.producto_serial_id = ps.id)`;

const buscarNodos = async (sucursalId, negocioId, { q = null, limit = 40 } = {}) => {
  if (!hayUbicaciones() || !q) return [];

  const { rows } = await pool.query(`
    SELECT * FROM (
      -- Productos por cantidad sin atributos activos (el producto ES la hoja)
      SELECT
        'producto'::text AS nivel,
        pc.id::int AS nodo_id,
        pc.nombre::text AS nombre,
        NULL::text AS detalle,
        pc.codigo::text AS codigo,
        NULL::text AS imei,
        COALESCE(pc.stock, 0)::int AS stock,
        ${SQL_UBI_PRODUCTO} AS ubicacion_id,
        false AS heredada
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE pc.sucursal_id = $1 AND su.negocio_id = $2 AND pc.activo = true
        AND NOT EXISTS (SELECT 1 FROM atributos_producto a
                         WHERE a.producto_id = pc.id AND a.activo = true)

      UNION ALL

      -- Atributos sin variantes activas
      SELECT
        'atributo'::text, ap.id::int, pc.nombre::text,
        (COALESCE(tc.nombre || ': ', '') || ap.valor)::text,
        COALESCE(ap.codigo, pc.codigo)::text, NULL::text,
        COALESCE(ap.stock, 0)::int,
        COALESCE(${SQL_UBI_ATRIBUTO}, ${SQL_UBI_PRODUCTO}),
        ${SQL_UBI_ATRIBUTO} IS NULL
      FROM atributos_producto ap
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
      WHERE ap.sucursal_id = $1 AND su.negocio_id = $2
        AND ap.activo = true AND pc.activo = true
        AND NOT EXISTS (SELECT 1 FROM variantes_atributo v
                         WHERE v.atributo_id = ap.id AND v.activo = true)

      UNION ALL

      -- Variantes: la hoja de verdad cuando el catálogo va por talla y color
      SELECT
        'variante'::text, va.id::int, pc.nombre::text,
        (COALESCE(tca.nombre || ': ', '') || ap.valor || ' · '
          || COALESCE(tcv.nombre || ': ', '') || va.valor)::text,
        COALESCE(va.codigo, ap.codigo, pc.codigo)::text, NULL::text,
        COALESCE(va.stock, 0)::int,
        COALESCE(${SQL_UBI_VARIANTE}, ${SQL_UBI_ATRIBUTO}, ${SQL_UBI_PRODUCTO}),
        ${SQL_UBI_VARIANTE} IS NULL
      FROM variantes_atributo va
      JOIN atributos_producto ap ON ap.id = va.atributo_id
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      LEFT JOIN tipos_caracteristica tca ON tca.id = ap.tipo_id
      LEFT JOIN tipos_caracteristica tcv ON tcv.id = va.tipo_id
      WHERE ap.sucursal_id = $1 AND su.negocio_id = $2
        AND va.activo = true AND ap.activo = true AND pc.activo = true

      UNION ALL

      -- Referencias con IMEI
      SELECT
        'referencia'::text, ps.id::int, ps.nombre::text,
        NULLIF(BTRIM(COALESCE(ps.marca, '') || ' ' || COALESCE(ps.modelo, '')), '')::text,
        NULL::text, NULL::text,
        (SELECT COUNT(*) FROM seriales s
          WHERE s.producto_id = ps.id AND s.vendido = false AND s.prestado = false)::int,
        ${SQL_UBI_REFERENCIA},
        false
      FROM productos_serial ps
      JOIN sucursales su ON su.id = ps.sucursal_id
      WHERE ps.sucursal_id = $1 AND su.negocio_id = $2

      UNION ALL

      -- Unidades sueltas. Solo salen las que tienen sitio PROPIO o cuyo IMEI
      -- coincide: listar los 300 equipos de una referencia al buscar su nombre
      -- enterraría el resultado que se busca.
      SELECT
        'unidad'::text, s.id::int, ps.nombre::text,
        NULLIF(BTRIM(COALESCE(s.color, '')), '')::text,
        NULL::text, s.imei::text,
        1::int,
        COALESCE((SELECT ui.ubicacion_id FROM ubicaciones_items ui WHERE ui.serial_id = s.id),
                 ${SQL_UBI_REFERENCIA}),
        (SELECT ui.ubicacion_id FROM ubicaciones_items ui WHERE ui.serial_id = s.id) IS NULL
      FROM seriales s
      JOIN productos_serial ps ON ps.id = s.producto_id
      JOIN sucursales su ON su.id = ps.sucursal_id
      WHERE ps.sucursal_id = $1 AND su.negocio_id = $2
        AND s.vendido = false AND s.prestado = false
        AND (s.imei ILIKE '%' || $3 || '%'
             OR EXISTS (SELECT 1 FROM ubicaciones_items ui WHERE ui.serial_id = s.id))
    ) x
    WHERE x.nombre  ILIKE '%' || $3 || '%'
       OR x.detalle ILIKE '%' || $3 || '%'
       OR x.codigo  ILIKE '%' || $3 || '%'
       OR x.imei    ILIKE '%' || $3 || '%'
    -- Lo que tiene sitio primero: quien busca "¿dónde está?" quiere una
    -- respuesta, no una lista de cosas que tampoco están ubicadas.
    ORDER BY (x.ubicacion_id IS NULL), x.nombre, x.detalle NULLS FIRST
    LIMIT $4
  `, [sucursalId, negocioId, q, limit]);

  return rows;
};

// ── Dónde está cada cosa de una lista (ruta de recogida) ─────────────────────
//
// Igual que el buscador, pero por IDS en vez de por texto: la lista ya existe
// (el carrito de una venta, un préstamo, un traslado) y lo único que falta es
// dónde ir a buscar cada línea.
//
// Una consulta por NIVEL presente, no una por línea: un carrito de 30 ítems son
// como mucho 5 consultas, no 30. La base la comparten 28 negocios.
//
// El ORDEN del recorrido NO se calcula aquí: la pantalla ya tiene el árbol con
// su jerarquía y su geometría, y agrupar es cosa suya. Aquí solo se responde
// "¿dónde está?", con la misma herencia hacia arriba que el buscador.

const SQL_RESOLVER = {
  producto: `
    SELECT pc.id AS nodo_id, ${SQL_UBI_PRODUCTO} AS ubicacion_id, false AS heredada
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE pc.id = ANY($1::int[]) AND pc.sucursal_id = $2 AND su.negocio_id = $3`,

  atributo: `
    SELECT ap.id AS nodo_id,
           COALESCE(${SQL_UBI_ATRIBUTO}, ${SQL_UBI_PRODUCTO}) AS ubicacion_id,
           ${SQL_UBI_ATRIBUTO} IS NULL AS heredada
    FROM atributos_producto ap
    JOIN productos_cantidad pc ON pc.id = ap.producto_id
    JOIN sucursales su ON su.id = ap.sucursal_id
    WHERE ap.id = ANY($1::int[]) AND ap.sucursal_id = $2 AND su.negocio_id = $3`,

  variante: `
    SELECT va.id AS nodo_id,
           COALESCE(${SQL_UBI_VARIANTE}, ${SQL_UBI_ATRIBUTO}, ${SQL_UBI_PRODUCTO}) AS ubicacion_id,
           ${SQL_UBI_VARIANTE} IS NULL AS heredada
    FROM variantes_atributo va
    JOIN atributos_producto ap ON ap.id = va.atributo_id
    JOIN productos_cantidad pc ON pc.id = ap.producto_id
    JOIN sucursales su ON su.id = ap.sucursal_id
    WHERE va.id = ANY($1::int[]) AND ap.sucursal_id = $2 AND su.negocio_id = $3`,

  referencia: `
    SELECT ps.id AS nodo_id, ${SQL_UBI_REFERENCIA} AS ubicacion_id, false AS heredada
    FROM productos_serial ps
    JOIN sucursales su ON su.id = ps.sucursal_id
    WHERE ps.id = ANY($1::int[]) AND ps.sucursal_id = $2 AND su.negocio_id = $3`,

  // Una unidad sin sitio propio se busca donde esté su referencia: es la misma
  // herencia que en todo el módulo, y es lo que evita que la ruta diga "no sé"
  // para un equipo que está perfectamente localizable.
  unidad: `
    SELECT s.id AS nodo_id,
           COALESCE((SELECT ui.ubicacion_id FROM ubicaciones_items ui WHERE ui.serial_id = s.id),
                    ${SQL_UBI_REFERENCIA}) AS ubicacion_id,
           (SELECT ui.ubicacion_id FROM ubicaciones_items ui WHERE ui.serial_id = s.id) IS NULL AS heredada
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales su ON su.id = ps.sucursal_id
    WHERE s.id = ANY($1::int[]) AND ps.sucursal_id = $2 AND su.negocio_id = $3`,
};

const ubicacionesDeNodos = async (sucursalId, negocioId, porNivel) => {
  if (!hayUbicaciones()) return [];

  const resultados = await Promise.all(
    Object.entries(porNivel)
      .filter(([nivel, ids]) => SQL_RESOLVER[nivel] && ids.length)
      .map(([nivel, ids]) => pool
        .query(SQL_RESOLVER[nivel], [ids, sucursalId, negocioId])
        .then(({ rows }) => rows.map((r) => ({ ...r, nivel }))))
  );

  return resultados.flat();
};

// ── Asignación ───────────────────────────────────────────────────────────────

// Columna de `ubicaciones_items` por tipo de nodo, y la consulta que dice a qué
// sucursal pertenece ese nodo. Un mismo mapa para las dos cosas: si mañana se
// agrega un tipo, se agrega aquí y no en cinco sitios.
// Cada consulta devuelve DOS cosas: a qué sucursal pertenece el nodo (para no
// colgar mercancía ajena de nuestro estante) y cómo se llama (para congelarlo
// en el historial; ver `registrarMovimiento`).
const NODOS = {
  producto:   {
    columna: 'producto_cantidad_id',
    sql: `SELECT pc.sucursal_id, pc.nombre AS etiqueta
          FROM productos_cantidad pc
          JOIN sucursales su ON su.id = pc.sucursal_id
          WHERE pc.id = $1 AND su.negocio_id = $2`,
  },
  atributo:   {
    columna: 'atributo_id',
    sql: `SELECT ap.sucursal_id, pc.nombre || ' · ' || ap.valor AS etiqueta
          FROM atributos_producto ap
          JOIN productos_cantidad pc ON pc.id = ap.producto_id
          JOIN sucursales su ON su.id = ap.sucursal_id
          WHERE ap.id = $1 AND su.negocio_id = $2`,
  },
  // `variantes_atributo` no tiene sucursal_id: cuelga de su atributo, igual que
  // pasa con su índice de código único.
  variante:   {
    columna: 'variante_id',
    sql: `SELECT ap.sucursal_id,
                 pc.nombre || ' · ' || ap.valor || ' / ' || va.valor AS etiqueta
          FROM variantes_atributo va
          JOIN atributos_producto ap ON ap.id = va.atributo_id
          JOIN productos_cantidad pc ON pc.id = ap.producto_id
          JOIN sucursales su ON su.id = ap.sucursal_id
          WHERE va.id = $1 AND su.negocio_id = $2`,
  },
  referencia: {
    columna: 'producto_serial_id',
    sql: `SELECT ps.sucursal_id, ps.nombre AS etiqueta
          FROM productos_serial ps
          JOIN sucursales su ON su.id = ps.sucursal_id
          WHERE ps.id = $1 AND su.negocio_id = $2`,
  },
  unidad:     {
    columna: 'serial_id',
    sql: `SELECT ps.sucursal_id, ps.nombre || ' · ' || s.imei AS etiqueta
          FROM seriales s
          JOIN productos_serial ps ON ps.id = s.producto_id
          JOIN sucursales su ON su.id = ps.sucursal_id
          WHERE s.id = $1 AND su.negocio_id = $2`,
  },
};

// Sin esto, un id ajeno colgaría mercancía de otro negocio en el estante propio.
// La base la comparten 28 negocios: la pertenencia se comprueba SIEMPRE, aunque
// el id venga de una pantalla que ya filtró.
const datosDelNodo = async (client, nivel, id, negocioId) => {
  const def = NODOS[nivel];
  if (!def) return null;
  const { rows } = await client.query(def.sql, [id, negocioId]);
  return rows[0] ?? null;
};

// Un nodo vive en un solo sitio (fase 1), así que asignar es "quitar de donde
// estuviera y poner aquí". El DELETE previo hace que la operación sea
// idempotente y evita chocar contra los índices únicos parciales.
//
// El `RETURNING ubicacion_id` es lo que hace posible el historial sin una
// consulta extra: el borrado ya sabe de dónde venía. Preguntarlo aparte además
// abriría una ventana entre leer y escribir.
const asignarNodo = async (client, ubicacionId, nivel, id, usuarioId) => {
  const { columna } = NODOS[nivel];

  const { rows: previas } = await client.query(
    `DELETE FROM ubicaciones_items WHERE ${columna} = $1 RETURNING ubicacion_id`,
    [id]
  );

  await client.query(`
    INSERT INTO ubicaciones_items (ubicacion_id, ${columna}, usuario_id)
    VALUES ($1, $2, $3)
  `, [ubicacionId, id, usuarioId ?? null]);

  return { desde: previas[0]?.ubicacion_id ?? null };
};

const quitarNodo = async (client, nivel, id) => {
  const { columna } = NODOS[nivel];
  const { rows } = await client.query(
    `DELETE FROM ubicaciones_items WHERE ${columna} = $1 RETURNING ubicacion_id`,
    [id]
  );
  return { desde: rows[0]?.ubicacion_id ?? null, borradas: rows.length };
};

// Nombres de las ubicaciones de la sucursal, para congelarlos en el historial.
// SIN filtrar por `activo`: el origen de un movimiento puede haberse dado de
// baja justo antes, y perder su nombre ahí es perder la mitad de la frase que
// alguien va a leer buscando dónde estaba algo.
const nombresDeUbicaciones = async (client, sucursalId, negocioId) => {
  const { rows } = await client.query(`
    SELECT u.id, u.nombre
    FROM ubicaciones u
    JOIN sucursales su ON su.id = u.sucursal_id
    WHERE u.sucursal_id = $1 AND su.negocio_id = $2
  `, [sucursalId, negocioId]);

  return new Map(rows.map((r) => [Number(r.id), r.nombre]));
};

// ── Historial ────────────────────────────────────────────────────────────────
//
// NUNCA lanza y NUNCA se salta la comprobación de la tabla: registrar es un
// extra, mover es la operación diaria del bodeguero. Como esto corre DENTRO de
// la transacción del movimiento, un INSERT fallido la abortaría entera y mover
// una caja de estante fallaría por culpa de su propia bitácora. Por eso se
// consulta la bandera antes en vez de envolver en try/catch: en una transacción
// abortada, atrapar el error no salva las sentencias siguientes.
const registrarMovimiento = async (client, {
  sucursalId, nivel, id, etiqueta, desde, hacia, desdeNombre, haciaNombre, usuarioId,
}) => {
  if (!hayMovimientosUbicacion()) return;

  const { columna } = NODOS[nivel];
  await client.query(`
    INSERT INTO movimientos_ubicacion
      (sucursal_id, ${columna}, desde_id, hacia_id,
       etiqueta, desde_nombre, hacia_nombre, usuario_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [sucursalId, id, desde ?? null, hacia ?? null,
      etiqueta ?? null, desdeNombre ?? null, haciaNombre ?? null, usuarioId ?? null]);
};

// Los nombres salen de las columnas congeladas, no de un JOIN: una ubicación
// dada de baja después del movimiento seguiría contando la verdad de ese día, y
// además la lista se resuelve con un solo escaneo del índice.
//
// `usuario_nombre` sí se une, y a propósito: quién es una persona es un dato
// vivo — si se casa y cambia de apellido, el historial debe decir el nombre de
// hoy, no el de aquel martes.
const listarMovimientos = async (sucursalId, negocioId, { ubicacionId = null, limit = 100 } = {}) => {
  if (!hayMovimientosUbicacion()) return [];

  const { rows } = await pool.query(`
    SELECT
      m.id, m.fecha, m.etiqueta,
      m.desde_id, m.hacia_id, m.desde_nombre, m.hacia_nombre,
      u.nombre AS usuario_nombre,
      CASE
        WHEN m.producto_cantidad_id IS NOT NULL THEN 'producto'
        WHEN m.atributo_id          IS NOT NULL THEN 'atributo'
        WHEN m.variante_id          IS NOT NULL THEN 'variante'
        WHEN m.producto_serial_id   IS NOT NULL THEN 'referencia'
        ELSE 'unidad'
      END AS nivel
    FROM movimientos_ubicacion m
    JOIN sucursales su ON su.id = m.sucursal_id
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.sucursal_id = $1
      AND su.negocio_id = $2
      -- Un estante tiene dos historias que importan por igual: lo que entró y
      -- lo que salió. Filtrar solo por destino escondería justo lo que alguien
      -- busca cuando algo no está donde debería.
      AND ($3::bigint IS NULL OR m.desde_id = $3 OR m.hacia_id = $3)
    ORDER BY m.fecha DESC, m.id DESC
    LIMIT $4
  `, [sucursalId, negocioId, ubicacionId, limit]);

  return rows;
};

module.exports = {
  listarCatalogo,
  listarArbol,
  getById,
  getRuta,
  getDescendientes,
  crear,
  actualizar,
  desactivar,
  guardarGeometria,
  listarItems,
  contarItems,
  contarHijasActivas,
  listarSinAsignar,
  buscarNodos,
  ubicacionesDeNodos,
  datosDelNodo,
  asignarNodo,
  quitarNodo,
  nombresDeUbicaciones,
  registrarMovimiento,
  listarMovimientos,
  NODOS,
};
