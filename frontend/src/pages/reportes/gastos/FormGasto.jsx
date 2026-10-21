// Registrar (o editar) un gasto en segundos: valor, categoría y listo. Todo lo
// demás —tercero, factura, IVA, retenciones, mes contable— va en «Más detalles»
// para quien lo quiera llenar. El backend vuelve a validar y calcular todo.
//
// Sin efectos que sincronicen estado: el padre REMONTA el formulario por `key`
// después de guardar, y eso limpia los campos y renueva la clave de
// idempotencia de una vez.
import { useState } from 'react';
import { ChevronDown, ChevronUp, Check } from 'lucide-react';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import { useClaveIdempotencia } from '../../../utils/claveIdempotencia';
import { useMetodosPago } from '../../../hooks/useMetodosPago';
import { formatCOP } from '../../../utils/formatters';
import {
  ICONOS_GASTO, ICONO_POR_DEFECTO, hoyBogota, sumarDias, sumarMes, nombreMes, totalCalculado,
} from './gastosUi';

const VISIBLES = 8;

const campoCls = 'w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all';

const Chip = ({ activo, onClick, children, color }) => (
  <button type="button" onClick={onClick}
    style={activo && color ? { backgroundColor: color, borderColor: color } : undefined}
    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5
      ${activo ? (color ? 'text-white shadow-sm' : 'bg-gray-900 border-gray-900 text-white')
        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
    {children}
  </button>
);

const desdeGasto = (g) => ({
  valor_total: g?.valor_total ?? '',
  categoria_id: g?.categoria_id ?? null,
  tipo: g?.tipo ?? null,
  nombre: g?.nombre ?? '',
  fecha: g?.fecha ?? hoyBogota(),
  medio_pago: g?.medio_pago ?? '',
  tercero: g?.tercero ?? '',
  numero_soporte: g?.numero_soporte ?? '',
  descripcion: g?.descripcion ?? '',
  cantidad: g?.cantidad ?? '',
  unidad: g?.unidad ?? '',
  valor_unitario: g?.valor_unitario ?? '',
  subtotal: g?.subtotal ?? '',
  iva: g?.iva ?? '',
  retenciones: g?.retenciones ?? '',
  mes_contable: g?.mes_contable ?? null,
  observaciones: g?.observaciones ?? '',
});

export function FormGasto({ categorias, inicial, onGuardar, guardando, error, compacto = false, mesVista }) {
  const metodos = useMetodosPago();
  const clave = useClaveIdempotencia();
  const [f, setF] = useState(() => desdeGasto(inicial));
  const [verTodas, setVerTodas] = useState(false);
  const [detalles, setDetalles] = useState(() => !!inicial && !!(inicial.tercero || inicial.subtotal || inicial.numero_soporte || inicial.descripcion));
  const [otraFecha, setOtraFecha] = useState(() => !!inicial && inicial.fecha !== hoyBogota() && inicial.fecha !== sumarDias(hoyBogota(), -1));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // Las más usadas primero; la elegida siempre visible.
  const ordenadas = [...categorias].sort((a, b) => (b.usos || 0) - (a.usos || 0) || a.orden - b.orden);
  const visibles = verTodas ? ordenadas : ordenadas.slice(0, VISIBLES);
  if (!verTodas && f.categoria_id && !visibles.some((c) => c.id === f.categoria_id)) {
    const elegida = ordenadas.find((c) => c.id === f.categoria_id);
    if (elegida) visibles.push(elegida);
  }
  const categoria = categorias.find((c) => c.id === f.categoria_id);
  const tipo = f.tipo ?? categoria?.tipo ?? 'variable';

  const hoy = hoyBogota();
  const ayer = sumarDias(hoy, -1);
  const mesDeFecha = (f.fecha || hoy).slice(0, 7);
  const mesContable = f.mes_contable ?? mesDeFecha;
  const calc = totalCalculado(f);
  const total = calc.total;
  const valido = !!f.categoria_id && Number(total) > 0;

  const guardar = () => {
    if (!valido || guardando) return;
    onGuardar({
      ...f,
      tipo,
      valor_total: calc.calculado ? undefined : f.valor_total,
      mes_contable: mesContable,
      clave_idempotencia: inicial ? undefined : clave(),
    });
  };

  const mesesOpciones = [sumarMes(mesDeFecha, -1), mesDeFecha, sumarMes(mesDeFecha, 1)];

  return (
    <div className="flex flex-col gap-3">
      {/* Valor: lo primero y lo más grande */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-300">$</span>
          <InputMoneda value={calc.calculado ? Math.round(total || 0) : f.valor_total}
            onChange={(v) => set('valor_total', v)}
            disabled={calc.calculado}
            onKeyDown={(e) => e.key === 'Enter' && guardar()}
            placeholder="0"
            className={`w-full pl-10 pr-4 ${compacto ? 'py-2.5 text-2xl' : 'py-3 text-3xl'} font-bold bg-gray-50 border border-gray-200 rounded-2xl text-gray-900
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all disabled:text-gray-500`} />
        </div>
        <div className="flex bg-gray-100 rounded-xl p-1 flex-shrink-0">
          {['fijo', 'variable'].map((t) => (
            <button key={t} type="button" onClick={() => set('tipo', t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${tipo === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
              {t === 'fijo' ? 'Fijo' : 'Variable'}
            </button>
          ))}
        </div>
      </div>
      {calc.calculado && (
        <p className="text-xs text-gray-500 -mt-1">Total calculado con los detalles: subtotal + IVA − retenciones.</p>
      )}

      {/* Categoría */}
      <div className="flex flex-wrap gap-1.5">
        {visibles.map((c) => {
          const Icono = ICONOS_GASTO[c.icono] ?? ICONO_POR_DEFECTO;
          return (
            <Chip key={c.id} activo={f.categoria_id === c.id} color={c.color}
              onClick={() => setF((x) => ({ ...x, categoria_id: c.id, tipo: null }))}>
              <Icono size={12} />
              {c.nombre}
            </Chip>
          );
        })}
        {ordenadas.length > VISIBLES && (
          <button type="button" onClick={() => setVerTodas((v) => !v)}
            className="px-3 py-1.5 rounded-full text-xs font-medium text-blue-600 hover:bg-blue-50">
            {verTodas ? 'Menos' : `+${ordenadas.length - VISIBLES} más`}
          </button>
        )}
      </div>

      <input value={f.nombre} onChange={(e) => set('nombre', e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && guardar()}
        placeholder={categoria ? `¿En qué? (opcional — si no, «${categoria.nombre}»)` : '¿En qué? (opcional)'}
        className={campoCls} maxLength={120} />

      {/* Fecha y medio de pago */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-400 mr-1">Fecha</span>
        <Chip activo={!otraFecha && f.fecha === hoy} onClick={() => { setOtraFecha(false); set('fecha', hoy); }}>Hoy</Chip>
        <Chip activo={!otraFecha && f.fecha === ayer} onClick={() => { setOtraFecha(false); set('fecha', ayer); }}>Ayer</Chip>
        <Chip activo={otraFecha} onClick={() => setOtraFecha(true)}>Otra</Chip>
        {otraFecha && (
          <input type="date" value={f.fecha} max="2099-12-31" onChange={(e) => set('fecha', e.target.value)}
            className="px-2 py-1 bg-gray-100 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-400 mr-1">Pagado con</span>
        {metodos.map((m) => (
          <Chip key={m.id} activo={f.medio_pago === m.id} onClick={() => set('medio_pago', f.medio_pago === m.id ? '' : m.id)}>
            {m.label}
          </Chip>
        ))}
      </div>

      {mesVista && mesContable !== mesVista && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5">
          Este gasto queda en <strong>{nombreMes(mesContable)}</strong>, no en el mes que estás viendo.
        </p>
      )}

      {/* Más detalles */}
      <button type="button" onClick={() => setDetalles((v) => !v)}
        className="self-start flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700">
        {detalles ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Más detalles (tercero, factura, IVA, retenciones, mes contable…)
      </button>
      {detalles && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-gray-50 rounded-2xl p-3">
          <label className="col-span-2 sm:col-span-2 flex flex-col gap-1 text-xs text-gray-500">Proveedor / tercero
            <input value={f.tercero} onChange={(e) => set('tercero', e.target.value)} className={campoCls} maxLength={120} placeholder="A quién se le pagó" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">N.º factura / soporte
            <input value={f.numero_soporte} onChange={(e) => set('numero_soporte', e.target.value)} className={campoCls} maxLength={60} />
          </label>
          <label className="col-span-2 sm:col-span-3 flex flex-col gap-1 text-xs text-gray-500">Descripción / concepto
            <input value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} className={campoCls} maxLength={500} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">Cantidad
            <input type="number" min="0" step="any" value={f.cantidad} onChange={(e) => set('cantidad', e.target.value)} className={campoCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">Unidad
            <input value={f.unidad} onChange={(e) => set('unidad', e.target.value)} className={campoCls} maxLength={30} placeholder="und, mes, kg…" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">Valor unitario
            <InputMoneda value={f.valor_unitario} onChange={(v) => set('valor_unitario', v)} className={campoCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">Subtotal
            <InputMoneda value={f.subtotal} onChange={(v) => set('subtotal', v)} className={campoCls}
              placeholder={f.cantidad && f.valor_unitario ? formatCOP(Number(f.cantidad) * Number(f.valor_unitario)) : '0'} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">IVA
            <InputMoneda value={f.iva} onChange={(v) => set('iva', v)} className={campoCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">Retenciones
            <InputMoneda value={f.retenciones} onChange={(v) => set('retenciones', v)} className={campoCls} />
          </label>
          <label className="col-span-2 sm:col-span-1 flex flex-col gap-1 text-xs text-gray-500">Mes contable
            <select value={mesContable} onChange={(e) => set('mes_contable', e.target.value)} className={campoCls}>
              {mesesOpciones.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs text-gray-500">Observaciones
            <input value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} className={campoCls} maxLength={1000} />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

      <button type="button" onClick={guardar} disabled={!valido || guardando}
        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold
          bg-gray-900 text-white hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        <Check size={16} />
        {guardando ? 'Guardando…' : inicial ? 'Guardar cambios'
          : valido ? `Guardar ${formatCOP(total)}${categoria ? ` en ${categoria.nombre}` : ''}` : 'Escribe el valor y elige la categoría'}
      </button>
    </div>
  );
}
