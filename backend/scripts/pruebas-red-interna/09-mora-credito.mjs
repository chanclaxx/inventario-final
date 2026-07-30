// ─────────────────────────────────────────────────────────────────────────────
// MORA POR PAGO TARDÍO — contra un Postgres real (PGlite/WASM).
//
// Ejercita los services VERDADEROS de créditos y préstamos. Verifica lo que más
// puede doler si se rompe:
//
//   · La mora NUNCA entra en `total_abonado` (si entrara, los reportes la
//     contarían como utilidad del producto — el riesgo #1 del diseño).
//   · Sin `fecha_limite` no hay mora: los créditos y préstamos que ya existen
//     no cambian al activar la feature (aditividad).
//   · Los tres modos de imputación reparten bien y no crean ni pierden plata.
//   · Condonar exige admin + motivo + PIN, y queda visible aparte.
//   · Anular un abono anula en cascada la mora que se cobró dentro de él.
//   · La condición pactada queda CONGELADA: subir la tasa no afecta lo otorgado.
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

// El esquema de pruebas es un recorte y le faltan columnas que sí existen en
// producción y que los repositorios reales de préstamos consultan. Se agregan
// aquí (no en el archivo compartido) para no alterar el resto de suites.
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
`);

await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260730_mora_credito.sql'), 'utf8'));

// PGlite devuelve `affectedRows`; el driver real de `pg` devuelve `rowCount`.
// Varios candados anti-carrera del código dependen de `rowCount` (p. ej.
// "UPDATE seriales SET prestado=true WHERE ... AND prestado=false" y luego
// `if (!rowCount) throw`), así que sin este mapeo la suite falla por el arnés y
// no por el producto.
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

const creditos  = require(path.join(RAIZ, 'src/modules/creditos/creditos.service.js'));
const prestamos = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'));
const creditosRepo = require(path.join(RAIZ, 'src/modules/creditos/creditos.repository.js'));
const moraUtil  = require(path.join(RAIZ, 'src/utils/mora.util.js'));
const bcrypt    = require('bcryptjs');

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

// Fechas relativas a HOY en Bogotá, para que la suite no caduque.
const hoy = moraUtil.hoyBogota();
const diasAtras = (n) => {
  const [y, m, d] = hoy.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};
const enFuturo = (n) => {
  const [y, m, d] = hoy.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// ── Datos base ──────────────────────────────────────────────────────────────
const PIN = '4321';
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con Mora'), ('Sin Mora');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal'),(2,'Otra');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Vendedor');
  INSERT INTO config_negocio VALUES
    (1,'mora_activa','1'),
    (1,'mora_lista','[{"id":"normal","nombre":"Normal","tipo":"mensual","valor":2,"dias_gracia":0},{"id":"suave","nombre":"Suave","tipo":"mensual","valor":1,"dias_gracia":5},{"id":"fija","nombre":"Fija","tipo":"diaria_fija","valor":2000,"dias_gracia":0}]'),
    (1,'mora_default_id','normal'),
    (1,'pin_eliminacion','${bcrypt.hashSync(PIN, 4)}');
  INSERT INTO productos_serial (nombre, precio, sucursal_id) VALUES ('Equipo', 1000000, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (1,'IMEI-A',600000),(1,'IMEI-B',600000);
  INSERT INTO clientes (negocio_id, nombre, cedula) VALUES (1,'Cliente Mora','111');
`);

const ADMIN = { usuario_id: 1, rol: 'admin_negocio' };

// ═══ 1. Un crédito SIN plazo no tiene mora (aditividad) ═════════════════════
console.log('\n═══ 1. Crédito SIN plazo: no tiene mora ═══');
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 1, 'Cliente Mora', 'Credito', NOW() - INTERVAL '60 days');
  INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio)
    VALUES (1, 'Equipo', 1, 1000000);
