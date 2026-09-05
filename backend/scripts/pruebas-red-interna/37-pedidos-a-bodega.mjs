// ─────────────────────────────────────────────────────────────────────────────
// PEDIDOS INTERNOS — el local le pide a la bodega. Contra un Postgres real.
//
// El circuito de la red interna nació en un solo sentido: la bodega decide,
// despacha, y el local confirma. Esto cierra el otro:
//
//     el local PIDE → la bodega DESPACHA (o cierra con una razón) → el local RECIBE
//
// LO QUE ESTA SUITE SOSTIENE, y que es donde estaría el error caro:
//
//   1. El avance del pedido se DERIVA. Un contador guardado se quedaría
//      mintiendo ante las cuatro cosas que le pueden pasar a una línea ya
//      despachada —anular la remisión, marcarla faltante, devolverla, devolver
//      parte de un lote— y el pedido nunca volvería a pedir lo que no llegó.
//      Las secciones 5, 6 y 7 hacen pasar las cuatro y comprueban que el
//      pendiente REAPARECE solo.
//   2. El catálogo que ve el local NO lleva costos. Es el costo de la BODEGA,
//      justo lo que `red_interna_ocultar_costos` y `costos_solo_admin`
//      esconden, y recortarlo en la pantalla dejaría el dato viajando en el
//      JSON. Sección 2.
//   3. El aislamiento: un local no ve ni toca los pedidos de otro, y la bodega
//      no ve borradores ajenos. Sección 9.
//   4. Nada de esto toca la deuda por su cuenta: el cargo del local sigue
//      naciendo en la RECEPCIÓN y valiendo exactamente lo mismo que valdría sin
//      pedido. Sección 8.
//
// Requiere PGlite (no va en package.json a propósito):
//   npm install --no-save @electric-sql/pglite
//   node scripts/pruebas-red-interna/37-pedidos-a-bodega.mjs
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
                 '20260823_red_interna_cargos_pagables.sql',
                 '20260823_remision_variantes.sql', '20260823_lotes_cantidad.sql',
                 '20260823_valor_acreditado.sql', '20260824_costo_origen_remision.sql',
                 '20260904_pedidos_internos.sql']) {
  await db.exec(readFileSync(path.join(RAIZ, '../migrations', m), 'utf8'));
}

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

// La feature agrega dos columnas a `remisiones` y `lineas_remision`, y el
// repositorio solo las nombra si existen (ver src/config/columnas.js). Aquí sí
// existen, así que se corre la detección de verdad: si esta línea faltara, la
// suite pasaría con el vínculo apagado y no probaría nada.
const columnas = require(path.join(RAIZ, 'src/config/columnas.js'));
await columnas.detectarColumnas();
if (!columnas.hayPedidosInternos()) {
  console.error('✗ la detección de columnas no encontró los pedidos: la migración no se aplicó');
  process.exit(1);
}

const red     = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.service.js'));
const pedidos = require(path.join(RAIZ, 'src/modules/red-interna/redInterna.pedidos.service.js'));

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
function check(nombre, real, esperado) {
  const ok_ = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok_ ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok_ ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`);
  ok_ ? pasados++ : fallos++;
}
function ok(nombre, cond, detalle = '') {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${detalle ? ': ' + detalle : ''}`);
  cond ? pasados++ : fallos++;
}
const falla = async (nombre, fn, esperado) => {
  try { await fn(); ok(nombre, false, 'no lanzó'); }
  catch (e) {
    const texto = `${e.codigo || ''} ${e.message || ''}`.toLowerCase();
    ok(nombre, texto.includes(String(esperado).toLowerCase()), e.message || e.codigo);
  }
};

