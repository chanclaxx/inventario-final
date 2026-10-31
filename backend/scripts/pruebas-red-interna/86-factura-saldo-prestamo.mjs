// ─────────────────────────────────────────────────────────────────────────────
// LA FACTURA DE SALDO DE UN PRÉSTAMO — PGlite.
//
// Auditoría de datos del 30-oct-2026:
//   · anular un abono cancelaba la factura de saldo buscando «#<id>» por texto,
//     sin sede, cuando la marca lleva el NÚMERO desde el 16-jul: no cancelaba
//     la suya y podía cancelar la de OTRO préstamo (Cellsite, 5-sep);
//   · cancelar esa factura como una venta dejaba el préstamo Saldado, el equipo
//     disponible y un egreso en caja por plata que entró por los abonos;
//   · bajar el valor de un préstamo hasta lo abonado no lo saldaba;
//   · un crédito con cuota inicial completa quedaba Activo y fuera de la utilidad.
//
// LA SECCIÓN 1 ES LA DE LO DE SIEMPRE (una factura normal se cancela igual) y
// la 2 la del choque id/número que canceló facturas ajenas en Cellsite.
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
// El reporte de ventas (sección 11) lee también la red interna.
for (const m of [
  '20260725_red_interna.sql', '20260726_red_interna_v2.sql', '20260822_red_interna_envios.sql',
  '20260823_red_interna_control.sql', '20260823_red_interna_cargos_pagables.sql',
  '20260823_remision_variantes.sql', '20260823_lotes_cantidad.sql',
  '20260824_costo_origen_remision.sql', '20260823_valor_acreditado.sql',
]) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}
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


const prestamos = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'));
const pRepo     = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.repository.js'));
const facturas  = require(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'));
const reportes  = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));
const FRONT     = path.resolve(RAIZ, '../frontend/src');

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const uno = async (sql, p = []) => (await q(sql, p))[0];
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));
const ok = (nombre, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${extra ? ': ' + extra : ''}`);
  cond ? pasados++ : fallos++;
};
const falla = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

// La misma cuenta que pinta la pantalla (suite 29): el extracto tiene que dar la deuda.
const cuadra = async (personaId) => {
  const movs = await prestamos.getEstadoCuenta(1, 'prestatario', personaId);
  const conSaldo = movs.filter((m) => m.saldo != null);
  const ext = conSaldo.length ? Number(conSaldo[conSaldo.length - 1].saldo) : 0;
  const deu = (await q(`SELECT p.valor_prestamo, p.total_abonado FROM prestamos p
    WHERE p.prestatario_id = $1 AND p.estado = 'Activo'`, [personaId]))
    .reduce((s, p) => s + Math.max(0, Number(p.valor_prestamo) - Number(p.total_abonado || 0)), 0);
  return { ok: Math.abs(ext - deu) < 1, ext, deu };
};

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tienda');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1, 'Centro');
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO productos_serial (nombre, precio, sucursal_id) VALUES ('iPhone', 3000000, 1);
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id) VALUES ('Cable', 10, 5000, 20000, 1);
  INSERT INTO prestatarios (negocio_id, nombre, cedula) VALUES (1, 'JUANSHOP', '900'), (1, 'ELIANA', '901'), (1, 'RED SHOP', '902');
`);
// Un préstamo con IMEI, prestado. `numero` controlado para reproducir el choque id/número.
const prestar = async ({ numero = null, imei = null, valor, persona = 1, nombre = 'iPhone', productoId = null, cantidad = 1 }) => {
  if (imei) await db.query(`INSERT INTO seriales (producto_id, imei, costo_compra, prestado) VALUES (1, $1, 1000000, true)`, [imei]);
  const { rows: [p] } = await db.query(`
    INSERT INTO prestamos (numero, sucursal_id, prestatario_id, prestatario, imei, producto_id, valor, valor_prestamo,
                           total_abonado, estado, nombre_producto, cantidad_prestada, fecha)
    VALUES ($1, 1, $2, (SELECT nombre FROM prestatarios WHERE id = $2), $3, $4, $5, $5, 0, 'Activo', $6, $7, NOW() - INTERVAL '3 days')
    RETURNING id`, [numero, persona, imei, productoId, valor, nombre, cantidad]);
  return p.id;
};
const abonar = (id, valor, metodo = 'Efectivo') => prestamos.registrarAbono(1, id, valor, metodo, 1, null, { sucursalId: 1 });
const saldoFavor = async (persona) => Number((await uno(`SELECT COALESCE(saldo_a_favor, 0) AS s FROM prestatarios WHERE id = $1`, [persona])).s);
const facturaDe = async (prestamoId) => {
  const p = await uno('SELECT numero, id FROM prestamos WHERE id = $1', [prestamoId]);
  return q(`SELECT id, estado, notas FROM facturas WHERE notas = 'Factura generada por saldo de préstamo #' || $1 ORDER BY id`, [p.numero ?? p.id]);
};

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. ★ Lo de siempre: una factura normal se cancela igual');
{
  const f = await facturas.crearFactura({
    negocio_id: 1, sucursal_id: 1, usuario_id: 1, nombre_cliente: 'Cliente', cedula: '1', celular: '300',
    lineas: [{ nombre_producto: 'Cable', producto_id: 1, cantidad: 2, precio: 20000 }],
    pagos: [{ metodo: 'Efectivo', valor: 40000 }],
  });
  ok('una factura normal no es «de préstamo» (la pantalla sigue su camino de siempre)',
    (await prestamos.infoFacturaDeSaldo(1, f.id)) === null);
  const e = await falla(() => facturas.cancelarFactura(1, f.id));
  ok('…y se cancela como siempre', e === null, e?.message);
  ok('…devolviendo su stock (10 → 8 → 10)', Number((await uno('SELECT stock FROM productos_cantidad WHERE id = 1')).stock) === 10);
}

