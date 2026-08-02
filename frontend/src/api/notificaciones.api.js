import api from './axios.config';

// ─────────────────────────────────────────────────────────────────────────────
// Notificaciones push. Como el resto de la app, las URLs se construyen SOLO
// aquí: ni el hook ni los componentes llaman a axios directamente.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estado de la feature en el servidor + clave pública VAPID + dispositivos ya
 * registrados por este usuario.
 *
 * La clave pública llega del backend en vez de compilarse en el bundle: si
 * algún día hay que rotarla, no obliga a un rebuild ni a un despliegue.
 */
export const getEstadoNotificaciones = () => api.get('/notificaciones/estado');

/** Registra este dispositivo. `suscripcion` es el objeto crudo del navegador. */
export const suscribirPush = (suscripcion) =>
  api.post('/notificaciones/suscribir', { suscripcion });

/** Da de baja este dispositivo. */
export const desuscribirPush = (endpoint) =>
  api.delete('/notificaciones/suscribir', { data: { endpoint } });

/** Envía un aviso de prueba al propio usuario. */
export const enviarNotificacionPrueba = () => api.post('/notificaciones/prueba');

/**
 * Clientes con el plazo vencido, para llamarlos.
 *
 * Vive en este archivo (y no en creditos/prestamos) porque mezcla los dos y es
 * la misma consulta que alimenta el aviso de cartera vencida: la pantalla y la
 * notificación no pueden mostrar cuentas distintas.
 */
export const getCobros = (params = {}) => api.get('/notificaciones/cobros', { params });
