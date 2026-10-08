// TESLA SMARTPHONESHOP (sede 48, negocio 33) — 7-oct-2026.
//
// Pedido del usuario: «para tesla elimina el stock de los productos por cantidad
// y actualiza las referencias a estas que tiene bodega con las variantes
// iguales». Solo la sede 48: ni la bodega, ni Bunny, ni Camilo.
//
//   1. STOCK EN CERO de todo producto por cantidad de la sede (producto y
//      tallas), con su renglón en el historial. Los equipos con IMEI no se tocan.
//   2. El CATÁLOGO queda igual al ACTIVO de la bodega (sede 40):
//        · mismo producto con otro nombre (mismo código)  → se RENOMBRA
//        · producto que la sede no tiene                  → se CREA (stock 0,
//          sin costo ni precio; mismo código y línea)
//        · producto que la bodega no tiene                → se DESACTIVA
//        · y lo mismo talla por talla dentro de cada producto.
//
// No se toca ningún costo: el de la sede es el valor de los envíos recibidos.
// Las cuentas de la red interna tampoco: la deuda vive en los envíos, no en el
// stock. Lo desactivado no se borra (baja lógica, como «eliminar» en pantalla).
//
// Todo en UNA transacción, con respaldo completo de las filas de la sede.
//
//   cd backend && node scripts/sincronizar-catalogo-tesla-48.js            (en seco)
//   cd backend && node scripts/sincronizar-catalogo-tesla-48.js --aplicar
//   … --detalle  lista completa de cada grupo
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false }, max: 1,
});
pool.on('error', (e) => console.error('pool:', e.message));

const APLICAR = process.argv.includes('--aplicar');
const DETALLE = process.argv.includes('--detalle');
const NEGOCIO = 33, BODEGA = 40, SEDE = 48;
const NOTA = 'Reinicio de inventario 7-oct-2026: stock en cero y catálogo igualado al de la bodega (pedido del negocio)';

const K = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const lista = (titulo, filas) => {
  console.log(`   ${titulo}: ${filas.length}`);
  for (const f of filas.slice(0, DETALLE ? Infinity : 8)) console.log('       ·', f);
  if (!DETALLE && filas.length > 8) console.log(`       … y ${filas.length - 8} más (--detalle)`);
};