seccion('2. ★★ Anular un abono cancela la factura de SU préstamo, nunca la de otro');
// El caso de Cellsite: el préstamo A tiene id = el NÚMERO del préstamo B. La
// búsqueda vieja (LIKE '%préstamo #<id>%') cancelaba la factura de B.
const A = await prestar({ numero: 500, imei: 'IMEI-A', valor: 3000000 });
const B = await prestar({ numero: A, imei: 'IMEI-B', valor: 2000000, persona: 2 });
{
  await abonar(A, 3000000);
  await abonar(B, 2000000);
  const [fa] = await facturaDe(A);
  const [fb] = await facturaDe(B);
  ok('los dos quedaron saldados con su factura', fa && fb && fa.estado === 'Activa' && fb.estado === 'Activa',
    `${fa?.notas} · ${fb?.notas}`);
  ok('la marca de B es «#' + A + '» = el ID de A (el choque)', fb.notas.endsWith(`#${A}`));
  const abonoA = await uno('SELECT id FROM abonos_prestamo WHERE prestamo_id = $1 AND NOT anulado', [A]);
  await prestamos.anularAbono(1, A, abonoA.id, null, 1);
  ok('★ la factura de A se canceló', (await uno('SELECT estado FROM facturas WHERE id = $1', [fa.id])).estado === 'Cancelada');
  ok('★★ la de B (marca «#' + A + '») NO se tocó', (await uno('SELECT estado FROM facturas WHERE id = $1', [fb.id])).estado === 'Activa');
  ok('A volvió a deberse y su equipo, a prestado', (await uno('SELECT estado FROM prestamos WHERE id = $1', [A])).estado === 'Activo'
    && (await uno(`SELECT prestado, vendido FROM seriales WHERE imei = 'IMEI-A'`)).prestado === true);
}

