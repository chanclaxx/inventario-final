// ─────────────────────────────────────────────────────────────────────────────
// ABONOS ANULADOS — contra un Postgres real (PGlite/WASM).
//
// Dos errores distintos dejaban la cuenta de un cliente mintiendo, y los dos se
// arreglan con el mismo mecanismo: el abono deja de contar pero NO desaparece,
// y queda con su motivo escrito al lado.
//
//   1. DEVOLUCIONES. Reportado desde producción (Cellsite): el prestamista
//      TIENDA mostraba $362.400.000 en su estado de cuenta y $363.580.000 de
//      deuda total. Al devolver un producto su cobro sale de la cuenta, pero
//      los abonos se quedaban vivos y el extracto los seguía restando: daba por
//      DEBAJO de la deuda real. A 23 personas, y a 12 de ellas negativa — como
//      si el negocio les debiera plata.
//
//   2. PAGOS DUPLICADOS. Un doble clic en "guardar" registraba el mismo pago
//      dos veces. En Cellsite: 45 parejas por $106.887.760, la última del
//      24-ago-2026, con pagos totales de id consecutivo creados en el mismo
//      segundo. Al cliente se le borraba deuda que sí debía.
//
// La regla ahora es una sola: **el valor correcto de toda cuenta es la deuda
// total**, y el extracto tiene que llegar a ese mismo número. Cuando no cuenta
// un movimiento, se ve por qué.
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

// Columnas que el esquema de pruebas recorta y los repositorios reales sí piden.
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
  -- El extracto lista las compras de artículo y las ordena por fecha; el
  -- fixture recorta estas tres y sin ellas la consulta ni compila.
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS fecha        TIMESTAMP DEFAULT NOW();
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS tipo_persona TEXT;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS persona_id   INTEGER;
  ALTER TABLE abonos_totales ADD COLUMN IF NOT EXISTS usuario_id INTEGER;
  -- La LISTA de prestamos (findAll) pide estas columnas; el fixture las recorta
  -- porque ninguna suite la ejercitaba hasta ahora.
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo_a_favor NUMERIC DEFAULT 0;
  ALTER TABLE productos_serial   ADD COLUMN IF NOT EXISTS linea_id INT;
  ALTER TABLE productos_cantidad ADD COLUMN IF NOT EXISTS linea_id INT;
  ALTER TABLE seriales ADD COLUMN IF NOT EXISTS color TEXT;
  CREATE TABLE IF NOT EXISTS lineas_producto (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT
  );
  CREATE TABLE IF NOT EXISTS empleados_prestatario (
    id SERIAL PRIMARY KEY, prestatario_id INT, nombre TEXT
  );
  -- El extracto de creditos lee la auditoria para fechar las devoluciones.
  CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, fecha TIMESTAMP DEFAULT NOW(),
    accion VARCHAR, tabla VARCHAR, registro_id INT, detalle TEXT
  );
`);
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260730_mora_credito.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260804_interes_corriente.sql'), 'utf8'));
// La migración bajo prueba: sin ella nada de esto existe.
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260825_abonos_anulados.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260825_pago_total_credito.sql'), 'utf8'));

// PGlite devuelve `affectedRows`; el driver real devuelve `rowCount`, y varios
// candados anti-carrera del código dependen de él.
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

const prestamos = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'));
const creditosRepo = require(path.join(RAIZ, 'src/modules/creditos/creditos.repository.js'));
const creditosService = require(path.join(RAIZ, 'src/modules/creditos/creditos.service.js'));

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
    console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${e.status || ''} ${String(e.message || '').slice(0, 60)}`);
    ok ? pasados++ : fallos++;
  }
};

// Saldo final del extracto: la última fila que participa del acumulado.
const saldoExtracto = async (personaId) => {
  const movs = await prestamos.getEstadoCuenta(1, 'prestatario', personaId);
  const conSaldo = movs.filter((m) => m.saldo != null);
  return conSaldo.length ? Number(conSaldo[conSaldo.length - 1].saldo) : 0;
};
// La deuda real: lo que muestran la tarjeta y el resumen de cartera.
const deudaReal = async (personaId) => {
  const [r] = await q(`
    SELECT COALESCE(SUM(p.valor_prestamo - p.total_abonado)
             FILTER (WHERE p.estado = 'Activo'), 0)::numeric AS deuda
      FROM prestamos p JOIN sucursales su ON su.id = p.sucursal_id
     WHERE p.prestatario_id = $1 AND su.negocio_id = 1`, [personaId]);
  return Number(r.deuda);
};

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Presta');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO productos_serial (nombre, precio, sucursal_id) VALUES ('Equipo', 1200000, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'IMEI-1',600000),(1,'IMEI-2',600000),(1,'IMEI-3',600000),(1,'IMEI-4',600000),
    (1,'IMEI-5',600000),(1,'IMEI-6',600000),(1,'IMEI-7',600000),(1,'IMEI-8',600000),
    (1,'IMEI-13',600000),(1,'IMEI-14',600000),(1,'IMEI-15',600000),(1,'IMEI-16',600000),
    (1,'IMEI-17',600000),(1,'IMEI-18',600000),(1,'IMEI-19',600000),(1,'IMEI-20',600000),(1,'IMEI-21',600000),(1,'IMEI-22',600000);
  INSERT INTO productos_cantidad (nombre, stock, precio, sucursal_id) VALUES ('Cargador', 50, 40000, 1);
  INSERT INTO prestatarios (negocio_id, nombre, cedula, saldo_a_favor) VALUES
    (1,'TIENDA','181', 0),
    (1,'PEPE','182', 0),
    (1,'SIN ABONOS','183', 0),
    (1,'PARCIAL','184', 0),
    (1,'DOBLE CLIC','185', 0);
