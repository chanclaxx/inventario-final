import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useCarritoStore = create(
  persist(
    (set, get) => ({
      items: [],

      agregarItem: (item) => {
        const items = get().items;
        const existe = items.find((i) => i.key === item.key);
        if (existe) return;
        set({ items: [...items, { ...item, precioFinal: item.precio }] });
      },

      // Escaneo de código único: si el producto ya está en el carrito suma 1
      // (tope: stock disponible) en vez de ignorarlo como agregarItem.
      // Devuelve 'agregado' | 'incrementado' | 'sin_stock'.
      agregarOIncrementar: (item) => {
        const items  = get().items;
        const existe = items.find((i) => i.key === item.key);
        if (!existe) {
          set({ items: [...items, { ...item, precioFinal: item.precio }] });
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
            i.key === key ? { ...i, precioFinal: Number(precioFinal) } : i
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