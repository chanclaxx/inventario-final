import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';
import { leerConfigInteres } from '../utils/interes';

// ─────────────────────────────────────────────────────────────────────────────
// Configuración de interés corriente del negocio.
//
// Reusa el query ['config'] que ya comparten el carrito, la factura, Ajustes y
// `useMora`: no dispara una petición extra. staleTime corto para que activar la
// feature o cambiar un plan se sienta pronto en la pantalla del vendedor.
//
// Si el negocio no la activó devuelve `activa: false` y lista vacía: quien lo
// consume no renderiza nada y todo queda como antes.
// ─────────────────────────────────────────────────────────────────────────────
export function useInteres() {
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60 * 1000,
  });

  return leerConfigInteres(config);
}

export default useInteres;
