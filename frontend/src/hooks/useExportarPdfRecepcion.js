// src/hooks/useExportarPdfRecepcion.js
// Descarga y/o comparte el PDF del recibo de recepción de una orden de servicio.

import { useState, useCallback } from 'react';
import api from '../api/axios.config';

async function fetchPdfBlob(ordenId, numeroMostrar) {
  const numFormateado = String(numeroMostrar ?? ordenId).padStart(4, '0');

  const response = await api.get(`/servicios/${ordenId}/pdf-recepcion`, {
    responseType: 'blob',
  });

  if (response.data.type === 'application/json') {
    const texto = await response.data.text();
    try {
      const json = JSON.parse(texto);
      throw new Error(json.error || 'Error al generar el PDF');
    } catch {
      throw new Error('Error al generar el PDF');
    }
  }

  return {
    blob:          new Blob([response.data], { type: 'application/pdf' }),
    nombreArchivo: `recepcion-OS-${numFormateado}.pdf`,
  };
}

const useExportarPdfRecepcion = () => {
  const [exportando, setExportando] = useState(false);

  const puedeCompartir = typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function';

  const descargarPdf = useCallback(async (ordenId, numeroMostrar) => {
    setExportando(true);
    try {
      const { blob, nombreArchivo } = await fetchPdfBlob(ordenId, numeroMostrar);
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      link.download = nombreArchivo;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExportando(false);
    }
  }, []);

  const compartirPdf = useCallback(async (ordenId, nombreCliente = '', numeroMostrar) => {
    setExportando(true);
    try {
      const { blob, nombreArchivo } = await fetchPdfBlob(ordenId, numeroMostrar);
      const archivo = new File([blob], nombreArchivo, { type: 'application/pdf' });

      const shareData = {
        title: `Recibo de recepción #OS-${String(numeroMostrar ?? ordenId).padStart(4, '0')}`,
        text:  nombreCliente
          ? `Recibo de recepción de ${nombreCliente}`
          : 'Adjunto tu recibo de recepción',
        files: [archivo],
      };

      const shareConArchivos = puedeCompartir && navigator.canShare(shareData);

      if (shareConArchivos) {
        await navigator.share(shareData);
      } else if (puedeCompartir) {
        await navigator.share({ title: shareData.title, text: shareData.text });
      } else {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href     = url;
        link.download = nombreArchivo;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExportando(false);
    }
  }, [puedeCompartir]);

  return { exportando, descargarPdf, compartirPdf, puedeCompartir };
};

export default useExportarPdfRecepcion;