// ── Escenario: una bodega, dos locales, catálogo con y sin variantes ─────────
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Con Red');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Bodega'),(1,'Local A'),(1,'Local B');
  INSERT INTO usuarios (nombre) VALUES ('Admin bodega'),('Vendedor A'),('Vendedor B');
  INSERT INTO config_negocio VALUES
    (1,'red_interna_activa','1'), (1,'red_interna_bodega_id','1'),
    (1,'variantes_activo','1');
  INSERT INTO lineas_producto (negocio_id, nombre) VALUES (1,'ACCESORIOS');

  -- BODEGA. El costo aquí es el que el local NO puede ver.
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (1,'CORREA 360', 34, 3700, 1, 'unidad'),      -- id 1 (con variantes)
           (1,'CABLE TIPO C', 10, 2000, 1, 'unidad'),    -- id 2
           (1,'VIDRIO AGOTADO', 0, 1500, 1, 'unidad');   -- id 3 (stock 0)
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
    VALUES (1,1,'38MM',15,3700),                          -- id 1
           (1,1,'40MM',19,3700);                          -- id 2

  INSERT INTO productos_serial (sucursal_id, nombre, marca, modelo, linea_id)
    VALUES (1,'IPHONE 13','Apple','128GB',1);             -- id 1
  INSERT INTO seriales (producto_id, imei, costo_compra, vendido, prestado)
    VALUES (1,'111111111111111', 900000, false, false),   -- id 1
           (1,'222222222222222', 900000, false, false),   -- id 2
           (1,'333333333333333', 900000, false, false);   -- id 3

  -- LOCALES: catálogo replicado, sin stock
  INSERT INTO productos_cantidad (sucursal_id, nombre, stock, costo_unitario, linea_id, unidad_medida)
    VALUES (2,'CORREA 360', 0, NULL, 1, 'unidad'),        -- id 4
           (2,'CABLE TIPO C', 0, NULL, 1, 'unidad');      -- id 5
  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, costo_unitario)
    VALUES (4,2,'38MM',0,NULL),                           -- id 3
           (4,2,'40MM',0,NULL);                           -- id 4
  INSERT INTO productos_serial (sucursal_id, nombre, marca, modelo, linea_id)
    VALUES (2,'IPHONE 13','Apple','128GB',1);             -- id 2
