// ── Código único escaneable (feature opt-in `codigo_producto_activo`) ────────
//
// Un código identifica **lo que se escanea**, y eso no siempre es el producto:
// con variantes activas el cliente escanea la talla 38MM de la correa, no "la
// correa". Por eso el código vive en los TRES niveles del árbol de cantidad:
//
//   productos_cantidad.codigo   → producto sin variantes
//   atributos_producto.codigo   → nivel 1 (talla, color…)
//   variantes_atributo.codigo   → nivel 2 (sub-variante dentro del atributo)
//
// **Un código = un nodo escaneable por sucursal, sin importar el nivel.** Si el
// mismo código estuviera en un producto y en el atributo de otro, el lector no
// tendría forma de decidir a cuál se refiere. La BD garantiza la unicidad por
// tabla (índices parciales por sucursal); la unicidad ENTRE niveles no es
// expresable como constraint —son tres tablas— y la impone `buscarCodigoEnUso`,
// igual que ya se hacía con la regla "un código = un solo nombre de producto".
//
// `variantes_atributo` no tiene `sucursal_id` (cuelga de `atributo_id`), así que
// su índice único es por atributo; el alcance de sucursal lo cubre la misma
// verificación de servicio.

const { pool } = require('../config/db');

const MAX_CODIGO = 50;

// Semántica de los tres casos, igual que `nota` y `ubicacion`:
//   undefined → no tocar (un cliente que no envía el campo no lo borra)
//   '' / null → limpiar
//   texto     → trim + MAYÚSCULAS (el lector siempre manda la misma cadena;
//               la entrada manual puede variar)
const normalizarCodigo = (codigo) => {
  if (codigo === undefined) return undefined;

  const limpio = String(codigo ?? '').trim().toUpperCase();
  if (!limpio) return null;

  if (/\s/.test(limpio)) throw { status: 400, message: 'El código no puede contener espacios' };
  if (limpio.length > MAX_CODIGO) {
    throw { status: 400, message: `El código no puede superar ${MAX_CODIGO} caracteres` };
  }
  return limpio;
};

// ── ¿Quién tiene ya este código? ─────────────────────────────────────────────
//
// Recorre los tres niveles y devuelve TODOS los nodos que lo ocupan, con su
// identidad lógica (nombre del producto + valor del atributo + valor de la
// variante). Se le puede pasar un `client` en transacción (lo usa el
// importador) o nada, y entonces usa el pool.
//
// Alcance: `sucursalId` limita a una sede; `negocioId` busca en todo el negocio.
// Los dos hacen falta según quién pregunte —el POS resuelve por sucursal, el
// importador valida contra el negocio entero— y por eso el filtro es opcional.
//
// La identidad importa porque el mismo nodo lógico en otra sede lleva el mismo
// código A PROPÓSITO (así el lector funciona en las dos): eso no es conflicto.
// Quien compara por id usa `excluir`; quien todavía no tiene id —el importador,
// que puede estar a punto de crear el nodo— compara por identidad.
const buscarCodigoEnUso = async (ejecutor, { sucursalId = null, negocioId = null, codigo, excluir = {} }) => {
  if (!codigo || (!sucursalId && !negocioId)) return [];
  const db = ejecutor || pool;

  const { rows } = await db.query(
    `
    SELECT 'producto'::text AS nivel, pc.id, pc.nombre AS etiqueta,
           pc.nombre AS producto_nombre, NULL::text AS atributo_valor, NULL::text AS variante_valor,
           su.nombre AS sucursal_nombre
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE pc.activo = true
      AND UPPER(pc.codigo) = $1
      AND ($2::int IS NULL OR pc.sucursal_id = $2)
      AND ($3::int IS NULL OR su.negocio_id  = $3)
      AND ($4::int IS NULL OR pc.id <> $4)

    UNION ALL

    SELECT 'atributo', ap.id, pc.nombre || ' — ' || ap.valor,
           pc.nombre, ap.valor, NULL::text, su.nombre
    FROM atributos_producto ap
    JOIN productos_cantidad pc ON pc.id = ap.producto_id
    JOIN sucursales su ON su.id = ap.sucursal_id
    WHERE ap.activo = true AND pc.activo = true
      AND UPPER(ap.codigo) = $1
      AND ($2::int IS NULL OR ap.sucursal_id = $2)
      AND ($3::int IS NULL OR su.negocio_id  = $3)
      AND ($5::int IS NULL OR ap.id <> $5)

    UNION ALL

    SELECT 'variante', v.id, pc.nombre || ' — ' || ap.valor || ' / ' || v.valor,
           pc.nombre, ap.valor, v.valor, su.nombre
    FROM variantes_atributo v
    JOIN atributos_producto ap ON ap.id = v.atributo_id
    JOIN productos_cantidad pc ON pc.id = ap.producto_id
    JOIN sucursales su ON su.id = ap.sucursal_id
    WHERE v.activo = true AND ap.activo = true AND pc.activo = true
      AND UPPER(v.codigo) = $1
      AND ($2::int IS NULL OR ap.sucursal_id = $2)
      AND ($3::int IS NULL OR su.negocio_id  = $3)
      AND ($6::int IS NULL OR v.id <> $6)
    `,
    [
      codigo, sucursalId, negocioId,
      excluir.producto ?? null, excluir.atributo ?? null, excluir.variante ?? null,
    ]
  );
  return rows;
};

