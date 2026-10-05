// ─────────────────────────────────────────────────────────────────────────────
// BÚSQUEDA DE PRÉSTAMOS — situación, cargos y agrupación por persona
//
// Pedido del negocio (sep-2026): buscar en Préstamos agrupando por persona y
// viendo de una vez quién está vencido, por vencer, con mora o con interés.
//
// Lo que esta prueba sostiene, en orden de importancia:
//
//   1. QUE «VENCIDO» EN LA BÚSQUEDA SEA LO MISMO QUE EN EL AVISO DE COBROS. El
//      filtro «Vencidos» y la alerta de las 8:00 tienen que traer exactamente
//      los mismos préstamos: si no, el aviso dice «3» y la búsqueda muestra otra
//      cosa.
//   2. Que un préstamo NO salga repetido. La consulta vieja unía `seriales` por
//      IMEI, y un IMEI vive en varias filas: el mismo préstamo salía una vez
//      por cada una (en la lista, en el conteo y en el Excel).
//   3. Que la mora y el interés lleguen calculados (antes la consulta ni traía
//      la fecha límite, y el aviso de vencido de la tarjeta nunca se pintaba),
//      y que «con mora» no incluya una mora de solo aviso (valor 0).
//   4. Que la agrupación por persona sume lo que el backend ya calculó.
//
//   node scripts/pruebas-red-interna/53-busqueda-prestamos.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
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

const ctrl    = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.controller.js'));
const alertas = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.alertas.js'));
const front   = await import(pathToFileURL(path.join(FRONT, 'utils/busquedaPrestamos.js')).href);

const HOY = alertas.hoyBogota();
const dia = (n) => {
  const [y, m, d] = HOY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const porHttp = (x) => JSON.parse(JSON.stringify(x));

// Llama al CONTROLADOR de verdad: ahí vive el parseo de los filtros.
const buscar = (query, { negocioId = 1, rol = 'admin_negocio', sucursalId = null } = {}) =>
  new Promise((resolve, reject) => {
    ctrl.buscarPrestamos(
      { query, sucursal_id: sucursalId, user: { negocio_id: negocioId, rol, id: 1 } },
      { json: (o) => resolve(porHttp(o.data)) },
      reject,
    );
  });
const ids = (r) => (r.prestamos || []).map((p) => p.id).sort((a, b) => a - b);

// ── Datos ───────────────────────────────────────────────────────────────────
// Ana (compañera): Cargador vencido hace 10 días con mora 2%, Funda vencida
// hace 3 SIN mora, Cable que vence en 2 días (por vencer), Tablet con interés
// 3% mensual y sin plazo. Beto: un saldado vencido (no cuenta) y uno sin plazo.
// Diana (cliente): Reloj vencido ayer con mora de SOLO AVISO (valor 0).
// Carlos: iPhone con IMEI que vive en TRES filas de seriales (fan-out).
// Negocio 2: un vencido que no puede colarse.
const MORA  = { id: 'normal', nombre: 'Normal', tipo: 'mensual', valor: 2, dias_gracia: 0, tope_pct: null, color: 'amber' };
const AVISO = { id: 'aviso', nombre: 'Solo aviso', tipo: 'mensual', valor: 0, dias_gracia: 0, tope_pct: null, color: 'amber' };
const PLAN  = { id: 'fin3', nombre: 'Financiación 3%', tipo: 'porcentaje', valor: 3,
  periodicidad: 'mensual', devengo: 'diario', base: 'saldo', inicia_tras_dias: 0, al_vencer: 'continua' };

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Grande'), ('Vecino');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Centro'),(1,'Norte'),(2,'Ajena');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO prestatarios (negocio_id, nombre, telefono) VALUES
    (1,'Ana María','300'), (1,'Beto','301'), (1,'Carlos','302'), (2,'Ajeno','304');
  INSERT INTO clientes (negocio_id, nombre, cedula, celular) VALUES (1,'Diana','111222','320111');
  INSERT INTO config_negocio (negocio_id, clave, valor) VALUES (1,'mora_aviso_previo_dias','3');
  INSERT INTO lineas_producto (id, negocio_id, nombre) VALUES (1, 1, 'Celulares');
  INSERT INTO productos_serial (id, nombre, sucursal_id, linea_id) VALUES
    (1,'iPhone 11',1,1), (2,'iPhone 11',2,1), (3,'iPhone 11 usado',1,1);
  INSERT INTO seriales (producto_id, imei) VALUES (1,'356000111'), (2,'356000111'), (3,'356000111');
