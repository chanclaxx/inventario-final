import { useState }  from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, AlertTriangle, PackageX, Package, Bike, CreditCard } from 'lucide-react';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { cancelarFactura } from '../../api/facturas.api';
import { getFacturaById }  from '../../api/facturas.api';
import { verificarPin }    from '../../api/config.api';
import { getEntregas }     from '../../api/domiciliarios.api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _labelTipoRetoma = (retoma) => retoma.imei ? 'Serial / IMEI' : 'Cantidad';

// ─── Pantalla de bloqueo por domicilio pendiente ──────────────────────────────

function PantallaBloqueo({ facturaId, entrega, onClose }) {
  return (
    <Modal open onClose={onClose} title="No se puede cancelar" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-xl p-3">
          <Bike size={18} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-orange-800">
              Factura #{String(facturaId).padStart(6, '0')} tiene un domicilio activo
            </p>
            <p className="text-xs text-orange-600">
              Esta factura está asignada a{' '}
              <span className="font-semibold">{entrega.domiciliario_nombre}</span>{' '}
              y aún no ha sido entregada.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl px-4 py-3 flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Para cancelar esta factura
          </p>
          <p className="text-sm text-gray-700">
            Ve a <span className="font-semibold">Préstamos → Domiciliarios</span>, abre
            el pedido y usa el botón{' '}
            <span className="font-semibold text-red-600">Marcar como no entregado</span>.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Eso cancelará la factura, revertirá el stock y registrará la
            devolución correctamente en caja.
          </p>
        </div>

        <Button variant="secondary" onClick={onClose}>Entendido</Button>
      </div>
    </Modal>
  );
}

// ─── Pantalla de bloqueo por crédito ──────────────────────────────────────────

