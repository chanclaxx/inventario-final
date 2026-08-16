// ─────────────────────────────────────────────────────────────────────────────
// REGLA DE DISPONIBILIDAD DEL BLOQUEO BLANDO
//
// Es la decisión central de la feature: si se equivoca, o frena ventas que
// debería dejar pasar, o avisa tanto que el vendedor aprende a descartar el
// aviso sin leerlo — y en los dos casos la feature deja de servir.
//
// Verifica:
//   • serial   → binario (un IMEI está o no está apartado)
//   • cantidad → contra el stock LIBRE, no contra la mera presencia
//   • el escáner no cuela la última unidad libre sumando de a una
//   • el borrador ya cargado en el carrito no choca consigo mismo
//   • varios borradores sobre el mismo producto suman, y se ordenan por edad
//   • sin stock conocido no se bloquea
//
// Correr:  node scripts/pruebas-reservas.mjs
// ─────────────────────────────────────────────────────────────────────────────
import {
  construirIndiceReservas, choca, unidadesLibres,
} from '../src/utils/reservas.js';

let fallos = 0, pasados = 0;
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

const BORRADORES = [
  {
    id: 1, titulo: 'Juan Pérez', usuario_nombre: 'Carlos',
    creado_en: '2026-08-15T09:00:00Z',
    items: [
      { id: 10, item_key: '350000000000001', tipo: 'serial',   cantidad: 1 },
      { id: 11, item_key: 'cant-1',          tipo: 'cantidad', cantidad: 2 },
      { id: 12, item_key: 'cant-2',          tipo: 'cantidad', cantidad: 3 },
    ],
  },
  {
    id: 2, titulo: 'Sra. del Ford', usuario_nombre: 'Ana',
    creado_en: '2026-08-15T08:00:00Z',   // más ANTIGUO que el 1
    items: [
      { id: 20, item_key: 'cant-2', tipo: 'cantidad', cantidad: 1 },
    ],
  },
];

const SERIAL = { key: '350000000000001', tipo: 'serial', nombre: 'iPhone' };
const FORRO  = { key: 'cant-1', tipo: 'cantidad', nombre: 'Forro',  stock: 200 };
const VIDRIO = { key: 'cant-2', tipo: 'cantidad', nombre: 'Vidrio', stock: 5 };

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Construcción del índice ═══');
// ═══════════════════════════════════════════════════════════════════════════
const idx = construirIndiceReservas(BORRADORES);

ok('indexa el serial por su IMEI', !!idx['350000000000001']);
ok('el serial suma 1', idx['350000000000001'].total === 1);
ok('suma las cantidades del mismo producto en varios borradores',
  idx['cant-2'].total === 4, `total=${idx['cant-2'].total}`);
ok('registra en cuántos borradores está', idx['cant-2'].entradas.length === 2);
ok('ordena las entradas por edad, el más antiguo primero',
  idx['cant-2'].entradas[0].borrador_id === 2,
  `primero=${idx['cant-2'].entradas[0].titulo}`);
ok('conserva el item_id para poder liberarlo',
  idx['cant-2'].entradas[0].item_id === 20);
ok('conserva quién lo apartó',
  idx['cant-2'].entradas[0].usuario_nombre === 'Ana');
ok('un producto sin borradores no aparece', idx['cant-99'] === undefined);
ok('lista vacía da índice vacío',
  Object.keys(construirIndiceReservas([])).length === 0);
