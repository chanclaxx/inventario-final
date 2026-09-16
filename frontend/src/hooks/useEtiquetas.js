import { useCallback, useState } from 'react';
import { pdfEtiquetas } from '../api/etiquetas.api';

// ── Preferencias de impresión ────────────────────────────────────────────────
//
// En `localStorage` y no en `config_negocio`: son de la MÁQUINA, no del negocio.
// El tamaño de plancha que compró esta oficina y, sobre todo, el desvío de ESTA
// impresora no tienen por qué ser los mismos en la otra sede — y guardarlos en
// la base los impondría a todas. Quien etiqueta lo hace todas las semanas y no
// tiene por qué volver a elegir formato cada vez.
//
// La CALIBRACIÓN (desvío, giro, escala, resolución) se guarda POR FORMATO: una
// oficina con una láser para las planchas y una térmica para el rollo necesita
// dos calibraciones distintas, y con una sola global cada cambio de papel
// desacomodaba el otro.
//
// Si el navegador bloquea el almacenamiento, se cae a los valores por defecto y
// la pantalla funciona igual.
const CLAVE = 'etiquetas_preferencias';

export const CALIBRACION_DEFECTO = { ajuste: { x: 0, y: 0 }, rotacion: 0, escala: 100, dpi: null };

// El editor a medida arranca en el caso que se reportó: una tira de 3 columnas.
export const PERSONALIZADO_DEFECTO = {
  medio: 'rollo', ancho: 32, alto: 25, columnas: 3,
  separacion: { x: 2, y: 3 },
  anchoRollo: 104,
  margen: { izquierda: '', arriba: '' },
  filasPorPagina: 1, incluirSeparacion: false,
  papel: 'a4', pagina: { ancho: 210, alto: 297 }, filas: 8,
};

export const PREFERENCIAS_DEFECTO = {
  simbologia:    'barras',
  formato:       'a4-5x13',
  personalizado: PERSONALIZADO_DEFECTO,
  guardados:     [],   // [{ id, nombre, personalizado }]
  mostrar:       { nombre: true, variante: true, precio: false, encabezado: false, pie: false },
  encabezadoTexto: '',
  pieTexto:        '',
  diseno:        { alinear: 'centro', escalaTexto: 1, lineasNombre: 2, margenInterior: '', altoSimbolo: '' },
  marco:         false,
  calibracion:   {},   // { [claveFormato]: CALIBRACION }
  cantidadModo:  'uno',
};

const _objeto = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export const leerPreferencias = () => {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return { ...PREFERENCIAS_DEFECTO };
    const g = JSON.parse(raw);
    const pers = _objeto(g.personalizado);

    // Las preferencias viejas tenían UN desvío global (`ajuste`). Se hereda al
    // formato que estaba elegido, que es la impresora con la que se midió.
    const calibracion = { ..._objeto(g.calibracion) };
    const ajusteViejo = _objeto(g.ajuste);
    if (!g.calibracion && (Number(ajusteViejo.x) || Number(ajusteViejo.y)) && g.formato) {
      calibracion[g.formato] = { ...CALIBRACION_DEFECTO, ajuste: { x: Number(ajusteViejo.x) || 0, y: Number(ajusteViejo.y) || 0 } };
    }

    // Mezcla por clave: una preferencia nueva que aún no esté guardada toma su
    // valor por defecto en vez de quedar `undefined`.
    return {
      ...PREFERENCIAS_DEFECTO, ...g,
      mostrar:  { ...PREFERENCIAS_DEFECTO.mostrar, ..._objeto(g.mostrar) },
      diseno:   { ...PREFERENCIAS_DEFECTO.diseno,  ..._objeto(g.diseno) },
      personalizado: {
        ...PERSONALIZADO_DEFECTO, ...pers,
        separacion: { ...PERSONALIZADO_DEFECTO.separacion, ..._objeto(pers.separacion) },
        margen:     { ...PERSONALIZADO_DEFECTO.margen,     ..._objeto(pers.margen) },
        pagina:     { ...PERSONALIZADO_DEFECTO.pagina,     ..._objeto(pers.pagina) },
      },
      guardados: Array.isArray(g.guardados) ? g.guardados.filter((f) => f?.id && f?.personalizado) : [],
      calibracion,
    };
  } catch { return { ...PREFERENCIAS_DEFECTO }; }
};

export const guardarPreferencias = (p) => {
  // `ajuste` era el campo global de antes: ya vive dentro de `calibracion`.
  const { ajuste: _viejo, ...resto } = p;
  try { localStorage.setItem(CLAVE, JSON.stringify(resto)); } catch { /* sin memoria, da igual */ }
};

