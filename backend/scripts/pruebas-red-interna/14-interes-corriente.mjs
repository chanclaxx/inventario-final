// ─────────────────────────────────────────────────────────────────────────────
// INTERÉS CORRIENTE — el cálculo, contra cifras calculadas a mano.
//
// Cubre las formas de cobrar que pidió el negocio, que son las que tiene que
// soportar la configuración:
//
//   · "2% mensual sobre el saldo desde que entrego"        → proporcional al día
//   · "pasa un mes y sube un 2% sobre el crédito total,
//      no sube diario sino que de una sola vez"            → ESCALÓN + valor original
//   · "puede ser cada 7 días"                              → periodicidad libre
//   · "30 días sin interés y después corre"                → inicia_tras_dias
//   · un valor fijo en pesos por período
//
// Y las dos reglas que no son negociables:
//   · el interés NO corre antes de su fecha de arranque (nada retroactivo);
//   · con 'sustituye', el interés SE DETIENE en la fecha límite y de ahí en
//     adelante solo corre la mora.
//
// Funciones puras: no necesita base de datos.
//   node scripts/pruebas-red-interna/14-interes-corriente.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const {
  calcularInteresCausado, resolverEstadoInteres,
  normalizarPlanInteres, parsearPlanes, leerConfigInteres, describirPlanInteres,
} = require(path.join(RAIZ, 'src/utils/interes.util.js'));
const { repartirAbono } = require(path.join(RAIZ, 'src/utils/mora.util.js'));

const ENTREGA = '2026-01-01';
const dia = (n) => {
  const d = new Date(Date.UTC(2026, 0, 1 + n));
  return d.toISOString().slice(0, 10);
};

let ok = 0, mal = 0;
const fallos = [];

const check = (titulo, obtenido, esperado) => {
  if (obtenido === esperado) { ok++; return; }
  mal++;
  fallos.push({ titulo, esperado, obtenido });
};

const seccion = (t) => console.log(`\n─── ${t} ───`);
const linea = (t, obtenido, esperado) => {
  check(t, obtenido, esperado);
  const marca = obtenido === esperado ? '✔' : '✘';
  const txt = `$${Number(obtenido).toLocaleString('es-CO')}`;
  const esp = obtenido === esperado ? '' : `   (esperaba $${Number(esperado).toLocaleString('es-CO')})`;
  console.log(`  ${marca} ${t.padEnd(58)} ${txt.padStart(14)}${esp}`);
};

const M = 1_000_000;

// ═══ 1. Porcentaje mensual sobre el saldo, proporcional al día ═══════════════
seccion('1. "2% mensual sobre el saldo, desde que entrego"');

const plan2Mensual = {
  id: 'p1', nombre: 'Financiación 2%', tipo: 'porcentaje', valor: 2,
  periodicidad: 'mensual', devengo: 'diario', base: 'saldo', inicia_tras_dias: 0,
};
const i1 = (d, extra = {}) => calcularInteresCausado({
  saldo: M, valor_original: M, fecha_inicio: ENTREGA,
  condicion: plan2Mensual, hoy: dia(d), ...extra,
});

linea('a los 30 días  (1 mes × 2% de $1.000.000)', i1(30), 20_000);
linea('a los 60 días  (2 meses)',                  i1(60), 40_000);
linea('a los 15 días  (medio mes, proporcional)',  i1(15), 10_000);
linea('a los 45 días  (mes y medio)',              i1(45), 30_000);
linea('el mismo día de la entrega',                i1(0),       0);

// ═══ 2. ESCALÓN sobre el valor total — el caso que pidió el negocio ═════════
seccion('2. "Pasa un mes y sube 2% del total, de una sola vez"');

const planEscalon = {
  id: 'p2', nombre: 'Escalón mensual', tipo: 'porcentaje', valor: 2,
  periodicidad: 'mensual', devengo: 'periodo_cumplido',
  base: 'valor_original', inicia_tras_dias: 0,
};
const i2 = (d, saldo = M) => calcularInteresCausado({
  saldo, valor_original: M, fecha_inicio: ENTREGA,
  condicion: planEscalon, hoy: dia(d),
});