`);

const nuevoPrestamo = async (prestatarioId, nombre, imei, valor) => {
  const [p] = await prestamos.crearPrestamos({
    sucursal_id: 1, usuario_id: 1, negocio_id: 1,
    prestatario: nombre, cedula: String(prestatarioId), telefono: '300',
    prestatario_id: prestatarioId,
    items: [{ nombre_producto: 'Equipo', imei, valor_prestamo: valor }],
  });
  return p.id;
};

// ═══ 1. El caso reportado: TIENDA ═══════════════════════════════════════════
//
// Presta $1.200.000, abona $1.180.000, devuelve el equipo. Antes el extracto
// restaba esos $1.180.000 sin haber sumado el cobro.
console.log('\n═══ 1. Devolver un producto ya abonado (el caso de TIENDA) ═══');
{
  const pDevuelto = await nuevoPrestamo(1, 'TIENDA', 'IMEI-1', 1200000);
  await nuevoPrestamo(1, 'TIENDA', 'IMEI-2', 5000000);
  await prestamos.registrarAbono(1, pDevuelto, 1180000, 'Efectivo', 1, null);

  check('antes de devolver, el extracto cuadra', await saldoExtracto(1), await deudaReal(1));

  const res = await prestamos.devolverPrestamo(1, pDevuelto);
  check('★ se anularon los abonos del producto', res.abonos_anulados, 1180000);

  const [ab] = await q(`SELECT anulado, motivo_anulacion FROM abonos_prestamo WHERE prestamo_id=$1`, [pDevuelto]);
  checkEq('★ el abono queda ANULADO, no borrado', ab?.anulado, true);
  checkEq('★ y con el motivo escrito', String(ab?.motivo_anulacion).startsWith('Anulado: se devolvió'), true);

  const [p] = await q(`SELECT total_abonado FROM prestamos WHERE id=$1`, [pDevuelto]);
  check('lo abonado del préstamo vuelve a cero', p.total_abonado, 0);

  check('★ el extracto ya NO resta ese abono', await saldoExtracto(1), 5000000);
  check('★ y coincide con la deuda total', await saldoExtracto(1), await deudaReal(1));

  const movs = await prestamos.getEstadoCuenta(1, 'prestatario', 1);
  const fila = movs.find((m) => m.tipo === 'abono' && Number(m.abono) === 1180000);
  checkEq('el abono SIGUE apareciendo en el extracto', !!fila, true);
  checkEq('★ marcado como anulado', fila?.anulado, true);
  checkEq('★ con el motivo a la vista', String(fila?.motivo_anulacion || '').includes('se devolvió'), true);
  checkEq('y sin saldo corrido en esa fila', fila?.saldo, null);
}

// ═══ 2. Baranda: devolver SIN abonos no cambia nada ═════════════════════════
console.log('\n═══ 2. Un préstamo sin abonos se devuelve igual que siempre ═══');
{
  const p = await nuevoPrestamo(3, 'SIN ABONOS', 'IMEI-3', 800000);
  const res = await prestamos.devolverPrestamo(1, p);
  check('★ no se anula nada', res.abonos_anulados, 0);
  checkEq('el préstamo sí queda devuelto',
    (await q(`SELECT estado FROM prestamos WHERE id=$1`, [p]))[0].estado, 'Devuelto');
  check('extracto y deuda coinciden', await saldoExtracto(3), await deudaReal(3));
}

// ═══ 3. Pago total repartido, con uno de los préstamos devuelto ═════════════
//
// El extracto tiene que seguir mostrando el pago COMPLETO —es lo que la persona
// pagó— pero bajar la deuda solo por la parte que sigue viva. Excluir la fila
// entera perdería la plata que sí pagó préstamos abiertos.
console.log('\n═══ 3. Pago total repartido, con un préstamo devuelto ═══');
{
  const pA = await nuevoPrestamo(2, 'PEPE', 'IMEI-4', 3400000);  // se devuelve
  await nuevoPrestamo(2, 'PEPE', 'IMEI-5', 5400000);             // sigue vivo
  await prestamos.registrarAbonoTotal(1, 'prestatario', 2, 8800000, 'Efectivo', 1, 1);

  check('el pago total dejó todo saldado', await deudaReal(2), 0);
  const [repartoA] = await q(`SELECT COALESCE(SUM(valor),0) v FROM abonos_prestamo WHERE prestamo_id=$1`, [pA]);

  const res = await prestamos.devolverPrestamo(1, pA);
  check('★ solo se anula lo que cayó en el devuelto', res.abonos_anulados, Number(repartoA.v));

  const movs = await prestamos.getEstadoCuenta(1, 'prestatario', 2);
  const filaPago = movs.find((m) => m.tipo === 'abono_total');
  check('★ el extracto muestra el pago COMPLETO', filaPago?.abono, 8800000);
  checkEq('★ y el pago total NO queda marcado (parte sigue viva)', filaPago?.anulado, false);
  check('★ pero solo baja deuda por la parte viva', await saldoExtracto(2), await deudaReal(2));
  check('esa deuda es cero: el préstamo vivo quedó pagado', await deudaReal(2), 0);
}

// ═══ 4. Devolución parcial: el sobrante también se anula ════════════════════
//
// Devolver unidades baja el valor del préstamo. Lo ya abonado puede quedar por
// ENCIMA de lo que ahora vale, y ese sobrante descuadraba igual que un pago
// duplicado: el préstamo mostraba más pagado de lo que costaba.
console.log('\n═══ 4. Devolución parcial que deja un sobrante ═══');
{
  const [p] = await prestamos.crearPrestamos({
    sucursal_id: 1, usuario_id: 1, negocio_id: 1,
    prestatario: 'PARCIAL', cedula: '184', telefono: '300', prestatario_id: 4,
    items: [{ nombre_producto: 'Cargador', producto_id: 1, cantidad_prestada: 4, valor_prestamo: 160000 }],
  });
  // Paga 120.000 de 160.000 y devuelve 3 de 4 → el préstamo baja a 40.000.
  await prestamos.registrarAbono(1, p.id, 120000, 'Efectivo', 1, null);
  const res = await prestamos.devolverParcial(1, p.id, 3);
  checkEq('devolvió 3 unidades', res.devuelto, 3);

  const [pp] = await q(`SELECT valor_prestamo, total_abonado, estado FROM prestamos WHERE id=$1`, [p.id]);
  check('★ el préstamo bajó a su nuevo valor', pp.valor_prestamo, 40000);
  check('★ y lo abonado ya no lo supera', pp.total_abonado, 40000);
  checkEq('queda saldado', pp.estado, 'Saldado');
  check('★ no queda ningún préstamo con más pagado que su valor',
    (await q(`SELECT COUNT(*)::int c FROM prestamos WHERE total_abonado > valor_prestamo`))[0].c, 0);
  check('extracto y deuda coinciden', await saldoExtracto(4), await deudaReal(4));
}

// ═══ 5. La baranda del DOBLE CLIC ═══════════════════════════════════════════
//
// Nadie paga dos veces exactamente lo mismo en el mismo minuto. Cuando pasa es
// el formulario enviándose dos veces — y en Cellsite dejó 45 parejas por
// $106.887.760 antes de que nadie lo notara.
console.log('\n═══ 5. El mismo pago no se puede registrar dos veces ═══');
{
  const p = await nuevoPrestamo(5, 'DOBLE CLIC', 'IMEI-6', 2000000);
  await prestamos.registrarAbono(1, p, 500000, 'Efectivo', 1, null);

  await debeFallar('★ el segundo abono idéntico se rechaza',
    () => prestamos.registrarAbono(1, p, 500000, 'Efectivo', 1, null), 'ya se registró');

  check('★ y la deuda quedó bien, no al doble', await deudaReal(5), 1500000);
  check('solo hay UN abono registrado',
    (await q(`SELECT COUNT(*)::int c FROM abonos_prestamo WHERE prestamo_id=$1`, [p]))[0].c, 1);

  // Un valor distinto SÍ pasa: la baranda no puede estorbar la operación real.
  await prestamos.registrarAbono(1, p, 300000, 'Efectivo', 1, null);
  check('★ un abono por otro valor sí entra', await deudaReal(5), 1200000);

  // Y el pago total tiene su propia baranda.
  const p2 = await nuevoPrestamo(5, 'DOBLE CLIC', 'IMEI-7', 1000000);
  await prestamos.registrarAbonoTotal(1, 'prestatario', 5, 200000, 'Efectivo', 1, 1);
  await debeFallar('★ el pago total duplicado también se rechaza',
    () => prestamos.registrarAbonoTotal(1, 'prestatario', 5, 200000, 'Efectivo', 1, 1), 'ya se registró');
  check('no se repartió dos veces',
    (await q(`SELECT COUNT(*)::int c FROM abonos_totales WHERE persona_id=5`))[0].c, 1);
  void p2;
}

// ═══ 6. Invariante: extracto = deuda total, para TODAS las personas ═════════
//
// Es la comprobación que resume todo. La regla del negocio es que el valor
// correcto de cualquier cuenta es la deuda total: si algún camino vuelve a
// dejar un abono contando contra un cobro que ya no existe, esto se cae.
console.log('\n═══ 6. Invariante: extracto = deuda total ═══');
{
  const personas = await q(`SELECT id, nombre FROM prestatarios ORDER BY id`);
  let descuadradas = 0;
  for (const per of personas) {
    const ext = await saldoExtracto(per.id);
    const real = await deudaReal(per.id);
    if (Math.abs(ext - real) >= 1) {
      descuadradas++;
      console.log(`     ✗ ${per.nombre}: extracto ${money(ext)} vs deuda ${money(real)}`);
    }
  }
  check('★ personas con el extracto descuadrado', descuadradas, 0);

  check('★ ningún préstamo con más pagado que su valor',
    (await q(`SELECT COUNT(*)::int c FROM prestamos WHERE total_abonado > valor_prestamo`))[0].c, 0);

  check('★ ningún abono vivo sobre un préstamo devuelto',
    (await q(`SELECT COUNT(*)::int c FROM abonos_prestamo a
                JOIN prestamos p ON p.id=a.prestamo_id
               WHERE p.estado='Devuelto' AND NOT a.anulado`))[0].c, 0);

  check('todo lo anulado conserva su motivo',
    (await q(`SELECT COUNT(*)::int c FROM abonos_prestamo
               WHERE anulado AND (motivo_anulacion IS NULL OR BTRIM(motivo_anulacion) = '')`))[0].c, 0);
}

// ═══ 7. CRÉDITOS: el mismo hueco, cerrado igual ═════════════════════════════
//
// Cancelar una factura a crédito ponía el crédito en 'Cancelado' pero dejaba
// sus abonos VIVOS: el cobro salía de la cuenta y los pagos se quedaban
// restando contra nada. Es exactamente el mismo error que tenía préstamos al
// devolver un producto abonado, en el otro vehículo de deuda del sistema.
console.log('\n═══ 7. Créditos: cancelar también anula sus abonos ═══');
{
  await db.exec(`
    INSERT INTO clientes (negocio_id, nombre, cedula) VALUES (1, 'CLIENTE CRED', '900');
    INSERT INTO facturas (numero, sucursal_id, nombre_cliente, cedula, estado, fecha)
      VALUES (900, 1, 'CLIENTE CRED', '900', 'Credito', NOW());
    INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio)
      VALUES ((SELECT id FROM facturas WHERE numero=900), 'Equipo', 1, 1000000);
  `);
  const facturaId = (await q(`SELECT id FROM facturas WHERE numero=900`))[0].id;

  const cli = await pool.connect();
  await creditosRepo.create(cli, {
    factura_id: facturaId, cliente_id: 1, sucursal_id: 1,
    valor_total: 1000000, cuota_inicial: 200000,
  });
  const creditoId = (await q(`SELECT id FROM creditos WHERE factura_id=$1`, [facturaId]))[0].id;
  await creditosRepo.insertarAbono(cli, {
    credito_id: creditoId, usuario_id: 1, valor: 300000, metodo: 'Efectivo', notas: null,
  });
  cli.release();

  check('el crédito arranca con su abono',
    (await q(`SELECT total_abonado FROM creditos WHERE id=$1`, [creditoId]))[0].total_abonado, 300000);

  const cli2 = await pool.connect();
  const res = await creditosRepo.anularAbonosDeCredito(
    cli2, creditoId, 'Anulado: se canceló la factura #000900');
  cli2.release();

  check('★ se anuló el abono del crédito', res.total, 300000);
  check('★ y lo abonado del crédito baja',
    (await q(`SELECT total_abonado FROM creditos WHERE id=$1`, [creditoId]))[0].total_abonado, 0);

  const [ab] = await q(
    `SELECT anulado, valor_anulado, motivo_anulacion FROM abonos_credito WHERE credito_id=$1`, [creditoId]);
  checkEq('★ el abono queda anulado, NO borrado', ab?.anulado, true);
  check('con su valor anulado completo', ab?.valor_anulado, 300000);
  checkEq('★ y con el motivo escrito', String(ab?.motivo_anulacion).includes('se canceló la factura'), true);

  // Se ve, con su motivo, pero fuera del saldo: el extracto explica el cambio
  // en vez de esconderlo.
  const movs = await creditosService.getEstadoCuenta(1, '900');
  const abs900 = movs.filter((m) => m.tipo === 'abono');
  checkEq('★ el abono anulado sigue visible en el extracto', abs900.length, 1);
  checkEq('★ pero NO cuenta en el saldo', abs900[0]?.saldo, null);
  checkEq('   y dice por que', String(abs900[0]?.motivo_anulacion).includes('se canceló la factura'), true);

  // Idempotente: llamarlo dos veces no puede bajar el abonado dos veces.
  const cli3 = await pool.connect();
  const res2 = await creditosRepo.anularAbonosDeCredito(cli3, creditoId, 'otra vez');
  cli3.release();
  check('★ llamarlo de nuevo no vuelve a descontar', res2.total, 0);
}

// ═══ 8. Las TRES salidas del modal de devolución ════════════════════════════
//
// El sistema no puede saber qué se acordó con el cliente, así que pregunta en
// el momento. Lo que no cambia en ninguna de las tres: el pago no se borra, y
// la deuda y el estado de cuenta quedan diciendo lo mismo.
console.log('\n═══ 8. Las tres salidas del modal ═══');
{
  await db.exec(`INSERT INTO prestatarios (negocio_id, nombre, cedula, saldo_a_favor)
                 VALUES (1,'OPCION A','190',0),(1,'OPCION B','191',0),(1,'OPCION C','192',0)`);
  const idA = (await q(`SELECT id FROM prestatarios WHERE nombre='OPCION A'`))[0].id;
  const idB = (await q(`SELECT id FROM prestatarios WHERE nombre='OPCION B'`))[0].id;
  const idC = (await q(`SELECT id FROM prestatarios WHERE nombre='OPCION C'`))[0].id;

  const saldoAFavor = async (pid) =>
    Number((await q(`SELECT saldo_a_favor FROM prestatarios WHERE id=$1`, [pid]))[0].saldo_a_favor);

  // ── A. 'anular': la deuda NO se mueve ────────────────────────────────────
  await nuevoPrestamo(idA, 'OPCION A', 'IMEI-13', 900000);
  const pA = await nuevoPrestamo(idA, 'OPCION A', 'IMEI-14', 500000);
  await prestamos.registrarAbono(1, pA, 400000, 'Efectivo', 1, null);
  const deudaAntesA = await deudaReal(idA);
  await prestamos.devolverPrestamo(1, pA, { decision: 'anular' });

  // Devolver el producto SÍ quita de la deuda lo que faltaba de ESE producto
  // ($100.000) — eso es correcto y siempre fue así. Lo que no puede pasar es
  // que el ABONO ($400.000) mueva la deuda ni un peso.
  check('★ [anular] la deuda baja solo por lo pendiente del producto, no por el abono',
    await deudaReal(idA), deudaAntesA - 100000);
  check('★ [anular] no se le crea saldo a favor', await saldoAFavor(idA), 0);
  check('★ [anular] extracto = deuda', await saldoExtracto(idA), await deudaReal(idA));
  const [abA] = await q(`SELECT anulado, motivo_anulacion FROM abonos_prestamo WHERE prestamo_id=$1`, [pA]);
  checkEq('[anular] el pago sigue ahí, marcado', abA?.anulado, true);

  // ── B. 'saldo_a_favor': queda como crédito ───────────────────────────────
  await nuevoPrestamo(idB, 'OPCION B', 'IMEI-15', 900000);
  const pB = await nuevoPrestamo(idB, 'OPCION B', 'IMEI-16', 500000);
  await prestamos.registrarAbono(1, pB, 350000, 'Efectivo', 1, null);
  const deudaAntesB = await deudaReal(idB);
  await prestamos.devolverPrestamo(1, pB, { decision: 'saldo_a_favor' });

  check('★ [a favor] igual: solo lo pendiente del producto',
    await deudaReal(idB), deudaAntesB - 150000);
  check('★ [a favor] queda como crédito a su nombre', await saldoAFavor(idB), 350000);
  check('★ [a favor] extracto = deuda', await saldoExtracto(idB), await deudaReal(idB));

  // ── C. 'reasignar': baja lo que debe ─────────────────────────────────────
  const pC1 = await nuevoPrestamo(idC, 'OPCION C', 'IMEI-17', 900000);
  const pC = await nuevoPrestamo(idC, 'OPCION C', 'IMEI-18', 500000);
  await prestamos.registrarAbono(1, pC, 300000, 'Efectivo', 1, null);
  const deudaAntesC = await deudaReal(idC);
  await prestamos.devolverPrestamo(1, pC, { decision: 'reasignar' });

  check('★ [reasignar] baja lo pendiente del producto Y el abono reasignado',
    await deudaReal(idC), deudaAntesC - 200000 - 300000);
  check('★ [reasignar] no queda saldo colgando', await saldoAFavor(idC), 0);
  check('★ [reasignar] extracto = deuda', await saldoExtracto(idC), await deudaReal(idC));
  check('y el otro préstamo lo recibió',
    (await q(`SELECT total_abonado FROM prestamos WHERE id=$1`, [pC1]))[0].total_abonado, 300000);

  // ── Sin decisión, se comporta como 'anular' ──────────────────────────────
  await db.exec(`INSERT INTO prestatarios (negocio_id, nombre, cedula, saldo_a_favor) VALUES (1,'SIN DECISION','193',0)`);
  const idD = (await q(`SELECT id FROM prestatarios WHERE nombre='SIN DECISION'`))[0].id;
  await nuevoPrestamo(idD, 'SIN DECISION', 'IMEI-19', 700000);
  const pD = await nuevoPrestamo(idD, 'SIN DECISION', 'IMEI-20', 400000);
  await prestamos.registrarAbono(1, pD, 200000, 'Efectivo', 1, null);
  const deudaAntesD = await deudaReal(idD);
  await prestamos.devolverPrestamo(1, pD);
  check('★ sin decisión, se comporta como anular',
    await deudaReal(idD), deudaAntesD - 200000);
  check('sin decisión, tampoco crea saldo a favor', await saldoAFavor(idD), 0);
}

// ═══ 9. Un PAGO TOTAL solo se anula por PARTES ══════════════════════════════
//
// Es el caso que más fácil se cuenta mal. La persona paga UNA suma y el programa
// la reparte entre varios préstamos. Si uno se devuelve, solo esa porción deja
// de contar: el pago sigue existiendo entero —es lo que pagó— pero baja la deuda
// menos.
//
// Lo que no puede pasar: que la fila muestre $8.800.000, el saldo baje
// $5.400.000, y no haya nada que explique la diferencia. Eso son dos números
// que no cuadran, que es justo lo que este trabajo vino a quitar.
console.log('\n═══ 9. Pago total: se anula solo la parte devuelta ═══');
{
  await db.exec(`INSERT INTO prestatarios (negocio_id, nombre, cedula, saldo_a_favor)
                 VALUES (1,'PARTES','195', 0)`);
  const id = (await q(`SELECT id FROM prestatarios WHERE nombre='PARTES'`))[0].id;

  const pDev  = await nuevoPrestamo(id, 'PARTES', 'IMEI-21', 3400000);  // se devuelve
  const pVivo = await nuevoPrestamo(id, 'PARTES', 'IMEI-22', 5400000);  // sigue

  await prestamos.registrarAbonoTotal(1, 'prestatario', id, 8800000, 'Efectivo', 1, 1);
  const [ptId] = await q(`SELECT id FROM abonos_totales WHERE persona_id=$1`, [id]);

  await prestamos.devolverPrestamo(1, pDev, { decision: 'anular' });

  // ── El pago total NO se toca ──────────────────────────────────────────────
  const [pt] = await q(`SELECT valor_total FROM abonos_totales WHERE id=$1`, [ptId.id]);
  check('★ el pago total sigue diciendo lo que la persona pagó', pt.valor_total, 8800000);

  // ── Solo el hijo del devuelto queda anulado ───────────────────────────────
  const hijos = await q(
    `SELECT prestamo_id, valor, valor_anulado, anulado FROM abonos_prestamo
      WHERE abono_total_id=$1 ORDER BY valor DESC`, [ptId.id]);
  checkEq('el pago se había repartido en 2 préstamos', hijos.length, 2);
  const hDev  = hijos.find((h) => Number(h.prestamo_id) === Number(pDev));
  const hVivo = hijos.find((h) => Number(h.prestamo_id) === Number(pVivo));
  checkEq('★ el pedazo del devuelto queda anulado', hDev?.anulado, true);
  check('   y por su valor exacto', hDev?.valor_anulado, 3400000);
  checkEq('★ el pedazo del préstamo vivo NO se toca', hVivo?.anulado, false);
  check('   sigue contando completo', hVivo?.valor_anulado, 0);

  // ── En el extracto: muestra todo, baja solo la parte viva ────────────────
  const movs = await prestamos.getEstadoCuenta(1, 'prestatario', id);
  const fila = movs.find((m) => m.tipo === 'abono_total');
  check('★ el extracto muestra el pago COMPLETO', fila?.abono, 8800000);
  checkEq('★ y NO lo marca como anulado del todo (parte sigue viva)', fila?.anulado_total, false);
  check('★ pero dice cuánto de él dejó de contar', fila?.valor_anulado, 3400000);
  checkEq('con su motivo, para que la fila se explique sola',
    String(fila?.motivo_anulacion || '').includes('se devolvió'), true);

  // ── Y el saldo baja exactamente por la parte viva ────────────────────────
  const conSaldo = movs.filter((m) => m.saldo != null);
  const i = conSaldo.findIndex((m) => m.tipo === 'abono_total');
  const bajo = i > 0 ? Number(conSaldo[i - 1].saldo) - Number(conSaldo[i].saldo) : null;
  check('★ el saldo baja solo por lo que sigue vivo', bajo, 5400000);
  check('★ y extracto = deuda al final', await saldoExtracto(id), await deudaReal(id));
}

// ═══ 10. La lista no puede OCULTAR préstamos ════════════════════════════════
//
// Un IMEI puede estar en varias filas de `seriales` — el mismo equipo cargado
// en dos productos, o en dos sucursales. Un LEFT JOIN plano multiplica el
// préstamo, y la consulta lo resolvía descartando las filas cuyo serial no
// estuviera en la sucursal del préstamo.
//
// El efecto: préstamos que EXISTEN y no salían en la lista. 11 en
// VideoTiendaGafas y 345 en Cellsite, uno de ellos con deuda viva. El usuario
// abonó a un iPad, lo fue a buscar y no estaba.
//
// La regla: la lista devuelve TODOS los préstamos del negocio, ni uno menos,
// y ninguno repetido.
console.log('\n═══ 10. Ningún préstamo se oculta de la lista ═══');
{
  await db.exec(`
    INSERT INTO sucursales (negocio_id, nombre) VALUES (1, 'Otra Sede');
    INSERT INTO prestatarios (negocio_id, nombre, cedula, saldo_a_favor)
      VALUES (1,'BUSCA','200', 0);
    -- El producto vive en la sucursal 2; el préstamo se hará en la 1.
    INSERT INTO productos_serial (nombre, precio, sucursal_id)
      VALUES ('Equipo Otra Sede', 1000000, 2);
  `);
  const idProd = (await q(`SELECT id FROM productos_serial WHERE nombre='Equipo Otra Sede'`))[0].id;
  await db.query(`INSERT INTO seriales (producto_id, imei, costo_compra) VALUES ($1,'IMEI-HUERFANO',500000)`, [idProd]);
  const id = (await q(`SELECT id FROM prestatarios WHERE nombre='BUSCA'`))[0].id;

  // Préstamo en la sucursal 1 con un IMEI cuyo producto está en la 2.
  // Se inserta directo a propósito: el service HOY impide crearlo así (valida
  // que el serial sea de la sucursal), pero en producción hay préstamos viejos
  // en ese estado — un equipo que se movió de sede después de prestarse. La
  // lista tiene que mostrarlos igual.
  await db.query(`
    INSERT INTO prestamos (sucursal_id, usuario_id, prestatario, cedula, telefono,
                           nombre_producto, imei, cantidad_prestada, valor_prestamo,
                           total_abonado, estado, prestatario_id)
    VALUES (1, 1, 'BUSCA', '200', '300', 'Equipo Otra Sede', 'IMEI-HUERFANO', 1, 700000,
            0, 'Activo', $1)`, [id]);
  const pOculto = (await q(`SELECT id FROM prestamos WHERE imei='IMEI-HUERFANO'`))[0].id;

  const lista = await prestamos.getPrestamos(null, 1);
  const [{ total }] = await q(`
    SELECT COUNT(*)::int AS total FROM prestamos p
      JOIN sucursales su ON su.id = p.sucursal_id WHERE su.negocio_id = 1`);

  checkEq('★ la lista devuelve TODOS los préstamos del negocio', lista.length, total);
  checkEq('★ y el del serial en otra sucursal SÍ aparece',
    lista.some((x) => Number(x.id) === Number(pOculto)), true);

  const ids = new Set(lista.map((x) => Number(x.id)));
  checkEq('★ sin duplicar ninguno (el IMEI no multiplica filas)', lista.length, ids.size);

  // El mismo IMEI en DOS seriales: el caso que originó el filtro.
  await db.exec(`
    INSERT INTO productos_serial (nombre, precio, sucursal_id) VALUES ('Equipo Duplicado', 900000, 1);
  `);
  const idProd2 = (await q(`SELECT id FROM productos_serial WHERE nombre='Equipo Duplicado'`))[0].id;
  await db.query(`INSERT INTO seriales (producto_id, imei, costo_compra) VALUES ($1,'IMEI-HUERFANO',400000)`, [idProd2]);

  const lista2 = await prestamos.getPrestamos(null, 1);
  const ids2 = new Set(lista2.map((x) => Number(x.id)));
  checkEq('★ con el IMEI en DOS seriales, sigue sin duplicarse', lista2.length, ids2.size);
  checkEq('   y el préstamo sigue apareciendo una sola vez',
    lista2.filter((x) => Number(x.id) === Number(pOculto)).length, 1);
}

// ═══ 11. PAGO TOTAL y ANULAR ABONO en CRÉDITOS ══════════════════════════════
//
// Los créditos solo dejaban abonar de a uno. Aquí se les da el mismo pago total
// que tienen los préstamos, con las mismas barandas que costó descubrir en esta
// sesión: por sucursal, FIFO, tope, sin doble clic, y con la nota del usuario.
//
// Y se agrega poder ANULAR un abono — que es lo que faltaba para poder arreglar
// un error sin borrar la evidencia.
console.log('\n═══ 11. Pago total y anulación en créditos ═══');
{
  const creditos = require(path.join(RAIZ, 'src/modules/creditos/creditos.service.js'));

  await db.exec(`
    INSERT INTO clientes (negocio_id, nombre, cedula) VALUES (1, 'CLIENTA PT', '777');
    INSERT INTO facturas (numero, sucursal_id, nombre_cliente, cedula, estado, fecha)
      VALUES (901, 1, 'CLIENTA PT', '777', 'Credito', NOW() - INTERVAL '10 days'),
             (902, 1, 'CLIENTA PT', '777', 'Credito', NOW() - INTERVAL '5 days'),
             (903, 2, 'CLIENTA PT', '777', 'Credito', NOW() - INTERVAL '3 days');
  `);
  const cli = (await q(`SELECT id FROM clientes WHERE cedula='777'`))[0].id;
  const f = {};
  for (const n of [901, 902, 903]) f[n] = (await q(`SELECT id FROM facturas WHERE numero=$1`, [n]))[0].id;

  const cx = await pool.connect();
  // Dos créditos en la sucursal 1 y uno en la 2.
  const crRepo = require(path.join(RAIZ, 'src/modules/creditos/creditos.repository.js'));
  await crRepo.create(cx, { factura_id: f[901], cliente_id: cli, sucursal_id: 1, valor_total: 1000000, cuota_inicial: 0 });
  await crRepo.create(cx, { factura_id: f[902], cliente_id: cli, sucursal_id: 1, valor_total: 600000,  cuota_inicial: 0 });
  await crRepo.create(cx, { factura_id: f[903], cliente_id: cli, sucursal_id: 2, valor_total: 900000,  cuota_inicial: 0 });
  cx.release();
  const ids = await q(`SELECT id, sucursal_id, valor_total FROM creditos WHERE cliente_id=$1 ORDER BY id`, [cli]);
  const [c1, c2, c3] = ids;

  // ── El tope: no puede pagar más de lo que debe EN ESA SUCURSAL ────────────
  await debeFallar('★ rechaza un pago mayor a lo que debe en la sucursal',
    () => creditos.registrarAbonoTotalCredito(1, cli, 2000000, 'Efectivo', 1, 1),
    'supera lo que el cliente debe');

  // ── El reparto ───────────────────────────────────────────────────────────
  const res = await creditos.registrarAbonoTotalCredito(
    1, cli, 1300000, 'Efectivo', 1, 1, { descripcion: 'abono de la quincena' });

  check('★ el pago se registró completo', res.valor_total, 1300000);
  check('   sin dejar sobrante', res.sobrante, 0);
  checkEq('★ repartió entre los DOS créditos de esa sucursal', res.distribucion.length, 2);
  check('★ FIFO: el más viejo se llena primero', res.distribucion[0]?.abonado, 1000000);
  check('   y el resto va al siguiente', res.distribucion[1]?.abonado, 300000);
  checkEq('★ el más viejo queda saldado', res.distribucion[0]?.saldado, true);

  const [ec3] = await q(`SELECT total_abonado, estado FROM creditos WHERE id=$1`, [c3.id]);
  check('★ el crédito de la OTRA sucursal no se tocó', ec3.total_abonado, 0);

  // ── La nota viaja aparte, no pegada al concepto ───────────────────────────
  const [pt] = await q(`SELECT destino, descripcion, valor_total FROM abonos_totales WHERE id=$1`, [res.abono_total_id]);
  checkEq('★ el pago queda marcado como de CRÉDITO', pt.destino, 'credito');
  checkEq('★ y guarda la nota del usuario', pt.descripcion, 'abono de la quincena');

  // ── El extracto: UN movimiento, desplegable ──────────────────────────────
  //
  // El usuario hizo UN pago. Verlo partido en dos filas lo manda a buscar una
  // plata que cree perdida, que es lo que ya paso en prestamos.
  const movs = await creditos.getEstadoCuenta(1, '777');
  const abonos = movs.filter((m) => m.tipo === 'abono');
  checkEq('★ el pago total sale como UN solo movimiento', abonos.length, 1);
  check('★ por el valor completo que se pago', abonos[0]?.abono, 1300000);
  checkEq('★ marcado como pago total', abonos[0]?.es_pago_total, true);
  checkEq('   y el concepto lo dice',
    String(abonos[0]?.concepto).includes('Pago total'), true);
  checkEq('   diciendo entre cuantas facturas se repartio',
    String(abonos[0]?.concepto).includes('2 facturas'), true);
  checkEq('   con la nota en columna propia', abonos[0]?.descripcion, 'abono de la quincena');
  checkEq('★ un pago total NO se puede anular suelto', abonos[0]?.anulable, false);

  // El reparto, para desplegarlo: a que facturas fue y cuanto a cada una.
  const reparto = abonos[0]?.detalle || [];
  checkEq('★ el reparto se puede desplegar', reparto.length, 2);
  check('★ FIFO tambien en el reparto que se ve', reparto[0]?.valor, 1000000);
  check('   y el resto en la siguiente factura', reparto[1]?.valor, 300000);
  checkEq('★ cada linea dice a que factura fue',
    reparto.every((d) => Number(d.factura) > 0), true);
  check('★ el reparto suma exactamente el pago',
    reparto.reduce((t, d) => t + Number(d.valor), 0), 1300000);

  // Un abono suelto NO se colapsa: sigue siendo su propia fila.
  await creditos.registrarAbono(1, c3.id, { usuario_id: 1, valor: 50000, metodo: 'Efectivo' });
  const movs3 = await creditos.getEstadoCuenta(1, '777');
  const suelto = movs3.filter((m) => m.tipo === 'abono' && !m.es_pago_total);
  checkEq('★ un abono suelto sigue siendo su propia fila', suelto.length, 1);
  checkEq('   sin reparto que desplegar', suelto[0]?.detalle?.length ?? 0, 0);
  checkEq('   y ese si se puede anular', suelto[0]?.anulable, true);

  // ── La baranda del doble clic ────────────────────────────────────────────
  await debeFallar('★ el mismo pago total no entra dos veces',
    () => creditos.registrarAbonoTotalCredito(1, cli, 1300000, 'Efectivo', 1, 1),
    'ya se registró');

  // ── Anular un abono suelto ───────────────────────────────────────────────
  await db.exec(`
    INSERT INTO clientes (negocio_id, nombre, cedula) VALUES (1, 'CLIENTE ANULA', '888');
    INSERT INTO facturas (numero, sucursal_id, nombre_cliente, cedula, estado, fecha)
      VALUES (904, 1, 'CLIENTE ANULA', '888', 'Credito', NOW());
  `);
  const cli2 = (await q(`SELECT id FROM clientes WHERE cedula='888'`))[0].id;
  const f904 = (await q(`SELECT id FROM facturas WHERE numero=904`))[0].id;
  const cy = await pool.connect();
  await crRepo.create(cy, { factura_id: f904, cliente_id: cli2, sucursal_id: 1, valor_total: 500000, cuota_inicial: 0 });
  cy.release();
  const cAnula = (await q(`SELECT id FROM creditos WHERE factura_id=$1`, [f904]))[0].id;

  await creditos.registrarAbono(1, cAnula, { usuario_id: 1, valor: 500000, metodo: 'Efectivo' });
  const [antes] = await q(`SELECT estado, total_abonado FROM creditos WHERE id=$1`, [cAnula]);
  checkEq('el crédito quedó saldado con el abono', antes.estado, 'Saldado');

  const abonoId = (await q(`SELECT id FROM abonos_credito WHERE credito_id=$1`, [cAnula]))[0].id;

  await debeFallar('★ anular EXIGE motivo',
    () => creditos.anularAbonoCredito(1, abonoId, { motivo: '' }), 'motivo');

  const an = await creditos.anularAbonoCredito(1, abonoId, { motivo: 'se registró por error', usuario_id: 1 });
  check('★ se anuló por su valor', an.valor, 500000);
  checkEq('★ y el crédito VOLVIÓ a estar activo', an.reabierto, true);

  const [desp] = await q(`SELECT estado, total_abonado FROM creditos WHERE id=$1`, [cAnula]);
  checkEq('   el estado quedó Activo', desp.estado, 'Activo');
  check('   y lo abonado bajó', desp.total_abonado, 0);

  const [ab] = await q(`SELECT anulado, valor_anulado, motivo_anulacion FROM abonos_credito WHERE id=$1`, [abonoId]);
  checkEq('★ el abono NO se borró: quedó marcado', ab.anulado, true);
  checkEq('★ con el motivo que escribió la persona',
    String(ab.motivo_anulacion).includes('se registró por error'), true);

  // El abono anulado SE VE (con su motivo) pero NO baja la deuda. Ocultarlo
  // cuadraria el numero y borraria la explicacion; contarlo devolveria el
  // descuadre entre el extracto y la deuda total. Mismo criterio que prestamos.
  const movs2 = await creditos.getEstadoCuenta(1, '888');
  const abAnul = movs2.filter((m) => m.tipo === 'abono');
  checkEq('★ el abono anulado SIGUE en el extracto', abAnul.length, 1);
  checkEq('★ marcado como anulado', abAnul[0]?.anulado, true);
  checkEq('   con el motivo a la vista',
    String(abAnul[0]?.motivo_anulacion).includes('se registró por error'), true);
  checkEq('★ pero NO cuenta en el saldo', abAnul[0]?.saldo, null);
  checkEq('★ y ya no se puede volver a anular desde el extracto',
    abAnul[0]?.anulable, false);
  // La deuda que ve el extracto vuelve a ser la del credito completo.
  const ultimo = [...movs2].reverse().find((m) => m.saldo !== null);
  check('★ el extracto vuelve a mostrar la deuda completa', ultimo?.saldo, 500000);

  await debeFallar('no se puede anular dos veces',
    () => creditos.anularAbonoCredito(1, abonoId, { motivo: 'otra vez' }), 'ya está anulado');

  // ── El pago total de PRESTAMOS tambien se puede desplegar ────────────────
  //
  // Prestamos ya mostraba el pago como UNA linea, pero no habia forma de ver en
  // que se aplico sin abrir prestamo por prestamo. Las dos pantallas son la
  // misma vista compartida: si una despliega y la otra no, el usuario cree que
  // le falta informacion en la que no lo hace.
  {
    // Se busca a quien SI tenga un pago total, en vez de fijar un id: el orden
    // de las secciones puede cambiar y una prueba anclada a un id miente en
    // silencio cuando eso pasa.
    const [dueno] = await q(`
      SELECT at.persona_id
        FROM abonos_totales at
       WHERE at.tipo_persona = 'prestatario'
         AND COALESCE(at.destino, 'prestamo') = 'prestamo'
         AND EXISTS (SELECT 1 FROM abonos_prestamo ap WHERE ap.abono_total_id = at.id)
       LIMIT 1`);
    checkEq('★ hay un pago total de préstamos para revisar', Boolean(dueno), true);
    const movsP = await prestamos.getEstadoCuenta(1, 'prestatario', dueno.persona_id);
    const pagosTotales = movsP.filter((m) => m.es_pago_total);
    checkEq('★ prestamos marca sus pagos totales', pagosTotales.length > 0, true);
    const conReparto = pagosTotales.filter((m) => (m.detalle || []).length > 0);
    checkEq('★ y traen su reparto para desplegar', conReparto.length > 0, true);
    const d0 = conReparto[0];
    check('★ el reparto suma lo que el pago aplico',
      (d0.detalle || []).reduce((t, x) => t + Number(x.valor), 0), Number(d0.abono));
    checkEq('★ cada linea dice a que prestamo fue',
      (d0.detalle || []).every((x) => Number(x.prestamo_id) > 0 && x.producto), true);
    // Un abono suelto de prestamos NO se marca como pago total.
    const sueltos = movsP.filter((m) => m.tipo === 'abono' && !m.es_pago_total);
    checkEq('★ un abono suelto de prestamos no finge ser pago total',
      sueltos.every((m) => (m.detalle || []).length === 0), true);
  }

  // ── Lo que ve el cliente en papel ────────────────────────────────────────
  // El extracto, el PDF y el Excel salen de la MISMA lista. Mostrar el abono
  // anulado sin marcarlo haria que la fila de totales del Excel dijera que el
  // cliente abono mas de lo que cuenta, y no cuadraria contra la deuda.
  const movPdf = abAnul[0];
  checkEq('★ el PDF lo puede atenuar y explicar', {
    atenuado: movPdf.anulado === true,
    hayMotivo: Boolean(movPdf.motivo_anulacion),
  }, { atenuado: true, hayMotivo: true });
  // Regla exacta que aplica la hoja de Excel compartida.
  const sinContar = movPdf.anulado_total === true
    ? Number(movPdf.abono || 0)
    : Math.min(Number(movPdf.abono || 0), Number(movPdf.valor_anulado || 0));
  check('★ el Excel no lo suma en los totales',
    Number(movPdf.abono || 0) - sinContar, 0);
}

console.log('\n' + '─'.repeat(62));
if (fallos) { console.log(`✗ ${fallos} FALLO(S) de ${fallos + pasados}`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
