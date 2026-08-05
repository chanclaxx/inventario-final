// ─────────────────────────────────────────────────────────────────────────────
// FECHAS — la parte que más veces ha mordido en este módulo.
//
// Tres bugs de dinero distintos han salido de confundir cómo se lee una fecha:
//   1. Leer `fecha_limite` (DATE) en Bogotá → se corría un día ATRÁS y la mora
//      salía con un día de más.
//   2. Leer la fecha de un abono (TIMESTAMP) en UTC → después de las 19:00 el
//      abono quedaba "en el futuro", salía del cálculo y la mora se perdía.
//   3. Leer `prestamos.fecha` (TIMESTAMP) en UTC al agregar el interés → el
//      interés causado salía corto un día.
//
// La regla es una sola y esta suite la fija:
//
//   · Columna DATE      (`fecha_limite`, `interes_desde`) → `aFecha`
//     El driver de pg las entrega a MEDIANOCHE UTC. Se leen con getters UTC.
//     Convertirlas a Bogotá (UTC−5) las corre un día hacia atrás.
//
//   · Columna TIMESTAMP (`prestamos.fecha`, `creditos.creado_en`, la fecha de
//     un abono) → `aFechaInstante`
//     Son instantes reales y el día que cuenta es el del negocio.
//
//   · "Ahora" → SIEMPRE `hoyBogota()`. Nunca `new Date().toISOString()`.
//
// Las pruebas puras usan `Date.UTC` explícito, así que dan igual en cualquier
// máquina. Las de base de datos están escritas para no fallar en falso si el
// proceso no corre en horario de Colombia (ver §5).
//
//   node scripts/pruebas-red-interna/16-fechas-cargos.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const dev = require(path.join(RAIZ, 'src/utils/devengo.util.js'));
const moraUtil = require(path.join(RAIZ, 'src/utils/mora.util.js'));
const interesUtil = require(path.join(RAIZ, 'src/utils/interes.util.js'));

let ok = 0, mal = 0;
const fallos = [];
const check = (t, real, esp) => {
  const igual = JSON.stringify(real) === JSON.stringify(esp);
  console.log(`  ${igual ? '✓' : '✗'} ${t}${igual ? '' : `  → ${JSON.stringify(real)} (esperaba ${JSON.stringify(esp)})`}`);
  igual ? ok++ : (mal++, fallos.push({ t, real, esp }));
};
const sec = (t) => console.log(`\n─── ${t} ───`);

// ═══ 1. Los dos normalizadores, con Date construidos a mano ════════════════
sec('1. DATE vs TIMESTAMP: los dos normalizadores no son intercambiables');

// Así entrega pg una columna DATE: medianoche UTC del día.
const comoDATE = new Date(Date.UTC(2026, 7, 4, 0, 0, 0));      // 2026-08-04 00:00 UTC
check('DATE 04-ago leída con aFecha → 04-ago',        dev.aFecha(comoDATE),        '2026-08-04');
check('★ la misma DATE con aFechaInstante se CORRE',  dev.aFechaInstante(comoDATE), '2026-08-03');

// Así entrega pg un TIMESTAMP de las 20:00 en Colombia: 01:00 UTC del día siguiente.
const comoTS2000 = new Date(Date.UTC(2026, 7, 5, 1, 0, 0));    // = 2026-08-04 20:00 Bogotá
check('TIMESTAMP 20:00 Bogotá con aFechaInstante → 04-ago', dev.aFechaInstante(comoTS2000), '2026-08-04');
check('★ el mismo TIMESTAMP con aFecha se ADELANTA',        dev.aFecha(comoTS2000),         '2026-08-05');

