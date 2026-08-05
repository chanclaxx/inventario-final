import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Calculator, AlertTriangle, Printer } from 'lucide-react';
import { Modal }              from '../../components/ui/Modal';
import { Button }             from '../../components/ui/Button';
import { InputMoneda }        from '../../components/ui/InputMoneda';
import { Calculadora }        from '../../components/ui/Calculadora';
import { formatCOP }          from '../../utils/formatters';
import { ModalImprimirFactura } from '../../components/ui/ModalImprimirFactura';
import { FacturaTermica }     from '../../components/FacturaTermica';
import { ReciboAbono }        from '../../components/ReciboAbono';
import { registrarAbonoPrestamo, cobrarMoraPrestamo } from '../../api/prestamos.api';
import { getFacturaById }         from '../../api/facturas.api';
import { getGarantiasPorFactura } from '../../api/garantias.api';
import { useMetodosPago }         from '../../hooks/useMetodosPago';
import { MODOS_ABONO }            from '../../utils/mora';
import { MODOS_ABONO_CARGOS }     from '../../utils/interes';
import api from '../../api/axios.config';

function useConfigColores() {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
  const activo  = data?.colores_serial_activo === '1';
  const colores = (() => {
    try { return JSON.parse(data?.colores_serial_lista || '[]'); } catch { return []; }
  })();
  return { activo, colores };
}

// ─── Pantallas del flujo ──────────────────────────────────────────────────────
// 'abono'      → formulario normal de abono
// 'confirmar'  → "¿Generar factura?"
// 'imprimir'   → ModalImprimirFactura (POS o PDF)
// 'pos'        → FacturaTermica

// ─── Hook: carga factura cuando se salda ─────────────────────────────────────

function useFacturaSaldada(facturaId) {
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    enabled:  !!facturaId,
  });

  const { data: facturaData } = useQuery({
    queryKey: ['factura-detalle', facturaId],
    queryFn:  () => getFacturaById(facturaId).then((r) => r.data.data),
    enabled:  !!facturaId,
    staleTime: 0,
  });

  const { data: garantiasData = [] } = useQuery({
    queryKey: ['garantias-factura', facturaId],
    queryFn:  () => getGarantiasPorFactura(facturaId).then((r) => r.data.data),
    enabled:  !!facturaId,
    staleTime: 0,
  });

  const facturaConConfig = facturaData && configData
    ? { ...facturaData, config: configData }
    : null;

  return { facturaConConfig, garantias: garantiasData };
}

// ─── ModalAbonoPrestamo ───────────────────────────────────────────────────────

