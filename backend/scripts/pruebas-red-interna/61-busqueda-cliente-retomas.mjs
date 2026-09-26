// ─────────────────────────────────────────────────────────────────────────────
// BÚSQUEDA — de quién vino el equipo (compra a cliente y retomas), contra un
// Postgres real (PGlite).
//
// Reportado desde producción (sep-2026): al buscar un IMEI que entró por COMPRA
// A CLIENTE, la ficha no decía a quién se le compró — la entrada solo sabía de
// proveedores, y a un no-admin le mostraba «Sin información de compra». Y las
// retomas se leían con `JOIN facturas`: una retoma hecha desde Préstamos (o la
// retoma directa) no aparecía en la línea de tiempo, y en Proveedores → Retomas
// salía como «Compra a cliente» sin cédula.
//
//   · Sección 1 — compra a cliente: la entrada y la ficha dicen a quién, con
//     cédula y celular, a CUALQUIER rol; el costo sigue siendo solo del admin.
//   · Sección 2 — dos clientes con el mismo nombre: no se inventa una cédula.
//   · Sección 3 — las tres puertas de la retoma en la línea de tiempo.
//   · Sección 4 — Proveedores → Retomas: la de préstamo sale como retoma con
//     su persona, y no duplicada como «compra».
//   · Sección 5 — el buscador de compras encuentra retomas por IMEI parcial.
//   · Sección 6 — aislamiento: el vecino no ve nada.
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
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
await db.exec(`
  CREATE TABLE IF NOT EXISTS lineas_compra (
    id SERIAL PRIMARY KEY, compra_id INT, producto_id INT, imei TEXT,
    nombre_producto TEXT, cantidad INT DEFAULT 1, precio_unitario NUMERIC DEFAULT 0
  );
  ALTER TABLE lineas_compra ADD COLUMN IF NOT EXISTS garantia_dias INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'Activa';
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS fecha TIMESTAMP DEFAULT NOW();
  ALTER TABLE seriales ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP DEFAULT NOW();
`);
for (const m of ['20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables', '20260823_remision_variantes',
  '20260823_lotes_cantidad', '20260824_costo_origen_remision', '20260823_valor_acreditado']) {
  await db.exec(readFileSync(path.join(RAIZ, `../migrations/${m}.sql`), 'utf8'));
}

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const busqueda   = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.service.js'));
const serialRepo = require(path.join(RAIZ, 'src/modules/productos/productosSerial.repository.js'));

let ok = 0; const fallos = [];
const seccion = (t) => console.log(`\n${t}`);
const checkEq = (nombre, real, esperado) => {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log(`  ✓ ${nombre}`); }
  else { fallos.push(nombre); console.log(`  ✗ ${nombre}\n      esperado ${b}\n      obtuvo   ${a}`); }
};
const q = async (s, p = []) => (await db.query(s, p)).rows;

// ── Datos ────────────────────────────────────────────────────────────────────
await q(`INSERT INTO negocios (id, nombre) VALUES (1, 'Tienda'), (2, 'Vecino')`);
await q(`INSERT INTO sucursales (id, negocio_id, nombre) VALUES (1, 1, 'Principal'), (2, 2, 'Vecina')`);
await q(`INSERT INTO usuarios (id, nombre) VALUES (1, 'Laura')`);
await q(`INSERT INTO clientes (id, negocio_id, nombre, cedula, celular) VALUES
  (1, 1, 'Ana Pérez',  '1010', '3001112233'),
  (2, 1, 'Carlos Ruiz','2020', '3002223344'),
  (3, 1, 'Carlos Ruiz','2021', '3009998877'),
  (4, 1, 'Dora Díaz',  '4040', '3004445566'),
  (9, 2, 'Ana Pérez',  '9999', '3999999999')`);
await q(`INSERT INTO prestatarios (id, negocio_id, nombre, cedula, telefono) VALUES
  (1, 1, 'Local Centro', '800', '6011234567')`);
await q(`INSERT INTO productos_serial (id, nombre, sucursal_id) VALUES (1, 'iPhone 11 usado', 1), (2, 'Moto G', 2)`);

// Compra a cliente: la unidad solo guarda el NOMBRE.
await q(`INSERT INTO seriales (id, producto_id, imei, costo_compra, cliente_origen, fecha_entrada)
         VALUES (1, 1, '111111111111111', 500000, 'Ana Pérez', '2026-09-01')`);
// Compra a un cliente con homónimo.
await q(`INSERT INTO seriales (id, producto_id, imei, costo_compra, cliente_origen, fecha_entrada)
         VALUES (2, 1, '222222222222222', 400000, 'Carlos Ruiz', '2026-09-02')`);
