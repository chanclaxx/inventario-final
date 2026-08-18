// Exporta la cartera COMPLETA de la pantalla de Préstamos: préstamos + créditos.
//
// Hojas: Resumen · Cartera por persona · Préstamos · Créditos · Por cobrar ·
//        Abonos totales   (las que quedan vacías no se crean)
//
// Comparte la paleta y las primitivas con los exportadores por persona
// (estadoCuentaExcel.js) para que todo lo que sale de la app se vea igual.
//
// Dos cosas que conviene saber antes de tocar este archivo:
//
//   · Las agrupaciones por persona se RE-DERIVAN aquí desde las listas planas,
//     con las MISMAS claves que arma la pantalla (`prestatario_<id>`,
//     `cliente_<id>`, y la cédula —o el nombre— en créditos). Si esas claves
//     cambian en PrestamosPage o TabCreditos, hay que cambiarlas aquí también o
//     las filas dejarán de corresponder a las tarjetas que ve el usuario.
//
//   · La mora y el interés NUNCA se suman al capital ni al total abonado: van
//     en columnas propias. Son ingreso financiero, no pago del producto, y
//     mezclarlos haría ver utilidad comercial donde no la hay.
//
// El exportador tolera listas incompletas a propósito: la búsqueda de préstamos
// devuelve filas sin mora, sin interés y sin fecha límite, y esas columnas
// simplemente salen vacías en vez de romper el archivo.
import * as XLSX from 'xlsx';
import {
  C, put, headers, seal, fmtFecha, hoy, nombreArchivo,
  sC, sN, sNat, sTotal, sTotalLabel, sSeccion, sLabel, sValor, sMoneda, sLeyenda,
} from './estadoCuentaExcel';

// ─── Colores de fila ──────────────────────────────────────────────────────────

const BG = {
  activo:   C.activo_bg,    // blanco  — vigente y al día
  saldado:  C.saldado_bg,   // verde   — pagado
  cerrado:  C.devuelto_bg,  // gris    — devuelto / cancelado
  vencido:  'FEE2E2',       // rojo    — pasó la fecha límite
  urgente:  'FECACA',       // rojo+   — más de 60 días de atraso
  aviso:    'FEF3C7',       // ámbar   — sin plazo vencido pero con cargos
  sinDeuda: 'F3F4F6',
};

const VERDE = '16A34A';
const ROJO  = 'DC2626';
const TEAL  = '0F766E';

// ─── Fechas ───────────────────────────────────────────────────────────────────

/** Hoy en Colombia como 'YYYY-MM-DD'. */
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

/**
 * `fecha_limite` es DATE, no timestamp: se corta la cadena en vez de construir
 * un Date. Pasarla por `fmtFecha` (que lee en Bogotá) la correría un día hacia
 * atrás cuando el backend la serializa como medianoche UTC.
 */
