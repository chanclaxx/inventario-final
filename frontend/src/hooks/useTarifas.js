import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';
import { useAuth } from '../context/useAuth';
import { leerConfigTarifas } from '../utils/tarifas';

// ─────────────────────────────────────────────────────────────────────────────
// Configuración de tarifas porcentuales del negocio.
//
// Reusa el query ['config'] que ya comparten Carrito, ModalFactura y Ajustes:
// no dispara una petición extra. Con un staleTime corto (60s) para que activar
// o editar una tarifa desde Ajustes se sienta pronto en la pantalla del
// vendedor; el resto de consumidores de ['config'] conserva su propio
// staleTime (cada observador de React Query decide por su cuenta).
//
// Si el negocio no activó la feature devuelve `activo: false` y una lista
// vacía: quien lo consume no renderiza nada y todo queda como antes.
// ─────────────────────────────────────────────────────────────────────────────
export function useTarifas() {
  const { usuario } = useAuth();

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60 * 1000,
  });

  const cfg = leerConfigTarifas(config);

  // El porcentaje permite despejar el costo del producto a partir del precio.
  // Para el rol vendedor solo se revela si el negocio lo autorizó de forma
  // explícita; los demás roles ya ven los costos en el inventario.
  // (esVendedor() del contexto significa "al menos vendedor", así que aquí se
  // compara el rol exacto.)
  const esVendedorRaso = usuario?.rol === 'vendedor';

  // La red interna manda sobre la config de tarifas: si el negocio decidió que
  // sus vendedores no ven costos (`red_interna_ocultar_costos`, activo por
  // defecto), mostrar el porcentaje lo contradiría — bastaría dividir el precio
  // para obtener el valor interno. En ese caso el vendedor ve solo el nombre.
  const redOcultaCostos = config?.red_interna_activa === '1'
    && config?.red_interna_ocultar_costos !== '0';

  const verPorcentaje = esVendedorRaso
    ? (cfg.verPorcentaje && !redOcultaCostos)
    : true;

  return { ...cfg, verPorcentaje };
}

export default useTarifas;
