const { pool } = require('../../config/db');
const { hayUbicacion } = require('../../config/columnas');

// ── Qué se puede etiquetar ───────────────────────────────────────────────────
//
// El NODO HOJA, nunca un contenedor. Es la misma regla que ya aplican el
// despacho de la red interna y el escaneo: si un producto tiene atributos
// activos, "la correa" no es una cosa que exista en el estante —lo que existe
// es la 38MM y la 42MM, cada una con su stock—. Pegarle una etiqueta al
// contenedor imprimiría un código que al escanearse obliga a elegir a mano, que
// es justo el trabajo que la etiqueta viene a quitar.
//
// El `NOT EXISTS` de cada rama es lo que deja fuera a los contenedores.
//
// NO SE SELECCIONA NINGÚN COSTO. No es un olvido: una etiqueta lleva precio de
// venta y nada más, así que este módulo entero queda fuera del alcance de
// `costos_solo_admin` sin necesitar un recorte propio. Si algún día alguien
// quiere el costo en la etiqueta, tendrá que pasar por `recortarSiToca` — y
// entonces habrá que decidir qué ve un supervisor, no antes.

// Ubicación espacial (feature opt-in): solo se selecciona si la columna existe.
// La consulta se ARMA EN CADA LLAMADA, nunca en una constante de módulo:
// `detectarColumnas()` corre después de las migraciones y este archivo se carga
// al montar las rutas, así que un SQL congelado al importar dejaría la feature
// apagada para siempre. Literal fijo, no entrada de usuario.
const colUbicacion = () => (hayUbicacion() ? 'pc.ubicacion' : 'NULL::text');

// El precio se resuelve hacia arriba igual que en el escaneo: la variante manda
// sobre el atributo y el atributo sobre el producto. Un nodo sin precio propio
// hereda el de su padre, que es lo que el POS cobra.
const sqlNodos = () => `
  SELECT * FROM (
    SELECT
      'producto'::text AS nivel,
      pc.id            AS producto_id,
      NULL::int        AS atributo_id,
      NULL::int        AS variante_id,
      pc.nombre,
      NULL::text       AS variante_label,
      -- Identidad LOGICA del nodo, en columnas separadas. La usan heredarCodigo
      -- y propagarCodigo para encontrar el mismo nodo en las otras sedes, donde
      -- los ids son otros. Va aparte y no partiendo variante_label por " / ":
      -- un atributo que se llame "Rojo / Azul" haria que ese parseo apuntara a
      -- un nodo inexistente, y el codigo se duplicaria entre sedes.
      -- (Sin acentos ni comillas invertidas: esto vive dentro de un template
      -- literal de JS, y una comilla invertida aqui lo cierra a media consulta.)
      NULL::text       AS atributo_valor,
      NULL::text       AS variante_valor,
      pc.codigo,
      pc.stock,
      pc.precio,
      pc.unidad_medida,
      pc.linea_id,
      lp.nombre        AS linea_nombre,
      ${colUbicacion()} AS ubicacion
    FROM productos_cantidad pc
    JOIN sucursales su           ON su.id = pc.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE su.negocio_id = $1 AND pc.sucursal_id = $2 AND pc.activo = true
      AND NOT EXISTS (SELECT 1 FROM atributos_producto x
                      WHERE x.producto_id = pc.id AND x.activo = true)

    UNION ALL

    SELECT
      'atributo', pc.id, ap.id, NULL::int,
      pc.nombre, ap.valor, ap.valor, NULL::text, ap.codigo, ap.stock,
      COALESCE(ap.precio, pc.precio),
      pc.unidad_medida, pc.linea_id, lp.nombre,
      ${colUbicacion()}
    FROM atributos_producto ap
    JOIN productos_cantidad pc   ON pc.id = ap.producto_id
    JOIN sucursales su           ON su.id = ap.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE su.negocio_id = $1 AND ap.sucursal_id = $2
      AND ap.activo = true AND pc.activo = true
      AND NOT EXISTS (SELECT 1 FROM variantes_atributo v
                      WHERE v.atributo_id = ap.id AND v.activo = true)

    UNION ALL

    SELECT
      'variante', pc.id, ap.id, v.id,
      pc.nombre, ap.valor || ' / ' || v.valor, ap.valor, v.valor, v.codigo, v.stock,
      COALESCE(v.precio, ap.precio, pc.precio),
      pc.unidad_medida, pc.linea_id, lp.nombre,
      ${colUbicacion()}
    FROM variantes_atributo v
    JOIN atributos_producto ap   ON ap.id = v.atributo_id
    JOIN productos_cantidad pc   ON pc.id = ap.producto_id
    JOIN sucursales su           ON su.id = ap.sucursal_id
    LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
    WHERE su.negocio_id = $1 AND ap.sucursal_id = $2
      AND v.activo = true AND ap.activo = true AND pc.activo = true
  ) nodos
`;

