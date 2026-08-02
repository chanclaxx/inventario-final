const webpush = require('web-push');
const repo    = require('./notificaciones.repository');

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICACIONES PUSH (Web Push / VAPID)
//
// Fase 1: infraestructura. Un dispositivo se suscribe, se guarda su endpoint y
// desde aquí se le puede empujar un aviso aunque la app esté cerrada.
//
// DECISIONES, en orden de importancia:
//
//   1. FEATURE OPT-IN A NIVEL DE SERVIDOR. Sin las variables VAPID_* nada de
//      esto se activa: `estaActivo()` devuelve false, las rutas responden 503 y
//      el resto del sistema funciona exactamente igual. Es lo que permite
//      desplegar esto sin tocar la configuración de producción el mismo día.
//
//   2. EL PAYLOAD SE VE EN LA PANTALLA BLOQUEADA. No van cédulas, ni nombres con
//      montos, ni nada que no quieras que lea quien tenga el celular en la mano.
//      "Tienes 3 clientes vencidos" sí; "Juan Pérez debe $340.000" no.
//
//   3. UN 404/410 SIGNIFICA QUE EL DISPOSITIVO YA NO EXISTE (el usuario
//      desinstaló la app o limpió el navegador) y su fila se BORRA en el acto.
//      Sin esa limpieza la tabla se llena de endpoints muertos y cada envío se
//      vuelve más lento y más caro.
//
//   4. LOS ENVÍOS NUNCA TUMBAN AL LLAMADOR. `enviar()` no lanza: un aviso que no
//      salió no puede hacer fallar la venta, el abono ni el cron que lo disparó.
//
//   5. FRONTERA MULTI-TENANT. Todo envío se resuelve dentro de un negocio_id.
//      No existe forma de mandar un aviso a los dispositivos de otro negocio.
// ─────────────────────────────────────────────────────────────────────────────

const TTL_SEGUNDOS = 60 * 60 * 24;   // el push caduca en 24h si el celular no se conecta

let _configurado = false;

/**
 * ¿Está la feature encendida en este servidor?
 * Configura web-push la primera vez que se pregunta.
 */
const estaActivo = () => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;

  if (!_configurado) {
    // El estándar exige un contacto (mailto: o https://) para que el servicio de
    // push pueda avisarte si tus envíos dan problemas.
    const subject = process.env.VAPID_SUBJECT || 'mailto:soporte@inventario.app';
    webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    _configurado = true;
  }
  return true;
};

/** La clave pública que necesita el navegador para suscribirse. */
const clavePublica = () => process.env.VAPID_PUBLIC_KEY || null;

// ── Suscripciones ────────────────────────────────────────────────────────────

/**
 * Guarda el dispositivo que acaba de aceptar las notificaciones.
 *
 * La `suscripcion` llega tal cual la entrega el navegador:
 *   { endpoint, keys: { p256dh, auth } }
 */
const suscribir = async ({ suscripcion, usuario, userAgent }) => {
  if (!estaActivo()) {
    throw { status: 503, message: 'Las notificaciones no están configuradas en el servidor' };
  }

  const endpoint = suscripcion?.endpoint;
  const p256dh   = suscripcion?.keys?.p256dh;
  const auth     = suscripcion?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw { status: 400, message: 'La suscripción del navegador está incompleta' };
  }
  // Un endpoint es una URL https del servicio de push del navegador. Validarlo
  // evita guardar basura que después falla en cada envío.
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 1000) {
    throw { status: 400, message: 'Endpoint de notificaciones inválido' };
  }

  const fila = await repo.upsert({
    usuario_id:  usuario.id,
    negocio_id:  usuario.negocio_id,
    // El admin no tiene sucursal fija (la pasa por query en cada request), así
    // que su dispositivo se guarda sin sucursal y recibe lo de todo el negocio.
    sucursal_id: usuario.sucursal_id ?? null,
    endpoint, p256dh, auth,
    user_agent:  (userAgent || '').slice(0, 300),
  });

  return { id: fila.id, activa: fila.activa };
};

/** Baja del dispositivo. Idempotente: desactivar dos veces no es un error. */
const desuscribir = async ({ endpoint, usuario }) => {
  if (!endpoint) throw { status: 400, message: 'Falta el endpoint del dispositivo' };
  const borrada = await repo.eliminarPorEndpoint(endpoint, usuario.id);
  return { desuscrito: borrada };
};

/** Dispositivos activos del usuario, para que la pantalla muestre cuántos hay. */
const misDispositivos = async (usuarioId) => {
  const filas = await repo.findPorUsuario(usuarioId);
  return filas.map((f) => ({
    id:         f.id,
    // El endpoint completo no se devuelve: es la credencial de envío. Con el
    // final basta para que el usuario reconozca el dispositivo actual.
    endpoint_fin: String(f.endpoint).slice(-12),
    user_agent: f.user_agent,
    creado_en:  f.creado_en,
    ultimo_ok:  f.ultimo_ok,
  }));
};

// ── Envío ────────────────────────────────────────────────────────────────────

/**
 * Empuja un aviso a UN dispositivo. Uso interno.
 * Devuelve true si salió; nunca lanza.
 */
