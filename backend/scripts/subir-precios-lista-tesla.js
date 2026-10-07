// Precios por lista de Tesla SmartPhone Shop (negocio 33), 6-oct-2026.
//
// El usuario entregó dos Excel de «Precios por lista»:
//   · precios-por-lista-AMERICAS.xlsx   → BODEGA LAS AMERICAS   (sede 40)
//   · precios-por-lista tesla.xlsx      → TESLA SMARTPHONESHOP  (sede 48)
//
// Los DOS son la plantilla de la BODEGA (sus ID son los de la sede 40). El de
// Tesla trae la hoja renombrada a «TESLA» y la columna «Al por mayor TESLA»,
// así que la pantalla lo rechazaría (HOJA_DESCONOCIDA) y, aunque no, escribiría
// sobre la bodega. Aquí cada fila se TRADUCE al mismo nodo de la sede 48 —mismo
// producto (por nombre) y misma talla— y lo que la 48 no tiene se reporta y se
// salta: no se crea nada.
//
// Lo que decide qué cambia es el lector REAL del importador (`resolverLibro`):
// este script solo le prepara el libro y aplica sus escrituras en conjunto (un
// UPDATE por nivel en vez de 2.385 idas y vueltas con las filas bloqueadas).
//
// Diferencia deliberada con la pantalla, solo en la sede 48: una fila SIN ningún
// precio no borra los precios que ese nodo ya tiene. El archivo nació de la
// plantilla de la bodega, así que un vacío ahí no es «quítale el precio a Tesla».
//
//   cd backend && node scripts/subir-precios-lista-tesla.js            (en seco)
//   cd backend && node scripts/subir-precios-lista-tesla.js --aplicar
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false }, max: 1,
});
pool.on('error', (e) => console.error('pool:', e.message));

// El repositorio real lee con ESTE pool (el suyo no fuerza SSL fuera de producción).
const rutaDb = require.resolve('../src/config/db.js');
require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: { pool, connectDB: async () => {} } };

const repo = require('../src/modules/listas-precios/listasPrecios.repository');
const { resolverLibro, leerPrecio, leerToken } = require('../src/modules/listas-precios/listasPrecios.excel');
const util = require('../src/utils/listasPrecios.util');

const APLICAR = process.argv.includes('--aplicar');
const VERBOSO = process.argv.includes('--detalle');
const NEGOCIO = 33, BODEGA = 40, TESLA = 48;
const RAIZ = path.join(__dirname, '..', '..');
const ARCHIVO_BODEGA = path.join(RAIZ, 'precios-por-lista-AMERICAS.xlsx');
const ARCHIVO_TESLA  = path.join(RAIZ, 'precios-por-lista tesla.xlsx');
// Columnas del archivo que NO se llaman como la lista: a cuál corresponden.
const ALIAS_COLUMNA = { 'Al por mayor TESLA': 'Al por mayor' };

const K = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const claveNodo = (n) => `${n.nivel}|${K(n.nombre)}|${K(n.detalle)}`;

/** Filas de la única hoja de datos del archivo. */
const leerHoja = (ruta) => {
  const wb = XLSX.readFile(ruta);
  const hoja = wb.SheetNames.find((s) => K(s) !== 'instrucciones');
  return { hoja, filas: XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: null }) };
};

/**
 * Deja la fila como la espera el lector: columnas con el nombre de la lista y
 * los precios numéricos ya redondeados. Lo segundo no es estética: el lector
 * convierte la celda a texto y quita el punto de miles, así que un número con
 * exactamente tres decimales (1296.225) se leería como 1.296.225.
 */
const normalizarFila = (fila, listas, cuenta) => {
  const f = {};
  for (const [col, v] of Object.entries(fila)) f[ALIAS_COLUMNA[col] || col] = v;
  for (const l of listas) {
    const v = f[l.nombre];
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) cuenta.decimales++;
      if (leerPrecio(v) !== (Math.round(v) === 0 ? null : Math.round(v))) cuenta.malLeidos++;
      f[l.nombre] = Math.round(v);
    }
  }
  return f;
};

const sinPrecios = (f, listas) => listas.every((l) => leerPrecio(f[l.nombre]) === null);

const libro = (nombreHoja, filas) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), nombreHoja);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

