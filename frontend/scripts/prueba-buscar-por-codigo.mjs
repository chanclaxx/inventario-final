// Prueba de la búsqueda por CÓDIGO en las pantallas donde entra mercancía
// (`src/utils/buscarProductos.js`; pedido del usuario, 16-oct-2026: «los
// buscadores deben poder buscar desde el código de producto que tenemos para
// pistolear»). Lo que se vigila:
//
//   1. sin texto, o buscando por nombre, NADA cambia (todo lo que antes salía
//      sigue saliendo);
//   2. el filtro encuentra por el código del producto y por el de sus variantes;
//   3. Enter: el código EXACTO gana, si no la única coincidencia; con varias no
//      adivina;
//   4. la corrección del guion del lector solo con la clave del negocio;
//   5. el selector de variantes, renderizado: sin código escaneado sale IGUAL
//      que antes; con él, esa variante llega elegida;
//   6. las seis pantallas usan la misma regla (estática);
//   7. los 2.180 códigos REALES de la plantilla de Sitio Tecnologico llevan cada
//      uno a su producto (y a su variante).
//
//   node scripts/prueba-buscar-por-codigo.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  coincideProducto, filtrarProductos, productoPorCodigo, elegirConEnter,
} from '../src/utils/buscarProductos.js';
import { hojaPorCodigo } from '../src/utils/buscarVariantes.js';
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

// Como los devuelve GET /productos-cantidad (`findAll`): el código propio y los
// de las variantes en `codigos_variantes`, separados por espacio.
const productos = [
  { id: 1, nombre: '360 NEGRO', codigo: null, codigos_variantes: 'ACC-360-38M-001 ACC-360-40M-002' },
  { id: 2, nombre: '360 TRANSPARENTE', codigo: null, codigos_variantes: 'ACC-360-38M-009 ACC-360-40M-010' },
  { id: 3, nombre: 'CONTROL PLAY 5', codigo: 'VID-CON-001', codigos_variantes: null },
  { id: 4, nombre: 'Cargador Rápido 20W', codigo: '000121', codigos_variantes: '' },
  { id: 5, nombre: 'CORREA JLLC 010 IMANTADA DOBLE FAZ', codigo: 'ACC-COR-TAL-023', codigos_variantes: 'ACC-COR-TAL-044' },
  { id: 6, nombre: 'Estuche   Silicona', codigo: undefined },
];
const ids = (lista) => lista.map((p) => p.id);
const reglaVieja = (lista, q) => lista.filter((p) => p.nombre.toLowerCase().includes(q.toLowerCase()));

console.log('\n1. Sin texto o por nombre, nada cambia');
cierto('★ sin texto devuelve EL MISMO arreglo', filtrarProductos(productos, '') === productos && filtrarProductos(productos, '   ') === productos);
for (const q of ['360', 'negro', 'CONTROL', 'play 5', 'cargador', 'rápido', 'correa jllc', 'zzz']) {
  const viejos = ids(reglaVieja(productos, q));
  const nuevos = ids(filtrarProductos(productos, q));
  cierto(`★ «${q}»: lo que salía antes sigue saliendo`, viejos.every((id) => nuevos.includes(id)), `${viejos} vs ${nuevos}`);
}
check('sin tilde encuentra la que la tiene', ids(filtrarProductos(productos, 'rapido')), [4]);
check('espacios repetidos no estorban', ids(filtrarProductos(productos, 'estuche silicona')), [6]);
cierto('un producto sin código no revienta', coincideProducto({ nombre: 'X' }, 'abc') === false);

console.log('\n2. Por código');
check('★ código de una VARIANTE encuentra su producto', ids(filtrarProductos(productos, 'ACC-360-40M-002')), [1]);
check('código del producto', ids(filtrarProductos(productos, 'VID-CON-001')), [3]);
check('en minúsculas', ids(filtrarProductos(productos, 'acc-360-38m-009')), [2]);
check('un pedazo del código trae todos los que lo comparten', ids(filtrarProductos(productos, 'ACC-360')), [1, 2]);
check('código numérico', ids(filtrarProductos(productos, '000121')), [4]);
check('con espacios alrededor (el lector a veces los manda)', ids(filtrarProductos(productos, '  VID-CON-001 ')), [3]);

console.log('\n3. Enter');
check('★ código exacto de variante → su producto y CUÁL variante',
  productoPorCodigo(productos, 'ACC-360-40M-002'), { producto: productos[0], codigoVariante: 'acc-360-40m-002' });