linea('día 29  — todavía no cumple el mes: NO cobra', i2(29),      0);
linea('día 30  — cumple el mes: sube de una vez',     i2(30), 20_000);
linea('día 45  — sigue igual hasta el próximo mes',   i2(45), 20_000);
linea('día 59  — sigue igual',                        i2(59), 20_000);
linea('día 60  — segundo escalón',                    i2(60), 40_000);
linea('día 90  — tercer escalón',                     i2(90), 60_000);

// El valor original NO se mueve aunque el cliente abone: es "sobre el total".
linea('día 60 habiendo abonado la mitad (sigue sobre el total)', i2(60, M / 2), 40_000);

// ═══ 3. Periodicidad libre ══════════════════════════════════════════════════
seccion('3. "Puede ser cada 7 días, quincenal, cada N días..."');

const planCada = (periodicidad, valor, cada_dias = null) => ({
  id: 'p3', nombre: 'X', tipo: 'porcentaje', valor, periodicidad, cada_dias,
  devengo: 'periodo_cumplido', base: 'saldo', inicia_tras_dias: 0,
});
const i3 = (plan, d) => calcularInteresCausado({
  saldo: M, valor_original: M, fecha_inicio: ENTREGA, condicion: plan, hoy: dia(d),
});

linea('semanal 1%, a los 20 días  (2 semanas cumplidas)', i3(planCada('semanal', 1), 20),   20_000);
linea('semanal 1%, a los 21 días  (3 semanas)',           i3(planCada('semanal', 1), 21),   30_000);
linea('quincenal 1,5%, a los 35 días (2 quincenas)',      i3(planCada('quincenal', 1.5), 35), 30_000);
linea('cada 10 días 1%, a los 45 días (4 períodos)',      i3(planCada('cada_n_dias', 1, 10), 45), 40_000);
linea('diaria 0,1%, a los 12 días',                       i3(planCada('diaria', 0.1), 12),  12_000);

// ═══ 4. Arranque diferido ═══════════════════════════════════════════════════
seccion('4. "Primer mes sin interés, después corre"');

const planDiferido = {
  id: 'p4', nombre: 'Primer mes gratis', tipo: 'porcentaje', valor: 3,
  periodicidad: 'mensual', devengo: 'diario', base: 'saldo', inicia_tras_dias: 30,
};
const i4 = (d, saldo = M) => calcularInteresCausado({
  saldo, valor_original: saldo, fecha_inicio: ENTREGA, condicion: planDiferido, hoy: dia(d),
});

linea('día 25 — dentro del plazo sin interés',   i4(25),      0);
linea('día 30 — justo al vencer el plazo',       i4(30),      0);
linea('día 45 — 15 días causando (3% × 0,5)',    i4(45), 15_000);
linea('día 60 — 30 días causando',               i4(60), 30_000);
linea('día 45 sobre $500.000',                   i4(45, 500_000), 7_500);

// ═══ 5. Valor fijo en pesos ═════════════════════════════════════════════════
seccion('5. "$50.000 al mes", pactado en pesos y no en porcentaje');

const planFijo = {
  id: 'p5', nombre: 'Cuota fija', tipo: 'fijo', valor: 50_000,
  periodicidad: 'mensual', devengo: 'periodo_cumplido', base: 'saldo', inicia_tras_dias: 0,
};
const i5 = (d) => calcularInteresCausado({
  saldo: M, valor_original: M, fecha_inicio: ENTREGA, condicion: planFijo, hoy: dia(d),
});

linea('día 20 — sin mes cumplido',  i5(20),       0);
linea('día 30 — un mes',            i5(30),  50_000);
linea('día 70 — dos meses',         i5(70), 100_000);

// ═══ 6. Los abonos bajan la base cuando base = saldo ════════════════════════
seccion('6. Abonos parciales sobre base = saldo');

const i6 = (saldoHoy, abonos, d) => calcularInteresCausado({
  saldo: saldoHoy, valor_original: M, fecha_inicio: ENTREGA,
  condicion: plan2Mensual, hoy: dia(d), abonos,
});

