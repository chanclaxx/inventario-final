import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Calculadora } from '../../components/ui/Calculadora';
import { formatCOP }   from '../../utils/formatters';
import { registrarAbonoTotal, modificarAbonoTotal } from '../../api/prestamos.api';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { CheckCircle, ArrowRight, Calculator, Pencil } from 'lucide-react';

// Simula la distribución FIFO igual que el backend.
//
// Cada préstamo debe capital + mora + interés, y el tope de lo que puede recibir
// es la suma de los tres. Contar solo el capital (o solo capital + mora) haría
// que la pantalla rechazara un pago que el backend sí acepta.
//
// ORDEN, decidido por el negocio: en CADA préstamo se cubre primero el producto
// y después sus cargos, y solo entonces se pasa al siguiente. Es el mismo
// reparto que hace el backend (`modo: 'capital_primero'`), para que lo que se ve
// en pantalla sea exactamente lo que se va a registrar.
//
// El Art. 1653 del Código Civil pone los intereses antes que el capital, pero
// admite pacto en contrario y este orden favorece al deudor: le baja la deuda
// antes. Es el que el negocio le explica al cliente.
const MODO_TOTAL = 'capital_primero';

const _repartir = (abono, mora, interes, saldo) => {
  const aCapital = Math.min(saldo, abono);
  const aMora    = Math.min(mora, abono - aCapital);
  const aInteres = Math.min(interes, abono - aCapital - aMora);
  return { aMora, aInteres, aCapital };
};

function simularDistribucion(prestamosActivos, valorTotal) {
  let remaining = valorTotal;
  return prestamosActivos
    .filter((p) => p.estado === 'Activo')
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .map((p) => {
      const saldo   = Number(p.valor_prestamo) - Number(p.total_abonado);
      const mora    = Number(p.mora?.pendiente || 0);
      const interes = Number(p.interes?.pendiente || 0);
      const debe    = saldo + mora + interes;
      if (debe <= 0 || remaining <= 0) return null;
      const abono = Math.min(remaining, debe);
      remaining  -= abono;
      const { aMora, aInteres, aCapital } = _repartir(abono, mora, interes, saldo);
      return { prestamo: p, abono, saldo, mora, interes, aMora, aInteres, aCapital, saldado: aCapital >= saldo };
    })
    .filter(Boolean);
}

// ─── ModalAbonoTotal ──────────────────────────────────────────────────────────
// mode: 'crear' | 'editar'
// Si mode='editar' se requieren: abonoTotalId, valorActual, metodoActual

const MAX_DESCRIPCION = 200;