/** Lee las dos sedes y arma el plan. `db` es el pool o el client de la transacción. */
const planear = async (db, { bloquear = false } = {}) => {
  const fu = bloquear ? 'FOR UPDATE OF pc' : '';
  const { rows: sedes } = await db.query(
    `SELECT id FROM sucursales WHERE negocio_id = $1 AND id = ANY($2)`, [NEGOCIO, [BODEGA, SEDE]]);
  if (sedes.length !== 2) throw new Error('Las sedes 40 y 48 no son las dos del negocio 33');

  const { rows: prods } = await db.query(
    `SELECT pc.id, pc.sucursal_id, pc.nombre, pc.activo, pc.stock, pc.codigo, pc.linea_id,
            pc.unidad_medida, pc.stock_minimo
     FROM productos_cantidad pc WHERE pc.sucursal_id = ANY($1) ORDER BY pc.id ${fu}`, [[BODEGA, SEDE]]);
  const { rows: atrs } = await db.query(
    `SELECT ap.id, ap.sucursal_id, ap.producto_id, ap.valor, ap.activo, ap.stock, ap.codigo, ap.tipo_id
     FROM atributos_producto ap WHERE ap.sucursal_id = ANY($1) ORDER BY ap.id ${bloquear ? 'FOR UPDATE OF ap' : ''}`,
    [[BODEGA, SEDE]]);
  const { rows: [{ n: variantes }] } = await db.query(
    `SELECT count(*)::int n FROM variantes_atributo v JOIN atributos_producto ap ON ap.id = v.atributo_id
     WHERE ap.sucursal_id = ANY($1)`, [[BODEGA, SEDE]]);
  // Este script solo sabe de dos niveles (producto → talla), que es lo que hay.
  if (variantes) throw new Error(`Hay ${variantes} sub-variantes (tercer nivel): este script no las maneja`);
  const { rows: transito } = await db.query(
    `SELECT id, numero FROM remisiones WHERE negocio_id = $1 AND estado = 'En transito'
       AND (sucursal_origen_id = $2 OR sucursal_destino_id = $2)`, [NEGOCIO, SEDE]);

  const B = prods.filter((p) => p.sucursal_id === BODEGA && p.activo);
  const T = prods.filter((p) => p.sucursal_id === SEDE);
  const atrsDe = new Map();
  for (const a of atrs) (atrsDe.get(a.producto_id) || atrsDe.set(a.producto_id, []).get(a.producto_id)).push(a);

  const plan = {
    transito, productos: { iguales: 0, renombrar: [], crear: [], desactivar: [], reactivar: [] },
    tallas: { iguales: 0, renombrar: [], crear: [], desactivar: [], reactivar: [] }, avisos: [],
    stock: {
      productos: T.filter((p) => Number(p.stock) !== 0).length,
      unidades: T.filter((p) => p.activo).reduce((s, p) => s + Number(p.stock), 0),
      tallas: atrs.filter((a) => a.sucursal_id === SEDE && Number(a.stock) !== 0).length,
    },
  };

  // ── Productos ──────────────────────────────────────────────────────────────
  const tPorNombre = new Map();          // nombre → fila (activa o no): el índice único es (nombre, sede)
  for (const p of T) {
    const k = K(p.nombre);
    if (tPorNombre.has(k)) plan.avisos.push(`La sede tiene dos productos llamados «${p.nombre}»`);
    else tPorNombre.set(k, p);
  }
  const bNombres = new Set(B.map((p) => K(p.nombre)));
  if (bNombres.size !== B.length) throw new Error('La bodega tiene nombres de producto repetidos: hay que mirarlo a mano');
  const tPorCodigo = new Map(T.filter((p) => p.activo && p.codigo).map((p) => [p.codigo, p]));
  const codigosProd = new Set(T.filter((p) => p.activo && p.codigo).map((p) => p.codigo));   // ocupados (activos)
  const usados = new Set();              // ids de la sede que ya tienen par
  const pares = [];                      // { b, t } — t puede ser null (se crea)

  for (const b of B) {
    let t = tPorNombre.get(K(b.nombre));
    if (t) {
      if (!t.activo) plan.productos.reactivar.push({ id: t.id, nombre: t.nombre });
      else plan.productos.iguales++;
    } else {
      // Mismo código y un nombre que la bodega ya no usa: es el mismo producto, renombrado.
      const c = b.codigo ? tPorCodigo.get(b.codigo) : null;
      if (c && !usados.has(c.id) && !bNombres.has(K(c.nombre))) {
        t = c;
        plan.productos.renombrar.push({ id: c.id, de: c.nombre, a: b.nombre, linea_id: b.linea_id });
      }
    }
    if (t) usados.add(t.id);
    pares.push({ b, t: t || null });
  }
  for (const t of T) {
    if (t.activo && !usados.has(t.id)) {
      plan.productos.desactivar.push({ id: t.id, nombre: t.nombre, stock: Number(t.stock) });
      if (t.codigo) codigosProd.delete(t.codigo);
    }
  }
  for (const par of pares) {
    if (par.t) continue;
    const libre = par.b.codigo && !codigosProd.has(par.b.codigo);
    if (libre) codigosProd.add(par.b.codigo);
    if (par.b.codigo && !libre) plan.avisos.push(`«${par.b.nombre}» nace sin código: ${par.b.codigo} ya lo usa otro producto de la sede`);
    plan.productos.crear.push({
      bodega_id: par.b.id, nombre: par.b.nombre, linea_id: par.b.linea_id,
      unidad_medida: par.b.unidad_medida || 'unidad', codigo: libre ? par.b.codigo : null,
    });
  }

  // ── Tallas ─────────────────────────────────────────────────────────────────
  const codigosAtr = new Set(atrs.filter((a) => a.sucursal_id === SEDE && a.activo && a.codigo).map((a) => a.codigo));
  const desactivadosProd = new Set(plan.productos.desactivar.map((p) => p.id));
  // Las tallas de un producto que se desactiva dejan libre su código.
  for (const a of atrs) if (desactivadosProd.has(a.producto_id) && a.activo && a.codigo) codigosAtr.delete(a.codigo);

  const porCrear = [];
  for (const { b, t } of pares) {
    const bA = (atrsDe.get(b.id) || []).filter((a) => a.activo);
    const tA = t ? (atrsDe.get(t.id) || []) : [];
    const bValores = new Set(bA.map((a) => K(a.valor)));
    if (bValores.size !== bA.length) plan.avisos.push(`La bodega tiene tallas repetidas en «${b.nombre}»: en la sede queda una sola`);
    const tPorValor = new Map();
    for (const a of tA) { const k = K(a.valor); if (!tPorValor.has(k) || (a.activo && !tPorValor.get(k).activo)) tPorValor.set(k, a); }
    const tPorCod = new Map(tA.filter((a) => a.activo && a.codigo).map((a) => [a.codigo, a]));
    const usadas = new Set();
    const vistos = new Set();
    for (const a of bA) {
      const k = K(a.valor);
      if (vistos.has(k)) continue;         // talla repetida en la bodega
      vistos.add(k);
      let x = tPorValor.get(k);
      if (x) {
        if (!x.activo) {
          plan.tallas.reactivar.push({ id: x.id, etiqueta: `${b.nombre} · ${x.valor}` });
          if (x.codigo && codigosAtr.has(x.codigo)) plan.avisos.push(`«${b.nombre} · ${x.valor}» se reactiva con un código que ya usa otra talla`);
        } else plan.tallas.iguales++;
      } else {
        const c = a.codigo ? tPorCod.get(a.codigo) : null;
        if (c && !usadas.has(c.id) && !bValores.has(K(c.valor))) {
          x = c;
          plan.tallas.renombrar.push({ id: c.id, etiqueta: `${b.nombre}: «${c.valor}» → «${a.valor}»`, a: a.valor });
        }
      }
      if (x) { usadas.add(x.id); continue; }
      porCrear.push({ b, t, a });
    }
    for (const x of tA) {
      if (x.activo && !usadas.has(x.id)) {
        plan.tallas.desactivar.push({ id: x.id, etiqueta: `${b.nombre} · ${x.valor}`, stock: Number(x.stock) });
        if (x.codigo) codigosAtr.delete(x.codigo);
      }
    }
  }
  for (const { b, t, a } of porCrear) {
    const libre = a.codigo && !codigosAtr.has(a.codigo);
    if (libre) codigosAtr.add(a.codigo);
    plan.tallas.crear.push({
      producto_id: t ? t.id : null, producto_nombre: b.nombre, valor: a.valor, tipo_id: a.tipo_id,
      codigo: libre ? a.codigo : null, etiqueta: `${b.nombre} · ${a.valor}`,
    });
  }
  plan.total_bodega = { productos: B.length, tallas: [...new Set(B.flatMap((b) => (atrsDe.get(b.id) || []).filter((a) => a.activo).map((a) => `${b.id}|${K(a.valor)}`)))].length };
  return plan;
};

