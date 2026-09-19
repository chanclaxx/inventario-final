// ─────────────────────────────────────────────────────────────────────────────
// PRECIO MÍNIMO DE VENTA — contra un Postgres real (PGlite).
//
// Feature opt-in `precio_minimo_activo`: encendida, ni la factura ni el
// despacho a un local aceptan un precio por debajo del MENOR de los precios
// escritos del producto (el predeterminado y, con listas activas, cada lista).
//
// Lo que protege, en orden:
//   1. APAGADA NO CAMBIA NADA (sección 1): los negocios que no la encienden
//      facturan y despachan a cualquier precio, igual que siempre.
//   2. Encendida, la factura, su edición y el despacho rechazan lo que queda
//      por debajo, y aceptan el precio exacto y cualquier cosa por encima.
//   3. Con listas activas, el piso es la lista más barata; sin ningún precio
//      escrito no hay piso.
//   4. `pisoDePrecios` del backend y del frontend dan lo mismo.
//
//   node scripts/pruebas-red-interna/56-precio-minimo.mjs
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
for (const m of [
  '20260725_red_interna.sql', '20260726_red_interna_v2.sql', '20260822_red_interna_envios.sql',
  '20260823_red_interna_control.sql', '20260823_red_interna_cargos_pagables.sql',
  '20260823_remision_variantes.sql', '20260823_lotes_cantidad.sql',
  '20260824_costo_origen_remision.sql', '20260823_valor_acreditado.sql',
]) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260912_listas_precios.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260730_mora_credito.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260804_interes_corriente.sql'), 'utf8'));
await db.exec(`
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular   TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email     TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion TEXT;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_label TEXT;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_label TEXT;
  CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, fecha TIMESTAMP DEFAULT NOW(),
    accion VARCHAR, tabla VARCHAR, registro_id INT, detalle TEXT
  );
`);

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

require(path.join(RAIZ, 'src/config/columnas.js'))._setListasPreciosDisponible(true);
const back     = require(path.join(RAIZ, 'src/utils/precioMinimo.util.js'));
const facturas = require(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'));
const red      = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const prestamos = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'));
const front    = await import(
  'file://' + path.resolve(RAIZ, '../frontend/src/utils/precioMinimo.js').replace(/\\/g, '/'));

let fallos = 0, pasados = 0;
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
};
const pasa = async (nombre, fn) => {
  try { await fn(); ok(nombre, true); }
  catch (e) { ok(nombre, false, `lanzó: ${e.message || e}`); }
};
const rechaza = async (nombre, fn) => {
  try { await fn(); ok(nombre, false, 'NO lanzó'); }
  catch (e) { ok(nombre, e.code === 'PRECIO_BAJO_MINIMO', `${e.code || ''} ${String(e.message || '').slice(0, 80)}`); }
};
const seccion = (t) => console.log(`\n── ${t}`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('U');
  INSERT INTO config_negocio VALUES (1,'red_interna_activa','1'),(1,'red_interna_bodega_id','1');

  -- 1) Cable: precio 15.000, lista mayorista 12.000 y cliente final 18.000
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, precios, sucursal_id)
    VALUES ('Cable', 100, 5000, 15000, '{"mayor":12000,"final":18000}', 1);
  -- 2) Protector SIN precio de venta: no tiene piso
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id)
    VALUES ('Protector', 100, 3000, NULL, 1);
  -- 3) Correa con tallas: la 42MM tiene precio propio y lista propia
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, precios, sucursal_id)
    VALUES ('Correa', 10, 20000, 60000, '{"mayor":50000}', 1);
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, precio, precios)
    VALUES (3, 1, '38MM', 5, NULL, NULL),
           (3, 1, '42MM', 5, 70000, '{"mayor":65000}');
  -- 4) Equipos: uno con precio propio en la unidad, otro que hereda
  INSERT INTO productos_serial (nombre, marca, modelo, precio, precios, sucursal_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, '{"mayor":2400000}', 1);
  INSERT INTO seriales (producto_id, imei, costo_compra, precio) VALUES
    (1, 'IMEI-A', 2000000, 2450000),
    (1, 'IMEI-B', 2000000, NULL),
    (1, 'IMEI-C', 2000000, NULL),
    (1, 'IMEI-D', 2000000, NULL),
    (1, 'IMEI-E', 2000000, NULL),
    (1, 'IMEI-F', 2000000, NULL);
