import { useState } from 'react';
import { Download, FileSpreadsheet, Layers, Building2, MapPin, Tags } from 'lucide-react';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import api        from '../../api/axios.config';
import { useAuth } from '../../context/useAuth';
import { exportarInventarioExcel }              from '../../utils/exportarInventarioExcel';
import { exportarInventarioPorLineas }           from '../../utils/exportarInventarioPorLineas';
import { exportarInventarioPorLineasNegocio }    from '../../utils/exportarInventarioPorLineasNegocio';

// La elección se recuerda entre exportaciones: quien exporta para hacer
// seguimiento lo hace todas las semanas y no tiene por qué volver a marcarla.
// Si el navegador bloquea el almacenamiento, se cae al default y ya.
const CLAVE_CAR = 'export_inventario_caracteristicas';
const leerPreferencia = () => {
  try { return localStorage.getItem(CLAVE_CAR) === '1'; } catch { return false; }
};
const guardarPreferencia = (v) => {
  try { localStorage.setItem(CLAVE_CAR, v ? '1' : '0'); } catch { /* sin memoria, da igual */ }
};

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

// El timeout global (30s) es para peticiones normales de pantalla. Un inventario
// grande tarda más en armarse del lado del servidor, y cortarlo a los 30s era lo
// que la clienta veía como "no se pudo exportar".
const OPCIONES_EXPORT = { timeout: 180000 };

const ALCANCES = [
  {
    id:    'sucursal',
    label: 'Esta sucursal',
    desc:  'Solo el inventario actual',
    icon:  MapPin,
  },
  {
    id:    'negocio',
    label: 'Todo el negocio',
    desc:  'Todas las sucursales',
    icon:  Building2,
  },
];

export function ModalExportarInventario({ open, onClose }) {
  const { puedeExportarInventarioGlobal } = useAuth();
  const puedeVerAlcance = puedeExportarInventarioGlobal();

  const [alcance,    setAlcance]    = useState('sucursal');
  const [modo,       setModo]       = useState('productos');
  const [exportando, setExportando] = useState(false);
  const [error,      setError]      = useState('');
  const [conCaracteristicas, setConCaracteristicas] = useState(leerPreferencia);

  const modoEfectivo = alcance === 'negocio' ? 'lineas' : modo;

  const handleExportar = async () => {
    setExportando(true);
    setError('');
    try {
      const opts = { caracteristicas: conCaracteristicas };
      if (alcance === 'negocio') {
        const { data } = await api.get('/inventario/exportar-negocio', OPCIONES_EXPORT);
        await exportarInventarioPorLineasNegocio(data.data.porLinea, data.data.configMap, opts);
      } else {
        // `modo` le dice al backend qué armar: en "líneas" se salta los cruces por
        // IMEI contra facturas y compras, que es lo que hacía eterna la consulta.
        const { data } = await api.get('/inventario/exportar', {
          ...OPCIONES_EXPORT,
          params: { modo: modoEfectivo },
        });
        const { porProducto, porLinea, cantidad, configMap } = data.data;
        if (modoEfectivo === 'productos') {
          await exportarInventarioExcel(porProducto, cantidad, configMap, opts);
        } else {
          await exportarInventarioPorLineas(porLinea, configMap, opts);
        }
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

        {/* ── Alcance (admin o usuario con permiso global) ── */}
        {puedeVerAlcance && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-700">Alcance</p>
            <div className="grid grid-cols-2 gap-2">
              {ALCANCES.map((a) => {
                const AlcanceIcon = a.icon;
                const activo = alcance === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => setAlcance(a.id)}
                    className={`flex flex-col gap-1.5 p-3 rounded-xl border-2 text-left transition-all
                      ${activo
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'}`}
                  >
                    <div className="flex items-center gap-2">
                      <AlcanceIcon size={15} className={activo ? 'text-blue-600' : 'text-gray-400'} />
                      <span className={`text-sm font-semibold ${activo ? 'text-blue-700' : 'text-gray-700'}`}>
                        {a.label}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">{a.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Modo (solo cuando alcance = sucursal) ── */}
        {alcance === 'sucursal' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-700">Modo de exportación</p>
            <div className="grid grid-cols-2 gap-2">
              {MODOS.map((m) => {
                const ModoIcon = m.icon;
                const activo = modo === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setModo(m.id)}
                    className={`flex flex-col gap-1.5 p-3 rounded-xl border-2 text-left transition-all
                      ${activo
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'}`}
                  >
                    <div className="flex items-center gap-2">
                      <ModoIcon size={15} className={activo ? 'text-blue-600' : 'text-gray-400'} />
                      <span className={`text-sm font-semibold ${activo ? 'text-blue-700' : 'text-gray-700'}`}>
                        {m.label}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">{m.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Características de los productos ── */}
        {/*
          Apagada por defecto: encendida, el Excel puede crecer bastante (una
          columna por característica y una hoja con el desglose por variante), y
          quien solo quiere ver stock no tiene por qué cargar con eso.
        */}
        <button
          type="button"
          onClick={() => {
            const v = !conCaracteristicas;
            setConCaracteristicas(v);
            guardarPreferencia(v);
          }}
          className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all
            ${conCaracteristicas
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 bg-white hover:border-gray-300'}`}
        >
          <div className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center
            ${conCaracteristicas ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
            {conCaracteristicas && (
              <svg viewBox="0 0 12 12" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <Tags size={14} className={conCaracteristicas ? 'text-blue-600' : 'text-gray-400'} />
              Incluir características
            </span>
            <span className="text-xs text-gray-400">
              Todas las de cada unidad (aunque ya no estén en Ajustes) y una hoja con
              el stock por talla, color o variante.
            </span>
          </div>
        </button>

        {/* ── Leyenda de colores ── */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Colores en el Excel
          </p>
          {alcance === 'negocio' ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {[
                { color: '#ffffff', border: true, label: 'Disponible (principal)' },
                { color: '#FED7AA',               label: 'Disponible (otra suc.)'  },
                { color: '#BFDBFE',               label: 'Prestado (principal)'    },
                { color: '#E9D5FF',               label: 'Prestado (otra suc.)'    },
                { color: '#FCA5A5',               label: 'Vendido'                 },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <div
                    className={`w-4 h-4 rounded flex-shrink-0 ${item.border ? 'border border-gray-300' : ''}`}
                    style={{ background: item.color }}
                  />
                  <span className="text-xs text-gray-600">{item.label}</span>
                </div>
              ))}
            </div>
          ) : (
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
          )}
        </div>

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