seccion('3. Factura vieja con la marca del ID (antes de la numeración)');
{
  const C = await prestar({ numero: null, imei: 'IMEI-C', valor: 1000000 });
  await abonar(C, 1000000);
  const [fc] = await facturaDe(C);
  ok('sin número la marca es el id', fc?.notas.endsWith(`#${C}`));
  // El préstamo recibe número DESPUÉS (backfill): su factura conserva el id.
  await db.query('UPDATE prestamos SET numero = 7777 WHERE id = $1', [C]);
  const abono = await uno('SELECT id FROM abonos_prestamo WHERE prestamo_id = $1 AND NOT anulado', [C]);
  await prestamos.anularAbono(1, C, abono.id, null, 1);
  ok('★ igual se encuentra y se cancela (la marca del id vale si no es ambigua)',
    (await uno('SELECT estado FROM facturas WHERE id = $1', [fc.id])).estado === 'Cancelada');
}

seccion('4. ★ Una factura de saldo NO se cancela como una venta cualquiera');
const [fB] = await facturaDe(B);
{
  const e = await falla(() => facturas.cancelarFactura(1, fB.id));
  ok('★ cancelarla por el camino viejo responde 409 FACTURA_DE_PRESTAMO', e?.code === 'FACTURA_DE_PRESTAMO' && e?.status === 409, e?.message);
  ok('…y no movió nada', (await uno('SELECT estado FROM facturas WHERE id = $1', [fB.id])).estado === 'Activa'
    && (await uno(`SELECT vendido FROM seriales WHERE imei = 'IMEI-B'`)).vendido === true
    && (await uno('SELECT estado FROM prestamos WHERE id = $1', [B])).estado === 'Saldado');
  const info = await prestamos.infoFacturaDeSaldo(1, fB.id);
  ok('la consulta dice de qué préstamo es y cuánto pagó', info?.identificado && info.prestamo.id === B && info.pagado === 2000000,
    JSON.stringify({ id: info?.prestamo?.id, pagado: info?.pagado }));
}

seccion('5. ★ Cancelar la factura de un préstamo pagado — «saldo a favor»');
{
  const antes = await saldoFavor(2);
  const r = await prestamos.cancelarFacturaDeSaldo(1, fB.id, { destino: 'saldo_a_favor', usuarioId: 1 });
  ok('★ el préstamo quedó Devuelto', (await uno('SELECT estado FROM prestamos WHERE id = $1', [B])).estado === 'Devuelto');
  ok('★ el equipo volvió al inventario (ni vendido ni prestado)',
    JSON.stringify(await uno(`SELECT vendido, prestado FROM seriales WHERE imei = 'IMEI-B'`)) === '{"vendido":false,"prestado":false}');
  ok('la factura quedó cancelada', (await uno('SELECT estado FROM facturas WHERE id = $1', [fB.id])).estado === 'Cancelada');
  ok('★ lo pagado ($2.000.000) quedó a favor de la persona', (await saldoFavor(2)) - antes === 2000000, money(await saldoFavor(2)));
  ok('sus abonos quedaron anulados con su motivo',
    (await uno(`SELECT COUNT(*)::int n FROM abonos_prestamo WHERE prestamo_id = $1 AND NOT anulado`, [B])).n === 0);
  ok('★ la caja no tiene ningún egreso (la plata se queda, ahora a favor)',
    (await uno(`SELECT COUNT(*)::int n FROM movimientos_caja`)).n === 0);
  const c = await cuadra(2);
  ok('el estado de cuenta sigue cuadrando con la deuda', c.ok, `${money(c.ext)} / ${money(c.deu)}`);
  ok('la respuesta lo cuenta', r.destino === 'saldo_a_favor' && r.a_favor === 2000000 && r.facturas_canceladas.includes(fB.id));
}

