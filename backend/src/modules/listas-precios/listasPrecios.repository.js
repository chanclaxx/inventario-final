const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// Escritura de los precios de lista de un NODO.
//
// Cuatro niveles y una sola forma. El `precios` de cada tabla es la MISMA
// columna con el mismo significado, así que lo único que cambia entre niveles
// es de dónde cuelga la sucursal — y eso es justo lo que decide si el nodo es
// de este negocio o del de al lado.
//
// Las consultas van acotadas por `negocio_id` SIEMPRE, y dentro del propio
// UPDATE: comprobar la pertenencia en una consulta aparte y escribir en otra
// deja una ventana entre las dos. En una base compartida por 28 negocios eso no
// es teoría — `findSerialEnInventario` buscaba por IMEI a secas y podía alcanzar
// (y hacer borrar) la fila de otro.
// ─────────────────────────────────────────────────────────────────────────────

// Cada nivel: cómo se llega desde su tabla hasta la sucursal, y por tanto hasta
// el negocio. `$1` = precios (jsonb o null), `$2` = id del nodo, `$3` = negocio.
const UPDATES = {
  producto: `
    UPDATE productos_cantidad pc
    SET precios = $1::jsonb
    FROM sucursales su
    WHERE pc.id = $2 AND su.id = pc.sucursal_id AND su.negocio_id = $3
    RETURNING pc.id`,

  atributo: `
    UPDATE atributos_producto ap
    SET precios = $1::jsonb
    FROM sucursales su
    WHERE ap.id = $2 AND su.id = ap.sucursal_id AND su.negocio_id = $3
    RETURNING ap.id`,

  // `variantes_atributo` no tiene `sucursal_id` —cuelga de su atributo—, igual
  // que pasa con su índice de código único. El alcance de negocio sube por el
  // padre, nunca se asume.
  variante: `
    UPDATE variantes_atributo v
    SET precios = $1::jsonb
    FROM atributos_producto ap
    JOIN sucursales su ON su.id = ap.sucursal_id
    WHERE v.id = $2 AND ap.id = v.atributo_id AND su.negocio_id = $3
    RETURNING v.id`,

  serial: `
    UPDATE productos_serial ps
    SET precios = $1::jsonb
    FROM sucursales su
    WHERE ps.id = $2 AND su.id = ps.sucursal_id AND su.negocio_id = $3
    RETURNING ps.id`,
};

const NIVELES = Object.keys(UPDATES);

/**
 * Escribe los precios de un nodo. Devuelve true si la fila existía Y era de
 * este negocio; false en cualquier otro caso — el llamador decide si eso es un
 * error o una línea que se salta.
 */
const escribirPrecios = async (client, { nivel, id, precios }, negocioId) => {
  const sql = UPDATES[nivel];
  if (!sql) return false;
  const { rows } = await client.query(sql, [
    precios === null ? null : JSON.stringify(precios),
    id,
    negocioId,
  ]);
  return rows.length > 0;
};

/**
 * Los precios que hoy tiene cada nodo de un producto por cantidad, para poder
 * pintarlos en el editor sin que la pantalla tenga que rearmarlos desde tres
 * consultas distintas. El árbol ya viaja con ellos en la lista de inventario;
 * esto existe para el caso en que se edite un producto que no está en pantalla.
 */
const leerPreciosProductoCantidad = async (productoId, negocioId) => {
  const { rows } = await pool.query(`
    SELECT 'producto' AS nivel, pc.id, pc.nombre AS etiqueta, pc.precios
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE pc.id = $1 AND su.negocio_id = $2

    UNION ALL

    SELECT 'atributo', ap.id, COALESCE(tc.nombre || ': ', '') || ap.valor, ap.precios
    FROM atributos_producto ap
    JOIN sucursales su ON su.id = ap.sucursal_id
    LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
    WHERE ap.producto_id = $1 AND ap.activo = true AND su.negocio_id = $2

    UNION ALL

    SELECT 'variante', v.id, COALESCE(tc.nombre || ': ', '') || v.valor, v.precios
    FROM variantes_atributo v
    JOIN atributos_producto ap ON ap.id = v.atributo_id
    JOIN sucursales su ON su.id = ap.sucursal_id
    LEFT JOIN tipos_caracteristica tc ON tc.id = v.tipo_id
    WHERE ap.producto_id = $1 AND ap.activo = true AND v.activo = true
      AND su.negocio_id = $2
  `, [productoId, negocioId]);
  return rows;
};

/**
 * Todos los nodos tarifables de una sucursal, para armar la plantilla de Excel.
 *
 * **Las TALLAS entran por defecto** (sep-2026, reportado por el usuario: «la
 * plantilla descarga los productos pero no las variantes»). Antes había que
 * acordarse de marcar una casilla, y eso deja sin tarifar justo lo que se
 * vende: con variantes activas el precio vive en la HOJA —el producto es un
 * contenedor— exactamente igual que el stock y que el código escaneable. Una
 * plantilla que solo trae el contenedor no sirve para poner precios.
 * `incluirVariantes: false` sigue existiendo para el negocio que solo quiere
 * revisar los productos, y quien decide el default es el service leyendo
 * `variantes_activo`.
 *
 * Las REFERENCIAS con IMEI también entran: `productos_serial.precios` existe
 * desde la misma migración y el editor de un producto ya las tarifa, pero la
 * plantilla no las bajaba — así que la única forma de ponerle precio de lista a
 * un equipo era uno por uno.
 *
 * ── El ORDEN es el del árbol, no el alfabético ──────────────────────────────
 * Cada talla va DEBAJO de su producto, y cada color debajo de SU talla. Antes
 * el `ORDER BY` ponía todos los atributos de un producto y después todas sus
 * variantes, así que «38MM» y «38MM / Negro» quedaban separadas por las otras
 * tallas: para tarifar un color había que buscarlo. Y dentro de un nivel manda
 * `tipos_caracteristica.orden`, igual que en el árbol del inventario y en el
 * export de inventario — ordenar alfabéticamente pondría las tallas como
 * L, M, S, XL.
 *
 * El `token` es lo que hace EXACTO el viaje de ida y vuelta: al reimportar no
 * hay que adivinar a qué fila corresponde cada línea del Excel. Si el usuario
 * lo borra o agrega una fila a mano, el importador cae al nombre — pero eso ya
 * es una conjetura, y se reporta como tal.
 */
