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
// Si el navegador bloquea el almacenamiento, se cae a los valores por defecto y
// la pantalla funciona igual.
const CLAVE = 'etiquetas_preferencias';

export const PREFERENCIAS_DEFECTO = {
  simbologia:   'barras',
  formato:      'a4-5x13',
  personalizado: { medio: 'rollo', ancho: 50, alto: 25, columnas: 1, filas: 1 },
  mostrar:      { nombre: true, variante: true, precio: false, encabezado: false },
  marco:        false,
  ajuste:       { x: 0, y: 0 },
  cantidadModo: 'uno',
};

export const leerPreferencias = () => {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return { ...PREFERENCIAS_DEFECTO };
    const guardado = JSON.parse(raw);
    // Mezcla superficial por clave: una preferencia nueva que aún no esté
    // guardada toma su valor por defecto en vez de quedar `undefined`.
    return {
      ...PREFERENCIAS_DEFECTO, ...guardado,
      mostrar:       { ...PREFERENCIAS_DEFECTO.mostrar,       ...(guardado.mostrar || {}) },
      ajuste:        { ...PREFERENCIAS_DEFECTO.ajuste,        ...(guardado.ajuste || {}) },
      personalizado: { ...PREFERENCIAS_DEFECTO.personalizado, ...(guardado.personalizado || {}) },
    };
  } catch { return { ...PREFERENCIAS_DEFECTO }; }
};

export const guardarPreferencias = (p) => {
  try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch { /* sin memoria, da igual */ }
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
 * @returns {{ generando: boolean, error: string, imprimir, descargar, previsualizar }}
 *   `previsualizar` devuelve una URL de blob para meter en un <iframe>; quien la
 *   usa es responsable de revocarla.
 */
export const useEtiquetas = () => {
  const [generando, setGenerando] = useState(false);
  const [error,     setError]     = useState('');

  const _pedir = useCallback(async (body) => {
    const { data } = await pdfEtiquetas(body);
    if (data.type === 'application/json') {
      throw new Error(await _mensajeDeBlob(data) || 'No se pudo generar el PDF');
    }
    return new Blob([data], { type: 'application/pdf' });
  }, []);

  const _envolver = useCallback(async (accion) => {
    setGenerando(true);
    setError('');
    try { return await accion(); }
    catch (err) {
      setError(err?.response?.data?.error || err?.message || 'No se pudo generar el PDF');
      return null;
    } finally { setGenerando(false); }
  }, []);

  const imprimir = useCallback((body) => _envolver(async () => {
    const url = URL.createObjectURL(await _pedir(body));
    _imprimir(url, () => window.open(url, '_blank'));
    return true;
  }), [_envolver, _pedir]);

  const descargar = useCallback((body) => _envolver(async () => {
    const url = URL.createObjectURL(await _pedir(body));
    const a = document.createElement('a');
    a.href = url;
    a.download = `etiquetas-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }), [_envolver, _pedir]);

  const previsualizar = useCallback((body) => _envolver(async () =>
    URL.createObjectURL(await _pedir(body))), [_envolver, _pedir]);

  return { generando, error, setError, imprimir, descargar, previsualizar };
};

export default useEtiquetas;
