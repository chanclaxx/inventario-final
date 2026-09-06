import axios from 'axios';
import api, { API_BASE } from './axios.config';

export const login = (email, password) =>
  api.post('/auth/login', { email, password });

export const logout = () =>
  api.post('/auth/logout');

export const getMe = () =>
  api.get('/auth/me');
// ── Restaurar la sesión al abrir la app ──────────────────────────────────────
//
// El access token vive en `sessionStorage`, que el navegador BORRA al cerrar la
// pestaña. En una PWA eso significa que cerrar la app es cerrar sesión, y que
// tocar una notificación te deja en el login habiendo perdido el enlace que
// traía el aviso.
//
// El refresh token, en cambio, es una cookie httpOnly de 7 días que sigue ahí.
// Esto la cambia por una sesión nueva sin pedir la contraseña.
//
// Va con `axios` pelado y no con `api` a propósito: el interceptor de `api`
// reacciona a un 401 intentando refrescar y, si falla, MANDA AL LOGIN con un
// `window.location`. Aquí un 401 es el caso normal —la cookie caducó o nunca
// existió— y tiene que poder devolverse en silencio.
export const restaurarSesion = () =>
  axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
