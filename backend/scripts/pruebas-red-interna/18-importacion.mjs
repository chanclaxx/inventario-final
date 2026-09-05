// ─────────────────────────────────────────────────────────────────────────────
// IMPORTACIÓN DE INVENTARIO — contra un Postgres real (PGlite/WASM).
//
// Se prueba como lo usa una persona: se generan bytes .xlsx de verdad y se
// entregan al CONTROLLER real, con un req/res falsos. Así se ejercita también
// la detección de hojas, la lectura de cabeceras y el agrupado — que es donde
// vivían la mitad de los bugs (hojas basura que creaban productos fantasma).
//
// Cubre, con las features encendidas Y apagadas:
//   · previsualización que no escribe y que coincide con la corrida real
//   · el mismo archivo en varias sucursales
//   · IMEI repetido entre sedes, ya vendido, o repetido dentro del archivo
//   · duplicados que YA existen en la base: se detectan, jamás se tocan
//   · variantes con costo propagado
//   · código único, heredado entre sedes y en conflicto
//   · ubicación y nota (columnas nuevas)
//   · hojas sin IMEI ni datos, varias hojas de producto en un libro
//   · números "1.500" / "1,500" y fechas dd/mm/aaaa
//   · aislamiento entre negocios
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
await db.exec(readFileSync(path.join(AQUI, 'esquema-importacion.sql'), 'utf8'));

const conectar = (t) => ({ query: (text, params) => t.query(text, params ?? []) });
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const XLSX      = require('xlsx');
const ctrl      = require(path.join(RAIZ, 'src/modules/importacion/importacion.controller.js'));
const columnas  = require(path.join(RAIZ, 'src/config/columnas.js'));

// Las columnas `ubicacion` existen en el fixture, igual que en producción.
columnas._setUbicacionDisponible(true);

let fallos = 0, pasados = 0;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}${ok ? '' : `  ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
}
// jsonb reordena las claves al guardarlas, así que comparar objetos con
// JSON.stringify daría falsos negativos por el orden.
function checkMapa(nombre, real, esperado) {
  const orden = (o) => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b)));
  check(nombre, orden(real), orden(esperado));
}
function checkQue(nombre, condicion, detalle = '') {
  console.log(`  ${condicion ? '✓' : '✗'} ${nombre}${condicion ? '' : `  ← ${detalle}`}`);
  condicion ? pasados++ : fallos++;
}
const seccion = (t) => console.log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`);

