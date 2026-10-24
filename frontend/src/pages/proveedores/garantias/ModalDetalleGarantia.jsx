import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User, Truck, CheckCircle2, Clock, Printer, Ban, Undo2, Hourglass, Building2,
} from 'lucide-react';
import { getGarantia, anularGarantia, anularMovimiento } from '../../../api/garantiasProveedor.api';
import { Modal }   from '../../../components/ui/Modal';
import { Button }  from '../../../components/ui/Button';
import { Spinner } from '../../../components/ui/Spinner';
import { useGarantiasProveedor } from '../../../hooks/useEnGarantia';
import { formatCOP, formatFechaHora, formatFecha } from '../../../utils/formatters';
import {
  ESTADO_PROVEEDOR, ESTADO_CLIENTE, TIPO_MOVIMIENTO, DESTINO_RECHAZO, fechaDia, numeroDe,
  textoOrigen, mensajeError,
} from './garantiasUi';
import { ModalResolverCliente }    from './ModalResolverCliente';
import { ModalRespuestaProveedor } from './ModalRespuestaProveedor';
import { ModalEnviarProveedor }    from './ModalEnviarProveedor';
import { refrescarTrasGarantia }   from './refrescar';
import { FotosGarantia }           from './FotosGarantia';

// ─────────────────────────────────────────────────────────────────────────────
// Un caso de garantía. Dos columnas porque son dos caminos que avanzan por
// separado: con el CLIENTE (se le respondió o espera) y con el PROVEEDOR (por
// enviar, afuera, resuelto). Cada columna muestra dónde va y UNA acción
// principal — la siguiente que toca —, para que nadie tenga que adivinar.
// En el celular las columnas se apilan.
// ─────────────────────────────────────────────────────────────────────────────