const _empujar = async (destino, payload) => {
  try {
    await webpush.sendNotification(
      { endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } },
      JSON.stringify(payload),
      { TTL: TTL_SEGUNDOS },
    );
    await repo.marcarOk(destino.endpoint);
    return true;
  } catch (err) {
    // 404 / 410: el navegador dice que ese endpoint ya no existe (desinstalaron
    // la app, limpiaron datos). No es un error recuperable: se borra la fila.
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await repo.eliminarMuerto(destino.endpoint).catch(() => {});
      return false;
    }
    await repo.marcarFallo(destino.endpoint).catch(() => {});
    console.warn(`[push] Fallo enviando a ...${String(destino.endpoint).slice(-12)}:`,
      err?.statusCode || '', err?.message || err);
    return false;
  }
};

/**
 * Envía un aviso a los dispositivos de un negocio.
 *
 * NUNCA LANZA: si las notificaciones están apagadas o el envío falla, devuelve
 * el conteo en ceros. Un aviso que no salió no puede hacer fallar la venta, el
 * abono ni el cron desde el que se llamó.
 *
 * @param {object}   opts
 * @param {number}   opts.negocio_id   — obligatorio, frontera multi-tenant
 * @param {number}   [opts.sucursal_id]— limita a esa sucursal (el admin igual recibe)
 * @param {string[]} [opts.roles]      — ej. ['admin_negocio', 'supervisor']
 * @param {number}   [opts.usuario_id] — un único destinatario
 * @param {string}   opts.titulo
 * @param {string}   opts.cuerpo
 * @param {string}   [opts.url]        — a dónde lleva el clic (ruta del frontend)
 * @param {string}   [opts.tag]        — agrupa/reemplaza avisos del mismo tipo
 * @param {string}   [opts.tipo]       — para la bitácora
 * @param {string}   [opts.referencia_id] — con `tipo`, evita repetir el aviso el mismo día
 * @param {boolean}  [opts.unico_por_dia] — activa la deduplicación por día
 */
const enviar = async ({
  negocio_id, sucursal_id = null, roles = null, usuario_id = null,
  titulo, cuerpo, url = '/', tag = 'general', tipo = 'general',
  referencia_id = '', unico_por_dia = false,
}) => {
  const vacio = { enviados: 0, fallidos: 0, omitido: true };
  if (!estaActivo() || !negocio_id || !titulo) return vacio;

  try {
    // Deduplicación: si este aviso ya salió hoy, no se repite.
    let bitacoraId = null;
    if (unico_por_dia) {
      bitacoraId = await repo.reservarEnvio({ negocio_id, tipo, referencia_id, titulo, cuerpo });
      if (!bitacoraId) return { enviados: 0, fallidos: 0, repetido: true };
    }

    const destinos = await repo.findDestinatarios({
      negocioId: negocio_id, sucursalId: sucursal_id, roles, usuarioId: usuario_id,
    });
    if (!destinos.length) {
      await repo.cerrarEnvio(bitacoraId, { enviados: 0, fallidos: 0 });
      return { enviados: 0, fallidos: 0, sin_dispositivos: true };
    }

    const payload = {
      titulo,
      cuerpo: cuerpo || '',
      url,
      tag,
      tipo,
      fecha: new Date().toISOString(),
    };

    const resultados = await Promise.all(destinos.map((d) => _empujar(d, payload)));
    const enviados = resultados.filter(Boolean).length;
    const fallidos = resultados.length - enviados;

    await repo.cerrarEnvio(bitacoraId, { enviados, fallidos });
    return { enviados, fallidos };
  } catch (err) {
    // Ni siquiera un error de base de datos puede propagarse: quien llamó estaba
    // haciendo otra cosa (vender, abonar) y eso tiene que terminar bien.
    console.error('[push] Error en el envío:', err.message);
    return vacio;
  }
};

/**
 * Aviso de prueba al propio usuario. Es LA herramienta de depuración: si esta
 * llega al celular, el resto es solo decidir qué texto mandar y cuándo.
 */
const enviarPrueba = async (usuario) => {
  if (!estaActivo()) {
    throw { status: 503, message: 'Las notificaciones no están configuradas en el servidor' };
  }
  const dispositivos = await repo.findPorUsuario(usuario.id);
  if (!dispositivos.length) {
    throw { status: 400, message: 'No tienes ningún dispositivo activado. Activa las notificaciones primero.' };
  }

  const res = await enviar({
    negocio_id: usuario.negocio_id,
    usuario_id: usuario.id,
    titulo: 'Notificaciones activadas ✓',
    cuerpo: 'Si ves esto, tu dispositivo ya puede recibir avisos del sistema.',
    url:    '/configuracion',
    tag:    'prueba',
    tipo:   'prueba',
  });

  if (!res.enviados) {
    throw { status: 502, message: 'No se pudo entregar la notificación de prueba. Revisa los permisos del navegador.' };
  }
  return res;
};

module.exports = {
  estaActivo, clavePublica,
  suscribir, desuscribir, misDispositivos,
  enviar, enviarPrueba,
};
