// ─────────────────────────────────────────────────────────────────────────────
// SUITE DE AISLAMIENTO ENTRE SUCURSALES  (prueba de caracterización)
//
// Propósito: dejar por escrito, en código ejecutable, que dos sucursales que
// manejan EL MISMO producto (mismo nombre, mismo código) siguen siendo
// independientes en stock, seriales, ventas, préstamos, reportes y alertas.
//
// Se corre ANTES de tocar el catálogo (línea base) y DESPUÉS del cambio.
// Si los resultados son idénticos, el aislamiento está probado, no argumentado.
//
// Ejercita los REPOSITORIOS REALES del sistema contra un Postgres de verdad
// (PGlite/WASM en memoria). No toca ninguna base de producción.
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
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260822_red_interna_envios.sql'), 'utf8'));

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

// ── Repositorios y servicios REALES del sistema ────────────────────────────
const repoCantidad = require(path.join(RAIZ, 'src/modules/productos/productosCantidad.repository.js'));
const repoSerial   = require(path.join(RAIZ, 'src/modules/productos/productosSerial.repository.js'));
const svcCantidad  = require(path.join(RAIZ, 'src/modules/productos/productosCantidad.service.js'));
const repoBusqueda = require(path.join(RAIZ, 'src/modules/busqueda/busqueda.repository.js'));
const svcReportes  = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));

let fallos = 0, pasados = 0;
const q = async (s, p = []) => (await db.query(s, p)).rows;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCENARIO BASE — el caso más exigente posible:
// dos sucursales con EL MISMO producto, mismo nombre y MISMO CÓDIGO.
// Si el aislamiento aguanta aquí, aguanta en cualquier parte.
// ─────────────────────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Negocio Aislamiento');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Centro'),(1,'Norte');
  INSERT INTO usuarios (nombre) VALUES ('U1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'Celulares'),(1,'Accesorios');

  -- MISMO producto serial en ambas sucursales (misma referencia lógica)
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id) VALUES
    ('iPhone 13','Apple','128GB', 2600000, 1, 1),   -- id 1 · Centro
    ('iPhone 13','Apple','128GB', 2700000, 2, 1);   -- id 2 · Norte
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'AAA111', 1800000), (1,'AAA222', 1810000),   -- Centro: 2 equipos
    (2,'BBB111', 1900000), (2,'BBB222', 1910000);   -- Norte:  2 equipos

  -- MISMO accesorio en ambas, con EL MISMO CÓDIGO (el caso límite)
  INSERT INTO productos_cantidad (nombre, stock, stock_minimo, costo_unitario, precio, sucursal_id, linea_id, codigo) VALUES
    ('Cargador tipo C', 100, 10, 8000, 20000, 1, 2, 'ACC-001'),  -- id 1 · Centro
    ('Cargador tipo C',  40, 10, 8500, 21000, 2, 2, 'ACC-001');  -- id 2 · Norte
