// ─────────────────────────────────────────────────────────────────────────────
// ÓRDENES DE COMPRA, RECEPCIÓN PARCIAL Y PROCEDENCIA
//
// Verifica contra Postgres real que el diseño se sostiene:
//
//   • el avance de la orden se DERIVA: cancelar una recepción la reabre sola
//   • devolver mercancía también la reabre — el caso que falla sin
//     lineas_compra.cantidad_devuelta
//   • recibir de más se rechaza; una orden en borrador no admite recepciones
//   • los DOS modos de cargo: 'recepcion' (cada entrega su deuda) y 'orden'
//     (la deuda nace con la factura y las entregas no crean cargo propio)
//   • en modo 'orden', recibir sin factura registrada se para en seco
//   • la procedencia lista los proveedores reales de un producto, descontando
//     lo devuelto, y no se deja engañar por productos_cantidad.proveedor_id
//   • el vencimiento de garantía no corre un día entre TIMESTAMP y DATE
//   • con la feature apagada, registrarCompra() se comporta como siempre
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const db = new PGlite();

// Esquema base + complemento, como todas las suites.
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));

// Lo que el fixture no trae y estas consultas sí tocan.
await db.exec(`
  ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS negocio_id INT;
  ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS nit TEXT;
  ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS telefono TEXT;

  CREATE TABLE IF NOT EXISTS acreedores (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT,
    telefono TEXT, proveedor_id INT
  );
  CREATE TABLE IF NOT EXISTS movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, usuario_id INT, tipo TEXT,
    valor NUMERIC DEFAULT 0, descripcion TEXT, fecha TIMESTAMP DEFAULT NOW(),
    compra_id INT, cargo_id INT, registrar_en_caja BOOLEAN DEFAULT TRUE,
    metodo TEXT, sucursal_id INT, mov_dinero_id BIGINT, pago_total_id BIGINT
  );
  CREATE TABLE IF NOT EXISTS lineas_compra (
    id SERIAL PRIMARY KEY, compra_id INT, nombre_producto TEXT, imei TEXT,
    cantidad INT, precio_unitario NUMERIC, precio_usd NUMERIC,
    factor_conversion NUMERIC, valor_traida NUMERIC,
    variante_id INT, atributo_id INT, producto_id INT
  );
  CREATE TABLE IF NOT EXISTS tipos_caracteristica (id SERIAL PRIMARY KEY, nombre TEXT, tipo_id INT);
  ALTER TABLE variantes_atributo ADD COLUMN IF NOT EXISTS tipo_id INT;
  ALTER TABLE atributos_producto  ADD COLUMN IF NOT EXISTS tipo_id INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS proveedor_id INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS usuario_id INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_factura TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS notas TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS registrar_en_caja BOOLEAN DEFAULT TRUE;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS metodo TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'Activa';
`);

// La migración real, tal cual se aplica en producción.
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260806_ordenes_compra.sql'), 'utf8'));

const conectar = () => ({ query: (s, p) => db.query(s, p ?? []) });
const pool = { ...conectar(), connect: async () => ({ ...conectar(), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const comprasSvc  = require(path.join(RAIZ, 'src/modules/compras/compras.service.js'));
const ordenesSvc  = require(path.join(RAIZ, 'src/modules/ordenes-compra/ordenesCompra.service.js'));
const ordenesRepo = require(path.join(RAIZ, 'src/modules/ordenes-compra/ordenesCompra.repository.js'));
const procedSvc   = require(path.join(RAIZ, 'src/modules/procedencia/procedencia.service.js'));
const ordenesMw   = require(path.join(RAIZ, 'src/middlewares/ordenesCompra.middleware.js'));

let fallos = 0, pasados = 0;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
}
async function falla(nombre, fn, fragmento = '') {
  try {
    await fn();
    ok(nombre, false, 'no lanzó');
  } catch (e) {
    const msg = e?.message || String(e);
    ok(nombre, !fragmento || msg.toLowerCase().includes(fragmento.toLowerCase()), msg.slice(0, 90));
  }
}

// Cambiar la configuración e invalidar el cache del middleware, como hace
// config.service al guardar desde Ajustes.
async function configurar(negocioId, claves) {
  for (const [clave, valor] of Object.entries(claves)) {
    await db.query(`
      INSERT INTO config_negocio(negocio_id, clave, valor) VALUES ($1, $2, $3)
      ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor
    `, [negocioId, clave, valor]);
  }
  ordenesMw.invalidarCache(negocioId);
}

const cfg = async (n) => ordenesMw.getConfigOrdenes(n);

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre, activa) VALUES (1, 'Principal', TRUE), (1, 'Norte', TRUE);
  INSERT INTO usuarios (nombre) VALUES ('Admin');
  INSERT INTO proveedores (negocio_id, nombre, nit, telefono, tipo, activo)
    VALUES (1, 'Distribuidora Andina', '900123456', '3001112233', 'proveedor', TRUE),
           (1, 'Tecnocel', '900999888', '3004445566', 'proveedor', TRUE);
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, activo)
    VALUES ('Cargador USB-C 65W', 0, 0, 60000, 1, TRUE),
           ('Vidrio templado 6.7', 0, 0, 12000, 1, TRUE);
