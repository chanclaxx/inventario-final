// ── Ayudas de la pantalla de etiquetas (sin componentes) ─────────────────────
//
// Nada de geometría se calcula aquí: el reparto de la etiqueta, la retícula,
// los márgenes centrados y la página física los decide el backend
// (`etiquetas.formatos.js` / `etiquetas.layout.js`) y llegan en el plan. Esto
// solo traduce entre lo que la pantalla guarda y lo que el backend espera.

/** 32 → "32", 32.5 → "32,5". Las medidas se leen como en el empaque. */
export const mm = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * 100) / 100).replace('.', ',');
};

export const PREFIJO_GUARDADO = 'guardado:';

/**
 * Un formato del catálogo → la forma del editor a medida. Es lo que permite
 * «ajustar este formato»: partir del rollo que más se parece al que se compró
 * y cambiar solo lo que difiere, en vez de medir todo desde cero.
 */
export const formatoAPersonalizado = (f) => {
  if (!f) return null;
  if (f.medio === 'rollo') {
    return {
      medio: 'rollo',
      ancho: f.etiqueta.ancho, alto: f.etiqueta.alto,
      columnas: f.columnas,
      separacion: { x: f.separacion?.x ?? 0, y: f.separacion?.y ?? 0 },
      anchoRollo: f.pagina.ancho,
      // Los del catálogo vienen centrados: se deja vacío para que siga centrado
      // si el usuario cambia el ancho del rollo.
      margen: { izquierda: '', arriba: '' },
      filasPorPagina: f.filas || 1,
      incluirSeparacion: !!f.rollo?.incluirSeparacion,
    };
  }
  return {
    medio: 'hoja',
    ancho: f.etiqueta.ancho, alto: f.etiqueta.alto,
    columnas: f.columnas, filas: f.filas,
    separacion: { x: f.separacion?.x ?? 0, y: f.separacion?.y ?? 0 },
    margen: { izquierda: f.margen?.izquierda ?? '', arriba: f.margen?.arriba ?? '' },
    papel: f.papel || 'personalizado',
    pagina: { ancho: f.pagina.ancho, alto: f.pagina.alto },
  };
};

/**
 * Qué formato está elegido, en la forma que espera el backend, y bajo qué
 * clave se guarda su calibración.
 */
export const resolverElegido = (prefs, formatos) => {
  if (prefs.formato?.startsWith(PREFIJO_GUARDADO)) {
    const g = prefs.guardados.find((x) => `${PREFIJO_GUARDADO}${x.id}` === prefs.formato);
    if (g) return { formato: 'personalizado', personalizado: g.personalizado, clave: prefs.formato, nombre: g.nombre, guardado: g };
    // Borrado en otra pestaña: se cae al editor.
    return { formato: 'personalizado', personalizado: prefs.personalizado, clave: 'personalizado', nombre: 'A medida' };
  }
  if (prefs.formato === 'personalizado') {
    return { formato: 'personalizado', personalizado: prefs.personalizado, clave: 'personalizado', nombre: 'A medida' };
  }
  const f = formatos.find((x) => x.id === prefs.formato);
  return { formato: prefs.formato, personalizado: undefined, clave: prefs.formato, nombre: f?.nombre || prefs.formato, preset: f };
};

/** Grupos del selector, en el orden en que la gente los busca. */
export const agruparFormatos = (formatos) => {
  const grupos = [
    { titulo: 'Rollo de etiquetas · 1 columna (impresora de etiquetas)', lista: [] },
    { titulo: 'Rollo de etiquetas · varias columnas', lista: [] },
    { titulo: 'Papel de recibo (impresora POS)', lista: [] },
    { titulo: 'Plancha adhesiva (impresora normal)', lista: [] },
  ];
  for (const f of formatos) {
    if (f.medio === 'hoja') grupos[3].lista.push(f);
    else if (f.rollo?.incluirSeparacion) grupos[2].lista.push(f);
    else if (f.columnas > 1) grupos[1].lista.push(f);
    else grupos[0].lista.push(f);
  }
  return grupos.filter((g) => g.lista.length);
};

