// ─────────────────────────────────────────────────────────────────────────────
// CADA SUCURSAL CON SUS DATOS EN LOS DOCUMENTOS (28-sep-2026)
//
// Tesla tiene la sede «BUNNY MOBILE»: sus clientes recibían facturas, préstamos
// y recibos con el nombre, el NIT y el logo de Tesla, porque todo documento
// salía de `config_negocio`. Ahora cada sede puede tener nombre comercial, NIT,
// dirección, teléfono y logo propios (`sucursales_documento`); lo vacío se
// hereda del negocio.
//
//   · Sección 1 — sin tabla, sin fila o con todo vacío: el mapa sale IDÉNTICO
//                 (los 28 negocios no ven ningún cambio).
//   · Sección 2 — la mezcla campo por campo: lo escrito gana, lo vacío hereda.
//   · Sección 3 — alcance: la sede de OTRO negocio no aporta nada.
//   · Sección 4 — la factura PDF de verdad sale con los datos de la sede.
//   · Sección 5 — la red interna: el envío con la sede que lo manda.
//   · Sección 6 — los endpoints: guardar, validar, borrar al vaciar, y la
//                 lista pública sin logo.
//   · Sección 7 — la copia del navegador da lo mismo que la del backend.
//   · Sección 8 — cada documento lee la sede del DOCUMENTO (estática).
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');
const leer = (...p) => readFileSync(path.join(...p), 'utf8');

const db = new PGlite();
await db.exec(leer(AQUI, 'esquema.sql'));
await db.exec(leer(AQUI, 'esquema-completo.sql'));
for (const m of ['20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
  '20260823_red_interna_control', '20260823_red_interna_cargos_pagables', '20260823_remision_variantes',
  '20260823_lotes_cantidad', '20260824_costo_origen_remision', '20260823_valor_acreditado']) {
  await db.exec(leer(RAIZ, `../migrations/${m}.sql`));
}
await db.exec(`ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS direccion TEXT;
               ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS telefono TEXT;`);

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

// Texto que de verdad se pinta en los PDF.
const PDFDocument = require(path.join(RAIZ, 'node_modules/pdfkit'));
let textos = null;
const origFragment = PDFDocument.prototype._fragment;
PDFDocument.prototype._fragment = function (t, ...r) {
  if (textos) textos.push(String(t ?? ''));
  return origFragment.call(this, t, ...r);
};
const origImage = PDFDocument.prototype.image;
let imagenes = 0;
PDFDocument.prototype.image = function (...a) { if (textos) imagenes += 1; return origImage.apply(this, a); };

const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
const emisor   = require(path.join(RAIZ, 'src/utils/emisor.util.js'));

let pasados = 0; const fallos = [];
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos.push(nombre);
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
// Igualdad de mapas sin depender del orden de las claves.
const mismo = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());

