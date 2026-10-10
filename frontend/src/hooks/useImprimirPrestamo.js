// src/hooks/useImprimirPrestamo.js
import { useState } from 'react';
import api from '../api/axios.config';
import { descargarBlob } from '../utils/descargarArchivo';

export default function useImprimirPrestamo() {
  const [descargando, setDescargando] = useState(false);

  const descargarPdf = async (prestamoId, numeroMostrar) => {
    setDescargando(true);
    try {
      const response = await api.get(`/prestamos/${prestamoId}/pdf`, {
        responseType: 'blob',
      });
      descargarBlob(response.data, `prestamo-${numeroMostrar ?? prestamoId}.pdf`);
    } finally {
      setDescargando(false);
    }
  };

  const compartirPdf = async (prestamoId, numeroMostrar) => {
    setDescargando(true);
    try {
      const response = await api.get(`/prestamos/${prestamoId}/pdf`, {
        responseType: 'blob',
      });

      const file = new File(
        [response.data],
        `prestamo-${numeroMostrar ?? prestamoId}.pdf`,
        { type: 'application/pdf' }
      );

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Préstamo #${numeroMostrar ?? prestamoId}` });
      } else {
        // Fallback a descarga directa
        descargarBlob(response.data, `prestamo-${numeroMostrar ?? prestamoId}.pdf`);
      }
    } finally {
      setDescargando(false);
    }
  };

  return { descargando, descargarPdf, compartirPdf };
}
