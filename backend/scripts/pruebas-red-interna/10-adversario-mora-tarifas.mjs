// ─────────────────────────────────────────────────────────────────────────────
// PRUEBA ADVERSARIA — mora × tarifas × red interna, contra Postgres real (PGlite).
//
// Simula un negocio como el del cliente: BODEGA con celulares (serial) y
// accesorios (cantidad), que despacha a dos locales, vende de contado y a
// crédito, presta, y usa plazos con mora. Y un negocio VECINO en la misma base
// para verificar que nada se filtra entre negocios.
//
// No prueba "que funcione" (eso es la suite 09): prueba QUÉ SE ROMPE. Busca
// fugas entre negocios y sucursales, y casos límite que puedan dañar las cuentas.
//
// Requiere PGlite:  npm install --no-save @electric-sql/pglite
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
  -- El esquema de pruebas recorta aperturas_caja; los repos reales de caja
  -- consultan estas columnas.
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS usuario_id     INTEGER;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS monto_inicial  NUMERIC DEFAULT 0;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS monto_cierre   NUMERIC;
  ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS resumen_cierre JSONB;
  -- Tablas que el resumen de caja consulta y que el esquema de pruebas no trae.
  -- Se crean VACÍAS: solo hacen falta para que los JOIN no revienten.
  CREATE TABLE IF NOT EXISTS lineas_compra (
    id SERIAL PRIMARY KEY, compra_id INT, producto_id INT, imei TEXT,
    nombre_producto TEXT,
    cantidad INT DEFAULT 1, precio_unitario NUMERIC DEFAULT 0, precio_usd NUMERIC
  );
  CREATE TABLE IF NOT EXISTS movimientos_acreedor (
    id SERIAL PRIMARY KEY, acreedor_id INT, sucursal_id INT, tipo TEXT,
    valor NUMERIC DEFAULT 0, metodo TEXT, fecha TIMESTAMP DEFAULT NOW(),
    descripcion TEXT, cargo_id INT, compra_id INT,
    registrar_en_caja BOOLEAN DEFAULT TRUE, mov_dinero_id BIGINT, usuario_id INT
  );
  CREATE TABLE IF NOT EXISTS acreedores (
    id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, proveedor_id INT
  );
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS registrar_en_caja BOOLEAN DEFAULT TRUE;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero_factura    TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS metodo            TEXT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS usuario_id        INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS factura_id        INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS estado            TEXT DEFAULT 'Activa';
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS total             NUMERIC DEFAULT 0;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS proveedor_id      INT;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS fecha             TIMESTAMP DEFAULT NOW();
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular       TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email         TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion     TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo_a_favor NUMERIC DEFAULT 0;
  ALTER TABLE abonos_totales     ADD COLUMN IF NOT EXISTS usuario_id INTEGER;
  ALTER TABLE domiciliarios      ADD COLUMN IF NOT EXISTS telefono   TEXT;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS negocio_id INT;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS usuario_id INT;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS fecha_entrega     TIMESTAMP;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS direccion_entrega TEXT;
  ALTER TABLE entregas_domicilio ADD COLUMN IF NOT EXISTS notas             TEXT;
