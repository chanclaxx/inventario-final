// src/hooks/useExportarPdfFactura.js
// ─────────────────────────────────────────────────────────────────────────────
// Hook reutilizable para descargar el PDF de una factura desde el backend
// y/o compartirlo usando la Web Share API (nativa del sistema operativo).
//
// La Web Share API muestra el sheet nativo del SO (el mismo que usa TikTok),
// donde el usuario puede elegir WhatsApp, Telegram, Mail, etc.
//
// En desktop donde share no está disponible, hace fallback a descarga directa.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import api from '../api/axios.config';

/**
 * Descarga el PDF de una factura como Blob desde el backend.
 * @param {number|string} facturaId
 * @returns {Promise<{blob: Blob, nombreArchivo: string}>}
 */
async function fetchPdfBlob(facturaId) {
  const numFormateado = String(facturaId).padStart(6, '0');

  const response = await api.get(`/facturas/${facturaId}/pdf`, {
    responseType: 'blob',
  });

  // Manejo de errores que llegan como blob JSON
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
    nombreArchivo: `factura-${numFormateado}.pdf`,
  };
}

/**
 * @returns {{
 *   exportando: boolean,
 *   descargarPdf: (facturaId: number|string) => Promise<void>,
 *   compartirPdf: (facturaId: number|string, nombreCliente?: string) => Promise<void>,
 *   puedeCompartir: boolean,
 * }}
 */
const useExportarPdfFactura = () => {
  const [exportando, setExportando] = useState(false);

  // La Web Share API con archivos está disponible en móviles modernos
  const puedeCompartir = typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function';

  /**
   * Descarga el PDF directamente al dispositivo.
   */
  const descargarPdf = useCallback(async (facturaId) => {
    setExportando(true);
    try {
      const { blob, nombreArchivo } = await fetchPdfBlob(facturaId);
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

  /**
   * Abre el sheet nativo de compartir (WhatsApp, Telegram, Mail, etc.).
   * Si el navegador no lo soporta, hace fallback a descarga directa.
   *
   * @param {number|string} facturaId
   * @param {string} [nombreCliente] - Para el texto del mensaje compartido
   */
  const compartirPdf = useCallback(async (facturaId, nombreCliente = '') => {
    setExportando(true);
    try {
      const { blob, nombreArchivo } = await fetchPdfBlob(facturaId);
      const archivo = new File([blob], nombreArchivo, { type: 'application/pdf' });

      const shareData = {
        title: `Factura #${String(facturaId).padStart(6, '0')}`,
        text:  nombreCliente
          ? `Factura de compra de ${nombreCliente}`
          : 'Adjunto tu factura de compra',
        files: [archivo],
      };

      // Verificar que el navegador puede compartir archivos PDF
      const shareConArchivos = puedeCompartir && navigator.canShare(shareData);

      if (shareConArchivos) {
        await navigator.share(shareData);
      } else if (puedeCompartir) {
        // Share sin archivos (algunos navegadores): solo título y texto
        await navigator.share({
          title: shareData.title,
          text:  shareData.text,
        });
      } else {
        // Fallback: descarga directa en desktop
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

export default useExportarPdfFactura;