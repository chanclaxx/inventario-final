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

console.log(`\n${pasados} verificaciones pasaron · ${fallos} fallaron`);
process.exit(fallos ? 1 : 0);
