// ─────────────────────────────────────────────────────────────────────────────
// TRASLADOS ENTRE SEDES PROPIAS — despacho y traslado conviven
//
// Tesla (oct-2026): la bodega le DESPACHA a dos locales que le pagan (Bunny,
// Camilo) y quiere TRASLADAR a su propia tienda, que no le debe nada. Un
// traslado es una remisión de tipo 'traslado' (20261030_traslados_internos.sql)
// que reusa el motor de la remisión y NO toca ninguna cuenta.
//
// Secciones:
//   1. ★ Sin sedes propias, todo es exactamente como antes.
//   2. Las reglas de ruta (puras).
//   3. Pasar una sede a propia: la cuenta se cierra en $0, sin borrar nada.
//   4. Trasladar con confirmación: reserva, recepción en la HOJA, costo real.
//   5. ★ Un traslado no genera cuenta, ni venta de la bodega, ni despacho.
//   6. Sin confirmación: entra directo.
//   7. Faltantes y anular.
//   8. Los candados de ruta (despachar a propia, devolver desde propia…).
//   9. Un equipo que fue y volvió se puede volver a despachar.
//  10. El equipo que llegó por despacho cuando la sede era local.
//  11. ★ Ningún costo ni precio viaja a quien no debe.
//  12. Contexto, permisos e idempotencia.
//  13. Validación de Ajustes.
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
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260926_reserva_transito.sql'), 'utf8'));
await db.exec(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS negocio_id INT;
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol TEXT;
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sucursal_id INT;`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const columnas  = require(path.join(RAIZ, 'src/config/columnas.js'));
const service   = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const traslados = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.traslados.js'));
const reglas    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.traslados.reglas.js'));
const repo      = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const redMw     = require(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'));
const despachosFac = require(path.join(RAIZ, 'src/modules/facturas/facturas.despachos.js'));

let pasados = 0; const fallos = [];
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const falla = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const intentar = async (sql, params = []) => {
  try { await db.query('BEGIN'); await db.query(sql, params); await db.query('COMMIT'); return null; }
  catch (err) { await db.query('ROLLBACK'); return err; }
};
const uno = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const num = (v) => Number(v || 0);

// ── Datos: Bodega (1), Bunny (2, local), Tienda (3, la que será propia), Otra (4)
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tesla');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Bunny Mobile'),(1,'Tesla Tienda'),(1,'Tesla Norte');
  INSERT INTO usuarios (nombre, negocio_id, rol, sucursal_id) VALUES
    ('Admin',1,'admin_negocio',NULL),('Bodeguero',1,'supervisor',1),('Vende Tienda',1,'vendedor',3),('Super Bunny',1,'supervisor',2);
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra)
    SELECT 1, 'IMEI-' || g, 1000000 + g FROM generate_series(1, 12) g;
  -- 1: case (sin tallas) · 2: correa con tallas 38MM y 42MM
  INSERT INTO productos_cantidad (nombre, precio, costo_unitario, stock, sucursal_id, linea_id, codigo)
    VALUES ('Case', 20000, 10000, 30, 1, 2, 'CASE01'), ('Correa', 30000, 15000, 18, 1, 2, NULL);
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
    VALUES (2, 1, '38MM', 10, 14000), (2, 1, '42MM', 8, 16000);
  -- La tienda ya tiene el case (catálogo replicado) con su propio costo.
  INSERT INTO productos_cantidad (nombre, precio, costo_unitario, stock, sucursal_id, linea_id, codigo)
    VALUES ('Case', 22000, 12000, 10, 3, 2, 'CASE01');
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),(1,2,'Efectivo','efectivo',ARRAY['Efectivo']),(1,3,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2),(3);
`);

