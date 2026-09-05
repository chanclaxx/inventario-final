// ─────────────────────────────────────────────────────────────────────────────
// PEDIDO DETALLADO — pedir la VARIANTE, conciliarla al recibir, corregir sin
// rehacer.
//
// Contra Postgres real. Lo que esta prueba sostiene, en orden de importancia:
//
//   1. QUE NADA CAMBIE CON LA FEATURE APAGADA. Es la sección 1 y es la que hay
//      que mirar primero: los 28 negocios que hoy piden "100 cargadores" tienen
//      que seguir comportándose exactamente igual, incluida la posibilidad de
//      recibir repartido por variante contra una orden pedida al producto.
//
//   2. QUE LA SUSTITUCIÓN NO PASE EN SILENCIO. Es el bug que motivó todo: se
//      pedía la variante de 25W, llegaba la de 20W, y la orden se marcaba
//      cumplida sin que nadie se enterara. Ahora exige confirmación explícita y
//      deja novedad con las etiquetas CONGELADAS — la sección 6 renombra la
//      talla después y comprueba que la novedad sigue diciendo la verdad.
//
//   3. QUE CORREGIR NO DAÑE EL INVENTARIO. La sección 7 corrige el nodo de una
//      entrada y verifica las tres cosas a la vez: el stock del nodo viejo
//      vuelve a su valor original, el nuevo recibe lo suyo, y el COSTO PROMEDIO
//      del nodo viejo vuelve EXACTO. Sin lo tercero, corregir una talla deja el
//      costo contando unidades que ya no están y la utilidad de cada venta
//      futura miente.
//
//   4. El invariante producto = Σ variantes en cada paso. Es el que se rompió en
//      las remisiones por variante y el que rompería una corrección que
//      escribiera en el nivel de arriba.
//
//   node scripts/pruebas-red-interna/38-pedido-detallado.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

let fallos = 0, pasados = 0;
const check = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else    { fallos++;  console.log(`  ✗ ${etiqueta} — dio ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`); }
};
const seccion = (t) => console.log(`\n═══ ${t} ═══`);

// Corre `fn` y devuelve el error que lance (o null). Se usa para las
// validaciones: lo que importa es el CODE, no el texto del mensaje.
const capturar = async (fn) => {
  try { await fn(); return null; } catch (e) { return e; }
};

const db = new PGlite();

await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));

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
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS factura_confirmada BOOLEAN DEFAULT TRUE;
  ALTER TABLE compras ADD COLUMN IF NOT EXISTS es_entrada BOOLEAN DEFAULT FALSE;
`);

// Las DOS migraciones reales, en su orden de producción. Nada de recrear el
// esquema a mano: si el .sql se desvía del código, esto tiene que enterarse.
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260806_ordenes_compra.sql'), 'utf8'));
await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260905_pedido_detallado.sql'), 'utf8'));

const conectar = () => ({ query: (s, p) => db.query(s, p ?? []) });
const pool = { ...conectar(), connect: async () => ({ ...conectar(), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] =
  { id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} } };

const comprasSvc = require(path.join(RAIZ, 'src/modules/compras/compras.service.js'));
const ordenesSvc = require(path.join(RAIZ, 'src/modules/ordenes-compra/ordenesCompra.service.js'));
const ordenesRepo= require(path.join(RAIZ, 'src/modules/ordenes-compra/ordenesCompra.repository.js'));
const columnas   = require(path.join(RAIZ, 'src/config/columnas.js'));

// La tabla existe en este fixture, así que la bandera se enciende a mano: la
// detección real consulta information_schema al arrancar el servidor.
columnas._setCorreccionesEntradaDisponible(true);

// ── Datos base ──────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO negocios(id, nombre) VALUES (1, 'Test') ON CONFLICT DO NOTHING;
  INSERT INTO sucursales(id, negocio_id, nombre, activa) VALUES (1, 1, 'Principal', true) ON CONFLICT DO NOTHING;
  INSERT INTO usuarios(id, nombre) VALUES (1, 'Bodeguero') ON CONFLICT DO NOTHING;
  INSERT INTO proveedores(id, negocio_id, nombre, nit, activo) VALUES (1, 1, 'Distri SAS', '900', true);
  INSERT INTO tipos_caracteristica(id, nombre) VALUES (1, 'Potencia');

  -- El cargador: un producto con dos potencias. El stock vive en los atributos;
  -- el del producto es la SUMA y se recalcula solo.
  INSERT INTO productos_cantidad(id, sucursal_id, nombre, stock, costo_unitario, activo)
    VALUES (10, 1, 'Cargador', 20, 1000, true);
  INSERT INTO atributos_producto(id, producto_id, sucursal_id, tipo_id, valor, stock, costo_unitario, activo)
    VALUES (100, 10, 1, 1, '25W', 12, 1000, true),
           (101, 10, 1, 1, '20W', 8,  1000, true);

  -- Un producto con TRES niveles, para probar que un contenedor no se puede
  -- pedir: el atributo 200 tiene variantes debajo.
  INSERT INTO productos_cantidad(id, sucursal_id, nombre, stock, costo_unitario, activo)
    VALUES (20, 1, 'Correa', 0, 500, true);
  INSERT INTO atributos_producto(id, producto_id, sucursal_id, tipo_id, valor, stock, costo_unitario, activo)
    VALUES (200, 20, 1, 1, 'Negra', 0, 500, true);
  INSERT INTO variantes_atributo(id, atributo_id, producto_id, tipo_id, valor, stock, costo_unitario, activo)
    VALUES (300, 200, 20, 1, '38MM', 0, 500, true);

  INSERT INTO productos_serial(id, sucursal_id, nombre, activo) VALUES (30, 1, 'iPhone', true);
`);

