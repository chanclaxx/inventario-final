// ─────────────────────────────────────────────────────────────────────────────
// RECLAMO POR FALTANTE ("esto no me llegó") — contra un Postgres real (PGlite).
//
// El local confirma un envío de más y después descubre que algo no venía en la
// caja. Lo marca como faltante; su deuda NO baja sola: baja cuando la bodega lo
// revisa y confirma que la mercancía la tiene ella.
//
// Reportado desde producción: la pantalla decía SIEMPRE "no hay nada que
// reportar: todo lo de este envío ya se vendió, se prestó o se devolvió",
// incluso con el envío recién recibido y nada vendido.
//
// Eran dos fallos encadenados:
//   1. el filtro de candidatos exigía `tipo === 'serial'`. `estado_unidad` solo
//      existe para seriales —el motor de estados sigue unidad por unidad, y eso
//      no se puede hacer con mercancía fungible—, así que las líneas de CANTIDAD
//      no eran ni candidatas ni bloqueadas: desaparecían de la pantalla. Para un
//      negocio con el catálogo por variantes eso es TODO su envío;
//   2. el mensaje de "no hay nada" era un cajón de sastre que afirmaba que ya se
//      había vendido, sin haber mirado si de verdad había algo vendido.
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
for (const m of ['20260725_red_interna.sql', '20260726_red_interna_v2.sql',
                 '20260822_red_interna_envios.sql', '20260823_red_interna_control.sql',
                 '20260823_red_interna_cargos_pagables.sql', '20260823_remision_variantes.sql']) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}

const conectar = (t) => ({ query: (s, p) => t.query(s, p ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const red     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const redRepo = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.repository.js'));

let fallos = 0, pasados = 0;
const q = async (s, p = []) => (await db.query(s, p)).rows;
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
}
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ': ' + detalle : ''}`);
  cond ? pasados++ : fallos++;
}

// Mismo criterio que la pantalla (ModalReportarFaltante).
const RECLAMABLES = ['En consignacion', 'Sin ubicar', 'Movida'];
const esCandidato = (l) => (l.tipo === 'serial'
  ? RECLAMABLES.includes(l.estado_unidad)
  : Number(l.reclamable || 0) > 0);
const verPantalla = async (remisionId) => {
  const lineas = (await redRepo.getLineasDetalladas(1, remisionId, 2))
    .filter((l) => l.estado_linea === 'Recibida');
  return {
    candidatos: lineas.filter(esCandidato),
    bloqueadas: lineas.filter((l) => !esCandidato(l)),
    lineas,
  };
};

// ── Un negocio como el del cliente: catálogo por variantes + algún equipo ────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con Red');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Local');
  INSERT INTO usuarios (nombre) VALUES ('Admin'),('Vendedor');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1'), (1,'variantes_activo','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'ACCESORIOS');

  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone 13','Apple','128GB', 2500000, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra) VALUES (1,'IMEI-A', 1800000);

  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (1,'360 NEGRO', 15, 3700, 1, 'unidad');                 -- id 1 bodega
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
    VALUES (1,1,'38MM',15,3700);                                   -- id 1
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (2,'360 NEGRO', 0, NULL, 1, 'unidad');                  -- id 2 local
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
    VALUES (2,2,'38MM',0,NULL);                                    -- id 2
`);

const reqBodega = {
  user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true,
  red: { activa: true, bodega_id: 1, modo_precio: 'costo', confirmar_recepcion: true,
         confirmar_remesa: true, ocultar_costos: false },
};
const reqLocal = {
  user: { id: 2, negocio_id: 1, rol: 'vendedor' }, sucursal_id: 2, esBodega: false,
  red: { ...reqBodega.red },
};

console.log('\n═══ 1. La bodega despacha un equipo y 5 accesorios de una talla ═══');
const envio = await red.despachar(reqBodega, {
  sucursal_destino_id: 2,
  lineas: [
    { tipo: 'serial',   serial_id: 1 },
    { tipo: 'cantidad', producto_id: 1, atributo_id: 1, cantidad: 5, valor_interno: 5000 },
  ],
});
{
  const ls = await redRepo.getLineasRemision(envio.id);
  await red.recibir(reqLocal, envio.id, { lineas_recibidas: ls.map((l) => Number(l.id)) });
  check('deuda del envío', Number(envio.valor_total), 1800000 + 25000);
}

