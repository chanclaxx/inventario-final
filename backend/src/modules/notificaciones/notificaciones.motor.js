const alertas     = require('./notificaciones.alertas');
const operaciones = require('./notificaciones.operaciones');

// ─────────────────────────────────────────────────────────────────────────────
// EL MOTOR — de diez avisos sueltos a una decisión
//
// ── El problema que resuelve ────────────────────────────────────────────────
// Antes cada alerta armaba y mandaba su propio push. Un negocio con cartera,
// stock bajo y una factura de proveedor recibía CINCO O SEIS notificaciones
// seguidas a las 8:00. Eso no es informar: es la forma más rápida de que alguien
// silencie la app, y entonces el aviso que sí importaba tampoco llega.
//
// ── La regla ────────────────────────────────────────────────────────────────
// Todo se convierte primero en SEÑALES con una misma forma. Después se decide:
//
//   URGENTE  → notificación propia. Es algo que hay que hacer HOY y que cuesta
//              plata si no se hace: un cobro vencido, una garantía que se vence
//              esta semana, una caja que quedó abierta anoche.
//   NORMAL   → entra en UN solo resumen. Sigue estando, sigue siendo visible al
//              abrirlo, pero no compite por la atención con lo urgente.
//
// Lo que decide la prioridad NO es el tipo de aviso sino su SITUACIÓN: el mismo
// pago es normal a siete días y urgente mañana. Por eso cada señal calcula su
// propia urgencia y el motor no tiene una tabla de "tipos importantes".
//
// ── Lo que este archivo NO hace ─────────────────────────────────────────────
// No envía. Devuelve las señales y quien las manda es el cron (o las pinta la
// pantalla de Avisos, que consume exactamente lo mismo). Separarlo es lo que
// permite que el panel y las notificaciones NUNCA discrepen sobre qué hay
// pendiente: si el motor dijera una cosa al pintar y otra al enviar, el usuario
// abriría el resumen y encontraría algo distinto a lo que le avisaron.
// ─────────────────────────────────────────────────────────────────────────────

const _pesos = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
const _plural = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;

/**
 * Una SEÑAL. Es el único formato que el resto del sistema conoce.
 *
 *   clave         identidad estable — dedupe del día y `tag` del push
 *   prioridad     'urgente' | 'normal'
 *   categoria     para agrupar en el panel
 *   titulo/cuerpo texto ya listo para la pantalla bloqueada (ver regla 2 del
 *                 service: nada de nombres con montos)
 *   url           a dónde lleva el toque
 *   valor         plata implicada, para ordenar dentro de una categoría
 *   n             cuántos documentos representa
 */
const _senal = (s) => ({ prioridad: 'normal', valor: 0, n: 1, ...s });

// ── Umbrales ─────────────────────────────────────────────────────────────────
//
// Se leen de la config del negocio cuando existe, con un default sensato. No son
// constantes sueltas: un negocio que compra a 90 días necesita otra ventana que
// uno que compra de contado, y sin poder moverlas el aviso o llega tarde o se
// vuelve ruido.
const DEFAULTS = {
  garantia_dias:  15,   // avisar de una garantía que vence dentro de N días
  entrada_dias:    3,   // una entrada sin confirmar pasados N días
  caja_horas:     16,   // una caja abierta más de N horas
};

