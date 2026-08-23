// ─────────────────────────────────────────────────────────────────────────────
// EL DESPACHO NO DEBE CREAR REFERENCIAS DUPLICADAS
//
// Caso reportado: la bodega tiene "iPad 10 64GB" (cód. IPAD10) y el local tiene
// EL MISMO iPad escrito distinto, "iPad 10ma gen 64GB", con el mismo código.
// El despacho creaba una tercera fila, sin código, que el lector no encontraba;
// y al intentar corregirle el código saltaba un 409.
//
// Aquí se prueba la cascada: código → nombre+línea → parecido → preguntar.
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

const service    = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const repo       = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const svcCantidad= require(path.join(RAIZ, 'src/modules/productos/productosCantidad.service.js'));
const busqueda   = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.repository.js'));

let fallos = 0, pasados = 0;
const q = async (s, p = []) => (await db.query(s, p)).rows;
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
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Tablets'),(1,'Accesorios');

  -- BODEGA
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, linea_id, codigo) VALUES
    ('iPad 10 64GB',     20, 1200000, 1800000, 1, 1, 'IPAD10'),   -- id 1
    ('Vidrio templado',  60,    3000,   12000, 1, 2, 'VID-01'),   -- id 2
    ('Manilla soporte',  30,    2000,    8000, 1, 2, NULL);       -- id 3 (sin código)

  -- CENTRO: el MISMO iPad escrito distinto, con el mismo código.
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, linea_id, codigo) VALUES
    ('iPad 10ma gen 64GB', 3, 1200000, 1850000, 2, 1, 'IPAD10'),  -- id 4
    ('Vidrio  Templado ',  5,    3100,   12500, 2, 2, NULL);      -- id 5 (nombre sucio, sin código)

  -- Equipos seriales
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id) VALUES
    ('iPhone 13','Apple','128GB', 2600000, 1, 1),   -- id 1 Bodega
    ('iPhone 13','apple','128 gb', 2750000, 2, 1);  -- id 2 Centro (escrito sucio)
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (1,'AAA111',1800000);

  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']),(1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
`);

const bodega = { user:{id:1,negocio_id:1,rol:'admin_negocio'}, sucursal_id:1, esBodega:true,
  red:{activa:true,bodega_id:1,confirmar_recepcion:true,confirmar_remesa:true} };
const centro = { user:{id:1,negocio_id:1,rol:'vendedor'}, sucursal_id:2, esBodega:false, red:{...bodega.red} };

const filas = async () => (await q(`SELECT COUNT(*)::int c FROM productos_cantidad`))[0].c;
const filasSerial = async () => (await q(`SELECT COUNT(*)::int c FROM productos_serial`))[0].c;

console.log('\n═══ 1. Previsualizar: el sistema dice a dónde va cada cosa ═══');
const prev = await service.previsualizarDestino(bodega, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'cantidad', producto_id: 1, cantidad: 5 },   // iPad — match por CÓDIGO
    { tipo: 'cantidad', producto_id: 2, cantidad: 10 },  // Vidrio — match por NOMBRE sucio
    { tipo: 'cantidad', producto_id: 3, cantidad: 4 },   // Manilla — no existe allá
    { tipo: 'serial',   serial_id: 1 },                  // iPhone — nombre/marca/modelo sucios
  ],
});
const porNombre = (n) => prev.items.find((i) => i.nombre_origen === n);
ok('★ El iPad se resuelve por CÓDIGO', porNombre('iPad 10 64GB').nivel === 'codigo',
   `→ "${porNombre('iPad 10 64GB').destino?.nombre}"`);
ok('★ El vidrio se resuelve por NOMBRE pese a espacios y mayúsculas',
   porNombre('Vidrio templado').nivel === 'exacto',
   `→ "${porNombre('Vidrio templado').destino?.nombre}"`);
ok('★ La manilla se marca como referencia NUEVA',
   porNombre('Manilla soporte').nivel === 'nuevo');
ok('★ El iPhone se resuelve pese a "apple"/"128 gb"',
   porNombre('iPhone 13').nivel === 'exacto',
   `→ prod #${porNombre('iPhone 13').destino?.id}`);
ok('  Solo 1 producto queda en duda (el nuevo)', prev.dudosos === 1);

console.log('\n═══ 2. Despachar y recibir: cero duplicados ═══');
const antesC = await filas(), antesS = await filasSerial();
const r1 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'cantidad', producto_id: 1, cantidad: 5 },
    { tipo: 'cantidad', producto_id: 2, cantidad: 10 },
    { tipo: 'serial',   serial_id: 1 },
  ],
});
const l1 = await repo.getLineasRemision(r1.id);
await service.recibir(centro, r1.id, { lineas_recibidas: l1.map((x) => Number(x.id)) });

const despues = await q(`SELECT id, sucursal_id, nombre, stock, codigo FROM productos_cantidad ORDER BY id`);
for (const p of despues) console.log(`   #${p.id} suc${p.sucursal_id} "${p.nombre}" stock ${p.stock} cod ${p.codigo ?? '—'}`);

ok('★ NO se creó ninguna referencia de cantidad nueva', await filas() === antesC,
   `${antesC} → ${await filas()}`);
ok('★ NO se creó ninguna referencia serial nueva', await filasSerial() === antesS);
ok('★ El iPad cayó en la fila que YA existía (id 4)',
   Number(despues.find((p) => p.id === 4).stock) === 8, 'era 3, ahora 8');
