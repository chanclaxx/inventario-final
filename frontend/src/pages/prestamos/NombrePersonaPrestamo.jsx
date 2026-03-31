// src/components/prestamos/NombrePersonaPrestamo.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Muestra el nombre del prestatario o cliente en la lista de préstamos.
// Al hacer clic abre un pequeño popover con la opción de exportar el PDF
// de todos sus préstamos ACTIVOS.
//
// Props:
//   prestamo  → objeto fila de la lista (del endpoint GET /prestamos)
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useState, useEffect } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import useExportarPdfPrestamos from '../../hooks/useExportarPdfPrestamos';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determina el tipo de persona y su id a partir de la fila del préstamo.
 * Retorna null si el préstamo no está activo (no tiene sentido exportar).
 */
const resolverPersona = (prestamo) => {
  if (prestamo.prestatario_id) {
    return {
      tipo:   'prestatario',
      id:     prestamo.prestatario_id,
      nombre: prestamo.prestatario_nombre || prestamo.prestatario,
    };
  }
  if (prestamo.cliente_id) {
    return {
      tipo:   'cliente',
      id:     prestamo.cliente_id,
      nombre: prestamo.cliente_nombre || prestamo.prestatario,
    };
  }
  return null;
};

// ─── Popover ──────────────────────────────────────────────────────────────────

function PopoverExportar({ persona, onExportar, exportando, onClose }) {
  const ref = useRef(null);

  // Cerrar al hacer clic fuera
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-50 left-0 mt-1 w-64 bg-white border border-gray-200
        rounded-xl shadow-lg overflow-hidden"
    >
      {/* Cabecera del popover */}
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide truncate">
          {persona.nombre}
        </p>
        <p className="text-xs text-gray-400">
          {persona.tipo === 'prestatario' ? 'Prestatario' : 'Cliente'}
        </p>
      </div>

      {/* Acción */}
      <button
        onClick={onExportar}
        disabled={exportando}
        className="w-full flex items-center gap-2.5 px-3 py-2.5
          hover:bg-blue-50 transition-colors text-left
          disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exportando ? (
          <Loader2 size={15} className="text-blue-500 animate-spin shrink-0" />
        ) : (
          <FileDown size={15} className="text-blue-500 shrink-0" />
        )}
        <div>
          <p className="text-sm font-medium text-gray-800">
            {exportando ? 'Generando PDF…' : 'Exportar PDF'}
          </p>
          <p className="text-xs text-gray-400">Solo préstamos activos</p>
        </div>
      </button>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function NombrePersonaPrestamo({ prestamo }) {
  const [abierto, setAbierto] = useState(false);
  const { exportando, exportarPdf } = useExportarPdfPrestamos();

  const persona = resolverPersona(prestamo);

  // Si no se puede identificar la persona, solo mostrar texto plano
  if (!persona) {
    return (
      <span className="text-sm text-gray-800">
        {prestamo.prestatario || '—'}
      </span>
    );
  }

  const handleExportar = async () => {
    try {
      const nombreArchivo = `prestamos-activos-${persona.nombre.replace(/\s+/g, '-').toLowerCase()}`;
      await exportarPdf(persona.tipo, persona.id, nombreArchivo);
      setAbierto(false);
    } catch (err) {
      // Puedes conectar esto a tu sistema de toasts
      console.error('[ExportarPDF]', err.message);
      alert(err.message || 'Error al generar el PDF');
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setAbierto((prev) => !prev)}
        className="text-sm font-medium text-blue-600 hover:text-blue-800
          hover:underline underline-offset-2 transition-colors text-left"
        title="Clic para ver opciones"
      >
        {persona.nombre}
      </button>

      {abierto && (
        <PopoverExportar
          persona={persona}
          onExportar={handleExportar}
          exportando={exportando}
          onClose={() => setAbierto(false)}
        />
      )}
    </div>
  );
}