// ── Construcción de libros .xlsx reales ──────────────────────────────────────
//
// Respeta la estructura que espera el parser: fila 1 título, fila 2 claves,
// fila 3 descripciones, fila 4+ datos.
const hoja = (titulo, cabeceras, filas) => {
  const aoa = [
    [titulo, ...Array(Math.max(0, cabeceras.length - 1)).fill('')],
    cabeceras,
    cabeceras.map(() => 'descripción'),
    ...filas,
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
};

const libro = (hojas) => {
  const wb = XLSX.utils.book_new();
  for (const { nombre, ws } of hojas) XLSX.utils.book_append_sheet(wb, ws, nombre);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

// ── Invocación del controller real ───────────────────────────────────────────
const llamar = async (buffer, { sucursalId, negocioId, preview }) => {
  const req = { file: { buffer }, sucursal_id: sucursalId, user: { negocio_id: negocioId } };
  let payload = null, status = 200;
  const res = {
    status(c) { status = c; return this; },
    json(body) { payload = body; return this; },
  };
  await new Promise((resolve, reject) => {
    const next = (err) => (err ? reject(err) : resolve());
    const fn = preview ? ctrl.analizarInventario : ctrl.importarInventario;
    Promise.resolve(fn(req, res, next)).then(resolve, reject);
  });
  return { status, body: payload };
};

const analizar = (buf, o) => llamar(buf, { ...o, preview: true });
const importar = (buf, o) => llamar(buf, { ...o, preview: false });

const tipos = (lista) => (lista || []).map((i) => i.tipo).sort();
const hayTipo = (lista, tipo) => (lista || []).some((i) => i.tipo === tipo);

// ── Datos base ───────────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO negocios (id, nombre) VALUES (1, 'Prueba Multi'), (2, 'Otro Negocio');
  INSERT INTO sucursales (id, negocio_id, nombre) VALUES
    (1, 1, 'Principal'), (2, 1, 'Segunda'), (3, 1, 'Tercera'),
    (4, 2, 'Ajena');
  SELECT setval('negocios_id_seq', 2);
  SELECT setval('sucursales_id_seq', 4);
`);

const setConfig = async (negocioId, mapa) => {
  await q('DELETE FROM config_negocio WHERE negocio_id = $1', [negocioId]);
  for (const [clave, valor] of Object.entries(mapa)) {
    await q('INSERT INTO config_negocio(negocio_id, clave, valor) VALUES($1,$2,$3)', [negocioId, clave, valor]);
  }
};

const TODO_APAGADO = {};
const TODO_ENCENDIDO = {
  variantes_activo: '1',
  codigo_producto_activo: '1',
  ubicacion_activa: '1',
  colores_serial_activo: '1',
  colores_serial_lista: JSON.stringify(['Negro', 'Azul']),
  caracteristicas_serial_activo: '1',
  caracteristicas_serial_lista: JSON.stringify(['Bateria', 'Tecnico']),
  tarifas_activo: '1',
  tarifas_lista: JSON.stringify([{ id: 'f', nombre: 'Frecuente', porcentaje: 5 }]),
};

// Columnas de la hoja de cantidad, en los dos modos.
const CAB_CANT_SIMPLE = ['Nombre *', 'Linea', 'Stock', 'Stock Minimo', 'Costo Unitario', 'Precio Venta', 'Unidad Medida', 'Proveedor', 'Cliente Origen', 'Nota'];
const CAB_CANT_FULL   = ['Nombre *', 'Codigo', 'Ubicacion', 'Linea', 'Atributo', 'Variante', 'Stock', 'Stock Minimo', 'Costo Unitario', 'Precio Venta', 'Unidad Medida', 'Proveedor', 'Cliente Origen', 'Nota'];
const CAB_SERIAL_FULL = ['IMEI *', 'Fecha Entrada', 'Proveedor', 'Marca', 'Modelo', 'Linea', 'Color', 'Bateria', 'Tecnico', 'Ubicacion', 'Precio', 'Costo Compra', 'Cliente Origen', 'Nota'];
const CAB_SERIAL_MIN  = ['IMEI *', 'Fecha Entrada', 'Proveedor', 'Marca', 'Modelo', 'Linea', 'Precio', 'Costo Compra', 'Cliente Origen', 'Nota'];

// ═════════════════════════════════════════════════════════════════════════════
seccion('1. NEGOCIO SIN NINGUNA FEATURE — alta inicial en la sucursal 1');
// ═════════════════════════════════════════════════════════════════════════════
await setConfig(1, TODO_APAGADO);

const libroBasico = () => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('📦 Cantidad', CAB_CANT_SIMPLE, [
    ['Cable USB-C',  'Accesorios', 10, 2, 5000,  12000, 'unidad', 'Distribuidora Sur', '', 'Caja azul'],
    ['Vidrio 15',    'Accesorios', 25, 5, 3000,  8000,  'unidad', 'Distribuidora Sur', '', ''],
    ['Audífonos JBL', 'Audio',     4,  1, 45000, 90000, 'unidad', 'JBL Colombia',      '', ''],
  ]),
}]);

// ── Preview: no puede escribir NADA ──
const antesPreview = (await q('SELECT COUNT(*)::int n FROM productos_cantidad'))[0].n;
const prev1 = await analizar(libroBasico(), { sucursalId: 1, negocioId: 1 });
const despuesPreview = (await q('SELECT COUNT(*)::int n FROM productos_cantidad'))[0].n;

check('preview: productos en la BD antes y después', [antesPreview, despuesPreview], [0, 0]);
check('preview: modo', prev1.body.data.modo, 'preview');
check('preview: productos nuevos anunciados', prev1.body.data.resumen.productos_nuevos, 3);
check('preview: proveedores que se crearían', prev1.body.data.informe.proveedores_nuevos.sort(), ['Distribuidora Sur', 'JBL Colombia']);
check('preview: líneas que se crearían', prev1.body.data.informe.lineas_nuevas.sort(), ['Accesorios', 'Audio']);
checkQue('preview: no hay conflictos', prev1.body.data.informe.conflictos.length === 0,
  JSON.stringify(prev1.body.data.informe.conflictos));

// ── Aplicar y comparar con lo prometido ──
const real1 = await importar(libroBasico(), { sucursalId: 1, negocioId: 1 });
check('real: coincide con el preview', real1.body.data.resumen.productos_nuevos, prev1.body.data.resumen.productos_nuevos);
check('real: modo', real1.body.data.modo, 'aplicado');

const s1 = await q(`SELECT nombre, stock, costo_unitario::float c, precio::float p, unidad_medida, nota
                    FROM productos_cantidad WHERE sucursal_id = 1 ORDER BY nombre`);
check('sucursal 1: nombres', s1.map((r) => r.nombre), ['Audífonos JBL', 'Cable USB-C', 'Vidrio 15']);
check('sucursal 1: stocks', s1.map((r) => r.stock), [4, 10, 25]);
check('sucursal 1: costos', s1.map((r) => r.c), [45000, 5000, 3000]);
check('nota importada (columna nueva)', s1.find((r) => r.nombre === 'Cable USB-C').nota, 'Caja azul');
check('proveedores creados una sola vez', (await q('SELECT COUNT(*)::int n FROM proveedores'))[0].n, 2);
check('líneas creadas una sola vez', (await q('SELECT COUNT(*)::int n FROM lineas_producto'))[0].n, 2);

// ═════════════════════════════════════════════════════════════════════════════
seccion('2. EL MISMO ARCHIVO EN OTRA SUCURSAL — no se pisan entre sedes');
// ═════════════════════════════════════════════════════════════════════════════
const real2 = await importar(libroBasico(), { sucursalId: 2, negocioId: 1 });
check('sucursal 2: 3 productos nuevos', real2.body.data.resumen.productos_nuevos, 3);

const stocks1 = await q('SELECT stock FROM productos_cantidad WHERE sucursal_id = 1 ORDER BY nombre');
const stocks2 = await q('SELECT stock FROM productos_cantidad WHERE sucursal_id = 2 ORDER BY nombre');
check('sucursal 1 quedó intacta', stocks1.map((r) => r.stock), [4, 10, 25]);
check('sucursal 2 recibió lo suyo', stocks2.map((r) => r.stock), [4, 10, 25]);
check('no se duplicaron proveedores', (await q('SELECT COUNT(*)::int n FROM proveedores'))[0].n, 2);
check('no se duplicaron líneas', (await q('SELECT COUNT(*)::int n FROM lineas_producto'))[0].n, 2);

// ═════════════════════════════════════════════════════════════════════════════
seccion('3. RE-SUBIR EL MISMO ARCHIVO — el stock se suma y hay que avisarlo');
// ═════════════════════════════════════════════════════════════════════════════
const prev3 = await analizar(libroBasico(), { sucursalId: 1, negocioId: 1 });
check('preview anuncia 0 nuevos y 3 que reciben stock',
  [prev3.body.data.resumen.productos_nuevos, prev3.body.data.resumen.productos_actualizados], [0, 3]);
check('preview anuncia las unidades que se sumarían', prev3.body.data.resumen.unidades_sumadas, 39);
checkQue('preview avisa que el stock se SUMA', hayTipo(prev3.body.data.informe.avisos, 'stock_se_suma'),
  JSON.stringify(tipos(prev3.body.data.informe.avisos)));

const stockAntes = (await q('SELECT SUM(stock)::int s FROM productos_cantidad WHERE sucursal_id=1'))[0].s;
await importar(libroBasico(), { sucursalId: 1, negocioId: 1 });
const stockDespues = (await q('SELECT SUM(stock)::int s FROM productos_cantidad WHERE sucursal_id=1'))[0].s;
check('el stock efectivamente se duplicó (39 → 78)', [stockAntes, stockDespues], [39, 78]);

// Dejar la sucursal 1 como estaba para las pruebas siguientes
await q('UPDATE productos_cantidad SET stock = stock / 2 WHERE sucursal_id = 1');

// ═════════════════════════════════════════════════════════════════════════════
seccion('4. DUPLICADOS QUE YA EXISTEN EN LA BASE — detectar, JAMÁS tocar');
// ═════════════════════════════════════════════════════════════════════════════
// Se reproduce el estado real de producción: dos filas que difieren solo en
// mayúsculas, y otra con un espacio final invisible.
await q(`INSERT INTO productos_cantidad (id, sucursal_id, nombre, stock, costo_unitario)
         VALUES (900, 3, '11PRO', 7, 100), (901, 3, '11Pro', 3, 200),
                (902, 3, 'cargador 3ds ', 5, 300)`);
await q(`SELECT setval('productos_cantidad_id_seq', 1000)`);

const libroDup = () => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('📦 Cantidad', CAB_CANT_SIMPLE, [
    ['11pro',        '', 1, 0, '', '', '', '', '', ''],
    ['cargador 3ds', '', 2, 0, '', '', '', '', '', ''],
  ]),
}]);

const prev4 = await analizar(libroDup(), { sucursalId: 3, negocioId: 1 });
checkQue('avisa que varios productos coinciden con «11pro»',
  hayTipo(prev4.body.data.informe.avisos, 'varios_productos_coinciden'),
  JSON.stringify(tipos(prev4.body.data.informe.avisos)));
checkQue('avisa que «cargador 3ds» va a crear uno NUEVO pese al parecido',
  hayTipo(prev4.body.data.informe.avisos, 'nombre_similar_existente'),
  JSON.stringify(tipos(prev4.body.data.informe.avisos)));

await importar(libroDup(), { sucursalId: 3, negocioId: 1 });
const dup = await q(`SELECT id, nombre, stock FROM productos_cantidad WHERE sucursal_id = 3 ORDER BY id`);
check('el stock fue a la fila MÁS ANTIGUA, de forma determinista',
  dup.filter((r) => r.id === 900).map((r) => r.stock), [8]);
check('la otra fila duplicada NO se tocó', dup.filter((r) => r.id === 901).map((r) => r.stock), [3]);
check('la fila con espacio final NO se tocó', dup.filter((r) => r.id === 902).map((r) => r.stock), [5]);
check('se creó una fila nueva «cargador 3ds» (sin espacio), como avisó el informe',
  dup.filter((r) => r.nombre === 'cargador 3ds').length, 1);
check('ninguna fila preexistente cambió de nombre',
  dup.filter((r) => [900, 901, 902].includes(r.id)).map((r) => r.nombre),
  ['11PRO', '11Pro', 'cargador 3ds ']);

// ═════════════════════════════════════════════════════════════════════════════
seccion('5. SERIALES — el mismo IMEI entre sedes, vendido, y repetido');
// ═════════════════════════════════════════════════════════════════════════════
await setConfig(1, TODO_ENCENDIDO);

const libroSerial = (imeis) => libro([{
  nombre: 'iPhone 13 128GB',
  ws: hoja('📦  iPhone 13 128GB — Hoja de Seriales', CAB_SERIAL_FULL,
    imeis.map((imei) => [imei, '15/03/2026', 'Apple SAS', 'Apple', '128GB', 'Celulares',
      'Negro', '95%', 'Juan', 'Estante A-3', 2000000, 1500000, '', 'Sin caja'])),
}]);

const rs1 = await importar(libroSerial(['IMEI-001', 'IMEI-002', 'IMEI-003']), { sucursalId: 1, negocioId: 1 });
check('3 seriales nuevos en la sucursal 1', rs1.body.data.resumen.seriales_nuevos, 3);
// La fecha se pide ya formateada por Postgres: el pool falso de las pruebas no
// pasa por `types.setTypeParser(1082, …)` de src/config/db.js, así que el driver
// devolvería un Date y compararíamos contra el huso local, no contra lo guardado.
const ser1 = await q(`SELECT s.imei, s.color, s.caracteristicas, s.costo_compra::float c, s.nota,
                             TO_CHAR(s.fecha_entrada, 'YYYY-MM-DD') AS fecha
                      FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
                      WHERE ps.sucursal_id = 1 ORDER BY s.imei`);
check('colores guardados (feature activa)', ser1.map((r) => r.color), ['Negro', 'Negro', 'Negro']);
check('características como JSON con el nombre original',
  ser1[0].caracteristicas, { Bateria: '95%', Tecnico: 'Juan' });
check('fecha dd/mm/aaaa interpretada bien', ser1[0].fecha, '2026-03-15');
check('nota del serial (columna nueva)', ser1[0].nota, 'Sin caja');
check('ubicación aplicada al producto',
  (await q(`SELECT ubicacion FROM productos_serial WHERE sucursal_id = 1`))[0].ubicacion, 'Estante A-3');

// ── El mismo IMEI en OTRA sede: conflicto, y no se toca la sede original ──
const prev5 = await analizar(libroSerial(['IMEI-001', 'IMEI-002']), { sucursalId: 2, negocioId: 1 });
check('preview: los 2 IMEI de otra sede son conflicto',
  tipos(prev5.body.data.informe.conflictos), ['imei_otra_sede', 'imei_otra_sede']);
checkQue('el mensaje nombra la sucursal donde ya está',
  prev5.body.data.informe.conflictos[0].mensaje.includes('Principal'),
  prev5.body.data.informe.conflictos[0].mensaje);

await importar(libroSerial(['IMEI-001', 'IMEI-002']), { sucursalId: 2, negocioId: 1 });
check('no se creó ningún serial en la sucursal 2',
  (await q(`SELECT COUNT(*)::int n FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id
            WHERE ps.sucursal_id = 2`))[0].n, 0);
check('los seriales de la sucursal 1 siguen siendo 3',
  (await q(`SELECT COUNT(*)::int n FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id
            WHERE ps.sucursal_id = 1`))[0].n, 3);

// ── Re-import correctivo en la MISMA sede: actualiza, no duplica ──
const libroCorregido = libro([{
  nombre: 'iPhone 13 128GB',
  ws: hoja('📦  iPhone 13 128GB — Hoja de Seriales', CAB_SERIAL_FULL,
    [['IMEI-001', '15/03/2026', 'Apple SAS', 'Apple', '128GB', 'Celulares',
      'Azul', '99%', 'Juan', 'Estante A-3', 2100000, 1600000, '', 'Con caja']]),
}]);
const rs2 = await importar(libroCorregido, { sucursalId: 1, negocioId: 1 });
check('re-import en la misma sede: actualiza', rs2.body.data.resumen.seriales_actualizados, 1);
check('sigue habiendo 3 seriales (no se duplicó)',
  (await q(`SELECT COUNT(*)::int n FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id
            WHERE ps.sucursal_id=1`))[0].n, 3);

// ── Unidad ya vendida: nunca se toca ──
await q(`UPDATE seriales SET vendido = TRUE WHERE imei = 'IMEI-003'`);
const costoAntes = (await q(`SELECT costo_compra::float c FROM seriales WHERE imei='IMEI-003'`))[0].c;
const libroVendido = libro([{
  nombre: 'iPhone 13 128GB',
  ws: hoja('📦  iPhone 13 128GB — Hoja de Seriales', CAB_SERIAL_FULL,
    [['IMEI-003', '15/03/2026', '', '', '', '', '', '', '', '', 9999999, 8888888, '', '']]),
}]);
const rs3 = await importar(libroVendido, { sucursalId: 1, negocioId: 1 });
check('la unidad vendida es conflicto', tipos(rs3.body.data.informe.conflictos), ['imei_vendido']);
check('su costo NO cambió (la utilidad histórica queda intacta)',
  (await q(`SELECT costo_compra::float c FROM seriales WHERE imei='IMEI-003'`))[0].c, costoAntes);

// ── IMEI repetido dentro del mismo archivo ──
const rs4 = await importar(libroSerial(['IMEI-777', 'IMEI-777']), { sucursalId: 1, negocioId: 1 });
check('el IMEI repetido en el archivo es conflicto',
  tipos(rs4.body.data.informe.conflictos), ['imei_repetido_archivo']);
check('solo entró una vez',
  (await q(`SELECT COUNT(*)::int n FROM seriales WHERE imei = 'IMEI-777'`))[0].n, 1);

// ═════════════════════════════════════════════════════════════════════════════
seccion('6. AISLAMIENTO ENTRE NEGOCIOS — el mismo IMEI en otro negocio sí puede');
// ═════════════════════════════════════════════════════════════════════════════
await setConfig(2, TODO_APAGADO);
const rs5 = await importar(
  libro([{ nombre: 'Equipo X', ws: hoja('📦  Equipo X — Hoja de Seriales', CAB_SERIAL_MIN,
    [['IMEI-001', '', '', '', '', '', '', '', '', '']]) }]),
  { sucursalId: 4, negocioId: 2 }
);
check('el negocio 2 puede registrar un IMEI que el negocio 1 ya tiene',
  rs5.body.data.resumen.seriales_nuevos, 1);
check('sin conflictos entre negocios', rs5.body.data.informe.conflictos.length, 0);
check('el negocio 1 no se enteró',
  (await q(`SELECT COUNT(*)::int n FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id
            JOIN sucursales su ON su.id=ps.sucursal_id WHERE su.negocio_id=1 AND s.imei='IMEI-001'`))[0].n, 1);

// ═════════════════════════════════════════════════════════════════════════════
seccion('7. VARIANTES ACTIVAS — el costo baja hasta la variante');
// ═════════════════════════════════════════════════════════════════════════════
const libroVar = () => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('📦 Cantidad', CAB_CANT_FULL, [
    ['Camiseta', 'CAM-01', 'Vitrina 2', 'Ropa', 'Talla M', 'Rojo',  5, 1, 12000, 30000, 'unidad', 'Textiles', '', 'algodón'],
    ['Camiseta', 'CAM-01', 'Vitrina 2', 'Ropa', 'Talla M', 'Azul',  3, 1, 12000, 30000, 'unidad', 'Textiles', '', ''],
    ['Camiseta', 'CAM-01', 'Vitrina 2', 'Ropa', 'Talla L', '',      7, 1, 13000, 32000, 'unidad', 'Textiles', '', ''],
  ]),
}]);
await importar(libroVar(), { sucursalId: 1, negocioId: 1 });

const prod = (await q(`SELECT id, stock, codigo, ubicacion, nota FROM productos_cantidad
                       WHERE sucursal_id=1 AND nombre='Camiseta'`))[0];
check('stock del producto = suma de sus atributos', prod.stock, 15);
check('código aplicado', prod.codigo, 'CAM-01');
check('ubicación aplicada', prod.ubicacion, 'Vitrina 2');
check('nota aplicada', prod.nota, 'algodón');

const atrs = await q(`SELECT valor, stock, costo_unitario::float c FROM atributos_producto
                      WHERE producto_id=$1 ORDER BY valor`, [prod.id]);
check('atributos con su stock', atrs.map((a) => [a.valor, a.stock]), [['Talla L', 7], ['Talla M', 8]]);
check('atributos CON costo (antes se perdía)', atrs.map((a) => a.c), [13000, 12000]);

const vars = await q(`SELECT v.valor, v.stock, v.costo_unitario::float c FROM variantes_atributo v
                      JOIN atributos_producto a ON a.id = v.atributo_id
                      WHERE a.producto_id=$1 ORDER BY v.valor`, [prod.id]);
check('variantes con su stock', vars.map((v) => [v.valor, v.stock]), [['Azul', 3], ['Rojo', 5]]);
check('variantes CON costo (antes se perdía)', vars.map((v) => v.c), [12000, 12000]);

// ═════════════════════════════════════════════════════════════════════════════
seccion('8. MISMAS COLUMNAS CON LAS FEATURES APAGADAS');
// ═════════════════════════════════════════════════════════════════════════════
await setConfig(1, TODO_APAGADO);
await importar(libroVar(), { sucursalId: 2, negocioId: 1 });

const prodOff = (await q(`SELECT id, stock, codigo, ubicacion FROM productos_cantidad
                          WHERE sucursal_id=2 AND nombre='Camiseta'`))[0];
check('sin variantes: el stock va directo al producto (5+3+7)', prodOff.stock, 15);
check('sin la feature de ubicación, no se escribe', prodOff.ubicacion, null);
check('no se crearon atributos',
  (await q(`SELECT COUNT(*)::int n FROM atributos_producto WHERE producto_id=$1`, [prodOff.id]))[0].n, 0);

const prevOff = await analizar(libroVar(), { sucursalId: 2, negocioId: 1 });
checkQue('avisa que el archivo trae columnas de una feature apagada',
  hayTipo(prevOff.body.data.informe.avisos, 'codigo_no_aplicado'),
  JSON.stringify(tipos(prevOff.body.data.informe.avisos)));

// Color y características con la feature apagada
await importar(
  libro([{ nombre: 'Tablet A', ws: hoja('📦  Tablet A — Hoja de Seriales', CAB_SERIAL_FULL,
    [['IMEI-900', '', '', '', '', '', 'Negro', '80%', 'Ana', 'Bodega', '', '', '', '']]) }]),
  { sucursalId: 3, negocioId: 1 }
);
const serOff = (await q(`SELECT color, caracteristicas FROM seriales WHERE imei='IMEI-900'`))[0];
check('con colores apagados, el color no se guarda', serOff.color, null);
check('con características apagadas, no se guarda el JSON', serOff.caracteristicas, null);

// ═════════════════════════════════════════════════════════════════════════════
seccion('9. CÓDIGO ÚNICO — herencia entre sedes y conflictos');
// ═════════════════════════════════════════════════════════════════════════════
await setConfig(1, TODO_ENCENDIDO);

// El mismo producto, en otra sucursal, SIN código en el Excel → lo hereda.
await importar(
  libro([{ nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_SIMPLE, [
    ['Camiseta', 'Ropa', 2, 0, 12000, 30000, 'unidad', '', '', ''],
  ]) }]),
  { sucursalId: 3, negocioId: 1 }
);
check('el código se heredó a la otra sucursal',
  (await q(`SELECT codigo FROM productos_cantidad WHERE sucursal_id=3 AND nombre='Camiseta'`))[0].codigo, 'CAM-01');

// Un código ya tomado por OTRO producto → conflicto, la fila se omite.
const rc = await importar(
  libro([{ nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_FULL, [
    ['Otro Producto', 'CAM-01', '', '', '', '', 1, 0, '', '', '', '', '', ''],
  ]) }]),
  { sucursalId: 1, negocioId: 1 }
);
check('código en uso por otro producto = conflicto', tipos(rc.body.data.informe.conflictos), ['codigo_en_uso']);
check('el producto no se creó',
  (await q(`SELECT COUNT(*)::int n FROM productos_cantidad WHERE nombre='Otro Producto'`))[0].n, 0);

// El mismo código para dos productos distintos DENTRO del archivo.
const rc2 = await importar(
  libro([{ nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_FULL, [
    ['Producto A', 'DUP-9', '', '', '', '', 1, 0, '', '', '', '', '', ''],
    ['Producto B', 'DUP-9', '', '', '', '', 1, 0, '', '', '', '', '', ''],
  ]) }]),
  { sucursalId: 1, negocioId: 1 }
);
check('mismo código, dos productos en el archivo = conflicto',
  tipos(rc2.body.data.informe.conflictos), ['codigo_duplicado_archivo']);
check('el primero sí entró', (await q(`SELECT COUNT(*)::int n FROM productos_cantidad WHERE nombre='Producto A'`))[0].n, 1);
check('el segundo no', (await q(`SELECT COUNT(*)::int n FROM productos_cantidad WHERE nombre='Producto B'`))[0].n, 0);

// Código heredado que choca con el índice único: el producto DEBE importarse igual.
await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, codigo, stock) VALUES (2, 'Bloqueador', 'HER-1', 1)`);
await q(`INSERT INTO productos_cantidad (sucursal_id, nombre, codigo, stock) VALUES (1, 'Heredable', 'HER-1', 1)`);
const rc3 = await importar(
  libro([{ nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_SIMPLE, [
    ['Heredable', '', 3, 0, '', '', '', '', '', ''],
  ]) }]),
  { sucursalId: 2, negocioId: 1 }
);
check('el producto se importó pese al choque de código', rc3.body.data.resumen.productos_nuevos, 1);
checkQue('y se avisó que el código no se pudo aplicar',
  hayTipo(rc3.body.data.informe.avisos, 'codigo_no_aplicado'),
  JSON.stringify(tipos(rc3.body.data.informe.avisos)));