const stockDe = async (tabla, id) => {
  const { rows } = await db.query(`SELECT stock, costo_unitario FROM ${tabla} WHERE id = $1`, [id]);
  return { stock: Number(rows[0].stock), costo: Number(rows[0].costo_unitario) };
};
const invarianteProducto = async (productoId) => {
  const { rows } = await db.query(
    `SELECT p.stock AS producto,
            (SELECT COALESCE(SUM(stock),0) FROM atributos_producto WHERE producto_id = p.id AND activo) AS suma
     FROM productos_cantidad p WHERE p.id = $1`, [productoId]);
  return Number(rows[0].producto) === Number(rows[0].suma);
};

// ═══════════════════════════════════════════════════════════════════════════
seccion('1. Con la feature APAGADA nada cambia');
// ═══════════════════════════════════════════════════════════════════════════
// La sección que protege a los 28 negocios. Si falla, el despliegue no va.

const ordenPlana = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, emitir: true,
  detalleNodo: false,
  lineas: [{ tipo: 'cantidad', producto_id: 10, nombre_producto: 'Cargador', cantidad_pedida: 10, precio_estimado: 1000 }],
});
check('una orden al producto se crea igual que siempre', ordenPlana.estado, 'Emitida');

const lineasPlanas = await ordenesRepo.getLineas(ordenPlana.id);
check('y su línea no baja a ningún nodo', [lineasPlanas[0].variante_id, lineasPlanas[0].atributo_id], [null, null]);

// El flujo de HOY: orden al producto, recepción repartida por variante. No es
// una sustitución y no puede pedir confirmación de nada.
const recepcionPlana = await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: ordenPlana.id, registrar_en_caja: false,
  lineas: [
    { nombre_producto: 'Cargador', producto_id: 10, atributo_id: 100, cantidad: 6, precio_unitario: 1000, orden_linea_id: lineasPlanas[0].id },
    { nombre_producto: 'Cargador', producto_id: 10, atributo_id: 101, cantidad: 4, precio_unitario: 1000, orden_linea_id: lineasPlanas[0].id },
  ],
});
check('★ recibir repartido por variante contra una orden al producto NO pide confirmación',
  Boolean(recepcionPlana.id), true);

check('el 25W subió 6', (await stockDe('atributos_producto', 100)).stock, 18);
check('el 20W subió 4',  (await stockDe('atributos_producto', 101)).stock, 12);
check('producto = Σ variantes', await invarianteProducto(10), true);

const { rows: novedadesPlanas } = await db.query('SELECT COUNT(*)::int AS n FROM novedades_proveedor');
check('★ y no se inventó ninguna novedad', novedadesPlanas[0].n, 0);

