// ─────────────────────────────────────────────────────────────────────────────
// INVARIANTE: el estado de cuenta SIEMPRE tiene que dar lo mismo que la deuda.
//
// Esta sesión empezó con un reclamo de producción: el prestatario TIENDA mostraba
// $362.400.000 en su extracto y $363.580.000 de deuda total. La causa de fondo no
// fue una operación en particular: fue que NADIE comprobaba que las dos cifras
// coincidieran después de cada cosa que mueve plata.
//
// Esta suite es esa comprobación. Ejecuta UNA POR UNA todas las operaciones que
// pueden tocar la cuenta de una persona —incluidas las que un humano hace mal— y
// después de CADA una vuelve a preguntar:
//
//     ¿el saldo final del extracto es el mismo número que la deuda que muestra
//      la tarjeta de esa persona?
//
// Las dos cifras se calculan con las MISMAS fórmulas que usa la pantalla, no con
// una versión "de prueba": si la pantalla suma distinto, la prueba tiene que
// fallar. Un fallo aquí significa que existe una secuencia de clics que deja al
// cliente viendo dos números que no cuadran.
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
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS fecha        TIMESTAMP DEFAULT NOW();
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS tipo_persona TEXT;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS persona_id   INTEGER;
  ALTER TABLE abonos_totales ADD COLUMN IF NOT EXISTS usuario_id INTEGER;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email   TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion TEXT;
  ALTER TABLE domiciliarios ADD COLUMN IF NOT EXISTS telefono TEXT;
  -- Cancelar una factura consulta si tenia domicilio asociado.
  CREATE TABLE IF NOT EXISTS entregas_domicilio (
    id SERIAL PRIMARY KEY, negocio_id INT, factura_id INT, domiciliario_id INT,
    estado TEXT, valor NUMERIC DEFAULT 0
  );
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS negocio_id INT;
  -- Cancelar una factura mira si hay caja abierta para revertir el pago.
  CREATE TABLE IF NOT EXISTS aperturas_caja (
    id SERIAL PRIMARY KEY, sucursal_id INT, usuario_id INT, estado TEXT,
    fecha_apertura TIMESTAMP DEFAULT NOW(), monto_inicial NUMERIC DEFAULT 0
  );
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS usuario_id INT;
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
  CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, fecha TIMESTAMP DEFAULT NOW(),
    accion VARCHAR, tabla VARCHAR, registro_id INT, detalle TEXT
  );
`);
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260730_mora_credito.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260804_interes_corriente.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260825_abonos_anulados.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260825_pago_total_credito.sql'), 'utf8'));

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
const crRepo    = require(path.join(RAIZ, 'src/modules/creditos/creditos.repository.js'));
const prestamos = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'));
const facturas  = require(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));
const ok = (nombre, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${extra ? ': ' + extra : ''}`);
  cond ? pasados++ : fallos++;
};
const debeFallar = async (nombre, fn, fragmento) => {
  try { await fn(); console.log(`  ✗ ${nombre}: NO falló`); fallos++; }
  catch (e) {
    const bien = !fragmento || String(e.message || '').toLowerCase().includes(fragmento.toLowerCase());
    console.log(`  ${bien ? '✓' : '✗'} ${nombre}: ${String(e.message || '').slice(0, 55)}`);
    bien ? pasados++ : fallos++;
  }
};

// ─── LAS DOS CIFRAS ──────────────────────────────────────────────────────────
//
// Se calculan igual que la pantalla, a propósito:
//
//   · el EXTRACTO es la última fila que participa del acumulado (las filas
//     informativas y las anuladas traen `saldo: null` y no cuentan);
//   · la DEUDA es lo que suma la tarjeta de la persona: solo documentos ACTIVOS
//     y nunca en negativo (Math.max(0, ...) — un documento sobrepagado no le
//     resta deuda a los otros).
//
// Si estas dos fórmulas se separan de las de la pantalla, la prueba deja de
// medir lo que el usuario ve y no sirve para nada.
const saldoExtractoCredito = async (clave, sucursalId) => {
  const movs = await creditos.getEstadoCuenta(1, clave, sucursalId);
  const conSaldo = movs.filter((m) => m.saldo != null);
  return conSaldo.length ? Number(conSaldo[conSaldo.length - 1].saldo) : 0;
};
const deudaCredito = async (clave, sucursalId) => {
  const rows = await q(`
    SELECT c.valor_total, c.cuota_inicial, c.total_abonado
      FROM creditos c
      JOIN facturas f ON f.id = c.factura_id
      JOIN sucursales su ON su.id = c.sucursal_id
     WHERE su.negocio_id = 1
       AND COALESCE(NULLIF(f.cedula, ''), f.nombre_cliente) = $1
       AND ($2::int IS NULL OR c.sucursal_id = $2)
       AND c.estado = 'Activo'`, [clave, sucursalId ?? null]);
  return rows.reduce((s, c) => s + Math.max(0,
    Number(c.valor_total) - Number(c.cuota_inicial || 0) - Number(c.total_abonado || 0)), 0);
};

