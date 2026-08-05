// ─────────────────────────────────────────────────────────────────────────────
// INTERÉS CORRIENTE — integración contra un Postgres real (PGlite/WASM).
//
// La suite 14 prueba la fórmula; esta prueba EL CABLEADO: que el pacto se
// congele en el documento, que el estado se derive al leer, que el abono reparta
// en tres cubetas, que el cobro y la condonación escriban con el `concepto`
// correcto, y que el documento no se cierre mientras quede interés.
//
// Ejercita los services VERDADEROS de créditos y préstamos. Lo que más puede
// doler si se rompe:
//
//   · El interés NUNCA entra en `total_abonado` (si entrara, los reportes lo
//     contarían como utilidad del producto — el riesgo #1 del diseño de mora,
//     que aplica igual aquí).
//   · Sin `interes_condicion` no hay interés: la cartera que ya existe no
//     cambia al activar la feature (aditividad).
//   · Mora e interés son INDEPENDIENTES: se puede tener uno sin el otro.
//   · La obligación no se salda con interés pendiente.
//   · El plan pactado queda CONGELADO: subir la tasa no afecta lo otorgado.
//
// Requiere PGlite (no va en package.json a propósito):
//   pnpm add @electric-sql/pglite --config.package-manager-strict=false
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

await db.exec(`
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_label VARCHAR;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_label VARCHAR;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_id    INTEGER;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_id    INTEGER;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS prestamo_id          INTEGER;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS tipo_retoma          TEXT;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS producto_serial_id   INTEGER;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS producto_cantidad_id INTEGER;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS sucursal_id          INTEGER;
  -- El estado de cuenta une retomas, saldos y movimientos; el esquema de
  -- pruebas está recortado y le faltan estas columnas.
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS fecha        TIMESTAMP DEFAULT NOW();
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS tipo_persona TEXT;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS persona_id   INTEGER;
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

const creditos     = require(path.join(RAIZ, 'src/modules/creditos/creditos.service.js'));
const creditosRepo = require(path.join(RAIZ, 'src/modules/creditos/creditos.repository.js'));
const prestamos    = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'));
const moraService  = require(path.join(RAIZ, 'src/modules/mora/mora.service.js'));
const moraUtil     = require(path.join(RAIZ, 'src/utils/mora.util.js'));
const bcrypt       = require('bcryptjs');

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));
const check = (nombre, real, esperado) => {
  const ok = Math.abs(Number(real || 0) - Number(esperado || 0)) < 1;
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${money(real)}${ok ? '' : `  ← esperaba ${money(esperado)}`}`);
  ok ? pasados++ : fallos++;
};
const checkEq = (nombre, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok ? '' : ` ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
};
const debeFallar = async (nombre, fn, fragmento) => {
  try { await fn(); console.log(`  ✗ ${nombre}: NO falló`); fallos++; }
  catch (e) {
    const ok = !fragmento || String(e.message || '').toLowerCase().includes(fragmento.toLowerCase());
    console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${e.status || ''} ${String(e.message || '').slice(0, 70)}`);
    ok ? pasados++ : fallos++;
  }
};

const hoy = moraUtil.hoyBogota();
const diasAtras = (n) => {
  const [y, m, d] = hoy.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

// ── Datos base ──────────────────────────────────────────────────────────────
const PIN = '4321';
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con Interes'), ('Sin Nada');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal'),(2,'Otra');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Vendedor');
  INSERT INTO config_negocio VALUES
    (1,'interes_activa','1'),
    (1,'interes_lista','[
      {"id":"fin2","nombre":"Financiación 2%","tipo":"porcentaje","valor":2,"periodicidad":"mensual","devengo":"diario","base":"saldo","inicia_tras_dias":0},
      {"id":"esc2","nombre":"Escalón 2% del total","tipo":"porcentaje","valor":2,"periodicidad":"mensual","devengo":"periodo_cumplido","base":"valor_original","inicia_tras_dias":0},
      {"id":"sem1","nombre":"Semanal 1%","tipo":"porcentaje","valor":1,"periodicidad":"semanal","devengo":"periodo_cumplido","base":"saldo","inicia_tras_dias":0}
    ]'),
    (1,'interes_default_id','fin2'),
    (1,'mora_activa','1'),
    (1,'mora_lista','[{"id":"normal","nombre":"Normal","tipo":"mensual","valor":3,"dias_gracia":0}]'),
    (1,'mora_default_id','normal'),
    (1,'pin_eliminacion','${bcrypt.hashSync(PIN, 4)}');
  INSERT INTO productos_serial (nombre, precio, sucursal_id) VALUES ('Equipo', 1000000, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (1,'IMEI-A',600000),(1,'IMEI-B',600000);
  INSERT INTO clientes (negocio_id, nombre, cedula) VALUES (1,'Cliente','111');
  INSERT INTO prestatarios (negocio_id, nombre, cedula) VALUES (1,'Prestatario','222');
`);

// ═══ 1. Aditividad: sin pacto de interés no pasa nada ═══════════════════════
console.log('\n═══ 1. Un crédito SIN interés pactado no causa nada ═══');
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 1, 'Cliente', 'Credito', NOW() - INTERVAL '60 days');
  INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio)
    VALUES (1, 'Equipo', 1, 1000000);
`);
{
  const client = await pool.connect();
  await creditosRepo.create(client, {
    factura_id: 1, cliente_id: 1, sucursal_id: 1, valor_total: 1000000, cuota_inicial: 200000,
  });
  await db.query(`UPDATE creditos SET creado_en = NOW() - INTERVAL '60 days' WHERE id = 1`);
}
let cred = await creditos.getCreditoById(1, 1);
checkEq('interes.aplica = false',  cred.interes.aplica, false);
check('interés causado = 0',       cred.interes.causado, 0);
check('interés pendiente = 0',     cred.interes.pendiente, 0);
checkEq('mora tampoco (sin plazo)', cred.mora.aplica, false);

