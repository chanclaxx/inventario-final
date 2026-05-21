import axios from 'axios';
import useSucursalStore from '../store/sucursalStore';

const api = axios.create({
  baseURL      : import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api`
    : '/api',
  withCredentials : true,
});

// ── Constantes ────────────────────────────────────────────────
const CODIGOS_PLAN = new Set(['PLAN_VENCIDO', 'CUENTA_PENDIENTE', 'CUENTA_SUSPENDIDA']);

/**
 * Rutas que NO necesitan sucursal_id.
 * Config es por negocio; sucursales es la propia query de lista;
 * auth y registro son públicas.
 */
const PREFIJOS_SIN_SUCURSAL = [
  '/auth/',
  '/registro',
  '/superadmin',
  '/sucursales',
  '/config',
  '/email',
  '/usuarios',
];

const requiereSucursal = (url = '') =>
  !PREFIJOS_SIN_SUCURSAL.some((prefijo) => url.includes(prefijo));

// ── Helpers ───────────────────────────────────────────────────
const getUsuarioSesion = () => {
  try {
    const raw = sessionStorage.getItem('usuario');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

// ── Request: token + sucursal_id ──────────────────────────────
api.interceptors.request.use((config) => {
  // 1. Token de autenticación
  const token = sessionStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // 2. Inyección de sucursal_id:
  //    - admin_negocio: siempre inyecta (elige entre todas sus sucursales).
  //    - supervisor/vendedor con sucursales_vista: inyecta cuando está en una vista.
  //    - supervisor/vendedor sin sucursales_vista: el backend resuelve por token.
  const usuario = getUsuarioSesion();
  const esAdmin    = usuario?.rol === 'admin_negocio';
  const tieneVista = Array.isArray(usuario?.sucursales_vista) && usuario.sucursales_vista.length > 0;
  if ((esAdmin || tieneVista) && requiereSucursal(config.url)) {
    const param = useSucursalStore.getState().sucursalParam();

    // No sobreescribir sucursal_id si ya viene explícito en la llamada
    if (param !== null && !config.params?.sucursal_id) {
      config.params = { ...config.params, sucursal_id: param };
    }
  }

  return config;
});

// ── Response: renovar token en 401 / bloquear plan en 403 ────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status   = error.response?.status;
    const code     = error.response?.data?.code;

    // 403 por plan vencido o suspendido → pantalla de bloqueo
    if (status === 403 && CODIGOS_PLAN.has(code)) {
      sessionStorage.setItem('plan_error', JSON.stringify({
        code,
        mensaje           : error.response.data.error,
        fecha_vencimiento : error.response.data.fecha_vencimiento ?? null,
      }));
      window.location.href = '/plan-bloqueado';
      return Promise.reject(error);
    }

    // 401 → intentar renovar access token con refresh cookie
    if (status === 401 && !original._retry) {
      original._retry = true;
      try {
        const { data } = await axios.post(
          '/api/auth/refresh',
          {},
          { withCredentials: true }
        );
        sessionStorage.setItem('accessToken', data.accessToken);
        if (data.usuario) {
          sessionStorage.setItem('usuario', JSON.stringify(data.usuario));
        }
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        sessionStorage.removeItem('accessToken');
        sessionStorage.removeItem('usuario');
        useSucursalStore.getState().reset();
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;