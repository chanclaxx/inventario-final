// ─────────────────────────────────────────────────────────────────────────────
// GARANTÍAS CON PROVEEDORES — contra un Postgres real (PGlite).
// Ver migrations/20261023_reclamos_garantia.sql.
//
// El caso que lo originó: un cliente trae un producto dañado (de una factura o
// un préstamo) o aparece dañado en el inventario; se le responde al cliente
// (otra unidad, el dinero o que espere) y la unidad sale al proveedor, que
// repone, repara, da nota crédito, devuelve plata o no lo cubre.
//
//   · Sección 1  — SIN la función (tablas ausentes): el inventario emite el SQL
//                  de siempre. Es la que hay que mirar primero.
//   · Sección 2  — la migración: idempotente, y el runner usa el MISMO archivo.
//   · Sección 3  — candidatos: de dónde salió cada unidad y su procedencia.
//   · Sección 4  — desde el INVENTARIO (serial): no se puede vender, no cuenta
//                  como disponible, y el chip lo sabe.
//   · Sección 5  — desde el INVENTARIO (cantidad): sale del stock.
//   · Sección 6  — FACTURA de contado + devolver el dinero: la venta de la línea
//                  se deshace y la caja registra el egreso.
//   · Sección 7  — FACTURA por cantidad + otra unidad: sale del stock la que se
//                  entrega, la dañada no vuelve a contar.
//   · Sección 8  — FACTURA a CRÉDITO + devolución: baja el crédito sin mover la
//                  unidad dos veces.
//   · Sección 9  — PRÉSTAMO + otra unidad: el préstamo pasa al equipo nuevo.
//   · Sección 10 — envío y respuestas del proveedor (repone, nota crédito,
//                  devuelve plata, no cubre, parcial).
//   · Sección 11 — anular: todo error tiene salida.
//   · Sección 12 — permisos: null = base del rol.
//   · Sección 13 — aislamiento entre negocios y el doble clic.
//   · Sección 14 — los PDF salen y el del cliente no lleva costos.
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
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS negocio_id INT;
  ALTER TABLE historial_stock_cantidad ADD COLUMN IF NOT EXISTS atributo_id INT;
  ALTER TABLE historial_stock_cantidad ADD COLUMN IF NOT EXISTS variante_id INT;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS usuario_id INTEGER;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS monto_inicial NUMERIC DEFAULT 0;
  CREATE TABLE IF NOT EXISTS acreedores (id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT, telefono TEXT, proveedor_id INT);
  CREATE TABLE IF NOT EXISTS movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, sucursal_id INT, tipo TEXT,
    valor NUMERIC DEFAULT 0, metodo TEXT, fecha TIMESTAMP DEFAULT NOW(),
    descripcion TEXT, cargo_id INT, compra_id INT, orden_compra_id INT,
    registrar_en_caja BOOLEAN DEFAULT TRUE, mov_dinero_id BIGINT, usuario_id INT
  );
  CREATE TABLE IF NOT EXISTS auditoria (id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT,
    accion TEXT, tabla TEXT, registro_id INT, detalle JSONB, fecha TIMESTAMP DEFAULT NOW());
`);

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
// PGlite no tiene advisory locks reales con lock_timeout entre conexiones: la
// conexión es una sola, así que el candado se acepta y no espera a nadie.
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const columnas   = require(path.join(RAIZ, 'src/config/columnas.js'));
const serialRepo = require(path.join(RAIZ, 'src/modules/productos/productosSerial.repository.js'));
const svc        = require(path.join(RAIZ, 'src/modules/reclamos-garantia/reclamosGarantia.service.js'));
const pdf        = require(path.join(RAIZ, 'src/modules/reclamos-garantia/reclamosGarantia.pdf.js'));
const mw         = require(path.join(RAIZ, 'src/middlewares/reclamosGarantia.middleware.js'));
const { puedeGarantias } = require(path.join(RAIZ, 'src/middlewares/role.middleware.js'));
const { exigirNoEnGarantia, sqlNoEnGarantia } = require(path.join(RAIZ, 'src/utils/serialEnGarantia.util.js'));
const usuariosSvc = require(path.join(RAIZ, 'src/modules/usuarios/usuarios.service.js'));

// ── Reporte ─────────────────────────────────────────────────────────────────
let ok = 0; const fallos = [];
const q = async (s, p = []) => (await db.query(s, p)).rows;
const checkEq = (n, real, esp) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  console.log(`  ${bien ? '✓' : '✗'} ${n}: ${JSON.stringify(real)}${bien ? '' : ` ← esperaba ${JSON.stringify(esp)}`}`);
  bien ? ok++ : fallos.push(`${n}: ${JSON.stringify(real)} (esperaba ${JSON.stringify(esp)})`);
};
const checkSi = (n, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${n}`); cond ? ok++ : fallos.push(n); };
const falla = async (n, fn, patron) => {
  try {
    await fn();
    console.log(`  ✗ ${n}: no falló`); fallos.push(`${n}: no falló`);
  } catch (err) {
    const msg = `${err.code || ''} ${err.message || ''}`;
    const bien = !patron || patron.test(msg);
    console.log(`  ${bien ? '✓' : '✗'} ${n} → ${msg.trim().slice(0, 110)}`);
    bien ? ok++ : fallos.push(`${n}: ${msg}`);
  }
};
const seccion = (t) => console.log(`\n── ${t}`);
const stock = async (tabla, id) => Number((await q(`SELECT stock FROM ${tabla} WHERE id = $1`, [id]))[0].stock);
const serial = async (id) => (await q('SELECT vendido, prestado, fecha_salida FROM seriales WHERE id = $1', [id]))[0];