`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Doble candado: sin el flag, la feature no existe ═══');
// ═══════════════════════════════════════════════════════════════════════════
let c = await cfg(1);
ok('órdenes apagadas por defecto', c.activas === false);
ok('modo de cargo por defecto es "recepcion"', c.modo_cargo === 'recepcion', c.modo_cargo);
ok('garantía apagada por defecto', c.garantia_activa === false);

await configurar(1, { codigos_proveedor_activos: '1' });
c = await cfg(1);
ok('los códigos de proveedor NO se activan sin código interno',
  c.codigos_activos === false);
await configurar(1, { codigo_producto_activo: '1' });
c = await cfg(1);
ok('con código interno encendido, ya resuelven', c.codigos_activos === true);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. Compra suelta: con la feature apagada nada cambia ═══');
// ═══════════════════════════════════════════════════════════════════════════
const suelta = await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  numero_factura: 'FV-001', lineas: [
    { nombre_producto: 'Cargador USB-C 65W', producto_id: 1, cantidad: 10, precio_unitario: 38000 },
  ],
  pagos: [],
});
let stock = await db.query('SELECT stock, costo_unitario FROM productos_cantidad WHERE id = 1');
ok('la compra suelta metió stock', Number(stock.rows[0].stock) === 10, `stock ${stock.rows[0].stock}`);
ok('orden_compra_id queda NULL', suelta.orden_compra_id === null);
let cargos = await db.query(`SELECT * FROM movimientos_acreedor WHERE compra_id = $1 AND tipo = 'Cargo'`, [suelta.id]);
ok('creó su cargo al acreedor', cargos.rows.length === 1, money(cargos.rows[0]?.valor));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. Orden en borrador: no admite recepciones ═══');
// ═══════════════════════════════════════════════════════════════════════════
await configurar(1, { ordenes_compra_activas: '1', ordenes_compra_modo_cargo: 'recepcion' });

const orden = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  fecha_esperada: '2026-08-20',
  lineas: [
    { tipo: 'cantidad', producto_id: 1, nombre_producto: 'Cargador USB-C 65W', cantidad_pedida: 100, precio_estimado: 38000, garantia_dias: 180 },
    { tipo: 'cantidad', producto_id: 2, nombre_producto: 'Vidrio templado 6.7', cantidad_pedida: 20, precio_estimado: 4500 },
  ],
});
ok('la orden nace en borrador', orden.estado === 'Borrador', orden.estado);
ok('tiene consecutivo propio', orden.numero === 1, `#${orden.numero}`);
ok('total estimado 3.890.000', Number(orden.total_estimado) === 3890000, money(orden.total_estimado));

await falla('recibir contra un borrador se rechaza', () => comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden.id,
  lineas: [{ nombre_producto: 'Cargador USB-C 65W', producto_id: 1, cantidad: 5, precio_unitario: 38000, orden_linea_id: 1 }],
}), 'borrador');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. Emitida: tres recepciones parciales suman exacto ═══');
// ═══════════════════════════════════════════════════════════════════════════
await ordenesSvc.emitir(1, orden.id, { usuario_id: 1 });

const lineasOrden = await ordenesRepo.getLineas(orden.id);
const [lCargador, lVidrio] = lineasOrden;
ok('pendiente inicial = lo pedido', Number(lCargador.pendiente) === 100, `${lCargador.pendiente}/100`);

const rec1 = await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden.id, numero_factura: 'FV-100',
  lineas: [{ nombre_producto: 'Cargador USB-C 65W', producto_id: 1, cantidad: 40, precio_unitario: 38000, orden_linea_id: lCargador.id, garantia_dias: 180 }],
});
let vista = await ordenesSvc.obtener(1, await cfg(1), orden.id);
ok('recepción #1: 40 de 120 unidades', Number(vista.unidades_recibidas) === 40, `${vista.unidades_recibidas}/${vista.unidades_pedidas}`);
ok('estado derivado: parcial', vista.estado_recepcion === 'parcial', vista.estado_recepcion);
ok('estado guardado sigue siendo Emitida', vista.estado === 'Emitida');

const rec2 = await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden.id,
  lineas: [
    { nombre_producto: 'Cargador USB-C 65W', producto_id: 1, cantidad: 60, precio_unitario: 39000, orden_linea_id: lCargador.id, garantia_dias: 180 },
    { nombre_producto: 'Vidrio templado 6.7', producto_id: 2, cantidad: 20, precio_unitario: 4500, orden_linea_id: lVidrio.id },
  ],
});
vista = await ordenesSvc.obtener(1, await cfg(1), orden.id);
ok('recepción #2 completa la orden', vista.estado_recepcion === 'completa', `${vista.unidades_recibidas}/${vista.unidades_pedidas}`);
ok('dos recepciones registradas', Number(vista.num_recepciones) === 2, `${vista.num_recepciones}`);
ok('la ficha trae la lista de recepciones', Array.isArray(vista.recepciones) && vista.recepciones.length === 2);
ok('el contador y la lista no se pisan',
  typeof vista.num_recepciones !== 'object' && Array.isArray(vista.recepciones));

stock = await db.query('SELECT stock, costo_unitario FROM productos_cantidad WHERE id = 1');
ok('el stock acumuló las dos entregas + la suelta', Number(stock.rows[0].stock) === 110, `stock ${stock.rows[0].stock}`);

