import axios from 'axios';
import useSucursalStore from '../store/sucursalStore';

// ── La base de la API, en UNA sola definición ────────────────────────────────
//
// Existe porque el refresh se hacía con `axios.post('/api/auth/refresh')`: una
// URL RELATIVA, que en producción no cae en el backend sino en Vercel. Y como
// `vercel.json` reescribe `/(.*)` a `/index.html`, esa llamada devolvía la
// página HTML con un 200 — así que `data.accessToken` era `undefined`, se
// guardaba la cadena "undefined" en sessionStorage y el reintento salía con
// `Bearer undefined`.
//
// Resultado en producción: el access token dura 8 horas y al expirar NO se podía
// renovar nunca. El usuario simplemente quedaba fuera y tenía que volver a
// escribir la contraseña. Es la mitad del "cierro la pestaña y pierdo la sesión".
//
// Todo lo que hable con la API tiene que salir de aquí; una segunda forma de
// armar la URL es exactamente lo que se acaba de romper.
export const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({
  baseURL      : API_BASE,
  withCredentials : true,
  // Evita peticiones colgadas indefinidamente (sin esto, un request que el
  // servidor nunca responde deja el botón girando para siempre).
  // Las peticiones largas legítimas (importación Excel) lo sobreescriben.
  timeout : 30000,
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
        // `axios` pelado y no `api`: un 401 aquí volvería a entrar por este mismo
        // interceptor y se llamaría a sí mismo. Pero con la base CORRECTA.
        const { data } = await axios.post(
          `${API_BASE}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        // Un refresh que no trae token no es un éxito. Sin esta guarda se
        // guardaba "undefined" y el siguiente request salía con
        // `Bearer undefined`, que falla de una forma mucho más difícil de leer.
        if (!data?.accessToken) throw new Error('refresh sin token');
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