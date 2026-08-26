import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Calculadora } from '../../components/ui/Calculadora';
import { formatCOP }   from '../../utils/formatters';
import { registrarAbonoTotalCredito } from '../../api/creditos.api';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { CheckCircle, ArrowRight, Calculator } from 'lucide-react';

// Simula el reparto FIFO igual que el backend, para que lo que se ve en
// pantalla sea exactamente lo que se va a registrar.
//
// El tope de cada crédito es capital + mora + interés: contar solo el capital
// haría que la pantalla rechazara un pago que el backend sí acepta.
//
// A diferencia de préstamos, aquí NO se puede ajustar el reparto a mano: el
// backend de créditos reparte siempre FIFO. Ofrecer un ajuste que no viaja
// dejaría a la pantalla prometiendo algo que no ocurre.
function simularDistribucion(creditosActivos, valorTotal) {
  let restante = valorTotal;
  return creditosActivos
    .map((c) => {
      const saldo   = Number(c.saldo_pendiente ?? (c.valor_total - c.cuota_inicial - c.total_abonado));
      const mora    = Number(c.mora?.pendiente || 0);
      const interes = Number(c.interes?.pendiente || 0);
      const debe    = Math.max(0, saldo) + mora + interes;
      if (debe <= 0 || restante <= 0) return null;
      const abono = Math.min(restante, debe);
      restante   -= abono;
      return { credito: c, abono, saldo: Math.max(0, saldo), mora, interes, saldado: abono >= debe };
    })
    .filter(Boolean);
}

const MAX_DESCRIPCION = 200;

/**
 * Pago total a los créditos de un cliente.
 *
 * `creditos` son los de la persona TAL COMO los trae la pantalla, que ya vienen
 * acotados a la sucursal activa: el reparto es por sucursal y el backend lo
 * vuelve a exigir. Un pago hecho en una sede no puede bajar la deuda de otra o
 * la cartera de cada una deja de cuadrar.
 */
export function ModalAbonoTotalCredito({ nombre, clienteId, creditos, onClose }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();

  const [valor,  setValor]  = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [descripcion, setDescripcion] = useState('');
  const [error,  setError]  = useState('');
  const [mostrarCalc, setMostrarCalc] = useState(false);

  // FIFO: del crédito más viejo al más nuevo, igual que el backend.
  const activos = useMemo(
    () => [...creditos]
      .filter((c) => c.estado === 'Activo')
      .sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en)),
    [creditos],
  );

  const totalMora    = activos.reduce((s, c) => s + Number(c.mora?.pendiente || 0), 0);
  const totalInteres = activos.reduce((s, c) => s + Number(c.interes?.pendiente || 0), 0);
  const totalPendiente = activos.reduce(
    (s, c) => s + Math.max(0, Number(c.saldo_pendiente ?? (c.valor_total - c.cuota_inicial - c.total_abonado))), 0,
  ) + totalMora + totalInteres;

  const valorNum = Number(valor) || 0;
  const distribucion = valorNum > 0 ? simularDistribucion(activos, valorNum) : [];

  const mutation = useMutation({
    mutationFn: () =>
      registrarAbonoTotalCredito(clienteId, valorNum, metodo, descripcion.trim() || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditos'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta-credito'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar el pago total'),
  });

  const handleConfirmar = () => {
    setError('');
    if (!valorNum || valorNum <= 0) return setError('El valor debe ser mayor a 0');
    if (valorNum > Math.round(totalPendiente))
      return setError(`El valor supera lo que el cliente debe en esta sucursal (${formatCOP(totalPendiente)})`);
    // El doble clic ya está bloqueado en el backend; no reenviar mientras viaja
    // evita además el mensaje de error innecesario.
    if (mutation.isPending) return;
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Pago total a créditos" size="md">
      <div className="flex flex-col gap-4">

        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-blue-500">Cliente</p>
            <p className="text-sm font-semibold text-blue-900">{nombre}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-blue-500">Debe en esta sucursal</p>
            <p className="text-base font-bold text-red-500">{formatCOP(totalPendiente)}</p>
          </div>
        </div>

        <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
          El pago se reparte desde el crédito más antiguo al más reciente, y solo
          entre los de <strong>esta sucursal</strong>.
        </p>

        {(totalMora + totalInteres) > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
            <p className="w-full text-[11px] font-medium text-blue-800">
              Además del capital, este cliente debe cargos:
            </p>
            {totalInteres > 0 && (
              <span className="text-[11px] text-teal-700">
                Interés: <strong>{formatCOP(totalInteres)}</strong>
              </span>
            )}
            {totalMora > 0 && (
              <span className="text-[11px] text-amber-700">
                Mora: <strong>{formatCOP(totalMora)}</strong>
              </span>
            )}
          </div>
        )}

        {/* Valor */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">Valor del pago total</label>
            <button
              type="button"
              onClick={() => setMostrarCalc((v) => !v)}
              className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors
                ${mostrarCalc ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}>
              <Calculator size={14} /> Calculadora
            </button>
          </div>
          <InputMoneda
            value={valor}
            onChange={setValor}
            placeholder="0"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
          {mostrarCalc && (
            <Calculadora
              valorInicial={valor}
              onAplicar={(v) => { setValor(v); setMostrarCalc(false); }}
              onCerrar={() => setMostrarCalc(false)}
            />
          )}
        </div>

        {/* Método */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex flex-wrap gap-2">
            {metodosPago.map((m) => (
              <button key={m.id} type="button" onClick={() => setMetodo(m.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                  ${metodo === m.id
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Descripción: por qué se hizo el pago. No toca el reparto. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Descripción <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            {descripcion.length > 0 && (
              <span className="text-[11px] text-gray-400">
                {descripcion.length}/{MAX_DESCRIPCION}
              </span>
            )}
          </div>
          <input
            type="text"
            value={descripcion}
            maxLength={MAX_DESCRIPCION}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: pagó la mamá, cierre de mes, acuerdo del 12 de agosto…"
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
          <p className="text-[11px] text-gray-400">
            Queda visible en el estado de cuenta, el PDF y el Excel.
          </p>
        </div>

        {/* Vista previa del reparto */}
        {distribucion.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Cómo se va a repartir
            </p>
            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
              {distribucion.map(({ credito, abono, saldo, mora, interes, saldado }) => (
                <div key={credito.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm
                    ${saldado ? 'bg-green-50 border border-green-100' : 'bg-gray-50 border border-gray-100'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-800 truncate">
                      Factura #{String(credito.factura_numero ?? credito.factura_id).padStart(6, '0')}
                    </p>
                    <p className="text-xs text-gray-400">
                      Debe: {formatCOP(saldo)}
                      {mora    > 0 && <span className="text-amber-600"> + {formatCOP(mora)} de mora</span>}
                      {interes > 0 && <span className="text-teal-700"> + {formatCOP(interes)} de interés</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <span className="text-green-600 font-semibold text-xs">
                      <ArrowRight size={11} className="inline" /> {formatCOP(abono)}
                    </span>
                    {saldado && (
                      <span className="flex items-center gap-0.5 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                        <CheckCircle size={10} /> Saldado
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs pt-1 border-t border-gray-100 text-gray-500 mt-1">
              <span>Total a pagar</span>
              <span className="font-semibold text-blue-700">{formatCOP(valorNum)}</span>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            onClick={handleConfirmar}
            disabled={!valorNum || valorNum <= 0 || mutation.isPending}
          >
            Registrar pago total
          </Button>
        </div>
      </div>
    </Modal>
  );
}
