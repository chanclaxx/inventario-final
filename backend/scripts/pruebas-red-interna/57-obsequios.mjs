// ─────────────────────────────────────────────────────────────────────────────
// OBSEQUIOS — lo que se regala se factura en $0 y su COSTO baja la utilidad.
// Contra un Postgres real (PGlite), con los servicios REALES de factura y de
// reportes: si los dos no cuentan lo mismo, la feature no sirve para nada.
//
// El caso que hay que mirar primero es la sección 5: se vende un celular de
// $2.600.000 (costó $2.000.000) con un vidrio y un estuche de regalo. La
// factura cobra $2.600.000 y el reporte dice que el costo fueron los TRES
// productos y que la utilidad bajó por los dos regalos.
//
// Lo que protege, en orden:
//   1. SIN LA COLUMNA NO CAMBIA NADA (sección 1): la marca se ignora y el
//      precio mínimo sigue rechazando el $0. Es la baranda de un despliegue
//      donde la migración no llegue a aplicarse.
//   2. El precio de un obsequio lo pone el SERVIDOR (sección 3): mandar
//      «obsequio + precio 100» no puede colar una venta de 100 que se saltó el
//      precio mínimo.
//   3. Regalar y luego cobrar por la edición pasa por el precio mínimo
//      (sección 4): comparado con 0 todo precio sube, así que sin esa regla la
//      edición sería la puerta de atrás del candado.
//   4. La utilidad (sección 5): la del reporte cuadra al peso con
//      ingresos − (costo del equipo + costo de los dos obsequios).
//
//   node scripts/pruebas-red-interna/57-obsequios.mjs
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
for (const m of [
  '20260725_red_interna.sql', '20260726_red_interna_v2.sql', '20260822_red_interna_envios.sql',
  '20260823_red_interna_control.sql', '20260823_red_interna_cargos_pagables.sql',
  '20260823_remision_variantes.sql', '20260823_lotes_cantidad.sql',
  '20260824_costo_origen_remision.sql', '20260823_valor_acreditado.sql',
]) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}
// La migración de la feature, leída del MISMO .sql que corre en producción.
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260920_obsequios.sql'), 'utf8'));
await db.exec(`
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS celular   TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email     TEXT;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS direccion TEXT;
  CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY, negocio_id INT, usuario_id INT, fecha TIMESTAMP DEFAULT NOW(),
    accion VARCHAR, tabla VARCHAR, registro_id INT, detalle TEXT
  );
`);

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
const facturas = require(path.join(RAIZ, 'src/modules/facturas/facturas.service.js'));
const reportes = require(path.join(RAIZ, 'src/modules/reportes/reportes.service.js'));

let fallos = 0, pasados = 0;
const ok = (nombre, cond, detalle = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  cond ? pasados++ : fallos++;
};
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
const igual = (nombre, real, esperado) =>
  ok(nombre, Math.abs(Number(real) - Number(esperado)) < 1, `${money(real)} vs ${money(esperado)}`);
const pasa = async (nombre, fn) => {
  try { await fn(); ok(nombre, true); }
  catch (e) { ok(nombre, false, `lanzó: ${e.message || e}`); }
};
const rechaza = async (nombre, fn, code) => {
  try { await fn(); ok(nombre, false, 'NO lanzó'); }
  catch (e) { ok(nombre, e.code === code, `${e.code || ''} ${String(e.message || '').slice(0, 70)}`); }
};
const seccion = (t) => console.log(`\n── ${t}`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Test');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Principal');
  INSERT INTO usuarios (nombre) VALUES ('Andrés'), ('Ana');
  INSERT INTO config_negocio VALUES (1,'precio_minimo_activo','1');

  -- Accesorios que se regalan: cuestan plata y se venden a un precio conocido.
  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id)
    VALUES ('Vidrio templado', 50, 6000, 20000, 1),   -- id 1
           ('Estuche',         50, 9000, 35000, 1),   -- id 2
           ('Cable sin precio', 50, 3000, NULL,  1);  -- id 3 (sin piso)

  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone 13','Apple','128GB', 2600000, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES
    (1, 'IMEI-1', 2000000), (1, 'IMEI-2', 2000000),
    (1, 'IMEI-3', 2000000), (1, 'IMEI-4', 2000000), (1, 'IMEI-5', 2000000);
