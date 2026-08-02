/* global clients */

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICACIONES PUSH — se inyecta en el service worker que genera Workbox.
//
// POR QUÉ ES UN ARCHIVO APARTE Y NO ESTÁ EN vite.config:
//   El plugin PWA está en modo `generateSW`: Workbox escribe el service worker
//   completo (precache + runtimeCaching) y ese archivo no se puede editar a
//   mano. Con `workbox.importScripts: ['/push-sw.js']` este código se ejecuta
//   DENTRO de ese mismo service worker, sin tocar una sola regla de caché.
//
// OJO — este archivo vive en `public/`, así que Vite lo copia tal cual: no pasa
// por el bundler. Nada de imports, ni JSX, ni sintaxis que el navegador no
// entienda directamente.
//
// El payload lo arma el backend (notificaciones.service.js) y llega así:
//   { titulo, cuerpo, url, tag, tipo, fecha }
// ─────────────────────────────────────────────────────────────────────────────

const ICONO = '/icons/icon-192x192.png';

/**
 * Llega un aviso del servidor.
 *
 * `showNotification` es OBLIGATORIO: el navegador nos dio el permiso con la
 * promesa de que todo push se le muestra al usuario (`userVisibleOnly`). Si el
 * service worker recibe un push y no muestra nada, el navegador lo castiga —
 * primero pinta un aviso genérico de "esta app se ejecutó en segundo plano" y
 * si se repite, deja de entregar los push.
 */
self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    // Un push sin JSON válido (o de prueba desde las DevTools) igual tiene que
    // mostrar algo, por la regla de arriba.
    datos = { titulo: 'Inventario', cuerpo: event.data ? event.data.text() : '' };
  }

  const titulo = datos.titulo || 'Inventario';
  const opciones = {
    body:  datos.cuerpo || '',
    icon:  ICONO,
    badge: ICONO,
    // `tag` agrupa: un segundo aviso del mismo tipo REEMPLAZA al anterior en vez
    // de apilar diez notificaciones de cartera vencida.
    tag:   datos.tag || 'general',
    renotify: true,
    // A dónde ir al tocarla. Viaja en `data` porque es lo único que sobrevive
    // hasta el evento de clic.
    data:  { url: datos.url || '/', tipo: datos.tipo || 'general' },
    // Vibración corta: en Android se siente aunque el celular esté en silencio
    // visual. iOS la ignora.
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

/**
 * El usuario tocó la notificación.
 *
 * Si la app ya está abierta se ENFOCA esa ventana y se navega dentro de ella;
 * abrir una pestaña nueva cada vez dejaría al usuario con cinco copias de la
 * app y, peor, con sesiones a medio cargar.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const destino = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const ventanas = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const ventana of ventanas) {
      // Misma app abierta: enfocar y navegar ahí mismo.
      if ('focus' in ventana) {
        await ventana.focus();
        if ('navigate' in ventana && destino) {
          await ventana.navigate(destino).catch(() => {});
        }
        return;
      }
    }

    if (clients.openWindow) await clients.openWindow(destino);
  })());
});

/**
 * El navegador rotó la suscripción por su cuenta.
 *
 * Pasa cada tanto y sin avisarle al usuario: si no se re-registra, el
 * dispositivo deja de recibir avisos en silencio y nadie se entera hasta que
 * alguien reclama que no le llegó nada. Aquí solo se avisa a la app; el
 * re-registro con el token de sesión lo hace el frontend (usePush).
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const ventanas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    ventanas.forEach((v) => v.postMessage({ tipo: 'push-resuscribir' }));
  })());
});
