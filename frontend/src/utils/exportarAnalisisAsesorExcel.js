// Exporta las tablas para asesoría (Reportes → Análisis) a un Excel: una hoja
// «Resumen» con los indicadores, los hallazgos y cómo leer las señales, y una
// hoja por tabla, con filtro, lista para cruzar y ordenar.
//
// Las hojas y sus columnas salen de `pages/reportes/asesor/tablasAsesor.js`, la
// MISMA definición que pinta la pantalla: aquí no se decide qué columnas hay.
// El Excel lleva además las marcadas `soloExcel`, que en pantalla no caben.
//
// Los números van como NÚMEROS con formato (no como texto «$1.200.000»): si no,
// Excel no los suma ni los ordena, que es para lo que se exporta.
import * as XLSXns from 'xlsx';
import {
  TABLAS, INDICADORES, SENALES, textoSenal, esNumerica,
} from '../pages/reportes/asesor/tablasAsesor.js';

// La librería es CommonJS: empaquetada por Vite llega con sus funciones a la
// vista; importada desde node (la prueba que relee el archivo) llega bajo
// `default`. Con esto sirve en los dos sitios.
const XLSX = XLSXns.utils ? XLSXns : XLSXns.default;

const C = {
  titulo: '1E3A8A', cabecera: '1F2937', blanco: 'FFFFFF', borde: 'CBD5E1',
  gris: '6B7280', seccion: 'EFF6FF', seccionTexto: '1E3A8A',
  rojo_bg: 'FEE2E2', rojo_tx: 'B91C1C', ambar_bg: 'FEF3C7', ambar_tx: '92400E',
  verde_bg: 'DCFCE7', verde_tx: '166534', gris_bg: 'F3F4F6', gris_tx: '4B5563',
};

const FORMATO = {
  moneda: '"$"#,##0;[Red]-"$"#,##0',
  entero: '#,##0',
  dias: '#,##0',
  pct: '0.0"%"',
  decimal: '0.0',
};

const borde = () => {
  const l = { style: 'thin', color: { rgb: C.borde } };
  return { top: l, bottom: l, left: l, right: l };
};

const texto = (v, s = {}) => ({ v: v ?? '', t: 's', s });
const sTitulo    = { font: { bold: true, sz: 14, color: { rgb: C.titulo } } };
const sSub       = { font: { sz: 10, color: { rgb: C.gris } }, alignment: { wrapText: true, vertical: 'top' } };
const sSeccion   = { font: { bold: true, sz: 11, color: { rgb: C.seccionTexto } }, fill: { fgColor: { rgb: C.seccion } } };
const sCabecera  = (numerica) => ({
  font: { bold: true, color: { rgb: C.blanco } }, fill: { fgColor: { rgb: C.cabecera } },
  alignment: { horizontal: numerica ? 'right' : 'left', vertical: 'center', wrapText: true }, border: borde(),
});
const sCelda     = (numerica) => ({ alignment: { horizontal: numerica ? 'right' : 'left', vertical: 'top' }, border: borde() });

const TONO = {
  rojo:  { bg: C.rojo_bg,  tx: C.rojo_tx },
  ambar: { bg: C.ambar_bg, tx: C.ambar_tx },
  verde: { bg: C.verde_bg, tx: C.verde_tx },
  gris:  { bg: C.gris_bg,  tx: C.gris_tx },
};
// El tono de una celda de señales es el de la más grave que lleve.
const GRAVEDAD = ['rojo', 'ambar', 'verde', 'gris'];
const tonoDe = (senales) => GRAVEDAD.find((t) => (senales || []).some((s) => SENALES[s]?.tono === t)) || null;

