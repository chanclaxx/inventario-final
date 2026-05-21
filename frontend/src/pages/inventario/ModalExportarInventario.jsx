import { useState } from 'react';
import { Download, ToggleLeft, ToggleRight, FileSpreadsheet, Layers } from 'lucide-react';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import api        from '../../api/axios.config';
import { exportarInventarioExcel, exportarInventarioPorLineas } from '../../utils/exportarInventarioExcel';

const MODOS = [
  {
    id:    'productos',
    label: 'Por Productos',
    desc:  'Una hoja por producto',
    icon:  FileSpreadsheet,
  },
  {
    id:    'lineas',
    label: 'Por Líneas',
    desc:  'Una hoja por línea',
    icon:  Layers,
  },
];

function Toggle({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-700">{label}</span>
      <button type="button" onClick={() => onChange(!value)} className="transition-colors">
        {value
          ? <ToggleRight size={28} className="text-blue-600" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </button>
    </div>
  );
}

export function ModalExportarInventario({ open, onClose }) {
  const [modo,             setModo]             = useState('productos');
  const [incluirCosto,     setIncluirCosto]     = useState(true);
  const [incluirPrecio,    setIncluirPrecio]    = useState(true);
  const [incluirProveedor, setIncluirProveedor] = useState(true);
  const [exportando,       setExportando]       = useState(false);
  const [error,            setError]            = useState('');

  const handleExportar = async () => {
    setExportando(true);
    setError('');
    try {
      const { data } = await api.get('/inventario/exportar');
      const { porProducto, porLinea, cantidad, configMap } = data.data;

      if (modo === 'productos') {
        exportarInventarioExcel(porProducto, cantidad, configMap);
      } else {
        exportarInventarioPorLineas(porLinea, configMap, {
          incluirCosto,
          incluirPrecio,
          incluirProveedor,
        });
      }
      onClose();
    } catch (err) {
      console.error('Error al exportar:', err);
      setError('No se pudo exportar el inventario. Intenta de nuevo.');
    } finally {
      setExportando(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Exportar inventario" size="sm">
      <div className="flex flex-col gap-5 pb-1">

        {/* Selector de modo */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-700">Modo de exportación</p>
          <div className="grid grid-cols-2 gap-2">
            {MODOS.map((m) => {
              const ModoIcon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => setModo(m.id)}
                  className={`flex flex-col gap-1.5 p-3 rounded-xl border-2 text-left transition-all
                    ${modo === m.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'}`}
                >
                  <div className="flex items-center gap-2">
                    <ModoIcon size={15} className={modo === m.id ? 'text-blue-600' : 'text-gray-400'} />
                    <span className={`text-sm font-semibold ${modo === m.id ? 'text-blue-700' : 'text-gray-700'}`}>
                      {m.label}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{m.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Opciones solo para "por líneas" */}
        {modo === 'lineas' && (
          <>
            <div className="flex flex-col gap-3 p-3 bg-gray-50 rounded-xl">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Columnas adicionales
              </p>
              <Toggle label="Precio Costo"  value={incluirCosto}     onChange={setIncluirCosto} />
              <Toggle label="Precio Venta"  value={incluirPrecio}    onChange={setIncluirPrecio} />
              <Toggle label="Proveedor"     value={incluirProveedor} onChange={setIncluirProveedor} />
            </div>

            {/* Leyenda de colores */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Colores en el Excel
              </p>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded border border-gray-300 bg-white" />
                  <span className="text-xs text-gray-600">Disponible</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded bg-blue-200" />
                  <span className="text-xs text-gray-600">Prestado</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded bg-green-100" />
                  <span className="text-xs text-gray-600">Vendido</span>
                </div>
              </div>
            </div>
          </>
        )}

        {error && (
          <p className="text-sm text-red-500 text-center">{error}</p>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={exportando}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={handleExportar} loading={exportando}>
            <Download size={15} />
            {exportando ? 'Generando...' : 'Exportar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