/**
 * Nodos etiquetables de una sucursal, con los filtros de la pantalla.
 *
 * Los filtros son los de una bodega recorriendo estantes: por línea, por
 * ubicación, por si hay existencias y por si al nodo le falta el código. El
 * último es el que hace usable la impresión masiva —"muéstrame lo que todavía
 * no tiene etiqueta"— y el que alimenta la generación de códigos.
 *
 * @param {object} f
 * @param {string} f.q             texto libre (nombre, variante o código)
 * @param {number|null} f.lineaId
 * @param {string} f.ubicacion     coincidencia exacta, como el filtro del inventario
 * @param {boolean} f.soloConStock
 * @param {'todos'|'con'|'sin'} f.codigo
 */
const listarNodos = async (negocioId, sucursalId, f = {}) => {
  const q            = String(f.q || '').trim().toLowerCase();
  const lineaId      = f.lineaId != null && f.lineaId !== '' ? Number(f.lineaId) : null;
  const ubicacion    = String(f.ubicacion || '').trim();
  const soloConStock = f.soloConStock === true;
  const codigo       = ['con', 'sin'].includes(f.codigo) ? f.codigo : 'todos';

  const { rows } = await pool.query(
    `${sqlNodos()}
     WHERE ($3 = '' OR LOWER(nombre) LIKE '%' || $3 || '%'
                    OR LOWER(COALESCE(variante_label, '')) LIKE '%' || $3 || '%'
                    OR LOWER(COALESCE(codigo, ''))         LIKE '%' || $3 || '%')
       AND ($4::int  IS NULL OR linea_id = $4)
       AND ($5::text = ''    OR LOWER(TRIM(COALESCE(ubicacion, ''))) = LOWER($5))
       AND ($6::bool = false OR stock > 0)
       AND ($7::text = 'todos'
            OR ($7 = 'con' AND codigo IS NOT NULL AND TRIM(codigo) <> '')
            OR ($7 = 'sin' AND (codigo IS NULL OR TRIM(codigo) = '')))
     ORDER BY linea_nombre NULLS LAST, nombre, variante_label NULLS FIRST`,
    [negocioId, sucursalId, q, lineaId, ubicacion, soloConStock, codigo]
  );
  return rows;
};

/**
 * Los nodos de una selección concreta, en el mismo formato que `listarNodos`.
 *
 * La selección viaja como identidad de nodo (nivel + id del nivel), no como un
 * id suelto: el mismo número 7 puede ser un atributo y una variante distintos,
 * y confundirlos imprimiría el código de otra cosa.
 *
 * Se vuelve a leer de la BD en vez de creerle al cuerpo de la petición: entre
 * que la pantalla cargó la lista y alguien pulsó Imprimir pudo cambiar un
 * precio o asignarse un código, y la etiqueta impresa se queda pegada al
 * producto durante meses. De paso, el `negocio_id` de la consulta es lo que
 * impide que una selección manipulada saque nodos de otro negocio.
 */
const nodosPorSeleccion = async (negocioId, sucursalId, seleccion) => {
  if (!seleccion.length) return [];

  const idsDe = (nivel, campo) => seleccion
    .filter((s) => s.nivel === nivel)
    .map((s) => Number(s[campo]))
    .filter(Number.isInteger);

  const { rows } = await pool.query(
    `${sqlNodos()}
     WHERE (nivel = 'producto' AND producto_id = ANY($3::int[]))
        OR (nivel = 'atributo' AND atributo_id = ANY($4::int[]))
        OR (nivel = 'variante' AND variante_id = ANY($5::int[]))
     ORDER BY linea_nombre NULLS LAST, nombre, variante_label NULLS FIRST`,
    [negocioId, sucursalId,
      idsDe('producto', 'producto_id'),
      idsDe('atributo', 'atributo_id'),
      idsDe('variante', 'variante_id')]
  );
  return rows;
};

/** Datos del encabezado que va en la etiqueta (nombre del negocio, sucursal). */
const contextoImpresion = async (negocioId, sucursalId) => {
  const { rows } = await pool.query(
    `SELECT su.nombre AS sucursal_nombre,
            (SELECT valor FROM config_negocio
              WHERE negocio_id = $1 AND clave = 'nombre_negocio') AS negocio_nombre
     FROM sucursales su
     WHERE su.id = $2 AND su.negocio_id = $1`,
    [negocioId, sucursalId]
  );
  return rows[0] || null;
};

module.exports = { listarNodos, nodosPorSeleccion, contextoImpresion };
