// ─────────────────────────────────────────────────────────────────────────────
// CÓDIGO AUTOMÁTICO — todo nodo nace con su código (contra Postgres real, PGlite)
//
// Hasta ahora un producto por cantidad nacía sin código y había que acordarse de
// ir a Etiquetas → «Generar códigos» antes de poder escanearlo. Con el código
// automático, cada nodo nace con el suyo: el producto sin variantes con el suyo;
// con variantes, cada talla con el propio (lo que se escanea y se etiqueta es la
// hoja), y el producto conserva el suyo como identidad entre sedes.
//
// Un solo motor (`utils/codigoAuto.util.js`) lo hace para los cuatro caminos:
// crear producto, crear atributo/variante, la generación masiva de Etiquetas y
// la recepción de la red interna (que solo COPIA: el nodo es el mismo que el de
// la bodega). El importador tiene su sección en `18-importacion`.
//
// Lo que hay que mirar primero es la sección 1: con la feature apagada —o con
// el código automático apagado— NADA cambia. Es lo que protege a los negocios
// que ya operan.
//
// Las reglas que se sostienen aquí, en el orden del motor:
//   · nunca se pisa un código (sección 3 y 8);
//   · se hereda antes de inventar, y heredar no gasta números (4 y 6);
//   · si el código heredado está ocupado en la sede NO se inventa otro distinto
//     (7) — la generación masiva lo hacía y además lo propagaba encima del de la
//     otra sede (8);
//   · se propaga solo a lo vacío (7);
//   · un código = un nodo por sede, en los tres niveles (12);
//   · asignar el código nunca tumba la operación que lo dispara (11).
//
//   node scripts/pruebas-red-interna/44-codigo-automatico.mjs
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
for (const m of ['20260725_red_interna.sql', '20260726_red_interna_v2.sql',
                 '20260822_red_interna_envios.sql', '20260823_red_interna_control.sql',
                 '20260823_red_interna_cargos_pagables.sql',
                 '20260823_remision_variantes.sql', '20260823_lotes_cantidad.sql', '20260823_valor_acreditado.sql',
                 '20260824_costo_origen_remision.sql']) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}
// Los índices únicos REALES de producción (src/config/migrations.js). El fixture
// solo trae el del producto; sin los otros dos, un código repetido en una talla
// pasaría la prueba y reventaría en producción.
await db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_cantidad_codigo
    ON productos_cantidad (sucursal_id, codigo) WHERE codigo IS NOT NULL AND activo;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_atributos_producto_codigo
    ON atributos_producto (sucursal_id, codigo) WHERE codigo IS NOT NULL AND activo;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_variantes_atributo_codigo
    ON variantes_atributo (atributo_id, codigo) WHERE codigo IS NOT NULL AND activo;
`);

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const productos = require(path.join(RAIZ, 'src/modules/productos/productosCantidad.service.js'));
const variantes = require(path.join(RAIZ, 'src/modules/variantes-producto/variantes-producto.service.js'));
const etiquetas = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.service.js'));
const config    = require(path.join(RAIZ, 'src/modules/config/config.service.js'));
const red       = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const redRepo   = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const auto      = require(path.join(RAIZ, 'src/utils/codigoAuto.util.js'));
const { buscarCodigoEnUso } = require(path.join(RAIZ, 'src/utils/codigo.util.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
}
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ': ' + detalle : ''}`);
  cond ? pasados++ : fallos++;
}
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

const contador = async (negocioId) => {
  const [r] = await q(`SELECT ultimo_numero FROM contadores_documento WHERE negocio_id=$1 AND tipo='codigo_producto'`, [negocioId]);
  return r ? Number(r.ultimo_numero) : null;
};
const codigoDe = async (tabla, id) => (await q(`SELECT codigo FROM ${tabla} WHERE id=$1`, [id]))[0]?.codigo ?? null;
const idProducto = async (sucursalId, nombre) =>
  (await q(`SELECT id FROM productos_cantidad WHERE sucursal_id=$1 AND nombre=$2 AND activo`, [sucursalId, nombre]))[0]?.id;

