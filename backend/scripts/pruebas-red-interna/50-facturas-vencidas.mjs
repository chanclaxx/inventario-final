// ─────────────────────────────────────────────────────────────────────────────
// FACTURAS DE PROVEEDOR VENCIDAS — el aviso, la lista y la tarjeta cuentan igual
//
// Reportado desde producción (sep-2026): el aviso «N facturas vencidas» llevaba
// a la pestaña general de Proveedores, que no dice cuáles son. Ahora lleva a
// Acreedores → Facturas → Vencidas, y la tarjeta de cada acreedor dice cuántas
// tiene vencidas.
//
// Lo que esta prueba sostiene, en orden de importancia:
//
//   1. QUE LOS TRES NÚMEROS SEAN EL MISMO. El aviso, la pestaña a la que lleva y
//      la suma de las tarjetas. Antes el aviso tenía su propia consulta (por
//      ORDEN, solo 'Emitida'): una compra suelta con plazo o una orden ya
//      cerrada con la factura sin pagar no avisaban, y el usuario tocaba
//      «1 factura vencida» para encontrar tres.
//
//   2. Que «vencida» sea lo mismo en todas partes: saldo > 0 y fecha < hoy. Lo
//      pagado sale solo, lo que vence hoy o después no cuenta, lo sin plazo
//      tampoco, y otro negocio no se cuela.
//
//   3. Que el enlace del aviso abra un filtro que la pantalla sí tiene.
//
//   node scripts/pruebas-red-interna/50-facturas-vencidas.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
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
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS orden_compra_id INT;
  CREATE TABLE IF NOT EXISTS acreedores (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT,
    telefono TEXT, proveedor_id INT
  );
  CREATE TABLE IF NOT EXISTS movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, usuario_id INT, tipo TEXT,
    valor NUMERIC DEFAULT 0, descripcion TEXT, fecha TIMESTAMP DEFAULT NOW(),
    compra_id INT, cargo_id INT, registrar_en_caja BOOLEAN DEFAULT TRUE,
    metodo TEXT, sucursal_id INT
  );
  CREATE TABLE IF NOT EXISTS lineas_compra (
    id SERIAL PRIMARY KEY, compra_id INT, nombre_producto TEXT, imei TEXT,
    cantidad INT, precio_unitario NUMERIC, variante_id INT, atributo_id INT,
    producto_id INT, cantidad_devuelta INT DEFAULT 0
  );
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS fecha_limite DATE;
  ALTER TABLE creditos  ADD COLUMN IF NOT EXISTS fecha_limite DATE;
  ALTER TABLE negocios ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;
  ALTER TABLE negocios ADD COLUMN IF NOT EXISTS estado_plan TEXT DEFAULT 'activo';
  ALTER TABLE negocios ADD COLUMN IF NOT EXISTS plan TEXT;
  ALTER TABLE negocios ADD COLUMN IF NOT EXISTS fecha_vencimiento TIMESTAMP;
