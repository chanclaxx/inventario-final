// ─────────────────────────────────────────────────────────────────────────────
// EDITAR UNA FACTURA A CRÉDITO — el crédito sigue a la factura.
//
// Reportado desde producción (New Store Caliwood, factura #6681, Electrocomfort):
// una venta a crédito de $3.940.000 se rebajó a $3.790.000 editando los precios
// desde Facturas. `editarFactura` reescribía `lineas_factura` y NUNCA tocaba
// `creditos.valor_total`, así que:
//   · la factura y su PDF decían $3.790.000;
//   · el crédito, el estado de cuenta y el bloque del crédito en el MISMO PDF
//     seguían diciendo $3.940.000;
//   · el abono aceptó $3.940.000 y lo dio por saldado.
//
// Lo que esta suite protege:
//   · Sección 1 — una factura de CONTADO se edita exactamente igual que antes.
//   · Sección 2 — el caso real: rebajar el precio baja el crédito, el extracto,
//     el resumen del PDF y lo que el abono acepta.
//   · Sección 3 — el ajuste es por DIFERENCIA: editar solo el cliente no toca un
//     crédito, ni siquiera uno que ya venía descuadrado.
//   · Sección 4 — bajar por debajo de lo pagado se RECHAZA y no deja nada a medias.
//   · Sección 5 — subir el precio de un crédito saldado lo vuelve a abrir.
//   · Sección 6 — con devolución parcial, extracto y crédito siguen cuadrando.
//   · Sección 7 — editar los pagos mueve la cuota inicial.
//   · Sección 8 — bajar justo hasta lo pagado lo salda.
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
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS prestamo_id          INTEGER;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS tipo_retoma          TEXT;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS producto_serial_id   INTEGER;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS producto_cantidad_id INTEGER;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS sucursal_id          INTEGER;
  ALTER TABLE retomas   ADD COLUMN IF NOT EXISTS fecha        TIMESTAMP DEFAULT NOW();
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular   TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email     TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo_a_favor NUMERIC DEFAULT 0;
  ALTER TABLE domiciliarios ADD COLUMN IF NOT EXISTS telefono TEXT;
  CREATE TABLE IF NOT EXISTS entregas_domicilio (
    id SERIAL PRIMARY KEY, negocio_id INT, factura_id INT, domiciliario_id INT,
    estado TEXT, valor NUMERIC DEFAULT 0
  );
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS negocio_id INT;
  CREATE TABLE IF NOT EXISTS lineas_producto (id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT);
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

const creditos = require(path.join(RAIZ, 'src/modules/creditos/creditos.service.js'));
const crRepo   = require(path.join(RAIZ, 'src/modules/creditos/creditos.repository.js'));
const facturas = require(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));
const check = (nombre, real, esperado) => {
  const ok = Math.abs(Number(real ?? NaN) - Number(esperado)) < 1;
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

// Las dos cifras que el cliente ve, calculadas como la pantalla (ver suite 29).
const saldoExtracto = async (clave) => {
  const movs = await creditos.getEstadoCuenta(1, clave, 1);
  const conSaldo = movs.filter((m) => m.saldo != null);
  return conSaldo.length ? Number(conSaldo[conSaldo.length - 1].saldo) : 0;
};
const deuda = async (clave) => {
  const rows = await q(`
    SELECT c.valor_total, c.cuota_inicial, c.total_abonado FROM creditos c
      JOIN facturas f ON f.id = c.factura_id
     WHERE COALESCE(NULLIF(f.cedula, ''), f.nombre_cliente) = $1 AND c.estado = 'Activo'`, [clave]);
  return rows.reduce((s, c) => s + Math.max(0,
    Number(c.valor_total) - Number(c.cuota_inicial || 0) - Number(c.total_abonado || 0)), 0);
};
const invariante = async (etiqueta, clave) => {
  const ext = await saldoExtracto(clave);
  const deu = await deuda(clave);
  const ok = Math.abs(ext - deu) < 1;
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}: extracto ${money(ext)} ${ok ? '==' : '≠'} deuda ${money(deu)}`);
  ok ? pasados++ : fallos++;
};
const cargoExtracto = async (clave, creditoId) => {
  const movs = await creditos.getEstadoCuenta(1, clave, 1);
  return movs.find((m) => m.tipo === 'credito' && m.credito_id === creditoId)?.cargo;
};
const cred = async (id) => (await q(`SELECT * FROM creditos WHERE id = $1`, [id]))[0];

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Caliwood');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1, 'Principal');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
`);

