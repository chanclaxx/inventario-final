import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTraslados, getTrasladoById, revertirTraslado } from '../../api/traslados.api';
import { getSucursales } from '../../api/sucursales.api';
import { formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Modal }      from '../../components/ui/Modal';
import { Badge }      from '../../components/ui/Badge';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ModalJalarTraslado } from './ModalJalarTraslado';
import api from '../../api/axios.config';
import {
  ArrowRightLeft, ChevronLeft, Package, ShoppingBag,
  RotateCcw, AlertTriangle, CheckCircle, XCircle, Clock, ArrowRight,
  ArrowDownToLine,
} from 'lucide-react';

// ─── API call reversión individual ───────────────────────────────────────────

const revertirLineaApi = (trasladoId, lineaId) =>
  api.post(`/traslados/${trasladoId}/lineas/${lineaId}/revertir`);

// ─── Helper: nombre del producto destino ─────────────────────────────────────

function nombreDestino(linea) {
  if (linea.tipo === 'serial') {
    return [linea.nombre_producto_destino, linea.marca_destino, linea.modelo_destino]
      .filter(Boolean).join(' ') || null;
  }
  return linea.nombre_cantidad_destino || null;
}

// ─── Modal confirmación reversión total ──────────────────────────────────────

function ModalRevertirTotal({ traslado, onConfirmar, onCerrar, loading }) {
  return (
    <Modal open onClose={onCerrar} title="Revertir traslado completo" size="sm">
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
            Todos los productos disponibles serán devueltos a la sucursal origen.
            Los seriales vendidos o prestados no podrán revertirse.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
            loading={loading} onClick={onConfirmar}>
            <RotateCcw size={14} /> Revertir todo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal confirmación reversión individual ──────────────────────────────────

function ModalRevertirLinea({ linea, traslado, onConfirmar, onCerrar, loading }) {
  const destino = nombreDestino(linea);
  return (
    <Modal open onClose={onCerrar} title="Revertir producto" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2">
          <p className="text-xs text-gray-400">Producto a revertir</p>
          <p className="text-sm font-semibold text-gray-800">{linea.nombre_producto}</p>
          {linea.imei && <p className="text-xs font-mono text-gray-400">{linea.imei}</p>}
          {linea.cantidad && <p className="text-xs text-gray-400">Cantidad: {linea.cantidad}</p>}
          {destino && destino !== linea.nombre_producto && (
            <div className="flex items-center gap-1.5 mt-1">
              <ArrowRight size={11} className="text-gray-300" />
              <p className="text-xs text-gray-400">Estaba en destino como: <span className="font-medium text-gray-600">{destino}</span></p>
            </div>
          )}
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <p className="text-sm text-blue-700">
            Este producto volverá a <span className="font-semibold">{traslado.sucursal_origen_nombre}</span>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button className="flex-1" loading={loading} onClick={onConfirmar}>
            <RotateCcw size={14} /> Revertir producto
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Tarjeta de línea individual ─────────────────────────────────────────────

function TarjetaLinea({ linea, esCancelado, onRevertir }) {
  const esSerial  = linea.tipo === 'serial';
  const LineaIcon = esSerial ? Package : ShoppingBag;
  const revertida = linea.revertida;
  const destino   = nombreDestino(linea);
  const mismaNombre = !destino || destino === linea.nombre_producto;

  return (
    <div className={`bg-white border rounded-xl p-4 flex gap-3 transition-all
      ${revertida
        ? 'border-red-100 bg-red-50/20 opacity-60'
        : esCancelado
        ? 'border-gray-100 opacity-60'
        : 'border-gray-100'}`}>

      {/* Ícono tipo */}
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
        ${esSerial ? 'bg-blue-50' : 'bg-green-50'}`}>
        <LineaIcon size={16} className={esSerial ? 'text-blue-500' : 'text-green-500'} />
      </div>

      {/* Contenido */}
      <div className="flex-1 min-w-0">
        {/* Nombre origen → destino */}
        <div className="flex items-start gap-1.5 flex-wrap">
          <p className={`text-sm font-semibold ${revertida ? 'line-through text-gray-400' : 'text-gray-900'}`}>
            {linea.nombre_producto}
          </p>
          {!mismaNombre && (
            <>
              <ArrowRight size={13} className="text-gray-300 flex-shrink-0 mt-0.5" />
              <p className={`text-sm font-medium ${revertida ? 'line-through text-gray-400' : 'text-blue-700'}`}>
                {destino}
              </p>
            </>
          )}
        </div>

        {/* Detalles secundarios */}
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
          {revertida && (
            <Badge variant="red">Revertido</Badge>
          )}
        </div>
        {revertida && (linea.revertida_por_nombre || linea.fecha_reversion) && (
          <div className="flex items-center gap-1.5 mt-1">
            <RotateCcw size={10} className="text-red-300 flex-shrink-0" />
            <span className="text-xs text-red-400">
              {linea.revertida_por_nombre && `por ${linea.revertida_por_nombre}`}
              {linea.revertida_por_nombre && linea.fecha_reversion && ' · '}
              {linea.fecha_reversion && formatFechaHora(linea.fecha_reversion)}
            </span>
          </div>
        )}
      </div>

      {/* Acción */}
      <div className="flex-shrink-0 flex items-center">
        {revertida ? (
          <XCircle size={16} className="text-red-300" />
        ) : !esCancelado && (
          <button
            onClick={() => onRevertir(linea)}
            title="Revertir este producto"
            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50
              transition-colors"
          >
            <RotateCcw size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Detalle de un traslado ───────────────────────────────────────────────────

function DetalleTraslado({ trasladoId, onVolver }) {
  const queryClient = useQueryClient();
  const [modalRevertirTotal,  setModalRevertirTotal]  = useState(false);
  const [lineaARevertir,      setLineaARevertir]      = useState(null);
  const [error,               setError]               = useState('');

  const { data: detalle, isLoading } = useQuery({
    queryKey: ['traslado', trasladoId],
    queryFn:  () => getTrasladoById(trasladoId).then((r) => r.data.data),
    enabled:  !!trasladoId,
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['traslados'],              exact: false });
    queryClient.invalidateQueries({ queryKey: ['traslado', trasladoId],  exact: false });
    queryClient.invalidateQueries({ queryKey: ['productos-serial'],       exact: false });
    queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],     exact: false });
  };

  const mutRevertirTotal = useMutation({
    mutationFn: () => revertirTraslado(trasladoId),
    onSuccess: () => { invalidar(); setModalRevertirTotal(false); setError(''); },
    onError:   (err) => { setModalRevertirTotal(false); setError(err.response?.data?.error || 'Error al revertir'); },
  });

  const mutRevertirLinea = useMutation({
    mutationFn: (lineaId) => revertirLineaApi(trasladoId, lineaId),
    onSuccess: () => { invalidar(); setLineaARevertir(null); setError(''); },
    onError:   (err) => { setLineaARevertir(null); setError(err.response?.data?.error || 'Error al revertir la línea'); },
  });

  if (isLoading) return <Spinner className="py-20" />;
  if (!detalle)  return <EmptyState icon={ArrowRightLeft} titulo="Traslado no encontrado" />;

  const esCancelado    = detalle.estado === 'Cancelado';
  const lineas         = detalle.lineas || [];
  const lineasActivas  = lineas.filter((l) => !l.revertida);
  const lineasRevertidas = lineas.filter((l) => l.revertida);

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
                {esCancelado ? 'Revertido' : lineasRevertidas.length > 0 ? 'Parcialmente revertido' : 'Completado'}
              </Badge>
            </div>
            <p className="text-sm text-gray-400 mt-1">{formatFechaHora(detalle.fecha)}</p>
            {detalle.usuario_nombre && (
              <p className="text-xs text-gray-400 mt-0.5">Por: {detalle.usuario_nombre}</p>
            )}
            {esCancelado && (detalle.revertido_por_nombre || detalle.fecha_reversion) && (
              <div className="flex items-center gap-1.5 mt-1.5 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5 w-fit">
                <RotateCcw size={11} className="text-red-400 flex-shrink-0" />
                <span className="text-xs text-red-500">
                  Revertido
                  {detalle.revertido_por_nombre && ` por ${detalle.revertido_por_nombre}`}
                  {detalle.fecha_reversion && ` · ${formatFechaHora(detalle.fecha_reversion)}`}
                </span>
              </div>
            )}
          </div>
          {/* Revertir todo solo si hay líneas activas */}
          {!esCancelado && lineasActivas.length > 0 && (
            <Button variant="secondary" onClick={() => setModalRevertirTotal(true)}>
              <RotateCcw size={14} /> Revertir todo
            </Button>
          )}
        </div>

        {/* Flujo visual origen → destino */}
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

      {/* Líneas activas */}
      {lineasActivas.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-600">
              Productos trasladados ({lineasActivas.length})
            </h3>
            <p className="text-xs text-gray-400">
              Toca <RotateCcw size={11} className="inline" /> para revertir uno
            </p>
          </div>
          {lineasActivas.map((linea) => (
            <TarjetaLinea
              key={linea.id}
              linea={linea}
              traslado={detalle}
              esCancelado={esCancelado}
              onRevertir={setLineaARevertir}
            />
          ))}
        </div>
      )}

      {/* Líneas revertidas */}
      {lineasRevertidas.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-gray-400">
            Revertidos ({lineasRevertidas.length})
          </h3>
          {lineasRevertidas.map((linea) => (
            <TarjetaLinea
              key={linea.id}
              linea={linea}
              traslado={detalle}
              esCancelado={true}
              onRevertir={() => {}}
            />
          ))}
        </div>
      )}

      {/* Modales */}
      {modalRevertirTotal && detalle && (
        <ModalRevertirTotal
          traslado={detalle}
          loading={mutRevertirTotal.isPending}
          onConfirmar={() => mutRevertirTotal.mutate()}
          onCerrar={() => setModalRevertirTotal(false)}
        />
      )}

      {lineaARevertir && (
        <ModalRevertirLinea
          linea={lineaARevertir}
          traslado={detalle}
          loading={mutRevertirLinea.isPending}
          onConfirmar={() => mutRevertirLinea.mutate(lineaARevertir.id)}
          onCerrar={() => setLineaARevertir(null)}
        />
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
  const [modalJalar, setModalJalar]       = useState(false);

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

  if (sucursales.length <= 1) {
    return (
      <EmptyState icon={ArrowRightLeft} titulo="Traslados no disponibles"
        descripcion="Necesitas al menos 2 sucursales para realizar traslados" />
    );
  }

  if (trasladoSelId) {
    return <DetalleTraslado trasladoId={trasladoSelId} onVolver={() => setTrasladoSelId(null)} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
          <ArrowRightLeft size={20} className="text-blue-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900">Traslados</h1>
          <p className="text-sm text-gray-400">Historial de movimientos entre sucursales</p>
        </div>
        <Button onClick={() => setModalJalar(true)} variant="secondary">
          <ArrowDownToLine size={15} />
          Traer de otra sucursal
        </Button>
      </div>

      <ListaTraslados
        traslados={trasladosData || []}
        isLoading={isLoading}
        onSeleccionar={setTrasladoSelId}
      />

      <ModalJalarTraslado open={modalJalar} onClose={() => setModalJalar(false)} />
    </div>
  );
}