ok('no revienta con borradores sin items',
  Object.keys(construirIndiceReservas([{ id: 9, items: null }])).length === 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. Serial: bloqueo BINARIO ═══');
// ═══════════════════════════════════════════════════════════════════════════
ok('un serial apartado siempre choca', choca(SERIAL, idx[SERIAL.key], 1) === true);
ok('un serial NO apartado no choca',
  choca({ ...SERIAL, key: '350000000000009' }, idx['350000000000009'], 1) === false);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. Cantidad: contra el stock LIBRE ═══');
// ═══════════════════════════════════════════════════════════════════════════
// 200 forros, 2 apartados: el aviso aquí sería ruido puro.
ok('200 en stock y 2 apartados → NO avisa',
  choca(FORRO, idx['cant-1'], 1) === false);
ok('ni siquiera pidiendo 100 de 198 libres',
  choca(FORRO, idx['cant-1'], 100) === false);
ok('pero pedir 199 de 198 libres SÍ choca',
  choca(FORRO, idx['cant-1'], 199) === true);
ok('pedir exactamente las 198 libres no choca',
  choca(FORRO, idx['cant-1'], 198) === false);

// 5 vidrios, 4 apartados: solo 1 libre. Aquí el aviso sí vale.
ok('5 en stock y 4 apartados → pedir 1 pasa',
  choca(VIDRIO, idx['cant-2'], 1) === false);
ok('pedir 2 de 1 libre choca',
  choca(VIDRIO, idx['cant-2'], 2) === true);

// Todo apartado.
const agotado = { ...VIDRIO, stock: 4 };
ok('con todo el stock apartado, hasta pedir 1 choca',
  choca(agotado, idx['cant-2'], 1) === true);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. El escáner no cuela la última unidad ═══');
// ═══════════════════════════════════════════════════════════════════════════
// 5 en stock, 4 apartados, 1 libre. El escáner suma de a una: si `pedida` fuera
// siempre 1, se podrían meter las 5 escaneando cinco veces.
ok('escanear la 1ª unidad pasa (0 en carrito + 1)',
  choca(VIDRIO, idx['cant-2'], 0 + 1) === false);
ok('escanear la 2ª unidad choca (1 en carrito + 1)',
  choca(VIDRIO, idx['cant-2'], 1 + 1) === true);
ok('escanear la 3ª también',
  choca(VIDRIO, idx['cant-2'], 2 + 1) === true);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. El borrador cargado no choca consigo mismo ═══');
// ═══════════════════════════════════════════════════════════════════════════
// El vendedor abrió el borrador 1: lo que ESE borrador aparta ya está en su
// carrito. Contarlo otra vez lo obligaría a pedirse permiso a sí mismo.
const idxSin1 = construirIndiceReservas(BORRADORES, 1);

ok('el serial del borrador cargado deja de estar apartado',
  idxSin1['350000000000001'] === undefined);
ok('sus unidades por cantidad salen del total',
  idxSin1['cant-2'].total === 1, `total=${idxSin1['cant-2'].total}`);
ok('un producto que solo estaba en el cargado desaparece',
  idxSin1['cant-1'] === undefined);
ok('lo apartado por OTROS borradores sigue contando',
  idxSin1['cant-2'].entradas.length === 1
  && idxSin1['cant-2'].entradas[0].borrador_id === 2);
ok('y con eso, agregar el serial ya no pide permiso',
  choca(SERIAL, idxSin1[SERIAL.key], 1) === false);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 6. Casos límite: nunca frenar por falta de datos ═══');
// ═══════════════════════════════════════════════════════════════════════════
ok('sin reserva no choca',            choca(FORRO, undefined, 1) === false);
ok('reserva vacía no choca',          choca(FORRO, { total: 0, entradas: [] }, 1) === false);
ok('sin stock conocido no bloquea',
  choca({ ...FORRO, stock: undefined }, idx['cant-1'], 999) === false);
ok('stock no numérico no bloquea',
  choca({ ...FORRO, stock: 'muchos' }, idx['cant-1'], 999) === false);
ok('pero un serial sin stock SÍ bloquea (no lo necesita)',
  choca({ ...SERIAL, stock: undefined }, idx[SERIAL.key], 1) === true);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. unidadesLibres (lo que ve el vendedor en la lista) ═══');
// ═══════════════════════════════════════════════════════════════════════════
ok('200 − 2 = 198 libres',   unidadesLibres(200, idx['cant-1']) === 198);
ok('5 − 4 = 1 libre',        unidadesLibres(5, idx['cant-2']) === 1);
ok('sin reserva, todo libre', unidadesLibres(10, undefined) === 10);
ok('stock desconocido → null', unidadesLibres(undefined, idx['cant-1']) === null);
ok('puede dar negativo si se vendió lo apartado',
  unidadesLibres(2, idx['cant-2']) === -2,
  'el stock manda; la reserva es blanda y no impidió la venta');

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${pasados} pasadas, ${fallos} fallidas`);
console.log('═'.repeat(72));
process.exit(fallos ? 1 : 0);
