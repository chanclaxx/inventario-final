// ─────────────────────────────────────────────────────────────────────────────
// CÓDIGO CON PATRÓN + CREAR EL PRODUCTO CON SUS VARIANTES DE UNA VEZ
// (contra Postgres real, PGlite)
//
// Dos cambios que viajan juntos:
//
//   · `codigo_auto_formato = 'patron'`: el código generado deja de ser un
//     número (000121) y pasa a ser CATEGORÍA-PRODUCTO-VARIANTE-consecutivo
//     (ACC-AUD-BLA-002). El consecutivo es por raíz CAT-PRO, así que dos
//     productos con las mismas tres letras comparten numeración y nunca chocan.
//
//   · `POST /productos-cantidad` acepta `variantes`: el producto nace con su
//     árbol completo en UNA transacción, en vez de crear el producto y luego ir
//     talla por talla.
//
// Lo que hay que mirar primero es la sección 1: sin la clave de formato los
// códigos siguen saliendo numéricos, y sin `variantes` crear un producto es el
// camino de siempre. Es lo que protege a los negocios que ya operan.
//
//   node scripts/pruebas-red-interna/45-codigo-patron.mjs
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
// Los índices únicos REALES de producción (src/config/migrations.js).
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
const auto      = require(path.join(RAIZ, 'src/utils/codigoAuto.util.js'));
const patron    = require(path.join(RAIZ, 'src/utils/codigoPatron.util.js'));
const code128   = require(path.join(RAIZ, 'src/utils/code128.util.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
}
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const falla = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const ADMIN = { rol: 'admin_negocio' };
const contadorRaiz = async (negocioId, raiz) => {
  const [r] = await q(`SELECT ultimo_numero FROM contadores_documento WHERE negocio_id=$1 AND tipo=$2`,
    [negocioId, `codigo_patron:${raiz}`]);
  return r ? Number(r.ultimo_numero) : null;
};
const codigoDe = async (tabla, id) => (await q(`SELECT codigo FROM ${tabla} WHERE id=$1`, [id]))[0]?.codigo ?? null;
const cuantos = async (nombre) => Number((await q(`SELECT COUNT(*)::int AS n FROM productos_cantidad WHERE nombre=$1`, [nombre]))[0].n);
// El árbol devuelto, aplanado a { 'Blanco': código } / { '38MM / Negro': código }.
// Con las claves ORDENADAS: `getArbol` ordena por valor y el `check` compara el
// JSON, así que sin ordenar fallaría por el orden y no por el código.
const codigosArbol = (arbol) => Object.fromEntries(arbol.flatMap((a) => (a.variantes?.length
  ? a.variantes.map((v) => [`${a.valor} / ${v.valor}`, v.codigo])
  : [[a.valor, a.codigo]])).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));

// ── Datos ────────────────────────────────────────────────────────────────────
// Negocio 1: dos sedes, código único + variantes + formato PATRÓN.
// Negocio 2: código único con el formato de siempre (sin la clave).
// Negocio 3: patrón, pero SIN variantes.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tienda'), ('Numerico'), ('Sin variantes');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal'), (1,'Sur'), (2,'Unica'), (3,'Unica');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Accesorios'), (2,'Varios'), (3,'Otra'), (1,'Ropa');
  INSERT INTO tipos_caracteristica (negocio_id, nombre, orden) VALUES (1,'Talla',1), (1,'Color',2), (2,'Ajeno',1);
  INSERT INTO config_negocio VALUES
    (1,'codigo_producto_activo','1'), (1,'variantes_activo','1'), (1,'codigo_auto_formato','patron'),
    (2,'codigo_producto_activo','1'),
    (3,'codigo_producto_activo','1'), (3,'codigo_auto_formato','patron');