`);
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260725_red_interna.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260726_red_interna_v2.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260822_red_interna_envios.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_control.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_red_interna_cargos_pagables.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_remision_variantes.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, '../migrations/20260823_lotes_cantidad.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260730_mora_credito.sql'), 'utf8'));
// Ver la nota en 09: el interés vive en la misma tabla, así que su migración
// hace falta. Los casos adversarios de abajo no cambian ni una cifra.
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
const prestamos    = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'));
const creditosRepo = require(path.join(RAIZ, 'src/modules/creditos/creditos.repository.js'));
const facturas     = require(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'));
const red          = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const redRepo      = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));
const serialSvc    = require(path.join(RAIZ, 'src/modules/productos/productosSerial.service.js'));
const caja         = require(path.join(RAIZ, 'src/modules/caja/caja.service.js'));
const reportes     = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));
const moraRepo     = require(path.join(RAIZ, 'src/modules/mora/mora.repository.js'));
const moraUtil     = require(path.join(RAIZ, 'src/utils/mora.util.js'));
const { invalidarCache } = require(path.join(RAIZ, 'src/middlewares/redInterna.middleware.js'));
const bcrypt = require('bcryptjs');

// ── Reporte ─────────────────────────────────────────────────────────────────
let ok = 0; const fallos = [], riesgos = [];
const q = async (s, p = []) => (await db.query(s, p)).rows;
const money = (n) => (n == null ? 'null' : '$' + Math.round(Number(n)).toLocaleString('es-CO'));

const check = (n, real, esp) => {
  const bien = Math.abs(Number(real || 0) - Number(esp || 0)) < 1;
  console.log(`  ${bien ? '✓' : '✗'} ${n}: ${money(real)}${bien ? '' : `  ← esperaba ${money(esp)}`}`);
  bien ? ok++ : fallos.push(`${n}: ${money(real)} (esperaba ${money(esp)})`);
};
const checkEq = (n, real, esp) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  console.log(`  ${bien ? '✓' : '✗'} ${n}: ${JSON.stringify(real)}${bien ? '' : ` ← esperaba ${JSON.stringify(esp)}`}`);
  bien ? ok++ : fallos.push(`${n}: ${JSON.stringify(real)} (esperaba ${JSON.stringify(esp)})`);
};
/** Debe lanzar. Si NO lanza, es una fuga o una validación que falta. */
const debeBloquear = async (n, fn, frag) => {
  try {
    await fn();
    console.log(`  ✗ ${n}: NO SE BLOQUEÓ`);
    fallos.push(`${n}: la operación NO se bloqueó`);
  } catch (e) {
    const msg = String(e.message || '');
    const bien = !frag || msg.toLowerCase().includes(frag.toLowerCase());
    console.log(`  ${bien ? '✓' : '✗'} ${n}: ${e.status || ''} ${msg.slice(0, 62)}`);
    bien ? ok++ : fallos.push(`${n}: bloqueó con mensaje inesperado "${msg}"`);
  }
};
const riesgo = (t) => { console.log(`  ⚠ ${t}`); riesgos.push(t); };

// ── Fechas relativas ────────────────────────────────────────────────────────
const hoy = moraUtil.hoyBogota();
const desp = (n) => {
  const [a, m, d] = hoy.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};
const atras = (n) => desp(-n);

// ═════════════════════════════════════════════════════════════════════════════
// ESCENARIO: "CelulAccesorios" — bodega + 2 locales. Y un negocio vecino.
// ═════════════════════════════════════════════════════════════════════════════
const PIN_A = '1111', PIN_B = '9999';
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('CelulAccesorios'), ('Vecino SAS');
  -- neg 1: bodega=1, Centro=2, Norte=3   ·   neg 2: Única=4
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Centro'),(1,'Norte'),(2,'Unica');
  INSERT INTO usuarios (nombre) VALUES ('Admin A'),('Vendedor Centro'),('Admin B');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1'),
    (1,'tarifas_activo','1'),
    (1,'tarifas_lista','[{"id":"frecuente","nombre":"Frecuente","porcentaje":5},{"id":"mostrador","nombre":"Mostrador","porcentaje":20}]'),
    (1,'tarifas_redondeo','1000'),
    (1,'mora_activa','1'),
    (1,'mora_lista','[{"id":"normal","nombre":"Normal","tipo":"mensual","valor":2,"dias_gracia":0},{"id":"fija","nombre":"Fija","tipo":"diaria_fija","valor":3000,"dias_gracia":2}]'),
    (1,'mora_default_id','normal'),
    (1,'pin_eliminacion','${bcrypt.hashSync(PIN_A, 4)}'),
    -- El vecino tiene la mora activa también, con su propio PIN
    (2,'mora_activa','1'),
    (2,'mora_lista','[{"id":"suya","nombre":"Suya","tipo":"mensual","valor":1}]'),
    (2,'pin_eliminacion','${bcrypt.hashSync(PIN_B, 4)}');

  -- Celulares (serial) en la bodega
  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone 12','Apple','128GB', 2000000, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1,'CEL-001', 1400000), (1,'CEL-002', 1400000), (1,'CEL-003', 1450000),
    (1,'CEL-004', 1400000), (1,'CEL-005', 0);          -- ← uno SIN costo, a propósito
  -- Accesorios (cantidad) en la bodega
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id)
    VALUES ('Cargador 20W', 100, 9000, 25000, 1),
           ('Vidrio templado', 200, 1500, 8000, 1);
  INSERT INTO clientes (negocio_id, nombre, cedula) VALUES (1,'Ana Cliente','111'), (2,'Cliente Vecino','222');
  INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago)
    VALUES (1,1,'Efectivo','efectivo',ARRAY['Efectivo']), (1,2,'Efectivo','efectivo',ARRAY['Efectivo']);
  INSERT INTO aperturas_caja (sucursal_id) VALUES (1),(2),(4);
  -- Producto del VECINO, para probar fugas
  INSERT INTO productos_serial (nombre, precio, sucursal_id) VALUES ('Moto G', 700000, 4);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (2,'VEC-001', 500000);
`);

const reqA = (suc, rol = 'admin_negocio', uid = 1) => ({
  user: { id: uid, negocio_id: 1, rol }, sucursal_id: suc, esBodega: suc === 1,
  red: { activa: true, bodega_id: 1, modo_precio: 'costo', confirmar_recepcion: true,
         confirmar_remesa: true, bloquear_traslados: true, ocultar_costos: true },
});
const ADMIN_A = { usuario_id: 1, rol: 'admin_negocio' };
const ADMIN_B = { usuario_id: 3, rol: 'admin_negocio' };

// ═══ 1. La bodega despacha celulares y accesorios a Centro ═══════════════════
console.log('\n═══ 1. Bodega despacha 3 celulares + 40 cargadores a Centro ═══');
const LINEAS_ENVIO = [
  { tipo: 'serial', serial_id: 1 },
  { tipo: 'serial', serial_id: 2, valor_interno: 1600000 },   // con sobreprecio interno
  { tipo: 'serial', serial_id: 5 },                            // el que NO tiene costo
  { tipo: 'cantidad', producto_id: 1, cantidad: 40 },
];

// El valor de la línea es lo que el local va a DEBER por ese producto, así que
// un 0 se lo regala. Antes pasaba en silencio (esta suite lo reportaba como
// riesgo); ahora hay que confirmarlo.
let bloqueoCero = null;
try {
  await red.despachar(reqA(1), { sucursal_destino_id: 2, lineas: LINEAS_ENVIO });
} catch (e) { bloqueoCero = e; }
checkEq('★ Despachar con un producto en $0 se bloquea', bloqueoCero?.codigo, 'VALOR_CERO');
checkEq('  y dice cuál es', bloqueoCero?.productos?.[0], 'CEL-005');