ok('★ El vidrio cayó en la fila sucia que ya existía (id 5)',
   Number(despues.find((p) => p.id === 5).stock) === 15, 'era 5, ahora 15');
const serialMovido = await q(
  `SELECT ps.id, ps.sucursal_id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id WHERE s.imei='AAA111'`);
ok('★ El iPhone cayó en la referencia sucia de Centro (id 2)', serialMovido[0].id === 2);

console.log('\n═══ 3. El lector sigue funcionando en el local ═══');
const escaneo = await busqueda.buscarCantidadPorCodigo('IPAD10', 1, 2);
ok('★ Escanear IPAD10 en Centro encuentra el producto', escaneo?.[0]?.id === 4);
ok('★ Con el stock ya sumado (8)', Number(escaneo?.[0]?.stock) === 8);

console.log('\n═══ 4. Lo que SÍ es nuevo se crea heredando el código ═══');
// La manilla no existe en Centro. Se despacha: debe crearse UNA vez.
await db.exec(`UPDATE productos_cantidad SET codigo = 'MAN-01' WHERE id = 3`);
const r2 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 3, cantidad: 4 }],
});
const l2 = await repo.getLineasRemision(r2.id);
await service.recibir(centro, r2.id, { lineas_recibidas: l2.map((x) => Number(x.id)) });

const manilla = await q(
  `SELECT id, nombre, stock, codigo FROM productos_cantidad WHERE sucursal_id = 2 AND nombre = 'Manilla soporte'`);
ok('★ Se creó la referencia (no existía)', manilla.length === 1);
ok('★ Y NACIÓ CON CÓDIGO — el lector la encuentra', manilla[0].codigo === 'MAN-01',
   `cod ${manilla[0].codigo ?? '—'}`);
const escaneoManilla = await busqueda.buscarCantidadPorCodigo('MAN-01', 1, 2);
ok('★ Escanearla en Centro funciona', escaneoManilla?.[0]?.id === manilla[0].id);

console.log('\n═══ 5. Despachar la misma manilla otra vez NO vuelve a crear ═══');
const n1 = await filas();
const r3 = await service.despachar(bodega, {
  sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 3, cantidad: 6 }],
});
const l3 = await repo.getLineasRemision(r3.id);
await service.recibir(centro, r3.id, { lineas_recibidas: l3.map((x) => Number(x.id)) });
ok('★ Sin filas nuevas', await filas() === n1);
const manilla2 = await q(`SELECT stock FROM productos_cantidad WHERE id = $1`, [manilla[0].id]);
ok('★ Solo se sumó el stock (4 → 10)', Number(manilla2[0].stock) === 10);

console.log('\n═══ 6. Ya no salta el 409 al ponerle el código ═══');
// El bug original: había una fila duplicada sin código y darle el código chocaba.
// Como ya no se duplica, el escenario no puede ocurrir. Se comprueba que ninguna
// sucursal tiene dos filas del mismo producto lógico.
const dups = await q(`
  SELECT sucursal_id, LOWER(TRIM(nombre)) n, COUNT(*)::int c
  FROM productos_cantidad WHERE activo GROUP BY 1,2 HAVING COUNT(*) > 1`);
ok('★ Ninguna sucursal tiene el mismo producto repetido', dups.length === 0,
   dups.map((d) => `suc${d.sucursal_id}:${d.n}×${d.c}`).join(' '));
const sinCodigo = await q(`
  SELECT COUNT(*)::int c FROM productos_cantidad pc
  WHERE pc.sucursal_id = 2 AND pc.activo AND pc.codigo IS NULL
    AND EXISTS (SELECT 1 FROM productos_cantidad o
                WHERE o.sucursal_id = 1 AND o.codigo IS NOT NULL
                  AND LOWER(TRIM(o.nombre)) = LOWER(TRIM(pc.nombre)))`);
ok('★ Ninguna referencia del local quedó muda teniendo código en bodega',
   sinCodigo[0].c === 0);

console.log('\n═══ 7. El usuario puede forzar el destino a mano ═══');
// Aunque la cascada resolvería sola, si el usuario elige otra referencia manda.
await db.exec(`INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, linea_id)
               VALUES ('Vidrio premium', 0, 4000, 15000, 2, 2)`);
const otro = (await q(`SELECT id FROM productos_cantidad WHERE nombre='Vidrio premium'`))[0].id;
const r4 = await service.despachar(bodega, {
  sucursal_destino_id: 2,
  lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad: 3, producto_destino_id: otro }],
});
const l4 = await repo.getLineasRemision(r4.id);
ok('★ La elección del usuario queda guardada en la línea',
   Number(l4[0].producto_destino_id) === otro);
await service.recibir(centro, r4.id, { lineas_recibidas: l4.map((x) => Number(x.id)) });
const premium = await q(`SELECT stock FROM productos_cantidad WHERE id = $1`, [otro]);
ok('★ Y el stock entró donde el usuario dijo', Number(premium[0].stock) === 3);

console.log('\n═══ 8. Un id de otra sucursal se rechaza ═══');
let rechazado = false;
try {
  await service.despachar(bodega, {
    sucursal_destino_id: 2,
    lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad: 1, producto_destino_id: 1 }], // id 1 es de la BODEGA
  });
} catch (e) { rechazado = e.status === 400; }
ok('★ No se acepta una referencia que no es de la sucursal destino', rechazado);

console.log(`\n${'═'.repeat(62)}`);
console.log(`RESULTADO: ${pasados} pasaron, ${fallos} fallaron`);
console.log('═'.repeat(62));
process.exit(fallos ? 1 : 0);