`);
await db.query(`
  INSERT INTO prestamos (sucursal_id, usuario_id, prestatario, prestatario_id, cliente_id, telefono,
                         nombre_producto, imei, valor_prestamo, total_abonado, estado, fecha,
                         fecha_limite, mora_condicion, interes_condicion)
  VALUES
    -- «Ana» a secas en el texto del préstamo: la ficha se renombró después.
    (1,1,'Ana',   1,NULL,NULL,     'Cargador', NULL,       100000,     0,'Activo',  $1, $2, $6::jsonb, NULL),
    (2,1,'Ana',   1,NULL,NULL,     'Funda',    NULL,        30000, 10000,'Activo',  $1, $3, NULL,      NULL),
    (1,1,'Ana',   1,NULL,NULL,     'Cable',    NULL,        20000,     0,'Activo',  $1, $4, $6::jsonb, NULL),
    (1,1,'Ana',   1,NULL,NULL,     'Tablet',   NULL,       200000,     0,'Activo',  $1, NULL, NULL,    $8::jsonb),
    (1,1,'Beto',  2,NULL,NULL,     'Teclado',  NULL,        50000, 50000,'Saldado', $1, $5, $6::jsonb, NULL),
    (1,1,'Beto',  2,NULL,NULL,     'Mouse',    NULL,        25000,     0,'Activo',  $1, NULL, NULL,    NULL),
    (1,1,'Diana', NULL,1,'3209998','Reloj',    NULL,        80000, 20000,'Activo',  $1, $9, $7::jsonb, NULL),
    (1,1,'Carlos',3,NULL,NULL,     'iPhone',   '356000111',900000,     0,'Activo',  $1, NULL, NULL,    NULL),
    (3,1,'Ajeno', 4,NULL,NULL,     'De otro',  NULL,       999999,     0,'Activo',  $1, $2, $6::jsonb, NULL)
