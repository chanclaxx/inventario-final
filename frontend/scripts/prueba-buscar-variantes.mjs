// Prueba del buscador de variantes (`src/utils/buscarVariantes.js`,
// `src/hooks/useBuscadorVariantes.js`, `src/components/ui/BuscadorVariantes.jsx`).
//
// Un producto con el árbol de variantes activo se compra, se recibe y se corrige
// eligiendo la HOJA. Con veinte es difícil encontrarla: pasado un umbral, cada
// selector muestra un cuadro de búsqueda. Lo que se vigila:
//
//   1. por debajo del umbral NADA cambia (ni cuadro, ni filtro, ni copia);
//   2. el filtro: sin tildes, por palabras, por el padre y por el código;
//   3. las hojas del árbol traen su código;
//   4. el cuadro, renderizado de verdad (se compila con el Vite del proyecto y
//      se pinta con react-dom/server): cuándo aparece y qué dice;
//   5. el selector de la compra, renderizado: con 8 variantes igual que antes,
//      con 9 aparece el buscador y siguen estando todas;
//   6. los ocho selectores lo usan (estática), y el punto de venta no se tocó.
//
//   node scripts/prueba-buscar-variantes.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  UMBRAL_BUSCADOR_VARIANTES, normalizarBusqueda, filtrarHojas, mereceBuscador,
} from '../src/utils/buscarVariantes.js';
import { hojasDelArbol } from '../src/pages/proveedores/capturaMercancia.utils.js';

const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC  = path.resolve(AQUI, '../src');
const leer = (...p) => readFileSync(path.join(SRC, ...p), 'utf8');

let fallos = 0, pasados = 0;
const check = (nombre, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${ok ? '' : `: ${JSON.stringify(real)} ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
};
const cierto = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${cond || !detalle ? '' : ` — ${detalle}`}`);
  cond ? pasados++ : fallos++;
};

// Un árbol como el que devuelve GET /variantes-producto/:id/arbol: tallas con
// colores debajo, y una talla suelta (hoja de primer nivel).
const arbol = [
  { id: 1, tipo_nombre: 'Talla', valor: '38MM', stock: 0, codigo: 'COR-38', variantes: [
    { id: 11, tipo_nombre: 'Color', valor: 'Negro',     stock: 4, codigo: 'ACC-COR-NEG-001' },
    { id: 12, tipo_nombre: 'Color', valor: 'Azul rey',  stock: 0, codigo: 'ACC-COR-AZU-002' },
    { id: 13, tipo_nombre: 'Color', valor: 'Café',      stock: 2, codigo: null },
  ] },
  { id: 2, tipo_nombre: 'Talla', valor: '42MM', stock: 0, codigo: null, variantes: [
    { id: 21, tipo_nombre: 'Color', valor: 'Negro',     stock: 9, codigo: '000121' },
    { id: 22, tipo_nombre: 'Color', valor: 'Rosado',    stock: 1, codigo: '000122' },
  ] },
  { id: 3, tipo_nombre: null, valor: 'Única', stock: 7, codigo: 'UNI-7', variantes: [] },
];
const hojas = hojasDelArbol(arbol);
const etiquetas = (lista) => lista.map((h) => (h.labelPadre ? `${h.labelPadre} / ${h.label}` : h.label));
const muchas = (n) => Array.from({ length: n }, (_, i) => ({ key: `a-${i}`, id: i, tipo: 'atributo', label: `Talla: ${30 + i}`, stock: i }));

console.log('\n1. Por debajo del umbral nada cambia');
check('el umbral es 8: aparece con MÁS de 8', UMBRAL_BUSCADOR_VARIANTES, 8);
check('8 variantes: sin buscador', mereceBuscador(muchas(8)), false);
check('★ 9 variantes: con buscador', mereceBuscador(muchas(9)), true);
check('20 variantes: con buscador', mereceBuscador(muchas(20)), true);
check('sin lista no revienta', [mereceBuscador([]), mereceBuscador(undefined), mereceBuscador(null)], [false, false, false]);
cierto('★ sin texto devuelve EL MISMO arreglo, no una copia', filtrarHojas(hojas, '') === hojas && filtrarHojas(hojas, '   ') === hojas);

