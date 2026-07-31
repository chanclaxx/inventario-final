import { useState } from 'react';
import { Modal } from './Modal';
import { Download, Loader2 } from 'lucide-react';

/**
 * Modal de exportación de cuentas — compartido por Préstamos y Créditos.
 *
 * Cada módulo pasa sus opciones; el flujo (tarjetas con descripción, spinner en
 * la que se está generando, manejo de error y descarga del blob) es idéntico
 * en los dos para que el usuario no tenga que aprender dos interfaces.
 *
 * Opción: { id, Icn, titulo, descripcion, color, archivo, descargar }
 *   · `descargar` devuelve una promesa con la respuesta Axios (blob).
 *   · `archivo`   es el nombre del archivo a guardar.
 */

const COLOR_MAP = {
  blue:    { border: 'border-blue-200',    bg: 'bg-blue-50',    text: 'text-blue-700',    icon: 'text-blue-500'    },
  purple:  { border: 'border-purple-200',  bg: 'bg-purple-50',  text: 'text-purple-700',  icon: 'text-purple-500'  },
  emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-500' },
};

function guardar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export function ModalExportarCuenta({
  opciones, personaNombre, titulo = 'Exportar PDF', onClose,
}) {
  const [cargando, setCargando] = useState(null);
  const [error,    setError]    = useState('');

  const handleDescargar = async (op) => {
    setError('');
    setCargando(op.id);
    try {
      const res = await op.descargar();
      guardar(res.data, op.archivo);
      onClose();
    } catch (err) {
      setError(err.response?.status === 404
        ? 'No hay información para exportar.'
        : 'Error al generar el archivo. Intenta de nuevo.');
    } finally {
      setCargando(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={titulo} size="sm">
      <div className="flex flex-col gap-3">

        {personaNombre && (
          <p className="text-xs text-gray-400">
            Exportando estado de cuenta de{' '}
            <span className="font-semibold text-gray-600">{personaNombre}</span>
          </p>
        )}

        {opciones.map((op) => {
          const Icn    = op.Icn;
          const c      = COLOR_MAP[op.color] || COLOR_MAP.blue;
          const activo = cargando === op.id;
          return (
            <button
              key={op.id}
              disabled={!!cargando}
              onClick={() => handleDescargar(op)}
              className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all
                ${c.border} ${c.bg}
                hover:shadow-sm disabled:opacity-60 disabled:cursor-not-allowed`}>
              <div className={`mt-0.5 flex-shrink-0 ${c.icon}`}>
                {activo ? <Loader2 size={20} className="animate-spin" /> : <Icn size={20} />}
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

        {error && <p className="text-xs text-red-500 text-center">{error}</p>}

        <button
          onClick={onClose}
          className="mt-1 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50 transition-colors border border-gray-200">
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
