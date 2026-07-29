// ─────────────────────────────────────────────────────────────────────────────
// TARIFAS PORCENTUALES SOBRE EL COSTO (feature opt-in por negocio)
//
// El negocio pregraba N tarifas con nombre y porcentaje ("Frecuente +5%",
// "Ocasional +10%"). En el momento de la venta el vendedor elige una y el precio
// se calcula desde el COSTO del producto en vez de usar el precio de lista.
//
// Feature opt-in vía config_negocio.tarifas_activo ('1'/'0'). Con la clave
// ausente todo esto queda apagado y el sistema se comporta exactamente igual
// que antes: `tarifasActivas()` devuelve false y ningún componente se monta.
//
// Este módulo es PURO (sin React, sin red): toda la aritmética y el parseo
// defensivo de la config viven aquí para poder probarlos aislados.
// ─────────────────────────────────────────────────────────────────────────────

/** Modos de cálculo soportados. */
export const MODO_MARKUP = 'markup'; // precio = costo × (1 + p/100)   ← default
export const MODO_MARGEN = 'margen'; // precio = costo ÷ (1 − p/100)

/** Opciones de redondeo ofrecidas en Ajustes (en pesos). */
export const OPCIONES_REDONDEO = [0, 100, 500, 1000];

/** Tope defensivo: evita que un JSON corrupto o malicioso infle la UI. */
export const MAX_TARIFAS = 20;

/** Origen del precio de un ítem del carrito. */
export const ORIGEN_LISTA  = 'lista';   // precio del producto, sin tocar
export const ORIGEN_TARIFA = 'tarifa';  // calculado desde el costo
export const ORIGEN_MANUAL = 'manual';  // el vendedor lo escribió a mano

// ── Parseo de la config ──────────────────────────────────────────────────────

/**
 * Normaliza una tarifa cruda venida del JSON de config.
 * Devuelve null si no es utilizable — el llamador la descarta.
 */
const _normalizarTarifa = (cruda, indice) => {
  if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) return null;

  const nombre = typeof cruda.nombre === 'string' ? cruda.nombre.trim() : '';
  if (!nombre) return null;

  const porcentaje = Number(cruda.porcentaje);
  if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 1000) return null;

  // El id es un slug estable: renombrar o reordenar una tarifa no debe romper
  // la referencia que guarda el ítem del carrito. Si falta, se deriva del índice.
  const id = typeof cruda.id === 'string' && cruda.id.trim()
    ? cruda.id.trim()
    : `t${indice + 1}`;

  return {
    id,
    nombre: nombre.slice(0, 40),
    porcentaje,
    color: typeof cruda.color === 'string' ? cruda.color : 'blue',
  };
};

/**
 * Lee `tarifas_lista` (string JSON) y devuelve un array limpio.
 * Nunca lanza: un JSON corrupto degrada a [] igual que hace
 * `colores_serial_lista` en ConfigPage.
 */
export const parsearTarifas = (raw) => {
  let lista;
  try {
    lista = JSON.parse(raw || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(lista)) return [];

  const vistos = new Set();
  const limpias = [];
  for (let i = 0; i < lista.length && limpias.length < MAX_TARIFAS; i++) {
    const t = _normalizarTarifa(lista[i], i);
    if (!t || vistos.has(t.id)) continue;   // ids duplicados: gana el primero
    vistos.add(t.id);
    limpias.push(t);
  }
  return limpias;
};

/**
 * Traduce el mapa de config del negocio a la configuración de tarifas.
 * `config` es el objeto plano que devuelve GET /config (puede ser undefined
 * mientras carga la query).
 */
export const leerConfigTarifas = (config) => {
  const cfg = config || {};
  const tarifas = parsearTarifas(cfg.tarifas_lista);

  const redondeoRaw = Number(cfg.tarifas_redondeo);
  const redondeo = OPCIONES_REDONDEO.includes(redondeoRaw) ? redondeoRaw : 100;

  const defaultId = typeof cfg.tarifas_default_id === 'string'
    ? cfg.tarifas_default_id
    : null;

  return {
    // Activa solo si el negocio la encendió Y configuró al menos una tarifa:
    // encenderla sin tarifas dejaría un selector vacío en el carrito.
    activo:         cfg.tarifas_activo === '1' && tarifas.length > 0,
    tarifas,
    modo:           cfg.tarifas_modo === MODO_MARGEN ? MODO_MARGEN : MODO_MARKUP,
    redondeo,
    // Solo vale si la tarifa referida sigue existiendo.
    defaultId:      tarifas.some((t) => t.id === defaultId) ? defaultId : null,
    verPorcentaje:  cfg.tarifas_ver_porcentaje === '1',
    avisarBajoCosto: cfg.tarifas_avisar_bajo_costo !== '0',  // ausente = avisar
  };
};

// ── Cálculo ──────────────────────────────────────────────────────────────────

/** Redondea al múltiplo pedido. `paso` 0 = solo entero. */
export const redondear = (valor, paso = 100) => {
  if (!Number.isFinite(valor)) return null;
  if (!paso || paso <= 0) return Math.round(valor);
  return Math.round(valor / paso) * paso;
};

/**
 * Motivo por el que una tarifa NO se puede aplicar a un ítem, o null si sí se puede.
 * Se expone aparte del cálculo para poder mostrar un tooltip claro en el chip.
 */
export const motivoNoAplicable = (costo, tarifa, { modo = MODO_MARKUP } = {}) => {
  const c = Number(costo);
  if (costo == null || costo === '' || !Number.isFinite(c)) {
    return 'Este producto no tiene costo registrado';
  }
  if (c <= 0) return 'El costo registrado es cero';
  if (!tarifa || !Number.isFinite(Number(tarifa.porcentaje))) {
    return 'Tarifa inválida';
  }
  if (modo === MODO_MARGEN && Number(tarifa.porcentaje) >= 100) {
    return 'Un margen del 100% o más no se puede calcular';
  }
  return null;
};

/**
 * Precio de venta a partir del costo y una tarifa.
 * Devuelve null (nunca 0 ni NaN) cuando no es calculable — la UI lo trata
 * como "no aplicable" y deja el precio como estaba.
 */
export const calcularPrecioTarifa = (costo, tarifa, { modo = MODO_MARKUP, redondeo = 100 } = {}) => {
  if (motivoNoAplicable(costo, tarifa, { modo })) return null;

  const c = Number(costo);
  const p = Number(tarifa.porcentaje);

  const bruto = modo === MODO_MARGEN
    ? c / (1 - p / 100)
    : c * (1 + p / 100);

  if (!Number.isFinite(bruto) || bruto <= 0) return null;
  return redondear(bruto, redondeo);
};

// ── Presentación ─────────────────────────────────────────────────────────────

/**
 * Etiqueta de la tarifa para el vendedor.
 *
 * OJO — decisión de seguridad: mostrar el porcentaje junto al precio permite
 * despejar el costo del producto (precio ÷ 1,05). El sistema ya trata el costo
 * como dato reservado (red_interna_ocultar_costos viene activo por defecto),
 * así que por defecto se muestra SOLO el nombre. `tarifas_ver_porcentaje`
 * lo revela para quien acepte esa consecuencia.
 */
export const etiquetaTarifa = (tarifa, verPorcentaje = false) => {
  if (!tarifa) return 'Manual';
  return verPorcentaje ? `${tarifa.nombre} +${tarifa.porcentaje}%` : tarifa.nombre;
};

/** Busca una tarifa por id dentro de la lista configurada. */
export const buscarTarifa = (tarifas, id) =>
  (tarifas || []).find((t) => t.id === id) || null;
