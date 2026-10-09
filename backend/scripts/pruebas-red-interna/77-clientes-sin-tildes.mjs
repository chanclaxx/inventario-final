// ─────────────────────────────────────────────────────────────────────────────
// CLIENTES Y COMPAÑEROS SIN TILDES — contra un Postgres real (PGlite).
//
// Reportado por un cliente (oct-2026): el teclado del celular le pone tildes al
// nombre («María López») y quien busca escribe «maria lopez» — o al revés. La
// búsqueda comparaba exacto, la persona «no existía» y se creaba otra vez.
//
//   · Sección 1 — lo que ya funcionaba sigue igual: sin filtro salen todos, la
//     cédula y el celular se encuentran. Es la que hay que mirar primero.
//   · Sección 2 — ★ el listado de clientes (`findAll`) encuentra sin tildes en
//     las dos direcciones, con mayúsculas y con espacios de más.
//   · Sección 3 — el autocompletado (`buscar`) también.
//   · Sección 4 — la expresión SQL y la función JS normalizan IGUAL, también
//     con texto guardado descompuesto (a + U+0301) y mayúsculas con tilde.
//   · Sección 5 — ★ un cliente con la cédula repetida devuelve el que existe.
//   · Sección 6 — ★ un compañero con el mismo nombre (otras tildes) no se crea
//     dos veces; renombrar tampoco funde dos; otro negocio no choca.
//   · Sección 7 — ★ empleados: igual, pero dentro de SU compañero.
//   · Sección 8 — el navegador normaliza lo mismo y las pantallas lo usan.
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
const FRONT = path.resolve(RAIZ, '../frontend/src');

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db.exec(`
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fecha_registro TIMESTAMP DEFAULT NOW();
`);

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

const clientesRepo = require(path.join(RAIZ, 'src/modules/clientes/clientes.repository.js'));
const clientes     = require(path.join(RAIZ, 'src/modules/clientes/clientes.service.js'));
const prestatarios = require(path.join(RAIZ, 'src/modules/prestatarios/prestatarios.service.js'));
const texto        = require(path.join(RAIZ, 'src/utils/textoBusqueda.util.js'));

let ok = 0; const fallos = [];
const seccion = (t) => console.log(`\n${t}`);
const checkEq = (nombre, real, esperado) => {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log(`  ✓ ${nombre}`); }
  else { fallos.push(nombre); console.log(`  ✗ ${nombre}\n      esperado ${b}\n      obtuvo   ${a}`); }
};
const q = async (s, p = []) => (await db.query(s, p)).rows;
const error = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

await q(`INSERT INTO negocios (id, nombre) VALUES (1, 'Con tildes'), (2, 'Vecino')`);
await q(`INSERT INTO sucursales (id, negocio_id, nombre) VALUES (1, 1, 'Principal'), (2, 2, 'Vecina')`);
// «José» guardado DESCOMPUESTO (e + acento combinante), como puede llegar de
// algunos teclados; «ÁNGEL» en mayúsculas con tilde.
await q(`INSERT INTO clientes (id, negocio_id, nombre, cedula, celular) VALUES
  (1, 1, 'María López',      '1001', '3001112233'),
  (2, 1, 'Maria Lopez Ruiz', '1002', '3004445566'),
  (3, 1, $1,                 '1003', NULL),
  (4, 1, 'ÁNGEL Peña',       '1004', NULL),
  (5, 1, 'Pedro  Gómez',     '1005', NULL),
  (6, 2, 'María López',      '1001', NULL)`, ['José Pérez']);
await q(`SELECT setval('clientes_id_seq', 6)`);

