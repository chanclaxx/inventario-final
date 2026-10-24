import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';
import { getEnGarantia, getConfigGarantias } from '../api/garantiasProveedor.api';
import useSucursalStore from '../store/sucursalStore';
import { useAuth } from '../context/useAuth';
import { puedeGarantias } from '../utils/permisosGarantias';

// ─────────────────────────────────────────────────────────────────────────────
// ¿La función de garantías con proveedores está encendida, y qué puede hacer
// este usuario? Una sola fuente para la pestaña y para los botones «Garantía»
// de Facturas, Préstamos e Inventario.
// ─────────────────────────────────────────────────────────────────────────────
export function useGarantiasProveedor() {
  const { usuario } = useAuth();
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const activa = config?.reclamos_garantia_activo === '1';
  // La config propia de la función (umbral, si hay dónde guardar fotos). Solo
  // se pide con la función encendida: apagada, la ruta responde 404.
  const { data: cfg } = useQuery({
    queryKey: ['garantias-config'],
    queryFn:  () => getConfigGarantias().then((r) => r.data.data),
    enabled:  activa,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return {
    activa,
    fotosActivas: activa && cfg?.fotos_activas === true,
    puede: (accion) => activa && puedeGarantias(usuario, accion),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ¿Qué tiene esta sucursal EN GARANTÍA con el proveedor?
//
// Lo que está en garantía NO cuenta en el stock vendible: por cantidad ya se
// descontó; un serial queda bloqueado por la base. Este hook trae la lista para
// que el inventario lo diga («2 en garantía · no cuentan»).
//
// Devuelve un mapa con las MISMAS claves de `useEnTransito`: el IMEI para un
// serial, y `cant-<p>` / `cant-<p>-a-<a>` / `cant-<p>-v-<v>` para un nodo.
// Sin la función (o en la vista de todas las sucursales) no pide nada.
// ─────────────────────────────────────────────────────────────────────────────

const claveNodo = (n) => (n.variante_id != null
  ? `cant-${n.producto_id}-v-${n.variante_id}`
  : n.atributo_id != null
    ? `cant-${n.producto_id}-a-${n.atributo_id}`
    : `cant-${n.producto_id}`);

/** Lo que un producto tiene en garantía sumando todas sus variantes. */
export const enGarantiaDeProducto = (mapa, productoId) => {
  let cantidad = 0; const casos = [];
  for (const [k, v] of mapa) {
    if (k === `cant-${productoId}` || k.startsWith(`cant-${productoId}-`)) {
      cantidad += Number(v.cantidad || 0); casos.push(...(v.casos || []));
    }
  }
  return cantidad ? { cantidad, casos } : null;
};

export function useEnGarantia() {
  const { activa } = useGarantiasProveedor();
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);
  const esVistaGlobal  = useSucursalStore((s) => s.esVistaGlobal());

  const { data } = useQuery({
    queryKey: ['garantias-en-inventario', sucursalActiva],
    queryFn:  () => getEnGarantia().then((r) => r.data.data),
    enabled:  activa && !esVistaGlobal,
    retry:    false,
    staleTime: 60 * 1000,
  });

  return useMemo(() => {
    const mapa = new Map();
    for (const s of data?.seriales || []) mapa.set(s.imei, { cantidad: 1, casos: s.casos });
    for (const n of data?.nodos || []) {
      const k = claveNodo(n);
      const previo = mapa.get(k);
      mapa.set(k, {
        cantidad: (previo?.cantidad || 0) + Number(n.cantidad || 0),
        casos: [...(previo?.casos || []), ...(n.casos || [])],
      });
    }
    return mapa;
  }, [data]);
}
