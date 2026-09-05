import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import {
  Upload, Download, FileSpreadsheet, Eye,
  CheckCircle, AlertTriangle, XCircle, Info, X, ChevronDown, ChevronUp
} from 'lucide-react';
import api              from '../../api/axios.config';
import useSucursalStore from '../../store/sucursalStore';
import { exportarInformeImportacion } from '../../utils/exportarInformeImportacion';

// ─────────────────────────────────────────────────────────────────────────────
// La importación se corre prácticamente UNA vez por negocio, al arrancar. El
// usuario no tiene práctica y no va a repetirla para aprendérsela. Por eso el
// flujo es de dos pasos y el peso está en el paso intermedio:
//
//   subir → VER QUÉ VA A PASAR → corregir el Excel si hace falta → confirmar
//
// El análisis corre la importación de verdad en el servidor dentro de una
// transacción que se revierte, así que lo que se muestra aquí es exactamente lo
// que va a ocurrir, no una estimación.
// ─────────────────────────────────────────────────────────────────────────────

async function descargarPlantilla() {
  const res = await api.get('/importacion/plantilla', { responseType: 'blob' });
  const url  = URL.createObjectURL(new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'plantilla_inventario.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// SUBCOMPONENTES
// ─────────────────────────────────────────────

function Metrica({ valor, etiqueta, tono = 'gris' }) {
  const tonos = {
    verde: 'bg-green-50 border-green-100 text-green-700',
    azul:  'bg-blue-50  border-blue-100  text-blue-700',
    rojo:  'bg-red-50   border-red-100   text-red-700',
    gris:  'bg-gray-50  border-gray-200  text-gray-700',
  };
  return (
    <div className={`flex-1 min-w-[92px] rounded-xl border px-3 py-2 ${tonos[tono]}`}>
      <p className="text-lg font-semibold leading-none">{valor}</p>
      <p className="text-[11px] mt-1 leading-tight opacity-80">{etiqueta}</p>
    </div>
  );
}

/** Lista colapsable de incidencias (conflictos o avisos) */
function ListaIncidencias({ titulo, items, tono, descripcion, abiertoInicial = false }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  if (!items?.length) return null;

  const esConflicto = tono === 'rojo';
  const estilos = esConflicto
    ? { caja: 'border-red-200 bg-red-50', texto: 'text-red-700', icono: 'text-red-500' }
    : { caja: 'border-amber-200 bg-amber-50', texto: 'text-amber-800', icono: 'text-amber-500' };

  return (
    <div className={`border rounded-xl overflow-hidden ${estilos.caja}`}>
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        {esConflicto
          ? <XCircle       size={15} className={`flex-shrink-0 ${estilos.icono}`} />
          : <AlertTriangle size={15} className={`flex-shrink-0 ${estilos.icono}`} />}
        <span className={`text-sm font-semibold flex-1 ${estilos.texto}`}>
          {titulo} ({items.length})
        </span>
        {abierto ? <ChevronUp size={14} className={estilos.icono} /> : <ChevronDown size={14} className={estilos.icono} />}
      </button>

      {abierto && (
        <div className="bg-white border-t border-gray-100 max-h-64 overflow-y-auto">
          {descripcion && (
            <p className="text-[11px] text-gray-500 px-3 pt-2">{descripcion}</p>
          )}
          <ul className="divide-y divide-gray-50">
            {items.map((it, i) => (
              <li key={i} className="px-3 py-2">
                <p className="text-xs text-gray-800">
                  {(it.hoja || it.fila) && (
                    <span className="font-medium text-gray-500">
                      {it.hoja ? `${it.hoja}` : ''}{it.fila ? ` · fila ${it.fila}` : ''}
                      {it.columna ? ` · ${it.columna}` : ''}
                      {' — '}
                    </span>
                  )}
                  {it.mensaje}
                </p>
                {it.sugerencia && (
                  <p className="text-[11px] text-gray-500 mt-0.5">→ {it.sugerencia}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

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

/** Referencias que se van a crear (proveedores, líneas, ubicaciones) */
function Creaciones({ informe }) {
  const prov   = informe?.proveedores_nuevos || [];
  const lineas = informe?.lineas_nuevas      || [];
  // La columna «Ubicacion» del Excel es texto, pero una ubicación es una fila
  // con identidad: el importador la crea y le cuelga el producto, así que
  // aparece en el mapa sin que nadie la asigne a mano. Se avisa antes de
  // confirmar, como los proveedores y las líneas — un estante mal escrito es
  // igual de fácil de corregir en el Excel y igual de molesto de deshacer.
  const ubis   = informe?.ubicaciones_nuevas || [];
  if (!prov.length && !lineas.length && !ubis.length) return null;

  return (
    <div className="border border-blue-100 bg-blue-50 rounded-xl px-3 py-2.5 flex gap-2">
      <Info size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
      <div className="text-xs text-blue-800 flex flex-col gap-1">
        {lineas.length > 0 && (
          <p><strong>Se crearán {lineas.length} línea(s):</strong> {lineas.join(', ')}</p>
        )}
        {prov.length > 0 && (
          <p><strong>Se crearán {prov.length} proveedor(es):</strong> {prov.join(', ')}</p>
        )}
        {ubis.length > 0 && (
          <p><strong>Se crearán {ubis.length} ubicación(es):</strong> {ubis.join(', ')}</p>
        )}
        <p className="text-blue-500">Si alguno es un error de escritura, corrígelo en el Excel antes de confirmar.</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MODAL PRINCIPAL
// ─────────────────────────────────────────────
export function ModalImportarInventario({ onClose }) {
  const queryClient    = useQueryClient();
  const inputRef       = useRef(null);
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);

  const [archivo, setArchivo] = useState(null);
  const [analisis, setAnalisis] = useState(null);   // informe del paso previo
  const [resultado, setResultado] = useState(null); // resultado ya aplicado
  const [error, setError] = useState('');
  // Cuando el archivo no tiene NADA importable el backend responde 400, pero
  // igual manda el informe explicando por qué (una hoja sin renombrar, una sin
  // columna IMEI…). Sin esto el usuario solo vería "no se encontraron datos".
  const [avisosError, setAvisosError] = useState([]);

  const params = sucursalActiva ? { sucursal_id: sucursalActiva } : undefined;

  const analizar = useMutation({
    mutationFn: (formData) =>
      api.post('/importacion/analizar', formData, { params, timeout: 120000 }),
    onSuccess: (res) => { setAnalisis(res.data.data); setAvisosError([]); },
    onError: (err) => {
      setError(err.response?.data?.error || 'Error al analizar el archivo');
      setAvisosError(err.response?.data?.informe?.avisos || []);
      setAnalisis(null);
    },
  });

  const confirmar = useMutation({
    mutationFn: (formData) =>
      api.post('/importacion/inventario', formData, { params, timeout: 120000 }),
    onSuccess: (res) => {
      setResultado(res.data.data);
      setAnalisis(null);
      queryClient.resetQueries({ queryKey: ['productos-serial'] });
      queryClient.resetQueries({ queryKey: ['productos-cantidad'] });
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al importar el archivo'),
  });

  const enProceso = analizar.isPending || confirmar.isPending;

  const handleArchivo = (file) => {
    if (!file) return;
    setArchivo(file);
    setAnalisis(null);
    setResultado(null);
    setAvisosError([]);
    setError('');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleArchivo(file);
  };

  const formData = () => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    return fd;
  };

  const handleAnalizar = () => { if (archivo) { setError(''); analizar.mutate(formData()); } };
  const handleConfirmar = () => { if (archivo) { setError(''); confirmar.mutate(formData()); } };

  const handleReiniciar = () => {
    setArchivo(null);
    setAnalisis(null);
    setResultado(null);
    setAvisosError([]);
    setError('');
  };

  const paso = resultado ? 'listo' : analisis ? 'revisar' : 'subir';

  const resumen    = analisis?.resumen  ?? resultado?.resumen;
  const informe    = analisis?.informe  ?? resultado?.informe;
  const conflictos = informe?.conflictos ?? [];
  const avisos     = informe?.avisos     ?? [];

  return (
    <Modal open onClose={onClose} title="Importar inventario desde Excel" size="md">
      <div className="flex flex-col gap-5">

        {/* Paso 1 — plantilla */}
        {paso === 'subir' && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
            <FileSpreadsheet size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-800">Paso 1 — Descarga la plantilla</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Trae tus líneas y proveedores ya cargados en la hoja <strong>Referencia</strong>,
                y las columnas que tu negocio tenga activas.
              </p>
            </div>
            <button
              onClick={descargarPlantilla}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                bg-white border border-blue-200 text-blue-700 text-xs font-medium
                hover:bg-blue-50 transition-colors"
            >
              <Download size={13} /> Plantilla
            </button>
          </div>
        )}

        {/* Paso 2 — subir */}
        {paso === 'subir' && (
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
              <p className="text-xs text-gray-500 mt-2">
                Todavía no se guarda nada: primero verás un resumen de lo que va a pasar.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <ListaIncidencias
              titulo="Por qué no se pudo importar"
              items={avisosError}
              tono="ambar"
              descripcion="Corrige esto en el Excel y vuelve a subirlo."
              abiertoInicial
            />

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                disabled={!archivo}
                loading={analizar.isPending}
                onClick={handleAnalizar}
              >
                <Eye size={15} /> Revisar antes de importar
              </Button>
            </div>
          </>
        )}

        {/* Paso 3 — revisar el informe */}
        {paso === 'revisar' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
              <Eye size={17} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-blue-900">Esto es lo que va a pasar</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Todavía no se ha guardado nada. Revisa, corrige el Excel si hace falta y vuelve a subirlo,
                  o confirma para aplicar.
                </p>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Metrica valor={resumen?.productos_nuevos ?? 0}      etiqueta="Productos nuevos"      tono="verde" />
              <Metrica valor={resumen?.productos_actualizados ?? 0} etiqueta="Reciben stock"         tono="azul" />
              <Metrica valor={resumen?.seriales_nuevos ?? 0}       etiqueta="Seriales nuevos"       tono="verde" />
              <Metrica valor={resumen?.omitidos ?? 0}              etiqueta="No se importan"
                       tono={(resumen?.omitidos ?? 0) > 0 ? 'rojo' : 'gris'} />
            </div>

            {(resumen?.unidades_sumadas ?? 0) > 0 && (
              <p className="text-xs text-gray-600 px-1">
                Se sumarán <strong>{resumen.unidades_sumadas}</strong> unidades a productos que ya existían.
              </p>
            )}

            <ListaIncidencias
              titulo="Filas que NO se importarán"
              items={conflictos}
              tono="rojo"
              descripcion="Corrige estas filas en el Excel y vuelve a subirlo. El resto sí se importa."
              abiertoInicial
            />

            <ListaIncidencias
              titulo="Revisa esto antes de confirmar"
              items={avisos}
              tono="ambar"
              descripcion="Estas filas SÍ se importan, pero el resultado puede no ser el que esperas."
            />

            <Creaciones informe={informe} />

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1 flex-wrap">
              <Button variant="secondary" className="flex-1" onClick={handleReiniciar} disabled={enProceso}>
                Cambiar archivo
              </Button>
              {(conflictos.length > 0 || avisos.length > 0) && (
                <Button
                  variant="secondary"
                  onClick={() => exportarInformeImportacion(informe, resumen)}
                  disabled={enProceso}
                >
                  <Download size={15} /> Informe
                </Button>
              )}
              <Button className="flex-1" loading={confirmar.isPending} onClick={handleConfirmar}>
                <Upload size={15} /> Confirmar e importar
              </Button>
            </div>
          </div>
        )}

        {/* Paso 4 — resultado aplicado */}
        {paso === 'listo' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-xl px-4 py-3 bg-green-50 border border-green-100">
              <CheckCircle size={18} className="text-green-600" />
              <p className="text-sm font-semibold text-gray-800">
                Importación aplicada — {(resumen?.productos_nuevos ?? 0) + (resumen?.seriales_nuevos ?? 0)} nuevo(s),{' '}
                {(resumen?.productos_actualizados ?? 0) + (resumen?.seriales_actualizados ?? 0)} actualizado(s)
              </p>
            </div>

            {(resumen?.omitidos ?? 0) > 0 && (
              <ListaIncidencias
                titulo="Filas que no se importaron"
                items={conflictos}
                tono="rojo"
                descripcion="Puedes corregirlas en el Excel e importar de nuevo: solo se agregará lo que falta."
                abiertoInicial
              />
            )}

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

            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={handleReiniciar}>
                Importar otro
              </Button>
              {(conflictos.length > 0 || avisos.length > 0) && (
                <Button variant="secondary" onClick={() => exportarInformeImportacion(informe, resumen)}>
                  <Download size={15} /> Informe
                </Button>
              )}
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