check('el producto que ya tenía el código conserva el suyo',
  (await q(`SELECT codigo FROM productos_cantidad WHERE sucursal_id=2 AND nombre='Bloqueador'`))[0].codigo, 'HER-1');

// ═════════════════════════════════════════════════════════════════════════════
seccion('10. HOJAS BASURA Y HOJA PLANA');
// ═════════════════════════════════════════════════════════════════════════════
const serialesAntes = (await q('SELECT COUNT(*)::int n FROM productos_serial'))[0].n;
const rh = await importar(libro([
  { nombre: 'Hoja1',    ws: hoja('Mis apuntes', ['Cosa', 'Otra'], [['a', 'b']]) },
  { nombre: 'Resumen',  ws: hoja('Totales', ['Concepto', 'Valor'], [['ventas', 100]]) },
  { nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_SIMPLE, [
    ['Producto Real', 'Accesorios', 1, 0, '', '', '', '', '', ''],
  ]) },
]), { sucursalId: 1, negocioId: 1 });

check('no se crearon productos fantasma desde hojas sin IMEI',
  (await q('SELECT COUNT(*)::int n FROM productos_serial'))[0].n, serialesAntes);
check('las hojas ignoradas se reportan', rh.body.data.informe.hojas_ignoradas.sort(), ['Hoja1', 'Resumen']);
check('el producto real sí entró', rh.body.data.resumen.productos_nuevos, 1);

// Hoja de seriales legítima pero vacía: SÍ debe crear el producto (es a propósito).
await importar(
  libro([{ nombre: 'Modelo Sin Stock', ws: hoja('📦  Modelo Sin Stock — Hoja de Seriales', CAB_SERIAL_MIN, []) }]),
  { sucursalId: 1, negocioId: 1 }
);
check('una hoja de seriales vacía sí crea la referencia',
  (await q(`SELECT COUNT(*)::int n FROM productos_serial WHERE nombre='Modelo Sin Stock'`))[0].n, 1);

// Varias hojas de producto en el MISMO libro: es el formato oficial cuando el
// negocio da de alta varios modelos a la vez.
const rp = await importar(libro([
  { nombre: 'Xiaomi A3', ws: hoja('📦  Xiaomi A3 — Hoja de Seriales', CAB_SERIAL_MIN, [
    ['PL-1', '', '', '', '', '', '', '', '', ''],
    ['PL-2', '', '', '', '', '', '', '', '', ''],
  ]) },
  { nombre: 'Moto G54', ws: hoja('📦  Moto G54 — Hoja de Seriales', CAB_SERIAL_MIN, [
    ['PL-3', '', '', '', '', '', '', '', '', ''],
  ]) },
]), { sucursalId: 1, negocioId: 1 });
check('varias hojas: 3 seriales importados', rp.body.data.resumen.seriales_nuevos, 3);
check('varias hojas: 2 productos', rp.body.data.resumen.productos_serial, 2);
check('Xiaomi A3 quedó con 2 IMEI',
  (await q(`SELECT COUNT(*)::int n FROM seriales s JOIN productos_serial p ON p.id=s.producto_id
            WHERE p.nombre='Xiaomi A3'`))[0].n, 2);
check('Moto G54 quedó con 1 IMEI',
  (await q(`SELECT COUNT(*)::int n FROM seriales s JOIN productos_serial p ON p.id=s.producto_id
            WHERE p.nombre='Moto G54'`))[0].n, 1);

// ═════════════════════════════════════════════════════════════════════════════
seccion('11. NÚMEROS Y FECHAS COMO LOS ESCRIBE LA GENTE');
// ═════════════════════════════════════════════════════════════════════════════
const rn = await importar(
  libro([{ nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_SIMPLE, [
    ['Precio con puntos', 'Accesorios', 3, 0, '1.500',     '12.000',  '', '', '', ''],
    ['Precio con comas',  'Accesorios', 3, 0, '1,500',     '12,000',  '', '', '', ''],
    ['Precio mixto',      'Accesorios', 3, 0, '1.500,50',  '12000',   '', '', '', ''],
  ]) }]),
  { sucursalId: 1, negocioId: 1 }
);
check('las 3 filas entraron', rn.body.data.resumen.productos_nuevos, 3);
const nums = await q(`SELECT nombre, costo_unitario::float c, precio::float p FROM productos_cantidad
                      WHERE sucursal_id=1 AND nombre LIKE 'Precio%' ORDER BY nombre`);
