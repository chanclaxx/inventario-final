// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVOS DE UNA COMPRA — el manifiesto de importación y sus papeles (6-oct-2026)
//
// Opt-in `compras_archivos_activo` (ausente = apagado). Una compra puede llevar
// adjuntos sus documentos, y la regla que manda es que NO SE PIERDAN: no hay
// borrado (se anula con motivo), cancelar la compra no los toca, apagar la
// feature tampoco, y cada archivo se lee de donde se escribió y se comprueba.
//
// Levanta las RUTAS REALES de compras sobre un Postgres en memoria y les habla
// por HTTP: multer, permisos, cabeceras y bytes de verdad. El almacenamiento es
// un proveedor en memoria: no se toca ningún bucket.
//
//   · Sección 1 — apagado: sin tabla o sin la clave, nada existe (404) y la
//                 config no deja encender lo que no se puede usar.
//   · Sección 2 — adjuntar y volver a bajar: los mismos bytes, las cabeceras.
//   · Sección 3 — qué se rechaza: el tipo se decide por el CONTENIDO.
//   · Sección 4 — quién: negocio, proveedor, rol y permiso de ver compras.
//   · Sección 5 — anular: con motivo, solo el admin, y el archivo se queda.
//   · Sección 6 — ★ no se pierde: cancelar, borrar, apagar, cambiar de
//                 almacenamiento y un archivo alterado.
//   · Sección 7 — el almacenamiento real: R2 nunca escribe en el bucket público.
//   · Sección 8 — estática: sin DELETE, listas y clave sin separarse, rutas.
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend');
const leer = (...p) => readFileSync(path.join(...p), 'utf8');

// Nada de esto puede salir a un bucket de verdad.
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_BUCKET_DOCUMENTOS',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_BUCKET_DOCUMENTOS',
  'R2_PUBLIC_URL', 'ARCHIVOS_CUPO_MB_NEGOCIO']) delete process.env[k];

