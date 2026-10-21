// Los gastos fijos del mes como lista de pendientes: lo que ya se pagó, lo que
// vence pronto y lo vencido. Pagarlo es un toque (el valor viene precargado y
// se puede cambiar: el recibo de la luz no llega igual todos los meses).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Repeat, Settings2 } from 'lucide-react';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import { confirmarRecurrente } from '../../../api/gastos.api';
import { invalidarReportes } from '../../../api/reportes.api';
import { formatCOP } from '../../../utils/formatters';
import { useClaveIdempotencia } from '../../../utils/claveIdempotencia';
import { ICONOS_GASTO, ICONO_POR_DEFECTO, mensajeError } from './gastosUi';

const ESTADOS = {
  vencido:    { texto: (p) => (p.dias != null ? `Vencido hace ${-p.dias} día${p.dias === -1 ? '' : 's'}` : 'Sin pagar'), cls: 'bg-red-50 text-red-700' },
  por_vencer: { texto: (p) => (p.dias === 0 ? 'Vence hoy' : `Vence en ${p.dias} día${p.dias === 1 ? '' : 's'}`), cls: 'bg-amber-50 text-amber-700' },
  pendiente:  { texto: (p) => (p.vence ? `Vence el ${Number(p.vence.slice(8))}` : 'Pendiente'), cls: 'bg-gray-100 text-gray-600' },
  pagado:     { texto: () => 'Pagado', cls: 'bg-emerald-50 text-emerald-700' },
};

function FilaPendiente({ p, mes, puedeRegistrar }) {
  const queryClient = useQueryClient();
  const clave = useClaveIdempotencia();
  const [valor, setValor] = useState(p.valor || '');
  const pagar = useMutation({
    mutationFn: () => confirmarRecurrente(p.recurrente_id, { mes, valor, clave_idempotencia: clave() }),
    onSuccess: () => invalidarReportes(queryClient),
  });
  const Icono = ICONOS_GASTO[p.categoria_icono] ?? ICONO_POR_DEFECTO;
  const est = ESTADOS[p.estado];
  const pagado = p.estado === 'pagado';

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${pagado ? 'border-emerald-100 bg-emerald-50/40' : 'border-gray-100 bg-white'}`}>
      <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white"
        style={{ backgroundColor: p.categoria_color || '#9CA3AF' }}>
        <Icono size={14} />
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${pagado ? 'text-gray-500' : 'text-gray-800'}`}>{p.nombre}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] px-1.5 py-0.5 rounded-md ${est.cls}`}>{est.texto(p)}</span>
          <span className="text-[11px] text-gray-400">{p.categoria_nombre}{p.tercero ? ` · ${p.tercero}` : ''}</span>
        </div>
        {pagar.isError && <p className="text-xs text-red-600 mt-1">{mensajeError(pagar.error)}</p>}
      </div>
      {pagado ? (
        <span className="flex items-center gap-1 text-sm font-semibold text-emerald-700 whitespace-nowrap">
          <CircleCheck size={15} /> {formatCOP(p.valor_pagado)}
        </span>
      ) : puedeRegistrar ? (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <InputMoneda value={valor} onChange={setValor}
            className="w-28 px-2 py-1.5 bg-gray-100 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="button" onClick={() => pagar.mutate()} disabled={pagar.isPending || !(Number(valor) > 0)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
            {pagar.isPending ? '…' : 'Marcar pagado'}
          </button>
        </div>
      ) : (
        <span className="text-sm text-gray-500 whitespace-nowrap">{formatCOP(p.valor)}</span>
      )}
    </div>
  );
}

export function PendientesMes({ resumen, puedeRegistrar, puedeAdministrar, onAdministrar }) {
  const { pendientes, recurrentes_resumen: rr, mes } = resumen;
  const pct = rr.total ? Math.round((rr.pagados / rr.total) * 100) : 0;
  const faltan = pendientes.filter((p) => p.estado !== 'pagado');

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Repeat size={15} className="text-indigo-500" /> Gastos fijos del mes
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {rr.total
              ? `${rr.pagados} de ${rr.total} pagados · ${formatCOP(rr.valor_pagado)} de ${formatCOP(rr.valor_esperado)}`
              : 'Lo que llega cada mes: arriendo, internet, nómina…'}
          </p>
        </div>
        {puedeAdministrar && (
          <button type="button" onClick={onAdministrar}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-100">
            <Settings2 size={13} /> Administrar
          </button>
        )}
      </div>

      {rr.total > 0 && (
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      {rr.total === 0 ? (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-3 py-3">
          {puedeAdministrar
            ? 'Agrega tus gastos fijos una vez y cada mes aparecerán aquí para marcarlos como pagados con un toque.'
            : 'El administrador todavía no ha definido gastos fijos.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {pendientes.map((p) => (
            <FilaPendiente key={`${p.recurrente_id}-${mes}-${p.estado}`} p={p} mes={mes} puedeRegistrar={puedeRegistrar} />
          ))}
        </div>
      )}
      {faltan.length > 0 && rr.total > 0 && (
        <p className="text-xs text-gray-500">
          Faltan <strong>{formatCOP(faltan.reduce((s, p) => s + p.valor, 0))}</strong> por pagar este mes.
        </p>
      )}
    </div>
  );
}
