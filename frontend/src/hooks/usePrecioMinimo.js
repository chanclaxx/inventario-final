import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';
import { leerConfigPrecioMinimo } from '../utils/precioMinimo';

// Precio mínimo de venta (feature opt-in `precio_minimo_activo`). Reusa el query
// ['config'] que ya comparten Carrito, ModalFactura y Ajustes: no dispara una
// petición extra. Apagada, `activo` es false y nadie pinta nada.
export function usePrecioMinimo() {
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60 * 1000,
  });
  return leerConfigPrecioMinimo(config);
}

export default usePrecioMinimo;