check('★ código del producto → sin variante', productoPorCodigo(productos, 'vid-con-001')?.codigoVariante, null);
check('producto con código propio Y variantes: el suyo no se toma por variante',
  productoPorCodigo(productos, 'ACC-COR-TAL-023')?.codigoVariante, null);
check('…y el de su talla sí', productoPorCodigo(productos, 'ACC-COR-TAL-044')?.codigoVariante, 'acc-cor-tal-044');
check('★ un pedazo NO es código exacto', productoPorCodigo(productos, 'ACC-360'), null);
check('★ el mismo código en dos productos: no adivina',
  productoPorCodigo([...productos, { id: 9, nombre: 'Otro', codigo: '000121' }], '000121'), null);
check('Enter con código exacto',
  elegirConEnter(productos, [], 'ACC-360-38M-009', {})?.producto.id, 2);
check('★ Enter gana el código aunque un filtro de línea lo esconda',
  elegirConEnter(productos, [productos[0]], 'VID-CON-001', {})?.producto.id, 3);
check('Enter sin código exacto y UNA coincidencia: esa', elegirConEnter(productos, filtrarProductos(productos, 'play'), 'play', {})?.producto.id, 3);
check('★ Enter con varias coincidencias: nada', elegirConEnter(productos, filtrarProductos(productos, '360'), '360', {}), null);
check('Enter sin texto: nada', elegirConEnter(productos, [productos[0]], '  ', {}), null);

console.log('\n4. La corrección del guion del lector (opt-in)');
const leido = "ACC'360'40M'002";
check('★ apagada (por defecto): el código mal leído no encuentra nada', ids(filtrarProductos(productos, leido)), []);
check('encendida: lo encuentra', ids(filtrarProductos(productos, leido, { corregir: true })), [1]);
check('encendida: Enter lo toma con su variante', productoPorCodigo(productos, leido, { corregir: true })?.codigoVariante, 'acc-360-40m-002');
check('apagada: Enter no lo toma', productoPorCodigo(productos, leido), null);

console.log('\n5. El selector de variantes, renderizado');
const arbol = [
  { id: 1, valor: '38MM', stock: 0, codigo: 'ACC-360-38M-001', variantes: [] },
  { id: 2, valor: '40MM', stock: 3, codigo: 'ACC-360-40M-002', variantes: [] },
  { id: 3, valor: '41MM', stock: 1, codigo: 'ACC-360-41M-003', variantes: [] },
];
const hojas = hojasDelArbol(arbol);
check('hojaPorCodigo encuentra sin mayúsculas', hojaPorCodigo(hojas, 'acc-360-40m-002')?.key, 'a-2');
check('hojaPorCodigo sin código: null', [hojaPorCodigo(hojas, null), hojaPorCodigo(hojas, ''), hojaPorCodigo(hojas, 'NO-EXISTE')], [null, null, null]);

const RAIZ_FRONT = path.resolve(AQUI, '..');
const TMP = path.join(RAIZ_FRONT, 'node_modules', '.prueba-buscar-por-codigo');
let MultiSelector = null, render = null, React = null;
try {
  const vite  = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  mkdirSync(TMP, { recursive: true });
  const entrada = path.join(TMP, 'entrada.js');
  writeFileSync(entrada, `export { MultiSelectorCompra } from '../../src/pages/proveedores/capturaMercancia.jsx';\n`);
  await vite.build({
    configFile: false, root: RAIZ_FRONT, logLevel: 'silent', plugins: [react()],
    build: {
      ssr: entrada, outDir: path.join(TMP, 'salida'), emptyOutDir: true, minify: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'piezas.mjs' } },
    },
  });
  ({ MultiSelectorCompra: MultiSelector } = await import(pathToFileURL(path.join(TMP, 'salida', 'piezas.mjs')).href));
  React  = (await import('react')).default;
  render = (await import('react-dom/server')).renderToStaticMarkup;
} catch (e) {
  cierto('se pudo compilar y cargar el selector', false, e.message);
}
if (render) {
  const pintar = (props) => render(React.createElement(MultiSelector, { hojas, nodosData: {}, onActualizar() {}, ...props }));
  const filas = (html) => (html.match(/en stock/g) || []).length;
  const antes = pintar({});
  check('★ sin código escaneado: idéntico a no pasar nada', pintar({ codigoInicial: null }), antes);
  check('…ninguna variante elegida', filas(antes), 0);
  const escaneado = pintar({ codigoInicial: 'acc-360-40m-002' });
  check('★ con el código de la 40MM: esa variante llega elegida', filas(escaneado), 1);
  cierto('…y es la 40MM', /40MM<\/p><p[^>]*>3 en stock/.test(escaneado));
  check('un código que no es de este producto: nada elegido', filas(pintar({ codigoInicial: 'VID-CON-001' })), 0);
  const conCantidad = pintar({ codigoInicial: 'acc-360-40m-002', nodosData: { 'a-1': { cantidad: '2', costo: '' } } });
  check('lo que ya tenía cantidad sigue elegido además de la escaneada', filas(conCantidad), 2);
}