// ¿Este código lo tiene un nodo DISTINTO al que describe la fila? Compara por
// identidad lógica, no por id: así re-importar el mismo archivo no choca
// consigo mismo, y el mismo nodo en otra sede tampoco.
const codigoTomadoPorOtroNodo = async (ejecutor, { negocioId, sucursalId, codigo, identidad }) => {
  const eq = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  const enUso = await buscarCodigoEnUso(ejecutor, { negocioId, sucursalId, codigo });
  return enUso.find((n) => !(
    eq(n.producto_nombre, identidad.producto) &&
    eq(n.atributo_valor,  identidad.atributo) &&
    eq(n.variante_valor,  identidad.variante)
  )) || null;
};

// Lanza el 409 con el mensaje que ve el usuario. Se usa desde los services;
// el importador prefiere `buscarCodigoEnUso` porque reporta al informe en vez
// de tumbar la fila.
const exigirCodigoLibre = async (ejecutor, { sucursalId, codigo, excluir }) => {
  const [enUso] = await buscarCodigoEnUso(ejecutor, { sucursalId, codigo, excluir });
  if (enUso) {
    throw {
      status: 409,
      message: `El código ${codigo} ya está en uso por "${enUso.etiqueta}" en esta sucursal`,
    };
  }
};

// ── Propagación del código a las demás sucursales ────────────────────────────
//
// El mismo nodo lógico en otra sede debe llevar el mismo código, o el lector
// deja de funcionar allá. La identidad del nodo es (nombre del producto, valor
// del atributo, valor de la variante): los ids son distintos en cada sucursal.
//
// Vive aquí y no en un repositorio porque lo necesitan dos sitios que no se
// pueden importar entre sí —el módulo de variantes y el importador, que corre
// todo con su propio `client` en transacción—, y tener dos copias del mismo
// UPDATE es exactamente cómo se desincronizan.
//
// Best-effort: nunca debe tumbar la operación principal. El `NOT EXISTS`
// protege el índice único — si en la otra sede ese código ya lo tiene otro
// nodo, esa fila se salta y las demás siguen.
const propagarCodigo = async (ejecutor, { negocioId, identidad, codigo }) => {
  const db = ejecutor || pool;
  const { producto, atributo = null, variante = null } = identidad;

  try {
    if (variante) {
      await db.query(
        `UPDATE variantes_atributo v SET codigo = $5
         FROM atributos_producto ap, productos_cantidad pc, sucursales su
         WHERE ap.id = v.atributo_id AND pc.id = ap.producto_id AND su.id = ap.sucursal_id
           AND su.negocio_id = $1
           AND LOWER(pc.nombre) = LOWER($2)
           AND LOWER(ap.valor)  = LOWER($3)
           AND LOWER(v.valor)   = LOWER($4)
           AND v.activo AND ap.activo AND pc.activo
           AND v.codigo IS DISTINCT FROM $5
           AND NOT EXISTS (
             SELECT 1 FROM variantes_atributo x
             WHERE x.atributo_id = v.atributo_id AND x.activo
               AND x.codigo = $5 AND x.id <> v.id
           )`,
        [negocioId, producto, atributo, variante, codigo ?? null]
      );
    } else if (atributo) {
      await db.query(
        `UPDATE atributos_producto ap SET codigo = $4
         FROM productos_cantidad pc, sucursales su
         WHERE pc.id = ap.producto_id AND su.id = ap.sucursal_id
           AND su.negocio_id = $1
           AND LOWER(pc.nombre) = LOWER($2)
           AND LOWER(ap.valor)  = LOWER($3)
           AND ap.activo AND pc.activo
           AND ap.codigo IS DISTINCT FROM $4
           AND NOT EXISTS (
             SELECT 1 FROM atributos_producto x
             WHERE x.sucursal_id = ap.sucursal_id AND x.activo
               AND x.codigo = $4 AND x.id <> ap.id
           )`,
        [negocioId, producto, atributo, codigo ?? null]
      );
    } else {
      await db.query(
        `UPDATE productos_cantidad pc SET codigo = $3
         FROM sucursales su
         WHERE su.id = pc.sucursal_id
           AND su.negocio_id = $1
           AND LOWER(pc.nombre) = LOWER($2)
           AND pc.activo
           AND pc.codigo IS DISTINCT FROM $3
           AND NOT EXISTS (
             SELECT 1 FROM productos_cantidad x
             WHERE x.sucursal_id = pc.sucursal_id AND x.activo
               AND x.codigo = $3 AND x.id <> pc.id
           )`,
        [negocioId, producto, codigo ?? null]
      );
    }
  } catch (err) {
    console.warn('⚠️ No se pudo sincronizar el código entre sucursales:', err.message);
  }
};

