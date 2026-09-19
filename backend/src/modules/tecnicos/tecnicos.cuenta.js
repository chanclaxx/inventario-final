// ─────────────────────────────────────────────────────────────────────────────
// LA CUENTA DE UN TÉCNICO — funciones puras, sin base de datos.
//
// Lo que se le debe NO se guarda: sale de los equipos que ya volvieron. Lo que
// se le paga sí (anticipos, pagos, devoluciones). Todo lo demás se DERIVA aquí,
// y lo usan el service (para validar) y la pantalla (para pintar), así que no
// puede haber dos versiones del saldo.
//
//   saldo = Σ cargos − Σ (anticipos + pagos) + Σ devoluciones
//   saldo > 0  → le debemos
//   saldo < 0  → nos debe (saldo a favor): el siguiente trabajo lo consume solo
//
// El saldo a favor no se "aplica" con un movimiento: es el mismo saldo corrido,
// así que el siguiente cargo lo absorbe por construcción. Es la forma de que
// no haya un saldo a favor guardado que se quede desincronizado.
// ─────────────────────────────────────────────────────────────────────────────

const _n = (v) => Number(v || 0);
const _r = (v) => Math.round(v * 100) / 100;

const SALE_PLATA   = new Set(['Anticipo', 'Pago']);
const ENTRA_PLATA  = new Set(['Devolucion']);

/** Cargos = equipos que volvieron con costo > 0 (reparados o con diagnóstico). */
const cargosDe = (equipos) => equipos
  .filter((e) => (e.estado === 'Reparado' || e.estado === 'Sin_reparar') && _n(e.costo) > 0)
  .map((e) => ({
    id:        e.id,
    salida_id: e.salida_id,
    fecha:     e.fecha_regreso,
    valor:     _n(e.costo),
    equipo:    e,
  }));

const vigentes = (pagos) => pagos.filter((p) => !p.anulado);

/** El saldo de la cuenta. Positivo = le debemos; negativo = a favor nuestro. */
const saldoDe = (equipos, pagos) => {
  const cargos = cargosDe(equipos).reduce((s, c) => s + c.valor, 0);
  let pagado = 0;
  for (const p of vigentes(pagos)) {
    if (SALE_PLATA.has(p.tipo))  pagado += _n(p.valor);
    if (ENTRA_PLATA.has(p.tipo)) pagado -= _n(p.valor);
  }
  return _r(cargos - pagado);
};

const resumen = (equipos, pagos) => {
  const saldo = saldoDe(equipos, pagos);
  const vig   = vigentes(pagos);
  const suma  = (tipo) => _r(vig.filter((p) => p.tipo === tipo).reduce((s, p) => s + _n(p.valor), 0));
  return {
    total_cargos:       _r(cargosDe(equipos).reduce((s, c) => s + c.valor, 0)),
    total_anticipos:    suma('Anticipo'),
    total_pagos:        suma('Pago'),
    total_devoluciones: suma('Devolucion'),
    saldo,
    deuda:              saldo > 0 ? saldo : 0,
    saldo_a_favor:      saldo < 0 ? -saldo : 0,
    equipos_en_tecnico: equipos.filter((e) => e.estado === 'En_tecnico').length,
  };
};

/**
 * ¿Cuánto de cada cargo está pagado? Solo para MOSTRAR (la deuda total no
 * depende de esto). Dos pasadas:
 *   1. lo dirigido: un anticipo o pago con `salida_id` va primero a los
 *      cargos de ESA salida — así el anticipo de la salida #12 se ve en la #12;
 *   2. lo que sobra de lo dirigido, más lo no dirigido, menos lo devuelto, se
 *      reparte del cargo más viejo al más nuevo (FIFO).
 * Devuelve un Map id_equipo → { valor, pagado, pendiente }.
 */
const imputar = (equipos, pagos) => {
  const cargos = cargosDe(equipos)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || a.id - b.id);
  const estado = new Map(cargos.map((c) => [c.id, { valor: c.valor, pagado: 0 }]));
  const pendiente = (c) => estado.get(c.id).valor - estado.get(c.id).pagado;

  let bolsa = 0;
  const vig = vigentes(pagos);
  for (const p of vig) {
    if (ENTRA_PLATA.has(p.tipo)) { bolsa -= _n(p.valor); continue; }
    if (!SALE_PLATA.has(p.tipo)) continue;
    let resto = _n(p.valor);
    if (p.salida_id != null) {
      for (const c of cargos) {
        if (resto <= 0) break;
        if (Number(c.salida_id) !== Number(p.salida_id)) continue;
        const aplica = Math.min(resto, pendiente(c));
        estado.get(c.id).pagado += aplica;
        resto -= aplica;
      }
    }
    bolsa += resto;
  }
  for (const c of cargos) {
    if (bolsa <= 0) break;
    const aplica = Math.min(bolsa, pendiente(c));
    estado.get(c.id).pagado += aplica;
    bolsa -= aplica;
  }

  const out = new Map();
  for (const [id, e] of estado) {
    out.set(id, { valor: _r(e.valor), pagado: _r(e.pagado), pendiente: _r(e.valor - e.pagado) });
  }
  return out;
};

