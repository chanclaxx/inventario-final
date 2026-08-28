import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PackagePlus, Check, Clock, ClipboardList, FileCheck2,
} from 'lucide-react';
import {
  getEntradas, getOrdenesParaRecibir,
  getEntradasPorConfirmar, confirmarEntrada,
} from '../../api/entradas.api';
import { VistaEntrada } from './VistaEntrada';
import { getCompraById }  from '../../api/compras.api';
import { getProveedores } from '../../api/proveedores.api';
import { Modal }          from '../../components/ui/Modal';
import { InputMoneda }    from '../../components/ui/InputMoneda';
import { useAuth }        from '../../context/useAuth';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Spinner }     from '../../components/ui/Spinner';
import { Badge }       from '../../components/ui/Badge';
import { EmptyState }  from '../../components/ui/EmptyState';
import { formatFechaHora, formatCOP } from '../../utils/formatters';
import { useSucursalKey }  from '../../hooks/useSucursalKey';

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADAS DE BODEGA
//
// La pantalla del bodeguero. No hay una sola cifra de dinero: ni costo, ni
// precio de compra, ni proveedor. Él cuenta lo que llegó; administración le
// pone la plata después, contra la factura del proveedor.
//
// ── Una sola pantalla para los dos casos ────────────────────────────────────
// Con pedido y sin pedido NO son flujos distintos: tocar un pedido abre esta
// misma vista con las líneas ya cargadas, y "Registrar entrada" la abre vacía.
// El pedido es un atajo que llena la lista, no un modo aparte. Eso es lo que
// evita la pregunta "¿esto tiene orden o no?" y el segundo tipo de documento.
//
// ── Bodega no crea productos ────────────────────────────────────────────────
// Es deliberado: de los nombres casi iguales salen los duplicados que hoy hay en
// producción. Si algo llega y no está en el catálogo, el backend responde con un
// mensaje que dice a quién pedírselo, en vez de solo negarse.
// ─────────────────────────────────────────────────────────────────────────────

const norm = (r) => (Array.isArray(r) ? r : (Array.isArray(r?.items) ? r.items : []));


