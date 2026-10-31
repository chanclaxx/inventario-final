// ─────────────────────────────────────────────────────────────────────────────
// TRASLADOS ENTRE SEDES PROPIAS — las reglas de ruta, sin base de datos
//
// Con la red interna encendida hay dos clases de sucursal además de la bodega:
//   · LOCAL      → se le DESPACHA. Cada envío es una cuenta que paga.
//   · SEDE PROPIA → se le TRASLADA. Es del mismo dueño: no debe nada.
//
// La clase la decide `red_interna_sedes_propias` (arreglo de ids, ausente =
// ninguna). La regla que protege la plata es una sola: UN LOCAL CON CUENTA
// NUNCA ENTRA EN UN TRASLADO, ni de origen ni de destino. Si pudiera, la
// mercancía de un local saldría de su cuenta sin devolución, o le llegaría sin
// deuda. Por la misma razón a una sede propia no se le despacha (le crearía
// una deuda consigo misma) ni devuelve por el circuito de la cuenta.
//
// Rutas (`red_interna_traslados_rutas`):
//   'bodega'      → bodega ↔ sede propia (por defecto)
//   'entre_sedes' → además sede propia ↔ sede propia
//
// Funciones puras: las usan el servicio, la validación de Ajustes, el contexto
// que pinta el carrito y la suite. Si la pantalla y el backend decidieran por
// separado qué destinos se ofrecen, acabarían ofreciendo uno que se rechaza.
// ─────────────────────────────────────────────────────────────────────────────

const _ids = (lista) => new Set((lista || []).map(Number));

/** ¿La función está encendida? Hace falta al menos una sede propia. */
const trasladosActivos = (red) => !!red?.activa && !!red?.bodega_id
  && Array.isArray(red?.sedes_propias) && red.sedes_propias.length > 0;

const esSedePropia = (red, sucursalId) =>
  trasladosActivos(red) && _ids(red.sedes_propias).has(Number(sucursalId));

/** Sucursales que pueden estar en un traslado: la bodega y las propias. */
const _participan = (red) => new Set([Number(red.bodega_id), ..._ids(red.sedes_propias)]);

/**
 * ¿Se puede trasladar de `origenId` a `destinoId`? Devuelve null si sí, o el
 * motivo (texto para el usuario) si no.
 */
const motivoRutaInvalida = (red, origenId, destinoId) => {
  const o = Number(origenId), d = Number(destinoId);
  if (!trasladosActivos(red)) return 'Los traslados entre sedes propias no están activos en este negocio';
  if (!o || !d) return 'Falta la sucursal de origen o de destino';
  if (o === d) return 'El origen y el destino no pueden ser la misma sucursal';
  const participan = _participan(red);
  if (!participan.has(o)) return 'Esta sucursal es un local con cuenta: su mercancía vuelve a la bodega con «Devolver»';
  if (!participan.has(d)) return 'Esa sucursal es un local con cuenta: a un local se le despacha, no se le traslada';
  const bodega = Number(red.bodega_id);
  if (red.traslados_rutas !== 'entre_sedes' && o !== bodega && d !== bodega) {
    return 'Los traslados solo van entre la bodega y sus sedes. Para mover entre dos sedes, actívalo en Ajustes → Bodega';
  }
  return null;
};

/** Los destinos que la sucursal `origenId` puede elegir, en el orden de `sucursales`. */
const destinosTraslado = (red, origenId, sucursales = []) =>
  sucursales.filter((s) => motivoRutaInvalida(red, origenId, s.id) === null);

/** A una sede propia no se le despacha: se le traslada. */
const motivoDespachoInvalido = (red, destinoId) => (esSedePropia(red, destinoId)
  ? 'Esa sucursal es una sede propia: a ella se le traslada (sin cuenta), no se le despacha'
  : null);

/** Una sede propia no devuelve por el circuito de la cuenta: traslada. */
const motivoDevolucionInvalida = (red, origenId) => (esSedePropia(red, origenId)
  ? 'Esta sucursal es una sede propia: lo que vuelve a la bodega va por «Trasladar», sin tocar ninguna cuenta'
  : null);

module.exports = {
  trasladosActivos, esSedePropia, motivoRutaInvalida, destinosTraslado,
  motivoDespachoInvalido, motivoDevolucionInvalida,
};
