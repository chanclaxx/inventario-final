import * as XLSX from 'xlsx';

// ─── Paleta ───────────────────────────────────────────────────────────────────
const COLOR = {
  header:        '1E40AF',
  headerAbono:   '065F46',
  blanco:        'FFFFFF',
  activo:        'FFFFFF',
  saldado:       'DCFCE7',
  devuelto:      'F3F4F6',
  abonoTotal:    'EEF2FF',
  borde:         'D1D5DB',
};

function borde() {
  const lado = { style: 'thin', color: { rgb: COLOR.borde } };
  return { top: lado, bottom: lado, left: lado, right: lado };
}

function sHeader(bg = COLOR.header) {
  return {
    font:      { bold: true, name: 'Arial', sz: 10, color: { rgb: COLOR.blanco } },
    fill:      { patternType: 'solid', fgColor: { rgb: bg } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border:    borde(),
  };
}

function sCelda(bg) {
  return {
    font:      { name: 'Arial', sz: 9 },
    fill:      { patternType: 'solid', fgColor: { rgb: bg } },
    alignment: { vertical: 'center' },
    border:    borde(),
  };
}

function sCeldaNum(bg) {
  return {
    ...sCelda(bg),
    alignment: { horizontal: 'right', vertical: 'center' },
    numFmt: '#,##0',
  };
}

function fmtFecha(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function sanitizarNombreHoja(nombre) {
  return (nombre || 'Sin nombre')
    .replace(/[\\/?*[\]:]/g, '')
    .trim()
    .slice(0, 31) || 'Sin nombre';
}

// ─── Hoja de préstamos (una por sucursal) ─────────────────────────────────────

const COLS = [
  'ID', 'Fecha', 'Tipo', 'Prestatario / Empresa', 'Empleado',
  'Cédula', 'Teléfono', 'Producto', 'IMEI / Serial', 'Cantidad',
  'Valor Préstamo', 'Total Abonado', 'Saldo Pendiente', 'Estado',
];
const ANCHOS = [6, 14, 12, 26, 18, 14, 14, 26, 20, 10, 16, 16, 16, 12];

function construirHojaPrestamos(lista) {
  const ws  = {};
  const enc = (r, c) => XLSX.utils.encode_cell({ r, c });

  COLS.forEach((h, c) => {
    ws[enc(0, c)] = { t: 's', v: h, s: sHeader() };
  });

  // Ordenar por nombre de persona dentro de la sucursal
  const ordenados = [...lista].sort((a, b) => {
    const na = a.prestatario_nombre || a.cliente_nombre || a.prestatario || '';
    const nb = b.prestatario_nombre || b.cliente_nombre || b.prestatario || '';
    return na.localeCompare(nb, 'es');
  });

  ordenados.forEach((p, idx) => {
    const r  = idx + 1;
    const bg = p.estado === 'Saldado'  ? COLOR.saldado
             : p.estado === 'Devuelto' ? COLOR.devuelto
             : COLOR.activo;

    const tipo    = p.prestatario_id ? 'Compañero' : 'Cliente';
    const nombre  = p.prestatario_nombre || p.cliente_nombre || p.prestatario || '';
    const cedula  = p.cedula   && p.cedula   !== 'COMPANERO'  ? p.cedula   : '';
    const telef   = p.telefono && p.telefono !== '0000000000' ? p.telefono : '';
    const saldo   = Number(p.saldo_pendiente ?? (Number(p.valor_prestamo) - Number(p.total_abonado)));
    const cant    = p.imei ? 1 : (Number(p.cantidad_prestada) || 1);

    const celdas = [
      { t: 'n', v: p.id,                           s: sCelda(bg)    },
      { t: 's', v: fmtFecha(p.fecha),               s: sCelda(bg)    },
      { t: 's', v: tipo,                            s: sCelda(bg)    },
      { t: 's', v: nombre,                          s: sCelda(bg)    },
      { t: 's', v: p.empleado_nombre || '',         s: sCelda(bg)    },
      { t: 's', v: cedula,                          s: sCelda(bg)    },
      { t: 's', v: telef,                           s: sCelda(bg)    },
      { t: 's', v: p.nombre_producto || '',         s: sCelda(bg)    },
      { t: 's', v: p.imei || '',                    s: sCelda(bg)    },
      { t: 'n', v: cant,                            s: sCeldaNum(bg) },
      { t: 'n', v: Number(p.valor_prestamo) || 0,   s: sCeldaNum(bg) },
      { t: 'n', v: Number(p.total_abonado)  || 0,   s: sCeldaNum(bg) },
      { t: 'n', v: saldo,                           s: sCeldaNum(bg) },
      { t: 's', v: p.estado || '',                  s: sCelda(bg)    },
    ];

    celdas.forEach((cell, c) => { ws[enc(r, c)] = cell; });
  });

  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lista.length, c: COLS.length - 1 } });
  ws['!cols'] = ANCHOS.map((wch) => ({ wch }));
  return ws;
}

