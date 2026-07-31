import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, AlertTriangle, HandCoins, Ban, Check } from 'lucide-react';
import { Button }       from './Button';
import { InputMoneda }  from './InputMoneda';
import { SelectorPlazo } from './SelectorPlazo';
import { formatCOP }    from '../../utils/formatters';
import { describirCondicion, fechaLegible, estadoVisual } from '../../utils/mora';
import { useAuth }      from '../../context/useAuth';

// ─────────────────────────────────────────────────────────────────────────────
// Panel de mora de UN documento (crédito o préstamo).
//
// Todos los números llegan calculados del backend en `documento.mora`: aquí no
// se recalcula nada. Si el documento no tiene plazo, solo ofrece ponérselo
// (que es lo que permite usar la feature con la cartera vieja).
//
// Acciones:
//   · Cobrar mora sin tocar el capital.
//   · Condonar — solo admin, con motivo y PIN.
//   · Fijar / cambiar / quitar el plazo.
// ─────────────────────────────────────────────────────────────────────────────

const TONOS = {
  rojo:  'bg-red-50 border-red-200',
  ambar: 'bg-amber-50 border-amber-200',
  verde: 'bg-emerald-50 border-emerald-200',
};
const TEXTO = {
  rojo:  'text-red-700',
  ambar: 'text-amber-700',
  verde: 'text-emerald-700',
};

