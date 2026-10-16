import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';
import { correccionGuionesActiva } from '../utils/codigoEscaneado';

// ¿El negocio encendió la corrección del guion del lector
// (`escaneo_corregir_guiones`)? Reusa el query ['config'] que ya comparten
// Carrito y Ajustes: no hay petición extra. Ausente = apagado.
export function useCorregirGuiones() {
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60 * 1000,
  });
  return correccionGuionesActiva(config);
}
