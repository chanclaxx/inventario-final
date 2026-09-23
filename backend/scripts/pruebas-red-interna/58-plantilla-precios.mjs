// ─────────────────────────────────────────────────────────────────────────────
// LA PLANTILLA DE PRECIOS TRAE LAS TALLAS — y el archivo vuelve exacto.
//
// Reportado por el usuario (sep-2026): «la plantilla de precios descarga los
// productos pero NO las variantes de esos mismos productos». Con variantes
// activas el precio vive en la HOJA —el producto es un contenedor, igual que
// con el stock y el código escaneable—, así que una plantilla que solo trae el
// contenedor no sirve para tarifar lo que de verdad se vende.
//
// Se genera el .xlsx DE VERDAD y se le leen las celdas: una plantilla mal
// armada no se ve mal, se ve perfecta y no se puede volver a subir.
//
// Lo que protege, en orden:
//   1. Las TALLAS y los COLORES están, y cada uno DEBAJO de su producto y de su
//      talla (sección 2). Es el orden del árbol, no el alfabético.
//   2. Las REFERENCIAS con IMEI también: su precio de lista es el de la
//      referencia y antes no había forma de ponerlo desde el Excel.
//   3. EL VIAJE DE VUELTA (sección 4): subir el archivo recién bajado, sin
//      tocar nada, no cambia NI UNA fila. Si esto falla, el usuario ve «438
//      cambios» sobre un archivo que no editó.
//   4. Un archivo VIEJO (con la columna «Detalle» y sin tallas) se sigue
//      subiendo igual (sección 5).
//
//   node scripts/pruebas-red-interna/58-plantilla-precios.mjs
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
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260912_listas_precios.sql'), 'utf8'));

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

const XLSX = require('xlsx');
const svc  = require(path.join(RAIZ, 'src/modules/listas-precios/listasPrecios.service.js'));
const repo = require(path.join(RAIZ, 'src/modules/listas-precios/listasPrecios.repository.js'));