// ─── Hoja de abonos totales ───────────────────────────────────────────────────

const COLS_AT = [
  'ID', 'Fecha', 'Tipo Persona', 'Persona', 'Sucursal', 'Método', 'Valor Total', 'Registrado por',
];
const ANCHOS_AT = [6, 14, 14, 26, 22, 14, 16, 22];

function construirHojaAbonosTotales(lista) {
  const ws  = {};
  const enc = (r, c) => XLSX.utils.encode_cell({ r, c });

  COLS_AT.forEach((h, c) => {
    ws[enc(0, c)] = { t: 's', v: h, s: sHeader(COLOR.headerAbono) };
  });

  lista.forEach((at, idx) => {
    const r  = idx + 1;
    const bg = COLOR.abonoTotal;

    const tipoLabel = at.tipo_persona === 'prestatario' ? 'Compañero' : 'Cliente';

    const celdas = [
      { t: 'n', v: at.id,                          s: sCelda(bg)    },
      { t: 's', v: fmtFecha(at.fecha),              s: sCelda(bg)    },
      { t: 's', v: tipoLabel,                       s: sCelda(bg)    },
      { t: 's', v: at.persona_nombre  || '',        s: sCelda(bg)    },
      { t: 's', v: at.sucursal_nombre || '',        s: sCelda(bg)    },
      { t: 's', v: at.metodo          || '',        s: sCelda(bg)    },
      { t: 'n', v: Number(at.valor_total) || 0,     s: sCeldaNum(bg) },
      { t: 's', v: at.usuario_nombre  || '',        s: sCelda(bg)    },
    ];

    celdas.forEach((cell, c) => { ws[enc(r, c)] = cell; });
  });

  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lista.length, c: COLS_AT.length - 1 } });
  ws['!cols'] = ANCHOS_AT.map((wch) => ({ wch }));
  return ws;
}

// ─── Export principal ─────────────────────────────────────────────────────────

export function exportarPrestamosExcel({ prestamos = [], abonosTotales = [] } = {}, nombre = 'prestamos') {
  if (!prestamos.length && !abonosTotales.length) return;

  const wb = XLSX.utils.book_new();

  // Agrupar préstamos por sucursal → una hoja por sucursal
  const porSucursal = {};
  prestamos.forEach((p) => {
    const key = p.sucursal_nombre || 'Sin sucursal';
    if (!porSucursal[key]) porSucursal[key] = [];
    porSucursal[key].push(p);
  });

  const hojasUsadas = new Set();
  Object.keys(porSucursal)
    .sort((a, b) => a.localeCompare(b, 'es'))
    .forEach((nombreSucursal) => {
      let hoja = sanitizarNombreHoja(nombreSucursal);
      if (hojasUsadas.has(hoja.toLowerCase())) {
        let i = 2;
        while (hojasUsadas.has(`${hoja.slice(0, 28)} ${i}`.toLowerCase())) i++;
        hoja = `${hoja.slice(0, 28)} ${i}`;
      }
      hojasUsadas.add(hoja.toLowerCase());
      XLSX.utils.book_append_sheet(wb, construirHojaPrestamos(porSucursal[nombreSucursal]), hoja);
    });

  // Hoja adicional con los abonos totales del período
  if (abonosTotales.length > 0) {
    XLSX.utils.book_append_sheet(wb, construirHojaAbonosTotales(abonosTotales), 'Abonos Totales');
  }

  const hoy = new Date()
    .toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .replace(/\//g, '-');
  XLSX.writeFile(wb, `${nombre}_${hoy}.xlsx`, { cellStyles: true });
}