`);

const RED = {
  activa: true, bodega_id: 1, modo_precio: 'costo',
  confirmar_recepcion: true, confirmar_remesa: true, ocultar_costos: true,
  pedidos: true,
};
const reqBodega = {
  user: { id: 1, negocio_id: 1, rol: 'admin_negocio' }, sucursal_id: 1, esBodega: true, red: RED,
};
const reqLocalA = {
  user: { id: 2, negocio_id: 1, rol: 'vendedor' }, sucursal_id: 2, esBodega: false, red: RED,
};
const reqLocalB = {
  user: { id: 3, negocio_id: 1, rol: 'vendedor' }, sucursal_id: 3, esBodega: false, red: RED,
};

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. El local pide — y un VENDEDOR puede hacerlo ═══');
// Recibir una remisión ya lo puede hacer un vendedor, y recibir GENERA la deuda.
// Pedir es estrictamente menos poderoso: exigir supervisor aquí sería pedir más
// para lo que menos pesa.

const pedido1 = await pedidos.crear(reqLocalA, {
  notas: 'Reposición del sábado',
  lineas: [
    { tipo: 'cantidad', producto_id: 1, atributo_id: 1, cantidad_pedida: 6 },  // CORREA 38MM
    { tipo: 'cantidad', producto_id: 2, cantidad_pedida: 4 },                  // CABLE
    { tipo: 'serial',   producto_id: 1, cantidad_pedida: 2 },                  // 2 iPhone
    { tipo: 'cantidad', nombre_producto: 'Cargadores tipo C 65W', cantidad_pedida: 3 }, // texto libre
  ],
});

ok('★ un vendedor del local pudo pedir', pedido1.id > 0);
check('nace Enviado (crear y enviar en un paso)', pedido1.estado, 'Enviado');
check('le asignan consecutivo propio', Number(pedido1.numero), 1);
check('unidades pedidas', Number(pedido1.unidades_pedidas), 15);
check('avance', pedido1.avance, 'Sin despachar');

const ficha1 = await pedidos.getPedido(reqLocalA, pedido1.id);
check('4 líneas', ficha1.lineas.length, 4);
check('la línea con variante congela su etiqueta',
  ficha1.lineas[0].nombre_producto, 'CORREA 360 / 38MM');
ok('★ el pedido a TEXTO LIBRE se acepta',
  ficha1.lineas[3].producto_id === null && ficha1.lineas[3].nombre_producto === 'Cargadores tipo C 65W');

await falla('la bodega no se pide a sí misma',
  () => pedidos.crear(reqBodega, { lineas: [{ tipo: 'cantidad', producto_id: 1, cantidad_pedida: 1 }] }),
  'sí misma');
await falla('un pedido vacío se rechaza',
  () => pedidos.crear(reqLocalA, { lineas: [] }), 'al menos un producto');
await falla('cantidad 0 se rechaza',
  () => pedidos.crear(reqLocalA, { lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad_pedida: 0 }] }),
  'al menos 1');
await falla('no se puede pedir un producto que no es de la bodega',
  () => pedidos.crear(reqLocalA, { lineas: [{ tipo: 'cantidad', producto_id: 4, cantidad_pedida: 1 }] }),
  'catálogo de la bodega');
await falla('no se puede colar un atributo de otro producto',
  () => pedidos.crear(reqLocalA, {
    lineas: [{ tipo: 'cantidad', producto_id: 2, atributo_id: 1, cantidad_pedida: 1 }],
  }), 'no pertenece');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. El catálogo del local NO lleva costos ═══');
// El costo de la bodega es exactamente lo que costos_solo_admin y
// red_interna_ocultar_costos esconden. No se recorta al final: no se selecciona.

const catalogo = await pedidos.catalogo(reqLocalA, '');
const json = JSON.stringify(catalogo);
ok('★ ni un costo viaja en el JSON del catálogo',
  !/costo|valor_interno|precio/i.test(json),
  json.slice(0, 120));
ok('lista nodos hoja, no contenedores',
  catalogo.some((c) => c.variante_label === '38MM')
  && !catalogo.some((c) => c.tipo === 'cantidad' && c.nombre === 'CORREA 360' && !c.atributo_id));
ok('★ incluye lo que la bodega tiene AGOTADO (pedir no exige stock)',
  catalogo.some((c) => c.nombre === 'VIDRIO AGOTADO' && c.disponibles === 0));
ok('los seriales se piden por referencia, nunca por IMEI',
  catalogo.some((c) => c.tipo === 'serial' && c.disponibles === 3) && !/imei/i.test(json));
await falla('la bodega no usa este catálogo', () => pedidos.catalogo(reqBodega, ''), 'sí misma');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. La bodega lo ve en su bandeja ═══');

const bandeja = await pedidos.listar(reqBodega, { abiertos: true });
check('un pedido por atender', bandeja.length, 1);
check('sabe de qué local es', bandeja[0].sucursal_nombre, 'Local A');
check('y cuántas unidades faltan', Number(bandeja[0].unidades_pendientes), 15);

const panelBodega = await red.getPanelBodega(reqBodega);
ok('★ el panel de la bodega trae la bandeja de pedidos',
  Array.isArray(panelBodega.pedidos_por_atender) && panelBodega.pedidos_por_atender.length === 1);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. Despachar contra el pedido — la atribución la hace el BACKEND ═══');
// A propósito NO se manda `pedido_linea_id` en ninguna línea: el despacho puede
// salir del modal del pedido, del carrito o del escáner, y las tres tienen que
// atribuir igual. Una pantalla que se olvide del vínculo dejaría el pedido
// pidiendo para siempre algo que ya salió.

const envio1 = await red.despachar(reqBodega, {
  sucursal_destino_id: 2,
  pedido_id: pedido1.id,
  lineas: [
    { tipo: 'cantidad', producto_id: 1, atributo_id: 1, cantidad: 6, valor_interno: 5000 },
    { tipo: 'cantidad', producto_id: 2, cantidad: 4, valor_interno: 2500 },
    { tipo: 'serial', serial_id: 1, valor_interno: 950000 },
  ],
});
check('la remisión queda enlazada al pedido', Number(envio1.pedido_id), pedido1.id);

const lineasEnlazadas = await q(`
  SELECT lr.nombre_producto, lr.pedido_linea_id
  FROM lineas_remision lr WHERE lr.remision_id = $1 ORDER BY lr.id`, [envio1.id]);
ok('★ las 3 líneas quedaron atribuidas solas',
  lineasEnlazadas.every((l) => l.pedido_linea_id != null),
  JSON.stringify(lineasEnlazadas.map((l) => l.pedido_linea_id)));

let f = await pedidos.getPedido(reqBodega, pedido1.id);
check('avance parcial', f.avance, 'Parcial');
check('11 de 15 despachadas', Number(f.unidades_despachadas), 11);
check('la correa quedó completa',    Number(f.lineas[0].pendiente), 0);
check('el cable quedó completo',     Number(f.lineas[1].pendiente), 0);
check('falta 1 de los 2 iPhone',     Number(f.lineas[2].pendiente), 1);
check('el texto libre sigue entero', Number(f.lineas[3].pendiente), 3);
ok('★ el texto libre NO se atribuye solo (nadie sabe qué es)',
  Number(f.lineas[3].despachada) === 0);
check('la ficha lista su remisión', f.remisiones.length, 1);

// El pedido sigue en la bandeja: todavía falta un iPhone y los cargadores.
check('sigue en la bandeja de la bodega',
  (await pedidos.listar(reqBodega, { abiertos: true })).length, 1);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. ANULAR la remisión reabre el pendiente ═══');
// Con un contador guardado, esto se quedaría "11 despachadas" para siempre y el
// local nunca volvería a recibir lo que la bodega canceló.

const envioAnulable = await red.despachar(reqBodega, {
  sucursal_destino_id: 2, pedido_id: pedido1.id,
  lineas: [{ tipo: 'serial', serial_id: 2, valor_interno: 950000 }],
});
f = await pedidos.getPedido(reqBodega, pedido1.id);
check('con el segundo iPhone en camino, el pendiente baja', Number(f.lineas[2].pendiente), 0);

await red.anularRemision(reqBodega, envioAnulable.id);
f = await pedidos.getPedido(reqBodega, pedido1.id);
ok('★ al anular la remisión, el iPhone vuelve a estar pendiente',
  Number(f.lineas[2].pendiente) === 1, `pendiente=${f.lineas[2].pendiente}`);
check('y el avance vuelve a Parcial', f.avance, 'Parcial');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 6. Un FALTANTE al recibir también lo reabre ═══');
// 'Faltante' = nunca entró al cargo: la mercancía se quedó en la bodega y el
// local la sigue necesitando. La bodega manda dos cosas y solo llega una.

const envio2 = await red.despachar(reqBodega, {
  sucursal_destino_id: 2, pedido_id: pedido1.id,
  lineas: [
    { tipo: 'serial',   serial_id: 2, valor_interno: 950000 },
    { tipo: 'cantidad', producto_id: 2, cantidad: 1, valor_interno: 2500 },
  ],
});
const lineasEnvio2 = await q(
  `SELECT id, tipo FROM lineas_remision WHERE remision_id=$1 ORDER BY id`, [envio2.id]);
f = await pedidos.getPedido(reqBodega, pedido1.id);
check('con el iPhone en camino otra vez, no falta ninguno', Number(f.lineas[2].pendiente), 0);

// Solo llega el cable: el equipo se reporta como no llegado.
await red.recibir(reqLocalA, envio2.id, {
  lineas_recibidas: [Number(lineasEnvio2.find((l) => l.tipo === 'cantidad').id)],
});
check('la línea del equipo quedó Faltante',
  (await q(`SELECT estado_linea FROM lineas_remision WHERE id=$1`,
    [lineasEnvio2.find((l) => l.tipo === 'serial').id]))[0].estado_linea,
  'Faltante');
f = await pedidos.getPedido(reqBodega, pedido1.id);
ok('★ lo que no llegó vuelve a contar como pendiente',
  Number(f.lineas[2].pendiente) === 1, `pendiente=${f.lineas[2].pendiente}`);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. Devolver lo recibido reabre lo devuelto ═══');
// El serial se marca 'Devuelta'; la mercancía por cantidad consume lotes con
// `cantidad_devuelta`. El avance tiene que entender las DOS formas.

await red.recibir(reqLocalA, envio1.id, {});   // recibe todo el primer envío
f = await pedidos.getPedido(reqBodega, pedido1.id);
check('recibir no cambia el avance (ya contaba en tránsito)', Number(f.unidades_despachadas), 11);

// El local devuelve 2 de las 6 correas 38MM.
const devol = await red.devolver(reqLocalA, {
  lineas: [{ tipo: 'cantidad', producto_id: 4, atributo_id: 3, cantidad: 2 }],
  motivo: 'devolucion',
});
await red.confirmarDevolucion(reqBodega, devol.id, {});
f = await pedidos.getPedido(reqBodega, pedido1.id);
ok('★ devolver 2 correas deja 2 pendientes en esa línea',
  Number(f.lineas[0].pendiente) === 2, `pendiente=${f.lineas[0].pendiente}`);
check('y el avance sigue siendo Parcial', f.avance, 'Parcial');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 8. La CUENTA no se entera de que hubo un pedido ═══');
// El pedido no toca inventario, ni caja, ni deuda. El cargo del local vale
// exactamente lo mismo que valdría sin pedido: 6×5000 + 4×2500 + 950000, menos
// las 2 correas devueltas.

// Envío 1 recibido entero (6 correas + 4 cables + 1 equipo), envío 2 solo el
// cable que sí llegó, menos las 2 correas devueltas. Ni un peso del pedido.
const totales = (await red.getEstadoLocal(1, 2)).totales;
check('deuda del local',
  Math.round(Number(totales.deuda_total)),
  (6 * 5000 + 4 * 2500 + 950000) + 2500 - 2 * 5000);
check('stock de la correa 38MM en el local',
  Number((await q(`SELECT stock FROM atributos_producto WHERE id=3`))[0].stock), 4);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 9. Aislamiento: cada quien ve lo suyo ═══');

const pedidoB = await pedidos.crear(reqLocalB, {
  lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad_pedida: 5 }],
});
check('el Local A solo ve el suyo',
  (await pedidos.listar(reqLocalA, {})).map((p) => Number(p.sucursal_id)), [2]);
check('el Local B solo ve el suyo',
  (await pedidos.listar(reqLocalB, {})).map((p) => Number(p.sucursal_id)), [3]);
check('la bodega ve los dos',
  (await pedidos.listar(reqBodega, {})).length, 2);

await falla('el Local A no abre el pedido del B',
  () => pedidos.getPedido(reqLocalA, pedidoB.id), 'no es de tu sucursal');
await falla('el Local A no anula el pedido del B',
  () => pedidos.anular(reqLocalA, pedidoB.id, {}), 'no es de tu sucursal');
await falla('un local no cierra pedidos (eso es de la bodega)',
  () => pedidos.cerrar(reqLocalA, pedido1.id, {}), 'solo la bodega');
await falla('la bodega no puede despachar el pedido del B al local A',
  () => red.despachar(reqBodega, {
    sucursal_destino_id: 2, pedido_id: pedidoB.id,
    lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad: 1, valor_interno: 2500 }],
  }), 'otro local');

// ── El BORRADOR es un papel a medio escribir ────────────────────────────────
const borrador = await pedidos.crear(reqLocalA, {
  enviar: false,
  lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad_pedida: 1 }],
});
check('nace Borrador', borrador.estado, 'Borrador');
ok('★ la bodega NO ve borradores ajenos',
  !(await pedidos.listar(reqBodega, {})).some((p) => Number(p.id) === Number(borrador.id)));
await falla('ni los abre', () => pedidos.getPedido(reqBodega, borrador.id), 'no encontrado');
ok('su autor sí lo ve',
  (await pedidos.listar(reqLocalA, {})).some((p) => Number(p.id) === Number(borrador.id)));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 10. Editar, enviar, anular y cerrar ═══');

await pedidos.editar(reqLocalA, borrador.id, {
  notas: 'Ahora sí',
  lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad_pedida: 7 }],
});
let b = await pedidos.getPedido(reqLocalA, borrador.id);
check('el borrador se editó', Number(b.unidades_pedidas), 7);

await pedidos.enviar(reqLocalA, borrador.id);
b = await pedidos.getPedido(reqLocalA, borrador.id);
check('y se envió', b.estado, 'Enviado');
await falla('★ un pedido ya enviado NO se edita',
  () => pedidos.editar(reqLocalA, borrador.id, { lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad_pedida: 1 }] }),
  'no se edita');

// Anular: solo mientras no haya salido nada.
await pedidos.anular(reqLocalA, borrador.id, { motivo: 'Ya no hace falta' });
check('anulado', (await pedidos.getPedido(reqLocalA, borrador.id)).estado, 'Anulado');
await falla('★ un pedido con mercancía ya despachada NO se anula',
  () => pedidos.anular(reqLocalA, pedido1.id, {}), 'ya despachó');

// Cerrar: la bodega dice por qué. Sin la razón, cerrar se ve igual que ignorar.
await pedidos.cerrar(reqBodega, pedido1.id, { respuesta: 'Sin iPhone hasta el lunes' });
f = await pedidos.getPedido(reqLocalA, pedido1.id);
check('cerrado', f.estado, 'Cerrado');
check('★ con la razón visible para el local', f.respuesta, 'Sin iPhone hasta el lunes');
check('y sale de la bandeja', (await pedidos.listar(reqBodega, { abiertos: true }))
  .some((p) => Number(p.id) === Number(pedido1.id)), false);

await pedidos.reabrir(reqBodega, pedido1.id);
f = await pedidos.getPedido(reqBodega, pedido1.id);
check('todo error tiene salida: se reabre', f.estado, 'Enviado');
ok('la razón del cierre queda como historia', f.respuesta === 'Sin iPhone hasta el lunes');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 11. Despachar SIN pedido sigue funcionando igual ═══');
// Es el único flujo que existe hoy en los 28 negocios: no puede haber cambiado.

const suelto = await red.despachar(reqBodega, {
  sucursal_destino_id: 3,
  lineas: [{ tipo: 'cantidad', producto_id: 2, cantidad: 1, valor_interno: 2500 }],
});
check('la remisión no cuelga de ningún pedido', suelto.pedido_id, null);
check('y sus líneas tampoco',
  (await q(`SELECT pedido_linea_id FROM lineas_remision WHERE remision_id=$1`, [suelto.id]))[0].pedido_linea_id,
  null);
await red.recibir(reqLocalB, suelto.id, {});
check('el circuito de siempre cierra igual',
  Math.round(Number((await red.getEstadoLocal(1, 3)).totales.deuda_total)), 2500);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 12. Con la función APAGADA, el módulo se comporta como antes ═══');
// `red_interna_pedidos = '0'`. El panel no puede reventar ni traer pedidos.

const reqApagado = { ...reqBodega, red: { ...RED, pedidos: false } };
const panelApagado = await red.getPanelBodega(reqApagado);
check('la bandeja de pedidos viene en null', panelApagado.pedidos_por_atender, null);
ok('y el resto del panel sigue completo',
  Array.isArray(panelApagado.locales) && panelApagado.totales != null);

const reqLocalApagado = { ...reqLocalA, red: { ...RED, pedidos: false } };
check('el panel del local tampoco los trae',
  (await red.getPanelLocal(reqLocalApagado)).pedidos, null);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 13. El .sql y la copia del runner no se separaron ═══');
// El `.sql` es lo que se lee; la copia inline de `src/config/migrations.js` es
// lo que CORRE en producción. Escribir uno y olvidar el otro deja el despliegue
// con el código nuevo contra una base vieja — ya pasó con `abonos_remision`.
// Se comparan sentencia por sentencia, restricciones e índices incluidos: "el
// runner corre sin error" no basta, porque un CHECK que dijera otra cosa se ve
// idéntico a simple vista y solo deja entrar basura en producción.

const norm = (t) => t
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  .replace(/\s+/g, ' ').toLowerCase();
const sentencias = (t) => norm(t).split(';').map((s) => s.trim())
  .filter((s) => /^(create|alter)/.test(s));

const archivoSql = readFileSync(path.join(RAIZ, '../migrations/20260904_pedidos_internos.sql'), 'utf8');
const runner = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8')
  // El bloque de este `migrar()`, sin la etiqueta ni el cierre del literal.
  .split("'Pedidos internos a la bodega'")[1].split('`);')[0].replace(/^[^`]*`/, '');

const delSql    = sentencias(archivoSql);
const delRunner = sentencias(runner);
check('el .sql y el runner traen el mismo número de sentencias',
  [delSql.length, delRunner.length], [11, 11]);
const faltan = delSql.filter((s) => !delRunner.includes(s));
const sobran = delRunner.filter((s) => !delSql.includes(s));
ok('★ ninguna sentencia del .sql falta en el runner', faltan.length === 0,
  faltan.map((s) => s.slice(0, 90)).join(' | '));
ok('★ el runner no trae ninguna que el .sql no tenga', sobran.length === 0,
  sobran.map((s) => s.slice(0, 90)).join(' | '));

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${fallos === 0 ? '✅' : '❌'} ${pasados} verificaciones pasadas, ${fallos} fallidas\n`);
process.exit(fallos === 0 ? 0 : 1);