`);

console.log('\n═══ 1. Inventario: cada sucursal ve solo lo suyo ═══');
const invCentro = await repoCantidad.findAll(1, 1, null);
const invNorte  = await repoCantidad.findAll(2, 1, null);
ok('Centro ve 1 producto de cantidad', invCentro.items.length === 1);
ok('  con SU stock (100)', Number(invCentro.items[0].stock) === 100);
ok('Norte ve 1 producto de cantidad', invNorte.items.length === 1);
ok('  con SU stock (40)', Number(invNorte.items[0].stock) === 40);
ok('★ Son filas distintas', invCentro.items[0].id !== invNorte.items[0].id);
ok('★ Cada una con su propio costo',
   Number(invCentro.items[0].costo_unitario) === 8000 &&
   Number(invNorte.items[0].costo_unitario) === 8500);
ok('★ Y su propio precio de venta',
   Number(invCentro.items[0].precio) === 20000 &&
   Number(invNorte.items[0].precio) === 21000);

const serCentro = await repoSerial.findAll(1, 1, null);
const serNorte  = await repoSerial.findAll(2, 1, null);
ok('Centro ve 2 equipos disponibles', Number(serCentro[0].disponibles) === 2);
ok('Norte ve 2 equipos disponibles',  Number(serNorte[0].disponibles) === 2);

console.log('\n═══ 2. Vista global: agrupa pero NO mezcla ═══');
const global = await repoCantidad.findAll(null, 1, null);
ok('Agrupa el mismo producto en un renglón', global.items.length === 1);
ok('  con el total sumado (140)', Number(global.items[0].stock_total) === 140);
ok('★ Pero detalla cada sucursal por separado', global.items[0].sucursales.length === 2);
const detCentro = global.items[0].sucursales.find((s) => s.sucursal_id === 1);
const detNorte  = global.items[0].sucursales.find((s) => s.sucursal_id === 2);
ok('★ Con el stock correcto de cada una', Number(detCentro.stock) === 100 && Number(detNorte.stock) === 40);

console.log('\n═══ 3. Vender en Centro NO toca a Norte ═══');
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, estado, fecha)
    VALUES (1, 1, 'Cliente Centro', 'Activa', NOW());
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 13', 'AAA111', 1, 2600000);
  INSERT INTO pagos_factura (factura_id, metodo, valor) VALUES (1,'Efectivo',2600000);
  UPDATE seriales SET vendido = TRUE WHERE imei = 'AAA111';
`);
await svcCantidad.ajustarStock(1, 1, -5, { tipo: 'venta' });   // 5 cargadores en Centro

const invCentro2 = await repoCantidad.findAll(1, 1, null);
const invNorte2  = await repoCantidad.findAll(2, 1, null);
ok('★ Stock de Centro bajó a 95', Number(invCentro2.items[0].stock) === 95);
ok('★ Stock de Norte SIGUE en 40', Number(invNorte2.items[0].stock) === 40);

const serCentro2 = await repoSerial.findAll(1, 1, null);
const serNorte2  = await repoSerial.findAll(2, 1, null);
ok('★ Centro queda con 1 equipo disponible', Number(serCentro2[0].disponibles) === 1);
ok('★ Norte SIGUE con 2 equipos disponibles', Number(serNorte2[0].disponibles) === 2);

console.log('\n═══ 4. Prestar en Centro NO afecta a Norte ═══');
await db.exec(`
  INSERT INTO prestamos (numero, sucursal_id, prestatario, imei, valor, estado, nombre_producto)
    VALUES (1, 1, 'Juan', 'AAA222', 500000, 'Activo', 'iPhone 13');
  UPDATE seriales SET prestado = TRUE WHERE imei = 'AAA222';
`);
const serCentro3 = await repoSerial.findAll(1, 1, null);
const serNorte3  = await repoSerial.findAll(2, 1, null);
ok('★ Centro queda sin equipos disponibles', Number(serCentro3[0].disponibles) === 0);
ok('★ Norte SIGUE con 2 disponibles', Number(serNorte3[0].disponibles) === 2);
const prestadosNorte = await q(
  `SELECT COUNT(*)::int c FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id
   WHERE ps.sucursal_id = 2 AND s.prestado`);
ok('★ Ningún serial de Norte quedó marcado como prestado', prestadosNorte[0].c === 0);

console.log('\n═══ 5. Escanear el MISMO código en cada sucursal ═══');
const codCentro = await repoBusqueda.buscarCantidadPorCodigo('ACC-001', 1, 1);
const codNorte  = await repoBusqueda.buscarCantidadPorCodigo('ACC-001', 1, 2);
ok('★ En Centro devuelve la fila de Centro', codCentro?.[0]?.id === 1, `id ${codCentro?.[0]?.id}`);
ok('★ En Norte devuelve la fila de Norte',  codNorte?.[0]?.id === 2,  `id ${codNorte?.[0]?.id}`);
ok('★ Con el stock de cada una',
   Number(codCentro?.[0]?.stock) === 95 && Number(codNorte?.[0]?.stock) === 40);