await falla('recibir de más se rechaza', () => comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden.id,
  lineas: [{ nombre_producto: 'Cargador USB-C 65W', producto_id: 1, cantidad: 1, precio_unitario: 38000, orden_linea_id: lCargador.id }],
}), 'solo faltan');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. Cancelar la recepción #2 reabre SU parte, no las otras ═══');
// ═══════════════════════════════════════════════════════════════════════════
await comprasSvc.cancelarCompra(1, rec2.id);
vista = await ordenesSvc.obtener(1, await cfg(1), orden.id);
ok('la orden vuelve a estar parcial', vista.estado_recepcion === 'parcial', vista.estado_recepcion);
ok('quedan las 40 de la recepción #1', Number(vista.unidades_recibidas) === 40, `${vista.unidades_recibidas}/120`);

let lineasTrasCancelar = await ordenesRepo.getLineas(orden.id);
ok('el cargador vuelve a tener 60 pendientes', Number(lineasTrasCancelar[0].pendiente) === 60, `${lineasTrasCancelar[0].pendiente}`);
ok('el vidrio vuelve a 20 pendientes', Number(lineasTrasCancelar[1].pendiente) === 20, `${lineasTrasCancelar[1].pendiente}`);

stock = await db.query('SELECT stock FROM productos_cantidad WHERE id = 1');
ok('el stock también se revirtió', Number(stock.rows[0].stock) === 50, `stock ${stock.rows[0].stock}`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 6. Devolver reabre el pendiente (falla sin cantidad_devuelta) ═══');
// ═══════════════════════════════════════════════════════════════════════════
const lineasRec1 = await db.query('SELECT * FROM lineas_compra WHERE compra_id = $1', [rec1.id]);
await comprasSvc.devolverCompra(1, rec1.id, {
  lineas: [{ linea_id: lineasRec1.rows[0].id, cantidad: 15 }],
  motivo: 'Llegaron rayados', usuario_id: 1,
});

const trasDevolver = await db.query('SELECT cantidad, cantidad_devuelta FROM lineas_compra WHERE id = $1', [lineasRec1.rows[0].id]);
ok('la línea registra las 15 devueltas', Number(trasDevolver.rows[0].cantidad_devuelta) === 15,
  `${trasDevolver.rows[0].cantidad_devuelta} de ${trasDevolver.rows[0].cantidad}`);

vista = await ordenesSvc.obtener(1, await cfg(1), orden.id);
ok('la orden baja a 25 recibidas', Number(vista.unidades_recibidas) === 25, `${vista.unidades_recibidas}/120`);

let lineasTrasDevol = await ordenesRepo.getLineas(orden.id);
ok('el pendiente del cargador sube a 75', Number(lineasTrasDevol[0].pendiente) === 75, `${lineasTrasDevol[0].pendiente}`);

await falla('devolver más de lo que queda se rechaza', () => comprasSvc.devolverCompra(1, rec1.id, {
  lineas: [{ linea_id: lineasRec1.rows[0].id, cantidad: 26 }], usuario_id: 1,
}), 'cantidad inválida');

await comprasSvc.devolverCompra(1, rec1.id, {
  lineas: [{ linea_id: lineasRec1.rows[0].id, cantidad: 25 }], usuario_id: 1,
});
await falla('devolver una línea ya agotada se rechaza', () => comprasSvc.devolverCompra(1, rec1.id, {
  lineas: [{ linea_id: lineasRec1.rows[0].id, cantidad: 1 }], usuario_id: 1,
}), 'totalidad');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. Procedencia: de quién vino cada lote ═══');
// ═══════════════════════════════════════════════════════════════════════════
// Una segunda compra del mismo producto, a OTRO proveedor.
await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 2,
  numero_factura: 'TC-77', lineas: [
    { nombre_producto: 'Cargador USB-C 65W', producto_id: 1, cantidad: 25, precio_unitario: 41500, garantia_dias: 90 },
  ],
});

const proc = await procedSvc.getPorProducto(1, 1, { sucursalId: 1 });
ok('lista las 3 entradas del producto', proc.entradas.length === 3, `${proc.entradas.length} entradas`);
ok('la más reciente va primero', proc.entradas[0].proveedor_nombre === 'Tecnocel', proc.entradas[0].proveedor_nombre);
ok('resume los dos proveedores', proc.proveedores.length === 2,
  proc.proveedores.map((p) => p.proveedor_nombre).join(' · '));

const andina = proc.proveedores.find((p) => p.proveedor_nombre === 'Distribuidora Andina');
ok('Andina: 50 unidades entregadas', Number(andina.unidades) === 50, `${andina.unidades}`);
ok('Andina: 40 devueltas registradas', Number(andina.devueltas) === 40, `${andina.devueltas}`);

const entradaAndina = proc.entradas.find((e) => e.compra_id === rec1.id);
ok('la entrada devuelta muestra cantidad neta 0', Number(entradaAndina.cantidad_neta) === 0,
  `${entradaAndina.cantidad} - ${entradaAndina.cantidad_devuelta}`);

