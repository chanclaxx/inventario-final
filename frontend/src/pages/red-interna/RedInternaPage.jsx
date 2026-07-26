import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPanel, getSucursales, confirmarRemesa, anularRemision, getConciliacion, getSalud,
} from '../../api/redInterna.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Badge }      from '../../components/ui/Badge';
import { Modal }      from '../../components/ui/Modal';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ModalDespachar } from './ModalDespachar';
import { ModalRecibir }   from './ModalRecibir';
import { ModalRemesa }    from './ModalRemesa';
import {
  Package, PackageCheck, Truck, Send, Store, AlertTriangle, CheckCircle,
  Wallet, ShieldCheck, ChevronRight, X, Clock,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// RED INTERNA — una ruta, dos caras.
//
// El backend decide qué cara devolver según la sucursal activa (`es_bodega`).
// El usuario de un local NUNCA ve las opciones de la bodega y viceversa: esa es
// la razón por la que esta pantalla no abruma pese a cubrir todo el circuito.
//
// Regla de diseño: máximo DOS acciones visibles a la vez. Todo lo demás es
// informativo o vive detrás de "Ver detalle".
// ─────────────────────────────────────────────────────────────────────────────

function Aviso({ mensaje, onCerrar }) {
  if (!mensaje) return null;
  return (
    <div className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200
      rounded-xl px-4 py-3 text-sm text-green-700">
      <CheckCircle size={16} className="flex-shrink-0" />
      <span className="flex-1">{mensaje}</span>
      <button onClick={onCerrar}><X size={15} className="text-green-400" /></button>
    </div>
  );
}

function Tarjeta({ children, className = '' }) {
  return (
    <div className={`bg-white border border-gray-100 rounded-2xl ${className}`}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CARA DEL LOCAL — dos botones y nada más
// ═══════════════════════════════════════════════════════════════════════════

function PanelLocal({ data, onRefrescar, onAviso }) {
  const [recibirId, setRecibirId] = useState(null);
  const [remesa,    setRemesa]    = useState(false);
  const [detalle,   setDetalle]   = useState(false);

  const t = data.totales;
  const porRecibir = data.por_recibir || [];

  return (
    <>
      {/* Acción 1 — hay algo por recibir */}
      {porRecibir.length > 0 && (
        <Tarjeta className="mb-4 border-blue-200 bg-blue-50/50">
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Package size={20} className="text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-gray-900">
                  {porRecibir.length} envío{porRecibir.length > 1 ? 's' : ''} por recibir
                </p>
                {porRecibir.slice(0, 3).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRecibirId(r.id)}
                    className="mt-2 w-full flex items-center justify-between gap-2
                      bg-white rounded-xl px-3 py-2.5 hover:bg-blue-50 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        Envío #{r.numero ?? r.id} · {r.total_items} producto(s)
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatFechaHora(r.fecha_emision)}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Tarjeta>
      )}

      {/* Acción 2 — remitir efectivo */}
      <Tarjeta className="mb-4">
        <div className="p-5 text-center">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            {t.saldo_por_liquidar < 0 ? 'La bodega te debe' : 'Por remitir a bodega'}
          </p>
          <p className={`text-3xl font-bold mt-1 ${
            t.saldo_por_liquidar > 0 ? 'text-gray-900'
            : t.saldo_por_liquidar < 0 ? 'text-blue-600' : 'text-green-600'}`}>
            {formatCOP(Math.abs(t.saldo_por_liquidar))}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {t.saldo_por_liquidar > 0  ? 'de los productos que ya vendiste'
             : t.saldo_por_liquidar < 0 ? 'remitiste de más (o hubo una anulación)'
             : 'Estás al día ✓'}
          </p>

          {t.remesas_en_transito > 0 && (
            <p className="text-xs text-amber-600 mt-2 flex items-center justify-center gap-1.5">
              <Clock size={13} /> {formatCOP(t.remesas_en_transito)} en tránsito, sin confirmar
            </p>
          )}

          <Button className="mt-4 w-full" onClick={() => setRemesa(true)}>
            <Send size={15} /> Enviar remesa
          </Button>
        </div>
      </Tarjeta>

      {/* Informativo — sin botones */}
      <Tarjeta>
        <div className="divide-y divide-gray-50">
          <div className="flex items-center justify-between px-5 py-3.5">
            <div>
              <p className="text-sm font-medium text-gray-700">En consignación</p>
              <p className="text-xs text-gray-400">Sin vender — no es deuda</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-900">{formatCOP(t.en_consignacion_valor)}</p>
              <p className="text-xs text-gray-400">{t.en_consignacion_unidades} equipo(s)</p>
            </div>
          </div>

          {t.en_recaudo_unidades > 0 && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-sm font-medium text-gray-700">Vendido a crédito</p>
                <p className="text-xs text-gray-400">Liquidas a medida que cobras</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">{formatCOP(t.en_recaudo_valor)}</p>
                <p className="text-xs text-gray-400">{t.en_recaudo_unidades} equipo(s)</p>
              </div>
            </div>
          )}

          {t.gastos_autorizados > 0 && (
            <div className="flex items-center justify-between px-5 py-3.5">
              <p className="text-sm font-medium text-gray-700">Gastos por cuenta de bodega</p>
              <p className="text-sm font-semibold text-gray-900">−{formatCOP(t.gastos_autorizados)}</p>
            </div>
          )}

          {t.sin_ubicar_unidades > 0 && (
            <div className="flex items-center justify-between px-5 py-3.5 bg-red-50">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-red-500" />
                <p className="text-sm font-medium text-red-700">Sin ubicar</p>
              </div>
              <p className="text-sm font-semibold text-red-700">{t.sin_ubicar_unidades} equipo(s)</p>
            </div>
          )}

          <button
            onClick={() => setDetalle(true)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm text-blue-600 font-medium">Ver detalle equipo por equipo</span>
            <ChevronRight size={16} className="text-gray-300" />
          </button>
        </div>
      </Tarjeta>

      {recibirId && (
        <ModalRecibir
          remisionId={recibirId}
          onCerrar={() => setRecibirId(null)}
          onListo={(msg) => { setRecibirId(null); onAviso(msg); onRefrescar(); }}
        />
      )}
      {remesa && (
        <ModalRemesa
          sugerido={Math.max(0, t.saldo_por_liquidar)}
          onCerrar={() => setRemesa(false)}
          onListo={() => { setRemesa(false); onAviso('Remesa enviada'); onRefrescar(); }}
        />
      )}
      {detalle && (
        <ModalConciliacion sucursalId={data.sucursal_id} onCerrar={() => setDetalle(false)} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CARA DE LA BODEGA — panel de control
// ═══════════════════════════════════════════════════════════════════════════

function PanelBodega({ data, locales, onRefrescar, onAviso }) {
  const [despachar, setDespachar] = useState(false);
  const [detalle,   setDetalle]   = useState(null);
  const [salud,     setSalud]     = useState(false);

  const confirmar = useMutation({
    mutationFn: (id) => confirmarRemesa(id),
    onSuccess: () => { onAviso('Remesa confirmada'); onRefrescar(); },
  });
  const anular = useMutation({
    mutationFn: (id) => anularRemision(id),
    onSuccess: () => { onAviso('Envío anulado'); onRefrescar(); },
  });

  const remesas    = data.remesas_por_confirmar   || [];
  const enTransito = data.remisiones_en_transito  || [];

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex gap-2 text-sm">
          <div>
            <p className="text-xs text-gray-400">Por liquidar</p>
            <p className="text-lg font-bold text-gray-900">{formatCOP(data.totales.saldo_por_liquidar)}</p>
          </div>
          <div className="ml-5">
            <p className="text-xs text-gray-400">En consignación</p>
            <p className="text-lg font-bold text-gray-500">{formatCOP(data.totales.en_consignacion)}</p>
          </div>
        </div>
        <Button onClick={() => setDespachar(true)}>
          <Truck size={15} /> Despachar
        </Button>
      </div>

      {/* Locales */}
      <Tarjeta className="mb-4">
        <div className="divide-y divide-gray-50">
          {data.locales.length === 0 && (
            <EmptyState icon={Store} titulo="No hay locales"
              descripcion="Crea otra sucursal para empezar a despachar." />
          )}
          {data.locales.map((l) => {
            const t = l.totales;
            return (
              <button
                key={l.sucursal_id}
                onClick={() => setDetalle(l.sucursal_id)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Store size={18} className="text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{l.sucursal_nombre}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t.en_consignacion_unidades} en consignación
                    {t.en_recaudo_unidades > 0 && ` · ${t.en_recaudo_unidades} a crédito`}
                    {t.sin_ubicar_unidades > 0 && (
                      <span className="text-red-500 font-medium"> · {t.sin_ubicar_unidades} sin ubicar ⚠</span>
                    )}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  {t.saldo_por_liquidar > 0
                    ? <p className="text-sm font-bold text-gray-900">{formatCOP(t.saldo_por_liquidar)}</p>
                    : t.saldo_por_liquidar < 0
                      ? <Badge variant="blue">Le debes {formatCOP(Math.abs(t.saldo_por_liquidar))}</Badge>
                      : <Badge variant="green">Al día</Badge>}
                </div>
                <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </Tarjeta>

      {/* Bandejas */}
      {remesas.length > 0 && (
        <Tarjeta className="mb-4 border-green-200">
          <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
            <Wallet size={16} className="text-green-600" />
            <p className="text-sm font-semibold text-gray-800">
              {remesas.length} remesa(s) por confirmar
            </p>
          </div>
          <div className="divide-y divide-gray-50">
            {remesas.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {formatCOP(r.valor)} · {r.sucursal_origen_nombre}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatFechaHora(r.fecha_envio)}
                    {r.usuario_envia_nombre ? ` · ${r.usuario_envia_nombre}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="success"
                  loading={confirmar.isPending && confirmar.variables === r.id}
                  onClick={() => confirmar.mutate(r.id)}
                >
                  <CheckCircle size={14} /> Recibí
                </Button>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      {enTransito.length > 0 && (
        <Tarjeta className="mb-4">
          <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
            <Truck size={16} className="text-amber-500" />
            <p className="text-sm font-semibold text-gray-800">
              {enTransito.length} envío(s) en tránsito
            </p>
          </div>
          <div className="divide-y divide-gray-50">
            {enTransito.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    #{r.numero ?? r.id} → {r.sucursal_destino_nombre}
                  </p>
                  <p className="text-xs text-gray-400">
                    {r.total_items} producto(s) · {formatCOP(r.valor_total)} · {formatFechaHora(r.fecha_emision)}
                  </p>
                </div>
                <Button size="sm" variant="ghost"
                  loading={anular.isPending && anular.variables === r.id}
                  onClick={() => anular.mutate(r.id)}
                >
                  Anular
                </Button>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      <button
        onClick={() => setSalud(true)}
        className="w-full flex items-center justify-center gap-2 py-3 text-sm text-gray-400
          hover:text-gray-600 transition-colors"
      >
        <ShieldCheck size={15} /> Verificar consistencia
      </button>

      {despachar && (
        <ModalDespachar
          locales={locales}
          onCerrar={() => setDespachar(false)}
          onListo={() => { setDespachar(false); onAviso('Remisión enviada'); onRefrescar(); }}
        />
      )}
      {detalle && <ModalConciliacion sucursalId={detalle} onCerrar={() => setDetalle(null)} />}
      {salud   && <ModalSalud onCerrar={() => setSalud(false)} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Conciliación equipo por equipo — "¿cuál ya se vendió y no se ha pagado?"
// ═══════════════════════════════════════════════════════════════════════════

const COLOR_ESTADO = {
  'En consignacion': 'gray',
  'Por liquidar':    'yellow',
  'En recaudo':      'purple',
  'En prestamo':     'blue',
  'Devuelta':        'green',
  'Faltante':        'red',
  'Sin ubicar':      'red',
  'Movida':          'red',
  'En transito':     'blue',
};

function ModalConciliacion({ sucursalId, onCerrar }) {
  const { data, isLoading } = useQuery({
    queryKey: ['red-conciliacion', sucursalId],
    queryFn:  () => getConciliacion(sucursalId).then((r) => r.data.data),
  });

  return (
    <Modal open onClose={onCerrar} title="Detalle equipo por equipo" size="lg">
      {isLoading || !data ? (
        <div className="py-10 flex justify-center"><Spinner /></div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400">Por liquidar</p>
              <p className="text-lg font-bold text-gray-900">
                {formatCOP(Math.max(0, data.totales.saldo_por_liquidar))}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs text-gray-400">Ya remesado</p>
              <p className="text-lg font-bold text-gray-500">
                {formatCOP(data.totales.remesado_recibido)}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
              Vendidos ({data.liquidaciones.length})
            </p>
            {data.liquidaciones.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                Todavía no se ha vendido nada de lo entregado.
              </p>
            ) : (
              <div className="border border-gray-100 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                {data.liquidaciones.map((u) => (
                  <div key={u.linea_id}
                    className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0
                      ${u.liquidada ? 'bg-green-400' : 'bg-amber-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{u.nombre_producto}</p>
                      <p className="text-xs text-gray-400 font-mono">{u.imei}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-gray-700">{formatCOP(u.liquidable)}</p>
                      <p className={`text-xs ${u.liquidada ? 'text-green-600' : 'text-amber-600'}`}>
                        {u.liquidada ? 'Pagado' : 'Pendiente'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
              Todo lo entregado ({data.unidades.length})
            </p>
            <div className="border border-gray-100 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
              {data.unidades.map((u) => (
                <div key={u.linea_id}
                  className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{u.nombre_producto}</p>
                    <p className="text-xs text-gray-400 font-mono">{u.imei}</p>
                  </div>
                  <Badge variant={COLOR_ESTADO[u.estado_unidad] || 'gray'}>
                    {u.etiqueta_estado}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel de salud — los invariantes, verificables a demanda
// ═══════════════════════════════════════════════════════════════════════════

function ModalSalud({ onCerrar }) {
  const { data, isLoading } = useQuery({
    queryKey: ['red-salud'],
    queryFn:  () => getSalud().then((r) => r.data.data),
  });

  const filas = data ? [
    ['Equipos sin ubicar',                data.sin_ubicar.length],
    ['Equipos movidos fuera de su local', data.movidas.length],
    ['Envíos en tránsito hace +7 días',   data.transito_vencido.length],
    ['Remesas sin movimiento de dinero',  data.remesas_huerfanas.length],
    ['IMEIs duplicados en inventario',    data.imeis_duplicados.length],
  ] : [];

  return (
    <Modal open onClose={onCerrar} title="Consistencia de la red" size="md">
      {isLoading || !data ? (
        <div className="py-10 flex justify-center"><Spinner /></div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className={`rounded-xl px-4 py-3 flex items-center gap-2
            ${data.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {data.ok ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <span className="text-sm font-medium">
              {data.ok ? 'Todo cuadra' : `${data.problemas} punto(s) por revisar`}
            </span>
          </div>

          <div className="border border-gray-100 rounded-xl overflow-hidden">
            {filas.map(([label, n]) => (
              <div key={label}
                className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-700">{label}</span>
                <span className={`text-sm font-semibold ${n > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {n > 0 ? n : '✓'}
                </span>
              </div>
            ))}
          </div>

          {data.sin_ubicar.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Sin ubicar</p>
              <div className="border border-red-100 bg-red-50/40 rounded-xl overflow-hidden">
                {data.sin_ubicar.slice(0, 10).map((u) => (
                  <div key={u.linea_id} className="px-3 py-2 border-b border-red-100/50 last:border-0">
                    <p className="text-sm text-gray-800">{u.nombre_producto}</p>
                    <p className="text-xs text-gray-400 font-mono">{u.imei}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Entregados al local, pero no están en su inventario, no aparecen vendidos
                y no fueron devueltos.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

export default function RedInternaPage() {
  const qc = useQueryClient();
  const [aviso, setAviso] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['red-panel'],
    queryFn:  () => getPanel().then((r) => r.data.data),
  });

  const { data: sucursales } = useQuery({
    queryKey: ['red-sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['red-panel'] });
    qc.invalidateQueries({ queryKey: ['red-conciliacion'] });
    qc.invalidateQueries({ queryKey: ['red-salud'] });
    // El movimiento afecta inventario y dinero: refrescar lo que el usuario
    // podría estar mirando en otra pestaña.
    qc.invalidateQueries({ queryKey: ['inventario'] });
    qc.invalidateQueries({ queryKey: ['tesoreria'] });
    qc.invalidateQueries({ queryKey: ['caja'] });
  };

  if (isLoading) {
    return <div className="py-20 flex justify-center"><Spinner /></div>;
  }

  if (isError) {
    const status = error?.response?.status;
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <EmptyState
          icon={Package}
          titulo={status === 409 ? 'Falta configurar la bodega' : 'Red interna no disponible'}
          descripcion={
            error?.response?.data?.error ||
            'Este negocio no tiene activada la distribución desde bodega.'
          }
        />
      </div>
    );
  }

  const locales = (sucursales || []).filter((s) => !s.es_bodega);

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
          {data.es_bodega
            ? <Truck size={18} className="text-blue-600" />
            : <PackageCheck size={18} className="text-blue-600" />}
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Bodega</h1>
          <p className="text-xs text-gray-400">
            {data.es_bodega ? 'Distribución a los locales' : 'Tu cuenta con la bodega'}
          </p>
        </div>
      </div>

      <Aviso mensaje={aviso} onCerrar={() => setAviso('')} />

      {data.es_bodega
        ? <PanelBodega data={data} locales={locales} onRefrescar={refrescar} onAviso={setAviso} />
        : <PanelLocal  data={data} onRefrescar={refrescar} onAviso={setAviso} />}
    </div>
  );
}
