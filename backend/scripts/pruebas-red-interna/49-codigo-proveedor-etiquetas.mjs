// ─────────────────────────────────────────────────────────────────────────────
// CÓDIGO DEL PROVEEDOR + ETIQUETAS AL RECIBIR (contra Postgres real, PGlite)
//
// Opt-in `proveedor_codigo_activo`:
//   · cada proveedor recibe NOMBRE-NIT-CIUDAD-consecutivo (DIS-900-CAL-001) al
//     encender la feature, al crearlo o al completarle el dato que le faltaba;
//   · las etiquetas de una compra (o una Entrada de bodega) salen con el código
//     del producto en el símbolo y el del proveedor como texto, y se pueden
//     reimprimir desde la compra misma.
//
// La sección 1 es la que hay que mirar primero: sin las columnas y sin la clave
// NADA cambia — ni el SQL de proveedores, ni la etiqueta de Inventario.
//
//   node scripts/pruebas-red-interna/49-codigo-proveedor-etiquetas.mjs
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
// Lo que producción tiene y los fixtures no: la fecha de alta del proveedor
// (findAll la selecciona) y la tabla de acreedores que crear un proveedor llena.
await db.exec(`
  ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP DEFAULT NOW();
  CREATE TABLE IF NOT EXISTS acreedores (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT, telefono TEXT, proveedor_id INT
  );
`);

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const columnas   = require(path.join(RAIZ, 'src/config/columnas.js'));
const proveedores = require(path.join(RAIZ, 'src/modules/proveedores/proveedores.service.js'));
const config     = require(path.join(RAIZ, 'src/modules/config/config.service.js'));
const etiquetas  = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.service.js'));
const layout     = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.layout.js'));
const util       = require(path.join(RAIZ, 'src/utils/codigoProveedor.util.js'));
const PDFDocument = require(path.join(RAIZ, 'node_modules/pdfkit'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
}
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const falla = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const codigoDe = async (id) => (await q('SELECT codigo FROM proveedores WHERE id=$1', [id]))[0]?.codigo ?? null;

const resFalso = (ok) => {
  const trozos = [];
  return {
    setHeader: () => {},
    write: (c) => { trozos.push(Buffer.from(c)); return true; },
    end:   () => ok(Buffer.concat(trozos)),
    on: () => {}, once: () => {}, emit: () => {}, removeListener: () => {},
  };
};
// Los textos que de verdad dibuja pdfkit (en el PDF van codificados).
const textosDelPdf = async (generar) => {
  const original = PDFDocument.prototype.text;
  const lista = [];
  PDFDocument.prototype.text = function (t, ...resto) { lista.push(String(t)); return original.call(this, t, ...resto); };
  try { const buf = await generar(); return { buf, lista }; }
  finally { PDFDocument.prototype.text = original; }
};

// ── Datos ────────────────────────────────────────────────────────────────────
// Negocio 1: la feature. Dos sedes. Negocio 2: otro negocio, para el aislamiento.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tienda'), ('Ajeno');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal'), (1,'Sur'), (2,'Unica');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Accesorios');
  INSERT INTO tipos_caracteristica (negocio_id, nombre, orden) VALUES (1,'Color',1);
`);

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Sin columnas y sin la clave, NADA cambia');
// ═════════════════════════════════════════════════════════════════════════════
{
  // La base todavía NO tiene `ciudad` ni `codigo`: la detección tiene que dar
  // falso y el SQL de proveedores ser el de siempre.
  await columnas.detectarColumnas();
  check('★ sin las columnas la detección da falso', columnas.hayCodigoProveedor(), false);

  const p = await proveedores.crearProveedor(1, { nombre: 'Viejo Conocido', nit: '800111222', ciudad: 'Cali' });
  check('★ crear un proveedor funciona sin las columnas (y no trae código)', [p.nombre, 'codigo' in p, 'codigo_faltantes' in p], ['Viejo Conocido', false, false]);
  const lista = await proveedores.getProveedores(1);
  check('★ la lista es la de siempre', [lista.length, 'codigo' in lista[0]], [1, false]);
  const editado = await proveedores.actualizarProveedor(1, p.id, { nombre: 'Viejo Conocido', nit: '800111222', ciudad: 'Cali' });
  check('editar tampoco nombra la columna', editado.nombre, 'Viejo Conocido');
  check('★ getConfig apaga la clave si la base no puede sostenerla', (await config.getConfig(1)).proveedor_codigo_activo, '0');

  const e = await falla(() => config.saveConfig(1, { codigo_producto_activo: '1', proveedor_codigo_activo: '1' }));
  check('y no deja encenderla', e?.status, 400);

  // Ahora sí, la migración (la MISMA del runner de arranque).
  const runner = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8');
  const bloque = runner.slice(runner.indexOf("'Código de proveedor'"));
  const sql = bloque.slice(bloque.indexOf('`') + 1, bloque.indexOf('`', bloque.indexOf('`') + 1));
  await db.exec(sql);
  await columnas.detectarColumnas();
  check('★ con la migración del runner, la detección da verdadero', columnas.hayCodigoProveedor(), true);

  const sinClave = await proveedores.crearProveedor(1, { nombre: 'Sin Feature', nit: '900222333', ciudad: 'Medellín' });
  check('★ con columnas pero sin la clave NO se asigna código', sinClave.codigo, null);
  check('la ciudad sí se guarda', sinClave.ciudad, 'Medellín');

  // La etiqueta de Inventario: un item sin `codigo_proveedor` sale idéntica.
  const ITEM = { nombre: 'Cargador 20W', variante_label: 'Blanco', codigo: 'ACC-CAR-001', precio: 35000 };
  const op = { simbologia: 'barras', mostrar: { nombre: true, variante: true, precio: true } };
  const w = 50 * 2.83465, h = 25 * 2.83465;
  const antes = layout.planear(w, h, ITEM, op);
  const conMostrar = layout.planear(w, h, ITEM, { ...op, mostrar: { ...op.mostrar, proveedor: true } });
  check('★ sin codigo_proveedor en el item, el plano es idéntico aunque se pida', JSON.stringify(conMostrar) === JSON.stringify(antes), true);
  check('y no hay ningún bloque de proveedor', antes.bloques.some((b) => /prov/i.test(String(b.texto))), false);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Las letras del código');
// ═════════════════════════════════════════════════════════════════════════════
{
  check('★ el ejemplo de Ajustes', util.EJEMPLO, 'DIS-900-CAL-001');
  check('sin tildes', util.componer({ nombre: 'Óptica Bogotá', nit: '901', ciudad: 'Bogotá' }, 7), 'OPT-901-BOG-007');
  check('los puntos y guiones del NIT no cuentan', util.componer({ nombre: 'X', nit: '9.0-0', ciudad: 'Pasto' }, 1), 'XXX-900-PAS-001');
  check('pasado 999 crece solo', util.componer({ nombre: 'Andes', nit: '800', ciudad: 'Cúcuta' }, 1234), 'AND-800-CUC-1234');
  check('★ sin ciudad no se arma', util.componer({ nombre: 'Andes', nit: '800', ciudad: '' }, 1), null);
  check('★ faltantes dice qué falta, en el orden del código', util.faltantes({ nombre: 'Andes', nit: '  ', ciudad: null }), ['nit', 'ciudad']);
  check('un nombre hecho solo de símbolos también falta', util.faltantes({ nombre: '---', nit: '1', ciudad: 'Cali' }), ['nombre']);
  check('la clave ausente es apagado', [util.activo({}), util.activo({ proveedor_codigo_activo: '0' }), util.activo({ proveedor_codigo_activo: '1' })], [false, false, true]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Encender la feature asigna los códigos ahí mismo');
// ═════════════════════════════════════════════════════════════════════════════
let idAndina, idSinCiudad, idInactivo, idViejo;
{
  idViejo = (await q(`SELECT id FROM proveedores WHERE nombre='Viejo Conocido'`))[0].id;
  // Sin ciudad (existía de antes) y uno inactivo.
  await q(`INSERT INTO proveedores (negocio_id, nombre, nit, ciudad) VALUES (1,'Sin Ciudad SAS','700555','')`);
  await q(`INSERT INTO proveedores (negocio_id, nombre, nit, ciudad, activo) VALUES (1,'Dado de Baja','600','Neiva', FALSE)`);
  await q(`INSERT INTO proveedores (negocio_id, nombre, nit, ciudad) VALUES (2,'Del Otro Negocio','500','Cali')`);
  idSinCiudad = (await q(`SELECT id FROM proveedores WHERE nombre='Sin Ciudad SAS'`))[0].id;
  idInactivo  = (await q(`SELECT id FROM proveedores WHERE nombre='Dado de Baja'`))[0].id;
  // «Viejo Conocido» se creó antes de la columna: sin ciudad guardada.
  await q(`UPDATE proveedores SET ciudad = 'Cali' WHERE id = $1`, [idViejo]);

  const e = await falla(() => config.saveConfig(1, { proveedor_codigo_activo: '1' }));
  check('★ exige el código único de producto', [e?.status, /código único de producto/.test(e?.message)], [400, true]);
  check('y sin guardarlo no asignó nada', await codigoDe(idViejo), null);

  const e2 = await falla(() => config.saveConfig(1, { proveedor_codigo_activo: 'si' }));
  check('un valor que no es 0/1 se rechaza', e2?.status, 400);

  await config.saveConfig(1, { codigo_producto_activo: '1', proveedor_codigo_activo: '1' });
  check('★ el más viejo recibe el 001', await codigoDe(idViejo), 'VIE-800-CAL-001');
  const sinFeature = (await q(`SELECT id FROM proveedores WHERE nombre='Sin Feature'`))[0].id;
  check('★ el siguiente, 002', await codigoDe(sinFeature), 'SIN-900-MED-002');
  check('★ sin ciudad se queda sin código', await codigoDe(idSinCiudad), null);
  check('uno inactivo no se numera', await codigoDe(idInactivo), null);
  check('★ otro negocio no se toca', (await q(`SELECT codigo FROM proveedores WHERE negocio_id=2`))[0].codigo, null);

  const lista = await proveedores.getProveedores(1);
  const fila = (id) => lista.find((p) => p.id === id);
  check('★ la lista trae el código y lo que falta', [fila(idViejo).codigo, fila(idViejo).codigo_faltantes, fila(idSinCiudad).codigo, fila(idSinCiudad).codigo_faltantes],
    ['VIE-800-CAL-001', [], null, ['ciudad']]);

  const otraVez = await config.saveConfig(1, { proveedor_codigo_activo: '1' });
  check('volver a guardar no renumera', [await codigoDe(idViejo), await codigoDe(sinFeature), otraVez.proveedor_codigo_activo], ['VIE-800-CAL-001', 'SIN-900-MED-002', '1']);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. Crear y editar');
// ═════════════════════════════════════════════════════════════════════════════
{
  const andina = await proveedores.crearProveedor(1, { nombre: 'Distribuidora Andina', nit: '900.123.456-7', ciudad: 'Cali' });
  idAndina = andina.id;
  check('★ crear con los tres datos nace con código', [andina.codigo, andina.codigo_faltantes], ['DIS-900-CAL-003', []]);

  const sinNit = await proveedores.crearProveedor(1, { nombre: 'Informal', nit: '', ciudad: 'Cali' });
  check('★ crear sin NIT se guarda, sin código y diciendo por qué', [sinNit.id > 0, sinNit.codigo, sinNit.codigo_faltantes], [true, null, ['nit']]);

  const completo = await proveedores.actualizarProveedor(1, idSinCiudad, { nombre: 'Sin Ciudad SAS', nit: '700555', ciudad: 'Pereira' });
  check('★ completar la ciudad le da el código siguiente', [completo.codigo, completo.codigo_faltantes], ['SIN-700-PER-004', []]);

  const renombrado = await proveedores.actualizarProveedor(1, idAndina, { nombre: 'Andina Global', nit: '111', ciudad: 'Bogotá' });
  check('★ renombrar, cambiar NIT y ciudad NO reescribe el código impreso', renombrado.codigo, 'DIS-900-CAL-003');

  const sinCampo = await proveedores.actualizarProveedor(1, idAndina, { nombre: 'Andina Global', nit: '111' });
  check('★ editar sin mandar `ciudad` (pantalla con la feature apagada) no la borra', sinCampo.ciudad, 'Bogotá');

  const colado = await proveedores.actualizarProveedor(1, idAndina, { nombre: 'Andina Global', nit: '111', codigo: 'HACK-1' });
  check('★ el código nunca viene del cliente al editar', colado.codigo, 'DIS-900-CAL-003');
  const coladoNuevo = await proveedores.crearProveedor(1, { nombre: 'Colado', nit: '1', ciudad: '', codigo: 'HACK-2' });
  check('★ ni al crear', coladoNuevo.codigo, null);
  await q('UPDATE proveedores SET activo = FALSE WHERE id = $1', [coladoNuevo.id]);

  const e = await falla(() => q(`UPDATE proveedores SET codigo = 'VIE-800-CAL-001' WHERE id = $1`, [idAndina]));
  check('el índice impide dos proveedores con el mismo código en un negocio', !!e, true);
  await q(`UPDATE proveedores SET codigo = 'VIE-800-CAL-001' WHERE negocio_id = 2`);
  check('pero en otro negocio el mismo código es legal', (await q(`SELECT codigo FROM proveedores WHERE negocio_id=2`))[0].codigo, 'VIE-800-CAL-001');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. El contador sigue a lo escrito a mano, y es por negocio');
// ═════════════════════════════════════════════════════════════════════════════
{
  const informal = (await q(`SELECT id FROM proveedores WHERE nombre='Informal'`))[0].id;
  await q(`UPDATE proveedores SET codigo = 'MAN-123-MED-040' WHERE id = $1`, [informal]);
  const nuevo = await proveedores.crearProveedor(1, { nombre: 'Nuevo', nit: '321', ciudad: 'Tunja' });
  check('★ un código a mano con el formato empuja el consecutivo', nuevo.codigo, 'NUE-321-TUN-041');

  await config.saveConfig(2, { codigo_producto_activo: '1', proveedor_codigo_activo: '1' });
  const ajeno = await proveedores.crearProveedor(2, { nombre: 'Ajeno Dos', nit: '222', ciudad: 'Cali' });
  check('★ el otro negocio lleva su propia numeración (sigue a su 001)', ajeno.codigo, 'AJE-222-CAL-002');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Asignar pendientes a mano');
// ═════════════════════════════════════════════════════════════════════════════
{
  await q(`INSERT INTO proveedores (negocio_id, nombre, nit, ciudad) VALUES (1,'Cargado por SQL','456','Ibagué')`);
  const r = await proveedores.asignarCodigosPendientes(1);
  check('★ asigna lo que esté listo y reporta lo que no', [r.asignados.map((a) => a.codigo), r.pendientes.length], [['CAR-456-IBA-042'], 0]);

  await config.saveConfig(1, { proveedor_codigo_activo: '0' });
  const e = await falla(() => proveedores.asignarCodigosPendientes(1));
  check('★ con la feature apagada responde 400', e?.status, 400);
  const apagado = await proveedores.crearProveedor(1, { nombre: 'Tras Apagar', nit: '999', ciudad: 'Cali' });
  check('y crear ya no asigna', apagado.codigo, null);
  check('★ apagarla no borra los códigos ya impresos', await codigoDe(idAndina), 'DIS-900-CAL-003');
  await config.saveConfig(1, { proveedor_codigo_activo: '1' });
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. Etiquetas de una compra');
// ═════════════════════════════════════════════════════════════════════════════
// Compra #15 de la Andina en la sede Principal:
//   L1 Audífonos Blanco (variante con código) × 5, 1 devuelta
//   L2 Estuche (producto sin variantes, con código) × 3
//   L3 Cable (producto sin código) × 2
//   L4 iPhone 11 IMEI 356000000000011
//   L5 Correa (el producto GANÓ variantes después: la línea quedó arriba) × 4
let compraId;
{
  await db.exec(`
    INSERT INTO productos_cantidad (id, nombre, stock, precio, sucursal_id, linea_id, codigo) VALUES
      (100, 'Audífonos', 5, 40000, 1, 1, 'ACC-AUD-001'),
      (101, 'Estuche',   3, 15000, 1, 1, 'ACC-EST-001'),
      (102, 'Cable',     2,  8000, 1, 1, NULL),
      (103, 'Correa',    4, 20000, 1, 1, 'ACC-COR-001');
    INSERT INTO atributos_producto (id, producto_id, sucursal_id, tipo_id, valor, stock, codigo) VALUES
      (200, 100, 1, 1, 'Blanco', 4, 'ACC-AUD-BLA-002'),
      (201, 103, 1, 1, 'Negro',  4, 'ACC-COR-NEG-002');
    INSERT INTO productos_serial (id, nombre, precio, sucursal_id) VALUES (300, 'iPhone 11', 1800000, 1), (301, 'iPhone 11', 1700000, 2);
    INSERT INTO seriales (producto_id, imei, color, costo_compra) VALUES
      (301, '356000000000011', 'Rojo', 900000),
      (300, '356000000000011', 'Negro', 1000000);
  `);
  const [c] = await q(`INSERT INTO compras (numero, sucursal_id, proveedor_id, total, estado)
                       VALUES (15, 1, $1, 0, 'Activa') RETURNING id`, [idAndina]);
  compraId = c.id;
  await q(`
    INSERT INTO lineas_compra (compra_id, nombre_producto, cantidad, cantidad_devuelta, producto_id, atributo_id, imei, precio_unitario) VALUES
      ($1, 'Audífonos', 5, 1, 100, 200, NULL, 20000),
      ($1, 'Estuche',   3, 0, 101, NULL, NULL, 5000),
      ($1, 'Cable',     2, 0, 102, NULL, NULL, 3000),
      ($1, 'iPhone 11', 1, 0, NULL, NULL, ' 356000000000011', 900000),
      ($1, 'Correa',    4, 0, 103, NULL, NULL, 7000)`, [compraId]);

  const ADMIN = { rol: 'admin_negocio', sucursalId: 1 };
  const { compra, lineas } = await etiquetas.lineasDeCompra(1, ADMIN, compraId);
  check('★ la cabecera trae el proveedor y su código', [compra.numero, compra.proveedor_nombre, compra.codigo_proveedor], [15, 'Andina Global', 'DIS-900-CAL-003']);
  const resumen = lineas.map((l) => [l.tipo, l.nombre, l.variante_label, l.codigo, l.cantidad, l.problema]);
  check('★ cada línea, con su nodo, su código y lo que queda por etiquetar', resumen, [
    ['cantidad', 'Audífonos', 'Blanco', 'ACC-AUD-BLA-002', 4, null],
    ['cantidad', 'Estuche', null, 'ACC-EST-001', 3, null],
    ['cantidad', 'Cable', null, null, 2, 'sin_codigo'],
    ['serial', 'iPhone 11', 'Negro', '356000000000011', 1, null],
    ['cantidad', 'Correa', null, null, 4, 'sin_nodo'],
  ]);
  check('★ el equipo sale con la fila de SU sede, no la de la otra', lineas[3].precio, '1800000');
  check('ninguna línea trae costo', lineas.some((l) => 'costo_unitario' in l || 'precio_unitario' in l || 'costo_compra' in l), false);

  const body = { formato: 'a4-5x13', simbologia: 'barras', mostrar: { nombre: true, variante: true, precio: false } };
  const plan = await etiquetas.planearCompra(1, ADMIN, compraId, body);
  check('★ el plan cuenta 4 + 3 + 1 etiquetas', [plan.total, plan.paginas], [8, 1]);
  check('★ y dice qué líneas no pueden salir', plan.conProblema.map((p) => [p.nombre, p.problema]), [['Cable', 'sin_codigo'], ['Correa', 'sin_nodo']]);

  const soloUna = await etiquetas.planearCompra(1, ADMIN, compraId, { ...body, cantidades: { [lineas[0].linea_id]: 1, [lineas[1].linea_id]: 0 } });
  check('★ reimprimir una sola etiqueta rota: 1 + 0 + 1', soloUna.total, 2);
  const basura = await etiquetas.planearCompra(1, ADMIN, compraId, { ...body, cantidades: { [lineas[0].linea_id]: 'abc', [lineas[1].linea_id]: -5 } });
  check('una cantidad ilegible usa la de la línea; una negativa, cero', basura.total, 4 + 0 + 1);

  const SUP_OTRA = { rol: 'supervisor', sucursalId: 2 };
  const e403 = await falla(() => etiquetas.lineasDeCompra(1, SUP_OTRA, compraId));
  check('★ un supervisor de otra sede no etiqueta esta compra', e403?.status, 403);
  const supPropia = await etiquetas.lineasDeCompra(1, { rol: 'supervisor', sucursalId: 1 }, compraId);
  check('el de la sede sí', supPropia.lineas.length, 5);
  const e404 = await falla(() => etiquetas.lineasDeCompra(2, { rol: 'admin_negocio' }, compraId));
  check('★ desde otro negocio la compra no existe', e404?.status, 404);
  const e400 = await falla(() => etiquetas.lineasDeCompra(1, ADMIN, 'abc'));
  check('un id que no es número es 400', e400?.status, 400);

  // El PDF de verdad: qué texto se dibuja.
  const { buf, lista } = await textosDelPdf(() => new Promise((ok, ko) => {
    etiquetas.construirPdfCompra(1, ADMIN, compraId, body, resFalso(ok)).catch(ko);
  }));
  check('★ sale un PDF', buf.subarray(0, 5).toString('latin1'), '%PDF-');
  check('★ cada etiqueta lleva el código del proveedor', lista.filter((t) => t === 'DIS-900-CAL-003').length, 8);
  // Decisión del negocio (25-sep-2026): la palabra «Prov» no sale en NINGUNA etiqueta.
  check('★ ninguna etiqueta dice «Prov»', lista.some((t) => /prov/i.test(t)), false);
  check('★ y el código del producto legible (el símbolo es ese mismo)', [lista.filter((t) => t === 'ACC-AUD-BLA-002').length, lista.filter((t) => t === '356000000000011').length], [4, 1]);

  const { lista: sinProv } = await textosDelPdf(() => new Promise((ok, ko) => {
    etiquetas.construirPdfCompra(1, ADMIN, compraId, { ...body, mostrar: { ...body.mostrar, proveedor: false } }, resFalso(ok)).catch(ko);
  }));
  check('pedir sin proveedor lo quita', sinProv.some((t) => t.includes('DIS-900-CAL-003')), false);

  await q(`UPDATE compras SET estado = 'Cancelada' WHERE id = $1`, [compraId]);
  const e409 = await falla(() => etiquetas.planearCompra(1, ADMIN, compraId, body));
  check('★ una compra cancelada no se etiqueta', [e409?.status, e409?.code], [409, 'COMPRA_CANCELADA']);
  await q(`UPDATE compras SET estado = 'Activa' WHERE id = $1`, [compraId]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Entrada de bodega sin proveedor: el código llega al confirmar');
// ═════════════════════════════════════════════════════════════════════════════
{
  const [c] = await q(`INSERT INTO compras (numero, sucursal_id, proveedor_id, total, estado)
                       VALUES (16, 1, NULL, 0, 'Activa') RETURNING id`);
  await q(`INSERT INTO lineas_compra (compra_id, nombre_producto, cantidad, producto_id) VALUES ($1, 'Estuche', 2, 101)`, [c.id]);
  const ADMIN = { rol: 'admin_negocio' };

  const antes = await etiquetas.lineasDeCompra(1, ADMIN, c.id);
  check('★ sin proveedor todavía, la etiqueta sale sin su código', antes.compra.codigo_proveedor, null);
  const { lista } = await textosDelPdf(() => new Promise((ok, ko) => {
    etiquetas.construirPdfCompra(1, ADMIN, c.id, { formato: 'a4-5x13' }, resFalso(ok)).catch(ko);
  }));
  check('y el PDF no inventa un «Prov.» vacío', [lista.filter((t) => t === 'ACC-EST-001').length, lista.some((t) => /prov/i.test(t))], [2, false]);

  // Administración confirma y asigna el proveedor.
  await q(`UPDATE compras SET proveedor_id = $1 WHERE id = $2`, [idAndina, c.id]);
  const despues = await etiquetas.lineasDeCompra(1, ADMIN, c.id);
  check('★ reimprimir después ya lo trae (se lee en vivo)', despues.compra.codigo_proveedor, 'DIS-900-CAL-003');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. En una etiqueta chica, el proveedor es lo último que cae');
// ═════════════════════════════════════════════════════════════════════════════
{
  check('★ el orden de sacrificio termina en el proveedor', layout.ORDEN_SACRIFICIO.at(-1), 'proveedor');
  const MM = 2.83465;
  const ITEM = { nombre: 'Audífonos inalámbricos con estuche', variante_label: 'Blanco', codigo: 'ACC-AUD-BLA-002', precio: 40000, codigo_proveedor: 'DIS-900-CAL-003' };
  const op = { simbologia: 'barras', mostrar: { nombre: true, variante: true, precio: true } };
  const chica = layout.planear(32 * MM, 19 * MM, ITEM, op);
  const textos = chica.bloques.map((b) => b.texto);
  check('★ en 32 × 19 sigue estando el proveedor', textos.includes('DIS-900-CAL-003'), true);
  check('★ y el código legible', textos.includes('ACC-AUD-BLA-002'), true);
  check('lo que cayó se avisa', chica.avisos.filter((a) => a.startsWith('sin_espacio_')).length > 0, true);
  check('el proveedor no está entre lo que cayó', chica.avisos.includes('sin_espacio_proveedor'), false);
  const grande = layout.planear(60 * MM, 40 * MM, ITEM, op);
  check('en 60 × 40 cabe todo', grande.avisos.filter((a) => a.startsWith('sin_espacio_')), []);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('10. La copia del runner y el .sql dicen lo mismo');
// ═════════════════════════════════════════════════════════════════════════════
{
  const limpiar = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join(' ').replace(/\s+/g, ' ').trim();
  const archivo = limpiar(readFileSync(path.join(RAIZ, 'migrations/20260916_codigo_proveedor.sql'), 'utf8'));
  const runner = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8');
  const bloque = runner.slice(runner.indexOf("'Código de proveedor'"));
  const copia = limpiar(bloque.slice(bloque.indexOf('`') + 1, bloque.indexOf('`', bloque.indexOf('`') + 1)));
  check('★ mismas sentencias, índice incluido', copia, archivo);
  const [idx] = await q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_proveedores_codigo'`);
  check('el índice es parcial y por negocio', /\(negocio_id, codigo\) WHERE \(codigo IS NOT NULL\)/.test(idx?.indexdef || ''), true);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('11. Las pantallas prometen lo que el backend hace');
// ═════════════════════════════════════════════════════════════════════════════
{
  const FRONT = path.resolve(RAIZ, '../frontend/src');
  const leer = (p) => readFileSync(path.join(FRONT, p), 'utf8');

  check('★ Ajustes muestra el mismo ejemplo que genera el motor',
    leer('pages/configuracion/ComprasConfig.jsx').includes(`'${util.EJEMPLO}'`), true);

  const ui = leer('pages/inventario/etiquetas/etiquetasUi.js');
  check('★ una sola regla para ofrecer etiquetas: exige las DOS claves, como el backend',
    /codigo_producto_activo === '1' && config\?\.proveedor_codigo_activo === '1'/.test(ui), true);

  const pantallas = [
    'pages/proveedores/ModalCompra.jsx', 'pages/proveedores/ModalRecibir.jsx',
    'pages/entradas/VistaEntrada.jsx', 'pages/entradas/EntradasPage.jsx',
    'pages/proveedores/ProveedoresPage.jsx',
  ];
  check('★ compra, recepción, entrada y los dos detalles usan esa regla y el mismo modal',
    pantallas.filter((p) => { const s = leer(p); return s.includes('etiquetasCompraActivas(') && s.includes('<ModalEtiquetasCompra'); }),
    pantallas);

  const modal = leer('pages/inventario/ModalEtiquetasCompra.jsx');
  check('★ el modal usa la configuración guardada de Etiquetas, no un editor propio',
    [modal.includes('leerPreferencias'), /SelectorFormato|PanelImpresora|guardarPreferencias/.test(modal)], [true, false]);
  check('y pide el PDF de la COMPRA, no el de Inventario',
    [modal.includes('pdfEtiquetasCompra'), /pdfEtiquetas\b(?!Compra)/.test(modal)], [true, false]);

  const proveedoresPage = leer('pages/proveedores/ProveedoresPage.jsx');
  check('★ el formulario no manda la ciudad con la feature apagada (no la borra)',
    /if \(!conCodigo\) delete payload\.ciudad/.test(proveedoresPage), true);
  check('los textos de lo que falta cubren las tres claves del motor',
    ['nombre', 'nit', 'ciudad'].every((k) => new RegExp(`${k}: '`).test(proveedoresPage)), true);
  check('★ el aviso nuevo del plano tiene su texto', leer('pages/inventario/etiquetas/etiquetasUi.js').includes('sin_espacio_proveedor'), true);
}

console.log(`\n${fallos === 0 ? '✅' : '❌'} ${pasados} verificaciones, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