/** Una celda con su tipo: número con formato, o texto. Lo vacío va vacío. */
const celda = (valor, tipo) => {
  if (tipo === 'senales') {
    const tono = tonoDe(valor);
    const s = sCelda(false);
    if (tono) { s.fill = { fgColor: { rgb: TONO[tono].bg } }; s.font = { color: { rgb: TONO[tono].tx }, bold: tono === 'rojo' }; }
    return texto((valor || []).map(textoSenal).join(', '), s);
  }
  if (valor === null || valor === undefined || valor === '') return texto('', sCelda(esNumerica(tipo)));
  if (esNumerica(tipo)) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return texto('', sCelda(true));
    return { v: tipo === 'moneda' ? Math.round(n) : n, t: 'n', z: FORMATO[tipo], s: sCelda(true) };
  }
  return texto(String(valor), sCelda(false));
};

const ancho = (col, filas) => {
  if (col.tipo === 'senales') return 30;
  const largoTitulo = col.titulo.length + 3;
  if (esNumerica(col.tipo)) return Math.max(col.tipo === 'moneda' ? 15 : 10, largoTitulo);
  const mayor = filas.slice(0, 300).reduce((m, f) => Math.max(m, String(f[col.clave] ?? '').length), 0);
  return Math.min(48, Math.max(largoTitulo, mayor + 2, 10));
};

const NIVEL = { alerta: 'Alerta', atencion: 'Para revisar', dato: 'Dato' };
const TONO_NIVEL = { alerta: 'rojo', atencion: 'ambar', dato: 'gris' };

const rango = (f1, c1, f2, c2) => XLSX.utils.encode_range({ s: { r: f1, c: c1 }, e: { r: f2, c: c2 } });

// ── Hoja de una tabla ────────────────────────────────────────────────────────
const FILA_CABECERA = 4;   // 0-based: título, pregunta, nota, en blanco, cabecera
const hojaDeTabla = (tabla, datos) => {
  const filas = (tabla.filasExcel || tabla.filas)(datos);
  if (!filas.length) return null;
  const cols = tabla.columnas;

  const aoa = [
    [texto(tabla.titulo, sTitulo)],
    [texto(tabla.pregunta, { font: { italic: true, sz: 10, color: { rgb: C.titulo } } })],
    [texto(tabla.nota || '', sSub)],
    [],
    cols.map((col) => texto(col.titulo, sCabecera(esNumerica(col.tipo)))),
    ...filas.map((f) => cols.map((col) => celda(f[col.clave], col.tipo))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ultimaCol = cols.length - 1;
  ws['!cols'] = cols.map((col) => ({ wch: ancho(col, filas) }));
  ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 44 }, { hpt: 6 }, { hpt: 32 }];
  // Título, pregunta y nota a lo ancho: si no, la nota se corta en la columna A.
  const hasta = Math.min(ultimaCol, 9);
  ws['!merges'] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: hasta } }));
  ws['!autofilter'] = { ref: rango(FILA_CABECERA, 0, FILA_CABECERA + filas.length, ultimaCol) };
  return ws;
};

