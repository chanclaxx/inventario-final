import * as XLSX from 'xlsx';
import { getCompraById } from '../api/compras.api';

// ─── Paleta ───────────────────────────────────────────────────────────────────
const C = {
  azul:        '1E40AF',
  blanco:      'FFFFFF',
  completada:  'DCFCE7',
  pendiente:   'FEF9C3',
  cancelada:   'FEE2E2',
  cargo:       'FEE2E2',
  abono:       'DCFCE7',
  gris:        'F3F4F6',
  borde:       'D1D5DB',
  naranja:     'FEF3C7',
};

function borde() {
  const l = { style: 'thin', color: { rgb: C.borde } };
  return { top: l, bottom: l, left: l, right: l };
}

const sHeader = () => ({
  font:      { bold: true, name: 'Arial', sz: 10, color: { rgb: C.blanco } },
  fill:      { patternType: 'solid', fgColor: { rgb: C.azul } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    borde(),
});

const sCelda = (bg) => ({
  font:      { name: 'Arial', sz: 9 },
  fill:      { patternType: 'solid', fgColor: { rgb: bg } },
  alignment: { vertical: 'center', wrapText: true },
  border:    borde(),
});

const sCeldaNum = (bg) => ({
  ...sCelda(bg),
  alignment: { horizontal: 'right', vertical: 'center' },
  numFmt: '"$"#,##0',
});

const sCeldaNat = (bg) => ({
  ...sCelda(bg),
  alignment: { horizontal: 'right', vertical: 'center' },
  numFmt: '#,##0',
});

function fmtFecha(val) {
  if (!val) return '';
  const raw = typeof val === 'string' && !val.includes('T') && !val.includes('+')
    ? new Date(val.replace(' ', 'T') + 'Z')
    : new Date(val);
  if (isNaN(raw)) return '';
  return raw.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function celda(ws, r, c, t, v, s) {
  const enc = XLSX.utils.encode_cell({ r, c });
  ws[enc] = { t, v: v ?? '', s };
}

function encabezados(ws, cols) {
  cols.forEach((h, c) => celda(ws, 0, c, 's', h, sHeader()));
}

function sellarRef(ws, filas, cols) {
  ws['!ref']  = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas, c: cols - 1 } });
}

// ─── Hoja 1: Compras ──────────────────────────────────────────────────────────
const COLS_COMPRAS = [
  'ID', 'Fecha', 'N° Factura Proveedor', 'Estado', 'Método de Pago',
  'Afectó Caja', 'Total', 'Sucursal', 'Registrado por', 'Notas',
];
const ANCHOS_COMPRAS = [8, 14, 22, 14, 18, 14, 16, 20, 20, 40];

function bgCompra(estado) {
  if (estado === 'Completada') return C.completada;
  if (estado === 'Pendiente')  return C.pendiente;
  if (estado === 'Cancelada')  return C.cancelada;
  return C.gris;
}

function hojaCompras(compras) {
  const ws = {};
  encabezados(ws, COLS_COMPRAS);
  compras.forEach((c, i) => {
    const r  = i + 1;
    const bg = bgCompra(c.estado);
    const esCredito = ['Credito', 'Fiado'].includes(c.metodo);
    celda(ws, r, 0,  'n', c.id,                                       sCeldaNat(bg));
    celda(ws, r, 1,  's', fmtFecha(c.fecha),                          sCelda(bg));
    celda(ws, r, 2,  's', c.numero_factura || '',                      sCelda(bg));
    celda(ws, r, 3,  's', c.estado || '',                              sCelda(bg));
    celda(ws, r, 4,  's', esCredito ? `${c.metodo} (Crédito)` : (c.metodo || 'Contado'), sCelda(bg));
    celda(ws, r, 5,  's', c.registrar_en_caja === false ? 'No' : 'Sí', sCelda(bg));
    celda(ws, r, 6,  'n', Number(c.total) || 0,                       sCeldaNum(bg));
    celda(ws, r, 7,  's', c.sucursal_nombre || '',                     sCelda(bg));
    celda(ws, r, 8,  's', c.usuario_nombre  || '',                     sCelda(bg));
    celda(ws, r, 9,  's', c.notas || '',                               sCelda(bg));
  });
  sellarRef(ws, compras.length, COLS_COMPRAS.length);
  ws['!cols'] = ANCHOS_COMPRAS.map((wch) => ({ wch }));
  return ws;
}

// ─── Hoja 2: Líneas de compra ─────────────────────────────────────────────────
const COLS_LINEAS = [
  'Compra ID', 'Fecha Compra', 'N° Factura', 'Proveedor',
  'Producto', 'IMEI / Serial', 'Cantidad', 'Precio Unitario', 'Subtotal',
  'Precio USD', 'Factor Conv.', 'Valor Traída',
];
const ANCHOS_LINEAS = [10, 14, 22, 22, 30, 22, 10, 16, 16, 14, 12, 14];