// Justo antes y después de la frontera de las 19:00 Colombia (00:00 UTC).
const antes = new Date(Date.UTC(2026, 7, 4, 23, 59, 0));       // 18:59 Bogotá del 4
const despues = new Date(Date.UTC(2026, 7, 5, 0, 1, 0));       // 19:01 Bogotá del 4
check('18:59 Bogotá sigue siendo el día 4', dev.aFechaInstante(antes),   '2026-08-04');
check('19:01 Bogotá SIGUE siendo el día 4', dev.aFechaInstante(despues), '2026-08-04');
check('★ pero en UTC ya son días distintos',
  [dev.aFecha(antes), dev.aFecha(despues)], ['2026-08-04', '2026-08-05']);

// El ancla: un Date suelto es ambiguo, y se resuelve como TIMESTAMP (el caso de
// `prestamos.fecha` y `creditos.creado_en`, las dos columnas de emisión).
check('aFechaAncla trata un Date como TIMESTAMP', dev.aFechaAncla(comoTS2000), '2026-08-04');
check('aFechaAncla con string lo deja igual',     dev.aFechaAncla('2026-08-04'), '2026-08-04');
check('aFechaAncla recorta un ISO completo',      dev.aFechaAncla('2026-08-04T22:10:00.000Z'), '2026-08-04');

// ═══ 2. Aritmética de calendario ══════════════════════════════════════════
sec('2. Sumar y restar días: bordes de mes, bisiesto y año');

check('31-ene + 30 días (feb de 28) = 02-mar', dev.sumarDias('2026-01-31', 30), '2026-03-02');
check('31-ene + 1 día = 01-feb',               dev.sumarDias('2026-01-31', 1),  '2026-02-01');
check('28-feb + 1 día en año NO bisiesto',     dev.sumarDias('2026-02-28', 1),  '2026-03-01');
check('★ 28-feb + 1 día en BISIESTO (2028)',   dev.sumarDias('2028-02-28', 1),  '2028-02-29');
check('29-feb + 1 día (2028)',                 dev.sumarDias('2028-02-29', 1),  '2028-03-01');
check('20-dic + 30 días cruza el año',         dev.sumarDias('2026-12-20', 30), '2027-01-19');
check('31-dic + 1 día',                        dev.sumarDias('2026-12-31', 1),  '2027-01-01');
check('restar días también funciona',          dev.sumarDias('2026-03-02', -30), '2026-01-31');

check('días entre 31-ene y 02-mar = 30',       dev.diasEntre('2026-01-31', '2026-03-02'), 30);
check('días a través de un bisiesto completo', dev.diasEntre('2028-01-01', '2029-01-01'), 366);
check('días de un año normal',                 dev.diasEntre('2026-01-01', '2027-01-01'), 365);
check('mismo día = 0',                         dev.diasEntre('2026-08-04', '2026-08-04'), 0);
check('hacia atrás da negativo',               dev.diasEntre('2026-08-04', '2026-08-01'), -3);

// Colombia no tiene horario de verano, pero la aritmética usa Date.UTC y por eso
// es inmune de todos modos. Se fija el borde en que EE.UU. sí cambia la hora.
check('★ inmune a DST (8-mar-2026, cambio en EE.UU.)', dev.diasEntre('2026-03-07', '2026-03-09'), 2);
check('★ inmune a DST al sumar',                       dev.sumarDias('2026-03-07', 2), '2026-03-09');

// ═══ 3. La cadena completa del interés con fechas mixtas ══════════════════
sec('3. Interés: el ancla se lee bien venga como venga');

const PLAN = {
  id: 'p', nombre: 'X', tipo: 'porcentaje', valor: 2,
  periodicidad: 'mensual', devengo: 'diario', base: 'saldo', inicia_tras_dias: 0,
};
const causado = (fecha_inicio, hoy) => interesUtil.calcularInteresCausado({
  saldo: 1_000_000, valor_original: 1_000_000, fecha_inicio, condicion: PLAN, hoy,
});