`);
{
  const client = await pool.connect();
  await creditosRepo.create(client, {
    factura_id: 1, cliente_id: 1, sucursal_id: 1, valor_total: 1000000, cuota_inicial: 200000,
  });
}
let cred = await creditos.getCreditoById(1, 1);
checkEq('mora.aplica = false',   cred.mora.aplica, false);
check('mora pendiente = 0',      cred.mora.pendiente, 0);
check('saldo de capital intacto', Number(cred.valor_total) - Number(cred.cuota_inicial) - Number(cred.total_abonado), 800000);

// Un abono normal se comporta EXACTAMENTE como antes de la feature
const ab1 = await creditos.registrarAbono(1, 1, { usuario_id: 1, valor: 300000, metodo: 'Efectivo' });
check('abono completo va a capital', ab1.abonado_capital, 300000);
check('nada fue a mora',             ab1.abonado_mora, 0);
check('total_abonado del crédito',   ab1.total_abonado, 300000);
await debeFallar('abono mayor al saldo sigue rechazándose',
  () => creditos.registrarAbono(1, 1, { usuario_id: 1, valor: 999999999, metodo: 'Efectivo' }), 'supera');

// ═══ 2. Crédito CON plazo vencido: se causa mora ════════════════════════════
console.log('\n═══ 2. Crédito con plazo vencido hace 30 días, 2% mensual ═══');
await creditos.fijarPlazo(1, 1, { fecha_limite: diasAtras(30), condicion_id: 'normal', rol: 'admin_negocio' });
cred = await creditos.getCreditoById(1, 1);
// La mora se causa sobre el capital que ESTUVO vencido, no sobre el que queda:
// durante los 30 días de atraso se debían 800.000 (1.000.000 − 200.000 inicial);
// el abono de 300.000 se hizo HOY, así que no reduce nada hacia atrás.
//   800.000 × 2% × (30/30) = 16.000
checkEq('mora.aplica = true',  cred.mora.aplica, true);
check('dias vencidos',         cred.mora.dias_vencidos, 30);
check('★ mora causada = 2% de los 800.000 que estuvieron vencidos', cred.mora.causada, 16000);
check('mora pendiente',        cred.mora.pendiente, 16000);
checkEq('condición congelada en el documento', cred.mora_condicion?.id, 'normal');

console.log('\n   → Subir la tasa en Ajustes NO cambia lo ya pactado');
await db.exec(`UPDATE config_negocio SET valor='[{"id":"normal","nombre":"Normal","tipo":"mensual","valor":20,"dias_gracia":0}]' WHERE negocio_id=1 AND clave='mora_lista'`);
cred = await creditos.getCreditoById(1, 1);
check('★ sigue calculando al 2%, no al 20%', cred.mora.causada, 16000);
await db.exec(`UPDATE config_negocio SET valor='[{"id":"normal","nombre":"Normal","tipo":"mensual","valor":2,"dias_gracia":0},{"id":"suave","nombre":"Suave","tipo":"mensual","valor":1,"dias_gracia":5},{"id":"fija","nombre":"Fija","tipo":"diaria_fija","valor":2000,"dias_gracia":0}]' WHERE negocio_id=1 AND clave='mora_lista'`);

// ═══ 3. Los tres modos de imputación ════════════════════════════════════════
console.log('\n═══ 3. Modo "mora y capital": paga primero los intereses ═══');
const ab2 = await creditos.registrarAbono(1, 1, { usuario_id: 1, valor: 100000, metodo: 'Efectivo', modo: 'mora_capital' });
check('a mora',    ab2.abonado_mora, 16000);
check('a capital', ab2.abonado_capital, 84000);
check('mora pendiente queda en 0', ab2.mora.pendiente, 0);

const totalAbonadoDb = Number((await q(`SELECT total_abonado FROM creditos WHERE id=1`))[0].total_abonado);
check('★ total_abonado NO incluye la mora (300.000 + 84.000)', totalAbonadoDb, 384000);
const moraEnTabla = Number((await q(`SELECT COALESCE(SUM(valor),0) v FROM movimientos_mora WHERE credito_id=1 AND tipo='Cobro' AND NOT anulado`))[0].v);
check('★ la mora vive en movimientos_mora', moraEnTabla, 16000);
const sumaAbonos = Number((await q(`SELECT COALESCE(SUM(valor),0) v FROM abonos_credito WHERE credito_id=1`))[0].v);
check('★ los abonos suman solo capital', sumaAbonos, 384000);

console.log('\n═══ 4. Modo "solo capital": la mora queda PENDIENTE, no condonada ═══');
await creditos.fijarPlazo(1, 1, { fecha_limite: diasAtras(60), condicion_id: 'normal', rol: 'admin_negocio' });
cred = await creditos.getCreditoById(1, 1);
// Los 800.000 estuvieron vencidos los 60 días (todos los abonos son de hoy):
//   800.000 × 2% × (60/30) = 32.000
check('mora causada a 60 días', cred.mora.causada, 32000);
check('menos los 16.000 ya cobrados', cred.mora.pendiente, 16000);

const causadaAntes = cred.mora.causada;
const ab3 = await creditos.registrarAbono(1, 1, { usuario_id: 1, valor: 50000, metodo: 'Efectivo', modo: 'solo_capital' });
check('nada fue a mora',    ab3.abonado_mora, 0);
check('todo fue a capital', ab3.abonado_capital, 50000);
checkEq('★ la mora NO quedó condonada', ab3.mora.condonada, 0);
check('★ y sigue pendiente (no se perdió)', ab3.mora.pendiente > 0, true);

// INVARIANTE CLAVE: la mora ya causada NO se borra ni se reduce al abonar capital.
//
// Se acumula por tramos sobre el capital que ESTUVO vencido: un abono de hoy
// solo deja de causar mora hacia adelante, nunca hacia atrás. Sin esto, un
// cliente que se atrasa y después paga todo dejaría la base en 0 y los intereses
// desaparecerían — el negocio los perdería en silencio. Fue un bug real que
// encontró la prueba adversaria (suite 10).
check('★ La mora causada NO baja al abonar capital', ab3.mora.causada, causadaAntes);
check('★ Y se sigue debiendo lo que no se ha cobrado',
  ab3.mora.pendiente, ab3.mora.causada - ab3.mora.cobrada);

console.log('\n═══ 5. Modo "personalizado": el vendedor decide cuánto a mora ═══');
const antes5 = await creditos.getCreditoById(1, 1);
const ab4 = await creditos.registrarAbono(1, 1, {
  usuario_id: 1, valor: 20000, metodo: 'Efectivo', modo: 'personalizado', valor_mora: 4000,
});
check('a mora lo indicado', ab4.abonado_mora, 4000);
check('el resto a capital', ab4.abonado_capital, 16000);
check('la mora cobrada acumulada subió 4.000', ab4.mora.cobrada, Number(antes5.mora.cobrada) + 4000);
check('la mora pendiente nunca es negativa', ab4.mora.pendiente >= 0, true);

// ═══ 6. Condonar: solo admin, con motivo y PIN ══════════════════════════════
console.log('\n═══ 6. Condonación de mora ═══');
// Se atrasa más el plazo para volver a causar mora suficiente y poder probar
// la condonación parcial y total.
await creditos.fijarPlazo(1, 1, { fecha_limite: diasAtras(120), condicion_id: 'normal', rol: 'admin_negocio' });
{
  const c = await creditos.getCreditoById(1, 1);
  check('hay mora pendiente para condonar', c.mora.pendiente > 0, true);
}
await debeFallar('un vendedor no puede condonar',
  () => creditos.condonarMora(1, 1, { valor: 1000, motivo: 'se pasó un día', pin: PIN, usuario_id: 2, rol: 'vendedor' }),
  'administrador');
await debeFallar('sin motivo no se puede condonar',
  () => creditos.condonarMora(1, 1, { valor: 1000, motivo: '', pin: PIN, ...ADMIN }), 'motivo');
await debeFallar('con PIN incorrecto no se puede condonar',
  () => creditos.condonarMora(1, 1, { valor: 1000, motivo: 'solo un día', pin: '0000', ...ADMIN }), 'pin');
await debeFallar('no se puede condonar más de lo pendiente',
  () => creditos.condonarMora(1, 1, { valor: 999999, motivo: 'todo', pin: PIN, ...ADMIN }), 'más de la mora');

const antesCond = await creditos.getCreditoById(1, 1);
const cond = await creditos.condonarMora(1, 1, { valor: 1000, motivo: 'Solo se pasó un día', pin: PIN, ...ADMIN });
check('condonación parcial registrada', cond.mora.condonada, 1000);
check('mora pendiente baja en 1.000',   cond.mora.pendiente, Number(antesCond.mora.pendiente) - 1000);

const condTodo = await creditos.condonarMora(1, 1, { motivo: 'Cliente de siempre', pin: PIN, ...ADMIN });
check('★ condonar sin valor = todo lo pendiente', condTodo.mora.pendiente, 0);
check('total condonado acumulado', condTodo.mora.condonada, Number(antesCond.mora.pendiente));

// 300.000 + 84.000 + 50.000 + 16.000 (el capital del abono personalizado) = 450.000
const totalAbonado2 = Number((await q(`SELECT total_abonado FROM creditos WHERE id=1`))[0].total_abonado);
check('★ condonar NO tocó total_abonado', totalAbonado2, 450000);
const sumaAbonos2 = Number((await q(`SELECT COALESCE(SUM(valor),0) v FROM abonos_credito WHERE credito_id=1`))[0].v);
check('★ Σ abonos_credito sigue igual a total_abonado', sumaAbonos2, totalAbonado2);
const condDb = await q(`SELECT valor, motivo, usuario_id FROM movimientos_mora WHERE credito_id=1 AND tipo='Condonacion' ORDER BY id`);
checkEq('★ queda registrada con motivo y autor',
  [condDb.length, condDb[0].motivo, Number(condDb[0].usuario_id)], [2, 'Solo se pasó un día', 1]);

// ═══ 7. Préstamos: mismo comportamiento ═════════════════════════════════════
console.log('\n═══ 7. Préstamo con plazo vencido ═══');
const creados = await prestamos.crearPrestamos({
  sucursal_id: 1, usuario_id: 1, negocio_id: 1,
  prestatario: 'Cliente Mora', cedula: '111', telefono: '300',
  cliente_id: 1,
  items: [{ nombre_producto: 'Equipo', imei: 'IMEI-A', cantidad_prestada: 1, valor_prestamo: 1000000 }],
  fecha_limite: enFuturo(10), mora_condicion_id: 'fija',
});
const pid = creados[0].id;
// Las columnas DATE vuelven como Date a medianoche UTC: se comparan en UTC, no
// con String() (que las muestra en hora local y las corre un día).
const soloFecha = (v) => new Date(v).toISOString().slice(0, 10);
checkEq('el préstamo nació con plazo', soloFecha(creados[0].fecha_limite), enFuturo(10));

let pr = await prestamos.getPrestamoById(1, pid);
check('aún no vence → sin mora', pr.mora.pendiente, 0);

// Se vence: 10 días de atraso × $2.000/día = $20.000
await db.query(`UPDATE prestamos SET fecha_limite = $1 WHERE id = $2`, [diasAtras(10), pid]);
pr = await prestamos.getPrestamoById(1, pid);
check('★ mora fija: 10 días × $2.000', pr.mora.pendiente, 20000);

const abP = await prestamos.registrarAbono(1, pid, 120000, 'Efectivo', 1, null, { modo: 'mora_capital' });
check('préstamo: a mora',    abP.abonado_mora, 20000);
check('préstamo: a capital', abP.abonado_capital, 100000);
const taP = Number((await q(`SELECT total_abonado FROM prestamos WHERE id=$1`, [pid]))[0].total_abonado);
check('★ total_abonado del préstamo sin mora', taP, 100000);

// ═══ 8. Anular el abono anula la mora cobrada dentro ════════════════════════
console.log('\n═══ 8. Anular abono → la mora cobrada se anula en cascada ═══');
const abonoRow = (await q(`SELECT id FROM abonos_prestamo WHERE prestamo_id=$1 ORDER BY id DESC LIMIT 1`, [pid]))[0];
const anul = await prestamos.anularAbono(1, pid, abonoRow.id);
check('★ la mora del abono se revirtió', anul.mora_anulada, 20000);
pr = await prestamos.getPrestamoById(1, pid);
check('★ la mora vuelve a estar pendiente', pr.mora.pendiente, 20000);
check('y el capital volvió a su saldo',     Number(pr.valor_prestamo) - Number(pr.total_abonado), 1000000);
const cobrosVivos = Number((await q(`SELECT COUNT(*)::int c FROM movimientos_mora WHERE prestamo_id=$1 AND tipo='Cobro' AND NOT anulado`, [pid]))[0].c);
checkEq('no queda ningún cobro de mora vivo', cobrosVivos, 0);

// ═══ 9. Feature apagada / negocio sin mora ══════════════════════════════════
console.log('\n═══ 9. Negocio SIN la feature: nada cambia ═══');
await debeFallar('no puede fijar plazo con la feature apagada',
  () => prestamos.fijarPlazo(2, pid, { fecha_limite: enFuturo(5), condicion_id: 'normal', rol: 'admin_negocio' }),
  'no está activado');

await db.exec(`UPDATE config_negocio SET valor='0' WHERE negocio_id=1 AND clave='mora_activa'`);
const sinFeature = await prestamos.crearPrestamos({
  sucursal_id: 1, usuario_id: 1, negocio_id: 1,
  prestatario: 'Cliente Mora', cedula: '111', telefono: '300', cliente_id: 1,
  items: [{ nombre_producto: 'Equipo', imei: 'IMEI-B', cantidad_prestada: 1, valor_prestamo: 500000 }],
  fecha_limite: enFuturo(30), mora_condicion_id: 'normal',
});
checkEq('★ con mora_activa=0 el plazo se ignora', sinFeature[0].fecha_limite, null);
const prSin = await prestamos.getPrestamoById(1, sinFeature[0].id);
checkEq('y el préstamo no tiene mora', prSin.mora.aplica, false);
await db.exec(`UPDATE config_negocio SET valor='1' WHERE negocio_id=1 AND clave='mora_activa'`);

// ═══ 10. Quitar el plazo desactiva la mora futura ═══════════════════════════
console.log('\n═══ 10. Quitar el plazo ═══');
await prestamos.fijarPlazo(1, pid, { fecha_limite: null, rol: 'admin_negocio' });
pr = await prestamos.getPrestamoById(1, pid);
checkEq('sin plazo, no aplica', pr.mora.aplica, false);
check('mora pendiente en 0',    pr.mora.pendiente, 0);

// ═══ 11. Invariantes globales ═══════════════════════════════════════════════
console.log('\n═══ 11. Invariantes ═══');
const huerf = Number((await q(`
  SELECT COUNT(*)::int c FROM movimientos_mora
  WHERE (credito_id IS NULL AND prestamo_id IS NULL)
     OR (credito_id IS NOT NULL AND prestamo_id IS NOT NULL)`))[0].c);
checkEq('★ ningún movimiento de mora sin documento (o con dos)', huerf, 0);
const negativos = Number((await q(`SELECT COUNT(*)::int c FROM movimientos_mora WHERE valor <= 0`))[0].c);
checkEq('ningún movimiento con valor <= 0', negativos, 0);
const abonosCero = Number((await q(`
  SELECT COUNT(*)::int c FROM abonos_credito WHERE valor <= 0
  UNION ALL SELECT COUNT(*)::int FROM abonos_prestamo WHERE valor <= 0`))[0].c);
checkEq('★ no se crearon abonos en $0 cuando todo fue a mora', abonosCero, 0);

console.log(`\n${'─'.repeat(62)}`);
console.log(fallos === 0 ? `✓ TODO OK — ${pasados} verificaciones` : `✗ ${fallos} FALLO(S) de ${pasados + fallos}`);
process.exit(fallos === 0 ? 0 : 1);