// Retoma en FACTURA (cliente escrito en la factura, sin ficha).
await q(`INSERT INTO facturas (id, numero, sucursal_id, usuario_id, nombre_cliente, cedula, celular, fecha)
         VALUES (10, 77, 1, 1, 'Beto Gómez', '3030', '3003334455', '2026-09-03 10:00')`);
await q(`INSERT INTO retomas (id, factura_id, imei, nombre_producto, valor_retoma, ingreso_inventario)
         VALUES (1, 10, '333333333333333', 'iPhone 11', 300000, true)`);
await q(`INSERT INTO seriales (id, producto_id, imei, costo_compra, cliente_origen, fecha_entrada)
         VALUES (3, 1, '333333333333333', 300000, 'Beto Gómez', '2026-09-03')`);
// Retoma contra un PRÉSTAMO de un cliente (con ficha).
await q(`INSERT INTO prestamos (id, numero, sucursal_id, usuario_id, prestatario, cedula, telefono, cliente_id, fecha)
         VALUES (20, 5, 1, 1, 'Dora Díaz', '4040', NULL, 4, '2026-08-01 09:00')`);
await q(`INSERT INTO retomas (id, prestamo_id, imei, nombre_producto, valor_retoma, ingreso_inventario, fecha)
         VALUES (2, 20, '444444444444444', 'Galaxy A12', 200000, true, '2026-09-04 11:00')`);
await q(`INSERT INTO seriales (id, producto_id, imei, costo_compra, cliente_origen, fecha_entrada)
         VALUES (4, 1, '444444444444444', 200000, 'Dora Díaz', '2026-09-04')`);
// Retoma DIRECTA a un compañero.
await q(`INSERT INTO retomas (id, imei, nombre_producto, valor_retoma, ingreso_inventario, tipo_persona, persona_id, sucursal_id, fecha)
         VALUES (3, '555555555555555', 'Redmi 9', 150000, true, 'prestatario', 1, 1, '2026-09-05 12:00')`);
// El vecino tiene un IMEI parecido y una compra a SU Ana Pérez.
await q(`INSERT INTO seriales (id, producto_id, imei, costo_compra, cliente_origen)
         VALUES (9, 2, '111111111111119', 1, 'Ana Pérez')`);