// El mismo instante expresado de tres formas debe dar lo MISMO.
check('ancla como string ISO corto',  causado('2026-06-01', '2026-07-31'), 40000);
check('ancla como ISO con hora',      causado('2026-06-01T22:00:00.000Z', '2026-07-31'), 40000);
check('★ ancla como Date de las 20:00 Bogotá (TIMESTAMP)',
  causado(new Date(Date.UTC(2026, 5, 2, 1, 0, 0)), '2026-07-31'), 40000);

// Este es el que fallaba antes del arreglo: leído en UTC el préstamo "empieza"
// un día después y el interés sale corto.
const conBug = interesUtil.calcularInteresCausado({
  saldo: 1_000_000, valor_original: 1_000_000,
  // Si se leyera en UTC daría 2026-06-02 y el resultado bajaría.
  fecha_inicio: dev.aFecha(new Date(Date.UTC(2026, 5, 2, 1, 0, 0))),
  condicion: PLAN, hoy: '2026-07-31',
});
check('★ leerlo mal SÍ cambia la plata (por eso importa)', conBug < 40000, true);

// ═══ 4. La mora conserva su contrato de fechas ════════════════════════════
sec('4. Mora: DATE en el plazo, TIMESTAMP en los abonos');

const COND = { id: 'c', nombre: 'N', tipo: 'mensual', valor: 2, dias_gracia: 0 };
const mora = (fecha_limite, hoy, abonos = []) => moraUtil.calcularMoraCausada({
  saldo: 1_000_000, fecha_limite, condicion: COND, hoy, abonos,
});

check('plazo como string',                    mora('2026-06-01', '2026-07-01'), 20000);
check('★ plazo como DATE (medianoche UTC)',   mora(new Date(Date.UTC(2026, 5, 1)), '2026-07-01'), 20000);

// Un abono hecho a las 20:00 de Bogotá: cuenta en SU día, no en el siguiente.
const abono20h = [{ fecha: new Date(Date.UTC(2026, 5, 17, 1, 0, 0)), valor: 500_000 }];
// Tramo 01-jun→16-jun sobre 1.500.000 y 16-jun→01-jul sobre 1.000.000.
//   1.500.000 × 2% × 15/30 = 15.000   +   1.000.000 × 2% × 15/30 = 10.000
check('★ abono TIMESTAMP de las 20:00 cuenta en su día Bogotá',
  mora('2026-06-01', '2026-07-01', abono20h), 25000);

// Sin gracia y con el plazo justo hoy: cero, no un día suelto.
check('el día del vencimiento todavía no causa', mora('2026-07-01', '2026-07-01'), 0);
check('un día después sí',                        mora('2026-07-01', '2026-07-02'), Math.round(1_000_000 * 0.02 / 30));

// ═══ 5. Contra la base de datos, con horas que provocan el corrimiento ════
sec('5. Contra Postgres: dos préstamos del MISMO día a horas distintas');

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db.exec(`
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_label VARCHAR;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_label VARCHAR;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_id    INTEGER;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_id    INTEGER;
`);
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260730_mora_credito.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260804_interes_corriente.sql'), 'utf8'));

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};
const moraService = require(path.join(RAIZ, 'src/modules/mora/mora.service.js'));

const PLAN_JSON = JSON.stringify({
  id: 'p2', nombre: 'Dos por ciento', tipo: 'porcentaje', valor: 2,
  periodicidad: 'mensual', devengo: 'diario', base: 'saldo',
  inicia_tras_dias: 0, al_vencer: 'sustituye', capitaliza: false,
  dias_periodo: 30, cada_dias: null, max_periodos: null, tope_pct: null, color: 'teal',
});

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('N');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'S');
  INSERT INTO prestatarios (negocio_id, nombre, cedula) VALUES (1,'P','1');
