import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTraslados, getTrasladoById, revertirTraslado } from '../../api/traslados.api';
import { getSucursales } from '../../api/sucursales.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Modal }      from '../../components/ui/Modal';
import { Badge }      from '../../components/ui/Badge';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  ArrowRightLeft, ChevronLeft, Package, ShoppingBag,
  RotateCcw, AlertTriangle, CheckCircle, XCircle, Clock,
} from 'lucide-react';

// ─── Modal de confirmación para revertir ──────────────────────────────────────
function ModalRevertir({ traslado, onConfirmar, onCerrar, loading }) {
  return (
    <Modal open onClose={onCerrar} title="Revertir traslado" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="w-14 h-14 rounded-full bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
            <AlertTriangle size={26} className="text-amber-500" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-gray-900">
              Traslado #{String(traslado.id).padStart(4, '0')}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {traslado.sucursal_origen_nombre} → {traslado.sucursal_destino_nombre}
            </p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-sm text-amber-700 leading-relaxed">
            Todos los productos serán devueltos a la sucursal origen.
            Los seriales vendidos o prestados no podrán revertirse.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button className="flex-1 bg-amber-600 hover:bg-amber-700 text-white" loading={loading} onClick={onConfirmar}>
            <RotateCcw size={14} /> Revertir
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Detalle de un traslado ───────────────────────────────────────────────────
function DetalleTraslado({ trasladoId, onVolver }) {
  const queryClient = useQueryClient();
  const [modalRevertir, setModalRevertir] = useState(false);
  const [error, setError]                 = useState('');

  const { data: detalle, isLoading } = useQuery({
    queryKey: ['traslado', trasladoId],
    queryFn:  () => getTrasladoById(trasladoId).then((r) => r.data.data),
    enabled:  !!trasladoId,
  });

  const mutRevertir = useMutation({
    mutationFn: () => revertirTraslado(trasladoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['traslados'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['traslado', trasladoId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],     exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],   exact: false });
      setModalRevertir(false);
      setError('');
    },
    onError: (err) => {
      setModalRevertir(false);
      setError(err.response?.data?.error || 'Error al revertir el traslado');
    },
  });

  if (isLoading) return <Spinner className="py-20" />;
  if (!detalle) return <EmptyState icon={ArrowRightLeft} titulo="Traslado no encontrado" />;

  const esCancelado = detalle.estado === 'Cancelado';
  const lineas      = detalle.lineas || [];

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onVolver}
        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors w-fit">
        <ChevronLeft size={16} /> Volver al historial
      </button>

      {/* Cabecera */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900">
                Traslado #{String(detalle.id).padStart(4, '0')}
              </h2>
              <Badge variant={esCancelado ? 'red' : 'green'}>
                {esCancelado ? 'Revertido' : 'Completado'}
              </Badge>
            </div>
            <p className="text-sm text-gray-400 mt-1">{formatFechaHora(detalle.fecha)}</p>
            {detalle.usuario_nombre && (
              <p className="text-xs text-gray-400 mt-0.5">Por: {detalle.usuario_nombre}</p>
            )}
          </div>
          {!esCancelado && (
            <Button variant="secondary" onClick={() => setModalRevertir(true)}>
              <RotateCcw size={14} /> Revertir
            </Button>
          )}
        </div>

        {/* Flujo visual */}
        <div className="flex items-center gap-3 mt-4 bg-gray-50 rounded-xl px-4 py-3">
          <div className="flex-1 text-center">
            <p className="text-xs text-gray-400">Origen</p>
            <p className="text-sm font-semibold text-gray-800">{detalle.sucursal_origen_nombre}</p>
          </div>
          <ArrowRightLeft size={18} className={esCancelado ? 'text-red-300' : 'text-blue-400'} />
          <div className="flex-1 text-center">
            <p className="text-xs text-gray-400">Destino</p>
            <p className="text-sm font-semibold text-gray-800">{detalle.sucursal_destino_nombre}</p>
          </div>
        </div>

        {detalle.notas && (
          <p className="text-sm text-gray-500 mt-3 bg-gray-50 rounded-xl px-3 py-2">
            {detalle.notas}
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Líneas */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-gray-600">
          Productos trasladados ({lineas.length})
        </h3>
        {lineas.map((linea) => {
          const esSerial = linea.tipo === 'serial';
          const LineaIcon = esSerial ? Package : ShoppingBag;
          return (
            <div key={linea.id}
              className={`bg-white border rounded-xl p-4 flex items-center gap-3 transition-all
                ${esCancelado ? 'border-red-100 bg-red-50/20 opacity-70' : 'border-gray-100'}`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
                ${esSerial ? 'bg-blue-50' : 'bg-green-50'}`}>
                <LineaIcon size={16} className={esSerial ? 'text-blue-500' : 'text-green-500'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${esCancelado ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                  {linea.nombre_producto}
                </p>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  {linea.imei && (
                    <span className="text-xs text-gray-400 font-mono">{linea.imei}</span>
                  )}
                  {linea.cantidad && (
                    <span className="text-xs text-gray-400">×{linea.cantidad} unidades</span>
                  )}
                  <Badge variant={esSerial ? 'blue' : 'green'}>
                    {esSerial ? 'Serial' : 'Cantidad'}
                  </Badge>
                </div>
              </div>
              {esCancelado && <XCircle size={16} className="text-red-300 flex-shrink-0" />}
            </div>
          );
        })}
      </div>

      {modalRevertir && detalle && (
        <ModalRevertir traslado={detalle} loading={mutRevertir.isPending}
          onConfirmar={() => mutRevertir.mutate()} onCerrar={() => setModalRevertir(false)} />
      )}
    </div>
  );
}

// ─── Lista de traslados ───────────────────────────────────────────────────────
function ListaTraslados({ traslados, isLoading, onSeleccionar }) {
  if (isLoading) return <Spinner className="py-20" />;

  if (!traslados || traslados.length === 0) {
    return (
      <EmptyState icon={ArrowRightLeft} titulo="Sin traslados"
        descripcion="Aún no se han realizado traslados entre sucursales" />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {traslados.map((t) => {
        const esCancelado = t.estado === 'Cancelado';
        const StatusIcon  = esCancelado ? XCircle : CheckCircle;
        return (
          <button key={t.id} onClick={() => onSeleccionar(t.id)}
            className={`bg-white border rounded-2xl p-4 text-left transition-all hover:shadow-sm
              ${esCancelado ? 'border-red-100 hover:border-red-200' : 'border-gray-100 hover:border-blue-200'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-gray-900">
                    #{String(t.id).padStart(4, '0')}
                  </span>
                  <Badge variant={esCancelado ? 'red' : 'green'}>
                    {esCancelado ? 'Revertido' : 'Completado'}
                  </Badge>
                  <span className="text-xs text-gray-300 bg-gray-50 px-2 py-0.5 rounded-full">
                    {t.total_items} item{t.total_items !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-sm text-gray-600">
                  <span className="font-medium">{t.sucursal_origen_nombre}</span>
                  <ArrowRightLeft size={13} className="text-gray-300 flex-shrink-0" />
                  <span className="font-medium">{t.sucursal_destino_nombre}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  <Clock size={11} />
                  <span>{formatFechaHora(t.fecha)}</span>
                  {t.usuario_nombre && <span>· {t.usuario_nombre}</span>}
                </div>
              </div>
              <StatusIcon size={18} className={esCancelado ? 'text-red-300' : 'text-green-400'} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function TrasladosPage() {
  const [trasladoSelId, setTrasladoSelId] = useState(null);

  const { data: sucursalesRaw } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
  });
  const sucursales = sucursalesRaw || [];

  const { data: trasladosData, isLoading } = useQuery({
    queryKey: ['traslados'],
    queryFn:  () => getTraslados().then((r) => r.data.data),
    enabled:  sucursales.length > 1,
  });

  // Si solo hay 1 sucursal, no mostrar la página
  if (sucursales.length <= 1) {
    return (
      <EmptyState icon={ArrowRightLeft} titulo="Traslados no disponibles"
        descripcion="Necesitas al menos 2 sucursales para realizar traslados" />
    );
  }

  if (trasladoSelId) {
    return (
      <DetalleTraslado trasladoId={trasladoSelId} onVolver={() => setTrasladoSelId(null)} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
          <ArrowRightLeft size={20} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Traslados</h1>
          <p className="text-sm text-gray-400">Historial de movimientos entre sucursales</p>
        </div>
      </div>

      <ListaTraslados
        traslados={trasladosData || []}
        isLoading={isLoading}
        onSeleccionar={setTrasladoSelId}
      />
    </div>
  );
}