// ── Confirmar una entrada contra la factura del proveedor ───────────────────
//
// Solo administración. Aquí es donde la entrada deja de ser "lo que llegó" y
// pasa a ser una compra con su plata: proveedor, precios reales y número de
// factura. Los precios vienen precargados con el valor provisional que resolvió
// el backend (el estimado de la orden o el último costo conocido), así que si
// la factura coincide basta con guardar.
//
// Al guardar corre `editarPreciosCompra`, que ya cascadea en una sola
// transacción al costo promedio, al costo de cada serial, al total de la compra
// y a la deuda con el proveedor. No se reimplementa nada de eso.
function ModalConfirmar({ entrada, onCerrar, onListo }) {
  const [proveedorId, setProveedorId] = useState(entrada.proveedor_id ? String(entrada.proveedor_id) : '');
  const [numFactura,  setNumFactura]  = useState(entrada.numero_factura || '');
  const [precios,     setPrecios]     = useState({});
  const [error,       setError]       = useState('');

  const { data: detalle, isLoading } = useQuery({
    queryKey: ['entrada-detalle', entrada.id],
    queryFn:  () => getCompraById(entrada.id).then((r) => r.data.data),
  });

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => getProveedores().then((r) => norm(r.data.data)),
    enabled:  !entrada.proveedor_id,
  });

  const precioDe = (l) => (l.id in precios ? precios[l.id] : Number(l.precio_unitario) || 0);

  const mut = useMutation({
    mutationFn: () => confirmarEntrada(entrada.id, {
      proveedor_id:   proveedorId ? Number(proveedorId) : null,
      numero_factura: numFactura.trim() || null,
      // Solo viajan las líneas que de verdad cambiaron: `editarPreciosCompra`
      // omite las iguales, pero mandarlas todas obligaría a rechazar las de
      // precio 0 (un producto que nunca tuvo costo) y no dejaría confirmar.
      lineas: (detalle?.lineas || [])
        .filter((l) => precioDe(l) > 0 && precioDe(l) !== Number(l.precio_unitario))
        .map((l) => ({ linea_id: l.id, precio_unitario: precioDe(l) })),
    }),
    onSuccess: () => onListo(`Entrada #${entrada.numero ?? entrada.id} confirmada`),
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo confirmar'),
  });

  return (
    <Modal open onClose={onCerrar} title={`Confirmar entrada #${entrada.numero ?? entrada.id}`} size="md">
      {isLoading ? <Spinner className="py-12" /> : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            Recibida por {entrada.recibida_por || 'bodega'} el {formatFechaHora(entrada.fecha)}.
            Los precios están precargados con el valor provisional; corrígelos con
            los de la factura.
          </p>

          {!entrada.proveedor_id && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Proveedor</label>
              <select
                value={proveedorId}
                onChange={(e) => setProveedorId(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
                  text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecciona el proveedor</option>
                {proveedores.map((pr) => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
              </select>
              <p className="text-xs text-gray-400">
                Esta entrada llegó sin pedido, así que nadie sabe todavía de quién vino.
              </p>
            </div>
          )}

          <Input
            label="Número de factura del proveedor (opcional)"
            value={numFactura}
            onChange={(e) => setNumFactura(e.target.value)}
            placeholder="Ej: FV-10245"
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Precio de compra por línea</label>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              {(detalle?.lineas || []).map((l) => (
                <div key={l.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">{l.nombre_producto}</p>
                    <p className="text-[11px] text-gray-400 tabular-nums">
                      {l.imei ? l.imei : `${l.cantidad} uds`}
                      {Number(l.precio_unitario) > 0
                        ? ` · provisional ${formatCOP(l.precio_unitario)}`
                        : ' · sin costo previo'}
                    </p>
                  </div>
                  <div className="w-32 flex-shrink-0">
                    <InputMoneda
                      value={precioDe(l)}
                      onChange={(v) => setPrecios((prev) => ({ ...prev, [l.id]: Number(v) || 0 }))}
                      placeholder="0"
                      className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl
                        text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
            <Button
              className="flex-1"
              loading={mut.isPending}
              disabled={!entrada.proveedor_id && !proveedorId}
              onClick={() => { setError(''); mut.mutate(); }}
            >
              <Check size={15} /> Confirmar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Vista: la lista ─────────────────────────────────────────────────────────
export default function EntradasPage() {
  const [vista, setVista] = useState(null);   // null | { orden }
  const [aviso, setAviso] = useState('');
  const [confirmando, setConfirmando] = useState(null);
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const queryClient = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const esAdmin = esAdminNegocio();

  const { data: ordenes = [], isLoading: cargandoOrdenes } = useQuery({
    queryKey: ['entradas-ordenes', ...sucursalKey],
    queryFn:  () => getOrdenesParaRecibir().then((r) => r.data.data || []),
    enabled:  sucursalLista,
  });

  const { data: entradas = [], isLoading } = useQuery({
    queryKey: ['entradas', ...sucursalKey],
    queryFn:  () => getEntradas().then((r) => r.data.data || []),
    enabled:  sucursalLista,
  });

  // La bandeja solo la pide administración: la ruta exige el permiso de ver
  // compras y responde con proveedor y totales.
  const { data: porConfirmar = [] } = useQuery({
    queryKey: ['entradas-por-confirmar', ...sucursalKey],
    queryFn:  () => getEntradasPorConfirmar().then((r) => r.data.data || []),
    enabled:  esAdmin && sucursalLista,
  });

  if (vista) {
    return (
      <VistaEntrada
        orden={vista.orden}
        onVolver={() => setVista(null)}
        onListo={(msg) => { setVista(null); setAviso(msg); setTimeout(() => setAviso(''), 4000); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Entradas</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Lo que llega a la bodega. Los precios los pone administración.
          </p>
        </div>
        <Button onClick={() => setVista({ orden: null })}>
          <PackagePlus size={15} /> Registrar entrada
        </Button>
      </div>

      {aviso && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
          {aviso}
        </p>
      )}

      {/* Bandeja de administración. No es un módulo aparte: es una sección más
          de esta pantalla, visible solo para quien puede decidir plata. */}
      {esAdmin && porConfirmar.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Por confirmar ({porConfirmar.length})
          </p>
          {porConfirmar.map((e) => (
            <div key={e.id}
              className="flex items-center justify-between gap-3 p-3 rounded-xl
                border border-amber-200 bg-amber-50/50">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">
                  Entrada #{String(e.numero ?? e.id).padStart(4, '0')}
                </p>
                {e.resumen && (
                  <p className="text-xs text-gray-600 truncate">{e.resumen}
                    {e.lineas > 4 && <span className="text-gray-400"> +{e.lineas - 4} más</span>}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  {formatFechaHora(e.fecha)} · {e.unidades} uds
                  {e.recibida_por && ` · ${e.recibida_por}`}
                  {e.orden_numero
                    ? ` · OC-${String(e.orden_numero).padStart(4, '0')}`
                    : ' · sin pedido'}
                </p>
                <p className="text-xs mt-0.5">
                  {!e.proveedor_id
                    ? <span className="text-amber-700 font-medium">falta el proveedor</span>
                    : <span className="text-gray-400">{e.proveedor_nombre}</span>}
                  {e.dias_esperando > 0 && (
                    <span className="text-gray-400"> · {e.dias_esperando} día(s) esperando</span>
                  )}
                </p>
              </div>
              <Button size="sm" onClick={() => setConfirmando(e)}>
                <FileCheck2 size={14} /> Confirmar
              </Button>
            </div>
          ))}
        </div>
      )}

      {confirmando && (
        <ModalConfirmar
          entrada={confirmando}
          onCerrar={() => setConfirmando(null)}
          onListo={(msg) => {
            setConfirmando(null);
            setAviso(msg);
            setTimeout(() => setAviso(''), 4000);
            queryClient.invalidateQueries({ queryKey: ['entradas-por-confirmar'], exact: false });
            queryClient.invalidateQueries({ queryKey: ['entradas'],               exact: false });
          }}
        />
      )}

      {/* Pedidos por llegar — el atajo que llena la lista, no otro flujo. */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Pedidos por llegar
        </p>
        {cargandoOrdenes ? <Spinner className="py-6" /> : ordenes.length === 0 ? (
          <p className="text-sm text-gray-400 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            No hay pedidos pendientes. Si llegó algo sin pedido, usa «Registrar entrada».
          </p>
        ) : ordenes.map((o) => {
          const pendiente = (o.lineas || []).reduce((n, l) => n + Math.max(0, l.pendiente), 0);
          const pedida    = (o.lineas || []).reduce((n, l) => n + l.pedida, 0);
          return (
            <button
              key={o.id}
              onClick={() => setVista({ orden: o })}
              className="flex items-center justify-between gap-3 p-3 rounded-xl border
                border-gray-100 bg-white hover:border-green-300 hover:bg-green-50/40
                transition-colors text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">
                  OC-{String(o.numero ?? o.id).padStart(4, '0')}
                </p>
                <p className="text-xs text-gray-400">
                  {(o.lineas || []).length} producto(s)
                  {o.fecha_esperada && ` · esperado ${String(o.fecha_esperada).slice(0, 10)}`}
                </p>
              </div>
              <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                faltan {pendiente} de {pedida} &nbsp;›
              </span>
            </button>
          );
        })}
      </div>

      {/* Lo ya registrado. El estado dice si administración ya le puso la
          factura: es toda la trazabilidad que el bodeguero necesita. */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Últimas entradas
        </p>
        {isLoading ? <Spinner className="py-8" /> : entradas.length === 0 ? (
          <EmptyState icon={ClipboardList}
            titulo="Sin entradas todavía"
            descripcion="Lo que registres va a aparecer aquí." />
        ) : entradas.map((e) => (
          <div key={e.id}
            className="flex items-center justify-between gap-3 p-3 rounded-xl
              border border-gray-100 bg-white">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">
                Entrada #{String(e.numero ?? e.id).padStart(4, '0')}
                {e.estado === 'Cancelada' && <span className="ml-2 text-xs text-red-500">cancelada</span>}
              </p>
              {/* Qué llegó. Con solo el número de documento habría que abrir
                  las entradas una por una para saber cuál es cuál. */}
              {e.resumen && (
                <p className="text-xs text-gray-600 truncate">{e.resumen}
                  {e.lineas > 4 && <span className="text-gray-400"> +{e.lineas - 4} más</span>}
                </p>
              )}
              <p className="text-xs text-gray-400">
                {formatFechaHora(e.fecha)} · {e.unidades} uds
                {e.recibida_por && ` · ${e.recibida_por}`}
                {e.orden_numero && ` · OC-${String(e.orden_numero).padStart(4, '0')}`}
              </p>
            </div>
            {e.factura_confirmada
              ? <Badge variant="green">confirmada</Badge>
              : <span className="flex items-center gap-1 text-xs text-amber-600 flex-shrink-0">
                  <Clock size={11} /> por confirmar
                </span>}
          </div>
        ))}
      </div>
    </div>
  );
}