export function PanelMora({
  documento,          // el crédito o préstamo, con su clave `mora`
  configMora,         // useMora()
  metodosPago = [],
  api,                // { fijarPlazo, cobrarMora, condonarMora }
  invalidar = [],     // queryKeys a invalidar tras cada acción
}) {
  const { usuario } = useAuth();
  const queryClient = useQueryClient();
  const esAdmin = usuario?.rol === 'admin_negocio';

  const [vista,   setVista]   = useState(null); // 'cobrar' | 'condonar' | 'plazo'
  const [valor,   setValor]   = useState('');
  const [metodo,  setMetodo]  = useState(metodosPago[0] || 'Efectivo');
  const [motivo,  setMotivo]  = useState('');
  const [pin,     setPin]     = useState('');
  // Condonar solo perdona lo acumulado hasta hoy: si la deuda sigue vencida,
  // mañana vuelve a causarse mora. Esta casilla además quita el plazo.
  const [noCobrarMas, setNoCobrarMas] = useState(false);
  const [plazo,   setPlazo]   = useState({ fecha_limite: '', condicion_id: '' });
  const [error,   setError]   = useState('');

  const mora = documento?.mora || null;

  const refrescar = () => {
    invalidar.forEach((key) => queryClient.invalidateQueries({ queryKey: key, exact: false }));
  };

  const cerrar = () => {
    setVista(null); setValor(''); setMotivo(''); setPin(''); setError('');
    setNoCobrarMas(false);
  };

  const mutCobrar = useMutation({
    mutationFn: () => api.cobrarMora({ valor: valor === '' ? null : Number(valor), metodo }),
    onSuccess: () => { refrescar(); cerrar(); },
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo cobrar la mora'),
  });

  const mutCondonar = useMutation({
    mutationFn: () => api.condonarMora({
      valor: valor === '' ? null : Number(valor), motivo, pin,
      quitar_plazo: noCobrarMas,
    }),
    onSuccess: () => { refrescar(); cerrar(); },
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo condonar la mora'),
  });

  const mutPlazo = useMutation({
    mutationFn: () => api.fijarPlazo({
      fecha_limite: plazo.fecha_limite || null,
      condicion_id: plazo.condicion_id || null,
    }),
    onSuccess: () => { refrescar(); cerrar(); },
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo guardar el plazo'),
  });

  // Sin la feature no se muestra nada. El return va DESPUÉS de declarar los
  // hooks: salir antes rompería el orden de hooks entre renders.
  if (!configMora?.activa) return null;

  // ── Documento sin plazo ───────────────────────────────────────────────────
  // Con la feature activa pero sin plazo, se ofrece ponérselo: es lo que permite
  // usar la mora con la cartera que ya estaba abierta.
  if (!mora?.aplica) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <CalendarClock size={14} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs font-medium text-gray-600">Sin fecha límite de pago</span>
          </div>
          {vista !== 'plazo' && (
            <button onClick={() => { setVista('plazo'); setError(''); }}
              className="text-[11px] text-blue-600 hover:text-blue-700 font-medium">
              ponerle plazo
            </button>
          )}
        </div>
        <span className="text-[11px] text-gray-400">
          Este documento no genera mora. Puedes ponerle un plazo; la mora correrá desde esa fecha.
        </span>

        {vista === 'plazo' && (
          <div className="flex flex-col gap-2">
            <SelectorPlazo
              config={configMora}
              fechaLimite={plazo.fecha_limite}
              condicionId={plazo.condicion_id}
              onChange={setPlazo}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" loading={mutPlazo.isPending}
                disabled={!plazo.fecha_limite || !plazo.condicion_id}
                onClick={() => mutPlazo.mutate()}>
                Guardar plazo
              </Button>
              <Button size="sm" variant="secondary" onClick={cerrar}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Documento con plazo ───────────────────────────────────────────────────
  const est  = estadoVisual(mora);
  const tono = est?.tono || 'verde';
  const hayPendiente = mora.pendiente > 0;

  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2.5 ${TONOS[tono]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            {hayPendiente
              ? <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
              : <CalendarClock  size={14} className="text-gray-400 flex-shrink-0" />}
            <span className={`text-xs font-semibold ${TEXTO[tono]}`}>{est?.texto}</span>
          </div>
          <span className="text-[11px] text-gray-500">
            Vence el {fechaLegible(mora.fecha_limite)}
            {mora.condicion ? ` · ${describirCondicion(mora.condicion)}` : ''}
          </span>
        </div>
        <button onClick={() => {
          setVista('plazo');
          setPlazo({ fecha_limite: mora.fecha_limite || '', condicion_id: mora.condicion?.id || '' });
          setError('');
        }}
          className="text-[11px] text-gray-400 hover:text-gray-600 flex-shrink-0">
          cambiar
        </button>
      </div>

      {/* Cifras */}
      <div className="grid grid-cols-3 gap-2 bg-white/70 rounded-lg p-2">
        {[
          ['Mora causada', mora.causada],
          ['Ya cobrada',   mora.cobrada],
          ['Condonada',    mora.condonada],
        ].map(([label, v]) => (
          <div key={label} className="flex flex-col">
            <span className="text-[10px] text-gray-400">{label}</span>
            <span className="text-xs font-semibold text-gray-700">{formatCOP(v)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-white/60 pt-2">
        <span className="text-xs font-medium text-gray-600">Mora pendiente</span>
        <span className={`text-sm font-bold ${hayPendiente ? 'text-red-600' : 'text-emerald-600'}`}>
          {formatCOP(mora.pendiente)}
        </span>
      </div>

      {/* El producto ya está pagado y lo único que mantiene abierta la deuda son
          los intereses: decirlo evita que el vendedor crea que el sistema no
          cerró el documento por error. */}
      {mora.solo_falta_mora && (
        <div className="bg-white/70 rounded-lg px-2.5 py-2">
          <p className="text-[11px] text-gray-600">
            El capital ya está pagado. Al cobrar (o no cobrar) esta mora, el documento
            queda saldado.
          </p>
        </div>
      )}

      {/* Acciones */}
      {hayPendiente && !vista && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => { setVista('cobrar'); setError(''); }}>
            <HandCoins size={14} /> Cobrar mora
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
          Solo el administrador puede decidir no cobrar la mora.
        </span>
      )}

      {/* Cobrar */}
      {vista === 'cobrar' && (
        <div className="flex flex-col gap-2 bg-white rounded-lg p-2.5">
          <span className="text-xs font-medium text-gray-600">Cobrar mora</span>
          <InputMoneda value={valor} onChange={setValor}
            placeholder={String(mora.pendiente)}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-[11px] text-gray-400">
            Vacío cobra todo lo pendiente ({formatCOP(mora.pendiente)}).
          </span>
          {metodosPago.length > 0 && (
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500">
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
          <span className="text-xs font-medium text-gray-600">No cobrar la mora</span>
          <InputMoneda value={valor} onChange={setValor}
            placeholder={String(mora.pendiente)}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-[11px] text-gray-400">
            Vacío condona todo lo pendiente ({formatCOP(mora.pendiente)}).
          </span>
          <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (ej: solo se pasó un día)"
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)}
            placeholder="PIN de administrador"
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-[11px] text-gray-400">
            Queda registrado quién condonó, cuánto y por qué. Aparece aparte en los reportes.
          </span>

          {/* Condonar solo perdona lo de hoy. Si la deuda sigue vencida, mañana
              vuelve a haber mora — es la confusión más fácil de tener. */}
          <label className="flex items-start gap-2 cursor-pointer bg-gray-50 rounded-lg p-2">
            <input
              type="checkbox"
              checked={noCobrarMas}
              onChange={(e) => setNoCobrarMas(e.target.checked)}
              className="mt-0.5 accent-blue-600"
            />
            <span className="text-[11px] text-gray-600">
              <span className="font-medium">Y no volver a cobrarle mora.</span>{' '}
              Si no marcas esto, la deuda sigue vencida y mañana se vuelve a causar mora.
              Marcarlo le quita la fecha límite y apaga la mora para siempre en este documento.
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

      {/* Cambiar plazo */}
      {vista === 'plazo' && (
        <div className="flex flex-col gap-2 bg-white rounded-lg p-2.5">
          <SelectorPlazo
            config={configMora}
            fechaLimite={plazo.fecha_limite}
            condicionId={plazo.condicion_id}
            onChange={setPlazo}
            titulo="Cambiar el plazo"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" loading={mutPlazo.isPending}
              onClick={() => mutPlazo.mutate()}>
              Guardar
            </Button>
            <Button size="sm" variant="secondary" onClick={cerrar}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PanelMora;