/**
 * El estado de cuenta: cargos y pagos en orden, con el saldo corrido. Los
 * pagos anulados SE MUESTRAN (tachados en pantalla) pero no mueven el saldo:
 * esconderlos sería perder el rastro de por qué alguien vio otra cifra ayer.
 */
const extracto = (equipos, pagos) => {
  const movs = [
    ...cargosDe(equipos).map((c) => ({
      clave:  `c${c.id}`,
      fecha:  c.fecha,
      tipo:   c.equipo.estado === 'Sin_reparar' ? 'Diagnostico' : 'Cargo',
      valor:  c.valor,
      signo:  1,
      detalle: c.equipo,
    })),
    ...pagos.map((p) => ({
      clave:  `p${p.id}`,
      fecha:  p.fecha,
      tipo:   p.tipo,
      valor:  _n(p.valor),
      signo:  p.anulado ? 0 : (ENTRA_PLATA.has(p.tipo) ? 1 : -1),
      anulado: !!p.anulado,
      detalle: p,
    })),
  ].sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || a.clave.localeCompare(b.clave));

  let saldo = 0;
  for (const m of movs) {
    saldo = _r(saldo + m.signo * m.valor);
    m.saldo = saldo;
  }
  return movs;
};

// ── Una cuenta POR SUCURSAL ──────────────────────────────────────────────────
//
// El técnico es del negocio, pero cada sede tiene su propia cuenta con él
// (decisión del negocio, 18-sep-2026): un arreglo es de la sede del EQUIPO y un
// pago es de la sede cuya CAJA lo pagó. Si la cuenta fuera una sola, la caja de
// la sede B pagaría arreglos de la A, el anticipo que dio A se gastaría en un
// trabajo de B, y ninguna de las dos cajas contaría la verdad. Todo lo de arriba
// sigue igual: estas funciones solo parten las listas antes de llamarlo.
const _suc = (x) => Number(x.sucursal_id);

const sucursalesDe = (equipos, pagos) =>
  [...new Set([...equipos.map(_suc), ...pagos.map(_suc)])].filter(Number.isFinite).sort((a, b) => a - b);

const deSucursal = (equipos, pagos, sucursalId) => ({
  equipos: equipos.filter((e) => _suc(e) === Number(sucursalId)),
  pagos:   pagos.filter((p) => _suc(p) === Number(sucursalId)),
});

/**
 * Las cuentas de un técnico, una por sede, más el TOTAL (la suma de cada campo).
 * Ojo: el total NO es el saldo de una cuenta única: una sede con deuda y otra
 * con saldo a favor no se compensan entre sí, así que `deuda` y
 * `saldo_a_favor` del total se suman por separado y los dos pueden ser > 0.
 */
const cuentasPorSucursal = (equipos, pagos) => {
  const cuentas = sucursalesDe(equipos, pagos).map((sucursalId) => {
    const m = deSucursal(equipos, pagos, sucursalId);
    return { sucursal_id: sucursalId, resumen: resumen(m.equipos, m.pagos) };
  });
  const campos = ['total_cargos', 'total_anticipos', 'total_pagos', 'total_devoluciones',
    'deuda', 'saldo_a_favor', 'equipos_en_tecnico'];
  const total = Object.fromEntries(campos.map((c) => [c, _r(cuentas.reduce((s, x) => s + x.resumen[c], 0))]));
  total.saldo = _r(total.deuda - total.saldo_a_favor);
  return { cuentas, total };
};

/** `imputar` por sede, unido en un solo Map (los ids de equipo no se repiten). */
const imputarPorSucursal = (equipos, pagos) => {
  const out = new Map();
  for (const sucursalId of sucursalesDe(equipos, pagos)) {
    const m = deSucursal(equipos, pagos, sucursalId);
    for (const [k, v] of imputar(m.equipos, m.pagos)) out.set(k, v);
  }
  return out;
};

// El vencimiento de la garantía NO se calcula aquí: node-postgres devuelve un
// TIMESTAMP como Date en la zona del servidor (UTC en Railway) y sumar días en
// JavaScript corre la fecha. Lo resuelve el SQL (`garantia_hasta`).

module.exports = {
  cargosDe, saldoDe, resumen, imputar, extracto,
  sucursalesDe, deSucursal, cuentasPorSucursal, imputarPorSucursal,
};