const configRed = async () => { redMw.invalidarCache(1); return redMw.getConfigRed(1); };
const req = async (userId, sucursalId, modulos = null) => {
  const u = await uno('SELECT * FROM usuarios WHERE id = $1', [userId]);
  const red = await configRed();
  return {
    user: { id: userId, negocio_id: 1, rol: u.rol, modulos_permitidos: modulos },
    sucursal_id: sucursalId, red, esBodega: Number(sucursalId) === Number(red.bodega_id),
  };
};
const stockNodo = async (tabla, id) => num((await uno(`SELECT stock FROM ${tabla} WHERE id = $1`, [id])).stock);
const totalesDe = async (suc) => (await service.getEstadoLocal(1, suc)).totales;
const sucursalDelSerial = async (id) => num((await uno(
  'SELECT ps.sucursal_id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id WHERE s.id = $1', [id])).sucursal_id);

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. ★ Sin sedes propias (o sin la migración), todo es como antes');
// ═════════════════════════════════════════════════════════════════════════════
columnas._setTrasladosInternosDisponible(false);
let bodega = await req(2, 1);
const ctx0 = await service.getContexto(bodega);
ok('★ El contexto dice que los traslados están apagados', ctx0.traslados?.activos === false && ctx0.traslados.destinos.length === 0);
ok('  y no ofrece destinos de traslado', ctx0.traslados.puede_trasladar === false);
let e = await falla(() => traslados.trasladar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'serial', serial_id: 1 }] }));
ok('★ Trasladar responde 404 (la función no existe para este negocio)', e?.status === 404, e?.message);
// Un despacho de siempre a la que después será la sede propia, y otro a Bunny.
const envioTienda = await service.despachar(bodega, {
  sucursal_destino_id: 3, lineas: [{ tipo: 'serial', serial_id: 11 }, { tipo: 'cantidad', producto_id: 1, cantidad: 2, valor_interno: 15000 }],
});
const envioBunny = await service.despachar(bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: 12 }] });
ok('★ Despachar a cualquier sucursal funciona igual', envioTienda.tipo === 'entrega' && envioBunny.tipo === 'entrega');
await service.recibir(await req(3, 3), envioTienda.id, {});
await service.recibir(await req(4, 2), envioBunny.id, {});
const tTienda0 = await totalesDe(3);
ok('  la tienda queda debiendo su envío, como cualquier local', tTienda0.deuda_total > 0, `$${tTienda0.deuda_total}`);

// Se instala la migración (dos veces: idempotente).
const SQL = readFileSync(path.join(RAIZ, 'migrations/20261030_traslados_internos.sql'), 'utf8');
await db.exec(SQL); await db.exec(SQL);
columnas._setTrasladosInternosDisponible(true);
bodega = await req(2, 1);
ok('  con la migración pero SIN sedes propias, sigue apagado', (await service.getContexto(bodega)).traslados.activos === false);
const e2 = await service.despachar(bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 1 }] });
ok('  y despachar sigue igual', e2.tipo === 'entrega');
await service.anularRemision(bodega, e2.id);

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Reglas de ruta');
// ═════════════════════════════════════════════════════════════════════════════
const redP = { activa: true, bodega_id: 1, sedes_propias: [3, 4], traslados_rutas: 'bodega' };
ok('  bodega → propia: sí', reglas.motivoRutaInvalida(redP, 1, 3) === null);
ok('  propia → bodega: sí', reglas.motivoRutaInvalida(redP, 3, 1) === null);
ok('★ bodega → local: NO (a un local se le despacha)', /despacha/.test(reglas.motivoRutaInvalida(redP, 1, 2)));
ok('★ local → bodega: NO (devuelve por su cuenta)', /Devolver/.test(reglas.motivoRutaInvalida(redP, 2, 1)));
ok('  propia → propia con rutas «bodega»: NO', reglas.motivoRutaInvalida(redP, 3, 4) !== null);
ok('  propia → propia con «entre_sedes»: sí', reglas.motivoRutaInvalida({ ...redP, traslados_rutas: 'entre_sedes' }, 3, 4) === null);
ok('★ propia → local aun con «entre_sedes»: NO', reglas.motivoRutaInvalida({ ...redP, traslados_rutas: 'entre_sedes' }, 3, 2) !== null);
ok('  a sí misma: NO', reglas.motivoRutaInvalida(redP, 3, 3) !== null);
ok('  despachar a una propia: NO', reglas.motivoDespachoInvalido(redP, 3) !== null && reglas.motivoDespachoInvalido(redP, 2) === null);
ok('  devolver desde una propia: NO', reglas.motivoDevolucionInvalida(redP, 3) !== null && reglas.motivoDevolucionInvalida(redP, 2) === null);

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Pasar la tienda a sede propia: la cuenta se cierra en $0');
// ═════════════════════════════════════════════════════════════════════════════
e = await falla(() => traslados.validarSedesPropias(1, '[3]', { bodegaId: 1, actuales: [] }));
ok('★ Con deuda, Ajustes no la deja guardar como propia', e?.status === 409 && e.code === 'SEDE_CON_CUENTA', e?.message);
const admin = await req(1, 1);
const envAntes = num((await uno(`SELECT COUNT(*) n FROM remisiones WHERE sucursal_destino_id = 3`)).n);
const cierre = await traslados.cerrarCuenta(admin, 3, {});
ok('★ Cerrar la cuenta la deja en $0', cierre.cuenta_en_cero && cierre.total_a_pagar === 0, JSON.stringify({ t: cierre.total_a_pagar, f: cierre.saldo_a_favor }));
ok('  con UN ajuste que dice por qué', cierre.ajuste && /decisión de diseño/.test(cierre.ajuste.concepto));
ok('  y no se borró nada: los envíos siguen ahí',
  num((await uno(`SELECT COUNT(*) n FROM remisiones WHERE sucursal_destino_id = 3`)).n) === envAntes);