console.log('\n═══ 2. Recién recibido y sin vender: TODO es reclamable ═══');
{
  const v = await verPantalla(envio.id);
  check('líneas del envío', v.lineas.length, 2);
  check('★ candidatos a reclamo (antes era 1: la de cantidad desaparecía)', v.candidatos.length, 2);
  check('★ ninguna bloqueada — nada se ha vendido', v.bloqueadas.length, 0);
  const cant = v.candidatos.find((l) => l.tipo === 'cantidad');
  check('★ la línea de cantidad dice cuántas se pueden reclamar', Number(cant.reclamable), 5);
  ok('★ la pantalla NO diría "ya se vendió"', v.candidatos.length > 0);
}

console.log('\n═══ 3. Reclamo parcial: 2 de los 5 accesorios no llegaron ═══');
let reclamo;
{
  const v = await verPantalla(envio.id);
  const cant = v.candidatos.find((l) => l.tipo === 'cantidad');
  reclamo = await red.devolver(reqLocal, {
    motivo: 'faltante',
    notas: 'La caja venía abierta',
    lineas: [{
      tipo: 'cantidad',
      producto_id: cant.producto_destino_id,
      atributo_id: cant.atributo_destino_id,
      cantidad: 2,
    }],
  });
  const [r] = await q(`SELECT tipo, motivo, estado FROM remisiones WHERE id=$1`, [reclamo.id]);
  check('★ nace como devolución con motivo "faltante"', [r.tipo, r.motivo], ['devolucion', 'faltante']);
  check('y queda en tránsito hasta que la bodega la revise', r.estado, 'En transito');

  // Hasta aquí NO se movió nada: la deuda del local sigue igual.
  const [loc] = await q(`SELECT stock FROM atributos_producto WHERE id=2`);
  check('★ el inventario del local no se toca todavía', Number(loc.stock), 5);
}

console.log('\n═══ 4. La bodega lo confirma: ahí sí baja la deuda ═══');
{
  const ls = await redRepo.getLineasRemision(reclamo.id);
  await red.confirmarDevolucion(reqBodega, reclamo.id, {
    lineas_recibidas: ls.map((l) => Number(l.id)),
  });
  const [loc] = await q(`SELECT stock FROM atributos_producto WHERE id=2`);
  const [bod] = await q(`SELECT stock FROM atributos_producto WHERE id=1`);
  check('★ salen del local las 2 que nunca llegaron', Number(loc.stock), 3);
  check('★ y vuelven a la talla correcta en la bodega', Number(bod.stock), 12);

  const cuenta = await red.getEstadoCuenta(reqLocal, 2);
  const esperado = 1800000 + 25000 - 10000;   // 2 unidades × $5.000
  check('★ la deuda bajó exactamente lo reclamado',
    Number(cuenta.totales.deuda_total), esperado);
}

console.log('\n═══ 5. Lo ya vendido NO se puede reclamar, y se dice por qué ═══');
{
  // El local vende el equipo: deja de ser reclamable.
  await q(`INSERT INTO facturas (sucursal_id, fecha, estado, nombre_cliente)
           VALUES (2, NOW(), 'Activa', 'Cliente')`);
  await q(`INSERT INTO lineas_factura (factura_id, nombre_producto, imei, cantidad, precio)
           VALUES ((SELECT MAX(id) FROM facturas), 'iPhone 13', 'IMEI-A', 1, 2400000)`);

  const v = await verPantalla(envio.id);
  const serial = v.lineas.find((l) => l.tipo === 'serial');
  check('el equipo pasó a "Por liquidar"', serial.estado_unidad, 'Por liquidar');
  ok('★ ya no es candidato', !esCandidato(serial));
  ok('★ y aparece como bloqueado, con motivo visible',
     v.bloqueadas.some((l) => l.tipo === 'serial'));
  ok('   la de cantidad sigue reclamable (quedan 3)',
     v.candidatos.some((l) => l.tipo === 'cantidad' && Number(l.reclamable) === 3));
}

console.log('\n═══ 6. Sin stock que sacar, no hay nada que reclamar ═══');
{
  // El local vende los 3 accesorios que le quedaban.
  await q(`UPDATE atributos_producto SET stock = 0 WHERE id = 2`);
  await q(`UPDATE productos_cantidad SET stock = 0 WHERE id = 2`);
  const v = await verPantalla(envio.id);
  check('★ ya no hay candidatos', v.candidatos.length, 0);
  ok('★ y AHORA sí es cierto que todo se vendió: hay bloqueadas que lo explican',
     v.bloqueadas.length === 2, `${v.bloqueadas.length} bloqueada(s)`);
}

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${pasados} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(72));
process.exit(fallos ? 1 : 0);
