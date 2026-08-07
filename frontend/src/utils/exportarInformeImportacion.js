import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────────────────────
// Informe de importación a Excel.
//
// El informe se lee en pantalla, pero corregir el archivo original se hace CON
// el Excel abierto al lado. Por eso cada incidencia lleva hoja, fila, columna y
// valor: son las cuatro cosas que hacen falta para saltar a la celda y
// arreglarla sin adivinar.
// ─────────────────────────────────────────────────────────────────────────────

const ENCABEZADOS = ['Tipo', 'Hoja', 'Fila', 'Columna', 'Valor', 'Qué pasa', 'Qué hacer'];

const _filas = (lista, etiqueta) =>
  (lista || []).map((i) => ({
    Tipo:        etiqueta,
    Hoja:        i.hoja    ?? '',
    Fila:        i.fila    ?? '',
    Columna:     i.columna ?? '',
    Valor:       i.valor   ?? '',
    'Qué pasa':  i.mensaje ?? '',
    'Qué hacer': i.sugerencia ?? '',
  }));

export function exportarInformeImportacion(informe, resumen) {
  const wb = XLSX.utils.book_new();

  const resumenFilas = [
    ['Productos nuevos',          resumen?.productos_nuevos       ?? 0],
    ['Productos que reciben stock', resumen?.productos_actualizados ?? 0],
    ['Unidades que se suman',     resumen?.unidades_sumadas       ?? 0],
    ['Seriales nuevos',           resumen?.seriales_nuevos        ?? 0],
    ['Seriales actualizados',     resumen?.seriales_actualizados  ?? 0],
    ['Filas que NO se importan',  resumen?.omitidos               ?? 0],
    [],
    ['Proveedores que se crearán', (informe?.proveedores_nuevos || []).join(', ') || '(ninguno)'],
    ['Líneas que se crearán',      (informe?.lineas_nuevas      || []).join(', ') || '(ninguna)'],
    ['Hojas ignoradas',            (informe?.hojas_ignoradas    || []).join(', ') || '(ninguna)'],
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet([['RESUMEN DE LA IMPORTACIÓN'], [], ...resumenFilas]);
  wsResumen['!cols'] = [{ wch: 34 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  const detalle = [
    ..._filas(informe?.conflictos, 'NO SE IMPORTA'),
    ..._filas(informe?.avisos,     'Aviso'),
  ];
  const wsDetalle = detalle.length
    ? XLSX.utils.json_to_sheet(detalle, { header: ENCABEZADOS })
    : XLSX.utils.aoa_to_sheet([ENCABEZADOS, ['—', '', '', '', '', 'Sin incidencias', '']]);
  wsDetalle['!cols'] = [
    { wch: 15 }, { wch: 24 }, { wch: 7 }, { wch: 16 }, { wch: 28 }, { wch: 70 }, { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle');

  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `informe_importacion_${fecha}.xlsx`);
}
