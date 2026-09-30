// ─────────────────────────────────────────────────────────────────────────────
// Vender o prestar un producto con variantes exige decir CUÁL.
//
// Con la feature «Variantes» el stock vive en la HOJA (variante > atributo) y el
// del producto es un DERIVADO: `sincronizarStockProducto` lo recalcula como la
// suma de sus tallas activas (y la talla, como la suma de sus colores).
// Una línea que sale del nivel de ARRIBA descuadra el árbol en silencio:
//   · producto con tallas, sin talla → baja el producto y ninguna talla; las
//     tallas siguen contando la unidad vendida y el primer ajuste de cualquier
//     talla la REVIVE en el inventario;
//   · talla con colores, sin color → baja la talla y la sincronización que va
//     justo detrás la recalcula desde los colores: la venta no descuenta nada.
// Tesla, 24–26 sep-2026: facturas #172 y #199 y cuatro préstamos de Bunny
// salieron así. La causa en pantalla era que el árbol no cargaba (límite de
// peticiones) y se pintaba como «este producto no tiene atributos», con el
// botón de agregar el producto entero; el backend lo aceptaba.
//
// Es la misma regla que ya imponen la red interna y las compras
// (`VARIANTE_REQUERIDA`). Solo aplica con `variantes_activo = '1'`: un negocio
// que apaga la feature deja de ver el árbol y tiene que poder seguir vendiendo
// el producto como antes. Solo mira lo que SALE: devolver o cancelar una línea
// vieja sin talla sigue funcionando igual.
// ─────────────────────────────────────────────────────────────────────────────

const LISTA_MAX = 4;

const _lista = (valores) =>
  valores.slice(0, LISTA_MAX - 1).join(', ') + (valores.length >= LISTA_MAX ? '…' : '');

/**
 * Lanza 400 `VARIANTE_REQUERIDA` si la línea sale de un nodo que tiene hijos
 * activos. Una sola consulta en el caso normal (línea con variante: ninguna).
 *
 * @param {object} client     cliente pg dentro de la transacción
 * @param {object} linea      { productoId, atributoId, varianteId, sucursalId, nombre }
 * @param {string} accion     verbo para el mensaje: 'vender' | 'prestar'
 */
const exigirVarianteSiTiene = async (client, {
  productoId, atributoId = null, varianteId = null, sucursalId, nombre,
}, accion = 'vender') => {
  if (!productoId || varianteId) return;

  const { rows } = await client.query(
    `SELECT
       (SELECT c.valor FROM config_negocio c JOIN sucursales s ON s.negocio_id = c.negocio_id
        WHERE s.id = $3 AND c.clave = 'variantes_activo' LIMIT 1) AS activo,
       ARRAY(
         SELECT h.valor FROM (
           SELECT ap.id, ap.valor FROM atributos_producto ap
           WHERE $2::int IS NULL AND ap.producto_id = $1 AND ap.activo = true
           UNION ALL
           SELECT v.id, v.valor FROM variantes_atributo v
           WHERE $2::int IS NOT NULL AND v.atributo_id = $2 AND v.activo = true
         ) h ORDER BY h.id LIMIT ${LISTA_MAX}
       ) AS hijos`,
    [productoId, atributoId, sucursalId]
  );
  const { activo, hijos } = rows[0] || {};
  if (activo !== '1' || !hijos?.length) return;

  const etiqueta = nombre || 'Este producto';
  throw {
    status: 400,
    code: 'VARIANTE_REQUERIDA',
    message: atributoId
      ? `"${etiqueta}" se divide en sub-variantes (${_lista(hijos)}): elige cuál vas a ${accion}. `
        + 'Quítalo del carrito y vuelve a agregarlo desde el producto.'
      : `"${etiqueta}" se maneja por variantes (${_lista(hijos)}): elige cuál vas a ${accion}. `
        + 'Quítalo del carrito y vuelve a agregarlo desde el producto; si no te aparecen las '
        + 'variantes, espera un momento y ábrelo otra vez.',
  };
};

module.exports = { exigirVarianteSiTiene };