`);
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260806_ordenes_compra.sql'), 'utf8'));

const conectar = () => ({ query: (s, p) => db.query(s, p ?? []) });
const pool = { ...conectar(), connect: async () => ({ ...conectar(), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const acreedoresSvc = require(path.join(RAIZ, 'src/modules/acreedores/acreedores.service.js'));
const alertas       = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.alertas.js'));
const motor         = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.motor.js'));
const { invalidarCache } = require(path.join(RAIZ, 'src/middlewares/ordenesCompra.middleware.js'));

// ── Datos base ──────────────────────────────────────────────────────────────
// Negocio 1: Distri (A1) debe cuatro facturas en cuatro situaciones distintas;
// TecnoCell (A2) debe una que vence mañana y una sin plazo. Negocio 2 tiene una
// vencida que NO puede aparecer en el negocio 1.
await db.exec(`
  INSERT INTO negocios(id, nombre) VALUES (1, 'Test'), (2, 'Otro');
  INSERT INTO sucursales(id, negocio_id, nombre, activa) VALUES (1, 1, 'Principal', true), (2, 2, 'Otra', true);
  INSERT INTO usuarios(id, nombre) VALUES (1, 'Ana');
  INSERT INTO proveedores(id, negocio_id, nombre, nit, activo) VALUES
    (1, 1, 'Distri SAS', '900', true), (2, 1, 'TecnoCell', '901', true), (3, 2, 'Ajeno', '902', true);
  INSERT INTO acreedores(id, negocio_id, nombre, proveedor_id) VALUES
    (1, 1, 'Distri SAS', 1), (2, 1, 'TecnoCell', 2), (3, 2, 'Ajeno', 3);
  INSERT INTO config_negocio(negocio_id, clave, valor) VALUES
    (1, 'ordenes_compra_activas', '1'), (2, 'ordenes_compra_activas', '1');

  -- Una orden ya CERRADA con la factura sin pagar: la consulta vieja del aviso
  -- solo miraba órdenes 'Emitida' y esta deuda no avisaba.
  INSERT INTO ordenes_compra(id, negocio_id, sucursal_id, proveedor_id, numero, estado, numero_factura, fecha_vencimiento)
  VALUES (10, 1, 1, 1, 1, 'Cerrada', 'F-100', CURRENT_DATE - 5);
  -- Una compra SUELTA con plazo: no tiene orden y el aviso viejo no la veía.
  INSERT INTO compras(id, numero, sucursal_id, proveedor_id, numero_factura, total, estado)
  VALUES (20, 7, 1, 1, 'F-200', 50000, 'Activa');

  INSERT INTO movimientos_acreedor(id, acreedor_id, tipo, valor, descripcion, sucursal_id, orden_compra_id, compra_id, fecha_vencimiento) VALUES
    (1, 1, 'Cargo', 100000, 'Orden cerrada',        1, 10,   NULL, CURRENT_DATE - 5),
    (2, 1, 'Cargo',  50000, 'Compra suelta',        1, NULL, 20,   CURRENT_DATE - 2),
    (3, 1, 'Cargo',  70000, 'Vence en diez días',   1, NULL, NULL, CURRENT_DATE + 10),
    (4, 1, 'Cargo',  40000, 'Vencida pero pagada',  1, NULL, NULL, CURRENT_DATE - 1),
    (5, 2, 'Cargo',  30000, 'Vence mañana',         1, NULL, NULL, CURRENT_DATE + 1),
    (6, 2, 'Cargo',  25000, 'Sin plazo',            1, NULL, NULL, NULL),
    (7, 3, 'Cargo',  90000, 'Otro negocio',         2, NULL, NULL, CURRENT_DATE - 3);
  -- Abono parcial a la compra suelta y pago completo de la #4.
  INSERT INTO movimientos_acreedor(id, acreedor_id, tipo, valor, descripcion, cargo_id, sucursal_id) VALUES
    (8, 1, 'Abono', 20000, 'Abono parcial', 2, 1),
    (9, 1, 'Abono', 40000, 'Pago total',    4, 1);
  SELECT setval('movimientos_acreedor_id_seq', 100);
