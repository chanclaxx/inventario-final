const cron    = require('node-cron');
const alertas = require('./notificaciones.alertas');
const service = require('./notificaciones.service');

// ─────────────────────────────────────────────────────────────────────────────
// AVISOS AUTOMÁTICOS — una pasada diaria por los negocios con dispositivos.
//
// Cuatro avisos: pagos POR VENCER, cartera VENCIDA, plan por vencer y stock bajo.
// Los dos primeros van separados porque son dos trabajos distintos: al que
// todavía no vence se le recuerda, al vencido se le cobra.
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

/** Agrupa una lista de cobros por sucursal. */
const _porSucursal = (items) => {
  const mapa = new Map();
  for (const it of items) {
    if (!mapa.has(it.sucursal_id)) mapa.set(it.sucursal_id, []);
    mapa.get(it.sucursal_id).push(it);
  }
  return mapa;
};

const _clientesDistintos = (docs) =>
  new Set(docs.map((d) => `${d.persona}|${d.telefono ?? ''}`)).size;

// ── Aviso 1: cartera vencida (a quién hay que llamar hoy) ────────────────────
//
// Va por SUCURSAL, no por negocio: el supervisor de un local no puede hacer nada
// con los vencidos del otro, y el dueño (admin_negocio) los recibe todos porque
// el reparto de destinatarios siempre lo incluye.
const _avisarCarteraVencida = async (negocioId, cartera) => {
  const items = cartera.vencidos.items;
  if (!items.length) return 0;

  let enviados = 0;
  for (const [sucursalId, docs] of _porSucursal(items)) {
    const total    = docs.reduce((s, d) => s + d.total, 0);
    const clientes = _clientesDistintos(docs);
    const peor     = docs[0];   // ya vienen ordenados por días de atraso

    const res = await service.enviar({
      negocio_id:  negocioId,
      sucursal_id: sucursalId,
      roles:       ['admin_negocio', 'supervisor'],
      titulo: clientes === 1
        ? '1 cliente por cobrar'
        : `${clientes} clientes por cobrar`,
      cuerpo: `${_pesos(total)} vencidos · el más atrasado lleva ${peor.dias_vencidos} día${peor.dias_vencidos === 1 ? '' : 's'}. Toca para llamarlos.`,
      url:  '/cobros',
      tag:  `cartera-${sucursalId}`,
      tipo: 'cartera_vencida',
      referencia_id: String(sucursalId),
      unico_por_dia: true,
    });
    enviados += res.enviados || 0;
  }
  return enviados;
};

// ── Aviso 2: pagos que están por vencer ──────────────────────────────────────
//
// El aviso que evita la mora en vez de perseguirla: se llama al cliente ANTES de
// la fecha, cuando todavía puede pagar sin intereses y la llamada es un
// recordatorio y no un reclamo.
//
// Va en un aviso SEPARADO del de vencidos (y con otro `tag`) a propósito: son
// dos trabajos distintos y mezclarlos en un solo texto haría que el urgente se
// pierda entre los que todavía no deben nada.
const _avisarPorVencer = async (negocioId, cartera) => {
  const items = cartera.por_vencer.items;
  if (!items.length) return 0;

  let enviados = 0;
  for (const [sucursalId, docs] of _porSucursal(items)) {
    const total    = docs.reduce((s, d) => s + d.total, 0);
    const clientes = _clientesDistintos(docs);
    const hoyMismo = docs.filter((d) => d.dias_restantes === 0).length;
    const proximo  = docs[0];   // ordenados del más próximo al más lejano

    // El titular cambia si hay algo venciendo HOY: es lo único que no puede
    // esperar a mañana.
    const titulo = hoyMismo > 0
      ? (hoyMismo === 1 ? '1 pago vence hoy' : `${hoyMismo} pagos vencen hoy`)
      : (clientes === 1 ? '1 pago está por vencer' : `${clientes} pagos están por vencer`);

    const cuando = proximo.dias_restantes === 0 ? 'hoy'
      : proximo.dias_restantes === 1            ? 'mañana'
      : `en ${proximo.dias_restantes} días`;

    const res = await service.enviar({
      negocio_id:  negocioId,
      sucursal_id: sucursalId,
      roles:       ['admin_negocio', 'supervisor'],
      titulo,
      cuerpo: `${_pesos(total)} en total · el más próximo vence ${cuando}. Recuérdaselos antes de que se venzan.`,
      url:  '/cobros?tab=proximos',
      tag:  `porvencer-${sucursalId}`,
      tipo: 'cartera_por_vencer',
      referencia_id: String(sucursalId),
      unico_por_dia: true,
    });
    enviados += res.enviados || 0;
  }
  return enviados;
};