`);

const LISTAS = JSON.stringify([
  { id: 'mayor', nombre: 'Al por mayor', color: 'green' },
  { id: 'final', nombre: 'Cliente final', color: 'blue' },
]);
const setCfg = async (clave, valor) => {
  await q(`DELETE FROM config_negocio WHERE negocio_id = 1 AND clave = $1`, [clave]);
  if (valor != null) await q(`INSERT INTO config_negocio VALUES (1, $1, $2)`, [clave, valor]);
};

const vender = (lineas) => facturas.crearFactura({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1,
  nombre_cliente: 'Cliente', cedula: '123', celular: '300',
  lineas, pagos: [{ metodo: 'Efectivo', valor: 1 }],
});
const cable     = (precio, cantidad = 1) => ({ nombre_producto: 'Cable', producto_id: 1, cantidad, precio });
const protector = (precio) => ({ nombre_producto: 'Protector', producto_id: 2, cantidad: 1, precio });
const correa    = (atributo_id, precio) => ({ nombre_producto: 'Correa', producto_id: 3, atributo_id, cantidad: 1, precio });
const equipo    = (imei, precio) => ({ nombre_producto: 'iPhone 13', imei, cantidad: 1, precio });

const bodega = { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true,
  red: { activa: true, bodega_id: 1, confirmar_recepcion: true, confirmar_remesa: true } };
let clave = 0;
const despachar = (lineas) => red.despachar(bodega, {
  sucursal_destino_id: 2, lineas, clave_idempotencia: `k${++clave}`,
});

// ─────────────────────────────────────────────────────────────────────────────
seccion('1. APAGADA: nada cambia');
{
  await pasa('factura a $1 con la clave ausente', () => vender([cable(1)]));
  await setCfg('precio_minimo_activo', '0');
  await pasa("factura a $1 con la clave en '0'", () => vender([cable(1)]));
  await pasa('despacho al costo (sin valor) con la clave apagada',
    () => despachar([{ tipo: 'cantidad', producto_id: 1, cantidad: 1 }]));
  ok('leerRegla devuelve null apagada', (await back.leerRegla(pool, 1)) === null);
  ok('frontend: apagada no marca nada',
    front.itemsBajoMinimo([{ precio: 15000, precioFinal: 1 }], front.leerConfigPrecioMinimo({})).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('2. Encendida sin listas: piso = precio predeterminado');
await setCfg('precio_minimo_activo', '1');
{
  await rechaza('cable a 14.999 (precio 15.000)', () => vender([cable(14999)]));
  await pasa('cable a 15.000 exacto', () => vender([cable(15000)]));
  await pasa('cable a 20.000 (subir siempre se puede)', () => vender([cable(20000)]));
  await pasa('protector sin precio registrado: no tiene piso', () => vender([protector(1)]));
  await rechaza('talla 38MM hereda el precio del producto (60.000)', () => vender([correa(1, 59000)]));
  await rechaza('talla 42MM usa el suyo (70.000)', () => vender([correa(2, 65000)]));
  await pasa('talla 42MM a 70.000', () => vender([correa(2, 70000)]));
  await rechaza('serial con precio propio (2.450.000)', () => vender([equipo('IMEI-A', 2400000)]));
  await pasa('serial con precio propio al precio', () => vender([equipo('IMEI-A', 2450000)]));
  await rechaza('serial que hereda la referencia (2.600.000)', () => vender([equipo('IMEI-B', 2450000)]));
  const antes = await q(`SELECT stock FROM productos_cantidad WHERE id = 1`);
  await rechaza('una línea mala tumba la factura entera', () => vender([cable(15000, 2), cable(10)]));
  const despues = await q(`SELECT stock FROM productos_cantidad WHERE id = 1`);
  ok('…y no movió stock (ROLLBACK)', Number(antes[0].stock) === Number(despues[0].stock));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('3. Con listas activas: piso = el más bajo');
await setCfg('listas_precios_activo', '1');
await setCfg('listas_precios_lista', LISTAS);
{
  await pasa('cable a 12.000 (lista mayorista)', () => vender([cable(12000)]));
  await rechaza('cable a 11.999', () => vender([cable(11999)]));
  await pasa('talla 42MM a 65.000 (su lista)', () => vender([correa(2, 65000)]));
  await pasa('talla 38MM a 50.000 (hereda la lista del producto)', () => vender([correa(1, 50000)]));
  await rechaza('serial por debajo de la lista de la referencia', () => vender([equipo('IMEI-C', 2399999)]));
  await pasa('serial a la lista de la referencia', () => vender([equipo('IMEI-C', 2400000)]));

  // Una lista borrada ya no cuenta: el vendedor no tiene cómo elegirla.
  await setCfg('listas_precios_lista', JSON.stringify([{ id: 'final', nombre: 'Cliente final' }]));
  await rechaza('lista mayorista borrada: su 12.000 ya no es piso', () => vender([cable(12000)]));
  await setCfg('listas_precios_lista', LISTAS);
  await setCfg('listas_precios_activo', '0');
  await rechaza('listas apagadas: el piso vuelve al predeterminado', () => vender([cable(12000)]));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('4. Editar la factura: no se puede bajar por debajo');
{
  const f = await vender([cable(15000), protector(5000)]);
  const lineas = await q(`SELECT id, cantidad, precio FROM lineas_factura WHERE factura_id = $1 ORDER BY id`, [f.id]);
  const editar = (precios) => facturas.editarFactura(1, f.id, {
    nombre_cliente: 'Cliente', cedula: '123', celular: '300',
    lineas: lineas.map((l, i) => ({ id: l.id, cantidad: l.cantidad, precio: precios[i] ?? Number(l.precio) })),
    pagos: [{ metodo: 'Efectivo', valor: 1 }],
  });
  await rechaza('bajar el cable a 10.000', () => editar([10000]));
  await pasa('subir el cable a 16.000', () => editar([16000]));
  await pasa('bajar el protector (sin precio registrado)', () => editar([16000, 1000]));

  // Factura de ANTES de encender el candado, ya por debajo: se sigue pudiendo
  // corregir lo demás sin que la detenga el precio que ya tenía.
  await setCfg('precio_minimo_activo', '0');
  const vieja = await vender([cable(9000)]);
  await setCfg('precio_minimo_activo', '1');
  const [lv] = await q(`SELECT id, cantidad FROM lineas_factura WHERE factura_id = $1`, [vieja.id]);
  await pasa('factura vieja a 9.000: corregir el nombre no la detiene', () => facturas.editarFactura(1, vieja.id, {
    nombre_cliente: 'Otro nombre', cedula: '123', celular: '300',
    lineas: [{ id: lv.id, cantidad: lv.cantidad, precio: 9000 }], pagos: [{ metodo: 'Efectivo', valor: 1 }],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('5. Despacho a un local');
{
  await rechaza('sin valor (sale al costo 5.000, precio 15.000)',
    () => despachar([{ tipo: 'cantidad', producto_id: 1, cantidad: 1 }]));
  await rechaza('valor 14.000', () => despachar([{ tipo: 'cantidad', producto_id: 1, cantidad: 1, valor_interno: 14000 }]));
  await pasa('valor 15.000', () => despachar([{ tipo: 'cantidad', producto_id: 1, cantidad: 1, valor_interno: 15000 }]));
  await rechaza('talla 42MM a 69.000',
    () => despachar([{ tipo: 'cantidad', producto_id: 3, atributo_id: 2, cantidad: 1, valor_interno: 69000 }]));
  await pasa('protector sin precio: sale al costo',
    () => despachar([{ tipo: 'cantidad', producto_id: 2, cantidad: 1 }]));
  const [{ id: sid }] = await q(`SELECT id FROM seriales WHERE imei = 'IMEI-D'`);
  await rechaza('serial al costo', () => despachar([{ tipo: 'serial', serial_id: sid }]));
  await pasa('serial al precio de la referencia',
    () => despachar([{ tipo: 'serial', serial_id: sid, valor_interno: 2600000 }]));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('6. Préstamos: valor_prestamo es el TOTAL');
{
  const prestar = (items) => prestamos.crearPrestamos({
    sucursal_id: 1, usuario_id: 1, negocio_id: 1,
    prestatario: 'Ana', cedula: '999', telefono: '300', items,
  });
  await rechaza('3 cables por 44.000 (14.667 c/u; mínimo 15.000)',
    () => prestar([{ nombre_producto: 'Cable', producto_id: 1, cantidad_prestada: 3, valor_prestamo: 44000 }]));
  await pasa('3 cables por 45.000 (15.000 c/u)',
    () => prestar([{ nombre_producto: 'Cable', producto_id: 1, cantidad_prestada: 3, valor_prestamo: 45000 }]));
  await rechaza('serial por debajo de la referencia',
    () => prestar([{ nombre_producto: 'iPhone 13', imei: 'IMEI-E', valor_prestamo: 2500000 }]));
  const antesSerial = await q(`SELECT prestado FROM seriales WHERE imei = 'IMEI-E'`);
  ok('…y el equipo no quedó prestado (ROLLBACK)', antesSerial[0].prestado === false);
  await pasa('protector sin precio registrado',
    () => prestar([{ nombre_producto: 'Protector', producto_id: 2, cantidad_prestada: 1, valor_prestamo: 1 }]));
  await rechaza('crearPrestamo (uno solo) también', () => prestamos.crearPrestamo({
    sucursal_id: 1, usuario_id: 1, negocio_id: 1, prestatario: 'Ana', cedula: '999', telefono: '300',
    nombre_producto: 'Correa', producto_id: 3, atributo_id: 2, cantidad_prestada: 1, valor_prestamo: 60000,
  }));

  const [p] = await prestar([{ nombre_producto: 'Cable', producto_id: 1, cantidad_prestada: 2, valor_prestamo: 40000 }])
    .then((r) => r.prestamos ?? r);
  const pid = p?.id ?? (await q(`SELECT max(id) AS id FROM prestamos`))[0].id;
  await rechaza('editar el valor a 29.000 (2 cables, mínimo 30.000)',
    () => prestamos.editarValorPrestamo(1, pid, 29000));
  await pasa('editar el valor a 30.000', () => prestamos.editarValorPrestamo(1, pid, 30000));
  await pasa('subir el valor siempre se puede', () => prestamos.editarValorPrestamo(1, pid, 50000));

  await setCfg('precio_minimo_activo', '0');
  await pasa('apagado: préstamo a $1', () =>
    prestar([{ nombre_producto: 'Cable', producto_id: 1, cantidad_prestada: 1, valor_prestamo: 1 }]));
  await setCfg('precio_minimo_activo', '1');
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('7. Backend y frontend calculan el mismo piso');
{
  const casos = [
    { precio: 15000, precios: null, listaIds: [] },
    { precio: '15000.00', precios: { mayor: 12000 }, listaIds: ['mayor'] },
    { precio: 15000, precios: '{"mayor":12000,"final":18000}', listaIds: ['final'] },
    { precio: null, precios: { mayor: 8000 }, listaIds: ['mayor'] },
    { precio: 0, precios: null, listaIds: ['mayor'] },
    { precio: null, precios: 'no-json', listaIds: ['mayor'] },
    { precio: 15000, precios: { mayor: 0, final: -3 }, listaIds: ['mayor', 'final'] },
    { precio: 15000, precios: { mayor: 20000 }, listaIds: ['mayor'] },
  ];
  for (const c of casos) {
    const b = back.pisoDePrecios(c);
    const f = front.pisoDePrecios(c);
    ok(`${JSON.stringify(c)} → ${b}`, b === f, `front=${f}`);
  }
  ok('bajoMinimo respeta el medio peso de tolerancia',
    !front.bajoMinimo(14999.6, 15000) && front.bajoMinimo(14999, 15000) && !front.bajoMinimo(1, null));
}

console.log(`\n${pasados} verificaciones OK, ${fallos} fallidas`);
process.exit(fallos ? 1 : 0);
