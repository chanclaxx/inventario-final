// ─────────────────────────────────────────────────────────────────────────────
// EL PAGO REGISTRADO DOS VECES — que no vuelva a entrar
//
// El 29-ago-2026 el cliente FACTURA JUANSHOP recibió TRES pagos totales de
// $100.000.000 en 2,8 segundos: $200.000.000 acreditados que nunca entraron, y
// su cuenta quedó $199.059.550 por debajo de lo que de verdad debe.
//
// Ya existía una baranda —desde el 25-ago— y no lo impidió. Falló por DOS cosas
// encadenadas, y esta suite vigila las dos, porque arreglar una sola deja el
// agujero abierto:
//
//   1. EL BOTÓN NUNCA SE DESHABILITABA. `Button` calculaba
//      `disabled={loading || props.disabled}` y acto seguido lo pisaba con
//      `{...props}`, que todavía traía `disabled`. Con el spinner girando, el
//      botón seguía aceptando clics. Afectaba a los 58 botones que pasan
//      `loading` y `disabled` a la vez.
//
//   2. LA BARANDA MIRABA DESDE FUERA DE LA TRANSACCIÓN. El SELECT de "¿ya hay
//      un gemelo?" corría sobre el pool ANTES del BEGIN. En READ COMMITTED no
//      ve lo que la petición hermana todavía no commiteó, así que las dos
//      pasaban. Solo servía para el reenvío secuencial.
//
// La sección 3 es la que de verdad importa el día de mañana: comprueba contra
// una base real que el segundo intento se rechaza, y —tan importante como eso—
// que un pago DISTINTO sí entra. Una baranda que estorba la operación real se
// termina quitando, y entonces vuelven los duplicados.
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