check('"1,500" → 1500', nums.find((r) => r.nombre === 'Precio con comas').c, 1500);
check('"1.500" → 1500', nums.find((r) => r.nombre === 'Precio con puntos').c, 1500);
check('"1.500,50" → 1500.5', nums.find((r) => r.nombre === 'Precio mixto').c, 1500.5);
check('"12.000" → 12000', nums.find((r) => r.nombre === 'Precio con puntos').p, 12000);

const rf = await importar(
  libro([{ nombre: 'Reloj Z', ws: hoja('📦  Reloj Z — Hoja de Seriales', CAB_SERIAL_MIN, [
    ['FECHA-1', '32/13/2026', '', '', '', '', '', '', '', ''],
  ]) }]),
  { sucursalId: 1, negocioId: 1 }
);
checkQue('una fecha imposible se avisa (antes caía a hoy en silencio)',
  hayTipo(rf.body.data.informe.avisos, 'fecha_no_reconocida'),
  JSON.stringify(tipos(rf.body.data.informe.avisos)));

// ═════════════════════════════════════════════════════════════════════════════
seccion('12. AVISOS DE COSTO — informan, nunca bloquean');
// ═════════════════════════════════════════════════════════════════════════════
const rcosto = await importar(
  libro([{ nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_SIMPLE, [
    ['Sin Costo Uno', 'Accesorios', 5, 0, '', 9000, '', '', '', ''],
  ]) }]),
  { sucursalId: 1, negocioId: 1 }
);
check('el producto sin costo SÍ se importa', rcosto.body.data.resumen.productos_nuevos, 1);
check('no es conflicto', rcosto.body.data.informe.conflictos.length, 0);
checkQue('es un aviso, y menciona las tarifas porque están activas',
  hayTipo(rcosto.body.data.informe.avisos, 'sin_costo_con_tarifas'),
  JSON.stringify(tipos(rcosto.body.data.informe.avisos)));

await setConfig(1, TODO_APAGADO);
const rcosto2 = await analizar(
  libro([{ nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_SIMPLE, [
    ['Sin Costo Dos', 'Accesorios', 5, 0, '', 9000, '', '', '', ''],
  ]) }]),
  { sucursalId: 1, negocioId: 1 }
);
checkQue('sin tarifas, el aviso es el genérico',
  hayTipo(rcosto2.body.data.informe.avisos, 'sin_costo'),
  JSON.stringify(tipos(rcosto2.body.data.informe.avisos)));

// ═════════════════════════════════════════════════════════════════════════════
seccion('13. EL PREVIEW NO ESCRIBE, NI SIQUIERA CON ERRORES DE POR MEDIO');
// ═════════════════════════════════════════════════════════════════════════════
const foto = async () => ({
  pc:  (await q('SELECT COUNT(*)::int n FROM productos_cantidad'))[0].n,
  ps:  (await q('SELECT COUNT(*)::int n FROM productos_serial'))[0].n,
  ser: (await q('SELECT COUNT(*)::int n FROM seriales'))[0].n,
  atr: (await q('SELECT COUNT(*)::int n FROM atributos_producto'))[0].n,
  var: (await q('SELECT COUNT(*)::int n FROM variantes_atributo'))[0].n,
  prov:(await q('SELECT COUNT(*)::int n FROM proveedores'))[0].n,
  lin: (await q('SELECT COUNT(*)::int n FROM lineas_producto'))[0].n,
  st:  (await q('SELECT COALESCE(SUM(stock),0)::int n FROM productos_cantidad'))[0].n,
});
await setConfig(1, TODO_ENCENDIDO);
const antes = await foto();
await analizar(libro([
  { nombre: 'Mixto',  ws: hoja('📦  Mixto — Hoja de Seriales', CAB_SERIAL_FULL, [
    ['IMEI-001', '', '', '', '', '', '', '', '', '', '', '', '', ''],   // conflicto: otra sede… no, misma
    ['NUEVO-1',  '', 'Proveedor Fantasma', '', '', 'Linea Fantasma', '', '', '', '', '', '', '', ''],
  ]) },
  { nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_FULL, [
    ['Producto Fantasma', 'FAN-1', 'X', 'Linea Fantasma', 'A', 'B', 9, 0, 1, 2, '', 'Proveedor Fantasma', '', ''],
    ['',                  '',      '',  '',               '',  '',  1, 0, '', '', '', '', '', ''],
  ]) },
]), { sucursalId: 1, negocioId: 1 });
const despues = await foto();
check('nada cambió tras el preview', despues, antes);

// ═════════════════════════════════════════════════════════════════════════════
seccion('14. EL PREVIEW PROMETE LO MISMO QUE HACE LA CORRIDA REAL');
// ═════════════════════════════════════════════════════════════════════════════
const libroFinal = () => libro([
  { nombre: 'Tablet Pro', ws: hoja('📦  Tablet Pro — Hoja de Seriales', CAB_SERIAL_FULL, [
    ['FIN-1', '01/02/2026', 'Prov Final', 'Sam', 'X', 'Tabletas', 'Azul', '90%', 'Luis', 'Est 9', 100, 50, '', 'n'],
    ['FIN-2', '01/02/2026', 'Prov Final', 'Sam', 'X', 'Tabletas', 'Azul', '90%', 'Luis', 'Est 9', 100, 50, '', 'n'],
    ['IMEI-001', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]) },
  { nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_FULL, [
    ['Cable USB-C', '', '', 'Accesorios', '', '', 4, 0, 5000, 12000, '', '', '', ''],
    ['Nuevo Final', 'NF-1', 'Est 1', 'Accesorios', '', '', 6, 0, 1000, 2000, '', 'Prov Final', '', ''],
  ]) },
]);

const pf = await analizar(libroFinal(), { sucursalId: 1, negocioId: 1 });
const rf2 = await importar(libroFinal(), { sucursalId: 1, negocioId: 1 });
check('resumen idéntico entre preview y aplicación', rf2.body.data.resumen, pf.body.data.resumen);
check('mismos conflictos', tipos(rf2.body.data.informe.conflictos), tipos(pf.body.data.informe.conflictos));
check('mismos avisos', tipos(rf2.body.data.informe.avisos), tipos(pf.body.data.informe.avisos));

// ═════════════════════════════════════════════════════════════════════════════
seccion('15. INTEGRIDAD FINAL — nadie se pisó con nadie');
// ═════════════════════════════════════════════════════════════════════════════
const porSucursal = await q(`
  SELECT su.negocio_id, pc.sucursal_id, COUNT(*)::int productos
  FROM productos_cantidad pc JOIN sucursales su ON su.id = pc.sucursal_id
  GROUP BY 1,2 ORDER BY 1,2`);
console.log('  productos por sucursal:', JSON.stringify(porSucursal));

const imeiCruzado = await q(`
  SELECT s.imei, COUNT(DISTINCT ps.sucursal_id)::int sedes
  FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
  JOIN sucursales su ON su.id = ps.sucursal_id
  WHERE su.negocio_id = 1
  GROUP BY 1 HAVING COUNT(DISTINCT ps.sucursal_id) > 1`);
check('ningún IMEI quedó en dos sedes del mismo negocio', imeiCruzado, []);

// 'HER-1' lo sembró a mano la sección 9 para provocar el choque de herencia:
// es un estado inconsistente PREEXISTENTE, del tipo que puede haber en
// producción. Lo que se verifica es que el importador no haya creado ninguno
// nuevo y que no haya "arreglado" el sembrado pisando datos ajenos.
const codigosMal = await q(`
  SELECT pc.codigo FROM productos_cantidad pc JOIN sucursales su ON su.id=pc.sucursal_id
  WHERE su.negocio_id=1 AND pc.codigo IS NOT NULL AND pc.activo
  GROUP BY pc.codigo HAVING COUNT(DISTINCT LOWER(pc.nombre)) > 1
  ORDER BY 1`);
check('el importador no creó ningún código ambiguo (solo queda el sembrado a mano)',
  codigosMal.map((r) => r.codigo), ['HER-1']);
check('el producto que ya tenía HER-1 en su sucursal lo conserva',
  (await q(`SELECT codigo FROM productos_cantidad WHERE sucursal_id=2 AND nombre='Bloqueador'`))[0].codigo, 'HER-1');
check('el importado quedó sin código, como avisó el informe',
  (await q(`SELECT codigo FROM productos_cantidad WHERE sucursal_id=2 AND nombre='Heredable'`))[0].codigo, null);

const negocioAjeno = await q(`SELECT COUNT(*)::int n FROM productos_cantidad WHERE sucursal_id = 4`);
check('el negocio ajeno no recibió productos por accidente', negocioAjeno[0].n, 0);

// ═════════════════════════════════════════════════════════════════════════════
seccion('16. IDA Y VUELTA REAL — descargar la plantilla, llenarla y subirla');
// ═════════════════════════════════════════════════════════════════════════════
//
// Es la prueba que más se parece a lo que hace una persona, y la que ninguna
// otra cubre: que el .xlsx que el sistema ENTREGA sea exactamente el que el
// sistema SABE LEER. Si la plantilla y el parser se desincronizan (una columna
// renombrada, una fila de más en la cabecera), todo lo demás sigue en verde y
// el usuario no puede importar nada.

const descargar = async (negocioId) => {
  const req = { user: { negocio_id: negocioId } };
  let buffer = null;
  const res = { setHeader() {}, end(b) { buffer = b; } };
  await ctrl.generarPlantilla(req, res, (e) => { throw e; });
  return buffer;
};

const normClaveTest = (c) => String(c ?? '')
  .replace(/\s*\*\s*/g, '').trim().toLowerCase().replace(/\s+/g, '_');

// Llena la plantilla como lo haría una persona: mira los títulos de la fila 2 y
// escribe debajo. Nunca asume posiciones de columna.
const llenar = (wb, nombreHoja, filas) => {
  const ws = wb.Sheets[nombreHoja];
  const cabeceras = XLSX.utils.sheet_to_json(ws, { header: 1, range: 1 })[0] || [];
  filas.forEach((obj, i) => {
    cabeceras.forEach((cab, c) => {
      const v = obj[normClaveTest(cab)];
      if (v !== undefined && v !== '') {
        XLSX.utils.sheet_add_aoa(ws, [[v]], { origin: { r: 3 + i, c } });
      }
    });
  });
  return cabeceras.map(normClaveTest);
};

