// src/components/ui/ModalImprimirFactura.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Modal que aparece al presionar "Imprimir" en una factura.
// Permite elegir entre impresión POS (térmica) o PDF (descarga / compartir).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Modal }    from './Modal';
import { Printer, FileDown, Share2, Loader2, X } from 'lucide-react';
import useExportarPdfFactura from '../../hooks/useExportarPdfFactura';

// ─── Opción seleccionable ─────────────────────────────────────────────────────

function OpcionFormato({ activo, onClick, icono, titulo, descripcion, color }) {
  const IconoFormato = icono;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border-2
        transition-all text-center
        ${activo
          ? `${color.borde} ${color.fondo} ${color.texto}`
          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'}`}
    >
      <IconoFormato size={22} className={activo ? color.icono : 'text-gray-400'} />
      <div>
        <p className="text-sm font-semibold">{titulo}</p>
        <p className={`text-xs mt-0.5 ${activo ? color.descripcion : 'text-gray-400'}`}>
          {descripcion}
        </p>
      </div>
    </button>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

/**
 * @param {object}   props
 * @param {boolean}  props.open
 * @param {Function} props.onClose
 * @param {object}   props.factura        - Objeto factura completo (con id, nombre_cliente, config, etc.)
 * @param {Array}    props.garantias      - Garantías de la factura
 * @param {Function} props.onImprimirPos  - Callback para abrir FacturaTermica (impresión POS)
 */
export function ModalImprimirFactura({ open, onClose, factura, garantias, onImprimirPos }) {
  const [formato, setFormato] = useState('pos');
  const [error,   setError]   = useState('');

  const { exportando, descargarPdf, compartirPdf, puedeCompartir } =
    useExportarPdfFactura();

  if (!factura) return null;

  const handleConfirmar = async () => {
    setError('');

    if (formato === 'pos') {
      onImprimirPos(factura, garantias);
      onClose();
      return;
    }

    // Formato PDF
    try {
      await descargarPdf(factura.id);
      onClose();
    } catch (err) {
      setError(err.message || 'Error al generar el PDF');
    }
  };

  const handleCompartir = async () => {
    setError('');
    try {
      await compartirPdf(factura.id, factura.nombre_cliente);
      onClose();
    } catch (err) {
      // Si el usuario canceló el share nativo, no mostrar error
      if (err?.name !== 'AbortError') {
        setError(err.message || 'Error al compartir el PDF');
      }
    }
  };

  const numFactura = `#${String(factura.id).padStart(6, '0')}`;

  return (
    <Modal open={open} onClose={onClose} title="Imprimir factura" size="sm">
      <div className="flex flex-col gap-5">

        {/* Número de factura */}
        <p className="text-sm text-gray-500 -mt-1">
          Factura <span className="font-semibold text-gray-700">{numFactura}</span>
          {factura.nombre_cliente && (
            <> · {factura.nombre_cliente}</>
          )}
        </p>

        {/* Selector de formato */}
        <div className="flex gap-3">
          <OpcionFormato
            activo={formato === 'pos'}
            onClick={() => setFormato('pos')}
            icono={Printer}
            titulo="Impresora POS"
            descripcion="Ticket térmico"
            color={{
              borde:       'border-blue-300',
              fondo:       'bg-blue-50',
              texto:       'text-blue-700',
              icono:       'text-blue-500',
              descripcion: 'text-blue-400',
            }}
          />
          <OpcionFormato
            activo={formato === 'pdf'}
            onClick={() => setFormato('pdf')}
            icono={FileDown}
            titulo="Formato PDF"
            descripcion="Descargar archivo"
            color={{
              borde:       'border-purple-300',
              fondo:       'bg-purple-50',
              texto:       'text-purple-700',
              icono:       'text-purple-500',
              descripcion: 'text-purple-400',
            }}
          />
        </div>

        {/* Mensaje contextual */}
        {formato === 'pos' && (
          <p className="text-xs text-gray-400 bg-gray-50 rounded-xl px-3 py-2.5">
            Se enviará a la impresora térmica configurada.
          </p>
        )}

        {formato === 'pdf' && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-400 bg-gray-50 rounded-xl px-3 py-2.5">
              Se descargará un PDF en formato A4 con toda la información de la factura.
            </p>

            {/* Botón compartir (visible solo si el navegador lo soporta) */}
            {puedeCompartir && (
              <button
                type="button"
                disabled={exportando}
                onClick={handleCompartir}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl
                  text-sm font-medium border-2 border-dashed border-green-300
                  text-green-700 bg-green-50 hover:bg-green-100 transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exportando
                  ? <Loader2 size={15} className="animate-spin" />
                  : <Share2 size={15} />}
                Compartir (WhatsApp, Telegram…)
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            <X size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Acciones */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium
              bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={exportando}
            onClick={handleConfirmar}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
              text-sm font-medium bg-blue-600 text-white hover:bg-blue-700
              transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportando
              ? <Loader2 size={15} className="animate-spin" />
              : formato === 'pos'
                ? <Printer size={15} />
                : <FileDown size={15} />}
            {formato === 'pos' ? 'Imprimir POS' : 'Descargar PDF'}
          </button>
        </div>
      </div>
    </Modal>
  );
}