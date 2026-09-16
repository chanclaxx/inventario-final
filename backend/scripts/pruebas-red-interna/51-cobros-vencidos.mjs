// ─────────────────────────────────────────────────────────────────────────────
// COBROS VENCIDOS — el aviso dice A QUIÉN y la tarjeta de la persona lo repite
//
// Reportado desde producción (sep-2026): el aviso «N cobros vencidos» llevaba a
// la pestaña general de Préstamos, y ahí no había forma de ver cuáles eran ni
// ninguna tarjeta de persona decía que tenía algo vencido.
//
// Ahora: el panel de Avisos despliega a las personas (cada una a su ficha), el
// enlace lleva a la lista filtrada a «Vencidos», y las tarjetas de Préstamos
// (compañeros y clientes) y de Créditos dicen cuántos vencidos tienen.
//
// Lo que esta prueba sostiene, en orden de importancia:
//
//   1. QUE EL AVISO Y LAS TARJETAS CUENTEN LO MISMO. «Vencido» = activo y con la
//      fecha límite antes de HOY EN BOGOTÁ, tenga o no mora pactada. Las
//      tarjetas de préstamos lo cuentan en SQL y las de créditos en el
//      navegador; las dos se comparan aquí contra la alerta real.
//   2. Que un préstamo con plazo y SIN mora diga sus días de atraso reales (antes
//      salía «0 días», porque los días venían solo de la mora).
//   3. Que el enlace lleve a la lista donde están y abra el filtro que existe.
//
//   node scripts/pruebas-red-interna/51-cobros-vencidos.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI  = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ  = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');

let fallos = 0, pasados = 0;
const check = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else    { fallos++;  console.log(`  ✗ ${etiqueta} — dio ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`); }
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db.exec(`
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_label VARCHAR;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_label VARCHAR;
  ALTER TABLE clientes  ADD COLUMN IF NOT EXISTS celular       TEXT;
  ALTER TABLE clientes  ADD COLUMN IF NOT EXISTS saldo_a_favor NUMERIC DEFAULT 0;
`);
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260730_mora_credito.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260804_interes_corriente.sql'), 'utf8'));

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

const alertas      = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.alertas.js'));
const motor        = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.motor.js'));
const ctrl         = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.controller.js'));
const creditosRepo = require(path.join(RAIZ, 'src/modules/creditos/creditos.repository.js'));