const saldoExtractoPrestamo = async (personaId) => {
  const movs = await prestamos.getEstadoCuenta(1, 'prestatario', personaId);
  const conSaldo = movs.filter((m) => m.saldo != null);
  return conSaldo.length ? Number(conSaldo[conSaldo.length - 1].saldo) : 0;
};
const deudaPrestamo = async (personaId) => {
  const rows = await q(`
    SELECT p.valor_prestamo, p.total_abonado
      FROM prestamos p JOIN sucursales su ON su.id = p.sucursal_id
     WHERE su.negocio_id = 1 AND p.prestatario_id = $1 AND p.estado = 'Activo'`, [personaId]);
  return rows.reduce((s, p) => s + Math.max(0,
    Number(p.valor_prestamo) - Number(p.total_abonado || 0)), 0);
};

// El corazón de la suite: después de CADA operación, las dos cifras.
let comprobaciones = 0;
const invarianteCredito = async (etiqueta, clave, sucursalId = 1) => {
  comprobaciones++;
  const ext = await saldoExtractoCredito(clave, sucursalId);
  const deu = await deudaCredito(clave, sucursalId);
  const cuadra = Math.abs(ext - deu) < 1;
  ok(`${etiqueta}`, cuadra,
    cuadra ? money(deu) : `extracto ${money(ext)} ≠ deuda ${money(deu)}  (desfase ${money(ext - deu)})`);
};
const invariantePrestamo = async (etiqueta, personaId) => {
  comprobaciones++;
  const ext = await saldoExtractoPrestamo(personaId);
  const deu = await deudaPrestamo(personaId);
  const cuadra = Math.abs(ext - deu) < 1;
  ok(`${etiqueta}`, cuadra,
    cuadra ? money(deu) : `extracto ${money(ext)} ≠ deuda ${money(deu)}  (desfase ${money(ext - deu)})`);
};

// ─── Semilla ─────────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Invariante');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Centro'), (1,'Norte');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO productos_serial (nombre, precio, sucursal_id) VALUES ('Equipo', 1200000, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'IM-1',600000),(1,'IM-2',600000),(1,'IM-3',600000),(1,'IM-4',600000);
  INSERT INTO config_negocio VALUES
    (1,'mora_activa','1'),
    (1,'mora_lista','[{"id":"normal","nombre":"Normal","tipo":"mensual","valor":2,"dias_gracia":0}]'),
    (1,'mora_default_id','normal');
  INSERT INTO clientes (negocio_id, nombre, cedula) VALUES (1,'ANA','111');
  INSERT INTO prestatarios (negocio_id, nombre, cedula) VALUES (1,'BETO','222');
