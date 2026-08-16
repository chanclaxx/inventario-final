import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { calcularPrecioTarifa, ORIGEN_LISTA, ORIGEN_TARIFA, ORIGEN_MANUAL } from '../utils/tarifas';
import { choca } from '../utils/reservas';

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

      // ── Borradores de venta (feature opt-in) ──────────────────────────────
      // De qué borrador salió lo que hay en el carrito, o null si se armó a
      // mano. Solo sirve para descartar ese borrador cuando la venta se
      // concreta: el borrador SOBREVIVE mientras el carrito se trabaja, para
      // que cerrar el navegador o cambiar de sucursal no lo pierdan.
      borradorOrigenId: null,

      cargarDesdeBorrador: (items, borradorId) =>
        set({ items, borradorOrigenId: borradorId }),

      // La venta se concretó: el carrito se vacía y el borrador ya se descartó
      // en el backend. Equivale a limpiarCarrito, pero se nombra aparte porque
      // quien lo llama sabe que hubo venta.
      olvidarBorradorOrigen: () => set({ borradorOrigenId: null }),

      // ── Bloqueo blando: índice de mercancía apalabrada ────────────────────
      //
      // `reservas` es un mapa item_key → { total, entradas[] } que un hook
      // sincroniza desde React Query (useSincronizarReservas). Vive AQUÍ y no
      // en los componentes por una razón concreta: así el chequeo ocurre dentro
      // de agregarItem, y los NUEVE sitios que agregan al carrito lo heredan
      // sin tocarlos — igual que el décimo que alguien escriba mañana.
      //
      // Es una consulta en memoria: se dispara en cada toque de la lista de
      // inventario y no puede costar un viaje al servidor.
      //
      // Con la feature apagada `reservas` es {} y agregarItem se comporta
      // exactamente como antes de que esto existiera.
      reservas: {},
      setReservas: (reservas) => set({ reservas }),

      // Choque pendiente de resolver. Un único <ModalConflictoBorrador/>
      // montado en InventarioPage lo consume; por eso el estado va en el store
      // y no en cada sitio que agrega.
      conflicto: null,
      cancelarConflicto: () => set({ conflicto: null }),

      agregarItem: (item) => {
        const items = get().items;
        const existe = items.find((i) => i.key === item.key);
        if (existe) return;

        // Apalabrado en un borrador: no se agrega, se pide permiso.
        const reserva = get().reservas[item.key];
        if (choca(item, reserva, 1)) return set({ conflicto: { item, reserva } });

        set({ items: [...items, _itemNuevo(item)] });
      },

      // Agrega saltándose el chequeo de reservas. Solo lo llama el modal de
      // conflicto, después de que el usuario decidió quitar el producto del
      // borrador que lo tenía apartado.
      forzarAgregar: (item) => {
        const items = get().items;
        const existe = items.find((i) => i.key === item.key);
        set({
          conflicto: null,
          items: existe
            ? items.map((i) =>
                i.key === item.key ? { ...i, cantidad: (i.cantidad || 1) + 1 } : i
              )
            : [...items, _itemNuevo(item)],
        });
      },

      // Escaneo de código único: si el producto ya está en el carrito suma 1
      // (tope: stock disponible) en vez de ignorarlo como agregarItem.
      // Devuelve 'agregado' | 'incrementado' | 'sin_stock' | 'reservado'.
      agregarOIncrementar: (item) => {
        const items  = get().items;
        const existe = items.find((i) => i.key === item.key);
        const enCarrito = existe ? (existe.cantidad || 1) : 0;

        // El escáner suma de a uno, así que lo que se pide es lo que ya hay
        // en el carrito más esta unidad: pasar solo 1 dejaría colar la número
        // 200 de un producto con 199 libres.
        const reserva = get().reservas[item.key];
        if (choca(item, reserva, enCarrito + 1)) {
          set({ conflicto: { item, reserva } });
          return 'reservado';
        }

        if (!existe) {
          set({ items: [...items, _itemNuevo(item)] });
          return 'agregado';
        }
        const tope = existe.stock != null ? Number(existe.stock) : Infinity;
        if (enCarrito >= tope) return 'sin_stock';
        set({
          items: items.map((i) =>
            i.key === item.key ? { ...i, cantidad: enCarrito + 1 } : i
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

      // `borradorOrigenId` se resetea SIEMPRE junto con los ítems, y eso no es
      // cosmético: SucursalSelector llama a limpiarCarrito() al cambiar de
      // sucursal. Sin este reset, cargar un borrador en Sansur, cambiar a
      // Principal y facturar allá borraría el borrador de Sansur, que nadie
      // vendió. (El backend lo bloquea además por su lado — todo DELETE lleva
      // sucursal_id —, pero el estado no debe quedar mintiendo.)
      // `reservas` también se limpia: SucursalSelector llama aquí al cambiar de
      // sucursal, y las reservas de Sansur no pueden seguir bloqueando
      // productos de Principal durante el segundo que tarda el refetch.
      limpiarCarrito: () => set({
        items: [], borradorOrigenId: null, reservas: {}, conflicto: null,
      }),

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
      // `reservas` y `conflicto` NO se persisten: son estado derivado del
      // servidor y de la interacción del momento. Guardar las reservas en
      // localStorage haría que al recargar la página bloquearan con la foto de
      // ayer, antes de que el refetch traiga la de verdad — y un borrador que
      // alguien ya descartó seguiría estorbando.
      partialize: (state) => ({
        items:            state.items,
        borradorOrigenId: state.borradorOrigenId,
      }),
    }
  )
);

export default useCarritoStore;