seccion('6. «Pasarlo a sus otros préstamos»');
{
  // Una persona sin otras cuentas: «pasar a sus otros préstamos» abona del
  // más viejo al más nuevo, y con más préstamos abiertos iría al más viejo.
  const D = await prestar({ numero: 601, imei: 'IMEI-D', valor: 1500000, persona: 3 });
  const E = await prestar({ numero: 602, valor: 400000, persona: 3, nombre: 'Cable', productoId: 1, cantidad: 2 });
  await abonar(D, 1500000);
  const [fD] = await facturaDe(D);
  const r = await prestamos.cancelarFacturaDeSaldo(1, fD.id, { destino: 'reasignar', usuarioId: 1 });
  const e = await uno('SELECT estado, total_abonado FROM prestamos WHERE id = $1', [E]);
  ok('★ el otro préstamo ($400.000) quedó pagado con esa plata', e.estado === 'Saldado' && Number(e.total_abonado) === 400000,
    JSON.stringify(e));
  ok('…por el cierre de siempre: tiene su factura de saldo', (await facturaDe(E)).some((f) => f.estado === 'Activa'));
  ok('lo que sobró ($1.100.000) quedó a favor', (await saldoFavor(3)) === 1100000, money(await saldoFavor(3)));
  ok('D devuelto y su equipo de vuelta', (await uno('SELECT estado FROM prestamos WHERE id = $1', [D])).estado === 'Devuelto'
    && (await uno(`SELECT vendido FROM seriales WHERE imei = 'IMEI-D'`)).vendido === false);
  const c = await cuadra(3);
  ok('el estado de cuenta cuadra', c.ok, `${money(c.ext)} / ${money(c.deu)}`);
  ok('la respuesta dice dónde se aplicó', Array.isArray(r.aplicado?.prestamos_afectados));
}

seccion('7. «Devolverle la plata» — exige caja abierta y devuelve solo lo que entró como dinero');
{
  const F = await prestar({ numero: 701, imei: 'IMEI-F', valor: 1000000, persona: 2 });
  await db.query(`UPDATE prestatarios SET saldo_a_favor = 0 WHERE id = 2`);
  await abonar(F, 700000, 'Efectivo');
  await abonar(F, 300000, 'Intercambio');   // pagó una parte con un equipo
  const [fF] = await facturaDe(F);
  const sinCaja = await falla(() => prestamos.cancelarFacturaDeSaldo(1, fF.id, { destino: 'devolver', usuarioId: 1 }));
  ok('★ sin caja abierta: 409 CAJA_CERRADA', sinCaja?.code === 'CAJA_CERRADA', sinCaja?.message);
  ok('…y no se movió NADA (todo en una transacción)',
    (await uno('SELECT estado FROM prestamos WHERE id = $1', [F])).estado === 'Saldado'
    && (await uno('SELECT estado FROM facturas WHERE id = $1', [fF.id])).estado === 'Activa'
    && (await uno(`SELECT vendido FROM seriales WHERE imei = 'IMEI-F'`)).vendido === true);
  await db.query(`INSERT INTO aperturas_caja (sucursal_id, usuario_id, estado) VALUES (1, 1, 'Abierta')`);
  const r = await prestamos.cancelarFacturaDeSaldo(1, fF.id, { destino: 'devolver', metodo: 'Nequi', usuarioId: 1 });
  const eg = await q(`SELECT tipo, valor, metodo, referencia_tipo FROM movimientos_caja`);
  ok('★ egreso en la caja SOLO por lo que entró como dinero ($700.000)',
    eg.length === 1 && eg[0].tipo === 'Egreso' && Number(eg[0].valor) === 700000 && eg[0].metodo === 'Nequi', JSON.stringify(eg));
  ok('★ lo pagado con un equipo ($300.000) no sale de la caja: vuelve a su saldo a favor',
    (await saldoFavor(2)) === 300000 && r.a_favor === 300000, money(await saldoFavor(2)));
  ok('F devuelto', (await uno('SELECT estado FROM prestamos WHERE id = $1', [F])).estado === 'Devuelto');
}

seccion('8. Duplicados viejos: se cancelan todas las facturas de saldo del préstamo');
{
  const G = await prestar({ numero: 801, imei: 'IMEI-G', valor: 500000, persona: 1 });
  await abonar(G, 500000);
  const [fG] = await facturaDe(G);
  // El doble clic de junio: una gemela idéntica de la factura de saldo.
  const { rows: [dup] } = await db.query(`INSERT INTO facturas (sucursal_id, nombre_cliente, cedula, estado, notas, fecha)
    SELECT sucursal_id, nombre_cliente, cedula, estado, notas, fecha FROM facturas WHERE id = $1 RETURNING id`, [fG.id]);
  await db.query(`INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    SELECT $2, nombre_producto, imei, cantidad, precio FROM lineas_factura WHERE factura_id = $1`, [fG.id, dup.id]);
  const r = await prestamos.cancelarFacturaDeSaldo(1, fG.id, { destino: 'saldo_a_favor', usuarioId: 1 });
  ok('★ las dos quedaron canceladas', r.facturas_canceladas.length === 2
    && (await q(`SELECT estado FROM facturas WHERE id = ANY($1::int[])`, [[fG.id, dup.id]])).every((f) => f.estado === 'Cancelada'));
}