// ── Datos ────────────────────────────────────────────────────────────────────
// Negocio 1: dos sedes, código único encendido y el automático por defecto
//            (sin la clave: ausente = encendido).
// Negocio 2: ajeno, con códigos altos — su numeración no puede contaminar la
//            del negocio 1.
// Negocio 3: sin la feature. Negocio 4: feature encendida, automático apagado.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tienda'), ('Ajeno'), ('Sin feature'), ('Auto apagado');
  INSERT INTO sucursales (negocio_id, nombre) VALUES
    (1,'Principal'), (1,'Sur'), (2,'Ajena'), (3,'Unica'), (4,'Unica');
  INSERT INTO usuarios (nombre) VALUES ('Admin'), ('Vendedor');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Accesorios'), (2,'X'), (3,'Y'), (4,'Z');
  INSERT INTO config_negocio VALUES
    (1,'codigo_producto_activo','1'), (1,'variantes_activo','1'),
    (1,'red_interna_activa','1'),     (1,'red_interna_bodega_id','1'),
    (2,'codigo_producto_activo','1'),
    (4,'codigo_producto_activo','1'), (4,'codigo_auto','0');

  -- Sede 1 ya usa códigos numéricos: el más alto es 000120.
  INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id, codigo, stock) VALUES
    ('Cargador', 1, 1, '000120', 5);
  -- El negocio ajeno llega hasta 000900.
  INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id, codigo, stock) VALUES
    ('Cosa ajena', 3, 2, '000900', 1);
