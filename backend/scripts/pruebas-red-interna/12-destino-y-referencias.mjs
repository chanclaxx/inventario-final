// ─────────────────────────────────────────────────────────────────────────────
// A DÓNDE FUE CADA EQUIPO, Y BAJO QUÉ NOMBRE QUEDÓ
//
// Dos preguntas que el local hacía y el sistema no contestaba:
//
//   1. "Vendido" y "prestado" no decían A QUIÉN. La venta traía cliente y
//      factura; el préstamo no traía nada. Ahora cada unidad lleva su destino.
//   2. El catálogo es POR SUCURSAL: el mismo modelo puede llamarse distinto en
//      la bodega y en el local. Si los nombres no coinciden hay que decirlo —
//      puede ser solo la escritura, o puede ser que se despachó otro equipo.
//
// Y la deuda del local, que vive en la página Bodega, ahora también sale en el
// Dashboard: se verifica que la calcule el mismo service (una sola fórmula) y
// que no aparezca para quien no tiene la feature ni para la bodega misma.
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

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const service  = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const reportes = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));
const { invalidarCache } = require(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'));

let fallos = 0, pasados = 0;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test'), ('Vecino');
  INSERT INTO sucursales (negocio_id, nombre) VALUES
    (1,'Bodega'), (1,'Centro'),      -- 1, 2
    (2,'Tienda del vecino');         -- 3
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Supervisor'),('Vendedor');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares');

  -- MISMO modelo, escrito distinto en cada sucursal: el caso real del cliente.
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id) VALUES
    ('iPhone 11 Pro Max','Apple','256GB', 2600000, 1, 1),   -- id 1 · bodega
    ('iphone 11 pro max','Apple','256GB', 2700000, 2, 1),   -- id 2 · local, minúsculas
    ('Galaxy S21','Samsung','128GB',      1500000, 1, 1);   -- id 3 · bodega

  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'VENTA-1',  1000000),   -- id 1 · se vende
    (1,'PREST-1',  1000000),   -- id 2 · se presta
    (1,'VITRINA-1',1000000),   -- id 3 · se queda
    (3,'DEVUEL-1',  800000);   -- id 4 · se devuelve

  INSERT INTO prestatarios (negocio_id, nombre, cedula, telefono)
    VALUES (1,'Luis Gómez','123','300');

  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),
           (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
`);

const red = { activa:true, bodega_id:1, confirmar_recepcion:true, confirmar_remesa:true,
              ocultar_costos:true };
const bodega = { user:{id:1,negocio_id:1,rol:'admin_negocio'}, sucursal_id:1, esBodega:true, red };
const centro = { user:{id:2,negocio_id:1,rol:'supervisor'},    sucursal_id:2, esBodega:false, red };
const vende  = { user:{id:3,negocio_id:1,rol:'vendedor'},      sucursal_id:2, esBodega:false, red };

console.log('\n═══ 1. Recibir un envío COMPLETO de un solo toque ═══');
// La página del local trae "Recibí todo": llama a recibir() sin lista de
// líneas. El default amable del service debe recibirlas todas, no dejarlas
// como faltantes.
const env = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [1, 2, 3, 4].map((id) => ({ tipo: 'serial', serial_id: id })),
});
const res = await service.recibir(centro, env.id, {});
ok('★ Sin lista de líneas, recibe las 4', Number(res.recibidas) === 4, `${res.recibidas}`);
ok('  y no deja ninguna como faltante', Number(res.faltantes) === 0);
const envRecibido = await repo.findRemisionById(1, env.id);
ok('★ El envío queda Recibida, no Parcial', envRecibido.estado === 'Recibida',
   envRecibido.estado);

console.log('\n═══ 2. Vendido: se ve el cliente y la factura ═══');
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (77, 2, 'Ana Pérez', 'Activa', NOW() + INTERVAL '1 minute');
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iphone 11 pro max', 'VENTA-1', 1, 2700000);
  UPDATE seriales SET vendido = TRUE WHERE imei = 'VENTA-1';
`);

let cuenta = await service.getEstadoCuenta(centro, 2);
const uni = (imei) => cuenta.mercancia.items.find((x) => x.imei === imei);

let v = uni('VENTA-1');
ok('★ Destino tipo venta',      v.destino.tipo === 'venta', v.destino.tipo);
ok('  con el nombre del cliente', v.destino.quien === 'Ana Pérez', v.destino.quien);
ok('  y el número de factura',    v.destino.documento === 'Factura #77', v.destino.documento);
ok('  y la fecha de la venta',    !!v.destino.fecha);
ok('  el estado sigue siendo el de siempre', v.estado_unidad === 'Por liquidar');

