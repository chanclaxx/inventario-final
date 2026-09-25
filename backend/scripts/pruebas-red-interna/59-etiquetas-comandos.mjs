// ─────────────────────────────────────────────────────────────────────────────
// ETIQUETAS COMO COMANDOS (TSPL / ZPL) — impresión directa sin el navegador
//
// Reportado con una DIG T451B (sep-2026): Chrome gira la página del PDF cuando
// no calza con el papel del driver, así que una tira de 3 columnas salía como
// 3 filas; en «hoja», filas en blanco. La salida es mandarle a la impresora sus
// propios comandos, con el tamaño y el hueco dentro del trabajo.
//
// Lo que esta prueba sostiene:
//   1. El trabajo dice el papel que el formato dice (SIZE / GAP / ^PW / ^LL),
//      y el volteo y el desvío llegan.
//   2. Cada código de barras, traducido a rectángulos en puntos del cabezal,
//      DECODIFICA al texto original — en todos los formatos del catálogo.
//   3. Cada QR reconstruido desde los rectángulos es la MISMA matriz.
//   4. Nada se sale de su etiqueta: ni barras ni texto (con el ancho real de las
//      fuentes internas de TSPL).
//   5. El código legible nunca se corta.
//   6. «Empezar en la etiqueta N», la hoja de prueba, las tildes (CP850).
//   7. La firma de QZ Tray verifica contra el certificado.
//
//   node scripts/pruebas-red-interna/59-etiquetas-comandos.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

const { PATRONES } = require(path.join(RAIZ, 'src/utils/code128.util'));
const qrUtil   = require(path.join(RAIZ, 'src/utils/qr.util'));
const formatos = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.formatos'));
const { generarComandos, FUENTES_TSPL, _cp850 } = require(path.join(RAIZ, 'src/modules/etiquetas/etiquetas.comandos'));
const { MM } = formatos;

let fallos = 0, pasados = 0;
const check = (etiqueta, cond, detalle = '') => {
  if (cond) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else { fallos++; console.log(`  ✗ ${etiqueta}${detalle ? `\n      ${detalle}` : ''}`); }
};
const seccion = (t) => console.log(`\n${t}`);

const OP = (extra = {}) => ({
  simbologia: 'barras',
  mostrar: { nombre: true, variante: true, precio: true },
  diseno: {}, ajuste: { x: 0, y: 0 }, impresora: { rotacion: 0 }, dpi: 203, desde: 1, ...extra,
});
const ITEMS = [
  { nombre: 'Audífonos Bluetooth Niño', variante_label: 'Blanco', codigo: 'ACC-AUD-BLA-002', precio: 15000 },
  { nombre: 'Cargador', codigo: '000121', precio: 25000 },
  { nombre: 'Estuche iPhone 11 Pro Max con cierre magnético y tapa', variante_label: 'Negro', codigo: '12345678', precio: 9900 },
  { nombre: 'Vidrio', codigo: '999', precio: 5000 },
];

// ── Lector del trabajo TSPL: páginas → rectángulos y textos ────────────────
const leerTspl = (buf) => {
  const txt = buf.toString('latin1');
  const paginas = [];
  let p = null;
  for (const l of txt.split('\r\n')) {
    if (l === 'CLS') { p = { bars: [], textos: [], boxes: [] }; paginas.push(p); continue; }
    let m;
    if ((m = l.match(/^BAR (\d+),(\d+),(\d+),(\d+)$/))) p.bars.push(m.slice(1).map(Number));
    else if ((m = l.match(/^BOX (\d+),(\d+),(\d+),(\d+),(\d+)$/))) p.boxes.push(m.slice(1).map(Number));
    else if ((m = l.match(/^TEXT (-?\d+),(-?\d+),"(\d)",0,1,1,"(.*)"$/))) p.textos.push({ x: +m[1], y: +m[2], f: m[3], s: m[4] });
  }
  return { txt, paginas };
};