console.log('\n6. Las pantallas usan la misma regla');
const sitios = [
  ['compra a proveedor', 'pages/proveedores/ModalCompra.jsx', ['filtrarProductos(', 'onEnter={handleEnterBusqueda}', 'codigoInicial={productoSel._escaneo?.codigo}']],
  ['pedido a proveedor', 'pages/proveedores/ModalOrden.jsx', ['filtrarProductos(', 'onEnter={elegirConEnterBusqueda}', 'useBuscadorVariantes(hojas, codigoInicial)']],
  ['entrada de bodega', 'pages/entradas/VistaEntrada.jsx', ['filtrarProductos(', 'onEnter={agregarConEnter}', 'codigos_variantes: p.codigos_variantes', 'codigoInicial={linea._escaneo?.codigo}']],
  ['inventario: agregar stock', 'pages/inventario/ModalAgregarProducto.jsx', ['codigoInicial={codigoEscaneado}', 'codigo:     v.codigo ?? null']],
  ['inventario: compra a cliente', 'pages/inventario/ModalAgregarProducto.jsx', ['onEnter={elegirCantidadConEnter}']],
  ['inventario: retoma', 'pages/inventario/ModalAgregarProducto.jsx', ['filtrarProductos(productosCantidad, busquedaCantidad']],
];
for (const [nombre, archivo, marcas] of sitios) {
  const txt = leer(archivo);
  const falta = marcas.filter((m) => !txt.includes(m));
  cierto(nombre, falta.length === 0, `falta ${falta.join(', ')} en ${archivo}`);
}
// Los buscadores de referencias con IMEI no cambian: ese catálogo no tiene
// código propio (lo que se escanea de un equipo es su IMEI, que aquí se captura).
cierto('el campo de búsqueda solo intercepta Enter si se le pide', /onKeyDown=\{onEnter \?/.test(leer('components/ui/SearchInput.jsx')));

console.log('\n7. Los códigos REALES de la plantilla (Sitio Tecnologico)');
const plantilla = path.resolve(RAIZ_FRONT, '..', 'precios-por-lista-AMERICAS.xlsx');
if (!existsSync(plantilla)) {
  console.log('  · no está el archivo, se salta');
} else {
  const XLSX = createRequire(path.resolve(RAIZ_FRONT, '..', 'backend', 'package.json'))('xlsx');
  const filas = XLSX.utils.sheet_to_json(XLSX.readFile(plantilla).Sheets['BODEGA LAS AMERICAS'], { header: 1, defval: '' }).slice(1);
  const cat = []; const esperados = [];
  for (const f of filas) {
    const cod = String(f[5]).trim();
    if (f[4] === 'Producto') cat.push({ id: cat.length + 1, nombre: String(f[2]).trim(), codigo: cod || null, vars: [] });
    else if (f[4] === 'Variante' && cod) cat.at(-1).vars.push(cod);
    if ((f[4] === 'Producto' || f[4] === 'Variante') && cod) esperados.push([cod, cat.at(-1).id, f[4] === 'Variante']);
  }
  for (const p of cat) p.codigos_variantes = p.vars.join(' ');
  const malos = esperados.filter(([cod, id, esVar]) => {
    const r = productoPorCodigo(cat, cod);
    return !r || r.producto.id !== id || (r.codigoVariante !== null) !== esVar;
  });
  check(`★ ${esperados.length} códigos: cada uno lleva a su producto y dice si es variante`, malos.slice(0, 5), []);
  const sinFiltro = esperados.filter(([cod, id]) => !ids(filtrarProductos(cat, cod)).includes(id));
  check('…y el filtro de la lista los muestra todos', sinFiltro.length, 0);
}

console.log(`\n${fallos ? `✗ ${fallos} FALLO(S)` : '✓ TODO OK'} — ${pasados + fallos} verificaciones`);
process.exit(fallos ? 1 : 0);
