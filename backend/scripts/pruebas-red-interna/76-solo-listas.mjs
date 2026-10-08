// ─────────────────────────────────────────────────────────────────────────────
// VENDER SOLO CON LISTAS (opt-in POR SEDE) — contra un Postgres real (PGlite).
//
// `listas_precios_solo_sucursales` (arreglo JSON de sedes; ausente = ninguna) +
// `listas_precios_principal`. En las sedes elegidas los productos POR CANTIDAD
// dejan de usar su precio predeterminado y la lista principal ocupa su lugar.
// Los equipos con IMEI no cambian. Pedido de Tesla, 7-oct-2026: solo su sede
// «TESLA SMARTPHONESHOP», ni la bodega ni los otros locales.
//
// Lo que protege, en orden:
//   1. APAGADO NO CAMBIA NADA (sección 1): sin la clave —los demás negocios— y
//      en las sedes NO elegidas del mismo negocio, etiquetas, precio mínimo y
//      plantilla dan exactamente lo de siempre.
//   2. No se puede dejar una sede sin de dónde cobrar: el guardado exige listas
//      activas y lista principal, y no deja apagarlas ni borrarla después.
//   3. Encendido en UNA sede: la etiqueta sale con el precio de la lista
//      principal, el piso del precio mínimo ignora el predeterminado, y la
//      plantilla no muestra «Precio actual» — solo ahí, y solo en cantidad.
//   4. La regla del backend y la del navegador son la misma.
//   5. El carrito y las pantallas están cableados (estático).
//
//   node scripts/pruebas-red-interna/76-solo-listas.mjs
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
// La lógica del carrito (el store de verdad) se prueba aparte:
//   node frontend/scripts/prueba-solo-listas.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');

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
  ALTER TABLE productos_serial ADD COLUMN IF NOT EXISTS linea_id INT;
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
const XLSX      = require('xlsx');
const regla     = require(path.join(RAIZ, 'src/utils/soloListas.util.js'));
const minimo    = require(path.join(RAIZ, 'src/utils/precioMinimo.util.js'));
const config    = require(path.join(RAIZ, 'src/modules/config/config.service.js'));
const etiquetas = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.repository.js'));
const listas    = require(path.join(RAIZ, 'src/modules/listas-precios/listasPrecios.service.js'));
const facturas  = require(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'));
const front     = await import('file://' + path.join(FRONT, 'utils/listasPrecios.js').replace(/\\/g, '/'));

let fallos = 0, pasados = 0;
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
};
const pasa = async (nombre, fn) => {
  try { await fn(); ok(nombre, true); }
  catch (e) { ok(nombre, false, `lanzó: ${e.message || e}`); }
};
const rechaza = async (nombre, fn, patron) => {
  try { await fn(); ok(nombre, false, 'NO lanzó'); }
  catch (e) { ok(nombre, e.status === 400 && (!patron || patron.test(e.message || '') || e.code === patron.source), String(e.message || e).slice(0, 90)); }
};
const seccion = (t) => console.log(`\n── ${t}`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

// Negocio 1: Bodega (sede 1) y Local (sede 2), el mismo catálogo en las dos.
// Negocio 2: otro negocio, con su propia sede 3.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Uno'), ('Otro');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Local'),(2,'Ajena');
  INSERT INTO usuarios (nombre) VALUES ('U');
`);
for (const sede of [1, 2]) {
  // Cable: predeterminado 9.000 (viejo y barato), listas 12.000 / 18.000
  // Protector: predeterminado 5.000 y NINGUNA lista
  // Correa con tallas: 38MM hereda del producto; 42MM trae su «final» propio
  await db.query(`
    INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, precios, sucursal_id, codigo) VALUES
      ('Cable', 100, 5000, 9000, '{"mayor":12000,"final":18000}', $1, 'CAB'),
      ('Protector', 100, 3000, 5000, NULL, $1, 'PRO'),
      ('Correa', 10, 20000, 40000, '{"mayor":50000,"final":60000}', $1, NULL)`, [sede]);
  const [{ id: correa }] = await q(`SELECT id FROM productos_cantidad WHERE nombre = 'Correa' AND sucursal_id = $1`, [sede]);
  await db.query(`
    INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, precio, precios, codigo) VALUES
      ($1, $2, '38MM', 5, NULL, NULL, 'C38'),
      ($1, $2, '42MM', 5, 45000, '{"final":70000}', 'C42')`, [correa, sede]);
  await db.query(`
    INSERT INTO productos_serial (nombre, marca, modelo, precio, precios, sucursal_id)
      VALUES ('iPhone 13','Apple','128GB', 2600000, '{"mayor":2400000}', $1)`, [sede]);
}
await db.exec(`INSERT INTO seriales (producto_id, imei, costo_compra, precio) VALUES (2, 'IMEI-L', 2000000, 2450000)`);

const LISTAS = JSON.stringify([
  { id: 'mayor', nombre: 'Al por mayor', color: 'green' },
  { id: 'final', nombre: 'Cliente final', color: 'blue' },
]);
const cfg = async () => Object.fromEntries((await q(`SELECT clave, valor FROM config_negocio WHERE negocio_id = 1`)).map((r) => [r.clave, r.valor]));
const admin = { negocio_id: 1, rol: 'admin_negocio' };
const idDe = async (nombre, sede) => (await q(`SELECT id FROM productos_cantidad WHERE nombre = $1 AND sucursal_id = $2`, [nombre, sede]))[0].id;
const tallaDe = async (valor, sede) => (await q(`SELECT id FROM atributos_producto WHERE valor = $1 AND sucursal_id = $2`, [valor, sede]))[0].id;

/** Precios de etiqueta de una sede, por «nombre · talla». */
const preciosEtiqueta = async (sede) => Object.fromEntries(
  (await etiquetas.listarNodos(1, sede, {})).map((n) => [[n.nombre, n.variante_label].filter(Boolean).join(' · '), n.precio == null ? null : Number(n.precio)]));
/** La hoja de una sede en la plantilla REAL, como filas. */
const hojaPlantilla = async (sede) => {
  const { buffer } = await listas.generarPlantilla(admin, { sucursales: [sede] });
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const nombre = wb.SheetNames.find((s) => s !== 'Instrucciones');
  return {
    buffer,
    filas: XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: null }).filter((f) => f.ID),
    instrucciones: XLSX.utils.sheet_to_json(wb.Sheets.Instrucciones, { header: 1 }).flat().join('\n'),
  };
};
const vender = (sede, lineas) => facturas.crearFactura({
  negocio_id: 1, sucursal_id: sede, usuario_id: 1,
  nombre_cliente: 'Cliente', cedula: '123', celular: '300',
  lineas, pagos: [{ metodo: 'Efectivo', valor: 1 }],
});

// ─────────────────────────────────────────────────────────────────────────────
seccion('1. APAGADO: nada cambia (los demás negocios y las sedes no elegidas)');
const ANTES = {};
{
  ok('sin ninguna clave la regla es null', regla.leerDeMapa({}) === null && (await regla.leer(pool, 1)) === null);
  await config.saveConfig(1, { listas_precios_activo: '1', listas_precios_lista: LISTAS });
  ok('con las listas activas y sin sedes sigue siendo null', (await regla.leer(pool, 1)) === null);
  ok('a medio configurar NO enciende: sedes sin lista principal',
    regla.leerDeMapa({ listas_precios_activo: '1', listas_precios_lista: LISTAS, listas_precios_solo_sucursales: '[2]' }) === null);
  ok('ni con la principal apuntando a una lista que no existe',
    regla.leerDeMapa({ listas_precios_activo: '1', listas_precios_lista: LISTAS, listas_precios_solo_sucursales: '[2]', listas_precios_principal: 'vieja' }) === null);
  ok('ni con las listas apagadas',
    regla.leerDeMapa({ listas_precios_activo: '0', listas_precios_lista: LISTAS, listas_precios_solo_sucursales: '[2]', listas_precios_principal: 'final' }) === null);
  ok('un JSON corrupto en las sedes degrada a ninguna', regla.parsearSedes('{no json').length === 0 && regla.parsearSedes('[2,"x",-1,2]').join() === '2');

  for (const sede of [1, 2]) {
    ANTES[sede] = { etiquetas: await preciosEtiqueta(sede), plantilla: await hojaPlantilla(sede) };
  }
  ok('la etiqueta lleva el precio predeterminado (variante > producto)',
    ANTES[2].etiquetas.Cable === 9000 && ANTES[2].etiquetas['Correa · 38MM'] === 40000 && ANTES[2].etiquetas['Correa · 42MM'] === 45000);
  ok('la plantilla trae «Precio actual» en los productos', ANTES[2].plantilla.filas.find((f) => f.Producto === 'Cable')['Precio actual'] === 9000);
  ok('y las instrucciones no hablan de sedes que venden solo con listas', !/SOLO CON LISTAS/.test(ANTES[2].plantilla.instrucciones));

  await config.saveConfig(1, { precio_minimo_activo: '1' });
  const r = await minimo.leerRegla(pool, 1);
  ok('el piso del Cable es su predeterminado (9.000, el menor)',
    (await minimo.pisoCantidad(pool, r, { productoId: await idDe('Cable', 2) })) === 9000);
  await pasa('y se puede vender a 9.000', () => vender(2, [{ nombre_producto: 'Cable', producto_id: 3 + 1, cantidad: 1, precio: 9000 }]));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('2. El guardado no deja una sede sin de dónde cobrar');
{
  await rechaza('sedes sin lista principal', () => config.saveConfig(1, { listas_precios_solo_sucursales: '[2]' }), /lista principal/);
  await rechaza('lista principal que no existe', () => config.saveConfig(1, { listas_precios_solo_sucursales: '[2]', listas_precios_principal: 'nope' }), /ya no existe/);
  await rechaza('una sede de OTRO negocio', () => config.saveConfig(1, { listas_precios_solo_sucursales: '[3]', listas_precios_principal: 'final' }), /no es de este negocio/);
  await rechaza('algo que no es un arreglo', () => config.saveConfig(1, { listas_precios_solo_sucursales: '{"a":1}', listas_precios_principal: 'final' }), /no es válida/);
  ok('nada de lo rechazado quedó escrito', (await cfg()).listas_precios_solo_sucursales === undefined);

  await pasa('la lista principal sola se puede guardar (no enciende nada)', () => config.saveConfig(1, { listas_precios_principal: 'final' }));
  ok('y la regla sigue apagada', (await regla.leer(pool, 1)) === null);
  await pasa('encender SOLO la sede 2', () => config.saveConfig(1, { listas_precios_solo_sucursales: [2] }));
  const r = await regla.leer(pool, 1);
  ok('la regla aplica en la 2 y no en la 1', regla.aplica(r, 2) && !regla.aplica(r, 1) && r.principal === 'final');
  ok('queda guardada como JSON de ids', (await cfg()).listas_precios_solo_sucursales === '[2]');

  await rechaza('con una sede encendida no se pueden apagar las listas', () => config.saveConfig(1, { listas_precios_activo: '0' }), /quítalas primero/);
  await rechaza('ni borrar la lista principal', () => config.saveConfig(1, {
    listas_precios_lista: JSON.stringify([{ id: 'mayor', nombre: 'Al por mayor', color: 'green' }]) }), /ya no existe/);
  await rechaza('ni dejar la principal vacía', () => config.saveConfig(1, { listas_precios_principal: '' }), /lista principal/);
  await pasa('renombrar una lista sí (el id no cambia)', () => config.saveConfig(1, {
    listas_precios_lista: JSON.stringify([
      { id: 'mayor', nombre: 'Mayoristas', color: 'green' }, { id: 'final', nombre: 'Cliente final', color: 'blue' }]) }));
  await pasa('y guardar cualquier otra clave no se entera', () => config.saveConfig(1, { nombre_negocio: 'Uno' }));
  await pasa('el otro negocio guarda sus listas sin sedes ni principal', () => config.saveConfig(2, { listas_precios_activo: '1', listas_precios_lista: LISTAS }));
  await config.saveConfig(1, { listas_precios_lista: LISTAS });
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('3. Etiquetas: la sede encendida imprime la lista principal');
{
  const local = await preciosEtiqueta(2);
  ok('Cable: 18.000 (lista «final»), no los 9.000 de antes', local.Cable === 18000, `${local.Cable}`);
  ok('la talla 38MM hereda del producto: 60.000', local['Correa · 38MM'] === 60000, `${local['Correa · 38MM']}`);
  ok('la 42MM usa SU precio de lista: 70.000', local['Correa · 42MM'] === 70000, `${local['Correa · 42MM']}`);
  ok('Protector (sin listas) sale SIN precio, no con el viejo', local.Protector === null, `${local.Protector}`);
  ok('la BODEGA (sede no elegida) imprime lo mismo que antes',
    JSON.stringify(await preciosEtiqueta(1)) === JSON.stringify(ANTES[1].etiquetas));
  const sel = await etiquetas.nodosPorSeleccion(1, 2, [
    { nivel: 'producto', producto_id: await idDe('Cable', 2) },
    { nivel: 'atributo', atributo_id: await tallaDe('42MM', 2) }]);
  ok('la selección para imprimir resuelve igual que la lista',
    sel.length === 2 && sel.some((n) => Number(n.precio) === 18000) && sel.some((n) => Number(n.precio) === 70000));
  ok('el resto de la fila no cambia (código, stock, nombre)',
    sel.find((n) => n.nivel === 'producto').codigo === 'CAB' && Number(sel.find((n) => n.nivel === 'producto').stock) > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('4. Precio mínimo: el predeterminado deja de ser el piso');
{
  const r = await minimo.leerRegla(pool, 1);
  const cableLocal = await idDe('Cable', 2), cableBodega = await idDe('Cable', 1);
  ok('Cable en la sede encendida: 12.000 (la lista más barata), no 9.000',
    (await minimo.pisoCantidad(pool, r, { productoId: cableLocal })) === 12000);
  ok('Cable en la bodega: sigue en 9.000',
    (await minimo.pisoCantidad(pool, r, { productoId: cableBodega })) === 9000);
  ok('talla 42MM: 50.000 (mayor heredada) y no su predeterminado de 45.000',
    (await minimo.pisoCantidad(pool, r, { productoId: await idDe('Correa', 2), atributoId: await tallaDe('42MM', 2) })) === 50000);
  ok('Protector (sin listas): sin piso',
    (await minimo.pisoCantidad(pool, r, { productoId: await idDe('Protector', 2) })) === null);
  ok('el equipo con IMEI NO cambia: 2.400.000 (su lista) contra 2.450.000 de la unidad',
    (await minimo.pisoSerial(pool, r, { imei: 'IMEI-L', sucursalId: 2 })) === 2400000);

  await rechaza('vender el Cable a 9.000 en la sede encendida ya no pasa',
    () => vender(2, [{ nombre_producto: 'Cable', producto_id: cableLocal, cantidad: 1, precio: 9000 }]), /PRECIO_BAJO_MINIMO/);
  await pasa('a 12.000 sí', () => vender(2, [{ nombre_producto: 'Cable', producto_id: cableLocal, cantidad: 1, precio: 12000 }]));
  await pasa('y en la bodega se sigue vendiendo a 9.000',
    () => vender(1, [{ nombre_producto: 'Cable', producto_id: cableBodega, cantidad: 1, precio: 9000 }]));
  await config.saveConfig(1, { precio_minimo_activo: '0' });
  await pasa('con el precio mínimo apagado la sede vende a cualquier precio (la regla no bloquea ventas)',
    () => vender(2, [{ nombre_producto: 'Cable', producto_id: cableLocal, cantidad: 1, precio: 1 }]));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('5. Plantilla de precios: sin «Precio actual» solo en esa sede y solo en cantidad');
{
  const local = await hojaPlantilla(2);
  const fila = (h, producto, nivel) => h.filas.find((f) => f.Producto === producto && (!nivel || f.Nivel === nivel));
  const vacio = (v) => v === null || v === '';
  ok('Cable sin «Precio actual»', vacio(fila(local, 'Cable')['Precio actual']));
  ok('las tallas tampoco', local.filas.filter((f) => f.Producto === 'Correa').every((f) => vacio(f['Precio actual'])));
  ok('el equipo con IMEI SÍ lo conserva', fila(local, 'iPhone 13', 'Referencia')['Precio actual'] === 2600000);
  ok('los precios de lista siguen ahí', fila(local, 'Cable')['Cliente final'] === 18000 && fila(local, 'Cable')['Al por mayor'] === 12000);
  ok('las instrucciones lo explican y nombran la sede y la lista',
    /SOLO CON LISTAS/.test(local.instrucciones) && /· Local/.test(local.instrucciones) && /«Cliente final»/.test(local.instrucciones));

  const bodega = await hojaPlantilla(1);
  ok('la hoja de la BODEGA es idéntica a la de antes',
    JSON.stringify(bodega.filas) === JSON.stringify(ANTES[1].plantilla.filas));
  ok('y sus instrucciones también', bodega.instrucciones === ANTES[1].plantilla.instrucciones);

  const informe = await listas.analizarExcel(admin, local.buffer, [2]);
  ok('subir el archivo recién bajado no cambia NI UNA fila',
    informe.con_cambio === 0 && informe.conflictos.length === 0, JSON.stringify({ c: informe.con_cambio, x: informe.conflictos.length }));
  const viejo = await listas.analizarExcel(admin, ANTES[2].plantilla.buffer, [2]);
  ok('y un archivo bajado ANTES de encender se sigue pudiendo subir', viejo.con_cambio === 0 && viejo.conflictos.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('6. El precio predeterminado NO se tocó: apagar devuelve todo');
{
  const precios = await q(`SELECT nombre, sucursal_id, precio FROM productos_cantidad ORDER BY id`);
  ok('ninguna columna `precio` cambió', precios.every((p) => Number(p.precio) === { Cable: 9000, Protector: 5000, Correa: 40000 }[p.nombre]));
  await config.saveConfig(1, { listas_precios_solo_sucursales: '[]' });
  ok('quitar la sede apaga la regla', (await regla.leer(pool, 1)) === null);
  ok('y las etiquetas vuelven a lo de antes', JSON.stringify(await preciosEtiqueta(2)) === JSON.stringify(ANTES[2].etiquetas));
  ok('la plantilla también', JSON.stringify((await hojaPlantilla(2)).filas) === JSON.stringify(ANTES[2].plantilla.filas));
  await pasa('y ahora sí se pueden apagar las listas', () => config.saveConfig(1, { listas_precios_activo: '0' }));
  await config.saveConfig(1, { listas_precios_activo: '1', listas_precios_solo_sucursales: '[2]' });
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('7. El navegador lee la MISMA regla');
{
  const base = { listas_precios_activo: '1', listas_precios_lista: LISTAS, listas_precios_principal: 'final' };
  const casos = [
    {}, base,
    { ...base, listas_precios_solo_sucursales: '[2]' },
    { ...base, listas_precios_solo_sucursales: '[1,2]' },
    { ...base, listas_precios_solo_sucursales: '[]' },
    { ...base, listas_precios_solo_sucursales: '{malo' },
    { ...base, listas_precios_solo_sucursales: '[2]', listas_precios_principal: '' },
    { ...base, listas_precios_solo_sucursales: '[2]', listas_precios_principal: 'borrada' },
    { ...base, listas_precios_solo_sucursales: '[2]', listas_precios_activo: '0' },
    { ...base, listas_precios_solo_sucursales: '[2]', listas_precios_lista: '[]' },
    { ...base, listas_precios_solo_sucursales: '["2", 2, 0, -3, "x"]' },
  ];
  let iguales = 0, total = 0;
  for (const c of casos) {
    for (const sede of [1, 2, 3, null, undefined, 'x']) {
      total++;
      const b = regla.aplica(regla.leerDeMapa(c), sede);
      const f = front.leerConfigSoloListas(c, sede);
      if (b === f.activo && (!b || f.principal.id === regla.leerDeMapa(c).principal)) iguales++;
      else console.log('     ✗', JSON.stringify(c), sede, b, f.activo);
    }
  }
  ok(`backend y frontend coinciden en ${total} combinaciones`, iguales === total);
  ok('sin config (cargando) el navegador responde apagado', front.leerConfigSoloListas(undefined, 2).activo === false);

  const modo = front.leerConfigSoloListas({ ...base, listas_precios_solo_sucursales: '[2]' }, 2);
  const P = { mayor: 12000, final: 18000 };
  ok('precio base = el de la lista principal; sin ella, 0 (nunca el viejo)',
    front.precioBaseSoloListas(P, 'final') === 18000 && front.precioBaseSoloListas({ mayor: 1 }, 'final') === 0 && front.precioBaseSoloListas(null, 'final') === 0);
  ok('precioVisible APAGADO devuelve lo que la pantalla ya mostraba, tal cual',
    front.precioVisible({ precioNormal: '9000.00', precios: P, modo: { activo: false } }) === '9000.00'
    && front.precioVisible({ precioNormal: undefined, precios: P, modo: undefined }) === null);
  ok('encendido: la lista elegida, o la principal, o null',
    front.precioVisible({ precioNormal: 9000, precios: P, modo, listaActivaId: 'mayor' }) === 12000
    && front.precioVisible({ precioNormal: 9000, precios: P, modo }) === 18000
    && front.precioVisible({ precioNormal: 9000, precios: { final: 18000 }, modo, listaActivaId: 'mayor' }) === 18000
    && front.precioVisible({ precioNormal: 9000, precios: null, modo }) === null);
  ok('solo aplica a productos por cantidad', front.esItemSoloListas({ tipo: 'cantidad' }) && !front.esItemSoloListas({ tipo: 'serial' }));
  ok('«sin precio»: en 0 sin que nadie lo escribiera',
    front.sinPrecioSoloListas({ solo_listas: true, precioFinal: 0, origen_precio: 'lista' })
    && !front.sinPrecioSoloListas({ solo_listas: true, precioFinal: 5000, origen_precio: 'lista' }));
  ok('un 0 escrito A MANO o un obsequio no son «sin precio» (regalar sigue funcionando)',
    !front.sinPrecioSoloListas({ solo_listas: true, precioFinal: 0, origen_precio: 'manual' })
    && !front.sinPrecioSoloListas({ solo_listas: true, precioFinal: 0, obsequio: true, origen_precio: 'obsequio' })
    && !front.sinPrecioSoloListas({ precioFinal: 0, origen_precio: 'lista' }));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('8. Cableado de las pantallas (estático)');
{
  const leer = (rel) => readFileSync(path.join(FRONT, rel), 'utf8');
  const store = leer('store/carritoStore.js');
  ok('las tres puertas del carrito pasan la regla de la sede',
    (store.match(/_itemNuevo\(item, get\(\)\.listaPrecioActiva, get\(\)\.soloListas\)/g) || []).length === 3
    && !/_itemNuevo\(item, get\(\)\.listaPrecioActiva\)/.test(store));
  ok('la regla NO se persiste (es una foto del servidor y de la sede)',
    !/partialize[\s\S]*soloListas:/.test(store));
  ok('un ítem sin el mapa de precios no se rebaja (borradores)', /item\.precios === undefined/.test(store));
  ok('InventarioPage monta la sincronización', /useSincronizarSoloListas\(\);/.test(leer('pages/inventario/InventarioPage.jsx')));
  const carrito = leer('pages/inventario/Carrito.jsx');
  ok('el carrito no deja facturar ni prestar con productos sin precio',
    /disabled=\{bajoElMinimo\.length > 0 \|\| sinPrecio\.length > 0\}/.test(carrito)
    && /onClick=\{onPrestar\}\s*\n\s*disabled=\{sinPrecio\.length > 0\}/.test(carrito));
  ok('y sin lista elegida enciende el chip de la principal', /valor=\{listaPrecioActiva\?\.id \|\| principal\?\.id \|\| null\}/.test(carrito));
  for (const [archivo, patron] of [
    ['pages/inventario/ModalEditarProductoCantidad.jsx', /tiene\('precio'\) && !soloListas/],
    ['pages/inventario/ModalAgregarProducto.jsx', /\{!soloListas && \(/],
    ['pages/proveedores/ModalCompra.jsx', /\{!soloListas && \(/],
    ['pages/inventario/VistaVariantesProducto.jsx', /ocultarPrecio \? <AvisoSoloListas \/>/],
    ['pages/inventario/EditorVariantesNuevas.jsx', /\{!ocultarPrecio && \(/],
  ]) ok(`${archivo.split('/').pop()} no pide «Precio de venta» en esa sede`, patron.test(leer(archivo)));
  const editar = leer('pages/inventario/ModalEditarProductoCantidad.jsx');
  ok('al editar, el precio guardado se sigue enviando tal cual (no se borra)',
    /precio\s*: form\.precio\s*!== '' \? Number\(form\.precio\)\s*: null/.test(editar));
  for (const serial of ['pages/inventario/ModalEditarSerial.jsx', 'pages/inventario/ModalEditarProductoSerial.jsx']) {
    ok(`${serial.split('/').pop()} (IMEI) no se tocó`, !/soloListas|SoloListas/.test(leer(serial)));
  }
  const ajustes = leer('pages/configuracion/ListasPreciosConfig.jsx');
  ok('Ajustes escribe las dos claves que lee el backend',
    ajustes.includes(`'${regla.CLAVE_SEDES}'`) && ajustes.includes(`'${regla.CLAVE_PRINCIPAL}'`));
}

console.log(`\n${pasados} verificaciones OK, ${fallos} fallidas`);
process.exit(fallos ? 1 : 0);