// Las fechas se arman desde HOY EN BOGOTÁ, que es contra lo que comparan la
// alerta y las tarjetas. CURRENT_DATE de PGlite es UTC y correría un día de noche.
const HOY = alertas.hoyBogota();
const dia = (n) => {
  const [y, m, d] = HOY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// Simula el viaje por HTTP: en el navegador todo llega como JSON.
const porHttp = (x) => JSON.parse(JSON.stringify(x));

const resumenPersonas = (negocioId = 1) => new Promise((resolve, reject) => {
  ctrl.getPrestamos(
    { query: { vista: 'personas' }, todasSucursales: true, sucursal_id: null,
      user: { negocio_id: negocioId, id: 1 } },
    { json: (o) => resolve(porHttp(o.data)) },
    reject,
  );
});

// ── Datos ───────────────────────────────────────────────────────────────────
// Ana (compañera): dos vencidos SIN mora pactada (hace 10 y hace 3 días) y uno
// que vence en 20. Beto: uno saldado con la fecha pasada y uno sin plazo.
// Diana (cliente): uno vencido ayer. Gabo (crédito, cédula 555): dos facturas
// vencidas. Hugo (crédito sin cédula): vence mañana. Iris (566): saldado.
// Negocio 2: un vencido que no puede colarse.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Grande'), ('Vecino');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Centro'),(1,'Norte'),(2,'Ajena');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO prestatarios (negocio_id, nombre, telefono) VALUES
    (1,'Ana','300'), (1,'Beto','301'), (2,'Ajeno','304');
  INSERT INTO clientes (negocio_id, nombre, cedula, celular) VALUES (1,'Diana','111','320111');
`);
await db.query(`
  INSERT INTO prestamos (sucursal_id, usuario_id, prestatario, prestatario_id, cliente_id,
                         nombre_producto, valor_prestamo, total_abonado, estado, fecha, fecha_limite)
  VALUES
    (1,1,'Ana',  1,NULL,'Cargador', 100000,     0,'Activo',  '2026-01-01 10:00', $1),
    (2,1,'Ana',  1,NULL,'Funda',     30000, 10000,'Activo',  '2026-01-02 10:00', $2),
    (1,1,'Ana',  1,NULL,'Cable',     20000,     0,'Activo',  '2026-01-03 10:00', $3),
    (1,1,'Beto', 2,NULL,'Teclado',   50000, 50000,'Saldado', '2026-01-04 10:00', $4),
    (1,1,'Beto', 2,NULL,'Mouse',     25000,     0,'Activo',  '2026-01-05 10:00', NULL),
    (1,1,'Diana',NULL,1,'Reloj',     80000, 20000,'Activo',  '2026-01-06 10:00', $5),
    (3,1,'Ajeno',3,NULL,'De otro',  999999,     0,'Activo',  '2026-01-07 10:00', $1)
`, [dia(-10), dia(-3), dia(20), dia(-30), dia(-1)]);
await db.exec(`
  INSERT INTO facturas (id, numero, sucursal_id, nombre_cliente, cedula, celular, estado) VALUES
    (1, 101, 1, 'Gabo', '555', '310', 'Activa'),
    (2, 102, 2, 'Gabo', '555', '310', 'Activa'),
    (3, 103, 1, 'Hugo', NULL,  NULL,  'Activa'),
    (4, 104, 1, 'Iris', '566', NULL,  'Activa');
  INSERT INTO creditos (factura_id, sucursal_id, valor_total, cuota_inicial, total_abonado, estado, fecha_limite) VALUES
    (1, 1, 500000, 100000, 0, 'Activo',  '${dia(-5)}'),
    (2, 2, 200000,      0, 0, 'Activo',  '${dia(-2)}'),
    (3, 1, 150000,      0, 0, 'Activo',  '${dia(1)}'),
    (4, 1,  90000,      0, 90000, 'Saldado', '${dia(-9)}');
`);

const cartera = await alertas.cartera(1);
const vencidos = cartera.vencidos.items;
const porUrl = (url) => vencidos.filter((i) => i.url === url).length;

// ═══════════════════════════════════════════════════════════════════════════
seccion('1. Las tarjetas de PRÉSTAMOS cuentan lo mismo que el aviso');
// ═══════════════════════════════════════════════════════════════════════════
const resumen = await resumenPersonas(1);
const ana   = resumen.prestatarios.find((r) => r.nombre === 'Ana');
const beto  = resumen.prestatarios.find((r) => r.nombre === 'Beto');
const diana = resumen.clientes.find((r) => r.nombre === 'Diana');

check('★★ Ana: 2 vencidos en su tarjeta', Number(ana.n_vencidos), 2);
check('★★ y 2 en el aviso, con el enlace a su ficha',
  porUrl('/prestamos?tab=prestamos&persona=prestatario_1'), 2);
check('★★ Diana (cliente): 1 y 1',
  [Number(diana.n_vencidos), porUrl('/prestamos?tab=prestamos&persona=cliente_1')], [1, 1]);
check('★ Beto: el saldado con fecha pasada y el sin plazo no cuentan',
  [Number(beto.n_vencidos), porUrl('/prestamos?tab=prestamos&persona=prestatario_2')], [0, 0]);
check('Ana: el atraso del más viejo son 10 días', Number(ana.dias_vencido_max), 10);
check('el que vence en 20 días no es vencido (Ana tiene 3 activos)', Number(ana.n_activos), 3);

// Todas las personas del resumen, contra el aviso: ninguna puede discrepar.
const discrepan = [
  ...resumen.prestatarios.map((r) => [`prestatario_${r.persona_id}`, r]),
  ...resumen.clientes.map((r) => [`cliente_${r.persona_id}`, r]),
].filter(([clave, r]) =>
  Number(r.n_vencidos) !== porUrl(`/prestamos?tab=prestamos&persona=${clave}`));
check('★★ ninguna persona de préstamos discrepa del aviso', discrepan.map(([c]) => c), []);

// ═══════════════════════════════════════════════════════════════════════════
seccion('2. Las tarjetas de CRÉDITOS cuentan lo mismo que el aviso');
// ═══════════════════════════════════════════════════════════════════════════
// Se extrae la función REAL de TabCreditos (JS puro, sin JSX) y se corre sobre
// la respuesta real de créditos pasada por JSON, como la ve el navegador.
const tabCreditos = readFileSync(path.join(FRONT, 'pages/prestamos/TabCreditos.jsx'), 'utf8');
const desde = tabCreditos.indexOf('function vencidosDe(');
check('TabCreditos todavía trae vencidosDe', desde !== -1, true);
let prof = 0, hasta = desde;
for (let i = tabCreditos.indexOf('{', desde); i < tabCreditos.length; i++) {
  if (tabCreditos[i] === '{') prof++;
  else if (tabCreditos[i] === '}') { prof--; if (prof === 0) { hasta = i + 1; break; } }
}
const vencidosDe = new Function(`${tabCreditos.slice(desde, hasta)}; return vencidosDe;`)();

const creditos = porHttp(await creditosRepo.findAll(null, 1));
const personasCredito = new Map();
for (const c of creditos) {
  const clave = c.cedula || c.nombre_cliente;       // la clave de la pantalla
  if (!personasCredito.has(clave)) personasCredito.set(clave, []);
  personasCredito.get(clave).push(c);
}
const urlCredito = (clave) => `/prestamos?tab=creditos&persona=${encodeURIComponent(clave)}`;

check('★★ Gabo: 2 vencidos en la tarjeta y 2 en el aviso',
  [vencidosDe(personasCredito.get('555')).cuantos, porUrl(urlCredito('555'))], [2, 2]);
check('Gabo: el más viejo hace 5 días', vencidosDe(personasCredito.get('555')).diasMax, 5);
check('★ Hugo vence mañana: 0 y 0',
  [vencidosDe(personasCredito.get('Hugo')).cuantos, porUrl(urlCredito('Hugo'))], [0, 0]);
check('★ Iris está saldada con la fecha pasada: 0 y 0',
  [vencidosDe(personasCredito.get('566')).cuantos, porUrl(urlCredito('566'))], [0, 0]);
const discrepanCred = [...personasCredito.entries()]
  .filter(([clave, lista]) => vencidosDe(lista).cuantos !== porUrl(urlCredito(clave)));
check('★★ ninguna persona de créditos discrepa del aviso', discrepanCred.map(([c]) => c), []);

// ═══════════════════════════════════════════════════════════════════════════
seccion('3. Los días de atraso sin mora pactada');
// ═══════════════════════════════════════════════════════════════════════════
const cargador = vencidos.find((i) => i.tipo === 'prestamo' && i.detalle === 'Cargador');
check('★ un préstamo con plazo y sin mora dice 10 días, no 0', cargador?.dias_vencidos, 10);
check('el aviso pone primero al más atrasado', vencidos[0]?.dias_vencidos, 10);
check('★ el total es lo que se debe: 100.000', cargador?.total, 100000);
check('el crédito resta la cuota inicial: 400.000',
  vencidos.find((i) => i.tipo === 'credito' && i.numero === 101)?.total, 400000);

// ═══════════════════════════════════════════════════════════════════════════
seccion('4. Aislamiento');
// ═══════════════════════════════════════════════════════════════════════════
check('★ el vencido del negocio 2 no está en el aviso del 1',
  vencidos.some((i) => i.persona === 'Ajeno'), false);
check('5 documentos vencidos en total en el negocio 1', vencidos.length, 5);
const resumen2 = await resumenPersonas(2);
check('el negocio 2 ve su propio vencido', Number(resumen2.prestatarios[0]?.n_vencidos), 1);

// ═══════════════════════════════════════════════════════════════════════════
seccion('5. A dónde lleva el aviso');
// ═══════════════════════════════════════════════════════════════════════════
const d = motor.destinoCobrosVencidos;
const it = (url) => ({ url });
check('★ una sola persona → directo a su ficha',
  d([it('/prestamos?tab=prestamos&persona=prestatario_1'), it('/prestamos?tab=prestamos&persona=prestatario_1')]),
  '/prestamos?tab=prestamos&persona=prestatario_1');
check('★ más personas en créditos → Créditos filtrado',
  d([it(urlCredito('555')), it(urlCredito('Hugo')), it('/prestamos?tab=prestamos&persona=cliente_1')]),
  '/prestamos?tab=creditos&filtro=vencidos');
check('más clientes de préstamos → Clientes filtrado',
  d([it('/prestamos?tab=prestamos&persona=cliente_1'), it('/prestamos?tab=prestamos&persona=cliente_2'),
     it('/prestamos?tab=prestamos&persona=prestatario_1')]),
  '/prestamos?tab=prestamos&sub=clientes&filtro=vencidos');
check('sin personas identificables cae a Préstamos', d([it('/prestamos')]), '/prestamos');

const { senales } = await motor.recolectar(1);
const senal = senales.find((s) => s.clave === 'cobros_vencidos');
check('★★ el aviso YA NO lleva a la pestaña general', senal?.url !== '/prestamos', true);
check('el aviso usa ese destino', senal?.url, d(vencidos));

// ═══════════════════════════════════════════════════════════════════════════
seccion('6. Las pantallas abren lo que el enlace pide');
// ═══════════════════════════════════════════════════════════════════════════
const pagina  = readFileSync(path.join(FRONT, 'pages/prestamos/PrestamosPage.jsx'), 'utf8');
const avisos  = readFileSync(path.join(FRONT, 'pages/avisos/AvisosPage.jsx'), 'utf8');
const cronSrc = readFileSync(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.cron.js'), 'utf8');
check('★ Préstamos lee ?filtro=vencidos', pagina.includes(`params.get('filtro') === 'vencidos'`), true);
check('★ Préstamos lee ?sub=clientes', pagina.includes(`paramSub === 'clientes'`), true);
check('Préstamos tiene el filtro Vencidos', pagina.includes(`id: 'vencidos'`), true);
check('★ y le pasa el filtro a Créditos', pagina.includes('filtroInicial={filtroCreditoInicial}'), true);
check('las tarjetas de préstamos pintan los vencidos', /nVencidos=\{grupo\.nVencidos\}/.test(pagina), true);
check('las tarjetas de créditos también', tabCreditos.includes('<BadgeVencidosPersona cuantos={persona.vencidos.cuantos}'), true);
check('★ Avisos despliega a las personas con el detalle del motor',
  avisos.includes('data?.detalle?.cartera?.vencidos'), true);
check('el push de «y N más» tampoco va a la pestaña general',
  cronSrc.includes('motor.destinoCobrosVencidos('), true);

console.log(`\n${pasados} verificaciones pasaron · ${fallos} fallaron`);
process.exit(fallos ? 1 : 0);
