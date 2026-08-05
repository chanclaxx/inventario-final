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
  // El abono paga SIEMPRE el producto y nada más. Los intereses y la mora se
  // cobran con el botón de cobrar de la tarjeta del préstamo, donde el vendedor
  // escribe cuánto recibe. Tener dos cosas en el mismo botón era justo lo que
  // hacía que el vendedor no supiera en qué se convirtió el pago.
  const MODO_ABONO = 'solo_capital';
  // Datos para el recibo de abono con desglose capital/mora.
  const [datosRecibo, setDatosRecibio] = useState(null);
  // Cargos que quedan debiéndose cuando el abono ya cubrió todo el producto: es
  // lo único que impide cerrar el préstamo, y se ofrece cobrarlos ahí mismo.
  // Se guardan separados para poder mostrar el desglose.
  const [restante, setRestante] = useState({ mora: 0, interes: 0, total: 0 });

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
      modo: MODO_ABONO,
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
        // El producto quedó pagado pero quedan cargos: el préstamo NO se cierra
        // por eso, así que se ofrece cobrarlos en el mismo paso.
        const m = Number(data?.mora?.pendiente ?? 0);
        const i = Number(data?.interes?.pendiente ?? 0);
        setRestante({ mora: m, interes: i, total: m + i });
        setPantalla('falta_mora');
      } else {
        // Si el pago tocó algún cargo, se ofrece el recibo con el desglose; si
        // no, el flujo queda igual que antes (se cierra sin fricción).
        const toco = Number(data?.abonado_mora ?? 0) + Number(data?.abonado_interes ?? 0);
        if (toco > 0) setPantalla('recibo');
        else onClose();
      }
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar abono'),
  });

  // Cobro de la mora que quedó tras el abono. Es lo que cierra el préstamo y
  // dispara la factura, así que reusa el mismo flujo de impresión.
  const mutCobrarMora = useMutation({
    // `concepto: 'todos'` cobra mora e interés en UNA transacción del backend:
    // dos llamadas seguidas podrían dejar la deuda a medias si la segunda falla.
    mutationFn: () => cobrarMoraPrestamo(prestamo.id, { valor: null, metodo, concepto: 'todos' }),
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
    onError: (err) => setError(err.response?.data?.error || 'No se pudo cobrar'),
  });

  // Lo que este abono va a hacer. Con el abono en modo "solo producto" es
  // directo, pero se calcula igual para poder avisar ANTES de enviar si el valor
  // se pasa del saldo (el backend lo rechazaría y el vendedor perdería el tipeo).
  const seExcede = Number(valor || 0) > saldoPendiente;

  const handleRegistrar = () => {
    setError('');
    if (!valor || Number(valor) <= 0) return setError('El valor debe ser mayor a 0');
    if (seExcede) {
      return setError(
        `Este abono paga el producto, y del producto solo faltan ${formatCOP(saldoPendiente)}.`
        + (cargosPendientes > 0
          ? ` Los intereses se cobran con el botón "Cobrar" del préstamo.`
          : '')
      );
    }
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

          {/* Este botón paga el PRODUCTO. Los cargos se ven aquí solo para que
              el vendedor sepa que existen, pero se cobran con su propio botón:
              mezclarlos era lo que hacía que el pago se sintiera "mordido". */}
          {cargosPendientes > 0 && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 flex flex-col gap-1">
              <p className="text-[11px] font-medium text-blue-800">
                Este abono baja la deuda del producto
              </p>
              <p className="text-[11px] text-blue-700">
                Aparte tiene {interesPendiente > 0 && (<><strong>{formatCOP(interesPendiente)}</strong> de interés</>)}
                {interesPendiente > 0 && moraPendiente > 0 && ' y '}
                {moraPendiente > 0 && (<><strong>{formatCOP(moraPendiente)}</strong> de mora</>)}
                . Eso se cobra con el botón <strong>Cobrar</strong> de la tarjeta del préstamo,
                o al terminar de pagar el producto.
              </p>
            </div>
          )}

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
          {/* Aviso: este abono deja el producto pagado pero quedan cargos, así
              que el préstamo sigue abierto hasta cobrarlos. Se dice ANTES de
              registrar para que el vendedor no crea que el sistema falló. */}
          {cargosPendientes > 0 && Number(valor || 0) >= saldoPendiente && saldoPendiente > 0 && (
            <div className="flex gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold text-amber-800">
                  Con este pago el producto queda pagado, pero quedarán{' '}
                  {formatCOP(cargosPendientes)} de {interesPendiente > 0 && moraPendiente > 0
                    ? 'intereses y mora'
                    : interesPendiente > 0 ? 'intereses' : 'mora'}
                </p>
                <p className="text-xs text-amber-700">
                  El préstamo NO queda saldado todavía: sigue abierto hasta que lo cobres
                  (o lo condones). Al hacerlo se marca el equipo como vendido y se genera
                  la factura. Te lo ofrecemos en el paso siguiente.
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
    // El título y el botón dicen exactamente lo que falta: a veces es solo
    // interés, a veces solo mora, a veces las dos. Decir siempre "mora" era
    // mentira en dos de los tres casos — y el botón fallaba en uno.
    const soloInteres = restante.interes > 0 && restante.mora <= 0;
    const soloMora    = restante.mora > 0 && restante.interes <= 0;
    const queFalta    = soloInteres ? 'el interés' : soloMora ? 'la mora' : 'los intereses';

    return (
      <Modal open onClose={onClose} title={`Falta ${queFalta}`} size="sm">
        <div className="flex flex-col gap-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-emerald-800">
              El producto quedó pagado
            </p>
            <p className="text-xs text-emerald-700 mt-1">
              {prestamo.nombre_producto} — {prestamo.prestatario}
            </p>
          </div>

          {/* Desglose: el vendedor tiene que poder decirle al cliente de qué es
              cada peso, sobre todo si son dos cobros con causas distintas. */}
          <div className="bg-gray-50 rounded-xl px-4 py-3 flex flex-col gap-1.5">
            {restante.interes > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-teal-700">Interés por financiar</span>
                <span className="text-sm font-semibold text-teal-700">{formatCOP(restante.interes)}</span>
              </div>
            )}
            {restante.mora > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-amber-700">Mora por atraso</span>
                <span className="text-sm font-semibold text-amber-700">{formatCOP(restante.mora)}</span>
              </div>
            )}
            {restante.interes > 0 && restante.mora > 0 && (
              <div className="flex items-center justify-between border-t border-gray-200 pt-1.5 mt-0.5">
                <span className="text-xs font-medium text-gray-600">Falta por cobrar</span>
                <span className="text-base font-bold text-gray-800">{formatCOP(restante.total)}</span>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500">
            El préstamo sigue abierto hasta que se cobre esto. Al cobrarlo queda saldado,
            el equipo se marca como vendido y se genera la factura. Si prefieres no
            cobrarlo, un administrador puede condonarlo desde el préstamo.
          </p>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Ahora no
            </Button>
            <Button className="flex-1" loading={mutCobrarMora.isPending}
              onClick={() => { setError(''); mutCobrarMora.mutate(); }}>
              Cobrar {formatCOP(restante.total)}
            </Button>
          </div>
          <p className="text-[11px] text-gray-400 -mt-2 text-center">
            Se registra como {metodo}
          </p>
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