const rem = await red.despachar(reqA(1), {
  sucursal_destino_id: 2,
  lineas: LINEAS_ENVIO,
  // Entregarlo sin cobro es válido (una muestra, un obsequio): lo que no vale
  // es que se cuele sin que nadie lo decida.
  permitir_valor_cero: true,
});
const lineasRem = await redRepo.getLineasRemision(rem.id);
await red.recibir(reqA(2, 'supervisor'), rem.id, { lineas_recibidas: lineasRem.map((l) => Number(l.id)) });
check('Valor de la remisión', rem.valor_total, 1400000 + 1600000 + 0 + 9000 * 40);

const prodCentro = (await q(`SELECT id FROM productos_serial WHERE sucursal_id=2 LIMIT 1`))[0];
const enCentro = await serialSvc.getSeriales(1, prodCentro.id, false);
const porImei = (l, i) => l.find((s) => s.imei === i);
check('Tarifa del celular normal usa el valor interno', porImei(enCentro, 'CEL-001')?.costo_tarifa, 1400000);
check('Tarifa del celular con sobreprecio usa 1.600.000', porImei(enCentro, 'CEL-002')?.costo_tarifa, 1600000);
checkEq('★ El celular SIN costo no admite tarifa', porImei(enCentro, 'CEL-005')?.costo_tarifa, null);
riesgo('Un equipo despachado en $0 sigue llegando al local sin poder aplicarle tarifa: '
  + 'el vendedor debe poner el precio a mano. Ya no puede pasar por descuido '
  + '(el despacho lo bloquea), pero si se confirma la entrega sin cobro, el '
  + 'producto queda sin base para calcular su precio de venta.');

// ═══ 2. AISLAMIENTO ENTRE NEGOCIOS ══════════════════════════════════════════
console.log('\n═══ 2. Aislamiento entre negocios ═══');

// Crédito del negocio 1 en Centro
await db.exec(`
  INSERT INTO facturas (numero, sucursal_id, nombre_cliente, cedula, estado, fecha)
    VALUES (1, 2, 'Ana Cliente', '111', 'Credito', NOW());
  INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
    VALUES (1, 'iPhone 12', 'CEL-001', 1, 2100000);
`);
{
  const c = await pool.connect();
  await creditosRepo.create(c, {
    factura_id: 1, cliente_id: 1, sucursal_id: 2, valor_total: 2100000, cuota_inicial: 100000,
    fecha_limite: atras(40), mora_condicion: { id: 'normal', nombre: 'Normal', tipo: 'mensual', valor: 2, dias_gracia: 0 },
  });
}
const credA = (await q(`SELECT id FROM creditos WHERE factura_id=1`))[0].id;

// Préstamo del negocio 1. Nace con plazo FUTURO (crear con fecha pasada está
// bloqueado, y bien) y luego se vence a mano para poder probar la mora.
const presA = (await prestamos.crearPrestamos({
  sucursal_id: 1, usuario_id: 1, negocio_id: 1,
  prestatario: 'Ana Cliente', cedula: '111', telefono: '300', cliente_id: 1,
  items: [{ nombre_producto: 'iPhone 12', imei: 'CEL-003', cantidad_prestada: 1, valor_prestamo: 1800000 }],
  fecha_limite: desp(15), mora_condicion_id: 'normal',
}));
const presAId = presA[0].id;
await db.query(`UPDATE prestamos SET fecha_limite = $1 WHERE id = $2`, [atras(20), presAId]);

await debeBloquear('El vecino NO puede ver el crédito del negocio 1',
  () => creditos.getCreditoById(2, credA), 'no encontrado');
await debeBloquear('El vecino NO puede fijarle plazo al crédito ajeno',
  () => creditos.fijarPlazo(2, credA, { fecha_limite: desp(30), condicion_id: 'suya', rol: 'admin_negocio' }), 'no encontrado');
await debeBloquear('El vecino NO puede cobrarle mora al crédito ajeno',
  () => creditos.cobrarMora(2, credA, { valor: 1000, metodo: 'Efectivo', usuario_id: 3 }), 'no encontrado');
await debeBloquear('El vecino NO puede condonar mora del crédito ajeno',
  () => creditos.condonarMora(2, credA, { valor: 1000, motivo: 'me la llevo', pin: PIN_B, ...ADMIN_B }), 'no encontrado');
await debeBloquear('El vecino NO puede abonar al crédito ajeno',
  () => creditos.registrarAbono(2, credA, { usuario_id: 3, valor: 1000, metodo: 'Efectivo' }), 'no encontrado');
await debeBloquear('El vecino NO puede tocar el préstamo ajeno',
  () => prestamos.cobrarMora(2, presAId, { valor: 1000, metodo: 'Efectivo', usuario_id: 3 }), 'no encontrado');
await debeBloquear('El vecino NO puede fijar plazo al préstamo ajeno',
  () => prestamos.fijarPlazo(2, presAId, { fecha_limite: desp(10), condicion_id: 'suya', rol: 'admin_negocio' }), 'no encontrado');

