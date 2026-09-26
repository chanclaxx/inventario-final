// ─────────────────────────────────────────────────────────────────────────────
// ESCANEO — el lector escribe con teclado en inglés y el computador está en
// español, contra un Postgres real (PGlite).
//
// Reportado desde un cliente (sep-2026): la etiqueta dice `ACC-AUD-001` y al
// escanearla llega `ACC'AUD'001` (el guion sale como apóstrofo o coma), así
// que el producto «no existe». Arreglo opt-in: `escaneo_corregir_guiones`.
//
//   · Sección 1 — APAGADO (lo que tienen todos los negocios): nada cambia, y
//     escanear no hace ni una consulta más. Es la que hay que mirar primero.
//   · Sección 2 — encendido: el código con apóstrofo, acento o coma se encuentra.
//   · Sección 3 — el código tal cual SIEMPRE gana (uno que de verdad lleve
//     apóstrofo no se confunde con el del guion).
//   · Sección 4 — la opción de un negocio no toca al vecino.
//   · Sección 5 — la copia del navegador corrige lo mismo que el backend, y
//     Ajustes ofrece el interruptor con la clave correcta.
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

// Cuenta las consultas a config_negocio: apagado, un escaneo que encuentra no
// puede pagar ni una más.
let consultasConfig = 0;
const conectar = (t) => ({
  query: async (text, params) => {
    if (/config_negocio/.test(text)) consultasConfig++;
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const busqueda = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.service.js'));
const util     = require(path.join(RAIZ, 'src/utils/codigoEscaneado.util.js'));

let ok = 0; const fallos = [];
const seccion = (t) => console.log(`\n${t}`);
const checkEq = (nombre, real, esperado) => {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log(`  ✓ ${nombre}`); }
  else { fallos.push(nombre); console.log(`  ✗ ${nombre}\n      esperado ${b}\n      obtuvo   ${a}`); }
};
const q = async (s, p = []) => (await db.query(s, p)).rows;

await q(`INSERT INTO negocios (id, nombre) VALUES (1, 'Con lector en inglés'), (2, 'Vecino')`);
await q(`INSERT INTO sucursales (id, negocio_id, nombre) VALUES (1, 1, 'Principal'), (2, 2, 'Vecina')`);
await q(`INSERT INTO productos_cantidad (id, sucursal_id, nombre, stock, codigo, activo) VALUES
  (1, 1, 'Audífonos',       5, 'ACC-AUD-001', true),
  (2, 1, 'Cable raro',      3, 'CAB''01',     true),
  (3, 1, 'Cable con guion', 3, 'CAB-01',      true),
  (4, 2, 'Audífonos vecino',5, 'ACC-AUD-001', true)`);
await q(`INSERT INTO atributos_producto (id, producto_id, sucursal_id, valor, stock, codigo, activo)
         VALUES (1, 1, 1, 'Blanco', 2, 'ACC-AUD-BLA-002', true)`);

const nombres = async (codigo, negocio, sucursal) =>
  (await busqueda.escanear(codigo, negocio, sucursal, 'vendedor'))?.nodos?.map((n) => n.nombre) ?? null;

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Apagado (el default de todos los negocios): nada cambia');
{
  checkEq('el código bien escaneado se encuentra', await nombres('ACC-AUD-001', 1, 1), ['Audífonos']);
  consultasConfig = 0;
  await nombres('ACC-AUD-001', 1, 1);
  checkEq('★ y no consulta la configuración ni una vez', consultasConfig, 0);
  checkEq('★ con apóstrofo sigue sin encontrarse, como antes', await nombres("ACC'AUD'001", 1, 1), null);
  checkEq('  por /busqueda/codigo tampoco', (await busqueda.buscarPorCodigo("ACC'AUD'001", 1, 1, 'vendedor')).length, 0);
  consultasConfig = 0;
  await nombres('NO-EXISTE', 1, 1);
  checkEq('un código sin nada que corregir no consulta la configuración', consultasConfig, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Encendido: el guion se recupera');
await q(`INSERT INTO config_negocio (negocio_id, clave, valor) VALUES (1, 'escaneo_corregir_guiones', '1')`);
{
  checkEq('★ apóstrofo', await nombres("ACC'AUD'001", 1, 1), ['Audífonos']);
  checkEq('acento agudo', await nombres('ACC´AUD´001', 1, 1), ['Audífonos']);
  checkEq('coma', await nombres('ACC,AUD,001', 1, 1), ['Audífonos']);
  checkEq('comilla tipográfica', await nombres('ACC’AUD’001', 1, 1), ['Audífonos']);
  checkEq('también en la talla (código del atributo)', (await busqueda.escanear("ACC'AUD'BLA'002", 1, 1, 'vendedor')).nodos[0].nivel, 'atributo');
  checkEq('y por /busqueda/codigo', (await busqueda.buscarPorCodigo("ACC'AUD'001", 1, 1, 'vendedor')).map((n) => n.nombre), ['Audífonos']);
  checkEq('lo que no existe sigue sin existir', await nombres("XYZ'999", 1, 1), null);
  consultasConfig = 0;
  await nombres('ACC-AUD-001', 1, 1);
  checkEq('un código bien escaneado no consulta la configuración', consultasConfig, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. El código tal cual siempre gana');
{
  checkEq("★ un código que de verdad lleva apóstrofo encuentra ESE producto", await nombres("CAB'01", 1, 1), ['Cable raro']);
  checkEq('y el del guion sigue siendo el suyo', await nombres('CAB-01', 1, 1), ['Cable con guion']);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. La opción es de UN negocio');
{
  checkEq('★ el vecino (apagado) no corrige', await nombres("ACC'AUD'001", 2, 2), null);
  checkEq('y encuentra el suyo bien escaneado', await nombres('ACC-AUD-001', 2, 2), ['Audífonos vecino']);
  checkEq('encendido en el negocio 1 no le trae el del vecino', await nombres("ACC'AUD'001", 1, 1), ['Audífonos']);
  await q(`UPDATE config_negocio SET valor = '0' WHERE negocio_id = 1`);
  checkEq("en '0' vuelve a comportarse como apagado", await nombres("ACC'AUD'001", 1, 1), null);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Navegador y Ajustes');
{
  const front = await import(new URL(`file:///${path.join(FRONT, 'utils/codigoEscaneado.js').replace(/\\/g, '/')}`));
  const casos = ["ACC'AUD'001", 'ACC´AUD´001', 'A,B', 'A`B', 'A’B‘C‚D', 'SIN-NADA', '123456789012345', ''];
  checkEq('★ la copia del navegador corrige lo mismo que el backend',
    casos.map((c) => front.corregirGuiones(c)), casos.map((c) => util.corregirGuiones(c)));
  checkEq('la misma lista de caracteres', front.EN_LUGAR_DEL_GUION.source, util.EN_LUGAR_DEL_GUION.source);
  checkEq('la misma clave', front.CLAVE_CORREGIR_GUIONES, util.CLAVE);
  checkEq('ausente = apagado en el navegador', front.correccionGuionesActiva({}), false);
  checkEq("'1' = encendido", front.correccionGuionesActiva({ escaneo_corregir_guiones: '1' }), true);

  const config = readFileSync(path.join(FRONT, 'pages/configuracion/ConfigPage.jsx'), 'utf8');
  checkEq('Ajustes ofrece el interruptor', config.includes('Corregir los guiones del lector'), true);
  checkEq("  y solo lo da por encendido con '1'", config.includes("valores[CLAVE_CORREGIR_GUIONES] === '1'"), true);
  const hook = readFileSync(path.join(FRONT, 'hooks/useEscanerCarrito.js'), 'utf8');
  checkEq('el atajo local del carrito prueba el tal cual PRIMERO',
    /resolverLocal\?\.\(codigo\)\s*\|\|\s*\(corregido/.test(hook), true);
}

console.log('\n' + '─'.repeat(62));
if (fallos.length) { console.log(`✗ ${fallos.length} FALLO(S) de ${fallos.length + ok}`); process.exit(1); }
console.log(`✓ TODO OK — ${ok} verificaciones`);