// Pedir un nodo con la feature apagada se rechaza: entraría a una orden que
// ninguna pantalla sabría pintar.
const errApagada = await capturar(() => ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, detalleNodo: false,
  lineas: [{ tipo: 'cantidad', producto_id: 10, nombre_producto: 'Cargador', atributo_id: 100, cantidad_pedida: 5 }],
}));
check('★ pedir por variante con la feature apagada se rechaza', errApagada?.status, 400);

// ═══════════════════════════════════════════════════════════════════════════
seccion('2. Crear la orden POR NODO');
// ═══════════════════════════════════════════════════════════════════════════

const orden = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, emitir: true,
  detalleNodo: true,
  lineas: [
    { tipo: 'cantidad', producto_id: 10, nombre_producto: 'Cargador', atributo_id: 100, cantidad_pedida: 50, precio_estimado: 1000 },
    { tipo: 'cantidad', producto_id: 10, nombre_producto: 'Cargador', atributo_id: 101, cantidad_pedida: 50, precio_estimado: 1000 },
  ],
});
const lineas = await ordenesRepo.getLineas(orden.id);
check('★ el mismo producto entra DOS veces, una por potencia', lineas.length, 2);
check('cada línea guarda su nodo', lineas.map((l) => l.atributo_id), [100, 101]);
check('y el repositorio ya rotula el valor', lineas.map((l) => l.atributo_valor), ['25W', '20W']);
check('el pedido total es 100', lineas.reduce((s, l) => s + l.cantidad_pedida, 0), 100);

const errDup = await capturar(() => ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, detalleNodo: true,
  lineas: [
    { tipo: 'cantidad', producto_id: 10, nombre_producto: 'Cargador', atributo_id: 100, cantidad_pedida: 5 },
    { tipo: 'cantidad', producto_id: 10, nombre_producto: 'Cargador', atributo_id: 100, cantidad_pedida: 3 },
  ],
}));
check('★ el mismo nodo dos veces se rechaza', errDup?.status, 400);

const errContenedor = await capturar(() => ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, detalleNodo: true,
  lineas: [{ tipo: 'cantidad', producto_id: 20, nombre_producto: 'Correa', atributo_id: 200, cantidad_pedida: 5 }],
}));
check('★ un contenedor (tiene variantes debajo) no se puede pedir', errContenedor?.code, 'NODO_CONTENEDOR');

const errAjeno = await capturar(() => ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, detalleNodo: true,
  lineas: [{ tipo: 'cantidad', producto_id: 10, nombre_producto: 'Cargador', atributo_id: 200, cantidad_pedida: 5 }],
}));
check('★ un nodo de OTRO producto se rechaza', errAjeno?.code, 'NODO_INVALIDO');

const errSerial = await capturar(() => ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, detalleNodo: true,
  lineas: [{ tipo: 'serial', producto_id: 30, nombre_producto: 'iPhone', atributo_id: 100, cantidad_pedida: 2 }],
}));
check('★ un serial no baja a nodo: se pide por modelo y cantidad', errSerial?.status, 400);

// La hoja SÍ se puede pedir, aunque su padre sea un contenedor.
const ordenHoja = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, detalleNodo: true,
  lineas: [{ tipo: 'cantidad', producto_id: 20, nombre_producto: 'Correa', variante_id: 300, cantidad_pedida: 4 }],
});
check('la HOJA de tres niveles sí se puede pedir', Boolean(ordenHoja.id), true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('3. Llegó lo que se pidió');
// ═══════════════════════════════════════════════════════════════════════════

const stock25Antes = (await stockDe('atributos_producto', 100)).stock;

await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden.id, registrar_en_caja: false,
  lineas: [{ nombre_producto: 'Cargador', producto_id: 10, atributo_id: 100, cantidad: 50, precio_unitario: 1000, orden_linea_id: lineas[0].id }],
});
check('el 25W recibió sus 50', (await stockDe('atributos_producto', 100)).stock, stock25Antes + 50);
check('producto = Σ variantes', await invarianteProducto(10), true);

const avance = await ordenesRepo.getLineas(orden.id);
check('la línea del 25W queda completa', [Number(avance[0].recibida), Number(avance[0].pendiente)], [50, 0]);
check('y la del 20W sigue entera pendiente', Number(avance[1].pendiente), 50);

// ═══════════════════════════════════════════════════════════════════════════
seccion('4. Llegó OTRA cosa — la sustitución');
// ═══════════════════════════════════════════════════════════════════════════
// El bug original: se pedía 20W, llegaba 25W, y la orden se marcaba cumplida en
// silencio.