function fmtFechaSola(val) {
  const f = String(val ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return '';
  const [a, m, d] = f.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Días de atraso. Cuando el documento tiene mora pactada manda el backend, que
 * es quien cobra; si solo tiene plazo (sin condición de mora) se derivan de la
 * fecha límite. Aquí no se calcula dinero, solo el conteo de días que se
 * muestra al lado.
 */
function diasVencido(doc) {
  if (doc?.mora?.aplica) return Number(doc.mora.dias_vencidos) || 0;
  const f = String(doc?.fecha_limite ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return 0;
  const dias = Math.floor((Date.parse(hoyISO()) - Date.parse(f)) / 86400000);
  return dias > 0 ? dias : 0;
}

// ─── Lecturas de un documento ─────────────────────────────────────────────────

const moraDe    = (d) => Number(d?.mora?.pendiente    || 0);
const interesDe = (d) => Number(d?.interes?.pendiente || 0);

const esActivo = (d) => d?.estado === 'Activo';

/** Capital pendiente de un préstamo. Nunca negativo. */
const saldoPrestamo = (p) => Math.max(0, Number(
  p.saldo_pendiente ?? (Number(p.valor_prestamo || 0) - Number(p.total_abonado || 0))
));

/** Capital pendiente de un crédito: valor − cuota inicial − abonos. */
const saldoCredito = (c) => Math.max(0, Number(
  c.saldo_pendiente ?? (Number(c.valor_total || 0) - Number(c.cuota_inicial || 0) - Number(c.total_abonado || 0))
));

const nombrePersona = (p) => p.prestatario_nombre || p.cliente_nombre || p.prestatario || 'Sin nombre';

/** La cédula de un compañero es un centinela, no un documento real. */
const cedulaDe = (p) => (p.cedula && p.cedula !== 'COMPANERO' ? p.cedula : '');

/**
 * Teléfono de la persona del préstamo. El de un compañero NO está en la fila
 * del préstamo (ahí `telefono` es el centinela '0000000000'): vive en la tabla
 * de prestatarios, igual que en la pantalla. Sin ese mapa la hoja "Por cobrar"
 * saldría sin a quién llamar.
 */
const telefonoDe = (p, tels) => {
  const t = (p.prestatario_id ? tels?.get(Number(p.prestatario_id)) : null)
    || p.cliente_celular || p.telefono || '';
  return t && t !== '0000000000' ? t : '';
};

/** Color de fondo de la fila de un documento. */
function bgDocumento(doc, dias) {
  if (doc.estado === 'Saldado') return BG.saldado;
  if (doc.estado !== 'Activo')  return BG.cerrado;   // Devuelto / Cancelado
  if (dias > 60)                return BG.urgente;
  if (dias > 0)                 return BG.vencido;
  if (moraDe(doc) + interesDe(doc) > 0) return BG.aviso;
  return BG.activo;
}

/** Fila de totales que cierra una hoja de detalle. */
function filaTotales(ws, r, nCols, etiqueta, colEtiqueta, sumas) {
  for (let c = 0; c < nCols; c++) {
    if (sumas[c] != null) put(ws, r, c, 'n', sumas[c], sTotal());
    else                  put(ws, r, c, 's', c === colEtiqueta ? etiqueta : '', sTotalLabel());
  }
}

/** Autofiltro sobre los datos, dejando la fila de totales fuera. */
function autofiltro(ws, filas, nCols) {
  if (filas <= 0) return;
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas, c: nCols - 1 } }),
  };
}

// ─── Agrupación por persona ───────────────────────────────────────────────────

/**
 * Une préstamos y créditos en una lista de personas, respetando la separación
 * de la pantalla: un mismo cliente puede aparecer dos veces (una por su
 * préstamo, otra por su crédito) porque la app los identifica distinto —
 * préstamos por `cliente_id`, créditos por cédula. Fusionarlos aquí inventaría
 * una identidad que el sistema no tiene.
 */
