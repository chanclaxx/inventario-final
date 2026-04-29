// src/hooks/useImprimirPrestamo.js
import { useState } from 'react';
import api from '../api/axios.config';

export default function useImprimirPrestamo() {
  const [descargando, setDescargando] = useState(false);

  const descargarPdf = async (prestamoId) => {
    setDescargando(true);
    try {
      const response = await api.get(`/prestamos/${prestamoId}/pdf`, {
        responseType: 'blob',
      });

      const url      = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link     = document.createElement('a');
      link.href      = url;
      link.download  = `prestamo-${prestamoId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } finally {
      setDescargando(false);
    }
  };

  const compartirPdf = async (prestamoId) => {
    setDescargando(true);
    try {
      const response = await api.get(`/prestamos/${prestamoId}/pdf`, {
        responseType: 'blob',
      });

      const file = new File(
        [response.data],
        `prestamo-${prestamoId}.pdf`,
        { type: 'application/pdf' }
      );

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Préstamo #${prestamoId}` });
      } else {
        // Fallback a descarga directa
        const url  = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href  = url;
        link.download = `prestamo-${prestamoId}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } finally {
      setDescargando(false);
    }
  };

  return { descargando, descargarPdf, compartirPdf };
}