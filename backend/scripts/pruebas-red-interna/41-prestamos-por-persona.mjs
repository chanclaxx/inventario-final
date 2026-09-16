// ─────────────────────────────────────────────────────────────────────────────
// LISTA DE PRÉSTAMOS POR PERSONA — contra un Postgres real (PGlite/WASM).
//
// `GET /api/prestamos` devolvía SIEMPRE el historial completo del negocio. En
// Cellsite eso son 9.976 filas y 13,6 MB de JSON, y la pantalla los volvía a
// pedir enteros después de CADA abono, para pintar diez tarjetas de persona.
// Ahora el endpoint acepta dos recortes opcionales:
//
//   ?vista=personas                 → una fila por persona (144 KB)
//   ?persona_tipo=..&persona_id=..  → los préstamos de esa persona
//
// Lo que esta suite protege es que sean EXACTAMENTE eso: recortes. Ni un número
// nuevo, ni una cifra distinta.
//
//   · Sección 1 — SIN parámetros la respuesta es la de siempre. Es la que hay
//     que mirar primero: es la que protege a los 28 negocios.
//   · Sección 2 — el resumen agregado da cifra por cifra lo mismo que agrupar
//     la lista completa en el navegador, que es lo que la pantalla hacía.
//   · Sección 3 — el filtro por persona da el MISMO subconjunto, en el mismo
//     orden y con las mismas claves.
//   · Sección 4 — `anotarLista` no cambia de FORMA según el conjunto. Era un
//     problema latente: sin plazo ni interés devolvía menos claves, así que el
//     mismo préstamo llegaba distinto según si OTRO préstamo del negocio tenía
//     plazo — y por lo tanto según qué subconjunto se pidiera.
//   · Sección 5 — el recorte no se salta el aislamiento entre negocios.
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

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));

// El esquema de pruebas es un recorte. Se completa aquí, no en el archivo
// compartido, para no alterar el resto de suites.
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

const ctrl = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.controller.js'));

let fallos = 0, pasados = 0;
const check = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${cond ? '' : `  ← ${detalle}`}`);
  cond ? pasados++ : fallos++;
};
const checkEq = (nombre, real, esperado) => check(
  nombre, JSON.stringify(real) === JSON.stringify(esperado),
  `dio ${JSON.stringify(real)?.slice(0, 200)}, esperaba ${JSON.stringify(esperado)?.slice(0, 200)}`);

// Llama al CONTROLADOR de verdad, que es donde vive el parseo de los parámetros.
const pedir = (query, negocioId = 1) => new Promise((resolve, reject) => {
  ctrl.getPrestamos(
    { query, todasSucursales: true, sucursal_id: null, user: { negocio_id: negocioId, id: 1 } },
    { json: (o) => resolve(o.data) },
    reject,
  );
});

// ── La agrupación que PrestamosPage hacía en el navegador, copiada tal cual ──
// Es el patrón oro de esta suite: si el resumen del backend no da exactamente
// esto, la pantalla mostraría cifras distintas a las de antes.
const agruparComoElNavegador = (prestamos) => {
  const comp = prestamos.filter((p) => p.prestatario_id).reduce((acc, p) => {
    const key = `prestatario_${p.prestatario_id}`;
    if (!acc[key]) acc[key] = {
      nombre: p.prestatario_nombre || p.prestatario, prestamos: [], saldoTotal: 0,
      saldoAFavor: Number(p.prestatario_saldo_a_favor ?? 0),
      ultimoAbono: p.ultimo_abono_prestatario ?? null,
    };
    acc[key].prestamos.push(p);
    if (p.estado === 'Activo') acc[key].saldoTotal += Number(p.valor_prestamo) - Number(p.total_abonado);
    return acc;
  }, {});
  const cli = prestamos.filter((p) => p.cliente_id).reduce((acc, p) => {
    const key = `cliente_${p.cliente_id}`;
    if (!acc[key]) acc[key] = {
      nombre: p.cliente_nombre || p.prestatario, celular: p.cliente_celular || '',
      prestamos: [], saldoTotal: 0,
      saldoAFavor: Number(p.cliente_saldo_a_favor ?? 0),
      ultimoAbono: p.ultimo_abono_cliente ?? null,
    };
    acc[key].prestamos.push(p);
    if (p.estado === 'Activo') acc[key].saldoTotal += Number(p.valor_prestamo) - Number(p.total_abonado);
    return acc;
  }, {});
  return { comp, cli };
};

// Lo que CardPersona derivaba de grupo.prestamos
const tarjeta = (g) => {
  const act = g.prestamos.filter((p) => p.estado === 'Activo');
  return {
    nActivos:  act.length,
    nCerrados: g.prestamos.filter((p) => p.estado !== 'Activo').length,
    valor:     act.reduce((s, p) => s + Number(p.valor_prestamo), 0),
    abonado:   act.reduce((s, p) => s + Number(p.total_abonado), 0),
  };
};
const iso = (v) => (v == null ? null : new Date(v).toISOString());

// ── Datos base ──────────────────────────────────────────────────────────────
// Dos negocios (para el aislamiento), dos sucursales en el primero, personas de
// los dos tipos, y estados variados: Activo, Saldado, Devuelto y uno con estado
// NULL — que el JavaScript contaba como cerrado y que un `<> 'Activo'` en SQL
// habría perdido de los dos contadores sin que nada avisara.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Grande'), ('Vecino');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Centro'),(1,'Norte'),(2,'Ajena');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO prestatarios (negocio_id, nombre, telefono, saldo_a_favor) VALUES
    (1,'Ana',   '300', 15000),
    (1,'Beto',  '301', 0),
    (1,'Carlos','302', 0),
    (1,'Sin Prestamos','303', 5000),
    (2,'Ajeno', '304', 0);
  INSERT INTO clientes (negocio_id, nombre, cedula, celular, saldo_a_favor) VALUES
    (1,'Diana','111','320111', 2500),
    (1,'Erika','222','320222', 0);
`);

