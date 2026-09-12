import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';
import { useAuth } from '../context/useAuth';
import { leerConfigListas } from '../utils/listasPrecios';

// ─────────────────────────────────────────────────────────────────────────────
// Listas de precios del negocio.
//
// Reusa el query ['config'] que ya comparten Carrito, ModalFactura y Ajustes:
// no dispara una petición extra. Mismo staleTime corto (60s) que `useTarifas`,
// para que crear o renombrar una lista desde Ajustes se sienta pronto en la
// pantalla del vendedor.
//
// Si el negocio no la activó devuelve `activo: false` y una lista vacía: quien
// lo consume no renderiza nada y todo queda exactamente como antes.
//
// A diferencia de `useTarifas`, aquí NO hay nada que esconderle a un vendedor.
// Una tarifa muestra el porcentaje, y con el porcentaje se despeja el costo
// dividiendo; un precio de lista es un precio de VENTA y el vendedor tiene que
// verlo para poder cobrarlo. Por eso esta feature convive con «ocultar costos»
// y las tarifas no.
// ─────────────────────────────────────────────────────────────────────────────
export function useListasPrecios() {
  const { usuario } = useAuth();

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60 * 1000,
  });

  const cfg = leerConfigListas(config);

  // Quién puede CAMBIAR los precios de una lista. Por defecto solo el admin;
  // un supervisor necesita el permiso explícito, que se da en Ajustes →
  // Usuarios. Es la misma regla que aplica el backend en
  // `requirePermisoPreciosLista` — aquí solo decide si se pinta el botón, el
  // que manda es el de allá.
  const puedeEditar = usuario?.rol === 'admin_negocio'
    || usuario?.permisos_edicion_productos?.puede_editar_precios_lista === true;

  return { ...cfg, puedeEditar };
}

export default useListasPrecios;