function hojaLineas(comprasDetalle) {
  const ws = {};
  encabezados(ws, COLS_LINEAS);
  let r = 1;
  comprasDetalle.forEach((compra) => {
    const lineas = compra.lineas || [];
    if (lineas.length === 0) return;
    const bg = bgCompra(compra.estado);
    lineas.forEach((l) => {
      const subtotal = (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0);
      celda(ws, r, 0,  'n', compra.id,                        sCeldaNat(bg));
      celda(ws, r, 1,  's', fmtFecha(compra.fecha),           sCelda(bg));
      celda(ws, r, 2,  's', compra.numero_factura || '',       sCelda(bg));
      celda(ws, r, 3,  's', compra.proveedor_nombre || '',     sCelda(bg));
      celda(ws, r, 4,  's', l.nombre_producto || '',           sCelda(bg));
      celda(ws, r, 5,  's', l.imei || '',                      sCelda(bg));
      celda(ws, r, 6,  'n', Number(l.cantidad)        || 0,   sCeldaNat(bg));
      celda(ws, r, 7,  'n', Number(l.precio_unitario) || 0,   sCeldaNum(bg));
      celda(ws, r, 8,  'n', subtotal,                          sCeldaNum(bg));
      celda(ws, r, 9,  'n', Number(l.precio_usd)        || 0, sCeldaNat(bg));
      celda(ws, r, 10, 'n', Number(l.factor_conversion) || 0, sCeldaNat(bg));
      celda(ws, r, 11, 'n', Number(l.valor_traida)      || 0, sCeldaNum(bg));
      r++;
    });
  });
  sellarRef(ws, Math.max(r - 1, 1), COLS_LINEAS.length);
  ws['!cols'] = ANCHOS_LINEAS.map((wch) => ({ wch }));
  return ws;
}

// ─── Hoja 3: Cuenta corriente ─────────────────────────────────────────────────
const COLS_MOVS = [
  'ID', 'Fecha', 'Tipo', 'Descripción', 'Valor',
  'Saldo Anterior', 'Saldo Nuevo', 'Compra Asociada',
  'Cargo Referenciado', 'Método',
];
const ANCHOS_MOVS = [8, 14, 10, 40, 16, 16, 16, 14, 36, 14];

function hojaMovimientos(movimientos) {
  const ws = {};
  encabezados(ws, COLS_MOVS);
  movimientos.forEach((m, i) => {
    const r  = i + 1;
    const bg = m.tipo === 'Cargo' ? C.cargo : C.abono;
    celda(ws, r, 0, 'n', m.id,                                          sCeldaNat(bg));
    celda(ws, r, 1, 's', fmtFecha(m.fecha),                             sCelda(bg));
    celda(ws, r, 2, 's', m.tipo || '',                                   sCelda(bg));
    celda(ws, r, 3, 's', m.descripcion || '',                            sCelda(bg));
    celda(ws, r, 4, 'n', Number(m.valor)        || 0,                   sCeldaNum(bg));
    celda(ws, r, 5, 'n', Number(m.saldo_antes)  || 0,                   sCeldaNum(bg));
    celda(ws, r, 6, 'n', Number(m.saldo_despues)|| 0,                   sCeldaNum(bg));
    celda(ws, r, 7, m.compra_id ? 'n' : 's', m.compra_id || '',         m.compra_id ? sCeldaNat(bg) : sCelda(bg));
    celda(ws, r, 8, 's', m.cargo_descripcion || (m.cargo_id ? `Cargo #${m.cargo_id}` : ''), sCelda(bg));
    celda(ws, r, 9, 's', m.metodo || '',                                 sCelda(bg));
  });
  sellarRef(ws, movimientos.length, COLS_MOVS.length);
  ws['!cols'] = ANCHOS_MOVS.map((wch) => ({ wch }));
  return ws;
}

// ─── Export principal ─────────────────────────────────────────────────────────
/**
 * @param {object}   opts
 * @param {string}   opts.nombre      - Nombre del proveedor / acreedor (para el archivo)
 * @param {Array}    opts.compras     - Lista de compras ya cargadas (puede ser [])
 * @param {number[]} opts.compraIds   - IDs de compras a buscar cuando no hay lista (p.ej. desde acreedores)
 * @param {Array}    opts.movimientos - Lista de movimientos cuenta corriente (puede ser [])
 */
export async function exportarCuentaExcel({ nombre = 'reporte', compras = [], compraIds = [], movimientos = [] }) {
  const wb = XLSX.utils.book_new();

  // Resolver compras: si no vienen pre-cargadas, buscar por ID
  let comprasDetalle = [];
  let comprasHeader  = compras;

  const idsAFetch = compras.length > 0
    ? compras.map((c) => c.id)
    : compraIds.filter(Boolean);

  if (idsAFetch.length > 0) {
    try {
      comprasDetalle = await Promise.all(
        idsAFetch.map((id) => getCompraById(id).then((r) => r.data.data))
      );
      // Si no teníamos headers pre-cargados, los tomamos del detalle
      if (comprasHeader.length === 0) {
        comprasHeader = comprasDetalle;
      }
    } catch {
      comprasDetalle = [];
    }
  }

  // Hoja 1: Compras (solo si hay)
  if (comprasHeader.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaCompras(comprasHeader), 'Compras');
  }

  // Hoja 2: Líneas de compra (solo si hay líneas)
  if (comprasDetalle.some((c) => c?.lineas?.length > 0)) {
    XLSX.utils.book_append_sheet(wb, hojaLineas(comprasDetalle), 'Líneas de Compra');
  }

  // Hoja 3: Cuenta Corriente (solo si hay)
  if (movimientos.length > 0) {
    XLSX.utils.book_append_sheet(wb, hojaMovimientos(movimientos), 'Cuenta Corriente');
  }

  if (wb.SheetNames.length === 0) return;

  const nombreSanitizado = nombre.replace(/[\\/?*[\]:]/g, '').trim().slice(0, 40) || 'reporte';
  const hoy = new Date().toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).replace(/\//g, '-');

  XLSX.writeFile(wb, `${nombreSanitizado}_${hoy}.xlsx`, { cellStyles: true });
}