function agruparPersonas(prestamos, creditos, tels) {
  const mapa = new Map();

  const nuevo = (clave, origen, nombre) => {
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        origen, nombre, cedula: '', telefono: '',
        documentos: 0, activos: 0,
        capital: 0, mora: 0, interes: 0,
        saldoAFavor: 0, ultimoAbono: null, vencido: false,
      });
    }
    return mapa.get(clave);
  };

  prestamos.forEach((p) => {
    const esCompanero = !!p.prestatario_id;
    const clave  = esCompanero ? `prestatario_${p.prestatario_id}` : `cliente_${p.cliente_id ?? nombrePersona(p)}`;
    const origen = esCompanero ? 'Préstamo · Compañero' : 'Préstamo · Cliente';
    const g      = nuevo(clave, origen, nombrePersona(p));

    g.cedula   = g.cedula   || cedulaDe(p);
    g.telefono = g.telefono || telefonoDe(p, tels);
    g.documentos++;
    if (esActivo(p)) {
      g.activos++;
      g.capital += saldoPrestamo(p);
      if (diasVencido(p) > 0) g.vencido = true;
    }
    g.mora    += moraDe(p);
    g.interes += interesDe(p);

    const aFavor = Number(esCompanero ? p.prestatario_saldo_a_favor : p.cliente_saldo_a_favor) || 0;
    if (aFavor > g.saldoAFavor) g.saldoAFavor = aFavor;

    const ult = esCompanero ? p.ultimo_abono_prestatario : p.ultimo_abono_cliente;
    if (ult && (!g.ultimoAbono || new Date(ult) > new Date(g.ultimoAbono))) g.ultimoAbono = ult;
  });

  creditos.forEach((c) => {
    // Misma clave que TabCreditos: la cédula, y el nombre cuando no la hay.
    const clave = `credito_${c.cedula || c.nombre_cliente}`;
    const g     = nuevo(clave, 'Crédito', c.nombre_cliente || 'Sin nombre');

    g.cedula   = g.cedula   || c.cedula  || '';
    g.telefono = g.telefono || c.celular || '';
    g.documentos++;
    if (esActivo(c)) {
      g.activos++;
      g.capital += saldoCredito(c);
      if (diasVencido(c) > 0) g.vencido = true;
    }
    g.mora    += moraDe(c);
    g.interes += interesDe(c);
  });

  return Array.from(mapa.values())
    .map((g) => ({ ...g, total: g.capital + g.mora + g.interes }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
}

// ─── Hoja 1: Resumen ──────────────────────────────────────────────────────────

function hojaResumen({ titulo, sucursal, prestamos, creditos, personas }) {
  const ws = {};
  let r = 0;

  const pActivos  = prestamos.filter(esActivo);
  const cActivos  = creditos.filter(esActivo);

  const deudaPrestamos = pActivos.reduce((s, p) => s + saldoPrestamo(p), 0);
  const deudaCreditos  = cActivos.reduce((s, c) => s + saldoCredito(c),  0);
  const moraTotal      = [...prestamos, ...creditos].reduce((s, d) => s + moraDe(d),    0);
  const interesTotal   = [...prestamos, ...creditos].reduce((s, d) => s + interesDe(d), 0);
  const saldoAFavor    = personas.reduce((s, g) => s + g.saldoAFavor, 0);

  const pVencidos = pActivos.filter((p) => diasVencido(p) > 0);
  const cVencidos = cActivos.filter((c) => diasVencido(c) > 0);

  const cuenta = (lista, estado) => lista.filter((d) => d.estado === estado).length;
  const suma   = (lista, campo)  => lista.reduce((s, d) => s + (Number(d[campo]) || 0), 0);

  put(ws, r, 0, 's', `${titulo} — ${sucursal}`, sSeccion());
  ws['!merges'] = [{ s: { r, c: 0 }, e: { r, c: 3 } }];
  r++;
  put(ws, r, 0, 's', `Generado el ${hoy()}  ·  ${prestamos.length} préstamo(s)  ·  ${creditos.length} crédito(s)`, sC(C.blanco));
  r += 2;

  /** Escribe un bloque de etiqueta/valor y devuelve la fila siguiente. */
  const bloque = (tituloBloque, filas) => {
    put(ws, r, 0, 's', tituloBloque, sSeccion()); r++;
    filas.forEach(([label, valor, color, esMoneda]) => {
      put(ws, r, 0, 's', label, sLabel());
      put(ws, r, 1, 'n', valor, esMoneda ? sMoneda(color) : sValor(color));
      r++;
    });
    r++;
  };

  const capitalTotal = deudaPrestamos + deudaCreditos;
  const totalCobrar  = capitalTotal + moraTotal + interesTotal;

  bloque('💰  CARTERA TOTAL', [
    ['Deuda de préstamos (capital)', deudaPrestamos, deudaPrestamos > 0 ? ROJO : VERDE, true],
    ...(creditos.length ? [['Deuda de créditos (capital)', deudaCreditos, deudaCreditos > 0 ? ROJO : VERDE, true]] : []),
    ['Capital pendiente total',      capitalTotal,   C.headerOscuro, true],
    ['Mora pendiente (aparte)',      moraTotal,      moraTotal    > 0 ? ROJO : C.gris600, true],
    ['Interés pendiente (aparte)',   interesTotal,   interesTotal > 0 ? TEAL : C.gris600, true],
    ['TOTAL A COBRAR',               totalCobrar,    ROJO,           true],
    ['Saldo a favor de personas',    saldoAFavor,    saldoAFavor  > 0 ? TEAL : C.gris600, true],
  ]);

  bloque('🤝  PRÉSTAMOS', [
    ['Personas con deuda',   personas.filter((g) => g.origen.startsWith('Préstamo') && g.total > 0).length, ROJO, false],
    ['Préstamos activos',    cuenta(prestamos, 'Activo'),   ROJO,  false],
    ['Préstamos saldados',   cuenta(prestamos, 'Saldado'),  VERDE, false],
    ['Préstamos devueltos',  cuenta(prestamos, 'Devuelto'), C.gris600, false],
    ['Valor prestado (histórico)', suma(prestamos, 'valor_prestamo'), C.headerOscuro, true],
    ['Total abonado',        suma(prestamos, 'total_abonado'), VERDE, true],
    ['Deuda activa',         deudaPrestamos, deudaPrestamos > 0 ? ROJO : VERDE, true],
    ['Préstamos vencidos',   pVencidos.length, pVencidos.length ? ROJO : VERDE, false],
    ['Deuda vencida',        pVencidos.reduce((s, p) => s + saldoPrestamo(p), 0), ROJO, true],
  ]);

  if (creditos.length) {
    bloque('💳  CRÉDITOS', [
      ['Clientes con deuda',   personas.filter((g) => g.origen === 'Crédito' && g.total > 0).length, ROJO, false],
      ['Créditos activos',     cuenta(creditos, 'Activo'),    ROJO,  false],
      ['Créditos saldados',    cuenta(creditos, 'Saldado'),   VERDE, false],
      ['Créditos cancelados',  cuenta(creditos, 'Cancelado'), C.gris600, false],
      ['Total facturado',      suma(creditos, 'valor_total'),   C.headerOscuro, true],
      ['Cuotas iniciales',     suma(creditos, 'cuota_inicial'), VERDE, true],
      ['Total abonado',        suma(creditos, 'total_abonado'), VERDE, true],
      ['Deuda activa',         deudaCreditos, deudaCreditos > 0 ? ROJO : VERDE, true],
      ['Créditos vencidos',    cVencidos.length, cVencidos.length ? ROJO : VERDE, false],
      ['Deuda vencida',        cVencidos.reduce((s, c) => s + saldoCredito(c), 0), ROJO, true],
    ]);
  }

  // ── Quién debe más ──
  const top = personas.filter((g) => g.total > 0).slice(0, 10);
  if (top.length) {
    put(ws, r, 0, 's', '🏆  QUIÉN DEBE MÁS (top 10)', sSeccion()); r++;
    ['#', 'Persona', 'Origen', 'Total a cobrar'].forEach((h, c) =>
      put(ws, r, c, 's', h, sLabel()));
    r++;
    top.forEach((g, i) => {
      const bg = g.vencido ? BG.vencido : C.blanco;
      put(ws, r, 0, 'n', i + 1,     sNat(bg));
      put(ws, r, 1, 's', g.nombre,  sC(bg));
      put(ws, r, 2, 's', g.origen,  sC(bg));
      put(ws, r, 3, 'n', g.total,   sN(bg));
      r++;
    });
    r++;
  }

  put(ws, r, 0, 's', '🎨  CÓMO LEER LOS COLORES', sSeccion()); r++;
  [
    [BG.urgente,  'Más de 60 días de atraso — cobro urgente'],
    [BG.vencido,  'Vencido — pasó la fecha límite'],
    [BG.aviso,    'Al día en plazo, pero con mora o interés pendiente'],
    [BG.activo,   'Activo y al día'],
    [BG.saldado,  'Saldado — pagado completamente'],
    [BG.cerrado,  'Cerrado — préstamo devuelto o crédito cancelado'],
  ].forEach(([bg, desc]) => {
    put(ws, r, 0, 's', ' ',  sLeyenda(bg));
    put(ws, r, 1, 's', desc, sC(C.blanco));
    r++;
  });

  seal(ws, r, 3);
  ws['!cols'] = [{ wch: 34 }, { wch: 26 }, { wch: 22 }, { wch: 18 }];
  return ws;
}

// ─── Hoja 2: Cartera por persona ──────────────────────────────────────────────

const COLS_PER = [
  '#', 'Origen', 'Persona', 'Cédula', 'Teléfono', 'Documentos', 'Activos',
  'Deuda capital', 'Mora pend.', 'Interés pend.', 'Total a cobrar',
  'Saldo a favor', 'Último abono', 'Estado',
];
const ANCH_PER = [5, 21, 30, 14, 14, 11, 8, 16, 14, 14, 17, 14, 14, 12];

function hojaPersonas(personas) {
  const ws = {};
  headers(ws, COLS_PER, 0, C.headerOscuro);

  let capital = 0, mora = 0, interes = 0, total = 0, aFavor = 0;

  personas.forEach((g, i) => {
    const r  = i + 1;
    const bg = g.total <= 0 ? BG.sinDeuda : g.vencido ? BG.vencido : BG.activo;
    const estado = g.total <= 0 ? 'Sin deuda' : g.vencido ? 'Vencido' : 'Al día';

    capital += g.capital;
    mora    += g.mora;
    interes += g.interes;
    total   += g.total;
    aFavor  += g.saldoAFavor;

    put(ws, r, 0,  'n', i + 1,        sNat(bg));
    put(ws, r, 1,  's', g.origen,     sC(bg));
    put(ws, r, 2,  's', g.nombre,     sC(bg));
    put(ws, r, 3,  's', g.cedula,     sC(bg));
    put(ws, r, 4,  's', g.telefono,   sC(bg));
    put(ws, r, 5,  'n', g.documentos, sNat(bg));
    put(ws, r, 6,  'n', g.activos,    sNat(bg));
    put(ws, r, 7,  'n', g.capital,    sN(bg));
    put(ws, r, 8,  'n', g.mora,       sN(bg));
    put(ws, r, 9,  'n', g.interes,    sN(bg));
    put(ws, r, 10, 'n', g.total,      sN(bg));
    put(ws, r, 11, 'n', g.saldoAFavor, sN(bg));
    put(ws, r, 12, 's', fmtFecha(g.ultimoAbono), sC(bg));
    put(ws, r, 13, 's', estado,       sC(bg));
  });

  const rTot = personas.length + 1;
  filaTotales(ws, rTot, COLS_PER.length, `TOTAL (${personas.length} personas)`, 2, {
    7: capital, 8: mora, 9: interes, 10: total, 11: aFavor,
  });

  seal(ws, rTot, COLS_PER.length - 1);
  ws['!cols'] = ANCH_PER.map((wch) => ({ wch }));
  autofiltro(ws, personas.length, COLS_PER.length);
  return ws;
}

// ─── Hoja 3: Préstamos (detalle) ──────────────────────────────────────────────

const COLS_P = [
  '#', 'Sucursal', 'N.º', 'Fecha', 'Tipo', 'Persona', 'Cédula', 'Teléfono',
  'Empleado', 'Producto', 'IMEI / Serial', 'Cant.', 'Valor préstamo',
  'Total abonado', 'Saldo pendiente', 'Vence', 'Días venc.', 'Mora pend.',
  'Interés pend.', 'Estado', 'Registró',
];
const ANCH_P = [5, 18, 9, 13, 12, 28, 14, 14, 18, 30, 20, 7, 16, 16, 16, 13, 11, 14, 14, 12, 18];

function hojaPrestamos(prestamos, tels) {
  const ws = {};
  headers(ws, COLS_P, 0, C.headerGris);

  let valor = 0, abonado = 0, saldo = 0, mora = 0, interes = 0;

  // Primero lo que sigue vivo, después por persona: así se lee como la pantalla.
  const orden = [...prestamos].sort((a, b) => {
    const va = esActivo(a) ? 0 : 1;
    const vb = esActivo(b) ? 0 : 1;
    if (va !== vb) return va - vb;
    const cmp = nombrePersona(a).localeCompare(nombrePersona(b), 'es');
    if (cmp !== 0) return cmp;
    return new Date(b.fecha) - new Date(a.fecha);
  });

  orden.forEach((p, i) => {
    const r     = i + 1;
    const dias  = diasVencido(p);
    const bg    = bgDocumento(p, dias);
    const pend  = esActivo(p) ? saldoPrestamo(p) : 0;

    valor   += Number(p.valor_prestamo) || 0;
    abonado += Number(p.total_abonado)  || 0;
    saldo   += pend;
    mora    += moraDe(p);
    interes += interesDe(p);

    put(ws, r, 0,  'n', i + 1,                      sNat(bg));
    put(ws, r, 1,  's', p.sucursal_nombre || '',    sC(bg));
    put(ws, r, 2,  'n', Number(p.numero ?? p.id),   sNat(bg));
    put(ws, r, 3,  's', fmtFecha(p.fecha),          sC(bg));
    put(ws, r, 4,  's', p.prestatario_id ? 'Compañero' : 'Cliente', sC(bg));
    put(ws, r, 5,  's', nombrePersona(p),           sC(bg));
    put(ws, r, 6,  's', cedulaDe(p),                sC(bg));
    put(ws, r, 7,  's', telefonoDe(p, tels),        sC(bg));
    put(ws, r, 8,  's', p.empleado_nombre || '',    sC(bg));
    put(ws, r, 9,  's', p.nombre_producto || '',    sC(bg));
    put(ws, r, 10, 's', p.imei || '',               sC(bg));
    put(ws, r, 11, 'n', p.imei ? 1 : (Number(p.cantidad_prestada) || 1), sNat(bg));
    put(ws, r, 12, 'n', Number(p.valor_prestamo) || 0, sN(bg));
    put(ws, r, 13, 'n', Number(p.total_abonado)  || 0, sN(bg));
    put(ws, r, 14, 'n', pend,                       sN(bg));
    put(ws, r, 15, 's', fmtFechaSola(p.fecha_limite), sC(bg));
    put(ws, r, 16, dias ? 'n' : 's', dias || '',    dias ? sNat(bg) : sC(bg, 'center'));
    put(ws, r, 17, 'n', moraDe(p),                  sN(bg));
    put(ws, r, 18, 'n', interesDe(p),               sN(bg));
    put(ws, r, 19, 's', p.estado || '',             sC(bg));
    put(ws, r, 20, 's', p.usuario_nombre || '',     sC(bg));
  });

  const rTot = orden.length + 1;
  filaTotales(ws, rTot, COLS_P.length, `TOTAL (${orden.length} préstamos)`, 5, {
    12: valor, 13: abonado, 14: saldo, 17: mora, 18: interes,
  });

  seal(ws, rTot, COLS_P.length - 1);
  ws['!cols'] = ANCH_P.map((wch) => ({ wch }));
  autofiltro(ws, orden.length, COLS_P.length);
  return ws;
}

// ─── Hoja 4: Créditos (detalle) ───────────────────────────────────────────────

const COLS_C = [
  '#', 'Sucursal', 'Factura', 'Fecha', 'Cliente', 'Cédula', 'Teléfono',
  'Productos', 'Valor total', 'Cuota inicial', 'Total abonado',
  'Saldo pendiente', 'Vence', 'Días venc.', 'Mora pend.', 'Interés pend.', 'Estado',
];
const ANCH_C = [5, 18, 12, 13, 28, 14, 14, 40, 16, 16, 16, 16, 13, 11, 14, 14, 12];

function hojaCreditos(creditos) {
  const ws = {};
  headers(ws, COLS_C, 0, C.headerGris);

  let valor = 0, inicial = 0, abonado = 0, saldo = 0, mora = 0, interes = 0;

  const orden = [...creditos].sort((a, b) => {
    const va = esActivo(a) ? 0 : 1;
    const vb = esActivo(b) ? 0 : 1;
    if (va !== vb) return va - vb;
    const cmp = String(a.nombre_cliente || '').localeCompare(String(b.nombre_cliente || ''), 'es');
    if (cmp !== 0) return cmp;
    return new Date(b.creado_en) - new Date(a.creado_en);
  });

  orden.forEach((c, i) => {
    const r    = i + 1;
    const dias = diasVencido(c);
    const bg   = bgDocumento(c, dias);
    const pend = esActivo(c) ? saldoCredito(c) : 0;

    valor   += Number(c.valor_total)   || 0;
    inicial += Number(c.cuota_inicial) || 0;
    abonado += Number(c.total_abonado) || 0;
    saldo   += pend;
    mora    += moraDe(c);
    interes += interesDe(c);

    const productos = (c.productos || [])
      .map((p) => `${p.nombre}${p.imei ? ` (${p.imei})` : ''}`)
      .join(', ');

    put(ws, r, 0,  'n', i + 1, sNat(bg));
    put(ws, r, 1,  's', c.sucursal_nombre || '', sC(bg));
    put(ws, r, 2,  's', `#${String(c.factura_numero ?? c.factura_id).padStart(6, '0')}`, sC(bg));
    put(ws, r, 3,  's', fmtFecha(c.creado_en),   sC(bg));
    put(ws, r, 4,  's', c.nombre_cliente || '',  sC(bg));
    put(ws, r, 5,  's', c.cedula  || '',         sC(bg));
    put(ws, r, 6,  's', c.celular || '',         sC(bg));
    put(ws, r, 7,  's', productos,               sC(bg));
    put(ws, r, 8,  'n', Number(c.valor_total)   || 0, sN(bg));
    put(ws, r, 9,  'n', Number(c.cuota_inicial) || 0, sN(bg));
    put(ws, r, 10, 'n', Number(c.total_abonado) || 0, sN(bg));
    put(ws, r, 11, 'n', pend,                    sN(bg));
    put(ws, r, 12, 's', fmtFechaSola(c.fecha_limite), sC(bg));
    put(ws, r, 13, dias ? 'n' : 's', dias || '', dias ? sNat(bg) : sC(bg, 'center'));
    put(ws, r, 14, 'n', moraDe(c),               sN(bg));
    put(ws, r, 15, 'n', interesDe(c),            sN(bg));
    put(ws, r, 16, 's', c.estado || '',          sC(bg));
  });

  const rTot = orden.length + 1;
  filaTotales(ws, rTot, COLS_C.length, `TOTAL (${orden.length} créditos)`, 4, {
    8: valor, 9: inicial, 10: abonado, 11: saldo, 14: mora, 15: interes,
  });

  seal(ws, rTot, COLS_C.length - 1);
  ws['!cols'] = ANCH_C.map((wch) => ({ wch }));
  autofiltro(ws, orden.length, COLS_C.length);
  return ws;
}

// ─── Hoja 5: Por cobrar ───────────────────────────────────────────────────────

const COLS_PC = [
  '#', 'Días venc.', 'Tipo', 'Persona', 'Teléfono', 'Documento', 'Vence',
  'Capital', 'Mora', 'Interés', 'Total a cobrar',
];
const ANCH_PC = [5, 11, 12, 30, 15, 24, 13, 16, 14, 14, 17];

/**
 * La lista de llamadas del día: solo lo vigente que ya venció o que arrastra
 * cargos, ordenado por atraso. Todo lo demás ya está en las hojas de detalle.
 */
function hojaPorCobrar(prestamos, creditos, tels) {
  const filas = [];

  prestamos.filter(esActivo).forEach((p) => {
    const dias = diasVencido(p);
    if (dias <= 0 && moraDe(p) + interesDe(p) <= 0) return;
    filas.push({
      dias,
      tipo:      p.prestatario_id ? 'Préstamo · Comp.' : 'Préstamo · Cliente',
      persona:   nombrePersona(p),
      telefono:  telefonoDe(p, tels),
      documento: `N.º ${p.numero ?? p.id} · ${p.nombre_producto || ''}`.trim(),
      vence:     fmtFechaSola(p.fecha_limite),
      capital:   saldoPrestamo(p),
      mora:      moraDe(p),
      interes:   interesDe(p),
    });
  });

  creditos.filter(esActivo).forEach((c) => {
    const dias = diasVencido(c);
    if (dias <= 0 && moraDe(c) + interesDe(c) <= 0) return;
    filas.push({
      dias,
      tipo:      'Crédito',
      persona:   c.nombre_cliente || '',
      telefono:  c.celular || '',
      documento: `Factura #${String(c.factura_numero ?? c.factura_id).padStart(6, '0')}`,
      vence:     fmtFechaSola(c.fecha_limite),
      capital:   saldoCredito(c),
      mora:      moraDe(c),
      interes:   interesDe(c),
    });
  });

  if (!filas.length) return null;

  filas.forEach((f) => { f.total = f.capital + f.mora + f.interes; });
  filas.sort((a, b) => b.dias - a.dias || b.total - a.total);

  const ws = {};
  headers(ws, COLS_PC, 0, C.headerOscuro);

  let capital = 0, mora = 0, interes = 0, total = 0;

  filas.forEach((f, i) => {
    const r  = i + 1;
    const bg = f.dias > 60 ? BG.urgente : f.dias > 0 ? BG.vencido : BG.aviso;

    capital += f.capital;
    mora    += f.mora;
    interes += f.interes;
    total   += f.total;

    put(ws, r, 0,  'n', i + 1,      sNat(bg));
    put(ws, r, 1,  f.dias ? 'n' : 's', f.dias || '—', f.dias ? sNat(bg) : sC(bg, 'center'));
    put(ws, r, 2,  's', f.tipo,      sC(bg));
    put(ws, r, 3,  's', f.persona,   sC(bg));
    put(ws, r, 4,  's', f.telefono,  sC(bg));
    put(ws, r, 5,  's', f.documento, sC(bg));
    put(ws, r, 6,  's', f.vence,     sC(bg));
    put(ws, r, 7,  'n', f.capital,   sN(bg));
    put(ws, r, 8,  'n', f.mora,      sN(bg));
    put(ws, r, 9,  'n', f.interes,   sN(bg));
    put(ws, r, 10, 'n', f.total,     sN(bg));
  });

  const rTot = filas.length + 1;
  filaTotales(ws, rTot, COLS_PC.length, `TOTAL (${filas.length} por cobrar)`, 3, {
    7: capital, 8: mora, 9: interes, 10: total,
  });

  seal(ws, rTot, COLS_PC.length - 1);
  ws['!cols'] = ANCH_PC.map((wch) => ({ wch }));
  autofiltro(ws, filas.length, COLS_PC.length);
  return ws;
}

// ─── Hoja 6: Abonos totales ───────────────────────────────────────────────────

const COLS_AT = ['#', 'Fecha', 'Tipo persona', 'Persona', 'Sucursal', 'Método', 'Valor total', 'Registrado por'];
const ANCH_AT = [5, 14, 15, 30, 22, 16, 17, 24];

function hojaAbonosTotales(abonos) {
  const ws = {};
  headers(ws, COLS_AT, 0, C.headerOscuro);

  let total = 0;

  abonos.forEach((at, i) => {
    const r  = i + 1;
    const bg = 'EEF2FF';
    total += Number(at.valor_total) || 0;

    put(ws, r, 0, 'n', i + 1, sNat(bg));
    put(ws, r, 1, 's', fmtFecha(at.fecha), sC(bg));
    put(ws, r, 2, 's', at.tipo_persona === 'prestatario' ? 'Compañero' : 'Cliente', sC(bg));
    put(ws, r, 3, 's', at.persona_nombre  || '', sC(bg));
    put(ws, r, 4, 's', at.sucursal_nombre || '', sC(bg));
    put(ws, r, 5, 's', at.metodo          || '', sC(bg));
    put(ws, r, 6, 'n', Number(at.valor_total) || 0, sN(bg));
    put(ws, r, 7, 's', at.usuario_nombre  || '', sC(bg));
  });

  const rTot = abonos.length + 1;
  filaTotales(ws, rTot, COLS_AT.length, `TOTAL (${abonos.length} pagos)`, 3, { 6: total });

  seal(ws, rTot, COLS_AT.length - 1);
  ws['!cols'] = ANCH_AT.map((wch) => ({ wch }));
  autofiltro(ws, abonos.length, COLS_AT.length);
  return ws;
}

// ─── Export principal ─────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {Array}  [opts.prestamos]      — salida de getPrestamos() (o de la búsqueda)
 * @param {Array}  [opts.creditos]       — salida de getCreditos()
 * @param {Array}  [opts.abonosTotales]  — pagos totales del período (solo búsqueda)
 * @param {Array}  [opts.prestatarios]   — salida de getPrestatarios(): aporta el teléfono
 * @param {string} [opts.titulo]         — encabezado de la hoja Resumen
 * @param {string} [opts.archivo]        — prefijo del nombre del archivo
 */
export function exportarPrestamosExcel({
  prestamos = [], creditos = [], abonosTotales = [], prestatarios = [],
  titulo  = 'CARTERA GENERAL',
  archivo = 'cartera',
} = {}) {
  if (!prestamos.length && !creditos.length && !abonosTotales.length) return;

  // El nombre de la sucursal sale de los propios datos: hoy siempre hay una
  // sola activa, pero si algún día vuelven varias el título no miente.
  const sucursales = new Set(
    [...prestamos, ...creditos].map((d) => d.sucursal_nombre).filter(Boolean),
  );
  const sucursal = sucursales.size === 1 ? [...sucursales][0]
                 : sucursales.size === 0 ? 'Sin sucursal'
                 : `${sucursales.size} sucursales`;

  const tels = new Map(
    prestatarios.filter((p) => p?.telefono).map((p) => [Number(p.id), p.telefono]),
  );
  const personas = agruparPersonas(prestamos, creditos, tels);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb,
    hojaResumen({ titulo, sucursal, prestamos, creditos, personas }), 'Resumen');

  if (personas.length)  XLSX.utils.book_append_sheet(wb, hojaPersonas(personas),         'Cartera por persona');
  if (prestamos.length) XLSX.utils.book_append_sheet(wb, hojaPrestamos(prestamos, tels), 'Préstamos');
  if (creditos.length)  XLSX.utils.book_append_sheet(wb, hojaCreditos(creditos),         'Créditos');

  const porCobrar = hojaPorCobrar(prestamos, creditos, tels);
  if (porCobrar) XLSX.utils.book_append_sheet(wb, porCobrar, 'Por cobrar');

  if (abonosTotales.length) {
    XLSX.utils.book_append_sheet(wb, hojaAbonosTotales(abonosTotales), 'Abonos totales');
  }

  XLSX.writeFile(wb, nombreArchivo(archivo, sucursal), { cellStyles: true });
}
