// Exporta la cuenta completa de un cliente a crédito en Excel.
// Hojas: Resumen · Estado de cuenta · Facturas
//
// Comparte estilos y la hoja "Estado de cuenta" con la exportación de préstamos
// (estadoCuentaExcel.js): las dos salen con el mismo formato.
import * as XLSX from 'xlsx';
import {
  C, put, headers, seal, freeze, fmtFecha, hoy, nombreArchivo,
  sC, sN, sNat, sTotal, sTotalLabel, sSeccion, sLabel, sValor, sMoneda, sLeyenda,
  hojaEstadoCuenta, saldoFinalDe,
} from './estadoCuentaExcel';

// ─── Paleta por tipo de movimiento (misma semántica que los badges en pantalla) ──

const TIPO_META = {
  credito:         { bg: 'FFEDD5', label: '🧾 Factura a crédito', desc: 'Venta a crédito por su valor original (genera deuda)'      },
  cuota_inicial:   { bg: 'DBEAFE', label: '💰 Cuota inicial',     desc: 'Pago entregado al momento de la venta'                     },
  abono:           { bg: 'D1FAE5', label: '💵 Abono',             desc: 'Pago en efectivo / transferencia / tarjeta'                },
  devolucion:      { bg: 'FFE4D5', label: '↩️ Devolución',        desc: 'Producto devuelto: rebaja la deuda de la factura'          },
  ajuste:          { bg: 'EDE9FE', label: '⚖️ Ajuste',            desc: 'Saldo condonado al marcar la factura como saldada'         },
  mora_cobro:      { bg: 'FEE2E2', label: '⏰ Mora cobrada',      desc: 'Interés por pago tardío — NO hace parte del capital'       },
  mora_condonacion:{ bg: 'F3F4F6', label: '🕊️ Mora condonada',    desc: 'Interés perdonado — NO hace parte del capital'             },
};

const ESTADO_BG = {
  Activo:    C.activo_bg,
  Saldado:   C.saldado_bg,
  Cancelado: C.devuelto_bg,
};

// ─── Hoja 1: Resumen ──────────────────────────────────────────────────────────

