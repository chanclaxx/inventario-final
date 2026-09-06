const cron    = require('node-cron');
const alertas = require('./notificaciones.alertas');
const service = require('./notificaciones.service');
const motor   = require('./notificaciones.motor');

// ─────────────────────────────────────────────────────────────────────────────
// AVISOS AUTOMÁTICOS — una pasada diaria por los negocios con dispositivos.
//
// Seis avisos: pagos POR VENCER, cartera VENCIDA, plan por vencer, stock bajo,
// facturas de proveedor por pagar y borradores de venta por vencer. Los dos
// primeros van separados porque son dos trabajos distintos: al que todavía no
// vence se le recuerda, al vencido se le cobra. El de proveedores va en la
// dirección contraria a todos los demás —ahí el que debe es el negocio— y por
// eso abre otra pantalla. El de borradores es el único que avisa de algo que va
// a DESHACERSE solo: si nadie lo atiende, la mercancía apartada se libera.
//
// Se manda a las 8:00 de Colombia por defecto: temprano para que dé tiempo de
// llamar a los clientes en el día, pero no de madrugada. Configurable con
// NOTIF_CRON sin tocar código.
//
// LAS TRES REGLAS DE ESTE ARCHIVO:
//
//   1. NADA SE REPITE EN EL DÍA. Todos los envíos usan `unico_por_dia`, que se
//      apoya en el índice único de `notificaciones_enviadas`. Railway reinicia
//      el contenedor cuando quiere; sin esto, al dueño le llegaría tres veces el
//      mismo aviso de cartera y dejaría de mirarlos.
//
//   2. UN NEGOCIO QUE FALLA NO TUMBA A LOS DEMÁS. Cada negocio va en su propio
//      try/catch: una base sin la migración de mora o un dato raro solo se salta
//      ese negocio.
//
//   3. EL TEXTO NO LLEVA DATOS SENSIBLES. La notificación se ve en la pantalla
//      bloqueada: van cantidades y totales, nunca "Juan Pérez debe $340.000".
//      Los nombres y teléfonos están al abrir la app, detrás de la sesión.
// ─────────────────────────────────────────────────────────────────────────────

const CRON_POR_DEFECTO = '0 8 * * *';   // todos los días a las 8:00 (Bogotá)
const ZONA = 'America/Bogota';

const _pesos = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;

const _resolverExpresion = () => {
  const custom = process.env.NOTIF_CRON;
  if (!custom) return CRON_POR_DEFECTO;
  if (cron.validate(custom)) return custom;
  console.warn(`[notif-cron] NOTIF_CRON inválida ("${custom}") — usando "${CRON_POR_DEFECTO}"`);
  return CRON_POR_DEFECTO;
};

// ── Avisos 1 y 2: cobros, UNO POR DEUDA ─────────────────────────────────────
//
// Cada aviso abre DIRECTO la ficha del cliente en la pantalla donde está su
// deuda (préstamo → Préstamos con la persona ya seleccionada; crédito → la
// pestaña de Créditos). Por eso van uno por documento y no un resumen: un
// resumen no puede llevar a cinco lugares distintos, y el punto es que quien
// recibe el aviso no tenga que buscar a nadie.
//
// Se agrupan POR DESTINO: un cliente con tres préstamos vencidos recibe UN aviso
// con el total, no tres idénticos. Si además tiene una factura a crédito, esa va
// aparte porque abre otra pantalla.
//
// TOPE DE 5 POR SUCURSAL Y POR TIPO: con veinte vencidos, veinte notificaciones
// seguidas se convierten en algo que se descarta sin leer. Se mandan las más
// urgentes (las listas ya vienen ordenadas) y la última avisa cuántas quedaron
// fuera, llevando a la lista completa.
const MAX_AVISOS_POR_SUCURSAL = 5;

/** Agrupa una lista de cobros por sucursal. */
const _porSucursal = (items) => {
  const mapa = new Map();
  for (const it of items) {
    if (!mapa.has(it.sucursal_id)) mapa.set(it.sucursal_id, []);
    mapa.get(it.sucursal_id).push(it);
  }
  return mapa;
};

/** Cómo se nombra el documento en el texto, con su artículo. */
const _etiquetaDoc = (d) =>
  d.tipo === 'prestamo' ? `del préstamo #${d.numero}` : `de la factura #${d.numero}`;

/**
 * Agrupa por DESTINO (la ficha que abre el aviso).
 *
 * Un cliente con tres préstamos vencidos tenía tres notificaciones idénticas que
 * abrían el mismo lugar. Agrupadas, recibe una sola con el total de lo que debe
 * ahí. Si además tiene una factura a crédito, esa sí va aparte: es otra pantalla.
 */
const _porDestino = (docs) => {
  const mapa = new Map();
  for (const d of docs) {
    if (!mapa.has(d.url)) mapa.set(d.url, []);
    mapa.get(d.url).push(d);
  }
  return [...mapa.values()];
};