// Abona 500.000 el día 30. Tramo 0-30 sobre 1.000.000, tramo 30-60 sobre 500.000.
linea('abona $500.000 el día 30, corte al día 60',
  i6(500_000, [{ fecha: `${dia(30)}T10:00:00Z`, valor: 500_000 }], 60), 30_000);

// Salda todo el día 40: el interés ya causado NO desaparece (0-40 sobre 1.000.000).
linea('salda todo el día 40 — el interés causado se conserva',
  i6(0, [{ fecha: `${dia(40)}T10:00:00Z`, valor: M }], 60),
  Math.round(M * 0.02 * (40 / 30)));

// ═══ 7. Convivencia con la mora ════════════════════════════════════════════
seccion('7. Qué pasa al vencerse (préstamo a 60 días, corte al día 90)');

const conAlVencer = (al_vencer) => ({ ...plan2Mensual, al_vencer });
const i7 = (al_vencer) => calcularInteresCausado({
  saldo: M, valor_original: M, fecha_inicio: ENTREGA,
  fecha_limite: dia(60), condicion: conAlVencer(al_vencer), hoy: dia(90),
});

linea("'sustituye' — el interés se detiene el día 60", i7('sustituye'), 40_000);
linea("'continua'  — sigue corriendo hasta hoy",       i7('continua'),  60_000);
linea('por defecto (sin declararlo) es sustituye',
  calcularInteresCausado({
    saldo: M, valor_original: M, fecha_inicio: ENTREGA,
    fecha_limite: dia(60), condicion: plan2Mensual, hoy: dia(90),
  }), 40_000);

// ═══ 8. Topes ══════════════════════════════════════════════════════════════
seccion('8. Límites: máximo de períodos y tope porcentual');

linea('máx. 3 meses, consultado al día 180',
  calcularInteresCausado({
    saldo: M, valor_original: M, fecha_inicio: ENTREGA, hoy: dia(180),
    condicion: { ...plan2Mensual, max_periodos: 3 },
  }), 60_000);

linea('5% mensual con tope del 20%, al año',
  calcularInteresCausado({
    saldo: M, valor_original: M, fecha_inicio: ENTREGA, hoy: dia(365),
    condicion: { ...plan2Mensual, valor: 5, tope_pct: 20 },
  }), 200_000);

// ═══ 9. Estado completo y derivación de lo pendiente ═══════════════════════
seccion('9. Estado: causado − cobrado − condonado');

const movs = [
  { tipo: 'Cobro',       valor: 5_000,  concepto: 'interes', anulado: false },
  { tipo: 'Condonacion', valor: 3_000,  concepto: 'interes', anulado: false },
  { tipo: 'Cobro',       valor: 99_000, concepto: 'interes', anulado: true  },  // anulado
  { tipo: 'Cobro',       valor: 77_000, concepto: 'mora',    anulado: false },  // es de mora
  { tipo: 'Cobro',       valor: 55_000,                      anulado: false },  // fila vieja, sin concepto
];
const est = resolverEstadoInteres({
  saldo: M, valor_original: M, fecha_inicio: ENTREGA,
  condicion: plan2Mensual, hoy: dia(60), movimientos: movs,
});

linea('causado al día 60',           est.causado,   40_000);
linea('cobrado (ignora anulados)',   est.cobrado,    5_000);
linea('condonado',                   est.condonado,  3_000);
linea('pendiente = 40.000−5.000−3.000', est.pendiente, 32_000);
check('no cuenta los movimientos de mora', est.cobrado, 5_000);

const sinPlan = resolverEstadoInteres({ saldo: M, fecha_inicio: ENTREGA, condicion: null });
check('sin plan pactado → aplica:false', sinPlan.aplica, false);
check('sin plan pactado → causado 0',    sinPlan.causado, 0);
console.log(`  ${sinPlan.aplica === false ? '✔' : '✘'} sin plan pactado no causa nada (aditividad)`);

const detenido = resolverEstadoInteres({
  saldo: M, valor_original: M, fecha_inicio: ENTREGA, fecha_limite: dia(60),
  condicion: plan2Mensual, hoy: dia(90),
});
check('marca detenido_por_mora', detenido.detenido_por_mora, true);
console.log(`  ${detenido.detenido_por_mora ? '✔' : '✘'} avisa que el interés se detuvo por el vencimiento`);