console.log('\n2. El filtro');
check('normaliza tildes, mayúsculas y espacios', normalizarBusqueda('  CAFÉ   con  Ñ '), 'cafe con n');
check('una palabra', etiquetas(filtrarHojas(hojas, 'rosado')), ['Talla: 42MM / Color: Rosado']);
check('★ sin tilde encuentra la que la tiene', etiquetas(filtrarHojas(hojas, 'cafe')), ['Talla: 38MM / Color: Café']);
check('con tilde encuentra la que no', etiquetas(filtrarHojas(hojas, 'unica')), ['Única']);
check('en mayúsculas', etiquetas(filtrarHojas(hojas, 'NEGRO')), ['Talla: 38MM / Color: Negro', 'Talla: 42MM / Color: Negro']);
check('★ dos palabras: el padre y la hoja, en cualquier orden',
  [etiquetas(filtrarHojas(hojas, '42 negro')), etiquetas(filtrarHojas(hojas, 'negro 42'))],
  [['Talla: 42MM / Color: Negro'], ['Talla: 42MM / Color: Negro']]);
check('una palabra a medias', etiquetas(filtrarHojas(hojas, 'azu')), ['Talla: 38MM / Color: Azul rey']);
check('por el padre trae todas sus hojas', filtrarHojas(hojas, '38mm').length, 3);
check('★ por el código (lo que teclea el lector)', etiquetas(filtrarHojas(hojas, '000122')), ['Talla: 42MM / Color: Rosado']);
check('por un código con guiones, sin importar mayúsculas', etiquetas(filtrarHojas(hojas, 'acc-cor-neg-001')), ['Talla: 38MM / Color: Negro']);
check('lo que no existe: lista vacía', filtrarHojas(hojas, 'verde'), []);
check('todas las palabras tienen que estar', filtrarHojas(hojas, 'negro rosado'), []);
check('no cambia el orden del árbol', etiquetas(filtrarHojas(hojas, 'color')), etiquetas(hojas).filter((e) => e.includes('Color')));
check('una hoja sin etiqueta no revienta', filtrarHojas([{ key: 'x' }, { key: 'y', label: 'Azul' }], 'azul').length, 1);

console.log('\n3. Las hojas traen su código');
check('seis hojas: cinco colores y la talla suelta', hojas.length, 6);
check('★ la variante lleva su código', hojas.find((h) => h.key === 'v-11').codigo, 'ACC-COR-NEG-001');
check('el atributo-hoja lleva el suyo', hojas.find((h) => h.key === 'a-3').codigo, 'UNI-7');
check('sin código es null, no undefined', hojas.find((h) => h.key === 'v-13').codigo, null);
check('lo que ya traían sigue igual', hojas.find((h) => h.key === 'v-21'),
  { key: 'v-21', id: 21, tipo: 'variante', labelPadre: 'Talla: 42MM', label: 'Color: Negro', stock: 9, codigo: '000121' });
cierto('el contenedor (la talla con colores) no es hoja', !hojas.some((h) => h.key === 'a-1' || h.key === 'a-2'));

// ── Render de verdad ─────────────────────────────────────────────────────────
// Se compila el .jsx con el propio Vite del proyecto (build SSR: empaqueta el
// código de `src` y deja `react` y los iconos como dependencias) y se pinta con
// react-dom/server. La salida va dentro de node_modules para que esas
// dependencias se resuelvan y git no la vea.
const RAIZ_FRONT = path.resolve(AQUI, '..');
const TMP = path.join(RAIZ_FRONT, 'node_modules', '.prueba-buscar-variantes');
let Buscador = null, MultiSelector = null, render = null, React = null;
try {
  const vite  = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  mkdirSync(TMP, { recursive: true });
  const entrada = path.join(TMP, 'entrada.js');
  writeFileSync(entrada, `
    export { BuscadorVariantes } from '../../src/components/ui/BuscadorVariantes.jsx';
    export { MultiSelectorCompra } from '../../src/pages/proveedores/capturaMercancia.jsx';
  `);
  await vite.build({
    configFile: false, root: RAIZ_FRONT, logLevel: 'silent', plugins: [react()],
    build: {
      ssr: entrada, outDir: path.join(TMP, 'salida'), emptyOutDir: true, minify: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'piezas.mjs' } },
    },
  });
  ({ BuscadorVariantes: Buscador, MultiSelectorCompra: MultiSelector } =
    await import(pathToFileURL(path.join(TMP, 'salida', 'piezas.mjs')).href));
  React  = (await import('react')).default;
  render = (await import('react-dom/server')).renderToStaticMarkup;
} catch (e) {
  cierto('se pudo compilar y cargar los componentes', false, e.message);
}