const ab0 = await creditos.registrarAbono(1, 1, { usuario_id: 1, valor: 100000, metodo: 'Efectivo' });
check('el abono va entero a capital', ab0.abonado_capital, 100000);
check('nada a interés',               ab0.abonado_interes, 0);

// ═══ 2. Interés sin plazo: se puede tener uno sin el otro ══════════════════
console.log('\n═══ 2. Interés SIN fecha límite (deuda abierta que causa interés) ═══');
await creditos.fijarInteres(1, 1, { plan_id: 'fin2', desde: hoy, rol: 'admin_negocio' });
// El interés corre desde HOY (fijarInteres nunca aplica hacia atrás), así que
// todavía no ha causado nada: es la garantía de que activar la feature sobre
// cartera vieja no inventa deudas.
cred = await creditos.getCreditoById(1, 1);
checkEq('★ interés pactado y activo', cred.interes.aplica, true);
check('★ pero sin causar nada todavía (no es retroactivo)', cred.interes.causado, 0);
checkEq('★ y sigue SIN mora: son independientes', cred.mora.aplica, false);
checkEq('el plan quedó congelado en el documento', cred.interes_condicion?.id, 'fin2');

await debeFallar('no deja poner el interés a correr hacia atrás',
  () => creditos.fijarInteres(1, 1, { plan_id: 'fin2', desde: diasAtras(30), rol: 'admin_negocio' }),
  'antes de hoy');

// ═══ 3. Préstamo que nace con interés: causación real ══════════════════════
console.log('\n═══ 3. Préstamo con 2% mensual, entregado hace 60 días ═══');
const [p1] = await prestamos.crearPrestamos({
  sucursal_id: 1, usuario_id: 1, negocio_id: 1,
  prestatario: 'Prestatario', cedula: '222', prestatario_id: 1,
  items: [{ imei: 'IMEI-A', nombre_producto: 'Equipo', valor_prestamo: 1000000 }],
  interes_plan_id: 'fin2',
});
checkEq('★ el préstamo nació con el plan congelado', p1.interes_condicion?.id, 'fin2');
checkEq('y SIN fecha límite (no se pidió)', p1.fecha_limite, null);

// Se envejece el préstamo 60 días para que cause interés.
await db.query(`UPDATE prestamos SET fecha = NOW() - INTERVAL '60 days' WHERE id = $1`, [p1.id]);
let est = await moraService.estadoDe('prestamo', p1.id, 1);
check('★ interés causado: 1.000.000 × 2% × 2 meses', est.interes.causado, 40000);
check('interés pendiente',       est.interes.pendiente, 40000);
check('capital intacto',         est.saldo_capital, 1000000);
check('★ total a pagar = capital + interés', est.total_a_pagar, 1040000);
checkEq('sin mora (no tiene plazo)', est.mora.aplica, false);