export function ModalAbonoTotal({ nombre, tipo, personaId, prestamos, onClose, mode = 'crear', abonoTotalId, valorActual = '', metodoActual = 'Efectivo', descripcionActual = '' }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();

  const [valor,  setValor]  = useState(mode === 'editar' ? String(valorActual) : '');
  const [metodo, setMetodo] = useState(mode === 'editar' ? metodoActual : 'Efectivo');
  const [descripcion, setDescripcion] = useState(descripcionActual || '');
  const [error,  setError]  = useState('');
  const [mostrarCalc, setMostrarCalc] = useState(false);
  // Reparto mora/capital dentro de cada préstamo, y distribución manual entre
  // préstamos: { [prestamo_id]: valor }. `ajustada` la activa el vendedor.
  const [ajustada, setAjustada] = useState(false);
  const [manual,   setManual]   = useState({});

  // Préstamos activos en orden FIFO (más antiguo primero)
  const prestamosActivos = useMemo(
    () =>
      [...prestamos]
        .filter((p) => p.estado === 'Activo')
        .sort((a, b) => new Date(a.fecha) - new Date(b.fecha)),
    [prestamos]
  );

  // El tope incluye los cargos pendientes de cada préstamo: si solo se contara
  // el capital, un pago que cubre los intereses se rechazaría en pantalla aunque
  // el backend lo aceptara.
  const totalMora    = prestamosActivos.reduce((s, p) => s + Number(p.mora?.pendiente || 0), 0);
  const totalInteres = prestamosActivos.reduce((s, p) => s + Number(p.interes?.pendiente || 0), 0);
  const totalPendiente = prestamosActivos.reduce(
    (s, p) => s + Number(p.valor_prestamo) - Number(p.total_abonado), 0
  ) + totalMora + totalInteres;

  const valorNum = Number(valor) || 0;

  // Distribución sugerida (FIFO del más viejo). Si el vendedor la ajusta, manda
  // lo que él puso: el negocio pidió poder pactarlo con el cliente en el momento
  // del pago para evitar inconvenientes.
  const sugerida = valorNum > 0 ? simularDistribucion(prestamosActivos, valorNum) : [];
  const distribucion = ajustada
    ? prestamosActivos
        .map((p) => {
          const saldo   = Number(p.valor_prestamo) - Number(p.total_abonado);
          const mora    = Number(p.mora?.pendiente || 0);
          const interes = Number(p.interes?.pendiente || 0);
          const abono   = Math.max(0, Number(manual[p.id] ?? 0));
          const { aMora, aInteres, aCapital } = _repartir(abono, mora, interes, saldo);
          return { prestamo: p, abono, saldo, mora, interes, aMora, aInteres, aCapital, saldado: aCapital >= saldo && saldo > 0 };
        })
        .filter((d) => d.abono > 0 || d.saldo + d.mora + d.interes > 0)
    : sugerida;

  const sumaManual = ajustada
    ? prestamosActivos.reduce((s, p) => s + Math.max(0, Number(manual[p.id] ?? 0)), 0)
    : valorNum;
  const cuadra = Math.round(sumaManual) === Math.round(valorNum);

  const tipoApi = tipo === 'companero' ? 'prestatario' : 'cliente';

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'crear'
        ? registrarAbonoTotal(tipoApi, personaId, valorNum, metodo, {
            modo: MODO_TOTAL,
            descripcion: descripcion.trim() || null,
            ...(ajustada && { distribucion_manual: manual }),
          })
        : modificarAbonoTotal(abonoTotalId, valorNum, metodo, descripcion.trim() || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'],    exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],     exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar el abono total'),
  });

  const handleConfirmar = () => {
    setError('');
    if (!valorNum || valorNum <= 0) return setError('El valor debe ser mayor a 0');
    if (mode === 'crear' && valorNum > totalPendiente)
      return setError(`El valor supera el saldo total pendiente (${formatCOP(totalPendiente)})`);
    if (mode === 'editar' && valorNum >= Number(valorActual))
      return setError(`Solo puedes disminuir el valor. El pago actual es ${formatCOP(valorActual)}`);
    // El backend valida lo mismo, pero avisar aquí evita un viaje y un mensaje
    // más frío.
    if (ajustada && !cuadra) {
      return setError(
        `Lo repartido suma ${formatCOP(sumaManual)} y el pago es ${formatCOP(valorNum)}. Deben coincidir.`
      );
    }
    mutation.mutate();
  };

  /** Pasa a modo manual precargando la sugerencia FIFO, para no empezar de cero. */
  const activarAjuste = () => {
    const base = {};
    for (const d of sugerida) base[d.prestamo.id] = d.abono;
    setManual(base);
    setAjustada(true);
    setError('');
  };

  return (
    <Modal open onClose={onClose} title={mode === 'crear' ? 'Abono total' : 'Modificar abono total'} size="md">
      <div className="flex flex-col gap-4">

        {/* Persona + saldo total */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-blue-500">Persona</p>
            <p className="text-sm font-semibold text-blue-900">{nombre}</p>
          </div>
          {mode === 'crear' && (
            <div className="text-right">
              <p className="text-xs text-blue-500">Saldo total pendiente</p>
              <p className="text-base font-bold text-red-500">{formatCOP(totalPendiente)}</p>
            </div>
          )}
          {mode === 'editar' && (
            <div className="text-right">
              <p className="text-xs text-blue-500">Pago actual</p>
              <p className="text-base font-bold text-indigo-600">{formatCOP(valorActual)}</p>
            </div>
          )}
        </div>

        {/* Info de funcionamiento */}
        <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
          El pago se distribuye desde el préstamo más antiguo al más reciente.
          {mode === 'crear' && ' Puedes ajustarlo abajo si lo acordaste distinto con el cliente.'}
        </p>

        {/* Reparto mora/capital. Solo si alguno de los préstamos tiene mora. */}
        {/* Cómo se aplica el pago. No es una decisión del vendedor: el orden lo
            fijó el negocio (producto y luego intereses, préstamo por préstamo),
            así que aquí solo se explica para que sepa qué va a pasar. */}
        {(totalMora + totalInteres) > 0 && (
          <div className="flex flex-col gap-1.5 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
            <p className="text-[11px] font-medium text-blue-800">Cómo se reparte</p>
            <p className="text-[11px] text-blue-700">
              Se empieza por el préstamo más viejo: primero se paga el producto y después
              sus intereses, y recién ahí se pasa al siguiente.
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {totalInteres > 0 && (
                <span className="text-[11px] text-teal-700">
                  Interés total: <strong>{formatCOP(totalInteres)}</strong>
                </span>
              )}
              {totalMora > 0 && (
                <span className="text-[11px] text-amber-700">
                  Mora total: <strong>{formatCOP(totalMora)}</strong>
                </span>
              )}
            </div>
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
                ${mostrarCalc ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
            >
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

        {/* Descripción: por qué se hizo el pago. Texto libre, no toca el reparto. */}
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

        {/* Preview de distribución — solo en modo crear */}
        {mode === 'editar' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-700">
            Solo puedes <strong>reducir</strong> el valor del pago. El nuevo valor debe ser menor a {formatCOP(valorActual)}.
            {valorNum > 0 && valorNum < Number(valorActual) && (
              <span className="block mt-1 text-indigo-700">
                El sistema redistribuirá <strong>{formatCOP(valorNum)}</strong> desde el préstamo más antiguo al más reciente.
              </span>
            )}
          </div>
        )}

        {mode === 'crear' && distribucion.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Distribución del pago
              </p>
              {ajustada ? (
                <button type="button"
                  onClick={() => { setAjustada(false); setManual({}); setError(''); }}
                  className="text-[11px] text-gray-400 hover:text-gray-600 font-medium">
                  volver al automático
                </button>
              ) : (
                <button type="button" onClick={activarAjuste}
                  className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-medium">
                  <Pencil size={11} /> ajustar a mano
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
              {distribucion.map(({ prestamo, abono, saldo, mora, aMora, aCapital, saldado }) => (
                <div key={prestamo.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm
                    ${saldado ? 'bg-green-50 border border-green-100' : 'bg-gray-50 border border-gray-100'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-800 truncate">{prestamo.nombre_producto}</p>
                    <p className="text-xs text-gray-400">
                      Debe: {formatCOP(saldo)}
                      {mora > 0 && <span className="text-amber-600"> + {formatCOP(mora)} de mora</span>}
                    </p>
                    {abono > 0 && mora > 0 && (
                      <p className="text-[11px] text-gray-400">
                        de esto: {formatCOP(aCapital)} a capital
                        {aMora > 0 && ` · ${formatCOP(aMora)} a mora`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    {ajustada ? (
                      <InputMoneda
                        value={manual[prestamo.id] ?? 0}
                        onChange={(v) => {
                          setManual((m) => ({ ...m, [prestamo.id]: v === '' ? 0 : Number(v) }));
                          setError('');
                        }}
                        className="w-24 text-right px-2 py-1 bg-white border border-gray-200 rounded-lg
                          text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <span className="text-green-600 font-semibold text-xs">
                        <ArrowRight size={11} className="inline" /> {formatCOP(abono)}
                      </span>
                    )}
                    {saldado && (
                      <span className="flex items-center gap-0.5 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                        <CheckCircle size={10} /> Saldado
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Resumen: en modo manual avisa si no cuadra con el pago */}
            <div className={`flex justify-between text-xs pt-1 border-t mt-1
              ${ajustada && !cuadra ? 'border-red-200 text-red-500' : 'border-gray-100 text-gray-500'}`}>
              <span>{ajustada ? 'Repartido' : 'Total a pagar'}</span>
              <span className={`font-semibold ${ajustada && !cuadra ? 'text-red-600' : 'text-blue-700'}`}>
                {formatCOP(ajustada ? sumaManual : valorNum)}
                {ajustada && ` / ${formatCOP(valorNum)}`}
              </span>
            </div>
            {ajustada && !cuadra && (
              <p className="text-[11px] text-red-500">
                Falta repartir {formatCOP(Math.abs(valorNum - sumaManual))}
                {sumaManual > valorNum ? ' de menos (te pasaste del pago)' : ''}.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            loading={mutation.isPending}
            onClick={handleConfirmar}
            disabled={!valorNum || valorNum <= 0 || (ajustada && !cuadra)}
          >
            {mode === 'crear' ? 'Registrar pago total' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
