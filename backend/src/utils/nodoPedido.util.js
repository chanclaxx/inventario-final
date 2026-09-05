// src/utils/nodoPedido.util.js
// ─────────────────────────────────────────────────────────────────────────────
// EL NODO DE UN PEDIDO — identidad, etiqueta y conciliación
//
// Una orden de compra pedía "100 cargadores". Con el pedido detallado pide "50
// de 25W y 50 de 20W", que son dos NODOS distintos del árbol de cantidad.
//
// Este archivo existe porque la misma pregunta se hace en cuatro sitios que no
// se pueden desincronizar sin que alguno empiece a mentir:
//
//   · ordenesCompra.service  — al crear la orden: ¿este nodo existe, es de este
//                              producto, y es una HOJA?
//   · compras.service        — al recibir: ¿lo que llegó es lo que se pidió?
//   · la novedad             — ¿cómo se llamaba lo pedido y lo recibido?
//   · la bitácora            — lo mismo, congelado en el momento de corregir.
//
// Es el mismo criterio que ya rige a `codigo.util.js` (compartido entre el
// importador y el módulo de variantes) y a `costos.util.js` (una sola respuesta
// a "¿puede ver los costos?"): cuando la misma pregunta se responde en varios
// sitios, o vive en un util o acaban dando respuestas distintas.
//
// ── Las dos nociones se DERIVAN, nunca se guardan ───────────────────────────
// SUSTITUCIÓN = la línea de la orden trae nodo Y la de la recepción trae otro.
// EXCESO      = recibida - pedida, cuando es positivo.
//
// Guardarlas abriría la puerta que este repositorio ya cerró en el avance de la
// orden, en la deuda de la red interna y en lo pendiente de mora: cancelar una
// recepción o devolver unidades jamás iría a corregir un contador, y ese
// contador quedaría contando algo que ya no existe.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identidad de un nodo dentro de una línea, como texto comparable.
 *
 * El orden importa: variante > atributo > producto, la misma jerarquía que usan
 * las remisiones, las etiquetas y las ubicaciones. Una variante SIEMPRE cuelga
 * de un atributo, así que mirar primero el atributo confundiría dos tallas del
 * mismo color.
 *
 * `'p'` (el producto pelado) es un valor legítimo, no un "sin dato": es lo que
 * significan hoy las órdenes de los 28 negocios y lo que va a seguir
 * significando — "el producto en general".
 */
const claveNodo = (n = {}) => {
  if (n.variante_id) return `v-${Number(n.variante_id)}`;
  if (n.atributo_id) return `a-${Number(n.atributo_id)}`;
  return 'p';
};

/** ¿La línea baja a una variante o a un atributo, o se queda en el producto? */
const tieneNodo = (n = {}) => Boolean(n.variante_id || n.atributo_id);

/**
 * ¿Lo que llegó responde a lo pedido con OTRO nodo?
 *
 * Solo es sustitución cuando la orden SÍ especificó un nodo. Una orden al
 * producto ("100 cargadores") recibida repartida por variante NO es una
 * sustitución: es exactamente el flujo que existe hoy y que tiene que seguir
 * comportándose igual con la feature apagada.
 */
const esSustitucion = (pedido, recibido) =>
  tieneNodo(pedido) && claveNodo(pedido) !== claveNodo(recibido);

/**
 * Etiqueta legible de un nodo: "Talla: 38MM", "Color: Negro", o null.
 *
 * Se CONGELA en quien la llame (la novedad, la bitácora), nunca se une por JOIN
 * al pintar. Si mañana renombran la talla, un JOIN reescribiría el pasado y la
 * novedad diría que el proveedor mandó algo que nunca se llamó así — el mismo
 * criterio de `movimientos_ubicacion.desde_nombre` y `lineas_remision.costo_origen`.
 *
 * Va con `client` y no con `pool` porque todos sus llamadores están dentro de
 * una transacción: leer por fuera vería el estado anterior a lo que se acaba de
 * escribir.
 */
const etiquetaNodo = async (client, { variante_id = null, atributo_id = null } = {}) => {
  if (variante_id) {
    const { rows } = await client.query(
      `SELECT va.valor, tc.nombre AS tipo
       FROM      variantes_atributo  va
       LEFT JOIN tipos_caracteristica tc ON tc.id = va.tipo_id
       WHERE va.id = $1`,
      [variante_id]
    );
    if (!rows.length) return null;
    return rows[0].tipo ? `${rows[0].tipo}: ${rows[0].valor}` : rows[0].valor;
  }
  if (atributo_id) {
    const { rows } = await client.query(
      `SELECT ap.valor, tc.nombre AS tipo
       FROM      atributos_producto  ap
       LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
       WHERE ap.id = $1`,
      [atributo_id]
    );
    if (!rows.length) return null;
    return rows[0].tipo ? `${rows[0].tipo}: ${rows[0].valor}` : rows[0].valor;
  }
  return null;
};