// ── Con TODO apagado ─────────────────────────────────────────────────────────
await setConfig(1, TODO_APAGADO);
const plantillaOff = XLSX.read(await descargar(1), { type: 'buffer', cellDates: true });
check('plantilla (features off): hojas',
  plantillaOff.SheetNames,
  ['Instrucciones', 'Ejemplo Producto', 'Productos Cantidad', 'Referencia']);

const cabsOff = llenar(plantillaOff, 'Productos Cantidad', [
  { nombre: 'Teclado RT', linea: 'Accesorios', stock: 6, costo_unitario: 20000, precio_venta: 45000, nota: 'del kit' },
]);
checkQue('sin features, la hoja de cantidad NO trae Codigo/Ubicacion/Atributo',
  !cabsOff.includes('codigo') && !cabsOff.includes('ubicacion') && !cabsOff.includes('atributo'),
  JSON.stringify(cabsOff));
checkQue('pero sí trae la columna Nota (nueva)', cabsOff.includes('nota'), JSON.stringify(cabsOff));

const rt1 = await importar(
  XLSX.write(plantillaOff, { type: 'buffer', bookType: 'xlsx' }),
  { sucursalId: 3, negocioId: 1 }
);
check('la plantilla descargada se importa sin conflictos', rt1.body.data.informe.conflictos.length, 0);
check('el producto entró', rt1.body.data.resumen.productos_nuevos, 1);
check('las hojas de ejemplo vacías no crearon nada',
  rt1.body.data.resumen.seriales_nuevos, 0);
const rtProd = (await q(`SELECT stock, costo_unitario::float c, nota FROM productos_cantidad
                         WHERE sucursal_id=3 AND nombre='Teclado RT'`))[0];
check('con los valores correctos', [rtProd.stock, rtProd.c, rtProd.nota], [6, 20000, 'del kit']);

// ── Con TODO encendido ───────────────────────────────────────────────────────
await setConfig(1, TODO_ENCENDIDO);
const plantillaOn = XLSX.read(await descargar(1), { type: 'buffer', cellDates: true });

const cabsCantOn = llenar(plantillaOn, 'Productos Cantidad', [
  { nombre: 'Gorra Pro', codigo: 'GOR-9', ubicacion: 'Vitrina 1', linea: 'Ropa',
    atributo: 'Talla U', variante: 'Negra', stock: 4, costo_unitario: 8000, precio_venta: 20000 },
]);
checkQue('con features, aparecen Codigo, Ubicacion, Atributo y Variante',
  ['codigo', 'ubicacion', 'atributo', 'variante'].every((c) => cabsCantOn.includes(c)),
  JSON.stringify(cabsCantOn));

// El usuario renombra la pestaña de ejemplo, como dicen las instrucciones.
plantillaOn.SheetNames[plantillaOn.SheetNames.indexOf('Ejemplo Producto')] = 'Redmi Note 15';
plantillaOn.Sheets['Redmi Note 15'] = plantillaOn.Sheets['Ejemplo Producto'];
delete plantillaOn.Sheets['Ejemplo Producto'];
XLSX.utils.sheet_add_aoa(plantillaOn.Sheets['Redmi Note 15'],
  [['📦  Redmi Note 15 — Hoja de Seriales']], { origin: 'A1' });

const cabsSerOn = llenar(plantillaOn, 'Redmi Note 15', [
  { imei: 'RT-100', fecha_entrada: '02/01/2026', marca: 'Xiaomi', linea: 'Celulares',
    color: 'Negro', bateria: '100%', tecnico: 'Ana', ubicacion: 'Est 4',
    precio: 900000, costo_compra: 700000, nota: 'sellado' },
  { imei: 'RT-101', color: 'Azul', costo_compra: 700000 },
]);
checkQue('la hoja de seriales trae Color, las características y Nota',
  ['color', 'bateria', 'tecnico', 'nota', 'ubicacion'].every((c) => cabsSerOn.includes(c)),
  JSON.stringify(cabsSerOn));

// Y agrega una segunda hoja de producto a mano, como dicen las instrucciones.
XLSX.utils.book_append_sheet(plantillaOn,
  XLSX.utils.aoa_to_sheet([
    ['📦  Realme C75 — Hoja de Seriales'],
    cabsSerOn.map((c) => c),           // mismas claves que la hoja de la plantilla
    cabsSerOn.map(() => 'descripción'),
    ['RT-200', '', '', '', '', '', '', '', '', '', '', '', 400000, '', ''],
    ['RT-201', '', '', '', '', '', '', '', '', '', '', '', 400000, '', ''],
  ]),
  'Realme C75');

const bufferOn = XLSX.write(plantillaOn, { type: 'buffer', bookType: 'xlsx' });
const prevOn = await analizar(bufferOn, { sucursalId: 3, negocioId: 1 });
const rt2 = await importar(bufferOn, { sucursalId: 3, negocioId: 1 });

check('preview y aplicación coinciden en el ida y vuelta', rt2.body.data.resumen, prevOn.body.data.resumen);
check('sin conflictos', rt2.body.data.informe.conflictos.length, 0);
check('4 seriales, repartidos en las 2 hojas de producto', rt2.body.data.resumen.seriales_nuevos, 4);
check('1 producto por cantidad', rt2.body.data.resumen.productos_nuevos, 1);

const gorra = (await q(`SELECT id, stock, codigo, ubicacion FROM productos_cantidad
                        WHERE sucursal_id=3 AND nombre='Gorra Pro'`))[0];
check('la variante se armó bien', [gorra.stock, gorra.codigo, gorra.ubicacion], [4, 'GOR-9', 'Vitrina 1']);
check('y con costo hasta la variante',
  (await q(`SELECT v.costo_unitario::float c FROM variantes_atributo v
            JOIN atributos_producto a ON a.id=v.atributo_id WHERE a.producto_id=$1`, [gorra.id]))[0].c, 8000);

const redmi = await q(`SELECT s.imei, s.color, s.caracteristicas, s.nota,
                              TO_CHAR(s.fecha_entrada,'YYYY-MM-DD') f
                       FROM seriales s JOIN productos_serial p ON p.id=s.producto_id
                       WHERE p.nombre='Redmi Note 15' ORDER BY s.imei`);
check('los 2 IMEI del producto renombrado', redmi.map((r) => r.imei), ['RT-100', 'RT-101']);
check('color leído de la plantilla', redmi.map((r) => r.color), ['Negro', 'Azul']);
check('características leídas de la plantilla', redmi[0].caracteristicas, { Bateria: '100%', Tecnico: 'Ana' });
check('fecha de la plantilla', redmi[0].f, '2026-01-02');
check('nota de la plantilla', redmi[0].nota, 'sellado');
check('la segunda hoja de producto entró completa',
  (await q(`SELECT COUNT(*)::int n FROM seriales s JOIN productos_serial p ON p.id=s.producto_id
            WHERE p.nombre='Realme C75'`))[0].n, 2);
check('la hoja Referencia no se interpretó como producto',
  (await q(`SELECT COUNT(*)::int n FROM productos_serial WHERE nombre ILIKE '%referencia%'`))[0].n, 0);
check('la hoja Instrucciones tampoco',
  (await q(`SELECT COUNT(*)::int n FROM productos_serial WHERE nombre ILIKE '%instruccion%'`))[0].n, 0);

// ── La plantilla sin renombrar avisa ─────────────────────────────────────────
const plantillaSinTocar = XLSX.read(await descargar(1), { type: 'buffer', cellDates: true });
llenar(plantillaSinTocar, 'Ejemplo Producto', [{ imei: 'SIN-RENOMBRAR-1' }]);
const rt3 = await analizar(
  XLSX.write(plantillaSinTocar, { type: 'buffer', bookType: 'xlsx' }),
  { sucursalId: 3, negocioId: 1 }
);
check('sin datos importables responde 400', rt3.status, 400);
checkQue('y explica que la hoja de ejemplo no se renombró',
  hayTipo(rt3.body.informe?.avisos, 'hoja_ignorada'),
  JSON.stringify(rt3.body));
checkQue('el mensaje de error nombra la hoja descartada',
  rt3.body.error.includes('Ejemplo Producto'), rt3.body.error);

// ═════════════════════════════════════════════════════════════════════════════
seccion('16b. CARACTERÍSTICA QUE SE LLAMA IGUAL QUE UNA COLUMNA FIJA');
// ═════════════════════════════════════════════════════════════════════════════
//
// Configuración real del negocio 4 en producción: colores de serial activos Y
// una característica llamada «Color». Son dos cosas distintas y las dos son
// legítimas, pero sin desambiguar producían dos columnas «Color» en la misma
// hoja: SheetJS renombra la segunda a `Color_1`, nadie la lee, y lo que el
// usuario escriba ahí se pierde en silencio.
await setConfig(1, {
  ...TODO_ENCENDIDO,
  colores_serial_activo: '1',
  colores_serial_lista: JSON.stringify(['Negro', 'Azul']),
  caracteristicas_serial_activo: '1',
  caracteristicas_serial_lista: JSON.stringify(['bateria', 'Color', 'Tecnico']),
});

const plantillaChoque = XLSX.read(await descargar(1), { type: 'buffer', cellDates: true });
const cabsChoque = (XLSX.utils.sheet_to_json(plantillaChoque.Sheets['Ejemplo Producto'],
  { header: 1, range: 1 })[0] || []).map(normClaveTest);
check('no hay claves de columna repetidas',
  cabsChoque.filter((c, i) => cabsChoque.indexOf(c) !== i), []);
checkQue('la característica quedó desambiguada',
  cabsChoque.includes('color') && cabsChoque.includes('color_(caract.)'), JSON.stringify(cabsChoque));

plantillaChoque.SheetNames[plantillaChoque.SheetNames.indexOf('Ejemplo Producto')] = 'Equipo Choque';
plantillaChoque.Sheets['Equipo Choque'] = plantillaChoque.Sheets['Ejemplo Producto'];
delete plantillaChoque.Sheets['Ejemplo Producto'];
XLSX.utils.sheet_add_aoa(plantillaChoque.Sheets['Equipo Choque'],
  [['📦  Equipo Choque — Hoja de Seriales']], { origin: 'A1' });
llenar(plantillaChoque, 'Equipo Choque', [
  { imei: 'CHOQUE-1', color: 'Negro', 'color_(caract.)': 'Rojo vino', bateria: '88%', tecnico: 'Sara' },
]);

await importar(XLSX.write(plantillaChoque, { type: 'buffer', bookType: 'xlsx' }),
  { sucursalId: 3, negocioId: 1 });
const choque = (await q(`SELECT color, caracteristicas FROM seriales WHERE imei='CHOQUE-1'`))[0];
check('el color de la FEATURE se guarda aparte', choque.color, 'Negro');
checkMapa('y la característica «Color» conserva su propio valor',
  choque.caracteristicas, { bateria: '88%', Color: 'Rojo vino', Tecnico: 'Sara' });

