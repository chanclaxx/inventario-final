// Exporta la cartera completa de un prestatario o cliente en Excel.
// Hojas: Resumen · Estado de cuenta · Préstamos
//
// Los estilos y la hoja "Estado de cuenta" viven en estadoCuentaExcel.js, que
// comparte con la exportación de facturas a crédito para que las dos salgan
// idénticas.
import * as XLSX from 'xlsx';
import {
  C, put, headers, seal, freeze, fmtFecha, hoy, nombreArchivo,
  sC, sN, sNat, sTotal, sTotalLabel, sSeccion, sLabel, sValor, sMoneda, sLeyenda,
  hojaEstadoCuenta,
} from './estadoCuentaExcel';

// ─── Paleta por tipo de movimiento ───────────────────────────────────────────

const TIPO_META = {
  prestamo:      { bg: 'FFEDD5', tx: 'C2410C', label: '📤 Préstamo',            desc: 'Entrega de artículo (genera deuda)'                    },
  abono:         { bg: 'D1FAE5', tx: '065F46', label: '💵 Abono',               desc: 'Pago en efectivo / transferencia / tarjeta'            },
  abono_total:   { bg: 'E0E7FF', tx: '4338CA', label: '💳 Pago total',          desc: 'Pago único distribuido entre varios préstamos activos' },
  pago_producto: { bg: 'DBEAFE', tx: '1E40AF', label: '🔄 Pago en producto',    desc: 'Entrega de artículo como pago'                         },
  saldo_aplicado:{ bg: 'CCFBF1', tx: '0F766E', label: '🏦 Saldo aplicado',      desc: 'Saldo a favor utilizado para pagar'                    },
  compra_directa:{ bg: 'EDE9FE', tx: '5B21B6', label: '🛍️ Compra de artículo', desc: 'Artículo comprado → genera saldo a favor'              },
};

// ─── Hoja 1: Resumen ──────────────────────────────────────────────────────────

function hojaResumen({ nombre, tipo, cedula, telefono, prestamos, movimientos, saldoAFavor }) {
  const ws = {};
  let r = 0;

  const activos     = prestamos.filter((p) => p.estado === 'Activo');
  const cerrados    = prestamos.filter((p) => p.estado !== 'Activo');
  const deudaTotal  = activos.reduce((s, p) => s + (Number(p.valor_prestamo) - Number(p.total_abonado)), 0);
  const cargos      = movimientos.filter((m) => m.tipo === 'prestamo');
  const abonos      = movimientos.filter((m) => m.tipo !== 'prestamo' && m.tipo !== 'compra_directa');
  const compras     = movimientos.filter((m) => m.tipo === 'compra_directa');
  const sumaCargos  = cargos.reduce((s, m) => s + Number(m.cargo  || 0), 0);
  const sumaAbonos  = abonos.reduce((s, m) => s + Number(m.abono  || 0), 0);
  const sumaCompras = compras.reduce((s, m) => s + Number(m.abono || 0), 0);

  const tipoLabel = tipo === 'prestatario' || tipo === 'companero' ? 'Compañero' : 'Cliente';

  put(ws, r, 0, 's', `CARTERA — ${nombre}`, sSeccion()); r++;
  put(ws, r, 0, 's', `${tipoLabel}  ·  Generado el ${hoy()}`, sC(C.blanco)); r += 2;

  // ── Datos de la persona ──
  put(ws, r, 0, 's', '👤  DATOS DE LA PERSONA', sSeccion()); r++;
  [
    ['Nombre completo', 's', nombre,    C.gris600,      false],
    ['Tipo',            's', tipoLabel, C.headerOscuro, false],
    ...(cedula   ? [['Cédula / CC', 's', cedula,   C.gris600, false]] : []),
    ...(telefono ? [['Teléfono',    's', telefono, C.gris600, false]] : []),
  ].forEach(([label, t, v, color]) => {
    put(ws, r, 0, 's', label, sLabel());
    put(ws, r, 1, t,   v,     sValor(color));
    r++;
  });
  r++;

  // ── Estado de la cuenta ──
  put(ws, r, 0, 's', '💳  ESTADO DE LA CUENTA', sSeccion()); r++;
  [
    ['Deuda activa',         'n', deudaTotal,         deudaTotal  > 0 ? 'DC2626' : '16A34A', true ],
    ['Saldo a favor',        'n', saldoAFavor,        saldoAFavor > 0 ? '0F766E' : C.gris600, true ],
    ['Total préstamos',      'n', sumaCargos,         C.headerOscuro, true ],
    ['Total pagado',         'n', sumaAbonos,         '16A34A',       true ],
    ['Compras de artículos', 'n', sumaCompras,        '5B21B6',       true ],
    ['Préstamos activos',    'n', activos.length,     'DC2626',       false],
    ['Préstamos cerrados',   'n', cerrados.length,    '16A34A',       false],
    ['Movimientos totales',  'n', movimientos.length, C.gris600,      false],
  ].forEach(([label, t, v, color, esMoneda]) => {
    put(ws, r, 0, 's', label, sLabel());
    put(ws, r, 1, t,   v,     esMoneda ? sMoneda(color) : sValor(color));
    r++;
  });
  r++;

  // ── Leyenda de colores ──
  put(ws, r, 0, 's', '🎨  LEYENDA DE COLORES DEL ESTADO DE CUENTA', sSeccion()); r++;
  Object.values(TIPO_META).forEach(({ bg, label, desc }) => {
    put(ws, r, 0, 's', label, sLeyenda(bg));
    put(ws, r, 1, 's', desc,  sC(C.blanco));
    r++;
  });

  r++;
  put(ws, r, 0, 's', '📋  LEYENDA DE ESTADOS DE PRÉSTAMO', sSeccion()); r++;
  [
    [C.activo_bg,   'Activo   — préstamo vigente con saldo pendiente'],
    [C.saldado_bg,  'Saldado  — préstamo pagado completamente'],
    [C.devuelto_bg, 'Devuelto — artículo devuelto sin completar pago'],
  ].forEach(([bg, desc]) => {
    put(ws, r, 0, 's', ' ',  sLeyenda(bg));
    put(ws, r, 1, 's', desc, sC(C.blanco));
    r++;
  });

  seal(ws, r, 1);
  ws['!cols'] = [{ wch: 32 }, { wch: 30 }];
  return ws;
}