// productos_cantidad.proveedor_id guarda el PRIMER proveedor y no se actualiza:
// la procedencia no puede depender de esa columna.
const provColumna = await db.query('SELECT proveedor_id FROM productos_cantidad WHERE id = 1');
ok('productos_cantidad.proveedor_id sigue clavado en el primero',
  Number(provColumna.rows[0].proveedor_id) === 1,
  `columna dice proveedor ${provColumna.rows[0].proveedor_id}, pero hay 2 proveedores reales`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 8. Garantía: el vencimiento se deriva sin correrse un día ═══');
// ═══════════════════════════════════════════════════════════════════════════
// Una compra a las 8 p.m. hora Bogotá — el caso que corre un día si se lee mal.
await db.query(`UPDATE compras SET fecha = '2026-08-01 20:00:00' WHERE id = $1`, [rec1.id]);
const procG = await procedSvc.getPorProducto(1, 1, { sucursalId: 1 });
const conGarantia = procG.entradas.find((e) => e.compra_id === rec1.id);
const hasta = new Date(conGarantia.garantia_hasta).toISOString().slice(0, 10);
ok('garantía de 180 d sobre el 1-ago vence el 28-ene', hasta === '2027-01-28', hasta);
ok('la entrada trae su estado de garantía', !!conGarantia.estado, conGarantia.estado);

const sinGarantia = procG.entradas.find((e) => e.compra_id === suelta.id);
ok('sin plazo registrado el estado es "sin_garantia"', sinGarantia.estado === 'sin_garantia', sinGarantia.estado);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 9. Cerrar: "ya no va a llegar" no toca inventario ni deuda ═══');
// ═══════════════════════════════════════════════════════════════════════════
const stockAntes = (await db.query('SELECT stock FROM productos_cantidad WHERE id = 1')).rows[0].stock;
const deudaAntes = (await db.query(`SELECT COALESCE(SUM(CASE WHEN tipo='Cargo' THEN valor ELSE -valor END),0) AS s FROM movimientos_acreedor`)).rows[0].s;

await ordenesSvc.cerrar(1, orden.id, { motivo: 'El proveedor descontinuó el modelo', usuario_id: 1 });
vista = await ordenesSvc.obtener(1, await cfg(1), orden.id);
ok('la orden queda cerrada', vista.estado === 'Cerrada', vista.estado);
ok('guarda el motivo', vista.motivo_cierre === 'El proveedor descontinuó el modelo');

const nov = await db.query(`SELECT * FROM novedades_proveedor WHERE orden_id = $1`, [orden.id]);
ok('deja rastro en la bitácora', nov.rows.length === 1 && nov.rows[0].tipo === 'cierre');

const stockDespues = (await db.query('SELECT stock FROM productos_cantidad WHERE id = 1')).rows[0].stock;
const deudaDespues = (await db.query(`SELECT COALESCE(SUM(CASE WHEN tipo='Cargo' THEN valor ELSE -valor END),0) AS s FROM movimientos_acreedor`)).rows[0].s;
ok('el stock no cambió', Number(stockAntes) === Number(stockDespues), `${stockAntes} → ${stockDespues}`);
ok('la deuda no cambió', Number(deudaAntes) === Number(deudaDespues), money(deudaDespues));

await falla('una orden cerrada ya no recibe', () => comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden.id,
  lineas: [{ nombre_producto: 'Cargador USB-C 65W', producto_id: 1, cantidad: 1, precio_unitario: 38000, orden_linea_id: lCargador.id }],
}), 'cerrada');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 10. Modo de cargo "orden": la deuda nace con la factura ═══');
// ═══════════════════════════════════════════════════════════════════════════
await configurar(1, { ordenes_compra_modo_cargo: 'orden' });
ok('el modo quedó en "orden"', (await cfg(1)).modo_cargo === 'orden');

const ordenB = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, emitir: true,
  lineas: [{ tipo: 'cantidad', producto_id: 2, nombre_producto: 'Vidrio templado 6.7', cantidad_pedida: 50, precio_estimado: 4500 }],
});
let cargoOrden = await db.query(`SELECT * FROM movimientos_acreedor WHERE orden_compra_id = $1 AND tipo = 'Cargo'`, [ordenB.id]);
ok('sin factura no hay deuda todavía', cargoOrden.rows.length === 0);

await falla('recibir sin factura se para en seco', () => comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: ordenB.id,
  lineas: [{ nombre_producto: 'Vidrio templado 6.7', producto_id: 2, cantidad: 10, precio_unitario: 4500 }],
}), 'factura');

await ordenesSvc.editar(1, ordenB.id, {
  numero_factura: 'FV-500', fecha_factura: '2026-08-06', dias_plazo: 30, usuario_id: 1,
});
cargoOrden = await db.query(`SELECT * FROM movimientos_acreedor WHERE orden_compra_id = $1 AND tipo = 'Cargo'`, [ordenB.id]);
ok('al facturar nace UN cargo por la orden completa', cargoOrden.rows.length === 1, money(cargoOrden.rows[0]?.valor));
ok('el cargo vale el total del pedido', Number(cargoOrden.rows[0].valor) === 225000, money(cargoOrden.rows[0].valor));
const venc = new Date(cargoOrden.rows[0].fecha_vencimiento).toISOString().slice(0, 10);
ok('el plazo de 30 días vence el 5-sep', venc === '2026-09-05', venc);

const lineasB = await ordenesRepo.getLineas(ordenB.id);
const recB1 = await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: ordenB.id,
  lineas: [{ nombre_producto: 'Vidrio templado 6.7', producto_id: 2, cantidad: 30, precio_unitario: 4500, orden_linea_id: lineasB[0].id }],
});
const cargosDeRec = await db.query(`SELECT * FROM movimientos_acreedor WHERE compra_id = $1 AND tipo = 'Cargo'`, [recB1.id]);
ok('la recepción NO crea cargo propio', cargosDeRec.rows.length === 0);

const todosLosCargos = await db.query(`SELECT COUNT(*) AS n FROM movimientos_acreedor WHERE orden_compra_id = $1 AND tipo = 'Cargo'`, [ordenB.id]);
ok('sigue habiendo un solo cargo, sin duplicar', Number(todosLosCargos.rows[0].n) === 1);