ok('  cerrarla otra vez no escribe nada', (await traslados.cerrarCuenta(admin, 3, {})).ya_estaba === true);
const supervisor = await req(2, 1);
ok('  solo el admin la cierra', (await falla(() => traslados.cerrarCuenta(supervisor, 3, {})))?.status === 403);
ok('  ahora Ajustes sí la acepta', await traslados.validarSedesPropias(1, '[3]', { bodegaId: 1, actuales: [] }) === '[3]');
await db.query(`INSERT INTO config_negocio VALUES (1,'red_interna_sedes_propias','[3]')`);
ok('  la Tesla Norte (sin cuenta) también se puede marcar', await traslados.validarSedesPropias(1, '[3,4]', { bodegaId: 1, actuales: [3] }) === '[3,4]');
await db.query(`UPDATE config_negocio SET valor = '[3,4]' WHERE clave = 'red_interna_sedes_propias'`);

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. Trasladar con confirmación: reserva, recepción en la HOJA, costo real');
// ═════════════════════════════════════════════════════════════════════════════
await db.query(`INSERT INTO config_negocio VALUES (1,'red_interna_traslados_confirmar','1')`);
bodega = await req(2, 1);
const caseBodega0 = await stockNodo('productos_cantidad', 1);
const caseTienda0 = await stockNodo('productos_cantidad', 3);
const t1 = await traslados.trasladar(bodega, {
  sucursal_destino_id: 3, notas: 'Reposición del viernes',
  lineas: [
    { tipo: 'serial', serial_id: 1 },
    { tipo: 'cantidad', producto_id: 1, cantidad: 5 },
    { tipo: 'cantidad', producto_id: 2, atributo_id: 1, cantidad: 4 },
  ],
});
ok('  nace como traslado en camino', t1.tipo === 'traslado' && t1.estado === 'En transito' && !t1.recibido_directo);
ok('  con su PROPIO consecutivo (T-1), no el de los envíos', Number(t1.numero) === 1);
ok('★ El valor del documento es $0', num(t1.valor_total) === 0);
let err = await intentar(`UPDATE seriales SET vendido = TRUE WHERE id = 1`);
ok('★ El IMEI en camino no se vende en la bodega', err?.code === 'RT001' && /traslado T-1/.test(err.message), err?.message);
err = await intentar(`UPDATE productos_cantidad SET stock = 4 WHERE id = 1`);
ok('★ El stock no baja de lo que va en camino (5 reservados)', err?.code === 'RT001', err?.message);
ok('  la bodega todavía tiene todo (no se descuenta hasta recibir)', await stockNodo('productos_cantidad', 1) === caseBodega0);
const enTransito = await service.getEnTransito(bodega);
ok('  el inventario lo ve «en camino» con su tipo', enTransito.seriales.some((s) => s.serial_id === 1 && s.tipo === 'traslado'));
e = await falla(() => service.despachar(bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: caseBodega0 - 4 }] }));
ok('★ Un despacho no puede llevarse lo que va en el traslado', e?.code === 'STOCK_COMPROMETIDO', e?.message);

const tienda = await req(3, 3);  // vendedor de la tienda
const costoAntes = num((await uno(`SELECT costo_unitario FROM productos_cantidad WHERE id = 3`)).costo_unitario);
const stockTiendaAntes = await stockNodo('productos_cantidad', 3);
await service.recibir(tienda, t1.id, {});
ok('★ Recibir lo mueve: el IMEI ya es de la tienda', await sucursalDelSerial(1) === 3);
ok('  y conserva su costo de compra', num((await uno('SELECT costo_compra FROM seriales WHERE id = 1')).costo_compra) === 1000001);
ok('  la bodega bajó 5 cases y la tienda subió 5',
  await stockNodo('productos_cantidad', 1) === caseBodega0 - 5 && await stockNodo('productos_cantidad', 3) === caseTienda0 + 5);
