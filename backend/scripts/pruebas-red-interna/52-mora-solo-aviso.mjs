// ─────────────────────────────────────────────────────────────────────────────
// MORA EN 0 — una condición de SOLO AVISO
//
// Pedido del negocio (sep-2026): poder crear una condición de mora con valor 0.
// El crédito o préstamo tiene fecha límite, se marca vencido y entra en el aviso
// de «cobros vencidos», pero nunca se le suma un peso de mora.
//
// Lo que esta prueba sostiene, en orden de importancia:
//
//   1. QUE LAS CONDICIONES CON COBRO NO CAMBIEN. Aceptar el 0 tocó el mismo
//      normalizador que usan todas; una de 2% tiene que dar exactamente lo mismo.
//   2. Que VACÍO no sea 0: Number(null) y Number('') dan 0, y una condición sin
//      valor se volvería de solo aviso sin que nadie lo decidiera.
//   3. Que el INTERÉS no se pierda: con 'sustituye' el interés se corta al
//      vencerse para dejarle el lugar a la mora. Sin mora que lo sustituya, el
//      cliente atrasado dejaría de pagar interés sin pagar mora. Debe seguir.
//   4. Que el documento aparezca en el aviso de cobros vencidos, sin mora.
//
//   node scripts/pruebas-red-interna/52-mora-solo-aviso.mjs
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

const moraUtil    = require(path.join(RAIZ, 'src/utils/mora.util.js'));
const moraService = require(path.join(RAIZ, 'src/modules/mora/mora.service.js'));
const alertas     = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.alertas.js'));
const obligacion  = require(path.join(RAIZ, 'src/utils/obligacion.js'));
const front       = await import(pathToFileURL(path.join(FRONT, 'utils/mora.js')).href);

const { normalizarCondicion, calcularMoraCausada, resolverEstadoMora, leerConfigMora } = moraUtil;

