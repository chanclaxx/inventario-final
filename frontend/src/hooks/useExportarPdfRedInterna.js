// src/hooks/useExportarPdfRedInterna.js
// ─────────────────────────────────────────────────────────────────────────────
// Descargar o compartir los PDF de la red interna (un envío, los envíos
// pendientes de un local y su estado de cuenta). Mismo patrón que
// useExportarPdfFactura: el PDF lo arma el backend y aquí solo se baja; en el
// celular se abre la hoja nativa de compartir (WhatsApp, correo…) y en el
// computador, donde no existe, se descarga.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import api from '../api/axios.config';

// Un error llega como JSON dentro del blob (403: no es de tu sucursal, 404…):
// se lee para mostrar el motivo en vez de un PDF roto.
async function fetchPdf(ruta) {
  const response = await api.get(ruta, { responseType: 'blob', timeout: 120000 });
  if (response.data.type === 'application/json') {
    const texto = await response.data.text();
    let mensaje = 'No se pudo generar el PDF';
    try { mensaje = JSON.parse(texto).error || mensaje; } catch { /* queda el genérico */ }
    throw new Error(mensaje);
  }
  return new Blob([response.data], { type: 'application/pdf' });
}

async function mensajeDeError(err) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).error || 'No se pudo generar el PDF'; } catch { /* sigue */ }
  }
  return err?.message || 'No se pudo generar el PDF';
}

const descargarBlob = (blob, nombreArchivo) => {
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nombreArchivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function useExportarPdfRedInterna() {
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState('');

  const puedeCompartir = typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function';

  /**
   * @param {{ ruta: string, nombreArchivo: string, titulo: string, texto?: string }} pdf
   * @param {'descargar'|'compartir'} modo
   */
  const exportar = useCallback(async (pdf, modo = 'descargar') => {
    setExportando(true);
    setError('');
    try {
      const blob = await fetchPdf(pdf.ruta);
      if (modo === 'compartir' && puedeCompartir) {
        const archivo = new File([blob], pdf.nombreArchivo, { type: 'application/pdf' });
        const datos = { title: pdf.titulo, text: pdf.texto || pdf.titulo, files: [archivo] };
        if (navigator.canShare(datos)) {
          await navigator.share(datos);
          return;
        }
      }
      descargarBlob(blob, pdf.nombreArchivo);
    } catch (err) {
      // Cancelar la hoja de compartir no es un error.
      if (err?.name !== 'AbortError') setError(await mensajeDeError(err));
    } finally {
      setExportando(false);
    }
  }, [puedeCompartir]);

  return { exportando, error, exportar, puedeCompartir };
}
