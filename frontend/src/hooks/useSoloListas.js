import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';
import { useAuth } from '../context/useAuth';
import useSucursalStore from '../store/sucursalStore';
import useCarritoStore from '../store/carritoStore';
import { leerConfigSoloListas, preciosDeNodo, precioVisible } from '../utils/listasPrecios';

// ─────────────────────────────────────────────────────────────────────────────
// ¿La sede abierta vende sus productos por cantidad SOLO con listas de precios?
//
// Opt-in por sede (`listas_precios_solo_sucursales`; ausente = ninguna). Reusa
// el query ['config'] de siempre: no dispara una petición más. Para el negocio
// que no lo encendió —y para las demás sedes del que sí— devuelve
// `{ activo: false }` y nadie que lo consuma cambia nada.
//
// La sede es la de la cabecera para el admin y la propia para los demás, que es
// la misma regla con la que el backend resuelve `req.sucursal_id`.
// ─────────────────────────────────────────────────────────────────────────────
export function useSoloListas() {
  const { usuario } = useAuth();
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60 * 1000,
  });

  const sede = usuario?.rol === 'admin_negocio' ? sucursalActiva : usuario?.sucursal_id;
  return leerConfigSoloListas(config, sede);
}

/**
 * Vuelca la regla al carritoStore. Se monta UNA vez (en InventarioPage), como
 * `useSincronizarReservas`: desde ahí la regla vive dentro de `agregarItem` y
 * todas las pantallas que agregan al carrito la heredan sin enterarse.
 */
export function useSincronizarSoloListas() {
  const { activo, principal } = useSoloListas();
  const setSoloListas = useCarritoStore((s) => s.setSoloListas);
  const principalId = activo ? principal.id : null;

  useEffect(() => { setSoloListas(principalId); }, [principalId, setSoloListas]);
}

/**
 * El precio que se MUESTRA de un producto por cantidad (tarjeta, árbol).
 *
 *   const precio = usePrecioVisible();
 *   precio.de(nodo.precio || precioPadre, producto, atributo, variante)
 *
 * El primer argumento es lo que la pantalla ya mostraba; los demás, los niveles
 * del árbol de lo general a lo específico (para mezclar sus listas). Con la
 * función apagada devuelve ese primer argumento TAL CUAL, así que la pantalla
 * pinta exactamente lo de siempre. Encendida, el de la lista que el carrito
 * tiene elegida y, si no, el de la principal; null = sin precio.
 */
export function usePrecioVisible() {
  const modo = useSoloListas();
  const listaActivaId = useCarritoStore((s) => s.listaPrecioActiva?.id ?? null);
  return {
    activo: modo.activo,
    de: (precioNormal, ...niveles) => (modo.activo
      ? precioVisible({ precioNormal, precios: preciosDeNodo(...niveles), modo, listaActivaId })
      : precioNormal),
  };
}

export default useSoloListas;