function Chip({ estado, mapa }) {
  const e = mapa[estado];
  if (!e) return null;
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${e.clase}`}>{e.texto}</span>;
}

function textoMovimiento(m) {
  const base = TIPO_MOVIMIENTO[m.tipo] || m.tipo;
  if (m.tipo === 'cambio') return `${base}: ${m.nombre_producto || ''}${m.imei ? ` (${m.imei})` : ''}${m.cantidad > 1 ? ` × ${m.cantidad}` : ''}`;
  if (m.tipo === 'reembolso') return `${base}: ${m.metodo === 'Crédito' ? `crédito −${formatCOP(m.valor)}` : `${formatCOP(m.valor)} (${m.metodo})`}`;
  if (m.tipo === 'reposicion') return `${base}${m.imei ? `: ${m.imei}` : ''}${m.cantidad > 1 ? ` × ${m.cantidad}` : ''}`
    + `${m.garantia_hasta ? ` · garantía hasta ${fechaDia(m.garantia_hasta)}` : ' · sin garantía'}`;
  if (m.tipo === 'reparacion') return `${base}${m.cantidad > 1 ? ` × ${m.cantidad}` : ''}`
    + `${m.garantia_hasta ? ` · garantía hasta ${fechaDia(m.garantia_hasta)}` : ''}`;
  if (m.tipo === 'nota_credito') return `${base}: ${formatCOP(m.valor)}`;
  if (m.tipo === 'reembolso_proveedor') return `${base}: ${formatCOP(m.valor)} (${m.metodo})`;
  if (m.tipo === 'rechazo') return `${base}: ${DESTINO_RECHAZO[m.destino] || ''}${m.cantidad > 1 ? ` × ${m.cantidad}` : ''}`;
  return base;
}

function Movimiento({ m, puedeAnular, onAnular }) {
  return (
    <div className={`flex items-start gap-2 text-xs ${m.anulado ? 'opacity-50' : ''}`}>
      <CheckCircle2 size={13} className={`flex-shrink-0 mt-0.5 ${m.anulado ? 'text-gray-400' : 'text-green-600'}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-gray-700 ${m.anulado ? 'line-through' : ''}`}>{textoMovimiento(m)}</p>
        <p className="text-gray-400">{formatFechaHora(m.fecha)}{m.usuario_nombre ? ` · ${m.usuario_nombre}` : ''}</p>
        {m.notas && <p className="text-gray-500">{m.notas}</p>}
        {m.anulado && <p className="text-red-500">Anulado: {m.anulado_motivo}</p>}
      </div>
      {!m.anulado && puedeAnular && (
        <button type="button" onClick={() => onAnular(m)} title="Anular este movimiento"
          className="p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
          <Undo2 size={13} />
        </button>
      )}
    </div>
  );
}

export function ModalDetalleGarantia({ reclamoId, onClose, onImprimir, onImprimirEnvio }) {
  const queryClient = useQueryClient();
  const { puede, fotosActivas } = useGarantiasProveedor();
  const [sub, setSub] = useState(null);          // { tipo, linea }
  const [anulando, setAnulando] = useState(null); // { tipo: 'caso' | 'mov', mov? }
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');

  const { data: r, isLoading, isError } = useQuery({
    queryKey: ['garantia-proveedor', reclamoId],
    queryFn:  () => getGarantia(reclamoId).then((res) => res.data.data),
  });

  const mutAnular = useMutation({
    mutationFn: () => (anulando.tipo === 'caso'
      ? anularGarantia(reclamoId, motivo)
      : anularMovimiento(anulando.mov.id, motivo)),
    onSuccess: () => { refrescarTrasGarantia(queryClient); setAnulando(null); setMotivo(''); },
    onError: (err) => setError(mensajeError(err, 'No se pudo anular')),
  });

  if (isLoading || isError || !r) {
    return (
      <Modal open onClose={onClose} title="Garantía" size="xl">
        {isError ? <p className="text-sm text-red-600 text-center py-6">No se pudo cargar la garantía.</p> : <Spinner className="py-10" />}
      </Modal>
    );
  }

  if (sub?.tipo === 'cliente') {
    return <ModalResolverCliente reclamo={r} linea={sub.linea} onClose={() => setSub(null)} />;
  }
  if (sub?.tipo === 'proveedor') {
    return <ModalRespuestaProveedor reclamo={r} linea={sub.linea} onClose={() => setSub(null)} />;
  }
  if (sub?.tipo === 'enviar') {
    return (
      <ModalEnviarProveedor proveedorId={r.proveedor_id}
        lineas={sub.lineas.map((l) => ({ ...l, reclamo_numero: numeroDe(r), falla: r.falla, proveedor_id: r.proveedor_id, proveedor_nombre: r.proveedor_nombre }))}
        onClose={() => setSub(null)}
        onEnviado={(e) => { setSub(null); onImprimirEnvio?.(e.id); }} />
    );
  }

  const conCliente = r.origen_tipo !== 'inventario';
  const movs = r.movimientos || [];
  const sinMovVivos = !movs.some((m) => !m.anulado);
  const porEnviar = (r.lineas || []).filter((l) => l.estado_proveedor === 'por_enviar');

  return (
    <Modal open onClose={onClose} title={`Garantía #${numeroDe(r)}`} size="xl">
      <div className="flex flex-col gap-4">
        {/* Cabecera: qué, de dónde, quién */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>{formatFechaHora(r.fecha)}</span>
            <span>·</span>
            <span>{textoOrigen(r)}</span>
            <span className="inline-flex items-center gap-1 text-purple-600"><Building2 size={11} />{r.sucursal_nombre}</span>
            {r.anulado && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Anulada</span>}
          </div>
          <div className="rounded-xl bg-gray-50 p-3 text-sm flex flex-col gap-0.5">
            <p className="text-gray-800"><b>Falla:</b> {r.falla}</p>
            {r.estado_fisico && <p className="text-gray-600"><b>Estado:</b> {r.estado_fisico}</p>}
            <p className="text-gray-600"><b>Entregó:</b> {(r.accesorios || []).length ? r.accesorios.join(', ') : 'solo el producto'}</p>
            {r.notas && <p className="text-gray-600"><b>Notas:</b> {r.notas}</p>}
            <p className="text-xs text-gray-400">Recibió {r.usuario_nombre || '—'}</p>
            {r.orden_servicio && (
              <p className="text-xs text-purple-600">Viene de la orden de servicio #OS-{String(r.orden_servicio.numero).padStart(4, '0')}</p>
            )}
          </div>
          {(fotosActivas || (r.archivos || []).length > 0) && (
            <FotosGarantia reclamoId={r.id} archivos={r.archivos || []} activas={fotosActivas && !r.anulado}
              puedeAdjuntar={puede('recibir')} puedeAnular={puede('anular')} />
          )}
          {r.anulado && <p className="text-xs text-red-600">Anulada: {r.anulado_motivo}</p>}
        </div>

        {(r.lineas || []).map((l) => {
          const movCli = movs.filter((m) => m.linea_id === l.id && m.lado === 'cliente');
          const movProv = movs.filter((m) => m.linea_id === l.id && m.lado === 'proveedor');
          const faltaCliente = Number(l.cantidad) - Number(l.cantidad_cliente);
          const faltaProv = Number(l.cantidad) - Number(l.cantidad_resuelta);
          return (
            <div key={l.id} className="border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-white border-b border-gray-100 flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-gray-800 flex-1 min-w-0">
                  {l.cantidad} × {l.nombre_producto}
                  {l.variante_texto && <span className="font-normal text-gray-500"> · {l.variante_texto}</span>}
                  {l.imei && <span className="font-mono font-normal text-gray-500"> · {l.imei}</span>}
                </p>
                {l.costo_unitario != null && <span className="text-xs text-gray-400">Costo {formatCOP(l.costo_unitario * l.cantidad)}</span>}
              </div>
              <div className={`grid ${conCliente ? 'md:grid-cols-2' : ''} divide-y md:divide-y-0 md:divide-x divide-gray-100`}>
                {conCliente && (
                  <div className="p-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-gray-400" />
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">Cliente</p>
                      <Chip estado={l.estado_cliente} mapa={ESTADO_CLIENTE} />
                    </div>
                    <p className="text-sm text-gray-700">{r.cliente_nombre || '—'}{r.cliente_telefono ? ` · ${r.cliente_telefono}` : ''}</p>
                    {movCli.map((m) => (
                      <Movimiento key={m.id} m={m} puedeAnular={puede('anular')} onAnular={(mov) => setAnulando({ tipo: 'mov', mov })} />
                    ))}
                    {!r.anulado && faltaCliente > 0 && (
                      <>
                        <p className="text-xs text-orange-700 flex items-center gap-1"><Hourglass size={12} /> Espera {faltaCliente} unidad(es)</p>
                        {(puede('cliente') || puede('reembolsar')) && (
                          <Button size="sm" onClick={() => setSub({ tipo: 'cliente', linea: l })}>Atender al cliente</Button>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div className="p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Truck size={14} className="text-gray-400" />
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">Proveedor</p>
                    <Chip estado={l.estado_proveedor} mapa={ESTADO_PROVEEDOR} />
                  </div>
                  <p className="text-sm text-gray-700">
                    {r.proveedor_nombre || 'Sin definir'}
                    {l.compra_numero ? <span className="text-gray-400"> · compra #{l.compra_numero} ({formatFecha(l.compra_fecha)})</span> : ''}
                  </p>
                  {l.garantia_proveedor_hasta && (
                    <p className="text-xs text-gray-500">Garantía del proveedor hasta {fechaDia(l.garantia_proveedor_hasta)}</p>
                  )}
                  {l.envio_id && (
                    <button type="button" onClick={() => onImprimirEnvio?.(l.envio_id)}
                      className="text-xs text-blue-600 hover:underline self-start flex items-center gap-1">
                      <Truck size={12} /> Envío #{l.envio_numero} · {formatFecha(l.envio_fecha)}{l.envio_guia ? ` · guía ${l.envio_guia}` : ''}
                      {l.dias_afuera != null ? ` · ${l.dias_afuera} día(s) afuera` : ''}
                    </button>
                  )}
                  {movProv.map((m) => (
                    <Movimiento key={m.id} m={m} puedeAnular={puede('anular')} onAnular={(mov) => setAnulando({ tipo: 'mov', mov })} />
                  ))}
                  {!r.anulado && l.estado_proveedor === 'por_enviar' && puede('enviar') && (
                    <Button size="sm" variant="secondary" onClick={() => setSub({ tipo: 'enviar', lineas: porEnviar })}>
                      <Truck size={14} /> Enviar al proveedor
                    </Button>
                  )}
                  {!r.anulado && l.envio_id && faltaProv > 0 && (
                    <>
                      <p className="text-xs text-blue-700 flex items-center gap-1"><Clock size={12} /> Esperando respuesta por {faltaProv} unidad(es)</p>
                      {puede('resolver') && (
                        <Button size="sm" onClick={() => setSub({ tipo: 'proveedor', linea: l })}>Registrar respuesta</Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {anulando && (
          <div className="rounded-xl border border-red-100 bg-red-50 p-3 flex flex-col gap-2">
            <p className="text-sm font-medium text-red-700">
              {anulando.tipo === 'caso'
                ? 'Anular la garantía: la unidad vuelve a donde estaba (al cliente o al inventario).'
                : `Anular: ${textoMovimiento(anulando.mov)}. Se revierte lo que movió (inventario, caja o la cuenta del proveedor).`}
            </p>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="¿Por qué? (obligatorio)"
              className="w-full px-3 py-2 border border-red-200 rounded-xl text-sm bg-white" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setAnulando(null); setMotivo(''); setError(''); }}>No</Button>
              <Button size="sm" variant="danger" loading={mutAnular.isPending} disabled={motivo.trim().length < 3}
                onClick={() => { setError(''); mutAnular.mutate(); }}>Sí, anular</Button>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => onImprimir?.(r.id)}>
            <Printer size={16} /> Imprimir comprobante
          </Button>
          {!r.anulado && sinMovVivos && puede('anular') && !anulando && (
            <Button variant="ghost" className="text-red-600" onClick={() => setAnulando({ tipo: 'caso' })}>
              <Ban size={16} /> Anular garantía
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Modal>
  );
}
