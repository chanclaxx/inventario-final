// ─────────────────────────────────────────────────────────────────────────────
// InputMoneda — prueba de regresión.
//
// Este componente lo usan 76 campos de dinero de toda la app: facturas, abonos,
// compras, tesorería, préstamos, servicios, red interna. Un cambio en su
// aritmética los toca TODOS a la vez, así que cualquier retoque tiene que pasar
// por aquí antes de subirse.
//
// Lo que protege:
//   1. Un `numeric` de Postgres llega como STRING con decimales ("7000.00").
//      Limpiarlo con replace(/\D/g,'') lo convertía en 700000 — el precio ×100 —
//      y ESE valor corrupto se guardaba en la base de datos en cuanto alguien
//      tocaba el campo. (Encontrado en el módulo de pedidos, 24-ago-2026.)
//   2. Todo lo demás — enteros, strings de dígitos, vacíos, basura, strings ya
//      formateados — tiene que seguir dando EXACTAMENTE lo de siempre.
//
// No necesita navegador ni framework: las funciones bajo prueba son puras y se
// leen del archivo real, no se copian.
//
//   node scripts/prueba-input-moneda.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ARCHIVO = path.join(AQUI, '..', 'src', 'components', 'ui', 'InputMoneda.jsx');

const src = readFileSync(ARCHIVO, 'utf8');
const cuerpoAEntero   = src.match(/const aEntero = \(valor\) => \{[\s\S]*?\n\};/)?.[0];
const cuerpoFormatear = src.match(/const formatearMiles = \(valor\) => \{[\s\S]*?\n\};/)?.[0];
if (!cuerpoAEntero || !cuerpoFormatear) {
  console.error('✗ No se pudieron extraer los helpers de InputMoneda.jsx.');
  console.error('  Si los renombraste, actualiza esta prueba — no la borres.');
  process.exit(1);
}
const formatear = new Function(`${cuerpoAEntero}\n${cuerpoFormatear}\nreturn formatearMiles;`)();

let ok = 0, fallos = 0;
const q = (x) => (typeof x === 'string' ? JSON.stringify(x) : String(x));
const check = (valor, esperado, nota) => {
  const real = formatear(valor);
  const bien = real === esperado;
  console.log(`  ${bien ? '✓' : '✗'} ${q(valor).padEnd(15)} → ${real === '' ? '(vacío)' : real}`
    + `${bien ? '' : `   ← esperaba ${esperado === '' ? '(vacío)' : esperado}`}   ${nota || ''}`);
  bien ? ok++ : fallos++;
};

console.log('\n═══ 1. El caso que estaba roto: numeric de Postgres ═══');
console.log('    (node-postgres no castea NUMERIC a number para no perder precisión)');
check('7000.00',    '7.000',     '← antes daba 700.000');
check('1500.00',    '1.500',     '← antes daba 150.000');
check('1500000.00', '1.500.000', '← antes daba 150.000.000');
check('2500000.50', '2.500.001', 'redondea: el peso no tiene centavos');
check('0.00',       '0');

console.log('\n═══ 2. Números con decimales (promedios, tarifas, prorrateos) ═══');
check(1500.5,      '1.501', '← antes daba 15.005');
check(7333.333333, '7.333', '← antes daba 7.333.333.333');

console.log('\n═══ 3. Lo que ya funcionaba NO se puede mover ═══');
check(0,          '0');
check(1500,       '1.500');
check(150000,     '150.000');
check(1500000,    '1.500.000');
check(999999999,  '999.999.999');
check('1500',     '1.500',      'string de dígitos');
check('1500000',  '1.500.000',  'string de dígitos');
check('',         '',           'campo vacío');
check(null,       '',           'API sin valor');
check(undefined,  '',           'prop ausente');
check('abc',      '',           'basura');
check('   ',      '',           'espacios');
check(NaN,        '');
check(Infinity,   '');

console.log('\n═══ 4. Strings ya formateados: camino de siempre, intacto ═══');
console.log('    (nadie debería pasarlos, pero si alguien lo hace no puede romperse)');
check('1.500.000', '1.500.000', 'puntos de miles');
check('$ 1.500',   '1.500',     'con símbolo');
check('1,500',     '1.500',     'coma de miles');

console.log('\n═══ 5. Negativos: se respeta el signo ═══');
console.log('    (antes se mostraba el valor absoluto: -5000 se veía como 5.000)');
check(-5000,      '-5.000');
check('-5000',    '-5.000');
check('-1500.00', '-1.500');

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${ok} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(72));
process.exit(fallos ? 1 : 0);