const resumirInforme = (titulo, informe) => {
  console.log(`\n══ ${titulo}`);
  console.log(`   filas leídas: ${informe.total_filas} · cambian: ${informe.con_cambio} · iguales: ${informe.sin_cambio}`);
  const porTipo = (lista) => lista.reduce((m, x) => ({ ...m, [x.tipo]: (m[x.tipo] || 0) + 1 }), {});
  console.log('   conflictos:', JSON.stringify(porTipo(informe.conflictos)));
  console.log('   avisos:    ', JSON.stringify(porTipo(informe.avisos)));
  const muestra = VERBOSO ? Infinity : 12;
  for (const x of informe.conflictos.slice(0, muestra)) console.log('     ✗', x.mensaje);
  for (const x of informe.avisos.filter((a) => a.tipo !== 'SIN_ID').slice(0, muestra)) console.log('     !', x.mensaje);
};

const TABLA = { producto: 'productos_cantidad', atributo: 'atributos_producto' };

/** Aplica las escrituras de UNA sede: respaldo con FOR UPDATE y un UPDATE por nivel. */
const aplicarSede = async (c, sucursalId, escrituras, anteriores, respaldo) => {
  let total = 0;
  for (const nivel of Object.keys(TABLA)) {
    const lote = escrituras.filter((e) => e.nivel === nivel);
    if (!lote.length) continue;
    const ids = lote.map((e) => e.id);
    const { rows: antes } = await c.query(
      `SELECT t.id, t.precios FROM ${TABLA[nivel]} t
       JOIN sucursales su ON su.id = t.sucursal_id
       WHERE t.id = ANY($1) AND t.sucursal_id = $2 AND su.negocio_id = $3
       FOR UPDATE OF t`, [ids, sucursalId, NEGOCIO]);
    if (antes.length !== lote.length) {
      throw new Error(`${nivel} sede ${sucursalId}: se esperaban ${lote.length} filas y hay ${antes.length}`);
    }
    // Guarda: lo que se va a pisar es lo mismo que se leyó al resolver.
    for (const a of antes) {
      const leido = anteriores.get(`${nivel}:${a.id}`);
      if (JSON.stringify(leido ?? null) !== JSON.stringify(a.precios ?? null)) {
        throw new Error(`${nivel} ${a.id}: sus precios cambiaron mientras se preparaba la carga`);
      }
      respaldo.push({ sucursal_id: sucursalId, nivel, id: a.id, precios_antes: a.precios });
    }
    const { rowCount } = await c.query(
      `UPDATE ${TABLA[nivel]} t SET precios = d.precios::jsonb
       FROM unnest($1::int[], $2::text[]) AS d(id, precios), sucursales su
       WHERE t.id = d.id AND t.sucursal_id = $3 AND su.id = t.sucursal_id AND su.negocio_id = $4`,
      [ids, lote.map((e) => (e.precios === null ? null : JSON.stringify(e.precios))), sucursalId, NEGOCIO]);
    if (rowCount !== lote.length) throw new Error(`${nivel} sede ${sucursalId}: se escribieron ${rowCount} de ${lote.length}`);
    total += rowCount;
  }
  return total;
};

