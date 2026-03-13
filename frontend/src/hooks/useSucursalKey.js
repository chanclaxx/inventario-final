import useSucursalStore from '../store/sucursalStore';
import { useAuth }       from '../context/useAuth';

/**
 * Retorna el sufijo de queryKey (negocio + sucursal) y un flag `sucursalLista`
 * que indica si la sucursal ya está resuelta y validada para hacer fetch.
 *
 * Uso:
 *   const { sucursalKey, sucursalLista } = useSucursalKey();
 *   useQuery({
 *     queryKey: ['prestamos', ...sucursalKey],
 *     enabled:  sucursalLista,
 *   })
 *
 * Valores de sucursalKey:
 *   admin viendo sucursal específica → ['negocio-3', 7]
 *   admin en vista global            → ['negocio-3', 'todas']
 *   admin sin selección aún          → ['negocio-3', 'sin-seleccion']  ← sucursalLista = false
 *   vendedor/supervisor              → ['negocio-3', 12]
 *
 * El negocio_id aísla el caché entre negocios que compartan el mismo sucursal_id.
 *
 * sucursalLista es false cuando:
 *   - No hay sucursal seleccionada (null)
 *   - La lista de sucursales del backend aún no se ha cargado
 *   - La sucursal persistida no pertenece a las sucursales del negocio actual
 *     (evita 403 con ids de sesiones anteriores o de otros negocios)
 */
export function useSucursalKey() {
  const { usuario }    = useAuth();
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);
  const sucursales     = useSucursalStore((s) => s.sucursales);

  const negocioSegmento = `negocio-${usuario?.negocio_id ?? 'sin-negocio'}`;

  if (usuario?.rol === 'admin_negocio') {
    const sucursalKey = [negocioSegmento, sucursalActiva ?? 'sin-seleccion'];

    // Bloquear fetch hasta que:
    // 1. La lista de sucursales haya llegado del backend (no vacía)
    // 2. Haya una sucursal seleccionada
    // 3. La sucursal activa sea válida dentro de este negocio
    const listaDisponible = sucursales.length > 0;
    const esValida        = sucursalActiva === 'todas' ||
                            sucursales.some((s) => s.id === sucursalActiva);
    const sucursalLista   = listaDisponible && sucursalActiva !== null && esValida;

    return { sucursalKey, sucursalLista };
  }

  // Vendedor/supervisor: sucursal fija en el token, siempre lista
  const sucursalKey = [negocioSegmento, usuario?.sucursal_id ?? 'propia'];
  return { sucursalKey, sucursalLista: true };
}