// Ana: 3 activos (uno en la otra sucursal) + 1 saldado + 1 con estado NULL.
// Beto: solo cerrados. Carlos: tres préstamos con la MISMA fecha al milisegundo,
// que es lo que pasa cuando se registran juntos desde el carrito.
await db.exec(`
  INSERT INTO prestamos
    (sucursal_id, usuario_id, prestatario, prestatario_id, cliente_id,
     nombre_producto, valor_prestamo, total_abonado, estado, fecha)
  VALUES
    (1,1,'Ana',   1,NULL,'Cargador', 100000, 40000,'Activo',  '2026-03-01 10:00:00'),
    (1,1,'Ana',   1,NULL,'Audifono',  60000,     0,'Activo',  '2026-03-05 10:00:00'),
    (2,1,'Ana',   1,NULL,'Funda',     30000, 30000,'Activo',  '2026-03-07 10:00:00'),
    (1,1,'Ana',   1,NULL,'Cable',     20000, 20000,'Saldado', '2026-02-01 10:00:00'),
    (1,1,'Ana',   1,NULL,'Vidrio',    10000,  1000, NULL,     '2026-01-15 10:00:00'),
    (1,1,'Beto',  2,NULL,'Teclado',   50000, 50000,'Saldado', '2026-02-10 10:00:00'),
    (1,1,'Beto',  2,NULL,'Mouse',     25000,     0,'Devuelto','2026-02-11 10:00:00'),
    (1,1,'Carlos',3,NULL,'Lote A',    11000,     0,'Activo',  '2026-04-01 09:30:00'),
    (1,1,'Carlos',3,NULL,'Lote B',    12000,     0,'Activo',  '2026-04-01 09:30:00'),
    (1,1,'Carlos',3,NULL,'Lote C',    13000,     0,'Activo',  '2026-04-01 09:30:00'),
    (1,1,'Diana', NULL,1,'Reloj',     80000, 20000,'Activo',  '2026-03-20 10:00:00'),
    (1,1,'Diana', NULL,1,'Correa',    15000, 15000,'Saldado', '2026-03-21 10:00:00'),
    (1,1,'Erika', NULL,2,'Parlante',  90000,     0,'Activo',  '2026-03-22 10:00:00'),
    (3,1,'Ajeno', 5,NULL,'De otro',  999999,     0,'Activo',  '2026-03-23 10:00:00');

  INSERT INTO abonos_prestamo (prestamo_id, valor, fecha) VALUES
    (1, 40000,'2026-05-10 08:00:00'),
    (4, 20000,'2026-06-02 08:00:00'),
    (5,  1000,'2026-04-04 08:00:00'),
    (6, 50000,'2026-05-30 08:00:00'),
    (11,20000,'2026-06-11 08:00:00'),
    (12,15000,'2026-05-01 08:00:00');
`);

console.log('\n═══ 1. SIN parámetros nuevos, nada cambia ═══\n');

const completo = await pedir({});
check('el historial completo sigue llegando entero', completo.length === 13,
  `dio ${completo.length} filas, esperaba 13`);
check('no se cuela ningún préstamo del negocio vecino',
  completo.every((p) => p.nombre_producto !== 'De otro'));

for (const q of [{ persona_id: 'abc' }, { persona_id: '0' }, { persona_id: '-5' },
                 { persona_tipo: 'cliente' }, { vista: 'otra' }, { persona_id: '' }]) {
  const r = await pedir(q);
  check(`un parámetro que no se entiende NO recorta: ${JSON.stringify(q)}`,
    Array.isArray(r) && r.length === 13, `dio ${r?.length}`);
}