console.log('\n   → Subir la tasa en Ajustes NO cambia lo ya pactado');
await db.exec(`UPDATE config_negocio SET valor='[{"id":"fin2","nombre":"Financiación","tipo":"porcentaje","valor":20,"periodicidad":"mensual","devengo":"diario","base":"saldo","inicia_tras_dias":0}]' WHERE negocio_id=1 AND clave='interes_lista'`);
est = await moraService.estadoDe('prestamo', p1.id, 1);
check('★ sigue al 2%, no al 20%', est.interes.causado, 40000);
await db.exec(`UPDATE config_negocio SET valor='[
  {"id":"fin2","nombre":"Financiación 2%","tipo":"porcentaje","valor":2,"periodicidad":"mensual","devengo":"diario","base":"saldo","inicia_tras_dias":0},
  {"id":"esc2","nombre":"Escalón 2% del total","tipo":"porcentaje","valor":2,"periodicidad":"mensual","devengo":"periodo_cumplido","base":"valor_original","inicia_tras_dias":0}
]' WHERE negocio_id=1 AND clave='interes_lista'`);

// ═══ 4. Abono en tres cubetas ═════════════════════════════════════════════
console.log('\n═══ 4. Abono: mora → interés → capital ═══');
const abP = await prestamos.registrarAbono(1, p1.id, 100000, 'Efectivo', 1, null, { modo: 'mora_capital' });
check('★ a interés (se cubre primero)', abP.abonado_interes, 40000);
check('★ a capital (el resto)',         abP.abonado_capital, 60000);
check('a mora (no tiene)',              abP.abonado_mora, 0);

const totalAbonadoDb = Number((await q(`SELECT total_abonado FROM prestamos WHERE id=$1`, [p1.id]))[0].total_abonado);
check('★★ total_abonado NO incluye el interés (si no, sería utilidad del producto)',
  totalAbonadoDb, 60000);
const interesEnTabla = Number((await q(
  `SELECT COALESCE(SUM(valor),0) v FROM movimientos_mora WHERE prestamo_id=$1 AND concepto='interes' AND tipo='Cobro' AND NOT anulado`,
  [p1.id]))[0].v);
check('★ el interés vive en movimientos_mora con concepto=interes', interesEnTabla, 40000);

est = await moraService.estadoDe('prestamo', p1.id, 1);
check('interés pendiente tras el abono', est.interes.pendiente, 0);
check('capital tras el abono',           est.saldo_capital, 940000);

// ═══ 5. Modo solo_capital deja el interés pendiente ═══════════════════════
console.log('\n═══ 5. Modo "solo capital": el interés queda debiéndose ═══');
await db.query(`UPDATE prestamos SET fecha = NOW() - INTERVAL '90 days' WHERE id = $1`, [p1.id]);
est = await moraService.estadoDe('prestamo', p1.id, 1);
const interesAntes = est.interes.pendiente;
console.log(`     (interés pendiente acumulado: ${money(interesAntes)})`);
const abSolo = await prestamos.registrarAbono(1, p1.id, 40000, 'Efectivo', 1, null, { modo: 'solo_capital' });
check('todo fue a capital',      abSolo.abonado_capital, 40000);
check('★ nada al interés',       abSolo.abonado_interes, 0);
est = await moraService.estadoDe('prestamo', p1.id, 1);
check('★ el interés sigue pendiente (no se condonó)', est.interes.pendiente > 0 ? 1 : 0, 1);

// ═══ 6. No se cierra con interés pendiente ════════════════════════════════
console.log('\n═══ 6. La obligación no se salda mientras quede interés ═══');
est = await moraService.estadoDe('prestamo', p1.id, 1);
const capitalRestante = est.saldo_capital;
const abFin = await prestamos.registrarAbono(1, p1.id, capitalRestante, 'Efectivo', 1, null, { modo: 'solo_capital' });
checkEq('★ NO se saldó: falta el interés', abFin.saldado, false);
checkEq('★ y lo avisa con solo_falta_mora', abFin.solo_falta_mora, true);
const estadoDb = (await q(`SELECT estado FROM prestamos WHERE id=$1`, [p1.id]))[0].estado;
checkEq('el préstamo sigue Activo', estadoDb, 'Activo');

est = await moraService.estadoDe('prestamo', p1.id, 1);
check('capital en cero', est.saldo_capital, 0);
console.log(`     (falta cobrar ${money(est.interes.pendiente)} de interés)`);

const cobro = await prestamos.cobrarMora(1, p1.id, {
  valor: null, metodo: 'Efectivo', usuario_id: 1, concepto: 'interes',
});
checkEq('★ al cobrar el interés SÍ se salda', cobro.saldado, true);
const estadoFinal = (await q(`SELECT estado FROM prestamos WHERE id=$1`, [p1.id]))[0].estado;
checkEq('y el préstamo queda Saldado', estadoFinal, 'Saldado');