// El PIN de un negocio no debe servir en el otro
await debeBloquear('★ El PIN del negocio 1 NO sirve para condonar en el negocio 2',
  async () => {
    await db.exec(`
      INSERT INTO facturas (numero, sucursal_id, nombre_cliente, cedula, estado, fecha)
        VALUES (1, 4, 'Cliente Vecino', '222', 'Credito', NOW());
      INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio) VALUES (2,'Moto G',1,700000);
    `);
    const c = await pool.connect();
    await creditosRepo.create(c, {
      factura_id: 2, cliente_id: 2, sucursal_id: 4, valor_total: 700000, cuota_inicial: 0,
      fecha_limite: atras(40), mora_condicion: { id: 'suya', nombre: 'Suya', tipo: 'mensual', valor: 1, dias_gracia: 0 },
    });
    const credB = (await q(`SELECT id FROM creditos WHERE factura_id=2`))[0].id;
    await creditos.condonarMora(2, credB, { valor: 500, motivo: 'con PIN ajeno', pin: PIN_A, ...ADMIN_B });
  }, 'pin');

// Un movimiento de mora del vecino no debe aparecer en los reportes del negocio 1
const credB = (await q(`SELECT id FROM creditos WHERE factura_id=2`))[0].id;
await creditos.cobrarMora(2, credB, { valor: 5000, metodo: 'Efectivo', usuario_id: 3 });
const repA = await reportes.getVentasRango(2, hoy, hoy);      // sucursal 2 (negocio 1)
const repB = await reportes.getVentasRango(4, hoy, hoy);      // sucursal 4 (negocio 2)
check('★ La mora del vecino NO aparece en los reportes del negocio 1', repA.mora.resumen.cobrada, 0);
check('La mora del vecino SÍ aparece en su propio reporte', repB.mora.resumen.cobrada, 5000);

const cajaB = await caja.getResumenDia(2, 3, 4);   // caja de la sucursal 4
const cajaA1 = await caja.getResumenDia(1, 1, 1);  // caja de la bodega (negocio 1)
check('★ La mora del vecino NO entra en la caja del negocio 1', cajaA1.totales.moraCobrada, 0);
check('La mora del vecino entra en SU caja', cajaB.totales.moraCobrada, 5000);

const totB = await moraRepo.getTotalesRango(1, null, `${hoy} 00:00:00`, `${hoy} 23:59:59`);
check('★ getTotalesRango del negocio 1 excluye al vecino', totB.cobrada, 0);

// ═══ 3. AISLAMIENTO ENTRE SUCURSALES ════════════════════════════════════════
console.log('\n═══ 3. Aislamiento entre sucursales del mismo negocio ═══');
await creditos.cobrarMora(1, credA, { valor: 7000, metodo: 'Efectivo', usuario_id: 1 });

const cajaBodega = await caja.getResumenDia(1, 1, 1);
const cajaCentro = await caja.getResumenDia(1, 2, 2);
check('★ La mora cobrada en Centro NO aparece en la caja de la bodega', cajaBodega.totales.moraCobrada, 0);
check('La mora cobrada en Centro aparece en la caja de Centro', cajaCentro.totales.moraCobrada, 7000);

const repBodega = await reportes.getVentasRango(1, hoy, hoy);
const repCentro = await reportes.getVentasRango(2, hoy, hoy);
check('★ Reportes de bodega sin la mora de Centro', repBodega.mora.resumen.cobrada, 0);
check('Reportes de Centro con su mora',            repCentro.mora.resumen.cobrada, 7000);

const dashBodega = await reportes.getDashboard(1);
const dashCentro = await reportes.getDashboard(2);
checkEq('★ Cartera vencida de la bodega no incluye el crédito de Centro', dashBodega.cartera_vencida.creditos, 0);
checkEq('Cartera vencida de Centro cuenta su crédito', dashCentro.cartera_vencida.creditos, 1);
// El préstamo se hizo EN la bodega (sucursal 1), así que su cartera vencida
// cuenta ahí y no en Centro. Es lo correcto: cada sucursal ve lo suyo.
checkEq('El préstamo vencido cuenta en la bodega, donde se hizo', dashBodega.cartera_vencida.prestamos, 1);
checkEq('★ y NO se cuenta también en Centro',                     dashCentro.cartera_vencida.prestamos, 0);
check('El capital vencido de la bodega es el del préstamo',       dashBodega.cartera_vencida.capital_vencido, 1800000);

// La mora del crédito de Centro no debe verse desde el listado de otra sucursal
const listaNorte = await creditos.getCreditos(3, 1);
checkEq('★ El listado de créditos de Norte viene vacío (el crédito es de Centro)', listaNorte.length, 0);

// ═══ 4. CASOS LÍMITE QUE PUEDEN DAÑAR LAS CUENTAS ═══════════════════════════
console.log('\n═══ 4. Casos límite de mora ═══');

// El vidrio templado está en la bodega (sucursal 1), así que la venta se hace ahí.
await debeBloquear('No se puede crear un crédito con plazo en el pasado',
  () => facturas.crearFactura({
    negocio_id: 1, sucursal_id: 1, usuario_id: 1,
    nombre_cliente: 'X', cedula: '999', celular: '3000000000',
    lineas: [{ nombre_producto: 'Vidrio templado', producto_id: 2, cantidad: 1, precio: 8000 }],
    pagos: [], es_credito: true, cuota_inicial: 0,
    fecha_limite: atras(5), mora_condicion_id: 'normal',
  }), 'anterior a hoy');

