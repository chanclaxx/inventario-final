import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HandCoins, ArrowRightLeft, Banknote, Info, ShieldAlert, PackageCheck } from 'lucide-react';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { cancelarFacturaDeSaldo } from '../../api/facturas.api';
import { verificarPin }    from '../../api/config.api';
import { useMetodosPago }  from '../../hooks/useMetodosPago';
import { formatCOP }       from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// Cancelar la factura que nació al SALDAR un préstamo.
//
// No es una venta cualquiera: cancelarla es DEVOLVER el préstamo. El equipo
// vuelve al inventario como devuelto por la persona, el préstamo queda Devuelto
// y hay que decidir qué pasa con lo que pagó (pedido del usuario, 31-oct-2026).
// Lo decide el backend (`PATCH /facturas/:id/cancelar-prestamo`); esta pantalla
// solo explica y pregunta. `info` viene de `GET /facturas/:id/prestamo-de-saldo`.
// ─────────────────────────────────────────────────────────────────────────────

function Opcion({ activa, deshabilitada, onClick, icono, titulo, children }) {
  // Con un const: sin eslint-plugin-react el uso en JSX no cuenta como referencia.
  const Icono = icono;
  return (
    <button type="button" disabled={deshabilitada} onClick={onClick}
      className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-colors
        ${deshabilitada ? 'opacity-50 cursor-not-allowed border-gray-100'
          : activa ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200 hover:border-blue-300'}`}>
      <Icono size={18} className={`flex-shrink-0 mt-0.5 ${activa ? 'text-blue-600' : 'text-gray-400'}`} />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-gray-800">{titulo}</p>
        <div className="text-xs text-gray-500">{children}</div>
      </div>
    </button>
  );
}

export function CancelarFacturaPrestamo({ factura, info, onClose, onSuccess }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();
  const [destino, setDestino] = useState(null);
  const [metodo,  setMetodo]  = useState('Efectivo');
  const [pin,     setPin]     = useState('');
  const [error,   setError]   = useState('');
  const [verificando, setVerificando] = useState(false);

  const numeroFactura = String(factura.numero ?? factura.id).padStart(6, '0');

  const mutation = useMutation({
    mutationFn: () => cancelarFacturaDeSaldo(factura.id, { destino, metodo }),
    onSuccess: () => {
      // El historial usa sus propias claves: ['facturas'] no las alcanza.
      for (const k of ['facturas', 'facturas-recientes', 'facturas-busqueda', 'prestamos',
        'productos-serial', 'productos-cantidad', 'caja', 'seriales']) {
        queryClient.invalidateQueries({ queryKey: [k], exact: false });
      }
      onSuccess?.();
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo cancelar la factura'),
  });

  // ── No se pudo identificar el préstamo: no se ofrece nada ────────────────
  if (!info.identificado) {
    return (
      <Modal open onClose={onClose} title="No se puede cancelar" size="sm">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <ShieldAlert size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              La factura #{numeroFactura} es el pago de un préstamo, pero {info.motivo || 'no se pudo identificar cuál'}
              {' '}Para no dañar el inventario ni la cuenta de la persona, no se cancela desde aquí. Contacta a soporte.
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>Entendido</Button>
        </div>
      </Modal>
    );
  }

  const { prestamo, pagado, pagado_dinero: dinero, pagado_no_dinero: noDinero,
    tiene_persona: tienePersona, deuda_otros_prestamos: deudaOtros, caja_abierta: cajaAbierta } = info;
  const sinCajaParaDevolver = dinero > 0 && !cajaAbierta;

  const handleConfirmar = async () => {
    if (!destino) { setError('Elige qué pasa con lo que pagó'); return; }
    if (!pin.trim()) { setError('Ingresa el PIN'); return; }
    setVerificando(true);
    setError('');
    try {
      const res = await verificarPin(pin.trim());
      if (!res.data.valido) { setError('PIN incorrecto'); return; }
      mutation.mutate();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al verificar el PIN. Intenta de nuevo.');
    } finally {
      setVerificando(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Cancelar factura de un préstamo" size="md">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 bg-red-50 rounded-xl p-3">
          <ShieldAlert size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-red-700">
              La factura #{numeroFactura} es el pago del préstamo #{prestamo.numero} de {prestamo.prestatario}
            </p>
            <p className="text-xs text-red-600">
              Cancelarla es <span className="font-semibold">devolver el préstamo</span>:
            </p>
            <ul className="text-xs text-red-600 list-disc pl-4 flex flex-col gap-0.5">
              <li>
                {prestamo.imei
                  ? <>El equipo <span className="font-medium">{prestamo.nombre_producto}</span> ({prestamo.imei}) vuelve al inventario como devuelto por la persona.</>
                  : <>{prestamo.cantidad} unidad(es) de <span className="font-medium">{prestamo.nombre_producto}</span> vuelven al inventario.</>}
              </li>
              <li>El préstamo #{prestamo.numero} queda <span className="font-medium">Devuelto</span> y esta factura, cancelada.</li>
              <li>La mora o el interés que se le hayan cobrado se quedan en el negocio.</li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-gray-700">
            ¿Qué pasa con lo que pagó ({formatCOP(pagado)})?
          </p>
          <Opcion activa={destino === 'saldo_a_favor'} deshabilitada={!tienePersona}
            onClick={() => setDestino('saldo_a_favor')} icono={HandCoins} titulo="Dejarlo como saldo a favor">
            {tienePersona
              ? <>Queda a favor de {prestamo.prestatario} para usarlo después en otro préstamo o compra.</>
              : <>No disponible: el préstamo no está ligado a un cliente o compañero registrado.</>}
          </Opcion>
          <Opcion activa={destino === 'reasignar'} deshabilitada={!tienePersona}
            onClick={() => setDestino('reasignar')} icono={ArrowRightLeft} titulo="Pasarlo a sus otros préstamos">
            {!tienePersona
              ? <>No disponible: el préstamo no está ligado a un cliente o compañero registrado.</>
              : deudaOtros > 0
                ? <>Abona a lo que debe en sus otros préstamos ({formatCOP(deudaOtros)}), del más viejo al más nuevo. Lo que sobre queda a favor.</>
                : <>No tiene otros préstamos activos: todo quedaría como saldo a favor.</>}
          </Opcion>
          <Opcion activa={destino === 'devolver'} deshabilitada={sinCajaParaDevolver}
            onClick={() => setDestino('devolver')} icono={Banknote} titulo="Devolverle la plata">
            {sinCajaParaDevolver
              ? <>Para devolver la plata tiene que haber una caja abierta en esta sede.</>
              : <>Se registra la salida de {formatCOP(dinero)} en la caja abierta.
                  {noDinero > 0 && <> Lo que pagó con un equipo o con saldo a favor ({formatCOP(noDinero)}) no sale de la caja: {tienePersona ? 'vuelve a su saldo a favor.' : 'no se devuelve.'}</>}</>}
          </Opcion>
        </div>

        {destino === 'devolver' && dinero > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">¿Cómo se le devuelve?</label>
            <div className="flex gap-2 flex-wrap">
              {metodosPago.map((m) => {
                const mId = m.id;
                return (
                  <button key={mId} type="button" onClick={() => setMetodo(mId)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                      ${metodo === mId ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 text-xs text-gray-500">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>Lo que ya entró a la caja no se borra de su día: queda el rastro de cada abono anulado y de esta devolución.</span>
        </div>

        <Input
          label="PIN de administrador"
          type="password"
          placeholder="••••"
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Volver</Button>
          <Button variant="danger" className="flex-1 flex items-center justify-center gap-1.5"
            loading={verificando || mutation.isPending}
            disabled={!destino || !pin.trim()}
            onClick={handleConfirmar}>
            <PackageCheck size={15} /> Devolver y cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
