// Lo que maneja solo el administrador: las categorías del negocio y los gastos
// fijos de la sede (las plantillas que cada mes aparecen como pendientes).
// Nada se borra: una categoría o un gasto fijo se APAGAN y dejan de ofrecerse.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import {
  getCategoriasGasto, crearCategoriaGasto, editarCategoriaGasto,
  getRecurrentes, crearRecurrente, editarRecurrente,
} from '../../../api/gastos.api';
import { invalidarReportes } from '../../../api/reportes.api';
import { useMetodosPago } from '../../../hooks/useMetodosPago';
import { Spinner } from '../../../components/ui/Spinner';
import { ICONOS_GASTO, ICONO_POR_DEFECTO, PALETA, mensajeError } from './gastosUi';

const campo = 'px-2.5 py-1.5 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white';

const SelectorTipo = ({ valor, onChange }) => (
  <select value={valor} onChange={(e) => onChange(e.target.value)} className={campo}>
    <option value="fijo">Fijo</option>
    <option value="variable">Variable</option>
  </select>
);

// ── Categorías ──────────────────────────────────────────────────────────────
function FilaCategoria({ cat, nueva = false, onListo }) {
  const queryClient = useQueryClient();
  const [c, setC] = useState(() => ({
    nombre: cat?.nombre ?? '', tipo: cat?.tipo ?? 'variable', color: cat?.color ?? PALETA[0],
    icono: cat?.icono ?? 'tag', activa: cat?.activa ?? true,
  }));
  const [verPaleta, setVerPaleta] = useState(false);
  const m = useMutation({
    mutationFn: (datos) => (nueva ? crearCategoriaGasto(datos) : editarCategoriaGasto(cat.id, datos)),
    onSuccess: () => { invalidarReportes(queryClient); onListo?.(); },
  });
  const cambiado = nueva ? c.nombre.trim() !== ''
    : c.nombre !== cat.nombre || c.tipo !== cat.tipo || c.color !== cat.color || c.icono !== cat.icono || c.activa !== cat.activa;
  const Icono = ICONOS_GASTO[c.icono] ?? ICONO_POR_DEFECTO;

  return (
    <div className={`flex flex-col gap-1.5 py-2 border-b border-gray-50 ${!c.activa ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setVerPaleta((v) => !v)} title="Color e ícono"
          className="w-8 h-8 rounded-full flex items-center justify-center text-white flex-shrink-0" style={{ backgroundColor: c.color }}>
          <Icono size={14} />
        </button>
        <input value={c.nombre} onChange={(e) => setC({ ...c, nombre: e.target.value })} maxLength={60}
          placeholder="Nombre de la categoría" className={`${campo} flex-1 min-w-0`} />
        <SelectorTipo valor={c.tipo} onChange={(t) => setC({ ...c, tipo: t })} />
        {!nueva && (
          <label className="flex items-center gap-1 text-xs text-gray-500 select-none">
            <input type="checkbox" checked={c.activa} onChange={(e) => setC({ ...c, activa: e.target.checked })} />
            Activa
          </label>
        )}
        <button type="button" disabled={!cambiado || m.isPending} onClick={() => m.mutate(c)} title="Guardar"
          className="p-1.5 rounded-lg bg-gray-900 text-white disabled:opacity-20">
          {nueva ? <Plus size={14} /> : <Check size={14} />}
        </button>
      </div>
      {verPaleta && (
        <div className="flex flex-col gap-1.5 pl-10">
          <div className="flex flex-wrap gap-1">
            {PALETA.map((col) => (
              <button key={col} type="button" onClick={() => setC({ ...c, color: col })}
                className={`w-5 h-5 rounded-full ${c.color === col ? 'ring-2 ring-offset-1 ring-gray-800' : ''}`} style={{ backgroundColor: col }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.keys(ICONOS_GASTO).map((k) => {
              const I = ICONOS_GASTO[k];
              return (
                <button key={k} type="button" onClick={() => setC({ ...c, icono: k })}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.icono === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  <I size={13} />
                </button>
              );
            })}
          </div>
        </div>
      )}
      {m.isError && <p className="text-xs text-red-600 pl-10">{mensajeError(m.error)}</p>}
    </div>
  );
}

export function ModalCategorias({ onClose }) {
  const [version, setVersion] = useState(0);
  const { data: cats, isLoading } = useQuery({
    queryKey: ['gastos', 'categorias', 'todas'],
    queryFn: () => getCategoriasGasto(true).then((r) => r.data.data),
  });
  return (
    <Modal open onClose={onClose} title="Categorías de gasto" size="xl">
      <p className="text-xs text-gray-400 mb-2">
        El tipo es el que toma un gasto nuevo de esa categoría (se puede cambiar en cada gasto).
        Apagar una categoría no toca los gastos que ya la usan.
      </p>
      {isLoading ? <Spinner className="py-8" /> : (
        <div className="flex flex-col">
          {(cats || []).map((c) => (
            <FilaCategoria key={`${c.id}-${c.nombre}-${c.tipo}-${c.color}-${c.icono}-${c.activa}`} cat={c} />
          ))}
          <p className="text-xs font-semibold text-gray-500 mt-3">Nueva categoría</p>
          <FilaCategoria key={`nueva-${version}`} nueva onListo={() => setVersion((v) => v + 1)} />
        </div>
      )}
    </Modal>
  );
}

// ── Gastos fijos (recurrentes) ──────────────────────────────────────────────
function FilaRecurrente({ rec, nueva = false, categorias, metodos, onListo }) {
  const queryClient = useQueryClient();
  const [r, setR] = useState(() => ({
    nombre: rec?.nombre ?? '', categoria_id: rec?.categoria_id ?? categorias[0]?.id ?? '',
    valor: rec?.valor ?? '', dia_pago: rec?.dia_pago ?? '', tipo: rec?.tipo ?? 'fijo',
    tercero: rec?.tercero ?? '', medio_pago: rec?.medio_pago ?? '', activo: rec?.activo ?? true,
  }));
  const m = useMutation({
    mutationFn: (d) => (nueva ? crearRecurrente(d) : editarRecurrente(rec.id, d)),
    onSuccess: () => { invalidarReportes(queryClient); onListo?.(); },
  });
  const valido = r.nombre.trim() && r.categoria_id && r.valor !== '';
  const cambiado = nueva || ['nombre', 'categoria_id', 'valor', 'tercero', 'medio_pago', 'activo']
    .some((k) => String(r[k] ?? '') !== String(rec[k] ?? ''))
    || String(r.dia_pago ?? '') !== String(rec.dia_pago ?? '');
  const set = (k, v) => setR((x) => ({ ...x, [k]: v }));

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-12 gap-1.5 items-center py-2 border-b border-gray-50 ${!r.activo ? 'opacity-50' : ''}`}>
      <input value={r.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Arriendo, Internet…" maxLength={80}
        className={`${campo} col-span-2 sm:col-span-3`} />
      <select value={r.categoria_id} onChange={(e) => set('categoria_id', Number(e.target.value))} className={`${campo} sm:col-span-3`}>
        {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      <InputMoneda value={r.valor} onChange={(v) => set('valor', v)} placeholder="Valor" className={`${campo} sm:col-span-2 text-right`} />
      <input type="number" min="1" max="31" value={r.dia_pago} onChange={(e) => set('dia_pago', e.target.value)}
        placeholder="Día" title="Día del mes en que se paga" className={`${campo} sm:col-span-1`} />
      <select value={r.medio_pago} onChange={(e) => set('medio_pago', e.target.value)} className={`${campo} sm:col-span-2`}>
        <option value="">Medio…</option>
        {metodos.map((mt) => <option key={mt.id} value={mt.id}>{mt.label}</option>)}
      </select>
      <div className="flex items-center justify-end gap-1.5 sm:col-span-1">
        {!nueva && (
          <input type="checkbox" title="Activo" checked={r.activo} onChange={(e) => set('activo', e.target.checked)} />
        )}
        <button type="button" disabled={!valido || !cambiado || m.isPending} onClick={() => m.mutate(r)} title="Guardar"
          className="p-1.5 rounded-lg bg-gray-900 text-white disabled:opacity-20">
          {nueva ? <Plus size={14} /> : <Check size={14} />}
        </button>
      </div>
      {m.isError && <p className="text-xs text-red-600 col-span-2 sm:col-span-12">{mensajeError(m.error)}</p>}
    </div>
  );
}

export function ModalRecurrentes({ categorias, onClose }) {
  const metodos = useMetodosPago();
  const [version, setVersion] = useState(0);
  const { data: recs, isLoading } = useQuery({
    queryKey: ['gastos', 'recurrentes', 'todos'],
    queryFn: () => getRecurrentes(true).then((r) => r.data.data),
  });
  return (
    <Modal open onClose={onClose} title="Gastos fijos de la sede" size="2xl">
      <p className="text-xs text-gray-400 mb-2">
        Lo que llega cada mes. Aparecen en «Gastos fijos del mes» para marcarlos como pagados;
        con el día de pago, avisan cuando están por vencer o vencidos. Apagar uno no toca lo ya pagado.
      </p>
      <div className="hidden sm:grid grid-cols-12 gap-1.5 text-[11px] font-medium text-gray-400 pb-1">
        <span className="col-span-3">Nombre</span><span className="col-span-3">Categoría</span>
        <span className="col-span-2 text-right">Valor</span><span className="col-span-1">Día</span>
        <span className="col-span-2">Medio</span><span className="col-span-1" />
      </div>
      {isLoading ? <Spinner className="py-8" /> : (
        <div className="flex flex-col">
          {(recs || []).map((r) => (
            <FilaRecurrente key={`${r.id}-${r.valor}-${r.activo}-${r.nombre}-${r.dia_pago}-${r.categoria_id}-${r.medio_pago}`}
              rec={r} categorias={categorias} metodos={metodos} />
          ))}
          <p className="text-xs font-semibold text-gray-500 mt-3">Nuevo gasto fijo</p>
          <FilaRecurrente key={`nueva-${version}`} nueva categorias={categorias} metodos={metodos}
            onListo={() => setVersion((v) => v + 1)} />
        </div>
      )}
    </Modal>
  );
}