// ── Aviso 2: el plan se acaba ────────────────────────────────────────────────
//
// Solo al dueño: es él quien renueva. Y solo en los hitos 7/3/1/0 días, que es
// lo que decide `alertas.planPorVencer`.
const _avisarPlan = async (negocioId) => {
  const plan = await alertas.planPorVencer(negocioId);
  if (!plan) return 0;

  const { dias } = plan;
  const titulo = dias === 0 ? 'Tu plan vence hoy'
    : dias === 1             ? 'Tu plan vence mañana'
    : `Tu plan vence en ${dias} días`;

  const res = await service.enviar({
    negocio_id: negocioId,
    roles:      ['admin_negocio'],
    titulo,
    cuerpo: dias === 0
      ? 'Renuévalo hoy para no perder el acceso al sistema.'
      : 'Renuévalo con tiempo para que no se te bloquee el sistema.',
    url:  '/',
    tag:  'plan',
    tipo: 'plan_por_vencer',
    // Los días entran en la clave: así el aviso de "faltan 7" no bloquea el de
    // "falta 1". Con el día de calendario ya en el índice, cada hito sale una
    // sola vez.
    referencia_id: String(dias),
    unico_por_dia: true,
  });
  return res.enviados || 0;
};

// ── Aviso 3: stock bajo ──────────────────────────────────────────────────────
const _avisarStockBajo = async (negocioId) => {
  const grupos = await alertas.stockBajo(negocioId);
  if (!grupos.length) return 0;

  let enviados = 0;
  for (const g of grupos) {
    const detalle = g.agotados > 0
      ? `${g.agotados} ya sin stock. Ej.: ${g.ejemplos.slice(0, 2).join(', ')}`
      : `Ej.: ${g.ejemplos.slice(0, 2).join(', ')}`;

    const res = await service.enviar({
      negocio_id:  negocioId,
      sucursal_id: g.sucursal_id,
      roles:       ['admin_negocio', 'supervisor'],
      titulo: g.cuantos === 1
        ? '1 producto bajo el mínimo'
        : `${g.cuantos} productos bajo el mínimo`,
      cuerpo: `${g.sucursal_nombre} · ${detalle}`,
      url:  '/inventario',
      tag:  `stock-${g.sucursal_id}`,
      tipo: 'stock_bajo',
      referencia_id: String(g.sucursal_id),
      unico_por_dia: true,
    });
    enviados += res.enviados || 0;
  }
  return enviados;
};

// ── Pasada completa ──────────────────────────────────────────────────────────

/**
 * Revisa todos los negocios y manda lo que corresponda.
 * Se exporta para poder dispararla a mano (pruebas, o un botón futuro).
 */
const ejecutar = async () => {
  if (!service.estaActivo()) {
    console.log('[notif-cron] Notificaciones apagadas (sin claves VAPID) — no hay nada que enviar');
    return { negocios: 0, enviados: 0 };
  }

  const negocios = await alertas.negociosANotificar();
  let enviados = 0;

  for (const n of negocios) {
    try {
      // Una sola consulta de cartera para los dos avisos: vencidos y próximos
      // salen del mismo recorrido.
      const cartera = await alertas.cartera(n.id);
      enviados += await _avisarCarteraVencida(n.id, cartera);
      enviados += await _avisarPorVencer(n.id, cartera);
      enviados += await _avisarPlan(n.id);
      enviados += await _avisarStockBajo(n.id);
    } catch (err) {
      // Un negocio con datos raros no puede dejar sin avisos a los otros 27.
      console.error(`[notif-cron] Negocio ${n.id} (${n.nombre}) omitido:`, err.message);
    }
  }

  console.log(`[notif-cron] ✓ ${negocios.length} negocio(s) revisado(s) · ${enviados} notificación(es) entregada(s)`);
  return { negocios: negocios.length, enviados };
};

const iniciarCronNotificaciones = () => {
  if (!service.estaActivo()) {
    console.log('[notif-cron] Cron de avisos desactivado (faltan las claves VAPID)');
    return;
  }
  const expresion = _resolverExpresion();

  cron.schedule(expresion, async () => {
    console.log(`[notif-cron] Revisando alertas — ${new Date().toISOString()}`);
    try {
      await ejecutar();
    } catch (err) {
      console.error('[notif-cron] Error en la pasada diaria:', err.message);
    }
  }, { timezone: ZONA });

  console.log(`[notif-cron] Cron de avisos activado — ${expresion} (${ZONA})`);
};

module.exports = { iniciarCronNotificaciones, ejecutar };