`);
const TALLA = 1, COLOR = 2, TIPO_AJENO = 3;

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Sin la clave de formato, y sin variantes, NADA cambia');
// ═════════════════════════════════════════════════════════════════════════════
{
  const cfg = auto.configCodigoAuto({ codigo_producto_activo: '1' });
  check('★ formato ausente = numérico', cfg.formato, 'numero');
  check('un formato desconocido también es numérico', auto.configCodigoAuto({ codigo_producto_activo: '1', codigo_auto_formato: 'raro' }).formato, 'numero');

  const tornillo = await productos.crearProducto(2, { nombre: 'Tornillo', sucursal_id: 3, linea_id: 2 });
  check('★ el negocio sin la clave sigue recibiendo números', tornillo.codigo, '000001');
  check('★ sin `variantes` la respuesta es la de siempre (no trae árbol)', 'arbol' in tornillo, false);

  const vacio = await productos.crearProducto(2, { nombre: 'Tuerca', sucursal_id: 3, linea_id: 2, variantes: [] }, { rol: 'vendedor' });
  check('una lista vacía es el camino de siempre, incluso para un vendedor', [vacio.codigo, 'arbol' in vacio], ['000002', false]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Las tres letras');
// ═════════════════════════════════════════════════════════════════════════════
{
  check('sin tildes', patron.tresLetras('Audífonos'), 'AUD');
  check('la Ñ pasa a N', patron.tresLetras('Niño'), 'NIN');
  check('★ las cifras cuentan (38MM ≠ 42MM)', [patron.tresLetras('38MM'), patron.tresLetras('42MM')], ['38M', '42M']);
  check('se rellena lo corto con X', patron.tresLetras('M'), 'MXX');
  check('espacios y símbolos no cuentan', patron.tresLetras('  3D S'), '3DS');
  check('solo símbolos = nada', patron.tresLetras('---'), null);
  check('sin categoría: GEN', patron.componerPatron({ categoria: null, producto: 'Vidrio' }, 1), 'GEN-VID-001');
  check('★ una variante hecha de símbolos conserva su segmento',
    patron.componerPatron({ categoria: 'Accesorios', producto: 'Audífonos', variante: '/' }, 12), 'ACC-AUD-XXX-012');
  check('pasado 999 el número crece solo', patron.componerPatron({ categoria: 'Accesorios', producto: 'Cargador' }, 1000), 'ACC-CAR-1000');
  const re = new RegExp(patron.regexRaiz('ACC-AUD'));
  check('la raíz reconoce sus códigos (con y sin variante)', [re.test('ACC-AUD-BLA-002'), re.test('ACC-AUD-002')], [true, true]);
  check('★ y no los de una raíz que solo empieza igual', re.test('ACC-AUDX-002'), false);
  check('se puede imprimir como código de barras', code128.esImprimible('ACC-AUD-BLA-002'), true);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Producto sin variantes: CAT-PRO-número');
// ═════════════════════════════════════════════════════════════════════════════
{
  const cargador = await productos.crearProducto(1, { nombre: 'Cargador', sucursal_id: 1, linea_id: 1 });
  check('★ Accesorios · Cargador', cargador.codigo, 'ACC-CAR-001');
  const carcasa = await productos.crearProducto(1, { nombre: 'Carcasa', sucursal_id: 1, linea_id: 1 });
  check('★ «Carcasa» también es CAR: comparte numeración y NO choca', carcasa.codigo, 'ACC-CAR-002');
  check('un contador por raíz', await contadorRaiz(1, 'ACC-CAR'), 2);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. ★ Crear el producto CON sus variantes, de una vez');
// ═════════════════════════════════════════════════════════════════════════════
let audifonos;
{
  audifonos = await productos.crearProducto(1, {
    nombre: 'Audífonos', sucursal_id: 1, linea_id: 1, precio: 30000,
    variantes: [
      { valor: 'Blanco', tipo_id: COLOR, precio: 25000 },
      { valor: 'Verde', tipo_id: COLOR },
      { valor: 'Rosado', tipo_id: COLOR },
    ],
  }, ADMIN);
  check('★ el producto nace con su código', audifonos.codigo, 'ACC-AUD-001');
  check('★ cada variante con el suyo, seguidos', codigosArbol(audifonos.arbol),
    { Blanco: 'ACC-AUD-BLA-002', Rosado: 'ACC-AUD-ROS-004', Verde: 'ACC-AUD-VER-003' });
  check('queda guardado, no solo en la respuesta', await codigoDe('productos_cantidad', audifonos.id), 'ACC-AUD-001');
  check('el precio propio de la variante se guarda', Number(audifonos.arbol.find((a) => a.valor === 'Blanco').precio), 25000);
  check('el tipo viaja con el nodo', audifonos.arbol[0].tipo_nombre, 'Color');
  check('★ el stock nace en 0: entra después, con su rastro', [Number(audifonos.stock), ...audifonos.arbol.map((a) => a.stock)], [0, 0, 0, 0]);
  check('contador de la raíz', await contadorRaiz(1, 'ACC-AUD'), 4);

  const camiseta = await productos.crearProducto(1, {
    nombre: 'Camiseta', sucursal_id: 1, linea_id: 4,
    variantes: [{ valor: 'S', tipo_id: TALLA }, { valor: 'M', tipo_id: TALLA }],
  }, ADMIN);
  check('otra categoría, otra raíz; las tallas cortas se rellenan',
    [camiseta.codigo, codigosArbol(camiseta.arbol)], ['ROP-CAM-001', { M: 'ROP-CAM-MXX-003', S: 'ROP-CAM-SXX-002' }]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Dos características (talla × color): se etiqueta la HOJA');
// ═════════════════════════════════════════════════════════════════════════════
{
  const correa = await productos.crearProducto(1, {
    nombre: 'Correa', sucursal_id: 1, linea_id: 1,
    variantes: [
      { valor: '38MM', tipo_id: TALLA, variantes: [{ valor: 'Negro', tipo_id: COLOR }, { valor: 'Café', tipo_id: COLOR }] },
      { valor: '42MM', tipo_id: TALLA, variantes: [{ valor: 'Negro', tipo_id: COLOR }] },
    ],
  }, ADMIN);
  check('producto', correa.codigo, 'ACC-COR-001');
  check('★ cada hoja con su código; 38MM/Negro y 42MM/Negro no chocan', codigosArbol(correa.arbol),
    { '38MM / Café': 'ACC-COR-CAF-003', '38MM / Negro': 'ACC-COR-NEG-002', '42MM / Negro': 'ACC-COR-NEG-004' });
  check('★ la talla contenedora NO gasta un número', correa.arbol.map((a) => a.codigo), [null, null]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Lo escrito a mano manda');
// ═════════════════════════════════════════════════════════════════════════════
{
  await db.exec(`INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id, codigo) VALUES ('Funda vieja', 1, 1, 'ACC-FUN-050')`);
  const funda = await productos.crearProducto(1, { nombre: 'Funda', sucursal_id: 1, linea_id: 1 });
  check('★ un código a mano con el patrón hace que el siguiente siga después', funda.codigo, 'ACC-FUN-051');

  const gorra = await productos.crearProducto(1, {
    nombre: 'Gorra', sucursal_id: 1, linea_id: 4,
    variantes: [{ valor: 'Roja', codigo: '7701' }, { valor: 'Azul' }],
  }, ADMIN);
  check('★ el código de fábrica de una variante se respeta y no gasta número',
    [gorra.codigo, codigosArbol(gorra.arbol)], ['ROP-GOR-001', { Azul: 'ROP-GOR-AZU-002', Roja: '7701' }]);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. Heredar sigue ganándole al patrón');
// ═════════════════════════════════════════════════════════════════════════════
{
  const sur = await productos.crearProducto(1, {
    nombre: 'Audífonos', sucursal_id: 2, linea_id: 1,
    variantes: [{ valor: 'blanco' }, { valor: 'Negro' }],
  }, ADMIN);
  check('★ el producto en Sur lleva el MISMO código que en Principal', sur.codigo, 'ACC-AUD-001');
  check('★ «blanco» hereda el de «Blanco»; lo nuevo sigue la numeración', codigosArbol(sur.arbol),
    { Negro: 'ACC-AUD-NEG-005', blanco: 'ACC-AUD-BLA-002' });
  check('heredar no gasta números', await contadorRaiz(1, 'ACC-AUD'), 5);

  const negro = await variantes.crearAtributo(1, audifonos.id, { valor: 'Negro' });
  check('una variante suelta desde el árbol hereda el de la otra sede', negro.codigo, 'ACC-AUD-NEG-005');
  const azul = await variantes.crearAtributo(1, audifonos.id, { valor: 'Azul' });
  check('★ y una nueva usa el patrón', azul.codigo, 'ACC-AUD-AZU-006');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Todo o nada');
// ═════════════════════════════════════════════════════════════════════════════
{
  await db.exec(`
    CREATE FUNCTION boom() RETURNS trigger AS $$
    BEGIN IF NEW.valor = 'BOOM' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER t_boom BEFORE INSERT ON atributos_producto FOR EACH ROW EXECUTE FUNCTION boom();
  `);
  const e = await falla(() => productos.crearProducto(1, {
    nombre: 'Bomba', sucursal_id: 1, linea_id: 1, variantes: [{ valor: 'Ok' }, { valor: 'BOOM' }],
  }, ADMIN));
  check('la creación falla', !!e, true);
  check('★ no queda el producto a medias', await cuantos('Bomba'), 0);
  check('★ ni su primera variante', Number((await q(`SELECT COUNT(*)::int AS n FROM atributos_producto WHERE valor='Ok'`))[0].n), 0);
  await db.exec('DROP TRIGGER t_boom ON atributos_producto; DROP FUNCTION boom();');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. Las llaves');
// ═════════════════════════════════════════════════════════════════════════════
{
  const base = { sucursal_id: 1, linea_id: 1 };
  const e1 = await falla(() => productos.crearProducto(1, { ...base, nombre: 'Prohibido', variantes: [{ valor: 'X' }] }, { rol: 'vendedor' }));
  check('★ un vendedor no crea variantes por esta puerta (la ruta de atributos es de admin)', e1?.status, 403);
  const e1b = await falla(() => productos.crearProducto(1, { ...base, nombre: 'Prohibido', variantes: [{ valor: 'X' }] }));
  check('sin rol, tampoco', e1b?.status, 403);

  const e2 = await falla(() => productos.crearProducto(3, { nombre: 'Sin feature', sucursal_id: 4, linea_id: 3, variantes: [{ valor: 'X' }] }, ADMIN));
  check('★ sin variantes activas en el negocio: 400', e2?.status, 400);

  const e3 = await falla(() => productos.crearProducto(1, { ...base, nombre: 'Gemelos', variantes: [{ valor: 'Blanco' }, { valor: 'blanco' }] }, ADMIN));
  check('★ dos «Blanco» en el mismo nivel se rechazan', [e3?.status, /repetido/.test(e3?.message)], [400, true]);

  const e4 = await falla(() => productos.crearProducto(1, { ...base, nombre: 'Ajeno', variantes: [{ valor: 'X', tipo_id: TIPO_AJENO }] }, ADMIN));
  check('★ un tipo de otro negocio: 403', e4?.status, 403);

  const muchas = Array.from({ length: 201 }, (_, i) => ({ valor: `V${i}` }));
  const e5 = await falla(() => productos.crearProducto(1, { ...base, nombre: 'Enorme', variantes: muchas }, ADMIN));
  check('más de 200 hojas: 400', e5?.status, 400);

  const e6 = await falla(() => productos.crearProducto(1, { ...base, nombre: 'Dup', variantes: [{ valor: 'A', codigo: 'x1' }, { valor: 'B', codigo: 'X1' }] }, ADMIN));
  check('★ el mismo código dos veces en el árbol: 409', e6?.status, 409);

  const e7 = await falla(() => productos.crearProducto(1, { ...base, nombre: 'Tomado', variantes: [{ valor: 'A', codigo: 'ACC-CAR-001' }] }, ADMIN));
  check('un código que ya usa otro producto de la sede: 409', e7?.status, 409);

  const e8 = await falla(() => productos.crearProducto(1, { ...base, nombre: 'Raro', variantes: 'Blanco' }, ADMIN));
  check('variantes que no son lista: 400', e8?.status, 400);

  const e9 = await falla(() => productos.crearProducto(1, { ...base, nombre: 'SinNombre', variantes: [{ valor: '  ' }] }, ADMIN));
  check('una variante sin nombre: 400', e9?.status, 400);

  const creados = [];
  for (const n of ['Prohibido', 'Sin feature', 'Gemelos', 'Ajeno', 'Enorme', 'Dup', 'Tomado', 'Raro', 'SinNombre']) creados.push(await cuantos(n));
  check('★ ninguna de esas peticiones dejó un producto', creados.every((n) => n === 0), true);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('10. Recibir mercancía le da código a lo que no tiene');
// ═════════════════════════════════════════════════════════════════════════════
{
  await db.exec(`
    INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id) VALUES ('Vidrio', 1, NULL), ('Pulso', 1, 1);
    INSERT INTO atributos_producto (producto_id, sucursal_id, valor)
      VALUES ((SELECT id FROM productos_cantidad WHERE nombre='Pulso'), 1, 'Plata');
    INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id) VALUES ('Arandela', 3, 2);
  `);
  const id = async (nombre, sede) => (await q('SELECT id FROM productos_cantidad WHERE nombre=$1 AND sucursal_id=$2', [nombre, sede]))[0].id;
  const [{ id: plata }] = await q(`SELECT id FROM atributos_producto WHERE valor='Plata'`);
  const cargador = await id('Cargador', 1);

  const client = await pool.connect();
  await client.query('BEGIN');
  await auto.asignarEnTransaccion(client, {
    negocioId: 1, sucursalId: 1,
    nodos: [
      { nivel: 'producto', id: await id('Vidrio', 1) },
      { nivel: 'producto', id: await id('Pulso', 1) }, { nivel: 'atributo', id: plata },
      { nivel: 'producto', id: cargador },
    ],
  });
  await auto.asignarEnTransaccion(client, { negocioId: 2, sucursalId: 3, nodos: [{ nivel: 'producto', id: await id('Arandela', 3) }] });
  await client.query('COMMIT');

  check('producto sin línea: GEN', await codigoDe('productos_cantidad', await id('Vidrio', 1)), 'GEN-VID-001');
  check('★ producto y talla, seguidos',
    [await codigoDe('productos_cantidad', await id('Pulso', 1)), await codigoDe('atributos_producto', plata)],
    ['ACC-PUL-001', 'ACC-PUL-PLA-002']);
  check('★ lo que ya tenía código no se toca', await codigoDe('productos_cantidad', cargador), 'ACC-CAR-001');
  check('el negocio numérico sigue numérico', await codigoDe('productos_cantidad', await id('Arandela', 3)), '000003');

  // El enganche en la compra: se revisa el fuente porque `registrarCompra`
  // necesita medio esquema de proveedores y caja que este fixture no tiene.
  const fuente = readFileSync(path.join(RAIZ, 'src/modules/compras/compras.service.js'), 'utf8');
  const cuerpo = fuente.slice(fuente.indexOf('const registrarCompra = async'), fuente.indexOf('const registrarEntrada = async'));
  const llamada = cuerpo.indexOf('asignarEnTransaccion(client');
  check('★ registrarCompra (y por ella la Entrada de bodega) llama al motor dentro de su transacción', llamada > 0, true);
  check('después de mover el stock y antes del acreedor',
    llamada > cuerpo.indexOf('ajustarStockCantidad') && llamada < cuerpo.indexOf('// ── Acreedor'), true);
  check('los seriales no tienen código de nodo y se saltan', /if \(l\.imei \|\| !l\.producto_id\) continue/.test(cuerpo), true);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('11. La generación masiva de Etiquetas usa el mismo formato');
// ═════════════════════════════════════════════════════════════════════════════
{
  await db.exec(`INSERT INTO productos_cantidad (nombre, sucursal_id, linea_id) VALUES ('Llavero', 1, 1)`);
  const [{ id }] = await q(`SELECT id FROM productos_cantidad WHERE nombre='Llavero'`);
  const r = await etiquetas.generarCodigos(1, 1, { seleccion: [{ nivel: 'producto', producto_id: id }], prefijo: 'ZZ', longitud: 8 });
  check('★ con patrón, prefijo y dígitos no aplican', r.detalle.map((d) => d.codigo), ['ACC-LLA-001']);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('12. Ajustes valida el formato, y la pantalla promete lo mismo que el motor');
// ═════════════════════════════════════════════════════════════════════════════
{
  const intentar = async (datos) => { try { await config.saveConfig(1, datos); return null; } catch (e) { return e.message; } };
  check('un formato desconocido se rechaza', /formato/i.test(await intentar({ codigo_auto_formato: 'raro' }) || ''), true);

  check('volver a numérico se guarda', await intentar({ codigo_auto_formato: 'numero' }), null);
  const numerico = await productos.crearProducto(1, { nombre: 'Numerico', sucursal_id: 1, linea_id: 1 });
  check('★ y lo siguiente vuelve a ser número (sigue el 7701 escrito a mano)', numerico.codigo, '007702');
  check('★ cambiar de formato no reescribió nada', await codigoDe('productos_cantidad', audifonos.id), 'ACC-AUD-001');
  await intentar({ codigo_auto_formato: 'patron' });

  const pantalla = readFileSync(path.join(RAIZ, '../frontend/src/pages/configuracion/ConfigPage.jsx'), 'utf8');
  check('★ los ejemplos de Ajustes son los que genera el motor',
    patron.EJEMPLOS_PATRON.every((ej) => pantalla.includes(ej)), true);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('13. Un código = un nodo por sede, en los tres niveles');
// ═════════════════════════════════════════════════════════════════════════════
{
  const dup = await q(`
    SELECT sede, codigo FROM (
      SELECT pc.sucursal_id AS sede, UPPER(pc.codigo) AS codigo FROM productos_cantidad pc WHERE pc.codigo IS NOT NULL AND pc.activo
      UNION ALL
      SELECT ap.sucursal_id, UPPER(ap.codigo) FROM atributos_producto ap WHERE ap.codigo IS NOT NULL AND ap.activo
      UNION ALL
      SELECT ap.sucursal_id, UPPER(v.codigo) FROM variantes_atributo v
        JOIN atributos_producto ap ON ap.id = v.atributo_id WHERE v.codigo IS NOT NULL AND v.activo
    ) t GROUP BY sede, codigo HAVING COUNT(*) > 1`);
  check('★ ningún código quedó en dos nodos de la misma sede', dup, []);
}

console.log('\n──────────────────────────────────────────────────────────────');
if (fallos) { console.log(`✗ ${fallos} FALLOS — ${pasados} verificaciones pasaron`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
