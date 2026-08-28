// ─────────────────────────────────────────────────────────────────────────────
// CONTRATOS DE HOOKS DEL FRONTEND
//
// El build de Vite compila cualquier disparate que sea JavaScript válido. Esta
// prueba cubre el hueco: verifica de forma estática que los hooks que devuelven
// un OBJETO se consuman como objeto.
//
// Nace de un error real en producción: `useSucursalKey()` devuelve
// `{ sucursalKey, sucursalLista }`, pero EntradasPage lo guardó entero y lo
// desparramó (`['entradas', ...sucursalKey]`). El build pasó limpio y la
// pantalla reventó al abrirla con
//
//     Uncaught TypeError: o is not iterable
//
// Es una familia de errores barata de cometer y cara de encontrar: no aparece
// hasta que alguien abre la pantalla, y el mensaje minificado no dice dónde.
//
//   node scripts/pruebas-red-interna/34-contratos-frontend.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const AQUI  = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC   = path.resolve(AQUI, '../../../frontend/src');

let fallos = 0, pasados = 0;
const check = (etiqueta, ok, detalle = '') => {
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else    { fallos++;  console.log(`  ✗ ${etiqueta}${detalle ? `\n      ${detalle}` : ''}`); }
};

const archivos = [];
(function recorrer(dir) {
  for (const entrada of readdirSync(dir)) {
    const p = path.join(dir, entrada);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (/\.jsx?$/.test(entrada)) archivos.push(p);
  }
})(SRC);

const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/');

// ── Hooks que devuelven un objeto y NO se pueden desparramar ────────────────
// Para agregar uno: su nombre y las claves que expone.
const HOOKS_OBJETO = [
  { hook: 'useSucursalKey', claves: ['sucursalKey', 'sucursalLista'] },
];

console.log(`\n1. Hooks que devuelven objeto (${archivos.length} archivos revisados)`);

for (const { hook, claves } of HOOKS_OBJETO) {
  const malos = [];
  const usos  = [];

  for (const f of archivos) {
    const src = readFileSync(f, 'utf8');
    if (!src.includes(`${hook}(`)) continue;

    for (const linea of src.split('\n')) {
      const m = linea.match(new RegExp(`const\\s+([^=]+?)\\s*=\\s*${hook}\\(`));
      if (!m) continue;
      usos.push(rel(f));
      const lhs = m[1].trim();
      // Tiene que ser una desestructuración: `const { sucursalKey } = ...`
      if (!lhs.startsWith('{')) {
        malos.push(`${rel(f)} → const ${lhs} = ${hook}()`);
      }
    }
  }

  check(`★ ${hook}() siempre se desestructura (${usos.length} usos)`,
    malos.length === 0, malos.join('\n      '));

  // Y que nadie desestructure una clave que el hook no tiene: un typo ahí
  // devuelve undefined en silencio y la consulta se queda deshabilitada para
  // siempre sin que nada falle.
  const clavesMalas = [];
  for (const f of archivos) {
    const src = readFileSync(f, 'utf8');
    for (const linea of src.split('\n')) {
      const m = linea.match(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${hook}\\(`));
      if (!m) continue;
      for (const bruta of m[1].split(',')) {
        const nombre = bruta.split(':')[0].trim();
        if (nombre && !claves.includes(nombre)) {
          clavesMalas.push(`${rel(f)} → "${nombre}" no existe en ${hook}()`);
        }
      }
    }
  }
  check(`las claves desestructuradas de ${hook}() existen`,
    clavesMalas.length === 0, clavesMalas.join('\n      '));
}

// ── El spread solo sobre lo que de verdad es un arreglo ─────────────────────
console.log('\n2. `...sucursalKey` solo donde sucursalKey es el arreglo');
const spreadsMalos = [];
for (const f of archivos) {
  const src = readFileSync(f, 'utf8');
  if (!src.includes('...sucursalKey')) continue;
  // Si el archivo desparrama sucursalKey, tiene que haberlo obtenido
  // desestructurando el hook o recibido como prop; lo que no puede es venir de
  // `const sucursalKey = useSucursalKey()`.
  if (/const\s+sucursalKey\s*=\s*useSucursalKey\(/.test(src)) {
    spreadsMalos.push(rel(f));
  }
}
check('★ ningún archivo desparrama el objeto del hook',
  spreadsMalos.length === 0, spreadsMalos.join('\n      '));

// ── La pantalla nueva, en concreto ──────────────────────────────────────────
console.log('\n3. Entradas de bodega');
const entradas = readFileSync(path.join(SRC, 'pages/entradas/EntradasPage.jsx'), 'utf8');
check('★ desestructura el hook',
  /const \{ sucursalKey, sucursalLista \} = useSucursalKey\(\)/.test(entradas));
check('★ y usa sucursalLista para no consultar antes de tiempo',
  (entradas.match(/enabled:\s*[^,\n]*sucursalLista/g) || []).length >= 3,
  'las consultas de productos, órdenes y entradas deben esperar a la sucursal');
check('★ no pinta un input de IMEI por unidad sin tope',
  /MAX_IMEI/.test(entradas),
  'una cantidad grande renderizaría miles de inputs y congelaría el navegador');
// El payload que arma la pantalla del bodeguero, tal cual sale hacia el backend.
// Si algun dia aparece ahi un precio o un proveedor, el diseno se torcio: esos
// los resuelve el servidor justamente porque esta persona no debe decidirlos.
const inicioMut = entradas.indexOf('const mut = useMutation');
const finMut    = entradas.indexOf('onSuccess:', inicioMut);
const payload   = entradas.slice(inicioMut, finMut);
check('★ el payload de la entrada no lleva precios',
  !/precio|costo/i.test(payload),
  'la pantalla del bodeguero nunca debe mandar cifras de dinero');
check('★ ni proveedor',
  !/proveedor/i.test(payload),
  'el proveedor sale de la orden en el backend, no del cliente');
check('y sí lleva lo que el bodeguero cuenta',
  /cantidad/.test(payload) && /producto_id/.test(payload));

console.log('\n' + '─'.repeat(62));
if (fallos) { console.log(`✗ ${fallos} FALLO(S) de ${fallos + pasados}`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
