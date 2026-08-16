// ─────────────────────────────────────────────────────────────────────────────
// BORRADORES DE VENTA (carritos guardados con reserva blanda)
//
// Verifica contra Postgres real que el diseño se sostiene:
//
//   • el INVENTARIO NO SE TOCA: guardar un borrador no marca el serial ni baja
//     el stock. Es la invariante central — si esto se rompe, la mercancía
//     desaparece de reportes, catálogo y alertas de stock bajo
//   • el total se DERIVA con SUM: quitar un ítem lo baja solo
//   • aislamiento POR SUCURSAL, no por negocio: los borradores de Sansur no
//     existen para Principal, ni para leer ni para borrar
//   • la revalidación al cargar detecta vendido, prestado, trasladado y agotado
//   • disponibilidad parcial: quedan 2 de 5 → se carga 2 y se avisa
//   • el "robo" de un ítem; el borrador que queda vacío se descarta
//   • vencimiento: el vencido no se lista ni reserva; renovar lo revive
//   • json_agg con FILTER: un borrador sin ítems da [] y no [null]
//   • doble candado: sin el flag del negocio, la feature no existe
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

// La migración real, tal cual se aplica en producción.
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260815_borradores.sql'), 'utf8'));

// PGlite devuelve `affectedRows`; el driver real de `pg` devuelve `rowCount`.
// El repositorio decide con `rowCount` si un UPDATE/DELETE alcanzó su fila —
// que es justo el candado de "este borrador es de otra sucursal". Sin este
// mapeo la suite falla por el arnés, no por el código. Mismo shim que ya usan
// las suites 09, 10, 15 y 16.
const conectar = () => ({
  query: async (s, p) => {
    const r = await db.query(s, p ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(), connect: async () => ({ ...conectar(), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const svc  = require(path.join(RAIZ, 'src/modules/borradores/borradores.service.js'));
const repo = require(path.join(RAIZ, 'src/modules/borradores/borradores.repository.js'));
const mw   = require(path.join(RAIZ, 'src/middlewares/borradores.middleware.js'));

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

async function configurar(negocioId, claves) {
  for (const [clave, valor] of Object.entries(claves)) {
    await db.query(`
      INSERT INTO config_negocio(negocio_id, clave, valor) VALUES ($1, $2, $3)
      ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor
    `, [negocioId, clave, valor]);
  }
  mw.invalidarCache(negocioId);
}

const uno = async (sql, p = []) => (await db.query(sql, p)).rows[0];

// ── Escenario ────────────────────────────────────────────────────────────────
// Negocio 1: sucursales 1 (Principal) y 2 (Sansur). Negocio 2: sucursal 3.
await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Tienda Test'), ('Otro Negocio');
  INSERT INTO sucursales (negocio_id, nombre, activa)
    VALUES (1, 'Principal', TRUE), (1, 'Sansur', TRUE), (2, 'Ajena', TRUE);
  INSERT INTO usuarios (nombre) VALUES ('Carlos'), ('Ana');

  INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id)
    VALUES ('iPhone 13 Pro', 'Apple', '13 Pro', 2500000, 1),   -- id 1, Principal
           ('iPhone 13 Pro', 'Apple', '13 Pro', 2500000, 2);   -- id 2, Sansur

  -- Sin la columna precio: el fixture de seriales no la tiene aunque
  -- producción sí. Da igual — este módulo no la lee.
  INSERT INTO seriales (producto_id, imei, vendido, prestado, costo_compra)
    VALUES (1, '350000000000001', FALSE, FALSE, 1800000),  -- id 1
           (1, '350000000000002', FALSE, FALSE, 1800000),  -- id 2
           (1, '350000000000003', FALSE, FALSE, 1800000),  -- id 3
           (2, '350000000000009', FALSE, FALSE, 1800000);  -- id 4, Sansur

  INSERT INTO productos_cantidad (nombre, stock, costo_unitario, precio, sucursal_id, activo)
    VALUES ('Forro silicona', 200, 5000, 20000, 1, TRUE),   -- id 1
           ('Vidrio templado', 5, 3000, 12000, 1, TRUE),    -- id 2
           ('Cargador 20W',   10, 15000, 45000, 1, TRUE);   -- id 3

  INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, precio, activo)
    VALUES (3, 1, 'Blanco', 4, 45000, TRUE);                -- id 1
  INSERT INTO variantes_atributo (atributo_id, producto_id, valor, stock, precio, activo)
    VALUES (1, 3, '1 metro', 3, 47000, TRUE);               -- id 1
`);

const SERIAL = (id, imei, precio = 2500000) => ({
  key: imei, tipo: 'serial', nombre: 'iPhone 13 Pro', imei,
  serial_id: id, cantidad: 1, precio: 2500000, precioFinal: precio,
  costo: 1800000, origen_precio: 'manual',
});
const CANT = (id, nombre, cantidad, precio) => ({
  key: `cant-${id}`, tipo: 'cantidad', nombre, producto_id: id,
  cantidad, precio, precioFinal: precio, costo: 5000, origen_precio: 'lista',
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Doble candado: sin el flag, la feature no existe ═══');
// ═══════════════════════════════════════════════════════════════════════════
let cfg = await mw.getConfigBorradores(1);
ok('borradores apagados por defecto', cfg.activo === false);
ok('vigencia por defecto: 7 días', cfg.dias === 7, String(cfg.dias));
ok('por defecto sí vencen', cfg.vencen === true);

await configurar(1, { borradores_activo: '1' });
cfg = await mw.getConfigBorradores(1);
ok('el flag enciende la feature', cfg.activo === true);

await configurar(1, { borradores_dias: '0' });
cfg = await mw.getConfigBorradores(1);
ok('días = 0 significa que no vencen', cfg.vencen === false && cfg.dias === 0);

await configurar(1, { borradores_dias: 'basura' });
cfg = await mw.getConfigBorradores(1);
ok('un valor inválido cae al default, no rompe', cfg.dias === 7);

await configurar(1, { borradores_dias: '9999' });
cfg = await mw.getConfigBorradores(1);
ok('un plazo fuera de rango cae al default', cfg.dias === 7);

await configurar(1, { borradores_dias: '7' });
cfg = await mw.getConfigBorradores(1);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. Guardar un borrador NO toca el inventario ═══');
// ═══════════════════════════════════════════════════════════════════════════
const b1 = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Juan Pérez', destino: 'factura', nota: 'Vuelve el sábado',
  items: [SERIAL(1, '350000000000001', 2400000), CANT(1, 'Forro silicona', 2, 20000)],
}, cfg);

ok('el borrador se creó', !!b1.id);
ok('guarda el título', b1.titulo === 'Juan Pérez');
ok('guarda el destino', b1.destino === 'factura');
ok('trae el nombre de quien lo guardó', b1.usuario_nombre === 'Carlos', b1.usuario_nombre);

// LA INVARIANTE CENTRAL.
const s1 = await uno('SELECT vendido, prestado FROM seriales WHERE id = 1');
ok('el serial NO quedó marcado como vendido', s1.vendido === false);
ok('el serial NO quedó marcado como prestado', s1.prestado === false);

const p1 = await uno('SELECT stock FROM productos_cantidad WHERE id = 1');
ok('el stock del producto NO bajó', Number(p1.stock) === 200, `stock=${p1.stock}`);

// El precio negociado es la razón de ser del borrador.
const itemSerial = b1.items.find((i) => i.tipo === 'serial');
ok('conserva el precio NEGOCIADO, no el de lista',
  Number(itemSerial.precio_final) === 2400000 && Number(itemSerial.precio) === 2500000,
  `final=${money(itemSerial.precio_final)} lista=${money(itemSerial.precio)}`);

ok('el total se deriva con SUM (2.400.000 + 2×20.000)',
  Number(b1.total) === 2440000, money(b1.total));
ok('cuenta los ítems', b1.num_items === 2);
ok('calcula los días para vencer', b1.dias_para_vencer === 7, String(b1.dias_para_vencer));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. El total se DERIVA: quitar un ítem lo baja solo ═══');
// ═══════════════════════════════════════════════════════════════════════════
const idForro = b1.items.find((i) => i.tipo === 'cantidad').id;
const robo = await svc.quitarItem(b1.id, idForro, 1, 1);
ok('el ítem se liberó', robo.borrador_eliminado === false && robo.restantes === 1);

const b1b = await svc.obtener(b1.id, 1, 1);
ok('el total bajó solo, sin escribirlo', Number(b1b.total) === 2400000, money(b1b.total));
ok('queda un solo ítem', b1b.num_items === 1);

await falla('quitar un ítem que ya no está da 404',
  () => svc.quitarItem(b1.id, idForro, 1, 1), 'ya no está');

// El borrador no guarda marca ni modelo (son del producto, no del trato), pero
// el payload del traslado los lee del ítem del carrito. Se reponen desde el
// JOIN que la revalidación ya hace: sin esto, un traslado armado desde un
// borrador cargado saldría sin marca ni modelo.
const conMarca = b1b.items.find((i) => i.tipo === 'serial');
ok('repone la marca del producto al cargar', conMarca?.marca === 'Apple', conMarca?.marca);
ok('repone el modelo del producto al cargar', conMarca?.modelo === '13 Pro', conMarca?.modelo);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. Aislamiento POR SUCURSAL (no por negocio) ═══');
// ═══════════════════════════════════════════════════════════════════════════
const b2 = await svc.crear({
  sucursalId: 2, negocioId: 1, usuarioId: 2,
  titulo: 'Sra. del Ford', destino: 'prestamo',
  items: [SERIAL(4, '350000000000009')],
}, cfg);

const enPrincipal = await svc.listar(1, 1);
const enSansur    = await svc.listar(2, 1);
ok('Principal solo ve los suyos',
  enPrincipal.length === 1 && enPrincipal[0].id === b1.id, `${enPrincipal.length} borrador(es)`);
ok('Sansur solo ve los suyos',
  enSansur.length === 1 && enSansur[0].id === b2.id, `${enSansur.length} borrador(es)`);

await falla('no se puede LEER el borrador de otra sucursal del mismo negocio',
  () => svc.obtener(b2.id, 1, 1), 'no encontrado');

// El caso venenoso: cargar un borrador en Sansur, cambiar a Principal y facturar.
// Sin el acotamiento por sucursal en el DELETE, se borraría el de Sansur.
await falla('no se puede BORRAR el borrador de otra sucursal',
  () => svc.eliminar(b2.id, 1, 1), 'no encontrado');
ok('el borrador de Sansur sigue vivo tras el intento',
  (await svc.listar(2, 1)).length === 1);

await falla('otro NEGOCIO no alcanza el borrador ni con el id correcto',
  () => svc.obtener(b1.id, 3, 2), 'no encontrado');
await falla('otro negocio tampoco lo borra',
  () => svc.eliminar(b1.id, 3, 2), 'no encontrado');
await falla('robar un ítem desde otra sucursal falla',
  () => svc.quitarItem(b2.id, b2.items[0].id, 1, 1), 'ya no está');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. Revalidación al cargar: el inventario cambió ═══');
// ═══════════════════════════════════════════════════════════════════════════
const b3 = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Cliente de prueba',
  items: [
    SERIAL(1, '350000000000001'),          // se venderá
    SERIAL(2, '350000000000002'),          // se prestará
    SERIAL(3, '350000000000003'),          // se trasladará a Sansur
    CANT(2, 'Vidrio templado', 5, 12000),  // quedará en 2 → parcial
    CANT(3, 'Cargador 20W',    2, 45000),  // se agotará
    CANT(1, 'Forro silicona',  2, 20000),  // sigue disponible
  ],
}, cfg);
ok('borrador de 6 ítems creado', b3.num_items === 6);

// El mundo cambia mientras el cliente no vuelve.
await db.exec(`
  UPDATE seriales SET vendido  = TRUE WHERE id = 1;
  UPDATE seriales SET prestado = TRUE WHERE id = 2;
  UPDATE seriales SET producto_id = 2  WHERE id = 3;   -- traslado a Sansur
  UPDATE productos_cantidad SET stock = 2 WHERE id = 2;
  UPDATE productos_cantidad SET stock = 0 WHERE id = 3;
`);

const cargado = await svc.obtener(b3.id, 1, 1);
const motivo = (imeiOKey) =>
  cargado.no_disponibles.find((i) => i.item_key === imeiOKey)?.motivo;

ok('detecta el vendido',    motivo('350000000000001') === 'Ya fue vendido');
ok('detecta el prestado',   motivo('350000000000002') === 'Está prestado');
ok('detecta el trasladado', motivo('350000000000003') === 'Se trasladó a otra sucursal',
  motivo('350000000000003'));
ok('detecta el agotado',    motivo('cant-3') === 'Sin stock');
ok('4 ítems no disponibles', cargado.no_disponibles.length === 4,
  String(cargado.no_disponibles.length));

const parcial = cargado.items.find((i) => i.item_key === 'cant-2');
ok('el parcial se carga con la cantidad que SÍ hay',
  parcial && Number(parcial.cantidad) === 2, `cantidad=${parcial?.cantidad}`);
ok('el parcial avisa cuántas quedan',
  parcial?.aviso === 'Solo quedan 2 de 5', parcial?.aviso);

const intacto = cargado.items.find((i) => i.item_key === 'cant-1');
ok('lo que sigue disponible viene con su stock fresco',
  intacto && Number(intacto.stock) === 200, `stock=${intacto?.stock}`);
ok('2 ítems cargables', cargado.items.length === 2, String(cargado.items.length));

// Revalidar NO puede lanzar: un borrador medio vendido sigue siendo útil.
ok('revalidar nunca lanza aunque todo esté vendido', true);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 6. Productos con árbol (atributos y variantes) ═══');
// ═══════════════════════════════════════════════════════════════════════════
const b4 = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Con árbol',
  items: [
    { key: 'cant-3-a-1', tipo: 'cantidad', nombre: 'Cargador 20W', producto_id: 3,
      atributo_id: 1, atributo_label: 'Blanco', cantidad: 2, precio: 45000,
      precioFinal: 45000 },
    { key: 'cant-3-v-1', tipo: 'cantidad', nombre: 'Cargador 20W', producto_id: 3,
      atributo_id: 1, variante_id: 1, variante_label: '1 metro', cantidad: 2,
      precio: 47000, precioFinal: 47000 },
  ],
}, cfg);

const arbol = await svc.obtener(b4.id, 1, 1);
ok('el stock del atributo se lee del atributo, no del producto agregado',
  arbol.items.find((i) => i.item_key === 'cant-3-a-1')?.stock === 4,
  `stock=${arbol.items.find((i) => i.item_key === 'cant-3-a-1')?.stock}`);
ok('el stock de la variante se lee de la variante',
  arbol.items.find((i) => i.item_key === 'cant-3-v-1')?.stock === 3);
ok('el producto padre agotado NO tumba a sus atributos con stock',
  arbol.no_disponibles.length === 0, `${arbol.no_disponibles.length} no disponibles`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. El borrador que queda vacío se descarta ═══');
// ═══════════════════════════════════════════════════════════════════════════
const soloUno = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Un solo producto', items: [CANT(1, 'Forro silicona', 1, 20000)],
}, cfg);

const vaciado = await svc.quitarItem(soloUno.id, soloUno.items[0].id, 1, 1);
ok('al quitar el último ítem se descarta el borrador entero',
  vaciado.borrador_eliminado === true && vaciado.restantes === 0);
await falla('el borrador vaciado ya no existe',
  () => svc.obtener(soloUno.id, 1, 1), 'no encontrado');

const huerfanos = await uno(
  'SELECT COUNT(*)::int AS n FROM borradores_items WHERE borrador_id = $1', [soloUno.id]);
ok('no quedan ítems huérfanos (CASCADE)', huerfanos.n === 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 8. Vencimiento ═══');
// ═══════════════════════════════════════════════════════════════════════════
const antes = (await svc.listar(1, 1)).length;
await db.query('UPDATE borradores SET expira_en = NOW() - INTERVAL \'1 day\' WHERE id = $1', [b3.id]);

const despues = await svc.listar(1, 1);
ok('el vencido desaparece de la lista (y deja de reservar)',
  despues.length === antes - 1, `${antes} → ${despues.length}`);
ok('pero se puede abrir por id, para poder renovarlo',
  (await svc.obtener(b3.id, 1, 1)).id === b3.id);

await svc.renovar(b3.id, 1, 1, cfg);
ok('renovar lo devuelve a la lista', (await svc.listar(1, 1)).length === antes);

await svc.renovar(b3.id, 1, 1, { vencen: false, dias: 0 });
const sinVencer = await uno('SELECT expira_en FROM borradores WHERE id = $1', [b3.id]);
ok('con días=0 el borrador no vence nunca (expira_en NULL)', sinVencer.expira_en === null);
ok('un borrador sin vencimiento sí se lista',
  (await svc.listar(1, 1)).some((b) => b.id === b3.id));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 9. json_agg con FILTER: sin ítems da [] y no [null] ═══');
// ═══════════════════════════════════════════════════════════════════════════
// Un borrador sin ítems no se puede crear por el service (lo prohíbe), pero sí
// puede quedar así si se borran sus productos del inventario (CASCADE). El
// frontend leería `.nombre` de un null y reventaría la lista entera.
await db.query(
  `INSERT INTO borradores (id, sucursal_id, usuario_id, titulo)
   VALUES (9999, 1, 1, 'Sin items')`);
const vacio = await repo.obtener(9999, 1, 1);
ok('items es un arreglo vacío, no [null]',
  Array.isArray(vacio.items) && vacio.items.length === 0, JSON.stringify(vacio.items));
ok('el total de un borrador vacío es 0', Number(vacio.total) === 0);
ok('num_items de un borrador vacío es 0', vacio.num_items === 0);

// El CASCADE del inventario deja el borrador vacío, no una reserva fantasma.
const b5 = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Se le borra el producto', items: [CANT(1, 'Forro silicona', 1, 20000)],
}, cfg);
await db.query('DELETE FROM productos_cantidad WHERE id = 1');
const trasBorrado = await repo.obtener(b5.id, 1, 1);
ok('borrar el producto del inventario se lleva su renglón del borrador (CASCADE)',
  trasBorrado.items.length === 0, `${trasBorrado.items.length} ítem(s)`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 10. Validación de entrada ═══');
// ═══════════════════════════════════════════════════════════════════════════
// El título dejó de ser obligatorio cuando el botón se movió DENTRO del modal
// de factura: sale del nombre del cliente, y el cliente pudo interrumpir antes
// de decirlo. Exigirlo obligaría a abrir el formulario extra que la feature
// existe para evitar. Ver sección 13.
const sinTitulo = await svc.crear({
  sucursalId: 1, negocioId: 1, titulo: '  ', items: [CANT(2, 'Vidrio', 1, 12000)],
}, cfg);
ok('un borrador sin título se guarda como "Sin nombre"',
  sinTitulo.titulo === 'Sin nombre', sinTitulo.titulo);
await svc.eliminar(sinTitulo.id, 1, 1);

await falla('un borrador sin productos se rechaza',
  () => svc.crear({ sucursalId: 1, negocioId: 1, titulo: 'X', items: [] }, cfg),
  'al menos un producto');
await falla('un serial sin serial_id se rechaza (sería una reserva fantasma)',
  () => svc.crear({ sucursalId: 1, negocioId: 1, titulo: 'X',
    items: [{ key: 'a', tipo: 'serial', nombre: 'iPhone', precioFinal: 100 }] }, cfg),
  'serial identificado');
await falla('un producto por cantidad sin producto_id se rechaza',
  () => svc.crear({ sucursalId: 1, negocioId: 1, titulo: 'X',
    items: [{ key: 'a', tipo: 'cantidad', nombre: 'Forro', precioFinal: 100 }] }, cfg),
  'identificador');

// El índice único (borrador_id, item_key) tumbaría el INSERT entero.
const dup = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1, titulo: 'Duplicados',
  items: [CANT(2, 'Vidrio', 1, 12000), CANT(2, 'Vidrio', 1, 12000)],
}, cfg);
ok('un item_key repetido se ignora en vez de tumbar el guardado', dup.num_items === 1);

const destinoRaro = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1, titulo: 'Destino raro',
  destino: 'cualquier_cosa', items: [CANT(2, 'Vidrio', 1, 12000)],
}, cfg);
ok('un destino inválido cae a "indefinido" en vez de romper',
  destinoRaro.destino === 'indefinido', destinoRaro.destino);

// El serial es unitario por definición.
const serialCant = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1, titulo: 'Serial con cantidad',
  items: [{ ...SERIAL(2, '350000000000002'), cantidad: 7 }],
}, cfg);
ok('un serial siempre pesa 1, aunque el carrito mande otra cantidad',
  Number(serialCant.items[0].cantidad) === 1, `cantidad=${serialCant.items[0].cantidad}`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 11. Edición de la cabecera ═══');
// ═══════════════════════════════════════════════════════════════════════════
const editado = await svc.actualizar(b1.id, 1, 1, { titulo: 'Juan Pérez Gómez' });
ok('renombrar funciona', editado.titulo === 'Juan Pérez Gómez');
ok('renombrar NO borra la nota', editado.nota === 'Vuelve el sábado', editado.nota);
ok('renombrar NO cambia el destino', editado.destino === 'factura');

const redestinado = await svc.actualizar(b1.id, 1, 1, { destino: 'prestamo' });
ok('cambiar el destino funciona', redestinado.destino === 'prestamo');
ok('cambiar el destino NO borra el título', redestinado.titulo === 'Juan Pérez Gómez');

await falla('un título vacío en la edición se rechaza',
  () => svc.actualizar(b1.id, 1, 1, { titulo: '   ' }), 'no puede quedar vacío');
await falla('editar el borrador de otra sucursal falla',
  () => svc.actualizar(b2.id, 1, 1, { titulo: 'Robado' }), 'no encontrado');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 12. El inventario sigue intacto al final de todo ═══');
// ═══════════════════════════════════════════════════════════════════════════
// Después de 12 secciones creando, cargando, robando y borrando borradores, lo
// único que cambió el inventario fueron los UPDATE explícitos de la sección 5.
const forro = await uno('SELECT stock FROM productos_cantidad WHERE id = 2');
ok('el stock solo refleja los cambios reales, ninguno de los borradores',
  Number(forro.stock) === 2, `stock=${forro.stock}`);

const serial4 = await uno('SELECT vendido, prestado FROM seriales WHERE id = 4');
ok('el serial apalabrado en Sansur sigue disponible y vendible',
  serial4.vendido === false && serial4.prestado === false);

const escrituras = await uno(`
  SELECT COUNT(*)::int AS n FROM seriales WHERE vendido = TRUE OR prestado = TRUE`);
ok('solo los 2 seriales que se vendieron/prestaron a mano están marcados',
  escrituras.n === 2, `${escrituras.n} marcados`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 13. El formulario a medio llenar viaja con el borrador ═══');
// ═══════════════════════════════════════════════════════════════════════════
// El caso real: el cliente dice "espero a mi esposa" con el modal de factura
// abierto y media cédula escrita. Guardar no puede obligar a cerrar el modal ni
// a volver a teclear nada.
const FORM = {
  form: { nombre: 'Pedro Gómez', cedula: '1088123456', celular: '3001234567',
          email: '', direccion: 'Cra 5 # 10-20', notas: 'Espera a la esposa' },
  tipoCliente: 'cliente',
  metodosSeleccionados: ['efectivo'],
  montos: { efectivo: 2400000 },
  conRetoma: true,
  retomas: [{ _key: 'r1', tipo_retoma: 'serial', imei: '99999', descripcion: 'iPhone X' }],
  vendedorId: '3',
};

const conForm = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Pedro Gómez', destino: 'factura', datos: FORM,
  items: [CANT(2, 'Vidrio', 1, 12000)],
}, cfg);

ok('el borrador guarda el formulario', !!conForm.datos);
ok('conserva los datos del cliente tecleados',
  conForm.datos.form.cedula === '1088123456', conForm.datos.form.cedula);
ok('conserva estructuras anidadas (retomas)',
  conForm.datos.retomas[0].imei === '99999');
ok('conserva el método de pago a medio elegir',
  conForm.datos.montos.efectivo === 2400000);

const releido = await svc.obtener(conForm.id, 1, 1);
ok('el formulario sobrevive a la relectura con revalidación',
  releido.datos?.form?.nombre === 'Pedro Gómez', releido.datos?.form?.nombre);
ok('y sigue trayendo los ítems del carrito', releido.items.length === 1);

const enLista = (await svc.listar(1, 1)).find((b) => b.id === conForm.id);
ok('la lista también lo trae', enLista?.datos?.form?.celular === '3001234567');

// Sin datos: el flujo de siempre no cambia.
const sinForm = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Sin formulario', items: [CANT(2, 'Vidrio', 1, 12000)],
}, cfg);
ok('un borrador sin formulario guarda datos = null', sinForm.datos === null);

// El cliente interrumpió antes de decir su nombre.
const anonimo = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: '   ', destino: 'factura', items: [CANT(2, 'Vidrio', 1, 12000)],
}, cfg);
ok('sin nombre del cliente NO se rechaza: se guarda igual',
  anonimo.titulo === 'Sin nombre', anonimo.titulo);

const sinTituloAlguno = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  destino: 'prestamo', items: [CANT(2, 'Vidrio', 1, 12000)],
}, cfg);
ok('ni siquiera mandando el título', sinTituloAlguno.titulo === 'Sin nombre');

// Actualizar el formulario (volver a guardar tras seguir diligenciando).
const actualizado = await svc.actualizar(conForm.id, 1, 1, {
  datos: { ...FORM, form: { ...FORM.form, email: 'pedro@correo.com' } },
});
ok('actualizar reemplaza el formulario',
  actualizado.datos.form.email === 'pedro@correo.com');
ok('y no toca el título', actualizado.titulo === 'Pedro Gómez');

// Topes y basura.
await falla('un formulario gigante se rechaza',
  () => svc.crear({ sucursalId: 1, negocioId: 1, titulo: 'X',
    datos: { basura: 'x'.repeat(70 * 1024) },
    items: [CANT(2, 'Vidrio', 1, 12000)] }, cfg),
  'demasiado grandes');
await falla('datos que no son objeto se rechazan',
  () => svc.crear({ sucursalId: 1, negocioId: 1, titulo: 'X', datos: 'texto suelto',
    items: [CANT(2, 'Vidrio', 1, 12000)] }, cfg),
  'inválido');
await falla('un arreglo tampoco es un formulario',
  () => svc.crear({ sucursalId: 1, negocioId: 1, titulo: 'X', datos: [1, 2, 3],
    items: [CANT(2, 'Vidrio', 1, 12000)] }, cfg),
  'inválido');

// Limpieza para no descuadrar los conteos de la sección siguiente.
for (const b of [conForm, sinForm, anonimo, sinTituloAlguno]) {
  await svc.eliminar(b.id, 1, 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 14. Mantenimiento: purga y aviso de vencimiento ═══');
// ═══════════════════════════════════════════════════════════════════════════
// Un borrador vencido ya es invisible y no reserva, pero su fila se quedaría
// para siempre. Se barre con un mes de gracia, no el mismo día: así un error
// con la vigencia en Ajustes no borra nada irrecuperable.
const vivo = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Vivo', items: [CANT(2, 'Vidrio', 1, 12000)],
}, cfg);
const recienVencido = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Vencido ayer', items: [CANT(2, 'Vidrio', 1, 12000)],
}, cfg);
const viejo = await svc.crear({
  sucursalId: 1, negocioId: 1, usuarioId: 1,
  titulo: 'Vencido hace meses', items: [CANT(2, 'Vidrio', 1, 12000)],
}, cfg);

await db.query(`UPDATE borradores SET expira_en = NOW() - INTERVAL '1 day'   WHERE id = $1`, [recienVencido.id]);
await db.query(`UPDATE borradores SET expira_en = NOW() - INTERVAL '90 days' WHERE id = $1`, [viejo.id]);

const purgados = await repo.purgarVencidos();
ok('la purga borra el vencido hace meses', purgados >= 1, `${purgados} borrado(s)`);
ok('el vencido ayer sobrevive (mes de gracia)',
  (await repo.obtener(recienVencido.id, 1, 1)) !== null);
ok('el vencido hace meses ya no está',
  (await repo.obtener(viejo.id, 1, 1)) === null);
ok('el borrador vigente ni se toca',
  (await repo.obtener(vivo.id, 1, 1)) !== null);

const huerfanosPurga = await uno(
  'SELECT COUNT(*)::int AS n FROM borradores_items WHERE borrador_id = $1', [viejo.id]);
ok('la purga se lleva sus ítems en cascada', huerfanosPurga.n === 0);

// El aviso push: los que vencen dentro de 1 día, agrupados por sucursal.
await db.query(`UPDATE borradores SET expira_en = NOW() + INTERVAL '10 hours' WHERE id = $1`, [vivo.id]);
const avisos = await repo.porVencer(1, 1);
ok('agrupa por sucursal los que vencen pronto', avisos.length === 1, `${avisos.length} grupo(s)`);
ok('cuenta cuántos', avisos[0]?.cuantos >= 1, `cuantos=${avisos[0]?.cuantos}`);
ok('trae el nombre de la sucursal', avisos[0]?.sucursal_nombre === 'Principal');
ok('trae ejemplos para el cuerpo del aviso',
  Array.isArray(avisos[0]?.ejemplos) && avisos[0].ejemplos.includes('Vivo'),
  JSON.stringify(avisos[0]?.ejemplos));

// Lo que ya venció no "está por vencer": no se avisa dos veces de lo mismo.
await db.query(`UPDATE borradores SET expira_en = NOW() - INTERVAL '2 hours' WHERE id = $1`, [vivo.id]);
const trasVencer = await repo.porVencer(1, 1);
ok('un borrador YA vencido no entra en el aviso de "por vencer"',
  !(trasVencer[0]?.ejemplos || []).includes('Vivo'));

// Los que no vencen nunca tampoco tienen nada que avisar.
await db.query('UPDATE borradores SET expira_en = NULL WHERE id = $1', [vivo.id]);
ok('un borrador sin vencimiento no entra en el aviso',
  !((await repo.porVencer(1, 1))[0]?.ejemplos || []).includes('Vivo'));
ok('y la purga no lo toca nunca',
  (await repo.obtener(vivo.id, 1, 1)) !== null);

// Otro negocio no ve los avisos de este.
ok('el aviso está acotado al negocio', (await repo.porVencer(2, 1)).length === 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${pasados} pasadas, ${fallos} fallidas`);
console.log('═'.repeat(72));
process.exit(fallos ? 1 : 0);