const costoDespues = num((await uno(`SELECT costo_unitario FROM productos_cantidad WHERE id = 3`)).costo_unitario);
ok('★ El costo de la tienda es el promedio con el costo REAL (10.000), no un precio',
  Math.abs(costoDespues - (stockTiendaAntes * costoAntes + 5 * 10000) / (stockTiendaAntes + 5)) < 1, `${costoAntes} → ${costoDespues}`);
const correaTienda = await uno(`SELECT id FROM productos_cantidad WHERE sucursal_id = 3 AND nombre = 'Correa'`);
ok('  la correa no existía en la tienda: se creó la referencia', !!correaTienda);
const talla = await uno(`SELECT stock, costo_unitario FROM atributos_producto WHERE producto_id = $1 AND valor = '38MM'`, [correaTienda.id]);
ok('★ Llegó a la TALLA (38MM: 4) con el costo de esa talla', num(talla.stock) === 4 && num(talla.costo_unitario) === 14000);
const sumaTallas = async (pid) => num((await uno(`SELECT COALESCE(SUM(stock),0) s FROM atributos_producto WHERE producto_id = $1 AND activo`, [pid])).s);
ok('  y el producto de la tienda = Σ tallas', await stockNodo('productos_cantidad', correaTienda.id) === await sumaTallas(correaTienda.id));
ok('  en la bodega la 38MM bajó a 6 y el producto = Σ tallas',
  await stockNodo('atributos_producto', 1) === 6 && await stockNodo('productos_cantidad', 2) === await sumaTallas(2));
const hist = await uno(`SELECT notas FROM historial_stock_cantidad WHERE producto_id = 1 AND cantidad = -5 ORDER BY id DESC LIMIT 1`);
ok('  el historial dice «Traslado T-1»', /Traslado T-1/.test(hist?.notas || ''), hist?.notas);

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. ★ Un traslado no genera cuenta, ni venta de la bodega, ni despacho');
// ═════════════════════════════════════════════════════════════════════════════
const tTienda = await totalesDe(3);
ok('★ La cuenta de la tienda sigue en $0', tTienda.deuda_total === 0 && tTienda.total_a_pagar === 0 && tTienda.saldo_a_favor === 0,
  JSON.stringify({ d: tTienda.deuda_total, f: tTienda.saldo_a_favor }));
const cargoT1 = await uno(`SELECT COALESCE(SUM(cargo),0) c FROM (${repo.SQL_CARGO_ENVIO}) x WHERE remision_id = $1`, [t1.id]);
ok('★ Aunque se sume sin filtrar el tipo, el traslado aporta $0 de cargo', num(cargoT1.c) === 0);
const envios = await db.query(`SELECT * FROM (${repo.SQL_ENVIOS_CUENTA}) x WHERE remision_id = $3`, [1, 3, t1.id]).catch(() => ({ rows: [] }));
ok('  no aparece entre los envíos de la cuenta', envios.rows.length === 0);
const ctxDesp = await despachosFac.contextoDespachos({ user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1 });
const desp = await despachosFac.listarDespachos(ctxDesp, { limit: 200 });
ok('  ni en los despachos del historial de facturas', Array.isArray(desp) && desp.length > 0 && !desp.some((d) => Number(d.id) === Number(t1.id)), `${desp?.length} despachos`);
const listaEnvios = await repo.findRemisiones(1, { sucursalId: 3, rol: 'destino' });
ok('  la bandeja de envíos del local no lo mezcla', !listaEnvios.some((r) => Number(r.id) === Number(t1.id)));
const det = await service.getRemision(admin, t1.id);
ok('  su detalle no deja editar ni corregir valores', det.puede_editar_valores === false && det.puede_corregir === false);
e = await falla(() => service.corregirValorLinea(bodega, det.lineas[0].id, { valor_nuevo: 5000, motivo: 'x' }));
ok('★ Corregir el valor de una línea de traslado se rechaza', e?.status === 409, e?.message);

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Sin confirmación: entra directo');
// ═════════════════════════════════════════════════════════════════════════════
await db.query(`DELETE FROM config_negocio WHERE clave = 'red_interna_traslados_confirmar'`);
bodega = await req(2, 1);
const [cb2, ct2] = [await stockNodo('productos_cantidad', 1), await stockNodo('productos_cantidad', 3)];
const t2 = await traslados.trasladar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'serial', serial_id: 2 }, { tipo: 'cantidad', producto_id: 1, cantidad: 3 }] });
ok('★ Ausente el opt-in, el traslado llega recibido', t2.recibido_directo === true && t2.estado === 'Recibida');
ok('  el IMEI ya está en la tienda', await sucursalDelSerial(2) === 3);
ok('  y el stock ya se movió (3 cases)', await stockNodo('productos_cantidad', 1) === cb2 - 3 && await stockNodo('productos_cantidad', 3) === ct2 + 3);
ok('  consecutivo T-2', Number(t2.numero) === 2);

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. Faltantes y anular');
// ═════════════════════════════════════════════════════════════════════════════
await db.query(`INSERT INTO config_negocio VALUES (1,'red_interna_traslados_confirmar','1')`);
bodega = await req(2, 1);
const t3 = await traslados.trasladar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'serial', serial_id: 3 }, { tipo: 'serial', serial_id: 4 }] });
const lin3 = await repo.getLineasRemision(t3.id);
const r3 = await service.recibir(tienda, t3.id, { lineas_recibidas: [Number(lin3[0].id)] });
ok('  recibe 1 de 2: queda Parcial', r3.estado === 'Parcial' && r3.faltantes === 1);
ok('★ El que no llegó sigue en la bodega y se vende libre',
  await sucursalDelSerial(4) === 1 && !(await intentar(`UPDATE seriales SET vendido = FALSE WHERE id = 4`)));
