// ─────────────────────────────────────────────────────────────────────────────
// VENDER SOLO CON LISTAS — el CARRITO de verdad.
//
// Compila `src/store/carritoStore.js` con el Vite del proyecto y maneja el
// store real: lo que se prueba es lo que corre en el mostrador, no una copia.
//
// La regla (opt-in por sede): en la sede que lo encendió, un producto POR
// CANTIDAD no usa su precio predeterminado; manda la lista principal. Los
// equipos con IMEI no cambian.
//
//   1. APAGADO el carrito hace exactamente lo de siempre (incluido el respaldo
//      `precio || costo` que mandan las pantallas).
//   2. Encendido: precio de la lista principal, nunca el viejo ni el costo.
//   3. Las listas: la elegida, y la principal cuando la elegida no lo menciona.
//   4. Sin precio en ninguna lista: entra en 0 y se marca; escribirlo lo arregla.
//   5. Lo que ya estaba en el carrito se reacomoda al encender y al apagar.
//
//   node frontend/scripts/prueba-solo-listas.mjs
// La regla del backend, el guardado y las pantallas: suite 76-solo-listas.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ_FRONT = path.resolve(AQUI, '..');
const TMP = path.join(RAIZ_FRONT, 'node_modules', '.prueba-solo-listas');

let fallos = 0, pasados = 0;
const cierto = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${cond || detalle === '' ? '' : ` — ${detalle}`}`);
  cond ? pasados++ : fallos++;
};

// El store persiste en localStorage: en node se le da uno en memoria.
const memoria = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
};
globalThis.window = globalThis;   // zustand busca `window.localStorage`

let useCarrito = null, util = null;
try {
  const vite = await import('vite');
  mkdirSync(TMP, { recursive: true });
  const entrada = path.join(TMP, 'entrada.js');
  writeFileSync(entrada, `
    export { default as useCarritoStore } from '../../src/store/carritoStore.js';
    export * as util from '../../src/utils/listasPrecios.js';
  `);
  await vite.build({
    configFile: false, root: RAIZ_FRONT, logLevel: 'silent',
    build: {
      ssr: entrada, outDir: path.join(TMP, 'salida'), emptyOutDir: true, minify: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'piezas.mjs' } },
    },
  });
  ({ useCarritoStore: useCarrito, util } =
    await import(pathToFileURL(path.join(TMP, 'salida', 'piezas.mjs')).href));
} catch (e) {
  cierto('se pudo compilar y cargar el store', false, e.message);
}

if (useCarrito) {
  const S = () => useCarrito.getState();
  const item = (key) => S().items.find((i) => i.key === key);
  const reiniciar = (principal = null) => {
    S().limpiarCarrito();
    S().aplicarListaPreciosATodos(null);
    S().setSoloListas(principal);
  };
  const MAYOR = { id: 'mayor', nombre: 'Al por mayor' };
  const FINAL = { id: 'final', nombre: 'Cliente final' };

  // Lo que mandan las pantallas, tal cual: `precio` = el predeterminado o, si
  // no hay, el COSTO (`producto.precio || producto.costo_unitario || 0`).
  const cable     = () => ({ key: 'cant-1', tipo: 'cantidad', nombre: 'Cable', producto_id: 1, precio: 9000, costo: 5000, stock: 10, cantidad: 1, precios: { mayor: 12000, final: 18000 } });
  const soloMayor = () => ({ key: 'cant-2', tipo: 'cantidad', nombre: 'Vidrio', producto_id: 2, precio: 4000, costo: 2000, stock: 10, cantidad: 1, precios: { mayor: 6000 } });
  const sinListas = () => ({ key: 'cant-3', tipo: 'cantidad', nombre: 'Protector', producto_id: 3, precio: 3000 /* = el costo */, costo: 3000, stock: 10, cantidad: 1, precios: null });
  const equipo    = () => ({ key: 'IMEI-1', tipo: 'serial', nombre: 'iPhone', imei: 'IMEI-1', precio: 2450000, costo: 2000000, cantidad: 1, precios: { mayor: 2400000 } });

  console.log('\n1. APAGADO: el carrito hace lo de siempre');
  {
    reiniciar(null);
    S().agregarItem(cable()); S().agregarItem(sinListas()); S().agregarItem(equipo());
    cierto('el producto entra a su precio predeterminado', item('cant-1').precioFinal === 9000 && item('cant-1').precio === 9000);
    cierto('y el que cae al costo, también (no es asunto de esta función)', item('cant-3').precioFinal === 3000);
    cierto('no queda ninguna marca en el ítem', !('solo_listas' in item('cant-1')) && !('precio_normal' in item('cant-1')));
    S().aplicarListaPreciosATodos(MAYOR);
    cierto('una lista lo reprecifica', item('cant-1').precioFinal === 12000 && item('IMEI-1').precioFinal === 2400000);
    cierto('lo que no está en la lista va a su precio normal y se marca',
      item('cant-3').precioFinal === 3000 && item('cant-3').sin_precio_en_lista === true);
    S().aplicarListaPreciosATodos(null);
    cierto('quitarla devuelve el predeterminado', item('cant-1').precioFinal === 9000 && item('IMEI-1').precioFinal === 2450000);
    cierto('nada está «sin precio»', S().items.every((i) => !util.sinPrecioSoloListas(i)));
    cierto('volcar null otra vez no reescribe los ítems (misma referencia)', (() => {
      const antes = S().items; S().setSoloListas(null); return S().items === antes;
    })());
  }

  console.log('\n2. ENCENDIDO: manda la lista principal');
  {
    reiniciar('final');
    S().agregarItem(cable());
    cierto('entra a 18.000 (Cliente final), no a los 9.000 de antes', item('cant-1').precioFinal === 18000);
    cierto('su precio base es el de la principal, y el viejo queda guardado aparte',
      item('cant-1').precio === 18000 && item('cant-1').precio_normal === 9000 && item('cant-1').solo_listas === true);
    S().agregarOIncrementar(soloMayor());
    cierto('el escáner entra por la misma regla: sin «final» queda en 0', item('cant-2').precioFinal === 0 && item('cant-2').precio === 0);
    S().forzarAgregar(sinListas());
    cierto('NUNCA el costo: el que mandaba `precio || costo` entra en 0', item('cant-3').precioFinal === 0);
    S().agregarItem(equipo());
    cierto('el equipo con IMEI no cambia: su precio normal', item('IMEI-1').precioFinal === 2450000 && !item('IMEI-1').solo_listas);
    cierto('ningún ítem lleva el costo como precio', S().items.every((i) => i.tipo === 'serial' || i.precioFinal !== i.costo));
  }

  console.log('\n3. Las listas: la elegida, y la principal cuando no lo menciona');
  {
    S().aplicarListaPreciosATodos(MAYOR);
    cierto('Cable a 12.000 (mayor)', item('cant-1').precioFinal === 12000 && item('cant-1').sin_precio_en_lista === false);
    cierto('Vidrio a 6.000 (solo tiene mayor)', item('cant-2').precioFinal === 6000);
    cierto('el equipo a su precio de lista', item('IMEI-1').precioFinal === 2400000);
    S().aplicarListaPreciosATodos(null);
    cierto('quitar la lista NO vuelve al predeterminado: vuelve a la principal', item('cant-1').precioFinal === 18000);
    cierto('y el equipo sí vuelve a su precio normal', item('IMEI-1').precioFinal === 2450000);

    reiniciar('mayor');
    S().agregarItem(cable()); S().agregarItem(soloMayor());
    S().aplicarListaPreciosATodos(FINAL);
    cierto('Vidrio no está en «final»: cae a la principal (6.000) y se marca',
      item('cant-2').precioFinal === 6000 && item('cant-2').sin_precio_en_lista === true && !util.sinPrecioSoloListas(item('cant-2')));
    S().aplicarListaPrecio('cant-1', MAYOR);
    cierto('una sola línea puede ir por otra lista', item('cant-1').precioFinal === 12000 && item('cant-2').precioFinal === 6000);
    cierto('la lista elegida es pegajosa: lo nuevo entra con ella',
      (S().agregarItem({ ...cable(), key: 'cant-9' }), item('cant-9').precioFinal === 18000));
  }

  console.log('\n4. Sin precio en ninguna lista');
  {
    reiniciar('final');
    S().agregarItem(sinListas()); S().agregarItem(soloMayor());
    cierto('los dos quedan «sin precio»', S().items.filter(util.sinPrecioSoloListas).length === 2);
    S().actualizarPrecio('cant-3', 7000);
    cierto('escribir el precio lo arregla', !util.sinPrecioSoloListas(item('cant-3')) && item('cant-3').precioFinal === 7000);
    S().actualizarPrecio('cant-2', 0);
    cierto('un 0 escrito a mano es una decisión (regalar), no un olvido', !util.sinPrecioSoloListas(item('cant-2')));
    S().aplicarListaPreciosATodos(MAYOR);
    cierto('elegir una lista que sí lo tiene le pone precio', item('cant-2').precioFinal === 6000);
    cierto('y al que no está en ninguna lo devuelve a «sin precio» (no al costo)',
      item('cant-3').precioFinal === 0 && util.sinPrecioSoloListas(item('cant-3')));

    reiniciar('final');
    S().agregarItem(cable());
    S().marcarObsequio('cant-1', true);
    cierto('un obsequio vale 0 y no es «sin precio»', item('cant-1').precioFinal === 0 && !util.sinPrecioSoloListas(item('cant-1')));
    S().marcarObsequio('cant-1', false);
    cierto('dejar de regalarlo lo devuelve a la lista principal, no al precio viejo', item('cant-1').precioFinal === 18000);
    cierto('el total suma lo que se cobra', S().totalCarrito() === 18000);
  }

  console.log('\n5. Lo que ya estaba en el carrito');
  {
    reiniciar(null);
    S().agregarItem(cable()); S().agregarItem(sinListas()); S().agregarItem(equipo());
    S().agregarItem({ ...soloMayor(), key: 'cant-m' }); S().actualizarPrecio('cant-m', 5500);
    // Un borrador cargado no trae el mapa de precios.
    S().cargarDesdeBorrador([...S().items, { key: 'cant-b', tipo: 'cantidad', nombre: 'Del borrador', precio: 8000, precioFinal: 7500, cantidad: 1, origen_precio: 'lista' }], 1);
    S().setSoloListas('final');
    cierto('al encender, el Cable pasa a la lista principal', item('cant-1').precioFinal === 18000);
    cierto('el que no tiene listas queda sin precio', util.sinPrecioSoloListas(item('cant-3')));
    cierto('lo escrito a mano se respeta', item('cant-m').precioFinal === 5500 && item('cant-m').precio === 0);
    cierto('el ítem del borrador (sin mapa de precios) NO se toca', item('cant-b').precioFinal === 7500 && item('cant-b').precio === 8000);
    cierto('el equipo tampoco', item('IMEI-1').precioFinal === 2450000);
    const foto = S().items;
    S().setSoloListas('final');
    cierto('volcar la misma regla no reescribe nada', S().items === foto);
    S().setSoloListas('mayor');
    cierto('cambiar la lista principal reacomoda', item('cant-1').precioFinal === 12000 && item('cant-1').precio_normal === 9000);
    S().setSoloListas(null);
    cierto('al apagar, vuelve el precio predeterminado', item('cant-1').precioFinal === 9000 && item('cant-1').precio === 9000);
    cierto('y se van las marcas', !('solo_listas' in item('cant-1')) && !('precio_normal' in item('cant-1')));
    cierto('el que caía al costo vuelve a como entraba', item('cant-3').precioFinal === 3000);

    const guardado = JSON.parse(memoria.get('carrito-inventario') || '{}').state || {};
    cierto('la regla no se guarda en el navegador', !('soloListas' in guardado) && Array.isArray(guardado.items));
  }
}

try { rmSync(TMP, { recursive: true, force: true }); } catch { /* da igual */ }
console.log(`\n${pasados} verificaciones OK, ${fallos} fallidas`);
process.exit(fallos ? 1 : 0);