const leerNodosSucursal = async (
  sucursalId, negocioId, { incluirVariantes = true, incluirSeriales = true } = {},
) => {
  const { rows } = await pool.query(`
    SELECT * FROM (
      SELECT
        'p' || pc.id::text AS token, 'producto'::text AS nivel, pc.id,
        pc.nombre, ''::text AS detalle, pc.codigo, pc.precio, pc.precios,
        'Producto'::text AS nivel_etiqueta,
        EXISTS (SELECT 1 FROM atributos_producto x
                WHERE x.producto_id = pc.id AND x.activo = true) AS tiene_hijos,
        pc.nombre AS orden_nombre, pc.id AS orden_producto,
        0 AS orden_atr_num, ''::text AS orden_atr_txt,
        0 AS orden_nivel,
        0 AS orden_var_num, ''::text AS orden_var_txt
      FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE pc.sucursal_id = $1 AND su.negocio_id = $2 AND pc.activo = true

      UNION ALL

      SELECT
        'a' || ap.id::text, 'atributo', ap.id,
        pc.nombre, COALESCE(tc.nombre || ': ', '') || ap.valor, ap.codigo, ap.precio, ap.precios,
        COALESCE(tc.nombre, 'Variante'),
        EXISTS (SELECT 1 FROM variantes_atributo x
                WHERE x.atributo_id = ap.id AND x.activo = true),
        pc.nombre, pc.id,
        COALESCE(tc.orden, 9999), ap.valor,
        1,
        0, ''
      FROM atributos_producto ap
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
      WHERE ap.sucursal_id = $1 AND su.negocio_id = $2
        AND ap.activo = true AND pc.activo = true AND $3::boolean

      UNION ALL

      SELECT
        'v' || v.id::text, 'variante', v.id,
        pc.nombre,
        COALESCE(tca.nombre || ': ', '') || ap.valor || ' / ' || COALESCE(tcv.nombre || ': ', '') || v.valor,
        v.codigo, v.precio, v.precios,
        COALESCE(tcv.nombre, 'Sub-variante'),
        false,
        pc.nombre, pc.id,
        COALESCE(tca.orden, 9999), ap.valor,
        2,
        COALESCE(tcv.orden, 9999), v.valor
      FROM variantes_atributo v
      JOIN atributos_producto ap ON ap.id = v.atributo_id
      JOIN productos_cantidad pc ON pc.id = ap.producto_id
      JOIN sucursales su ON su.id = ap.sucursal_id
      LEFT JOIN tipos_caracteristica tca ON tca.id = ap.tipo_id
      LEFT JOIN tipos_caracteristica tcv ON tcv.id = v.tipo_id
      WHERE ap.sucursal_id = $1 AND su.negocio_id = $2
        AND v.activo = true AND ap.activo = true AND pc.activo = true AND $3::boolean

      UNION ALL

      -- Referencias con IMEI. El precio de lista vive en la REFERENCIA (el
      -- modelo), no en cada unidad: «a cuanto le vendo este modelo a un
      -- mayorista» es una pregunta del modelo. La marca y el modelo van en la
      -- columna de variante porque son lo que distingue dos referencias que se
      -- llaman igual. productos_serial no tiene ni activo ni codigo.
      -- OJO: sin comillas invertidas aqui dentro — este SQL vive en un
      -- template literal y una sola lo cierra a media consulta.
      SELECT
        's' || ps.id::text, 'serial', ps.id,
        ps.nombre,
        NULLIF(TRIM(COALESCE(ps.marca, '') || ' ' || COALESCE(ps.modelo, '')), ''),
        NULL::text, ps.precio, ps.precios,
        'Referencia',
        false,
        ps.nombre, ps.id,
        0, '',
        0,
        0, ''
      FROM productos_serial ps
      JOIN sucursales su ON su.id = ps.sucursal_id
      WHERE ps.sucursal_id = $1 AND su.negocio_id = $2 AND $4::boolean
    ) nodos
    ORDER BY orden_nombre, orden_producto,
             orden_atr_num, orden_atr_txt, orden_nivel, orden_var_num, orden_var_txt
  `, [sucursalId, negocioId, incluirVariantes, incluirSeriales]);
  return rows;
};

/** Las sucursales del negocio, para elegir a cuáles aplica la plantilla. */
const leerSucursales = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre FROM sucursales WHERE negocio_id = $1 ORDER BY nombre`, [negocioId]);
  return rows;
};

module.exports = {
  NIVELES, escribirPrecios, leerPreciosProductoCantidad,
  leerNodosSucursal, leerSucursales, pool,
};
