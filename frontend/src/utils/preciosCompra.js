// ─────────────────────────────────────────────────────────────────────────────
// PRECIOS DE VENTA AL COMPRAR (pedido del usuario, 14-oct-2026)
//
// Con las listas de precios encendidas, toda pantalla donde entra mercancía
// —compra a proveedor, pedido (orden de compra), recepción de una orden, y
// agregar stock / compra a cliente desde Inventario— muestra los precios de
// venta de lo que se está comprando y deja corregirlos o ponerlos en el mismo
// momento. Es cuando el negocio está mirando el costo, y es cuando decide.
//
// Este archivo es PURO (sin React ni red): qué filas pintar a partir de las
// líneas de la compra, qué valor muestra cada casilla, qué se hereda y qué se
// manda a guardar. La pantalla es `components/compras/PreciosVentaCompra.jsx`
// y el estado vive en `hooks/usePreciosCompra.js`.
//
// ── Las reglas, que son las del editor «Precios por lista» ──────────────────
//   · Se edita el nodo que se compra: la talla o el color si la línea baja a
//     la variante, y el producto (o la referencia con IMEI) siempre. Una casilla
//     vacía HEREDA del nivel de arriba, igual que en la venta.
//   · Solo se guarda lo que se tocó, y con el mapa COMPLETO de ese nodo (el
//     backend reemplaza la columna): las listas que nadie editó se conservan.
//   · Lo que se tocó y después se quitó de la compra NO se guarda.
//   · Escribir pasa por el mismo `PUT /listas-precios/nodos` y su permiso.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizarPrecios, precioEnLista } from './listasPrecios.js';

export const claveNodo = (nivel, id) => `${nivel}:${id}`;

const _num = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Las filas que pide una línea, del producto hacia abajo, como claves.
 * `linea` = { tipo: 'cantidad'|'serial', producto_id, atributo_id?, variante_id? }
 */
const _clavesDeLinea = (l) => {
  const pid = _num(l?.producto_id);
  if (!pid) return [];
  if (l.tipo === 'serial') return [claveNodo('serial', pid)];
  const out = [claveNodo('producto', pid)];
  const vid = _num(l.variante_id);
  const aid = _num(l.atributo_id);
  if (vid) out.push(claveNodo('variante', vid));
  else if (aid) out.push(claveNodo('atributo', aid));
  return out;
};

/** Los productos a consultar, sin repetir y en orden estable. */
export const productosDeLineas = (lineas) => {
  const cantidad = new Set();
  const serial   = new Set();
  for (const l of lineas || []) {
    const pid = _num(l?.producto_id);
    if (!pid) continue;
    (l.tipo === 'serial' ? serial : cantidad).add(pid);
  }
  return {
    cantidad: [...cantidad].sort((a, b) => a - b),
    serial:   [...serial].sort((a, b) => a - b),
  };
};

/** Las claves de los nodos que la compra muestra HOY: lo único que se guarda. */
export const clavesVigentes = (lineas) =>
  new Set((lineas || []).flatMap(_clavesDeLinea));

/**
 * Los grupos a pintar: uno por producto (en el orden en que aparecen en la
 * compra), con la fila del producto primero y debajo cada talla o color que se
 * está comprando. `datos` son las filas de `GET /listas-precios/compra`.
 *
 * Cada fila trae `cadena`: los nodos de arriba, del más general al más
 * específico, que es de donde hereda (producto → talla → color).
 */
export const armarGrupos = (lineas, datos) => {
  const porClave = new Map();
  for (const d of datos || []) porClave.set(claveNodo(d.nivel, d.id), d);

  const grupos = new Map();
  for (const l of lineas || []) {
    const claves = _clavesDeLinea(l);
    if (!claves.length) continue;
    const raiz = porClave.get(claves[0]);
    if (!raiz) continue;                      // borrado, o de otro negocio
    if (!grupos.has(claves[0])) {
      grupos.set(claves[0], {
        clave: claves[0],
        filas: [{ ...raiz, clave: claves[0], cadena: [], sangria: 0 }],
      });
    }
    const grupo = grupos.get(claves[0]);
    for (const clave of claves.slice(1)) {
      if (grupo.filas.some((f) => f.clave === clave)) continue;
      const nodo = porClave.get(clave);
      if (!nodo) continue;
      const cadena = [raiz];
      if (nodo.nivel === 'variante') {
        const padre = porClave.get(claveNodo('atributo', nodo.atributo_id));
        if (padre) cadena.push(padre);
      }
      grupo.filas.push({ ...nodo, clave, cadena, sangria: 1 });
    }
  }
  return [...grupos.values()];
};

/** Lo que muestra la casilla de un nodo en una lista: lo editado, o lo guardado. */
export const valorEnLista = (nodo, listaId, cambios) => {
  const c = cambios?.[claveNodo(nodo.nivel, nodo.id)];
  if (c && Object.prototype.hasOwnProperty.call(c.valores, listaId)) return c.valores[listaId];
  return precioEnLista(nodo.precios, listaId) ?? '';
};

/**
 * Lo que se hereda en esa lista: el valor del nivel de arriba más cercano que
 * tenga uno, contando lo que se acaba de escribir (escribir el precio del
 * producto se ve al instante en sus tallas). null = no hay nada que heredar.
 */
export const heredadoEnLista = (cadena, listaId, cambios) => {
  for (let i = (cadena || []).length - 1; i >= 0; i--) {
    const v = Number(valorEnLista(cadena[i], listaId, cambios));
    if (Number.isFinite(v) && v > 0) return Math.round(v);
  }
  return null;
};

/** ¿La casilla quedó distinta de lo guardado? Para marcarla en pantalla. */
export const casillaCambiada = (nodo, listaId, cambios) => {
  const guardado = precioEnLista(nodo.precios, listaId);
  const v = Number(valorEnLista(nodo, listaId, cambios));
  const actual = Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  return actual !== guardado;
};

const _iguales = (a, b) => {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

/**
 * Lo que hay que mandar a `PUT /listas-precios/nodos`.
 *
 * `cambios[clave]` = { nivel, id, base, valores: { listaId: '7000' | '' } },
 * donde `base` es el mapa guardado del nodo cuando se empezó a editar. Se manda
 * el mapa COMPLETO (base + lo editado): las listas no tocadas se conservan, y
 * una casilla vaciada a propósito se quita. Lo que quedó igual no viaja, y lo
 * que ya no está en la compra (`vigentes`) tampoco.
 */
export const nodosAGuardar = (cambios, listas, vigentes = null) => {
  const ids = new Set((listas || []).map((l) => l.id));
  const out = [];
  for (const [clave, c] of Object.entries(cambios || {})) {
    if (vigentes && !vigentes.has(clave)) continue;
    const base  = normalizarPrecios(c.base) || {};
    const nuevo = { ...base };
    for (const [listaId, crudo] of Object.entries(c.valores || {})) {
      if (!ids.has(listaId)) continue;
      const n = Number(crudo);
      if (Number.isFinite(n) && n > 0) nuevo[listaId] = Math.round(n);
      else delete nuevo[listaId];
    }
    if (_iguales(normalizarPrecios(nuevo) || {}, base)) continue;
    out.push({ nivel: c.nivel, id: c.id, precios: nuevo });
  }
  return out;
};
