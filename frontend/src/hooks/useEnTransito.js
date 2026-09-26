import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';
import { getEnTransito } from '../api/redInterna.api';
import useSucursalStore from '../store/sucursalStore';

// ─────────────────────────────────────────────────────────────────────────────
// ¿Qué tiene esta sucursal EN CAMINO? (red interna)
//
// Lo que va en un envío (o una devolución) sin recibir está BLOQUEADO en la
// sucursal que lo despachó: la base no deja venderlo, prestarlo ni bajar su
// stock (20260926_reserva_transito.sql). Este hook trae esa lista para que el
// inventario lo diga ANTES de que alguien tropiece con el candado.
//
// Devuelve un mapa con las MISMAS claves de `ChipApartado`: el IMEI para un
// serial, y `cant-<p>` / `cant-<p>-a-<a>` / `cant-<p>-v-<v>` para un nodo.
// Sin red interna (o en la vista de todas las sucursales) no pide nada.
// ─────────────────────────────────────────────────────────────────────────────

const claveNodo = (n) => (n.variante_id != null
  ? `cant-${n.producto_id}-v-${n.variante_id}`
  : n.atributo_id != null
    ? `cant-${n.producto_id}-a-${n.atributo_id}`
    : `cant-${n.producto_id}`);

export function useEnTransito() {
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);
  const esVistaGlobal  = useSucursalStore((s) => s.esVistaGlobal());
  const activa = config?.red_interna_activa === '1' && !esVistaGlobal;

  const { data } = useQuery({
    // La sucursal va en la clave: un admin que cambia de sede ve lo de esa sede.
    queryKey: ['red-en-transito', sucursalActiva],
    queryFn:  () => getEnTransito().then((r) => r.data.data),
    enabled:  activa,
    retry:    false,
    staleTime: 60 * 1000,
  });

  // Un mapa por respuesta, no por render: el hook lo llama cada fila.
  return useMemo(() => {
    const mapa = new Map();
    for (const s of data?.seriales || []) {
      mapa.set(s.imei, { cantidad: 1, envios: [s] });
    }
    for (const n of data?.nodos || []) {
      mapa.set(claveNodo(n), { cantidad: n.cantidad, envios: n.envios });
    }
    return mapa;
  }, [data]);
}
