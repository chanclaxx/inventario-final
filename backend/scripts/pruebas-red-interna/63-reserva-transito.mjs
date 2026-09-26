// ─────────────────────────────────────────────────────────────────────────────
// LO QUE VA EN CAMINO NO SE TOCA — reserva de la mercancía de la red interna
//
// Despachar no mueve inventario (lo mueve la recepción), así que mientras un
// envío va en camino la bodega podía vender, prestar o ajustar lo que ya iba en
// el camión, y el envío quedaba imposible de recibir (Tesla, envío #21).
//
// Los triggers de 20260926_reserva_transito.sql lo impiden en la BASE, para
// que ninguno de los más de veinte sitios que escriben stock se escape. La
// suite escribe directo con SQL —como lo haría cualquiera de esos sitios— y
// comprueba que:
//   1. lo que va en camino no se vende, presta, mueve, borra ni baja;
//   2. lo que NO va en camino se sigue tocando igual que siempre;
//   3. recibir, anular y reportar faltantes siguen funcionando y liberan solo;
//   4. el contenedor de un árbol de variantes se sigue sincronizando.
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
for (const m of [
  '20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables',
  '20260823_remision_variantes', '20260823_lotes_cantidad',
  '20260824_costo_origen_remision', '20260823_valor_acreditado',
]) {
  await db.exec(readFileSync(path.join(RAIZ, `../migrations/${m}.sql`), 'utf8'));
}
const SQL_RESERVA = readFileSync(path.join(RAIZ, 'migrations/20260926_reserva_transito.sql'), 'utf8');
await db.exec(SQL_RESERVA);
await db.exec(SQL_RESERVA);   // idempotente

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const { errorHandler: errorMw } = require(path.join(RAIZ, 'src/middlewares/error.middleware.js'));