const t4 = await traslados.trasladar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 2 }] });
const otra = await req(2, 3); // un supervisor parado en la tienda no lo anula
e = await falla(() => traslados.anular({ ...otra, user: { ...otra.user, rol: 'supervisor' } }, t4.id));
ok('  solo el origen lo anula', e?.status === 403);
const cb4 = await stockNodo('productos_cantidad', 1);
ok('  antes de anular, no se puede bajar a 1', (await intentar(`UPDATE productos_cantidad SET stock = 1 WHERE id = 1`))?.code === 'RT001');
await traslados.anular(bodega, t4.id);
ok('★ Anular libera la reserva', !(await intentar(`UPDATE productos_cantidad SET stock = 1 WHERE id = 1`)));
await db.query(`UPDATE productos_cantidad SET stock = $1 WHERE id = 1`, [cb4]);

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Los candados de ruta');
// ═════════════════════════════════════════════════════════════════════════════
e = await falla(() => service.despachar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 1 }] }));
ok('★ Despachar a la sede propia → 409 SEDE_PROPIA', e?.status === 409 && e.code === 'SEDE_PROPIA', e?.message);
e = await falla(() => service.devolver(tienda, { lineas: [{ tipo: 'serial', serial_id: 1 }] }));
ok('★ Devolver por cuenta desde la sede propia → 409', e?.status === 409 && e.code === 'SEDE_PROPIA');
e = await falla(() => traslados.trasladar(bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 1 }] }));
ok('★ Trasladar a un local → 409', e?.status === 409 && e.code === 'RUTA_TRASLADO', e?.message);
const bunny = await req(4, 2);
e = await falla(() => traslados.trasladar(bunny, { sucursal_destino_id: 1, lineas: [{ tipo: 'serial', serial_id: 12 }] }));
ok('★ Un local no traslada a la bodega (devuelve por su cuenta)', e?.status === 409);
e = await falla(async () => traslados.trasladar(await req(3, 3), { sucursal_destino_id: 4, lineas: [{ tipo: 'serial', serial_id: 1 }] }));
ok('  propia → propia con rutas «bodega» → 409', e?.status === 409);
await db.query(`INSERT INTO config_negocio VALUES (1,'red_interna_traslados_rutas','entre_sedes')`);
const tEntre = await traslados.trasladar(await req(3, 3), { sucursal_destino_id: 4, lineas: [{ tipo: 'serial', serial_id: 1 }] });
ok('  con «entre_sedes» sí', tEntre.tipo === 'traslado');
await traslados.anular(await req(3, 3), tEntre.id);
await db.query(`DELETE FROM config_negocio WHERE clave = 'red_interna_traslados_rutas'`);
ok('  Bunny sigue recibiendo despachos', (await service.despachar(await req(2, 1), {
  sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 1 }] })).tipo === 'entrega');

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. Un equipo que fue y volvió se puede volver a despachar');
// ═════════════════════════════════════════════════════════════════════════════
const vuelta = await traslados.trasladar(await req(3, 3), { sucursal_destino_id: 1, lineas: [{ tipo: 'serial', serial_id: 1 }] });
await service.recibir(await req(2, 1), vuelta.id, {});
ok('  el IMEI-1 volvió a la bodega', await sucursalDelSerial(1) === 1);
const re = await falla(async () => service.despachar(await req(2, 1), { sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: 1 }] }));
ok('★ …y se despacha a Bunny (el traslado recibido no lo ata)', re === null, re?.message);

