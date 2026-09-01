// ─────────────────────────────────────────────────────────────────────────────
// Geometría del mapa de ubicaciones — disposición automática y rejilla.
//
// Es lógica pura y por eso se prueba en node, sin navegador ni React. Lo que
// protege son dos cosas que NO se ven mal leyendo el código y sí se ven mal en
// pantalla, cuando ya hay un negocio usándolo:
//
//   1. Que las cajas acomodadas solas NO SE ENCIMEN — ni entre ellas ni sobre
//      las que alguien ya colocó a mano. Un mapa con dos estantes superpuestos
//      no se arregla solo: hay que volver a acomodarlo todo.
//   2. Que una ubicación recién creada APAREZCA. Sin geometría no se dibuja, y
//      si no se dibuja, para el usuario no existe. Que el mapa sea opcional es
//      lo que permite empezar hoy y dibujarlo el mes que viene.
//
//   node scripts/prueba-mapa-ubicaciones.mjs
// ─────────────────────────────────────────────────────────────────────────────
import {
  MUNDO, REJILLA, disponerEnLienzo, aRejilla,
  encuadreDe, camaraHacia, aplicarCamara, transformCamara,
  ordenRecorrido, agruparPorRuta, nodoDeItemCarrito,
} from '../src/utils/ubicaciones.js';

let fallos = 0, pasados = 0;
const check = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✅ ${etiqueta}`); }
  else {
    fallos++;
    console.log(`  ❌ ${etiqueta}\n       esperado: ${JSON.stringify(esperado)}\n       real:     ${JSON.stringify(real)}`);
  }
};
const checkTrue = (etiqueta, valor) => check(etiqueta, !!valor, true);
const seccion = (n, t) => console.log(`\n── ${n}. ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);

// Dos rectángulos se solapan si se cruzan en los dos ejes a la vez.
const seSolapan = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const solapes = (cajas) => {
  const pares = [];
  for (let i = 0; i < cajas.length; i += 1) {
    for (let j = i + 1; j < cajas.length; j += 1) {
      if (seSolapan(cajas[i], cajas[j])) pares.push([cajas[i].nombre, cajas[j].nombre]);
    }
  }
  return pares;
};