const vistaB = await ordenesSvc.obtener(1, await cfg(1), ordenB.id);
ok('la orden va 30 de 50', Number(vistaB.unidades_recibidas) === 30, `${vistaB.unidades_recibidas}/50`);
ok('semáforo de pago calculado', ['al_dia', 'por_vencer', 'vencida'].includes(vistaB.estado_pago), vistaB.estado_pago);

// La devolución en modo 'orden' debe encontrar el cargo de la ORDEN.
const lineaRecB = (await db.query('SELECT * FROM lineas_compra WHERE compra_id = $1', [recB1.id])).rows[0];
await comprasSvc.devolverCompra(1, recB1.id, {
  lineas: [{ linea_id: lineaRecB.id, cantidad: 10 }], motivo: 'Rotos', usuario_id: 1,
});
const notaCredito = await db.query(`
  SELECT * FROM movimientos_acreedor WHERE compra_id = $1 AND tipo = 'Abono' AND metodo = 'Devolución'
`, [recB1.id]);
ok('la nota crédito se aplicó contra el cargo de la orden', notaCredito.rows.length === 1,
  money(notaCredito.rows[0]?.valor));
ok('apunta al cargo compartido', Number(notaCredito.rows[0]?.cargo_id) === Number(cargoOrden.rows[0].id));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 11. Aislamiento entre sucursales y negocios ═══');
// ═══════════════════════════════════════════════════════════════════════════
await falla('no se recibe una orden desde otra sucursal', () => comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 2, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: ordenB.id,
  lineas: [{ nombre_producto: 'Vidrio templado 6.7', cantidad: 1, precio_unitario: 4500 }],
}), 'otra sucursal');

await db.exec(`INSERT INTO negocios (nombre) VALUES ('Otro');`);
const cfgOtro = await cfg(2);
await falla('otro negocio no ve la orden', () => ordenesSvc.obtener(2, cfgOtro, ordenB.id), 'no encontrada');

const listado = await ordenesSvc.listar(2, cfgOtro, {});
ok('el listado de otro negocio sale vacío', listado.rows.length === 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 12. Anular: solo sin recepciones ═══');
// ═══════════════════════════════════════════════════════════════════════════
await falla('no se anula una orden con mercancía recibida',
  () => ordenesSvc.anular(1, ordenB.id, { motivo: 'Error', usuario_id: 1 }), 'ya tiene mercancía');

const ordenC = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 2, emitir: true,
  numero_factura: 'X-1', fecha_factura: '2026-08-06', dias_plazo: 15,
  lineas: [{ tipo: 'cantidad', producto_id: 1, nombre_producto: 'Cargador USB-C 65W', cantidad_pedida: 5, precio_estimado: 40000 }],
});
let cargoC = await db.query(`SELECT * FROM movimientos_acreedor WHERE orden_compra_id = $1`, [ordenC.id]);
ok('la orden C nació con su cargo (modo orden)', cargoC.rows.length === 1, money(cargoC.rows[0]?.valor));