const entrada = (r) => r.historial.find((h) => h.tipo === 'entrada');
const retomasDe = (r) => r.historial.filter((h) => h.tipo === 'retoma');

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Compra a cliente: la ficha dice a quién');
{
  const adm = await busqueda.buscarPorIMEI('111111111111111', 1, 'admin_negocio');
  checkEq('la entrada es una compra a cliente', entrada(adm).detalle.origen, 'cliente');
  checkEq('  con su nombre', entrada(adm).detalle.cliente, 'Ana Pérez');
  checkEq('  su cédula (de la ficha)', entrada(adm).detalle.cliente_cedula, '1010');
  checkEq('  y su celular', entrada(adm).detalle.cliente_celular, '3001112233');
  checkEq('la tarjeta del serial también', [adm.serial.cliente_origen, adm.serial.cliente_origen_cedula], ['Ana Pérez', '1010']);
  checkEq('el admin ve el costo', Number(entrada(adm).detalle.costo_compra), 500000);

  const ven = await busqueda.buscarPorIMEI('111111111111111', 1, 'vendedor');
  checkEq('★ el vendedor también ve a quién se le compró', entrada(ven).detalle.cliente, 'Ana Pérez');
  checkEq('  con cédula', entrada(ven).detalle.cliente_cedula, '1010');
  checkEq('el vendedor NO ve el costo', entrada(ven).detalle.costo_compra, undefined);
  checkEq('  ni en la tarjeta', ven.serial.costo_compra, undefined);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Homónimos: no se inventa una cédula');
{
  const r = await busqueda.buscarPorIMEI('222222222222222', 1, 'admin_negocio');
  checkEq('el nombre sí', entrada(r).detalle.cliente, 'Carlos Ruiz');
  checkEq('★ la cédula no (hay dos fichas con ese nombre)', entrada(r).detalle.cliente_cedula, null);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Las tres puertas de la retoma en la línea de tiempo');
{
  const f = await busqueda.buscarPorIMEI('333333333333333', 1, 'vendedor');
  const rf = retomasDe(f);
  checkEq('retoma de FACTURA: una', rf.length, 1);
  checkEq('  con cliente, cédula y celular de la factura',
    [rf[0].detalle.cliente, rf[0].detalle.cedula, rf[0].detalle.celular], ['Beto Gómez', '3030', '3003334455']);
  checkEq('  y el número de la factura', [rf[0].detalle.origen, rf[0].detalle.factura_numero], ['factura', 77]);
  checkEq('  quién la registró', rf[0].detalle.usuario, 'Laura');
  checkEq('la entrada se reconoce como entrada POR retoma', entrada(f).detalle.origen, 'retoma');
  checkEq('  con la cédula de la retoma', entrada(f).detalle.cliente_cedula, '3030');

  const p = await busqueda.buscarPorIMEI('444444444444444', 1, 'admin_negocio');
  const rp = retomasDe(p);
  checkEq('★ retoma de PRÉSTAMO: ahora aparece', rp.length, 1);
  checkEq('  con la persona de la ficha', [rp[0].detalle.cliente, rp[0].detalle.cedula, rp[0].detalle.celular],
    ['Dora Díaz', '4040', '3004445566']);
  checkEq('  y el préstamo', [rp[0].detalle.origen, rp[0].detalle.prestamo_numero], ['prestamo', 5]);
  checkEq('  con la fecha de la RETOMA, no la del préstamo',
    new Date(rp[0].fecha).getDate(), 4);

  // La directa no tiene serial en el fixture: se ve desde el buscador de compras.
  const c = await busqueda.buscarCompras('555555555555555', 'imei', 1, 1, 'admin_negocio', null);
  checkEq('★ retoma DIRECTA: aparece', c.retomas.length, 1);
  checkEq('  a nombre del compañero, con su teléfono',
    [c.retomas[0].nombre_cliente, c.retomas[0].cedula_cliente, c.retomas[0].celular_cliente, c.retomas[0].persona_tipo],
    ['Local Centro', '800', '6011234567', 'companero']);
  checkEq('  marcada como directa', c.retomas[0].origen, 'directa');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. Proveedores → Retomas');
{
  const { seriales, retomas } = await serialRepo.findComprasCliente(1, '');
  const imeisCompra = seriales.map((s) => s.imei).sort();
  checkEq('★ las unidades retomadas no salen además como «compra»', imeisCompra,
    ['111111111111111', '222222222222222']);
  checkEq('la compra a cliente trae cédula y celular',
    [seriales.find((s) => s.imei === '111111111111111').cedula_cliente,
     seriales.find((s) => s.imei === '111111111111111').celular_cliente], ['1010', '3001112233']);
  checkEq('con homónimo, sin cédula', seriales.find((s) => s.imei === '222222222222222').cedula_cliente, null);
  checkEq('las tres retomas, cada una con su origen',
    retomas.map((r) => r.origen).sort(), ['directa', 'factura', 'prestamo']);
  checkEq('la de préstamo con su cédula', retomas.find((r) => r.origen === 'prestamo').cedula_cliente, '4040');

  const porCedula = await serialRepo.findComprasCliente(1, '4040');
  checkEq('se encuentra por la cédula de la retoma de préstamo', porCedula.retomas.map((r) => r.id), [2]);
  const porCedulaCompra = await serialRepo.findComprasCliente(1, '1010');
  checkEq('y por la cédula de la compra a cliente', porCedulaCompra.seriales.map((s) => s.id), [1]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Buscador de compras: retomas por IMEI parcial');
{
  const c = await busqueda.buscarCompras('4444', 'imei', 1, 1, 'admin_negocio', null);
  checkEq('un pedazo del IMEI encuentra la retoma de préstamo', c.retomas.map((r) => r.id), [2]);
  // Con un solo candidato la ficha resuelve el IMEI completo (como siempre) y
  // la línea de tiempo se arma con ESE IMEI, no con el pedazo tecleado.
  const unico = await busqueda.buscarPorIMEI('4444', 1, 'admin_negocio');
  checkEq('la línea de tiempo usa el IMEI completo del candidato', unico.serial.imei, '444444444444444');
  checkEq('  y trae su retoma una sola vez', retomasDe(unico).length, 1);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Aislamiento entre negocios');
{
  const r = await busqueda.buscarPorIMEI('111111111111119', 2, 'admin_negocio');
  checkEq('★ el vecino ve a SU Ana Pérez, no la cédula de la otra tienda', entrada(r).detalle.cliente_cedula, '9999');
  const c = await busqueda.buscarCompras('3333', 'imei', 2, 2, 'admin_negocio', null);
  checkEq('el vecino no ve las retomas de la tienda', c.retomas.length, 0);
  const l = await serialRepo.findComprasCliente(2, '');
  checkEq('ni en Proveedores', l.retomas.length, 0);
}

console.log('\n' + '─'.repeat(62));
if (fallos.length) { console.log(`✗ ${fallos.length} FALLO(S) de ${fallos.length + ok}`); process.exit(1); }
console.log(`✓ TODO OK — ${ok} verificaciones`);
