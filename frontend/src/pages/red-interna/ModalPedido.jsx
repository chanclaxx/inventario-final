import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getPedido, cerrarPedido, reabrirPedido, anularPedido, resolverItemsCarrito,
} from '../../api/redInterna.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Badge }   from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import {
  Package, ShoppingBag, PenLine, Truck, CheckCircle, XCircle, Zap,
  Store, RotateCcw, AlertTriangle, MessageSquare,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// LA FICHA DE UN PEDIDO — una pantalla para los dos lados
//
// La usa el LOCAL para ver en qué quedó lo suyo y la BODEGA para atenderlo.
// Antes de que existiera, esto eran dos componentes mostrando los mismos datos
// con layouts distintos, que es exactamente como se desincronizan las
// pantallas — la misma razón por la que `CuentaLocal` también es una sola.
//
// Lo que manda es la LISTA DE LÍNEAS con su pendiente. Ese número no está
// guardado en ninguna columna: se deriva de las remisiones cada vez que se lee,
// para que anular un envío o reportar un faltante lo devuelvan solos a rojo.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_AVANCE = {
  'Sin despachar': 'gray',
  Parcial:         'yellow',
  Despachado:      'green',
  Vacío:           'gray',
};

function BarraAvance({ pedidas, despachadas }) {
  const pct = pedidas > 0 ? Math.min(100, Math.round((despachadas / pedidas) * 100)) : 0;
  return (
    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Linea({ l }) {
  const pendiente = Number(l.pendiente || 0);
  const libre = l.producto_id == null;
  const Icono = libre ? PenLine : l.tipo === 'serial' ? Package : ShoppingBag;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
      <Icono size={15} className={`flex-shrink-0 ${
        libre ? 'text-gray-400' : l.tipo === 'serial' ? 'text-blue-500' : 'text-green-500'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{l.nombre_producto}</p>
        <p className="text-xs text-gray-400">
          {libre
            ? 'escrito a mano — la bodega decide qué mandar'
            : `pidió ${l.cantidad_pedida} · despachadas ${l.despachada}`}
          {l.notas ? ` · ${l.notas}` : ''}
        </p>
      </div>
      <div className="flex-shrink-0">
        {pendiente === 0
          ? <Badge variant="green">completo</Badge>
          : <Badge variant="yellow">faltan {pendiente}</Badge>}
      </div>
    </div>
  );
}

export function ModalPedido({
  pedidoId, esBodega = false, propia = false,
  onCerrar, onAviso, onDespachar = () => {},
}) {
  const [respuesta, setRespuesta] = useState('');
  // null | 'cerrar' (la bodega) | 'anular' (el local). Un solo estado para los
  // dos: los dos preguntan lo mismo —¿por qué?— y compartir el campo evita que
  // uno acabe pidiendo el motivo y el otro no.
  const [confirmar, setConfirmar] = useState(null);
  const [error,     setError]     = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['red-pedido', pedidoId],
    queryFn:  () => getPedido(pedidoId).then((r) => r.data.data),
  });

  const cerrar = useMutation({
    mutationFn: () => cerrarPedido(pedidoId, respuesta.trim() || null),
    onSuccess: () => { onAviso('Pedido cerrado'); onCerrar(); },
    onError: (e) => setError(e?.response?.data?.error || 'No se pudo cerrar'),
  });

  const reabrir = useMutation({
    mutationFn: () => reabrirPedido(pedidoId),
    onSuccess: () => { onAviso('Pedido reabierto'); refetch(); },
    onError: (e) => setError(e?.response?.data?.error || 'No se pudo reabrir'),
  });

  const anular = useMutation({
    mutationFn: () => anularPedido(pedidoId, respuesta.trim() || null),
    onSuccess: () => { onAviso('Pedido anulado'); onCerrar(); },
    onError: (e) => setError(e?.response?.data?.error || 'No se pudo anular'),
  });

  // Prepara el despacho: las líneas por CANTIDAD que aún faltan se traducen a
  // ítems valorizados con el mismo endpoint que usa el carrito de inventario.
  //
  // Los EQUIPOS no se pueden precargar y no es un descuido: el pedido dice
  // "2 × iPhone 13" y quién elige los IMEI concretos es quien tiene las cajas
  // en la mano. Se muestran como recordatorio y se escanean.
  const preparar = useMutation({
    mutationFn: () => {
      const pendientes = (data.lineas || []).filter(
        (l) => Number(l.pendiente) > 0 && l.tipo === 'cantidad' && l.producto_id
      );
      if (!pendientes.length) return Promise.resolve({ items: [], descartados: [] });
      return resolverItemsCarrito(pendientes.map((l) => ({
        tipo: 'cantidad',
        producto_id: l.producto_id,
        atributo_id: l.atributo_id,
        variante_id: l.variante_id,
        cantidad: Number(l.pendiente),
        nombre: l.nombre_producto,
      }))).then((r) => r.data.data);
    },
    onSuccess: (res) => onDespachar({ pedido: data, ...res }),
    onError: (e) => setError(e?.response?.data?.error || 'No se pudo preparar el despacho'),
  });

  if (isLoading || isError || !data) {
    return (
      <Modal open onClose={onCerrar} title="Pedido" size="md">
        {isError
          ? <p className="text-sm text-gray-500 py-8 text-center">No se pudo cargar el pedido.</p>
          : <div className="py-12 flex justify-center"><Spinner /></div>}
      </Modal>
    );
  }

  const abierto  = data.estado === 'Enviado';
  const pendiente = Number(data.unidades_pendientes || 0);
  // Equipos que la bodega tiene que escanear: no se precargan, se recuerdan.
  const porEscanear = (data.lineas || []).filter(
    (l) => l.tipo === 'serial' && Number(l.pendiente) > 0
  );

  return (
    <Modal open onClose={onCerrar} title={`Pedido #${data.numero ?? data.id}`} size="lg">
      <div className="flex flex-col gap-4">

        {/* Encabezado: de quién, cuándo y en qué va */}
        <div className="rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
              <Store size={17} className="text-gray-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                {data.sucursal_nombre}
                {data.prioridad === 'urgente' && (
                  <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md
                    bg-amber-100 text-amber-700 text-[11px] font-semibold align-middle">
                    <Zap size={10} /> urgente
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-400">
                {formatFechaHora(data.fecha)}
                {data.usuario_nombre ? ` · ${data.usuario_nombre}` : ''}
              </p>
            </div>
            <Badge variant={data.estado === 'Enviado' ? COLOR_AVANCE[data.avance] || 'gray'
                          : data.estado === 'Cerrado' ? 'gray' : 'red'}>
              {data.estado === 'Enviado' ? data.avance : data.estado}
            </Badge>
          </div>

          <div className="px-4 py-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span>{data.unidades_despachadas} de {data.unidades_pedidas} unidades despachadas</span>
              {pendiente > 0 && <span className="text-amber-600 font-medium">faltan {pendiente}</span>}
            </div>
            <BarraAvance pedidas={data.unidades_pedidas} despachadas={data.unidades_despachadas} />
          </div>

          {data.notas && (
            <div className="px-4 py-2.5 border-t border-gray-100 flex items-start gap-2">
              <MessageSquare size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-500 italic">{data.notas}</p>
            </div>
          )}

          {/* La respuesta de la bodega. Sin ella, cerrar un pedido se ve desde
              el local exactamente igual que ignorarlo. */}
          {data.respuesta && (
            <div className="px-4 py-2.5 border-t border-gray-100 bg-blue-50/60 flex items-start gap-2">
              <MessageSquare size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-blue-800">
                  {data.estado === 'Anulado' ? 'Motivo de la anulación' : 'Respuesta de la bodega'}
                </p>
                <p className="text-xs text-blue-700">{data.respuesta}</p>
              </div>
            </div>
          )}
        </div>

        {/* Las líneas */}
        <div className="border border-gray-100 rounded-2xl overflow-hidden">
          {(data.lineas || []).map((l) => <Linea key={l.id} l={l} />)}
        </div>

        {/* Envíos que respondieron */}
        {(data.remisiones || []).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
              Envíos de este pedido
            </p>
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
              {data.remisiones.map((r) => (
                <div key={r.id}
                  className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 last:border-0">
                  <Truck size={15} className={
                    r.estado === 'Anulada' ? 'text-gray-300' : 'text-blue-500'} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${
                      r.estado === 'Anulada' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                      Envío #{r.numero ?? r.id}
                      <span className="font-normal text-gray-400"> · {r.total_items} producto(s)</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatFechaHora(r.fecha_emision)}
                      {r.valor_total != null ? ` · ${formatCOP(r.valor_total)}` : ''}
                    </p>
                  </div>
                  <Badge variant={r.estado === 'Recibida' ? 'green'
                                : r.estado === 'Anulada'  ? 'gray' : 'yellow'}>
                    {r.estado}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-500 flex items-center gap-1.5">
            <AlertTriangle size={14} /> {error}
          </p>
        )}

        {/* ── Acciones de la BODEGA ──────────────────────────────────────── */}
        {esBodega && abierto && !confirmar && (
          <>
            {porEscanear.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <p className="text-xs text-blue-800">
                  <strong>Equipos por escanear:</strong>{' '}
                  {porEscanear.map((l) => `${l.pendiente} × ${l.nombre_producto}`).join(', ')}.
                  Los accesorios se precargan solos; los IMEI los eliges tú en el despacho.
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" loading={preparar.isPending}
                disabled={pendiente === 0}
                onClick={() => { setError(''); preparar.mutate(); }}>
                <Truck size={15} /> Despachar {pendiente > 0 ? `(${pendiente} pendientes)` : ''}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmar('cerrar')}>
                <XCircle size={15} /> Cerrar pedido
              </Button>
            </div>
          </>
        )}

        {/* El paso de confirmación, compartido por las dos acciones que dejan
            un pedido sin atender. El motivo es lo que hace que la otra parte se
            entere de por qué: sin él, cerrar (o anular) se ve exactamente igual
            que ignorar el pedido, y a la semana se vuelve a pedir lo mismo. */}
        {confirmar && (
          <div className="bg-gray-50 rounded-xl px-4 py-3 flex flex-col gap-2">
            <p className="text-xs text-gray-600">
              {confirmar === 'cerrar'
                ? 'Cerrar deja lo pendiente sin atender. Dile al local por qué — sin una razón, para él es igual que si nadie hubiera visto su pedido.'
                : 'Se cancela el pedido completo. Cuéntale a la bodega por qué, que puede tenerlo abierto en su bandeja ahora mismo.'}
            </p>
            <input
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              placeholder={confirmar === 'cerrar'
                ? 'Ej: no hay stock hasta el lunes'
                : 'Ej: ya lo conseguimos por otro lado'}
              autoFocus
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2">
              {confirmar === 'cerrar' ? (
                <Button size="sm" className="flex-1" loading={cerrar.isPending}
                  onClick={() => { setError(''); cerrar.mutate(); }}>
                  <CheckCircle size={14} /> Cerrar el pedido
                </Button>
              ) : (
                <Button size="sm" variant="danger" className="flex-1" loading={anular.isPending}
                  onClick={() => { setError(''); anular.mutate(); }}>
                  <XCircle size={14} /> Anular el pedido
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setConfirmar(null)}>
                Volver
              </Button>
            </div>
          </div>
        )}

        {esBodega && data.estado === 'Cerrado' && (
          <Button variant="secondary" loading={reabrir.isPending}
            onClick={() => { setError(''); reabrir.mutate(); }}>
            <RotateCcw size={15} /> Reabrir pedido
          </Button>
        )}

        {/* ── Acciones del LOCAL ─────────────────────────────────────────── */}
        {/* Anular solo mientras nada haya salido: con mercancía ya despachada,
            el backend responde que se lo pida cerrar a la bodega. */}
        {propia && !confirmar && (abierto || data.estado === 'Borrador') && (
          <Button variant="ghost" onClick={() => { setError(''); setConfirmar('anular'); }}>
            <XCircle size={15} /> Anular mi pedido
          </Button>
        )}
      </div>
    </Modal>
  );
}