await ordenesSvc.anular(1, ordenC.id, { motivo: 'Pedido duplicado', usuario_id: 1 });
cargoC = await db.query(`SELECT * FROM movimientos_acreedor WHERE orden_compra_id = $1`, [ordenC.id]);
ok('al anular se va también su deuda', cargoC.rows.length === 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 13. El avance nunca se guarda: se recalcula siempre ═══');
// ═══════════════════════════════════════════════════════════════════════════
const columnas = await db.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name IN ('ordenes_compra', 'lineas_orden_compra')
    AND column_name IN ('cantidad_recibida', 'recibida', 'unidades_recibidas', 'pendiente')
`);
ok('no existe ninguna columna de avance guardado', columnas.rows.length === 0,
  columnas.rows.map((r) => r.column_name).join(', ') || 'ninguna');

const estados = await db.query(`
  SELECT DISTINCT estado FROM ordenes_compra ORDER BY estado
`);
ok('estado solo guarda decisiones humanas',
  estados.rows.every((r) => ['Borrador', 'Emitida', 'Cerrada', 'Anulada'].includes(r.estado)),
  estados.rows.map((r) => r.estado).join(', '));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 14. Códigos del proveedor: la equivalencia se aprende ═══');
// ═══════════════════════════════════════════════════════════════════════════
const codigosSvc = require(path.join(RAIZ, 'src/modules/codigos-proveedor/codigosProveedor.service.js'));

await db.query(`UPDATE productos_cantidad SET codigo = '7701234567890' WHERE id = 1`);

let r = await codigosSvc.resolverCodigo(1, { proveedor_id: 1, codigo: 'ACC-9931-BLK', sucursal_id: 1 });
ok('un código nunca visto sale como desconocido', r.estado === 'desconocido', r.estado);

await codigosSvc.aprender(1, {
  proveedor_id: 1, codigo_proveedor: 'ACC-9931-BLK',
  codigo_interno: '7701234567890', descripcion_proveedor: 'Cargador tipo C 65W negro',
  usuario_id: 1,
});
r = await codigosSvc.resolverCodigo(1, { proveedor_id: 1, codigo: 'ACC-9931-BLK', sucursal_id: 1 });
ok('la segunda vez ya resuelve solo', r.estado === 'resuelto', r.estado);
ok('apunta al producto correcto', r.producto?.id === 1, r.producto?.nombre);

r = await codigosSvc.resolverCodigo(1, { proveedor_id: 1, codigo: '  acc-9931-blk ', sucursal_id: 1 });
ok('resuelve sin importar mayúsculas ni espacios', r.estado === 'resuelto', r.estado);

// Dos proveedores SÍ pueden apuntar al mismo producto: es el punto de la tabla.
await codigosSvc.aprender(1, {
  proveedor_id: 2, codigo_proveedor: 'TC-CARG-65', codigo_interno: '7701234567890', usuario_id: 1,
});
const inverso = await codigosSvc.porCodigoInterno(1, '7701234567890');
ok('dos proveedores pueden llamarlo distinto', inverso.length === 2,
  inverso.map((c) => `${c.proveedor_nombre}:${c.codigo_proveedor}`).join(' · '));

// Pero un código suyo NO puede apuntar a dos productos: re-aprender corrige.
await db.query(`UPDATE productos_cantidad SET codigo = 'VT-INTERNO' WHERE id = 2`);
await codigosSvc.aprender(1, {
  proveedor_id: 1, codigo_proveedor: 'ACC-9931-BLK', codigo_interno: 'VT-INTERNO', usuario_id: 1,
});
const filasDelCodigo = await db.query(
  `SELECT * FROM codigos_proveedor WHERE proveedor_id = 1 AND UPPER(BTRIM(codigo_proveedor)) = 'ACC-9931-BLK'`
);
ok('re-aprender corrige, no duplica', filasDelCodigo.rows.length === 1,
  `${filasDelCodigo.rows.length} fila(s) → ${filasDelCodigo.rows[0]?.codigo_interno}`);

await falla('no se aprende una equivalencia que apunta al vacío',
  () => codigosSvc.aprender(1, {
    proveedor_id: 1, codigo_proveedor: 'XX-1', codigo_interno: 'NO-EXISTE', usuario_id: 1,
  }), 'ningún producto');

// El producto 1 está solo en la sucursal 1: en la 2 la equivalencia existe pero
// no hay a qué apuntar, y eso es distinto de "no lo conozco".
await codigosSvc.aprender(1, {
  proveedor_id: 2, codigo_proveedor: 'TC-CARG-65', codigo_interno: '7701234567890', usuario_id: 1,
});
r = await codigosSvc.resolverCodigo(1, { proveedor_id: 2, codigo: 'TC-CARG-65', sucursal_id: 2 });
ok('en otra sucursal distingue "no está aquí" de "no lo conozco"',
  r.estado === 'sin_producto', r.estado);

await falla('otro negocio no puede resolver contra este proveedor',
  () => codigosSvc.resolverCodigo(2, { proveedor_id: 1, codigo: 'ACC-9931-BLK', sucursal_id: 1 }),
  'no válido');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 15. Alerta de facturas de proveedor por pagar ═══');
// ═══════════════════════════════════════════════════════════════════════════
const alertas = require(path.join(RAIZ, 'src/modules/notificaciones/notificaciones.alertas.js'));

// La orden B (modo 'orden') tiene factura con vencimiento el 5-sep y saldo vivo.
// Se le corre el vencimiento al pasado para que caiga en "vencida".
await db.query(`UPDATE ordenes_compra SET fecha_vencimiento = CURRENT_DATE - 4 WHERE id = $1`, [ordenB.id]);
let cartProv = await alertas.carteraProveedores(1);
ok('encuentra la factura vencida', cartProv.vencidas.length === 1,
  cartProv.vencidas.map((v) => `${v.proveedor} ${money(v.saldo)}`).join(' · '));
ok('cuenta los días de atraso', cartProv.vencidas[0]?.dias_para_vencer === -4,
  String(cartProv.vencidas[0]?.dias_para_vencer));
ok('el saldo descuenta la nota crédito de la devolución',
  Number(cartProv.vencidas[0]?.saldo) === 180000, money(cartProv.vencidas[0]?.saldo));

// Saldada → sale de la lista. El saldo se DERIVA, no se marca.
const cargoB = (await db.query(
  `SELECT id, acreedor_id FROM movimientos_acreedor WHERE orden_compra_id = $1 AND tipo = 'Cargo'`, [ordenB.id]
)).rows[0];
await db.query(`
  INSERT INTO movimientos_acreedor(acreedor_id, tipo, valor, descripcion, cargo_id, sucursal_id)
  VALUES ($1, 'Abono', 180000, 'Pago total', $2, 1)
`, [cargoB.acreedor_id, cargoB.id]);
cartProv = await alertas.carteraProveedores(1);
ok('una vez pagada desaparece del aviso', cartProv.vencidas.length === 0);

await configurar(1, { ordenes_compra_activas: '0' });
cartProv = await alertas.carteraProveedores(1);
ok('con las órdenes apagadas no consulta nada', cartProv.vencidas.length === 0
  && cartProv.por_vencer.length === 0);
await configurar(1, { ordenes_compra_activas: '1' });

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 16. Recibir con variantes: el stock va a la HOJA, no al padre ═══');
// ═══════════════════════════════════════════════════════════════════════════
// El stock de un producto con variantes es la SUMA de sus hojas. Escribirlo en
// el padre lo borra la siguiente sincronización — el bug que motivó esta sección.
//
// Se vuelve al modo por defecto: lo de aquí en adelante es el flujo normal, y
// la sección 10 dejó el negocio cobrando por orden.
await configurar(1, { ordenes_compra_modo_cargo: 'recepcion' });

await db.exec(`
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, activo)
    VALUES ('Camiseta', 0, 0, 45000, 1, TRUE);
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario, activo)
    VALUES (3, 1, 'Talla M', 0, 0, TRUE);
  INSERT INTO variantes_atributo (atributo_id, producto_id, valor, stock, costo_unitario, activo)
    VALUES (1, 3, 'Rojo', 0, 0, TRUE), (1, 3, 'Azul', 0, 0, TRUE);