/** La calibración del formato elegido (o la de por defecto si nunca se calibró). */
export const calibracionDe = (prefs, claveFormato) => {
  const c = _objeto(prefs.calibracion?.[claveFormato]);
  return {
    ...CALIBRACION_DEFECTO, ...c,
    ajuste: { ...CALIBRACION_DEFECTO.ajuste, ..._objeto(c.ajuste) },
    // Solo 0 o 180: un 90/270 guardado antes no hacía nada (el navegador lo
    // deshacía al imprimir) y ya no tiene botón que lo muestre.
    rotacion: Number(c.rotacion) === 180 ? 180 : 0,
  };
};

// ── Entrega del PDF ──────────────────────────────────────────────────────────

/** Un error del backend llega como blob de JSON, no como objeto. */
const _mensajeDeBlob = async (blob) => {
  try {
    const json = JSON.parse(await blob.text());
    return json.error || json.message || null;
  } catch { return null; }
};

/**
 * Abre el diálogo de impresión sin descargar nada.
 *
 * Es la acción principal: quien está etiquetando quiere la hoja saliendo de la
 * impresora, no un archivo en Descargas que luego hay que abrir. El iframe
 * oculto es lo que evita el rodeo; Safari e iOS no dejan imprimir desde ahí, y
 * para esos se abre en una pestaña, que es lo mismo con un clic más.
 */
const _imprimir = (url, alFallar) => {
  const marco = document.createElement('iframe');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  marco.src = url;
  marco.onload = () => {
    try {
      marco.contentWindow.focus();
      marco.contentWindow.print();
    } catch { alFallar(); }
    // El diálogo sigue leyendo del blob mientras está abierto: liberar la URL
    // ahí mismo deja la vista previa del sistema en blanco.
    setTimeout(() => { URL.revokeObjectURL(url); marco.remove(); }, 120000);
  };
  document.body.appendChild(marco);
};

/**
 * Pide el PDF de etiquetas y lo entrega: imprimir, descargar o previsualizar.
 *
 * @returns {{ generando: boolean, error: string, imprimir, descargar, previsualizar, abrir }}
 *   `previsualizar` devuelve una URL de blob para meter en un <iframe>; quien la
 *   usa es responsable de revocarla.
 */
export const useEtiquetas = (pedirPdf = pdfEtiquetas) => {
  const [generando, setGenerando] = useState(false);
  const [error,     setError]     = useState('');

  // `pedirPdf` cambia DE DÓNDE sale el PDF (Inventario o una compra), no cómo se
  // entrega: imprimir, descargar y la previa son los mismos. Quien lo pasa tiene
  // que memorizarlo, o la previa se pediría otra vez en cada render.
  const _pedir = useCallback(async (body) => {
    const { data } = await pedirPdf(body);
    if (data.type === 'application/json') {
      throw new Error(await _mensajeDeBlob(data) || 'No se pudo generar el PDF');
    }
    return new Blob([data], { type: 'application/pdf' });
  }, [pedirPdf]);

  const _envolver = useCallback(async (accion) => {
    setGenerando(true);
    setError('');
    try { return await accion(); }
    catch (err) {
      const blob = err?.response?.data;
      const msg = blob instanceof Blob ? await _mensajeDeBlob(blob) : err?.response?.data?.error;
      setError(msg || err?.message || 'No se pudo generar el PDF');
      return null;
    } finally { setGenerando(false); }
  }, []);

  const imprimir = useCallback((body) => _envolver(async () => {
    const url = URL.createObjectURL(await _pedir(body));
    _imprimir(url, () => window.open(url, '_blank'));
    return true;
  }), [_envolver, _pedir]);

  const descargar = useCallback((body, nombre) => _envolver(async () => {
    const url = URL.createObjectURL(await _pedir(body));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre || `etiquetas-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }), [_envolver, _pedir]);

  /** Abre el PDF en una pestaña: la vista previa de los celulares, que no pintan PDF dentro de un iframe. */
  const abrir = useCallback((body) => _envolver(async () => {
    const url = URL.createObjectURL(await _pedir(body));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return true;
  }), [_envolver, _pedir]);

  const previsualizar = useCallback((body) => _envolver(async () =>
    URL.createObjectURL(await _pedir(body))), [_envolver, _pedir]);

  return { generando, error, setError, imprimir, descargar, previsualizar, abrir };
};

export default useEtiquetas;