const errSust = await capturar(() => comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden.id, registrar_en_caja: false,
  lineas: [{ nombre_producto: 'Cargador', producto_id: 10, atributo_id: 100, cantidad: 50, precio_unitario: 1000, orden_linea_id: lineas[1].id }],
}));
check('★ sin confirmar, la sustitución se PARA EN SECO', errSust?.code, 'NODO_DISTINTO');
check('y el error dice qué se pidió y qué llegó',
  [errSust?.detalle?.pedido, errSust?.detalle?.recibido], ['Potencia: 20W', 'Potencia: 25W']);

const { rows: sinEscribir } = await db.query(
  `SELECT COUNT(*)::int AS n FROM lineas_compra WHERE orden_linea_id = $1`, [lineas[1].id]);
check('★ y no escribió NADA (el 409 dejó la transacción intacta)', sinEscribir[0].n, 0);

const stock25PreSust = (await stockDe('atributos_producto', 100)).stock;

await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden.id, registrar_en_caja: false,
  lineas: [{
    nombre_producto: 'Cargador', producto_id: 10, atributo_id: 100, cantidad: 50,
    precio_unitario: 1000, orden_linea_id: lineas[1].id, sustituye: true,
  }],
});
check('confirmada, la sustitución entra', (await stockDe('atributos_producto', 100)).stock, stock25PreSust + 50);
check('★ el stock entra en el nodo que LLEGÓ, no en el que se pidió',
  (await stockDe('atributos_producto', 101)).stock, 12);

const avanceSust = await ordenesRepo.getLineas(orden.id);
check('★ la línea del 20W queda CUMPLIDA (el proveedor respondió)',
  Number(avanceSust[1].pendiente), 0);

const { rows: nov } = await db.query(
  `SELECT tipo, cantidad, pedido_etiqueta, recibido_etiqueta, orden_linea_id
   FROM novedades_proveedor WHERE tipo = 'sustitucion'`);
check('★ queda novedad de sustitución', nov.length, 1);
check('con lo pedido y lo recibido', [nov[0].pedido_etiqueta, nov[0].recibido_etiqueta],
  ['Potencia: 20W', 'Potencia: 25W']);
check('y con la cantidad', Number(nov[0].cantidad), 50);
check('atada a la línea de la orden', Number(nov[0].orden_linea_id), Number(lineas[1].id));

// ═══════════════════════════════════════════════════════════════════════════
seccion('5. Llegaron de MÁS — el exceso');
// ═══════════════════════════════════════════════════════════════════════════

const orden2 = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, emitir: true, detalleNodo: true,
  lineas: [{ tipo: 'cantidad', producto_id: 10, nombre_producto: 'Cargador', atributo_id: 101, cantidad_pedida: 10, precio_estimado: 1000 }],
});
const l2 = (await ordenesRepo.getLineas(orden2.id))[0];

const errExceso = await capturar(() => comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden2.id, registrar_en_caja: false,
  lineas: [{ nombre_producto: 'Cargador', producto_id: 10, atributo_id: 101, cantidad: 13, precio_unitario: 1000, orden_linea_id: l2.id }],
}));
check('★ sin confirmar, el exceso se para', errExceso?.code, 'EXCESO');
check('y dice cuántas sobran', errExceso?.detalle?.sobra, 3);

const stock20Pre = (await stockDe('atributos_producto', 101)).stock;
await comprasSvc.registrarCompra({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1,
  orden_compra_id: orden2.id, registrar_en_caja: false,
  lineas: [{
    nombre_producto: 'Cargador', producto_id: 10, atributo_id: 101, cantidad: 13,
    precio_unitario: 1000, orden_linea_id: l2.id, excedente_ok: true,
  }],
});
check('★ confirmado, entran las 13 completas', (await stockDe('atributos_producto', 101)).stock, stock20Pre + 13);

const l2Post = (await ordenesRepo.getLineas(orden2.id))[0];
check('la línea registra las 13 recibidas', Number(l2Post.recibida), 13);
check('★ pero el pendiente no se va a negativo', Number(l2Post.pendiente), 0);

