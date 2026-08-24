// ─────────────────────────────────────────────────────────────────────────────
// BUGS REPORTADOS EN EL DESPACHO (regresión)
//
//   A. Buscar por CÓDIGO devolvía "el equipo ya fue vendido": la búsqueda se
//      cortaba en la primera pista (IMEI) y, si esa coincidía con un serial en
//      mal estado, nunca llegaba a probar el código del accesorio.
//
//   B. El valor de la línea no se veía ni se podía cambiar. Ahora es editable
//      y el precio del carrito viaja como sugerencia (nunca se aplica solo:
//      es un precio de VENTA y le cobraría de más al local).
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260822_red_interna_envios.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_control.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_cargos_pagables.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_remision_variantes.sql'), 'utf8'));

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));

let fallos = 0, pasados = 0;
const q = async (s, p = []) => (await db.query(s, p)).rows;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('U');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1'),(1,'codigo_producto_activo','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Accesorios'),(1,'Celulares');

  -- EL CASO DEL BUG: un accesorio cuyo CÓDIGO es "12345"…
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, linea_id, codigo)
    VALUES ('Cable USB-C', 40, 5000, 15000, 1, 1, '12345');

  -- …y un equipo YA VENDIDO cuyo IMEI es exactamente "12345".
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('Equipo viejo','Generico','X', 100000, 1, 2);
  INSERT INTO seriales (producto_id, imei, costo_compra, vendido)
    VALUES (1, '12345', 80000, TRUE);

  -- Equipo sin costo registrado (saldría en $0)
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 2);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (2, 'AAA111', NULL);

  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),(1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
`);

const bodega = { user:{id:1,negocio_id:1,rol:'admin_negocio'}, sucursal_id:1, esBodega:true,
  red:{activa:true,bodega_id:1,confirmar_recepcion:true,confirmar_remesa:true} };
const centro = { user:{id:1,negocio_id:1,rol:'vendedor'}, sucursal_id:2, esBodega:false, red:{...bodega.red} };

console.log('\n═══ A. Buscar "12345": código de accesorio vs IMEI de equipo vendido ═══');
const hallado = await service.buscarParaDespacho(bodega, '12345')
  .catch((e) => ({ error: `${e.status}: ${e.message}` }));
ok('★ Devuelve el ACCESORIO, no el error del equipo vendido',
   hallado.tipo === 'cantidad', hallado.error || `"${hallado.nombre}"`);
ok('  con su costo', Number(hallado.valor_interno) === 5000, money(hallado.valor_interno));
ok('  y su stock', Number(hallado.stock) === 40);

console.log('\n   … si el accesorio se queda sin stock, ahí sí explica el problema');
await db.exec(`UPDATE productos_cantidad SET stock = 0 WHERE codigo = '12345'`);
const sinNada = await service.buscarParaDespacho(bodega, '12345')
  .catch((e) => ({ status: e.status, message: e.message }));
ok('★ Explica AMBOS motivos, no solo el del equipo',
   sinNada.status === 409 && /sin stock/i.test(sinNada.message)
                          && /vendido/i.test(sinNada.message), sinNada.message);
await db.exec(`UPDATE productos_cantidad SET stock = 40 WHERE codigo = '12345'`);

console.log('\n   … y un IMEI de un equipo vendido sigue avisando bien');
await db.exec(`
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('Otro','Gen','Y', 1000, 1, 2);
  INSERT INTO seriales (producto_id, imei, costo_compra, vendido) VALUES (3,'999888777', 5000, TRUE);
`);
const vendido = await service.buscarParaDespacho(bodega, '999888777')
  .catch((e) => ({ status: e.status, message: e.message }));
ok('★ Un IMEI vendido de verdad sí dice "ya fue vendido"',
   vendido.status === 409 && /vendido/i.test(vendido.message), vendido.message);

console.log('\n═══ B. El valor de la línea es editable ═══');
const equipoSinCosto = await service.buscarParaDespacho(bodega, 'AAA111');
ok('El iPhone entró sin costo → sale en $0', Number(equipoSinCosto.valor_interno) === 0);
ok('  y viene marcado para que la pantalla lo resalte', equipoSinCosto.sin_costo === true);

// Se despacha poniéndole un valor a mano.
const r1 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'serial', serial_id: 2, valor_interno: 1750000 },      // valor puesto a mano
    { tipo: 'cantidad', producto_id: 1, cantidad: 4, valor_interno: 6000 }, // costo 5000 → 6000
  ],
});
const l1 = await repo.getLineasRemision(r1.id);
const lSerial   = l1.find((l) => l.tipo === 'serial');
const lCantidad = l1.find((l) => l.tipo === 'cantidad');
ok('★ El valor escrito manda sobre el costo (equipo)',
   Number(lSerial.valor_interno) === 1750000, money(lSerial.valor_interno));
ok('★ También en accesorios', Number(lCantidad.valor_interno) === 6000, money(lCantidad.valor_interno));
ok('★ El total de la remisión usa esos valores',
   Number(r1.valor_total) === 1750000 + 6000 * 4, money(r1.valor_total));

console.log('\n   … y sin valor escrito sigue mandando el costo');
const r2 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 2 }],
});
const l2 = await repo.getLineasRemision(r2.id);
ok('★ Default = costo real (5.000)', Number(l2[0].valor_interno) === 5000, money(l2[0].valor_interno));

console.log('\n   … un valor negativo se rechaza');
let negativo = false;
try {
  await service.despachar(bodega, {
    sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 1, valor_interno: -500 }],
  });
} catch (e) { negativo = e.status === 400; }
ok('★ Rechazado', negativo);

console.log('\n═══ C. El valor editado es el que se liquida ═══');
const l1b = await repo.getLineasRemision(r1.id);
await service.recibir(centro, r1.id, { lineas_recibidas: l1b.map((x) => Number(x.id)) });
// El local vende el iPhone de contado
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 2, 'Cliente', 'Activa', NOW());
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 13', 'AAA111', 1, 2600000);
  UPDATE seriales SET vendido = TRUE WHERE imei = 'AAA111';
`);
const estado = await service.getPanelLocal(centro);
// La deuda ya no depende de la venta (ver el cambio de modelo), pero lo que se
// verifica aquí sigue siendo lo mismo: que el equipo se cobre al valor EDITADO
// y no en $0 por no tener costo registrado.
const detalleR1 = await service.getRemision(bodega, r1.id);
const lineaIphone = detalleR1.lineas.find((l) => l.imei === 'AAA111');
ok('★ Al local se le cobra el valor que se le puso, no $0',
   Number(lineaIphone.valor_interno) === 1750000, money(lineaIphone.valor_interno));
ok('  y ese valor entra en la deuda del envío',
   Number(estado.totales.deuda_total) >= 1750000, money(estado.totales.deuda_total));

console.log('\n═══ D. El precio del carrito llega como sugerencia, no aplicado ═══');
const resuelto = await service.resolverItems(bodega, [
  { tipo: 'cantidad', producto_id: 1, cantidad: 2, precio_carrito: 15000 },
]);
const item = resuelto.items[0];
ok('★ El valor sigue siendo el COSTO (5.000)', Number(item.valor_interno) === 5000, money(item.valor_interno));
ok('★ El precio del carrito viaja aparte (15.000)',
   Number(item.precio_carrito) === 15000, money(item.precio_carrito));
ok('  así la pantalla puede ofrecerlo sin cobrarle de más al local por defecto', true);

console.log(`\n${'═'.repeat(62)}`);
console.log(`RESULTADO: ${pasados} pasaron, ${fallos} fallaron`);
console.log('═'.repeat(62));
process.exit(fallos ? 1 : 0);
