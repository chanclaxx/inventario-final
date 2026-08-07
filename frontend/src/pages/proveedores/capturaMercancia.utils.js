// ─────────────────────────────────────────────────────────────────────────────
// CAPTURA DE MERCANCÍA QUE ENTRA — piezas compartidas
//
// Las usan `ModalCompra` (compra suelta) y `ModalRecibir` (recepción contra una
// orden). Viven aquí y NO duplicadas en cada modal a propósito: son la única
// forma de que un IMEI capturado al recibir traiga el mismo color y las mismas
// características que uno capturado en una compra normal. Dos copias se
// desincronizan y acaban guardando datos distintos para la misma cosa — es
// exactamente lo que ya pasó con `nombreColumnaCaracteristica` en la
// importación, y por eso allá también se compartió.
//
// TODO lo de aquí es ADAPTATIVO: qué campos se piden sale de la configuración
// del negocio (`colores_serial_activo`, `caracteristicas_serial_activo`,
// `variantes_activo`). Un negocio que no active nada ve solo la casilla del IMEI
// o la cantidad, igual que siempre.
// ─────────────────────────────────────────────────────────────────────────────

// ── Forma de un item de serial ───────────────────────────────────────────────
//
// Sin colores ni características, un IMEI es un STRING pelado (así estaba antes
// de que existieran esas features, y así se sigue guardando para no obligar a
// migrar nada). Con alguna activa, pasa a ser { imei, color, caracteristicas }.
// Estos tres lectores aceptan las dos formas para que ningún componente tenga
// que saber en cuál está.

export function extraerImei(item) {
  if (typeof item === 'string') return item;
  return item?.imei || '';
}

export function extraerColor(item) {
  if (typeof item === 'string') return null;
  return item?.color?.trim() || null;
}

export function extraerCaracteristicas(item) {
  if (typeof item === 'string') return {};
  return (item?.caracteristicas && typeof item.caracteristicas === 'object')
    ? item.caracteristicas
    : {};
}

export function parsearColoresConfig(configData) {
  try {
    const lista = JSON.parse(configData?.colores_serial_lista || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

export function parsearCaracteristicasConfig(configData) {
  try {
    const lista = JSON.parse(configData?.caracteristicas_serial_lista || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/**
 * ¿La captura necesita objetos en vez de strings? Es la MISMA pregunta en todos
 * los sitios, y por eso se responde en un solo lugar: si se separan, un modal
 * guardaría objetos y otro strings para el mismo negocio.
 */
export function usaItemObjeto(coloresActivo, caracteristicasActivo, caracteristicasLista) {
  return Boolean(coloresActivo || (caracteristicasActivo && caracteristicasLista?.length > 0));
}

/** Item vacío con la forma que corresponda a la configuración del negocio. */
export function itemSerialVacio(coloresActivo, caracteristicasActivo, caracteristicasLista) {
  return usaItemObjeto(coloresActivo, caracteristicasActivo, caracteristicasLista)
    ? { imei: '', color: '', caracteristicas: {} }
    : '';
}

/**
 * Aplana el árbol de un producto a sus HOJAS: los nodos sobre los que de verdad
 * se mueve el stock.
 *
 * Un atributo con variantes debajo NO es hoja (su stock es la suma de ellas);
 * un atributo sin variantes SÍ. Es la misma regla que aplica el backend, y de
 * ella depende que el stock no se escriba en el sitio equivocado.
 */
const labelNodo = (n) => (n.tipo_nombre ? `${n.tipo_nombre}: ${n.valor}` : n.valor);

export function hojasDelArbol(arbol) {
  return (arbol || []).flatMap((atr) => {
    if (atr.variantes?.length > 0) {
      return atr.variantes.map((v) => ({
        key: `v-${v.id}`, id: v.id, tipo: 'variante',
        labelPadre: labelNodo(atr), label: labelNodo(v), stock: v.stock,
      }));
    }
    return [{ key: `a-${atr.id}`, id: atr.id, tipo: 'atributo', label: labelNodo(atr), stock: atr.stock }];
  });
}