seccion('9. Lo que no se puede hacer, y no hace nada');
{
  const e1 = await falla(() => prestamos.cancelarFacturaDeSaldo(1, fB.id, { destino: 'saldo_a_favor' }));
  ok('una factura ya cancelada', e1?.status === 400, e1?.message);
  const H = await prestar({ numero: 901, imei: 'IMEI-H', valor: 300000, persona: 1 });
  await abonar(H, 300000);
  const [fH] = await facturaDe(H);
  const e2 = await falla(() => prestamos.cancelarFacturaDeSaldo(1, fH.id, {}));
  ok('sin decir qué pasa con la plata: 400 DESTINO_REQUERIDO', e2?.code === 'DESTINO_REQUERIDO');
  await db.query('UPDATE prestamos SET prestatario_id = NULL WHERE id = $1', [H]);
  const e3 = await falla(() => prestamos.cancelarFacturaDeSaldo(1, fH.id, { destino: 'saldo_a_favor' }));
  ok('sin persona registrada no hay a quién dejarle saldo: 409 SIN_PERSONA', e3?.code === 'SIN_PERSONA');
  const info = await prestamos.infoFacturaDeSaldo(1, fH.id);
  ok('…y la pantalla lo sabe de antemano (tiene_persona: false)', info?.tiene_persona === false);
  const e4 = await falla(() => prestamos.devolverPrestamo(1, H, { decision: 'saldo_a_favor' }));
  ok('★ «Devolver» un préstamo PAGADO por el camino viejo: 409 PRESTAMO_PAGADO', e4?.code === 'PRESTAMO_PAGADO', e4?.message);
  const e5 = await falla(() => prestamos.devolverParcial(1, H, 1));
  ok('★ …ni en parte (devolución parcial): 409 PRESTAMO_PAGADO', e5?.code === 'PRESTAMO_PAGADO', e5?.message);
  ok('…y H sigue saldado con su factura', (await uno('SELECT estado FROM prestamos WHERE id = $1', [H])).estado === 'Saldado'
    && (await uno('SELECT estado FROM facturas WHERE id = $1', [fH.id])).estado === 'Activa');
}

seccion('10. ★ Bajar el valor hasta lo abonado SALDA el préstamo');
{
  const I = await prestar({ numero: 1001, imei: 'IMEI-I', valor: 5800000, persona: 1 });
  await abonar(I, 4850000);
  const r = await prestamos.editarValorPrestamo(1, I, 4850000);
  ok('★ quedó Saldado (el caso Cellsite #12915)', r.saldado === true
    && (await uno('SELECT estado FROM prestamos WHERE id = $1', [I])).estado === 'Saldado');
  ok('…con su factura de saldo y el equipo vendido', (await facturaDe(I)).some((f) => f.estado === 'Activa')
    && (await uno(`SELECT vendido, prestado FROM seriales WHERE imei = 'IMEI-I'`)).vendido === true);
  const J = await prestar({ numero: 1002, imei: 'IMEI-J', valor: 1000000, persona: 1 });
  await abonar(J, 300000);
  const rj = await prestamos.editarValorPrestamo(1, J, 900000);
  ok('bajarlo sin llegar a lo abonado: sigue Activo como siempre', rj.saldado === false
    && (await uno('SELECT estado, valor_prestamo FROM prestamos WHERE id = $1', [J])).estado === 'Activo');
  const e = await falla(() => prestamos.editarValorPrestamo(1, J, 200000));
  ok('por debajo de lo abonado sigue rechazado', e?.status === 400);
}