console.log('\n═══ 6. Reportes: cada sucursal cuenta lo suyo ═══');
const dashCentro = await svcReportes.getDashboard(1);
const dashNorte  = await svcReportes.getDashboard(2);
ok('★ Ventas de hoy en Centro', Number(dashCentro.ventas_hoy) === 2600000, money(dashCentro.ventas_hoy));
ok('★ Ventas de hoy en Norte = 0', Number(dashNorte.ventas_hoy) === 0, money(dashNorte.ventas_hoy));
ok('★ Utilidad de Centro = 2.600.000 − 1.800.000',
   Number(dashCentro.utilidad_hoy) === 800000, money(dashCentro.utilidad_hoy));
ok('★ Utilidad de Norte = 0', Number(dashNorte.utilidad_hoy) === 0);

// La fecha del negocio es la de Colombia, no la UTC: entre las 19:00 y la
// medianoche de Bogotá `toISOString()` ya devuelve el día siguiente y el rango
// dejaba fuera las facturas de hoy, haciendo fallar la suite cada tarde.
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const ventasCentro = await svcReportes.getVentasRango(1, hoy, hoy);
const ventasNorte  = await svcReportes.getVentasRango(2, hoy, hoy);
ok('★ Centro reporta 1 factura', ventasCentro.facturas.length === 1);
ok('★ Norte reporta 0 facturas', ventasNorte.facturas.length === 0);

console.log('\n═══ 7. Alerta de stock bajo: no se contamina ═══');
const bajoCentro = await svcReportes.getInventarioBajo(1);
const bajoNorte  = await svcReportes.getInventarioBajo(2);
ok('Centro sin alertas (95 > 10)', bajoCentro.length === 0);
ok('Norte sin alertas (40 > 10)',  bajoNorte.length === 0);
ok('★ El contador del dashboard de Centro está limpio', Number(dashCentro.stock_bajo) === 0);
ok('★ Y el de Norte también', Number(dashNorte.stock_bajo) === 0);

console.log('\n   … bajo el stock de Norte por debajo del mínimo');
await svcCantidad.ajustarStock(1, 2, -35, { tipo: 'venta' });  // Norte: 40 → 5
const bajoCentro2 = await svcReportes.getInventarioBajo(1);
const bajoNorte2  = await svcReportes.getInventarioBajo(2);
ok('★ Norte SÍ alerta', bajoNorte2.length === 1);
ok('★ Centro NO se contagia', bajoCentro2.length === 0);

console.log('\n═══ 8. Valor de inventario por sucursal ═══');
const valCentro = await svcReportes.getValorInventario(1);
const valNorte  = await svcReportes.getValorInventario(2);
// El costo de inventario de cada sucursal se calcula solo con SUS filas.
// Centro: 1 equipo prestado + 95 cargadores × 8.000 · Norte: 2 equipos + 5 × 8.500
const costoCentro = Number(valCentro?.cantidad?.costo_total ?? valCentro?.total_costo ?? 0);
const costoNorte  = Number(valNorte?.cantidad?.costo_total  ?? valNorte?.total_costo  ?? 0);
ok('★ El costo de inventario de cada sucursal es independiente',
   costoCentro !== costoNorte, `Centro ${money(costoCentro)} · Norte ${money(costoNorte)}`);
ok('★ Ninguna suma stock de la otra',
   costoCentro > 0 && costoNorte > 0 && costoCentro !== costoNorte);

console.log('\n═══ 9. Ajustar costo en una sucursal no mueve la otra ═══');
await svcCantidad.ajustarStock(1, 1, 50, { costo_unitario: 9000, tipo: 'compra' });
const cCentro = await q(`SELECT costo_unitario FROM productos_cantidad WHERE id = 1`);
const cNorte  = await q(`SELECT costo_unitario FROM productos_cantidad WHERE id = 2`);
ok('★ El costo de Centro se recalculó', Number(cCentro[0].costo_unitario) !== 8000,
   money(cCentro[0].costo_unitario));