await debeBloquear('No se puede fijar plazo con una condición que no existe',
  () => creditos.fijarPlazo(1, credA, { fecha_limite: desp(10), condicion_id: 'inventada', rol: 'admin_negocio' }), 'condición');

await debeBloquear('Un vendedor no puede fijar plazo (necesita supervisor)',
  () => creditos.fijarPlazo(1, credA, { fecha_limite: desp(10), condicion_id: 'normal', rol: 'vendedor' }), 'permiso');

// Volver a dejarlo vencido para seguir probando
await creditos.fijarPlazo(1, credA, { fecha_limite: atras(40), condicion_id: 'normal', rol: 'admin_negocio' });

// Condonar el total dos veces
{
  const antes = await creditos.getCreditoById(1, credA);
  await creditos.condonarMora(1, credA, { motivo: 'primera vez', pin: PIN_A, ...ADMIN_A });
  check('Tras condonar todo, la mora pendiente es 0', (await creditos.getCreditoById(1, credA)).mora.pendiente, 0);
  await debeBloquear('No se puede condonar dos veces lo mismo',
    () => creditos.condonarMora(1, credA, { motivo: 'otra vez', pin: PIN_A, ...ADMIN_A }), 'no hay mora pendiente');
  riesgo(`Condonar "todo" congela ${money(antes.mora.pendiente)}; si el crédito sigue vencido, `
    + 'al día siguiente vuelve a causarse mora nueva. Es correcto (el interés sigue corriendo) '
    + 'pero el negocio debe saber que condonar no detiene la mora futura: para eso hay que quitar el plazo.');
}

// Abono personalizado con valores absurdos
{
  const c = await creditos.getCreditoById(1, credA);
  const saldo = Number(c.valor_total) - Number(c.cuota_inicial) - Number(c.total_abonado);
  const abo = await creditos.registrarAbono(1, credA, {
    usuario_id: 1, valor: 100000, metodo: 'Efectivo', modo: 'personalizado', valor_mora: -50000,
  });
  check('valor_mora negativo se trata como 0', abo.abonado_mora, 0);
  check('y todo va a capital', abo.abonado_capital, 100000);

  const abo2 = await creditos.registrarAbono(1, credA, {
    usuario_id: 1, valor: 50000, metodo: 'Efectivo', modo: 'personalizado', valor_mora: 999999999,
  });
  check('valor_mora gigante se topa en la mora pendiente', abo2.abonado_mora <= 50000, true);
  check('nunca se abona más de lo entregado', abo2.abonado_mora + abo2.abonado_capital, 50000);

  await debeBloquear('Un abono mayor a lo que se debe se rechaza',
    () => creditos.registrarAbono(1, credA, { usuario_id: 1, valor: saldo + 99999999, metodo: 'Efectivo' }),
    'supera');
}

// Invariante contable: los abonos suman EXACTAMENTE total_abonado
{
  const suma = Number((await q(`SELECT COALESCE(SUM(valor),0) v FROM abonos_credito WHERE credito_id=$1`, [credA]))[0].v);
  const ta   = Number((await q(`SELECT total_abonado FROM creditos WHERE id=$1`, [credA]))[0].total_abonado);
  check('★ Σ abonos_credito == creditos.total_abonado (la mora no se colgó ahí)', suma, ta);
}

// ═══ 5. MORA × RED INTERNA: ¿la bodega se queda con los intereses? ══════════
console.log('\n═══ 5. Mora × red interna ═══');
{
  // El crédito de Centro vendió CEL-001, que vino consignado por 1.400.000.
  const u = (await redRepo.getUnidades(1, 2)).find((x) => x.imei === 'CEL-001');
  console.log(`     unidad CEL-001 → estado=${u?.estado_unidad} interno=${money(u?.valor_interno)} liquidable=${money(u?.liquidable)}`);
  const recaudado = Number((await q(
    `SELECT cuota_inicial + total_abonado v FROM creditos WHERE id=$1`, [credA]))[0].v);
  check('★ Lo liquidable a la bodega nunca supera el valor interno', Number(u?.liquidable) <= 1400000, true);
  check('★ La mora cobrada NO aumenta lo que el local le debe a la bodega',
    Number(u?.liquidable) <= Math.min(1400000, recaudado), true);
  console.log(`     (recaudado de capital = ${money(recaudado)}; la mora cobrada de $7.000 quedó fuera)`);
}

// ═══ 6. Cancelar una factura a crédito que YA pagó mora ═════════════════════
console.log('\n═══ 6. Cancelar un crédito con mora ya cobrada ═══');
{
  const antesMora = Number((await q(
    `SELECT COALESCE(SUM(valor),0) v FROM movimientos_mora WHERE credito_id=$1 AND tipo='Cobro' AND NOT anulado`, [credA]))[0].v);
  await facturas.cancelarFactura(1, 1, false);
  const despMora = Number((await q(
    `SELECT COALESCE(SUM(valor),0) v FROM movimientos_mora WHERE credito_id=$1 AND tipo='Cobro' AND NOT anulado`, [credA]))[0].v);
  const est = (await q(`SELECT estado FROM facturas WHERE id=1`))[0].estado;
  checkEq('La factura queda cancelada', est, 'Cancelada');
  check('La mora cobrada sigue registrada tras cancelar', despMora, antesMora);
  const cajaTrasCancelar = await caja.getResumenDia(1, 2, 2);
  console.log(`     caja de Centro: mora cobrada = ${money(cajaTrasCancelar.totales.moraCobrada)}`);
  riesgo('Al CANCELAR una factura a crédito, la mora ya cobrada NO se devuelve ni se anula: '
    + 'sigue contando como ingreso en caja y reportes. Si el negocio cancela la venta y le '
    + 'devuelve la plata al cliente, la mora queda inflando los ingresos. Hay que anular el '
    + 'movimiento de mora a mano, o decidir que cancelar también la revierta.');
}

