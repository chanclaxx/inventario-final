'use strict';

/**
 * TEXTO DE LA VARIANTE de una línea vendida o prestada («Talla: 38MM / Color:
 * Negro»), para los documentos.
 *
 * Un préstamo guarda la variante en DOS sitios: la etiqueta congelada
 * (`atributo_label` / `variante_label`, la que vio el vendedor al prestar) y
 * los ids. La etiqueta manda —renombrar la talla no reescribe el pasado—; los
 * ids solo cubren los préstamos viejos que no la guardaron. Una línea de
 * factura no tiene etiqueta: la variante ya va pegada al nombre del producto
 * (`nombreConVariante` en el carrito), así que solo se resuelve por id.
 *
 * Sin variante devuelve NULL: un negocio sin tallas imprime lo de siempre.
 */
const _nodo = (tabla, idExpr) => `(
  SELECT COALESCE(tc.nombre || ': ', '') || n.valor
    FROM ${tabla} n
    LEFT JOIN tipos_caracteristica tc ON tc.id = n.tipo_id
   WHERE n.id = ${idExpr}
)`;

/**
 * @param {string} alias   alias de la tabla con atributo_id/variante_id
 * @param {object} [opts]
 * @param {boolean} [opts.conEtiquetas] la tabla tiene atributo_label/variante_label
 */
const sqlVarianteTexto = (alias, { conEtiquetas = false } = {}) => {
  const porId = `NULLIF(CONCAT_WS(' / ',
      ${_nodo('atributos_producto', `${alias}.atributo_id`)},
      ${_nodo('variantes_atributo', `${alias}.variante_id`)}), '')`;
  if (!conEtiquetas) return porId;
  return `COALESCE(
    NULLIF(CONCAT_WS(' / ', NULLIF(BTRIM(${alias}.atributo_label), ''),
                            NULLIF(BTRIM(${alias}.variante_label), '')), ''),
    ${porId})`;
};

/**
 * Nombre del producto con su variante, sin repetirla: en una factura el nombre
 * ya la trae entre paréntesis y escribirla otra vez sería ruido.
 */
const nombreConVariante = (nombre, variante) => {
  const n = String(nombre || '').trim();
  const v = String(variante || '').trim();
  if (!v) return n;
  if (n.toLowerCase().includes(v.toLowerCase())) return n;
  return n ? `${n} (${v})` : v;
};

module.exports = { sqlVarianteTexto, nombreConVariante };