// El orden tiene que ser estable: activos primero, luego saldados, luego el
// resto; dentro de eso por fecha. Los tres "Lote" comparten fecha al
// milisegundo y sin desempate Postgres podía barajarlos entre dos cargas.
const orden1 = completo.map((p) => p.id);
const orden2 = (await pedir({})).map((p) => p.id);
checkEq('el orden es estable entre dos llamadas', orden2, orden1);
check('los activos van primero',
  completo.slice(0, 7).every((p) => p.estado === 'Activo'));

console.log('\n═══ 2. El resumen == la agrupación del navegador ═══\n');

const resumen = await pedir({ vista: 'personas' });
const { comp, cli } = agruparComoElNavegador(completo);

check('mismas personas prestatarias', resumen.prestatarios.length === Object.keys(comp).length,
  `${resumen.prestatarios.length} vs ${Object.keys(comp).length}`);
check('mismas personas clientes', resumen.clientes.length === Object.keys(cli).length,
  `${resumen.clientes.length} vs ${Object.keys(cli).length}`);
check('el prestamista sin préstamos NO sale del resumen (lo aporta /prestatarios)',
  !resumen.prestatarios.some((r) => r.nombre === 'Sin Prestamos'));

for (const [tipo, grupos, filas] of [['prestatario', comp, resumen.prestatarios],
                                     ['cliente', cli, resumen.clientes]]) {
  for (const f of filas) {
    const g = grupos[`${tipo}_${f.persona_id}`];
    const t = tarjeta(g);
    const iguales = g.nombre === f.nombre
      && Number(f.saldo_total)     === g.saldoTotal
      && Number(f.saldo_a_favor)   === g.saldoAFavor
      && iso(f.ultimo_abono)       === iso(g.ultimoAbono)
      && Number(f.n_activos)       === t.nActivos
      && Number(f.n_cerrados)      === t.nCerrados
      && Number(f.valor_activos)   === t.valor
      && Number(f.abonado_activos) === t.abonado
      && (tipo !== 'cliente' || (f.celular || '') === g.celular);
    check(`${f.nombre}: las 8 cifras de la tarjeta coinciden`, iguales,
      `resumen=${JSON.stringify(f)} navegador=${JSON.stringify({ ...t, nombre: g.nombre, saldoTotal: g.saldoTotal, saldoAFavor: g.saldoAFavor, ultimoAbono: g.ultimoAbono })}`);
  }
}

// El caso que un `<> 'Activo'` habría perdido en silencio.
const ana = resumen.prestatarios.find((r) => r.nombre === 'Ana');
check('el préstamo con estado NULL cuenta como CERRADO, no desaparece',
  Number(ana.n_activos) + Number(ana.n_cerrados) === 5,
  `${ana.n_activos} activos + ${ana.n_cerrados} cerrados`);
check('el saldo de Ana suma sus dos sucursales (Centro y Norte)',
  Number(ana.saldo_total) === 120000, `dio ${ana.saldo_total}`);
check('el resumen no arrastra ningún costo', !JSON.stringify(resumen).includes('costo'));

console.log('\n═══ 3. El filtro por persona da el MISMO subconjunto ═══\n');

for (const [tipo, grupos] of [['prestatario', comp], ['cliente', cli]]) {
  for (const key of Object.keys(grupos)) {
    const id = Number(key.split('_')[1]);
    const soloEsa  = await pedir({ persona_tipo: tipo, persona_id: String(id) });
    const esperado = completo.filter((p) => (tipo === 'cliente' ? p.cliente_id : p.prestatario_id) === id);
    checkEq(`${grupos[key].nombre}: mismas filas, mismo orden, mismas claves`, soloEsa, esperado);
  }
}

console.log('\n═══ 4. anotarLista no cambia de forma según el conjunto ═══\n');

const clavesDe = (p) => Object.keys(p).sort().join(',');
check('todas las filas del historial traen las mismas claves',
  new Set(completo.map(clavesDe)).size === 1);

// Se le pone plazo a UN préstamo de Ana: el negocio pasa a tener cargos. Los de
// Beto siguen sin plazo, y antes eso les cambiaba la forma según si se pedía el
// negocio entero o solo a Beto.
await db.exec(`UPDATE prestamos SET fecha_limite = '2026-04-01',
  mora_condicion = '{"id":"normal","nombre":"Normal","tipo":"mensual","valor":2,"dias_gracia":0}'::jsonb
  WHERE id = 1;`);

const conCargos  = await pedir({});
const soloBeto   = await pedir({ persona_tipo: 'prestatario', persona_id: '2' });
const betoEnTodo = conCargos.filter((p) => p.prestatario_id === 2);
checkEq('con un plazo en el negocio, los préstamos SIN plazo llegan igual filtrados que completos',
  soloBeto, betoEnTodo);