seccion('11. ★ Crédito con la cuota inicial completa: nace pagado y su utilidad cuenta');
{
  const venta = (extra) => facturas.crearFactura({
    negocio_id: 1, sucursal_id: 1, usuario_id: 1, nombre_cliente: 'Jenny', cedula: '555', celular: '300',
    lineas: [{ nombre_producto: 'Cable', producto_id: 1, cantidad: 1, precio: 20000 }],
    es_credito: true, ...extra,
  });
  const f1 = await venta({ cuota_inicial: 20000, pagos: [{ metodo: 'Efectivo', valor: 20000 }] });
  const c1 = await uno('SELECT estado FROM creditos WHERE factura_id = $1', [f1.id]);
  ok('★ cuota = total → el crédito nace Saldado (Tesla 195)', c1.estado === 'Saldado', c1.estado);
  const f2 = await venta({ cuota_inicial: 5000, pagos: [{ metodo: 'Efectivo', valor: 5000 }], clave_idempotencia: 'otra-venta-1' });
  ok('cuota menor → Activo como siempre', (await uno('SELECT estado FROM creditos WHERE factura_id = $1', [f2.id])).estado === 'Activo');
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const v = await reportes.getVentasRango(1, hoy, hoy);
  const enReporte = v.creditos?.saldados?.find?.((x) => x.factura_id === f1.id || x.credito_id === undefined);
  ok('★ su utilidad entra al período (cuota − costo = $15.000)', Number(v.utilidad_periodo.creditos) === 15000,
    money(v.utilidad_periodo.creditos));
  void enReporte;
  // El «Saldado» viejo sin abonos y sin cuota (Caliwood) NO entra: saldría como pérdida.
  const f3 = await venta({ cuota_inicial: 0, pagos: [], clave_idempotencia: 'otra-venta-2' });
  await db.query(`UPDATE creditos SET estado = 'Saldado' WHERE factura_id = $1`, [f3.id]);
  const v2 = await reportes.getVentasRango(1, hoy, hoy);
  ok('★ un saldado sin abonos y SIN cuota no entra (no aparece una pérdida)', Number(v2.utilidad_periodo.creditos) === 15000,
    money(v2.utilidad_periodo.creditos));
}

seccion('12. Las piezas que no se ven');
{
  const srv = readFileSync(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'), 'utf8');
  const rep = srv.slice(srv.indexOf('const _repartirSaldoEnTx'), srv.indexOf('const aplicarSaldoAPrestamos'));
  ok('el reparto del saldo cierra por cerrarSiPagadoEnTx (no se salta la mora)',
    rep.includes('cerrarSiPagadoEnTx(client, prestamo.id') && !rep.includes("updateEstado(client, prestamo.id, 'Saldado')"));
  const repo = readFileSync(path.join(RAIZ, 'src/modules/prestamos/prestamos.repository.js'), 'utf8');
  ok('la búsqueda vieja por texto parcial ya no existe', !repo.includes('`%préstamo #${prestamoId}%`'));
  const modal = readFileSync(path.join(FRONT, 'pages/facturas/ModalCancelarFactura.jsx'), 'utf8');
  ok('el modal de cancelar pregunta primero si es de un préstamo', modal.includes('getPrestamoDeFacturaSaldo')
    && modal.includes('<CancelarFacturaPrestamo'));
  const nuevo = readFileSync(path.join(FRONT, 'pages/facturas/CancelarFacturaPrestamo.jsx'), 'utf8');
  ok('las tres opciones de la plata están en pantalla', ['saldo_a_favor', 'reasignar', 'devolver'].every((d) => nuevo.includes(`'${d}'`)));
  ok('pantalla y backend usan los mismos destinos', /DESTINOS_PLATA = \['saldo_a_favor', 'reasignar', 'devolver'\]/.test(srv));
}

console.log(`\n${fallos === 0 ? '✓' : '✗'} ${pasados} pasaron, ${fallos} fallaron\n`);
process.exit(fallos ? 1 : 0);