let numero = 0;
// Crea la factura como la deja `crearFactura`: crédito = Σ líneas, cuota = Σ pagos.
const crearVenta = async ({ cedula, lineas, pagos = [], credito = true }) => {
  numero++;
  const [{ id: fid }] = await q(`
    INSERT INTO facturas (numero, sucursal_id, nombre_cliente, cedula, celular, estado)
    VALUES ($1, 1, $2, $3, '300', $4) RETURNING id`,
    [numero, `CLIENTE ${cedula}`, cedula, credito ? 'Credito' : 'Activa']);
  for (const [nombre, cantidad, precio] of lineas) {
    await q(`INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio) VALUES ($1,$2,$3,$4)`,
      [fid, nombre, cantidad, precio]);
  }
  for (const [metodo, valor] of pagos) {
    await q(`INSERT INTO pagos_factura (factura_id, metodo, valor) VALUES ($1,$2,$3)`, [fid, metodo, valor]);
  }
  if (!credito) return { facturaId: fid };
  const cx = await pool.connect();
  const c = await crRepo.create(cx, {
    factura_id: fid, cliente_id: null, sucursal_id: 1,
    valor_total: lineas.reduce((s, [, cant, p]) => s + cant * p, 0),
    cuota_inicial: pagos.reduce((s, [, v]) => s + v, 0),
  });
  cx.release();
  return { facturaId: fid, creditoId: c.id };
};

// Arma el cuerpo como lo manda ModalEditarFactura: todas las líneas y todos los pagos.
const editar = async (facturaId, { precios = {}, pagos = null, nombre = null } = {}) => {
  const [f] = await q(`SELECT * FROM facturas WHERE id = $1`, [facturaId]);
  const lineas = await q(`SELECT id, cantidad, precio FROM lineas_factura WHERE factura_id = $1 ORDER BY id`, [facturaId]);
  const pagosActuales = await q(`SELECT metodo, valor FROM pagos_factura WHERE factura_id = $1`, [facturaId]);
  return facturas.editarFactura(1, facturaId, {
    nombre_cliente: nombre ?? f.nombre_cliente, cedula: f.cedula, celular: f.celular, notas: null,
    lineas: lineas.map((l, i) => ({ id: l.id, cantidad: l.cantidad, precio: precios[i] ?? Number(l.precio) })),
    pagos: (pagos ?? pagosActuales.map((p) => [p.metodo, Number(p.valor)])).map(([metodo, valor]) => ({ metodo, valor })),
    retoma: null,
  });
};

console.log('\n═══ 1. Factura de CONTADO: igual que antes ═══');
{
  const v = await crearVenta({ cedula: '100', credito: false, lineas: [['Cargador', 2, 50000]], pagos: [['Efectivo', 100000]] });
  const r = await editar(v.facturaId, { precios: { 0: 40000 }, pagos: [['Efectivo', 80000]] });
  check('la línea quedó con el precio nuevo', (await q(`SELECT precio FROM lineas_factura WHERE factura_id=$1`, [v.facturaId]))[0].precio, 40000);
  check('los pagos se reescribieron', (await q(`SELECT SUM(valor) s FROM pagos_factura WHERE factura_id=$1`, [v.facturaId]))[0].s, 80000);
  checkEq('no aparece ningún crédito', (await q(`SELECT COUNT(*)::int n FROM creditos WHERE factura_id=$1`, [v.facturaId]))[0].n, 0);
  checkEq('no reporta ajuste de crédito', r.credito_ajuste, null);
  check('la respuesta trae el total nuevo (la auditoría ya no guarda 0)', r.total, 80000);
  check('y el anterior', r.total_anterior, 100000);
}

