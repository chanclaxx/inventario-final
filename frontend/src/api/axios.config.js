import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
});

// ── Request: agrega token automáticamente ─────────────────────
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Códigos de error de plan — redirigen a pantalla de bloqueo
const CODIGOS_PLAN = new Set(['PLAN_VENCIDO', 'CUENTA_PENDIENTE', 'CUENTA_SUSPENDIDA']);

// ── Response: renueva token en 401, bloquea en 403 de plan ────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status   = error.response?.status;
    const code     = error.response?.data?.code;

    // 403 por estado del plan — redirigir a pantalla de bloqueo
    if (status === 403 && CODIGOS_PLAN.has(code)) {
      sessionStorage.setItem('plan_error', JSON.stringify({
        code,
        mensaje: error.response.data.error,
        fecha_vencimiento: error.response.data.fecha_vencimiento || null,
      }));
      window.location.href = '/plan-bloqueado';
      return Promise.reject(error);
    }

    // 401 — intentar renovar token con refresh
    if (status === 401 && !original._retry) {
      original._retry = true;
      try {
        const { data } = await axios.post('/api/auth/refresh', {}, { withCredentials: true });
        sessionStorage.setItem('accessToken', data.accessToken);

        // Actualizar usuario en sessionStorage si viene en la respuesta
        if (data.usuario) {
          sessionStorage.setItem('usuario', JSON.stringify(data.usuario));
        }

        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        sessionStorage.removeItem('accessToken');
        sessionStorage.removeItem('usuario');
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;