// El mismo nodo ya creado en otra sucursal → hereda su código, para que el
// escaneo funcione igual en todas. Solo lo hereda si en la sucursal destino ese
// código está libre (evita chocar con el índice único ante datos heredados
// inconsistentes).
//
// Devuelve `{ codigo, bloqueadoPor }` y NO solo el código: hay que poder
// distinguir "no hay nada que heredar" de "lo hay pero está ocupado". Si se
// devuelve null en los dos casos, el nodo se queda sin código sin que nadie se
// entere, el escaneo deja de funcionar en esa sede y no hay forma de saber por
// qué. El llamador reporta el segundo caso al informe.
const heredarCodigo = async (ejecutor, { negocioId, sucursalId, identidad }) => {
  const db = ejecutor || pool;
  const { producto, atributo = null, variante = null } = identidad;

  // El código se hereda del MISMO nivel, nunca de uno de arriba: darle a un
  // atributo el código de su producto los dejaría a los dos con el mismo, y el
  // lector no sabría cuál de los dos se escaneó.
  const nivel = variante ? 'variante' : (atributo ? 'atributo' : 'producto');
  const columna = { producto: 'pc.codigo', atributo: 'ap.codigo', variante: 'v.codigo' }[nivel];

  const { rows } = await db.query(
    `SELECT ${columna} AS codigo
     FROM productos_cantidad pc
     JOIN sucursales su ON su.id = pc.sucursal_id
     LEFT JOIN atributos_producto ap
       ON ap.producto_id = pc.id AND ap.activo
      AND $3::text IS NOT NULL AND LOWER(ap.valor) = LOWER($3)
     LEFT JOIN variantes_atributo v
       ON v.atributo_id = ap.id AND v.activo
      AND $4::text IS NOT NULL AND LOWER(v.valor) = LOWER($4)
     WHERE su.negocio_id = $1
       AND pc.activo
       AND LOWER(pc.nombre) = LOWER($2)
       AND ${columna} IS NOT NULL
       AND ($3::text IS NULL OR ap.id IS NOT NULL)
       AND ($4::text IS NULL OR v.id  IS NOT NULL)
     ORDER BY pc.id
     LIMIT 1`,
    [negocioId, producto, atributo, variante]
  );
  const codigo = rows[0]?.codigo || null;
  if (!codigo) return { codigo: null, bloqueadoPor: null };

  const [ocupado] = await buscarCodigoEnUso(db, { sucursalId, codigo });
  return ocupado
    ? { codigo: null, bloqueadoPor: { ...ocupado, codigo } }
    : { codigo, bloqueadoPor: null };
};

module.exports = {
  normalizarCodigo, buscarCodigoEnUso, codigoTomadoPorOtroNodo,
  exigirCodigoLibre, propagarCodigo, heredarCodigo, MAX_CODIGO,
};