// Compatibilidad: una plantilla vieja (una sola columna «Color») se sigue leyendo.
const rVieja = await importar(
  libro([{ nombre: 'Equipo Viejo', ws: hoja('📦  Equipo Viejo — Hoja de Seriales',
    ['IMEI *', 'Color', 'bateria', 'Tecnico'],
    [['VIEJA-1', 'Azul', '70%', 'Luis']]) }]),
  { sucursalId: 3, negocioId: 1 }
);
check('plantilla antigua: sin conflictos', rVieja.body.data.informe.conflictos.length, 0);
const vieja = (await q(`SELECT color, caracteristicas FROM seriales WHERE imei='VIEJA-1'`))[0];
check('plantilla antigua: la feature de color sigue leyendo', vieja.color, 'Azul');
checkMapa('plantilla antigua: la característica cae en la misma columna, como siempre',
  vieja.caracteristicas, { bateria: '70%', Color: 'Azul', Tecnico: 'Luis' });

// ═════════════════════════════════════════════════════════════════════════════
seccion('17. UN NEGOCIO, TRES SUCURSALES — aritmética de stock exacta');
// ═════════════════════════════════════════════════════════════════════════════
//
// Negocio limpio y aparte para poder afirmar números exactos, no diferencias.
// Es el escenario que de verdad importa: una cadena dando de alta el mismo
// catálogo en todas sus sedes.
await db.exec(`
  INSERT INTO negocios (id, nombre) VALUES (3, 'Cadena Tres Sedes');
  INSERT INTO sucursales (id, negocio_id, nombre) VALUES
    (10, 3, 'Norte'), (11, 3, 'Centro'), (12, 3, 'Sur');
  SELECT setval('negocios_id_seq', 3);
  SELECT setval('sucursales_id_seq', 12);
`);
await setConfig(3, { ...TODO_ENCENDIDO, tarifas_activo: '0' });

const SEDES = [{ id: 10, nombre: 'Norte' }, { id: 11, nombre: 'Centro' }, { id: 12, nombre: 'Sur' }];

// Catálogo idéntico para las tres, con cantidades distintas por sede.
const catalogo = (stocks) => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('📦', CAB_CANT_FULL, [
    ['Cargador 20W',  'CG-20', 'Est A', 'Accesorios', '', '', stocks[0], 2, 8000,  20000, 'unidad', 'Mayorista', '', ''],
    ['Vidrio 15 Pro', 'VD-15', 'Est B', 'Accesorios', '', '', stocks[1], 3, 2500,  9000,  'unidad', 'Mayorista', '', ''],
    ['Forro Silicona', 'FR-01', 'Est C', 'Accesorios', '', '', stocks[2], 1, 4000,  15000, 'unidad', 'Mayorista', '', ''],
  ]),
}]);

const esperado = {
  10: [50, 80, 30],
  11: [12, 25, 9],
  12: [7,  0,  100],
};

for (const sede of SEDES) {
  const r = await importar(catalogo(esperado[sede.id]), { sucursalId: sede.id, negocioId: 3 });
  check(`${sede.nombre}: 3 productos nuevos`, r.body.data.resumen.productos_nuevos, 3);
  check(`${sede.nombre}: sin conflictos`, r.body.data.informe.conflictos.length, 0);
}

// Stock exacto por sede, producto a producto.
for (const sede of SEDES) {
  const filas = await q(
    `SELECT nombre, stock, stock_minimo, costo_unitario::float c, precio::float p, codigo, ubicacion
     FROM productos_cantidad WHERE sucursal_id = $1 ORDER BY nombre`, [sede.id]);
  check(`${sede.nombre}: stocks exactos`,
    filas.map((f) => f.stock),
    [esperado[sede.id][0], esperado[sede.id][2], esperado[sede.id][1]]); // orden alfabético: Cargador, Forro, Vidrio
  check(`${sede.nombre}: costos iguales en todas las sedes`, filas.map((f) => f.c), [8000, 4000, 2500]);
  check(`${sede.nombre}: mismo código lógico en todas`, filas.map((f) => f.codigo), ['CG-20', 'FR-01', 'VD-15']);
  check(`${sede.nombre}: ubicación propia de la sede`, filas.map((f) => f.ubicacion), ['Est A', 'Est C', 'Est B']);
}

check('total del negocio = suma de las tres sedes',
  (await q(`SELECT SUM(stock)::int s FROM productos_cantidad pc JOIN sucursales su ON su.id=pc.sucursal_id
            WHERE su.negocio_id=3`))[0].s,
  Object.values(esperado).flat().reduce((a, b) => a + b, 0));
check('9 filas en total (3 productos × 3 sedes)',
  (await q(`SELECT COUNT(*)::int n FROM productos_cantidad pc JOIN sucursales su ON su.id=pc.sucursal_id
            WHERE su.negocio_id=3`))[0].n, 9);
check('un solo proveedor, compartido', (await q(`SELECT COUNT(*)::int n FROM proveedores WHERE negocio_id=3`))[0].n, 1);
check('una sola línea, compartida', (await q(`SELECT COUNT(*)::int n FROM lineas_producto WHERE negocio_id=3`))[0].n, 1);

// ── Reponer stock SOLO en Centro: las otras dos no se pueden mover ───────────
const fotoSedes = async () => Object.fromEntries(await Promise.all(SEDES.map(async (s) => [
  s.id, (await q(`SELECT SUM(stock)::int t FROM productos_cantidad WHERE sucursal_id=$1`, [s.id]))[0].t,
])));
const antesReposicion = await fotoSedes();

const rRepo = await importar(
  libro([{ nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_SIMPLE, [
    ['Cargador 20W', 'Accesorios', 100, 0, '', '', '', '', '', ''],
  ]) }]),
  { sucursalId: 11, negocioId: 3 }
);
check('reposición: 0 nuevos, 1 actualizado',
  [rRepo.body.data.resumen.productos_nuevos, rRepo.body.data.resumen.productos_actualizados], [0, 1]);

const despuesReposicion = await fotoSedes();
check('Norte no se movió', despuesReposicion[10], antesReposicion[10]);
check('Sur no se movió',   despuesReposicion[12], antesReposicion[12]);
check('Centro subió exactamente 100', despuesReposicion[11], antesReposicion[11] + 100);
check('el Cargador de Centro quedó en 112',
  (await q(`SELECT stock FROM productos_cantidad WHERE sucursal_id=11 AND nombre='Cargador 20W'`))[0].stock, 112);
check('el Cargador de Norte sigue en 50',
  (await q(`SELECT stock FROM productos_cantidad WHERE sucursal_id=10 AND nombre='Cargador 20W'`))[0].stock, 50);

// ── Variantes en dos sedes distintas ────────────────────────────────────────
const libroVariantes = (m, l) => libro([{ nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_FULL, [
  ['Camisa Polo', '', '', 'Ropa', 'Talla M', 'Blanca', m, 1, 15000, 40000, '', '', '', ''],
  ['Camisa Polo', '', '', 'Ropa', 'Talla L', 'Blanca', l, 1, 16000, 42000, '', '', '', ''],
]) }]);

await importar(libroVariantes(6, 4),  { sucursalId: 10, negocioId: 3 });
await importar(libroVariantes(20, 15), { sucursalId: 12, negocioId: 3 });

const polo = async (sucursalId) => {
  const p = (await q(`SELECT id, stock FROM productos_cantidad WHERE sucursal_id=$1 AND nombre='Camisa Polo'`, [sucursalId]))[0];
  const atr = await q(`SELECT valor, stock, costo_unitario::float c FROM atributos_producto
                       WHERE producto_id=$1 ORDER BY valor`, [p.id]);
  return { total: p.stock, atributos: atr.map((a) => [a.valor, a.stock]), costos: atr.map((a) => a.c) };
};
const poloNorte = await polo(10);
const poloSur   = await polo(12);
check('Norte: la Camisa suma 10 (6+4)', poloNorte.total, 10);
check('Norte: atributos', poloNorte.atributos, [['Talla L', 4], ['Talla M', 6]]);
check('Sur: la Camisa suma 35 (20+15)', poloSur.total, 35);
check('Sur: atributos', poloSur.atributos, [['Talla L', 15], ['Talla M', 20]]);
check('los costos por talla bajaron a cada sede', [poloNorte.costos, poloSur.costos], [[16000, 15000], [16000, 15000]]);
check('Centro no tiene Camisa Polo',
  (await q(`SELECT COUNT(*)::int n FROM productos_cantidad WHERE sucursal_id=11 AND nombre='Camisa Polo'`))[0].n, 0);

// ── Seriales repartidos entre las tres sedes ────────────────────────────────
const libroSedeSerial = (imeis) => libro([{
  nombre: 'Moto G85',
  ws: hoja('📦  Moto G85 — Hoja de Seriales', CAB_SERIAL_MIN,
    imeis.map((i) => [i, '10/04/2026', 'Motorola CO', 'Motorola', '256GB', 'Celulares', 800000, 600000, '', ''])),
}]);

await importar(libroSedeSerial(['MG-1', 'MG-2', 'MG-3']), { sucursalId: 10, negocioId: 3 });
await importar(libroSedeSerial(['MG-4', 'MG-5']),         { sucursalId: 11, negocioId: 3 });
await importar(libroSedeSerial(['MG-6']),                 { sucursalId: 12, negocioId: 3 });

const porSede = await q(`
  SELECT ps.sucursal_id, COUNT(*)::int n
  FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
  WHERE ps.sucursal_id IN (10,11,12) GROUP BY 1 ORDER BY 1`);
check('seriales repartidos 3/2/1', porSede.map((r) => [r.sucursal_id, r.n]), [[10, 3], [11, 2], [12, 1]]);
check('cada sede tiene su propia referencia «Moto G85»',
  (await q(`SELECT COUNT(*)::int n FROM productos_serial WHERE sucursal_id IN (10,11,12) AND nombre='Moto G85'`))[0].n, 3);

// Y un IMEI de Norte intentando entrar por Sur.
const rCruce = await importar(libroSedeSerial(['MG-1']), { sucursalId: 12, negocioId: 3 });
check('el IMEI de otra sede se rechaza', tipos(rCruce.body.data.informe.conflictos), ['imei_otra_sede']);
checkQue('y dice de qué sede', rCruce.body.data.informe.conflictos[0].mensaje.includes('Norte'),
  rCruce.body.data.informe.conflictos[0].mensaje);
check('Sur sigue con 1 serial',
  (await q(`SELECT COUNT(*)::int n FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id
            WHERE ps.sucursal_id=12`))[0].n, 1);

// ── El preview de una sede no habla de las otras ────────────────────────────
const prevSede = await analizar(catalogo([1, 1, 1]), { sucursalId: 12, negocioId: 3 });
check('preview en Sur: 3 productos ya existentes ahí', prevSede.body.data.resumen.productos_actualizados, 3);
checkQue('los avisos de stock hablan solo de esa sede',
  prevSede.body.data.informe.avisos
    .filter((a) => a.tipo === 'stock_se_suma')
    .every((a) => !a.mensaje.includes('Norte') && !a.mensaje.includes('Centro')),
  JSON.stringify(prevSede.body.data.informe.avisos.map((a) => a.mensaje)));

