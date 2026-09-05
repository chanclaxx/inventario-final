import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOrdenes, getOrdenById, emitirOrden, editarOrden, cerrarOrden, anularOrden,
} from '../../api/ordenesCompra.api';
import { getProveedores } from '../../api/proveedores.api';
import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Modal }       from '../../components/ui/Modal';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ModalOrden }   from './ModalOrden';
import { ModalRecibir } from './ModalRecibir';
import { BarraAvance, ChipPago, ChipEstadoOrden } from './indicadoresOrden';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { useAuth } from '../../context/useAuth';
import {
  ClipboardList, Plus, ChevronRight, ChevronLeft, PackageCheck, Send,
  XCircle, Ban, FileText, Truck, AlertTriangle, Package, Smartphone,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// PESTAÑA ÓRDENES
//
// La lista lleva DOS señales independientes por fila y nunca las mezcla: la
// barra es mercancía (qué llegó), el chip es dinero (cuándo vence la factura).
// Una orden puede estar completa y vencida.
//
// Por defecto solo muestra las vivas. Una lista que arrastra años de órdenes
// cerradas deja de servir para trabajar.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function norm(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

// ─── Fila de la lista ─────────────────────────────────────────────────────────
function FilaOrden({ orden, onAbrir }) {
  return (
    <button onClick={onAbrir}
      className="w-full bg-white border border-gray-100 rounded-xl p-3.5 flex items-center gap-3
                 hover:border-gray-200 hover:shadow-sm transition-all text-left">
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-900 truncate">{orden.proveedor_nombre}</span>
          <ChipEstadoOrden estado={orden.estado} estadoRecepcion={orden.estado_recepcion} />
        </div>
        <p className="text-xs text-gray-400 tabular-nums truncate">
          OC-{String(orden.numero ?? orden.id).padStart(4, '0')}
          {orden.fecha_esperada && ` · esperada ${formatFecha(orden.fecha_esperada)}`}
          {` · ${formatCOP(orden.total_estimado)}`}
        </p>
      </div>

      <div className="w-28 sm:w-32 flex-shrink-0 hidden xs:block">
        <BarraAvance recibidas={orden.unidades_recibidas} pedidas={orden.unidades_pedidas} />
      </div>

      <div className="flex-shrink-0 flex items-center gap-1.5">
        <ChipPago estado={orden.estado_pago} dias={orden.dias_para_vencer} />
        <ChevronRight size={16} className="text-gray-300" />
      </div>
    </button>
  );
}

// ─── Línea de tiempo de la ficha ──────────────────────────────────────────────
//
// Recepciones, novedades y movimientos en UNA sola columna cronológica. Sin
// pestañas: la pregunta real siempre es "¿qué pasó con este pedido?", no "¿qué
// recepciones tuvo?".
function LineaTiempo({ orden }) {
  const eventos = [];

  eventos.push({
    fecha: orden.fecha_emision,
    titulo: `Orden creada — ${orden.unidades_pedidas} unidades, ${formatCOP(orden.total_estimado)}`,
    detalle: [orden.usuario_nombre, orden.fecha_esperada && `entrega esperada ${formatFecha(orden.fecha_esperada)}`]
      .filter(Boolean).join(' · '),
    Icn: FileText,
  });

  if (orden.numero_factura) {
    eventos.push({
      fecha: orden.fecha_factura || orden.fecha_emision,
      titulo: `Factura ${orden.numero_factura} registrada`,
      detalle: orden.fecha_vencimiento
        ? `${orden.dias_plazo ? `Plazo ${orden.dias_plazo} días · ` : ''}vence ${formatFecha(orden.fecha_vencimiento)}`
        : 'Sin plazo registrado',
      Icn: FileText,
    });
  }

  for (const r of orden.recepciones || []) {
    eventos.push({
      fecha: r.fecha,
      titulo: r.estado === 'Cancelada'
        ? `Recepción anulada — compra #${r.numero ?? r.id}`
        : `Llegaron ${r.unidades} unidades`,
      detalle: `Compra #${r.numero ?? r.id} · ${formatCOP(r.total)}${r.usuario_nombre ? ` · ${r.usuario_nombre}` : ''}`,
      Icn: PackageCheck,
      apagado: r.estado === 'Cancelada',
    });
  }

  if (orden.cerrada_en) {
    eventos.push({
      fecha: orden.cerrada_en,
      titulo: orden.estado === 'Anulada' ? 'Orden anulada' : 'Orden cerrada',
      detalle: orden.motivo_cierre || '',
      Icn: XCircle,
      apagado: true,
    });
  }

  eventos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  return (
    <div className="flex flex-col">
      {eventos.map((e, i) => {
        const Icn = e.Icn;
        const ultimo = i === eventos.length - 1;
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center
                ${e.apagado ? 'bg-gray-100' : 'bg-blue-50'}`}>
                <Icn size={13} className={e.apagado ? 'text-gray-300' : 'text-blue-500'} />
              </div>
              {!ultimo && <div className="w-px flex-1 bg-gray-100 my-1" />}
            </div>
            <div className={`flex-1 min-w-0 ${ultimo ? '' : 'pb-4'}`}>
              <p className={`text-sm font-medium ${e.apagado ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                {e.titulo}
              </p>
              {e.detalle && <p className="text-xs text-gray-400 mt-0.5">{e.detalle}</p>}
              <p className="text-xs text-gray-300 mt-0.5">{formatFechaHora(e.fecha)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Registrar la factura del proveedor ───────────────────────────────────────
//
// La factura del PROVEEDOR: el papel donde él dice cuánto le debes. No tiene
// nada que ver con las facturas que tú le haces a tus clientes.
//
// Va en su propio modal y no dentro de "Editar" porque son dos momentos
// distintos: los productos se definen antes de emitir, y la factura llega
// después —a veces con la mercancía, a veces antes—. Una orden ya emitida no
// puede cambiar lo pedido, pero sí tiene que poder recibir su factura.
function ModalFactura({ open, orden, obligatoria, onClose }) {
  const queryClient = useQueryClient();
  const [numero, setNumero] = useState(orden?.numero_factura || '');
  const [fecha,  setFecha]  = useState(orden?.fecha_factura?.slice(0, 10) || '');
  const [plazo,  setPlazo]  = useState(orden?.dias_plazo ?? '');
  const [error,  setError]  = useState('');

  const mut = useMutation({
    mutationFn: () => editarOrden(orden.id, {
      numero_factura: numero.trim() || null,
      fecha_factura:  fecha || null,
      dias_plazo:     plazo !== '' ? Number(plazo) : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ordenes-compra'], exact: false });
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo guardar la factura'),
  });

  // Se muestra el vencimiento que va a quedar antes de guardar, para que nadie
  // tenga que calcularlo de cabeza.
  const vencimiento = (() => {
    if (!fecha || plazo === '') return null;
    const d = new Date(`${fecha}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + Number(plazo));
    return d.toISOString().slice(0, 10);
  })();

  return (
    <Modal open={open} onClose={onClose} title="Factura del proveedor">
      <div className="flex flex-col gap-4">
        {obligatoria && (
          <div className="bg-amber-50 rounded-xl px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Tu negocio está configurado para deberle al proveedor desde que te
              factura el pedido completo. Registra aquí su factura y ya podrás
              recibir la mercancía.
            </p>
          </div>
        )}

        <Input label="N° de factura" value={numero} autoFocus
          onChange={(e) => setNumero(e.target.value)}
          placeholder="El número que trae el papel del proveedor" />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Fecha de la factura</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
              className="px-3 py-2.5 text-sm bg-gray-100 border-0 rounded-xl text-gray-700
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Plazo (días)</label>
            <input type="number" min="0" max="365" value={plazo} placeholder="30"
              onChange={(e) => setPlazo(e.target.value)}
              className="px-3 py-2.5 text-sm tabular-nums bg-gray-100 border-0 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
          </div>
        </div>

        {vencimiento && (
          <p className="text-xs text-gray-500">
            Le tienes que pagar antes del <strong>{formatFecha(vencimiento)}</strong>.
          </p>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={mut.isPending} onClick={() => mut.mutate()}
            disabled={!numero.trim()}>
            Guardar factura
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal de cierre ──────────────────────────────────────────────────────────
function ModalCerrar({ open, orden, onClose }) {
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [error,  setError]  = useState('');

  const mut = useMutation({
    mutationFn: () => cerrarOrden(orden.id, { motivo: motivo.trim() || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ordenes-compra'], exact: false });
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo cerrar la orden'),
  });

  const pendientes = Number(orden?.unidades_pedidas || 0) - Number(orden?.unidades_recibidas || 0);

  return (
    <Modal open={open} onClose={onClose} title="Ya no va a llegar">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">
          {pendientes > 0
            ? `Quedan ${pendientes} unidades sin recibir. Al cerrar la orden dejas de esperarlas.`
            : 'Esta orden ya llegó completa. Al cerrarla sale de la lista de pendientes.'}
        </p>
        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-xs text-gray-500">
            No toca el inventario ni la deuda: lo que llegó ya se registró, y lo que
            no llegó nunca generó nada.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">¿Qué pasó?</label>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
            placeholder="El proveedor descontinuó el modelo…"
            className="px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none
                       focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={mut.isPending} onClick={() => mut.mutate()}>Cerrar orden</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Ficha de la orden ────────────────────────────────────────────────────────
function FichaOrden({ ordenId, garantiaActiva, modoCargo, detalleNodo, onVolver }) {
  const queryClient = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const [recibiendo, setRecibiendo] = useState(false);
  const [editando,   setEditando]   = useState(false);
  const [facturando, setFacturando] = useState(false);
  const [cerrando,   setCerrando]   = useState(false);
  const [error,      setError]      = useState('');

  const { data: orden, isLoading } = useQuery({
    queryKey: ['ordenes-compra', 'detalle', ordenId],
    queryFn:  () => getOrdenById(ordenId).then((r) => r.data.data),
  });

  const mutEmitir = useMutation({
    mutationFn: () => emitirOrden(ordenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ordenes-compra'], exact: false }),
    onError: (e) => setError(e.response?.data?.error || 'No se pudo emitir'),
  });

  const mutAnular = useMutation({
    mutationFn: () => anularOrden(ordenId, { motivo: 'Anulada desde la ficha' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ordenes-compra'], exact: false });
      onVolver();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo anular'),
  });

  if (isLoading) return <Spinner className="py-20" />;
  if (!orden) return <EmptyState icon={ClipboardList} titulo="Orden no encontrada" />;

  const pendientes = Number(orden.unidades_pedidas) - Number(orden.unidades_recibidas);
  const puedeRecibir = orden.estado === 'Emitida' && pendientes > 0;

  // Con el modo "al facturar la orden", la deuda nace con la factura del
  // proveedor y las entregas solo traen la mercancía. Sin esa factura no se
  // puede recibir: crear la deuda al recibir la duplicaría cuando llegue el
  // papel, y no crearla dejaría mercancía adentro sin nada que deber.
  const faltaFactura = modoCargo === 'orden'
    && orden.estado === 'Emitida'
    && !orden.numero_factura;

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onVolver}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors w-fit">
        <ChevronLeft size={16} /> Órdenes
      </button>

      {/* Cabecera */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-gray-900 truncate">{orden.proveedor_nombre}</h2>
              <ChipEstadoOrden estado={orden.estado} estadoRecepcion={orden.estado_recepcion} />
            </div>
            <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
              OC-{String(orden.numero ?? orden.id).padStart(4, '0')} · {orden.sucursal_nombre}
            </p>
          </div>
          <ChipPago estado={orden.estado_pago} dias={orden.dias_para_vencer} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-1">Mercancía</p>
            <BarraAvance recibidas={orden.unidades_recibidas} pedidas={orden.unidades_pedidas} />
          </div>
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400">Pedido / recibido</p>
            <p className="text-sm font-bold text-gray-900 tabular-nums mt-1">
              {formatCOP(orden.total_estimado)}
            </p>
            <p className="text-xs text-gray-400 tabular-nums">
              llegó {formatCOP(orden.total_recibido)}
            </p>
          </div>
        </div>

        {orden.notas && (
          <p className="text-xs text-gray-500 bg-amber-50 rounded-xl px-3 py-2">{orden.notas}</p>
        )}

        {faltaFactura && (
          <div className="bg-amber-50 rounded-xl px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Falta la factura del proveedor. Tu negocio le debe desde que él factura
              el pedido completo, así que hay que registrarla antes de recibir la
              mercancía.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {orden.estado === 'Borrador' && (
            <>
              <Button size="sm" loading={mutEmitir.isPending} onClick={() => mutEmitir.mutate()}>
                <Send size={14} /> Emitir orden
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditando(true)}>
                Editar
              </Button>
            </>
          )}
          {/* Una orden emitida ya no cambia lo pedido, pero SÍ tiene que poder
              recibir su factura: llega después, y a veces días después. */}
          {orden.estado === 'Emitida' && (
            <Button size="sm" variant={faltaFactura ? 'primary' : 'secondary'}
              onClick={() => setFacturando(true)}>
              <FileText size={14} />
              {orden.numero_factura ? 'Editar factura' : 'Registrar factura'}
            </Button>
          )}
          {puedeRecibir && (
            <Button size="sm" variant={faltaFactura ? 'secondary' : 'primary'}
              onClick={() => setRecibiendo(true)}>
              <PackageCheck size={14} /> Recibir mercancía
            </Button>
          )}
          {(orden.estado === 'Borrador' || orden.estado === 'Emitida') && (
            <Button size="sm" variant="ghost" onClick={() => setCerrando(true)}>
              Ya no va a llegar
            </Button>
          )}
          {esAdminNegocio() && orden.estado !== 'Anulada' && Number(orden.num_recepciones) === 0 && (
            <Button size="sm" variant="ghost" loading={mutAnular.isPending}
              onClick={() => mutAnular.mutate()}
              className="text-red-500 hover:bg-red-50">
              <Ban size={14} /> Anular
            </Button>
          )}
        </div>
      </div>

      {/* Líneas con su avance */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Lo que pediste</h3>
        <div className="flex flex-col gap-2">
          {(orden.lineas || []).map((l) => {
            const completa = Number(l.pendiente) <= 0;
            return (
              <div key={l.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                {l.tipo === 'serial'
                  ? <Smartphone size={14} className="text-gray-300 flex-shrink-0" />
                  : <Package size={14} className="text-gray-300 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{l.nombre_producto}</p>
                  <p className="text-xs text-gray-400 tabular-nums">
                    {completa
                      ? `${l.cantidad_pedida} recibidas · completa`
                      : `${l.recibida} de ${l.cantidad_pedida} · faltan ${l.pendiente}`}
                    {l.precio_estimado ? ` · ${formatCOP(l.precio_estimado)} c/u` : ''}
                  </p>
                </div>
                <div className="w-20 flex-shrink-0">
                  <BarraAvance recibidas={l.recibida} pedidas={l.cantidad_pedida} compacta />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Historia */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Qué ha pasado</h3>
        <LineaTiempo orden={orden} />
      </div>

      {recibiendo && (
        <ModalRecibir open orden={orden} garantiaActiva={garantiaActiva}
          onClose={() => setRecibiendo(false)} />
      )}
      {editando && (
        <ModalOrden open orden={orden} garantiaActiva={garantiaActiva} detalleNodo={detalleNodo}
          proveedor={{ id: orden.proveedor_id, nombre: orden.proveedor_nombre }}
          onClose={() => setEditando(false)} />
      )}
      {facturando && (
        <ModalFactura open orden={orden} obligatoria={faltaFactura}
          onClose={() => setFacturando(false)} />
      )}
      {cerrando && (
        <ModalCerrar open orden={orden} onClose={() => setCerrando(false)} />
      )}
    </div>
  );
}

// ─── Pestaña ──────────────────────────────────────────────────────────────────
export function TabOrdenes({ garantiaActiva, modoCargo, detalleNodo }) {
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const [ordenAbierta, setOrdenAbierta] = useState(null);
  const [creando,      setCreando]      = useState(false);
  const [proveedorSel, setProveedorSel] = useState(null);
  const [busqueda,     setBusqueda]     = useState('');
  const [verTodas,     setVerTodas]     = useState(false);
  const [pagina,       setPagina]       = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['ordenes-compra', ...sucursalKey, busqueda, verTodas, pagina],
    queryFn:  () => getOrdenes({
      q: busqueda || undefined,
      todas: verTodas ? '1' : undefined,
      page: pagina, limit: PAGE_SIZE,
    }).then((r) => r.data.data),
    enabled: sucursalLista,
  });

  const { data: proveedoresData } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => getProveedores().then((r) => norm(r.data.data)),
    enabled:  creando,
  });

  if (ordenAbierta) {
    return (
      <FichaOrden ordenId={ordenAbierta} garantiaActiva={garantiaActiva} detalleNodo={detalleNodo}
        modoCargo={modoCargo} onVolver={() => setOrdenAbierta(null)} />
    );
  }

  const ordenes = data?.rows || [];
  const totalPaginas = data?.totalPages || 1;

  // Las vencidas suben al tope: es lo único de esta lista que cuesta plata.
  const ordenadas = [...ordenes].sort((a, b) => {
    const peso = (o) => o.estado_pago === 'vencida' ? 0 : o.estado_pago === 'por_vencer' ? 1 : 2;
    return peso(a) - peso(b);
  });

  const proveedores = norm(proveedoresData).filter((p) => p.activo !== false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <SearchInput value={busqueda} onChange={(v) => { setBusqueda(v); setPagina(1); }}
            placeholder="Buscar por proveedor, factura o número…" />
        </div>
        <Button onClick={() => setCreando(true)}>
          <Plus size={15} /> <span className="hidden sm:inline">Nueva orden</span>
        </Button>
      </div>

      <label className="flex items-center gap-2 cursor-pointer w-fit">
        <input type="checkbox" checked={verTodas}
          onChange={(e) => { setVerTodas(e.target.checked); setPagina(1); }}
          className="w-4 h-4 rounded accent-blue-600" />
        <span className="text-xs text-gray-500">Ver también las cerradas y anuladas</span>
      </label>

      {isLoading ? <Spinner className="py-20" /> : ordenadas.length === 0 ? (
        <EmptyState icon={ClipboardList} titulo="Sin órdenes"
          descripcion={busqueda
            ? 'Ninguna orden coincide con la búsqueda'
            : 'Crea una orden para llevar la cuenta de lo que le pediste a tus proveedores'} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {ordenadas.map((o) => (
              <FilaOrden key={o.id} orden={o} onAbrir={() => setOrdenAbierta(o.id)} />
            ))}
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors">
                <ChevronLeft size={16} className="text-gray-500" />
              </button>
              <span className="text-xs text-gray-400 tabular-nums">
                {pagina} de {totalPaginas}
              </span>
              <button disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors">
                <ChevronRight size={16} className="text-gray-500" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Elegir proveedor antes de crear: una orden siempre es para alguien */}
      {creando && !proveedorSel && (
        <Modal open onClose={() => setCreando(false)} title="¿A quién le vas a pedir?">
          <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
            {proveedores.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">
                No tienes proveedores registrados todavía
              </p>
            ) : proveedores.map((p) => (
              <button key={p.id} onClick={() => setProveedorSel(p)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-blue-50 text-left transition-colors">
                <Truck size={15} className="text-gray-300 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 truncate">{p.nombre}</p>
                  {p.nit && <p className="text-xs text-gray-400">{p.nit}</p>}
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {creando && proveedorSel && (
        <ModalOrden open proveedor={proveedorSel} garantiaActiva={garantiaActiva} detalleNodo={detalleNodo}
          onClose={() => { setCreando(false); setProveedorSel(null); }} />
      )}
    </div>
  );
}