`, [`${dia(-60)} 12:00:00`, dia(-10), dia(-3), dia(2), dia(-30), JSON.stringify(MORA),
    JSON.stringify(AVISO), JSON.stringify(PLAN), dia(-1)]);

const idDe = async (producto) =>
  (await db.query(`SELECT id FROM prestamos WHERE nombre_producto = $1 AND sucursal_id <> 3`, [producto])).rows[0].id;
const ID = {};
for (const n of ['Cargador', 'Funda', 'Cable', 'Tablet', 'Teclado', 'Mouse', 'Reloj', 'iPhone']) ID[n] = await idDe(n);

// ═══════════════════════════════════════════════════════════════════════════
seccion('1. «Vencidos» en la búsqueda == vencidos del aviso de cobros');
// ═══════════════════════════════════════════════════════════════════════════
const vencidos = await buscar({ situacion: 'vencido' });
const cartera  = await alertas.cartera(1);
const delAviso = cartera.vencidos.items.filter((i) => i.tipo === 'prestamo').map((i) => i.id).sort((a, b) => a - b);

check('★★ los mismos préstamos que el aviso', ids(vencidos), delAviso);
check('★★ son el Cargador, la Funda y el Reloj',
  ids(vencidos), [ID.Cargador, ID.Funda, ID.Reloj].sort((a, b) => a - b));
check('★ el saldado con la fecha pasada no cuenta', ids(vencidos).includes(ID.Teclado), false);
check('★ el vencido del otro negocio no se cuela', vencidos.prestamos.some((p) => p.prestatario === 'Ajeno'), false);
check('los días de atraso salen del calendario (sin mora pactada también)',
  vencidos.prestamos.find((p) => p.id === ID.Funda)?.dias_vencidos, 3);
check('y coinciden con los del aviso',
  vencidos.prestamos.find((p) => p.id === ID.Cargador)?.dias_vencidos,
  cartera.vencidos.items.find((i) => i.id === ID.Cargador)?.dias_vencidos);

// ═══════════════════════════════════════════════════════════════════════════
seccion('2. Cada préstamo sale UNA vez');
// ═══════════════════════════════════════════════════════════════════════════
const porImei = await buscar({ q: '356000111' });
check('★★ el iPhone con el IMEI en tres filas de seriales sale una sola vez', ids(porImei), [ID.iPhone]);
check('y trae su línea', porImei.prestamos[0]?.linea_nombre, 'Celulares');
const todos = await buscar({ estado: 'Activo' });
check('★ ningún id repetido en una búsqueda amplia',
  ids(todos).length, new Set(ids(todos)).size);
check('la búsqueda por línea sigue funcionando', ids(await buscar({ q: 'celulares' })), [ID.iPhone]);

// ═══════════════════════════════════════════════════════════════════════════
seccion('3. Situación de cada préstamo');
// ═══════════════════════════════════════════════════════════════════════════
const sit = Object.fromEntries(todos.prestamos.map((p) => [p.id, p.situacion]));
check('Cargador: vencido', sit[ID.Cargador], 'vencido');
check('Cable (vence en 2 días, ventana de 3): por vencer', sit[ID.Cable], 'por_vencer');
check('Tablet (sin fecha límite): sin plazo', sit[ID.Tablet], 'sin_plazo');
check('★ «Por vencer» trae solo el Cable', ids(await buscar({ situacion: 'por_vencer' })), [ID.Cable]);
check('«Sin plazo» trae los activos sin fecha',
  ids(await buscar({ situacion: 'sin_plazo' })), [ID.Tablet, ID.Mouse, ID.iPhone].sort((a, b) => a - b));
check('la respuesta dice cuál es la ventana de «por vencer»', todos.dias_aviso, 3);
check('un valor de situación que no se entiende no filtra (ni llega al SQL)',
  ids(await buscar({ estado: 'Activo', situacion: "x'; DROP TABLE prestamos;--" })), ids(todos));

// ═══════════════════════════════════════════════════════════════════════════
seccion('4. Mora e interés, calculados por el motor');
// ═══════════════════════════════════════════════════════════════════════════
const cargador = todos.prestamos.find((p) => p.id === ID.Cargador);
check('★ el Cargador trae su mora: 100.000 × 2% × 10 días = 667', cargador.mora_pendiente, 667);
check('★ el aviso de la tarjeta ya tiene de dónde leer (antes llegaba vacío)', cargador.mora?.vencido, true);
const conMora = await buscar({ cargo: 'mora' });
check('★ «Con mora» trae solo el Cargador', ids(conMora), [ID.Cargador]);
check('★ la mora de solo aviso (valor 0) no entra en «con mora»', ids(conMora).includes(ID.Reloj), false);
check('pero ese préstamo sí está vencido', ids(vencidos).includes(ID.Reloj), true);
const conInteres = await buscar({ cargo: 'interes' });
check('«Con interés» trae la Tablet', ids(conInteres), [ID.Tablet]);
check('con su interés: 200.000 × 3% × 60 días = 12.000', conInteres.prestamos[0]?.interes_pendiente, 12000);
check('el total a pagar suma capital e interés', conInteres.prestamos[0]?.total_a_pagar, 212000);

// ═══════════════════════════════════════════════════════════════════════════
seccion('5. Buscar por lo que la gente sabe de la persona');
// ═══════════════════════════════════════════════════════════════════════════
check('★ por el nombre NUEVO de la ficha (el préstamo dice «Ana»)',
  ids(await buscar({ q: 'maria' })), [ID.Cargador, ID.Funda, ID.Cable, ID.Tablet].sort((a, b) => a - b));
check('por la cédula del cliente', ids(await buscar({ q: '111222' })), [ID.Reloj]);
check('por el teléfono del préstamo', ids(await buscar({ q: '3209998' })), [ID.Reloj]);
check('texto y situación se combinan',
  ids(await buscar({ q: 'maria', situacion: 'vencido' })), [ID.Cargador, ID.Funda].sort((a, b) => a - b));

// ═══════════════════════════════════════════════════════════════════════════
seccion('6. Alcance');
// ═══════════════════════════════════════════════════════════════════════════
const vendedor = await buscar({ situacion: 'vencido' }, { rol: 'vendedor', sucursalId: 1 });
check('★ un vendedor solo ve su sucursal (la Funda es de Norte)',
  ids(vendedor), [ID.Cargador, ID.Reloj].sort((a, b) => a - b));
check('el vendedor no puede pedir otra sucursal con ?suc',
  ids(await buscar({ situacion: 'vencido', suc: '2' }, { rol: 'vendedor', sucursalId: 1 })), ids(vendedor));
const vecino = await buscar({ situacion: 'vencido' }, { negocioId: 2 });
check('el otro negocio solo ve lo suyo', vecino.prestamos.map((p) => p.prestatario), ['Ajeno']);
check('sin ningún filtro no se recorre nada', await buscar({}), []);

// ═══════════════════════════════════════════════════════════════════════════
seccion('7. Agrupar por persona (la lógica de la pantalla)');
// ═══════════════════════════════════════════════════════════════════════════
const grupos = front.agruparPorPersona(todos.prestamos);
const ana = grupos.find((g) => g.clave === 'prestatario_1');
check('★ los cuatro préstamos activos de Ana quedan en UN grupo', ana?.prestamos.length, 4);
check('★ con el nombre de su ficha', ana?.nombre, 'Ana María');
check('★ 2 vencidos y 1 por vencer', [ana?.n_vencidos, ana?.n_por_vencer], [2, 1]);
check('el más atrasado, hace 10 días', ana?.dias_vencido_max, 10);
check('suma la mora y el interés que calculó el backend', [ana?.mora, ana?.interes], [667, 12000]);
check('★ su deuda total = la suma de los total_a_pagar',
  ana?.total_a_pagar,
  todos.prestamos.filter((p) => p.prestatario_id === 1).reduce((s, p) => s + Number(p.total_a_pagar), 0));
check('la clave abre su ficha en Préstamos', front.claveBusquedaPersona(todos.prestamos.find((p) => p.cliente_id)), 'cliente_1');

const resumen = front.resumenBusqueda(todos.prestamos);
check('★ el resumen cuenta PERSONAS vencidas: Ana y Diana', resumen.vencido.personas, 2);
check('y préstamos vencidos: 3', resumen.vencido.n, 3);
check('mora pendiente del resumen = la del Cargador', resumen.con_mora.valor, 667);

const orden = front.ordenarGrupos(grupos, 'urgencia').map((g) => g.nombre);
check('★ «Más urgente»: primero quien está vencido, el más atrasado arriba', orden.slice(0, 2), ['Ana María', 'Diana']);
check('el que no tiene nada urgente va al final', orden[orden.length - 1] !== 'Ana María', true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('8. La pantalla usa lo que el backend manda');
// ═══════════════════════════════════════════════════════════════════════════
const pagina = readFileSync(path.join(FRONT, 'pages/prestamos/PrestamosPage.jsx'), 'utf8');
check('★ el aviso que nunca se pintaba ya no se usa', /<BadgeVencido\s/.test(pagina), false);
check('la tarjeta pinta la situación que calcula el backend', pagina.includes('<BadgeSituacion prestamo={prestamo} />'), true);
check('★ la pestaña manda situación y cargo', pagina.includes('...(situacion && { situacion })') && pagina.includes('...(cargo && { cargo })'), true);
check('agrupa con la lógica probada arriba', pagina.includes('agruparPorPersona(resultados)'), true);
check('y puede abrir la ficha de la persona', pagina.includes('<TabBusquedaPrestamos onAbrirPersona='), true);
// Un negocio sin mora no tiene fechas límite: sus atajos de situación y «Con
// mora» siempre darían «Sin resultados». Se esconden según sus opt-in.
check('★ la fila de Situación solo sale con la mora activa',
  /\{moraActiva && \(\s*<div[^>]*>\s*<span[^>]*>Situación<\/span>/.test(pagina), true);
check('★ «Con mora» y «Con interés» dependen de su opt-in',
  pagina.includes("(o.v === 'mora' ? moraActiva : interesActivo)"), true);
check('sin mora, «Más urgente» no se ofrece y el orden por defecto es la deuda',
  pagina.includes("o.id !== 'urgencia' || moraActiva") && pagina.includes("(moraActiva ? 'urgencia' : 'deuda')"), true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('9. La sede seleccionada y las facturas a crédito (oct-2026)');
// ═══════════════════════════════════════════════════════════════════════════
// Reportado: «salen los préstamos de todas las sedes» — el admin buscaba en
// todo el negocio aunque tuviera una sede elegida arriba — y las facturas a
// crédito no salían en la búsqueda. Diana tiene dos créditos en Centro (uno
// vencido con mora, uno saldado), Ernesto uno en Norte, y el negocio 2 uno.
await db.exec(`
  INSERT INTO facturas (id, numero, sucursal_id, usuario_id, cliente_id, nombre_cliente, cedula, celular, estado, fecha) VALUES
    (901, 5001, 1, 1, 1,    'Diana',   '111222', '320111', 'Credito', $1),
    (902, 5002, 1, 1, 1,    'Diana',   '111222', '320111', 'Credito', $1),
    (903, 5003, 2, 1, NULL, 'Ernesto', '777888', '315000', 'Credito', $1),
    (904, 5004, 3, 1, NULL, 'Ajeno',   '999',    '300',    'Credito', $1);
  `.replace(/\$1/g, `'${dia(-40)} 10:00:00'`));
await db.exec(`
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio) VALUES
    (901, 'Moto G84', '357000999', 1, 900000),
    (901, 'Vidrio',   NULL,        1, 20000),
    (902, 'Audífonos', NULL,       1, 150000),
    (903, 'Redmi 13', '358000111', 1, 700000),
    (904, 'De otro',  '359000000', 1, 1);