if (render) {
  const pintar = (Comp, props) => render(React.createElement(Comp, props));
  const buscadorCon = (extra) => ({
    activo: true, consulta: '', setConsulta() {}, limpiar() {}, visibles: hojas, total: hojas.length, ...extra,
  });

  console.log('\n4. El cuadro de búsqueda');
  check('★ lista corta (inactivo): no pinta NADA', pintar(Buscador, { buscador: buscadorCon({ activo: false }) }), '');
  const vacio = pintar(Buscador, { buscador: buscadorCon({ total: 20 }) });
  cierto('activo: pinta el cuadro', /<input[^>]*type="text"/.test(vacio) && vacio.includes('Buscar variante'));
  cierto('sin texto dice cuántas hay', />20</.test(vacio) && !vacio.includes(' de 20'));
  cierto('sin texto no ofrece borrar ni Enter', !vacio.includes('Borrar la búsqueda') && !vacio.includes('Enter para elegirla'));
  const filtrado = pintar(Buscador, { buscador: buscadorCon({ consulta: 'negro', visibles: hojas.slice(0, 2), total: 20 }), onUnico() {} });
  cierto('con texto dice «2 de 20» y deja borrar', filtrado.includes('2 de 20') && filtrado.includes('Borrar la búsqueda'));
  cierto('con varias coincidencias NO ofrece Enter', !filtrado.includes('Enter para elegirla'));
  const una = pintar(Buscador, { buscador: buscadorCon({ consulta: 'rosado', visibles: hojas.slice(4, 5), total: 20 }), onUnico() {} });
  cierto('★ con UNA coincidencia ofrece Enter', una.includes('1 de 20') && una.includes('Enter para elegirla'));
  const unaSinEnter = pintar(Buscador, { buscador: buscadorCon({ consulta: 'rosado', visibles: hojas.slice(4, 5), total: 20 }) });
  cierto('…salvo que el selector no elija con Enter (lista de costos)', !unaSinEnter.includes('Enter para elegirla'));
  const nada = pintar(Buscador, { buscador: buscadorCon({ consulta: ' verde ', visibles: [], total: 20 }), onUnico() {} });
  cierto('sin coincidencias lo dice, con lo que se escribió', nada.includes('Ninguna variante coincide con «verde»') && nada.includes('0 de 20'));

  console.log('\n5. El selector de la compra, renderizado');
  const contar = (html, re) => (html.match(re) || []).length;
  const sel8 = pintar(MultiSelector, { hojas: muchas(8), nodosData: {}, onActualizar() {} });
  cierto('★ con 8 variantes: sin cuadro de búsqueda', !sel8.includes('Buscar variante'));
  check('…y sus 8 chips', contar(sel8, /<button/g), 8);
  cierto('…sin tope de alto (igual que antes)', !sel8.includes('max-h-40'));
  const sel9 = pintar(MultiSelector, { hojas: muchas(9), nodosData: {}, onActualizar() {} });
  cierto('★ con 9 variantes: aparece el cuadro', sel9.includes('Buscar variante'));
  check('…y siguen las 9 (sin escribir no se esconde ninguna)', contar(sel9, /type="button"[^>]*class="flex items-center gap-1 px-2\.5/g), 9);
  const sel20 = pintar(MultiSelector, {
    hojas: muchas(20), nodosData: { 'a-3': { cantidad: '5', costo: '1000' } }, onActualizar() {}, mostrarCosto: false,
  });
  cierto('con 20: cuadro, chips con tope de alto y la ya elegida en su fila',
    sel20.includes('Buscar variante') && sel20.includes('max-h-40') && sel20.includes('1 variante(s) — 5 unidades totales'));
  cierto('bodega (sin costos) sigue sin la columna de precio', !sel20.includes('Precio unit.'));
  const selArbol = pintar(MultiSelector, { hojas, nodosData: {}, onActualizar() {} });
  cierto('el chip muestra padre / hoja', selArbol.includes('Talla: 38MM / Color: Negro'));
}

console.log('\n6. Los ocho selectores lo usan');
const SITIOS = [
  ['compra, recepción y entrada (chips)', 'pages/proveedores/capturaMercancia.jsx', ['useBuscadorVariantes(hojas)', 'buscador.visibles.map(']],
  ['agregar stock desde Inventario',      'pages/inventario/ModalAgregarProducto.jsx', ['useBuscadorVariantes(hojas)', 'buscador.visibles.map(']],
  ['pedir una variante en la orden',      'pages/proveedores/ModalOrden.jsx', ['useBuscadorVariantes(hojas)', 'buscador.visibles.map(']],
  ['recibir: llegó otra / llegó de más',  'pages/proveedores/ModalRecibir.jsx', ['buscSust.visibles.map(', 'buscExtra.visibles.map(']],
  ['entrada: llegó otra / llegó de más',  'pages/entradas/VistaEntrada.jsx', ['buscSust.visibles.map(', 'buscExtra.visibles.map(']],
  ['retoma: a cuál entra',                'components/ui/SelectorNodoRetoma.jsx', ['useBuscadorVariantes(hojas)', 'buscador.visibles.map(']],
  ['corregir una entrada',                'pages/entradas/ModalCorregirEntrada.jsx', ['useBuscadorVariantes(hojas)', 'buscador.visibles.map(']],
  ['costo por variante al editar',        'pages/inventario/ModalEditarProductoCantidad.jsx', ['useBuscadorVariantes(hojas)', 'buscadorCostos.visibles.map(']],
];
for (const [nombre, archivo, marcas] of SITIOS) {
  const s = leer(archivo);
  cierto(nombre, s.includes('<BuscadorVariantes ') && marcas.every((m) => s.includes(m)),
    `falta en ${archivo}`);
}
// Las filas ya elegidas NO se filtran: buscar otra variante no puede esconder
// (ni mucho menos borrar) una cantidad ya escrita.
for (const archivo of ['pages/proveedores/capturaMercancia.jsx', 'pages/inventario/ModalAgregarProducto.jsx']) {
  const s = leer(archivo);
  cierto(`★ ${path.basename(archivo)}: lo ya elegido sale de TODAS las hojas, no de lo visible`,
    /const hojasSel\s+= hojas\.filter\(\(h\) => seleccionadas\.has\(h\.key\)\)/.test(s)
    && /if \(!seleccionadas\.has\(h\.key\)\) \{ toggle\(h\);/.test(s));
}
cierto('★ al guardar los costos se recorre `hojas`, no lo visible',
  /pendientes = hojas\.filter/.test(leer('pages/inventario/ModalEditarProductoCantidad.jsx')));
const reciben = leer('pages/proveedores/ModalRecibir.jsx') + leer('pages/entradas/VistaEntrada.jsx');
cierto('lo que ya está en la recepción no se ofrece como «de más»', (reciben.match(/!nodosUsados\?\.has\(h\.key\)/g) || []).length === 2);
const hook = leer('hooks/useBuscadorVariantes.js');
cierto('★ inactivo, el hook devuelve la lista TAL CUAL', /visibles: activo \? filtrarHojas\(hojas, consulta\) : hojas/.test(hook));
cierto('el punto de venta conserva su propia búsqueda (no se tocó)',
  leer('pages/inventario/VistaVariantesProducto.jsx').includes('function coincideNodo(')
  && !leer('pages/inventario/VistaVariantesProducto.jsx').includes('BuscadorVariantes'));

try { rmSync(TMP, { recursive: true, force: true }); } catch { /* da igual */ }

console.log(`\n${fallos === 0 ? '✓ TODO OK' : `✗ ${fallos} FALLO(S)`} — ${pasados} verificaciones`);
process.exit(fallos ? 1 : 0);