`);

const vender = (lineas, usuarioId = 1) => facturas.crearFactura({
  negocio_id: 1, sucursal_id: 1, usuario_id: usuarioId,
  nombre_cliente: 'Cliente', cedula: '123', celular: '300',
  lineas, pagos: [{ metodo: 'Efectivo', valor: 1 }],
});
const celular = (imei, precio = 2600000) =>
  ({ nombre_producto: 'iPhone 13', imei, cantidad: 1, precio });
const vidrio  = (extra = {}) =>
  ({ nombre_producto: 'Vidrio templado', producto_id: 1, cantidad: 1, precio: 20000, ...extra });
const estuche = (extra = {}) =>
  ({ nombre_producto: 'Estuche', producto_id: 2, cantidad: 1, precio: 35000, ...extra });

// Lo que la factura cobra de verdad: la suma de sus líneas (`subtotal` es una
// columna generada = cantidad × precio), que es lo que el obsequio no mueve.
const totalDe = async (facturaId) => Number(
  (await q(`SELECT COALESCE(SUM(subtotal), 0) AS t FROM lineas_factura WHERE factura_id = $1`,
    [facturaId]))[0].t);

const lineasDe = (facturaId) =>
  q(`SELECT nombre_producto, precio, obsequio FROM lineas_factura WHERE factura_id = $1 ORDER BY id`,
    [facturaId]);
const stockDe = async (id) =>
  Number((await q(`SELECT stock FROM productos_cantidad WHERE id = $1`, [id]))[0].stock);

// ─────────────────────────────────────────────────────────────────────────────
seccion('1. SIN LA COLUMNA no cambia nada (protege a los 28 negocios)');
{
  columnas._setObsequiosDisponible(false);
  // La marca se ignora entera: sin dónde escribir «esto es un regalo», dejar
  // pasar un $0 sería abrir el candado sin dejar rastro.
  await rechaza('obsequio sin columna: manda el precio mínimo',
    () => vender([celular('IMEI-1'), vidrio({ obsequio: true, precio: 0 })]),
    'PRECIO_BAJO_MINIMO');
  await pasa('y la venta normal sigue funcionando igual',
    () => vender([vidrio()]));
  const [l] = await lineasDe((await q(`SELECT max(id) AS id FROM facturas`))[0].id);
  ok('la línea no quedó marcada', l.obsequio === false);
  columnas._setObsequiosDisponible(true);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('2. Con la columna: el obsequio se factura en $0 y sale del inventario');
{
  const stockAntes = await stockDe(1);
  const f = await vender([celular('IMEI-1'), vidrio({ obsequio: true })]);
  const lineas = await lineasDe(f.id);
  ok('la línea del regalo quedó marcada', lineas[1].obsequio === true);
  igual('…y su precio es 0', lineas[1].precio, 0);
  igual('el celular se cobró completo', lineas[0].precio, 2600000);
  igual('el total de la factura es solo el celular', await totalDe(f.id), 2600000);
  ok('el vidrio salió del inventario', (await stockDe(1)) === stockAntes - 1,
    `${stockAntes} → ${await stockDe(1)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('3. El precio de un obsequio lo pone el SERVIDOR');
{
  // Si se confiara en el número del navegador, «obsequio + precio 100» sería
  // una venta de 100 que se saltó el precio mínimo.
  const f = await vender([vidrio({ obsequio: true, precio: 100 })]);
  const [l] = await lineasDe(f.id);
  igual('obsequio + precio 100 → se guarda 0', l.precio, 0);
  igual('…y la factura no cobró nada', await totalDe(f.id), 0);

  // Un obsequio es una unidad que SALE del inventario: sin producto no hay
  // costo que contar, que es justo el punto de la feature.
  await rechaza('texto libre marcado como obsequio → 400',
    () => vender([{ nombre_producto: 'Servicio', cantidad: 1, precio: 0, obsequio: true }]),
    'OBSEQUIO_SIN_PRODUCTO');

  // Un producto SIN precio de venta no tiene piso: no necesita la marca, y si
  // la trae igual se respeta.
  await pasa('producto sin precio registrado marcado como obsequio',
    () => vender([{ nombre_producto: 'Cable sin precio', producto_id: 3, cantidad: 1, precio: 0, obsequio: true }]));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('4. Editar: sigue en 0, y cobrarlo pasa por el precio mínimo');
{
  const f = await vender([celular('IMEI-2'), vidrio({ obsequio: true })]);
  const lineas = await q(`SELECT id, cantidad, precio FROM lineas_factura WHERE factura_id = $1 ORDER BY id`, [f.id]);
  const editar = (precios) => facturas.editarFactura(1, f.id, {
    nombre_cliente: 'Cliente', cedula: '123', celular: '300',
    lineas: lineas.map((l, i) => ({ id: l.id, cantidad: l.cantidad, precio: precios[i] ?? Number(l.precio) })),
    pagos: [{ metodo: 'Efectivo', valor: 1 }],
  });

  await pasa('guardar sin tocar nada deja el obsequio en 0', () => editar([]));
  ok('sigue marcado', (await lineasDe(f.id))[1].obsequio === true);

  // Comparado con 0 todo precio sube: sin esta regla, «regalar y luego cobrar
  // 5.000» sería la puerta de atrás del candado.
  await rechaza('cobrarlo a 5.000 (mínimo 20.000) → rechazado',
    () => editar([undefined, 5000]), 'PRECIO_BAJO_MINIMO');
  ok('y sigue siendo obsequio', (await lineasDe(f.id))[1].obsequio === true);

  await pasa('cobrarlo a 20.000 (su precio) → aceptado', () => editar([undefined, 20000]));
  const despues = await lineasDe(f.id);
  ok('deja de ser obsequio', despues[1].obsequio === false);
  igual('…y queda con su precio', despues[1].precio, 20000);

  // La edición NO convierte en obsequio una línea cobrada: eso regala
  // mercancía ya facturada y se decide en el carrito.
  await pasa('marcar obsequio desde la edición se ignora', () => facturas.editarFactura(1, f.id, {
    nombre_cliente: 'Cliente', cedula: '123', celular: '300',
    lineas: despues.map((l, i) => ({
      id: lineas[i].id, cantidad: 1, precio: Number(l.precio), obsequio: true,
    })),
    pagos: [{ metodo: 'Efectivo', valor: 1 }],
  }));
  ok('el celular sigue sin ser obsequio', (await lineasDe(f.id))[0].obsequio === false);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('5. EL CASO: celular con vidrio y estuche de regalo — la utilidad');
{
  await q(`DELETE FROM lineas_factura`);
  await q(`DELETE FROM pagos_factura`);
  await q(`DELETE FROM facturas`);

  const f = await vender([
    celular('IMEI-3'),
    vidrio({ obsequio: true }),
    estuche({ obsequio: true }),
  ]);
  igual('la factura cobra solo el celular', await totalDe(f.id), 2600000);

  const hoy = new Date().toISOString().slice(0, 10);
  const rep = await reportes.getVentasRango(1, hoy, hoy);
  const factura = rep.facturas.find((x) => x.id === f.id);

  const COSTO_EQUIPO = 2000000, COSTO_VIDRIO = 6000, COSTO_ESTUCHE = 9000;
  const costoTotal = COSTO_EQUIPO + COSTO_VIDRIO + COSTO_ESTUCHE;

  ok('el reporte trae las TRES líneas', factura.lineas.length === 3);
  ok('y sabe cuáles fueron obsequio',
    factura.lineas.filter((l) => l.obsequio).length === 2);

  const costoReportado = factura.lineas.reduce((s, l) => s + Number(l.costo_total || 0), 0);
  igual('costo = equipo + vidrio + estuche', costoReportado, costoTotal);
  igual('utilidad = 2.600.000 − 2.015.000', factura.utilidad_bruta, 2600000 - costoTotal);
  igual('cada obsequio aporta su costo en negativo',
    factura.lineas.filter((l) => l.obsequio).reduce((s, l) => s + l.utilidad, 0),
    -(COSTO_VIDRIO + COSTO_ESTUCHE));

  igual('la factura informa el costo de lo regalado', factura.costo_obsequios,
    COSTO_VIDRIO + COSTO_ESTUCHE);
  ok('…y cuántas unidades', factura.unidades_obsequio === 2);

  igual('resumen: costo de obsequios del período', rep.resumen.costo_obsequios,
    COSTO_VIDRIO + COSTO_ESTUCHE);
  ok('resumen: unidades', rep.resumen.unidades_obsequio === 2);
  ok('resumen: facturas con obsequio', rep.resumen.facturas_con_obsequio === 1);
  igual('resumen: utilidad del período', rep.resumen.utilidad_neta_total, 2600000 - costoTotal);

  // La misma venta SIN regalar (cobrando los dos accesorios) deja más utilidad,
  // y la diferencia es exactamente lo que se dejó de cobrar.
  const f2 = await vender([celular('IMEI-4'), vidrio(), estuche()]);
  const rep2 = await reportes.getVentasRango(1, hoy, hoy);
  const factura2 = rep2.facturas.find((x) => x.id === f2.id);
  igual('cobrándolos, la utilidad sube por el precio de los accesorios',
    factura2.utilidad_bruta - factura.utilidad_bruta, 20000 + 35000);
  igual('y el costo de las dos ventas es el mismo',
    factura2.lineas.reduce((s, l) => s + Number(l.costo_total || 0), 0), costoTotal);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('6. El resumen de control: qué se regaló y QUIÉN lo dio');
{
  const hoy = new Date().toISOString().slice(0, 10);

  // Ana regala dos vidrios en una venta aparte: sin este corte, «¿alguien está
  // regalando de más?» habría que responderlo abriendo factura por factura.
  await vender([celular('IMEI-5'), vidrio({ obsequio: true, cantidad: 2 })], 2);

  const rep = await reportes.getObsequiosRango(1, hoy, hoy);
  ok('el bloque existe', !!rep);

  // Lo de la sección 5 (1 vidrio + 1 estuche de Andrés) más los 2 de Ana.
  ok('unidades del período', rep.resumen.unidades === 4, `${rep.resumen.unidades}`);
  igual('costo del período', rep.resumen.costo_total, 6000 + 9000 + 6000 * 2);
  ok('facturas con obsequio', rep.resumen.facturas === 2, `${rep.resumen.facturas}`);
  igual('costo promedio por factura', rep.resumen.costo_por_factura, (6000 + 9000 + 12000) / 2);

  // Qué se regala, de lo más caro a lo más barato.
  ok('el producto más regalado encabeza',
    rep.productos[0].nombre_producto === 'Vidrio templado', rep.productos[0].nombre_producto);
  ok('…con sus 3 unidades', rep.productos[0].unidades === 3, `${rep.productos[0].unidades}`);
  igual('…y su costo', rep.productos[0].costo_total, 6000 * 3);
  igual('el estuche va después', rep.productos[1].costo_total, 9000);

  // Quién lo dio: el corte de control.
  const ana    = rep.responsables.find((r) => r.usuario_nombre === 'Ana');
  const andres = rep.responsables.find((r) => r.usuario_nombre === 'Andrés');
  ok('Ana aparece con sus 2 unidades', ana?.unidades === 2, `${ana?.unidades}`);
  igual('…y su costo', ana.costo_total, 12000);
  ok('…en 1 factura', ana.facturas === 1);
  ok('Andrés aparece con sus 2 unidades', andres?.unidades === 2);
  // Ordena por COSTO, no por unidades: Ana regaló 2 vidrios ($12.000) y Andrés
  // un vidrio y un estuche ($15.000). Lo que hay que mirar primero es dónde se
  // fue el dinero, no quién entregó más cosas.
  ok('encabeza quien más COSTO regaló, no quien más unidades',
    rep.responsables[0].usuario_nombre === 'Andrés' && rep.responsables[0].unidades === 2,
    `${rep.responsables[0].usuario_nombre} · ${rep.responsables[0].costo_total}`);

  // Las facturas, de la más cara a la más barata en regalos.
  ok('se listan las 2 facturas', rep.facturas.length === 2);
  ok('la más cara primero', rep.facturas[0].costo_total >= rep.facturas[1].costo_total);
  ok('cada factura trae sus líneas', rep.facturas[0].lineas.length > 0);
  ok('…y dice quién lo dio', !!rep.facturas[0].usuario_nombre);

  // Cuadra con lo que dice la pestaña de ventas: si las dos cifras se
  // separaran, el panel de control contradiría al de utilidad.
  const ventas = await reportes.getVentasRango(1, hoy, hoy);
  igual('el bloque cuadra con el resumen de ventas',
    ventas.obsequios.resumen.costo_total, ventas.resumen.costo_obsequios);
  ok('…y con las unidades', ventas.obsequios.resumen.unidades === ventas.resumen.unidades_obsequio);

  // Un período sin obsequios no pinta nada.
  ok('un rango sin obsequios devuelve null',
    (await reportes.getObsequiosRango(1, '2020-01-01', '2020-01-02')) === null);

  // Sin la columna, tampoco: la pregunta no se puede responder y no se finge.
  columnas._setObsequiosDisponible(false);
  ok('sin la columna devuelve null', (await reportes.getObsequiosRango(1, hoy, hoy)) === null);
  const ventasSin = await reportes.getVentasRango(1, hoy, hoy);
  ok('…y la pestaña de ventas tampoco lo trae', ventasSin.obsequios === null);
  columnas._setObsequiosDisponible(true);

  // Productos más vendidos: un accesorio regalado no puede encabezar el ranking
  // sin decir que no dejó un peso.
  const top = await reportes.getProductosTop(1, hoy, hoy);
  const vidrioTop = top.find((t) => t.nombre_producto === 'Vidrio templado');
  ok('el top de productos dice cuántas fueron obsequio',
    vidrioTop.unidades_obsequio === 3, `${vidrioTop.unidades_obsequio}`);
  ok('…sin inventar unidades de más', vidrioTop.unidades_obsequio <= vidrioTop.cantidad_vendida);

  // Por vendedor (feature opt-in de vendedores).
  await q(`INSERT INTO config_negocio VALUES (1, 'vendedores_activo', '1')`);
  await q(`INSERT INTO vendedores (sucursal_id, nombre, activo) VALUES (1, 'Vendedor 1', true)`);
  const [{ id: vid }] = await q(`SELECT id FROM vendedores LIMIT 1`);
  await q(`UPDATE facturas SET vendedor_id = $1`, [vid]);
  const porVendedor = await reportes.getVentasPorVendedor(1, hoy, hoy);
  const v1 = porVendedor.vendedores[0];
  ok('el vendedor reporta sus obsequios', v1.unidades_obsequio === 4, `${v1.unidades_obsequio}`);
  igual('…y su costo', v1.costo_obsequios, 6000 * 3 + 9000);
  ok('el costo del regalo ya estaba dentro de su costo total',
    v1.costo_total >= v1.costo_obsequios);
  await q(`DELETE FROM config_negocio WHERE clave = 'vendedores_activo'`);
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('7. Las pantallas prometen lo mismo que el backend');
{
  const leer = (rel) => readFileSync(path.join(RAIZ, '..', rel), 'utf8');

  const carrito = leer('frontend/src/pages/inventario/Carrito.jsx');
  ok('el carrito solo ofrece obsequiar con el precio mínimo activo',
    /reglaPrecio\.activo &&[\s\S]{0,400}marcarObsequio/.test(carrito));

  const modal = leer('frontend/src/pages/facturas/ModalFactura.jsx');
  ok('ModalFactura manda la marca al backend', /obsequio: true/.test(modal));
  ok('…y no manda un precio propio para el regalo',
    !/precio:\s*0,\s*\n\s*obsequio/.test(modal));

  const store = leer('frontend/src/store/carritoStore.js');
  ok('marcar obsequio pone el precio en 0', /obsequio: true, precioFinal: 0/.test(store));
  ok('escribir un precio a mano quita la marca', /obsequio: false, origen_precio: ORIGEN_MANUAL/.test(store));

  const minimo = leer('frontend/src/utils/precioMinimo.js');
  ok('el aviso de precio mínimo no marca los obsequios', /filter\(\(i\) => !esObsequio\(i\)\)/.test(minimo));

  const prestamo = leer('frontend/src/pages/prestamos/ModalPrestamo.jsx');
  ok('un obsequio no se puede prestar', /items\.find\(esObsequio\)/.test(prestamo));

  const termica = leer('frontend/src/components/FacturaTermica.jsx');
  ok('el ticket dice «Obsequio»', /l\.obsequio \? 'Obsequio'/.test(termica));

  const pdf = leer('backend/src/modules/facturas/facturas.pdf.js');
  ok('el PDF dice «Obsequio»', /linea\.obsequio/.test(pdf));

  const reportesUI = leer('frontend/src/pages/reportes/ReportesPage.jsx');
  ok('la pestaña Ventas pinta la sección solo si el backend la manda',
    /if \(!obsequios\) return null/.test(reportesUI));
  ok('…y la cuelga de los datos del período', /<SeccionObsequios/.test(reportesUI));
  ok('la pestaña Productos marca lo regalado',
    /producto\.unidades_obsequio > 0/.test(reportesUI));

  const vendedoresUI = leer('frontend/src/pages/reportes/PanelVendedores.jsx');
  ok('la pestaña Vendedores dice cuánto regaló cada uno',
    /unidades_obsequio/.test(vendedoresUI) && /costo_obsequios/.test(vendedoresUI));
}

console.log(`\n${pasados} verificaciones OK, ${fallos} fallidas`);
process.exit(fallos ? 1 : 0);