/**
 * Lo que hay que poner en el diálogo de impresión y en el driver, dicho con
 * las medidas de ESTE formato. Es la mitad del problema de «no cuadra»: el PDF
 * mide exactamente el papel, pero si el diálogo lo ajusta a la hoja o el driver
 * tiene otro tamaño, las etiquetas caen corridas.
 */
export const instruccionesImpresion = (geometria) => {
  if (!geometria) return [];
  const { papel, medio, rollo, separacion, filas } = geometria;
  const tam = `${mm(papel.ancho)} × ${mm(papel.alto)} mm`;
  // El navegador gira y achica la página por su cuenta cuando el papel elegido
  // no calza con ella (Chrome/Edge lo hacen siempre con un PDF). La vista previa
  // del diálogo ya lo muestra: es el último punto donde se ve antes de gastar.
  const revisar = `Antes de imprimir, mira la vista previa del diálogo: la etiqueta tiene que verse derecha y a tamaño real. Si se ve de lado o pequeña, el papel no es el de ${tam}: corrígelo ahí, porque desde aquí no se puede.`;
  const escala = 'Márgenes «Ninguno» y escala «Predeterminado» o «Personalizado» 100 —nunca «Ajustar al área de impresión».';

  if (medio === 'rollo') {
    const gap = Number(separacion?.y) || 0;
    return [
      `En Windows: Impresoras → tu impresora → Preferencias de impresión. Crea el papel de ${mm(papel.ancho)} mm de ANCHO × ${mm(papel.alto)} mm de ALTO, orientación Vertical, sin márgenes${filas === 1 ? '. Es UNA fila del rollo, no el rollo entero' : ''}.`,
      rollo?.incluirSeparacion
        ? 'Tipo de papel: continuo (sin marcas). Cada página ya incluye la separación entre etiquetas.'
        : `Tipo de papel: etiquetas con separación («gap»)${gap ? ` de ${mm(gap)} mm` : ''}. Con el rollo puesto, calibra la impresora una vez (opción de calibrar del driver, o manteniendo el botón FEED hasta que avance sola).`,
      `En el diálogo de impresión, en «Más opciones de configuración»: tamaño del papel ${tam}. ${escala}`,
      revisar,
      'Imprime primero la hoja de prueba: si sale corrida o de cabeza, corrígelo en Calibración.',
    ];
  }
  return [
    `Carga la plancha en la bandeja y elige el papel ${tam} en el diálogo de impresión.`,
    escala,
    revisar,
    'Imprime la hoja de prueba en papel normal y ponla sobre la plancha a contraluz: así ves si cae sobre el troquel sin gastar etiquetas.',
  ];
};

/** Resumen corto de la calibración, para el encabezado plegado. */
export const resumenCalibracion = (c) => {
  const partes = [];
  if (Number(c.ajuste?.x) || Number(c.ajuste?.y)) partes.push(`desvío ${mm(c.ajuste.x || 0)} / ${mm(c.ajuste.y || 0)} mm`);
  if (Number(c.rotacion)) partes.push(`girada ${c.rotacion}°`);
  if (Number(c.escala) && Number(c.escala) !== 100) partes.push(`escala ${mm(c.escala)} %`);
  if (c.dpi) partes.push(`${c.dpi} dpi`);
  return partes.length ? partes.join(' · ') : 'sin ajustes';
};

export const DPI_OPCIONES = [
  { valor: '',    texto: 'No sé / impresora de oficina' },
  { valor: '203', texto: '203 dpi (8 puntos/mm) — la mayoría de impresoras de etiquetas' },
  { valor: '300', texto: '300 dpi (12 puntos/mm)' },
  { valor: '600', texto: '600 dpi (24 puntos/mm)' },
];

export const TAMANOS_LETRA = [
  { valor: 0.85, texto: 'Pequeña' },
  { valor: 1,    texto: 'Normal' },
  { valor: 1.15, texto: 'Grande' },
  { valor: 1.3,  texto: 'Muy grande' },
];
