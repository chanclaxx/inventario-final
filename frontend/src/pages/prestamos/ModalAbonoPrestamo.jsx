import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Modal }              from '../../components/ui/Modal';
import { Button }             from '../../components/ui/Button';
import { InputMoneda }        from '../../components/ui/InputMoneda';
import { formatCOP }          from '../../utils/formatters';
import { ModalImprimirFactura } from '../../components/ui/ModalImprimirFactura';
import { FacturaTermica }     from '../../components/FacturaTermica';
import { registrarAbonoPrestamo } from '../../api/prestamos.api';
import { getFacturaById }         from '../../api/facturas.api';
import { getGarantiasPorFactura } from '../../api/garantias.api';
import { useMetodosPago }         from '../../hooks/useMetodosPago';
import api from '../../api/axios.config';

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

  const [valor,      setValor]   = useState('');
  const [metodo,     setMetodo]  = useState('Efectivo');
  const [error,      setError]   = useState('');
  const [pantalla,   setPantalla]= useState('abono'); // 'abono' | 'confirmar' | 'imprimir' | 'pos'
  const [facturaId,  setFacturaId]  = useState(null);
  const [datosPos,   setDatosPos]   = useState(null); // { factura, garantias }

  const { facturaConConfig, garantias } = useFacturaSaldada(facturaId);

  const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);

  const mutation = useMutation({
    mutationFn: () => registrarAbonoPrestamo(prestamo.id, Number(valor), metodo),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],  exact: false });
      const data = res.data?.data;
      if (data?.saldado && data?.factura_id) {
        // Primero seteamos el id para que las queries arranquen inmediatamente
        setFacturaId(data.factura_id);
        // Pequeño delay para que React procese el estado antes de cambiar pantalla
        setTimeout(() => setPantalla('confirmar'), 0);
      } else {
        onClose();
      }
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar abono'),
  });

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
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Valor del abono</label>
            <InputMoneda
              value={valor}
              onChange={setValor}
              placeholder="0"
              onKeyDown={(e) => e.key === 'Enter' && handleRegistrar()}
              autoFocus
              className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
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