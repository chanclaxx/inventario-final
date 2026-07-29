import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { calcularPrecioTarifa, ORIGEN_LISTA, ORIGEN_TARIFA, ORIGEN_MANUAL } from '../utils/tarifas';

// ─────────────────────────────────────────────────────────────────────────────
// Carrito compartido por facturas, préstamos, traslados y despachos de red.
//
// Cada ítem lleva:
//   precio        → precio de lista del producto (nunca se modifica)
//   precioFinal   → el que se cobra; es lo que viaja a /facturas y /prestamos
//   costo         → costo del producto, solo para calcular tarifas porcentuales.
//                   Puede ser null (producto sin costo registrado, o ítem
//                   guardado en localStorage antes de existir esta feature).
//   tarifa_id     → tarifa aplicada, o null si el precio es de lista/manual
//   origen_precio → 'lista' | 'tarifa' | 'manual' (solo informativo en la UI)
//
// `costo`, `tarifa_id` y `origen_precio` son inertes para quien no usa tarifas:
// ningún payload de la API los incluye.
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normaliza un ítem recién agregado. `costo` es opcional. */
const _itemNuevo = (item) => ({
  ...item,
  precioFinal:   item.precio,
  costo:         item.costo != null && Number.isFinite(Number(item.costo)) && Number(item.costo) > 0
    ? Number(item.costo)
    : null,
  tarifa_id:     null,
  origen_precio: ORIGEN_LISTA,
});

/**
 * Devuelve el ítem con la tarifa aplicada, o sin tocar si no es calculable.
 * Los ítems que ya estaban en localStorage antes de esta feature no traen
 * `costo`: caen aquí en el camino "sin costo" y conservan su precio.
 */
const _conTarifa = (item, tarifa, opciones) => {
  if (!tarifa) {
    // Quitar la tarifa devuelve el precio de lista original.
    return { ...item, precioFinal: item.precio, tarifa_id: null, origen_precio: ORIGEN_LISTA };
  }
  const precio = calcularPrecioTarifa(item.costo, tarifa, opciones);
  if (precio == null) return item;
  return { ...item, precioFinal: precio, tarifa_id: tarifa.id, origen_precio: ORIGEN_TARIFA };
};

// ── Store ────────────────────────────────────────────────────────────────────

const useCarritoStore = create(
  persist(
    (set, get) => ({
      items: [],

      agregarItem: (item) => {
        const items = get().items;
        const existe = items.find((i) => i.key === item.key);
        if (existe) return;
        set({ items: [...items, _itemNuevo(item)] });
      },

      // Escaneo de código único: si el producto ya está en el carrito suma 1
      // (tope: stock disponible) en vez de ignorarlo como agregarItem.
      // Devuelve 'agregado' | 'incrementado' | 'sin_stock'.
      agregarOIncrementar: (item) => {
        const items  = get().items;
        const existe = items.find((i) => i.key === item.key);
        if (!existe) {
          set({ items: [...items, _itemNuevo(item)] });
          return 'agregado';
        }
        const tope = existe.stock != null ? Number(existe.stock) : Infinity;
        if ((existe.cantidad || 1) >= tope) return 'sin_stock';
        set({
          items: items.map((i) =>
            i.key === item.key ? { ...i, cantidad: (i.cantidad || 1) + 1 } : i
          ),
        });
        return 'incrementado';
      },

      actualizarPrecio: (key, precioFinal) => {
        set({
          items: get().items.map((i) =>
            i.key === key
              // Editar a mano descarta la tarifa: el precio dejó de derivarse
              // del costo y el chip debe reflejarlo.
              ? { ...i, precioFinal: Number(precioFinal), tarifa_id: null, origen_precio: ORIGEN_MANUAL }
              : i
          ),
        });
      },

      actualizarCantidad: (key, cantidad) => {
        set({
          items: get().items.map((i) =>
            i.key === key ? { ...i, cantidad: Math.max(1, Number(cantidad)) } : i
          ),
        });
      },

      // ── Tarifas porcentuales sobre el costo (feature opt-in) ───────────────
      // `tarifa` null devuelve el ítem a su precio de lista. Un ítem sin costo
      // se deja intacto: mejor conservar su precio que ponerle 0.

      aplicarTarifa: (key, tarifa, opciones = {}) => {
        set({
          items: get().items.map((i) =>
            i.key === key ? _conTarifa(i, tarifa, opciones) : i
          ),
        });
      },

      aplicarTarifaATodos: (tarifa, opciones = {}) => {
        set({ items: get().items.map((i) => _conTarifa(i, tarifa, opciones)) });
      },

      eliminarItem: (key) => {
        set({ items: get().items.filter((i) => i.key !== key) });
      },

      limpiarCarrito: () => set({ items: [] }),

      totalCarrito: () => {
        return get().items.reduce((sum, i) => {
          const cantidad = i.cantidad || 1;
          return sum + i.precioFinal * cantidad;
        }, 0);
      },

      cantidadItems: () => get().items.length,
    }),
    {
      name: 'carrito-inventario',
    }
  )
);

export default useCarritoStore;