const imprimir = (plan) => {
  console.log(`\nBodega (activo): ${plan.total_bodega.productos} productos · ${plan.total_bodega.tallas} tallas`);
  console.log('\n══ 1. STOCK EN CERO (sede 48)');
  console.log(`   ${plan.stock.unidades} unidades en ${plan.stock.productos} productos y ${plan.stock.tallas} tallas`);
  lista('envíos EN TRÁNSITO que tocan la sede', plan.transito.map((r) => `#${r.numero ?? r.id}`));
  console.log('\n══ 2. PRODUCTOS');
  console.log(`   ya iguales: ${plan.productos.iguales}`);
  lista('se RENOMBRAN (mismo código)', plan.productos.renombrar.map((p) => `«${p.de}» → «${p.a}»`));
  lista('se CREAN', plan.productos.crear.map((p) => `${p.nombre}${p.codigo ? ` [${p.codigo}]` : ' [sin código]'}`));
  lista('se REACTIVAN', plan.productos.reactivar.map((p) => p.nombre));
  lista('se DESACTIVAN (la bodega no los tiene)', plan.productos.desactivar.map((p) => `${p.nombre} (stock hoy ${p.stock})`));
  console.log('\n══ 3. TALLAS');
  console.log(`   ya iguales: ${plan.tallas.iguales}`);
  lista('se RENOMBRAN (mismo código)', plan.tallas.renombrar.map((t) => t.etiqueta));
  lista('se CREAN', plan.tallas.crear.map((t) => t.etiqueta));
  lista('se REACTIVAN', plan.tallas.reactivar.map((t) => t.etiqueta));
  lista('se DESACTIVAN (la bodega no las tiene)', plan.tallas.desactivar.map((t) => `${t.etiqueta} (stock hoy ${t.stock})`));
  console.log('');
  lista('AVISOS', plan.avisos);
};

