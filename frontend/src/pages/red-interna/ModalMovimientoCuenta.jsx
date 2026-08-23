import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  registrarGastoAutorizado, registrarAjuste, getCuentasParaRemesa,
} from '../../api/redInterna.api';
import { formatCOP } from '../../utils/formatters';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Info, Receipt, Plus, Minus } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// GASTOS Y AJUSTES DE LA CUENTA INTERNA
//
// El backend soportaba las dos cosas desde julio y NINGUNA tenía pantalla: el
// resumen del local mostraba un renglón de "gastos por cuenta de la bodega" que
// era imposible de alimentar, y los únicos ajustes que existían los creaba
// sola una devolución. Esto cierra ese hueco.
//
//   GASTO   lo registra el LOCAL: pagó algo con plata de la bodega (un
//           domicilio, un repuesto). Sale de su caja YA, pero la deuda no baja
//           hasta que la bodega lo apruebe. Antes bajaba sola, así que un local
//           podía rebajarse la deuda sin que nadie se enterara.
//
//   AJUSTE  lo registra la BODEGA sobre la cuenta de un local:
//             a favor  → le abona (una garantía, un acuerdo)
//             en contra → le cobra (una rotura, un faltante)
//           Un ajuste a favor se reparte entre los envíos abiertos como
//           cualquier pago; uno en contra no cuelga de ningún envío y suma
//           aparte, porque no vino de uno.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalMovimientoCuenta({
  tipo, sucursalId, nombreLocal, onCerrar, onListo,
}) {
  const esGasto = tipo === 'gasto';
  const [valor,    setValor]    = useState('');
  const [concepto, setConcepto] = useState('');
  const [signo,    setSigno]    = useState('favor'); // solo ajustes
  const [cuentaId, setCuentaId] = useState(null);    // solo gastos
  const [error,    setError]    = useState('');

  // De DÓNDE sale la plata del gasto. Antes se asumía siempre la caja de
  // efectivo, así que un gasto pagado por Nequi o transferencia descuadraba la
  // caja física del local.
  const { data: cuentas = [] } = useQuery({
    queryKey: ['red-cuentas-remesa'],
    queryFn:  () => getCuentasParaRemesa().then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
    enabled:   esGasto,
  });
  const porDefecto = cuentas.find((c) => c.es_efectivo) || cuentas[0] || null;
  const cuenta = cuentas.find((c) => c.id === cuentaId) || porDefecto;

  const guardar = useMutation({
    mutationFn: () => {
      const monto = Number(valor);
      if (esGasto) {
        return registrarGastoAutorizado({
          valor: monto, concepto: concepto.trim(),
          cuenta_origen_id: cuenta?.id || undefined,
        });
      }
      return registrarAjuste({
        sucursal_id: sucursalId,
        valor: signo === 'contra' ? -monto : monto,
        concepto: concepto.trim(),
      });
    },
    onSuccess: (res) => {
      const d = res.data?.data;
      const n = (d?.reparto || []).length;
      onListo(esGasto
        ? 'Gasto registrado — la bodega tiene que aprobarlo para que baje tu deuda'
        : signo === 'contra' ? 'Cargo registrado en la cuenta del local'
        : (n > 1 ? `Abono registrado — cubrió ${n} envíos` : 'Abono registrado'));
    },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo registrar'),
  });

  const monto = Number(valor) || 0;
  const puede = monto > 0 && concepto.trim().length > 0;

  return (
    <Modal
      open onClose={onCerrar} size="sm"
      title={esGasto ? 'Gasto por cuenta de la bodega' : `Ajustar la cuenta de ${nombreLocal || 'este local'}`}
    >
      <div className="flex flex-col gap-4">
        {!esGasto && (
          <div className="flex gap-1.5">
            <button
              onClick={() => setSigno('favor')}
              className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all
                inline-flex items-center justify-center gap-1.5
                ${signo === 'favor' ? 'bg-green-600 border-green-600 text-white'
                                    : 'bg-white border-gray-200 text-gray-600 hover:border-green-300'}`}
            >
              <Minus size={14} /> Le abono
            </button>
            <button
              onClick={() => setSigno('contra')}
              className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all
                inline-flex items-center justify-center gap-1.5
                ${signo === 'contra' ? 'bg-red-600 border-red-600 text-white'
                                     : 'bg-white border-gray-200 text-gray-600 hover:border-red-300'}`}
            >
              <Plus size={14} /> Le cobro
            </button>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            {esGasto ? '¿Cuánto pagaste?' : '¿De cuánto es el ajuste?'}
          </label>
          <InputMoneda
            value={valor}
            onChange={(v) => { setValor(v); setError(''); }}
            autoFocus
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            {esGasto ? '¿En qué se gastó?' : '¿Por qué?'}
          </label>
          <input
            value={concepto}
            onChange={(e) => { setConcepto(e.target.value); setError(''); }}
            maxLength={200}
            placeholder={esGasto ? 'Domicilio urgente, repuesto…' : 'Garantía, equipo roto…'}
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
              placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {esGasto && cuentas.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">¿De dónde salió?</label>
            <div className="flex flex-wrap gap-1.5">
              {cuentas.map((c) => (
                <button
                  key={c.id} onClick={() => setCuentaId(c.id)}
                  className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all
                    ${cuenta?.id === c.id ? 'bg-blue-600 border-blue-600 text-white'
                                        : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300'}`}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={`rounded-xl px-4 py-3 ${
          !esGasto && signo === 'contra' ? 'bg-red-50' : 'bg-blue-50'}`}>
          <p className={`text-xs flex items-start gap-2 ${
            !esGasto && signo === 'contra' ? 'text-red-700' : 'text-blue-700'}`}>
            {esGasto ? <Receipt size={14} className="mt-0.5 flex-shrink-0" />
                     : <Info size={14} className="mt-0.5 flex-shrink-0" />}
            <span>
              {esGasto ? (
                <>Sale de <strong>{cuenta?.nombre || 'tu caja'}</strong> ahora.
                Tu deuda <strong>no baja todavía</strong>: la bodega tiene que
                aprobarlo. Cuando lo haga, esos
                {monto > 0 ? ` ${formatCOP(monto)}` : ' pesos'} se reparten entre tus
                envíos abiertos del más viejo al más nuevo.
                {cuenta && !cuenta.es_efectivo && ' No pasa por la caja física.'}</>
              ) : signo === 'contra' ? (
                <>Le SUBE la deuda al local en {monto > 0 ? formatCOP(monto) : 'ese valor'}.
                No cuelga de ningún envío: aparece como un cargo aparte.</>
              ) : (
                <>Le BAJA la deuda en {monto > 0 ? formatCOP(monto) : 'ese valor'}, repartido
                entre sus envíos abiertos. Lo que sobre le queda a favor.</>
              )}
            </span>
          </p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1" disabled={!puede}
            loading={guardar.isPending} onClick={() => guardar.mutate()}
          >
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
