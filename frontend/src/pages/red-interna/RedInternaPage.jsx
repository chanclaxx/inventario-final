import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPanel, getSucursales, confirmarRemesa, anularRemesa, anularRemision,
  confirmarDevolucion, getSalud,
} from '../../api/redInterna.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Badge }      from '../../components/ui/Badge';
import { Modal }      from '../../components/ui/Modal';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { ModalDespachar } from './ModalDespachar';
import { CuentaLocal }   from './CuentaLocal';
import {
  Package, PackageCheck, Truck, Store, AlertTriangle, CheckCircle,
  Wallet, ShieldCheck, ChevronRight, X, Undo2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// RED INTERNA — una ruta, dos caras.
//
// El backend decide qué cara devolver según la sucursal activa (`es_bodega`).
// El usuario de un local NUNCA ve las opciones de la bodega y viceversa: esa es
// la razón por la que esta pantalla no abruma pese a cubrir todo el circuito.
//
// La cara del LOCAL es su cuenta con la bodega (CuentaLocal.jsx): las dos
// cifras arriba —lo que debe y lo que tiene que remitir— y cinco pestañas.
// La cara de la BODEGA es un panel de control: bandejas de confirmación y la
// lista de locales, y abre ESA MISMA cuenta para revisar cualquiera de ellos.
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
// CARA DE LA BODEGA — panel de control
// ═══════════════════════════════════════════════════════════════════════════

function PanelBodega({ data, locales, onRefrescar, onAviso, onVerCuenta }) {
  const [despachar, setDespachar] = useState(false);
  const [salud,     setSalud]     = useState(false);

  const confirmar = useMutation({
    mutationFn: (id) => confirmarRemesa(id),
    onSuccess: () => { onAviso('Pago confirmado'); onRefrescar(); },
  });
  // "No me llegó": deshace el pago y libera los envíos que estaba tapando.
  // El backend lo soportaba desde julio y no había botón en ninguna pantalla.
  const rechazar = useMutation({
    mutationFn: (id) => anularRemesa(id),
    onSuccess: () => { onAviso('Pago anulado — los envíos vuelven a quedar abiertos'); onRefrescar(); },
    onError: (e) => onAviso(e?.response?.data?.error || 'No se pudo anular'),
  });
  const anular = useMutation({
    mutationFn: (id) => anularRemision(id),
    onSuccess: () => { onAviso('Envío anulado'); onRefrescar(); },
  });
  const confirmarDev = useMutation({
    mutationFn: (id) => confirmarDevolucion(id).then((r) => r.data),
    onSuccess: (res) => { onAviso(res.message || 'Devolución confirmada'); onRefrescar(); },
  });

  const remesas     = data.remesas_por_confirmar      || [];
  const enTransito  = data.remisiones_en_transito     || [];
  const devoluciones = data.devoluciones_por_confirmar || [];

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex gap-2 text-sm">
          <div>
            <p className="text-xs text-gray-400">Te deben</p>
            <p className="text-lg font-bold text-gray-900">{formatCOP(data.totales.deuda)}</p>
          </div>
          <div className="ml-5">
            <p className="text-xs text-gray-400">Envíos abiertos</p>
            <p className="text-lg font-bold text-gray-500">{data.totales.envios_abiertos}</p>
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
                onClick={() => onVerCuenta(l.sucursal_id, l.sucursal_nombre)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Store size={18} className="text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{l.sucursal_nombre}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t.envios_abiertos > 0
                      ? `${t.envios_abiertos} envío(s) sin pagar`
                      : `${t.envios_total} envío(s), todos pagados`}
                    {t.en_consignacion_unidades > 0 && ` · ${t.en_consignacion_unidades} en vitrina`}
                    {t.sin_ubicar_unidades > 0 && (
                      <span className="text-red-500 font-medium"> · {t.sin_ubicar_unidades} sin ubicar ⚠</span>
                    )}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  {t.saldo_por_liquidar > 0
                    ? <p className="text-sm font-bold text-gray-900">{formatCOP(t.saldo_por_liquidar)}</p>
                    : t.saldo_a_favor > 0
                      ? <Badge variant="blue">{formatCOP(t.saldo_a_favor)} a favor</Badge>
                      : <Badge variant="green">Al día</Badge>}
                </div>
                <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </Tarjeta>

      {/* Bandejas */}
      {devoluciones.length > 0 && (
        <Tarjeta className="mb-4 border-amber-200">
          <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
            <Undo2 size={16} className="text-amber-600" />
            <p className="text-sm font-semibold text-gray-800">
              {devoluciones.length} devolución(es) por revisar
            </p>
          </div>
          <div className="divide-y divide-gray-50">
            {devoluciones.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    #{d.numero ?? d.id} · {d.total_items} producto(s)
                  </p>
                  <p className="text-xs text-gray-400">
                    De {d.sucursal_origen_nombre} · {formatFechaHora(d.fecha_emision)}
                  </p>
                  {d.notas && <p className="text-xs text-gray-400 italic">{d.notas}</p>}
                </div>
                <Button size="sm" variant="success"
                  loading={confirmarDev.isPending && confirmarDev.variables === d.id}
                  onClick={() => confirmarDev.mutate(d.id)}
                >
                  <CheckCircle size={14} /> Recibí
                </Button>
              </div>
            ))}
          </div>
        </Tarjeta>
      )}

      {remesas.length > 0 && (
        <Tarjeta className="mb-4 border-green-200">
          <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
            <Wallet size={16} className="text-green-600" />
            <p className="text-sm font-semibold text-gray-800">
              {remesas.length} pago(s) por confirmar
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
                <Button size="sm" variant="ghost"
                  loading={rechazar.isPending && rechazar.variables === r.id}
                  onClick={() => rechazar.mutate(r.id)}
                >
                  No llegó
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
      {salud   && <ModalSalud onCerrar={() => setSalud(false)} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Conciliación equipo por equipo — "¿cuál ya se vendió y no se ha pagado?"
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
  const [aviso,  setAviso]  = useState('');
  // Cuando hay una cuenta abierta, la pantalla se dedica a ella.
  const [cuenta, setCuenta] = useState(null); // { id, nombre }

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
    qc.invalidateQueries({ queryKey: ['red-estado-cuenta'] });
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

      {/* La bodega abre la cuenta de un local; el local ve la suya de entrada,
          con los botones de recibir y pagar que la bodega no necesita. */}
      {cuenta ? (
        <CuentaLocal
          sucursalId={cuenta.id}
          nombre={cuenta.nombre}
          esBodega={data.es_bodega === true}
          onVolver={() => setCuenta(null)}
          onRefrescar={refrescar}
          onAviso={setAviso}
        />
      ) : data.es_bodega ? (
        <PanelBodega data={data} locales={locales} onRefrescar={refrescar} onAviso={setAviso}
          onVerCuenta={(id, nombre) => setCuenta({ id, nombre })} />
      ) : (
        <CuentaLocal
          sucursalId={data.sucursal_id}
          propia
          panel={data}
          onRefrescar={refrescar}
          onAviso={setAviso}
        />
      )}
    </div>
  );
}