export function ModalAbonoPrestamo({ prestamo, onClose }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();
  const { activo: coloresActivo, colores } = useConfigColores();

  const [valor,      setValor]   = useState('');
  const [metodo,     setMetodo]  = useState('Efectivo');
  const [color,      setColor]   = useState('');
  const [error,      setError]   = useState('');
  const [mostrarCalc, setMostrarCalc] = useState(false);
  const [pantalla,   setPantalla]= useState('abono'); // 'abono' | 'confirmar' | 'imprimir' | 'pos'
  const [facturaId,  setFacturaId]  = useState(null);
  const [datosPos,   setDatosPos]   = useState(null); // { factura, garantias }
  // Imputación del abono cuando el préstamo tiene mora pendiente. Por defecto
  // el abono paga SOLO el producto: la mora se cobra aparte y es lo último que
  // cierra el préstamo.
  const [modo,      setModo]      = useState('solo_capital');
  const [valorMora, setValorMora] = useState('');
  const [valorInteres, setValorInteres] = useState('');
  // Datos para el recibo de abono con desglose capital/mora.
  const [datosRecibo, setDatosRecibio] = useState(null);
  // Mora que queda debiéndose cuando el abono ya cubrió todo el producto: es lo
  // único que impide cerrar el préstamo, y se ofrece cobrarla ahí mismo.
  const [moraRestante, setMoraRestante] = useState(0);

  // Config del negocio para los parámetros de la impresora térmica. Se pide
  // aquí y no dentro de useFacturaSaldada porque ese solo carga si hubo factura,
  // y el recibo del abono puede imprimirse sin que el préstamo se salde.
  const { data: configImpresion } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const { facturaConConfig, garantias } = useFacturaSaldada(facturaId);

  const saldoPendiente    = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
  const mostrarColores    = coloresActivo && !!prestamo.imei && colores.length > 0;
  const moraPendiente     = Number(prestamo.mora?.pendiente || 0);
  const interesPendiente  = Number(prestamo.interes?.pendiente || 0);
  const cargosPendientes  = moraPendiente + interesPendiente;

  const mutation = useMutation({
    mutationFn: () => registrarAbonoPrestamo(prestamo.id, Number(valor), metodo, color || null, {
      modo,
      valor_mora:    modo === 'personalizado' ? Number(valorMora || 0)    : 0,
      valor_interes: modo === 'personalizado' ? Number(valorInteres || 0) : 0,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],  exact: false });
      const data = res.data?.data;

      // Datos del recibo: se guardan aquí porque el backend es el que sabe cómo
      // quedó repartido el pago entre capital, mora e interés.
      setDatosRecibio({
        abono: {
          valor:          Number(valor),
          capital:        Number(data?.abonado_capital ?? valor),
          mora:           Number(data?.abonado_mora ?? 0),
          interes:        Number(data?.abonado_interes ?? 0),
          metodo,
          fecha:          new Date(),
          saldo_antes:    saldoPendiente,
          saldo_despues:  Math.max(0, Number(data?.valor_prestamo ?? 0) - Number(data?.total_abonado ?? 0)),
          mora_pendiente:    Number(data?.mora?.pendiente ?? 0),
          interes_pendiente: Number(data?.interes?.pendiente ?? 0),
        },
        deuda: {
          tipo: 'prestamo', numero: prestamo.numero ?? prestamo.id,
          persona: prestamo.prestatario, cedula: prestamo.cedula,
          descripcion: prestamo.nombre_producto,
          fecha_limite: data?.mora?.fecha_limite ?? prestamo.mora?.fecha_limite ?? null,
          dias_mora:    data?.mora?.dias_vencidos ?? 0,
        },
      });

      if (data?.saldado && data?.factura_id) {
        // Primero seteamos el id para que las queries arranquen inmediatamente
        setFacturaId(data.factura_id);
        // Pequeño delay para que React procese el estado antes de cambiar pantalla
        setTimeout(() => setPantalla('confirmar'), 0);
      } else if (data?.solo_falta_mora) {
        // El producto quedó pagado pero la mora sigue debiéndose: el préstamo
        // NO se cierra por eso, así que se ofrece cobrarla en el mismo paso.
        setMoraRestante(Number(data?.mora?.pendiente ?? 0));
        setPantalla('falta_mora');
      } else {
        // Si hubo mora en el pago, se ofrece el recibo con el desglose; si no,
        // el flujo queda igual que antes (se cierra sin fricción).
        if (Number(data?.abonado_mora ?? 0) > 0) setPantalla('recibo');
        else onClose();
      }
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar abono'),
  });

  // Cobro de la mora que quedó tras el abono. Es lo que cierra el préstamo y
  // dispara la factura, así que reusa el mismo flujo de impresión.
  const mutCobrarMora = useMutation({
    mutationFn: () => cobrarMoraPrestamo(prestamo.id, { valor: null, metodo }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'],     exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],      exact: false });
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['caja'],          exact: false });
      const data = res.data?.data;
      if (data?.saldado && data?.factura_id) {
        setFacturaId(data.factura_id);
        setTimeout(() => setPantalla('confirmar'), 0);
      } else {
        onClose();
      }
    },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo cobrar la mora'),
  });

  // Un préstamo solo se salda cuando NO se debe nada: producto y mora. Si este
  // abono va a cubrir el producto pero deja mora, se avisa ANTES de registrar
  // para que el vendedor sepa que el préstamo seguirá abierto (y que la factura
  // se generará al cobrar esa mora, no ahora).
  // Reparto previsto (mora -> interes -> capital), replica del backend SOLO
  // para avisar antes de registrar. El reparto real lo hace el servidor.
  const repartoPrevisto = (() => {
    const v = Number(valor || 0);
    if (v <= 0) return { a_mora: 0, a_interes: 0, a_capital: 0 };
    let aMora = 0, aInteres = 0;
    if (modo === 'solo_capital') {
      aMora = 0; aInteres = 0;
    } else if (modo === 'personalizado') {
      aMora    = Math.min(Number(valorMora || 0), moraPendiente, v);
      aInteres = Math.min(Number(valorInteres || 0), interesPendiente, v - aMora);
    } else {
      aMora    = Math.min(moraPendiente, v);
      aInteres = Math.min(interesPendiente, v - aMora);
    }
    return {
      a_mora: aMora, a_interes: aInteres,
      a_capital: Math.min(saldoPendiente, v - aMora - aInteres),
    };
  })();
  const saldariaConMora = cargosPendientes > 0
    && repartoPrevisto.a_capital >= saldoPendiente
    && (repartoPrevisto.a_mora + repartoPrevisto.a_interes) < cargosPendientes;

  // LA TRAMPA DE LA DEUDA INMORTAL. Con interes sobre el saldo y reparto en
  // cascada, un cliente que abona justo lo que costaron los intereses paga
  // todos los meses y NUNCA baja la deuda. El calculo es correcto; lo que esta
  // mal es que nadie se entere. Aqui se le dice, y se le da el monto minimo que
  // si moveria el capital.
  const noBajaLaDeuda = Number(valor || 0) > 0
    && repartoPrevisto.a_capital === 0
    && saldoPendiente > 0
    && (repartoPrevisto.a_mora + repartoPrevisto.a_interes) > 0;

  const handleRegistrar = () => {
    setError('');
    if (!valor || Number(valor) <= 0) return setError('El valor debe ser mayor a 0');
    mutation.mutate();
  };

  // ── Pantalla: formulario de abono ─────────────────────────────────────────
  if (pantalla === 'abono') {
    return (
      <Modal open onClose={onClose} title="Registrar Abono" size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400">Préstamo — {prestamo.prestatario}</p>
            <p className="text-xs text-gray-500 mt-0.5">{prestamo.nombre_producto}</p>
            {prestamo.empleado_nombre && (
              <p className="text-xs text-blue-500 mt-0.5">Empleado: {prestamo.empleado_nombre}</p>
            )}
            <div className="flex justify-between mt-2">
              <span className="text-xs text-gray-400">Saldo pendiente</span>
              <span className="text-sm font-bold text-red-500">{formatCOP(saldoPendiente)}</span>
            </div>
            {interesPendiente > 0 && (
              <div className="flex justify-between">
                <span className="text-xs text-teal-700">+ interés por financiar</span>
                <span className="text-sm font-bold text-teal-700">{formatCOP(interesPendiente)}</span>
              </div>
            )}
            {moraPendiente > 0 && (
              <div className="flex justify-between">
                <span className="text-xs text-amber-600">
                  + mora ({prestamo.mora.dias_vencidos} día{prestamo.mora.dias_vencidos === 1 ? '' : 's'} de atraso)
                </span>
                <span className="text-sm font-bold text-amber-600">{formatCOP(moraPendiente)}</span>
              </div>
            )}
            {cargosPendientes > 0 && (
              <div className="flex justify-between border-t border-gray-200 mt-1.5 pt-1.5">
                <span className="text-xs font-medium text-gray-600">Total a pagar</span>
                <span className="text-sm font-bold text-gray-800">
                  {formatCOP(saldoPendiente + cargosPendientes)}
                </span>
              </div>
            )}
          </div>

          {/* Cómo se reparte el pago. Solo aparece si hay cargos que repartir.
              Las etiquetas cambian según haya solo mora o también interés. */}
          {cargosPendientes > 0 && (() => {
            const MODOS = interesPendiente > 0 ? MODOS_ABONO_CARGOS : MODOS_ABONO;
            return (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-gray-600">¿A qué se aplica el pago?</span>
                <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                  {MODOS.map((o) => (
                    <button key={o.id} type="button" onClick={() => setModo(o.id)}
                      className={`flex-1 py-1.5 px-1 rounded-lg text-[11px] font-medium transition-all
                        ${modo === o.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-gray-400">
                  {MODOS.find((o) => o.id === modo)?.descripcion}
                </span>

                {modo === 'personalizado' && (
                  <div className="flex flex-col gap-2">
                    {moraPendiente > 0 && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-gray-500">
                          Cuánto va a la mora (debe {formatCOP(moraPendiente)})
                        </label>
                        <InputMoneda value={valorMora} onChange={setValorMora} placeholder="0"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
                            focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    )}
                    {interesPendiente > 0 && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-gray-500">
                          Cuánto va al interés (debe {formatCOP(interesPendiente)})
                        </label>
                        <InputMoneda value={valorInteres} onChange={setValorInteres} placeholder="0"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
                            focus:outline-none focus:ring-2 focus:ring-teal-500" />
                      </div>
                    )}
                  </div>
                )}

                {/* Desglose en vivo: el vendedor ve en qué se convierte el pago
                    ANTES de registrarlo, no después. */}
                {Number(valor || 0) > 0 && (
                  <div className="bg-gray-50 rounded-lg p-2 flex flex-col gap-0.5">
                    {repartoPrevisto.a_mora > 0 && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-amber-600">A la mora</span>
                        <span className="font-medium text-amber-600">{formatCOP(repartoPrevisto.a_mora)}</span>
                      </div>
                    )}
                    {repartoPrevisto.a_interes > 0 && (
                      <div className="flex justify-between text-[11px]">
                        <span className="text-teal-700">Al interés</span>
                        <span className="font-medium text-teal-700">{formatCOP(repartoPrevisto.a_interes)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-600">Baja la deuda</span>
                      <span className="font-semibold text-gray-800">{formatCOP(repartoPrevisto.a_capital)}</span>
                    </div>
                  </div>
                )}

                {noBajaLaDeuda && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                    <p className="text-[11px] text-amber-800 font-medium">
                      Este abono no baja la deuda.
                    </p>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Se va completo a los intereses, así que el cliente seguirá debiendo{' '}
                      <strong>{formatCOP(saldoPendiente)}</strong>. Para que empiece a bajar tiene
                      que abonar más de <strong>{formatCOP(cargosPendientes)}</strong>.
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Valor del abono</label>
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
              onKeyDown={(e) => e.key === 'Enter' && handleRegistrar()}
              autoFocus
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
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Método de pago</label>
            <div className="flex flex-wrap gap-2">
              {metodosPago.map((m) => {
                const mId    = m.id;
                const mLabel = m.label;
                return (
                  <button key={mId} type="button" onClick={() => setMetodo(mId)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                      ${metodo === mId
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {mLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {mostrarColores && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">
                Color del serial
                <span className="text-gray-400 font-normal ml-1">(opcional)</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {colores.map((c) => (
                  <button key={c} type="button" onClick={() => setColor(color === c ? '' : c)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                      ${color === c
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Aviso: este abono paga el producto pero deja mora, así que el
              préstamo sigue abierto hasta cobrarla */}
          {saldariaConMora && (
            <div className="flex gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-amber-800">
                  Con este pago el producto queda pagado, pero quedarán{' '}
                  {formatCOP(moraPendiente - repartoPrevisto.a_mora)} de mora
                </p>
                <p className="text-xs text-amber-700">
                  El préstamo NO queda saldado todavía: sigue abierto hasta que cobres
                  (o no cobres) esa mora. Al hacerlo se marca el equipo como vendido y
                  se genera la factura. Te lo ofrecemos en el paso siguiente.
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1" loading={mutation.isPending} onClick={handleRegistrar}>
              Registrar
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Pantalla: el producto quedó pagado pero falta la mora ─────────────────
  // El préstamo sigue abierto a propósito. Aquí se ofrece cerrarlo cobrando la
  // mora, que es el paso que además genera la factura.
  if (pantalla === 'falta_mora') {
    return (
      <Modal open onClose={onClose} title="Falta la mora" size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">
              El producto quedó pagado
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {prestamo.nombre_producto} — {prestamo.prestatario}
            </p>
          </div>

          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <span className="text-xs text-gray-500">Mora pendiente</span>
            <span className="text-base font-bold text-red-500">{formatCOP(moraRestante)}</span>
          </div>

          <p className="text-xs text-gray-500">
            El préstamo sigue abierto hasta que se cobre esta mora. Al cobrarla queda
            saldado, el equipo se marca como vendido y se genera la factura. Si prefieres
            no cobrarla, un administrador puede condonarla desde el préstamo.
          </p>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Ahora no
            </Button>
            <Button className="flex-1" loading={mutCobrarMora.isPending}
              onClick={() => { setError(''); mutCobrarMora.mutate(); }}>
              Cobrar mora ({metodo})
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Pantalla: recibo del abono con desglose capital/mora ──────────────────
  if (pantalla === 'recibo') {
    return (
      <ReciboAbono
        abono={datosRecibo?.abono}
        deuda={datosRecibo?.deuda}
        config={configImpresion}
        onClose={onClose}
      />
    );
  }

  // ── Pantalla: confirmar si genera factura ─────────────────────────────────
  if (pantalla === 'confirmar') {
    return (
      <Modal open onClose={onClose} title="Préstamo saldado" size="sm">
        <div className="flex flex-col gap-5">
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
            <p className="text-green-700 font-semibold text-sm">
              ✓ El préstamo quedó completamente saldado
            </p>
            <p className="text-green-600 text-xs mt-1">
              {prestamo.nombre_producto} — {prestamo.prestatario}
            </p>
          </div>
          {/* Si el pago incluyó mora, se ofrece el recibo con el desglose: es el
              comprobante de que los intereses se cobraron. */}
          {Number(datosRecibo?.abono?.mora || 0) > 0 && (
            <button
              onClick={() => setPantalla('recibo')}
              className="flex items-center justify-center gap-1.5 text-xs font-medium
                text-blue-600 hover:text-blue-700"
            >
              <Printer size={13} /> Imprimir recibo del abono (capital y mora)
            </button>
          )}
          <p className="text-sm text-gray-600 text-center">
            ¿Deseas generar una factura por este pago?
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              No, cerrar
            </Button>
            <Button
              className="flex-1"
              disabled={!facturaConConfig}
              loading={!facturaConConfig}
              onClick={() => {
                if (!facturaConConfig) return;
                setPantalla('imprimir');
              }}
            >
              {facturaConConfig ? 'Sí, generar factura' : 'Cargando...'}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Pantalla: selector POS / PDF ──────────────────────────────────────────
  // Doble guard: si por alguna razón facturaConConfig aún es null, no renderizar
  if (pantalla === 'imprimir') {
    if (!facturaConConfig) {
      setPantalla('confirmar');
      return null;
    }
    return (
      <ModalImprimirFactura
        open
        onClose={onClose}
        factura={facturaConConfig}
        garantias={garantias}
        onImprimirPos={(f, g) => {
          setDatosPos({ factura: f, garantias: g });
          setPantalla('pos');
        }}
      />
    );
  }

  // ── Pantalla: impresión POS térmica ───────────────────────────────────────
  if (pantalla === 'pos') {
    return (
      <FacturaTermica
        factura={datosPos.factura}
        garantias={datosPos.garantias}
        onClose={onClose}
      />
    );
  }

  return null;
}