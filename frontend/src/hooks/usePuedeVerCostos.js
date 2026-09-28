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

// ─────────────────────────────────────────────────────────────────────────────
// ¿Ve el costo del INVENTARIO de su local? — espejo de
// `costos.util.recortarInventarioSiToca`.
//
// Lo mismo que arriba, más una puerta: en un local de la red interna el costo
// de lo que llegó de la bodega ES el precio del despacho, y el admin decide en
// Ajustes → Red interna quién lo ve (`red_interna_valores_usuarios`). Solo para
// el inventario de SU local: no abre compras, proveedores ni procedencia, que
// siguen con `usePuedeVerCostos`.
// ─────────────────────────────────────────────────────────────────────────────
const _idsDe = (raw) => {
  try {
    const lista = JSON.parse(raw || '[]');
    return Array.isArray(lista) ? lista.map(Number) : [];
  } catch {
    return [];
  }
};

export function usePuedeVerCostoInventario() {
  const general = usePuedeVerCostos();
  const { usuario } = useAuth();
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60 * 1000,
  });

  if (general) return true;
  if (config?.red_interna_activa !== '1') return false;
  const bodegaId = Number(config?.red_interna_bodega_id);
  const sucursalId = Number(usuario?.sucursal_id);
  if (!sucursalId || sucursalId === bodegaId) return false;
  return _idsDe(config?.red_interna_valores_usuarios).includes(Number(usuario?.id));
}
