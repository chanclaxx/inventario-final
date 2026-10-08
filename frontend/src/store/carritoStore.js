import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { calcularPrecioTarifa, ORIGEN_LISTA, ORIGEN_TARIFA, ORIGEN_MANUAL } from '../utils/tarifas';
import { choca, mismasReservas } from '../utils/reservas';
import {
  resolverPrecioItem, ORIGEN_LISTA_PRECIO, esItemSoloListas, precioBaseSoloListas,
} from '../utils/listasPrecios';
import { ORIGEN_OBSEQUIO } from '../utils/obsequios';

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

// ─────────────────────────────────────────────────────────────────────────────
// VENDER SOLO CON LISTAS (opt-in por sede; `solo` null = como siempre)
//
// En una sede que lo encendió, un producto POR CANTIDAD no usa su precio
// predeterminado: su `precio` base pasa a ser el de la LISTA PRINCIPAL (o 0 =
// «sin precio»). Se cambia AQUÍ, en el `precio` del ítem, y no en cada cálculo:
// todo lo que cae al «precio de siempre» —quitar la lista, la lista que no lo
// menciona, desmarcar un obsequio, el piso del precio mínimo, el valor que
// viaja al despacho— lee ese campo, así que lo hereda sin tocarse. Y las doce
// pantallas que agregan al carrito siguen mandando lo que mandaban: varias
// caían a `precio || costo`, y eso aquí deja de llegar al cliente.
//
// El predeterminado original se guarda en `precio_normal` para poder devolverlo
// si la sede apaga la función con el carrito lleno.
//
// `precios === undefined` es «no sé» (un borrador cargado no trae el mapa) y
// ese ítem no se toca: rebajarlo a 0 sería borrar el precio que se negoció.
// Los equipos con IMEI nunca entran (decisión del negocio).
// ─────────────────────────────────────────────────────────────────────────────
const _conBase = (item, solo) => {
  if (!solo || !esItemSoloListas(item) || item.precios === undefined) {
    if (!item.solo_listas) return item;
    const { solo_listas: _marca, precio_normal: normal, ...resto } = item;
    return { ...resto, precio: normal ?? resto.precio };
  }
  const base = precioBaseSoloListas(item.precios, solo.principalId);
  if (item.solo_listas && item.precio === base) return item;
  return {
    ...item,
    precio_normal: item.solo_listas ? item.precio_normal : item.precio,
    precio:        base,
    solo_listas:   true,
  };
};

/**
 * Reacomoda un ítem que YA estaba en el carrito cuando cambia la regla de la
 * sede (la config terminó de cargar, o el admin la encendió). Lo escrito a
 * mano y los obsequios conservan lo que cobran: solo se les corrige la base.
 */
const _reubicar = (item, solo) => {
  const base = _conBase(item, solo);
  if (base === item) return item;
  if (item.obsequio || item.origen_precio === ORIGEN_MANUAL || item.tarifa_id) return base;
  return _conLista(base, item.lista_precio_id ? { id: item.lista_precio_id } : null);
};

/** Normaliza un ítem recién agregado. `costo` es opcional. */
const _itemNuevo = (crudo, listaActiva = null, solo = null) => _itemNormalizado(_conBase(crudo, solo), listaActiva);