function hojaResumen({ nombre, cedula, telefono, creditos, movimientos }) {
  const ws = {};
  let r = 0;

  const activos  = creditos.filter((c) => c.estado === 'Activo');
  const cerrados = creditos.filter((c) => c.estado !== 'Activo');

  const saldoDe = (c) => Math.max(0, Number(
    c.saldo_pendiente ?? (Number(c.valor_total) - Number(c.cuota_inicial || 0) - Number(c.total_abonado || 0))
  ));
  const deudaActiva = activos.reduce((s, c) => s + saldoDe(c), 0);
  const totalPagado = creditos.reduce(
    (s, c) => s + Number(c.total_abonado || 0) + Number(c.cuota_inicial || 0), 0);

  const sumaCargos = movimientos.filter((m) => m.tipo === 'credito')
    .reduce((s, m) => s + Number(m.cargo || 0), 0);
  const sumaDevol  = movimientos.filter((m) => m.tipo === 'devolucion')
    .reduce((s, m) => s + Number(m.abono || 0), 0);
  const sumaMora   = movimientos.filter((m) => m.tipo === 'mora_cobro')
    .reduce((s, m) => s + Number(m.abono || 0), 0);

  put(ws, r, 0, 's', `CUENTA A CRÉDITO — ${nombre}`, sSeccion()); r++;
  put(ws, r, 0, 's', `Cliente  ·  Generado el ${hoy()}`, sC(C.blanco)); r += 2;

  // ── Datos del cliente ──
  put(ws, r, 0, 's', '👤  DATOS DEL CLIENTE', sSeccion()); r++;
  [
    ['Nombre completo', 's', nombre, C.gris600],
    ...(cedula   ? [['Cédula / CC', 's', cedula,   C.gris600]] : []),
    ...(telefono ? [['Teléfono',    's', telefono, C.gris600]] : []),
  ].forEach(([label, t, v, color]) => {
    put(ws, r, 0, 's', label, sLabel());
    put(ws, r, 1, t,   v,     sValor(color));
    r++;
  });
  r++;

  // ── Estado de la cuenta ──
  put(ws, r, 0, 's', '💳  ESTADO DE LA CUENTA', sSeccion()); r++;
  [
    ['Deuda activa',         'n', deudaActiva,        deudaActiva > 0 ? 'DC2626' : '16A34A', true ],
    ['Saldo del estado de cuenta', 'n', saldoFinalDe(movimientos), 'DC2626', true ],
    ['Total facturado',      'n', sumaCargos,         C.headerOscuro, true ],
    ['Total pagado',         'n', totalPagado,        '16A34A',       true ],
    ['Total devuelto',       'n', sumaDevol,          'EA580C',       true ],
    ['Mora cobrada (aparte)', 'n', sumaMora,          'DC2626',       true ],
    ['Facturas activas',     'n', activos.length,     'DC2626',       false],
    ['Facturas cerradas',    'n', cerrados.length,    '16A34A',       false],
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
  put(ws, r, 0, 's', '📋  LEYENDA DE ESTADOS DE FACTURA', sSeccion()); r++;
  [
    [C.activo_bg,   'Activo    — crédito vigente con saldo pendiente'],
    [C.saldado_bg,  'Saldado   — crédito pagado completamente'],
    [C.devuelto_bg, 'Cancelado — factura anulada: no arrastra deuda'],
  ].forEach(([bg, desc]) => {
    put(ws, r, 0, 's', ' ',  sLeyenda(bg));
    put(ws, r, 1, 's', desc, sC(C.blanco));
    r++;
  });

  seal(ws, r, 1);
  ws['!cols'] = [{ wch: 32 }, { wch: 34 }];
  return ws;
}

// ─── Hoja 3: Facturas ─────────────────────────────────────────────────────────

const COLS_F = ['#', 'Factura', 'Fecha', 'Productos', 'Valor total', 'Cuota inicial', 'Total abonado', 'Saldo pendiente', 'Estado', 'Vence', 'Mora pendiente'];
const ANCH_F = [5,   12,        14,      40,           17,            16,              16,              17,                12,       13,      15];

function hojaFacturas(creditos) {
  const ws = {};
  headers(ws, COLS_F, 0, C.headerGris);

  let totalValor = 0, totalInicial = 0, totalAbonado = 0, totalPendiente = 0;

  creditos.forEach((c, i) => {
    const r  = i + 1;
    const bg = ESTADO_BG[c.estado] || C.activo_bg;

    const valor    = Number(c.valor_total)      || 0;
    const inicial  = Number(c.cuota_inicial)    || 0;
    const abonado  = Number(c.total_abonado)    || 0;
    const saldo    = Math.max(0, Number(c.saldo_pendiente ?? (valor - inicial - abonado)));

    totalValor     += valor;
    totalInicial   += inicial;
    totalAbonado   += abonado;
    totalPendiente += c.estado === 'Activo' ? saldo : 0;

    const productos = (c.productos || [])
      .map((p) => `${p.nombre}${p.imei ? ` (${p.imei})` : ''}`)
      .join(', ');

    put(ws, r, 0,  'n', i + 1, sNat(bg));
    put(ws, r, 1,  's', `#${String(c.factura_numero ?? c.factura_id).padStart(6, '0')}`, sC(bg));
    put(ws, r, 2,  's', fmtFecha(c.creado_en), sC(bg));
    put(ws, r, 3,  's', productos,             sC(bg));
    put(ws, r, 4,  'n', valor,                 sN(bg));
    put(ws, r, 5,  'n', inicial,               sN(bg));
    put(ws, r, 6,  'n', abonado,               sN(bg));
    put(ws, r, 7,  'n', saldo,                 sN(bg));
    put(ws, r, 8,  's', c.estado || '',        sC(bg));
    put(ws, r, 9,  's', fmtFecha(c.fecha_limite), sC(bg));
    put(ws, r, 10, 'n', Number(c.mora?.pendiente || 0), sN(bg));
  });

  const rTot = creditos.length + 1;
  [0, 1, 2, 3].forEach((c) =>
    put(ws, rTot, c, 's', c === 3 ? `TOTAL (${creditos.length} facturas)` : '', sTotalLabel()));
  put(ws, rTot, 4, 'n', totalValor,     sTotal());
  put(ws, rTot, 5, 'n', totalInicial,   sTotal());
  put(ws, rTot, 6, 'n', totalAbonado,   sTotal());
  put(ws, rTot, 7, 'n', totalPendiente, sTotal());
  [8, 9, 10].forEach((c) => put(ws, rTot, c, 's', '', sTotalLabel()));

  seal(ws, rTot, COLS_F.length - 1);
  ws['!cols'] = ANCH_F.map((wch) => ({ wch }));
  freeze(ws);
  return ws;
}

// ─── Export principal ─────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.nombre       — Nombre del cliente
 * @param {string} [opts.cedula]
 * @param {string} [opts.telefono]
 * @param {Array}  opts.creditos     — Créditos del cliente (los de la pantalla)
 * @param {Array}  opts.movimientos  — Resultado de getEstadoCuentaCredito()
 */
export function exportarCuentaCreditoExcel({
  nombre, cedula, telefono, creditos = [], movimientos = [],
}) {
  if (!creditos.length && !movimientos.length) return;

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    hojaResumen({ nombre, cedula, telefono, creditos, movimientos }),
    'Resumen',
  );

  if (movimientos.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaEstadoCuenta(movimientos, TIPO_META), 'Estado de cuenta');
  }

  if (creditos.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaFacturas(creditos), 'Facturas');
  }

  XLSX.writeFile(wb, nombreArchivo('cuenta-credito', nombre), { cellStyles: true });
}