// ═══ 7. Escalón sobre el valor total ══════════════════════════════════════
console.log('\n═══ 7. Escalón: "pasa el mes y sube 2% del total, de una sola vez" ═══');
const [p2] = await prestamos.crearPrestamos({
  sucursal_id: 1, usuario_id: 1, negocio_id: 1,
  prestatario: 'Prestatario', cedula: '222', prestatario_id: 1,
  items: [{ imei: 'IMEI-B', nombre_producto: 'Equipo', valor_prestamo: 1000000 }],
  interes_plan_id: 'esc2',
});
const interesAl = async (dias) => {
  await db.query(`UPDATE prestamos SET fecha = NOW() - ($1 || ' days')::interval WHERE id = $2`, [dias, p2.id]);
  return (await moraService.estadoDe('prestamo', p2.id, 1)).interes.causado;
};
check('día 29 — todavía no cobra',  await interesAl(29),      0);
check('★ día 30 — sube de una vez', await interesAl(30), 20000);
check('día 45 — no sigue subiendo', await interesAl(45), 20000);
check('día 60 — segundo escalón',   await interesAl(60), 40000);

// ═══ 8. Interés Y mora juntos, con sustitución ════════════════════════════
console.log('\n═══ 8. Los dos cargos a la vez (interés 2% + mora 3%) ═══');
await moraService.fijarPlazo(1, 'prestamo', p2.id, {
  fecha_limite: hoy, condicion_id: 'normal', rol: 'admin_negocio',
});
// El préstamo tiene 60 días de antigüedad y vence HOY, así que el interés corrió
// los 60 días completos y la mora aún no arranca.
est = await moraService.estadoDe('prestamo', p2.id, 1);
check('★ interés por los 60 días (2 escalones)', est.interes.causado, 40000);
check('mora todavía en 0 (vence hoy)',           est.mora.causada, 0);
checkEq('los dos cargos conviven en el documento',
  [est.interes.aplica, est.mora.aplica], [true, true]);
check('★ total a pagar = capital + interés',     est.total_a_pagar, 1040000);

// ═══ 9. Condonar interés, sin tocar la mora ═══════════════════════════════
console.log('\n═══ 9. Condonar el interés (admin + motivo + PIN) ═══');
await debeFallar('un vendedor no puede condonar',
  () => moraService.condonar(1, 'prestamo', p2.id, {
    motivo: 'porque sí', pin: PIN, usuario_id: 2, rol: 'vendedor', concepto: 'interes',
  }), 'administrador');
await debeFallar('exige PIN correcto',
  () => moraService.condonar(1, 'prestamo', p2.id, {
    motivo: 'cliente antiguo', pin: '0000', usuario_id: 1, rol: 'admin_negocio', concepto: 'interes',
  }), 'PIN');
await debeFallar('exige motivo',
  () => moraService.condonar(1, 'prestamo', p2.id, {
    motivo: '', pin: PIN, usuario_id: 1, rol: 'admin_negocio', concepto: 'interes',
  }), 'motivo');

const cond = await moraService.condonar(1, 'prestamo', p2.id, {
  valor: 15000, motivo: 'Cliente de años', pin: PIN, usuario_id: 1,
  rol: 'admin_negocio', concepto: 'interes',
});
check('★ interés pendiente tras condonar 15.000', cond.interes.pendiente, 25000);
const condDb = await q(
  `SELECT concepto, valor, motivo FROM movimientos_mora WHERE prestamo_id=$1 AND tipo='Condonacion'`,
  [p2.id]);
checkEq('★ quedó registrada como condonación de interés',
  [condDb[0]?.concepto, Number(condDb[0]?.valor), condDb[0]?.motivo],
  ['interes', 15000, 'Cliente de años']);

// `quitar_interes` apaga el cargo hacia adelante (condonar solo no lo detiene).
await moraService.condonar(1, 'prestamo', p2.id, {
  motivo: 'Se le perdona todo', pin: PIN, usuario_id: 1,
  rol: 'admin_negocio', concepto: 'interes', quitar_interes: true,
});
est = await moraService.estadoDe('prestamo', p2.id, 1);
checkEq('★ con quitar_interes el pacto se apaga', est.interes.aplica, false);
check('y no vuelve a causar', est.interes.causado, 0);

