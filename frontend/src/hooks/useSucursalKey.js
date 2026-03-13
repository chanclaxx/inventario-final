import useSucursalStore from '../store/sucursalStore';
import { useAuth }       from '../context/useAuth';

/**
 * Retorna un sufijo de queryKey que incluye la sucursal activa.
 *
 * Uso:
 *   const sucursalKey = useSucursalKey();
 *   useQuery({ queryKey: ['facturas', ...sucursalKey], ... })
 *
 * - admin_negocio : incluye el id o 'todas' → caché separado por sucursal
 * - vendedor/supervisor : incluye su sucursal_id del token → caché propio
 */
export function useSucursalKey() {
  const { usuario } = useAuth();
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);

  if (usuario?.rol === 'admin_negocio') {
    return [sucursalActiva ?? 'sin-seleccion'];
  }

  // Para vendedor/supervisor el backend filtra por su sucursal asignada
  return [usuario?.sucursal_id ?? 'propia'];
}