let fallos = 0, pasados = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${nombre}${extra ? ': ' + extra : ''}`);
  cond ? pasados++ : fallos++;
};
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
const leer = (rel) => readFileSync(path.join(RAIZ, rel), 'utf8');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. El botón se deshabilita mientras la petición viaja ═══');
// ═════════════════════════════════════════════════════════════════════════════
{
  const src = readFileSync(path.join(RAIZ, '../frontend/src/components/ui/Button.jsx'), 'utf8');

  // Se mira el CÓDIGO, sin comentarios: el comentario de arriba explica el bug
  // y nombra tanto `props.disabled` como `{...props}`. Midiendo contra el texto
  // completo, la comprobación de orden pasaba incluso con el bug puesto.
  const codigo = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const firma = codigo.match(/export function Button\(\{([^}]*)\}/s)?.[1] ?? '';
  ok('`disabled` se saca de props en la firma', /\bdisabled\b/.test(firma),
    firma.trim().replace(/\s+/g, ' ').slice(0, 70));

  // La prueba de fuego: si `disabled` no se destructura, `{...props}` lo trae y
  // pisa el cálculo. Y aunque se destructure, ponerlo ANTES del spread lo
  // dejaría a merced de cualquier prop suelta.
  const iSpread   = codigo.indexOf('{...props}');
  const iDisabled = codigo.lastIndexOf('disabled={');
  ok('el atributo `disabled` va DESPUÉS de {...props}', iSpread !== -1 && iDisabled > iSpread,
    `spread en ${iSpread}, disabled en ${iDisabled}`);
  ok('el `disabled` del botón tiene en cuenta `loading`',
    /disabled=\{\s*loading\s*\|\|/.test(codigo));
  ok('ya no se lee `props.disabled` (venía pisado por el spread)',
    !codigo.includes('props.disabled'));
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. La baranda vive DENTRO de la transacción, detrás del lock ═══');
// ═════════════════════════════════════════════════════════════════════════════
//
// Se revisa el ORDEN en el texto de cada camino que mueve plata. Es estático a
// propósito: el fallo que se quiere cazar no es un cálculo equivocado sino un
// SELECT en el sitio equivocado, y eso solo se ve leyendo el orden.
{
  const CAMINOS = [
    { que: 'abono a préstamo',      archivo: 'src/modules/prestamos/prestamos.service.js',   fn: 'const registrarAbono = async (' },
    { que: 'pago total préstamos',  archivo: 'src/modules/prestamos/prestamos.service.js',   fn: 'const registrarAbonoTotal = async (' },
    { que: 'abono a crédito',       archivo: 'src/modules/creditos/creditos.service.js',     fn: 'const registrarAbono = async (' },
    { que: 'pago total créditos',   archivo: 'src/modules/creditos/creditos.service.js',     fn: 'const registrarAbonoTotalCredito = async (' },
    { que: 'movimiento a acreedor', archivo: 'src/modules/acreedores/acreedores.service.js', fn: 'const registrarMovimiento = async (' },
  ];

  for (const c of CAMINOS) {
    const src = leer(c.archivo);
    const desde = src.indexOf(c.fn);
    // El cuerpo llega hasta la siguiente declaración de nivel superior.
    const sig = src.indexOf('\nconst ', desde + c.fn.length);
    const cuerpo = src.slice(desde, sig === -1 ? undefined : sig);

    const iBegin  = cuerpo.indexOf("client.query('BEGIN')");
    const iLock   = cuerpo.indexOf('bloquearOperacion(client');
    const iGemelo = Math.min(
      ...['Gemelo(client', 'FROM abonos_credito', 'FROM movimientos_acreedor']
        .map((p) => cuerpo.indexOf(p)).filter((i) => i !== -1).concat([Infinity])
    );

    ok(`${c.que} — abre transacción`, iBegin !== -1);
    ok(`${c.que} — toma el lock después del BEGIN`, iLock > iBegin && iBegin !== -1);
    ok(`${c.que} — comprueba el gemelo DESPUÉS del lock`, iGemelo > iLock && iLock !== -1);
    // El pecado original: preguntar por el pool. Fuera de la transacción, ese
    // SELECT no ve al hermano sin commitear.
    ok(`${c.que} — no consulta el gemelo sobre el pool`,
      !/Gemelo\(pool/.test(cuerpo) && !/rows: gemelo \} = await pool\.query/.test(cuerpo));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. Contra una base real: el segundo intento se rechaza ═══');
// ═════════════════════════════════════════════════════════════════════════════

const db = new PGlite();
await db.exec(readFileSync(path.join(AQUI, 'esquema.sql'), 'utf8'));
await db.exec(readFileSync(path.join(AQUI, 'esquema-completo.sql'), 'utf8'));
await db.exec(`
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_label VARCHAR;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_label VARCHAR;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS atributo_id    INTEGER;
  ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS variante_id    INTEGER;
  ALTER TABLE abonos_totales ADD COLUMN IF NOT EXISTS usuario_id INTEGER;
  ALTER TABLE clientes ADD COLUMN IF NOT EXISTS saldo_a_favor NUMERIC DEFAULT 0;
  ALTER TABLE seriales ADD COLUMN IF NOT EXISTS color TEXT;
  -- El estado de cuenta une las compras de artículo directas.
  ALTER TABLE retomas ADD COLUMN IF NOT EXISTS prestamo_id  INTEGER;
  ALTER TABLE retomas ADD COLUMN IF NOT EXISTS sucursal_id  INTEGER;
  ALTER TABLE retomas ADD COLUMN IF NOT EXISTS fecha        TIMESTAMP DEFAULT NOW();
  ALTER TABLE retomas ADD COLUMN IF NOT EXISTS tipo_persona TEXT;
  ALTER TABLE retomas ADD COLUMN IF NOT EXISTS persona_id   INTEGER;
`);
await db.exec(leer('migrations/20260730_mora_credito.sql'));
await db.exec(leer('migrations/20260804_interes_corriente.sql'));
await db.exec(leer('migrations/20260825_abonos_anulados.sql'));
await db.exec(leer('migrations/20260825_pago_total_credito.sql'));

const conectar = (t) => ({
  query: async (text, params) => {
    const r = await t.query(text, params ?? []);
    return { ...r, rowCount: r.rowCount ?? r.affectedRows ?? (r.rows?.length ?? 0) };
  },
});
const pool = { ...conectar(db), connect: async () => ({ ...conectar(db), release() {} }) };
require.cache[require.resolve(path.join(RAIZ, 'src/config/db.js'))] = {
  id: 'db', filename: 'db', loaded: true, exports: { pool, connectDB: async () => {} },
};

const prestamos = require(path.join(RAIZ, 'src/modules/prestamos/prestamos.service.js'));
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

await db.exec(`
  INSERT INTO negocios (nombre) VALUES ('Doble clic');
  INSERT INTO sucursales (negocio_id, nombre) VALUES (1,'Centro');
  INSERT INTO usuarios (nombre) VALUES ('Vendedor');
  INSERT INTO productos_serial (nombre, precio, sucursal_id) VALUES ('Equipo', 1200000, 1);
  INSERT INTO seriales (producto_id, imei, costo_compra, prestado) VALUES
    (1,'IM-1',600000,true),(1,'IM-2',600000,true),(1,'IM-3',600000,true);
  INSERT INTO prestatarios (negocio_id, nombre, cedula) VALUES (1,'MAYORISTA','900');
  INSERT INTO prestamos (sucursal_id, prestatario_id, prestatario, imei, valor_prestamo, valor,
                         total_abonado, estado, nombre_producto, fecha)
  VALUES (1, 1, 'MAYORISTA', 'IM-1', 1000000, 1000000, 0, 'Activo', 'Equipo A', NOW() - INTERVAL '9 days'),
         (1, 1, 'MAYORISTA', 'IM-2', 1000000, 1000000, 0, 'Activo', 'Equipo B', NOW() - INTERVAL '8 days'),
         (1, 1, 'MAYORISTA', 'IM-3', 1000000, 1000000, 0, 'Activo', 'Equipo C', NOW() - INTERVAL '7 days');