const { rows: resumen2 } = await db.query(
  `SELECT unidades_pedidas, unidades_recibidas FROM (
     SELECT o.id,
            COALESCE(av.pedidas,0) AS unidades_pedidas,
            COALESCE(av.recibidas,0) AS unidades_recibidas
     FROM ordenes_compra o
     LEFT JOIN (
       SELECT a.orden_id, SUM(loc.cantidad_pedida) AS pedidas,
              SUM(LEAST(a.recibida, loc.cantidad_pedida)) AS recibidas
       FROM (
         SELECT loc.id AS linea_id, loc.orden_id,
                COALESCE(SUM(lc.cantidad - COALESCE(lc.cantidad_devuelta,0))
                  FILTER (WHERE c.id IS NOT NULL), 0) AS recibida
         FROM lineas_orden_compra loc
         LEFT JOIN lineas_compra lc ON lc.orden_linea_id = loc.id
         LEFT JOIN compras c ON c.id = lc.compra_id AND c.estado <> 'Cancelada'
         GROUP BY loc.id
       ) a JOIN lineas_orden_compra loc ON loc.id = a.linea_id
       GROUP BY a.orden_id
     ) av ON av.orden_id = o.id
     WHERE o.id = $1
   ) t`, [orden2.id]);
check('★ el avance de la orden NO pasa del 100 % (el LEAST lo acota)',
  [Number(resumen2[0].unidades_pedidas), Number(resumen2[0].unidades_recibidas)], [10, 10]);

const { rows: novEx } = await db.query(
  `SELECT cantidad FROM novedades_proveedor WHERE tipo = 'exceso'`);
check('★ queda novedad de exceso por las 3 de más', Number(novEx[0]?.cantidad), 3);

// ═══════════════════════════════════════════════════════════════════════════
seccion('6. Las etiquetas van CONGELADAS');
// ═══════════════════════════════════════════════════════════════════════════
// Si se unieran por JOIN, renombrar la talla reescribiría el pasado y la
// novedad diría que el proveedor mandó algo que nunca se llamó así.

await db.query(`UPDATE atributos_producto SET valor = '20 vatios' WHERE id = 101`);
const { rows: novTrasRenombrar } = await db.query(
  `SELECT pedido_etiqueta FROM novedades_proveedor WHERE tipo = 'sustitucion'`);
check('★ renombrar la potencia NO reescribe la novedad',
  novTrasRenombrar[0].pedido_etiqueta, 'Potencia: 20W');
await db.query(`UPDATE atributos_producto SET valor = '20W' WHERE id = 101`);

// ═══════════════════════════════════════════════════════════════════════════
seccion('7. Corregir una entrada sin rehacerla');
// ═══════════════════════════════════════════════════════════════════════════

// Estado de partida de los dos nodos, para comprobar el retorno exacto.
const antes25 = await stockDe('atributos_producto', 100);
const antes20 = await stockDe('atributos_producto', 101);

// El bodeguero recibe 10 y se equivoca: eran 20W, no 25W. La entrada se
// valoriza al último costo conocido del nodo (neutro).
const entrada = await comprasSvc.registrarEntrada({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1,
  lineas: [{ producto_id: 10, nombre_producto: 'Cargador', atributo_id: 100, cantidad: 10 }],
});
check('la entrada nace sin confirmar', entrada.factura_confirmada, false);
check('el 25W subió 10 (mal capturados)', (await stockDe('atributos_producto', 100)).stock, antes25.stock + 10);
check('★ y el promedio NO se movió: la entrada es neutra',
  (await stockDe('atributos_producto', 100)).costo, antes25.costo);

const { rows: lcRows } = await db.query(
  'SELECT id FROM lineas_compra WHERE compra_id = $1', [entrada.id]);

const res = await comprasSvc.corregirEntrada(1, entrada.id, {
  operaciones: [{ linea_id: lcRows[0].id, atributo_id: 101, variante_id: null }],
  motivo: 'Me equivoqué de potencia',
  usuario_id: 1,
});
check('la corrección reporta un cambio de nodo', res.correcciones[0].accion, 'nodo');
check('★ el 25W vuelve EXACTO a donde estaba', await stockDe('atributos_producto', 100), antes25);
check('★ y las 10 aparecen en el 20W', (await stockDe('atributos_producto', 101)).stock, antes20.stock + 10);
check('producto = Σ variantes tras corregir', await invarianteProducto(10), true);

