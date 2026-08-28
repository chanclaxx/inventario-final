// ─────────────────────────────────────────────────────────────────────────────
// LA LISTA DE MÓDULOS ESTÁ DUPLICADA — que las dos copias digan lo mismo
//
// `backend/src/config/modulos.js` se anuncia como «fuente única de verdad», pero
// el frontend NO puede importarlo (son dos paquetes distintos), así que
// `UsuariosConfig.jsx` lleva su propia copia escrita a mano. Se separaron.
//
// Al frontend le faltaba `red_interna` —la pestaña «Bodega»— en las dos listas.
// El síntoma que se reportó desde producción: *"bodega la tengo activa en
// usuarios como supervisor y no se ve esa pestaña"*.
//
// Y el daño no era solo la casilla que faltaba:
//
//   · Sin `red_interna` en MODULOS, no había forma de concederlo desde la
//     pantalla, ni de ver que un usuario lo tenía.
//   · Sin `red_interna` en PERMISOS_BASE pasaba lo grave: `handleToggle` arma el
//     arreglo nuevo a partir de la base de ESE archivo. A un usuario con
//     permisos base (`modulos_permitidos = NULL`, que en el backend SÍ incluye
//     red_interna) le bastaba con que un admin tocara CUALQUIER otro módulo para
//     que se guardara una lista sin Bodega. Se perdía en silencio y no había
//     forma de devolverla desde la interfaz.
//
// Mientras la lista siga duplicada, esta prueba es lo único que evita que vuelva
// a pasar. Lee los dos archivos de verdad y los compara.
//
//   node scripts/pruebas-red-interna/32-modulos-sincronizados.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src/pages/configuracion/UsuariosConfig.jsx');

let fallos = 0, pasados = 0;
const checkEq = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else {
    fallos++;
    console.log(`  ✗ ${etiqueta}\n      frontend  ${JSON.stringify(real)}\n      backend   ${JSON.stringify(esperado)}`);
  }
};

// ── Lado backend: se puede requerir ─────────────────────────────────────────
const { MODULOS, PERMISOS_BASE } = require(path.join(RAIZ, 'src/config/modulos'));

// ── Lado frontend: hay que leerlo como texto ────────────────────────────────
const fuente = readFileSync(FRONT, 'utf8');

const bloque = (nombre) => {
  const i = fuente.indexOf(`const ${nombre} = `);
  if (i === -1) throw new Error(`No se encontró ${nombre} en UsuariosConfig.jsx`);
  // Hasta el `];` o `};` que cierra la declaración.
  const fin = fuente.slice(i).search(/\n\};|\n\];/);
  return fuente.slice(i, i + fin);
};

// `key: 'x'` dentro del bloque MODULOS, en orden.
const modulosFront = [...bloque('MODULOS').matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1]);

// El arreglo de cada rol dentro de PERMISOS_BASE.
const baseFront = (rol) => {
  const txt = bloque('PERMISOS_BASE');
  const i = txt.indexOf(`${rol}:`);
  if (i === -1) return null;
  const arr = txt.slice(i).match(/\[([\s\S]*?)\]/);
  if (!arr) return null;
  return [...arr[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

console.log('\n1. La lista de módulos');
const modulosBack = MODULOS.map((m) => m.key);
checkEq('★ las dos listas tienen las mismas claves',
  [...modulosFront].sort(), [...modulosBack].sort());
checkEq('y en el mismo orden (es el orden en que se pintan)', modulosFront, modulosBack);
checkEq('★ «Bodega» (red_interna) está en el frontend', modulosFront.includes('red_interna'), true);

console.log('\n2. Los permisos base por rol');
for (const rol of Object.keys(PERMISOS_BASE)) {
  checkEq(`★ base de ${rol}`, [...(baseFront(rol) || [])].sort(), [...PERMISOS_BASE[rol]].sort());
}
checkEq('★ el supervisor arranca con Bodega',
  (baseFront('supervisor') || []).includes('red_interna'), true);
checkEq('★ el vendedor también (confirma remisiones en el local)',
  (baseFront('vendedor') || []).includes('red_interna'), true);

console.log('\n3. Ningún permiso base nombra un módulo inexistente');
for (const [rol, claves] of Object.entries(PERMISOS_BASE)) {
  const huerfanas = claves.filter((k) => !modulosBack.includes(k));
  checkEq(`${rol} sin claves huérfanas`, huerfanas, []);
}

console.log('\n4. El escenario que se rompía en producción');
// Reproduce `handleToggle` de UsuariosConfig: un usuario con permisos base al
// que un admin le toca OTRO módulo. Antes, la base del frontend no traía
// red_interna y se guardaba una lista sin Bodega.
const handleToggle = (modulosPermitidos, rol, key) => {
  const base = modulosPermitidos !== null ? modulosPermitidos : (baseFront(rol) || []);
  return base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
};
const guardado = handleToggle(null, 'supervisor', 'tesoreria');   // le quitan Tesorería
checkEq('★ tocar otro módulo NO le quita Bodega', guardado.includes('red_interna'), true);
checkEq('y sí le quita el que se tocó', guardado.includes('tesoreria'), false);

console.log('\n' + '─'.repeat(62));
if (fallos) { console.log(`✗ ${fallos} FALLO(S) de ${fallos + pasados}`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