(async () => {
  // ── 1. Lo que hay hoy ──────────────────────────────────────────────────────
  const { rows: sedes } = await pool.query(
    `SELECT id, nombre FROM sucursales WHERE negocio_id = $1 AND id = ANY($2)`, [NEGOCIO, [BODEGA, TESLA]]);
  const nombreDe = Object.fromEntries(sedes.map((s) => [s.id, s.nombre]));
  if (!nombreDe[BODEGA] || !nombreDe[TESLA]) throw new Error('No encuentro las dos sedes en el negocio 33');

  const { rows: cfg } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1
     AND clave IN ('listas_precios_activo','listas_precios_lista')`, [NEGOCIO]);
  const mapa = Object.fromEntries(cfg.map((r) => [r.clave, r.valor]));
  if (mapa.listas_precios_activo !== '1') throw new Error('Las listas de precios no están activas en Tesla');
  const listas = util.parsearListas(mapa.listas_precios_lista);
  console.log('Listas:', listas.map((l) => `${l.nombre} (${l.id})`).join(' · '));

  const leerNodos = async (sede) => (await repo.leerNodosSucursal(sede, NEGOCIO, { incluirVariantes: true }))
    .filter((n) => TABLA[n.nivel] || n.nivel === 'variante' || n.nivel === 'serial');
  const nodosBodega = await leerNodos(BODEGA);
  const nodosTesla  = await leerNodos(TESLA);
  console.log(`Nodos hoy — ${nombreDe[BODEGA]}: ${nodosBodega.length} · ${nombreDe[TESLA]}: ${nodosTesla.length}`);

  // ── 2. Bodega: el archivo ya es suyo ───────────────────────────────────────
  const cuentaB = { decimales: 0, malLeidos: 0 };
  const hojaB = leerHoja(ARCHIVO_BODEGA);
  const filasB = hojaB.filas.map((f) => normalizarFila(f, listas, cuentaB));
  console.log(`\nArchivo bodega: hoja «${hojaB.hoja}», ${filasB.length} filas · con decimales: ${cuentaB.decimales}`
    + ` · que el lector habría leído mal: ${cuentaB.malLeidos}`);
  const resB = resolverLibro(libro(nombreDe[BODEGA], filasB),
    { listas, porSucursal: new Map([[BODEGA, { nombre: nombreDe[BODEGA], nodos: nodosBodega }]]) });
  resumirInforme(`${nombreDe[BODEGA]} (sede ${BODEGA})`, resB.informe);

  // ── 3. Tesla: cada fila se traduce al mismo nodo de la sede 48 ─────────────
  const cuentaT = { decimales: 0, malLeidos: 0 };
  const hojaT = leerHoja(ARCHIVO_TESLA);
  const porTokenBodega = new Map(nodosBodega.map((n) => [n.token, n]));
  const porClaveTesla = new Map();
  for (const n of nodosTesla) {
    const k = claveNodo(n);
    if (!porClaveTesla.has(k)) porClaveTesla.set(k, []);
    porClaveTesla.get(k).push(n);
  }
  const porTokenTesla = new Map(nodosTesla.map((n) => [n.token, n]));

  const filasT = [];
  const fuera = { sin_nodo_bodega: [], no_esta_en_tesla: [], ambiguo: [], vacias_que_conservan: [], repetido: [] };
  const usados = new Set();
  let codigoDistinto = 0;
  for (const cruda of hojaT.filas) {
    const f = normalizarFila(cruda, listas, cuentaT);
    if (!leerToken(f.ID)) { continue; }                      // encabezados de línea y filas vacías
    const etiqueta = [f.Producto, String(f.Variante ?? '').trim()].filter(Boolean).join(' · ');
    const origen = porTokenBodega.get(String(f.ID).trim().toLowerCase());
    if (!origen) { fuera.sin_nodo_bodega.push(etiqueta); continue; }
    const candidatos = porClaveTesla.get(claveNodo(origen)) || [];
    const exactos = candidatos.filter((n) => n.nombre === origen.nombre && n.detalle === origen.detalle);
    const destino = candidatos.length === 1 ? candidatos[0] : (exactos.length === 1 ? exactos[0] : null);
    if (!candidatos.length) { fuera.no_esta_en_tesla.push(etiqueta); continue; }
    if (!destino) { fuera.ambiguo.push(`${etiqueta} (${candidatos.length} en Tesla)`); continue; }
    if (usados.has(destino.token)) { fuera.repetido.push(etiqueta); continue; }
    usados.add(destino.token);
    if (origen.codigo && destino.codigo && origen.codigo !== destino.codigo) codigoDistinto++;
    if (sinPrecios(f, listas)) {
      if (destino.precios) fuera.vacias_que_conservan.push(etiqueta);
      continue;                                              // un vacío no borra lo que Tesla ya tiene
    }
    filasT.push({ ...f, ID: destino.token });
  }
  console.log(`\nArchivo Tesla: hoja «${hojaT.hoja}», ${hojaT.filas.length} filas · con decimales: ${cuentaT.decimales}`
    + ` · que el lector habría leído mal: ${cuentaT.malLeidos}`);
  console.log(`   traducidas a la sede ${TESLA}: ${filasT.length}`);
  for (const [motivo, lista] of Object.entries(fuera)) {
    console.log(`   ${motivo}: ${lista.length}`);
    for (const x of lista.slice(0, VERBOSO ? Infinity : 15)) console.log('       ·', x);
  }
  console.log(`   mismo nodo con código distinto entre sedes (solo informativo): ${codigoDistinto}`);
  const resT = resolverLibro(libro(nombreDe[TESLA], filasT),
    { listas, porSucursal: new Map([[TESLA, { nombre: nombreDe[TESLA], nodos: nodosTesla }]]) });
  resumirInforme(`${nombreDe[TESLA]} (sede ${TESLA})`, resT.informe);

  // Muestra de lo que cambia, para leerlo con ojos.
  const muestra = (titulo, escrituras, porToken) => {
    console.log(`\n   Muestra — ${titulo}`);
    const paso = Math.max(1, Math.floor(escrituras.length / 8));
    for (let i = 0; i < escrituras.length; i += paso) {
      const e = escrituras[i];
      const n = porToken.get(`${e.nivel[0]}${e.id}`);
      console.log(`     ${n.nombre}${n.detalle ? ' · ' + n.detalle : ''}: ${JSON.stringify(n.precios)} → ${JSON.stringify(e.precios)}`);
    }
  };
  muestra('bodega', resB.escrituras, porTokenBodega);
  muestra('Tesla', resT.escrituras, porTokenTesla);

  const niveles = (es) => JSON.stringify(es.reduce((m, e) => ({ ...m, [e.nivel]: (m[e.nivel] || 0) + 1 }), {}));
  console.log(`\nEscrituras — bodega: ${resB.escrituras.length} ${niveles(resB.escrituras)} · Tesla: ${resT.escrituras.length} ${niveles(resT.escrituras)}`);
  const ajenos = [...resB.escrituras, ...resT.escrituras].filter((e) => !TABLA[e.nivel]);
  if (ajenos.length) throw new Error(`Hay ${ajenos.length} escrituras de un nivel que este script no maneja`);

  if (!APLICAR) { console.log('\nEN SECO: no se escribió nada. Para aplicar: --aplicar'); await pool.end(); return; }

  // ── 4. Aplicar ─────────────────────────────────────────────────────────────
  const c = await pool.connect();
  const respaldo = [];
  try {
    await c.query("SET lock_timeout = '5s'");
    await c.query('BEGIN');
    const antB = new Map(nodosBodega.map((n) => [`${n.nivel}:${n.id}`, n.precios]));
    const antT = new Map(nodosTesla.map((n) => [`${n.nivel}:${n.id}`, n.precios]));
    const nB = await aplicarSede(c, BODEGA, resB.escrituras, antB, respaldo);
    const nT = await aplicarSede(c, TESLA, resT.escrituras, antT, respaldo);
    const archivo = path.join(__dirname, `respaldo-precios-lista-tesla-${Date.now()}.json`);
    fs.writeFileSync(archivo, JSON.stringify({ fecha: new Date().toISOString(), negocio: NEGOCIO, filas: respaldo }));
    await c.query('COMMIT');
    console.log(`\nAPLICADO — bodega: ${nB} · Tesla: ${nT} · respaldo: ${path.basename(archivo)}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('\nROLLBACK, no se escribió nada:', e.message);
    process.exitCode = 1;
    return;
  } finally { c.release(); }

  // ── 5. Comprobar: el mismo libro, vuelto a leer, ya no cambia nada ──────────
  const vB = resolverLibro(libro(nombreDe[BODEGA], filasB),
    { listas, porSucursal: new Map([[BODEGA, { nombre: nombreDe[BODEGA], nodos: await leerNodos(BODEGA) }]]) });
  const vT = resolverLibro(libro(nombreDe[TESLA], filasT),
    { listas, porSucursal: new Map([[TESLA, { nombre: nombreDe[TESLA], nodos: await leerNodos(TESLA) }]]) });
  console.log(`Comprobación — bodega: quedan ${vB.informe.con_cambio} por cambiar · Tesla: quedan ${vT.informe.con_cambio}`);
  await pool.end();
})().catch(async (e) => { console.error('ERROR:', e.message); process.exitCode = 1; await pool.end().catch(() => {}); });
