// ─────────────────────────────────────────────────────────────────────────────
// PRUEBA DORADA — el motor de devengo da EXACTAMENTE lo mismo que la fórmula
// de mora que había antes de extraerlo.
//
// Por qué existe: `calcularMoraCausada` se reescribió para delegar en
// `devengo.util.js`, que ahora comparten la mora y el interés corriente. Ese
// refactor toca el cálculo de la cartera de 1.793 préstamos activos. La única
// forma de moverlo con tranquilidad es demostrar que no cambió ni un peso.
//
// Aquí abajo está copiada, LITERAL, la implementación anterior (tomada del
// archivo antes del cambio). Se corren las dos sobre una matriz grande de casos
// y se exige igualdad exacta — no "parecido", igual al peso.
//
// No necesita base de datos: las dos funciones son puras. Corre en un segundo:
//   node scripts/pruebas-red-interna/13-devengo-identidad.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const { calcularMoraCausada, repartirAbono } = require(path.join(RAIZ, 'src/utils/mora.util.js'));

// ═══════════════════════════════════════════════════════════════════════════
// LA IMPLEMENTACIÓN VIEJA, copiada tal cual. No tocar: es el patrón de oro.
// ═══════════════════════════════════════════════════════════════════════════

const ZONA = 'America/Bogota';
const TIPO_MENSUAL     = 'mensual';
const TIPO_DIARIA_FIJA = 'diaria_fija';

const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: ZONA });

const _aFecha = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const _aFechaInstante = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toLocaleDateString('en-CA', { timeZone: ZONA });
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const _sumarDias = (iso, dias) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + Number(dias || 0))).toISOString().slice(0, 10);
};

const _diasEntre = (a, b) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

const normalizarCondicionVieja = (cruda, indice = 0) => {
  if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) return null;
  const nombre = typeof cruda.nombre === 'string' ? cruda.nombre.trim() : '';
  if (!nombre) return null;
  const tipo = cruda.tipo === TIPO_DIARIA_FIJA ? TIPO_DIARIA_FIJA : TIPO_MENSUAL;
  const valor = Number(cruda.valor);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  if (tipo === TIPO_MENSUAL && valor > 100) return null;
  if (tipo === TIPO_DIARIA_FIJA && valor > 10_000_000) return null;
  const gracia = Number(cruda.dias_gracia);
  const tope   = Number(cruda.tope_pct);
  return {
    id: typeof cruda.id === 'string' && cruda.id.trim() ? cruda.id.trim() : `m${indice + 1}`,
    nombre: nombre.slice(0, 40), tipo, valor,
    dias_gracia: Number.isFinite(gracia) && gracia >= 0 ? Math.floor(gracia) : 0,
    tope_pct: Number.isFinite(tope) && tope > 0 ? tope : null,
    color: typeof cruda.color === 'string' ? cruda.color : 'amber',
  };
};

const calcularMoraCausadaVIEJA = ({ saldo, fecha_limite, condicion, hoy, abonos = [] } = {}) => {
  const cond = normalizarCondicionVieja(condicion);
  if (!cond) return 0;
  const saldoHoy = Number(saldo);
  if (!Number.isFinite(saldoHoy) || saldoHoy < 0) return 0;
  const limite = _aFecha(fecha_limite);
  if (!limite) return 0;
  const hoyF   = _aFecha(hoy) || hoyBogota();
  const inicio = _sumarDias(limite, cond.dias_gracia || 0);
  if (_diasEntre(inicio, hoyF) <= 0) return 0;

  const posteriores = (abonos || [])
    .map((a) => ({ fecha: _aFechaInstante(a.fecha), valor: Number(a.valor) || 0 }))
    .filter((a) => a.fecha && a.valor > 0 && _diasEntre(inicio, a.fecha) > 0
                   && _diasEntre(a.fecha, hoyF) >= 0)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  const saldoInicial = saldoHoy + posteriores.reduce((s, a) => s + a.valor, 0);
  if (saldoInicial <= 0) return 0;

  const tramos = [];
  let cursor = inicio;
  let saldoTramo = saldoInicial;
  for (const ab of posteriores) {
    const dias = _diasEntre(cursor, ab.fecha);
    if (dias > 0) tramos.push({ dias, saldo: saldoTramo });
    saldoTramo = Math.max(0, saldoTramo - ab.valor);
    cursor = ab.fecha;
  }
  const diasFinal = _diasEntre(cursor, hoyF);
  if (diasFinal > 0) tramos.push({ dias: diasFinal, saldo: saldoTramo });

  let bruto = 0;
  for (const t of tramos) {
    if (t.saldo <= 0) continue;
    bruto += cond.tipo === TIPO_DIARIA_FIJA
      ? cond.valor * t.dias
      : t.saldo * (cond.valor / 100) * (t.dias / 30);
  }
  if (!Number.isFinite(bruto) || bruto <= 0) return 0;
  const conTope = cond.tope_pct != null
    ? Math.min(bruto, saldoInicial * (cond.tope_pct / 100))
    : bruto;
  return Math.round(conTope);
};

