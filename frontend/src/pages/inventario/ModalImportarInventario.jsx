import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import {
  Upload, Download, FileSpreadsheet,
  CheckCircle, AlertTriangle, X, ChevronDown, ChevronUp
} from 'lucide-react';
import api from '../../api/axios.config';

// ─────────────────────────────────────────────
// SUBCOMPONENTES
// ─────────────────────────────────────────────

/** Fila colapsable por producto serial */
function FilaProducto({ item }) {
  const [abierto, setAbierto] = useState(false);
  const tieneErrores = item.errores?.length > 0;

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5
          bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="text-sm font-medium text-gray-700 truncate">{item.producto}</span>
        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
          <span className="text-xs text-green-600">+{item.insertados}</span>
          <span className="text-xs text-blue-600">↻{item.actualizados}</span>
          {item.omitidos > 0 && (
            <span className="text-xs text-red-500">✗{item.omitidos}</span>
          )}
          {tieneErrores
            ? <AlertTriangle size={13} className="text-yellow-500" />
            : <CheckCircle   size={13} className="text-green-500" />
          }
          {abierto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </div>
      </button>

      {abierto && tieneErrores && (
        <div className="px-3 py-2 flex flex-col gap-1 bg-white">
          {item.errores.map((e, i) => (
            <p key={i} className="text-xs text-red-500">Fila {e.fila}: {e.error}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bloque de resultado por tipo */
function ResultadoCantidad({ data }) {
  if (!data) return null;
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
      <p className="text-sm font-semibold text-gray-800">Productos por Cantidad</p>
      <div className="flex gap-4 flex-wrap">
        <span className="text-xs text-green-700">✓ {data.insertados} insertado(s)</span>
        <span className="text-xs text-blue-700">↻ {data.actualizados} actualizado(s)</span>
        {data.omitidos > 0 && (
          <span className="text-xs text-red-600">✗ {data.omitidos} omitido(s)</span>
        )}
      </div>
      {data.errores?.map((e, i) => (
        <p key={i} className="text-xs text-red-500">Fila {e.fila}: {e.error}</p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// MODAL PRINCIPAL
// ─────────────────────────────────────────────
export function ModalImportarInventario({ onClose }) {
  const queryClient = useQueryClient();
  const inputRef    = useRef(null);

  const [archivo,   setArchivo]   = useState(null);
  const [resultado, setResultado] = useState(null);
  const [error,     setError]     = useState('');

  const mutation = useMutation({
    mutationFn: (formData) =>
      api.post('/importacion/inventario', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    onSuccess: (res) => {
  setResultado(res.data.data);
  queryClient.resetQueries({ queryKey: ['productos-serial'] });
  queryClient.resetQueries({ queryKey: ['productos-cantidad'] });
},
    onError: (err) => {
      setError(err.response?.data?.error || 'Error al procesar el archivo');
    },
  });

  const handleArchivo = (file) => {
    if (!file) return;
    setArchivo(file);
    setResultado(null);
    setError('');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleArchivo(file);
  };

  const handleImportar = () => {
    if (!archivo) return;
    setError('');
    const fd = new FormData();
    fd.append('archivo', archivo);
    mutation.mutate(fd);
  };

  const handleReiniciar = () => {
    setArchivo(null);
    setResultado(null);
    setError('');
  };

  // Totales del resultado
  const totalSerial    = resultado?.serial
    ? { ins: resultado.serial.insertados, act: resultado.serial.actualizados }
    : null;
  const totalCantidad  = resultado?.cantidad
    ? { ins: resultado.cantidad.insertados, act: resultado.cantidad.actualizados }
    : null;
  const totalGlobal    = (totalSerial?.ins || 0) + (totalSerial?.act || 0)
                       + (totalCantidad?.ins || 0) + (totalCantidad?.act || 0);

  return (
    <Modal open onClose={onClose} title="Importar inventario desde Excel" size="md">
      <div className="flex flex-col gap-5">

        {/* Paso 1 — plantilla */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
          <FileSpreadsheet size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-800">Paso 1 — Descarga la plantilla</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Cada hoja con nombre de producto = seriales de ese producto.
              La hoja <strong>Productos Cantidad</strong> es para productos sin serial.
            </p>
          </div>
          <a
            href="/plantilla_inventario.xlsx"
            download
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg
              bg-white border border-blue-200 text-blue-700 text-xs font-medium
              hover:bg-blue-50 transition-colors"
          >
            <Download size={13} /> Plantilla
          </a>
        </div>

        {/* Paso 2 — subir / resultado */}
        {!resultado ? (
          <>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Paso 2 — Sube el archivo completado
              </p>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer
                  transition-colors
                  ${archivo
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => handleArchivo(e.target.files?.[0])}
                />
                <Upload size={24} className="mx-auto mb-2 text-gray-400" />
                {archivo ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileSpreadsheet size={16} className="text-blue-600" />
                    <span className="text-sm font-medium text-blue-700 truncate max-w-[200px]">
                      {archivo.name}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleReiniciar(); }}
                      className="text-gray-400 hover:text-red-500 flex-shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    Arrastra el archivo aquí o{' '}
                    <span className="text-blue-600 font-medium">haz clic para seleccionar</span>
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">Solo .xlsx · Máximo 10 MB</p>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                disabled={!archivo}
                loading={mutation.isPending}
                onClick={handleImportar}
              >
                <Upload size={15} /> Importar
              </Button>
            </div>
          </>
        ) : (
          /* ── Resultado ── */
          <div className="flex flex-col gap-3">

            {/* Resumen global */}
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3
              ${totalGlobal > 0
                ? 'bg-green-50 border border-green-100'
                : 'bg-yellow-50 border border-yellow-100'}`}
            >
              <CheckCircle size={18} className={totalGlobal > 0 ? 'text-green-600' : 'text-yellow-500'} />
              <p className="text-sm font-semibold text-gray-800">
                {totalGlobal > 0
                  ? `Importación completada — ${(totalSerial?.ins || 0) + (totalCantidad?.ins || 0)} nuevo(s), ${(totalSerial?.act || 0) + (totalCantidad?.act || 0)} actualizado(s)`
                  : 'Importación completada sin cambios'}
              </p>
            </div>

            {/* Detalle serial por producto */}
            {resultado.serial?.detalle?.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
                  Productos con Serial — {resultado.serial.detalle.length} producto(s)
                </p>
                <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto pr-1">
                  {resultado.serial.detalle.map((item, i) => (
                    <FilaProducto key={i} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Detalle cantidad */}
            <ResultadoCantidad data={resultado.cantidad} />

            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={handleReiniciar}>
                Importar otro
              </Button>
              <Button className="flex-1" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}