// ═══ 10. Reparto del abono en tres cubetas ═════════════════════════════════
seccion('10. Imputación: mora → interés → capital');

const r1 = repartirAbono({ valor: 100_000, mora_pendiente: 20_000, interes_pendiente: 30_000, saldo_capital: 500_000 });
check('cascada: a mora',    r1.a_mora,    20_000);
check('cascada: a interés', r1.a_interes, 30_000);
check('cascada: a capital', r1.a_capital, 50_000);
console.log(`  ✔ $100.000 con mora $20.000 e interés $30.000 → mora 20.000 · interés 30.000 · capital 50.000`);

const r2 = repartirAbono({ valor: 100_000, mora_pendiente: 20_000, interes_pendiente: 30_000, saldo_capital: 500_000, modo: 'solo_capital' });
check('solo_capital: nada a mora',    r2.a_mora,    0);
check('solo_capital: nada a interés', r2.a_interes, 0);
check('solo_capital: todo a capital', r2.a_capital, 100_000);
console.log(`  ✔ modo solo_capital deja los dos cargos pendientes (no los condona)`);

const r3 = repartirAbono({ valor: 25_000, mora_pendiente: 20_000, interes_pendiente: 30_000, saldo_capital: 500_000 });
check('alcanza para mora y parte del interés: mora',    r3.a_mora,    20_000);
check('alcanza para mora y parte del interés: interés', r3.a_interes,  5_000);
check('no llega a capital',                             r3.a_capital,      0);
console.log(`  ✔ un abono corto se consume en orden y no toca capital`);

const r4 = repartirAbono({ valor: 60_000, mora_pendiente: 10_000, interes_pendiente: 10_000, saldo_capital: 20_000 });
check('excedente cuando cubre todo', r4.excedente, 20_000);
console.log(`  ✔ lo que sobra después de cubrir todo queda como excedente (saldo a favor)`);

// ═══ 11. Normalización y configuración ═════════════════════════════════════
seccion('11. Configuración: normalización y degradación');

check('rechaza plan sin nombre',      normalizarPlanInteres({ valor: 2 }), null);
check('rechaza valor 0',              normalizarPlanInteres({ nombre: 'X', valor: 0 }), null);
check('rechaza % de tres cifras',     normalizarPlanInteres({ nombre: 'X', valor: 150 }), null);
check('rechaza cada_n_dias sin días', normalizarPlanInteres({ nombre: 'X', valor: 2, periodicidad: 'cada_n_dias' }), null);
check('JSON corrupto → []',           parsearPlanes('{roto').length, 0);
check('no es arreglo → []',           parsearPlanes('{"a":1}').length, 0);
check('descarta ids repetidos',
  parsearPlanes(JSON.stringify([
    { id: 'x', nombre: 'A', valor: 2 }, { id: 'x', nombre: 'B', valor: 3 },
  ])).length, 1);
check('nunca capitaliza (anatocismo)',
  normalizarPlanInteres({ nombre: 'X', valor: 2, capitaliza: true }).capitaliza, false);
check('apagada sin planes',  leerConfigInteres({ interes_activa: '1' }).activa, false);
check('apagada por defecto', leerConfigInteres({}).activa, false);
check('encendida con plan',
  leerConfigInteres({
    interes_activa: '1',
    interes_lista: JSON.stringify([{ id: 'a', nombre: 'A', valor: 2 }]),
  }).activa, true);
console.log('  ✔ 11 validaciones de configuración');

console.log('');
console.log(`  Descripción legible: "${describirPlanInteres(normalizarPlanInteres(planEscalon))}"`);
console.log(`  Descripción legible: "${describirPlanInteres(normalizarPlanInteres(planDiferido))}"`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
if (mal === 0) {
  console.log(`  ✅ ${ok} comprobaciones, todas correctas.`);
  console.log('');
  process.exit(0);
} else {
  console.log(`  ❌ ${mal} de ${ok + mal} fallaron:`);
  for (const f of fallos) console.log('   ', JSON.stringify(f));
  console.log('');
  process.exit(1);
}
