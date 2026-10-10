// src/hooks/useExportarPdfPrestamos.js
// ─────────────────────────────────────────────────────────────────────────────
// Hook reutilizable que llama al endpoint y descarga el PDF en el navegador.
// No depende de ninguna librería de terceros adicional.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import api from '../api/axios.config'; // tu instancia Axios con baseURL y auth
import { descargarBlob } from '../utils/descargarArchivo';

/**
 * @typedef {'prestatario'|'cliente'} TipoPersona
 *
 * @returns {{
 *   exportando: boolean,
 *   exportarPdf: (tipo: TipoPersona, personaId: number, nombreArchivo?: string) => Promise<void>
 * }}
 */
const useExportarPdfPrestamos = () => {
  const [exportando, setExportando] = useState(false);

  const exportarPdf = async (tipo, personaId, nombreArchivo = 'prestamos-activos') => {
    setExportando(true);
    try {
      const response = await api.get(`/prestamos/pdf/${tipo}/${personaId}`, {
        responseType: 'blob',
      });

      descargarBlob(response.data, `${nombreArchivo}.pdf`);
    } catch (err) {
      // El blob puede contener el JSON de error del servidor
      if (err.response?.data instanceof Blob) {
        const texto = await err.response.data.text();
        try {
          const json = JSON.parse(texto);
          throw new Error(json.error || 'Error al generar el PDF');
        } catch {
          throw new Error('Error al generar el PDF');
        }
      }
      throw err;
    } finally {
      setExportando(false);
    }
  };

  return { exportando, exportarPdf };
};

export default useExportarPdfPrestamos;