console.log('\n═══ 3. ★ Prestado: ahora se ve A QUIÉN ═══');
await db.exec(`
  INSERT INTO prestamos (numero, sucursal_id, prestatario_id, prestatario, imei,
                         nombre_producto, valor_prestamo, estado, fecha)
    VALUES (45, 2, 1, 'Luis Gómez', 'PREST-1', 'iphone 11 pro max',
            500000, 'Activo', NOW() + INTERVAL '2 minutes');
  UPDATE seriales SET prestado = TRUE WHERE imei = 'PREST-1';
`);

cuenta = await service.getEstadoCuenta(centro, 2);
let p = uni('PREST-1');
ok('★ El estado es En préstamo', p.estado_unidad === 'En prestamo');
ok('★ Destino tipo préstamo',    p.destino.tipo === 'prestamo', p.destino.tipo);
ok('★ Con el nombre del prestatario', p.destino.quien === 'Luis Gómez', p.destino.quien);
ok('  y el número del préstamo', p.destino.documento === 'Préstamo #45', p.destino.documento);
ok('  y dice que todavía no es deuda',
   /no genera deuda/i.test(p.destino.nota || ''), p.destino.nota);
ok('★ Y sigue sin liquidar nada', Number(p.liquidable) === 0);

console.log('\n═══ 4. El cruce del préstamo respeta los candados de siempre ═══');
// Un préstamo del MISMO IMEI pero de otra sucursal no puede aparecer aquí:
// es el fan-out de IMEI, la trampa de este modelo.
await db.exec(`
  INSERT INTO prestamos (numero, sucursal_id, prestatario, imei, nombre_producto,
                         valor_prestamo, estado, fecha)
    VALUES (99, 1, 'Prestatario de la bodega', 'VITRINA-1', 'iPhone 11 Pro Max',
            400000, 'Activo', NOW() + INTERVAL '3 minutes');
`);
cuenta = await service.getEstadoCuenta(centro, 2);
const vitrina = uni('VITRINA-1');
ok('★ Un préstamo de OTRA sucursal no contamina la unidad',
   vitrina.estado_unidad === 'En consignacion' && vitrina.destino.tipo === 'vitrina',
   `${vitrina.estado_unidad} / ${vitrina.destino.tipo}`);
ok('  y el equipo en vitrina dice que está disponible',
   /disponible/i.test(vitrina.destino.nota || ''), vitrina.destino.nota);

console.log('\n═══ 5. Devuelto: se ve cuándo volvió a la bodega ═══');
const dev = await service.devolver(centro, { lineas: [{ tipo: 'serial', serial_id: 4 }] });
await service.confirmarDevolucion(bodega, dev.id, {});
cuenta = await service.getEstadoCuenta(centro, 2, { estado: 'Devuelta' });
const d = cuenta.mercancia.items.find((x) => x.imei === 'DEVUEL-1');
ok('★ Destino tipo devolución', d.destino.tipo === 'devolucion', d.destino.tipo);
ok('  con su fecha',            !!d.destino.fecha);
ok('  y su número de documento', /Devolución #/.test(d.destino.documento || ''),
   d.destino.documento);

console.log('\n═══ 6. ★ La referencia que no coincide entre bodega y local ═══');
cuenta = await service.getEstadoCuenta(centro, 2);
v = uni('VENTA-1');
ok('★ Trae la referencia del catálogo de la bodega',
   v.nombre_producto_bodega === 'iPhone 11 Pro Max', v.nombre_producto_bodega);
ok('  y el nombre del despacho conserva marca y modelo',
   v.nombre_producto === 'iPhone 11 Pro Max Apple 256GB', v.nombre_producto);
ok('★ Y el nombre que tiene en el local',
   v.nombre_producto_local === 'iphone 11 pro max', v.nombre_producto_local);
ok('★ Solo cambia la escritura → NO se marca como diferencia',
   v.referencia_difiere === false);

// Ahora sí: alguien renombra la referencia del local a otro modelo.
await db.exec(`UPDATE productos_serial SET nombre = 'iPhone 12 Pro' WHERE id = 2`);
cuenta = await service.getEstadoCuenta(centro, 2);
v = uni('VENTA-1');
ok('★★ Nombre realmente distinto → se marca la diferencia',
   v.referencia_difiere === true,
   `${v.nombre_producto_bodega} vs ${v.nombre_producto_local}`);