// Decodifica un Code 128 desde rectángulos de UNA etiqueta (mismo y), midiendo
// anchos como un lector: barra, espacio, barra…
const INV = Object.fromEntries(PATRONES.map((p, i) => [p, i]));
const decodificar = (bars) => {
  const b = [...bars].sort((a, c) => a[0] - c[0]);
  const mod = Math.min(...b.map((r) => r[2]));
  const w = [];
  for (let i = 0; i < b.length; i += 1) {
    w.push(b[i][2] / mod);
    if (i < b.length - 1) w.push((b[i + 1][0] - b[i][0] - b[i][2]) / mod);
  }
  // Símbolos de 6 elementos y el STOP de 7 al final (2331112).
  const vals = [];
  let i = 0;
  for (; i + 7 < w.length; i += 6) vals.push(INV[w.slice(i, i + 6).join('')]);
  vals.push(INV[w.slice(i).join('')]);
  if (vals.some((v) => v === undefined) || vals[vals.length - 1] !== 106) return null;
  let suma = vals[0];
  for (let k = 1; k < vals.length - 2; k += 1) suma += k * vals[k];
  if (suma % 103 !== vals[vals.length - 2]) return null;
  let set = vals[0] === 105 ? 'C' : 'B';
  let out = '';
  for (const v of vals.slice(1, -2)) {
    if (v === 99) { set = 'C'; continue; }
    if (v === 100) { set = 'B'; continue; }
    out += set === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
  }
  return out;
};

const celdaDots = (f, i, k, dx = 0, dy = 0) => {
  const col = i % f.columnas;
  const fil = Math.floor(i / f.columnas);
  const x = (f.margen.izquierda + col * (f.etiqueta.ancho + f.separacion.x)) * MM * k + dx;
  const y = (f.margen.arriba + fil * (f.etiqueta.alto + f.separacion.y)) * MM * k + dy;
  return { x, y, w: f.etiqueta.ancho * MM * k, h: f.etiqueta.alto * MM * k };
};
const dentro = (r, c) => r[0] >= Math.floor(c.x) - 1 && r[1] >= Math.floor(c.y) - 1
  && r[0] + r[2] <= Math.ceil(c.x + c.w) + 1 && r[1] + r[3] <= Math.ceil(c.y + c.h) + 1;
const celdaDe = (r, f, k, n) => {
  for (let i = 0; i < n; i += 1) { const c = celdaDots(f, i, k); if (dentro(r, c)) return i; }
  return -1;
};