// ═════════════════════════════════════════════════════════════════════════════
seccion('10. El equipo que llegó por DESPACHO cuando la tienda era local');
// ═════════════════════════════════════════════════════════════════════════════
ok('  IMEI-11 está en la tienda con su envío viejo vivo', await sucursalDelSerial(11) === 3);
const prep = await traslados.resolver(await req(3, 3), [{ tipo: 'serial', serial_id: 11 }]);
ok('  la pantalla lo ofrece (no lo descarta)', prep.items.length === 1 && prep.descartados.length === 0, JSON.stringify(prep.descartados));
const deudaAntes = await totalesDe(3);
const tViejo = await traslados.trasladar(await req(3, 3), { sucursal_destino_id: 1, lineas: [{ tipo: 'serial', serial_id: 11 }] });
await service.recibir(await req(2, 1), tViejo.id, {});
const deudaDesp = await totalesDe(3);
ok('★ Sale por traslado y la cuenta NO se mueve', deudaDesp.deuda_total === deudaAntes.deuda_total && deudaDesp.saldo_a_favor === 0,
  JSON.stringify({ antes: deudaAntes.deuda_total, despues: deudaDesp.deuda_total, favor: deudaDesp.saldo_a_favor }));
const ajusteComp = await uno(`SELECT concepto FROM movimientos_cuenta_interna WHERE sucursal_id = 3 AND concepto LIKE 'Traslado T-%' ORDER BY id DESC LIMIT 1`);
ok('  con rastro de por qué', /IMEI-11/.test(ajusteComp?.concepto || ''), ajusteComp?.concepto);
const re2 = await falla(async () => service.despachar(await req(2, 1), { sucursal_destino_id: 2, lineas: [{ tipo: 'serial', serial_id: 11 }] }));
ok('★ …y la bodega lo puede volver a despachar', re2 === null, re2?.message);

// ═════════════════════════════════════════════════════════════════════════════
seccion('11. ★ Ningún costo ni precio viaja a quien no debe');
// ═════════════════════════════════════════════════════════════════════════════
const CLAVES_PLATA = /costo|precio|valor|subtotal|liquidable/i;
const claves = (o, acc = new Set()) => {
  if (Array.isArray(o)) o.forEach((x) => claves(x, acc));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.add(k); claves(v, acc); }
  return acc;
};
bodega = await req(2, 1);
const res = await traslados.resolver(bodega, [{ tipo: 'serial', serial_id: 5 }, { tipo: 'cantidad', producto_id: 1, cantidad: 2 }, { tipo: 'cantidad', producto_id: 2, cantidad: 1 }]);
ok('★ Preparar el traslado no manda ni costo ni precio', ![...claves(res)].some((k) => CLAVES_PLATA.test(k)), [...claves(res)].filter((k) => CLAVES_PLATA.test(k)).join(','));
ok('  el producto con tallas pide la talla (no se descarta)', res.sin_variante.length === 1 && res.sin_variante[0].producto_id === 2);
const bus = await traslados.buscar(bodega, 'CASE01');
const busT = await traslados.buscar(bodega, 'corr');
ok('★ El buscador tampoco', ![...claves(bus), ...claves(busT)].some((k) => CLAVES_PLATA.test(k)));
ok('  el código exacto agrega directo y el texto da opciones en la HOJA',
  bus.item?.producto_id === 1 && busT.opciones?.length === 2 && busT.opciones.every((o) => o.atributo_id));
const detV = await traslados.detalle(tienda, t1.id);
ok('★ El detalle para el vendedor no trae el costo', ![...claves(detV)].some((k) => CLAVES_PLATA.test(k)));
const detA = await traslados.detalle(await req(1, 1), t1.id);
ok('  el admin sí ve lo que costó lo trasladado', detA.valor_costo > 0 && detA.lineas.every((l) => 'costo_origen' in l));
const panelT = await traslados.panel(tienda);
ok('  el panel de la tienda no trae plata', ![...claves(panelT)].some((k) => CLAVES_PLATA.test(k)));
e = await falla(() => traslados.detalle(bunny, t1.id));
ok('  un local no ve los traslados de otros', e?.status === 403);