p = uni('PREST-1');
ok('  y marca todas las unidades afectadas, no solo una',
   p.referencia_difiere === true);
await db.exec(`UPDATE productos_serial SET nombre = 'iphone 11 pro max' WHERE id = 2`);

console.log('\n═══ 7. Tildes y espacios de más no son una diferencia ═══');
await db.exec(`UPDATE productos_serial SET nombre = '  íPhone  11 PRO máx ' WHERE id = 2`);
cuenta = await service.getEstadoCuenta(centro, 2);
ok('★ Se ignoran tildes, mayúsculas y espacios repetidos',
   uni('VENTA-1').referencia_difiere === false,
   uni('VENTA-1').nombre_producto_local);
await db.exec(`UPDATE productos_serial SET nombre = 'iphone 11 pro max' WHERE id = 2`);

console.log('\n═══ 8. El detalle del envío cuenta lo mismo que la lista ═══');
const detalle = await service.getRemision(centro, env.id);
const lineaPrest = detalle.lineas.find((l) => l.imei === 'PREST-1');
ok('★ La línea del envío también trae el prestatario',
   lineaPrest.destino.quien === 'Luis Gómez', lineaPrest.destino.quien);
ok('  y el mismo estado que la lista', lineaPrest.estado_unidad === 'En prestamo');
// Regresión: el detalle pasaba el id de la remisión donde el motor de estados
// esperaba la sucursal, así que TODAS las líneas caían sin estado y el resumen
// del envío decía siempre "0 de deuda", aunque el local ya hubiera vendido.
ok('★★ El resumen del envío refleja la deuda real, no 0',
   Number(detalle.resumen.liquidable) === 1000000, money(detalle.resumen.liquidable));
ok('  y sabe cuánto sigue en vitrina',
   Number(detalle.resumen.en_vitrina) > 0, money(detalle.resumen.en_vitrina));

console.log('\n═══ 9. ★ Un vendedor ve el destino, no los pesos ═══');
const comoVendedor = await service.getEstadoCuenta(vende, 2);
const vv = comoVendedor.mercancia.items.find((x) => x.imei === 'PREST-1');
ok('★ Ve a quién le prestó',  vv.destino.quien === 'Luis Gómez');
ok('★ Ve el estado',          vv.estado_unidad === 'En prestamo');
ok('★ Ve los dos nombres',    !!vv.nombre_producto && !!vv.nombre_producto_local);
ok('★ Pero no el costo',      vv.valor_interno === null);
ok('  ni lo liquidable',      vv.liquidable === null);

console.log('\n═══ 10. ★ La deuda del Dashboard sale del mismo cálculo ═══');
invalidarCache(1);
const estado = await service.getEstadoLocal(1, 2);
const dash = await reportes.getDashboard(2, 1);
ok('★ El Dashboard trae la deuda con bodega', dash.deuda_bodega !== null);
ok('★★ Y es exactamente la del panel',
   Number(dash.deuda_bodega.saldo) === Number(estado.totales.saldo_por_liquidar),
   `${money(dash.deuda_bodega.saldo)} vs ${money(estado.totales.saldo_por_liquidar)}`);
ok('  con cuántos equipos la sostienen', dash.deuda_bodega.unidades_vendidas === 1,
   `${dash.deuda_bodega.unidades_vendidas}`);

console.log('\n═══ 11. La deuda NO aparece donde no corresponde ═══');
const dashBodega = await reportes.getDashboard(1, 1);
ok('★ La bodega no se debe a sí misma', dashBodega.deuda_bodega === null);

const dashVecino = await reportes.getDashboard(3, 2);
ok('★ Un negocio sin la feature no ve nada', dashVecino.deuda_bodega === null);
ok('  y su dashboard sigue funcionando igual',
   dashVecino.ventas_hoy !== undefined && dashVecino.cartera_vencida !== undefined);

await db.exec(`UPDATE config_negocio SET valor = '0' WHERE negocio_id = 1 AND clave = 'red_interna_activa'`);
invalidarCache(1);
const dashApagado = await reportes.getDashboard(2, 1);
ok('★ Apagar la feature apaga la tarjeta, sin migrar nada',
   dashApagado.deuda_bodega === null);

console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${pasados} pasaron · ${fallos} fallaron`);
console.log('─'.repeat(60));
process.exit(fallos ? 1 : 0);