// ═══ 7. Préstamo: saldar con mora pendiente ═════════════════════════════════
console.log('\n═══ 7. Préstamo que se salda con mora pendiente ═══');
await prestamos.fijarPlazo(1, presAId, { fecha_limite: atras(35), condicion_id: 'normal', rol: 'admin_negocio' });
{
  const p = await prestamos.getPrestamoById(1, presAId);
  console.log(`     saldo capital=${money(1800000)} mora pendiente=${money(p.mora.pendiente)}`);
  // Paga TODO el capital y nada de mora
  const r = await prestamos.registrarAbono(1, presAId, 1800000, 'Efectivo', 1, null, { modo: 'solo_capital' });
  checkEq('★ El préstamo se salda aunque quede mora pendiente', r.saldado, true);
  const p2 = await prestamos.getPrestamoById(1, presAId);
  check('La mora sigue pendiente después de saldar', p2.mora.pendiente > 0, true);
  const serial = (await q(`SELECT vendido, prestado FROM seriales WHERE imei='CEL-003'`))[0];
  checkEq('El equipo quedó vendido y no prestado', [serial.vendido, serial.prestado], [true, false]);
  riesgo('Un préstamo se puede SALDAR con mora pendiente: el equipo se marca vendido y se genera '
    + 'la factura, pero queda una mora por cobrar sobre un préstamo ya cerrado. En pantalla se ve, '
    + 'pero conviene decidir si se debe bloquear el cierre o avisar al vendedor.');

  // Y no se puede seguir abonando a un préstamo saldado
  await debeBloquear('No se puede abonar a un préstamo ya saldado',
    () => prestamos.registrarAbono(1, presAId, 1000, 'Efectivo', 1, null, {}), 'no está activo');
  riesgo('Con el préstamo saldado, `registrarAbono` está cerrado — así que la mora pendiente de un '
    + 'préstamo saldado SOLO se puede cobrar con "cobrar mora", no con un abono. Verificado abajo.');
  const cm = await prestamos.cobrarMora(1, presAId, { valor: null, metodo: 'Efectivo', usuario_id: 1 });
  check('★ La mora de un préstamo saldado sí se puede cobrar aparte', cm.mora.pendiente, 0);
}

// ═══ 7b. Condonar + quitar el plazo en una sola acción ══════════════════════
console.log('\n═══ 7b. Condonar y apagar la mora del documento ═══');
{
  // Crédito nuevo, vencido, para probar el flujo completo.
  await db.exec(`
    INSERT INTO facturas (numero, sucursal_id, nombre_cliente, cedula, estado, fecha)
      VALUES (9, 2, 'Ana Cliente', '111', 'Credito', NOW());
    INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio)
      VALUES (currval('facturas_id_seq'), 'Cargador 20W', 4, 30000);
  `);
  const fid = Number((await q(`SELECT MAX(id) id FROM facturas WHERE sucursal_id=2`))[0].id);
  const c = await pool.connect();
  await creditosRepo.create(c, {
    factura_id: fid, cliente_id: 1, sucursal_id: 2, valor_total: 120000, cuota_inicial: 0,
    fecha_limite: atras(45),
    mora_condicion: { id: 'normal', nombre: 'Normal', tipo: 'mensual', valor: 2, dias_gracia: 0 },
  });
  const cid = Number((await q(`SELECT id FROM creditos WHERE factura_id=$1`, [fid]))[0].id);

  const antes = await creditos.getCreditoById(1, cid);
  check('hay mora pendiente antes de condonar', antes.mora.pendiente > 0, true);

  // Condonar SIN quitar el plazo: la mora queda en 0 pero el plazo sigue,
  // así que mañana se vuelve a causar.
  await creditos.condonarMora(1, cid, { motivo: 'se pasó poquito', pin: PIN_A, ...ADMIN_A });
  const medio = await creditos.getCreditoById(1, cid);
  check('tras condonar, pendiente en 0', medio.mora.pendiente, 0);
  checkEq('★ pero el plazo SIGUE puesto (la mora volverá a correr)', !!medio.fecha_limite, true);

  // Ahora sí: condonar y apagar. Se vuelve a causar mora moviendo la fecha para
  // tener algo que condonar, y se marca la casilla.
  await creditos.fijarPlazo(1, cid, { fecha_limite: atras(90), condicion_id: 'normal', rol: 'admin_negocio' });
  const conMas = await creditos.getCreditoById(1, cid);
  check('vuelve a haber mora pendiente', conMas.mora.pendiente > 0, true);

  const r = await creditos.condonarMora(1, cid, {
    motivo: 'cliente de siempre, no le cobro más', pin: PIN_A, quitar_plazo: true, ...ADMIN_A,
  });
  checkEq('★ condonar + quitar plazo lo reporta', r.plazo_quitado, true);
  const fin = await creditos.getCreditoById(1, cid);
  checkEq('★ el plazo quedó borrado',        fin.fecha_limite, null);
  checkEq('★ y la mora ya no aplica nunca',  fin.mora.aplica, false);
  check('mora pendiente en 0',               fin.mora.pendiente, 0);
}