`);

const ordenV = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, emitir: true,
  lineas: [{ tipo: 'cantidad', producto_id: 3, nombre_producto: 'Camiseta', cantidad_pedida: 30, precio_estimado: 20000 }],
});
const lineaV = (await ordenesRepo.getLineas(ordenV.id))[0];

await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: ordenV.id,
  lineas: [
    { nombre_producto: 'Camiseta', producto_id: 3, cantidad: 12, precio_unitario: 20000, variante_id: 1, orden_linea_id: lineaV.id },
    { nombre_producto: 'Camiseta', producto_id: 3, cantidad: 8,  precio_unitario: 21000, variante_id: 2, orden_linea_id: lineaV.id },
  ],
});

const vars = await db.query('SELECT id, valor, stock, costo_unitario FROM variantes_atributo ORDER BY id');
ok('la variante Rojo recibió 12', Number(vars.rows[0].stock) === 12, `${vars.rows[0].stock}`);
ok('la variante Azul recibió 8',  Number(vars.rows[1].stock) === 8,  `${vars.rows[1].stock}`);
ok('cada variante guardó SU costo',
  Number(vars.rows[0].costo_unitario) === 20000 && Number(vars.rows[1].costo_unitario) === 21000,
  `${vars.rows[0].costo_unitario} / ${vars.rows[1].costo_unitario}`);

const padre = await db.query('SELECT stock FROM productos_cantidad WHERE id = 3');
ok('el padre quedó sincronizado con la suma (20)', Number(padre.rows[0].stock) === 20, `${padre.rows[0].stock}`);

const avanceV = await ordenesSvc.obtener(1, await cfg(1), ordenV.id);
ok('la orden cuenta las 20 aunque vinieran repartidas',
  Number(avanceV.unidades_recibidas) === 20, `${avanceV.unidades_recibidas}/30`);

await falla('el reparto por variantes tampoco puede exceder lo pedido',
  () => comprasSvc.registrarCompra({
    negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
    orden_compra_id: ordenV.id,
    lineas: [
      { nombre_producto: 'Camiseta', producto_id: 3, cantidad: 7, precio_unitario: 20000, variante_id: 1, orden_linea_id: lineaV.id },
      { nombre_producto: 'Camiseta', producto_id: 3, cantidad: 7, precio_unitario: 20000, variante_id: 2, orden_linea_id: lineaV.id },
    ],
  }), 'solo faltan');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 17. Seriales con color y características al recibir ═══');
// ═══════════════════════════════════════════════════════════════════════════
await db.exec(`
  INSERT INTO productos_serial (nombre, precio, sucursal_id, activo)
    VALUES ('iPhone 11 Pro', 1800000, 1, TRUE);