const nodo = (id, extra = {}) => ({
  id, nombre: `U${id}`, hijas: [], items_total: 0,
  pos_x: null, pos_y: null, ancho: null, alto: null, ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
seccion(1, 'Sin geometría, el mapa se dibuja solo');
// ─────────────────────────────────────────────────────────────────────────────
for (const n of [1, 2, 3, 5, 7, 12, 20]) {
  const cajas = disponerEnLienzo(Array.from({ length: n }, (_, i) => nodo(i + 1)));
  check(`${n} ubicaciones nuevas ⇒ ${n} cajas dibujadas`, cajas.length, n);
  checkTrue(`  y ninguna encimada (${n})`, solapes(cajas).length === 0);
  checkTrue(`  todas con tamaño real (${n})`, cajas.every((c) => c.w > 0 && c.h > 0));
  checkTrue(`  y marcadas como automáticas (${n})`, cajas.every((c) => c.auto === true));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion(2, 'Lo que alguien colocó a mano no se toca');
// ─────────────────────────────────────────────────────────────────────────────
const colocada = nodo(1, { pos_x: 100, pos_y: 100, ancho: 400, alto: 300 });
const mixto = disponerEnLienzo([colocada, nodo(2), nodo(3), nodo(4)]);
const suya = mixto.find((c) => c.id === 1);

check('Respeta su posición exacta', [suya.x, suya.y, suya.w, suya.h], [100, 100, 400, 300]);
check('Y no la marca como automática', suya.auto, false);
check('Las nuevas sí', mixto.filter((c) => c.id !== 1).every((c) => c.auto), true);
check('Nadie se encima con ella', solapes(mixto), []);

// El caso que de verdad importa: una caja a mano ocupando media pantalla.
const grandota = nodo(1, { pos_x: 0, pos_y: 0, ancho: 1000, alto: 500 });
const conGrandota = disponerEnLienzo([grandota, nodo(2), nodo(3), nodo(4), nodo(5)]);
check('Ni con una caja que ocupa media sede', solapes(conGrandota), []);
checkTrue('Y las automáticas bajan por debajo de ella',
  conGrandota.filter((c) => c.auto).every((c) => c.y >= 500));

// ─────────────────────────────────────────────────────────────────────────────
seccion(3, 'Las cajas caben en el lienzo');
// ─────────────────────────────────────────────────────────────────────────────
const nueve = disponerEnLienzo(Array.from({ length: 9 }, (_, i) => nodo(i + 1)));
checkTrue('Ninguna se sale por la izquierda o por arriba',
  nueve.every((c) => c.x >= 0 && c.y >= 0));
checkTrue('Ninguna se sale por la derecha',
  nueve.every((c) => c.x + c.w <= MUNDO));
// Hacia ABAJO sí puede crecer: un mapa largo se hace scroll, uno con cajas
// encimadas no se arregla solo.
checkTrue('Con 9 caben todas en el alto del lienzo',
  nueve.every((c) => c.y + c.h <= MUNDO));

// ─────────────────────────────────────────────────────────────────────────────
seccion(4, 'La rejilla del editor');
// ─────────────────────────────────────────────────────────────────────────────
check('Redondea al múltiplo más cercano', aRejilla(37), 25);
check('Hacia arriba también',            aRejilla(38), 50);
check('Ya alineado se queda igual',      aRejilla(100), 100);
check('No deja salirse por abajo',       aRejilla(-40), 0);
check('Ni por arriba',                   aRejilla(2000), MUNDO);
check('Respeta un mínimo propio',        aRejilla(10, REJILLA * 2), REJILLA * 2);
checkTrue('Siempre cae en la rejilla',
  [0, 13, 61, 499, 987].every((v) => aRejilla(v) % REJILLA === 0));

// ─────────────────────────────────────────────────────────────────────────────
seccion(5, 'Casos de borde que no pueden reventar la pantalla');
// ─────────────────────────────────────────────────────────────────────────────
check('Sin ubicaciones, lienzo vacío', disponerEnLienzo([]), []);
check('Sin argumento tampoco falla',   disponerEnLienzo(), []);

// Geometría a medias (un guardado interrumpido): se trata como no dibujada en
// vez de generar un rectángulo con NaN, que desaparece del SVG sin decir nada.
const aMedias = disponerEnLienzo([nodo(1, { pos_x: 10, pos_y: 10 })]);
check('Geometría incompleta se acomoda sola', aMedias[0].auto, true);
checkTrue('Y sin NaN en ninguna coordenada',
  [aMedias[0].x, aMedias[0].y, aMedias[0].w, aMedias[0].h].every(Number.isFinite));

// Los NUMERIC de Postgres llegan como STRING: si no se castean, `x + w` se
// concatena en vez de sumar y la caja aparece en cualquier parte.
const comoLlegaDeLaBD = disponerEnLienzo([
  nodo(1, { pos_x: '100.00', pos_y: '50.00', ancho: '300.00', alto: '200.00' }),
]);
check('Los NUMERIC en string se castean a número',
  [comoLlegaDeLaBD[0].x, comoLlegaDeLaBD[0].y, comoLlegaDeLaBD[0].w, comoLlegaDeLaBD[0].h],
  [100, 50, 300, 200]);
checkTrue('Y suman en vez de concatenarse',
  comoLlegaDeLaBD[0].x + comoLlegaDeLaBD[0].w === 400);

// ─────────────────────────────────────────────────────────────────────────────
seccion(6, 'El encuadre: al contenido mirando, entero editando');
// ─────────────────────────────────────────────────────────────────────────────
const enUnaEsquina = [
  { x: 100, y: 100, w: 200, h: 150 },
  { x: 350, y: 100, w: 200, h: 150 },
];

const mirando = encuadreDe(enUnaEsquina, false);
checkTrue('Mirando, el encuadre abraza el contenido',
  mirando.w < MUNDO && mirando.h < MUNDO);
checkTrue('Con margen alrededor (nada pegado al borde)',
  mirando.x < 100 && mirando.y < 100
  && mirando.x + mirando.w > 550 && mirando.y + mirando.h > 250);

check('Editando se ve el lienzo entero', encuadreDe(enUnaEsquina, true),
  { x: 0, y: 0, w: MUNDO, h: MUNDO });
check('Sin nada dibujado, también', encuadreDe([], false),
  { x: 0, y: 0, w: MUNDO, h: MUNDO });

// ─────────────────────────────────────────────────────────────────────────────
seccion(7, 'La cámara aterriza donde debe');
// ─────────────────────────────────────────────────────────────────────────────
const casi = (a, b, tol = 0.001) => Math.abs(a - b) < tol;

// Se prueba contra encuadres distintos —el del lienzo entero y uno ya ajustado
// al contenido— porque la cámara se dispara desde los dos.
for (const [nombre, vista] of [
  ['lienzo entero', { x: 0, y: 0, w: MUNDO, h: MUNDO }],
  ['encuadre ajustado', { x: 60, y: 60, w: 530, h: 230 }],
]) {
  for (const [forma, rect] of [
    ['cuadrada',  { x: 100, y: 100, w: 200, h: 200 }],
    ['ancha',     { x: 50,  y: 400, w: 600, h: 120 }],
    ['alta',      { x: 700, y: 20,  w: 120, h: 600 }],
  ]) {
    const cam = camaraHacia(rect, vista);
    const centro = aplicarCamara(cam, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    const vcx = vista.x + vista.w / 2;
    const vcy = vista.y + vista.h / 2;

    checkTrue(`[${nombre}] la caja ${forma} queda centrada`,
      casi(centro.x, vcx) && casi(centro.y, vcy));

    // Y entra COMPLETA: si se escalara por el lado menor, una caja alargada se
    // saldría por los lados justo al terminar la animación.
    const a = aplicarCamara(cam, { x: rect.x, y: rect.y });
    const b = aplicarCamara(cam, { x: rect.x + rect.w, y: rect.y + rect.h });
    checkTrue(`[${nombre}] la caja ${forma} entra completa`,
      a.x >= vista.x - 0.001 && a.y >= vista.y - 0.001
      && b.x <= vista.x + vista.w + 0.001 && b.y <= vista.y + vista.h + 0.001);

    // Y llena la vista por su lado limitante: si no, el zoom se queda corto y
    // la transición no llega a sentirse como entrar.
    const llenaAncho = casi(b.x - a.x, vista.w);
    const llenaAlto  = casi(b.y - a.y, vista.h);
    checkTrue(`[${nombre}] la caja ${forma} llena la vista`, llenaAncho || llenaAlto);
  }
}

// La cámara se aplica como `transform` de CSS: en SVG los `px` son unidades del
// lienzo, así que el texto tiene que salir con ellos y sin notación científica.
const cadena = transformCamara(camaraHacia({ x: 0, y: 0, w: 250, h: 250 },
  { x: 0, y: 0, w: MUNDO, h: MUNDO }));
checkTrue('El transform sale como cadena CSS válida',
  /^translate\(500px, 500px\) scale\(4\) translate\(-125px, -125px\)$/.test(cadena));
checkTrue('Y sin NaN', !/NaN/.test(cadena));

// ─────────────────────────────────────────────────────────────────────────────
seccion(8, 'Ruta de recogida: el orden del recorrido');
// Una lista en el orden en que se escribio obliga a cruzar la bodega una vez por
// producto. Lo que se prueba aqui es que el recorrido sea el de una persona
// caminando: se termina una bodega antes de pasar a la siguiente.

const ubi = (id, nombre, hijas = [], geo = {}) => ({
  id, nombre, hijas,
  pos_x: geo.x ?? null, pos_y: geo.y ?? null,
  ancho: geo.w ?? null, alto: geo.h ?? null,
});

const arbolSinDibujar = [
  ubi(1, 'Bodega A', [ubi(11, 'Estante 1'), ubi(12, 'Estante 2')]),
  ubi(2, 'Bodega B', [ubi(21, 'Estante 1')]),
];

check('Se recorre en profundidad: se termina una bodega antes de la siguiente',
  ordenRecorrido(arbolSinDibujar), [1, 11, 12, 2, 21]);
check('Sin ubicaciones, recorrido vacio', ordenRecorrido([]), []);
check('Sin argumento tampoco falla', ordenRecorrido(), []);

// Con el mapa dibujado manda la geometria: arriba-abajo, izquierda-derecha.
const arbolDibujado = [
  ubi(1, 'Derecha', [], { x: 600, y: 100, w: 200, h: 100 }),
  ubi(2, 'Abajo',   [], { x: 100, y: 700, w: 200, h: 100 }),
  ubi(3, 'Arriba',  [], { x: 100, y: 100, w: 200, h: 100 }),
];
check('Dibujado, se camina de arriba abajo y de izquierda a derecha',
  ordenRecorrido(arbolDibujado), [3, 1, 2]);

// Con la mitad dibujada, ordenar por posicion seria un zigzag sin sentido: se
// respeta el orden del arbol, que el admin controla y que al menos es estable.
const arbolMixto = [
  ubi(1, 'Dibujada', [], { x: 600, y: 700, w: 100, h: 100 }),
  ubi(2, 'Sin dibujar'),
];
check('Con la mitad dibujada se respeta el orden del arbol',
  ordenRecorrido(arbolMixto), [1, 2]);

seccion(9, 'Ruta de recogida: las paradas');
const lineas = [
  { key: 'a', nombre: 'Correa',  ubicacion_id: 21 },
  { key: 'b', nombre: 'Estuche', ubicacion_id: 11 },
  { key: 'c', nombre: 'Cable',   ubicacion_id: null },
  { key: 'd', nombre: 'Vidrio',  ubicacion_id: 11 },
];
const paradas = agruparPorRuta(lineas, arbolSinDibujar);

check('Las paradas salen en orden de recorrido',
  paradas.map((p) => p.ubicacion_id), [11, 21, null]);
check('Lo que comparte estante va junto en una sola parada',
  paradas[0].items.map((i) => i.key), ['b', 'd']);
check('Cada parada trae su ruta completa para leerla de un vistazo',
  paradas[0].ruta, ['Bodega A', 'Estante 1']);
check('Lo que no tiene sitio va al FINAL, en su propia parada',
  paradas[2].items.map((i) => i.key), ['c']);

// Una ubicacion dada de baja entre que se armo el carrito y se pidio la ruta no
// puede llevarse sus productos por delante.
const huerfana = agruparPorRuta(
  [{ key: 'x', ubicacion_id: 999 }, { key: 'y', ubicacion_id: 11 }],
  arbolSinDibujar);
check('Una ubicacion que ya no esta en el arbol no desaparece',
  huerfana.map((p) => p.ubicacion_id), [11, 999]);
check('Y se muestra sin ruta en vez de romper', huerfana[1].ruta, []);

check('Una lista vacia no produce paradas', agruparPorRuta([], arbolSinDibujar), []);
check('Ni sin argumentos', agruparPorRuta(), []);

seccion(10, 'Del carrito al nodo del arbol');
// El carrito lo llenan nueve pantallas y ninguna sabe de ubicaciones. Esta
// traduccion es el contrato entre los dos mundos, y baja SIEMPRE al nodo mas
// especifico que traiga la linea.
check('Una variante lleva al cajon de esa talla, no al del producto',
  nodoDeItemCarrito({ tipo: 'cantidad', producto_id: 5, atributo_id: 7, variante_id: 9 }),
  { nivel: 'variante', id: 9 });
check('Sin variante, al atributo',
  nodoDeItemCarrito({ tipo: 'cantidad', producto_id: 5, atributo_id: 7 }),
  { nivel: 'atributo', id: 7 });
check('Sin atributo, al producto',
  nodoDeItemCarrito({ tipo: 'cantidad', producto_id: 5 }),
  { nivel: 'producto', id: 5 });
check('Un serial lleva a su unidad concreta',
  nodoDeItemCarrito({ tipo: 'serial', serial_id: 42, imei: '111' }),
  { nivel: 'unidad', id: 42 });

// Los items guardados en localStorage antes de esta feature no traen ids: no
// pueden reventar la ruta, solo quedarse fuera.
check('Un item viejo sin ids no rompe nada',
  nodoDeItemCarrito({ tipo: 'cantidad', nombre: 'De otra epoca' }), null);
check('Ni un serial sin serial_id',
  nodoDeItemCarrito({ tipo: 'serial', imei: '111' }), null);
check('Ni un item nulo', nodoDeItemCarrito(null), null);

console.log(`\n${'═'.repeat(64)}`);
console.log(`  ${pasados} verificaciones pasaron, ${fallos} fallaron`);
console.log(`${'═'.repeat(64)}\n`);
process.exit(fallos ? 1 : 0);
