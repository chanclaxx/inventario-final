import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getEstadoNotificaciones, suscribirPush, desuscribirPush, enviarNotificacionPrueba,
} from '../api/notificaciones.api';

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICACIONES PUSH — estado y acciones del dispositivo actual.
//
// LO QUE HAY QUE SABER ANTES DE TOCAR ESTO:
//
//   1. EL PERMISO SE PIDE CON UN CLIC, NUNCA AL CARGAR. Los navegadores bloquean
//      la petición automática, y un "No permitir" NO se puede volver a preguntar
//      por código: el usuario tendría que ir a los ajustes del navegador. Por
//      eso `activar()` solo se llama desde un botón.
//
//   2. EN iPHONE SOLO FUNCIONA CON LA APP INSTALADA en la pantalla de inicio
//      (iOS 16.4+). En Safari normal la API ni existe. Se detecta y se explica,
//      en vez de mostrar un botón que no va a funcionar.
//
//   3. LA SUSCRIPCIÓN VIVE EN EL NAVEGADOR, no en la sesión. Cerrar sesión no la
//      borra; por eso al entrar se re-sincroniza contra el backend (el
//      dispositivo pudo quedar registrado con otro usuario).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estados posibles:
 *   'no-soportado'     → el navegador no tiene push (o iOS en Safari normal)
 *   'ios-sin-instalar' → iPhone/iPad sin agregar la app a la pantalla de inicio
 *   'servidor-apagado' → el backend no tiene las claves VAPID configuradas
 *   'bloqueado'        → el usuario dijo "No permitir" en este navegador
 *   'inactivo'         → se puede activar
 *   'activo'           → este dispositivo ya recibe avisos
 */

const soportaPush = () =>
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window;

/** iPhone/iPad. iPadOS moderno se hace pasar por Mac, de ahí el segundo chequeo. */
const esIOS = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua)
    || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
};

/** ¿Está corriendo como app instalada y no como pestaña del navegador? */
const esAppInstalada = () =>
  window.matchMedia?.('(display-mode: standalone)')?.matches
  || window.navigator.standalone === true;

/** La clave VAPID viaja en base64url y `subscribe()` la exige como Uint8Array. */
const claveAUint8 = (base64) => {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const normal  = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const binario = window.atob(normal);
  const salida  = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
  return salida;
};

export function usePush() {
  const [suscripcion, setSuscripcion] = useState(null);
  const [ocupado,     setOcupado]     = useState(false);
  const [error,       setError]       = useState('');
  const [aviso,       setAviso]       = useState('');

  const soportado = soportaPush();

  // Estado del servidor: si no tiene claves VAPID, no tiene sentido ni mostrar
  // el botón. `retry: false` porque un 503 aquí es una respuesta válida.
  const { data: estadoServidor, refetch } = useQuery({
    queryKey: ['notificaciones-estado'],
    queryFn:  () => getEstadoNotificaciones().then((r) => r.data.data),
    retry:    false,
    staleTime: 5 * 60 * 1000,
  });

  // Suscripción que ya tenga este navegador (de una sesión anterior).
  useEffect(() => {
    if (!soportado) return;
    let cancelado = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sus = await reg.pushManager.getSubscription();
        if (!cancelado) setSuscripcion(sus);
      } catch {
        /* sin service worker aún (dev sin PWA): se queda en null */
      }
    })();
    return () => { cancelado = true; };
  }, [soportado]);

  // El navegador puede rotar la suscripción por su cuenta. El service worker
  // nos avisa y aquí se vuelve a registrar contra el backend; si no, el
  // dispositivo deja de recibir avisos en silencio.
  useEffect(() => {
    if (!soportado) return undefined;
    const alMensaje = async (ev) => {
      if (ev.data?.tipo !== 'push-resuscribir') return;
      try {
        const reg = await navigator.serviceWorker.ready;
        const sus = await reg.pushManager.getSubscription();
        if (sus) {
          await suscribirPush(sus.toJSON());
          setSuscripcion(sus);
        }
      } catch { /* se reintenta la próxima vez que se abra la app */ }
    };
    navigator.serviceWorker.addEventListener('message', alMensaje);
    return () => navigator.serviceWorker.removeEventListener('message', alMensaje);
  }, [soportado]);

  const permiso = soportado ? Notification.permission : 'denied';

  const estado = (() => {
    if (!soportado) return esIOS() && !esAppInstalada() ? 'ios-sin-instalar' : 'no-soportado';
    if (esIOS() && !esAppInstalada())                    return 'ios-sin-instalar';
    if (estadoServidor && !estadoServidor.activo)        return 'servidor-apagado';
    if (permiso === 'denied')                            return 'bloqueado';
    if (suscripcion)                                     return 'activo';
    return 'inactivo';
  })();

  /** Pide permiso, se suscribe y registra el dispositivo. SOLO desde un clic. */
  const activar = useCallback(async () => {
    setError(''); setAviso(''); setOcupado(true);
    try {
      const permisoDado = await Notification.requestPermission();
      if (permisoDado !== 'granted') {
        setError(permisoDado === 'denied'
          ? 'Bloqueaste las notificaciones. Actívalas desde los permisos del navegador para este sitio.'
          : 'No se concedió el permiso de notificaciones.');
        return false;
      }

      const clave = estadoServidor?.clave_publica;
      if (!clave) {
        setError('El servidor no tiene configuradas las notificaciones.');
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      // Reusar la suscripción existente si ya la hay: volver a suscribir con la
      // misma clave devuelve la misma, pero pedirla dos veces con claves
      // distintas falla con InvalidStateError.
      const sus = (await reg.pushManager.getSubscription())
        || (await reg.pushManager.subscribe({
          userVisibleOnly: true,            // obligatorio: todo push se le muestra al usuario
          applicationServerKey: claveAUint8(clave),
        }));

      await suscribirPush(sus.toJSON());
      setSuscripcion(sus);
      setAviso('Notificaciones activadas en este dispositivo.');
      refetch();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'No se pudieron activar las notificaciones');
      return false;
    } finally {
      setOcupado(false);
    }
  }, [estadoServidor, refetch]);

  /** Baja del dispositivo: se avisa al backend y se cancela en el navegador. */
  const desactivar = useCallback(async () => {
    setError(''); setAviso(''); setOcupado(true);
    try {
      const sus = suscripcion || (await (await navigator.serviceWorker.ready).pushManager.getSubscription());
      if (sus) {
        // Primero el backend: si se cancela en el navegador y falla la llamada,
        // quedaría una fila fantasma a la que se le seguiría enviando.
        await desuscribirPush(sus.endpoint).catch(() => {});
        await sus.unsubscribe().catch(() => {});
      }
      setSuscripcion(null);
      setAviso('Este dispositivo ya no recibirá notificaciones.');
      refetch();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudieron desactivar las notificaciones');
      return false;
    } finally {
      setOcupado(false);
    }
  }, [suscripcion, refetch]);

  /** Aviso de prueba: la forma más rápida de saber si todo el circuito funciona. */
  const probar = useCallback(async () => {
    setError(''); setAviso(''); setOcupado(true);
    try {
      await enviarNotificacionPrueba();
      setAviso('Enviada. Debería aparecer en unos segundos.');
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo enviar la notificación de prueba');
      return false;
    } finally {
      setOcupado(false);
    }
  }, []);

  return {
    estado,
    permiso,
    ocupado,
    error,
    aviso,
    dispositivos: estadoServidor?.dispositivos ?? [],
    esIOS: esIOS(),
    activar,
    desactivar,
    probar,
  };
}

export default usePush;