(async () => {
  if (!APLICAR) {
    imprimir(await planear(pool));
    console.log('\nEN SECO: no se escribió nada. Para aplicar: --aplicar');
    await pool.end();
    return;
  }

  const c = await pool.connect();
  try {
    await c.query("SET lock_timeout = '8s'");
    await c.query('BEGIN');
    // El plan se arma DENTRO de la transacción y con las filas bloqueadas: la
    // sede está vendiendo, y lo que se decide tiene que ser lo que se escribe.
    const plan = await planear(c, { bloquear: true });
    imprimir(plan);
    if (plan.transito.length) throw new Error('Hay envíos en tránsito que tocan la sede: hay que recibirlos o anularlos antes');

    // Respaldo completo de la sede.
    const respaldo = {
      fecha: new Date().toISOString(), negocio: NEGOCIO, sucursal: SEDE,
      productos_cantidad: (await c.query(`SELECT * FROM productos_cantidad WHERE sucursal_id = $1 ORDER BY id`, [SEDE])).rows,
      atributos_producto: (await c.query(`SELECT * FROM atributos_producto WHERE sucursal_id = $1 ORDER BY id`, [SEDE])).rows,
      plan,
    };

    // 1. Historial y stock en cero. El renglón va en la TALLA cuando el stock
    //    vive ahí; en el producto solo si es plano (o si sus tallas ya están en 0).
    const h1 = await c.query(
      `INSERT INTO historial_stock_cantidad (producto_id, sucursal_id, cantidad, costo_unitario, tipo, notas, atributo_id)
       SELECT ap.producto_id, ap.sucursal_id, -ap.stock, ap.costo_unitario, 'ajuste', $2, ap.id
       FROM atributos_producto ap WHERE ap.sucursal_id = $1 AND ap.stock <> 0`, [SEDE, NOTA]);
    const h2 = await c.query(
      `INSERT INTO historial_stock_cantidad (producto_id, sucursal_id, cantidad, costo_unitario, tipo, notas)
       SELECT pc.id, pc.sucursal_id, -pc.stock, pc.costo_unitario, 'ajuste', $2
       FROM productos_cantidad pc WHERE pc.sucursal_id = $1 AND pc.stock <> 0
         AND NOT EXISTS (SELECT 1 FROM atributos_producto ap WHERE ap.producto_id = pc.id AND ap.stock <> 0)`, [SEDE, NOTA]);
    const z1 = await c.query(`UPDATE atributos_producto SET stock = 0 WHERE sucursal_id = $1 AND stock <> 0`, [SEDE]);
    const z2 = await c.query(`UPDATE productos_cantidad SET stock = 0 WHERE sucursal_id = $1 AND stock <> 0`, [SEDE]);

    // 2. Desactivar primero: libera nombres de talla y códigos antes de crear.
    const ids = (xs) => xs.map((x) => x.id);
    await c.query(`UPDATE atributos_producto SET activo = false WHERE sucursal_id = $1 AND id = ANY($2)`, [SEDE, ids(plan.tallas.desactivar)]);
    await c.query(`UPDATE productos_cantidad SET activo = false WHERE sucursal_id = $1 AND id = ANY($2)`, [SEDE, ids(plan.productos.desactivar)]);
    await c.query(`UPDATE atributos_producto SET activo = false WHERE sucursal_id = $1 AND producto_id = ANY($2)`, [SEDE, ids(plan.productos.desactivar)]);

    // 3. Renombrar y reactivar.
    await c.query(
      `UPDATE productos_cantidad pc SET nombre = d.nombre, linea_id = d.linea_id
       FROM unnest($2::int[], $3::text[], $4::int[]) AS d(id, nombre, linea_id)
       WHERE pc.id = d.id AND pc.sucursal_id = $1`,
      [SEDE, ids(plan.productos.renombrar), plan.productos.renombrar.map((p) => p.a), plan.productos.renombrar.map((p) => p.linea_id)]);
    await c.query(`UPDATE productos_cantidad SET activo = true WHERE sucursal_id = $1 AND id = ANY($2)`, [SEDE, ids(plan.productos.reactivar)]);
    await c.query(
      `UPDATE atributos_producto ap SET valor = d.valor
       FROM unnest($2::int[], $3::text[]) AS d(id, valor) WHERE ap.id = d.id AND ap.sucursal_id = $1`,
      [SEDE, ids(plan.tallas.renombrar), plan.tallas.renombrar.map((t) => t.a)]);
    await c.query(`UPDATE atributos_producto SET activo = true WHERE sucursal_id = $1 AND id = ANY($2)`, [SEDE, ids(plan.tallas.reactivar)]);

    // 4. Crear productos, y con sus ids las tallas.
    const cp = plan.productos.crear;
    const { rows: creados } = await c.query(
      `INSERT INTO productos_cantidad (nombre, stock, stock_minimo, unidad_medida, sucursal_id, linea_id, codigo)
       SELECT d.nombre, 0, 0, d.unidad, $1, d.linea_id, d.codigo
       FROM unnest($2::text[], $3::text[], $4::int[], $5::text[]) AS d(nombre, unidad, linea_id, codigo)
       RETURNING id, nombre`,
      [SEDE, cp.map((p) => p.nombre), cp.map((p) => p.unidad_medida), cp.map((p) => p.linea_id), cp.map((p) => p.codigo)]);
    const idDe = new Map(creados.map((p) => [p.nombre, p.id]));
    const ct = plan.tallas.crear.map((t) => ({ ...t, producto_id: t.producto_id ?? idDe.get(t.producto_nombre) }));
    if (ct.some((t) => !t.producto_id)) throw new Error('Una talla nueva se quedó sin producto');
    const { rows: tallasCreadas } = await c.query(
      `INSERT INTO atributos_producto (producto_id, sucursal_id, tipo_id, valor, stock, codigo)
       SELECT d.producto_id, $1, d.tipo_id, d.valor, 0, d.codigo
       FROM unnest($2::int[], $3::int[], $4::text[], $5::text[]) AS d(producto_id, tipo_id, valor, codigo)
       RETURNING id`,
      [SEDE, ct.map((t) => t.producto_id), ct.map((t) => t.tipo_id), ct.map((t) => t.valor), ct.map((t) => t.codigo)]);

    // 5. Comprobar ANTES del commit: stock en cero y catálogo idéntico al de la bodega.
    const { rows: [chk] } = await c.query(`
      SELECT
        (SELECT count(*)::int FROM productos_cantidad WHERE sucursal_id = $1 AND stock <> 0)
          + (SELECT count(*)::int FROM atributos_producto WHERE sucursal_id = $1 AND stock <> 0) AS con_stock,
        (SELECT count(*)::int FROM (
           SELECT lower(btrim(nombre)) FROM productos_cantidad WHERE sucursal_id = $2 AND activo
           EXCEPT SELECT lower(btrim(nombre)) FROM productos_cantidad WHERE sucursal_id = $1 AND activo) x) AS faltan_prod,
        (SELECT count(*)::int FROM (
           SELECT lower(btrim(nombre)) FROM productos_cantidad WHERE sucursal_id = $1 AND activo
           EXCEPT SELECT lower(btrim(nombre)) FROM productos_cantidad WHERE sucursal_id = $2 AND activo) x) AS sobran_prod,
        (SELECT count(*)::int FROM (
           SELECT lower(btrim(pc.nombre)), lower(btrim(ap.valor)) FROM atributos_producto ap JOIN productos_cantidad pc ON pc.id = ap.producto_id
           WHERE ap.sucursal_id = $2 AND ap.activo AND pc.activo
           EXCEPT SELECT lower(btrim(pc.nombre)), lower(btrim(ap.valor)) FROM atributos_producto ap JOIN productos_cantidad pc ON pc.id = ap.producto_id
           WHERE ap.sucursal_id = $1 AND ap.activo AND pc.activo) x) AS faltan_tallas,
        (SELECT count(*)::int FROM (
           SELECT lower(btrim(pc.nombre)), lower(btrim(ap.valor)) FROM atributos_producto ap JOIN productos_cantidad pc ON pc.id = ap.producto_id
           WHERE ap.sucursal_id = $1 AND ap.activo AND pc.activo
           EXCEPT SELECT lower(btrim(pc.nombre)), lower(btrim(ap.valor)) FROM atributos_producto ap JOIN productos_cantidad pc ON pc.id = ap.producto_id
           WHERE ap.sucursal_id = $2 AND ap.activo AND pc.activo) x) AS sobran_tallas`, [SEDE, BODEGA]);
    console.log('\nComprobación:', JSON.stringify(chk));
    if (Object.values(chk).some((n) => n !== 0)) throw new Error('La comprobación no dio cero en todo');

    const sello = Date.now();
    fs.writeFileSync(path.join(__dirname, `respaldo-catalogo-tesla-48-${sello}.json`), JSON.stringify(respaldo));
    // Los nodos que nacieron o cambiaron de nombre: son los que les falta el precio de lista.
    fs.writeFileSync(path.join(__dirname, `nodos-nuevos-tesla-48-${sello}.json`), JSON.stringify({
      producto: [...creados.map((p) => p.id), ...ids(plan.productos.renombrar), ...ids(plan.productos.reactivar)],
      atributo: [...tallasCreadas.map((t) => t.id), ...ids(plan.tallas.renombrar), ...ids(plan.tallas.reactivar)],
    }));
    await c.query('COMMIT');
    console.log(`\nAPLICADO — historial: ${h1.rowCount + h2.rowCount} renglones · stock en cero: ${z2.rowCount} productos y ${z1.rowCount} tallas`
      + ` · creados: ${creados.length} productos y ${tallasCreadas.length} tallas`);
    console.log(`Respaldo: respaldo-catalogo-tesla-48-${sello}.json · nodos nuevos: nodos-nuevos-tesla-48-${sello}.json`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('\nROLLBACK, no se escribió nada:', e.message);
    process.exitCode = 1;
  } finally { c.release(); await pool.end(); }
})().catch(async (e) => { console.error('ERROR:', e.message); process.exitCode = 1; await pool.end().catch(() => {}); });