// ── Datos ───────────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO negocios (id, nombre) VALUES (1, 'Tesla'), (2, 'Vecino');
  INSERT INTO sucursales (id, negocio_id, nombre) VALUES (1, 1, 'Principal'), (2, 1, 'Norte'), (3, 2, 'Otro');
  INSERT INTO usuarios (id, nombre, negocio_id) VALUES (1, 'Admin', 1), (2, 'Super', 1), (3, 'Vende', 1), (9, 'Ajeno', 2);
  INSERT INTO proveedores (id, negocio_id, nombre, nit, telefono) VALUES (1, 1, 'Distrimovil', '900', '300'), (2, 1, 'TecnoImport', '901', '301'), (3, 2, 'Ajeno', '1', '1');
  INSERT INTO productos_serial (id, nombre, precio, sucursal_id) VALUES
    (1, 'iPhone 13', 3000000, 1), (2, 'Moto G', 800000, 1), (3, 'iPhone ajeno', 1, 3);
  INSERT INTO seriales (id, producto_id, imei, costo_compra, precio, vendido, prestado, fecha_salida) VALUES
    (1, 1, 'IMEI-INV', 2000000, 3000000, false, false, NULL),
    (2, 1, 'IMEI-VEN', 2100000, 3000000, true,  false, CURRENT_DATE - 10),
    (3, 1, 'IMEI-NUEVO', 2050000, 3000000, false, false, NULL),
    (4, 2, 'IMEI-PRE', 500000, 800000, false, true, NULL),
    (5, 2, 'IMEI-PRE2', 510000, 800000, false, false, NULL),
    (6, 1, 'IMEI-CRE', 2000000, 3000000, true, false, CURRENT_DATE - 5),
    (7, 3, 'IMEI-AJENO', 1, 1, false, false, NULL);
  SELECT setval('seriales_id_seq', 50);
  INSERT INTO productos_cantidad (id, nombre, stock, costo_unitario, precio, sucursal_id, codigo) VALUES
    (1, 'Cargador 20W', 10, 15000, 40000, 1, 'CAR20'),
    (2, 'Vidrio templado', 30, 2000, 10000, 1, NULL);
  SELECT setval('productos_cantidad_id_seq', 50);
  INSERT INTO compras (id, numero, sucursal_id, proveedor_id, total, fecha) VALUES
    (1, 11, 1, 1, 6150000, NOW() - INTERVAL '20 days'),
    (2, 12, 1, 2, 150000, NOW() - INTERVAL '30 days');
  INSERT INTO lineas_compra (id, compra_id, producto_id, imei, nombre_producto, cantidad, precio_unitario, garantia_dias) VALUES
    (1, 1, NULL, 'IMEI-INV', 'iPhone 13', 1, 2000000, 90),
    (2, 1, NULL, 'IMEI-VEN', 'iPhone 13', 1, 2100000, 90),
    (3, 1, NULL, 'IMEI-NUEVO', 'iPhone 13', 1, 2050000, 90),
    (4, 2, 1, NULL, 'Cargador 20W', 10, 15000, 30);
  INSERT INTO acreedores (id, negocio_id, nombre, cedula, proveedor_id) VALUES (1, 1, 'Distrimovil', '900', 1);
  INSERT INTO movimientos_acreedor (id, acreedor_id, sucursal_id, tipo, valor, compra_id, registrar_en_caja)
    VALUES (1, 1, 1, 'Cargo', 6150000, 1, false);
  SELECT setval('movimientos_acreedor_id_seq', 50);
  -- Venta de contado del IMEI-VEN y de 3 cargadores.
  INSERT INTO facturas (id, numero, sucursal_id, usuario_id, nombre_cliente, cedula, celular, estado, fecha) VALUES
    (1, 101, 1, 3, 'Ana Ruiz', '111', '3001', 'Activa', NOW() - INTERVAL '10 days'),
    (2, 102, 1, 3, 'Luis Pérez', '222', '3002', 'Credito', NOW() - INTERVAL '5 days');
  INSERT INTO lineas_factura (id, factura_id, nombre_producto, imei, cantidad, precio, producto_id) VALUES
    (1, 1, 'iPhone 13', 'IMEI-VEN', 1, 3000000, NULL),
    (2, 1, 'Cargador 20W', NULL, 3, 40000, 1),
    (3, 2, 'iPhone 13', 'IMEI-CRE', 1, 3000000, NULL),
    (4, 2, 'Vidrio templado', NULL, 1, 10000, 2);
  INSERT INTO pagos_factura (factura_id, metodo, valor) VALUES (1, 'Efectivo', 3120000), (2, 'Efectivo', 500000);
  INSERT INTO creditos (id, factura_id, sucursal_id, valor_total, cuota_inicial, total_abonado, estado)
    VALUES (1, 2, 1, 3010000, 500000, 0, 'Activo');
  INSERT INTO prestamos (id, numero, sucursal_id, usuario_id, prestatario, cedula, telefono, imei, producto_id,
                         valor_prestamo, cantidad_prestada, estado, nombre_producto)
    VALUES (1, 201, 1, 3, 'Carlos', '333', '3003', 'IMEI-PRE', 2, 800000, 1, 'Activo', 'Moto G');
  INSERT INTO aperturas_caja (id, sucursal_id, estado, fecha_apertura) VALUES (1, 1, 'Abierta', NOW() - INTERVAL '1 hour');
  INSERT INTO config_negocio (negocio_id, clave, valor) VALUES (1, 'reclamos_garantia_activo', '1');