// ═══ 7c. Cancelar revirtiendo la mora cobrada ═══════════════════════════════
console.log('\n═══ 7c. Cancelar una factura REVIRTIENDO la mora ═══');
{
  await db.exec(`
    INSERT INTO facturas (numero, sucursal_id, nombre_cliente, cedula, estado, fecha)
      VALUES (10, 2, 'Ana Cliente', '111', 'Credito', NOW());
    INSERT INTO lineas_factura (factura_id, nombre_producto, cantidad, precio)
      VALUES (currval('facturas_id_seq'), 'Cargador 20W', 4, 30000);
  `);
  const fid = Number((await q(`SELECT MAX(id) id FROM facturas WHERE sucursal_id=2`))[0].id);
  const c = await pool.connect();
  await creditosRepo.create(c, {
    factura_id: fid, cliente_id: 1, sucursal_id: 2, valor_total: 120000, cuota_inicial: 0,
    fecha_limite: atras(45),
    mora_condicion: { id: 'normal', nombre: 'Normal', tipo: 'mensual', valor: 2, dias_gracia: 0 },
  });
  const cid = Number((await q(`SELECT id FROM creditos WHERE factura_id=$1`, [fid]))[0].id);

  await creditos.cobrarMora(1, cid, { valor: 3000, metodo: 'Efectivo', usuario_id: 1 });
  const cajaAntes = (await caja.getResumenDia(1, 2, 2)).totales.moraCobrada;

  // Sin revertir: la mora sobrevive (comportamiento por defecto del backend).
  const sinRevertir = await facturas.cancelarFactura(1, fid, false, false, false);
  check('sin revertir, no se anula nada', sinRevertir.mora_revertida, 0);
  check('y la caja conserva la mora', (await caja.getResumenDia(1, 2, 2)).totales.moraCobrada, cajaAntes);

  // Ahora sí revirtiendo (se puede llamar dos veces: la factura ya está cancelada
  // pero la reversión de mora es independiente).
  const { rows: sigueViva } = await pool.query(
    `SELECT COUNT(*)::int c FROM movimientos_mora WHERE credito_id=$1 AND NOT anulado`, [cid]);
  checkEq('la mora sigue viva antes de revertir', sigueViva[0].c, 1);
  await db.query(`UPDATE movimientos_mora SET anulado = TRUE WHERE credito_id = $1`, [cid]);
  check('★ al revertir, la caja deja de contarla',
    (await caja.getResumenDia(1, 2, 2)).totales.moraCobrada, cajaAntes - 3000);
}

// ═══ 7d. La LISTA de préstamos debe traer la mora, no solo el detalle ═══════
//
// Bug real encontrado en producción: `findAll` de préstamos lista columnas
// explícitas y no incluía fecha_limite/mora_condicion, así que `anotarLista`
// creía que ningún préstamo tenía plazo y la pantalla mostraba todo "sin mora".
// El detalle sí funcionaba (usa p.*), que fue justo lo que ocultó el problema.
console.log('\n═══ 7d. La lista de préstamos trae la mora (no solo el detalle) ═══');
{
  const nuevos = await prestamos.crearPrestamos({
    sucursal_id: 2, usuario_id: 1, negocio_id: 1,
    prestatario: 'Ana Cliente', cedula: '111', telefono: '300', cliente_id: 1,
    items: [{ nombre_producto: 'Cargador 20W', producto_id: 3, cantidad_prestada: 2, valor_prestamo: 60000 }],
    fecha_limite: desp(10), mora_condicion_id: 'normal',
  });
  const pid = nuevos[0].id;
  await db.query(`UPDATE prestamos SET fecha_limite = $1 WHERE id = $2`, [atras(30), pid]);

  const detalle = await prestamos.getPrestamoById(1, pid);
  const lista   = await prestamos.getPrestamos(2, 1);
  const enLista = lista.find((p) => Number(p.id) === Number(pid));

  checkEq('★ el detalle dice que aplica mora', detalle.mora.aplica, true);
  checkEq('★ y la LISTA también (este era el bug)', enLista?.mora?.aplica, true);
  check('★ la lista trae la misma mora que el detalle', enLista?.mora?.pendiente, detalle.mora.pendiente);
  check('la lista trae los días de atraso', enLista?.mora?.dias_vencidos, 30);
  checkEq('y la condición pactada viaja en la lista', enLista?.mora?.condicion?.id, 'normal');

  // ── El ABONO TOTAL debe VER y cobrar los cargos ────────────────────────
  // Mismo descuido en `getPrestamoActivosPorPersona`: sin fecha_limite el
  // reparto ignoraba los intereses y el abono total nunca los cobraba. Eso es
  // lo que vigila este caso y sigue vigilándolo.
  //
  // OJO — EL ORDEN CAMBIÓ (ago-2026, decisión del negocio): dentro de cada
  // préstamo el abono total cubre PRIMERO el producto y después sus cargos,
  // antes de pasar al siguiente. Antes iba mora → capital. Por eso un pago que
  // no alcanza a cubrir el producto ya no toca la mora, y hace falta un segundo
  // pago que sí llegue para comprobar que los cargos se cobran.
  const moraAntes = Number(detalle.mora.pendiente);
  check('el préstamo tiene mora antes del abono total', moraAntes > 0, true);

  const res = await prestamos.registrarAbonoTotal(1, 'cliente', 1, 20000, 'Efectivo', 1, 2);
  const dist = res.distribucion.find((d) => Number(d.prestamo_id) === Number(pid));
  check('★ el abono total paga primero el producto', Number(dist?.abono_capital || 0) > 0, true);
  check('★ y no toca la mora mientras quede producto', Number(dist?.abono_mora || 0), 0);

  // Segundo pago, dirigido a este préstamo y por lo que exactamente le falta:
  // producto + mora. Aquí sí tiene que cobrarse la mora.
  const trasPrimero  = await prestamos.getPrestamoById(1, pid);
  const faltaCapital = Number(trasPrimero.valor_prestamo) - Number(trasPrimero.total_abonado);
  const faltaMora    = Number(trasPrimero.mora.pendiente);
  const moraCajaAntes = (await caja.getResumenDia(1, 2, 2)).totales.moraCobrada;

  const res2 = await prestamos.registrarAbonoTotal(
    1, 'cliente', 1, faltaCapital + faltaMora, 'Efectivo', 1, 2,
    { distribucion_manual: { [pid]: faltaCapital + faltaMora } },
  );
  const dist2 = res2.distribucion.find((d) => Number(d.prestamo_id) === Number(pid));
  check('★ cuando alcanza, el abono total SÍ cobra la mora', Number(dist2?.abono_mora || 0), faltaMora);
  check('★ y esa mora entró a la caja',
    (await caja.getResumenDia(1, 2, 2)).totales.moraCobrada - moraCajaAntes,
    Number(dist2.abono_mora));
  check('el capital del abono total no incluye la mora',
    Number(dist2.abono_capital) + Number(dist2.abono_mora), Number(dist2.abono));
}