// ═════════════════════════════════════════════════════════════════════════════
seccion('12. Contexto, permisos e idempotencia');
// ═════════════════════════════════════════════════════════════════════════════
const ctxB = await service.getContexto(bodega);
ok('  la bodega puede trasladar a la tienda y a Norte', ctxB.traslados.activos && ctxB.traslados.destinos.map((s) => s.id).join() === '3,4');
const ctxT = (await service.getContexto(await req(3, 3))).traslados;
ok('  la tienda es sede propia y su destino es la bodega', ctxT.es_sede_propia && ctxT.destinos.map((s) => s.id).join() === '1');
ok('★ El vendedor sin el módulo «Traslados» no puede trasladar', ctxT.puede_trasladar === false);
const ctxTv = (await service.getContexto(await req(3, 3, ['inventario', 'red_interna', 'traslados']))).traslados;
ok('  con el módulo marcado en Ajustes → Usuarios, sí', ctxTv.puede_trasladar === true);
ok('  el supervisor de la bodega lo trae por defecto', ctxB.traslados.puede_trasladar === true);
ok('  Bunny no es sede propia y no tiene destinos', (await service.getContexto(bunny)).traslados.destinos.length === 0);
const clave = 'trasl-prueba-1';
const a1 = await traslados.trasladar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 1 }], clave_idempotencia: clave });
const a2 = await traslados.trasladar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 1 }], clave_idempotencia: clave });
ok('★ El doble clic devuelve el MISMO traslado', a2.repetido === true && Number(a2.id) === Number(a1.id));
e = await falla(() => traslados.trasladar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'serial', serial_id: 6 }, { tipo: 'serial', serial_id: 6 }] }));
ok('  el mismo IMEI dos veces se rechaza', e?.status === 400);
e = await falla(() => traslados.trasladar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad: 1 }] }));
ok('  un producto con tallas sin talla → se pide la variante', e && /variante|talla/i.test(e.message || ''), e?.message);

// ═════════════════════════════════════════════════════════════════════════════
seccion('13. Validación de Ajustes');
// ═════════════════════════════════════════════════════════════════════════════
e = await falla(() => traslados.validarSedesPropias(1, '[1]', { bodegaId: 1 }));
ok('  la bodega no puede ser sede propia', e?.status === 400);
e = await falla(() => traslados.validarSedesPropias(1, '[99]', { bodegaId: 1 }));
ok('  una sede de otro negocio no entra', e?.status === 400);
e = await falla(() => traslados.validarSedesPropias(1, '[2]', { bodegaId: 1, actuales: [3, 4] }));
ok('★ Bunny (con cuenta abierta) no se puede volver propia', e?.status === 409, e?.message);
ok('  quitar sedes de la lista siempre se puede', await traslados.validarSedesPropias(1, '[]', { bodegaId: 1, actuales: [3, 4] }) === '[]');
const estado = await traslados.estadoSedes(await req(1, 1));
const fila = (id) => estado.sedes.find((s) => s.sucursal_id === id);
ok('  el estado de Ajustes marca la tienda como propia y Bunny con deuda',
  fila(3).es_propia && !fila(2).es_propia && fila(2).total_a_pagar > 0 && !fila(2).lista);

