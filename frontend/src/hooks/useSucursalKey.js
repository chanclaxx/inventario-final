import useSucursalStore from '../store/sucursalStore';
import { useAuth }       from '../context/useAuth';

/**
 * Retorna un sufijo de queryKey que incluye negocio_id + sucursal activa.
 *
 * Uso:
 *   const sucursalKey = useSucursalKey();
 *   useQuery({ queryKey: ['prestamos', ...sucursalKey], ... })
 *
 * Ejemplos de valores resultantes:
 *   admin viendo sucursal específica → ['negocio-3', 7]
 *   admin en vista global            → ['negocio-3', 'todas']
 *   admin sin selección aún          → ['negocio-3', 'sin-seleccion']
 *   vendedor/supervisor              → ['negocio-3', 12]   (sucursal_id del token)
 *
 * El negocio_id es necesario para aislar el caché entre negocios distintos
 * que puedan compartir el mismo sucursal_id numérico en la base de datos.
 */
export function useSucursalKey() {
  const { usuario } = useAuth();
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);

  const negocioSegmento = `negocio-${usuario?.negocio_id ?? 'sin-negocio'}`;

  if (usuario?.rol === 'admin_negocio') {
    return [negocioSegmento, sucursalActiva ?? 'sin-seleccion'];
  }

  // Para vendedor/supervisor el backend filtra por su sucursal asignada en el token
  return [negocioSegmento, usuario?.sucursal_id ?? 'propia'];
}