// ═══ 10. Negocio SIN la feature ═══════════════════════════════════════════
console.log('\n═══ 10. Negocio con interes_activa=0: nada cambia ═══');
const cfgApagada = await moraService.getConfigInteres(2);
checkEq('config apagada', cfgApagada.activa, false);
const datos = await moraService.datosParaNuevoDocumento(2, { interes_plan_id: 'fin2' });
checkEq('★ un plan pedido con la feature apagada se ignora', datos.interes_condicion, null);

// ═══ 10b. El estado de cuenta no puede llamarle "mora" al interés ═════════
//
// Bug real: la consulta del estado de cuenta etiquetaba TODA fila de
// movimientos_mora como 'mora_cobro'/'mora_condonacion' sin mirar `concepto`,
// así que un cobro de interés le decía al cliente que se había atrasado cuando
// no lo hizo. Los totales estaban bien; la etiqueta mentía.
//
// Y lo que más duele si se rompe: los tipos nuevos tienen que estar en el Set
// INFORMATIVOS del service. Si no, el interés entra al saldo acumulado y el
// estado de cuenta muestra una deuda que no existe.
console.log('\n═══ 10b. Estado de cuenta: el interés se etiqueta como interés ═══');

const cuenta = await prestamos.getEstadoCuenta(1, 'prestatario', 1, 1);
const tiposCuenta = cuenta.map((m) => m.tipo);

const cobrosInteres = cuenta.filter((m) => m.tipo === 'interes_cobro');
const condInteres   = cuenta.filter((m) => m.tipo === 'interes_condonacion');

check('★ el cobro de interés sale como interes_cobro', cobrosInteres.length > 0, true);
check('★ y la condonación como interes_condonacion',   condInteres.length > 0, true);
console.log(`     (tipos en la cuenta: ${[...new Set(tiposCuenta)].join(', ')})`);

// Ninguna fila de interés puede estar rotulada como mora.
const interesComoMora = cuenta.filter(
  (m) => (m.tipo === 'mora_cobro' || m.tipo === 'mora_condonacion')
      && /inter[ée]s/i.test(String(m.concepto || ''))
);
check('★ ninguna fila de interés quedó rotulada como mora', interesComoMora.length, 0);

// El concepto legible tiene que hablar de financiación, no de atraso.
const textoOk = cobrosInteres.every((m) => /financiaci[óo]n/i.test(String(m.concepto)));
check('★ el texto dice "financiación", no "mora"', textoOk, true);

// EL INVARIANTE DE PLATA: los cargos son informativos y no mueven el acumulado.
const interesEnSaldo = [...cobrosInteres, ...condInteres].filter((m) => m.saldo != null);
check('★★ el interés NO entra en el saldo acumulado (saldo null)', interesEnSaldo.length, 0);

const moraEnSaldo = cuenta.filter(
  (m) => (m.tipo === 'mora_cobro' || m.tipo === 'mora_condonacion') && m.saldo != null
);
check('★ la mora tampoco (no se rompió al agregar el interés)', moraEnSaldo.length, 0);

// ═══ 11. Invariantes ══════════════════════════════════════════════════════
console.log('\n═══ 11. Invariantes ═══');
const huerfanos = Number((await q(`
  SELECT COUNT(*)::int c FROM movimientos_mora
  WHERE (credito_id IS NULL AND prestamo_id IS NULL)
     OR (credito_id IS NOT NULL AND prestamo_id IS NOT NULL)`))[0].c);
check('★ ningún movimiento sin documento (o con dos)', huerfanos, 0);

const conceptosMalos = Number((await q(
  `SELECT COUNT(*)::int c FROM movimientos_mora WHERE concepto NOT IN ('mora','interes')`))[0].c);
check('★ ningún concepto inválido', conceptosMalos, 0);

const negativos = Number((await q(`SELECT COUNT(*)::int c FROM movimientos_mora WHERE valor <= 0`))[0].c);
check('ningún movimiento con valor <= 0', negativos, 0);

// El invariante que más plata cuesta si se rompe.
const abonosVsInteres = Number((await q(`
  SELECT COALESCE(SUM(ap.valor),0) v FROM abonos_prestamo ap
  JOIN movimientos_mora mm ON mm.abono_prestamo_id = ap.id AND mm.concepto = 'interes'
  WHERE ap.valor <= 0`))[0].v);
check('★ no se crearon abonos en $0 cuando todo fue a interés', abonosVsInteres, 0);

console.log('\n──────────────────────────────────────────────────────────────');
if (fallos === 0) {
  console.log(`✓ TODO OK — ${pasados} verificaciones`);
  process.exit(0);
} else {
  console.log(`✗ ${fallos} FALLO(S) de ${pasados + fallos}`);
  process.exit(1);
}