// ── Hoja Resumen ─────────────────────────────────────────────────────────────
const hojaResumen = (datos, { negocio, hojas }) => {
  const { alcance, resumen, hallazgos, umbrales } = datos;
  const tituloDe = new Map(TABLAS.map((t) => [t.id, t.hoja]));
  const sedes = alcance.sedes.map((s) => s.nombre).join(', ');

  const aoa = [
    [texto(`Análisis para asesoría${negocio ? ` — ${negocio}` : ''}`, sTitulo)],
    [texto(`Período: ${alcance.desde} a ${alcance.hasta} (${alcance.dias} días)`, sSub)],
    [texto(`${alcance.todo_el_negocio ? 'Todo el negocio' : 'Sede'}: ${sedes}`, sSub)],
    [texto(`Inventario, cartera y deudas a ${alcance.hoy}. La deuda con proveedores es siempre la de todo el negocio.`, sSub)],
    [],
    [texto('Indicadores', sSeccion), texto('', sSeccion), texto('', sSeccion), texto('', sSeccion)],
    ...INDICADORES.map((ind) => [
      texto(ind.titulo, sCelda(false)), celda(resumen[ind.clave], ind.tipo), texto(ind.ayuda || '', sSub),
    ]),
    [],
    [texto('Hallazgos', sSeccion), texto('', sSeccion), texto('', sSeccion), texto('', sSeccion)],
    ['Nivel', 'Mírelo en la hoja', 'Hallazgo', 'Detalle'].map((t) => texto(t, sCabecera(false))),
    ...(hallazgos.length ? hallazgos : [{ nivel: 'dato', tabla: '', titulo: 'Sin hallazgos en este período', detalle: '' }]).map((h) => {
      const tono = TONO[TONO_NIVEL[h.nivel]] || TONO.gris;
      const sNivel = { ...sCelda(false), fill: { fgColor: { rgb: tono.bg } }, font: { bold: true, color: { rgb: tono.tx } } };
      const envuelto = { ...sCelda(false), alignment: { wrapText: true, vertical: 'top' } };
      return [texto(NIVEL[h.nivel] || h.nivel, sNivel), texto(tituloDe.get(h.tabla) || '', sCelda(false)),
        texto(h.titulo, { ...envuelto, font: { bold: true } }), texto(h.detalle, envuelto)];
    }),
    [],
    [texto('Cómo leer las señales', sSeccion), texto('', sSeccion), texto('', sSeccion), texto('', sSeccion)],
    ['Señal', '', 'Qué significa', ''].map((t) => texto(t, sCabecera(false))),
    ...Object.entries(SENALES).map(([, s]) => {
      const tono = TONO[s.tono] || TONO.gris;
      return [texto(s.texto, { ...sCelda(false), fill: { fgColor: { rgb: tono.bg } }, font: { color: { rgb: tono.tx } } }),
        texto('', sCelda(false)), texto(s.ayuda(umbrales), { ...sCelda(false), alignment: { wrapText: true, vertical: 'top' } })];
    }),
    [],
    [texto('Hojas de este archivo', sSeccion), texto('', sSeccion), texto('', sSeccion), texto('', sSeccion)],
    ['Hoja', '', 'La pregunta que responde', ''].map((t) => texto(t, sCabecera(false))),
    ...hojas.map((t) => [texto(t.hoja, { ...sCelda(false), font: { bold: true } }), texto('', sCelda(false)), texto(t.pregunta, sCelda(false))]),
    [],
    [texto('La utilidad de este archivo es la de lo VENDIDO en el período, por fecha de venta (incluye lo vendido a crédito aún sin cobrar). '
      + 'No es la utilidad cobrada que muestran las gráficas de Análisis. Lo que no tiene costo registrado no suma utilidad.', sSub)],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 24 }, { wch: 62 }, { wch: 90 }];
  const ultima = aoa.length - 1;
  ws['!merges'] = [0, 1, 2, 3, ultima].map((r) => ({ s: { r, c: 0 }, e: { r, c: 3 } }));
  const altos = [];
  altos[ultima] = { hpt: 40 };
  ws['!rows'] = altos;
  return ws;
};

/**
 * Arma el libro (sin escribirlo). Separado de la descarga para poder probarlo.
 * Una tabla sin filas no genera hoja: un archivo con hojas vacías obliga a
 * abrirlas una por una para descubrir que no dicen nada.
 */
export function construirLibroAsesor(datos, { negocio = '' } = {}) {
  const conHoja = TABLAS
    .map((tabla) => ({ tabla, ws: hojaDeTabla(tabla, datos) }))
    .filter((x) => x.ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaResumen(datos, { negocio, hojas: conHoja.map((x) => x.tabla) }), 'Resumen');
  for (const { tabla, ws } of conHoja) XLSX.utils.book_append_sheet(wb, ws, tabla.hoja);
  return wb;
}

export const nombreArchivoAsesor = (datos) =>
  `analisis-asesoria_${datos.alcance.desde}_a_${datos.alcance.hasta}${datos.alcance.todo_el_negocio ? '_negocio' : ''}.xlsx`;

export function exportarAnalisisAsesorExcel(datos, opciones = {}) {
  XLSX.writeFile(construirLibroAsesor(datos, opciones), nombreArchivoAsesor(datos));
}
