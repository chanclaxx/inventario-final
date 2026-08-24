// ─────────────────────────────────────────────────────────────────────────────
// Pruebas de SEGURIDAD PARA PRODUCCIÓN.
//
// 1. Un negocio SIN el flag no debe notar absolutamente nada.
// 2. Idempotencia: doble toque no duplica plata ni mercancía.
// 3. Devolución, anulación y estados imposibles.
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
// Raíz del backend, relativa a este archivo (no depende de dónde se ejecute).
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');

const db = new PGlite();
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
// El cruce de 'a quien se presto' toca prestamos/prestatarios, que viven aqui.
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260822_red_interna_envios.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_control.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_cargos_pagables.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_remision_variantes.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_lotes_cantidad.sql'), 'utf8'));

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const service   = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo      = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const traslados = require(path.join(RAIZ, 'src/modules/traslados/traslados.service.js'));
const middleware= require(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

// ── Dos negocios: 1 CON la feature, 2 SIN ella (cliente actual) ────────────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con red'), ('Cliente actual SIN red');
  INSERT INTO sucursales (negocio_id, nombre) VALUES
    (1,'Bodega'),(1,'Centro'),
    (2,'Sede A'),(2,'Sede B');
  INSERT INTO usuarios (nombre) VALUES ('U1'),('U2');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id) VALUES
    ('iPhone 13','Apple','128GB',2600000,1),   -- id 1, bodega neg1
    ('iPhone 13','Apple','128GB',2600000,3),   -- id 2, Sede A neg2
    ('iPhone 13','Apple','128GB',2600000,4);   -- id 3, Sede B neg2
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'111111111111111',1800000),
    (1,'222222222222222',1900000),
    (2,'999999999999999',1500000);
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago) VALUES
    (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),
    (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
`);

const bodega = { user:{id:1,negocio_id:1,rol:'admin_negocio'}, sucursal_id:1, esBodega:true,
  red:{activa:true,bodega_id:1,modo_precio:'costo',confirmar_recepcion:true,confirmar_remesa:true, ocultar_costos: false } };
const centro = { user:{id:2,negocio_id:1,rol:'vendedor'}, sucursal_id:2, esBodega:false, red:{...bodega.red} };

console.log('\n═══ A. El cliente SIN el flag no nota NADA ═══');
const cfg2 = await middleware.getConfigRed(2);
ok('getConfigRed devuelve activa=false para el negocio 2', cfg2.activa === false);

// El traslado libre del negocio 2 debe seguir funcionando exactamente igual.
const tras = await traslados.ejecutarTraslado(2, 1, {
  sucursal_origen_id: 3, sucursal_destino_id: 4,
  lineas: [{ tipo: 'serial', serial_id: 3, producto_destino_id: 3 }],
});
ok('★ Traslado libre del negocio SIN red funciona igual que siempre', !!tras.id);
const movido = await q(`SELECT ps.sucursal_id FROM seriales s
  JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id=3`);
ok('  y el equipo se movió correctamente', movido[0].sucursal_id === 4);

// El negocio 1 (con red) sí lo tiene bloqueado.
let bloqueado = false;
try {
  await traslados.ejecutarTraslado(1, 1, {
    sucursal_origen_id: 1, sucursal_destino_id: 2,
    lineas: [{ tipo: 'serial', serial_id: 1, producto_destino_id: 1 }],
  });
} catch (e) { bloqueado = e.status === 409; }
ok('★ El negocio CON red sí tiene el traslado libre cerrado', bloqueado);

const filas2 = await q(`SELECT COUNT(*)::int c FROM remisiones WHERE negocio_id = 2`);
ok('★ El negocio SIN red no escribió ni una fila en las tablas nuevas', filas2[0].c === 0);

console.log('\n═══ B. Idempotencia: doble toque no duplica ═══');
const CLAVE = 'clave-fija-de-prueba';
const r1 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo:'serial', serial_id: 1 }], clave_idempotencia: CLAVE,
});
const r2 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo:'serial', serial_id: 1 }], clave_idempotencia: CLAVE,
});
ok('★ Segundo despacho devuelve la MISMA remisión', Number(r1.id) === Number(r2.id));
ok('  y viene marcado como repetido', r2.repetido === true);
const nRem = await q(`SELECT COUNT(*)::int c FROM remisiones WHERE negocio_id=1`);
ok('  solo existe una remisión', nRem[0].c === 1);

console.log('\n═══ C. Un equipo no puede estar en dos remisiones a la vez ═══');
let dupBloqueado = false;
try {
  await service.despachar(bodega, { sucursal_destino_id: 2, lineas: [{ tipo:'serial', serial_id: 1 }] });
} catch (e) { dupBloqueado = e.status === 409; }
ok('★ Bloqueado: ya está en una remisión activa', dupBloqueado);

console.log('\n═══ D. Anular una remisión en tránsito ═══');
const r3 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo:'serial', serial_id: 2 }],
});
await service.anularRemision(bodega, r3.id);
const anulada = await repo.findRemisionById(1, r3.id);
ok('★ Queda Anulada', anulada.estado === 'Anulada');
const sig = await q(`SELECT ps.sucursal_id FROM seriales s
  JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id=2`);
ok('  el equipo nunca salió de la bodega', sig[0].sucursal_id === 1);
// Y ahora sí se puede volver a despachar.
const r4 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo:'serial', serial_id: 2 }],
});
ok('★ El equipo liberado se puede volver a despachar', !!r4.id);

console.log('\n═══ E. No se puede recibir dos veces ═══');
const lin = await repo.getLineasRemision(r1.id);
await service.recibir(centro, r1.id, { lineas_recibidas: lin.map((l)=>Number(l.id)) });
let dobleRecep = false;
try {
  await service.recibir(centro, r1.id, { lineas_recibidas: lin.map((l)=>Number(l.id)) });
} catch (e) { dobleRecep = e.status === 409; }
ok('★ La segunda recepción se rechaza', dobleRecep);

console.log('\n═══ F. Un local no puede recibir la remisión de otro ═══');
const otro = { ...centro, sucursal_id: 99 };
let ajeno = false;
try { await service.recibir(otro, r4.id, {}); } catch (e) { ajeno = e.status === 403; }
ok('★ Rechazado por sucursal ajena', ajeno);

console.log('\n═══ G. Devolución local → bodega (con confirmación) ═══');
let est = await service.getPanelLocal(centro);
const antes = est.totales.en_consignacion_unidades;
const supervisorLocal = { ...centro, user: { ...centro.user, rol: 'supervisor' } };

const devol = await service.devolver(supervisorLocal, {
  lineas: [{ tipo: 'serial', serial_id: 1, nombre_producto: 'iPhone 13' }],
});
ok('★ Nace en tránsito, sin mover nada', devol.estado === 'En transito');
const enCamino = await q(`SELECT ps.sucursal_id FROM seriales s
  JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id=1`);
ok('  el equipo sigue en el local', enCamino[0].sucursal_id === 2);

// La bodega la confirma: ahí sí se mueve.
const lDev = await repo.getLineasRemision(devol.id);
await service.confirmarDevolucion(bodega, devol.id, {
  lineas_recibidas: lDev.map((x) => Number(x.id)),
});
est = await service.getPanelLocal(centro);
ok('★ Confirmada: sale de la consignación del local',
   est.totales.en_consignacion_unidades === antes - 1);
const vuelta = await q(`SELECT ps.sucursal_id FROM seriales s
  JOIN productos_serial ps ON ps.id=s.producto_id WHERE s.id=1`);
ok('  y el equipo volvió físicamente a la bodega', vuelta[0].sucursal_id === 1);
const salud = await service.getSalud(bodega);
ok('★ El devuelto NO queda como "sin ubicar"', salud.sin_ubicar.length === 0);

console.log('\n═══ H. Idempotencia de remesas (el caso que cuesta plata) ═══');
const CLAVE_R = 'remesa-fija';
const m1 = await service.enviarRemesa({...centro, user:{...centro.user, rol:'supervisor'}},
  { valor: 500000, clave_idempotencia: CLAVE_R });
const m2 = await service.enviarRemesa({...centro, user:{...centro.user, rol:'supervisor'}},
  { valor: 500000, clave_idempotencia: CLAVE_R });
ok('★ La segunda devuelve la misma remesa', Number(m1.id) === Number(m2.id));
const nMov = await q(`SELECT COUNT(*)::int c FROM movimientos_dinero WHERE categoria='traslado'`);
ok('★ Solo se movió la plata una vez (2 patas, no 4)', nMov[0].c === 2, `hay ${nMov[0].c}`);

console.log('\n═══ I. Anular remesa: nunca se borra dinero, se desactiva ═══');
await service.anularRemesa({...centro, user:{...centro.user, rol:'supervisor'}}, m1.id);
const movs = await q(`SELECT activo FROM movimientos_dinero WHERE categoria='traslado'`);
ok('★ Los movimientos siguen existiendo (huella de auditoría)', movs.length === 2);
ok('★ Pero quedan desactivados', movs.every((m) => m.activo === false));
const saldoLocal = await q(`SELECT COALESCE(SUM(CASE WHEN m.tipo='entrada' THEN m.valor ELSE -m.valor END),0) s
  FROM movimientos_dinero m JOIN cuentas_dinero c ON c.id=m.cuenta_id
  WHERE c.sucursal_id=2 AND m.activo`);
ok('  el saldo del local vuelve a cero', Number(saldoLocal[0].s) === 0);

console.log('\n═══ J. Sin cuenta de bodega definida → el módulo no existe ═══');
await db.exec(`DELETE FROM config_negocio WHERE negocio_id=1 AND clave='red_interna_activa'`);
middleware.invalidarCache(1);
const cfgOff = await middleware.getConfigRed(1);
ok('★ Al apagar el flag, el módulo queda inactivo de inmediato', cfgOff.activa === false);
// Y el traslado libre vuelve a funcionar.
const trasVuelta = await traslados.ejecutarTraslado(1, 1, {
  sucursal_origen_id: 1, sucursal_destino_id: 2,
  lineas: [{ tipo:'serial', serial_id: 1, producto_destino_id: 1 }],
}).then(() => true).catch((e) => e.status !== 409);
ok('★ Y el traslado libre se reactiva (reversible sin migrar nada)', trasVuelta);

console.log(`\n${'═'.repeat(60)}`);
console.log(`RESULTADO: ${pasados} pasaron, ${fallos} fallaron`);
console.log('═'.repeat(60));
process.exit(fallos ? 1 : 0);