function PantallaBloqueoCredito({ facturaId, nombreCliente, onClose }) {
  return (
    <Modal open onClose={onClose} title="No se puede cancelar" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
          <CreditCard size={18} className="text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-yellow-800">
              Factura #{String(facturaId).padStart(6, '0')} es una venta a crédito
            </p>
            <p className="text-xs text-yellow-700">
              La factura de <span className="font-semibold">{nombreCliente}</span> está
              asociada a un crédito. No se puede cancelar directamente desde aquí
              porque podría descuadrar los abonos y el saldo del crédito.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl px-4 py-3 flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Para cancelar esta factura
          </p>
          <p className="text-sm text-gray-700">
            Ve a <span className="font-semibold">Préstamos → Créditos</span>, busca
            el crédito del cliente y usa el botón{' '}
            <span className="font-semibold text-red-600">Cancelar crédito</span>.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Eso cancelará el crédito, cancelará la factura y devolverá los productos
            al inventario de forma segura.
          </p>
        </div>

        <Button variant="secondary" onClick={onClose}>Entendido</Button>
      </div>
    </Modal>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalCancelarFactura({ factura, onClose, onSuccess }) {
  const queryClient = useQueryClient();

  const { data: detalle, isLoading: loadingDetalle } = useQuery({
    queryKey: ['factura-detalle-cancelar', factura.id],
    queryFn:  () => getFacturaById(factura.id).then((r) => r.data.data),
    staleTime: 0,
  });

  const { data: entregasData, isLoading: loadingEntrega } = useQuery({
    queryKey: ['entregas-domicilio-factura', factura.id],
    queryFn:  () => getEntregas({ factura_id: factura.id }).then((r) => r.data.data),
    staleTime: 0,
  });

  const isLoading = loadingDetalle || loadingEntrega;

  const entregaPendiente = (entregasData || []).find(
    (e) => e.factura_id === factura.id && e.estado === 'Pendiente'
  ) || null;

  const esCredito = detalle?.estado === 'Credito' || factura?.estado === 'Credito';

  const retomasEnInventario = (detalle?.retomas || []).filter(
    (r) => r.ingreso_inventario
  );
  const tieneRetomaEnInventario = retomasEnInventario.length > 0;

  const [eliminarRetoma, setEliminarRetoma] = useState(null);
  const [pin,            setPin]            = useState('');
  const [error,          setError]          = useState('');
  const [verificando,    setVerificando]    = useState(false);

  const paso = !isLoading && tieneRetomaEnInventario && eliminarRetoma === null
    ? 'decision'
    : 'pin';

  const mutation = useMutation({
    mutationFn: () => cancelarFactura(factura.id, eliminarRetoma === true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facturas'],           exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      setError(err.response?.data?.error || 'Error al cancelar la factura');
    },
  });

  const handleConfirmar = async () => {
    if (!pin.trim()) { setError('Ingresa el PIN'); return; }
    setVerificando(true);
    setError('');
    try {
      const res = await verificarPin(pin.trim());
      if (!res.data.valido) { setError('PIN incorrecto'); return; }
      mutation.mutate();
    } catch {
      setError('Error al verificar el PIN. Intenta de nuevo.');
    } finally {
      setVerificando(false);
    }
  };

  // ── Cargando ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Modal open onClose={onClose} title="Cancelar factura" size="sm">
        <Spinner className="py-10" />
      </Modal>
    );
  }

  // ── Bloqueo: factura de crédito ───────────────────────────────────────────
  if (esCredito) {
    return (
      <PantallaBloqueoCredito
        facturaId={factura.id}
        nombreCliente={factura.nombre_cliente}
        onClose={onClose}
      />
    );
  }

  // ── Bloqueo: domicilio pendiente ──────────────────────────────────────────
  if (entregaPendiente) {
    return (
      <PantallaBloqueo
        facturaId={factura.id}
        entrega={entregaPendiente}
        onClose={onClose}
      />
    );
  }

  // ── Paso 1: decisión sobre la retoma ─────────────────────────────────────
  if (paso === 'decision') {
    return (
      <Modal open onClose={onClose} title="Cancelar factura" size="sm">
        <div className="flex flex-col gap-4">

          <div className="flex items-start gap-3 bg-red-50 rounded-xl p-3">
            <ShieldAlert size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-red-700">
                Factura #{String(factura.id).padStart(6, '0')} — {factura.nombre_cliente}
              </p>
              <p className="text-xs text-red-500">
                Esta factura tiene{' '}
                {retomasEnInventario.length === 1
                  ? 'una retoma que ingresó'
                  : `${retomasEnInventario.length} retomas que ingresaron`}{' '}
                al inventario. ¿Qué deseas hacer?
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {retomasEnInventario.map((r) => {
              const retomaId = r.id;
              return (
                <div key={retomaId}
                  className="bg-purple-50 border border-purple-100 rounded-xl px-3 py-2">
                  <p className="text-xs font-medium text-purple-700 truncate">{r.descripcion}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{_labelTipoRetoma(r)}</p>
                  {r.imei && (
                    <p className="text-xs text-gray-500 font-mono">{r.imei}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setEliminarRetoma(false)}
              className="flex items-start gap-3 p-3 rounded-xl border-2 border-gray-200
                hover:border-blue-300 hover:bg-blue-50/40 transition-colors text-left"
            >
              <Package size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-gray-800">Mantener en inventario</p>
                <p className="text-xs text-gray-500">
                  La retoma permanece en el inventario aunque se cancele la factura.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setEliminarRetoma(true)}
              className="flex items-start gap-3 p-3 rounded-xl border-2 border-gray-200
                hover:border-red-300 hover:bg-red-50/40 transition-colors text-left"
            >
              <PackageX size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-gray-800">Eliminar del inventario</p>
                <p className="text-xs text-gray-500">
                  Se eliminará el serial o se reducirá el stock añadido por la retoma.
                </p>
              </div>
            </button>
          </div>

          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </Modal>
    );
  }

  // ── Paso 2: PIN de confirmación ───────────────────────────────────────────
  return (
    <Modal open onClose={onClose} title="Confirmar cancelación" size="sm">
      <div className="flex flex-col gap-4">

        <div className="flex items-start gap-3 bg-red-50 rounded-xl p-3">
          <ShieldAlert size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <p className="text-sm text-red-700">
              Cancelar factura{' '}
              <span className="font-bold">#{String(factura.id).padStart(6, '0')}</span>{' '}
              de <span className="font-bold">{factura.nombre_cliente}</span>.
            </p>
            <p className="text-xs text-red-500">
              Los productos volverán al inventario y la factura quedará cancelada.
            </p>
          </div>
        </div>

        {eliminarRetoma === true && (
          <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200
            rounded-xl px-3 py-2.5">
            <AlertTriangle size={15} className="text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-700">
              La retoma será eliminada del inventario. Esta acción no se puede deshacer.
            </p>
          </div>
        )}

        {tieneRetomaEnInventario && eliminarRetoma === false && (
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-100
            rounded-xl px-3 py-2.5">
            <Package size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              La retoma permanecerá en el inventario.
            </p>
          </div>
        )}

        <Input
          label="PIN de administrador"
          type="password"
          placeholder="••••"
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
          autoFocus
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          {tieneRetomaEnInventario ? (
            <Button variant="secondary" className="flex-1"
              onClick={() => { setEliminarRetoma(null); setPin(''); setError(''); }}>
              Atrás
            </Button>
          ) : (
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
          )}
          <Button
            variant="danger"
            className="flex-1"
            loading={verificando || mutation.isPending}
            onClick={handleConfirmar}
            disabled={!pin.trim()}
          >
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  );
}