`);
const ordenS = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, emitir: true,
  lineas: [{ tipo: 'serial', producto_id: 1, nombre_producto: 'iPhone 11 Pro', cantidad_pedida: 3, precio_estimado: 1500000, garantia_dias: 365 }],
});
const lineaS = (await ordenesRepo.getLineas(ordenS.id))[0];
ok('la orden pide seriales por modelo y cantidad, sin IMEI',
  lineaS.tipo === 'serial' && Number(lineaS.cantidad_pedida) === 3);

await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: ordenS.id,
  lineas: [
    { nombre_producto: 'iPhone 11 Pro', producto_id: 1, imei: '351111111111111', cantidad: 1, precio_unitario: 1500000,
      color: 'Gris', caracteristicas: { Almacenamiento: '64GB', Batería: '89%' }, orden_linea_id: lineaS.id, garantia_dias: 365 },
    { nombre_producto: 'iPhone 11 Pro', producto_id: 1, imei: '351222222222222', cantidad: 1, precio_unitario: 1500000,
      color: 'Azul', caracteristicas: { Almacenamiento: '128GB' }, orden_linea_id: lineaS.id, garantia_dias: 365 },
  ],
});

const ser = await db.query(`SELECT imei, color, caracteristicas FROM seriales ORDER BY imei`);
ok('los dos equipos entraron al inventario', ser.rows.length === 2);
ok('guardó el color de cada uno',
  ser.rows[0].color === 'Gris' && ser.rows[1].color === 'Azul',
  ser.rows.map((s) => s.color).join(' / '));

const car0 = typeof ser.rows[0].caracteristicas === 'string'
  ? JSON.parse(ser.rows[0].caracteristicas) : ser.rows[0].caracteristicas;
ok('guardó las características', car0?.Almacenamiento === '64GB' && car0?.['Batería'] === '89%',
  JSON.stringify(car0));

const avanceS = await ordenesSvc.obtener(1, await cfg(1), ordenS.id);
ok('la orden va 2 de 3 (un IMEI = una unidad)',
  Number(avanceS.unidades_recibidas) === 2, `${avanceS.unidades_recibidas}/3`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 18. Compra SUELTA con plazo: también vence ═══');
// ═══════════════════════════════════════════════════════════════════════════
const { resolverVencimiento } = require(path.join(RAIZ, 'src/utils/vencimiento.util.js'));
ok('30 días sobre el 6-ago dan el 5-sep',
  resolverVencimiento({ fecha_factura: '2026-08-06', dias_plazo: 30 }) === '2026-09-05',
  resolverVencimiento({ fecha_factura: '2026-08-06', dias_plazo: 30 }));
ok('una fecha explícita manda sobre el plazo',
  resolverVencimiento({ fecha_factura: '2026-08-06', dias_plazo: 30, fecha_vencimiento: '2026-08-20' }) === '2026-08-20');
ok('sin plazo no inventa vencimiento',
  resolverVencimiento({ fecha_factura: '2026-08-06' }) === null);

const compraSuelta = await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 2,
  numero_factura: 'SUELTA-1', fecha_factura: '2026-08-06', dias_plazo: 15,
  lineas: [{ nombre_producto: 'Cargador USB-C 65W', producto_id: 1, cantidad: 5, precio_unitario: 40000 }],
});
const cargoSuelto = await db.query(
  `SELECT fecha_vencimiento, orden_compra_id FROM movimientos_acreedor WHERE compra_id = $1 AND tipo = 'Cargo'`,
  [compraSuelta.id]
);
const vencSuelto = new Date(cargoSuelto.rows[0].fecha_vencimiento).toISOString().slice(0, 10);
ok('la compra suelta guardó su vencimiento', vencSuelto === '2026-08-21', vencSuelto);
ok('y no quedó atada a ninguna orden', cargoSuelto.rows[0].orden_compra_id === null);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 19. Pantalla de facturas: órdenes y compras sueltas juntas ═══');
// ═══════════════════════════════════════════════════════════════════════════
const acreedSvc = require(path.join(RAIZ, 'src/modules/acreedores/acreedores.service.js'));

// El caso que el usuario quiere ver: una factura de ORDEN con entrega parcial.
// En modo 'recepcion' el cargo lo crea la entrega y HEREDA el vencimiento de la
// orden — la factura del proveedor vence el mismo día llegue en una entrega o
// en tres.
const ordenF = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, emitir: true,
  numero_factura: 'FV-900', fecha_factura: '2026-08-06', dias_plazo: 20,
  lineas: [{ tipo: 'cantidad', producto_id: 2, nombre_producto: 'Vidrio templado 6.7', cantidad_pedida: 100, precio_estimado: 5000 }],
});
const lineaF = (await ordenesRepo.getLineas(ordenF.id))[0];
await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: ordenF.id,
  lineas: [{ nombre_producto: 'Vidrio templado 6.7', producto_id: 2, cantidad: 40, precio_unitario: 5000, orden_linea_id: lineaF.id }],
});

const facturas = await acreedSvc.getFacturasPorVencer(1, {});
ok('lista facturas de los dos orígenes',
  facturas.items.some((f) => f.origen === 'orden') && facturas.items.some((f) => f.origen === 'compra'),
  facturas.items.map((f) => f.origen).join(', '));

const deSuelta = facturas.items.find((f) => f.compra_id === compraSuelta.id);
ok('la compra suelta aparece con su proveedor', deSuelta?.proveedor_nombre === 'Tecnocel', deSuelta?.proveedor_nombre);
ok('trae su saldo derivado', Number(deSuelta?.saldo) === 200000, money(deSuelta?.saldo));
ok('una compra suelta no reporta avance de recepción', deSuelta?.unidades_pedidas === null);

const deOrden = facturas.items.find((f) => Number(f.orden_id) === Number(ordenF.id));
ok('la de una orden muestra la entrega parcial',
  deOrden && Number(deOrden.unidades_recibidas) === 40 && Number(deOrden.unidades_pedidas) === 100,
  deOrden ? `${deOrden.unidades_recibidas}/${deOrden.unidades_pedidas}` : 'ninguna');
ok('el cargo de la entrega heredó el vencimiento de la orden',
  deOrden && new Date(deOrden.fecha_vencimiento).toISOString().slice(0, 10) === '2026-08-26',
  deOrden ? new Date(deOrden.fecha_vencimiento).toISOString().slice(0, 10) : '—');
ok('y trae el número de factura de la orden', deOrden?.numero_factura === 'FV-900', deOrden?.numero_factura);

ok('el resumen suma lo mismo que las filas',
  Math.abs(facturas.resumen.total - facturas.items.reduce((s, f) => s + f.saldo, 0)) < 0.01,
  money(facturas.resumen.total));

// Pagar una factura la saca de la lista: el saldo se DERIVA, no se marca.
const cargoDeSuelta = (await db.query(
  `SELECT id, acreedor_id FROM movimientos_acreedor WHERE compra_id = $1 AND tipo = 'Cargo'`, [compraSuelta.id]
)).rows[0];
await db.query(`
  INSERT INTO movimientos_acreedor(acreedor_id, tipo, valor, descripcion, cargo_id, sucursal_id)
  VALUES ($1, 'Abono', 200000, 'Pago', $2, 1)
`, [cargoDeSuelta.acreedor_id, cargoDeSuelta.id]);

const trasPagar = await acreedSvc.getFacturasPorVencer(1, {});
ok('una vez pagada sale de la lista',
  !trasPagar.items.some((f) => f.compra_id === compraSuelta.id));

const conPagadas = await acreedSvc.getFacturasPorVencer(1, { incluirPagadas: true });
ok('pero se puede ver en "Todas"',
  conPagadas.items.some((f) => f.compra_id === compraSuelta.id));

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(62)}`);
console.log(`  ${pasados} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(62));
process.exit(fallos > 0 ? 1 : 0);
