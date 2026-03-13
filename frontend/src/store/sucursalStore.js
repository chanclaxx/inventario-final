import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Store global de sucursal activa.
 *
 * Reglas de negocio:
 *   - vendedor / supervisor : el backend resuelve por token; este store no aplica.
 *   - admin_negocio         : puede elegir sucursal específica o "todas".
 *
 * Valores de `sucursalActiva`:
 *   null      → sin selección (estado inicial o tras logout)
 *   'todas'   → vista global (envía sucursal_id=todas al backend)
 *   number    → id de sucursal específica
 */
const useSucursalStore = create(
  persist(
    (set, get) => ({
      sucursalActiva : null,  // null | 'todas' | number
      sucursales     : [],    // sucursales activas del negocio (sin persistir)

      // ── Getters ──────────────────────────────────────────────
      esVistaGlobal   : () => get().sucursalActiva === 'todas',
      sucursalParam   : () => get().sucursalActiva ?? null,
      esUnicaSucursal : () => get().sucursales.length === 1,

      // ── Setters ──────────────────────────────────────────────
      setSucursal : (valor) => set({ sucursalActiva: valor }),

      /**
       * Recibe la lista fresca del backend.
       * - 1 sucursal  → selección automática; selector no se muestra.
       * - >1 sucursal → mantiene selección previa válida o toma la primera.
       */
      setSucursales : (lista) => {
        const { sucursalActiva } = get();
        set({ sucursales: lista });

        if (lista.length === 1) {
          set({ sucursalActiva: lista[0].id });
          return;
        }

        const seleccionValida =
          sucursalActiva === 'todas' ||
          lista.some((s) => s.id === sucursalActiva);

        if (!seleccionValida) {
          set({ sucursalActiva: lista[0]?.id ?? null });
        }
      },

      reset : () => set({ sucursalActiva: null, sucursales: [] }),
    }),
    {
      name       : 'sucursal-store',
      partialize : (state) => ({ sucursalActiva: state.sucursalActiva }),
    }
  )
);

export default useSucursalStore;