// ═════════════════════════════════════════════════════════════════════════════
seccion('14. ★ Nombre PARECIDO: se pregunta antes de duplicar el catálogo');
// ═════════════════════════════════════════════════════════════════════════════
// La bodega tiene «Cargador iPhone 20W» y la tienda lo tiene escrito
// «Cargador 20W iPhone - Apple»; la funda no tiene nada parecido en la tienda.
await db.exec(`
  INSERT INTO productos_cantidad (nombre, precio, costo_unitario, stock, sucursal_id, linea_id)
    VALUES ('Cargador iPhone 20W', 30000, 9000, 10, 1, 2),
           ('Cargador 20W iPhone - Apple', 32000, 9500, 1, 3, 2),
           ('Funda MagSafe', 50000, 20000, 5, 1, 2);
`);
const cargB = num((await uno(`SELECT id FROM productos_cantidad WHERE sucursal_id = 1 AND nombre = 'Cargador iPhone 20W'`)).id);
const cargT = num((await uno(`SELECT id FROM productos_cantidad WHERE sucursal_id = 3 AND nombre = 'Cargador 20W iPhone - Apple'`)).id);
const fundaB = num((await uno(`SELECT id FROM productos_cantidad WHERE sucursal_id = 1 AND nombre = 'Funda MagSafe'`)).id);
bodega = await req(2, 1);
const prev = await traslados.previsualizar(bodega, {
  sucursal_destino_id: 3,
  lineas: [
    { tipo: 'cantidad', producto_id: cargB }, { tipo: 'cantidad', producto_id: fundaB },
    { tipo: 'cantidad', producto_id: 1 },          // el case: mismo código → seguro
  ],
});
const pCarg = prev.items.find((x) => x.producto_id === cargB);
ok('★ El cargador se marca como PARECIDO, no se asume', pCarg?.nivel === 'similar' && !pCarg.seguro);
ok('  y sugiere el de la tienda', pCarg?.sugerencias?.[0]?.id === cargT, JSON.stringify(pCarg?.sugerencias));
ok('  la funda no tiene nada parecido: nueva', prev.items.find((x) => x.producto_id === fundaB)?.nivel === 'nuevo');
ok('  el case (mismo código) se resuelve solo', prev.items.find((x) => x.producto_id === 1)?.seguro === true);
ok('  hay que confirmar antes de trasladar', prev.requiere_confirmacion === true && prev.dudosos === 2);
ok('★ La revisión no trae costo ni precio', ![...claves(prev)].some((k) => CLAVES_PLATA.test(k)),
  [...claves(prev)].filter((k) => CLAVES_PLATA.test(k)).join(','));
e = await falla(() => traslados.previsualizar(bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: cargB }] }));
ok('  la revisión respeta la ruta (no hacia un local)', e?.status === 409);
e = await falla(() => traslados.previsualizar(bodega, { sucursal_destino_id: 3, lineas: [{ tipo: 'cantidad', producto_id: cargT }] }));
ok('  ni revisa productos que no son de esta sucursal', e?.status === 404);
const refs = await traslados.referenciasDestino(bodega, { sucursalId: 3, tipo: 'cantidad', q: 'cargador' });
ok('  «Buscar otra» trae el catálogo de la tienda, sin plata',
  refs.some((r) => Number(r.id) === cargT) && ![...claves(refs)].some((k) => CLAVES_PLATA.test(k)));

const nCargAntes = num((await uno(`SELECT COUNT(*) n FROM productos_cantidad WHERE sucursal_id = 3 AND nombre ILIKE '%cargador%'`)).n);
const tElegido = await traslados.trasladar(bodega, {
  sucursal_destino_id: 3,
  lineas: [{ tipo: 'cantidad', producto_id: cargB, cantidad: 2, producto_destino_id: cargT }],
});
await service.recibir(tienda, tElegido.id, {});
ok('★★ Eligiendo el de la tienda, NO se duplica: llega a ese mismo producto',
  num((await uno(`SELECT COUNT(*) n FROM productos_cantidad WHERE sucursal_id = 3 AND nombre ILIKE '%cargador%'`)).n) === nCargAntes
  && await stockNodo('productos_cantidad', cargT) === 3);
const tNueva = await traslados.trasladar(bodega, {
  sucursal_destino_id: 3, lineas: [{ tipo: 'cantidad', producto_id: fundaB, cantidad: 1 }],
});
await service.recibir(tienda, tNueva.id, {});
ok('  «Crear nueva» (sin destino) crea la referencia como siempre',
  !!(await uno(`SELECT id FROM productos_cantidad WHERE sucursal_id = 3 AND nombre = 'Funda MagSafe'`)));

// El despacho usa la misma cascada: también pregunta por lo parecido.
await db.exec(`INSERT INTO productos_cantidad (nombre, precio, costo_unitario, stock, sucursal_id, linea_id)
  VALUES ('Cargador 20W iPhone (Apple)', 32000, 9500, 0, 2, 2)`);
const prevD = await service.previsualizarDestino(bodega, { sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: cargB }] });
ok('  el DESPACHO también sugiere el parecido del local', prevD.items[0].nivel === 'similar' && prevD.items[0].sugerencias.length === 1);

console.log(`\n${pasados} verificaciones pasaron · ${fallos.length} fallaron`);
if (fallos.length) { console.log('Fallaron:\n  - ' + fallos.join('\n  - ')); process.exit(1); }