`);
await db.query(`
  INSERT INTO creditos (id, factura_id, cliente_id, sucursal_id, valor_total, cuota_inicial, total_abonado,
                        estado, creado_en, fecha_limite, mora_condicion) VALUES
    (801, 901, 1,    1, 920000, 120000, 100000, 'Activo',  $1, $2, $3::jsonb),
    (802, 902, 1,    1, 150000, 0,      150000, 'Saldado', $1, NULL, NULL),
    (803, 903, NULL, 2, 700000, 0,      0,      'Activo',  $1, $4, NULL),
    (804, 904, NULL, 3, 1,      0,      0,      'Activo',  $1, $2, NULL)
`, [`${dia(-40)} 10:00:00`, dia(-5), JSON.stringify(MORA), dia(10)]);

const credIds = (r) => (r.creditos || []).map((c) => c.id).sort((a, b) => a - b);
const sedesDe = (r) => [...new Set([...(r.prestamos || []), ...(r.creditos || [])].map((x) => x.sucursal_id))].sort();

// — La sede —
const adminCentro = await buscar({ estado: 'Activo' }, { sucursalId: 1 });
check('★★ el admin con Centro elegido ve SOLO Centro (préstamos y créditos)', sedesDe(adminCentro), [1]);
check('★ la Funda (Norte) ya no se cuela en Centro', ids(adminCentro).includes(ID.Funda), false);
const adminNorte = await buscar({ estado: 'Activo' }, { sucursalId: 2 });
check('★ y con Norte elegido, solo Norte', sedesDe(adminNorte), [2]);
check('Norte: la Funda y el crédito de Ernesto', [ids(adminNorte), credIds(adminNorte)], [[ID.Funda], [803]]);
check('el admin todavía puede pedir otra sede explícita con ?suc',
  sedesDe(await buscar({ estado: 'Activo', suc: '2' }, { sucursalId: 1 })), [2]);
check('la respuesta dice de qué sede es', adminCentro.sucursal_id, 1);
check('un vendedor sigue en la suya, también para créditos',
  sedesDe(await buscar({ estado: 'Activo', suc: '2' }, { rol: 'vendedor', sucursalId: 1 })), [1]);

// — Los créditos salen —
check('★★ las facturas a crédito salen en la búsqueda', credIds(adminCentro), [801]);
check('★ marcadas como crédito', adminCentro.creditos.every((c) => c.es_credito === true), true);
check('★ por la cédula de la factura', credIds(await buscar({ q: '111222' }, { sucursalId: 1 })), [801, 802]);
check('★ por el IMEI de una línea', credIds(await buscar({ q: '357000999' }, { sucursalId: 1 })), [801]);
check('por el producto', credIds(await buscar({ q: 'audifonos' }, { sucursalId: 1 })), [802]);
check('por el número de factura', credIds(await buscar({ q: '5001' }, { sucursalId: 1 })), [801]);
check('por el celular', credIds(await buscar({ q: '320111' }, { sucursalId: 1 })), [801, 802]);
check('un crédito con dos líneas sale UNA vez (EXISTS, no JOIN)',
  (await buscar({ q: 'diana' }, { sucursalId: 1 })).creditos.filter((c) => c.id === 801).length, 1);
check('el otro negocio no se cuela', credIds(await buscar({ q: 'otro' }, { sucursalId: 1 })), []);

const c801 = adminCentro.creditos.find((c) => c.id === 801);
check('★ saldo = valor − cuota inicial − abonado', Number(c801.saldo_pendiente), 700000);
check('trae sus productos con el IMEI', c801.productos.map((l) => l.imei), ['357000999', null]);
check('y la factura', c801.factura_numero, 5001);

// — Mismos filtros —
check('★ tipo «Créditos» trae solo créditos', (await buscar({ tipo: 'credito' }, { sucursalId: 1 })).prestamos.length, 0);
check('tipo «Créditos» con estado', credIds(await buscar({ tipo: 'credito', estado: 'Saldado' }, { sucursalId: 1 })), [802]);
check('★ tipo «Compañeros» no trae créditos', (await buscar({ tipo: 'companero' }, { sucursalId: 1 })).creditos.length, 0);
check('estado «Devuelto» no trae créditos (no existe en créditos)',
  (await buscar({ estado: 'Devuelto' }, { sucursalId: 1 })).creditos.length, 0);
const vencCentro = await buscar({ situacion: 'vencido' }, { sucursalId: 1 });
check('★ «Vencidos» trae el crédito vencido', credIds(vencCentro), [801]);
check('con sus días de atraso', vencCentro.creditos[0]?.dias_vencidos, 5);
check('★ y su mora, del mismo motor', vencCentro.creditos[0]?.mora_pendiente > 0, true);
check('«Con mora» lo incluye', credIds(await buscar({ cargo: 'mora' }, { sucursalId: 1 })), [801]);
check('«Por vencer» no lo trae; el de Norte vence en 10 días (fuera de la ventana de 3)',
  credIds(await buscar({ situacion: 'por_vencer' }, { sucursalId: 2 })), []);
check('fecha de la venta: antes de la venta no sale',
  credIds(await buscar({ tipo: 'credito', fechaDesde: dia(-30) }, { sucursalId: 1 })), []);
check('y desde antes de la venta sí',
  credIds(await buscar({ tipo: 'credito', fechaDesde: dia(-45), fechaHasta: dia(-35) }, { sucursalId: 1 })), [801, 802]);

// — Cuadra con el aviso y con la pestaña Créditos —
const vencNegocio = await buscar({ situacion: 'vencido' });
const delAvisoCred = (await alertas.cartera(1)).vencidos.items
  .filter((i) => i.tipo === 'credito').map((i) => i.id).sort((a, b) => a - b);
check('★★ «Vencidos» en créditos == los créditos vencidos del aviso de cobros', credIds(vencNegocio), delAvisoCred);
const credSvc = require(path.join(RAIZ, 'src/modules/creditos/creditos.service.js'));
const pestana = (await credSvc.getCreditos(1, 1)).filter((c) => c.estado === 'Activo');
check('★★ activos de Centro == los de la pestaña Créditos (ids)',
  credIds(adminCentro), pestana.map((c) => c.id).sort((a, b) => a - b));
check('★ y el mismo total a pagar',
  adminCentro.creditos.reduce((s, c) => s + Number(c.total_a_pagar), 0),
  pestana.reduce((s, c) => s + Number(c.total_a_pagar), 0));

// — La lógica de la pantalla —
const conCred = [...adminCentro.prestamos, ...adminCentro.creditos];
const gruposCred = front.agruparPorPersona(conCred);
const gDiana = gruposCred.find((g) => g.clave === 'credito_111222');
check('★ el crédito se agrupa con la clave de la pestaña Créditos (cédula)', !!gDiana, true);
check('aparte de sus préstamos (dos fichas distintas)', gruposCred.some((g) => g.clave === 'cliente_1'), true);
check('el grupo es de tipo crédito, con su nombre', [gDiana?.tipo, gDiana?.nombre], ['credito', 'Diana']);
check('★ el grupo debe lo que calculó el backend', gDiana?.total_a_pagar, Number(c801.total_a_pagar));
check('la clave de React distingue préstamo y crédito con el mismo id',
  front.claveDocumento({ id: 7 }) !== front.claveDocumento({ id: 7, es_credito: true }), true);
check('el resumen cuenta el crédito vencido', front.resumenBusqueda(vencCentro.creditos).vencido.n, 1);

const pagina9 = readFileSync(path.join(FRONT, 'pages/prestamos/PrestamosPage.jsx'), 'utf8');
check('★ la clave de la consulta lleva la sede (cambiar de sede vuelve a buscar)',
  pagina9.includes("queryKey: ['busqueda-prestamos', sucursalActiva,"), true);
check('★ la pantalla junta préstamos y créditos', pagina9.includes('[...prestamosEnc, ...creditosEnc]'), true);
check('pinta los créditos con su tarjeta', pagina9.includes('<TarjetaResultadoCredito'), true);
check('★ abrir un crédito lleva a su ficha en Créditos',
  pagina9.includes("clave.startsWith('credito_')") && pagina9.includes("setTabPrincipal('creditos')"), true);
check('el filtro de tipo ofrece «Créditos»', pagina9.includes("{ v: 'credito',   label: 'Créditos'"), true);
check('el Excel de préstamos no recibe créditos', pagina9.includes('prestamos: prestamosEnc, abonosTotales'), true);

console.log(`\n${pasados} verificaciones pasaron · ${fallos} fallaron`);
process.exit(fallos ? 1 : 0);