console.log('\n═══ 2. El caso real: $3.940.000 rebajada a $3.790.000 ═══');
{
  const v = await crearVenta({ cedula: '901841446', lineas: [
    ['GALAXY A26', 1, 850000], ['GALAXY A17', 1, 480000], ['GALAXY A17', 1, 480000],
    ['REDMI NOTE 15', 1, 710000], ['REDMI NOTE 15', 1, 710000], ['REDMI NOTE 15', 1, 710000],
  ] });
  check('antes: el crédito vale', (await cred(v.creditoId)).valor_total, 3940000);
  await invariante('antes de editar', '901841446');

  const r = await editar(v.facturaId, { precios: { 0: 800000, 1: 460000, 2: 460000, 3: 690000, 4: 690000, 5: 690000 } });
  check('el crédito baja con la factura', (await cred(v.creditoId)).valor_total, 3790000);
  check('el ajuste lo reporta', r.credito_ajuste?.valor_nuevo, 3790000);
  check('el cargo del estado de cuenta es el nuevo', await cargoExtracto('901841446', v.creditoId), 3790000);
  await invariante('tras editar', '901841446');

  const detalle = await facturas.getFacturaById(1, v.facturaId);
  const totalLineas = detalle.lineas.reduce((s, l) => s + Number(l.precio) * Number(l.cantidad), 0);
  check('PDF: total de productos', totalLineas, 3790000);
  check('PDF: valor del crédito en el MISMO documento', detalle.credito?.resumen?.valor_actual, 3790000);
  check('PDF: saldo', detalle.credito?.resumen?.saldo, 3790000);

  await debeFallar('el abono ya no acepta los $3.940.000 viejos',
    () => creditos.registrarAbono(1, v.creditoId, { usuario_id: 1, valor: 3940000, metodo: 'Efectivo', sucursal_id: 1 }));
  await creditos.registrarAbono(1, v.creditoId, { usuario_id: 1, valor: 3790000, metodo: 'Efectivo', sucursal_id: 1 });
  checkEq('con $3.790.000 queda saldado', (await cred(v.creditoId)).estado, 'Saldado');
  await invariante('tras saldar', '901841446');
}

console.log('\n═══ 3. Editar solo el cliente no toca el crédito ═══');
{
  const v = await crearVenta({ cedula: '300', lineas: [['iPad', 1, 2650000]] });
  // Un descuadre HEREDADO de antes del arreglo: no es esta edición quien lo corrige.
  await q(`UPDATE creditos SET valor_total = 2450000 WHERE id = $1`, [v.creditoId]);
  const r = await editar(v.facturaId, { nombre: 'NOMBRE CORREGIDO' });
  checkEq('sin ajuste', r.credito_ajuste, null);
  check('valor_total intacto', (await cred(v.creditoId)).valor_total, 2450000);
}

console.log('\n═══ 4. Bajar por debajo de lo pagado se rechaza ═══');
{
  const v = await crearVenta({ cedula: '400', lineas: [['Equipo', 1, 1000000]] });
  await creditos.registrarAbono(1, v.creditoId, { usuario_id: 1, valor: 900000, metodo: 'Efectivo', sucursal_id: 1 });
  await debeFallar('rebajar a $800.000 con $900.000 pagados',
    () => editar(v.facturaId, { precios: { 0: 800000 } }), 'ya pagó');
  check('la línea NO cambió (rollback)', (await q(`SELECT precio FROM lineas_factura WHERE factura_id=$1`, [v.facturaId]))[0].precio, 1000000);
  check('el crédito NO cambió', (await cred(v.creditoId)).valor_total, 1000000);
  check('el abono sigue entero', (await cred(v.creditoId)).total_abonado, 900000);
  await invariante('tras el rechazo', '400');
}

console.log('\n═══ 5. Subir el precio de un crédito saldado lo reabre ═══');
{
  const v = await crearVenta({ cedula: '500', lineas: [['Equipo', 1, 500000]] });
  await creditos.registrarAbono(1, v.creditoId, { usuario_id: 1, valor: 500000, metodo: 'Efectivo', sucursal_id: 1 });
  checkEq('saldado', (await cred(v.creditoId)).estado, 'Saldado');
  const r = await editar(v.facturaId, { precios: { 0: 560000 } });
  checkEq('vuelve a Activo', (await cred(v.creditoId)).estado, 'Activo');
  check('debe la diferencia', r.credito_ajuste?.saldo_nuevo, 60000);
  await invariante('tras reabrir', '500');
}

console.log('\n═══ 6. Con devolución parcial ═══');
{
  const v = await crearVenta({ cedula: '600', lineas: [['Cable', 10, 25000], ['Forro', 2, 30000]] });
  const [cable] = await q(`SELECT id FROM lineas_factura WHERE factura_id=$1 ORDER BY id`, [v.facturaId]);
  await facturas.devolverLineasCredito(1, v.facturaId, [{ linea_id: cable.id, cantidad_devolver: 4 }]);
  check('tras devolver 4 cables', (await cred(v.creditoId)).valor_total, 210000);
  await editar(v.facturaId, { precios: { 0: 20000 } });
  check('crédito = Σ precio × cantidad vigente', (await cred(v.creditoId)).valor_total, 6 * 20000 + 2 * 30000);
  check('cargo del extracto = valor original con el precio nuevo', await cargoExtracto('600', v.creditoId), 10 * 20000 + 2 * 30000);
  await invariante('devolución + edición', '600');
}

