// ─────────────────────────────────────────────────────────────────────────────
// ENTRADAS DE BODEGA — el bodeguero recibe sin ver ni teclear precios
//
// Lo que esta prueba sostiene, en orden de importancia:
//
//   1. LA ARITMÉTICA. Recibir al último costo conocido y corregir después
//      contra la factura tiene que dar EXACTAMENTE lo mismo que habría dado la
//      compra normal al precio real. Es la identidad que hace innecesario un
//      segundo tipo de documento:
//
//          C + (R−C)·cant/(stock+cant)  ==  (stock·C + cant·R)/(stock+cant)
//
//      Si esto se rompe, el inventario queda mal valorado y la utilidad de las
//      ventas miente. La sección 1 lo corre sobre las DOS funciones reales del
//      repositorio, no sobre una copia.
//
//   2. Que recibir en CERO sea distinto —y peor—, que es la razón por la que el
//      precio provisional existe. Sin esta comparación, el próximo que lea el
//      código va a "simplificar" poniendo 0 y va a romperlo en silencio.
//
//   3. Que el bodeguero no pueda decidir plata: si manda proveedor o precios en
//      el cuerpo, se ignoran.
//
//   4. Que una Entrada nazca sin confirmar y que ninguna compra vieja aparezca
//      de golpe en la bandeja de los 28 negocios.
//
//   node scripts/pruebas-red-interna/33-entradas-bodega.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

let fallos = 0, pasados = 0;
const check = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else    { fallos++;  console.log(`  ✗ ${etiqueta} — dio ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`); }
};

// ─── 1. La identidad del costo ──────────────────────────────────────────────
//
// Se usan las funciones REALES: `calcularCostoPromedio` del util compartido y
// `_ajustarCostoPromedioDelta`, que no se exporta y se lee del fuente. Copiar
// la fórmula aquí probaría la copia, no el código que corre en producción.
const { calcularCostoPromedio } = require(path.join(RAIZ, 'src/utils/costoPromedio.util'));

const fuenteService = readFileSync(path.join(RAIZ, 'src/modules/compras/compras.service.js'), 'utf8');
const cuerpoDelta = fuenteService.match(
  /const _ajustarCostoPromedioDelta = \(([^)]*)\) => \{([\s\S]*?)\n\};/
);
if (!cuerpoDelta) {
  console.log('  ✗ no se pudo extraer _ajustarCostoPromedioDelta del service');
  process.exit(1);
}
// eslint-disable-next-line no-new-func
const ajustarDelta = new Function(cuerpoDelta[1], cuerpoDelta[2]);

console.log('\n1. ★ Recibir al último costo y corregir == comprar al precio real');
let diferencias = 0, casos = 0;
for (const stock of [1, 7, 10, 55, 300, 1200]) {
  for (const C of [100, 1500, 87450, 2399900]) {
    for (const cant of [1, 5, 40, 250]) {
      for (const R of [50, 100, 180, 99999, 3100000]) {
        casos++;
        const provisional = calcularCostoPromedio(stock, C, cant, C);        // entra al último costo
        const corregido   = ajustarDelta(stock + cant, provisional, cant, R - C);
        const directo     = calcularCostoPromedio(stock, C, cant, R);        // la compra normal
        if (corregido !== directo) diferencias++;
      }
    }
  }
}
check(`★ idénticos en las ${casos} combinaciones`, diferencias, 0);
check('★ el provisional NO mueve el promedio', calcularCostoPromedio(10, 100, 10, 100), 100);
check('★ y la corrección aterriza donde debe', ajustarDelta(20, 100, 10, 80), 140);

console.log('\n2. Por qué NO se recibe en cero (la trampa que el diseño evita)');
// Recibir en 0: `registrarCompra` se salta el bloque de costo (`precio > 0`),
// así que el promedio se queda en 100 con 20 unidades. Luego el delta desde 0
// reparte 180 sobre el stock entero.
const enCero = ajustarDelta(20, 100, 10, 180 - 0);
check('★ recibir en cero y corregir da una cifra equivocada', enCero, 190);
check('★ la respuesta correcta era', calcularCostoPromedio(10, 100, 10, 180), 140);
check('★ y por eso no son intercambiables', enCero === 140, false);

console.log('\n3. El precio provisional se resuelve, no se recibe');
const fuenteCtrl = readFileSync(path.join(RAIZ, 'src/modules/compras/compras.controller.js'), 'utf8');
const cuerpoEntrada = fuenteCtrl.slice(
  fuenteCtrl.indexOf('const registrarEntrada'),
  fuenteCtrl.indexOf('const getEntradas'),
);
check('★ el controlador NO propaga proveedor_id del cuerpo',
  /proveedor_id:\s*req\.body/.test(cuerpoEntrada), false);
check('★ el controlador NO propaga precios del cuerpo',
  /precio_unitario:\s*req\.body/.test(cuerpoEntrada), false);
check('★ no esparce req.body entero',
  /\.\.\.req\.body/.test(cuerpoEntrada), false);
check('la respuesta pasa por el recorte de costos',
  /recortarSiToca/.test(cuerpoEntrada), true);

console.log('\n4. Las rutas: quién puede hacer qué');
const fuenteRutas = readFileSync(path.join(RAIZ, 'src/modules/compras/compras.routes.js'), 'utf8');
const linea = (frag) => fuenteRutas.split('\n').find((l) => l.includes(frag)) || '';
check("★ registrar entrada va por el módulo 'inventario', no 'proveedores'",
  /requireModulo\('inventario'\)/.test(linea("router.post('/entradas'")), true);
check('★ y la puede hacer un supervisor (el bodeguero)',
  /requireNivel\('supervisor'\)/.test(linea("router.post('/entradas'")), true);
check('★ confirmar la factura es SOLO de admin',
  /requireNivel\('admin_negocio'\)/.test(linea("router.patch('/:id/confirmar'")), true);
check('la bandeja exige el permiso de ver compras',
  /requirePermisoVerCompras/.test(linea("router.get  ('/por-confirmar'")), true);

console.log('\n5. Estado inicial y compatibilidad');
const fuenteRepo = readFileSync(path.join(RAIZ, 'src/modules/compras/compras.repository.js'), 'utf8');
check('★ una compra normal nace CONFIRMADA (default true)',
  /factura_confirmada = true/.test(fuenteRepo), true);
check('★ una Entrada nace SIN confirmar',
  /factura_confirmada:\s*false/.test(fuenteService), true);
check('★ y no toca caja: nadie pagó nada todavía',
  /registrar_en_caja:\s*false/.test(fuenteService), true);
// La migración pone DEFAULT TRUE justamente para que el historial de los 28
// negocios no aparezca de golpe como pendiente de confirmar.
const fuenteMigr = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8');
check('★ la migración deja lo existente como confirmado',
  /factura_confirmada BOOLEAN NOT NULL DEFAULT TRUE/.test(fuenteMigr), true);
check('y hace nullable el proveedor (entrada sin orden)',
  /ALTER COLUMN proveedor_id DROP NOT NULL/.test(fuenteMigr), true);

console.log('\n6. Bodega no crea productos — pero el error dice qué hacer');
check('★ una línea sin producto_id se rechaza',
  /PRODUCTO_NO_EXISTE/.test(fuenteService), true);
check('★ y el mensaje manda a administración, no solo se niega',
  /Pidele a administracion que lo cree/.test(fuenteService), true);

console.log('\n' + '─'.repeat(62));
if (fallos) { console.log(`✗ ${fallos} FALLO(S) de ${fallos + pasados}`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