// ─── Hoja 3: Préstamos ────────────────────────────────────────────────────────

const COLS_P = ['#', 'ID', 'Fecha', 'Producto', 'IMEI / Serial', 'Cant.', 'Valor préstamo', 'Total abonado', 'Saldo pendiente', 'Estado'];
const ANCH_P = [5,   8,    14,      34,          22,              7,       17,               17,              17,                12];

function hojaPrestamos(prestamos) {
  const ws = {};
  headers(ws, COLS_P, 0, C.headerGris);

  let totalValor = 0, totalAbonado = 0, totalPendiente = 0;

  prestamos.forEach((p, i) => {
    const r  = i + 1;
    const bg = p.estado === 'Saldado'  ? C.saldado_bg
             : p.estado === 'Devuelto' ? C.devuelto_bg
             : C.activo_bg;

    const saldo = Number(p.valor_prestamo) - Number(p.total_abonado);
    totalValor     += Number(p.valor_prestamo) || 0;
    totalAbonado   += Number(p.total_abonado)  || 0;
    totalPendiente += Math.max(saldo, 0);

    put(ws, r, 0, 'n', i + 1,                        sNat(bg));
    put(ws, r, 1, 'n', p.id,                          sNat(bg));
    put(ws, r, 2, 's', fmtFecha(p.fecha),             sC(bg));
    put(ws, r, 3, 's', p.nombre_producto || '',       sC(bg));
    put(ws, r, 4, 's', p.imei || '',                  sC(bg));
    put(ws, r, 5, 'n', p.imei ? 1 : (Number(p.cantidad_prestada) || 1), sNat(bg));
    put(ws, r, 6, 'n', Number(p.valor_prestamo) || 0, sN(bg));
    put(ws, r, 7, 'n', Number(p.total_abonado)  || 0, sN(bg));
    put(ws, r, 8, 'n', Math.max(saldo, 0),            sN(bg));
    put(ws, r, 9, 's', p.estado || '',                sC(bg));
  });

  const rTot = prestamos.length + 1;
  [0, 1, 2, 3, 4, 5].forEach((c) =>
    put(ws, rTot, c, 's', c === 5 ? `TOTAL (${prestamos.length})` : '', sTotalLabel()));
  put(ws, rTot, 6, 'n', totalValor,     sTotal());
  put(ws, rTot, 7, 'n', totalAbonado,   sTotal());
  put(ws, rTot, 8, 'n', totalPendiente, sTotal());
  put(ws, rTot, 9, 's', '',             sTotalLabel());

  seal(ws, rTot, COLS_P.length - 1);
  ws['!cols'] = ANCH_P.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

// ─── Export principal ─────────────────────────────────────────────────────────

/**
 * @param {object}  opts
 * @param {string}  opts.nombre       — Nombre del prestatario / cliente
 * @param {string}  opts.tipo         — 'prestatario' | 'cliente' | 'companero'
 * @param {string}  [opts.cedula]     — Cédula (opcional)
 * @param {string}  [opts.telefono]   — Teléfono (opcional)
 * @param {Array}   opts.prestamos    — Todos los préstamos de la persona
 * @param {Array}   opts.movimientos  — Resultado de getEstadoCuenta()
 * @param {number}  opts.saldoAFavor  — Saldo a favor actual
 */
export function exportarCarteraPersonaExcel({
  nombre, tipo, cedula, telefono, prestamos = [], movimientos = [], saldoAFavor = 0,
}) {
  if (!prestamos.length && !movimientos.length) return;

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    hojaResumen({ nombre, tipo, cedula, telefono, prestamos, movimientos, saldoAFavor }),
    'Resumen',
  );

  if (movimientos.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaEstadoCuenta(movimientos, TIPO_META), 'Estado de cuenta');
  }

  if (prestamos.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaPrestamos(prestamos), 'Préstamos');
  }

  XLSX.writeFile(wb, nombreArchivo('cartera', nombre), { cellStyles: true });
}