// ── Foto final del negocio 3 ────────────────────────────────────────────────
const finalSedes = await q(`
  SELECT su.nombre sede,
         COUNT(*)::int productos,
         SUM(pc.stock)::int unidades
  FROM productos_cantidad pc JOIN sucursales su ON su.id = pc.sucursal_id
  WHERE su.negocio_id = 3 GROUP BY su.id, su.nombre ORDER BY su.id`);
console.log('  resumen final por sede:', JSON.stringify(finalSedes));
check('Norte: 4 productos', finalSedes[0].productos, 4);
check('Centro: 3 productos', finalSedes[1].productos, 3);
check('Sur: 4 productos', finalSedes[2].productos, 4);
check('unidades por sede', finalSedes.map((f) => f.unidades), [50 + 80 + 30 + 10, 112 + 25 + 9, 7 + 0 + 100 + 35]);

check('ningún producto quedó sin sucursal',
  (await q(`SELECT COUNT(*)::int n FROM productos_cantidad WHERE sucursal_id IS NULL`))[0].n, 0);
check('ningún serial quedó colgando',
  (await q(`SELECT COUNT(*)::int n FROM seriales s
            LEFT JOIN productos_serial ps ON ps.id = s.producto_id WHERE ps.id IS NULL`))[0].n, 0);
check('el stock del producto raíz siempre cuadra con sus atributos', (await q(`
  SELECT COUNT(*)::int n FROM productos_cantidad pc
  WHERE EXISTS (SELECT 1 FROM atributos_producto a WHERE a.producto_id = pc.id AND a.activo)
    AND pc.stock <> (SELECT COALESCE(SUM(a.stock),0) FROM atributos_producto a
                     WHERE a.producto_id = pc.id AND a.activo)`))[0].n, 0);
check('el stock del atributo siempre cuadra con sus variantes', (await q(`
  SELECT COUNT(*)::int n FROM atributos_producto a
  WHERE EXISTS (SELECT 1 FROM variantes_atributo v WHERE v.atributo_id = a.id AND v.activo)
    AND a.stock <> (SELECT COALESCE(SUM(v.stock),0) FROM variantes_atributo v
                    WHERE v.atributo_id = a.id AND v.activo)`))[0].n, 0);

// ═════════════════════════════════════════════════════════════════════════════
seccion('17b. MISMO NOMBRE EN DOS SEDES CON STOCK DISTINTO — cantidad Y serial');
// ═════════════════════════════════════════════════════════════════════════════
//
// El caso concreto: el negocio vende el MISMO producto en dos sucursales y
// quiere darlo de alta en las dos con cantidades distintas. Tiene que quedar
// una fila por sede, independiente, y mover una no puede mover la otra.
// Se prueba para los dos modelos de producto.

// ── A) Producto por CANTIDAD, mismo nombre, stock distinto ──────────────────
const mismoNombreCant = (stock, precio, ubic) => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('📦', CAB_CANT_FULL, [
    ['Manos Libres X9', 'MLX-9', ubic, 'Accesorios', '', '', stock, 1, 6000, precio, 'unidad', 'Mayorista', '', ''],
  ]),
}]);

const cantNorte = await importar(mismoNombreCant(40, 18000, 'Vitrina N'), { sucursalId: 10, negocioId: 3 });
const cantSur   = await importar(mismoNombreCant(9,  19000, 'Vitrina S'), { sucursalId: 12, negocioId: 3 });
check('cantidad · Norte: producto nuevo', cantNorte.body.data.resumen.productos_nuevos, 1);
check('cantidad · Sur: producto nuevo (no lo toma como el de Norte)', cantSur.body.data.resumen.productos_nuevos, 1);

const mlx = await q(`SELECT pc.id, pc.sucursal_id, pc.nombre, pc.stock, pc.precio::float p, pc.codigo, pc.ubicacion
                     FROM productos_cantidad pc WHERE pc.nombre = 'Manos Libres X9' ORDER BY pc.sucursal_id`);
check('cantidad · hay exactamente 2 filas, una por sede', mlx.length, 2);
checkQue('cantidad · con ids distintos', mlx[0].id !== mlx[1].id, `${mlx[0].id} vs ${mlx[1].id}`);
check('cantidad · sucursales', mlx.map((r) => r.sucursal_id), [10, 12]);
check('cantidad · el stock es el de cada sede', mlx.map((r) => r.stock), [40, 9]);
check('cantidad · el precio es el de cada sede', mlx.map((r) => r.p), [18000, 19000]);
check('cantidad · la ubicación es propia de cada sede', mlx.map((r) => r.ubicacion), ['Vitrina N', 'Vitrina S']);
check('cantidad · el código SÍ se comparte (es el mismo producto lógico)',
  mlx.map((r) => r.codigo), ['MLX-9', 'MLX-9']);

// Mover una sede no puede mover la otra.
await importar(mismoNombreCant(11, 18500, ''), { sucursalId: 10, negocioId: 3 });
const mlx2 = await q(`SELECT sucursal_id, stock, precio::float p FROM productos_cantidad
                      WHERE nombre = 'Manos Libres X9' ORDER BY sucursal_id`);
check('cantidad · Norte subió a 51 (40+11)', mlx2[0].stock, 51);
check('cantidad · Sur sigue en 9, sin tocar', mlx2[1].stock, 9);
check('cantidad · el precio de Sur no cambió', mlx2[1].p, 19000);

// ── B) Producto SERIAL, mismo nombre, cantidad de unidades distinta ─────────
const mismoNombreSerial = (imeis, precio, marca) => libro([{
  nombre: 'Tablet T7',
  ws: hoja('📦  Tablet T7 — Hoja de Seriales', CAB_SERIAL_MIN,
    imeis.map((i) => [i, '20/05/2026', 'Mayorista', marca, '64GB', 'Tabletas', precio, 300000, '', ''])),
}]);

const serNorte = await importar(mismoNombreSerial(['T7-N1', 'T7-N2', 'T7-N3', 'T7-N4'], 700000, 'Lenovo'),
  { sucursalId: 10, negocioId: 3 });
const serSur   = await importar(mismoNombreSerial(['T7-S1'], 750000, 'Lenovo'),
  { sucursalId: 12, negocioId: 3 });
check('serial · Norte: 4 unidades', serNorte.body.data.resumen.seriales_nuevos, 4);
check('serial · Sur: 1 unidad', serSur.body.data.resumen.seriales_nuevos, 1);
check('serial · Sur no dio conflicto (los IMEI son distintos)', serSur.body.data.informe.conflictos.length, 0);

const t7 = await q(`SELECT ps.id, ps.sucursal_id, ps.precio::float p,
                           (SELECT COUNT(*)::int FROM seriales s WHERE s.producto_id = ps.id) unidades
                    FROM productos_serial ps WHERE ps.nombre = 'Tablet T7' ORDER BY ps.sucursal_id`);
check('serial · hay exactamente 2 referencias, una por sede', t7.length, 2);
checkQue('serial · con ids distintos', t7[0].id !== t7[1].id, `${t7[0].id} vs ${t7[1].id}`);
check('serial · sucursales', t7.map((r) => r.sucursal_id), [10, 12]);
check('serial · unidades por sede', t7.map((r) => r.unidades), [4, 1]);
check('serial · precio propio de cada sede', t7.map((r) => r.p), [700000, 750000]);

// Agregar unidades en Sur no puede tocar Norte.
await importar(mismoNombreSerial(['T7-S2', 'T7-S3'], 760000, 'Lenovo'), { sucursalId: 12, negocioId: 3 });
const t7b = await q(`SELECT ps.sucursal_id, ps.precio::float p,
                            (SELECT COUNT(*)::int FROM seriales s WHERE s.producto_id = ps.id) unidades
                     FROM productos_serial ps WHERE ps.nombre = 'Tablet T7' ORDER BY ps.sucursal_id`);
check('serial · Sur pasó a 3 unidades', t7b[1].unidades, 3);
check('serial · Norte sigue en 4', t7b[0].unidades, 4);
check('serial · el precio de Norte no se movió', t7b[0].p, 700000);
check('serial · el precio de Sur sí se actualizó', t7b[1].p, 760000);

// Y los IMEI de cada sede son los suyos, sin mezclarse.
const imeisPorSede = await q(`
  SELECT ps.sucursal_id, array_agg(s.imei ORDER BY s.imei) imeis
  FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
  WHERE ps.nombre = 'Tablet T7' GROUP BY 1 ORDER BY 1`);
check('serial · IMEI de Norte', imeisPorSede[0].imeis, ['T7-N1', 'T7-N2', 'T7-N3', 'T7-N4']);
check('serial · IMEI de Sur',   imeisPorSede[1].imeis, ['T7-S1', 'T7-S2', 'T7-S3']);

// ── C) Las dos cosas a la vez, en un solo archivo y en la tercera sede ──────
const mixto = libro([
  { nombre: 'Tablet T7', ws: hoja('📦  Tablet T7 — Hoja de Seriales', CAB_SERIAL_MIN,
    [['T7-C1', '20/05/2026', 'Mayorista', 'Lenovo', '64GB', 'Tabletas', 730000, 300000, '', '']]) },
  { nombre: 'Productos Cantidad', ws: hoja('📦', CAB_CANT_FULL,
    [['Manos Libres X9', 'MLX-9', 'Vitrina C', 'Accesorios', '', '', 3, 1, 6000, 17500, 'unidad', '', '', '']]) },
]);
const rMixto = await importar(mixto, { sucursalId: 11, negocioId: 3 });
check('mixto · Centro recibe 1 producto y 1 serial',
  [rMixto.body.data.resumen.productos_nuevos, rMixto.body.data.resumen.seriales_nuevos], [1, 1]);

const repartoFinal = await q(`
  SELECT su.nombre sede,
         COALESCE((SELECT stock FROM productos_cantidad WHERE sucursal_id=su.id AND nombre='Manos Libres X9'), 0) manos_libres,
         COALESCE((SELECT COUNT(*)::int FROM seriales s JOIN productos_serial ps ON ps.id=s.producto_id
                   WHERE ps.sucursal_id=su.id AND ps.nombre='Tablet T7'), 0) tablets
  FROM sucursales su WHERE su.negocio_id = 3 ORDER BY su.id`);
console.log('  reparto final:', JSON.stringify(repartoFinal));
check('cantidad por sede (Norte/Centro/Sur)', repartoFinal.map((r) => r.manos_libres), [51, 3, 9]);
check('seriales por sede (Norte/Centro/Sur)', repartoFinal.map((r) => r.tablets), [4, 1, 3]);
check('3 referencias serial «Tablet T7», una por sede',
  (await q(`SELECT COUNT(*)::int n FROM productos_serial WHERE nombre='Tablet T7'`))[0].n, 3);
