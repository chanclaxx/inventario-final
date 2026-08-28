import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';
import { useAuth } from '../context/useAuth';

// ─────────────────────────────────────────────────────────────────────────────
// ¿ESTE USUARIO PUEDE VER LOS COSTOS?  — espejo de backend/src/utils/costos.util
//
// Es SOLO para pintar la pantalla. Quien manda es el backend: con el candado
// puesto el costo ni siquiera llega en la respuesta, así que esto evita marcos
// vacíos y etiquetas que dirían "$0", no protege nada por sí mismo.
//
// La regla, igual que allá:
//   · admin_negocio                      → siempre
//   · costos_solo_admin ausente o '0'    → siempre (default, nada cambia)
//   · candado puesto                     → solo si el negocio le concedió a esta
//                                          persona el campo «Costo» en Ajustes →
//                                          Usuarios
//
// Reusa el query ['config'] que ya comparten el carrito, ModalFactura y Ajustes:
// no dispara una petición extra.
// ─────────────────────────────────────────────────────────────────────────────
export function usePuedeVerCostos() {
  const { usuario, camposEdicionProductos } = useAuth();

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60 * 1000,
  });

  if (usuario?.rol === 'admin_negocio') return true;
  if (config?.costos_solo_admin !== '1') return true;

  // `camposEdicionProductos()` devuelve null para admin (ya resuelto arriba) y
  // el array de campos concedidos para el resto.
  const campos = camposEdicionProductos();
  return Array.isArray(campos) && campos.includes('costo');
}

export default usePuedeVerCostos;