const db = new PGlite();
await db.exec(leer(AQUI, 'esquema.sql'));
await db.exec(leer(AQUI, 'esquema-completo.sql'));
await db.exec(`CREATE TABLE IF NOT EXISTS auditoria (
  id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, accion TEXT, tabla TEXT,
  registro_id INT, detalle JSONB, fecha TIMESTAMP DEFAULT NOW());`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const columnas  = require(path.join(RAIZ, 'src/config/columnas.js'));
const storage   = require(path.join(RAIZ, 'src/modules/archivos/archivos.storage.js'));
const servicio  = require(path.join(RAIZ, 'src/modules/compras/archivosCompra.service.js'));
const configSvc = require(path.join(RAIZ, 'src/modules/config/config.service.js'));
const express   = require(path.join(RAIZ, 'node_modules/express'));

let pasados = 0; const fallos = [];
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const lanza = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── Almacenamiento en memoria ────────────────────────────────────────────────
const proveedorMem = (nombre) => {
  const objetos = new Map();
  return {
    nombre, objetos,
    bucket: () => `bucket-${nombre}`,
    async subir({ bucket, path: p, buffer }) { objetos.set(`${bucket}/${p}`, Buffer.from(buffer)); },
    async descargar({ bucket, path: p }) {
      const b = objetos.get(`${bucket}/${p}`);
      if (!b) throw new Error('NoSuchKey');
      return b;
    },
  };
};
const memA = proveedorMem('mem-a');
const memB = proveedorMem('mem-b');

// ── Archivos de prueba, con su firma real ────────────────────────────────────
const relleno = (n, semilla) => crypto.createHash('sha256').update(String(semilla)).digest().subarray(0, n);
const PDF  = (s = 1) => Buffer.concat([Buffer.from('%PDF-1.7\n'), relleno(32, `pdf${s}`), Buffer.from('\n%%EOF')]);
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), relleno(24, 'png')]);
const ZIP  = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), relleno(24, 'zip')]);
const EXE  = Buffer.concat([Buffer.from('MZ'), relleno(30, 'exe')]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

// ── Escenario ────────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Importadora'), ('Otro negocio');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal'), (2,'Sede ajena');
  INSERT INTO usuarios (nombre) VALUES ('Ana Admin'), ('Saúl Supervisor'), ('Vera Vendedora'), ('Admin ajeno');
  INSERT INTO proveedores (negocio_id, nombre) VALUES (1,'Shenzhen Trading'), (1,'Distribuidora local'), (2,'Proveedor ajeno');
  INSERT INTO compras (numero, sucursal_id, proveedor_id, usuario_id, total, estado) VALUES
    (101, 1, 1, 1, 5000000, 'Completada'),
    (102, 1, 2, 1,  800000, 'Completada'),
    (  7, 2, 3, 4,  100000, 'Completada');
`);

// ── La app: las rutas REALES de compras, con el usuario que diga la cabecera ──
const USUARIOS = {
  admin:      { id: 1, negocio_id: 1, rol: 'admin_negocio' },
  supervisor: { id: 2, negocio_id: 1, rol: 'supervisor', modulos_permitidos: ['proveedores'],
                permisos_proveedores: { ver: true, ver_todos: true, ver_lista: [], ver_compras: true } },
  // Ve compras, pero solo las del proveedor 2.
  restringido: { id: 2, negocio_id: 1, rol: 'supervisor', modulos_permitidos: ['proveedores'],
                 permisos_proveedores: { ver: true, ver_todos: false, ver_lista: [2], ver_compras: true } },
  // Supervisor con el módulo, sin el permiso de ver compras.
  sinCompras: { id: 2, negocio_id: 1, rol: 'supervisor', modulos_permitidos: ['proveedores'],
                permisos_proveedores: { ver: true, ver_todos: true, ver_lista: [], ver_compras: false } },
  vendedor:   { id: 3, negocio_id: 1, rol: 'vendedor', modulos_permitidos: ['proveedores'],
                permisos_proveedores: { ver: true, ver_todos: true, ver_lista: [], ver_compras: true } },
  // El bodeguero de Entradas: inventario sí, proveedores no.
  bodeguero:  { id: 2, negocio_id: 1, rol: 'supervisor', modulos_permitidos: ['inventario'] },
  ajeno:      { id: 4, negocio_id: 2, rol: 'admin_negocio' },
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = USUARIOS[req.headers['x-usuario']]; next(); });
app.use('/api/compras', require(path.join(RAIZ, 'src/modules/compras/compras.routes.js')));
app.use(require(path.join(RAIZ, 'src/middlewares/error.middleware.js')).errorHandler
  ?? require(path.join(RAIZ, 'src/middlewares/error.middleware.js')));
const servidor = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://127.0.0.1:${servidor.address().port}/api/compras`;

// El manejador de errores registra cada 4xx/5xx en la consola: aquí son parte
// de la prueba, no ruido que haya que leer.
const consolaError = console.error;
console.error = () => {};

const pedir = async (usuario, metodo, ruta, { json, form } = {}) => {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { 'x-usuario': usuario, ...(json ? { 'content-type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : form,
  });
  const tipo = res.headers.get('content-type') || '';
  const cuerpo = tipo.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, cuerpo };
};
const subir = (usuario, compraId, buffer, nombre, campos = {}) => {
  const form = new FormData();
  form.append('nombre', nombre);
  for (const [k, v] of Object.entries(campos)) form.append(k, v);
  form.append('archivo', new Blob([buffer]), nombre);
  return pedir(usuario, 'POST', `/${compraId}/archivos`, { form });
};
const listar = (usuario, compraId) => pedir(usuario, 'GET', `/${compraId}/archivos`);
const bajar  = (usuario, id) => pedir(usuario, 'GET', `/archivos/${id}/descargar`);
const anular = (usuario, id, motivo) =>
  pedir(usuario, 'PATCH', `/archivos/${id}/anular`, { json: motivo === undefined ? {} : { motivo } });
const filas = async () => (await db.query('SELECT * FROM archivos_compra ORDER BY id')).rows;

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Apagado: nada existe y no se puede encender lo que no se puede usar');
{
  // Sin la tabla (la migración no llegó).
  columnas._setArchivosCompraDisponible(false);
  storage._setProveedorPrueba(memA);
  await db.query(`INSERT INTO config_negocio VALUES (1, 'compras_archivos_activo', '1')`);
  ok('sin la tabla: listar responde 404', (await listar('admin', 1)).status === 404);
  ok('sin la tabla: adjuntar responde 404', (await subir('admin', 1, PDF(), 'm.pdf')).status === 404);
  ok('sin la tabla: la config sale apagada aunque la clave diga 1',
    (await configSvc.getConfig(1)).compras_archivos_activo === '0');
  const e1 = await lanza(() => configSvc.saveConfig(1, { compras_archivos_activo: '1' }));
  ok('sin la tabla: no deja encenderlo', e1?.status === 400);
  await db.query(`DELETE FROM config_negocio WHERE negocio_id = 1 AND clave = 'compras_archivos_activo'`);

  // La migración, dos veces.
  await db.exec(leer(RAIZ, 'migrations/20261006_archivos_compra.sql'));
  await db.exec(leer(RAIZ, 'migrations/20261006_archivos_compra.sql'));
  ok('la migración es idempotente', true);
  columnas._setArchivosCompraDisponible(true);

  // Con la tabla y SIN la clave: el estado de los 28 negocios.
  ok('con la tabla y sin la clave: listar 404', (await listar('admin', 1)).status === 404);
  ok('…adjuntar 404', (await subir('admin', 1, PDF(), 'm.pdf')).status === 404);
  ok('…descargar 404', (await bajar('admin', 1)).status === 404);
  ok('…anular 404', (await anular('admin', 1, 'x')).status === 404);
  ok('…y no se escribió ni una fila ni un objeto', (await filas()).length === 0 && memA.objetos.size === 0);
  ok('la clave ausente se lee como apagada', servicio.activo({}) === false && servicio.activo({ compras_archivos_activo: '0' }) === false);

  // Sin almacenamiento no se enciende.
  storage._setProveedorPrueba(null);
  ok('sin credenciales no hay almacenamiento', storage.estaActivo() === false);
  const e2 = await lanza(() => configSvc.saveConfig(1, { compras_archivos_activo: '1' }));
  ok('sin almacenamiento: no deja encenderlo, y dice por qué',
    e2?.status === 400 && /almacenamiento/i.test(e2.message));
  ok('…pero apagarlo siempre se puede',
    (await lanza(() => configSvc.saveConfig(1, { compras_archivos_activo: '0' }))) === null);
  const e3 = await lanza(() => configSvc.saveConfig(1, { compras_archivos_activo: 'si' }));
  ok('un valor que no es 0 ni 1 se rechaza', e3?.status === 400);

  storage._setProveedorPrueba(memA);
  ok('con tabla y almacenamiento: se enciende',
    (await lanza(() => configSvc.saveConfig(1, { compras_archivos_activo: '1' }))) === null
    && (await configSvc.getConfig(1)).compras_archivos_activo === '1');
  ok('encenderlo en un negocio no lo enciende en otro', (await listar('ajeno', 3)).status === 404);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Adjuntar el manifiesto y volver a bajarlo');
let ID_MANIFIESTO;
{
  const manifiesto = PDF(1);
  const r = await subir('supervisor', 1, manifiesto, 'Manifiesto importación nº 48.pdf', {
    tipo: 'manifiesto', numero_documento: '  MAN-2026-00481 ', fecha_documento: '2026-09-28', nota: 'Contenedor 2 de 3',
  });
  ok('un supervisor adjunta: 201', r.status === 201, JSON.stringify(r.cuerpo).slice(0, 120));
  const f = r.cuerpo.data;
  ID_MANIFIESTO = f.id;
  ok('guarda qué es, su número (sin espacios) y su fecha',
    f.tipo === 'manifiesto' && f.numero_documento === 'MAN-2026-00481' && f.fecha_documento === '2026-09-28');
  ok('el nombre conserva tildes y ñ', f.nombre_original === 'Manifiesto importación nº 48.pdf', f.nombre_original);
  ok('el tipo sale del contenido', f.mime === 'application/pdf' && f.bytes === manifiesto.length);
  ok('dice quién lo subió', f.subido_por_nombre === 'Saúl Supervisor');
  ok('la respuesta NO trae dónde está guardado',
    !('storage_path' in f) && !('bucket' in f) && !('sha256' in f) && !('proveedor_storage' in f));

  const [fila] = await filas();
  ok('la ficha recuerda dónde quedó y su huella',
    fila.proveedor_storage === 'mem-a' && fila.bucket === 'bucket-mem-a'
    && fila.sha256 === crypto.createHash('sha256').update(manifiesto).digest('hex'));
  ok('la ruta lleva negocio, compra y un UUID — nunca el nombre del usuario',
    /^negocio_1\/compra_1\/[0-9a-f-]{36}\.pdf$/.test(fila.storage_path), fila.storage_path);
  ok('el objeto está en el almacenamiento', memA.objetos.has(`${fila.bucket}/${fila.storage_path}`));

  const l = await listar('supervisor', 1);
  ok('la compra lo lista', l.status === 200 && l.cuerpo.data.archivos.length === 1
    && l.cuerpo.data.archivos[0].id === ID_MANIFIESTO);
  ok('la lista trae los límites y que hay almacenamiento',
    l.cuerpo.data.limites.max_bytes === 15 * 1024 * 1024 && l.cuerpo.data.limites.max_por_compra === 20
    && l.cuerpo.data.almacenamiento === true);
  ok('otra compra del mismo negocio no lo lista', (await listar('admin', 2)).cuerpo.data.archivos.length === 0);

  const d = await bajar('supervisor', ID_MANIFIESTO);
  ok('se baja: 200 y los MISMOS bytes', d.status === 200 && Buffer.compare(d.cuerpo, manifiesto) === 0);
  ok('sale como adjunto, con su nombre', /^attachment; filename\*=UTF-8''Manifiesto%20importaci%C3%B3n/.test(
    d.headers.get('content-disposition') || ''), d.headers.get('content-disposition'));
  ok('sin que el navegador adivine el tipo ni lo guarde en caché',
    d.headers.get('x-content-type-options') === 'nosniff' && /no-store/.test(d.headers.get('cache-control') || '')
    && d.headers.get('content-type') === 'application/pdf');

  // La auditoría es «dispara y olvida»: se le da un instante.
  await new Promise((r2) => setTimeout(r2, 50));
  const { rows: aud } = await db.query(`SELECT * FROM auditoria WHERE accion = 'Archivo adjuntado a compra'`);
  ok('queda en auditoría, colgado de la compra', aud.length === 1 && aud[0].registro_id === 1
    && aud[0].detalle.numero_documento === 'MAN-2026-00481');

  // Otros tipos aceptados.
  ok('una imagen (PNG)', (await subir('admin', 1, PNG, 'foto.PNG', { tipo: 'factura' })).cuerpo.data?.mime === 'image/png');
  ok('un Excel (.xlsx)', (await subir('admin', 1, ZIP, 'lista de empaque.xlsx', { tipo: 'empaque' }))
    .cuerpo.data?.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  ok('sin tipo, es el manifiesto', (await subir('admin', 2, PDF(2), 'm2.pdf')).cuerpo.data?.tipo === 'manifiesto');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Qué se rechaza: el tipo lo decide el contenido');
{
  const antes = (await filas()).length;
  const objetosAntes = memA.objetos.size;
  const r1 = await subir('admin', 1, EXE, 'manifiesto.pdf');
  ok('un ejecutable renombrado a .pdf', r1.status === 400 && /PDF/.test(r1.cuerpo.error), r1.cuerpo.error);
  ok('un HTML llamado .pdf', (await subir('admin', 1, HTML, 'pagina.pdf')).status === 400);
  ok('un ZIP cualquiera (sin extensión de Office)', (await subir('admin', 1, ZIP, 'cosas.zip')).status === 400);
  ok('un ZIP llamado .pdf', (await subir('admin', 1, ZIP, 'cosas.pdf')).status === 400);
  ok('un archivo vacío', (await subir('admin', 1, Buffer.alloc(0), 'vacio.pdf')).status === 400);

  const grande = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(15 * 1024 * 1024)]);
  const rg = await subir('admin', 1, grande, 'enorme.pdf');
  ok('más de 15 MB: 400 con el motivo, no un 500', rg.status === 400 && /15 MB/.test(rg.cuerpo.error), rg.cuerpo.error);

  ok('un tipo de documento inventado', (await subir('admin', 1, PDF(3), 'a.pdf', { tipo: 'contrato' })).status === 400);
  ok('una fecha que no existe (31 de febrero)',
    (await subir('admin', 1, PDF(3), 'a.pdf', { fecha_documento: '2026-02-31' })).status === 400);
  ok('una fecha en otro formato', (await subir('admin', 1, PDF(3), 'a.pdf', { fecha_documento: '28/09/2026' })).status === 400);
  ok('un número de documento de 61 caracteres',
    (await subir('admin', 1, PDF(3), 'a.pdf', { numero_documento: 'x'.repeat(61) })).status === 400);
  ok('una compra que no existe', (await subir('admin', 999, PDF(3), 'a.pdf')).status === 404);
  ok('un id de compra que no es número', (await subir('admin', 'abc', PDF(3), 'a.pdf')).status === 400);

  const dup = await subir('admin', 1, PDF(1), 'el mismo con otro nombre.pdf');
  ok('el MISMO archivo dos veces en la compra: 409', dup.status === 409 && dup.cuerpo.error.includes('ya está adjunto'));
  ok('…pero el mismo archivo en OTRA compra sí entra', (await subir('admin', 2, PDF(1), 'copia.pdf')).status === 201);

  // Ningún rechazo dejó rastro: ni fila ni objeto (lo subido no se borra,
  // así que todo se valida ANTES de subir).
  ok('ningún rechazo escribió una fila ni subió un objeto',
    (await filas()).length === antes + 1 && memA.objetos.size === objetosAntes + 1);

  // Un nombre con ruta y comillas no decide nada.
  const raro = await subir('admin', 2, PDF(4), '..\\..\\etc\\"pass".pdf');
  ok('un nombre con carpetas y comillas se limpia', raro.status === 201 && raro.cuerpo.data.nombre_original === 'pass.pdf',
    raro.cuerpo.data?.nombre_original);

  // El tope por compra.
  await db.query(`INSERT INTO compras (numero, sucursal_id, proveedor_id, usuario_id, total) VALUES (103, 1, 1, 1, 1)`);
  const { rows: [{ id: C_LLENA }] } = await db.query(`SELECT id FROM compras WHERE numero = 103`);
  for (let i = 0; i < 20; i++) await subir('admin', C_LLENA, PDF(`lleno${i}`), `d${i}.pdf`);
  const r21 = await subir('admin', C_LLENA, PDF('lleno20'), 'd20.pdf');
  ok('el archivo 21 de una compra', r21.status === 400 && /hasta 20/.test(r21.cuerpo.error), r21.cuerpo.error);

  // El cupo del negocio.
  process.env.ARCHIVOS_CUPO_MB_NEGOCIO = '0.0001';   // ~105 bytes: ya se pasó
  const rc = await subir('admin', 2, PDF('cupo'), 'cupo.pdf');
  ok('pasado el cupo del negocio: se rechaza y dice que lo guardado no se toca',
    rc.status === 400 && /no se toca/.test(rc.cuerpo.error), rc.cuerpo.error);
  delete process.env.ARCHIVOS_CUPO_MB_NEGOCIO;
  ok('sin el tope de prueba vuelve a entrar', (await subir('admin', 2, PDF('cupo'), 'cupo.pdf')).status === 201);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. Quién: negocio, proveedor, rol y permiso');
{
  ok('otro negocio no lista la compra (404, no 403)', (await listar('ajeno', 1)).status === 404);
  ok('otro negocio no baja el archivo', (await bajar('ajeno', ID_MANIFIESTO)).status === 404);
  ok('otro negocio no adjunta a la compra', (await subir('ajeno', 1, PDF(9), 'x.pdf')).status === 404);
  // Para probar el alcance del anulado, el negocio 2 enciende la feature.
  await db.query(`INSERT INTO config_negocio VALUES (2, 'compras_archivos_activo', '1')`);
  ok('otro negocio (con la feature) sigue sin ver la compra', (await listar('ajeno', 1)).status === 404);
  ok('…ni bajar el archivo', (await bajar('ajeno', ID_MANIFIESTO)).status === 404);
  ok('…ni anularlo', (await anular('ajeno', ID_MANIFIESTO, 'no es mío')).status === 404);
  ok('…y el archivo sigue vigente', (await filas()).find((f) => Number(f.id) === ID_MANIFIESTO).anulado === false);

  ok('restringido a otro proveedor: no lista', (await listar('restringido', 1)).status === 403);
  ok('…no baja', (await bajar('restringido', ID_MANIFIESTO)).status === 403);
  ok('…no adjunta', (await subir('restringido', 1, PDF(9), 'x.pdf')).status === 403);
  ok('…pero sí ve la compra de SU proveedor', (await listar('restringido', 2)).status === 200);

  ok('sin el permiso de ver compras: no lista', (await listar('sinCompras', 1)).status === 403);
  ok('…ni baja (el manifiesto trae precios)', (await bajar('sinCompras', ID_MANIFIESTO)).status === 403);
  ok('el bodeguero (inventario, sin proveedores): no entra', (await listar('bodeguero', 1)).status === 403);

  ok('un vendedor con el permiso VE', (await listar('vendedor', 1)).status === 200);
  ok('…y baja', (await bajar('vendedor', ID_MANIFIESTO)).status === 200);
  const antes = (await filas()).length;
  ok('…pero no adjunta', (await subir('vendedor', 1, PDF(9), 'x.pdf')).status === 403);
  ok('…y su archivo ni se leyó (no hay fila nueva)', (await filas()).length === antes);
  ok('un supervisor no anula', (await anular('supervisor', ID_MANIFIESTO, 'me equivoqué')).status === 403);
  ok('sin sesión: 401', (await listar('nadie', 1)).status === 401);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Anular: con motivo, y el archivo se queda');
let ID_ANULADO;
{
  const equivocado = PDF('equivocado');
  ID_ANULADO = (await subir('supervisor', 1, equivocado, 'manifiesto de otra compra.pdf')).cuerpo.data.id;
  const objetos = memA.objetos.size;

  ok('sin motivo: 400', (await anular('admin', ID_ANULADO)).status === 400);
  ok('con el motivo en blanco: 400', (await anular('admin', ID_ANULADO, '   ')).status === 400);
  const r = await anular('admin', ID_ANULADO, 'Era el manifiesto de la compra 102');
  ok('el admin anula con su motivo', r.status === 200 && r.cuerpo.data.anulado === true
    && r.cuerpo.data.motivo_anulacion === 'Era el manifiesto de la compra 102'
    && r.cuerpo.data.anulado_por_nombre === 'Ana Admin' && !!r.cuerpo.data.anulado_en);
  ok('anularlo otra vez: 409, y no pisa el primer motivo',
    (await anular('admin', ID_ANULADO, 'otro motivo')).status === 409
    && (await filas()).find((f) => Number(f.id) === ID_ANULADO).motivo_anulacion === 'Era el manifiesto de la compra 102');

  ok('la FILA sigue ahí', (await filas()).some((f) => Number(f.id) === ID_ANULADO && f.anulado));
  ok('el OBJETO sigue en el almacenamiento', memA.objetos.size === objetos);

  const ls = (await listar('supervisor', 1)).cuerpo.data.archivos;
  ok('el supervisor ya no lo ve', !ls.some((a) => a.id === ID_ANULADO));
  ok('…ni lo baja', (await bajar('supervisor', ID_ANULADO)).status === 404);
  const la = (await listar('admin', 1)).cuerpo.data.archivos;
  ok('el admin lo ve, marcado y al final', la.at(-1).id === ID_ANULADO && la.at(-1).anulado === true
    && la.filter((a) => !a.anulado).length === ls.length);
  const d = await bajar('admin', ID_ANULADO);
  ok('…y lo puede seguir bajando, intacto', d.status === 200 && Buffer.compare(d.cuerpo, equivocado) === 0);

  ok('anulado, el mismo archivo se puede volver a adjuntar',
    (await subir('supervisor', 1, equivocado, 'ahora sí.pdf')).status === 201);
  ok('un archivo que no existe: 404', (await anular('admin', 99999, 'x')).status === 404);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. ★ No se pierde');
{
  const original = PDF(1);

  // Cancelar la compra es un estado.
  await db.query(`UPDATE compras SET estado = 'Cancelada' WHERE id = 1`);
  const l = await listar('admin', 1);
  ok('★ compra CANCELADA: sus documentos se siguen listando',
    l.status === 200 && l.cuerpo.data.archivos.some((a) => a.id === ID_MANIFIESTO));
  ok('★ …y bajando', Buffer.compare((await bajar('supervisor', ID_MANIFIESTO)).cuerpo, original) === 0);

  // Borrar la compra no se puede mientras tenga documentos.
  const eDel = await lanza(() => db.query('DELETE FROM compras WHERE id = 1'));
  ok('★ la base no deja BORRAR una compra con documentos', eDel !== null && /archivos_compra/.test(String(eDel.message)));
  ok('…y la compra sigue ahí', (await db.query('SELECT 1 FROM compras WHERE id = 1')).rows.length === 1);

  // Apagar la feature.
  const total = (await filas()).length;
  const objetos = memA.objetos.size;
  await configSvc.saveConfig(1, { compras_archivos_activo: '0' });
  ok('apagada: las rutas dejan de existir', (await listar('admin', 1)).status === 404);
  ok('★ apagarla no borró ni una fila ni un objeto', (await filas()).length === total && memA.objetos.size === objetos);
  await configSvc.saveConfig(1, { compras_archivos_activo: '1' });
  ok('★ al volver a encenderla está todo',
    (await listar('admin', 1)).cuerpo.data.archivos.some((a) => a.id === ID_MANIFIESTO)
    && Buffer.compare((await bajar('admin', ID_MANIFIESTO)).cuerpo, original) === 0);

  // Cambiar de almacenamiento.
  storage._setProveedorPrueba(memB);
  const nuevo = PDF('en B');
  const idB = (await subir('admin', 2, nuevo, 'declaracion.pdf', { tipo: 'declaracion' })).cuerpo.data.id;
  ok('lo nuevo se escribe en el almacenamiento nuevo',
    (await filas()).find((f) => Number(f.id) === idB).proveedor_storage === 'mem-b' && memB.objetos.size === 1);
  ok('★ lo VIEJO se sigue leyendo de donde se escribió',
    Buffer.compare((await bajar('admin', ID_MANIFIESTO)).cuerpo, original) === 0);
  ok('…y lo nuevo, del nuevo', Buffer.compare((await bajar('admin', idB)).cuerpo, nuevo) === 0);

  // Sin almacenamiento para escribir, lo guardado se sigue leyendo.
  storage._setProveedorPrueba(null);
  const ls = await listar('admin', 1);
  ok('sin almacenamiento activo: la lista lo dice', ls.cuerpo.data.almacenamiento === false);
  const rs = await subir('admin', 1, PDF('sin'), 'sin.pdf');
  ok('…adjuntar responde 503 sin nombres de variables', rs.status === 503 && !/[A-Z]{2,}_[A-Z]/.test(rs.cuerpo.error), rs.cuerpo.error);
  ok('★ …y lo ya guardado se sigue bajando', (await bajar('admin', ID_MANIFIESTO)).status === 200);
  storage._setProveedorPrueba(memA);

  // Un archivo alterado en el bucket no se entrega como si nada.
  const fila = (await filas()).find((f) => Number(f.id) === ID_MANIFIESTO);
  const clave = `${fila.bucket}/${fila.storage_path}`;
  memA.objetos.set(clave, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('otro contenido')]));
  const alt = await bajar('admin', ID_MANIFIESTO);
  ok('★ un archivo ALTERADO en el almacenamiento no se entrega: 502 y lo dice',
    alt.status === 502 && alt.cuerpo.code === 'ARCHIVO_ALTERADO' && /no coincide/.test(alt.cuerpo.error),
    JSON.stringify(alt.cuerpo));
  memA.objetos.set(clave, original);
  ok('restaurado, vuelve a bajar', (await bajar('admin', ID_MANIFIESTO)).status === 200);

  // Un fallo del almacenamiento al subir no deja ficha huérfana.
  const roto = { ...proveedorMem('roto'), async subir() { throw new Error('ECONNRESET'); } };
  storage._setProveedorPrueba(roto);
  const antes = (await filas()).length;
  const rf = await subir('admin', 2, PDF('roto'), 'roto.pdf');
  ok('si el almacenamiento falla al subir: 502 y NINGUNA ficha', rf.status === 502 && (await filas()).length === antes);
  storage._setProveedorPrueba(memA);

  // Un objeto que desapareció del bucket.
  const idPerdido = (await subir('admin', 2, PDF('perdido'), 'perdido.pdf')).cuerpo.data.id;
  const fp = (await filas()).find((f) => Number(f.id) === idPerdido);
  memA.objetos.delete(`${fp.bucket}/${fp.storage_path}`);
  ok('si el objeto no está: 502 con mensaje, no un 500 mudo',
    (await bajar('admin', idPerdido)).status === 502);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. El almacenamiento real: nunca el bucket público del catálogo');
{
  storage._setProveedorPrueba(null);
  ok('sin variables: apagado', storage.proveedorActivo() === null);

  Object.assign(process.env, { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' });
  ok('R2 con credenciales pero SIN R2_BUCKET_DOCUMENTOS: no adivina un bucket', storage.proveedorActivo() === null);
  process.env.R2_BUCKET_DOCUMENTOS = 'catalogo';
  ok('★ R2_BUCKET_DOCUMENTOS = el bucket del catálogo (por defecto): se rechaza', storage.proveedorActivo() === null);
  process.env.R2_BUCKET = 'fotos-publicas';
  process.env.R2_BUCKET_DOCUMENTOS = 'fotos-publicas';
  ok('★ …y también si el catálogo usa otro nombre', storage.proveedorActivo() === null);
  process.env.R2_BUCKET_DOCUMENTOS = 'documentos-privados';
  ok('con un bucket propio: R2', storage.proveedorActivo()?.nombre === 'r2'
    && storage.proveedorActivo().bucket() === 'documentos-privados');

  Object.assign(process.env, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' });
  ok('con los dos configurados gana R2', storage.proveedorActivo()?.nombre === 'r2');
  delete process.env.R2_BUCKET_DOCUMENTOS;
  ok('sin el bucket de R2: Supabase', storage.proveedorActivo()?.nombre === 'supabase'
    && storage.proveedorActivo().bucket() === 'documentos-compras');
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) delete process.env[k];

  const e = await lanza(() => storage.descargar({ proveedor: 'r2', bucket: 'b', path: 'p' }));
  ok('un archivo de R2 sin credenciales: 503 que dice que SIGUE guardado',
    e?.status === 503 && /sigue guardado/.test(e.message));
  const e2 = await lanza(() => storage.descargar({ proveedor: 'gdrive', bucket: 'b', path: 'p' }));
  ok('un proveedor desconocido no revienta: 500 con mensaje', e2?.status === 500);

  ok('detectarTipo: .docx y .xls por firma + extensión',
    storage.detectarTipo(ZIP, 'carta.docx')?.ext === 'docx'
    && storage.detectarTipo(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'viejo.xls')?.ext === 'xls');
  ok('detectarTipo: JPG y WebP',
    storage.detectarTipo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]), 'f.jpeg')?.mime === 'image/jpeg'
    && storage.detectarTipo(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), 'f.webp')?.ext === 'webp');
  ok('detectarTipo: la extensión sola no alcanza', storage.detectarTipo(EXE, 'a.xlsx') === null
    && storage.detectarTipo(PNG, 'a.xlsx')?.ext === 'png');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Estática: lo que no puede separarse ni aparecer');
{
  const svc   = leer(RAIZ, 'src/modules/compras/archivosCompra.service.js');
  const repo  = leer(RAIZ, 'src/modules/compras/archivosCompra.repository.js');
  const ctrl  = leer(RAIZ, 'src/modules/compras/archivosCompra.controller.js');
  const stor  = leer(RAIZ, 'src/modules/archivos/archivos.storage.js');
  const rutas = leer(RAIZ, 'src/modules/compras/compras.routes.js');
  const mig   = leer(RAIZ, 'migrations/20261006_archivos_compra.sql');
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  // No hay cómo borrar.
  ok('★ ningún DELETE en el módulo', !/\bDELETE\b/i.test(sinComentarios(svc + repo + ctrl)));
  ok('★ el almacenamiento no sabe borrar (ni DeleteObject ni remove)',
    !/DeleteObject|\.remove\(|borrar\s*[:=(]/.test(sinComentarios(stor)) && !('borrar' in storage));
  ok('★ no hay ruta DELETE de archivos', !/router\.delete\([^)]*archivos/.test(rutas));
  ok('la compra queda protegida por la base (ON DELETE RESTRICT)',
    /REFERENCES compras\(id\) ON DELETE RESTRICT/.test(mig));
  ok('la migración no borra ni altera nada existente', !/\b(DROP|DELETE|TRUNCATE|ALTER)\b/.test(mig.replace(/--.*$/gm, '').replace('ON DELETE RESTRICT', '')));

  // Las rutas: antes de /:id, y cada una con sus llaves.
  const iArchivos = rutas.indexOf("'/archivos/:archivoId/descargar'");
  const iId = rutas.indexOf("router.get('/:id',");
  ok('las rutas de archivos van ANTES de /:id', iArchivos > 0 && iId > iArchivos);
  const linea = (frag) => {
    const i = rutas.indexOf(frag);
    return rutas.slice(i, rutas.indexOf(');', i));
  };
  ok('descargar exige ver compras y el candado',
    /requirePermisoVerCompras[\s\S]*requireArchivosCompra/.test(linea("'/archivos/:archivoId/descargar'")));
  ok('anular exige admin_negocio', /requireNivel\('admin_negocio'\)/.test(linea("'/archivos/:archivoId/anular'")));
  const post = linea("router.post ('/:id/archivos'");
  ok('adjuntar: permisos y candado ANTES de leer el archivo',
    post.indexOf('requirePermisoVerCompras') < post.indexOf('recibirArchivo')
    && post.indexOf("requireNivel('supervisor')") < post.indexOf('recibirArchivo')
    && post.indexOf('requireArchivosCompra') < post.indexOf('recibirArchivo'));
  ok('todas cuelgan de proveedores, no de inventario',
    ["'/archivos/:archivoId/descargar'", "'/archivos/:archivoId/anular'", "router.get  ('/:id/archivos'", "router.post ('/:id/archivos'"]
      .every((f) => /requireModulo\('proveedores'\)/.test(linea(f))));

  // El runner aplica el MISMO archivo.
  const runner = leer(RAIZ, 'src/config/migrations.js');
  ok('el runner de arranque lee el mismo .sql', runner.includes('20261006_archivos_compra.sql'));
  ok('la bandera se detecta al arrancar', leer(RAIZ, 'src/config/columnas.js').includes('await _detectarArchivosCompra();'));

  // La lista de tipos: migración, backend y frontend.
  const delCheck = /CHECK \(tipo IN \(([^)]+)\)\)/.exec(mig)[1].split(',').map((t) => t.trim().replace(/'/g, '')).sort();
  const delBack  = Object.keys(servicio.TIPOS_DOCUMENTO).sort();
  const utilFront = leer(FRONT, 'src/utils/archivosCompra.js');
  const bloque = /export const TIPOS_DOCUMENTO = \{([\s\S]*?)\};/.exec(utilFront)[1];
  const delFront = [...bloque.matchAll(/^\s*(\w+):\s*'([^']+)'/gm)].map((m) => [m[1], m[2]]);
  ok('los tipos del CHECK son los del service', JSON.stringify(delCheck) === JSON.stringify(delBack), delCheck.join(','));
  ok('…y los de la pantalla, con los mismos nombres',
    JSON.stringify(Object.fromEntries(delFront)) === JSON.stringify(servicio.TIPOS_DOCUMENTO));

  // La clave de config, en los cinco sitios.
  const CLAVE = servicio.CLAVE_CONFIG;
  ok('la clave es una sola', CLAVE === 'compras_archivos_activo'
    && leer(RAIZ, 'src/modules/config/config.service.js').includes(`CLAVE_ARCHIVOS_COMPRA = '${CLAVE}'`)
    && utilFront.includes(`config?.${CLAVE} === '1'`)
    && leer(FRONT, 'src/pages/configuracion/ComprasConfig.jsx').includes(`set('${CLAVE}'`));

  // La pantalla promete lo que el backend cumple.
  const api = leer(FRONT, 'src/api/compras.api.js');
  ok('la API del frontend llama a las cuatro rutas', ['/compras/${compraId}/archivos`', '/compras/archivos/${archivoId}/descargar`',
    '/compras/archivos/${archivoId}/anular`'].every((u) => api.includes(u)) && !/api\.delete/.test(api));
  const pant = leer(FRONT, 'src/pages/proveedores/ArchivosCompra.jsx');
  ok('la pantalla no ofrece borrar: anula', !/Eliminar|Borrar archivo|Trash/.test(pant) && pant.includes('Anular archivo'));
  const cfg = leer(FRONT, 'src/pages/configuracion/ComprasConfig.jsx');
  const lim = servicio.limites();
  ok('Ajustes promete los mismos topes que aplica el backend',
    cfg.includes(`hasta ${lim.max_bytes / 1024 / 1024} MB`) && cfg.includes(`hasta ${lim.max_por_compra} por compra`));
  ok('el detalle de la compra y el registro montan la misma pieza',
    leer(FRONT, 'src/pages/proveedores/ProveedoresPage.jsx').includes('<ArchivosCompra compraId={compraId} />')
    && leer(FRONT, 'src/pages/proveedores/ModalCompra.jsx').includes('<ArchivosCompra compraId={compraRegistrada.id} />'));
  ok('el Service Worker no cachea la descarga', leer(FRONT, 'vite.config.js').includes('prestamos|compras\\/archivos)'));
}

console.error = consolaError;
servidor.close();
console.log(`\n${'─'.repeat(60)}\n${pasados} verificaciones pasaron, ${fallos.length} fallaron`);
if (fallos.length) { fallos.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