const _itemNormalizado = (item, listaActiva) => ({
  ...item,
  precioFinal:   item.precio,
  costo:         item.costo != null && Number.isFinite(Number(item.costo)) && Number(item.costo) > 0
    ? Number(item.costo)
    : null,
  tarifa_id:     null,
  origen_precio: ORIGEN_LISTA,
  // La lista elegida es PEGAJOSA: se aplica sola a todo lo que entre después.
  // Es lo que hace que el vendedor de un local mayorista elija una vez al día
  // y no una vez por producto — que es justo la fricción que hace que la gente
  // deje de usar la función y vuelva a teclear precios de memoria.
  ...(listaActiva ? _conLista({ ...item, precioFinal: item.precio }, listaActiva) : null),
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

// ─────────────────────────────────────────────────────────────────────────────
// LISTAS DE PRECIOS (feature opt-in, excluyente con las tarifas)
//
// Devuelve el ítem con la lista aplicada. `lista` null lo devuelve a su precio
// de siempre.
//
// Un producto que la lista no menciona NO se queda en cero ni se salta: cae a
// su `precio` de lista y se marca con `sin_precio_en_lista`, para que el
// carrito pueda decir «3 productos no están en “Al por mayor”». Una lista a
// medio llenar tiene que verse ANTES de cobrar, no después.
// ─────────────────────────────────────────────────────────────────────────────
const _conLista = (item, lista) => {
  if (!lista) {
    return {
      ...item,
      precioFinal: item.precio,
      lista_precio_id: null,
      sin_precio_en_lista: false,
      origen_precio: ORIGEN_LISTA,
    };
  }
  const { precio, deLista } = resolverPrecioItem(item, lista.id);
  return {
    ...item,
    precioFinal: precio,
    lista_precio_id: lista.id,
    sin_precio_en_lista: !deLista,
    // Si la lista no le puso precio, el número que se cobra es el de siempre:
    // decir que viene de la lista sería mentir sobre de dónde salió.
    origen_precio: deLista ? ORIGEN_LISTA_PRECIO : ORIGEN_LISTA,
  };
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

      // Lo que estaba diligenciado en el modal cuando se guardó: cliente,
      // método de pago, retoma a medio llenar. Lo consume ModalFactura /
      // ModalPrestamo al abrirse, para que el vendedor no reescriba nada.
      datosBorrador: null,

      cargarDesdeBorrador: (items, borradorId, datos = null) =>
        set({ items, borradorOrigenId: borradorId, datosBorrador: datos }),

      // El modal ya se hidrató. Se limpia para que no se vuelva a aplicar si el
      // vendedor cierra y reabre el modal habiendo cambiado cosas a mano.
      consumirDatosBorrador: () => set({ datosBorrador: null }),

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

      // No escribe si el contenido no cambió. `construirIndiceReservas` devuelve
      // siempre un objeto nuevo, así que sin esta guarda cada render de más se
      // vuelve una escritura al store, y esa escritura otro render: el bucle
      // infinito que ya tumbó la app (React #185). La causa de aquella vez está
      // arreglada en useBorradores, pero esto la hace imposible de repetir.
      setReservas: (reservas) => {
        if (mismasReservas(get().reservas, reservas)) return;
        set({ reservas });
      },

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

        set({ items: [...items, _itemNuevo(item, get().listaPrecioActiva, get().soloListas)] });
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
            : [...items, _itemNuevo(item, get().listaPrecioActiva, get().soloListas)],
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
          set({ items: [...items, _itemNuevo(item, get().listaPrecioActiva, get().soloListas)] });
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

      // ── Listas de precios (feature opt-in, excluyente con las tarifas) ────
      //
      // La lista elegida vive AQUÍ y no en el componente, y se persiste: es lo
      // que hace que se pegue a todo lo que entre después, incluso si el
      // vendedor recarga la página a media venta.
      //
      // Es por DISPOSITIVO a propósito. El mostrador de un local mayorista y el
      // de uno al detal son dos navegadores distintos, así que cada uno se queda
      // en su lista sin que nadie tenga que configurar nada por sucursal. Y un
      // dispositivo nuevo arranca en `null`, que es el precio de siempre: el
      // caso sin configurar nunca cobra de menos.
      listaPrecioActiva: null,

      // ── Vender solo con listas (opt-in POR SEDE) ──────────────────────────
      // `{ principalId }` cuando la sede abierta vende sus productos por
      // cantidad solo con listas; null = como siempre. Lo vuelca
      // `useSincronizarSoloListas` desde el query ['config'], igual que las
      // reservas: así la regla vive dentro de agregarItem. NO se persiste: es
      // una foto del servidor y de la sede elegida, y se repone al montar.
      soloListas: null,

      setSoloListas: (principalId) => {
        const nuevo = principalId ? { principalId } : null;
        if ((get().soloListas?.principalId ?? null) === (nuevo?.principalId ?? null)) return;
        set({ soloListas: nuevo, items: get().items.map((i) => _reubicar(i, nuevo)) });
      },

      aplicarListaPrecio: (key, lista) => {
        set({
          items: get().items.map((i) => (i.key === key ? _conLista(i, lista) : i)),
        });
      },

      // Aplica a todo el carrito Y se queda como lista activa. Las dos cosas
      // juntas: elegir «Al por mayor» con el carrito lleno tiene que reprecificar
      // lo que ya está y también lo que falte por escanear.
      aplicarListaPreciosATodos: (lista) => {
        set({
          listaPrecioActiva: lista || null,
          items: get().items.map((i) => _conLista(i, lista)),
        });
      },

      // ── Obsequios (va de la mano del precio mínimo) ───────────────────────
      //
      // Marcar un ítem como obsequio es decir «esto va con la venta y no se
      // cobra»: el precio se pone en 0 y ahí se queda. No es un precio
      // escrito a mano —por eso descarta la tarifa y la lista— y es LO ÚNICO
      // que deja pasar el candado del precio mínimo, porque el backend sabe
      // que es un regalo y va a contar su costo igual en la utilidad.
      //
      // Quitar la marca lo devuelve al precio que le tocaba: el de la lista
      // activa si hay una, y si no el suyo de siempre. Nunca se queda en 0:
      // un ítem a $0 sin marca es justo lo que el precio mínimo existe para
      // impedir.
      marcarObsequio: (key, esObsequio) => {
        set({
          items: get().items.map((i) => {
            if (i.key !== key) return i;
            if (esObsequio) {
              return {
                ...i, obsequio: true, precioFinal: 0,
                tarifa_id: null, lista_precio_id: null, sin_precio_en_lista: false,
                origen_precio: ORIGEN_OBSEQUIO,
              };
            }
            const { obsequio: _quitada, ...resto } = i;
            return _conLista(resto, get().listaPrecioActiva);
          }),
        });
      },

      actualizarPrecio: (key, precioFinal) => {
        set({
          items: get().items.map((i) =>
            i.key === key
              // Editar a mano descarta la tarifa: el precio dejó de derivarse
              // del costo y el chip debe reflejarlo.
              // Editar a mano descarta la tarifa Y la lista: el precio dejó
              // de venir de ninguna de las dos y el chip debe reflejarlo.
              // Escribir un precio a mano deja de ser un obsequio: un regalo
              // vale 0 y lo decide el botón, no el teclado.
              ? { ...i, precioFinal: Number(precioFinal), tarifa_id: null,
                  lista_precio_id: null, sin_precio_en_lista: false,
                  obsequio: false, origen_precio: ORIGEN_MANUAL }
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
      // `listaPrecioActiva` NO se resetea aquí, y es deliberado: vaciar el
      // carrito entre un cliente y el siguiente no significa que el mostrador
      // haya dejado de ser mayorista. Volver al precio de siempre en cada venta
      // obligaría a reelegir la lista veinte veces al día, que es la fricción
      // que esto viene a quitar. Se cambia tocando otro chip, que es explícito.
      limpiarCarrito: () => set({
        items: [], borradorOrigenId: null, datosBorrador: null,
        reservas: {}, conflicto: null,
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
        datosBorrador:    state.datosBorrador,
        // Sí se persiste, al revés que las reservas: no es una foto del
        // servidor sino una decisión del mostrador, y tiene que sobrevivir a
        // cerrar la PWA igual que sobrevive el carrito.
        listaPrecioActiva: state.listaPrecioActiva,
      }),
    }
  )
);

export default useCarritoStore;