const { rows: bitacora } = await db.query(
  `SELECT accion, antes_etiqueta, despues_etiqueta, antes_cantidad, despues_cantidad, motivo, usuario_id
   FROM correcciones_entrada WHERE compra_id = $1`, [entrada.id]);
check('★ la bitácora quedó escrita', bitacora.length, 1);
check('con el antes y el después congelados',
  [bitacora[0].antes_etiqueta, bitacora[0].despues_etiqueta], ['Potencia: 25W', 'Potencia: 20W']);
check('con el motivo', bitacora[0].motivo, 'Me equivoqué de potencia');
check('y con quién lo hizo', Number(bitacora[0].usuario_id), 1);

// Corregir la cantidad: mismo nodo, solo el delta.
const res2 = await comprasSvc.corregirEntrada(1, entrada.id, {
  operaciones: [{ linea_id: lcRows[0].id, cantidad: 7 }],
  usuario_id: 1,
});
check('bajar la cantidad se registra como tal', res2.correcciones[0].accion, 'cantidad');
check('★ el 20W queda con 7, no con 10', (await stockDe('atributos_producto', 101)).stock, antes20.stock + 7);
check('producto = Σ variantes', await invarianteProducto(10), true);

const { rows: totalRows } = await db.query('SELECT total FROM compras WHERE id = $1', [entrada.id]);
check('★ el total de la entrada se recalculó desde las líneas', Number(totalRows[0].total), 7000);

// ═══════════════════════════════════════════════════════════════════════════
seccion('8. Las barandas de la corrección');
// ═══════════════════════════════════════════════════════════════════════════

const errSinCambio = await comprasSvc.corregirEntrada(1, entrada.id, {
  operaciones: [{ linea_id: lcRows[0].id, cantidad: 7 }], usuario_id: 1,
});
check('★ corregir a lo mismo no escribe nada', errSinCambio.sin_cambios, true);

const errCero = await capturar(() => comprasSvc.corregirEntrada(1, entrada.id, {
  operaciones: [{ linea_id: lcRows[0].id, cantidad: 0 }], usuario_id: 1,
}));
check('★ cantidad 0 manda a quitar la línea, no la acepta', errCero?.status, 400);

const errVaciar = await capturar(() => comprasSvc.corregirEntrada(1, entrada.id, {
  operaciones: [{ linea_id: lcRows[0].id, quitar: true }], usuario_id: 1,
}));
check('★ quitar TODAS las líneas manda a cancelar la entrada', errVaciar?.status, 409);
check('y el stock quedó intacto tras ese rechazo',
  (await stockDe('atributos_producto', 101)).stock, antes20.stock + 7);

// Una compra normal (no entrada) no se corrige por aquí.
const errNoEntrada = await capturar(() => comprasSvc.corregirEntrada(1, recepcionPlana.id, {
  operaciones: [{ linea_id: 1, cantidad: 1 }], usuario_id: 1,
}));
check('★ una compra de administración no se corrige por aquí', errNoEntrada?.status, 409);

// La frontera: confirmada, se acabó.
await db.query('UPDATE compras SET factura_confirmada = true WHERE id = $1', [entrada.id]);
const errConfirmada = await capturar(() => comprasSvc.corregirEntrada(1, entrada.id, {
  operaciones: [{ linea_id: lcRows[0].id, cantidad: 5 }], usuario_id: 1,
}));
check('★ confirmada, la corrección se cierra', errConfirmada?.code, 'ENTRADA_CONFIRMADA');
await db.query('UPDATE compras SET factura_confirmada = false WHERE id = $1', [entrada.id]);

// Otro negocio no ve esta entrada.
const errAjena = await capturar(() => comprasSvc.corregirEntrada(999, entrada.id, {
  operaciones: [{ linea_id: lcRows[0].id, cantidad: 5 }], usuario_id: 1,
}));
check('★ otro negocio no puede tocarla', errAjena?.status, 404);

// ═══════════════════════════════════════════════════════════════════════════
seccion('9. Corregir cuando el costo NO era neutro');
// ═══════════════════════════════════════════════════════════════════════════
// Una entrada contra una orden se valoriza al `precio_estimado`, que sí mueve el
// promedio. Es el único caso en que la reversa hace trabajo real, y tiene que
// devolver la cifra EXACTA.