/**
 * Valida que el nodo exista, sea de ESTE producto y sea una HOJA.
 * Devuelve su etiqueta congelada.
 *
 * ── Por qué exige la hoja ───────────────────────────────────────────────────
 * Es la misma regla del despacho de la red interna y de las etiquetas
 * imprimibles: si "Correa" tiene 38MM y 42MM, en el estante no existe "la
 * correa" — existen las dos tallas, cada una con su stock. Pedir el contenedor
 * obliga a que alguien elija a mano al recibir, que es justo el trabajo que el
 * pedido detallado viene a quitar.
 *
 * La diferencia con una REMISIÓN es que allá el nodo hoja es obligatorio porque
 * mueve stock (`VARIANTE_REQUERIDA`); aquí el nodo entero es opcional —una línea
 * al producto sigue siendo válida y es lo que hacen las órdenes de hoy—. Lo que
 * no se acepta es el punto intermedio: bajar a medias, a un contenedor.
 *
 * ── Y por qué exige la sucursal ─────────────────────────────────────────────
 * `atributos_producto` tiene `sucursal_id`; `variantes_atributo` NO (cuelga de
 * su atributo), igual que pasa con el código único. Así que el alcance de
 * sucursal de una variante se comprueba a través de su padre, aquí, y no con un
 * índice.
 */
const validarNodo = async (client, { producto_id, variante_id, atributo_id, sucursal_id }) => {
  if (variante_id && atributo_id) {
    throw { status: 400, message: 'Una línea no puede apuntar a un atributo y a una variante a la vez' };
  }

  if (variante_id) {
    const { rows } = await client.query(
      `SELECT va.id, va.valor, tc.nombre AS tipo
       FROM      variantes_atributo   va
       JOIN      atributos_producto   ap ON ap.id = va.atributo_id
       LEFT JOIN tipos_caracteristica tc ON tc.id = va.tipo_id
       WHERE va.id = $1
         AND va.activo = true
         AND ap.producto_id = $2
         AND ap.sucursal_id = $3`,
      [variante_id, producto_id, sucursal_id]
    );
    if (!rows.length) {
      throw { status: 400, code: 'NODO_INVALIDO', message: 'La variante indicada no existe en este producto' };
    }
    // Una variante es siempre hoja: el árbol tiene tres niveles y este es el
    // último. No hay nada que comprobar debajo.
    return {
      etiqueta: rows[0].tipo ? `${rows[0].tipo}: ${rows[0].valor}` : rows[0].valor,
      nivel: 'variante',
    };
  }

  if (atributo_id) {
    const { rows } = await client.query(
      `SELECT ap.id, ap.valor, tc.nombre AS tipo,
              EXISTS (
                SELECT 1 FROM variantes_atributo v
                WHERE v.atributo_id = ap.id AND v.activo = true
              ) AS tiene_hijas
       FROM      atributos_producto   ap
       LEFT JOIN tipos_caracteristica tc ON tc.id = ap.tipo_id
       WHERE ap.id = $1
         AND ap.activo = true
         AND ap.producto_id = $2
         AND ap.sucursal_id = $3`,
      [atributo_id, producto_id, sucursal_id]
    );
    if (!rows.length) {
      throw { status: 400, code: 'NODO_INVALIDO', message: 'La característica indicada no existe en este producto' };
    }
    const etiqueta = rows[0].tipo ? `${rows[0].tipo}: ${rows[0].valor}` : rows[0].valor;
    if (rows[0].tiene_hijas) {
      throw {
        status: 400,
        code: 'NODO_CONTENEDOR',
        message: `"${etiqueta}" tiene variantes debajo. Pide una de ellas: `
          + 'un contenedor obliga a elegir a mano al recibir.',
      };
    }
    return { etiqueta, nivel: 'atributo' };
  }

  // Sin nodo: "el producto en general". Es válido y es lo de siempre.
  return { etiqueta: null, nivel: 'producto' };
};

module.exports = { claveNodo, tieneNodo, esSustitucion, etiquetaNodo, validarNodo };