console.log('\n═══ 7. Editar los pagos mueve la cuota inicial ═══');
{
  const v = await crearVenta({ cedula: '700', lineas: [['Equipo', 1, 1000000]], pagos: [['Efectivo', 100000]] });
  await editar(v.facturaId, { pagos: [['Efectivo', 100000], ['Nequi', 50000]] });
  check('cuota inicial', (await cred(v.creditoId)).cuota_inicial, 150000);
  check('valor intacto', (await cred(v.creditoId)).valor_total, 1000000);
  await invariante('tras cambiar la cuota', '700');
}

console.log('\n═══ 8. Bajar justo hasta lo pagado lo salda ═══');
{
  const v = await crearVenta({ cedula: '800', lineas: [['Equipo', 1, 1000000]] });
  await creditos.registrarAbono(1, v.creditoId, { usuario_id: 1, valor: 950000, metodo: 'Efectivo', sucursal_id: 1 });
  const r = await editar(v.facturaId, { precios: { 0: 950000 } });
  checkEq('queda Saldado', (await cred(v.creditoId)).estado, 'Saldado');
  checkEq('y lo reporta', r.credito_ajuste?.estado, 'Saldado');
  await invariante('saldado por descuento', '800');
}

console.log('\n═══ 9. La corrección de producción: abono anulado en PARTE ═══');
{
  // Reproduce lo que deja scripts/corregir-credito-electrocomfort.js: crédito en
  // el valor de la factura y $150.000 del abono anulados con su motivo.
  const v = await crearVenta({ cedula: '900', lineas: [['Lote', 1, 3790000]] });
  await q(`UPDATE creditos SET valor_total = 3940000 WHERE id = $1`, [v.creditoId]);
  await creditos.registrarAbono(1, v.creditoId, { usuario_id: 1, valor: 3940000, metodo: 'Efectivo', sucursal_id: 1 });
  await q(`UPDATE creditos SET valor_total = 3790000, total_abonado = 3790000 WHERE id = $1`, [v.creditoId]);
  await q(`UPDATE abonos_credito SET valor_anulado = 150000, motivo_anulacion = 'corrección', anulado_en = NOW()
            WHERE credito_id = $1`, [v.creditoId]);

  const detalle = await facturas.getFacturaById(1, v.facturaId);
  const r = detalle.credito.resumen;
  check('recibo: el abono cuenta por lo vigente', r.abonos[0]?.valor, 3790000);
  check('recibo: y conserva lo registrado', r.abonos[0]?.valor_registrado, 3940000);
  check('recibo: total abonado', r.total_abonado, 3790000);
  check('recibo: saldo', r.saldo, 0);
  checkEq('recibo: pagada', r.estado, 'pagada');
  check('extracto: cargo', await cargoExtracto('900', v.creditoId), 3790000);
  const abonoExt = (await creditos.getEstadoCuenta(1, '900', 1)).find((m) => m.tipo === 'abono');
  check('extracto: el abono se ve entero', abonoExt?.abono, 3940000);
  check('extracto: con su parte anulada al lado', abonoExt?.valor_anulado, 150000);
  await invariante('tras la corrección', '900');

  // Un abono anulado del TODO no es un pago: sale del recibo y no baja el saldo corrido.
  const w = await crearVenta({ cedula: '901', lineas: [['Equipo', 1, 1000000]] });
  await creditos.registrarAbono(1, w.creditoId, { usuario_id: 1, valor: 400000, metodo: 'Efectivo', sucursal_id: 1 });
  const [ab] = await q(`SELECT id FROM abonos_credito WHERE credito_id = $1`, [w.creditoId]);
  await creditos.anularAbonoCredito(1, ab.id, { motivo: 'no entró', usuario_id: 1, sucursal_id: 1 });
  const rw = (await facturas.getFacturaById(1, w.facturaId)).credito.resumen;
  checkEq('anulado entero: fuera del recibo', rw.abonos.length, 0);
  check('anulado entero: saldo', rw.saldo, 1000000);
}

console.log(`\n${fallos === 0 ? '✓' : '✗'} ${pasados} verificaciones, ${fallos} fallos\n`);
process.exit(fallos ? 1 : 0);