`);

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Con la feature apagada, o con el automático apagado, NADA cambia');
// ═════════════════════════════════════════════════════════════════════════════
{
  const p3 = await productos.crearProducto(3, { nombre: 'Tornillo', sucursal_id: 4, linea_id: 3 });
  check('sin código único: el producto nace sin código, como siempre', p3.codigo ?? null, null);
  check('y el negocio no estrena contador', await contador(3), null);

  const p4 = await productos.crearProducto(4, { nombre: 'Tuerca', sucursal_id: 5, linea_id: 4 });
  check('con codigo_auto = 0: nace sin código', p4.codigo ?? null, null);
  const a4 = await variantes.crearAtributo(4, p4.id, { valor: 'Grande' });
  check('y su atributo también', a4.codigo ?? null, null);
  check('ni un número gastado', await contador(4), null);

  const cfg = auto.configCodigoAuto({ codigo_producto_activo: '1' });
  check('★ ausente = encendido cuando el código único está activo', cfg.activo, true);
  check('sin el código único, el automático no existe', auto.configCodigoAuto({ codigo_auto: '1' }).activo, false);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Un producto nuevo nace con el siguiente código del negocio');
// ═════════════════════════════════════════════════════════════════════════════
let audifonos;
{
  audifonos = await productos.crearProducto(1, { nombre: 'Audífonos', sucursal_id: 1, linea_id: 1, stock: 0 });
  check('★ continúa la numeración (el mayor era 000120)', audifonos.codigo, '000121');
  check('queda guardado, no solo en la respuesta', await codigoDe('productos_cantidad', audifonos.id), '000121');
  check('el contador queda en el último repartido', await contador(1), 121);

  const funda = await productos.crearProducto(1, { nombre: 'Funda', sucursal_id: 1, linea_id: 1 });
  check('el siguiente producto, el siguiente número', funda.codigo, '000122');
  check('★ el 000900 del negocio ajeno no movió nada', await contador(1), 122);

  const code128 = require(path.join(RAIZ, 'src/utils/code128.util.js'));
  check('lo generado se puede imprimir como código de barras', code128.esImprimible(funda.codigo), true);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Lo escrito a mano manda: el automático solo llena lo vacío');
// ═════════════════════════════════════════════════════════════════════════════
{
  const conEan = await productos.crearProducto(1, { nombre: 'Cable', sucursal_id: 1, linea_id: 1, codigo: '7701234567890' });
  check('el código escaneado de fábrica se respeta', conEan.codigo, '7701234567890');
  check('★ y no gasta un número del contador', await contador(1), 122);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. El mismo producto en otra sede HEREDA su código, no inventa otro');
// ═════════════════════════════════════════════════════════════════════════════
let audifonosSur;
{
  audifonosSur = await productos.crearProducto(1, { nombre: 'Audífonos', sucursal_id: 2, linea_id: 1 });
  check('★ lleva el mismo código que en Principal', audifonosSur.codigo, '000121');
  check('y heredar no gasta números', await contador(1), 122);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Con variantes, cada talla nace con SU código');
// ═════════════════════════════════════════════════════════════════════════════
let blanco, verde, blancoM;
{
  blanco = await variantes.crearAtributo(1, audifonos.id, { valor: 'Blanco' });
  verde  = await variantes.crearAtributo(1, audifonos.id, { valor: 'Verde' });
  check('★ la primera talla, el siguiente número', blanco.codigo, '000123');
  check('la segunda, el siguiente', verde.codigo, '000124');
  check('★ el producto conserva el suyo (identidad entre sedes)',
    await codigoDe('productos_cantidad', audifonos.id), '000121');

  blancoM = await variantes.crearVariante(1, blanco.id, { valor: 'M' });
  check('la sub-variante también nace con código', blancoM.codigo, '000125');

  const rojo = await variantes.crearAtributo(1, audifonos.id, { valor: 'Rojo', codigo: 'rojo-1' });
  check('un código escrito para la talla se respeta (en mayúsculas)', rojo.codigo, 'ROJO-1');
  check('y no gasta número', await contador(1), 125);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. La talla en la otra sede también hereda');
// ═════════════════════════════════════════════════════════════════════════════
{
  const blancoSur = await variantes.crearAtributo(1, audifonosSur.id, { valor: 'blanco' });
  check('★ «blanco» en Sur = «Blanco» en Principal → mismo código', blancoSur.codigo, '000123');
  check('sin gastar número', await contador(1), 125);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. Propagación: llena lo vacío en las otras sedes y nunca pisa');
// ═════════════════════════════════════════════════════════════════════════════
{
  // Sur ya tiene unas «Gafas» SIN código; Principal las crea ahora.
  await db.exec(`INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id) VALUES ('Gafas', 2, 1)`);
  const gafas = await productos.crearProducto(1, { nombre: 'Gafas', sucursal_id: 1, linea_id: 1 });
  check('Principal: número nuevo', gafas.codigo, '000126');
  check('★ Sur recibe el MISMO código (estaba vacío)',
    await codigoDe('productos_cantidad', await idProducto(2, 'Gafas')), '000126');

  // Heredable pero BLOQUEADO: «Correa» tiene COR-2 en Sur, y en Principal ese
  // código ya lo tiene otro producto. Inventarle uno distinto partiría su
  // identidad entre sedes; se queda sin código y la otra sede no se toca.
  await db.exec(`
    INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id, codigo) VALUES ('Correa', 2, 1, 'COR-2');
    INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id, codigo) VALUES ('Otra cosa', 1, 1, 'COR-2');
  `);
  const antes = await contador(1);
  const correa = await productos.crearProducto(1, { nombre: 'Correa', sucursal_id: 1, linea_id: 1 });
  check('★ no se inventa un segundo código para el mismo producto', correa.codigo ?? null, null);
  check('★ la otra sede conserva COR-2', await codigoDe('productos_cantidad', await idProducto(2, 'Correa')), 'COR-2');
  check('ni se gastó un número', await contador(1), antes);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. La generación masiva de Etiquetas usa el MISMO motor');
// ═════════════════════════════════════════════════════════════════════════════
{
  // Nodos viejos, de antes del automático: sin código.
  await db.exec(`
    INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id) VALUES ('Vidrio', 1, 1), ('Soporte', 1, 1);
    -- El mismo «Soporte» en Sur tiene SOP-9, y en Principal SOP-9 ya lo usa otro.
    INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id, codigo) VALUES ('Soporte', 2, 1, 'SOP-9');
    INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id, codigo) VALUES ('Ocupa SOP', 1, 1, 'SOP-9');
  `);
  const sel = [
    { nivel: 'producto', producto_id: await idProducto(1, 'Vidrio') },
    { nivel: 'producto', producto_id: await idProducto(1, 'Soporte') },
    { nivel: 'producto', producto_id: await idProducto(1, 'Cargador') },   // ya tiene código
  ];
  const r = await etiquetas.generarCodigos(1, 1, { seleccion: sel });
  check('asigna solo al que puede', r.asignados, 1);
  check('el que ya tenía código se omite', r.omitidos, 1);
  check('★ el bloqueado se REPORTA con quién tiene el código',
    r.bloqueados.map((b) => [b.nombre, b.codigo, b.bloqueadoPor]), [['Soporte', 'SOP-9', 'Ocupa SOP']]);
  check('★ y la otra sede conserva SOP-9 (antes se pisaba con uno nuevo)',
    await codigoDe('productos_cantidad', await idProducto(2, 'Soporte')), 'SOP-9');
  check('sin prefijo ni dígitos usa los de Ajustes: 6 dígitos', r.detalle[0].codigo, '000127');
  check('el Cargador conserva el suyo', await codigoDe('productos_cantidad', await idProducto(1, 'Cargador')), '000120');

  const r2 = await etiquetas.generarCodigos(1, 1, { seleccion: sel });
  check('★ una segunda pasada no cambia nada', [r2.asignados, r2.detalle.length], [0, 0]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. Ajustes valida con las MISMAS reglas del motor');
// ═════════════════════════════════════════════════════════════════════════════
{
  const intentar = async (datos) => { try { await config.saveConfig(1, datos); return null; } catch (e) { return e.message; } };
  ok('un prefijo con espacios se rechaza', /prefijo/i.test(await intentar({ codigo_auto_prefijo: 'A B' }) || ''));
  ok('3 dígitos se rechaza', /dígitos/i.test(await intentar({ codigo_auto_digitos: '3' }) || ''));
  ok('11 dígitos se rechaza', /dígitos/i.test(await intentar({ codigo_auto_digitos: '11' }) || ''));
  ok('un valor raro para el interruptor se rechaza', /encendido/i.test(await intentar({ codigo_auto: 'si' }) || ''));

  check('un prefijo válido se guarda en mayúsculas', await intentar({ codigo_auto_prefijo: 'ac', codigo_auto_digitos: '5' }), null);
  const [{ valor: pref }] = await q(`SELECT valor FROM config_negocio WHERE negocio_id=1 AND clave='codigo_auto_prefijo'`);
  check('guardado', pref, 'AC');

  const conPrefijo = await productos.crearProducto(1, { nombre: 'Llavero', sucursal_id: 1, linea_id: 1 });
  check('★ el producto nuevo nace con el prefijo y los dígitos de Ajustes', conPrefijo.codigo, 'AC00128');

  await intentar({ codigo_auto_prefijo: '', codigo_auto_digitos: '6' });
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('10. Red interna: la talla que llega al local nace con el código de la bodega');
// ═════════════════════════════════════════════════════════════════════════════
{
  // Bodega (sede 1): «Reloj» con tallas 38MM (con código) y 42MM.
  await db.exec(`
    INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, codigo)
      VALUES (1, 'Reloj', 12, 3700, 1, 'REL-1');
    INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario, codigo)
      VALUES ((SELECT id FROM productos_cantidad WHERE sucursal_id=1 AND nombre='Reloj'), 1, '38MM', 6, 3700, 'REL-38'),
             ((SELECT id FROM productos_cantidad WHERE sucursal_id=1 AND nombre='Reloj'), 1, '42MM', 6, 3700, 'REL-42');
    -- El local tiene el producto pero NO la talla 38MM; y el código REL-42 ya
    -- lo usa otra cosa en el local.
    INSERT INTO productos_cantidad (sucursal_id, nombre, stock, linea_id, codigo)
      VALUES (2, 'Reloj', 0, 1, 'REL-1'), (2, 'Tapa', 0, 1, 'REL-42');
  `);
  const reqBodega = {
    user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true,
    red: { activa: true, bodega_id: 1, modo_precio: 'costo', confirmar_recepcion: true,
           confirmar_remesa: true, ocultar_costos: true },
  };
  const reqLocal = { user: { id: 2, negocio_id: 1, rol: 'vendedor' }, sucursal_id: 2, esBodega: false, red: { ...reqBodega.red } };

  const relojB = await idProducto(1, 'Reloj');
  const [a38] = await q(`SELECT id FROM atributos_producto WHERE producto_id=$1 AND valor='38MM'`, [relojB]);
  const [a42] = await q(`SELECT id FROM atributos_producto WHERE producto_id=$1 AND valor='42MM'`, [relojB]);

  const rem = await red.despachar(reqBodega, {
    sucursal_destino_id: 2,
    lineas: [
      { tipo: 'cantidad', producto_id: relojB, atributo_id: a38.id, cantidad: 2, valor_interno: 5000 },
      { tipo: 'cantidad', producto_id: relojB, atributo_id: a42.id, cantidad: 1, valor_interno: 5000 },
    ],
  });
  const lineas = await redRepo.getLineasRemision(rem.id);
  await red.recibir(reqLocal, rem.id, { lineas_recibidas: lineas.map((l) => Number(l.id)) });

  const relojL = await idProducto(2, 'Reloj');
  const [l38] = await q(`SELECT codigo, stock FROM atributos_producto WHERE producto_id=$1 AND valor='38MM'`, [relojL]);
  const [l42] = await q(`SELECT codigo, stock FROM atributos_producto WHERE producto_id=$1 AND valor='42MM'`, [relojL]);
  check('★ la 38MM nace en el local con el código de la bodega', l38?.codigo, 'REL-38');
  check('y con su stock', Number(l38?.stock), 2);
  check('★ la 42MM nace sin código: en el local REL-42 ya es de otra cosa', l42?.codigo ?? null, null);
  check('y la recepción NO se cayó por eso: el stock llegó', Number(l42?.stock), 1);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('11. Asignar el código NUNCA tumba la creación');
// ═════════════════════════════════════════════════════════════════════════════
{
  await db.exec(`ALTER TABLE contadores_documento RENAME TO contadores_documento_x`);
  let creado = null, error = null;
  try { creado = await productos.crearProducto(1, { nombre: 'Sin contador', sucursal_id: 1, linea_id: 1 }); }
  catch (e) { error = e.message; }
  await db.exec(`ALTER TABLE contadores_documento_x RENAME TO contadores_documento`);
  ok('★ el producto se crea aunque el contador falle', !!creado?.id, error || '');
  check('y queda sin código (se le genera después desde Etiquetas)', creado?.codigo ?? null, null);

  // La conexión quedó sana: lo siguiente funciona.
  const despues = await productos.crearProducto(1, { nombre: 'Después', sucursal_id: 1, linea_id: 1 });
  ok('la siguiente creación ya recibe código', /^\d{6}$/.test(despues.codigo || ''), despues.codigo);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('12. Un código = un nodo por sede, en los tres niveles');
// ═════════════════════════════════════════════════════════════════════════════
{
  const todos = await q(`
    SELECT pc.sucursal_id, pc.codigo FROM productos_cantidad pc WHERE pc.activo AND pc.codigo IS NOT NULL
    UNION ALL
    SELECT ap.sucursal_id, ap.codigo FROM atributos_producto ap WHERE ap.activo AND ap.codigo IS NOT NULL
    UNION ALL
    SELECT ap.sucursal_id, v.codigo FROM variantes_atributo v JOIN atributos_producto ap ON ap.id = v.atributo_id
     WHERE v.activo AND v.codigo IS NOT NULL`);
  const repetidos = new Set();
  for (const { sucursal_id: s, codigo } of todos) {
    const n = (await buscarCodigoEnUso(null, { sucursalId: s, codigo })).length;
    if (n > 1) repetidos.add(`${codigo}@${s}×${n}`);
  }
  check(`★ ninguno de los ${todos.length} códigos quedó en dos nodos de la misma sede`, [...repetidos], []);
}

console.log('\n' + '─'.repeat(62));
if (fallos) { console.log(`✗ ${fallos} FALLO(S) de ${fallos + pasados}`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