// ═══════════════════════════════════════════════════════════════════════════
// LA MATRIZ
// ═══════════════════════════════════════════════════════════════════════════

const LIMITE = '2026-03-15';   // fecha límite fija; se varía el "hoy"

const CONDICIONES = [
  { id: 'a', nombre: 'Suave',        tipo: 'mensual',     valor: 1                                    },
  { id: 'b', nombre: 'Normal',       tipo: 'mensual',     valor: 2.5                                  },
  { id: 'c', nombre: 'Estricta',     tipo: 'mensual',     valor: 3,   dias_gracia: 5                  },
  { id: 'd', nombre: 'Con tope',     tipo: 'mensual',     valor: 5,   tope_pct: 20                    },
  { id: 'e', nombre: 'Gracia+tope',  tipo: 'mensual',     valor: 4,   dias_gracia: 10, tope_pct: 15   },
  { id: 'f', nombre: 'Diaria',       tipo: 'diaria_fija', valor: 2000                                 },
  { id: 'g', nombre: 'Diaria gracia',tipo: 'diaria_fija', valor: 5000, dias_gracia: 3                 },
  { id: 'h', nombre: 'Diaria tope',  tipo: 'diaria_fija', valor: 10000, tope_pct: 30                  },
  { id: 'i', nombre: 'Decimal',      tipo: 'mensual',     valor: 1.75, dias_gracia: 1, tope_pct: 12.5 },
];

const SALDOS = [0, 1, 15000, 250000, 700000, 1_000_000, 3_500_000, 12_345_678];

// Días transcurridos desde la fecha límite hasta "hoy".
const DIAS = [-10, 0, 1, 2, 3, 5, 6, 10, 11, 29, 30, 31, 45, 60, 90, 180, 365, 800];

// Patrones de abono, como desplazamientos en días desde la fecha límite.
const PATRONES_ABONO = [
  [],
  [{ d: 5,  v: 100000 }],
  [{ d: 1,  v: 50000  }],
  [{ d: 10, v: 300000 }, { d: 20, v: 200000 }],
  [{ d: 3,  v: 100000 }, { d: 3,  v: 100000 }],           // dos el mismo día
  [{ d: -5, v: 400000 }],                                  // antes del vencimiento
  [{ d: 40, v: 700000 }, { d: 41, v: 300000 }],            // salda todo
  [{ d: 15, v: 250000 }, { d: 30, v: 250000 }, { d: 60, v: 500000 }],
  [{ d: 1000, v: 100000 }],                                // en el futuro
];

let corridas = 0;
let fallos   = 0;
const ejemplosFallidos = [];

for (const cond of CONDICIONES) {
  for (const saldo of SALDOS) {
    for (const dias of DIAS) {
      for (const patron of PATRONES_ABONO) {
        const hoy    = _sumarDias(LIMITE, dias);
        const abonos = patron.map((a) => ({
          // Se manda como TIMESTAMP con hora, que es lo que entrega Postgres.
          fecha: `${_sumarDias(LIMITE, a.d)}T14:30:00.000Z`,
          valor: a.v,
        }));

        const args = { saldo, fecha_limite: LIMITE, condicion: cond, hoy, abonos };
        const vieja = calcularMoraCausadaVIEJA(args);
        const nueva = calcularMoraCausada(args);

        corridas++;
        if (vieja !== nueva) {
          fallos++;
          if (ejemplosFallidos.length < 8) {
            ejemplosFallidos.push({
              cond: cond.nombre, saldo, dias, abonos: patron.length, vieja, nueva,
            });
          }
        }
      }
    }
  }
}

// ── Fechas como objeto Date (lo que entrega el driver de pg) ────────────────
let corridasDate = 0;
for (const cond of CONDICIONES.slice(0, 4)) {
  for (const saldo of [500000, 2_000_000]) {
    for (const dias of [10, 45, 120]) {
      const limiteDate = new Date(Date.UTC(2026, 2, 15));   // 2026-03-15 a medianoche UTC
      const hoy = _sumarDias(LIMITE, dias);
      const args = { saldo, fecha_limite: limiteDate, condicion: cond, hoy, abonos: [] };
      const vieja = calcularMoraCausadaVIEJA(args);
      const nueva = calcularMoraCausada(args);
      corridas++; corridasDate++;
      if (vieja !== nueva) {
        fallos++;
        if (ejemplosFallidos.length < 8) {
          ejemplosFallidos.push({ cond: cond.nombre, saldo, dias, tipoFecha: 'Date', vieja, nueva });
        }
      }
    }
  }
}

