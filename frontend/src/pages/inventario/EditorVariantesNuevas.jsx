import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Plus, X } from 'lucide-react';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { getTipos } from '../../api/tiposCaracteristicaApi';
import { agregarValores, hojasVariantes, errorVariantes } from '../../utils/variantesNuevas';

// ── Las variantes, en el MISMO paso en que se crea el producto ──────────────
//
// Antes: crear el producto, cerrarlo, buscarlo, abrir su árbol y agregar talla
// por talla, cada una en su modal. Aquí se eligen las características y sus
// valores, y el producto nace con todas las combinaciones de una vez (el backend
// lo hace en una sola transacción). El stock NO se pide aquí: la pantalla que
// usa este editor ya tiene, justo después, el paso de cantidad por variante —
// con su compra o su ajuste y su rastro.
//
// Controlado: el estado lo tiene quien lo usa (lo necesita para armar el
// payload) y la lógica vive en `utils/variantesNuevas.js`.

function EditorCaracteristica({ titulo, dim, tipos, onChange, onQuitar }) {
  const [texto, setTexto] = useState('');
  const tipoSel = tipos.find((t) => String(t.id) === String(dim.tipoId));
  const sugeridos = (tipoSel?.valores || []).filter((v) => !dim.valores.some((x) => x.toLowerCase() === String(v).toLowerCase()));

  const agregar = () => {
    if (!texto.trim()) return;
    onChange({ ...dim, valores: agregarValores(dim.valores, texto) });
    setTexto('');
  };

  return (
    <div className="flex flex-col gap-2 bg-white border border-gray-200 rounded-xl p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-600 flex-shrink-0">{titulo}</span>
        {tipos.length > 0 && (
          <select
            value={dim.tipoId}
            onChange={(e) => onChange({ ...dim, tipoId: e.target.value })}
            className="flex-1 min-w-0 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-400"
          >
            <option value="">Sin tipo</option>
            {tipos.map((t) => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
          </select>
        )}
        {onQuitar && (
          <button type="button" onClick={onQuitar} title="Quitar característica"
            className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50">
            <X size={13} />
          </button>
        )}
      </div>

      {dim.valores.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dim.valores.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-medium bg-green-600 text-white">
              {v}
              <button type="button" aria-label={`Quitar ${v}`}
                onClick={() => onChange({ ...dim, valores: dim.valores.filter((x) => x !== v) })}
                className="p-0.5 rounded-full hover:bg-green-700">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {sugeridos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sugeridos.map((v) => (
            <button key={v} type="button"
              onClick={() => onChange({ ...dim, valores: agregarValores(dim.valores, v) })}
              className="px-2.5 py-0.5 rounded-full text-xs font-medium border bg-gray-50 text-gray-600 border-gray-200 hover:border-green-300">
              + {v}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          type="text" value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } }}
          placeholder="Escribe y Enter (o varias separadas por coma)"
          className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-400"
        />
        <button type="button" onClick={agregar} aria-label="Agregar valor"
          className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center hover:bg-green-700 flex-shrink-0">
          <Plus size={14} className="text-white" />
        </button>
      </div>
    </div>
  );
}

export function EditorVariantesNuevas({ estado, onChange, puedeVerCosto = false, codigoActivo = false, codigoAuto = false }) {
  const { data: tiposData } = useQuery({
    queryKey: ['tipos-caracteristica'],
    queryFn:  () => getTipos().then((r) => r.data.data),
    enabled:  estado.activo,
  });
  const tipos = tiposData || [];

  const hojas = hojasVariantes(estado);
  const error = errorVariantes(estado);
  const [d1, d2] = estado.dims;

  const setDim = (i, dim) => onChange({ ...estado, dims: estado.dims.map((d, k) => (k === i ? dim : d)) });
  const setFila = (clave, campo, valor) => onChange({
    ...estado, filas: { ...estado.filas, [clave]: { ...(estado.filas[clave] || {}), [campo]: valor } },
  });

  const claseCampo = 'w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-400';

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none">
        <input
          type="checkbox" checked={estado.activo}
          onChange={(e) => onChange({ ...estado, activo: e.target.checked })}
          className="rounded border-gray-300 text-green-600 focus:ring-green-500"
        />
        <Layers size={13} className="text-gray-400" />
        Tiene variantes (talla, color…)
      </label>

      {estado.activo && (
        <>
          <EditorCaracteristica
            titulo={d2 ? 'Característica 1' : 'Variantes'}
            dim={d1} tipos={tipos}
            onChange={(dim) => setDim(0, dim)}
          />
          {d2 ? (
            <EditorCaracteristica
              titulo="Característica 2"
              dim={d2} tipos={tipos}
              onChange={(dim) => setDim(1, dim)}
              onQuitar={() => onChange({ ...estado, dims: [d1] })}
            />
          ) : (
            <button type="button"
              onClick={() => onChange({ ...estado, dims: [d1, { tipoId: '', valores: [] }] })}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium text-left">
              + Combinar con otra característica (ej. talla × color)
            </button>
          )}

          {hojas.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-gray-500">
                Se crearán <strong>{hojas.length}</strong> {hojas.length === 1 ? 'variante' : 'variantes'}.
                Precio vacío = el del producto.{codigoAuto ? ' Cada una nace con su código.' : ''}
              </p>
              <div className="max-h-56 overflow-y-auto flex flex-col gap-1 pr-0.5">
                {hojas.map((h) => {
                  const f = estado.filas[h.clave] || {};
                  return (
                    <div key={h.clave} className="flex flex-wrap items-center gap-1.5 bg-white border border-gray-100 rounded-lg px-2 py-1.5">
                      <span className="text-xs font-medium text-gray-800 w-full sm:w-28 sm:flex-shrink-0 break-words">{h.label}</span>
                      <div className="flex-1 min-w-[5.5rem]">
                        <InputMoneda value={f.precio ?? ''} onChange={(val) => setFila(h.clave, 'precio', val)}
                          placeholder="Precio" className={claseCampo} />
                      </div>
                      {puedeVerCosto && (
                        <div className="flex-1 min-w-[5.5rem]">
                          <InputMoneda value={f.costo ?? ''} onChange={(val) => setFila(h.clave, 'costo', val)}
                            placeholder="Costo" className={claseCampo} />
                        </div>
                      )}
                      {codigoActivo && (
                        <div className="flex-1 min-w-[6.5rem]">
                          <input type="text" value={f.codigo ?? ''}
                            onChange={(e) => setFila(h.clave, 'codigo', e.target.value.toUpperCase())}
                            placeholder={codigoAuto ? 'Código (automático)' : 'Código'}
                            className={claseCampo} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-amber-600">{error}</p>}
        </>
      )}
    </div>
  );
}