`);

const tarjetas = async (negocioId) =>
  Object.fromEntries((await acreedoresSvc.getAcreedores(negocioId, '')).map((a) => [a.id, a]));

// ═══════════════════════════════════════════════════════════════════════════
seccion('1. El aviso, la pestaña y las tarjetas dicen el MISMO número');
// ═══════════════════════════════════════════════════════════════════════════
const facturas = await acreedoresSvc.getFacturasPorVencer(1);
const cartera  = await alertas.carteraProveedores(1);
const t1       = await tarjetas(1);
const sumaTarjetas = Object.values(t1).reduce((s, a) => s + a.facturas_vencidas, 0);
const saldoTarjetas = Object.values(t1).reduce((s, a) => s + a.saldo_vencido, 0);

check('★★ la pestaña Facturas → Vencidas cuenta 2', facturas.resumen.vencidas.cuantas, 2);
check('★★ el aviso cuenta las MISMAS 2', cartera.vencidas.length, facturas.resumen.vencidas.cuantas);
check('★★ y las tarjetas suman las mismas 2', sumaTarjetas, facturas.resumen.vencidas.cuantas);
check('★ el saldo vencido coincide en el aviso ($130.000)',
  cartera.vencidas.reduce((s, v) => s + v.saldo, 0), facturas.resumen.vencidas.valor);
check('★ y en las tarjetas', saldoTarjetas, facturas.resumen.vencidas.valor);
check('las por vencer también coinciden', cartera.por_vencer.length, facturas.resumen.por_vencer.cuantas);

// ═══════════════════════════════════════════════════════════════════════════
seccion('2. Lo que el aviso viejo no veía');
// ═══════════════════════════════════════════════════════════════════════════
const idsAviso = cartera.vencidas.map((v) => v.id).sort();
check('★ avisa de la factura de una orden CERRADA sin pagar', idsAviso.includes(1), true);
check('★ avisa de la compra SUELTA con plazo', idsAviso.includes(2), true);
check('cada ítem del aviso trae su acreedor (para ir a su ficha)',
  cartera.vencidas.every((v) => v.acreedor_id === 1), true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('3. La tarjeta de cada acreedor');
// ═══════════════════════════════════════════════════════════════════════════
check('Distri: 2 facturas vencidas', t1[1].facturas_vencidas, 2);
check('Distri: $130.000 vencidos (100.000 + 50.000 − 20.000 abonado)', t1[1].saldo_vencido, 130000);
check('Distri: el semáforo sigue diciendo "vencida"', t1[1].estado_pago, 'vencida');
check('la pagada no cuenta aunque su fecha ya pasó', t1[1].facturas_vencidas, 2);
check('TecnoCell: la que vence mañana no es vencida', t1[2].facturas_vencidas, 0);
check('TecnoCell: saldo vencido en 0, no null', t1[2].saldo_vencido, 0);
check('★ otro negocio no aparece en la lista', t1[3], undefined);
const t2 = await tarjetas(2);
check('★ y su vencida no se suma al negocio 1', t2[3].facturas_vencidas, 1);

// ═══════════════════════════════════════════════════════════════════════════
seccion('4. La ficha marca cuáles están vencidas');
// ═══════════════════════════════════════════════════════════════════════════
const cargosA1 = Object.fromEntries(
  (await acreedoresSvc.getComprasConSaldo(1, 1)).map((c) => [c.id, c]));
check('el cargo de la orden cerrada trae −5 días', Number(cargosA1[1].dias_para_vencer), -5);
check('el que vence en diez días trae +10', Number(cargosA1[3].dias_para_vencer), 10);
const cargosA2 = Object.fromEntries(
  (await acreedoresSvc.getComprasConSaldo(1, 2)).map((c) => [c.id, c]));
check('uno sin plazo trae null (no se marca)', cargosA2[6].dias_para_vencer, null);

// ═══════════════════════════════════════════════════════════════════════════
seccion('5. Pagar apaga el aviso y la tarjeta a la vez');
// ═══════════════════════════════════════════════════════════════════════════
await db.query(`INSERT INTO movimientos_acreedor(acreedor_id, tipo, valor, descripcion, cargo_id, sucursal_id)
                VALUES (1, 'Abono', 100000, 'Pago orden', 1, 1)`);
const tras = await tarjetas(1);
const carteraTras = await alertas.carteraProveedores(1);
check('la tarjeta baja a 1', tras[1].facturas_vencidas, 1);
check('el aviso baja a 1', carteraTras.vencidas.length, 1);
check('el saldo vencido queda en lo que falta de la suelta', tras[1].saldo_vencido, 30000);

// ═══════════════════════════════════════════════════════════════════════════
seccion('6. El enlace del aviso abre un filtro que la pantalla sí tiene');
// ═══════════════════════════════════════════════════════════════════════════
const { senales } = await motor.recolectar(1);
const senalVencidas = senales.find((s) => s.clave === 'proveedor_vencido');
const senalPorVencer = senales.find((s) => s.clave === 'proveedor_por_vencer');
check('★ el aviso de vencidas lleva a Facturas → Vencidas',
  senalVencidas?.url, '/acreedores?tab=facturas&filtro=vencidas');
check('el título cuenta lo mismo que la lista', senalVencidas?.titulo, '1 factura vencida por pagar');
check('el de por vencer lleva a la pestaña Facturas', senalPorVencer?.url, '/acreedores?tab=facturas');

const tabFacturas = readFileSync(path.join(FRONT, 'pages/acreedores/TabFacturas.jsx'), 'utf8');
const pagina      = readFileSync(path.join(FRONT, 'pages/acreedores/AcreedoresPage.jsx'), 'utf8');
const proveedores = readFileSync(path.join(FRONT, 'pages/proveedores/ProveedoresPage.jsx'), 'utf8');
const url = new URL(senalVencidas.url, 'http://x');
check('★ TabFacturas tiene el filtro que pide el enlace',
  tabFacturas.includes(`id: '${url.searchParams.get('filtro')}'`), true);
check('★ la página lee la pestaña de la URL', pagina.includes(`params.get('tab') === '${url.searchParams.get('tab')}'`), true);
check('★ la página le pasa el filtro de la URL a la pestaña', pagina.includes(`params.get('filtro')`), true);
check('la tarjeta de Acreedores pinta las vencidas',
  /AvisoFacturasVencidas[^>]*facturas_vencidas/.test(pagina), true);
check('la tarjeta de Proveedores también',
  /AvisoFacturasVencidas[\s\S]{0,120}facturas_vencidas/.test(proveedores), true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('7. Con las órdenes apagadas no hay aviso');
// ═══════════════════════════════════════════════════════════════════════════
await db.query(`UPDATE config_negocio SET valor = '0' WHERE negocio_id = 1 AND clave = 'ordenes_compra_activas'`);
invalidarCache(1);
const apagado = await alertas.carteraProveedores(1);
check('sin la feature (y sin la pestaña) no se avisa', apagado.vencidas.length + apagado.por_vencer.length, 0);

console.log(`\n${pasados} verificaciones pasaron · ${fallos} fallaron`);
process.exit(fallos ? 1 : 0);
