import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Store global de sucursal activa.
 *
 * Reglas de negocio:
 *   - vendedor / supervisor : el backend resuelve por token; este store no aplica.
 *   - admin_negocio         : puede elegir sucursal específica.
 *
 * Valores de `sucursalActiva`:
 *   null      → sin selección (estado inicial o tras logout)
 *   number    → id de sucursal específica
 *
 * `negocioId` se persiste junto con `sucursalActiva` para invalidar la
 * selección si el admin inicia sesión en un negocio diferente.
 */
const useSucursalStore = create(
  persist(
    (set, get) => ({
      sucursalActiva : null,  // null | number
      sucursales     : [],    // sucursales activas del negocio (sin persistir)
      negocioId      : null,  // negocio_id persistido para validación entre sesiones

      // ── Getters ──────────────────────────────────────────────
      // esVistaGlobal se mantiene por compatibilidad con componentes que lo usan,
      // pero siempre retorna false (ya no existe vista global).
      esVistaGlobal   : () => false,
      sucursalParam   : () => get().sucursalActiva ?? null,
      esUnicaSucursal : () => get().sucursales.length === 1,

      // ── Setters ──────────────────────────────────────────────
      setSucursal : (valor) => set({ sucursalActiva: valor }),

      /**
       * Recibe la lista fresca del backend y el negocio_id del admin activo.
       *
       * Prioridad de selección:
       *   1. Si solo hay 1 sucursal → selección automática.
       *   2. Si el negocio cambió respecto al persistido → primera sucursal.
       *   3. Si sucursalActiva es null o 'todas' (migración) → primera sucursal.
       *   4. Si la selección previa ya no existe en la lista → primera sucursal.
       *   5. Si la selección previa sigue siendo válida → mantenerla.
       */
      setSucursales : (lista, negocioIdActual) => {
        const { sucursalActiva, negocioId: negocioIdPersistido } = get();

        set({ sucursales: lista, negocioId: negocioIdActual ?? negocioIdPersistido });

        if (lista.length === 0) return;

        // Caso 1: única sucursal → auto-seleccionar siempre
        if (lista.length === 1) {
          set({ sucursalActiva: lista[0].id });
          return;
        }

        // Caso 2: cambio de negocio → limpiar selección anterior
        const negocioCambio =
          negocioIdActual != null &&
          negocioIdPersistido != null &&
          negocioIdActual !== negocioIdPersistido;

        if (negocioCambio) {
          set({ sucursalActiva: lista[0].id });
          return;
        }

        // Caso 3: sin selección previa, o migración desde 'todas' → primera sucursal
        if (sucursalActiva === null || sucursalActiva === 'todas') {
          set({ sucursalActiva: lista[0].id });
          return;
        }

        // Caso 4: la selección previa ya no existe en este negocio → primera sucursal
        const seleccionValida = lista.some((s) => s.id === sucursalActiva);

        if (!seleccionValida) {
          set({ sucursalActiva: lista[0].id });
        }
        // Caso 5: selección previa válida → no tocar nada
      },

      reset : () => set({ sucursalActiva: null, sucursales: [], negocioId: null }),
    }),
    {
      name       : 'sucursal-store',
      partialize : (state) => ({
        sucursalActiva : state.sucursalActiva,
        negocioId      : state.negocioId,
      }),
    }
  )
);

export default useSucursalStore;