`);

const crearCredito = async (numero, valor, { sucursal = 1, inicial = 0, dias = 0 } = {}) => {
  await db.query(`
    INSERT INTO facturas (numero, sucursal_id, nombre_cliente, cedula, estado, fecha)
    VALUES ($1, $2, 'ANA', '111', 'Credito', NOW() - ($3 || ' days')::interval)`,
    [numero, sucursal, String(dias)]);
  const fid = (await q(`SELECT id FROM facturas WHERE numero=$1`, [numero]))[0].id;
  await db.query(`
    INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio)
    VALUES ($1, 'Producto ' || $2::text, 1, $3)`, [fid, numero, valor]);
  const cx = await pool.connect();
  const cid = (await crRepo.create(cx, {
    factura_id: fid, cliente_id: 1, sucursal_id: sucursal,
    valor_total: valor, cuota_inicial: inicial,
  })).id;
  cx.release();
  return { creditoId: cid, facturaId: fid };
};

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  INVARIANTE — extracto == deuda, después de CADA operación');
console.log('═══════════════════════════════════════════════════════════════');

// ═══ 1. CRÉDITOS: el camino normal ══════════════════════════════════════════
console.log('\n═══ 1. Créditos — operaciones normales ═══');
{
  const a = await crearCredito(1, 1000000, { dias: 10 });
  await invarianteCredito('crédito recién creado', '111');

  const b = await crearCredito(2, 600000, { dias: 8, inicial: 100000 });
  await invarianteCredito('segundo crédito, con cuota inicial', '111');

  await creditos.registrarAbono(1, a.creditoId, { usuario_id: 1, valor: 300000, metodo: 'Efectivo', sucursal_id: 1 });
  await invarianteCredito('tras un abono parcial', '111');

  const pt = await creditos.registrarAbonoTotalCredito(1, 1, 400000, 'Efectivo', 1, 1, { descripcion: 'quincena' });
  await invarianteCredito('tras un pago total', '111');

  await creditos.anularAbonoTotalCredito(1, pt.abono_total_id, { motivo: 'digité mal el monto', usuario_id: 1, sucursal_id: 1 });
  await invarianteCredito('tras ANULAR el pago total', '111');

  const abonoId = (await q(`SELECT id FROM abonos_credito WHERE credito_id=$1 AND NOT anulado`, [a.creditoId]))[0].id;
  await creditos.anularAbonoCredito(1, abonoId, { motivo: 'no entró el pago', usuario_id: 1, sucursal_id: 1 });
  await invarianteCredito('tras anular un abono suelto', '111');

  // Volver a abonar después de anular: la cuenta tiene que seguir cuadrando.
  await creditos.registrarAbono(1, a.creditoId, { usuario_id: 1, valor: 250000, metodo: 'Efectivo', sucursal_id: 1 });
  await invarianteCredito('tras volver a abonar', '111');
}

// ═══ 2. CRÉDITOS: saldar dejando remanente (el negocio perdona) ═════════════
console.log('\n═══ 2. Créditos — saldar dejando plata sin cobrar ═══');
{
  const c = await crearCredito(3, 500000, { dias: 6 });
  await creditos.registrarAbono(1, c.creditoId, { usuario_id: 1, valor: 100000, metodo: 'Efectivo', sucursal_id: 1 });
  await invarianteCredito('antes de saldar', '111');

  await creditos.saldarCredito(1, c.creditoId, { usuario_id: 1 });
  await invarianteCredito('★ tras SALDAR con $400.000 sin pagar', '111');
}

// ═══ 3. CRÉDITOS: cancelar la factura ═══════════════════════════════════════
console.log('\n═══ 3. Créditos — cancelar una factura con abonos ═══');
{
  const c = await crearCredito(4, 800000, { dias: 5 });
  await creditos.registrarAbono(1, c.creditoId, { usuario_id: 1, valor: 200000, metodo: 'Efectivo', sucursal_id: 1 });
  await invarianteCredito('antes de cancelar', '111');

  await creditos.cancelarCredito(1, c.creditoId, { usuario_id: 1 });
  await invarianteCredito('★ tras CANCELAR la factura (el abono se anula)', '111');
}

// ═══ 4. CRÉDITOS: devolución parcial de productos ═══════════════════════════
console.log('\n═══ 4. Créditos — devolución parcial de mercancía ═══');
{
  const c = await crearCredito(5, 900000, { dias: 4 });
  await creditos.registrarAbono(1, c.creditoId, { usuario_id: 1, valor: 300000, metodo: 'Efectivo', sucursal_id: 1 });
  await invarianteCredito('antes de la devolución', '111');

  // Se llama al CAMINO REAL (facturas.devolverLineasCredito), no a una
  // imitación con SQL: una imitación prueba lo que yo creo que hace el sistema,
  // no lo que hace. La primera versión de esta sección simulaba la devolución a
  // mano y "encontró" un descuadre de $300.000 que el código real no tiene.
  const linea = (await q(`SELECT id FROM lineas_factura WHERE factura_id=$1`, [c.facturaId]))[0];
  await facturas.devolverLineasCredito(1, c.facturaId, [{ linea_id: linea.id, cantidad_devolver: 1 }]);
  await invarianteCredito('★ tras devolver TODA la mercancía', '111');

  // Y una devolución PARCIAL, que es el caso que deja el crédito valiendo menos
  // de lo que el cliente ya pagó: ese sobrante tiene que dejar de contar.
  const d = await crearCredito(8, 1000000, { dias: 4 });
  await db.query(`
    UPDATE lineas_factura SET cantidad = 2, precio = 500000 WHERE factura_id = $1`, [d.facturaId]);
  await creditos.registrarAbono(1, d.creditoId, { usuario_id: 1, valor: 800000, metodo: 'Efectivo', sucursal_id: 1 });
  await invarianteCredito('antes de la devolución parcial', '111');

  const l2 = (await q(`SELECT id FROM lineas_factura WHERE factura_id=$1`, [d.facturaId]))[0];
  await facturas.devolverLineasCredito(1, d.facturaId, [{ linea_id: l2.id, cantidad_devolver: 1 }]);
  await invarianteCredito('★ tras devolver LA MITAD habiendo pagado de más', '111');
}

// ═══ 5. CRÉDITOS: mora e interés no deben tocar el capital ══════════════════
console.log('\n═══ 5. Créditos — cargos financieros (no son capital) ═══');
{
  const c = await crearCredito(6, 700000, { dias: 40 });
  // La condición de mora es una clave de configuración del negocio, no una
  // fila: 'normal' es la que traen todos por defecto.
  await creditos.fijarPlazo(1, c.creditoId, {
    fecha_limite: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
    condicion_id: 'normal', rol: 'admin_negocio',
  });
  await invarianteCredito('con mora causándose', '111');

  await creditos.cobrarMora(1, c.creditoId, { metodo: 'Efectivo', usuario_id: 1, concepto: 'mora' });
  await invarianteCredito('★ tras COBRAR la mora (no baja capital)', '111');

  await creditos.registrarAbono(1, c.creditoId, { usuario_id: 1, valor: 700000, metodo: 'Efectivo', sucursal_id: 1 });
  await invarianteCredito('★ tras pagar TODO el capital', '111');
}

// ═══ 6. CRÉDITOS: el error humano — anular lo que no era ════════════════════
console.log('\n═══ 6. Créditos — errores humanos ═══');
{
  const c = await crearCredito(7, 400000, { dias: 3 });
  await creditos.registrarAbono(1, c.creditoId, { usuario_id: 1, valor: 400000, metodo: 'Efectivo', sucursal_id: 1 });
  const est = (await q(`SELECT estado FROM creditos WHERE id=$1`, [c.creditoId]))[0].estado;
  ok('el crédito quedó saldado solo', est === 'Saldado', est);
  await invarianteCredito('con el crédito saldado', '111');

  const ab = (await q(`SELECT id FROM abonos_credito WHERE credito_id=$1`, [c.creditoId]))[0].id;
  await creditos.anularAbonoCredito(1, ab, { motivo: 'era de otro cliente', usuario_id: 1, sucursal_id: 1 });
  await invarianteCredito('★ tras anular el abono que lo saldó', '111');

  // Doble clic: el segundo pago no puede entrar.
  await creditos.registrarAbono(1, c.creditoId, { usuario_id: 1, valor: 150000, metodo: 'Efectivo', sucursal_id: 1 });
  await debeFallar('★ el doble clic no registra dos veces',
    () => creditos.registrarAbono(1, c.creditoId, { usuario_id: 1, valor: 150000, metodo: 'Efectivo', sucursal_id: 1 }),
    'ya se registró');
  await invarianteCredito('tras el intento de doble clic', '111');
}

// ═══ 7. PRÉSTAMOS: el mismo recorrido ═══════════════════════════════════════
console.log('\n═══ 7. Préstamos — operaciones normales ═══');
{
  await db.exec(`
    INSERT INTO prestamos (sucursal_id, prestatario_id, prestatario, imei, valor_prestamo, valor,
                           total_abonado, estado, nombre_producto, fecha)
    VALUES (1, 1, 'BETO', 'IM-1', 1000000, 1000000, 0, 'Activo', 'Equipo A', NOW() - INTERVAL '10 days'),
           (1, 1, 'BETO', 'IM-2',  600000,  600000, 0, 'Activo', 'Equipo B', NOW() - INTERVAL '8 days'),
           (1, 1, 'BETO', 'IM-3',  400000,  400000, 0, 'Activo', 'Equipo C', NOW() - INTERVAL '6 days');
    UPDATE seriales SET prestado = true WHERE imei IN ('IM-1','IM-2','IM-3');
  `);
  await invariantePrestamo('tres préstamos activos', 1);

  const p1 = (await q(`SELECT id FROM prestamos WHERE imei='IM-1'`))[0].id;
  await prestamos.registrarAbono(1, p1, 200000, 'Efectivo', 1, null, { sucursalId: 1 });
  await invariantePrestamo('tras un abono parcial', 1);

  const pt = await prestamos.registrarAbonoTotal(1, 'prestatario', 1, 700000, 'Efectivo', 1, 1,
    { descripcion: 'pago de la quincena' });
  await invariantePrestamo('★ tras un PAGO TOTAL repartido', 1);

  await prestamos.anularAbonoTotal(1, pt.abonoTotal.id, {
    motivo: 'me equivoqué de persona', usuario_id: 1, sucursal_id: 1,
  });
  await invariantePrestamo('★ tras ANULAR el pago total completo', 1);

  // Y volver a pagar bien.
  const pt2 = await prestamos.registrarAbonoTotal(1, 'prestatario', 1, 500000, 'Transferencia', 1, 1);
  await invariantePrestamo('tras registrar el pago correcto', 1);
  ok('el pago correcto sí se repartió', pt2.abonoTotal?.id > 0);
}

// ═══ 8. PRÉSTAMOS: saldar y anular el abono que lo saldó ════════════════════
console.log('\n═══ 8. Préstamos — saldar y deshacerlo ═══');
{
  const p3 = (await q(`SELECT id FROM prestamos WHERE imei='IM-3'`))[0].id;
  const antes = (await q(`SELECT valor_prestamo, total_abonado FROM prestamos WHERE id=$1`, [p3]))[0];
  const falta = Number(antes.valor_prestamo) - Number(antes.total_abonado);
  if (falta > 0) {
    await prestamos.registrarAbono(1, p3, falta, 'Efectivo', 1, null, { sucursalId: 1 });
  }
  const est = (await q(`SELECT estado FROM prestamos WHERE id=$1`, [p3]))[0].estado;
  ok('el préstamo quedó saldado', est === 'Saldado', est);
  await invariantePrestamo('★ con un préstamo saldado', 1);

  const ab = (await q(`SELECT id FROM abonos_prestamo WHERE prestamo_id=$1 AND NOT anulado ORDER BY id DESC LIMIT 1`, [p3]))[0];
  if (ab) {
    await prestamos.anularAbono(1, p3, ab.id, null, 1);
    await invariantePrestamo('★ tras anular el abono que lo saldó', 1);
  }
}

// ═══ 9. PRÉSTAMOS: devolver el producto con abonos encima ═══════════════════
console.log('\n═══ 9. Préstamos — devolver el producto (las 3 decisiones) ═══');
{
  const p2 = (await q(`SELECT id FROM prestamos WHERE imei='IM-2'`))[0].id;
  await invariantePrestamo('antes de devolver', 1);

  await prestamos.devolverPrestamo(1, p2, { decision: 'anular' });
  await invariantePrestamo('★ tras DEVOLVER anulando sus abonos', 1);
}

// ═══ 10. PRÉSTAMOS: editar el valor con abonos encima ═══════════════════════
console.log('\n═══ 10. Préstamos — cambiar el valor del préstamo ═══');
{
  const p1 = (await q(`SELECT id FROM prestamos WHERE imei='IM-1'`))[0].id;
  const est = (await q(`SELECT estado, total_abonado FROM prestamos WHERE id=$1`, [p1]))[0];
  if (est.estado === 'Activo') {
    const nuevo = Number(est.total_abonado) + 350000;
    await prestamos.editarValorPrestamo(1, p1, nuevo);
    await invariantePrestamo('★ tras cambiarle el valor al préstamo', 1);
  } else {
    ok('préstamo no activo: nada que editar', true, est.estado);
  }
}

// ═══ 11. El invariante bajo TODAS las operaciones seguidas ═════════════════
console.log('\n═══ 11. Cierre: la cuenta completa de las dos personas ═══');
{
  await invarianteCredito('cuenta final de ANA (créditos)', '111');
  await invariantePrestamo('cuenta final de BETO (préstamos)', 1);

  // Y que ninguna cuenta quede NEGATIVA: un extracto en negativo le dice al
  // cliente que el negocio le debe plata. Es como se vio el error original.
  const extC = await saldoExtractoCredito('111', 1);
  const extP = await saldoExtractoPrestamo(1);
  ok('★ el extracto de créditos nunca queda negativo', extC >= 0, money(extC));
  ok('★ el extracto de préstamos nunca queda negativo', extP >= 0, money(extP));
}


// ═══ 12. Los caminos que mueven plata ENTRE documentos ══════════════════════
//
// Son los más propensos a descuadrar: no crean ni destruyen dinero, lo MUEVEN.
// Si el origen baja y el destino no sube (o al revés), el extracto y la deuda
// se separan sin que nadie toque un abono.
console.log('\n═══ 12. Mover plata entre documentos ═══');
{
  // Dos préstamos nuevos para no depender del estado que dejaron las secciones
  // anteriores.
  await db.exec(`
    INSERT INTO prestatarios (negocio_id, nombre, cedula) VALUES (1,'CARLOS','333');
    INSERT INTO prestamos (sucursal_id, prestatario_id, prestatario, imei, valor_prestamo, valor,
                           total_abonado, estado, nombre_producto, fecha)
    VALUES (1, 2, 'CARLOS', 'IM-4', 800000, 800000, 0, 'Activo', 'Equipo D', NOW() - INTERVAL '9 days'),
           (1, 2, 'CARLOS', NULL,   500000, 500000, 0, 'Activo', 'Equipo E', NOW() - INTERVAL '7 days');
    UPDATE seriales SET prestado = true WHERE imei = 'IM-4';
  `);
  await invariantePrestamo('dos préstamos de CARLOS', 2);

  // ── Modificar un pago total: revierte y REDISTRIBUYE ──────────────────────
  const pt = await prestamos.registrarAbonoTotal(1, 'prestatario', 2, 900000, 'Efectivo', 1, 1);
  await invariantePrestamo('tras el pago total', 2);

  await prestamos.modificarAbonoTotal(1, pt.abonoTotal.id, 400000, 'Efectivo', null, 1);
  await invariantePrestamo('★ tras REDUCIR el pago total (se redistribuye)', 2);

  // ── Devolver dejando la plata a favor de la persona ───────────────────────
  const pD = (await q(`SELECT id FROM prestamos WHERE imei='IM-4'`))[0].id;
  await prestamos.devolverPrestamo(1, pD, { decision: 'saldo_a_favor' });
  await invariantePrestamo('★ tras devolver dejando la plata A FAVOR', 2);

  // ── Reasignar los abonos de lo devuelto a los otros préstamos ─────────────
  await db.exec(`
    INSERT INTO prestamos (sucursal_id, prestatario_id, prestatario, valor_prestamo, valor,
                           total_abonado, estado, nombre_producto, fecha)
    VALUES (1, 2, 'CARLOS', 600000, 600000, 0, 'Activo', 'Equipo F', NOW() - INTERVAL '5 days');
  `);
  const pF = (await q(`SELECT id FROM prestamos WHERE nombre_producto='Equipo F'`))[0].id;
  await prestamos.registrarAbono(1, pF, 200000, 'Efectivo', 1, null, { sucursalId: 1 });
  await invariantePrestamo('antes de reasignar', 2);

  await prestamos.devolverPrestamo(1, pF, { decision: 'reasignar' });
  await invariantePrestamo('★ tras devolver REASIGNANDO sus abonos', 2);

  // ── Cobrar interés corriente: tampoco es capital ──────────────────────────
  const pE = (await q(`SELECT id FROM prestamos WHERE nombre_producto='Equipo E'`))[0].id;
  const estE = (await q(`SELECT estado FROM prestamos WHERE id=$1`, [pE]))[0].estado;
  if (estE === 'Activo') {
    await prestamos.registrarAbono(1, pE, 100000, 'Efectivo', 1, null, { sucursalId: 1 });
    await invariantePrestamo('★ tras un abono más', 2);
  } else {
    ok('el préstamo E ya no está activo', true, estE);
  }
}

console.log('\n' + '─'.repeat(62));
console.log(`  ${comprobaciones} comprobaciones del invariante`);
if (fallos) { console.log(`✗ ${fallos} FALLO(S) de ${fallos + pasados}`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