const nombres = (rows) => rows.map((r) => r.nombre).sort();

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Lo que ya funcionaba sigue igual');
{
  checkEq('sin filtro salen todos los del negocio (y solo esos)',
    (await clientesRepo.findAll(1)).length, 5);
  checkEq('filtro vacío = sin filtro', (await clientesRepo.findAll(1, '')).length, 5);
  checkEq('por cédula', nombres(await clientesRepo.findAll(1, '1004')), ['ÁNGEL Peña']);
  checkEq('por celular', nombres(await clientesRepo.findAll(1, '300444')), ['Maria Lopez Ruiz']);
  checkEq('un % escrito no es comodín', (await clientesRepo.findAll(1, '%')).length, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. ★ El listado de clientes encuentra sin tildes, en las dos direcciones');
{
  checkEq('«maria» encuentra a «María» y a «Maria»',
    nombres(await clientesRepo.findAll(1, 'maria')), ['Maria Lopez Ruiz', 'María López']);
  checkEq('«MARÍA LÓPEZ» encuentra también a «Maria Lopez Ruiz»',
    nombres(await clientesRepo.findAll(1, 'MARÍA LÓPEZ')), ['Maria Lopez Ruiz', 'María López']);
  checkEq('«jose» encuentra a «José» guardado descompuesto',
    nombres(await clientesRepo.findAll(1, 'jose')), ['José Pérez']);
  checkEq('«angel pena» encuentra a «ÁNGEL Peña» (mayúsculas con tilde y ñ)',
    nombres(await clientesRepo.findAll(1, 'angel pena')), ['ÁNGEL Peña']);
  checkEq('los espacios repetidos no estorban («pedro gomez»)',
    nombres(await clientesRepo.findAll(1, '  pedro   gomez ')), ['Pedro  Gómez']);
  checkEq('nunca sale un cliente de otro negocio',
    (await clientesRepo.findAll(1, 'maría')).every((c) => c.id !== 6), true);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. El autocompletado al facturar también');
{
  checkEq('«maría» encuentra a los dos',
    nombres(await clientesRepo.buscar(1, 'maría')), ['Maria Lopez Ruiz', 'María López']);
  checkEq('«ANGEL» encuentra a «ÁNGEL Peña»', nombres(await clientesRepo.buscar(1, 'ANGEL')), ['ÁNGEL Peña']);
  checkEq('una letra sigue sin buscar', (await clientesRepo.buscar(1, 'm')).length, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. SQL y JS normalizan igual');
{
  const casos = ['María López', 'MARÍA LÓPEZ', 'José', 'ÁNGEL Peña', '  Ñandú   Çé ',
    'Ü ü Ö ö', 'àèìòù ÀÈÌÒÙ', 'âêîôû', 'ãõ', 'Plain text', ''];
  const sql = [];
  for (const c of casos) {
    sql.push((await q(`SELECT ${texto.sqlSinTildes('$1::text')} AS n`, [c]))[0].n);
  }
  checkEq('★ cada caso da lo mismo en las dos orillas', sql, casos.map(texto.normalizarTexto));
  checkEq('la tabla de tildes está pareada', texto.CON_TILDE.length, texto.SIN_TILDE.length);
  checkEq('NULL en la columna no revienta', (await q(`SELECT ${texto.sqlSinTildes('NULL::text')} AS n`))[0].n, '');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. ★ Cliente con la cédula repetida: se devuelve el que existe');
{
  const e = await error(() => clientes.crearCliente(1, { nombre: 'Maria Lopez', cedula: '1001' }));
  checkEq('409', e?.status, 409);
  checkEq('con código CLIENTE_EXISTE', e?.code, 'CLIENTE_EXISTE');
  checkEq('y el cliente que ya existe', e?.detalle?.existente?.id, 1);
  checkEq('el mensaje dice de quién es', /María López/.test(e?.message), true);
  const nuevo = await clientes.crearCliente(1, { nombre: 'María López', cedula: '2002' });
  checkEq('un homónimo con OTRA cédula sí se crea (puede ser otra persona)', nuevo.cedula, '2002');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. ★ Compañeros: el mismo nombre con otras tildes no se crea dos veces');
{
  const ana = await prestatarios.crearPrestatario({ negocio_id: 1, nombre: 'Ana Muñoz' });
  checkEq('el primero se crea', ana.nombre, 'Ana Muñoz');
  for (const otro of ['ana munoz', 'ANA MUÑOZ', '  Ána   Muñoz ']) {
    const e = await error(() => prestatarios.crearPrestatario({ negocio_id: 1, nombre: otro }));
    checkEq(`«${otro}» → 409 PRESTATARIO_EXISTE con el existente`,
      [e?.status, e?.code, e?.detalle?.existente?.id], [409, 'PRESTATARIO_EXISTE', ana.id]);
  }
  const vecino = await prestatarios.crearPrestatario({ negocio_id: 2, nombre: 'Ana Muñoz' });
  checkEq('en otro negocio no choca', vecino.negocio_id, 2);
  const beto = await prestatarios.crearPrestatario({ negocio_id: 1, nombre: 'Beto' });
  checkEq('otro nombre se crea', beto.nombre, 'Beto');
  const e = await error(() => prestatarios.actualizarPrestatario(1, beto.id, { nombre: 'ana muñoz' }));
  checkEq('renombrar a otro que ya existe → 409', [e?.status, e?.code], [409, 'PRESTATARIO_EXISTE']);
  const corregido = await prestatarios.actualizarPrestatario(1, ana.id, { nombre: 'Ana MUÑOZ' });
  checkEq('corregirse las mayúsculas a sí mismo sí se puede', corregido.nombre, 'Ana MUÑOZ');
  checkEq('total de compañeros del negocio: 2',
    (await q(`SELECT COUNT(*)::int AS n FROM prestatarios WHERE negocio_id = 1`))[0].n, 2);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. ★ Empleados: lo mismo, dentro de SU compañero');
{
  const [ana, beto] = (await q(`SELECT id FROM prestatarios WHERE negocio_id = 1 ORDER BY id`)).map((r) => r.id);
  const luis = await prestatarios.crearEmpleado(1, { prestatario_id: ana, nombre: 'Luís' });
  checkEq('el primero se crea', luis.nombre, 'Luís');
  const e = await error(() => prestatarios.crearEmpleado(1, { prestatario_id: ana, nombre: 'luis' }));
  checkEq('«luis» en el mismo compañero → 409 EMPLEADO_EXISTE con el existente',
    [e?.status, e?.code, e?.detalle?.existente?.id], [409, 'EMPLEADO_EXISTE', luis.id]);
  const otroLuis = await prestatarios.crearEmpleado(1, { prestatario_id: beto, nombre: 'Luis' });
  checkEq('el mismo nombre en OTRO compañero sí se crea', otroLuis.nombre, 'Luis');
  const ajeno = await error(() => prestatarios.crearEmpleado(2, { prestatario_id: ana, nombre: 'X' }));
  checkEq('un compañero de otro negocio sigue siendo 404', ajeno?.status, 404);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. El navegador normaliza lo mismo y las pantallas lo usan');
{
  const front = await import(new URL(`file:///${path.join(FRONT, 'utils/texto.js').replace(/\\/g, '/')}`));
  const casos = ['María López', 'MARÍA LÓPEZ', 'José', 'ÁNGEL Peña', '  Ñandú   Çé ', 'Ü ö', '', null];
  checkEq('★ la copia del navegador da lo mismo que el backend',
    casos.map(front.normalizarTexto), casos.map(texto.normalizarTexto));
  checkEq('contieneTexto: «maria» está en «María López»', front.contieneTexto('María López', 'maria'), true);
  checkEq('buscarHomonimo encuentra «Ana Muñoz» por «ana munoz»',
    front.buscarHomonimo([{ id: 7, nombre: 'Ana Muñoz' }], 'ana munoz')?.id, 7);
  checkEq('buscarHomonimo sin nombre = nada', front.buscarHomonimo([{ id: 7, nombre: '' }], '  '), null);

  const modal = readFileSync(path.join(FRONT, 'pages/prestamos/ModalPrestamo.jsx'), 'utf8');
  checkEq('el modal de préstamo ya no filtra con toLowerCase().includes',
    /nombre\?\.toLowerCase\(\)\.includes/.test(modal), false);
  checkEq('  ofrece el homónimo antes de crear', modal.includes('buscarHomonimo(items, nombre)'), true);
  checkEq('  y usa el existente cuando el backend lo devuelve',
    ['CLIENTE_EXISTE', 'PRESTATARIO_EXISTE', 'EMPLEADO_EXISTE'].every((c) => modal.includes(`'${c}'`)), true);
  const pagina = readFileSync(path.join(FRONT, 'pages/prestamos/PrestamosPage.jsx'), 'utf8');
  checkEq('la búsqueda de personas de Préstamos ignora tildes',
    pagina.includes('contieneTexto(g.nombre, busquedaPersonas)'), true);
}

console.log('\n' + '─'.repeat(62));
if (fallos.length) { console.log(`✗ ${fallos.length} FALLO(S) de ${fallos.length + ok}`); process.exit(1); }
console.log(`✓ TODO OK — ${ok} verificaciones`);