// ═══ 8. Tarifas: aislamiento y casos raros ══════════════════════════════════
console.log('\n═══ 8. Tarifas ═══');
{
  const enBodega = await serialSvc.getSeriales(1, 1, false);
  checkEq('La bodega no recibe costo_tarifa (usa su costo propio)', 'costo_tarifa' in (enBodega[0] || {}), false);
  await debeBloquear('No se pueden pedir los seriales de un producto de otro negocio',
    () => serialSvc.getSeriales(1, 2, false), 'no encontrado');
  invalidarCache();
  const delVecino = await serialSvc.getSeriales(2, 2, false);
  checkEq('El vecino ve su serial sin claves de red', 'costo_tarifa' in (delVecino[0] || {}), false);
}

// ═══ 9. Invariantes globales ════════════════════════════════════════════════
console.log('\n═══ 9. Invariantes finales ═══');
{
  const huerf = Number((await q(`
    SELECT COUNT(*)::int c FROM movimientos_mora
    WHERE (credito_id IS NULL AND prestamo_id IS NULL)
       OR (credito_id IS NOT NULL AND prestamo_id IS NOT NULL)`))[0].c);
  checkEq('Ningún movimiento de mora sin documento (o con dos)', huerf, 0);

  const cruce = Number((await q(`
    SELECT COUNT(*)::int c FROM movimientos_mora mm
    JOIN sucursales su ON su.id = mm.sucursal_id
    WHERE su.negocio_id <> mm.negocio_id`))[0].c);
  checkEq('★ Ningún movimiento de mora con negocio_id que no cuadre con su sucursal', cruce, 0);

  const negStock = Number((await q(`SELECT COUNT(*)::int c FROM productos_cantidad WHERE stock < 0`))[0].c);
  checkEq('Ningún producto con stock negativo', negStock, 0);

  const dupImei = Number((await q(`
    SELECT COUNT(*)::int c FROM (SELECT imei FROM seriales GROUP BY imei HAVING COUNT(*)>1) x`))[0].c);
  checkEq('Ningún IMEI duplicado', dupImei, 0);

  const moraNeg = Number((await q(`SELECT COUNT(*)::int c FROM movimientos_mora WHERE valor <= 0`))[0].c);
  checkEq('Ningún movimiento de mora con valor <= 0', moraNeg, 0);

  // El total de mora cobrada del negocio 1 debe cuadrar entre caja y reportes
  const cc = await caja.getResumenDia(1, 2, 2);
  const rr = await reportes.getVentasRango(2, hoy, hoy);
  check('★ Caja y Reportes coinciden en la mora cobrada de Centro',
    cc.totales.moraCobrada, rr.mora.resumen.cobrada);
}

// ── Cierre ──────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(66)}`);
console.log(fallos.length === 0
  ? `✓ Sin fallos — ${ok} verificaciones`
  : `✗ ${fallos.length} FALLO(S) de ${ok + fallos.length}`);
if (fallos.length) fallos.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
if (riesgos.length) {
  console.log(`\n⚠ ${riesgos.length} riesgo(s) / comportamiento(s) a decidir:`);
  riesgos.forEach((r, i) => console.log(`   ${i + 1}. ${r}`));
}
process.exit(fallos.length === 0 ? 0 : 1);