`);

const deuda = async () => {
  const rows = await q(`SELECT valor_prestamo, total_abonado FROM prestamos
                         WHERE prestatario_id = 1 AND estado = 'Activo'`);
  return rows.reduce((s, p) => s + Math.max(0, Number(p.valor_prestamo) - Number(p.total_abonado)), 0);
};

{
  ok('la persona arranca debiendo $3.000.000', (await deuda()) === 3000000, money(await deuda()));

  // ── El primer pago entra normalmente ──────────────────────────────────────
  const uno = await prestamos.registrarAbonoTotal(1, 'prestatario', 1, 1000000, 'Efectivo', 1, 1);
  ok('el primer pago total entra', !!uno.abonoTotal?.id);
  ok('bajó la deuda a $2.000.000', (await deuda()) === 2000000, money(await deuda()));

  // ── El segundo, idéntico, es el doble clic ────────────────────────────────
  let rechazo = null;
  try {
    await prestamos.registrarAbonoTotal(1, 'prestatario', 1, 1000000, 'Efectivo', 1, 1);
  } catch (e) { rechazo = e; }
  ok('el segundo pago IDÉNTICO se rechaza', !!rechazo, rechazo ? `${rechazo.status}` : 'NO se rechazó');
  ok('lo rechaza con 409 (conflicto), no con un 500', rechazo?.status === 409);
  ok('la deuda NO se movió con el intento repetido', (await deuda()) === 2000000, money(await deuda()));
  ok('solo quedó UN pago total escrito',
    (await q('SELECT id FROM abonos_totales')).length === 1);

  // ── Pero la baranda no puede estorbar la operación real ───────────────────
  const dos = await prestamos.registrarAbonoTotal(1, 'prestatario', 1, 500000, 'Efectivo', 1, 1);
  ok('un pago de OTRO valor sí entra', !!dos.abonoTotal?.id);
  ok('y baja la deuda a $1.500.000', (await deuda()) === 1500000, money(await deuda()));

  // El abono individual tiene su propia baranda, con su propia clave.
  const prest = (await q(`SELECT id FROM prestamos WHERE estado='Activo' ORDER BY id LIMIT 1`))[0];
  await prestamos.registrarAbono(1, prest.id, 100000, 'Efectivo', 1, null, { sucursalId: 1 });
  let rechazoAbono = null;
  try {
    await prestamos.registrarAbono(1, prest.id, 100000, 'Efectivo', 1, null, { sucursalId: 1 });
  } catch (e) { rechazoAbono = e; }
  ok('el abono individual repetido también se rechaza', rechazoAbono?.status === 409);
  await prestamos.registrarAbono(1, prest.id, 250000, 'Efectivo', 1, null, { sucursalId: 1 });
  ok('y un abono de otro valor sigue entrando', (await deuda()) === 1150000, money(await deuda()));
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. El reparto en lote da lo mismo que uno por uno ═══');
// ═════════════════════════════════════════════════════════════════════════════
//
// El pago total pasó a escribir en lote los préstamos SIN cargos pactados (de
// ~6 consultas por préstamo a tres para todos). Lo que no puede cambiar es el
// resultado: los mismos abonos, los mismos saldados, el mismo orden y el equipo
// marcado como vendido.
{
  await db.exec(`
    INSERT INTO prestatarios (negocio_id, nombre, cedula) VALUES (1,'LOTE','901');
    INSERT INTO productos_serial (nombre, precio, sucursal_id) VALUES ('Equipo L', 1000000, 1);
    INSERT INTO seriales (producto_id, imei, costo_compra, prestado) VALUES
      (2,'LT-1',500000,true),(2,'LT-2',500000,true),(2,'LT-3',500000,true);
    INSERT INTO prestamos (sucursal_id, prestatario_id, prestatario, imei, valor_prestamo, valor,
                           total_abonado, estado, nombre_producto, fecha)
    VALUES (1, 2, 'LOTE', 'LT-1', 400000, 400000, 0, 'Activo', 'L1', NOW() - INTERVAL '5 days'),
           (1, 2, 'LOTE', 'LT-2', 400000, 400000, 0, 'Activo', 'L2', NOW() - INTERVAL '4 days'),
           (1, 2, 'LOTE', 'LT-3', 400000, 400000, 0, 'Activo', 'L3', NOW() - INTERVAL '3 days');
  `);

  // $1.000.000 sobre tres préstamos de $400.000: cierra dos y deja el tercero a medias.
  const r = await prestamos.registrarAbonoTotal(1, 'prestatario', 2, 1000000, 'Efectivo', 1, 1);

  ok('reparte sobre los tres préstamos', r.distribucion.length === 3, `${r.distribucion.length}`);
  ok('respeta el orden FIFO (más viejo primero)',
    r.distribucion.map((d) => d.nombre_producto).join(',') === 'L1,L2,L3',
    r.distribucion.map((d) => d.nombre_producto).join(','));
  ok('los dos primeros quedan saldados y el tercero no',
    r.distribucion.map((d) => (d.saldado ? 'S' : 'a')).join('') === 'SSa',
    r.distribucion.map((d) => (d.saldado ? 'S' : 'a')).join(''));
  ok('el reparto suma el pago completo',
    r.distribucion.reduce((s, d) => s + Number(d.abono), 0) === 1000000);

  const filas = await q(`SELECT p.nombre_producto, p.total_abonado, p.estado
                           FROM prestamos p WHERE p.prestatario_id = 2 ORDER BY p.fecha`);
  ok('el abonado quedó 400.000 / 400.000 / 200.000',
    filas.map((f) => Number(f.total_abonado)).join('/') === '400000/400000/200000',
    filas.map((f) => Number(f.total_abonado)).join('/'));
  ok('los estados quedaron Saldado / Saldado / Activo',
    filas.map((f) => f.estado).join('/') === 'Saldado/Saldado/Activo',
    filas.map((f) => f.estado).join('/'));

  const abonos = await q(`SELECT ap.valor, ap.abono_total_id FROM abonos_prestamo ap
                            JOIN prestamos p ON p.id = ap.prestamo_id
                           WHERE p.prestatario_id = 2 ORDER BY ap.id`);
  ok('escribió un abono por préstamo, atado al pago total', abonos.length === 3
    && abonos.every((a) => Number(a.abono_total_id) === Number(r.abonoTotal.id)));

  // El pago total no factura cada préstamo, pero sí marca el equipo vendido.
  const seriales = await q(`SELECT imei, vendido, prestado FROM seriales
                             WHERE imei IN ('LT-1','LT-2','LT-3') ORDER BY imei`);
  ok('marca vendidos SOLO los equipos de los préstamos que se saldaron',
    seriales.map((s) => (s.vendido ? 'V' : '-')).join('') === 'VV-',
    seriales.map((s) => (s.vendido ? 'V' : '-')).join(''));
  ok('y les quita la marca de prestado',
    seriales.filter((s) => s.vendido).every((s) => s.prestado === false));

  // El extracto tiene que seguir cuadrando con la deuda (el invariante de la 29).
  const movs = await prestamos.getEstadoCuenta(1, 'prestatario', 2);
  const conSaldo = movs.filter((m) => m.saldo != null);
  const extracto = conSaldo.length ? Number(conSaldo[conSaldo.length - 1].saldo) : 0;
  const rows = await q(`SELECT valor_prestamo, total_abonado FROM prestamos
                         WHERE prestatario_id = 2 AND estado = 'Activo'`);
  const deudaLote = rows.reduce((s, p) => s + Math.max(0,
    Number(p.valor_prestamo) - Number(p.total_abonado)), 0);
  ok('★ el extracto sigue cuadrando con la deuda', Math.abs(extracto - deudaLote) < 1,
    `${money(extracto)} vs ${money(deudaLote)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n──────────────────────────────────────────────────────────────');
if (fallos) {
  console.log(`✗ ${fallos} FALLIDAS de ${pasados + fallos}`);
  process.exit(1);
}
console.log(`✓ TODO OK — ${pasados} verificaciones`);