// ── Entradas basura: las dos deben degradar igual, sin lanzar ───────────────
const BASURA = [
  {},
  { saldo: 100000 },
  { saldo: 100000, fecha_limite: LIMITE },
  { saldo: 100000, fecha_limite: LIMITE, condicion: null },
  { saldo: 100000, fecha_limite: LIMITE, condicion: { nombre: 'X' } },
  { saldo: 100000, fecha_limite: LIMITE, condicion: { nombre: 'X', tipo: 'mensual', valor: 0 } },
  { saldo: 100000, fecha_limite: LIMITE, condicion: { nombre: 'X', tipo: 'mensual', valor: 200 } },
  { saldo: 100000, fecha_limite: 'no-es-fecha', condicion: CONDICIONES[0] },
  { saldo: -5000,  fecha_limite: LIMITE, condicion: CONDICIONES[0], hoy: '2026-06-01' },
  { saldo: NaN,    fecha_limite: LIMITE, condicion: CONDICIONES[0], hoy: '2026-06-01' },
  { saldo: 100000, fecha_limite: LIMITE, condicion: 'texto suelto' },
  { saldo: 100000, fecha_limite: LIMITE, condicion: [1, 2, 3] },
  { saldo: 100000, fecha_limite: LIMITE, condicion: CONDICIONES[0], abonos: null },
  { saldo: 100000, fecha_limite: LIMITE, condicion: CONDICIONES[0], hoy: '2026-06-01',
    abonos: [{ fecha: null, valor: 100 }, { fecha: '2026-04-01', valor: -50 }] },
];

let fallosBasura = 0;
for (const args of BASURA) {
  let vieja, nueva;
  try { vieja = calcularMoraCausadaVIEJA(args); } catch (e) { vieja = `LANZÓ: ${e.message}`; }
  try { nueva = calcularMoraCausada(args);      } catch (e) { nueva = `LANZÓ: ${e.message}`; }
  corridas++;
  if (vieja !== nueva) {
    fallos++; fallosBasura++;
    if (ejemplosFallidos.length < 12) {
      ejemplosFallidos.push({ caso: JSON.stringify(args).slice(0, 70), vieja, nueva });
    }
  }
}

// ── repartirAbono: sin interés, tiene que repartir como siempre ────────────
//
// La firma creció con una tercera cubeta. Cualquier llamador viejo (que no
// manda `interes_pendiente`) debe recibir exactamente el mismo reparto.
const repartirVIEJO = ({ valor, mora_pendiente = 0, saldo_capital = 0, modo = 'mora_capital', valor_mora = 0 } = {}) => {
  const total = Math.max(0, Math.round(Number(valor) || 0));
  const mora  = Math.max(0, Math.round(Number(mora_pendiente) || 0));
  const cap   = Math.max(0, Math.round(Number(saldo_capital) || 0));
  let aMora = 0;
  if (modo === 'solo_capital') aMora = 0;
  else if (modo === 'personalizado') aMora = Math.min(Math.max(0, Math.round(Number(valor_mora) || 0)), mora, total);
  else aMora = Math.min(mora, total);
  const aCapital  = Math.min(cap, total - aMora);
  const excedente = total - aMora - aCapital;
  return { a_mora: aMora, a_capital: aCapital, excedente };
};

let fallosReparto = 0;
for (const valor of [0, 1, 5000, 50000, 100000, 999999]) {
  for (const mora of [0, 3000, 25000, 100000]) {
    for (const cap of [0, 10000, 80000, 500000]) {
      for (const modo of ['mora_capital', 'solo_capital', 'personalizado']) {
        for (const vm of [0, 1000, 30000]) {
          const args = { valor, mora_pendiente: mora, saldo_capital: cap, modo, valor_mora: vm };
          const v = repartirVIEJO(args);
          const n = repartirAbono(args);
          corridas++;
          const igual = v.a_mora === n.a_mora && v.a_capital === n.a_capital
                        && v.excedente === n.excedente && n.a_interes === 0;
          if (!igual) {
            fallos++; fallosReparto++;
            if (ejemplosFallidos.length < 16) {
              ejemplosFallidos.push({ reparto: args, vieja: v, nueva: n });
            }
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════

console.log('');
console.log('═══ PRUEBA DORADA — motor de devengo ≡ fórmula anterior ═══');
console.log('');
console.log(`  Combinaciones de mora comparadas : ${(corridas - 14 - 1728).toLocaleString('es-CO')}`);
console.log(`  · condiciones                    : ${CONDICIONES.length}`);
console.log(`  · saldos                         : ${SALDOS.length}`);
console.log(`  · cortes en el tiempo            : ${DIAS.length}`);
console.log(`  · patrones de abono              : ${PATRONES_ABONO.length}`);
console.log(`  Fechas como objeto Date          : ${corridasDate}`);
console.log(`  Entradas basura                  : ${BASURA.length}  (fallos: ${fallosBasura})`);
console.log(`  repartirAbono sin interés        : 1.728  (fallos: ${fallosReparto})`);
console.log('');
console.log(`  TOTAL CORRIDAS : ${corridas.toLocaleString('es-CO')}`);
console.log('');

if (fallos === 0) {
  console.log('  ✅ IDÉNTICO AL PESO. El refactor no cambió una sola cifra.');
  console.log('');
  process.exit(0);
} else {
  console.log(`  ❌ ${fallos} DIFERENCIA(S). El refactor SÍ cambió el cálculo:`);
  console.log('');
  for (const e of ejemplosFallidos) console.log('   ', JSON.stringify(e));
  console.log('');
  process.exit(1);
}
