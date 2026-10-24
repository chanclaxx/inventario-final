// src/hooks/useExportarPdfGarantia.js
// ─────────────────────────────────────────────────────────────────────────────
// Descargar o compartir los PDF de garantías con proveedores (el comprobante
// del caso y la guía del envío). Mismo patrón que useExportarPdfRedInterna: el
// PDF lo arma el backend y aquí solo se baja; en el celular se abre la hoja de
// compartir (WhatsApp, correo…) y en el computador se descarga.
//
// La descarga pasa por `descargarBlob` (libera la URL al minuto): en iPhone,
// revocarla en el mismo clic abre el PDF en blanco.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import api from '../api/axios.config';
import { descargarBlob, mensajeDeErrorBlob } from '../utils/descargarArchivo';

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

export default function useExportarPdfGarantia() {
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
      if (err?.name !== 'AbortError') setError(await mensajeDeErrorBlob(err, err?.message || 'No se pudo generar el PDF'));
    } finally {
      setExportando(false);
    }
  }, [puedeCompartir]);

  return { exportando, error, exportar, puedeCompartir };
}