`);

const admin  = { id: 1, negocio_id: 1, rol: 'admin_negocio', sucursal_id: null };
const superv = { id: 2, negocio_id: 1, rol: 'supervisor', sucursal_id: 1 };
const vende  = { id: 3, negocio_id: 1, rol: 'vendedor', sucursal_id: 1 };
const ajeno  = { id: 9, negocio_id: 2, rol: 'admin_negocio', sucursal_id: null };

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. Sin la función: el inventario emite el SQL de siempre');
columnas._setReclamosGarantiaDisponible(false);
{
  checkEq('la condición de disponibles es TRUE', sqlNoEnGarantia('s'), 'TRUE');
  const lista = await serialRepo.findAll(1, 1, null);
  checkSi('el listado de referencias resuelve sin las tablas', lista.length === 2);
  checkSi('  y no trae la columna en_garantia', !('en_garantia' in lista[0]));
  const ser = await serialRepo.getSeriales(1, null);
  checkSi('el listado de seriales resuelve sin las tablas', ser.length === 4);
  checkSi('  y no trae la marca de garantía', !('en_garantia_numero' in ser[0]));
  const cfg = await mw.getConfigReclamos(1);
  checkEq('sin tablas la función está apagada aunque la clave diga 1', cfg.activo, false);
  await exigirNoEnGarantia(pool, 1, 'IMEI-INV');
  checkSi('el despacho no pregunta nada sin las tablas', true);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. La migración');
const SQL_MIG = readFileSync(path.join(RAIZ, 'migrations/20261023_reclamos_garantia.sql'), 'utf8');
await db.exec(SQL_MIG);
await db.exec(SQL_MIG);
checkSi('se aplica dos veces sin error (idempotente)', true);
{
  const runner = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8');
  checkSi('el runner de arranque lee el MISMO archivo', runner.includes("migrations/20261023_reclamos_garantia.sql'"));
  columnas._setReclamosGarantiaDisponible(true);
  columnas._setPermisosGarantiasDisponible(true);
  mw.invalidarCache();
  const cfg = await mw.getConfigReclamos(1);
  checkEq('con tablas y la clave en 1, encendida', cfg.activo, true);
  checkEq('umbral de demora por defecto', cfg.dias_demora, 15);
  mw.invalidarCache();
  checkEq('otro negocio sin la clave: apagada', (await mw.getConfigReclamos(2)).activo, false);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. Candidatos: de dónde salió y a quién reclamarle');
{
  const [inv] = await svc.buscarCandidatos(admin, 1, { serial_id: 1 });
  checkEq('serial disponible → inventario', inv.origen_tipo, 'inventario');
  checkEq('  proveedor propuesto por la compra', inv.procedencia?.proveedor_nombre, 'Distrimovil');
  checkSi('  con su garantía vigente', ['vigente', 'por_vencer'].includes(inv.procedencia?.estado));
  const [ven] = await svc.buscarCandidatos(admin, 1, { serial_id: 2 });
  checkEq('serial vendido → su factura', [ven.origen_tipo, ven.factura?.numero, ven.cliente?.nombre], ['factura', 101, 'Ana Ruiz']);
  const [pre] = await svc.buscarCandidatos(admin, 1, { serial_id: 4 });
  checkEq('serial prestado → su préstamo', [pre.origen_tipo, pre.prestamo?.numero], ['prestamo', 201]);
  const [lf] = await svc.buscarCandidatos(admin, 1, { linea_factura_id: 2 });
  checkEq('línea de cantidad: hasta 3 unidades', [lf.tipo, lf.cantidad_max, lf.precio_venta], ['cantidad', 3, 40000]);
  checkEq('  proveedor de la última compra del producto', lf.procedencia?.proveedor_nombre, 'TecnoImport');
  const porNumero = await svc.buscarCandidatos(admin, 1, { q: '101' });
  checkSi('buscar «101» trae las dos líneas de la factura', porNumero.filter((c) => c.factura?.numero === 101).length === 2);
  const porImei = await svc.buscarCandidatos(admin, 1, { q: 'IMEI-INV' });
  checkSi('buscar por IMEI', porImei.some((c) => c.serial_id === 1));
  const porCodigo = await svc.buscarCandidatos(admin, 1, { q: 'CAR20' });
  checkSi('buscar por código del producto (nodo del inventario)', porCodigo.some((c) => c.origen_tipo === 'inventario' && c.producto_id === 1));
  const sinCosto = await svc.buscarCandidatos(vende, 1, { serial_id: 1 });
  checkEq('al vendedor no le viaja el costo (candado de costos apagado → sí lo ve)', sinCosto[0].costo_unitario, 2000000);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. Desde el inventario (serial): bloqueado y fuera de los disponibles');
let rInv;
{
  rInv = await svc.crear(vende, null, { origen: { tipo: 'inventario', serial_id: 1 }, falla: 'No enciende', proveedor_id: 1 });
  checkSi('se crea con número', rInv.reclamo.numero === 1);
  checkEq('la línea guarda la compra y su garantía', [rInv.linea.compra_id, !!rInv.linea.garantia_proveedor_hasta], [1, true]);
  await falla('venderlo revienta con GP001', () => db.query('UPDATE seriales SET vendido = true WHERE id = 1'), /GP001/);
  await falla('prestarlo revienta', () => db.query('UPDATE seriales SET prestado = true WHERE id = 1'), /GP001/);
  await falla('borrarlo revienta', () => db.query('DELETE FROM seriales WHERE id = 1'), /GP001/);
  await db.query("UPDATE seriales SET nota = 'pantalla rota' WHERE id = 1");
  checkSi('editar otra cosa sí se puede', true);
  const lista = await serialRepo.findAll(1, 1, null);
  const ip = lista.find((p) => p.id === 1);
  checkEq('ya no cuenta como disponible (IMEI-INV y IMEI-NUEVO → 1)', [Number(ip.disponibles), Number(ip.en_garantia)], [1, 1]);
  const ser = await serialRepo.getSeriales(1, null);
  checkEq('la unidad dice en qué garantía está', ser.find((s) => s.id === 1).en_garantia_numero, 1);
  const det = await serialRepo.contarSerialesDetalle(1);
  checkEq('el conteo del detalle tampoco lo cuenta', det.disponibles, 1);
  await falla('el despacho de la red no lo deja salir', () => exigirNoEnGarantia(pool, 1, 'IMEI-INV'), /EQUIPO_EN_GARANTIA/);
  const enInv = await svc.enInventario(superv, null);
  checkSi('el chip del inventario lo sabe', enInv.seriales.some((s) => s.serial_id === 1));
  await falla('mandarlo otra vez a garantía', () => svc.crear(admin, 1, { origen: { tipo: 'inventario', serial_id: 1 }, falla: 'x' }), /Ya está en la garantía #1/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. Desde el inventario (cantidad): sale del stock');
let rCant;
{
  rCant = await svc.crear(superv, null, { origen: { tipo: 'inventario', producto_id: 1 }, cantidad: 4, falla: 'No cargan' });
  checkEq('el stock baja de 10 a 6', await stock('productos_cantidad', 1), 6);
  const hist = await q("SELECT cantidad, tipo FROM historial_stock_cantidad WHERE tipo = 'garantia'");
  checkEq('queda en el historial del stock', hist.map((h) => [h.cantidad, h.tipo]), [[-4, 'garantia']]);
  const enInv = await svc.enInventario(superv, null);
  checkEq('el chip cuenta las 4 que están afuera', enInv.nodos.find((n) => n.producto_id === 1)?.cantidad, 4);
  await falla('no se pueden mandar más de las que hay', () =>
    svc.crear(superv, null, { origen: { tipo: 'inventario', producto_id: 1 }, cantidad: 7, falla: 'x' }), /hasta 6/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. Factura de contado + devolver el dinero');
let rVen;
{
  rVen = await svc.crear(superv, null, {
    origen: { tipo: 'factura', linea_factura_id: 1 }, falla: 'Pantalla con rayas', accesorios: ['Caja', 'Cargador'],
    proveedor_id: 1, resolucion_cliente: { tipo: 'reembolso', metodo: 'Efectivo' },
  });
  checkEq('el equipo volvió al inventario (ya no está vendido)', (await serial(2)).vendido, false);
  await falla('…pero no se puede volver a vender', () => db.query('UPDATE seriales SET vendido = true WHERE id = 2'), /GP001/);
  const lf = (await q('SELECT cantidad_devuelta FROM lineas_factura WHERE id = 1'))[0];
  checkEq('la venta de la línea se deshizo', lf.cantidad_devuelta, 1);
  const caja = await q("SELECT tipo, valor, metodo, referencia_tipo FROM movimientos_caja WHERE referencia_tipo = 'garantia_cliente'");
  checkEq('la caja registra el egreso', caja.map((c) => [c.tipo, Number(c.valor), c.metodo]), [['Egreso', 3000000, 'Efectivo']]);
  checkEq('el cliente quedó resuelto', rVen.movimiento_cliente?.tipo, 'reembolso');
  const det = await svc.detalle(superv, rVen.reclamo.id);
  checkEq('estados derivados', [det.lineas[0].estado_cliente, det.lineas[0].estado_proveedor], ['resuelto', 'por_enviar']);
  checkEq('accesorios guardados', det.accesorios, ['Caja', 'Cargador']);
  await falla('devolver otra vez la misma línea', () => svc.resolverCliente(superv, det.lineas[0].id, { tipo: 'reembolso' }), /ya se resolvió/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. Factura por cantidad + entregarle otra unidad');
let rCar;
{
  const antes = await stock('productos_cantidad', 1);
  rCar = await svc.crear(superv, null, {
    origen: { tipo: 'factura', linea_factura_id: 2 }, cantidad: 2, falla: 'No carga',
    resolucion_cliente: { tipo: 'cambio' },
  });
  checkEq('sale del stock solo lo que se entrega (2)', await stock('productos_cantidad', 1), antes - 2);
  const lf = (await q('SELECT cantidad_devuelta FROM lineas_factura WHERE id = 2'))[0];
  checkEq('la venta NO se deshace con un cambio', lf.cantidad_devuelta, 0);
  const [cand] = await svc.buscarCandidatos(superv, null, { linea_factura_id: 2 });
  checkEq('de la línea queda 1 unidad por reclamar', cand.cantidad_max, 1);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. Factura a crédito + devolución');
{
  const r = await svc.crear(superv, null, {
    origen: { tipo: 'factura', linea_factura_id: 3 }, falla: 'Se apaga', resolucion_cliente: { tipo: 'reembolso' },
  });
  const cr = (await q('SELECT valor_total, estado FROM creditos WHERE id = 1'))[0];
  checkEq('el crédito baja 3.000.000 (de 3.010.000 a 10.000)', Number(cr.valor_total), 10000);
  checkEq('el equipo no se movió dos veces (no vendido, una sola fila)', (await serial(6)).vendido, false);
  checkEq('el movimiento lo dice como crédito', r.movimiento_cliente.metodo, 'Crédito');
  const caja = await q("SELECT 1 FROM movimientos_caja WHERE referencia_id = $1 AND referencia_tipo = 'garantia_cliente'", [r.movimiento_cliente.id]);
  checkEq('y no toca la caja', caja.length, 0);
  await falla('una devolución a crédito no se anula desde aquí', () => svc.anularMovimiento(admin, r.movimiento_cliente.id, 'error de prueba'), /crédito/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. Préstamo + entregarle otra unidad');
let rPre;
{
  rPre = await svc.crear(superv, null, {
    origen: { tipo: 'prestamo', prestamo_id: 1 }, falla: 'Cámara dañada',
    resolucion_cliente: { tipo: 'cambio', unidad: { serial_id: 5 } },
  });
  const p = (await q('SELECT imei FROM prestamos WHERE id = 1'))[0];
  checkEq('el préstamo pasa al equipo nuevo', p.imei, 'IMEI-PRE2');
  checkEq('el nuevo queda prestado', (await serial(5)).prestado, true);
  checkEq('el dañado ya no está prestado…', (await serial(4)).prestado, false);
  await falla('…y no se puede volver a prestar', () => db.query('UPDATE seriales SET prestado = true WHERE id = 4'), /GP001/);
  await falla('en un préstamo no se devuelve dinero desde aquí', () =>
    svc.resolverCliente(superv, rPre.linea.id, { tipo: 'reembolso' }), /ya se resolvió|préstamo/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('10. Envío y respuestas del proveedor');
let envio;
{
  await falla('no se responde sin envío', () => svc.resolverProveedor(superv, rInv.linea.id, { tipo: 'reparacion' }), /SIN_ENVIO/);
  await falla('una unidad de otro proveedor no entra al envío', () =>
    svc.crearEnvio(superv, null, { proveedor_id: 2, linea_ids: [rInv.linea.id] }), /otro proveedor/);
  envio = await svc.crearEnvio(superv, null, {
    proveedor_id: 1, linea_ids: [rInv.linea.id, rVen.linea.id, rPre.linea.id, rCant.linea.id], guia: 'G-1', transportadora: 'Servientrega',
  });
  checkEq('envío numerado con 4 unidades', [envio.numero, envio.lineas], [1, 4]);
  const casoPre = (await q('SELECT proveedor_id FROM reclamos_garantia WHERE id = $1', [rPre.reclamo.id]))[0];
  checkEq('el caso sin proveedor tomó el del envío', casoPre.proveedor_id, 1);
  await falla('la misma unidad no sale en dos envíos', () =>
    svc.crearEnvio(superv, null, { proveedor_id: 1, linea_ids: [rInv.linea.id] }), /ya se envió/);

  // Repone el IMEI-INV con un equipo nuevo, garantía de 60 días.
  const rep = await svc.resolverProveedor(superv, rInv.linea.id, {
    tipo: 'reposicion', unidad: { imei: 'IMEI-REPUESTO' }, garantia: { modo: 'dias', dias: 60 },
  });
  const nuevo = (await q("SELECT id, costo_compra, proveedor_id, vendido FROM seriales WHERE imei = 'IMEI-REPUESTO'"))[0];
  checkEq('entra el equipo repuesto con el costo del dañado y el proveedor', [Number(nuevo.costo_compra), nuevo.proveedor_id, nuevo.vendido], [2000000, 1, false]);
  checkEq('el dañado sale del inventario (su fila se conserva)', (await serial(1)).vendido, true);
  checkSi('la garantía del repuesto quedó en 60 días', !!rep.garantia_hasta);
  await db.query('UPDATE seriales SET vendido = true WHERE id = $1', [nuevo.id]);
  await db.query('UPDATE seriales SET vendido = false WHERE id = $1', [nuevo.id]);
  checkSi('el repuesto se vende normal (sin candado)', true);
  const [candRep] = await svc.buscarCandidatos(admin, 1, { serial_id: nuevo.id });
  checkEq('su procedencia es la reposición, con su garantía', [candRep.procedencia?.via, candRep.procedencia?.garantia_hasta], ['reposicion', rep.garantia_hasta]);
  await falla('un IMEI que ya existe no se repone', () =>
    svc.resolverProveedor(superv, rVen.linea.id, { tipo: 'reposicion', unidad: { imei: 'IMEI-NUEVO' } }), /IMEI_EXISTE/);

  // Nota crédito por el IMEI-VEN: abona al cargo de la compra.
  const nc = await svc.resolverProveedor(superv, rVen.linea.id, { tipo: 'nota_credito' });
  const ab = await q("SELECT valor, cargo_id, metodo, registrar_en_caja FROM movimientos_acreedor WHERE metodo = 'Garantía'");
  checkEq('la nota crédito abona al cargo de la compra', ab.map((a) => [Number(a.valor), a.cargo_id, a.registrar_en_caja]), [[2100000, 1, false]]);
  checkEq('y la línea de compra cuenta la unidad devuelta', (await q('SELECT cantidad_devuelta FROM lineas_compra WHERE id = 2'))[0].cantidad_devuelta, 1);
  checkEq('el IMEI-VEN sale del inventario', (await serial(2)).vendido, true);

  // Devuelve plata por el IMEI-PRE.
  const rp = await svc.resolverProveedor(superv, rPre.linea.id, { tipo: 'reembolso_proveedor', valor: 450000, metodo: 'Nequi' });
  const ing = await q("SELECT tipo, valor, metodo FROM movimientos_caja WHERE referencia_tipo = 'garantia_proveedor'");
  checkEq('la caja registra el ingreso', ing.map((c) => [c.tipo, Number(c.valor), c.metodo]), [['Ingreso', 450000, 'Nequi']]);

  // Cargadores: repone 2, no cubre 1 (baja), y 1 vuelve sin cubrir.
  const antes = await stock('productos_cantidad', 1);
  await svc.resolverProveedor(superv, rCant.linea.id, { tipo: 'reposicion', cantidad: 2 });
  checkEq('2 repuestos vuelven al stock', await stock('productos_cantidad', 1), antes + 2);
  await svc.resolverProveedor(superv, rCant.linea.id, { tipo: 'rechazo', destino: 'baja', cantidad: 1 });
  checkEq('la baja no suma stock', await stock('productos_cantidad', 1), antes + 2);
  let det = await svc.detalle(superv, rCant.reclamo.id);
  checkEq('la línea queda parcial (3 de 4)', [det.lineas[0].estado_proveedor, det.lineas[0].cantidad_resuelta], ['parcial', 3]);
  await falla('no se responde por más de las que quedan', () =>
    svc.resolverProveedor(superv, rCant.linea.id, { tipo: 'reparacion', cantidad: 2 }), /Quedan 1/);
  await svc.resolverProveedor(superv, rCant.linea.id, { tipo: 'rechazo', destino: 'reingreso', cantidad: 1 });
  det = await svc.detalle(superv, rCant.reclamo.id);
  checkEq('ahora resuelta', det.lineas[0].estado_proveedor, 'resuelto');
  const nodoCar = (await svc.enInventario(superv, null)).nodos.find((n) => n.producto_id === 1);
  checkEq('el chip ya no cuenta los 4 del inventario: solo los 2 del cambio, aún sin enviar', [nodoCar?.cantidad, nodoCar?.casos], [2, [rCar.reclamo.numero]]);

  const lista = await svc.listar(superv, null, { vista: 'todas' }, { dias_demora: 15 });
  checkSi('el listado trae todas las líneas', lista.items.length >= 6);
  checkEq('resumen: nada afuera, el cambio del cargador pendiente con el cliente', [lista.resumen.afuera, lista.resumen.cliente_pendiente], [0, 0]);
  void nc; void rp;
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('11. Anular: todo error tiene salida');
{
  // La reposición del IMEI-INV: el repuesto se va y el dañado vuelve a garantía.
  const det = await svc.detalle(admin, rInv.reclamo.id);
  const movRep = det.movimientos.find((m) => m.tipo === 'reposicion');
  await svc.anularMovimiento(admin, movRep.id, 'llegó otro IMEI');
  checkEq('el repuesto sin vender desaparece', (await q("SELECT 1 FROM seriales WHERE imei = 'IMEI-REPUESTO'")).length, 0);
  checkEq('el dañado vuelve al inventario…', (await serial(1)).vendido, false);
  await falla('…bloqueado otra vez', () => db.query('UPDATE seriales SET vendido = true WHERE id = 1'), /GP001/);
  checkEq('la línea se reabre', (await svc.detalle(admin, rInv.reclamo.id)).lineas[0].estado_proveedor, 'afuera');

  // La nota crédito: el abono se borra y la línea de compra lo descuenta.
  const detVen = await svc.detalle(admin, rVen.reclamo.id);
  await svc.anularMovimiento(admin, detVen.movimientos.find((m) => m.tipo === 'nota_credito').id, 'no era nota crédito');
  checkEq('el abono de garantía ya no está', (await q("SELECT 1 FROM movimientos_acreedor WHERE metodo = 'Garantía'")).length, 0);
  checkEq('la línea de compra vuelve a 0 devueltas', (await q('SELECT cantidad_devuelta FROM lineas_compra WHERE id = 2'))[0].cantidad_devuelta, 0);
  // El reembolso al cliente de contado: la venta vuelve y la caja se apaga.
  await svc.anularMovimiento(admin, detVen.movimientos.find((m) => m.tipo === 'reembolso').id, 'el cliente no recibió la plata');
  checkEq('la línea de la factura vuelve a estar vendida', (await q('SELECT cantidad_devuelta FROM lineas_factura WHERE id = 1'))[0].cantidad_devuelta, 0);
  checkEq('el egreso de caja quedó inactivo', (await q("SELECT activo FROM movimientos_caja WHERE referencia_tipo = 'garantia_cliente'"))[0].activo, false);

  // Anular el caso entero devuelve el equipo al cliente (vendido).
  await falla('no se anula un caso con movimientos vivos', () => svc.anularReclamo(admin, rCar.reclamo.id, 'x prueba'), /movimientos/);
  await svc.anularEnvio(admin, envio.id, 'prueba').catch(() => {});
  const rTmp = await svc.crear(admin, 1, { origen: { tipo: 'inventario', serial_id: 3 }, falla: 'Prueba' });
  await svc.anularReclamo(admin, rTmp.reclamo.id, 'me equivoqué de equipo');
  await db.query('UPDATE seriales SET vendido = true WHERE id = 3');
  await db.query('UPDATE seriales SET vendido = false WHERE id = 3');
  checkSi('anulado el caso, el equipo se vende normal', true);
  const rTmp2 = await svc.crear(admin, 1, { origen: { tipo: 'inventario', producto_id: 2 }, cantidad: 5, falla: 'Prueba' });
  await svc.anularReclamo(admin, rTmp2.reclamo.id, 'me equivoqué de cantidad');
  checkEq('anulado, el stock vuelve (30)', await stock('productos_cantidad', 2), 30);
  await falla('motivo obligatorio', () => svc.anularReclamo(admin, rCar.reclamo.id, ''), /por qué/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('12. Permisos: null = base del rol');
{
  checkEq('vendedor: recibe y cambia, no reembolsa ni envía', ['recibir', 'cliente', 'reembolsar', 'enviar', 'resolver', 'anular'].map((k) => puedeGarantias(vende, k)),
    [true, true, false, false, false, false]);
  checkEq('supervisor: todo menos anular', ['recibir', 'reembolsar', 'enviar', 'resolver', 'anular'].map((k) => puedeGarantias(superv, k)),
    [true, true, true, true, false]);
  checkEq('admin: todo', puedeGarantias(admin, 'anular'), true);
  checkEq('personalizado: una llave no le quita las otras', [puedeGarantias({ ...vende, permisos_garantias: { reembolsar: true } }, 'reembolsar'),
    puedeGarantias({ ...vende, permisos_garantias: { reembolsar: true } }, 'cliente')], [true, true]);
  checkEq('personalizado en false sí quita', puedeGarantias({ ...superv, permisos_garantias: { enviar: false } }, 'enviar'), false);
  checkEq('el guardado limpia llaves raras', usuariosSvc._normalizarPermisosGarantias({ ver: true, hackear: true, enviar: 'si' }), { ver: true });
  checkEq('sin llaves válidas se guarda NULL', usuariosSvc._normalizarPermisosGarantias({}), null);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('13. Aislamiento y doble clic');
{
  checkEq('el vecino no encuentra el serial de otro negocio', await svc.buscarCandidatos(ajeno, 3, { serial_id: 1 }), [null].filter(Boolean));
  await falla('el vecino no ve el caso', () => svc.detalle(ajeno, rVen.reclamo.id), /no encontrada/);
  await falla('el supervisor de otra sede no lo ve', () => svc.detalle({ ...superv, sucursal_id: 2 }, rVen.reclamo.id), /otra sucursal/);
  await falla('el admin sin sede no puede crear', () => svc.crear(admin, null, { origen: { tipo: 'inventario', serial_id: 3 }, falla: 'x' }), /SUCURSAL_REQUERIDA/);
  await svc.crear(superv, null, { origen: { tipo: 'inventario', producto_id: 2 }, cantidad: 1, falla: 'rayado' });
  await falla('el mismo caso por cantidad dos veces seguidas', () =>
    svc.crear(superv, null, { origen: { tipo: 'inventario', producto_id: 2 }, cantidad: 1, falla: 'rayado' }), /ya se registró/);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('14. Los PDF');
const aBuffer = (doc) => new Promise((res) => { const p = []; doc.on('data', (d) => p.push(d)); doc.on('end', () => res(Buffer.concat(p))); });
{
  const det = await svc.detalle(superv, rCar.reclamo.id);
  const buf = await aBuffer(pdf.construirPdfReclamo(det, { nombre_negocio: 'Tesla' }));
  checkSi('el comprobante del cliente sale', buf.length > 1000 && buf.slice(0, 4).toString() === '%PDF');
  const texto = buf.toString('latin1');
  checkSi('  y no imprime costos', !texto.includes('15.000') && !/costo/i.test(texto));
  const e = await svc.getEnvio(superv, envio.id);
  const buf2 = await aBuffer(pdf.construirPdfEnvio(e, { nombre_negocio: 'Tesla' }));
  checkSi('la guía del proveedor sale', buf2.slice(0, 4).toString() === '%PDF');
  const muchas = { ...e, lineas: Array.from({ length: 70 }, (_, i) => ({ ...e.lineas[0], id: i, nombre_producto: `Producto ${i}` })) };
  const buf3 = await aBuffer(pdf.construirPdfEnvio(muchas, { nombre_negocio: 'Tesla' }));
  const paginas = (buf3.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  checkSi(`una guía de 70 unidades no deja hojas sueltas (${paginas} páginas)`, paginas >= 2 && paginas <= 5);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('15. Producto con tallas: se ofrecen sus variantes, no un error');
{
  await db.exec(`
    INSERT INTO config_negocio (negocio_id, clave, valor) VALUES (1, 'variantes_activo', '1');
    INSERT INTO productos_cantidad (id, nombre, stock, costo_unitario, sucursal_id) VALUES (60, 'Correa', 7, 10000, 1);
    INSERT INTO atributos_producto (id, producto_id, sucursal_id, valor, stock, costo_unitario) VALUES
      (60, 60, 1, '38MM', 4, 11000), (61, 60, 1, '42MM', 3, 12000);
  `);
  const hojas = await svc.buscarCandidatos(superv, null, { producto_id: 60 });
  checkEq('abrir desde el producto ofrece sus dos tallas', hojas.map((h) => h.variante_texto), ['38MM', '42MM']);
  checkEq('  cada una con su stock y su costo', hojas.map((h) => [h.cantidad_max, h.costo_unitario]), [[4, 11000], [3, 12000]]);
  await falla('crear sobre el producto sin elegir la talla', () =>
    svc.crear(superv, null, { origen: { tipo: 'inventario', producto_id: 60 }, falla: 'x' }), /VARIANTE_REQUERIDA/);
  await svc.crear(superv, null, { origen: { tipo: 'inventario', producto_id: 60, atributo_id: 61 }, falla: 'hebilla rota' });
  checkEq('la talla baja de 3 a 2', await stock('atributos_producto', 61), 2);
  checkEq('el producto se recalcula (Σ tallas = 6)', await stock('productos_cantidad', 60), 6);
  const enInv = await svc.enInventario(superv, null);
  checkSi('el chip la cuenta en SU talla', enInv.nodos.some((n) => n.producto_id === 60 && n.atributo_id === 61 && n.cantidad === 1));
  const mes = await svc.listar(superv, null, { vista: 'resueltas_mes' }, { dias_demora: 15 });
  checkSi('la vista «resueltas este mes» coincide con la tarjeta', mes.items.length === mes.resumen.resueltas_mes);
}

// ═════════════════════════════════════════════════════════════════════════════
seccion('16. El frontend no se separa del backend');
{
  const front = readFileSync(path.join(RAIZ, '../frontend/src/utils/permisosGarantias.js'), 'utf8');
  const role = require(path.join(RAIZ, 'src/middlewares/role.middleware.js'));
  const baseFront = new Function(`${front.replace(/export const/g, 'const').split('export const puedeGarantias')[0]}
    return BASE_GARANTIAS;`)();
  checkEq('la base de permisos es la misma en las dos copias', baseFront, role.BASE_GARANTIAS);
  const llavesFront = [...front.matchAll(/\{ id: '([a-z]+)',/g)].map((m) => m[1]);
  checkEq('las llaves de Ajustes son las del backend', llavesFront.sort(), Object.keys(role.BASE_GARANTIAS.supervisor).sort());
  checkEq('y las que guarda usuarios.service', Object.keys(usuariosSvc._normalizarPermisosGarantias(
    Object.fromEntries(llavesFront.map((k) => [k, true])))).sort(), llavesFront.sort());
  const ui = readFileSync(path.join(RAIZ, '../frontend/src/pages/proveedores/garantias/garantiasUi.js'), 'utf8');
  const repo = require(path.join(RAIZ, 'src/modules/reclamos-garantia/reclamosGarantia.repository.js'));
  const estadosBack = [...repo.SQL_ESTADO_PROVEEDOR.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  checkSi('cada estado del proveedor tiene nombre en pantalla', estadosBack.every((e) => ui.includes(`  ${e}:`)));
  const tiposBack = svc.TIPOS_PROVEEDOR.concat(['cambio', 'reembolso']);
  checkSi('cada movimiento tiene texto en pantalla', tiposBack.every((t) => new RegExp(`\\b${t}:`).test(ui)));
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 2
// ═════════════════════════════════════════════════════════════════════════════
const storage   = require(path.join(RAIZ, 'src/modules/archivos/archivos.storage.js'));
const archivos  = require(path.join(RAIZ, 'src/modules/reclamos-garantia/reclamosGarantia.archivos.js'));
const operaciones = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.operaciones.js'));
const motor     = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.motor.js'));
const reportesSvc = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));
const busquedaRepo = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.repository.js'));

seccion('17. Fase 2 sin su migración: la fase 1 sigue igual');
{
  columnas._setReclamosFase2Disponible(false);
  checkEq('sin la migración, el detalle no trae fotos ni orden', Object.keys(await (async () => {
    const d = await svc.detalle(superv, rCar.reclamo.id); return { archivos: d.archivos, orden: d.orden_servicio };
  })()).filter((k) => k), ['archivos', 'orden']);
  const d = await svc.detalle(superv, rCar.reclamo.id);
  checkSi('  (las dos claves vienen vacías)', d.archivos === undefined && d.orden_servicio === undefined);
  checkEq('las fotos están apagadas', archivos.activas(), false);
  await falla('adjuntar responde 404', () => archivos.adjuntar(superv, rCar.reclamo.id, { buffer: Buffer.from('x'), originalname: 'a.jpg' }), /no están instaladas/);
  const SQL2 = readFileSync(path.join(RAIZ, 'migrations/20261024_reclamos_garantia_fase2.sql'), 'utf8');
  await db.exec(SQL2); await db.exec(SQL2);
  checkSi('la migración de la fase 2 es idempotente', true);
  checkSi('el runner lee el MISMO archivo', readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8')
    .includes("migrations/20261024_reclamos_garantia_fase2.sql'"));
  columnas._setReclamosFase2Disponible(true);
}

seccion('18. Fotos del producto dañado');
{
  const mem = (() => {
    const objetos = new Map();
    return {
      nombre: 'mem-g', objetos, bucket: () => 'bucket-g',
      async subir({ bucket, path: p, buffer }) { objetos.set(`${bucket}/${p}`, Buffer.from(buffer)); },
      async descargar({ bucket, path: p }) { const b = objetos.get(`${bucket}/${p}`); if (!b) throw new Error('NoSuchKey'); return b; },
    };
  })();
  storage._setProveedorPrueba(null);
  checkEq('sin almacenamiento, las fotos están apagadas', archivos.activas(), false);
  await falla('…y adjuntar lo dice', () => archivos.adjuntar(superv, rCar.reclamo.id, { buffer: Buffer.from('x'), originalname: 'a.jpg' }), /almacenamiento/);
  storage._setProveedorPrueba(mem);
  checkEq('con almacenamiento, encendidas', archivos.activas(), true);
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('foto-de-la-pantalla-rota')]);
  const f = await archivos.adjuntar(vende, rCar.reclamo.id, { buffer: JPG, originalname: 'pantalla.jpg' }, { nota: 'golpe' });
  checkEq('se guarda la foto', [f.mime, f.nombre_original], ['image/jpeg', 'pantalla.jpg']);
  checkSi('  en la carpeta de la garantía, no en la de una compra', [...mem.objetos.keys()][0].includes(`garantia_${rCar.reclamo.id}/`));
  await falla('la misma foto dos veces', () => archivos.adjuntar(vende, rCar.reclamo.id, { buffer: JPG, originalname: 'otra.jpg' }), /ya está/);
  await falla('un archivo que no es foto ni PDF', () => archivos.adjuntar(vende, rCar.reclamo.id,
    { buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(20)]), originalname: 'virus.jpg' }), /Solo se aceptan/);
  await falla('otra sede no adjunta', () => archivos.adjuntar({ ...superv, sucursal_id: 2 }, rCar.reclamo.id,
    { buffer: JPG, originalname: 'x.jpg' }), /otra sucursal/);
  const bajada = await archivos.descargar(superv, f.id);
  checkSi('se descarga idéntica', bajada.buffer.equals(JPG));
  const det = await svc.detalle(superv, rCar.reclamo.id);
  checkEq('el detalle la lista (sin su ruta en el almacenamiento)', [det.archivos.length, 'storage_path' in det.archivos[0]], [1, false]);
  mem.objetos.set([...mem.objetos.keys()][0], Buffer.from('alterado'));
  await falla('un archivo alterado no se entrega', () => archivos.descargar(superv, f.id), /ARCHIVO_ALTERADO/);
  await archivos.anular(admin, f.id, 'foto equivocada');
  checkEq('anular no borra: la fila sigue, anulada', (await q('SELECT anulado FROM reclamos_garantia_archivos WHERE id = $1', [f.id]))[0].anulado, true);
  await falla('una foto anulada no la baja el vendedor', () => archivos.descargar(vende, f.id), /anulada/);
}

seccion('19. Desde una orden de Servicios');
{
  await db.exec(`
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS cliente_cedula TEXT;
    ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS cliente_telefono TEXT;
    INSERT INTO seriales (id, producto_id, imei, costo_compra, precio, vendido, fecha_salida) VALUES (40, 1, 'IMEI-OS', 1900000, 3000000, true, CURRENT_DATE);
    INSERT INTO facturas (id, numero, sucursal_id, nombre_cliente, cedula, estado) VALUES (9, 109, 1, 'Pedro OS', '999', 'Activa');
    INSERT INTO lineas_factura (id, factura_id, nombre_producto, imei, cantidad, precio) VALUES (9, 9, 'iPhone 13', 'IMEI-OS', 1, 3000000);
    INSERT INTO ordenes_servicio (id, numero, sucursal_id, factura_id, cliente_nombre, equipo_nombre, equipo_serial, estado, falla_reportada)
      VALUES (1, 31, 1, 9, 'Pedro OS', 'iPhone 13', 'IMEI-OS', 'Garantia', 'No carga'),
             (2, 32, 1, NULL, 'Otro', 'Samsung', 'IMEI-AJENO-DEL-CLIENTE', 'Recibido', 'Pantalla'),
             (3, 33, 1, NULL, 'Sin serial', 'Tablet', NULL, 'Recibido', 'x');
  `);
  const [c] = await svc.buscarCandidatos(superv, null, { orden_servicio_id: 1 });
  checkEq('la orden resuelve su equipo como una venta', [c.origen_tipo, c.factura?.numero, c.orden_servicio?.numero], ['factura', 109, 31]);
  const [ajeno] = await svc.buscarCandidatos(superv, null, { orden_servicio_id: 2 });
  checkSi('un equipo que no es nuestro lo dice', /no salió de tu inventario/.test(ajeno.bloqueo || ''));
  const [sinSerial] = await svc.buscarCandidatos(superv, null, { orden_servicio_id: 3 });
  checkSi('una orden sin IMEI lo dice', /no tiene el IMEI/.test(sinSerial.bloqueo || ''));
  const r = await svc.crear(superv, null, {
    origen: { tipo: 'factura', linea_factura_id: 9, orden_servicio_id: 1 }, falla: 'No carga', proveedor_id: 1,
  });
  const det = await svc.detalle(superv, r.reclamo.id);
  checkEq('la garantía queda ligada a la orden', det.orden_servicio?.numero, 31);
  await falla('una orden de otro equipo no se puede ligar', () => svc.crear(superv, null, {
    origen: { tipo: 'inventario', serial_id: 3, orden_servicio_id: 1 }, falla: 'x' }), /no corresponde/);
  const [porImei] = await svc.buscarCandidatos(superv, null, { imei: 'IMEI-OS' });
  checkSi('buscar por IMEI exacto lo encuentra (ya en garantía)', /Ya está en la garantía/.test(porImei.bloqueo || ''));
}

seccion('20. Avisos');
{
  mw.invalidarCache();
  const p = await operaciones.reclamosPendientes(1);
  checkEq('la función está activa en los avisos', p.activo, true);
  checkSi('cuenta clientes esperando', p.esperando.total >= 1);
  // Un caso con el cliente esperando y el proveedor que YA repuso → urgente.
  const rEsp = await svc.crear(superv, null, { origen: { tipo: 'factura', linea_factura_id: 4 }, falla: 'rayado', proveedor_id: 1 });
  await svc.crearEnvio(superv, null, { proveedor_id: 1, linea_ids: [rEsp.linea.id] });
  await svc.resolverProveedor(superv, rEsp.linea.id, { tipo: 'reposicion' });
  const p2 = await operaciones.reclamosPendientes(1);
  checkSi('el cliente cuya unidad ya volvió está «listo»', p2.listos.items.some((x) => x.reclamo_id === rEsp.reclamo.id));
  // Demorada: un envío de hace 20 días.
  await db.query(`UPDATE envios_garantia SET fecha = NOW() - INTERVAL '20 days'`);
  const { senales } = await motor.recolectar(1);
  const claves = senales.map((s) => s.clave);
  checkSi('«ya pueden recibir» es URGENTE', senales.some((s) => s.clave === 'garantias_listas_cliente' && s.prioridad === 'urgente'));
  checkSi('las demás van al resumen', ['garantias_clientes_esperando'].every((k) => claves.includes(k))
    && senales.filter((s) => s.categoria === 'reclamos' && s.clave !== 'garantias_listas_cliente').every((s) => s.prioridad === 'normal'));
  checkSi('el enlace abre la pestaña con el filtro', senales.find((s) => s.clave === 'garantias_listas_cliente').url.includes('tab=garantias&filtro=cliente_pendiente'));
  await db.query(`DELETE FROM config_negocio WHERE clave = 'reclamos_garantia_activo'`);
  mw.invalidarCache();
  checkEq('apagada la función, ningún aviso', (await operaciones.reclamosPendientes(1)).activo, false);
  await db.query(`INSERT INTO config_negocio (negocio_id, clave, valor) VALUES (1, 'reclamos_garantia_activo', '1')`);
  mw.invalidarCache();
}

seccion('21. Valor del inventario y estado de cuenta');
{
  // El valor del inventario mira el valor interno de la red: sus tablas.
  for (const m of ['20260725_red_interna', '20260726_red_interna_v2', '20260822_red_interna_envios',
    '20260823_red_interna_control', '20260823_red_interna_cargos_pagables', '20260823_remision_variantes',
    '20260823_lotes_cantidad', '20260824_costo_origen_remision', '20260823_valor_acreditado']) {
    await db.exec(readFileSync(path.join(RAIZ, `../migrations/${m}.sql`), 'utf8'));
  }
  const v = await reportesSvc.getValorInventario(1);
  const disponibles = (await q(`
    SELECT COUNT(*)::int n FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
    WHERE ps.sucursal_id = 1 AND NOT s.vendido AND NOT s.prestado`))[0].n;
  const enGar = (await svc.enInventario(superv, null)).seriales.length;
  checkEq('el inventario de seriales no cuenta los que están en garantía', v.serial.unidades, disponibles - enGar);
  checkSi('y los informa aparte, con su costo', v.en_garantia && v.en_garantia.unidades >= enGar && v.en_garantia.costo_total > 0);
  const ec = await svc.estadoCuentaProveedor(superv, null, 1, {});
  checkSi('el estado de cuenta del proveedor trae sus líneas', ec.lineas.length > 0 && ec.lineas.every((l) => l.estado_proveedor !== undefined));
  checkEq('cuenta las reposiciones', ec.resumen.repuestas >= 1, true);
  const buf = await aBuffer(pdf.construirPdfEstadoCuenta(ec, { nombre_negocio: 'Tesla' }));
  checkSi('su PDF sale', buf.slice(0, 4).toString() === '%PDF');
  await falla('un proveedor de otro negocio no', () => svc.estadoCuentaProveedor(superv, null, 3, {}), /no encontrado/);
}

seccion('22. Historia del IMEI');
{
  const h = await busquedaRepo.getGarantiasPorIMEI('IMEI-OS', 1);
  checkEq('el IMEI que fue a garantía tiene su caso', h.casos.length, 1);
  const h2 = await busquedaRepo.getGarantiasPorIMEI('IMEI-PRE2', 1);
  checkSi('el equipo entregado en un cambio dice de qué garantía vino', h2.reposiciones.some((x) => x.tipo === 'cambio' && x.imei_anterior === 'IMEI-PRE'));
}

// Hallazgos de la prueba en el navegador (24-oct-2026).
seccion('23. Lo que se vio en el navegador');
{
  // La tarjeta «Con proveedores» sumaba también lo que aún no sale: decía 0
  // casos y $2.000.000 a la vez.
  const repo = require(path.join(RAIZ, 'src/modules/reclamos-garantia/reclamosGarantia.repository.js'));
  const r = await repo.resumen(1, null, 15);
  const [esperado] = await q(`SELECT COALESCE(SUM((l.cantidad - l.cantidad_resuelta) * COALESCE(l.costo_unitario, 0)), 0)::numeric AS v
    FROM reclamos_garantia_lineas l JOIN reclamos_garantia r ON r.id = l.reclamo_id
    WHERE r.negocio_id = 1 AND NOT r.anulado AND NOT l.cerrada AND l.envio_id IS NOT NULL`);
  checkEq('el valor «con proveedores» es solo lo enviado', r.valor_afuera, Number(esperado.v));
  if (r.afuera === 0) checkEq('sin nada afuera, $0', r.valor_afuera, 0);

  // La cabecera de la búsqueda por IMEI decía «Disponible» de un equipo en
  // garantía y «Vendido» del que se quedó el proveedor.
  const busquedaSvc = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.service.js'));
  const casos = await q(`SELECT l.imei, l.cerrada, s.vendido,
      EXISTS (SELECT 1 FROM reclamos_garantia_movimientos m WHERE m.linea_id = l.id AND NOT m.anulado
              AND m.lado = 'proveedor' AND m.tipo IN ('reposicion','nota_credito','reembolso_proveedor')) AS se_lo_quedo
    FROM reclamos_garantia_lineas l JOIN reclamos_garantia r ON r.id = l.reclamo_id JOIN seriales s ON s.id = l.serial_id
    WHERE r.negocio_id = 1 AND NOT r.anulado AND l.imei IS NOT NULL`);
  const abierto = casos.find((c) => !c.cerrada && !c.vendido);
  const quedado = casos.find((c) => c.cerrada && c.vendido && c.se_lo_quedo);
  for (const [c, texto] of [[abierto, 'En garantía'], [quedado, 'Lo tiene el proveedor']]) {
    if (!c) { checkSi(`hay un caso «${texto}» para probar`, false); continue; }
    try {
      const res = await busquedaSvc.buscarPorIMEI(c.imei, 1, 'admin_negocio');
      checkEq(`la cabecera de ${c.imei} dice «${texto}»`, res.serial.estado_garantia, texto);
    } catch (err) {
      checkSi(`la búsqueda de ${c.imei} corre (${err.message})`, false);
    }
  }

  // Una ruta mal escrita que cae en `/:id` respondía 500 («NaN» contra la base).
  const rutas = readFileSync(path.join(RAIZ, 'src/modules/reclamos-garantia/reclamosGarantia.routes.js'), 'utf8');
  checkSi('los :id no numéricos se cortan antes de la base', /router\.param\(p,/.test(rutas) && rutas.includes("'proveedorId'"));

  // Desde una orden de Servicios, la falla ya escrita llega al asistente.
  const modal = readFileSync(path.join(RAIZ, '../frontend/src/pages/proveedores/garantias/ModalNuevaGarantia.jsx'), 'utf8');
  checkSi('el asistente arranca con la falla de la orden', modal.includes('candidato?.orden_servicio?.falla'));
  const det = await svc.buscarCandidatos(superv, null, { orden_servicio_id: 1 });
  checkSi('y el candidato de la orden la trae', det.some((c) => c.orden_servicio?.falla === 'No carga'));
}

console.log(`\n${ok} verificaciones correctas, ${fallos.length} fallidas`);
if (fallos.length) { console.log('\nFALLAS:'); fallos.forEach((f) => console.log(' ·', f)); process.exit(1); }