check('las claves siguen siendo las mismas para todos',
  new Set(conCargos.map(clavesDe)).size === 1);
check('el préstamo con plazo sí trae la mora resuelta',
  conCargos.find((p) => p.id === 1).mora.aplica === true);
check('los demás siguen con mora.aplica = false',
  conCargos.filter((p) => p.id !== 1).every((p) => p.mora.aplica === false));
check('total_a_pagar llega siempre, con o sin cargos pactados',
  conCargos.every((p) => p.total_a_pagar != null));

console.log('\n═══ 5. El recorte no se salta el aislamiento ═══\n');

const desdeVecino = await pedir({ persona_tipo: 'prestatario', persona_id: '1' }, 2);
check('pedir a Ana desde el negocio vecino no devuelve nada', desdeVecino.length === 0,
  `dio ${desdeVecino.length}`);
const resumenVecino = await pedir({ vista: 'personas' }, 2);
check('el resumen del vecino solo trae a su gente',
  resumenVecino.prestatarios.length === 1 && resumenVecino.prestatarios[0].nombre === 'Ajeno');
check('el vecino no ve a nadie del negocio 1',
  !JSON.stringify(resumenVecino).includes('Ana'));

console.log('\n═══ 6. El respaldo de despliegue del frontend no se separa del backend ═══\n');

// Vercel y Railway se despliegan por separado, así que hay una ventana en la que
// el frontend nuevo habla con el backend viejo: ese ignora `?vista=personas` y
// responde el historial completo. `adaptarResumenPersonas` lo agrupa en el
// navegador para que la pantalla no salga vacía. Aquí se extrae la función REAL
// del archivo (es JS puro, sin JSX) y se comprueba que dé lo MISMO que el SQL.
// Sin esto el respaldo se separa del backend en el primer cambio, y nadie se
// entera hasta el despliegue siguiente — que es cuando ya no sirve.
const PAGINA = path.join(RAIZ, '../frontend/src/pages/prestamos/PrestamosPage.jsx');
const fuente = readFileSync(PAGINA, 'utf8');
const desde  = fuente.indexOf('function adaptarResumenPersonas(');
check('la pantalla todavía trae el respaldo de despliegue', desde !== -1);

if (desde !== -1) {
  let prof = 0, hasta = desde;
  for (let i = fuente.indexOf('{', desde); i < fuente.length; i++) {
    if (fuente[i] === '{') prof++;
    else if (fuente[i] === '}') { prof--; if (prof === 0) { hasta = i + 1; break; } }
  }
  const adaptar = new Function(`${fuente.slice(desde, hasta)}; return adaptarResumenPersonas;`)();

  const norm = (f) => ({
    persona_id: Number(f.persona_id), nombre: f.nombre ?? null, celular: f.celular ?? null,
    saldo_a_favor: Number(f.saldo_a_favor ?? 0),
    ultimo_abono: f.ultimo_abono == null ? null : new Date(f.ultimo_abono).toISOString(),
    n_activos: Number(f.n_activos), n_cerrados: Number(f.n_cerrados),
    valor_activos: Number(f.valor_activos), abonado_activos: Number(f.abonado_activos),
    saldo_total: Number(f.saldo_total),
    // Los vencidos de la tarjeta (aviso «N cobros vencidos»): el respaldo los
    // cuenta en el navegador y tiene que dar lo mismo que el SQL.
    n_vencidos: Number(f.n_vencidos ?? 0), dias_vencido_max: Number(f.dias_vencido_max ?? 0),
  });
  const porId = (a) => [...a].map(norm).sort((x, y) => x.persona_id - y.persona_id);

  const delBackend = await pedir({ vista: 'personas' });
  const delViejo   = adaptar(conCargos);
  // Sin un vencido en los datos, la comparación de vencidos pasaría en vacío.
  // Ana tiene el préstamo 1 con fecha límite 2026-04-01 (sección 4).
  const anaVencidos = delBackend.prestatarios.find((r) => r.nombre === 'Ana');
  check('el resumen cuenta el préstamo vencido de Ana',
    Number(anaVencidos?.n_vencidos) >= 1 && Number(anaVencidos?.dias_vencido_max) > 0,
    JSON.stringify(anaVencidos));
  for (const clave of ['prestatarios', 'clientes']) {
    checkEq(`respaldo == resumen del backend (${clave})`,
      porId(delViejo[clave]), porId(delBackend[clave]));
  }
  check('con la respuesta NUEVA el respaldo la deja pasar tal cual',
    adaptar(delBackend) === delBackend);
}

console.log('\n──────────────────────────────────────────────────────────────');
console.log(fallos ? `✗ ${fallos} FALLARON · ${pasados} pasaron`
                   : `✓ TODO OK — ${pasados} verificaciones`);
process.exit(fallos ? 1 : 0);