let fallos = 0, pasados = 0;
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
};
const seccion = (t) => console.log(`\n── ${t}`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

const LISTAS = JSON.stringify([
  { id: 'mayor', nombre: 'Al por mayor', color: 'green' },
  { id: 'final', nombre: 'Cliente final', color: 'blue' },
]);

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO config_negocio VALUES
    (1,'listas_precios_activo','1'),
    (1,'listas_precios_lista','${LISTAS.replace(/'/g, "''")}'),
    (1,'variantes_activo','1');

  -- Los TIPOS mandan el orden, igual que en el árbol del inventario: si se
  -- ordenara alfabéticamente, las tallas saldrían como L, M, S, XL.
  INSERT INTO tipos_caracteristica (negocio_id, nombre, orden)
    VALUES (1,'Talla',1), (1,'Color',2);

  -- Correa con dos tallas; la 38MM además tiene dos colores.
  INSERT INTO productos_cantidad (nombre, stock, precio, precios, sucursal_id, codigo)
    VALUES ('Correa', 0, 60000, '{"mayor":50000}', 1, 'COR');
  INSERT INTO atributos_producto (producto_id, sucursal_id, tipo_id, valor, stock, precio, codigo)
    VALUES (1, 1, 1, '42MM', 5, 70000, 'C42'),
           (1, 1, 1, '38MM', 0, NULL,  'C38');
  INSERT INTO variantes_atributo (atributo_id, producto_id, tipo_id, valor, stock, precio, codigo, precios)
    VALUES (2, 1, 2, 'Negro', 2, NULL, 'C38N', '{"mayor":48000}'),
           (2, 1, 2, 'Café',  3, NULL, 'C38C', NULL);

  -- Un producto plano (sin tallas) y una referencia con IMEI.
  INSERT INTO productos_cantidad (nombre, stock, precio, sucursal_id, codigo)
    VALUES ('Cable', 10, 15000, 1, 'CAB');
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1);
`);

const admin = { id: 1, negocio_id: 1, rol: 'admin_negocio', sucursal_id: 1 };

const hojaDe = (buffer, nombre = 'Principal') => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return { wb, filas: XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: null }) };
};

// ─────────────────────────────────────────────────────────────────────────────
seccion('1. Con variantes activas, las tallas vienen SIN pedir nada');
{
  const { buffer } = await svc.generarPlantilla(admin, {});
  const { wb, filas } = hojaDe(buffer);

  ok('el libro trae Instrucciones y la hoja de la sucursal',
    wb.SheetNames.includes('Instrucciones') && wb.SheetNames.includes('Principal'),
    wb.SheetNames.join(', '));

  const tokens = filas.map((f) => f.ID);
  ok('★ están las dos tallas', tokens.includes('a1') && tokens.includes('a2'), tokens.join(' '));
  ok('★ están los dos colores', tokens.includes('v1') && tokens.includes('v2'));
  ok('★ está la referencia con IMEI', tokens.includes('s1'));
  ok('y los productos, claro', tokens.includes('p1') && tokens.includes('p2'));
  ok('7 filas en total', filas.length === 7, `${filas.length}`);

  // El negocio que NO usa variantes sigue bajando solo productos.
  await q(`UPDATE config_negocio SET valor = '0' WHERE clave = 'variantes_activo'`);
  const sinVar = hojaDe((await svc.generarPlantilla(admin, {})).buffer).filas;
  ok('sin `variantes_activo` no bajan tallas',
    sinVar.every((f) => !String(f.ID).startsWith('a') && !String(f.ID).startsWith('v')),
    sinVar.map((f) => f.ID).join(' '));
  ok('…pero la referencia con IMEI sigue estando',
    sinVar.some((f) => f.ID === 's1'));
  await q(`UPDATE config_negocio SET valor = '1' WHERE clave = 'variantes_activo'`);

  // Y quien lo pide explícitamente manda sobre el default.
  const forzado = hojaDe((await svc.generarPlantilla(admin, { incluirVariantes: false })).buffer).filas;
  ok('«solo productos» explícito se respeta', forzado.length === 3, `${forzado.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('2. Sale ORGANIZADO: cada talla bajo su producto, y el color bajo su talla');
{
  const { filas } = hojaDe((await svc.generarPlantilla(admin, {})).buffer);
  const orden = filas.map((f) => f.ID);

  // Cable (p2) va antes que Correa (p1) por nombre. Dentro de Correa manda el
  // orden del TIPO y, dentro del tipo, el valor — el MISMO criterio del árbol
  // del inventario (`ORDER BY tc.orden, valor`): 38MM antes que 42MM aunque se
  // crearan al revés. Y los colores de la 38MM van pegados a SU talla, no
  // detrás de todas las tallas, que era el desorden que había.
  ok('★ el orden es el del árbol',
    JSON.stringify(orden) === JSON.stringify(['p2', 'p1', 'a2', 'v2', 'v1', 'a1', 's1']),
    orden.join(' → '));

  const porId = Object.fromEntries(filas.map((f) => [f.ID, f]));
  ok('la fila de la talla dice a qué producto pertenece', porId.a2.Producto === 'Correa');
  ok('★ y la columna Variante dice cuál es', /38MM/.test(porId.a2.Variante), porId.a2.Variante);
  ok('el color trae su talla y su color', /38MM.*Negro/.test(porId.v1.Variante), porId.v1.Variante);
  ok('★ las tallas van sangradas bajo el producto',
    porId.a2.Variante.startsWith('    ') && porId.v1.Variante.startsWith('        '),
    JSON.stringify([porId.a2.Variante, porId.v1.Variante]));

  ok('la columna Nivel dice qué es cada fila',
    porId.p1.Nivel === 'Producto' && porId.a2.Nivel === 'Talla'
      && porId.v1.Nivel === 'Color' && porId.s1.Nivel === 'Referencia',
    [porId.p1.Nivel, porId.a2.Nivel, porId.v1.Nivel, porId.s1.Nivel].join(' / '));
  ok('un producto CON tallas lo avisa en su fila',
    /todas sus variantes/.test(porId.p1.Variante), porId.p1.Variante);
  ok('un producto sin tallas no dice nada raro', porId.p2.Variante === '');
  ok('la referencia con IMEI trae marca y modelo', porId.s1.Variante === 'Apple 128GB');
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('3. Cada fila trae SUS precios de hoy, no los del producto');
{
  const { filas } = hojaDe((await svc.generarPlantilla(admin, {})).buffer);
  const porId = Object.fromEntries(filas.map((f) => [f.ID, f]));

  ok('el producto trae su precio de lista', porId.p1['Al por mayor'] === 50000);
  ok('★ el color con precio propio trae el SUYO', porId.v1['Al por mayor'] === 48000,
    `${porId.v1['Al por mayor']}`);
  ok('lo que no tiene precio en esa lista va vacío', porId.v2['Al por mayor'] === null);
  ok('la lista sin ningún precio va vacía en todos', filas.every((f) => f['Cliente final'] === null));
  ok('«Precio actual» es el de venta, de referencia', porId.a1['Precio actual'] === 70000);
  ok('…y vacío cuando la talla hereda el del producto', !porId.a2['Precio actual']);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('4. EL VIAJE DE VUELTA: subir lo recién bajado no cambia nada');
{
  const { buffer } = await svc.generarPlantilla(admin, {});
  const informe = await svc.analizarExcel(admin, buffer, []);

  ok('★ ni una sola fila cambia', informe.con_cambio === 0, `${informe.con_cambio} cambios`);
  ok('…y todas se reconocieron', informe.sin_cambio === 7, `${informe.sin_cambio}`);
  ok('sin conflictos', informe.conflictos.length === 0,
    JSON.stringify(informe.conflictos.slice(0, 2)));
  ok('sin avisos de columnas ignoradas',
    !informe.avisos.some((a) => a.tipo === 'COLUMNA_IGNORADA'),
    JSON.stringify(informe.avisos.slice(0, 2)));

  // Ahora sí se edita el precio de UN color, y solo ese cambia.
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets.Principal;
  const filaColor = XLSX.utils.sheet_to_json(ws, { defval: null })
    .findIndex((f) => f.ID === 'v2');
  const colMayor = XLSX.utils.sheet_to_json(ws, { header: 1 })[0].indexOf('Al por mayor');
  ws[XLSX.utils.encode_cell({ r: filaColor + 1, c: colMayor })] = { t: 'n', v: 47000 };
  const editado = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const informe2 = await svc.analizarExcel(admin, editado, []);
  ok('★ editar una talla cambia SOLO esa fila', informe2.con_cambio === 1, `${informe2.con_cambio}`);

  const aplicado = await svc.importarExcel(admin, editado, []);
  ok('y se guarda donde va', aplicado.guardados === 1);
  const [v2] = await q(`SELECT precios FROM variantes_atributo WHERE id = 2`);
  ok('★ el precio quedó en el COLOR, no en el producto', Number(v2.precios?.mayor) === 47000,
    JSON.stringify(v2.precios));
  const [p1] = await q(`SELECT precios FROM productos_cantidad WHERE id = 1`);
  ok('…y el del producto no se tocó', Number(p1.precios?.mayor) === 50000);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('5. Un archivo VIEJO se sigue pudiendo subir');
{
  // Como lo bajaba la plantilla antes de sep-2026: columna «Detalle», sin
  // tallas, sin «Nivel». Vercel y Railway se despliegan por separado y la gente
  // guarda archivos: si esto fallara, el usuario perdería su trabajo.
  const viejo = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['ID', 'Producto', 'Detalle', 'Código', 'Precio actual', 'Al por mayor', 'Cliente final'],
    ['p2', 'Cable', '', 'CAB', 15000, 13000, null],
    [null, null, null, null, null, null, null],            // fila vacía a propósito
  ]);
  XLSX.utils.book_append_sheet(viejo, ws, 'Principal');
  const buffer = XLSX.write(viejo, { type: 'buffer', bookType: 'xlsx' });

  const informe = await svc.analizarExcel(admin, buffer, []);
  ok('★ el archivo viejo se entiende', informe.con_cambio === 1, `${informe.con_cambio}`);
  ok('la columna «Detalle» no sale como ignorada',
    !informe.avisos.some((a) => a.tipo === 'COLUMNA_IGNORADA'),
    JSON.stringify(informe.avisos));
  ok('★ una fila vacía no es un conflicto', informe.conflictos.length === 0,
    JSON.stringify(informe.conflictos));
  ok('…y ni siquiera se cuenta como fila', informe.total_filas === 1, `${informe.total_filas}`);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('6. El alcance por negocio y por sucursal no se afloja');
{
  await db.exec(`
    INSERT INTO negocios (nombre) VALUES ('Otro');
    INSERT INTO sucursales (negocio_id, nombre) VALUES (2,'Ajena');
    INSERT INTO productos_cantidad (nombre, stock, precio, sucursal_id)
      VALUES ('Producto ajeno', 5, 9000, 2);
  `);
  const nodos = await repo.leerNodosSucursal(1, 1, {});
  ok('no se cuela nada de otro negocio',
    nodos.every((n) => n.nombre !== 'Producto ajeno'), `${nodos.length} filas`);
  const ajenos = await repo.leerNodosSucursal(2, 1, {});
  ok('pedir la sucursal de otro negocio no devuelve nada', ajenos.length === 0);
}

console.log(`\n${'═'.repeat(60)}\n  ${pasados} verificaciones pasaron · ${fallos} fallaron\n${'═'.repeat(60)}`);
process.exit(fallos ? 1 : 0);