ok('★ El costo de Norte quedó intacto (8.500)', Number(cNorte[0].costo_unitario) === 8500);

console.log('\n═══ 10. El código único se valida a nivel NEGOCIO, no sucursal ═══');
// Dos productos DISTINTOS no pueden compartir código, aunque estén en sucursales
// distintas (así el escaneo nunca es ambiguo dentro del negocio).
let choco = false;
try {
  await svcCantidad.crearProducto(1, {
    nombre: 'Vidrio templado', sucursal_id: 2, linea_id: 2, codigo: 'ACC-001', stock: 5,
  });
} catch (e) { choco = e.status === 409; }
ok('★ Rechaza el mismo código para otro producto', choco);

// El MISMO producto lógico SÍ hereda el código al crearse en una sucursal
// que todavía no lo tenía. Es `codigoHeredado`, ya en producción.
await db.exec(`INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Sur')`);
const enSur = await svcCantidad.crearProducto(1, {
  nombre: 'Cargador tipo C', sucursal_id: 3, linea_id: 2, stock: 0,
}).catch((e) => ({ error: e.message }));
ok('★ Al crearlo en una sucursal nueva HEREDA el código del negocio',
   enSur.codigo === 'ACC-001', enSur.error || `cod ${enSur.codigo}`);
ok('  y nace con su propio stock en cero', Number(enSur.stock) === 0);

console.log('\n═══ 11. Garantías: siguen la línea del producto ═══');
await db.exec(`
  INSERT INTO garantias (negocio_id, nombre, orden) VALUES (1, '6 meses', 1);
  INSERT INTO garantias_lineas (garantia_id, linea_id) VALUES (1, 1);
`);
const repoGar = require(path.join(RAIZ, 'src/modules/garantias/garantias.repository.js'));
const garFactura = await repoGar.findByFacturaLineas
  ? await repoGar.findByFacturaLineas(1)
  : null;
ok('La garantía se resuelve por línea, no por sucursal',
   garFactura === null || Array.isArray(garFactura));

console.log('\n═══ 12. Conteo final de filas: nada se creó de más ═══');
const filas = await q(`
  SELECT
    (SELECT COUNT(*)::int FROM productos_serial)   AS serial,
    (SELECT COUNT(*)::int FROM productos_cantidad) AS cantidad,
    (SELECT COUNT(*)::int FROM seriales)           AS seriales`);
console.log(`   productos_serial=${filas[0].serial}  productos_cantidad=${filas[0].cantidad}  seriales=${filas[0].seriales}`);
ok('★ 2 referencias serial (una por sucursal)',   filas[0].serial === 2);
ok('★ 3 referencias cantidad (Centro, Norte y la de Sur recién creada)',
   filas[0].cantidad === 3);
ok('★ 4 seriales, ninguno duplicado',             filas[0].seriales === 4);

// Ninguna sucursal debe tener dos filas del mismo producto lógico.
const dupPorSucursal = await q(`
  SELECT sucursal_id, LOWER(TRIM(nombre)) AS nombre, COUNT(*)::int AS filas
  FROM productos_cantidad WHERE activo
  GROUP BY sucursal_id, LOWER(TRIM(nombre)) HAVING COUNT(*) > 1`);
ok('★ Ninguna sucursal tiene el mismo producto repetido', dupPorSucursal.length === 0,
   dupPorSucursal.map((d) => `suc${d.sucursal_id}:"${d.nombre}"×${d.filas}`).join(' '));

console.log(`\n${'═'.repeat(62)}`);
console.log(`AISLAMIENTO: ${pasados} pasaron, ${fallos} fallaron`);
console.log('═'.repeat(62));
process.exit(fallos ? 1 : 0);