let fallos = 0, pasados = 0;
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}
// Corre un SQL y devuelve el error (o null). Cada intento en su transacción,
// como lo haría cualquier módulo real.
const intentar = async (sql, params = []) => {
  try {
    await db.query('BEGIN');
    await db.query(sql, params);
    await db.query('COMMIT');
    return null;
  } catch (err) {
    await db.query('ROLLBACK');
    return err;
  }
};
const bloqueado = (e) => e?.code === 'RT001';
const stockDe = async (tabla, id) => Number((await db.query(`SELECT stock FROM ${tabla} WHERE id = $1`, [id])).rows[0].stock);

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Supervisor');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra)
    SELECT 1, 'IMEI-' || g, 1000000 FROM generate_series(1, 10) g;
  -- 1: case suelto (sin variantes) · 2: correa con tallas
  INSERT INTO productos_cantidad (nombre, precio, costo_unitario, stock, sucursal_id, linea_id)
    VALUES ('Case', 20000, 10000, 7, 1, 2), ('Correa', 30000, 15000, 8, 1, 2);
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
    VALUES (2, 1, '38MM', 5, 15000), (2, 1, '42MM', 3, 15000);
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']), (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
`);

const red = { activa: true, bodega_id: 1, confirmar_recepcion: true, confirmar_remesa: true, ocultar_costos: true };
const bodega = { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true, red };
const centro = { user: { id: 2, negocio_id: 1, rol: 'supervisor' },    sucursal_id: 2, esBodega: false, red };

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Sin envíos en camino, todo se toca como siempre ═══');
// ═════════════════════════════════════════════════════════════════════════════
ok('  vender un IMEI libre', !(await intentar(`UPDATE seriales SET vendido = TRUE WHERE id = 10`)));
ok('  y devolver la venta', !(await intentar(`UPDATE seriales SET vendido = FALSE WHERE id = 10`)));
ok('  bajar stock libre', !(await intentar(`UPDATE productos_cantidad SET stock = 6 WHERE id = 1`)));
ok('  y subirlo', !(await intentar(`UPDATE productos_cantidad SET stock = 7 WHERE id = 1`)));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. Un IMEI en camino no se vende, presta, mueve ni borra ═══');
// ═════════════════════════════════════════════════════════════════════════════
const e1 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: 1 }, { tipo: 'serial', serial_id: 2 }],
});
let err = await intentar(`UPDATE seriales SET vendido = TRUE WHERE id = 1`);
ok('★★ Venderlo → bloqueado', bloqueado(err), err?.message);
ok('  el mensaje dice qué envío y hacia dónde', /IMEI-1/.test(err?.message) && /#/.test(err?.message) && /Centro/.test(err?.message));
ok('★ Prestarlo → bloqueado', bloqueado(await intentar(`UPDATE seriales SET prestado = TRUE WHERE id = 1`)));
await db.query(`INSERT INTO productos_serial (nombre, sucursal_id) VALUES ('iPhone 13 usado', 1)`);
ok('★ Cambiarlo de referencia → bloqueado',
   bloqueado(await intentar(`UPDATE seriales SET producto_id = (SELECT MAX(id) FROM productos_serial) WHERE id = 1`)));
ok('★ Borrarlo → bloqueado', bloqueado(await intentar(`DELETE FROM seriales WHERE id = 1`)));
ok('  cambiarle el precio o la nota sí se puede', !(await intentar(`UPDATE seriales SET precio = 2700000 WHERE id = 1`)));
ok('  un IMEI que NO va en el envío se vende normal', !(await intentar(`UPDATE seriales SET vendido = TRUE WHERE id = 9`)));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. El stock no baja de lo que va en camino (el caso Tesla #21) ═══');
// ═════════════════════════════════════════════════════════════════════════════
// La bodega tiene 7 cases y despacha los 7.
const e2 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 7 }],
});
err = await intentar(`UPDATE productos_cantidad SET stock = 6 WHERE id = 1`);
ok('★★ Vender 1 de los 7 que van en camino → bloqueado', bloqueado(err), err?.message);
ok('  el mensaje dice cuántas van y en qué envío', /7 unidad/.test(err?.message) && /#/.test(err?.message));
ok('  subir stock sí se puede (llegó más mercancía)', !(await intentar(`UPDATE productos_cantidad SET stock = 10 WHERE id = 1`)));
ok('★ …y ahora se pueden vender las 3 que NO van en camino', !(await intentar(`UPDATE productos_cantidad SET stock = 7 WHERE id = 1`)));
ok('  pero no una más', bloqueado(await intentar(`UPDATE productos_cantidad SET stock = 6 WHERE id = 1`)));
ok('★ Desactivar el producto con mercancía en camino → bloqueado',
   bloqueado(await intentar(`UPDATE productos_cantidad SET activo = FALSE WHERE id = 1`)));
ok('  borrarlo → bloqueado', bloqueado(await intentar(`DELETE FROM productos_cantidad WHERE id = 1`)));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. Árbol de variantes: se protege la HOJA, el contenedor sincroniza ═══');
// ═════════════════════════════════════════════════════════════════════════════
const e3 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 2, atributo_id: 1, cantidad: 4 }],
});
ok('★ La talla 38MM (4 de 5 en camino) no baja de 4', bloqueado(await intentar(`UPDATE atributos_producto SET stock = 3 WHERE id = 1`)));
ok('  pero sí puede vender la que sobra', !(await intentar(`UPDATE atributos_producto SET stock = 4 WHERE id = 1`)));
ok('  la otra talla (42MM) se toca libre', !(await intentar(`UPDATE atributos_producto SET stock = 0 WHERE id = 2`)));
ok('★ El producto contenedor se re-sincroniza (Σ tallas) sin bloqueo',
   !(await intentar(`UPDATE productos_cantidad SET stock = (SELECT SUM(stock) FROM atributos_producto WHERE producto_id = 2) WHERE id = 2`)));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. Recibir, anular y los faltantes liberan solos ═══');
// ═════════════════════════════════════════════════════════════════════════════
// Envío 1 (dos IMEI): el local recibe uno y reporta el otro como faltante.
const lineas1 = await repo.getLineasRemision(e1.id);
const r1 = await service.recibir(centro, e1.id, { lineas_recibidas: [Number(lineas1[0].id)] });
ok('★ La recepción mueve el IMEI reservado sin tropezar con el candado', r1.recibidas === 1);
ok('  el faltante quedó libre en la bodega (se puede vender)',
   !(await intentar(`UPDATE seriales SET vendido = TRUE WHERE id = $1`, [lineas1[1].serial_id])));
ok('  el recibido ya es del local y se vende libre',
   !(await intentar(`UPDATE seriales SET vendido = TRUE WHERE id = $1`, [lineas1[0].serial_id])));

// Envío 2 (7 cases): se recibe entero.
const stockAntes = await stockDe('productos_cantidad', 1);
await service.recibir(centro, e2.id, {});
ok('★ Recibir los 7 cases descuenta de la bodega (el trigger los deja salir)',
   await stockDe('productos_cantidad', 1) === stockAntes - 7, `${stockAntes} → ${await stockDe('productos_cantidad', 1)}`);
ok('  y lo que queda en la bodega se toca libre', !(await intentar(`UPDATE productos_cantidad SET stock = 0 WHERE id = 1`)));

// Envío 3 (4 de 38MM): se anula.
await service.anularRemision(bodega, e3.id);
ok('★ Anular el envío libera la talla', !(await intentar(`UPDATE atributos_producto SET stock = 0 WHERE id = 1`)));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 6. Una devolución en camino reserva la mercancía del LOCAL ═══');
// ═════════════════════════════════════════════════════════════════════════════
const devo = await service.devolver(centro, {
  lineas: [{ tipo: 'serial', serial_id: lineas1[0].serial_id }], notas: 'no sirve',
}).catch((e) => ({ error: e }));
if (devo.error) {
  // El IMEI ya se vendió arriba (sección 5); devolvemos otro recién recibido.
  await db.query(`UPDATE seriales SET vendido = FALSE WHERE id = $1`, [lineas1[0].serial_id]);
}
const dev = devo.error
  ? await service.devolver(centro, { lineas: [{ tipo: 'serial', serial_id: lineas1[0].serial_id }], notas: 'no sirve' })
  : devo;
err = await intentar(`UPDATE seriales SET vendido = TRUE WHERE id = $1`, [lineas1[0].serial_id]);
ok('★ El local no puede vender lo que ya mandó de vuelta', bloqueado(err), err?.message);
ok('  el mensaje habla de la DEVOLUCIÓN', /devoluci/.test(err?.message || ''));
await service.confirmarDevolucion(bodega, dev.id, {});
const vuelta = (await db.query(`SELECT ps.sucursal_id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id WHERE s.id = $1`, [lineas1[0].serial_id])).rows[0];
ok('★ La bodega confirma la devolución y el equipo vuelve (el candado la deja pasar)', Number(vuelta.sucursal_id) === 1);
ok('  y ya se vende libre en la bodega', !(await intentar(`UPDATE seriales SET vendido = TRUE WHERE id = $1`, [lineas1[0].serial_id])));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. La marca de la recepción no se le escapa a nadie ═══');
// ═════════════════════════════════════════════════════════════════════════════
const e4 = await service.despachar(bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: 5 }] });
await db.query('BEGIN');
await db.query(`SELECT set_config('app.red_transito_libre', '1', true)`);
await db.query('COMMIT');
ok('★ Después de una transacción marcada, la siguiente vuelve a estar protegida',
   bloqueado(await intentar(`UPDATE seriales SET vendido = TRUE WHERE id = 5`)));
await service.anularRemision(bodega, e4.id);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 8. La pantalla recibe un 409 que se entiende ═══');
// ═════════════════════════════════════════════════════════════════════════════
let respuesta = null;
const res = { status: (c) => ({ json: (b) => { respuesta = { c, b }; } }) };
const logOriginal = console.error; console.error = () => {};
errorMw({ code: 'RT001', message: 'El equipo X va en camino…' }, { method: 'POST', url: '/x' }, res, () => {});
console.error = logOriginal;
ok('★ RT001 → 409 EN_TRANSITO con el mensaje del trigger',
   respuesta?.c === 409 && respuesta.b.code === 'EN_TRANSITO' && /camino/.test(respuesta.b.error));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 9. Lo reservado se VE antes de tropezar, y el olvidado avisa ═══');
// ═════════════════════════════════════════════════════════════════════════════
const e5 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [{ tipo: 'serial', serial_id: 6 },
           { tipo: 'cantidad', producto_id: 2, atributo_id: 2, cantidad: 0 + 1 }],
}).catch(async () => {
  // La 42MM quedó en 0 en la sección 4: se repone antes de despachar.
  await db.query(`UPDATE atributos_producto SET stock = 3 WHERE id = 2`);
  return service.despachar(bodega, {
    sucursal_destino_id: 2,
    lineas: [{ tipo: 'serial', serial_id: 6 }, { tipo: 'cantidad', producto_id: 2, atributo_id: 2, cantidad: 1 }],
  });
});
const vista = await service.getEnTransito(bodega);
ok('★ El inventario de la bodega recibe lo que va en camino',
   vista.seriales.some((s) => s.serial_id === 6 && s.imei === 'IMEI-6')
   && vista.nodos.some((n) => n.producto_id === 2 && n.atributo_id === 2 && n.variante_id === null && n.cantidad === 1));
ok('  con el envío y su destino', vista.seriales[0].destino === 'Centro' && vista.seriales[0].numero != null);
ok('  sin ninguna clave de costo', !/costo|valor/.test(JSON.stringify(vista)));
const vistaLocal = await service.getEnTransito(centro);
ok('  el local no ve como suyo lo que la bodega despacha', vistaLocal.seriales.length === 0 && vistaLocal.nodos.length === 0);

const operaciones = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.operaciones.js'));
await db.query(`UPDATE remisiones SET fecha_emision = NOW() - INTERVAL '8 days' WHERE id = $1`, [e5.id]);
const olvidados = await operaciones.enviosSinRecibir(1);
ok('★ Un envío de hace 8 días sin recibir sale en los avisos', olvidados.total === 1 && olvidados.items[0].dias >= 7);
const motor = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.motor.js'));
const sen = await motor.recolectar(1);
ok('  y es URGENTE (su mercancía lleva una semana congelada)',
   sen.urgentes.some((s) => s.clave === 'red_envios_sin_recibir'));
await service.anularRemision(bodega, e5.id);
ok('  anularlo lo saca del aviso', (await operaciones.enviosSinRecibir(1)).total === 0);

console.log(`\n${fallos === 0 ? '✓' : '✗'} ${pasados} pasaron, ${fallos} fallaron\n`);
process.exit(fallos ? 1 : 0);