const _umbrales = async (negocioId) => {
  try {
    const configRepo = require('../config/config.repository');
    const cfg = await configRepo.getMap(negocioId);
    const leer = (clave, def, min, max) => {
      const n = Number(cfg?.[clave]);
      return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : def;
    };
    return {
      garantia_dias: leer('notif_garantia_dias', DEFAULTS.garantia_dias, 1, 90),
      entrada_dias:  leer('notif_entrada_dias',  DEFAULTS.entrada_dias,  0, 30),
      caja_horas:    leer('notif_caja_horas',    DEFAULTS.caja_horas,    4, 72),
    };
  } catch {
    return { ...DEFAULTS };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Recolección
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Todas las señales vivas de un negocio, ya priorizadas.
 *
 * Cada bloque va en su propio try/catch dentro de su alerta: una consulta que
 * falle apaga SU señal y no la pasada completa. Es la misma decisión que ya
 * tomaba el cron por negocio, un nivel más abajo.
 */
const recolectar = async (negocioId) => {
  const u = await _umbrales(negocioId);

  const [cartera, proveedores, plan, stock, borradores,
    garantias, pedidos, entradas, cajas] = await Promise.all([
    alertas.cartera(negocioId),
    alertas.carteraProveedores(negocioId),
    alertas.planPorVencer(negocioId),
    alertas.stockBajo(negocioId),
    alertas.borradoresPorVencer(negocioId),
    operaciones.garantiasPorVencer(negocioId, u.garantia_dias),
    operaciones.pedidosAtrasados(negocioId),
    operaciones.entradasSinConfirmar(negocioId, u.entrada_dias),
    operaciones.cajasSinCerrar(negocioId, u.caja_horas),
  ]);

  const senales = [];

  // ── Cobros ────────────────────────────────────────────────────────────────
  // Lo VENCIDO es urgente por definición: ya se pasó la fecha y cada día que
  // corre es mora que el cliente va a discutir.
  const venc = cartera?.vencidos;
  if (venc?.items?.length) {
    senales.push(_senal({
      clave: 'cobros_vencidos', prioridad: 'urgente', categoria: 'cobros',
      titulo: `${_plural(venc.total_clientes, 'cobro vencido', 'cobros vencidos')}`,
      cuerpo: `${_pesos(venc.total)} por recuperar. Toca para ver a quién llamar.`,
      url: '/prestamos', valor: Number(venc.total || 0), n: venc.total_clientes,
    }));
  }

  // Lo que aún NO vence es un recordatorio: llamar hoy evita la mora de pasado
  // mañana, pero nadie tiene que dejar lo que está haciendo.
  const porV = cartera?.por_vencer;
  if (porV?.items?.length) {
    senales.push(_senal({
      clave: 'cobros_por_vencer', categoria: 'cobros',
      titulo: `${_plural(porV.total_clientes, 'cobro se vence', 'cobros se vencen')} pronto`,
      cuerpo: `${_pesos(porV.total)} dentro de ${cartera.dias_aviso} días o menos.`,
      url: '/prestamos', valor: Number(porV.total || 0), n: porV.total_clientes,
    }));
  }

  // ── Lo que el negocio DEBE ────────────────────────────────────────────────
  // `carteraProveedores` devuelve ARREGLOS planos (`vencidas` / `por_vencer`),
  // no grupos con totales como la cartera de clientes. El total se suma aquí.
  const _saldo = (lista) => (lista || []).reduce((t, i) => t + Number(i.saldo || 0), 0);

  if (proveedores?.vencidas?.length) {
    const v = proveedores.vencidas;
    senales.push(_senal({
      clave: 'proveedor_vencido', prioridad: 'urgente', categoria: 'proveedores',
      titulo: `${_plural(v.length, 'factura vencida', 'facturas vencidas')} por pagar`,
      cuerpo: `Le debes ${_pesos(_saldo(v))} a proveedores y ya se pasó la fecha.`,
      url: '/proveedores?tab=compras', valor: _saldo(v), n: v.length,
    }));
  }
  if (proveedores?.por_vencer?.length) {
    const v = proveedores.por_vencer;
    senales.push(_senal({
      clave: 'proveedor_por_vencer', categoria: 'proveedores',
      titulo: `${_plural(v.length, 'factura', 'facturas')} de proveedor por vencer`,
      cuerpo: `${_pesos(_saldo(v))} con fecha próxima.`,
      url: '/proveedores?tab=compras', valor: _saldo(v), n: v.length,
    }));
  }

  // ── Garantías ─────────────────────────────────────────────────────────────
  // Urgente solo si alguna vence HOY: una garantía que se pasa ya no se puede
  // reclamar, y ese es el único momento en que no da esperar a mañana.
  if (garantias?.total) {
    senales.push(_senal({
      clave: 'garantias_por_vencer',
      prioridad: garantias.vencen_hoy > 0 ? 'urgente' : 'normal',
      categoria: 'garantias',
      titulo: garantias.vencen_hoy > 0
        ? `${_plural(garantias.vencen_hoy, 'garantía vence', 'garantías vencen')} HOY`
        : `${_plural(garantias.total, 'garantía', 'garantías')} por vencer`,
      cuerpo: garantias.vencen_hoy > 0
        ? 'Después de hoy ya no se le puede reclamar al proveedor.'
        : `Equipos con garantía del proveedor a punto de acabarse.`,
      url: '/proveedores?tab=compras', n: garantias.total,
    }));
  }

  // ── Pedidos que no llegaron ───────────────────────────────────────────────
  if (pedidos?.total) {
    const peor = pedidos.items[0];
    senales.push(_senal({
      clave: 'pedidos_atrasados', categoria: 'pedidos',
      titulo: `${_plural(pedidos.total, 'pedido atrasado', 'pedidos atrasados')}`,
      cuerpo: `El más viejo lleva ${_plural(peor.dias_atraso, 'día', 'días')} de retraso.`,
      url: '/proveedores?tab=ordenes', n: pedidos.total,
    }));
  }

  // ── Entradas sin valorizar ────────────────────────────────────────────────
  // No es plata que se pierda, pero mientras tanto cada venta de esa mercancía
  // reporta una utilidad que no es la real.
  if (entradas?.total) {
    senales.push(_senal({
      clave: 'entradas_sin_confirmar', categoria: 'entradas',
      titulo: `${_plural(entradas.total, 'entrada', 'entradas')} sin confirmar`,
      cuerpo: 'Se está vendiendo con costo provisional hasta que les pongas la factura.',
      url: '/entradas', n: entradas.total,
    }));
  }

  // ── Caja abierta ──────────────────────────────────────────────────────────
  // Siempre urgente: cada hora que pasa mezcla el turno de hoy con el de ayer y
  // el descuadre deja de tener dueño.
  if (cajas?.total) {
    senales.push(_senal({
      clave: 'caja_sin_cerrar', prioridad: 'urgente', categoria: 'caja',
      titulo: `${_plural(cajas.total, 'caja quedó abierta', 'cajas quedaron abiertas')}`,
      cuerpo: `La más vieja lleva ${_plural(cajas.items[0].horas_abierta, 'hora', 'horas')} sin cerrar.`,
      url: '/caja', n: cajas.total,
    }));
  }

  // ── El plan ───────────────────────────────────────────────────────────────
  // Urgente cuando faltan 3 días o menos: pasado el vencimiento la app se
  // bloquea y no se puede ni facturar.
  // `planPorVencer` devuelve null cuando no hay nada que avisar: ya filtra por su
  // propia escalera de días (7/3/1/0) y descarta el plan ya vencido, del que se
  // encarga el bloqueo y no un aviso.
  if (plan) {
    const dias = Number(plan.dias);
    senales.push(_senal({
      clave: 'plan_por_vencer',
      prioridad: dias <= 3 ? 'urgente' : 'normal',
      categoria: 'plan',
      titulo: dias <= 0 ? 'Tu plan vence hoy' : `Tu plan vence en ${_plural(dias, 'día', 'días')}`,
      cuerpo: 'Renuévalo para no quedarte sin facturar.',
      url: '/config', n: 1,
    }));
  }

  // ── Borradores ────────────────────────────────────────────────────────────
  if (borradores?.length) {
    senales.push(_senal({
      clave: 'borradores_por_vencer', categoria: 'borradores',
      titulo: `${_plural(borradores.length, 'venta guardada', 'ventas guardadas')} por vencer`,
      cuerpo: 'Si nadie las atiende, la mercancía apartada se libera sola.',
      url: '/', n: borradores.length,
    }));
  }

  // ── Stock bajo ────────────────────────────────────────────────────────────
  // El menos urgente de todos y el que más ruido hacía: es una lista que casi
  // siempre tiene algo, y por eso nunca justifica una notificación propia.
  // `stockBajo` devuelve una fila POR SUCURSAL con su conteo, no una lista de
  // productos: lo que se cuenta es la suma de `cuantos`, no el largo del arreglo.
  const bajos = (stock || []).reduce((t, s2) => t + Number(s2.cuantos || 0), 0);
  if (bajos > 0) {
    const agotados = (stock || []).reduce((t, s2) => t + Number(s2.agotados || 0), 0);
    senales.push(_senal({
      clave: 'stock_bajo', categoria: 'inventario',
      titulo: `${_plural(bajos, 'producto', 'productos')} en el mínimo`,
      cuerpo: agotados > 0
        ? `${_plural(agotados, 'está agotado', 'están agotados')}. Revisa qué volver a pedir.`
        : 'Revisa qué hay que volver a pedir.',
      url: '/inventario', n: bajos,
    }));
  }

  // Dentro de cada prioridad manda la PLATA. Un cobro de $3.000.000 va antes que
  // uno de $50.000 aunque los dos lleven los mismos días vencidos.
  const orden = { urgente: 0, normal: 1 };
  senales.sort((a, b) => (orden[a.prioridad] - orden[b.prioridad]) || (b.valor - a.valor));

  return {
    senales,
    urgentes: senales.filter((s) => s.prioridad === 'urgente'),
    normales: senales.filter((s) => s.prioridad === 'normal'),
    // El detalle crudo, para la pantalla de Avisos. El push nunca lo lleva: en
    // una pantalla bloqueada no van nombres de clientes con sus montos.
    detalle: { cartera, proveedores, garantias, pedidos, entradas, cajas, stock, borradores, plan },
    umbrales: u,
  };
};

/**
 * El texto del resumen del día, a partir de las señales normales.
 *
 * Devuelve `null` cuando no hay nada: un resumen que dice "no tienes nada
 * pendiente" todos los días entrena a la gente a ignorarlo, y entonces el día
 * que sí trae algo tampoco lo abre.
 */
const resumenDiario = (normales) => {
  if (!normales.length) return null;

  // Cada señal aporta su parte corta. El cuerpo tiene que caber en la pantalla
  // bloqueada de un celular: tres o cuatro trozos, no diez.
  const partes = normales.slice(0, 4).map((s) => s.titulo.toLowerCase());
  const resto  = normales.length - partes.length;

  return {
    titulo: `Resumen del día · ${_plural(normales.length, 'cosa por revisar', 'cosas por revisar')}`,
    cuerpo: partes.join(' · ') + (resto > 0 ? ` y ${resto} más` : ''),
    url: '/avisos',
  };
};

module.exports = { recolectar, resumenDiario, DEFAULTS };