// ── Escenario: Tesla con Bunny Mobile, y otro negocio al lado ────────────────
// Un PNG de 1×1 de verdad: el PDF lo tiene que poder dibujar.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tesla'), ('Otro');
  INSERT INTO sucursales (negocio_id, nombre, direccion, telefono) VALUES
    (1,'BODEGA LAS AMERICAS','Cra 5 #16-35', NULL),
    (1,'BUNNY MOBILE','CRA 5 #15-70 L2','3009998877'),
    (1,'TESLA SMARTPHONESHOP','CRA 5 #15-70','3153138778'),
    (2,'Sede del otro negocio', NULL, NULL);
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO config_negocio VALUES
    (1,'nombre_negocio','Tesla SmartPhone Shop'), (1,'nit','1193434487-7'),
    (1,'direccion','Cra 5 #15-70'), (1,'telefono','3153138778'),
    (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1');
`);
const { rows: [{ c: CONFIG_TESLA }] } = await db.query(
  `SELECT jsonb_object_agg(clave, valor) AS c FROM config_negocio WHERE negocio_id = 1`);

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Sin datos propios: el documento sale EXACTAMENTE como antes');
{
  columnas._setDatosDocumentoSucursalDisponible(false);
  const sinTabla = await emisor.configDocumento(1, 2);
  ok('sin la tabla: el mapa del negocio, idéntico', mismo(sinTabla, CONFIG_TESLA));

  await db.exec(leer(RAIZ, 'migrations/20260928_datos_documento_sucursal.sql'));
  await db.exec(leer(RAIZ, 'migrations/20260928_datos_documento_sucursal.sql'));
  ok('la migración es idempotente', true);
  columnas._setDatosDocumentoSucursalDisponible(true);

  const sinFila = await emisor.configDocumento(1, 2);
  ok('con la tabla y sin fila: idéntico', mismo(sinFila, CONFIG_TESLA));
  ok('sin sede (admin en «todas»): idéntico', mismo(await emisor.configDocumento(1, null), CONFIG_TESLA));
  const base = { nombre_negocio: 'X' };
  ok('mezclar con nada devuelve el MISMO objeto', emisor.aplicarDatosSucursal(base, null) === base
    && emisor.aplicarDatosSucursal(base, { nombre_comercial: '  ', nit: '' }) === base);
  const enc = await emisor.encabezadoPara(1, 2, { nombre: 'Tesla (registro)', logo: 'LOGO' });
  ok('encabezado suelto (préstamos) sin fila: el que ya traía', enc.nombre === 'Tesla (registro)' && enc.logo === 'LOGO');
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. Lo escrito gana, lo vacío hereda');
{
  await db.query(`INSERT INTO sucursales_documento (sucursal_id, nombre_comercial, nit, direccion, telefono, logo)
                  VALUES (2, 'BUNNY MOBILE', '901555666-1', NULL, '  ', $1)`, [PNG]);
  const c = await emisor.configDocumento(1, 2);
  ok('nombre comercial de la sede', c.nombre_negocio === 'BUNNY MOBILE');
  ok('NIT de la sede', c.nit === '901555666-1');
  ok('dirección vacía: la del negocio', c.direccion === 'Cra 5 #15-70');
  ok('teléfono en blanco: el del negocio', c.telefono === '3153138778');
  ok('logo de la sede', c.logo_negocio === PNG);
  ok('las demás claves siguen ahí (red interna, etc.)', c.red_interna_bodega_id === '1');
  ok('no toca el mapa del negocio', CONFIG_TESLA.nombre_negocio === 'Tesla SmartPhone Shop');
  const otra = await emisor.configDocumento(1, 3);
  ok('otra sede del mismo negocio, sin datos: la del negocio', otra.nombre_negocio === 'Tesla SmartPhone Shop');
  const enc = await emisor.encabezadoPara(1, 2, { nombre: 'Tesla (registro)', logo: 'LOGO' });
  ok('encabezado suelto (préstamos): nombre y logo de la sede', enc.nombre === 'BUNNY MOBILE' && enc.logo === PNG);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. La sede de otro negocio no aporta nada');
{
  await db.query(`INSERT INTO sucursales_documento (sucursal_id, nombre_comercial) VALUES (4, 'INTRUSO')`);
  const c = await emisor.configDocumento(1, 4);
  ok('pedir la sede 4 (del negocio 2) desde el negocio 1: sin cambios', c.nombre_negocio === 'Tesla SmartPhone Shop');
  ok('datosDeSucursal acotado al negocio', (await emisor.datosDeSucursal(1, 4)) === null);
  ok('  y un id basura no revienta', (await emisor.datosDeSucursal(1, 'abc')) === null);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. La factura PDF de verdad');
{
  const { generarPdfFactura } = require(path.join(RAIZ, 'src/modules/facturas/facturas.pdf'));
  const render = async (config) => {
    textos = []; imagenes = 0;
    const trozos = [];
    const res = new Writable({ write(c, e, cb) { trozos.push(c); cb(); } });
    res.setHeader = () => {};
    const fin = new Promise((r) => res.on('finish', r));
    generarPdfFactura({
      factura: {
        id: 9, numero: 6681, fecha: '2026-09-28T15:00:00Z', estado: 'Activa', sucursal_id: 2,
        nombre_cliente: 'Cliente de Bunny', cedula: '123', celular: '300',
        lineas: [{ nombre_producto: 'iPhone 13', cantidad: 1, cantidad_devuelta: 0, precio: 2600000 }],
        retomas: [], pagos: [{ metodo: 'Efectivo', valor: 2600000 }],
      },
      config, garantias: [], credito: null, res,
    });
    await fin;
    const t = { texto: textos.join(' | '), imagenes };
    textos = null;
    return t;
  };
  const bunny = await render(await emisor.configDocumento(1, 2));
  ok('factura de Bunny: su nombre comercial', bunny.texto.includes('BUNNY MOBILE'));
  ok('  su NIT', bunny.texto.includes('901555666-1'));
  ok('  y la dirección heredada del negocio', bunny.texto.includes('Cra 5 #15-70'));
  ok('  sin el nombre de Tesla', !bunny.texto.includes('Tesla SmartPhone Shop'));
  ok('  con el logo de la sede dibujado', bunny.imagenes > 0);
  const tesla = await render(await emisor.configDocumento(1, 3));
  ok('factura de la sede sin datos propios: la de siempre',
    tesla.texto.includes('Tesla SmartPhone Shop') && tesla.texto.includes('1193434487-7') && tesla.imagenes === 0);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Red interna: el envío con los datos de quien lo manda');
{
  await db.query(`INSERT INTO sucursales_documento (sucursal_id, nombre_comercial, nit)
                  VALUES (1, 'DISTRIBUIDORA LAS AMERICAS', '900111222-3')`);
  await db.exec(`
    INSERT INTO productos_cantidad (nombre, codigo, precio, costo_unitario, stock, sucursal_id)
      VALUES ('Cargador 20W','CARG20', 60000, 30000, 50, 1);
    INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
      VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']), (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
    INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2);
  `);
  const service = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
  const pdf     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.pdf.js'));
  const red = { activa: true, bodega_id: 1, confirmar_recepcion: true, confirmar_remesa: true, valores_usuarios: [] };
  const admin = { user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true, red };
  const envio = await service.despachar(admin, {
    sucursal_destino_id: 2, lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad: 2, valor_interno: 45000 }],
  });
  const leerPdf = async (fn) => {
    textos = [];
    const salida = await fn();
    const doc = salida.doc || salida;
    doc.on('data', () => {});
    await new Promise((r) => doc.on('end', r));
    const t = textos.join(' | ');
    textos = null;
    return t;
  };
  const t = await leerPdf(() => pdf.generarPdfEnvio(admin, envio.id));
  ok('el envío sale con el nombre de la BODEGA (quien lo manda)', t.includes('DISTRIBUIDORA LAS AMERICAS'));
  ok('  y no con el de Bunny, que lo recibe', !t.includes('BUNNY MOBILE ·') && !t.includes('901555666-1'));
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Los endpoints de Ajustes → Sucursales');
{
  const router = require(path.join(RAIZ, 'src/modules/sucursales/sucursales.routes.js'));
  const llamar = (metodo, ruta, { user, params = {}, body = {} }) => new Promise((resolve, reject) => {
    const capa = router.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]);
    if (!capa) return reject(new Error(`sin ruta ${metodo} ${ruta}`));
    const pasos = capa.route.stack.map((s) => s.handle);
    const req = { user, params, body, query: {} };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; },
                  json(b) { resolve({ status: this.statusCode, body: b }); } };
    const correr = (i) => (i >= pasos.length ? resolve({ status: 500 })
      : Promise.resolve(pasos[i](req, res, (err) => (err ? reject(err) : correr(i + 1)))).catch(reject));
    correr(0);
  });
  const admin = { id: 1, negocio_id: 1, rol: 'admin_negocio' };
  const super_ = { id: 2, negocio_id: 1, rol: 'supervisor', sucursal_id: 2 };

  const g = await llamar('put', '/:id/documento', { user: admin, params: { id: 3 },
    body: { nombre_comercial: '  TESLA SHOP  ', nit: '', direccion: 'CRA 5 #15-70', telefono: null, logo: '' } });
  ok('guarda y recorta; lo vacío queda NULL', g.status === 200 && g.body.data.nombre_comercial === 'TESLA SHOP'
    && g.body.data.nit === null && g.body.data.logo === null);
  const denegado = await llamar('put', '/:id/documento', { user: super_, params: { id: 3 }, body: { nit: '1' } });
  ok('solo el admin los cambia', denegado.status === 403);
  const ajena = await llamar('put', '/:id/documento', { user: admin, params: { id: 4 }, body: { nit: '1' } });
  ok('no se escribe la sede de otro negocio', ajena.status === 404);
  const malLogo = await llamar('put', '/:id/documento', { user: admin, params: { id: 3 }, body: { logo: 'https://x/y.png' } });
  ok('el logo tiene que ser una imagen en base64', malLogo.status === 400);
  const largo = await llamar('put', '/:id/documento', { user: admin, params: { id: 3 }, body: { nit: 'x'.repeat(201) } });
  ok('texto demasiado largo: 400', largo.status === 400);

  const lista = await llamar('get', '/documentos', { user: super_ });
  ok('la lista la puede leer cualquier usuario del negocio', lista.status === 200 && lista.body.data.length === 3);
  ok('  sin la imagen del logo (solo si tiene)', lista.body.data.every((d) => !('logo' in d))
    && lista.body.data.find((d) => d.sucursal_id === 2).tiene_logo === true);
  ok('  y sin la sede del otro negocio', !lista.body.data.some((d) => d.sucursal_id === 4));
  const una = await llamar('get', '/:id/documento', { user: admin, params: { id: 2 } });
  ok('la de una sede (para editarla) sí trae el logo', una.body.data.logo === PNG);

  const vaciar = await llamar('put', '/:id/documento', { user: admin, params: { id: 3 }, body: {} });
  const { rows } = await db.query('SELECT 1 FROM sucursales_documento WHERE sucursal_id = 3');
  ok('vaciar todo borra la fila: la sede vuelve a heredar', vaciar.body.data === null && rows.length === 0);

  columnas._setDatosDocumentoSucursalDisponible(false);
  const sinTabla = await llamar('get', '/documentos', { user: super_ });
  ok('sin la tabla la lista sale vacía (todo hereda) y no revienta', sinTabla.body.data.length === 0);
  columnas._setDatosDocumentoSucursalDisponible(true);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. La copia del navegador dice lo mismo');
{
  const front = await import('file://' + path.resolve(FRONT, 'utils/emisor.js').replace(/\\/g, '/'));
  ok('mismo mapeo de campos', JSON.stringify(front.CAMPOS) === JSON.stringify(emisor.CAMPOS));
  const casos = [null, {}, { nombre_comercial: 'A' }, { nit: ' 9 ', direccion: '' },
    { nombre_comercial: '  ', telefono: '1', logo: PNG }, { nombre_comercial: 'B', nit: 'C', direccion: 'D', telefono: 'E', logo: 'F' }];
  const bases = [{}, CONFIG_TESLA, { nombre_negocio: 'N', otra: 'x' }];
  let iguales = 0; let total = 0;
  for (const b of bases) for (const d of casos) {
    total++;
    if (JSON.stringify(front.aplicarDatosSucursal(b, d)) === JSON.stringify(emisor.aplicarDatosSucursal(b, d))) iguales++;
  }
  ok(`las dos mezclas dan lo mismo en ${total} casos`, iguales === total, `${iguales}/${total}`);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Cada documento usa la sede del DOCUMENTO');
{
  const B = (p) => leer(RAIZ, 'src', p);
  const F = (p) => leer(FRONT, p);
  const backend = [
    ['factura PDF',          B('modules/facturas/facturas.pdf.controller.js'), 'configDocumento(req.user.negocio_id, factura.sucursal_id'],
    ['correo de la factura', B('modules/facturas/facturas.service.js'),        'configDocumento(negocio_id, factura.sucursal_id'],
    ['orden de servicio',    B('modules/servicios/servicios.pdf.controller.js'), 'configDocumento(negocioId, orden.sucursal_id'],
    ['aviso/paz y salvo de crédito', B('modules/creditos/creditos.pdf.service.js'), 'configDocumento(negocioId, credito.sucursal_id'],
    ['estado de cuenta de crédito',  B('modules/creditos/creditos.pdf.service.js'), 'encabezadoPara(negocioId, sucursalId'],
    // Desde oct-2026 el comprobante arma el encabezado con NIT/dirección
    // (`_configEncabezado`, que llama a encabezadoPara y configDocumento con la
    // MISMA sede): sigue siendo la sede que prestó.
    ['comprobante de préstamo',      B('modules/prestamos/prestamos.pdf.service.js'), '_configEncabezado(negocioId, datos.sucursal_id'],
    ['aviso/paz y salvo de préstamo', B('modules/prestamos/prestamos.pdf.service.js'), 'configDocumento(negocioId, datos.sucursal_id)'],
    ['envío de la red',      B('modules/red-interna/redInterna.pdf.js'),  '_config(req.user.negocio_id, r.sucursal_origen_id)'],
    ['etiquetas',            B('modules/etiquetas/etiquetas.repository.js'), 'sucursales_documento'],
  ];
  for (const [n, src, frag] of backend) ok(`backend · ${n}`, src.includes(frag));

  const tickets = [
    ['factura POS',           F('components/FacturaTermica.jsx'),           'useConfigDocumento(factura?.config || {}, factura?.sucursal_id)'],
    ['orden de servicio POS', F('components/ComprobanteServicio.jsx'),      'useConfigDocumento(configNegocio, orden?.sucursal_id)'],
    ['recepción POS',         F('components/ReciboRecepcion.jsx'),          'useConfigDocumento(configNegocio, orden?.sucursal_id)'],
    ['recibo de abono POS',   F('components/ReciboAbono.jsx'),              'useConfigDocumento(configNegocio, deuda?.sucursal_id)'],
    ['aviso/paz y salvo POS', F('components/documentos/ModalDocumentosObligacion.jsx'), 'data?.sucursal_id ?? data?.credito?.sucursal_id'],
    ['préstamo POS',          F('components/ui/ModalImprimirPrestamo.jsx'), 'useConfigDocumento(configNegocio, prestamo.sucursal_id)'],
    ['envío POS',             F('pages/red-interna/documentos/ModalDocumentoEnvio.jsx'), 'r?.sucursal_origen_id'],
    ['pendientes POS',        F('pages/red-interna/documentos/ModalEnviosPendientes.jsx'), 'red_interna_bodega_id'],
    ['recibo de acreedor POS', F('components/Reciboacreedor.jsx'),          'movimiento?.sucursal_id'],
  ];
  for (const [n, src, frag] of tickets) ok(`ticket · ${n}`, src.includes(frag));
  ok('el abono de crédito y de préstamo mandan su sede al recibo',
    F('pages/prestamos/TabCreditos.jsx').includes('sucursal_id: credito.sucursal_id')
    && F('pages/prestamos/ModalAbonoPrestamo.jsx').includes('sucursal_id: prestamo.sucursal_id'));
  const runner = B('config/migrations.js');
  ok('el runner de arranque aplica la migración', runner.includes('20260928_datos_documento_sucursal.sql'));
}

console.log(`\n${pasados} pasaron, ${fallos.length} fallaron`);
if (fallos.length) { console.log('Fallaron:\n  - ' + fallos.join('\n  - ')); process.exit(1); }