`);
// Mismo día de calendario en Colombia (02:00 y 22:00), 60 días atrás.
for (const hora of ['02:00:00', '22:00:00']) {
  await db.query(
    `INSERT INTO prestamos (sucursal_id, prestatario, valor_prestamo, total_abonado, estado, fecha, interes_condicion)
     VALUES (1,'P',1000000,0,'Activo', (CURRENT_DATE - INTERVAL '60 days' + TIME '${hora}'), $1::jsonb)`,
    [PLAN_JSON]
  );
}
const e1 = await moraService.estadoDe('prestamo', 1, 1);
const e2 = await moraService.estadoDe('prestamo', 2, 1);
console.log(`     (02:00 → ${e1.interes.causado} · 22:00 → ${e2.interes.causado})`);
check('★ la hora del día NO cambia el interés causado', e1.interes.causado, e2.interes.causado);
check('y el valor es el correcto (60 días al 2%)',      e1.interes.causado, 40000);

// `interes_desde` es DATE: fijarlo no debe correrse ni un día.
await db.query(`UPDATE prestamos SET interes_desde = CURRENT_DATE - INTERVAL '30 days' WHERE id = 2`);
const e3 = await moraService.estadoDe('prestamo', 2, 1);
check('★ interes_desde (DATE) manda sobre la emisión, sin corrimiento', e3.interes.causado, 20000);

// El mismo contrato para la mora, con el plazo como DATE.
await db.query(
  `UPDATE prestamos SET fecha_limite = CURRENT_DATE - INTERVAL '30 days',
     mora_condicion = '{"id":"m","nombre":"M","tipo":"mensual","valor":3,"dias_gracia":0,"tope_pct":null,"color":"amber"}'::jsonb
   WHERE id = 1`
);
const e4 = await moraService.estadoDe('prestamo', 1, 1);
check('★ mora por 30 días exactos al 3%', e4.mora.causada, 30000);
check('y días vencidos exactos',          e4.mora.dias_vencidos, 30);
// Con 'sustituye', el interés se detuvo en la fecha límite (día 30 de los 60).
check('★ el interés se detuvo en el vencimiento', e4.interes.causado, 20000);

// ═══ 6. "Ahora" siempre en Bogotá ════════════════════════════════════════
sec('6. El "hoy" del negocio');

check('hoyBogota tiene formato de fecha', /^\d{4}-\d{2}-\d{2}$/.test(dev.hoyBogota()), true);
check('★ hoyBogota coincide con aFechaInstante(ahora)',
  dev.hoyBogota(), dev.aFechaInstante(new Date()));
// Si alguien usara toISOString() para "hoy", después de las 19:00 diferiría.
const utcHoy = new Date().toISOString().slice(0, 10);
if (utcHoy !== dev.hoyBogota()) {
  console.log(`     ⚠ ahora mismo UTC (${utcHoy}) y Bogotá (${dev.hoyBogota()}) difieren:`);
  console.log('       es exactamente la franja en que usar toISOString() rompería el cálculo.');
} else {
  console.log('     (ahora mismo UTC y Bogotá coinciden; la diferencia aparece después de las 19:00)');
}

// ═══ 7. Entradas imposibles no rompen ni inventan plata ══════════════════
sec('7. Fechas basura');

check('fecha nula',        dev.aFecha(null), null);
check('texto cualquiera',  dev.aFecha('ayer'), null);
check('Date inválido',     dev.aFecha(new Date('nada')), null);
check('instante nulo',     dev.aFechaInstante(null), null);
check('interés sin ancla', causado(null, '2026-07-31'), 0);
check('interés con ancla basura', causado('no-es-fecha', '2026-07-31'), 0);
check('mora sin plazo',    mora(null, '2026-07-01'), 0);
check('★ corte anterior al inicio no causa nada', causado('2026-07-31', '2026-06-01'), 0);

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
if (mal === 0) {
  console.log(`  ✅ ${ok} comprobaciones de fecha, todas correctas.`);
  process.exit(0);
} else {
  console.log(`  ❌ ${mal} de ${ok + mal} fallaron:`);
  for (const f of fallos) console.log('   ', JSON.stringify(f));
  process.exit(1);
}
