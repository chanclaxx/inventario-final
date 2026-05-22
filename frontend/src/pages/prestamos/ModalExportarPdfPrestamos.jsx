import { useState } from 'react';
import { Modal }   from '../../components/ui/Modal';
import { FileText, LayoutList, Download, Loader2 } from 'lucide-react';
import { descargarPdfPrestamosActivos, descargarPdfEstadoCuenta } from '../../api/prestamos.api';

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export function ModalExportarPdfPrestamos({ tipo, personaId, personaNombre, onClose }) {
  const [cargando, setCargando] = useState(null); // 'activos' | 'cuenta'
  const [error,    setError]    = useState('');

  const tipoApi = tipo === 'companero' ? 'prestatario' : tipo;

  const handleDescargar = async (modo) => {
    setError('');
    setCargando(modo);
    try {
      const fn  = modo === 'activos' ? descargarPdfPrestamosActivos : descargarPdfEstadoCuenta;
      const res = await fn(tipoApi, personaId);
      const nombre = modo === 'activos'
        ? `prestamos-activos-${personaNombre || personaId}.pdf`
        : `estado-cuenta-${personaNombre || personaId}.pdf`;
      descargar(res.data, nombre);
      onClose();
    } catch (err) {
      const msg = err.response?.status === 404
        ? 'No hay préstamos activos para exportar.'
        : 'Error al generar el PDF. Intenta de nuevo.';
      setError(msg);
    } finally {
      setCargando(null);
    }
  };

  const opciones = [
    {
      id:          'activos',
      Icn:         FileText,
      titulo:      'Préstamos activos',
      descripcion: 'Lista de préstamos vigentes con sus abonos y saldo pendiente de cada uno.',
      color:       'blue',
    },
    {
      id:          'cuenta',
      Icn:         LayoutList,
      titulo:      'Estado de cuenta',
      descripcion: 'Todos los movimientos (préstamos, abonos, compras) con saldo acumulado en 5 columnas.',
      color:       'purple',
    },
  ];

  const colorMap = {
    blue:   { border: 'border-blue-200',   bg: 'bg-blue-50',   text: 'text-blue-700',   icon: 'text-blue-500',   btn: 'bg-blue-600 hover:bg-blue-700'   },
    purple: { border: 'border-purple-200', bg: 'bg-purple-50', text: 'text-purple-700', icon: 'text-purple-500', btn: 'bg-purple-600 hover:bg-purple-700' },
  };

  return (
    <Modal open onClose={onClose} title="Exportar PDF" size="sm">
      <div className="flex flex-col gap-3">

        {personaNombre && (
          <p className="text-xs text-gray-400">
            Exportando estado de cuenta de <span className="font-semibold text-gray-600">{personaNombre}</span>
          </p>
        )}

        {opciones.map((op) => {
          const Icn = op.Icn;
          const c   = colorMap[op.color];
          const activo = cargando === op.id;
          return (
            <button
              key={op.id}
              disabled={!!cargando}
              onClick={() => handleDescargar(op.id)}
              className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all
                ${c.border} ${c.bg}
                hover:shadow-sm disabled:opacity-60 disabled:cursor-not-allowed`}>
              <div className={`mt-0.5 flex-shrink-0 ${c.icon}`}>
                {activo
                  ? <Loader2 size={20} className="animate-spin" />
                  : <Icn size={20} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${c.text}`}>{op.titulo}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-snug">{op.descripcion}</p>
              </div>
              {!activo && (
                <Download size={14} className={`mt-1 flex-shrink-0 ${c.icon} opacity-60`} />
              )}
            </button>
          );
        })}

        {error && (
          <p className="text-xs text-red-500 text-center">{error}</p>
        )}

        <button
          onClick={onClose}
          className="mt-1 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50 transition-colors border border-gray-200">
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