/** Texto de "qué debe" según sea una deuda o varias en el mismo lugar. */
const _detalleDeudas = (grupo) => {
  const total = grupo.reduce((s, d) => s + d.total, 0);
  if (grupo.length === 1) return `${_pesos(total)} ${_etiquetaDoc(grupo[0])}`;
  const tipo = grupo.every((d) => d.tipo === 'prestamo') ? 'préstamos'
    : grupo.every((d) => d.tipo === 'credito')           ? 'facturas'
    :                                                      'deudas';
  return `${_pesos(total)} en ${grupo.length} ${tipo}`;
};

const _avisarCarteraVencida = async (negocioId, cartera) => {
  const items = cartera.vencidos.items;
  if (!items.length) return 0;

  let enviados = 0;
  for (const [sucursalId, docs] of _porSucursal(items)) {
    const destinos = _porDestino(docs);

    for (const grupo of destinos.slice(0, MAX_AVISOS_POR_SUCURSAL)) {
      const d    = grupo[0];                                   // el más atrasado
      const dias = Math.max(...grupo.map((x) => x.dias_vencidos));

      const res = await service.enviar({
        negocio_id:  negocioId,
        sucursal_id: sucursalId,
        roles:       ['admin_negocio', 'supervisor'],
        titulo: `${d.persona} · ${dias} día${dias === 1 ? '' : 's'} de atraso`,
        cuerpo: `Debe ${_detalleDeudas(grupo)}. Toca para abrir su cuenta y cobrarle.`,
        // Directo a la ficha de esa persona.
        url:  d.url,
        // Un tag por destino: dos clientes no se pisan la notificación, pero el
        // mismo cliente no acumula una por cada deuda.
        tag:  `cobro-${d.url}`,
        tipo: 'cartera_vencida',
        referencia_id: d.url,
        unico_por_dia: true,
      });
      enviados += res.enviados || 0;
    }

    const sobran = destinos.length - MAX_AVISOS_POR_SUCURSAL;
    if (sobran > 0) {
      const res = await service.enviar({
        negocio_id:  negocioId,
        sucursal_id: sucursalId,
        roles:       ['admin_negocio', 'supervisor'],
        titulo: `y ${sobran} cobro${sobran === 1 ? '' : 's'} más vencido${sobran === 1 ? '' : 's'}`,
        cuerpo: `Además de los anteriores. Toca para ver la lista completa.`,
        url:  '/prestamos',
        tag:  `cartera-resto-${sucursalId}`,
        tipo: 'cartera_vencida_resto',
        referencia_id: String(sucursalId),
        unico_por_dia: true,
      });
      enviados += res.enviados || 0;
    }
  }
  return enviados;
};

// ── Lo que se fue, y por qué ────────────────────────────────────────────────
//
// Aquí vivían cinco emisores más: por-vencer de clientes, plan, facturas de
// proveedor, stock bajo y borradores. Cada uno armaba y mandaba su propio push,
// y por eso un negocio con varias cosas abiertas recibía cinco o seis
// notificaciones seguidas a las 8:00.
//
// Todos siguen existiendo como SEÑALES en `notificaciones.motor.js`: se siguen
// calculando, se siguen viendo en el panel de Avisos, y los que son urgentes
// siguen sonando solos. Lo que cambió es que los que NO son urgentes viajan
// juntos en un resumen en vez de competir cada uno por la atención.
//
// El de cobros vencidos NO se fue, y esa excepción es deliberada: es el único
// cuyo valor entero está en llevar a la ficha de UNA persona concreta para
// llamarla. Un resumen no puede abrir cinco fichas distintas.

// ─────────────────────────────────────────────────────────────────────────────
// LA PASADA — urgente aparte, el resto en UN resumen
//
// Antes cada aviso se mandaba por su cuenta y un negocio con cartera, stock y
// una factura de proveedor recibía cinco o seis notificaciones seguidas a la
// misma hora. Ahora el motor decide: lo urgente conserva su notificación propia
// (es lo que hay que hacer HOY) y todo lo demás se junta en un solo resumen que
// abre el panel de Avisos.
//
// DOS PASADAS AL DÍA:
//   · la de la mañana manda todo — urgentes y resumen
//   · la de la tarde manda SOLO urgentes, y solo los que siguen ahí
//
// La de la tarde es una segunda oportunidad para el cobro del día, no una
// repetición: `unico_por_dia` hace que lo que ya salió en la mañana no vuelva a
// sonar, así que en la tarde solo suena lo que apareció después o lo que nadie
// atendió y cambió de estado. Repetir el mismo resumen dos veces es la forma más
// rápida de que dejen de mirarlo.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manda las señales de UN negocio.
 *
 * @param {number} negocioId
 * @param {boolean} soloUrgentes — la pasada de la tarde
 */
