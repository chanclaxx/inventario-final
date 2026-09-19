// ─────────────────────────────────────────────────────────────────────────────
// PRECIO MÍNIMO DE VENTA (feature opt-in: `precio_minimo_activo`)
//
// Encendido, nadie factura ni despacha por debajo del MENOR de los precios que
// el producto tiene escritos: el predeterminado y, con las listas de precios
// activas, el de cada lista. Sin ningún precio escrito no hay piso.
//
// Quien manda es el backend (`backend/src/utils/precioMinimo.util.js`): esto
// solo lo dice ANTES de enviar. `pisoDePrecios` está duplicada a mano con la de
// allá y la prueba `56-precio-minimo` corre las dos sobre los mismos casos.
// ─────────────────────────────────────────────────────────────────────────────
// Con extensión: la prueba del backend importa este archivo con Node puro.
import { parsearListas } from './listasPrecios.js';

const _positivo = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const _mapaPrecios = (crudo) => {
  let obj = crudo;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return {}; }
  }
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
};

/** El piso de un nodo, o null si no tiene ningún precio escrito. */
export const pisoDePrecios = ({ precio, precios, listaIds = [] }) => {
  const candidatos = [];
  const base = _positivo(precio);
  if (base != null) candidatos.push(base);

  const mapa = _mapaPrecios(precios);
  for (const id of listaIds) {
    const v = _positivo(mapa[id]);
    if (v != null) candidatos.push(v);
  }
  return candidatos.length ? Math.min(...candidatos) : null;
};

/** Lee la regla del objeto plano de GET /config. */
export const leerConfigPrecioMinimo = (config) => {
  const cfg = config || {};
  const conListas = cfg.listas_precios_activo === '1';
  return {
    activo:   cfg.precio_minimo_activo === '1',
    listaIds: conListas ? parsearListas(cfg.listas_precios_lista).map((l) => l.id) : [],
  };
};

/**
 * Piso de un ítem del carrito: `precio` es el predeterminado (el de siempre,
 * no el que se está cobrando) y `precios` las listas ya heredadas.
 */
export const pisoItemCarrito = (item, regla) => {
  if (!regla?.activo || !item) return null;
  return pisoDePrecios({ precio: item.precio, precios: item.precios, listaIds: regla.listaIds });
};

/** Mismo medio peso de tolerancia que el backend. */
export const bajoMinimo = (valor, piso) =>
  piso != null && !(Number(valor) + 0.5 >= piso);

/** Ítems del carrito cuyo precio a cobrar quedó por debajo de su piso. */
export const itemsBajoMinimo = (items, regla) => {
  if (!regla?.activo) return [];
  return (items || [])
    .map((i) => ({ item: i, piso: pisoItemCarrito(i, regla) }))
    .filter(({ item, piso }) => bajoMinimo(item.precioFinal, piso));
};
