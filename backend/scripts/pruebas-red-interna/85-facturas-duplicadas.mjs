// ─────────────────────────────────────────────────────────────────────────────
// UNA VENTA, UNA FACTURA — PGlite.
//
// La auditoría de datos del 30-oct-2026 encontró facturas gemelas (mismo
// usuario, cliente y productos) a 10–40 s una de otra: dos clics, o un Enter y
// un clic, eran dos ventas. Con IMEI ya se rechazaba la segunda desde julio;
// con accesorios no había freno. Ver src/modules/facturas/facturas.duplicados.js.
//
// LA SECCIÓN 2 ES LA QUE PROTEGE A LOS NEGOCIOS: lo que no es la misma venta
// tiene que seguir pasando igual que siempre.
// PGlite no simula concurrencia: el candado se vigila por su ORDEN (sección 7).
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
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
await db.exec(`
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular   TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email     TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion TEXT;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_label TEXT;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_label TEXT;
  -- Lo que el fixture no trae y cancelar una factura lee (copiado de la suite 10, que ya cancela facturas).
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
  CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, fecha TIMESTAMP DEFAULT NOW(),
    accion VARCHAR, tabla VARCHAR, registro_id INT, detalle TEXT
  );
`);

// Contador de consultas del util (sección 1: cuánto le cuesta a un negocio sin tallas).
let consultasUtil = 0;
const conectar = (t) => ({
  query: async (text, params) => {
    if (String(text).includes("clave = 'variantes_activo' LIMIT 1")) consultasUtil++;
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const facturas   = require(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'));
const controller = require(path.join(RAIZ, 'src/modules/facturas/facturas.controller.js'));
const duplicados = require(path.join(RAIZ, 'src/modules/facturas/facturas.duplicados.js'));

let fallos = 0, pasados = 0;
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const contar = async (sql, p = []) => Number((await q(sql, p))[0].n);
const stock = async (id) => Number((await q('SELECT stock FROM productos_cantidad WHERE id=$1', [id]))[0].stock);

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tienda');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1, 'Centro');
  INSERT INTO usuarios (nombre) VALUES ('Caja 1'), ('Caja 2');
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id) VALUES
    ('Vidrio', 100, 1000, 5000, 1), ('Cargador', 50, 8000, 24000, 1);
  INSERT INTO productos_serial (sucursal_id, nombre) VALUES (1, 'iPhone 13');
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (1, 'IMEI-A', 900000), (1, 'IMEI-B', 900000);
`);

const venta = (extra = {}) => ({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1,
  nombre_cliente: 'Cliente genérico', cedula: 'COMPANERO', celular: '0000000000',
  lineas: [{ nombre_producto: 'Vidrio', producto_id: 1, cantidad: 2, precio: 5000 }],
  pagos: [{ metodo: 'Efectivo', valor: 10000 }],
  ...extra,
});
const facturasVivas = () => contar(`SELECT count(*)::int n FROM facturas WHERE estado <> 'Cancelada'`);

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. ★ Sin clave (pantalla vieja): la MISMA venta dos veces es UNA factura');
{
  const a = await facturas.crearFactura(venta());
  const b = await facturas.crearFactura(venta());
  ok('★ la segunda devuelve la misma factura', b.id === a.id && b.repetida === true, `${a.id} / ${b.id}`);
  ok('una sola factura', (await facturasVivas()) === 1);
  ok('el stock bajó UNA vez (100 → 98)', (await stock(1)) === 98);
  ok('un solo pago en la caja', (await contar('SELECT count(*)::int n FROM pagos_factura')) === 1);
}

seccion('2. Lo que NO es la misma venta pasa como siempre');
{
  const otroCliente = await facturas.crearFactura(venta({ nombre_cliente: 'Ana', cedula: '111', celular: '300' }));
  ok('otro cliente: venta nueva', !otroCliente.repetida);
  const otroUsuario = await facturas.crearFactura(venta({ usuario_id: 2 }));
  ok('otro usuario (otra caja): venta nueva', !otroUsuario.repetida);
  const otraCantidad = await facturas.crearFactura(venta({
    lineas: [{ nombre_producto: 'Vidrio', producto_id: 1, cantidad: 3, precio: 5000 }] }));
  ok('otra cantidad: venta nueva', !otraCantidad.repetida);
  const otroPrecio = await facturas.crearFactura(venta({
    lineas: [{ nombre_producto: 'Vidrio', producto_id: 1, cantidad: 2, precio: 4500 }] }));
  ok('otro precio: venta nueva', !otroPrecio.repetida);
  const masProductos = await facturas.crearFactura(venta({ lineas: [
    { nombre_producto: 'Vidrio', producto_id: 1, cantidad: 2, precio: 5000 },
    { nombre_producto: 'Cargador', producto_id: 2, cantidad: 1, precio: 24000 }] }));
  ok('un producto más: venta nueva', !masProductos.repetida);
  ok('las líneas en otro orden SÍ son la misma venta', (await facturas.crearFactura(venta({ lineas: [
    { nombre_producto: 'Cargador', producto_id: 2, cantidad: 1, precio: 24000 },
    { nombre_producto: 'Vidrio', producto_id: 1, cantidad: 2, precio: 5000 }] }))).id === masProductos.id);
}

seccion('3. La ventana: pasados 30 s, una venta idéntica es otra venta');
{
  await q(`UPDATE facturas SET fecha = fecha - INTERVAL '40 seconds'`);
  const c = await facturas.crearFactura(venta());
  ok('★ fuera de la ventana: venta nueva', !c.repetida);
  await q(`UPDATE facturas SET estado = 'Cancelada' WHERE id = $1`, [c.id]);
  const d = await facturas.crearFactura(venta());
  ok('una factura CANCELADA no cuenta como gemela', !d.repetida && d.id !== c.id);
}

seccion('4. ★ Con clave (pantalla actual): manda la CLAVE');
{
  const antes = await facturasVivas();
  const e = await facturas.crearFactura(venta({ cedula: '222', nombre_cliente: 'Beto', celular: '300', clave_idempotencia: 'intento-0001' }));
  const f = await facturas.crearFactura(venta({ cedula: '222', nombre_cliente: 'Beto', celular: '300', clave_idempotencia: 'intento-0001' }));
  ok('★ la misma clave devuelve la misma factura', f.id === e.id && f.repetida === true);
  await q(`UPDATE facturas SET fecha = fecha - INTERVAL '5 minutes' WHERE id = $1`, [e.id]);
  const g = await facturas.crearFactura(venta({ cedula: '222', nombre_cliente: 'Beto', celular: '300', clave_idempotencia: 'intento-0001' }));
  ok('…también 5 minutos después (el reintento tras un corte de red)', g.id === e.id && g.repetida === true);
  const h = await facturas.crearFactura(venta({ cedula: '222', nombre_cliente: 'Beto', celular: '300', clave_idempotencia: 'intento-0002' }));
  ok('★ clave NUEVA con la venta idéntica: es otra venta (dos clientes, el mismo vidrio)', !h.repetida && h.id !== e.id);
  ok('quedan exactamente dos facturas nuevas', (await facturasVivas()) === antes + 2);
  ok('una clave basura se ignora (no rompe)', duplicados.normalizarClave(123) === null && duplicados.normalizarClave('x') === null
    && duplicados.normalizarClave('  intento-0003  ') === 'intento-0003');
}

seccion('5. Equipo con IMEI: el doble envío no termina en «ya fue vendido»');
{
  const lineas = [{ nombre_producto: 'iPhone 13', imei: 'IMEI-A', cantidad: 1, precio: 2000000 }];
  const a = await facturas.crearFactura(venta({ nombre_cliente: 'Carla', cedula: '333', celular: '300', lineas, pagos: [{ metodo: 'Efectivo', valor: 2000000 }] }));
  const b = await facturas.crearFactura(venta({ nombre_cliente: 'Carla', cedula: '333', celular: '300', lineas, pagos: [{ metodo: 'Efectivo', valor: 2000000 }] }));
  ok('el segundo envío devuelve la factura (la pantalla imprime, no muestra un error)', b.id === a.id && b.repetida === true);
  let err = null;
  try {
    await facturas.crearFactura(venta({ nombre_cliente: 'Dani', cedula: '444', celular: '300', lineas, pagos: [{ metodo: 'Efectivo', valor: 2000000 }] }));
  } catch (e) { err = e; }
  ok('venderle el MISMO equipo a otra persona sigue rechazado', /ya fue vendido/.test(err?.message || ''), err?.message);
}

seccion('6. El controlador: 200, sin auditar una venta que no existió');
{
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const req = (body) => ({ body, sucursal_id: 1, user: { id: 1, negocio_id: 1, rol: 'admin_negocio' } });
  const cuerpo = { ...venta({ nombre_cliente: 'Elena', cedula: '555', celular: '300' }) };
  delete cuerpo.negocio_id; delete cuerpo.sucursal_id; delete cuerpo.usuario_id;
  const r1 = { ...res };
  await controller.crearFactura(req(cuerpo), r1, (e) => { throw e; });
  await new Promise((r) => setTimeout(r, 30));
  const auditadas = await contar(`SELECT count(*)::int n FROM auditoria WHERE accion = 'Venta registrada'`);
  const r2 = { ...res };
  await controller.crearFactura(req(cuerpo), r2, (e) => { throw e; });
  await new Promise((r) => setTimeout(r, 30));
  ok('la primera responde 201', r1.code === 201);
  ok('★ la repetida responde 200 con la MISMA factura y lo dice', r2.code === 200 && r2.body.data.id === r1.body.data.id
    && /ya se había registrado/.test(r2.body.message), r2.body?.message);
  ok('no se audita una segunda «Venta registrada»',
    (await contar(`SELECT count(*)::int n FROM auditoria WHERE accion = 'Venta registrada'`)) === auditadas);
}

seccion('7. ★ El orden: el candado ANTES de buscar la repetida (si no, no sirve)');
{
  const srv = readFileSync(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'), 'utf8');
  const cuerpo = srv.slice(srv.indexOf('const crearFactura'), srv.indexOf('// ── Cancelar factura'));
  const iBegin = cuerpo.indexOf("client.query('BEGIN')");
  const iLock = cuerpo.indexOf('bloquearOperacion(client');
  const iBusca = cuerpo.indexOf('duplicados.buscarRepetida');
  const iInsert = cuerpo.indexOf('facturasRepo.create(');
  ok('BEGIN → candado → buscar → crear', iBegin > 0 && iBegin < iLock && iLock < iBusca && iBusca < iInsert,
    `${iBegin} ${iLock} ${iBusca} ${iInsert}`);
  ok('el candado es por sede y usuario', /bloquearOperacion\(client, `factura:\$\{Number\(sucursal_id\)\}:\$\{usuario_id\}`/.test(cuerpo));
  ok('la clave se recuerda DESPUÉS del COMMIT', cuerpo.indexOf("client.query('COMMIT')") < cuerpo.indexOf('duplicados.recordarClave'));
  const otros = ['ingresarSerialRetomado', 'creditosRepo.create'];
  ok('dentro de la venta no se toma un segundo candado', !/bloquearOperacion/.test(readFileSync(path.join(RAIZ, 'src/utils/retomaSerial.util.js'), 'utf8')), otros.join(', '));
}

seccion('8. La pantalla: freno inmediato y una clave por intento');
{
  const jsx = readFileSync(path.join(FRONT, 'pages/facturas/ModalFactura.jsx'), 'utf8');
  const handle = jsx.slice(jsx.indexOf('const handleSubmit = async'), jsx.indexOf('const validarYEnviar'));
  ok('★ handleSubmit frena ANTES de cualquier await',
    handle.indexOf('if (enviandoRef.current) return') >= 0
    && handle.indexOf('enviandoRef.current = true') < handle.indexOf('await'));
  ok('el Enter pasa por el mismo freno (handleKeyDown llama a handleSubmit)', /else handleSubmit\(\);/.test(jsx));
  ok('el payload lleva la clave', /clave_idempotencia: claveIdempotencia \|\| null/.test(jsx)
    && /claveIdempotencia: claveRef\.current/.test(jsx));
  ok('la clave nace al enviar y se renueva al terminar la venta (resetForm)',
    /if \(!claveRef\.current\) claveRef\.current = nuevaClaveVenta\(\)/.test(jsx)
    && /const resetForm = \(\) => \{\s*enviandoRef\.current = false;\s*claveRef\.current\s*= null;/.test(jsx));
  ok('un error libera el freno (se puede corregir y reintentar con la MISMA clave)',
    /onError: \(err\) => \{\s*enviandoRef\.current = false;/.test(jsx));
  ok('confirmar el cliente reescrito también pasa por el freno',
    /const handleReescribir = async \(\) => \{\s*if \(enviandoRef\.current\) return;/.test(jsx));
}

console.log(`\n${fallos === 0 ? '✓' : '✗'} ${pasados} pasaron, ${fallos} fallaron\n`);
process.exit(fallos ? 1 : 0);