await db.query(`UPDATE atributos_producto SET stock = 10, costo_unitario = 1000 WHERE id = 100`);
await db.query(`UPDATE productos_cantidad SET stock = (SELECT SUM(stock) FROM atributos_producto WHERE producto_id = 10) WHERE id = 10`);

const orden3 = await ordenesSvc.crear({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, proveedor_id: 1, emitir: true, detalleNodo: true,
  lineas: [{ tipo: 'cantidad', producto_id: 10, nombre_producto: 'Cargador', atributo_id: 100, cantidad_pedida: 10, precio_estimado: 1800 }],
});
const l3 = (await ordenesRepo.getLineas(orden3.id))[0];

const entrada3 = await comprasSvc.registrarEntrada({
  negocio_id: 1, sucursal_id: 1, usuario_id: 1, orden_compra_id: orden3.id,
  lineas: [{ producto_id: 10, nombre_producto: 'Cargador', atributo_id: 100, cantidad: 10, orden_linea_id: l3.id }],
});
const trasEntrada = await stockDe('atributos_producto', 100);
check('la entrada se valorizó al estimado de la orden', trasEntrada.stock, 20);
check('★ y el promedio SÍ se movió (10 a $1.000 + 10 a $1.800)', trasEntrada.costo, 1400);

const { rows: lc3 } = await db.query('SELECT id FROM lineas_compra WHERE compra_id = $1', [entrada3.id]);
await comprasSvc.corregirEntrada(1, entrada3.id, {
  operaciones: [{ linea_id: lc3[0].id, atributo_id: 101, variante_id: null }],
  motivo: 'Eran 20W', usuario_id: 1,
});
const trasCorregir = await stockDe('atributos_producto', 100);
check('★ el stock del 25W vuelve a 10', trasCorregir.stock, 10);
check('★★ y el COSTO PROMEDIO vuelve EXACTO a $1.000', trasCorregir.costo, 1000);
check('producto = Σ variantes', await invarianteProducto(10), true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('10. El .sql y la copia de migrations.js no se separaron');
// ═══════════════════════════════════════════════════════════════════════════
// Escribir el .sql y olvidar el runner deja el despliegue con el código nuevo
// contra una base vieja. Ya pasó con abonos_remision.

const sqlArchivo = readFileSync(path.join(RAIZ, 'migrations/20260905_pedido_detallado.sql'), 'utf8');
const runner     = readFileSync(path.join(RAIZ, 'src/config/migrations.js'), 'utf8');

check('★ el .sql no tiene comillas invertidas (rompen el template literal)',
  sqlArchivo.includes('`'), false);

for (const pieza of [
  'correcciones_entrada', 'correcciones_entrada_accion_chk',
  'idx_correcciones_entrada_compra', 'idx_novedades_proveedor_orden_linea',
  'pedido_etiqueta', 'recibido_etiqueta', "'sustitucion'", "'exceso'",
]) {
  check(`el runner replica ${pieza}`, runner.includes(pieza), true);
}
check('★ el runner corre el bloque en su propio migrar()',
  runner.includes('Pedido detallado y corrección de entradas'), true);
check('★ y la bandera de columnas.js apaga solo la corrección',
  readFileSync(path.join(RAIZ, 'src/config/columnas.js'), 'utf8').includes('hayCorreccionesEntrada'), true);

// ═══════════════════════════════════════════════════════════════════════════
seccion('11. Las pantallas dicen lo mismo que el backend');
// ═══════════════════════════════════════════════════════════════════════════
// Revision estatica, al estilo de 34-contratos-frontend. Una pantalla que
// ofrece algo que el servidor rechaza —o que promete algo que no va a pasar— es
// peor que una que no lo ofrece: el usuario descubre el error DESPUES de haber
// hecho el trabajo. Es exactamente el bug que traia VistaEntrada.

const FRONT = path.resolve(RAIZ, '../frontend/src');
const leer = (rel) => readFileSync(path.join(FRONT, rel), 'utf8');

const modalOrden   = leer('pages/proveedores/ModalOrden.jsx');
const modalRecibir = leer('pages/proveedores/ModalRecibir.jsx');
const vistaEntrada = leer('pages/entradas/VistaEntrada.jsx');
const modalCorregir= leer('pages/entradas/ModalCorregirEntrada.jsx');
const entradasPage = leer('pages/entradas/EntradasPage.jsx');
const comprasCfg   = leer('pages/configuracion/ComprasConfig.jsx');
const entradasApi  = leer('api/entradas.api.js');

// ── La orden manda el nodo ─────────────────────────────────────────────────
check('★ ModalOrden manda variante_id/atributo_id en el payload',
  /variante_id:\s*l\.variante_id/.test(modalOrden) && /atributo_id:\s*l\.atributo_id/.test(modalOrden), true);
check('★ y la clave de deduplicacion ya NO es solo tipo-producto',
  modalOrden.includes('`${l.tipo}-${l.producto_id}`'), false);
check('★ la clave incluye el nodo (el mismo producto entra dos veces)',
  modalOrden.includes('const claveDe'), true);
check('★ el rotulo del nodo NO viaja al backend (lo resuelve el servidor)',
  /nodo_label:\s*l\.nodo_label/.test(modalOrden), false);

// ── La recepcion concilia ──────────────────────────────────────────────────
for (const [nombre, fuente] of [['ModalRecibir', modalRecibir], ['VistaEntrada', vistaEntrada]]) {
  check(`${nombre} lee el nodo que pidio la orden`, fuente.includes('nodoPedido'), true);
  check(`${nombre} manda sustituye solo cuando hay sustitucion`,
    fuente.includes('{ sustituye: true }'), true);
  check(`${nombre} manda excedente_ok solo cuando se marco`,
    fuente.includes('{ excedente_ok: true }'), true);
}

// El bug reportado: la pantalla prometia que el sobrante quedaba anotado y el
// backend respondia 400.
check('★★ VistaEntrada ya NO promete que el sobrante "queda anotado en la entrada"',
  vistaEntrada.includes('sobran ${pedida'), false);
check('★★ ahora pide un si explicito para el sobrante',
  vistaEntrada.includes('Me quedo con ellas'), true);
check('★ y ModalRecibir dejo de bloquear el exceso a secas',
  modalRecibir.includes('Hay líneas donde estás recibiendo más de lo que falta'), false);
check('★ ahora distingue el exceso SIN confirmar',
  modalRecibir.includes('excesoSinConfirmar'), true);

// ── Ni un precio en la correccion ──────────────────────────────────────────
// El bodeguero no decide plata, ni cuando corrige.
for (const prohibido of ['precio_unitario', 'InputMoneda', 'formatCOP', 'costo_unitario']) {
  check(`★ ModalCorregirEntrada no menciona ${prohibido}`,
    modalCorregir.includes(prohibido), false);
}
check('★ la correccion manda TODO en una sola peticion',
  modalCorregir.includes('operaciones,'), true);
check('★ y explica la frontera en vez de dejar que el usuario choque con el 409',
  modalCorregir.includes('entrada.factura_confirmada'), true);

// ── El boton respeta la misma frontera que el backend ──────────────────────
check('★★ "Corregir" solo aparece si NO esta confirmada y NO esta cancelada',
  /!e\.factura_confirmada && e\.estado !== 'Cancelada'/.test(entradasPage), true);

// ── El interruptor y su prerrequisito ──────────────────────────────────────
check('Ajustes ofrece el interruptor', comprasCfg.includes('ordenes_compra_detalle_nodo'), true);
check('★ y lo bloquea sin variantes activas, igual que el backend',
  comprasCfg.includes('valores.variantes_activo') && comprasCfg.includes('disabled={!variantes}'), true);

// ── La API no inventa rutas ────────────────────────────────────────────────
check('la api apunta a la ruta real de corregir',
  entradasApi.includes('/compras/entradas/${id}/corregir'), true);
check('y a la del historial',
  entradasApi.includes('/compras/entradas/${id}/correcciones'), true);

const rutas = readFileSync(path.join(RAIZ, 'src/modules/compras/compras.routes.js'), 'utf8');
check('★ las rutas de correccion van ANTES de /:id',
  rutas.indexOf("'/entradas/:id/corregir'") < rutas.indexOf("router.get('/:id'"), true);
check('★ corregir es del BODEGUERO (supervisor), no de administracion',
  /entradas\/:id\/corregir',\s*requireModulo\('inventario'\), requireNivel\('supervisor'\)/.test(rutas), true);

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(62)}`);
console.log(`  ${pasados} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(62));
process.exit(fallos > 0 ? 1 : 0);