const HOY = moraUtil.hoyBogota();
const dia = (n) => {
  const [y, m, d] = HOY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const AVISO  = { id: 'aviso', nombre: 'Solo aviso', tipo: 'mensual', valor: 0 };
const NORMAL = { id: 'normal', nombre: 'Normal', tipo: 'mensual', valor: 2, dias_gracia: 0 };

// ═══════════════════════════════════════════════════════════════════════════
seccion('1. Las condiciones CON cobro siguen exactamente igual');
// ═══════════════════════════════════════════════════════════════════════════
const normal = normalizarCondicion(NORMAL);
check('★★ una de 2% normaliza igual que siempre', normal,
  { id: 'normal', nombre: 'Normal', tipo: 'mensual', valor: 2, dias_gracia: 0, tope_pct: null, color: 'amber' });
check('★★ y cobra lo mismo: 100.000 × 2% × 30 días = 2.000',
  calcularMoraCausada({ saldo: 100000, fecha_limite: dia(-30), condicion: NORMAL, hoy: HOY }), 2000);
check('su tope se sigue respetando',
  normalizarCondicion({ ...NORMAL, tope_pct: 5 }).tope_pct, 5);
check('su estado no es de solo aviso',
  resolverEstadoMora({ saldo: 100000, fecha_limite: dia(-30), condicion: NORMAL, hoy: HOY }).solo_aviso, false);

// ═══════════════════════════════════════════════════════════════════════════
seccion('2. El 0 se acepta; lo vacío y lo negativo, no');
// ═══════════════════════════════════════════════════════════════════════════
check('★ valor 0 es una condición válida', normalizarCondicion(AVISO)?.valor, 0);
check('★ valor "0" (texto) también', normalizarCondicion({ ...AVISO, valor: '0' })?.valor, 0);
check('★★ sin valor NO es solo aviso', normalizarCondicion({ nombre: 'X', tipo: 'mensual' }), null);
check('★★ valor null NO es solo aviso', normalizarCondicion({ ...AVISO, valor: null }), null);
check('★★ valor "" NO es solo aviso', normalizarCondicion({ ...AVISO, valor: '' }), null);
check('negativo sigue siendo inválido', normalizarCondicion({ ...AVISO, valor: -1 }), null);
check('en 0 el tope no tiene sentido y se descarta',
  normalizarCondicion({ ...AVISO, tope_pct: 10 }).tope_pct, null);
check('una lista con solo la condición en 0 enciende la feature',
  leerConfigMora({ mora_activa: '1', mora_lista: JSON.stringify([AVISO]) }).activa, true);
check('la descripción lo dice en palabras',
  moraUtil.describirCondicion(normalizarCondicion(AVISO)), 'Sin cobro de mora (solo aviso de vencimiento)');
check('también la de los documentos', obligacion.describirCondicion(AVISO),
  'Sin cobro de mora (solo aviso de vencimiento)');

// El navegador lee las mismas condiciones con su propio parser: si rechazara el
// 0, Ajustes guardaría una condición que el selector del POS no mostraría.
const lista = JSON.stringify([AVISO, NORMAL, { id: 'vacia', nombre: 'Vacía', tipo: 'mensual', valor: '' }]);
check('★ el navegador acepta la de 0 y descarta la vacía, igual que el backend',
  front.parsearCondiciones(lista).map((c) => c.id),
  moraUtil.parsearCondiciones(lista).map((c) => c.id));
check('el navegador la reconoce como solo aviso', front.esSoloAviso(front.parsearCondiciones(lista)[0]), true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('3. Vencido, sin mora');
// ═══════════════════════════════════════════════════════════════════════════
const est = resolverEstadoMora({ saldo: 100000, fecha_limite: dia(-40), condicion: AVISO, hoy: HOY });
check('★ se marca vencido', est.vencido, true);
check('★ con 40 días de atraso', est.dias_vencidos, 40);
check('★★ sin un peso de mora', [est.causada, est.pendiente], [0, 0]);
check('lo que se debe es solo el capital', est.total_a_pagar, 100000);
check('y avisa que es solo aviso', est.solo_aviso, true);
check('★ con el capital pagado no queda abierto por una mora que no existe',
  resolverEstadoMora({ saldo: 0, fecha_limite: dia(-40), condicion: AVISO, hoy: HOY }).solo_falta_mora, false);
check('la pantalla lo pinta como vencido, en rojo',
  front.estadoVisual(est)?.tono, 'rojo');

// ═══════════════════════════════════════════════════════════════════════════
seccion('4. El interés NO se pierde al vencerse');
// ═══════════════════════════════════════════════════════════════════════════
// Dos préstamos idénticos: 100.000 al 3% mensual, entregados hace 60 días, con
// fecha límite hace 30 y plan 'sustituye'. Uno con mora de 2%, otro solo aviso.
const PLAN = { id: 'fin3', nombre: 'Financiación 3%', tipo: 'porcentaje', valor: 3,
  periodicidad: 'mensual', devengo: 'diario', base: 'saldo', inicia_tras_dias: 0, al_vencer: 'sustituye' };
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Grande');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO prestatarios (negocio_id, nombre, telefono) VALUES (1,'Ana','300'), (1,'Beto','301');
`);
await db.query(`
  INSERT INTO prestamos (sucursal_id, usuario_id, prestatario, prestatario_id, nombre_producto,
                         valor_prestamo, total_abonado, estado, fecha, fecha_limite,
                         mora_condicion, interes_condicion)
  VALUES
    (1,1,'Ana', 1,'Con mora',   100000, 0,'Activo', $1, $2, $3::jsonb, $5::jsonb),
    (1,1,'Beto',2,'Solo aviso', 100000, 0,'Activo', $1, $2, $4::jsonb, $5::jsonb)
`, [`${dia(-60)} 12:00:00`, dia(-30), JSON.stringify(normal),
    JSON.stringify(normalizarCondicion(AVISO)), JSON.stringify(PLAN)]);

const { rows } = await db.query(`SELECT * FROM prestamos ORDER BY id`);
const [conMora, soloAviso] = await moraService.anotarLista(rows, 'prestamo');

check('con mora: el interés se detiene al vencerse (como siempre)', conMora.interes.detenido_por_mora, true);
check('con mora: interés de 30 días = 3.000', conMora.interes.causado, 3000);
check('con mora: y corre la mora de 30 días = 2.000', conMora.mora.causada, 2000);
check('★★ solo aviso: el interés NO se detiene', soloAviso.interes.detenido_por_mora, false);
check('★★ solo aviso: interés de los 60 días = 6.000', soloAviso.interes.causado, 6000);
check('★ solo aviso: sin mora', soloAviso.mora.causada, 0);
check('solo aviso: debe capital + interés', soloAviso.total_a_pagar, 106000);

// ═══════════════════════════════════════════════════════════════════════════
seccion('5. Entra en el aviso de cobros vencidos');
// ═══════════════════════════════════════════════════════════════════════════
const cartera = await alertas.cartera(1);
const beto = cartera.vencidos.items.find((i) => i.persona === 'Beto');
check('★ el préstamo de solo aviso sale como vencido', !!beto, true);
check('★ con sus 30 días de atraso', beto?.dias_vencidos, 30);
check('sin mora en lo que se le cobra', beto?.mora, 0);
check('pero con el interés que sí debe', beto?.interes, 6000);

// ═══════════════════════════════════════════════════════════════════════════
seccion('6. Las pantallas lo permiten y lo explican');
// ═══════════════════════════════════════════════════════════════════════════
const moraConfig = readFileSync(path.join(FRONT, 'pages/configuracion/MoraConfig.jsx'), 'utf8');
const panel      = readFileSync(path.join(FRONT, 'components/ui/PanelMora.jsx'), 'utf8');
const avisoPdf   = readFileSync(path.join(RAIZ, 'src/utils/obligacion.pdf.js'), 'utf8');
check('★ Ajustes ya no exige un valor mayor a 0', moraConfig.includes('El valor debe ser mayor a 0'), false);
check('Ajustes explica para qué sirve el 0', moraConfig.includes('solo un aviso'), true);
check('el panel de mora no pinta cifras en $0 con solo aviso', panel.includes('soloAviso ? ('), true);
check('el aviso de mora impreso no lista intereses de mora en $0',
  avisoPdf.includes("if (!soloAviso || moraPendiente > 0) detalle.push(['Intereses de mora causados'"), true);

console.log(`\n${pasados} verificaciones pasaron · ${fallos} fallaron`);
process.exit(fallos ? 1 : 0);