const _avisarNegocio = async (negocioId, { soloUrgentes = false } = {}) => {
  const { urgentes, normales, detalle } = await motor.recolectar(negocioId);
  let enviados = 0;

  // Cada urgente conserva su notificación propia. `tag` = la clave, así que un
  // segundo aviso del mismo asunto REEMPLAZA al anterior en la bandeja en vez de
  // apilar tres tarjetas de lo mismo.
  for (const s of urgentes) {
    // ── La excepción: los cobros vencidos se delegan ──────────────────────
    //
    // El motor decide QUÉ es urgente; quién lo entrega puede ser otro. Los
    // cobros tienen un emisor propio que manda UNO POR CLIENTE con enlace
    // directo a su ficha, agrupado por destino y acotado a cinco por sucursal.
    // Reemplazarlo por un "3 cobros vencidos" que lleva a la lista general
    // sería cambiar un aviso accionable por uno informativo — justo lo
    // contrario de hacerlo más inteligente.
    if (s.clave === 'cobros_vencidos') {
      enviados += await _avisarCarteraVencida(negocioId, detalle.cartera);
      continue;
    }

    const res = await service.enviar({
      negocio_id: negocioId,
      titulo: s.titulo,
      cuerpo: s.cuerpo,
      url:    s.url,
      tag:    s.clave,
      tipo:   s.clave,
      referencia_id: String(s.n),
      // La deduplicación mira `tipo` + `referencia_id`: si el número de
      // documentos cambia durante el día, el aviso vuelve a salir —porque de
      // verdad es una situación nueva— y si no cambió, se queda callado.
      unico_por_dia: true,
    });
    enviados += res.enviados || 0;
  }

  if (soloUrgentes) return enviados;

  const resumen = motor.resumenDiario(normales);
  // Sin `resumen` no se manda nada. Un "no tienes nada pendiente" diario entrena
  // a la gente a ignorar el aviso, y entonces el día que sí trae algo tampoco lo
  // abre.
  if (resumen) {
    const res = await service.enviar({
      negocio_id: negocioId,
      titulo: resumen.titulo,
      cuerpo: resumen.cuerpo,
      url:    resumen.url,
      tag:    'resumen_diario',
      tipo:   'resumen_diario',
      referencia_id: String(normales.length),
      unico_por_dia: true,
    });
    enviados += res.enviados || 0;
  }

  return enviados;
};

/**
 * Revisa todos los negocios y manda lo que corresponda.
 * Se exporta para poder dispararla a mano (pruebas, o un botón futuro).
 */
const ejecutar = async ({ soloUrgentes = false } = {}) => {
  if (!service.estaActivo()) {
    console.log('[notif-cron] Notificaciones apagadas (sin claves VAPID) — no hay nada que enviar');
    return { negocios: 0, enviados: 0 };
  }

  const negocios = await alertas.negociosANotificar();
  let enviados = 0;

  for (const n of negocios) {
    try {
      enviados += await _avisarNegocio(n.id, { soloUrgentes });
    } catch (err) {
      // Un negocio con datos raros no puede dejar sin avisos a los otros 27.
      console.error(`[notif-cron] Negocio ${n.id} (${n.nombre}) omitido:`, err.message);
    }
  }

  const etiqueta = soloUrgentes ? 'tarde (solo urgentes)' : 'mañana (completa)';
  console.log(`[notif-cron] ✓ ${etiqueta} · ${negocios.length} negocio(s) · ${enviados} notificación(es)`);
  return { negocios: negocios.length, enviados };
};

// La segunda pasada. Solo lo urgente y a media tarde: da tiempo de llamar antes
// de que cierre el día, sin repetir el ruido de la mañana.
const CRON_TARDE_POR_DEFECTO = '0 14 * * *';

const iniciarCronNotificaciones = () => {
  if (!service.estaActivo()) {
    console.log('[notif-cron] Cron de avisos desactivado (faltan las claves VAPID)');
    return;
  }
  const expresion = _resolverExpresion();

  cron.schedule(expresion, async () => {
    console.log(`[notif-cron] Pasada de la mañana — ${new Date().toISOString()}`);
    try {
      await ejecutar();
    } catch (err) {
      console.error('[notif-cron] Error en la pasada de la mañana:', err.message);
    }
  }, { timezone: ZONA });

  // NOTIF_CRON_TARDE = 'off' la apaga sin tocar código: un negocio de un solo
  // turno no necesita que le recuerden a las 2 lo que ya vio a las 8.
  const expresionTarde = process.env.NOTIF_CRON_TARDE || CRON_TARDE_POR_DEFECTO;
  if (expresionTarde !== 'off' && cron.validate(expresionTarde)) {
    cron.schedule(expresionTarde, async () => {
      console.log(`[notif-cron] Pasada de la tarde — ${new Date().toISOString()}`);
      try {
        await ejecutar({ soloUrgentes: true });
      } catch (err) {
        console.error('[notif-cron] Error en la pasada de la tarde:', err.message);
      }
    }, { timezone: ZONA });
    console.log(`[notif-cron] Cron de avisos activado — ${expresion} y ${expresionTarde} (${ZONA})`);
  } else {
    console.log(`[notif-cron] Cron de avisos activado — ${expresion} (${ZONA}), sin pasada de tarde`);
  }
};

module.exports = { iniciarCronNotificaciones, ejecutar };
