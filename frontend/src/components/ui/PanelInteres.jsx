import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Percent, HandCoins, Ban, Check, PauseCircle } from 'lucide-react';
import { Button }      from './Button';
import { InputMoneda } from './InputMoneda';
import { formatCOP }   from '../../utils/formatters';
import { describirPlanCompleto, unidadPeriodo } from '../../utils/interes';
import { useAuth }     from '../../context/useAuth';

// ─────────────────────────────────────────────────────────────────────────────
// Panel de INTERÉS de un documento (crédito o préstamo).
//
// Va aparte de `PanelMora` a propósito: interés y mora son cargos distintos y
// se gestionan por separado. Es común perdonar la mora por el atraso y seguir
// cobrando el interés que sí se pactó por financiar.
//
// Todos los números llegan calculados del backend en `documento.interes`: aquí
// no se recalcula nada.
//
// Acciones:
//   · Cobrar el interés sin tocar el capital.
//   · Condonar — solo admin, con motivo y PIN.
//   · Poner / cambiar / quitar el plan.
// ─────────────────────────────────────────────────────────────────────────────

export function PanelInteres({
  documento,          // el crédito o préstamo, con su clave `interes`
  configInteres,      // useInteres()
  metodosPago = [],
  api,                // { fijarInteres, cobrarCargo, condonarCargo }
  invalidar = [],     // queryKeys a invalidar tras cada acción
}) {
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const esAdmin = usuario?.rol === 'admin_negocio';

  const [vista,  setVista]  = useState(null);  // 'cobrar' | 'condonar' | 'plan'
  const [valor,  setValor]  = useState('');
  const [metodo, setMetodo] = useState(metodosPago[0] || 'Efectivo');
  const [motivo, setMotivo] = useState('');
  const [pin,    setPin]    = useState('');
  // Condonar solo perdona lo causado hasta hoy: si el plan sigue vivo, mañana
  // vuelve a causarse. Esta casilla además apaga el plan.
  const [noCobrarMas, setNoCobrarMas] = useState(false);
  const [planId, setPlanId] = useState('');
  const [error,  setError]  = useState('');

  const interes = documento?.interes || null;

  const refrescar = () => {
    invalidar.forEach((key) => queryClient.invalidateQueries({ queryKey: key, exact: false }));
  };
  const cerrar = () => {
    setVista(null); setValor(''); setMotivo(''); setPin(''); setError('');
    setNoCobrarMas(false);
  };

  const mutCobrar = useMutation({
    mutationFn: () => api.cobrarCargo({
      valor: valor === '' ? null : Number(valor), metodo, concepto: 'interes',
    }),
    onSuccess: () => { refrescar(); cerrar(); },
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo cobrar el interés'),
  });

  const mutCondonar = useMutation({
    mutationFn: () => api.condonarCargo({
      valor: valor === '' ? null : Number(valor), motivo, pin,
      concepto: 'interes', quitar_interes: noCobrarMas,
    }),
    onSuccess: () => { refrescar(); cerrar(); },
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo condonar el interés'),
  });

  const mutPlan = useMutation({
    mutationFn: () => api.fijarInteres({ plan_id: planId || null }),
    onSuccess: () => { refrescar(); cerrar(); },
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo guardar el plan'),
  });

  // Sin la feature no se muestra nada. El return va DESPUÉS de declarar los
  // hooks: salir antes rompería el orden de hooks entre renders.
  if (!configInteres?.activa) return null;

  const planes = configInteres.planes || [];

  // ── Selector de plan, compartido por los dos estados ──────────────────────
  const selectorPlan = (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium text-gray-500">Plan de interés</span>
      <div className="flex flex-wrap gap-1.5">
        {planes.map((p) => (
          <button key={p.id} type="button" onClick={() => setPlanId(p.id)}
            className={`rounded-full border text-[11px] font-medium px-2.5 py-1 transition-colors
              ${planId === p.id
                ? 'bg-teal-50 border-teal-300 text-teal-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            {p.nombre}
          </button>
        ))}
        <button type="button" onClick={() => setPlanId('')}
          className={`rounded-full border text-[11px] font-medium px-2.5 py-1 transition-colors
            ${planId === ''
              ? 'bg-gray-100 border-gray-300 text-gray-700'
              : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}>
          sin interés
        </button>
      </div>
      {planId && (
        <span className="text-[11px] text-gray-500">
          {describirPlanCompleto(planes.find((p) => p.id === planId))}
        </span>
      )}
      {/* Es la regla que más sorprende: ponerle interés a una deuda vieja no
          cobra los meses que ya pasaron. */}
      <span className="text-[11px] text-amber-600">
        El interés empieza a correr <strong>hoy</strong>, no desde que se hizo la venta.
        No se cobra hacia atrás.
      </span>
    </div>
  );

  // ── Documento sin interés pactado ─────────────────────────────────────────
  if (!interes?.aplica) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Percent size={14} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs font-medium text-gray-600">Sin interés por financiar</span>
          </div>
          {vista !== 'plan' && (
            <button onClick={() => { setVista('plan'); setPlanId(''); setError(''); }}
              className="text-[11px] text-teal-600 hover:text-teal-700 font-medium">
              cobrar interés
            </button>
          )}
        </div>
        <span className="text-[11px] text-gray-400">
          Este documento no genera interés. Puedes ponerle un plan; correrá desde hoy.
        </span>

        {vista === 'plan' && (
          <div className="flex flex-col gap-2 bg-white rounded-lg p-2.5">
            {selectorPlan}
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" loading={mutPlan.isPending}
                disabled={!planId} onClick={() => mutPlan.mutate()}>
                Guardar plan
              </Button>
              <Button size="sm" variant="secondary" onClick={cerrar}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Documento con interés pactado ─────────────────────────────────────────
  const hayPendiente = interes.pendiente > 0;
  const detenido     = interes.detenido_por_mora;

  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2.5
      ${detenido ? 'bg-amber-50 border-amber-200' : 'bg-teal-50 border-teal-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            {detenido
              ? <PauseCircle size={14} className="text-amber-500 flex-shrink-0" />
              : <Percent size={14} className="text-teal-500 flex-shrink-0" />}
            <span className={`text-xs font-semibold ${detenido ? 'text-amber-700' : 'text-teal-700'}`}>
              {interes.condicion?.nombre || 'Interés por financiar'}
            </span>
          </div>
          <span className="text-[11px] text-gray-500">
            {describirPlanCompleto(interes.condicion)}
          </span>
        </div>
        <button onClick={() => {
          setVista('plan');
          setPlanId(interes.condicion?.id || '');
          setError('');
        }}
          className="text-[11px] text-gray-400 hover:text-gray-600 flex-shrink-0">
          cambiar
        </button>
      </div>

      {/* Por qué debe lo que debe. Sin esto el cliente solo ve una cifra. */}
      {!detenido && interes.condicion && (
        <span className="text-[11px] text-gray-500 bg-white/70 rounded-lg px-2.5 py-1.5">
          Lleva <strong>{interes.periodos_corridos}</strong>{' '}
          {unidadPeriodo(interes.condicion)}{interes.periodos_corridos === 1 ? '' : 's'} causado
          {interes.periodos_corridos === 1 ? '' : 's'}
          {interes.dias_al_siguiente != null && (
            <> · faltan <strong>{interes.dias_al_siguiente}</strong> día(s) para el siguiente</>
          )}
        </span>
      )}

      {/* El interés dejó de correr porque el documento se venció: decirlo evita
          que el vendedor crea que el cálculo se congeló por error. */}
      {detenido && (
        <span className="text-[11px] text-amber-700 bg-white/70 rounded-lg px-2.5 py-1.5">
          El interés <strong>dejó de correr</strong> el día del vencimiento. De ahí en adelante
          corre la mora, para no cobrar las dos cosas sobre la misma deuda.
        </span>
      )}

      {/* Cifras */}
      <div className="grid grid-cols-3 gap-2 bg-white/70 rounded-lg p-2">
        {[
          ['Interés causado', interes.causado],
          ['Ya cobrado',      interes.cobrado],
          ['Condonado',       interes.condonado],
        ].map(([label, v]) => (
          <div key={label} className="flex flex-col">
            <span className="text-[10px] text-gray-400">{label}</span>
            <span className="text-xs font-semibold text-gray-700">{formatCOP(v)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-white/60 pt-2">
        <span className="text-xs font-medium text-gray-600">Interés pendiente</span>
        <span className={`text-sm font-bold ${hayPendiente ? 'text-teal-700' : 'text-emerald-600'}`}>
          {formatCOP(interes.pendiente)}
        </span>
      </div>

      {/* Acciones */}
      {hayPendiente && !vista && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => { setVista('cobrar'); setError(''); }}>
            <HandCoins size={14} /> Cobrar interés
          </Button>
          {esAdmin && (
            <Button size="sm" variant="secondary" className="flex-1"
              onClick={() => { setVista('condonar'); setError(''); }}>
              <Ban size={14} /> No cobrar
            </Button>
          )}
        </div>
      )}
      {hayPendiente && !esAdmin && !vista && (
        <span className="text-[11px] text-gray-400">
          Solo el administrador puede decidir no cobrar el interés.
        </span>
      )}

      {/* Cobrar */}
      {vista === 'cobrar' && (
        <div className="flex flex-col gap-2 bg-white rounded-lg p-2.5">
          <span className="text-xs font-medium text-gray-600">Cobrar interés</span>
          <InputMoneda value={valor} onChange={setValor}
            placeholder={String(interes.pendiente)}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <span className="text-[11px] text-gray-400">
            Vacío cobra todo lo pendiente ({formatCOP(interes.pendiente)}).
          </span>
          {metodosPago.length > 0 && (
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-teal-500">
              {metodosPago.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" loading={mutCobrar.isPending}
              onClick={() => mutCobrar.mutate()}>
              <Check size={14} /> Confirmar cobro
            </Button>
            <Button size="sm" variant="secondary" onClick={cerrar}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Condonar */}
      {vista === 'condonar' && (
        <div className="flex flex-col gap-2 bg-white rounded-lg p-2.5">
          <span className="text-xs font-medium text-gray-600">No cobrar el interés</span>
          <InputMoneda value={valor} onChange={setValor}
            placeholder={String(interes.pendiente)}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <span className="text-[11px] text-gray-400">
            Vacío condona todo lo pendiente ({formatCOP(interes.pendiente)}).
          </span>
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (ej: cliente de años)"
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)}
            placeholder="PIN de administrador"
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <span className="text-[11px] text-gray-400">
            Queda registrado quién condonó, cuánto y por qué. Aparece aparte en los reportes.
          </span>

          <label className="flex items-start gap-2 cursor-pointer bg-gray-50 rounded-lg p-2">
            <input type="checkbox" checked={noCobrarMas}
              onChange={(e) => setNoCobrarMas(e.target.checked)}
              className="mt-0.5 accent-teal-600" />
            <span className="text-[11px] text-gray-600">
              <span className="font-medium">Y no volver a cobrarle interés.</span>{' '}
              Si no marcas esto, el plan sigue vivo y mañana se vuelve a causar interés.
              Marcarlo lo apaga para siempre en este documento.
            </span>
          </label>

          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" loading={mutCondonar.isPending}
              disabled={motivo.trim().length < 3 || !pin}
              onClick={() => mutCondonar.mutate()}>
              <Check size={14} /> Confirmar
            </Button>
            <Button size="sm" variant="secondary" onClick={cerrar}>Cancelar</Button>
          </div>
        </div>
      )}

      {/* Cambiar plan */}
      {vista === 'plan' && (
        <div className="flex flex-col gap-2 bg-white rounded-lg p-2.5">
          {selectorPlan}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" loading={mutPlan.isPending}
              onClick={() => mutPlan.mutate()}>
              Guardar
            </Button>
            <Button size="sm" variant="secondary" onClick={cerrar}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PanelInteres;
