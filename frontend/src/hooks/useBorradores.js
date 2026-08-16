import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios.config';
import useCarritoStore from '../store/carritoStore';
import { construirIndiceReservas } from '../utils/reservas';
import {
  getBorradores, getBorrador, crearBorrador, editarBorrador,
  renovarBorrador, eliminarBorrador, quitarItemBorrador,
} from '../api/borradores.api';
import { useSucursalKey } from './useSucursalKey';

// ─────────────────────────────────────────────────────────────────────────────
// Borradores de venta (carritos guardados con reserva blanda).
//
// Los borradores son SERVER STATE, no estado de UI: viven en React Query y no
// en Zustand. Es lo que hace que la reserva signifique algo — si vivieran en el
// localStorage de cada vendedor, el borrador de Carlos no advertiría nada a Ana
// desde el otro terminal, que es justo el caso que la feature resuelve.
//
// El carrito activo, en cambio, sigue siendo local: es de este vendedor y de
// este momento.
//
// La queryKey lleva `sucursalKey` porque los borradores son POR SUCURSAL: los
// de Sansur no existen para Principal. Al cambiar de sucursal, SucursalSelector
// invalida todas las queries y la lista se recarga sola.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿El negocio encendió los borradores?
 *
 * Reusa el query ['config'] que ya comparten Carrito, ModalFactura y Ajustes:
 * no dispara una petición extra. Apagada la feature, quien lo consume no
 * renderiza nada y el carrito queda exactamente como estaba.
 */
export function useBorradoresActivo() {
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60 * 1000,
  });
  return config?.borradores_activo === '1';
}

export function useBorradores() {
  const queryClient = useQueryClient();
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const activo = useBorradoresActivo();

  const queryKey = ['borradores', ...sucursalKey];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getBorradores().then((r) => r.data.data),
    enabled: activo && sucursalLista,
    // Corto a propósito: el borrador que Ana guardó hace un minuto tiene que
    // aparecerle a Carlos. Es lo que sostiene el aviso de reserva de la Fase 3.
    staleTime: 30 * 1000,
    // El vendedor vuelve a la pestaña después de atender a alguien: ese es el
    // momento exacto en que la lista puede estar desactualizada.
    refetchOnWindowFocus: true,
    // Sin la feature el backend responde 404: no tiene sentido reintentar.
    retry: false,
  });

  const invalidar = () => queryClient.invalidateQueries({ queryKey, exact: false });

  const guardar = useMutation({
    mutationFn: (datos) => crearBorrador(datos).then((r) => r.data.data),
    onSuccess:  invalidar,
  });

  const editar = useMutation({
    mutationFn: ({ id, ...datos }) => editarBorrador(id, datos).then((r) => r.data.data),
    onSuccess:  invalidar,
  });

  const descartar = useMutation({
    mutationFn: (id) => eliminarBorrador(id),
    onSuccess:  invalidar,
  });

  // El "robo": el producto estaba apalabrado en otro borrador y el vendedor se
  // lo lleva a este carrito. Lo usa el modal de conflicto de la Fase 3.
  const liberarItem = useMutation({
    mutationFn: ({ borradorId, itemId }) =>
      quitarItemBorrador(borradorId, itemId).then((r) => r.data.data),
    onSuccess: invalidar,
  });

  return {
    activo,
    borradores: data || [],
    isLoading,
    guardar,
    editar,
    descartar,
    liberarItem,
    invalidar,
  };
}

/**
 * Vuelca el índice de reservas al carritoStore.
 *
 * Se monta UNA sola vez (en InventarioPage). A partir de ahí, el chequeo vive
 * dentro de agregarItem y los nueve sitios que agregan al carrito lo heredan
 * sin enterarse — incluidos traslado, despacho y devolución, que comparten el
 * mismo carrito.
 */
export function useSincronizarReservas() {
  const { borradores, activo } = useBorradores();
  const borradorOrigenId = useCarritoStore((s) => s.borradorOrigenId);
  const setReservas      = useCarritoStore((s) => s.setReservas);

  const indice = useMemo(
    () => (activo ? construirIndiceReservas(borradores, borradorOrigenId) : {}),
    [activo, borradores, borradorOrigenId]
  );

  useEffect(() => { setReservas(indice); }, [indice, setReservas]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Traducción borrador → carrito.
//
// Es el ÚNICO punto donde se cruzan los dos vocabularios: la BD guarda
// `precio_final` / `item_key` y el carrito de Zustand usa `precioFinal` / `key`.
// Si el borrador guardara los nombres del store, cualquier renombrado allá
// rompería datos ya escritos en la base.
// ─────────────────────────────────────────────────────────────────────────────
export function itemBorradorACarrito(i) {
  return {
    key:            i.item_key,
    tipo:           i.tipo,
    nombre:         i.nombre,
    imei:           i.imei || undefined,
    serial_id:      i.serial_id   ?? undefined,
    producto_id:    i.producto_id ?? undefined,
    atributo_id:    i.atributo_id ?? undefined,
    variante_id:    i.variante_id ?? undefined,
    atributo_label: i.atributo_label ?? undefined,
    variante_label: i.variante_label ?? undefined,
    // Marca y modelo no se guardan en el borrador: los repone el backend desde
    // el producto al revalidar, porque el payload del traslado los lee.
    marca:          i.marca  ?? null,
    modelo:         i.modelo ?? null,
    cantidad:       Number(i.cantidad) || 1,
    // El stock viene fresco de la revalidación, no del día que se guardó: es lo
    // que topa el selector de cantidad del carrito.
    stock:          i.stock ?? undefined,
    precio:         Number(i.precio ?? i.precio_final) || 0,
    // Lo que se negoció con el cliente. Es la razón de ser del borrador.
    precioFinal:    Number(i.precio_final) || 0,
    costo:          i.costo != null ? Number(i.costo) : null,
    tarifa_id:      i.tarifa_id ?? null,
    origen_precio:  i.origen_precio || 'lista',
    linea_id:       i.linea_id ?? null,
  };
}

/**
 * Carga un borrador al carrito, revalidado contra el inventario de hoy.
 *
 * Devuelve `{ items, noDisponibles, borrador }` — nunca lanza por mercancía
 * que ya no está: un borrador con la mitad vendida sigue sirviendo, y qué
 * hacer con el resto lo decide el vendedor.
 *
 * El borrador NO se borra aquí: sobrevive (y sigue reservando) hasta que la
 * factura o el préstamo se cree de verdad.
 */
export async function cargarBorrador(id) {
  const { data } = await getBorrador(id);
  const b = data.data;
  return {
    borrador:      b,
    items:         (b.items || []).map(itemBorradorACarrito),
    noDisponibles: b.no_disponibles || [],
  };
}

export { renovarBorrador };