// ─────────────────────────────────────────────────────────────────────────────
seccion('1. El trabajo dice el papel del formato (el caso reportado: 3 columnas en 104 mm)');
{
  const f = formatos.resolver('rollo3-32x25');
  const { txt } = leerTspl(generarComandos({ etiquetas: ITEMS, formato: f, opciones: OP() }));
  check('SIZE = una FILA del rollo, 104 × 25 mm', txt.includes('SIZE 104 mm,25 mm\r\n'));
  check('GAP = el hueco entre filas (3 mm), para que la impresora se realinee en cada fila', txt.includes('GAP 3 mm,0 mm\r\n'));
  check('CODEPAGE 850 (tildes y ñ)', txt.includes('CODEPAGE 850\r\n'));
  check('4 etiquetas en 3 columnas = 2 filas impresas', (txt.match(/^PRINT 1,1$/gm) || []).length === 2);
  check('el encabezado va UNA vez', (txt.match(/^SIZE /gm) || []).length === 1);
  const normal = txt.match(/DIRECTION (\d),0/)[1];
  const volteado = generarComandos({ etiquetas: ITEMS, formato: f, opciones: OP({ impresora: { rotacion: 180 } }) })
    .toString('latin1').match(/DIRECTION (\d),0/)[1];
  check('180° cambia DIRECTION (y nada más)', normal !== volteado);

  const recibo = formatos.resolver('recibo-80');
  const tr = generarComandos({ etiquetas: ITEMS, formato: recibo, opciones: OP() }).toString('latin1');
  check('papel continuo: GAP 0 y la página ya trae la separación', tr.includes('GAP 0 mm,0 mm') && tr.includes(`SIZE 80 mm,${recibo.pagina.alto} mm`));

  const z = generarComandos({ lenguaje: 'zpl', etiquetas: ITEMS, formato: f, opciones: OP() }).toString('utf8');
  check('ZPL: ancho 104 mm = 831 puntos, alto 25 mm = 200', z.includes('^PW831') && z.includes('^LL200'));
  check('ZPL: sensor de hueco (^MNY) y UTF-8 (^CI28)', z.includes('^MNY') && z.includes('^CI28'));
  check('ZPL: 2 filas = 2 ^XA…^XZ', (z.match(/\^XA/g) || []).length === 2 && (z.match(/\^XZ/g) || []).length === 2);
  check('ZPL: 180° = ^POI', generarComandos({ lenguaje: 'zpl', etiquetas: ITEMS, formato: f, opciones: OP({ impresora: { rotacion: 180 } }) }).toString().includes('^POI'));
  check('ZPL: el texto va con sus tildes', z.includes('Audífonos'));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('2-4. Todos los formatos: los códigos decodifican, los QR son la misma matriz, nada se sale');
for (const dpi of [203, 300]) {
  const k = dpi / 72;
  let decod = 0, decodMal = [], qrOk = 0, qrMal = [], fuera = [];
  for (const f0 of formatos.FORMATOS) {
    const f = formatos.resolver(f0.id);
    const n = Math.min(ITEMS.length, f.columnas * f.filas);
    const items = ITEMS.slice(0, n);
    for (const simbologia of ['barras', 'qr']) {
      const { paginas } = leerTspl(generarComandos({ etiquetas: items, formato: f, opciones: OP({ simbologia, dpi }) }));
      const pag = paginas[0];
      const porCelda = items.map(() => []);
      for (const r of pag.bars) {
        const c = celdaDe(r, f, k, n);
        if (c < 0) { fuera.push(`${f.id}/${simbologia}/${dpi}: barra ${r}`); continue; }
        porCelda[c].push(r);
      }
      for (const t of pag.textos) {
        const [alto, ancho] = FUENTES_TSPL[dpi >= 250 ? 300 : 203][t.f];
        const r = [t.x, t.y, t.s.length * ancho, alto];
        if (celdaDe(r, f, k, n) < 0) fuera.push(`${f.id}/${simbologia}/${dpi}: texto "${t.s}"`);
      }
      items.forEach((it, i) => {
        if (simbologia === 'barras') {
          const d = decodificar(porCelda[i]);
          if (d === it.codigo) decod++; else decodMal.push(`${f.id}/${dpi}: "${it.codigo}" → "${d}"`);
        } else {
          const rs = porCelda[i];
          const mod = Math.min(...rs.map((r) => r[3]));
          const x0 = Math.min(...rs.map((r) => r[0]));
          const y0 = Math.min(...rs.map((r) => r[1]));
          const { matriz, lado } = qrUtil.codificar(it.codigo);
          const m = Array.from({ length: lado }, () => Array(lado).fill(false));
          for (const r of rs) for (let x = r[0]; x < r[0] + r[2]; x += mod) m[(r[1] - y0) / mod][(x - x0) / mod] = true;
          // Los módulos oscuros del borde fijan x0/y0: los patrones de posición
          // ocupan la esquina (0,0), así que el origen coincide.
          const igual = matriz.every((fila, a) => fila.every((v, b) => !!v === m[a][b]));
          if (igual) qrOk++; else qrMal.push(`${f.id}/${dpi}: ${it.codigo}`);
        }
      });
    }
  }
  check(`${dpi} dpi: ${decod} códigos de barras decodifican al texto original`, decodMal.length === 0, decodMal.slice(0, 5).join('\n      '));
  check(`${dpi} dpi: ${qrOk} QR reconstruidos = la misma matriz`, qrMal.length === 0, qrMal.slice(0, 5).join('\n      '));
  check(`${dpi} dpi: ninguna barra ni texto se sale de su etiqueta`, fuera.length === 0, fuera.slice(0, 5).join('\n      '));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('5. El código legible nunca se corta');
{
  let cortados = [];
  for (const f0 of formatos.FORMATOS) {
    const f = formatos.resolver(f0.id);
    const items = ITEMS.slice(0, Math.min(ITEMS.length, f.columnas));
    const { paginas } = leerTspl(generarComandos({ etiquetas: items, formato: f, opciones: OP() }));
    for (const it of items) {
      if (!paginas[0].textos.some((t) => t.s === it.codigo)) cortados.push(`${f.id}: ${it.codigo}`);
    }
  }
  check('en todos los formatos, cada código aparece entero como texto', cortados.length === 0, cortados.slice(0, 5).join('\n      '));
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('6. Empezar en la etiqueta N, hoja de prueba, desvío, tildes');
{
  const f = formatos.resolver('rollo3-32x25');
  const k = 203 / 72;
  const { paginas } = leerTspl(generarComandos({ etiquetas: ITEMS.slice(0, 1), formato: f, opciones: OP({ desde: 3 }) }));
  const celdas = new Set(paginas[0].bars.map((r) => celdaDe(r, f, k, 3)));
  check('desde 3: la única etiqueta cae en la tercera columna', celdas.size === 1 && celdas.has(2));

  const base = leerTspl(generarComandos({ etiquetas: ITEMS.slice(0, 1), formato: f, opciones: OP() })).paginas[0].bars[0];
  const movida = leerTspl(generarComandos({ etiquetas: ITEMS.slice(0, 1), formato: f, opciones: OP({ ajuste: { x: 2, y: 1 } }) })).paginas[0].bars[0];
  check('desvío 2 mm / 1 mm = 16 / 8 puntos a 203 dpi', Math.abs(movida[0] - base[0] - 16) <= 1 && Math.abs(movida[1] - base[1] - 8) <= 1);

  const prueba = leerTspl(generarComandos({ formato: f, opciones: OP(), prueba: true }));
  check('prueba en rollo: 2 filas', prueba.paginas.length === 2);
  check('prueba: un contorno por etiqueta', prueba.paginas.every((p) => p.boxes.length === 3));
  check('prueba: numeradas #1…#6', prueba.paginas.flatMap((p) => p.textos.map((t) => t.s)).filter((s) => /^#\d$/.test(s)).join() === '#1,#2,#3,#4,#5,#6');
  const regla = prueba.paginas[0].bars.filter((r) => r[3] === 2 && r[2] > 100)[0];
  check('prueba: la regla de 30 mm mide 30 mm en puntos (240 ± 1)', regla && Math.abs(regla[2] - 240) <= 1, JSON.stringify(regla));

  check('CP850: á é í ó ú ñ Ñ', _cp850('áéíóúñÑ').equals(Buffer.from([0xA0, 0x82, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5])));
  check('lo que no está en CP850 pierde la tilde, no se vuelve basura', _cp850('ãõ').toString('latin1') === 'ao');
  check('la comilla doble no rompe el TEXT', !_cp850('14" pulgadas').includes(0x22));
  check('el espacio duro del precio es un espacio', _cp850('$ 15.000').toString('latin1') === '$ 15.000');
}

// ─────────────────────────────────────────────────────────────────────────────
seccion('7. Firma de QZ Tray');
{
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const qzPath = path.join(RAIZ, 'src/modules/etiquetas/etiquetas.qz.js');

  delete process.env.QZ_PRIVATE_KEY;
  delete require.cache[require.resolve(qzPath)];
  let qz = require(qzPath);
  check('sin clave: no hay certificado ni firma (QZ imprime preguntando)', qz.certificado() === null && qz.firmar('x') === null);

  for (const [nombre, valor] of [['PEM', pem], ['base64', Buffer.from(pem).toString('base64')], ['PEM con \\n escapados', pem.replace(/\n/g, '\\n')]]) {
    process.env.QZ_PRIVATE_KEY = valor;
    delete require.cache[require.resolve(qzPath)];
    qz = require(qzPath);
    const firma = qz.firmar('hola QZ');
    const v = crypto.createVerify('RSA-SHA512'); v.update('hola QZ');
    check(`clave en ${nombre}: la firma SHA-512 verifica`, !!firma && v.verify(publicKey, firma, 'base64'));
  }
  check('con clave: sirve el certificado del repo', /BEGIN CERTIFICATE/.test(qz.certificado() || ''));
  delete process.env.QZ_PRIVATE_KEY;
}

console.log('\n──────────────────────────────────────────────────────────────');
console.log(fallos ? `✗ ${fallos} FALLOS, ${pasados} bien` : `✓ TODO OK — ${pasados} verificaciones`);
process.exit(fallos ? 1 : 0);
