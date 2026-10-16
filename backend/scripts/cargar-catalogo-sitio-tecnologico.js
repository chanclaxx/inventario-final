// SITIO TECNOLOGICO (negocio 38, sede 54 «Principal») — 16-oct-2026.
//
// Pedido del usuario: subir las REFERENCIAS y sus VARIANTES de la plantilla
// `precios-por-lista-AMERICAS.xlsx` (la de «Precios por lista» de la bodega de
// Tesla) al negocio recién creado, agrupadas por la misma LÍNEA, y SIN precios
// de compra ni de venta ni nada más.
//
//   · Líneas    → `lineas_producto` del negocio 38 (se crean las que falten).
//   · Productos → `productos_cantidad` de la sede 54: stock 0, sin costo, sin
//                 precio, sin precios por lista, sin proveedor.
//   · Variantes → `atributos_producto` (un solo nivel, como en el archivo), igual
//                 de vacías. `tipo_id` NULL, como en la bodega y en SZ CELL.
//   · Código    → el de la plantilla, en el nodo que la fila describe (producto
//                 o talla). Todas las hojas traen el suyo.
//   · Config    → `variantes_activo = '1'`: sin ella las tallas no se ven y el
//                 stock iría al producto.
//
// Las columnas de precio del archivo NO se leen. Lo que ya exista (por nombre,
// sin mayúsculas ni espacios de más) no se duplica ni se toca.
//
// La bodega tiene «VIDRIO ANTIESPIA SIN BORDE / SIN BORDE IPHONE 16 PRO MAX»
// dos veces (a5910 y a1090): aquí entra UNA, la primera del archivo
// (PRO-VID-SIN-149); la otra (PRO-VID-SIN-138) se omite y se informa.
//
// Todo en UNA transacción, en SQL de conjunto (la base está a ~145 ms por ida).
//
//   cd backend && node scripts/cargar-catalogo-sitio-tecnologico.js            (en seco)
//   cd backend && node scripts/cargar-catalogo-sitio-tecnologico.js --aplicar
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false }, max: 1,
});
pool.on('error', (e) => console.error('pool:', e.message));

const APLICAR = process.argv.includes('--aplicar');
const NEGOCIO = 38, SEDE = 54, NOMBRE_NEGOCIO = 'Sitio Tecnologico';
const ARCHIVO = path.join(__dirname, '..', '..', 'precios-por-lista-AMERICAS.xlsx');
const HOJA = 'BODEGA LAS AMERICAS';

const limpio = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const K = (s) => limpio(s).toLowerCase();

/** Lee la plantilla: productos en orden, cada uno con su línea, código y tallas. */
const leerPlantilla = () => {
  const wb = XLSX.readFile(ARCHIVO);
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[HOJA], { header: 1, defval: '' });
  const enc = filas[0].map(limpio);
  const col = (n) => { const i = enc.indexOf(n); if (i < 0) throw new Error(`Falta la columna «${n}»`); return i; };
  const C = { linea: col('Línea'), producto: col('Producto'), variante: col('Variante'), nivel: col('Nivel'), codigo: col('Código') };

  const productos = []; const descartes = [];
  let actual = null;
  for (const [i, f] of filas.slice(1).entries()) {
    const nivel = limpio(f[C.nivel]);
    if (!nivel || nivel === 'Línea') continue;
    if (nivel === 'Producto') {
      actual = { nombre: limpio(f[C.producto]), linea: limpio(f[C.linea]), codigo: limpio(f[C.codigo]) || null, tallas: [] };
      if (!actual.nombre || !actual.linea) throw new Error(`Fila ${i + 2}: producto sin nombre o sin línea`);
      productos.push(actual);
    } else if (nivel === 'Variante') {
      if (!actual || limpio(f[C.producto]) !== actual.nombre) throw new Error(`Fila ${i + 2}: variante fuera de su producto`);
      const valor = limpio(f[C.variante]);
      if (!valor) throw new Error(`Fila ${i + 2}: variante sin valor`);
      if (actual.tallas.some((t) => K(t.valor) === K(valor))) {
        descartes.push(`${actual.nombre} / ${valor} (${limpio(f[C.codigo])}) — repetida en el archivo`);
        continue;
      }
      actual.tallas.push({ valor, codigo: limpio(f[C.codigo]) || null });
    } else {
      throw new Error(`Fila ${i + 2}: nivel desconocido «${nivel}»`);
    }
  }
  return { productos, descartes };
};