check('3 filas «Manos Libres X9», una por sede',
  (await q(`SELECT COUNT(*)::int n FROM productos_cantidad WHERE nombre='Manos Libres X9'`))[0].n, 3);

// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
seccion('18. LA COLUMNA UBICACION CREA EL SITIO Y ASIGNA EL PRODUCTO');
// ═════════════════════════════════════════════════════════════════════════════
// Hasta ahora la columna «Ubicacion» solo escribía el TEXTO en el producto.
// Desde 20260831 una ubicación es una FILA con identidad, así que importar 400
// productos con su estante escrito los dejaba a los 400 fuera del mapa: el
// texto estaba, el sitio no existía, y había que crearlos y asignarlos a mano —
// justo el trabajo que la importación viene a quitar.
//
// Lo PRIMERO que se prueba es lo contrario: que sin las tablas del mapa, todo
// lo anterior de esta suite funcionó igual. El INSERT del sitio corre dentro de
// la transacción de la importación, y contra una tabla ausente la abortaría
// entera, perdiendo el archivo completo.
check('hasta aquí no existían las tablas del mapa',
  (await q(`SELECT to_regclass('public.ubicaciones') AS t`))[0].t, null);

await db.exec(readFileSync(path.join(RAIZ, 'migrations/20260831_ubicaciones_estructura.sql'), 'utf8'));
columnas._setUbicacionesDisponible(true);

await q(`INSERT INTO negocios (id, nombre) VALUES (4, 'Bodega Grande')`);
await q(`INSERT INTO sucursales (id, negocio_id, nombre) VALUES (40, 4, 'Central')`);
await setConfig(4, { ubicacion_activa: '1' });

const libroUbic = () => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('Cantidad', CAB_CANT_FULL, [
    ['Cable USB-C',  '', 'Estante A-3', 'Accesorios', '', '', 10, 2, 5000,  12000, 'unidad', '', '', ''],
    ['Vidrio 15',    '', 'Estante A-3', 'Accesorios', '', '', 25, 5, 3000,   8000, 'unidad', '', '', ''],
    ['Audifonos JBL', '', 'Vitrina 2',  'Audio',      '', '', 4,  1, 45000, 90000, 'unidad', '', '', ''],
    ['Cargador 20W', '', '',            'Accesorios', '', '', 7,  1, 4000,  15000, 'unidad', '', '', ''],
  ]),
}]);

// ── El informe lo dice ANTES de escribir nada ──
const prevU = await analizar(libroUbic(), { sucursalId: 40, negocioId: 4 });
check('preview: anuncia las ubicaciones que va a crear',
  (prevU.body.data.informe.ubicaciones_nuevas || []).slice().sort(),
  ['Estante A-3', 'Vitrina 2']);
// Se cuenta SOLO la sucursal nueva: al aplicar la migración, su backfill
// convirtió en filas el texto que dejaron las 17 secciones anteriores (que es
// justo lo que tiene que hacer). La sucursal 40 arranca limpia.
check('preview: y no creó ninguna todavía',
  (await q('SELECT COUNT(*)::int n FROM ubicaciones WHERE sucursal_id = 40'))[0].n, 0);

// ── Aplicar ──
await importar(libroUbic(), { sucursalId: 40, negocioId: 4 });

const sitios = await q('SELECT id, nombre, padre_id FROM ubicaciones WHERE sucursal_id = 40 ORDER BY nombre');
check('se crean los dos sitios, no uno por fila', sitios.map((r) => r.nombre),
  ['Estante A-3', 'Vitrina 2']);
check('nacen en la raíz (la plantilla no expresa jerarquía)',
  sitios.every((r) => r.padre_id === null), true);

const asignados = await q(`
  SELECT pc.nombre, u.nombre AS sitio
  FROM ubicaciones_items ui
  JOIN productos_cantidad pc ON pc.id = ui.producto_cantidad_id
  JOIN ubicaciones u ON u.id = ui.ubicacion_id
  WHERE pc.sucursal_id = 40 ORDER BY pc.nombre`);
check('cada producto queda colgado de su sitio',
  asignados.map((r) => r.nombre + ' -> ' + r.sitio),
  ['Audifonos JBL -> Vitrina 2', 'Cable USB-C -> Estante A-3', 'Vidrio 15 -> Estante A-3']);
check('el que vino con la celda vacía no se inventa un sitio',
  asignados.some((r) => r.nombre === 'Cargador 20W'), false);

// La columna TEXT sigue escribiéndose: es el respaldo del rollback y lo que
// leen el autocompletado y las exportaciones a Excel.
check('el texto de siempre sigue ahí',
  (await q(`SELECT ubicacion FROM productos_cantidad WHERE nombre = 'Cable USB-C' AND sucursal_id = 40`))[0].ubicacion,
  'Estante A-3');

// ── Reimportar el mismo archivo no duplica nada ──
await importar(libroUbic(), { sucursalId: 40, negocioId: 4 });
check('reimportar no duplica los sitios',
  (await q('SELECT COUNT(*)::int n FROM ubicaciones WHERE sucursal_id = 40'))[0].n, 2);
check('ni duplica las asignaciones',
  (await q(`SELECT COUNT(*)::int n FROM ubicaciones_items ui
            JOIN productos_cantidad pc ON pc.id = ui.producto_cantidad_id
            WHERE pc.sucursal_id = 40`))[0].n, 3);

// ── El Excel manda sobre la celda que trae llena: mueve el producto ──
const libroMueve = () => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('Cantidad', CAB_CANT_FULL, [
    ['Cable USB-C', '', 'Vitrina 2', 'Accesorios', '', '', 0, 2, 5000, 12000, 'unidad', '', '', ''],
  ]),
}]);
await importar(libroMueve(), { sucursalId: 40, negocioId: 4 });
const movido = await q(`
  SELECT u.nombre FROM ubicaciones_items ui
  JOIN productos_cantidad pc ON pc.id = ui.producto_cantidad_id
  JOIN ubicaciones u ON u.id = ui.ubicacion_id
  WHERE pc.nombre = 'Cable USB-C' AND pc.sucursal_id = 40`);
check('un producto sigue en UN solo sitio tras moverlo', movido.length, 1);
check('y es el que dice el Excel', movido[0].nombre, 'Vitrina 2');

// ── Nombre repetido en dos ramas: no se adivina ──
// «Estante 1» dentro de dos bodegas distintas es legítimo. El texto se escribe
// igual (la fila no se pierde) pero no se asigna al mapa: es un aviso, no un
// conflicto, porque la fila SÍ entra.
const bodegaA = (await q(`INSERT INTO ubicaciones (sucursal_id, nombre) VALUES (40, 'Bodega A') RETURNING id`))[0].id;
const bodegaB = (await q(`INSERT INTO ubicaciones (sucursal_id, nombre) VALUES (40, 'Bodega B') RETURNING id`))[0].id;
await q(`INSERT INTO ubicaciones (sucursal_id, padre_id, nombre)
         VALUES (40, $1, 'Estante 1'), (40, $2, 'Estante 1')`, [bodegaA, bodegaB]);

const libroAmbiguo = () => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('Cantidad', CAB_CANT_FULL, [
    ['Funda gel', '', 'Estante 1', 'Accesorios', '', '', 3, 1, 1000, 4000, 'unidad', '', '', ''],
  ]),
}]);
const ambiguo = await importar(libroAmbiguo(), { sucursalId: 40, negocioId: 4 });
checkQue('un nombre repetido en dos ramas produce un aviso',
  (ambiguo.body.data.informe.avisos || []).some((a) => a.tipo === 'ubicacion_ambigua'),
  JSON.stringify(ambiguo.body.data.informe.avisos));
check('la fila SÍ se escribe, con su texto',
  (await q(`SELECT ubicacion FROM productos_cantidad WHERE nombre = 'Funda gel' AND sucursal_id = 40`))[0].ubicacion,
  'Estante 1');
check('pero no se asigna a ninguna de las dos',
  (await q(`SELECT COUNT(*)::int n FROM ubicaciones_items ui
            JOIN productos_cantidad pc ON pc.id = ui.producto_cantidad_id
            WHERE pc.nombre = 'Funda gel' AND pc.sucursal_id = 40`))[0].n, 0);

// ── Un sitio que ya existe se reusa, aunque esté anidado ──
const libroAnidado = () => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('Cantidad', CAB_CANT_FULL, [
    ['Protector', '', 'Bodega A', 'Accesorios', '', '', 5, 1, 900, 3000, 'unidad', '', '', ''],
  ]),
}]);
await importar(libroAnidado(), { sucursalId: 40, negocioId: 4 });
check('un sitio que ya existe se reusa, no se duplica',
  (await q(`SELECT COUNT(*)::int n FROM ubicaciones WHERE sucursal_id = 40 AND nombre = 'Bodega A'`))[0].n, 1);

// ── Seriales: la ubicación es del PRODUCTO, no de cada IMEI ──
const libroSerialUbic = () => libro([{
  nombre: 'iPhone 13',
  ws: hoja('iPhone 13', CAB_SERIAL_FULL, [
    ['111222333444555', '', '', 'Apple', '13', 'Celulares', '', '', '', 'Vitrina 2', 2000000, 1600000, '', ''],
    ['111222333444666', '', '', 'Apple', '13', 'Celulares', '', '', '', 'Vitrina 2', 2000000, 1600000, '', ''],
  ]),
}]);
await importar(libroSerialUbic(), { sucursalId: 40, negocioId: 4 });
const refUbicada = await q(`
  SELECT u.nombre FROM ubicaciones_items ui
  JOIN productos_serial ps ON ps.id = ui.producto_serial_id
  JOIN ubicaciones u ON u.id = ui.ubicacion_id
  WHERE ps.sucursal_id = 40`);
check('la referencia con IMEI también queda asignada', refUbicada.map((r) => r.nombre), ['Vitrina 2']);
check('y no se creó otra Vitrina 2',
  (await q(`SELECT COUNT(*)::int n FROM ubicaciones WHERE sucursal_id = 40 AND nombre = 'Vitrina 2'`))[0].n, 1);

// ── Con la feature apagada, nada de esto ocurre ──
await setConfig(4, {});
const libroApagado = () => libro([{
  nombre: 'Productos Cantidad',
  ws: hoja('Cantidad', CAB_CANT_FULL, [
    ['Sin feature', '', 'Estante Z', 'Accesorios', '', '', 1, 1, 100, 200, 'unidad', '', '', ''],
  ]),
}]);
await importar(libroApagado(), { sucursalId: 40, negocioId: 4 });
check('con ubicacion_activa apagada no se crea ningún sitio',
  (await q(`SELECT COUNT(*)::int n FROM ubicaciones WHERE sucursal_id = 40 AND nombre = 'Estante Z'`))[0].n, 0);

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${pasados} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(72));
process.exit(fallos > 0 ? 1 : 0);