const main = async () => {
  const { productos, descartes } = leerPlantilla();
  const lineas = [...new Map(productos.map((p) => [K(p.linea), p.linea])).values()];
  const tallas = productos.flatMap((p) => p.tallas.map((t) => ({ producto: p.nombre, ...t })));
  console.log(`Plantilla: ${lineas.length} líneas, ${productos.length} productos, ${tallas.length} variantes`);
  for (const d of descartes) console.log('   · se omite', d);

  // Un código = un nodo: si el archivo repitiera alguno, el índice parcial lo rechazaría.
  const codigos = [...productos.map((p) => p.codigo), ...tallas.map((t) => t.codigo)].filter(Boolean);
  if (new Set(codigos).size !== codigos.length) throw new Error('El archivo repite códigos');

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [neg] } = await c.query(
      `SELECT n.nombre FROM negocios n JOIN sucursales s ON s.negocio_id = n.id WHERE n.id = $1 AND s.id = $2`,
      [NEGOCIO, SEDE]);
    if (!neg || neg.nombre !== NOMBRE_NEGOCIO) throw new Error(`La sede ${SEDE} no es de «${NOMBRE_NEGOCIO}» (${NEGOCIO})`);

    // 1. Config: las variantes tienen que estar encendidas para verse.
    await c.query(
      `INSERT INTO config_negocio(negocio_id, clave, valor) VALUES ($1, 'variantes_activo', '1')
       ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor`, [NEGOCIO]);

    // 2. Líneas.
    const { rowCount: lineasNuevas } = await c.query(
      `INSERT INTO lineas_producto (negocio_id, nombre)
       SELECT $1, u.nombre FROM unnest($2::text[]) WITH ORDINALITY u(nombre, ord)
       WHERE NOT EXISTS (SELECT 1 FROM lineas_producto l
                         WHERE l.negocio_id = $1 AND LOWER(BTRIM(l.nombre)) = LOWER(u.nombre))
       ORDER BY u.ord`, [NEGOCIO, lineas]);

    // 3. Productos: stock 0 y ningún valor (costo, precio, precios, proveedor en NULL).
    const { rowCount: productosNuevos } = await c.query(
      `INSERT INTO productos_cantidad (sucursal_id, nombre, stock, stock_minimo, linea_id, codigo)
       SELECT $1, u.nombre, 0, 0,
              (SELECT l.id FROM lineas_producto l WHERE l.negocio_id = $2
                 AND LOWER(BTRIM(l.nombre)) = LOWER(u.linea) ORDER BY l.id LIMIT 1),
              u.codigo
       FROM unnest($3::text[], $4::text[], $5::text[]) WITH ORDINALITY u(nombre, linea, codigo, ord)
       WHERE NOT EXISTS (SELECT 1 FROM productos_cantidad p
                         WHERE p.sucursal_id = $1 AND LOWER(BTRIM(p.nombre)) = LOWER(u.nombre))
       ORDER BY u.ord`,
      [SEDE, NEGOCIO, productos.map((p) => p.nombre), productos.map((p) => p.linea), productos.map((p) => p.codigo)]);

    // 4. Variantes (un nivel), en el orden del archivo.
    const { rowCount: tallasNuevas } = await c.query(
      `INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, stock_minimo, codigo)
       SELECT p.id, $1, u.valor, 0, 0, u.codigo
       FROM unnest($2::text[], $3::text[], $4::text[]) WITH ORDINALITY u(producto, valor, codigo, ord)
       JOIN LATERAL (SELECT id FROM productos_cantidad p
                     WHERE p.sucursal_id = $1 AND LOWER(BTRIM(p.nombre)) = LOWER(u.producto)
                     ORDER BY p.id LIMIT 1) p ON true
       WHERE NOT EXISTS (SELECT 1 FROM atributos_producto a
                         WHERE a.producto_id = p.id AND a.activo AND LOWER(BTRIM(a.valor)) = LOWER(u.valor))
       ORDER BY u.ord`,
      [SEDE, tallas.map((t) => t.producto), tallas.map((t) => t.valor), tallas.map((t) => t.codigo)]);

    console.log(`\nCreado: ${lineasNuevas} líneas, ${productosNuevos} productos, ${tallasNuevas} variantes`);

    // 5. Verificación contra la base, dentro de la misma transacción.
    const { rows: [v] } = await c.query(
      `SELECT
         (SELECT count(*)::int FROM lineas_producto WHERE negocio_id = $2) AS lineas,
         (SELECT count(*)::int FROM productos_cantidad WHERE sucursal_id = $1) AS productos,
         (SELECT count(*)::int FROM productos_cantidad WHERE sucursal_id = $1 AND linea_id IS NULL) AS sin_linea,
         (SELECT count(*)::int FROM atributos_producto WHERE sucursal_id = $1) AS variantes,
         (SELECT count(*)::int FROM productos_cantidad WHERE sucursal_id = $1
            AND (stock <> 0 OR costo_unitario IS NOT NULL OR precio IS NOT NULL OR precios IS NOT NULL OR proveedor_id IS NOT NULL)) AS prod_con_valor,
         (SELECT count(*)::int FROM atributos_producto WHERE sucursal_id = $1
            AND (stock <> 0 OR costo_unitario IS NOT NULL OR precio IS NOT NULL OR precios IS NOT NULL)) AS var_con_valor,
         (SELECT count(*)::int FROM productos_cantidad WHERE sucursal_id = $1 AND codigo IS NOT NULL)
           + (SELECT count(*)::int FROM atributos_producto WHERE sucursal_id = $1 AND codigo IS NOT NULL) AS con_codigo,
         (SELECT valor FROM config_negocio WHERE negocio_id = $2 AND clave = 'variantes_activo') AS variantes_activo`,
      [SEDE, NEGOCIO]);
    console.log('Verificación:', v);
    const { rows: porLinea } = await c.query(
      `SELECT l.nombre AS linea, count(DISTINCT p.id)::int AS productos, count(a.id)::int AS variantes
       FROM lineas_producto l
       LEFT JOIN productos_cantidad p ON p.linea_id = l.id AND p.sucursal_id = $1
       LEFT JOIN atributos_producto a ON a.producto_id = p.id
       WHERE l.negocio_id = $2 GROUP BY l.nombre ORDER BY l.nombre`, [SEDE, NEGOCIO]);
    console.table(porLinea);

    const esperado = { lineas: lineas.length, productos: productos.length, variantes: tallas.length, con_codigo: codigos.length };
    const fallas = Object.entries(esperado).filter(([k, n]) => v[k] !== n).map(([k, n]) => `${k}: ${v[k]} ≠ ${n}`);
    if (v.sin_linea || v.prod_con_valor || v.var_con_valor) fallas.push('hay productos sin línea o con algún valor');
    if (fallas.length) throw new Error('No cuadra: ' + fallas.join('; '));

    await c.query(APLICAR ? 'COMMIT' : 'ROLLBACK');
    console.log(APLICAR ? '\nAPLICADO.' : '\nEn seco: nada se guardó. Corre con --aplicar.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
};

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
