import { useState }                               from 'react';
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query';
import {
  getOrdenes, getOrdenById, getResumenHoy,
  crearOrden, marcarEnReparacion, marcarListo,
  registrarAbono, entregarOrden, sinReparar,
  abrirGarantia,
} from '../../api/servicios.api';
import { getClientes }                from '../../api/clientes.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Badge }       from '../../components/ui/Badge';
import { Button }      from '../../components/ui/Button';
import { Modal }       from '../../components/ui/Modal';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import {
  Wrench, Plus, ChevronRight, ChevronLeft,
  AlertTriangle, CheckCircle, RefreshCw, Search,
  ChevronDown, ChevronUp, Smartphone, User, Clock,
} from 'lucide-react';

// ─── Constantes ───────────────────────────────────────────────────────────────

const ESTADOS_CONFIG = {
  Recibido:      { badge: 'blue',   label: 'Recibido',       border: 'border-l-blue-400'   },
  En_reparacion: { badge: 'yellow', label: 'En reparación',  border: 'border-l-amber-400'  },
  Listo:         { badge: 'green',  label: 'Listo',          border: 'border-l-green-400'  },
  Entregado:     { badge: 'gray',   label: 'Entregado',      border: 'border-l-gray-300'   },
  Sin_reparar:   { badge: 'red',    label: 'Sin reparar',    border: 'border-l-red-300'    },
  Garantia:      { badge: 'purple', label: 'Garantía',       border: 'border-l-purple-400' },
};

const METODOS_PAGO    = ['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Otro'];
const TIPOS_EQUIPO    = ['Celular', 'Tablet', 'Computador', 'Portátil', 'Consola', 'Otro'];
const MOTIVOS_SIN_REPARAR = [
  'No fue posible reparar',
  'Cliente no aceptó el precio',
  'Falta de repuestos',
  'Otro',
];

const ESTADOS_ACTIVOS  = ['Recibido', 'En_reparacion', 'Listo', 'Garantia'];
const ESTADOS_CERRADOS = ['Entregado', 'Sin_reparar'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const cfg         = (estado) => ESTADOS_CONFIG[estado] || { badge: 'gray', label: estado, border: 'border-l-gray-300' };
const nombreEquipo = (o) => [o.equipo_marca, o.equipo_modelo].filter(Boolean).join(' ') || o.equipo_tipo || 'Equipo';

// ─── MetricCard (mismo estilo que ReportesPage) ───────────────────────────────

function MetricCard({ label, valor, colorClass, sub }) {
  return (
    <div className={`rounded-2xl p-4 ${colorClass}`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-xl font-bold mt-1">{valor}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Barra de cobro ───────────────────────────────────────────────────────────

function BarraCobro({ abonado, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((abonado / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{formatCOP(abonado)} abonado</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-green-500 transition-all duration-300"
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── CardOrden (estilo FilaFactura con border-l de color) ────────────────────

function CardOrden({ orden, onAccion }) {
  const [expandida, setExpandida] = useState(false);
  const estado   = cfg(orden.estado);
  const saldo    = Number(orden.saldo_pendiente) || 0;
  const esCerrado = ESTADOS_CERRADOS.includes(orden.estado);

  return (
    <div className={`bg-white border border-gray-100 border-l-4 ${estado.border}
      rounded-xl overflow-hidden shadow-sm transition-all`}>

      {/* Cabecera — siempre visible */}
      <button onClick={() => setExpandida((v) => !v)}
        className="w-full px-4 py-3 flex items-start justify-between hover:bg-gray-50 transition-colors text-left gap-3">

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 font-mono font-medium">
              #OS-{String(orden.id).padStart(4, '0')}
            </span>
            <Badge variant={estado.badge}>{estado.label}</Badge>
          </div>
          <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">
            {nombreEquipo(orden)}{orden.equipo_color ? ` · ${orden.equipo_color}` : ''}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <User size={11} /> {orden.cliente_nombre}
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock size={11} /> {formatFechaHora(orden.fecha_recepcion)}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {orden.precio_final
            ? <p className="text-sm font-bold text-gray-900">{formatCOP(Number(orden.precio_final))}</p>
            : orden.costo_estimado
              ? <p className="text-xs text-gray-400">Est. {formatCOP(Number(orden.costo_estimado))}</p>
              : null
          }
          {saldo > 0 && ['Listo','Garantia'].includes(orden.estado) && (
            <p className="text-xs font-semibold text-red-500">Saldo {formatCOP(saldo)}</p>
          )}
          {expandida ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </button>

      {/* Detalle expandido */}
      {expandida && (
        <div className="px-4 pb-4 flex flex-col gap-3 bg-gray-50 border-t border-gray-100">

          {/* Falla */}
          <p className="text-sm text-gray-600 pt-3">{orden.falla_reportada}</p>

          {/* Barra de cobro */}
          {orden.precio_final && orden.estado !== 'Sin_reparar' && (
            <BarraCobro
              abonado={Number(orden.total_abonado) || 0}
              total={Number(orden.precio_final)}
            />
          )}

          {/* Info extra */}
          {(orden.notas_tecnico || orden.equipo_serial || orden.motivo_sin_reparar || orden.utilidad != null) && (
            <div className="flex flex-col gap-1">
              {orden.equipo_serial   && <p className="text-xs text-gray-400 font-mono">Serial: {orden.equipo_serial}</p>}
              {orden.notas_tecnico   && <p className="text-xs text-gray-500">Notas: {orden.notas_tecnico}</p>}
              {orden.motivo_sin_reparar && <p className="text-xs text-orange-600">Motivo: {orden.motivo_sin_reparar}</p>}
              {orden.utilidad != null && (
                <p className={`text-xs font-semibold ${Number(orden.utilidad) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  Utilidad: {formatCOP(Number(orden.utilidad))}
                </p>
              )}
            </div>
          )}

          {/* Acciones */}
          <AccionesOrden orden={orden} onAccion={onAccion} />
        </div>
      )}

      {/* Si está cerrado, botón Ver detalle siempre visible */}
      {esCerrado && !expandida && (
        <div className="px-4 pb-3">
          <button onClick={() => onAccion('detalle', orden)}
            className="text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2">
            Ver detalle
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Acciones por estado ──────────────────────────────────────────────────────

function AccionesOrden({ orden, onAccion }) {
  const estado = orden.estado;
  return (
    <div className="flex gap-2 flex-wrap pt-1">
      <button onClick={() => onAccion('detalle', orden)}
        className="text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2">
        Ver detalle
      </button>

      {estado === 'Recibido' && (
        <>
          <Button size="sm" onClick={() => onAccion('en-reparacion', orden)}>En reparación</Button>
          <Button size="sm" variant="secondary" onClick={() => onAccion('sin-reparar', orden)}>Sin reparar</Button>
        </>
      )}
      {estado === 'En_reparacion' && (
        <>
          <Button size="sm" onClick={() => onAccion('listo', orden)}>Marcar listo</Button>
          <Button size="sm" variant="secondary" onClick={() => onAccion('sin-reparar', orden)}>Sin reparar</Button>
        </>
      )}
      {estado === 'Listo' && (
        <>
          <Button size="sm" onClick={() => onAccion('abono', orden)}><Plus size={13} /> Abono</Button>
          <Button size="sm" variant="secondary" onClick={() => onAccion('entregar', orden)}>
            <CheckCircle size={13} /> Entregar
          </Button>
        </>
      )}
      {estado === 'Garantia' && (
        <>
          <Button size="sm" onClick={() => onAccion('listo', orden)}>Marcar listo</Button>
          {orden.garantia_cobrable && (
            <Button size="sm" variant="secondary" onClick={() => onAccion('abono', orden)}>
              <Plus size={13} /> Abono
            </Button>
          )}
        </>
      )}
      {estado === 'Entregado' && (
        <Button size="sm" variant="secondary" onClick={() => onAccion('garantia', orden)}>
          <RefreshCw size={13} /> Garantía
        </Button>
      )}
    </div>
  );
}

// ─── Indicador de paso ────────────────────────────────────────────────────────

function PasoIndicador({ paso, total, labels }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        return (
          <div key={n} className="flex items-center gap-2 flex-1">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all
              ${paso > n ? 'bg-blue-100 text-blue-600' : paso === n ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
              {n}
            </div>
            <span className={`text-xs hidden sm:block truncate ${paso >= n ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
              {labels[i]}
            </span>
            {n < total && <div className={`flex-1 h-px ${paso > n ? 'bg-blue-300' : 'bg-gray-200'}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Modal: Nueva orden (wizard 3 pasos) ──────────────────────────────────────

function ModalNuevaOrden({ onClose, onCreada }) {
  const [paso, setPaso] = useState(1);
  const [form, setForm] = useState({
    cliente_nombre: '', cliente_telefono: '', cliente_id: '',
    equipo_tipo: '', equipo_marca: '', equipo_modelo: '',
    equipo_color: '', equipo_serial: '',
    falla_reportada: '', contrasena_equipo: '', notas_tecnico: '', costo_estimado: '',
  });
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [error, setError] = useState('');

  const set = (campo, val) => setForm((f) => ({ ...f, [campo]: val }));

  const { data: clientesData } = useQuery({
    queryKey: ['clientes-servicio', busquedaCliente],
    queryFn:  () => getClientes(busquedaCliente).then((r) => r.data.data),
    enabled:  busquedaCliente.trim().length > 1,
  });
  const clientes = clientesData || [];

  const mutCrear = useMutation({
    mutationFn: () => crearOrden({
      cliente_nombre:    form.cliente_nombre.trim(),
      cliente_telefono:  form.cliente_telefono  || null,
      cliente_id:        form.cliente_id        || null,
      equipo_tipo:       form.equipo_tipo        || null,
      equipo_marca:      form.equipo_marca       || null,
      equipo_modelo:     form.equipo_modelo      || null,
      equipo_color:      form.equipo_color       || null,
      equipo_serial:     form.equipo_serial      || null,
      falla_reportada:   form.falla_reportada.trim(),
      contrasena_equipo: form.contrasena_equipo  || null,
      notas_tecnico:     form.notas_tecnico      || null,
      costo_estimado:    form.costo_estimado !== '' ? Number(form.costo_estimado) : null,
    }),
    onSuccess: (res) => { onCreada(res.data.data); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'Error al crear la orden'),
  });

  const seleccionarCliente = (c) => {
    setForm((f) => ({
      ...f,
      cliente_nombre:   c.nombre,
      cliente_telefono: c.celular || f.cliente_telefono,
      cliente_id:       String(c.id),
    }));
    setBusquedaCliente('');
  };

  const validarPaso1 = () => {
    if (!form.cliente_nombre.trim()) { setError('El nombre del cliente es requerido'); return false; }
    return true;
  };
  const validarPaso3 = () => {
    if (!form.falla_reportada.trim()) { setError('La falla reportada es requerida'); return false; }
    return true;
  };

  const irPaso = (n) => { setError(''); setPaso(n); };
  const siguiente = () => {
    if (paso === 1 && !validarPaso1()) return;
    irPaso(paso + 1);
  };

  return (
    <Modal open onClose={onClose} title="Nueva orden de servicio" size="md">
      <PasoIndicador paso={paso} total={3} labels={['Cliente', 'Equipo', 'Falla']} />

      {/* ── Paso 1: Cliente ── */}
      {paso === 1 && (
        <div className="flex flex-col gap-3">
          {/* Buscador cliente registrado */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Buscar cliente registrado <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Nombre o cédula..."
                value={busquedaCliente}
                onChange={(e) => setBusquedaCliente(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl
                  text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
            </div>
            {clientes.length > 0 && busquedaCliente.trim().length > 1 && (
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                {clientes.slice(0, 4).map((c) => {
                  const cId = c.id;
                  return (
                    <button key={cId} onClick={() => seleccionarCliente(c)}
                      className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b border-gray-50 last:border-0 text-sm">
                      <p className="font-medium text-gray-800">{c.nombre}</p>
                      {c.cedula && <p className="text-xs text-gray-400">CC: {c.cedula}</p>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {form.cliente_id && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
              <User size={14} className="text-blue-500" />
              <p className="text-sm text-blue-700 font-medium flex-1">{form.cliente_nombre}</p>
              <button onClick={() => setForm((f) => ({ ...f, cliente_id: '', cliente_nombre: '', cliente_telefono: '' }))}
                className="text-xs text-blue-400 hover:text-blue-600">Cambiar</button>
            </div>
          )}

          {!form.cliente_id && (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Nombre *" placeholder="Nombre del cliente"
                value={form.cliente_nombre}
                onChange={(e) => set('cliente_nombre', e.target.value)} autoFocus />
              <Input label="Teléfono" placeholder="3001234567"
                value={form.cliente_telefono}
                onChange={(e) => set('cliente_telefono', e.target.value)} />
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1" onClick={siguiente}>
              Siguiente <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}

      {/* ── Paso 2: Equipo ── */}
      {paso === 2 && (
        <div className="flex flex-col gap-3">
          <div className="bg-blue-50 rounded-xl px-3 py-2.5">
            <p className="text-xs text-blue-500">Cliente</p>
            <p className="text-sm font-semibold text-blue-800">{form.cliente_nombre}</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Tipo de equipo</label>
            <div className="flex gap-2 flex-wrap">
              {TIPOS_EQUIPO.map((t) => {
                const tipoKey = t;
                return (
                  <button key={tipoKey} onClick={() => set('equipo_tipo', t)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                      ${form.equipo_tipo === t
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Marca" placeholder="Samsung, Apple..."
              value={form.equipo_marca} onChange={(e) => set('equipo_marca', e.target.value)} autoFocus />
            <Input label="Modelo" placeholder="Galaxy A32..."
              value={form.equipo_modelo} onChange={(e) => set('equipo_modelo', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Color" placeholder="Negro, blanco..."
              value={form.equipo_color} onChange={(e) => set('equipo_color', e.target.value)} />
            <Input label="Serial / IMEI" placeholder="Opcional"
              value={form.equipo_serial} onChange={(e) => set('equipo_serial', e.target.value)} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={() => irPaso(1)}>
              <ChevronLeft size={15} /> Volver
            </Button>
            <Button className="flex-1" onClick={() => irPaso(3)}>
              Siguiente <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}

      {/* ── Paso 3: Falla ── */}
      {paso === 3 && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blue-50 rounded-xl px-3 py-2">
              <p className="text-xs text-blue-500">Cliente</p>
              <p className="text-sm font-semibold text-blue-800 truncate">{form.cliente_nombre}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-400">Equipo</p>
              <p className="text-sm font-semibold text-gray-700 truncate">
                {[form.equipo_marca, form.equipo_modelo].filter(Boolean).join(' ') || form.equipo_tipo || '—'}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Falla reportada *</label>
            <textarea placeholder="Describe la falla que reporta el cliente..."
              value={form.falla_reportada}
              onChange={(e) => set('falla_reportada', e.target.value)}
              rows={3} autoFocus
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Costo estimado</label>
              <InputMoneda value={form.costo_estimado} onChange={(val) => set('costo_estimado', val)}
                placeholder="0"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                  text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <Input label="Contraseña / patrón"
              placeholder="Solo para técnico"
              value={form.contrasena_equipo}
              onChange={(e) => set('contrasena_equipo', e.target.value)} />
          </div>

          {form.contrasena_equipo && (
            <p className="text-xs text-orange-500 -mt-1">
              Solo visible internamente. No aparece en comprobantes.
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Notas técnico <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <textarea placeholder="Observaciones internas..."
              value={form.notas_tecnico}
              onChange={(e) => set('notas_tecnico', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" onClick={() => irPaso(2)}>
              <ChevronLeft size={15} /> Volver
            </Button>
            <Button className="flex-1" loading={mutCrear.isPending}
              disabled={!form.falla_reportada.trim()}
              onClick={() => { if (validarPaso3()) mutCrear.mutate(); }}>
              Crear orden
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Modal: Marcar listo ──────────────────────────────────────────────────────

function ModalMarcarListo({ orden, onClose, onExito }) {
  const [costoReal,   setCostoReal]   = useState('');
  const [precioFinal, setPrecioFinal] = useState(
    orden.costo_estimado ? Number(orden.costo_estimado) : ''
  );
  const [notas, setNotas] = useState(orden.notas_tecnico || '');
  const [error, setError] = useState('');

  const mutListo = useMutation({
    mutationFn: () => marcarListo(orden.id, {
      costo_real:    costoReal   !== '' ? Number(costoReal)   : null,
      precio_final:  precioFinal !== '' ? Number(precioFinal) : null,
      notas_tecnico: notas || null,
    }),
    onSuccess: () => { onExito(); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'Error'),
  });

  const utilidad = costoReal !== '' && precioFinal !== ''
    ? Number(precioFinal) - Number(costoReal)
    : null;

  return (
    <Modal open onClose={onClose} title="Marcar como listo" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
          <p className="text-sm font-semibold text-green-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-green-600">{orden.cliente_nombre}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Costo del arreglo <span className="text-gray-400 font-normal">(repuestos + mano de obra)</span>
          </label>
          <InputMoneda value={costoReal} onChange={setCostoReal} placeholder="0"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-gray-400">Se usa para calcular tu utilidad.</p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">¿Cuánto le cobras al cliente? *</label>
          <InputMoneda value={precioFinal} onChange={setPrecioFinal} placeholder="0"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {orden.costo_estimado && (
            <p className="text-xs text-gray-400">
              Estimado original: {formatCOP(Number(orden.costo_estimado))}
            </p>
          )}
        </div>

        {utilidad !== null && (
          <div className={`rounded-xl px-3 py-2.5 text-sm font-semibold
            ${utilidad >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            Utilidad estimada: {formatCOP(utilidad)}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Notas del técnico <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
            placeholder="Qué se hizo, repuestos usados..."
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutListo.isPending}
            disabled={precioFinal === ''}
            onClick={() => mutListo.mutate()}>
            Marcar listo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: Abono ─────────────────────────────────────────────────────────────

function ModalAbono({ orden, onClose, onExito }) {
  const [valor,  setValor]  = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [notas,  setNotas]  = useState('');
  const [error,  setError]  = useState('');

  const saldo = Number(orden.precio_final || 0) - Number(orden.total_abonado || 0);

  const mutAbono = useMutation({
    mutationFn: () => registrarAbono(orden.id, { valor: Number(valor), metodo, notas: notas || null }),
    onSuccess:  () => { onExito(); onClose(); },
    onError:    (err) => setError(err.response?.data?.error || 'Error'),
  });

  return (
    <Modal open onClose={onClose} title="Registrar abono" size="sm">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-gray-50 rounded-xl px-3 py-2 col-span-1">
            <p className="text-xs text-gray-400">Total</p>
            <p className="text-sm font-bold text-gray-800">{formatCOP(Number(orden.precio_final))}</p>
          </div>
          <div className="bg-green-50 rounded-xl px-3 py-2 col-span-1">
            <p className="text-xs text-green-500">Abonado</p>
            <p className="text-sm font-bold text-green-700">{formatCOP(Number(orden.total_abonado))}</p>
          </div>
          <div className="bg-red-50 rounded-xl px-3 py-2 col-span-1">
            <p className="text-xs text-red-400">Saldo</p>
            <p className="text-sm font-bold text-red-600">{formatCOP(saldo)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor del abono *</label>
          <InputMoneda value={valor} onChange={setValor} placeholder="0"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Método</label>
          <div className="flex gap-2 flex-wrap">
            {METODOS_PAGO.map((m) => {
              const mKey = m;
              return (
                <button key={mKey} onClick={() => setMetodo(m)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                    ${metodo === m ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  {m}
                </button>
              );
            })}
          </div>
        </div>

        <Input label="Notas (opcional)" placeholder="Observaciones..."
          value={notas} onChange={(e) => setNotas(e.target.value)} />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutAbono.isPending}
            disabled={!valor || Number(valor) <= 0}
            onClick={() => mutAbono.mutate()}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: Entregar ──────────────────────────────────────────────────────────

function ModalEntregar({ orden, onClose, onExito }) {
  const [forzar,      setForzar]      = useState(false);
  const [saldoAlerta, setSaldoAlerta] = useState(null);
  const [error,       setError]       = useState('');

  const saldo = Number(orden.precio_final || 0) - Number(orden.total_abonado || 0);

  const mutEntregar = useMutation({
    mutationFn: () => entregarOrden(orden.id, forzar),
    onSuccess:  () => { onExito(); onClose(); },
    onError:    (err) => {
      if (err.response?.status === 409) setSaldoAlerta(err.response.data.saldo);
      else setError(err.response?.data?.error || 'Error al entregar');
    },
  });

  return (
    <Modal open onClose={onClose} title="Entregar equipo" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-sm font-semibold text-gray-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-gray-500">{orden.cliente_nombre}</p>
          {orden.precio_final && (
            <p className="text-xs text-gray-400 mt-1">
              Total: {formatCOP(Number(orden.precio_final))} ·
              Abonado: {formatCOP(Number(orden.total_abonado))}
            </p>
          )}
        </div>

        {!saldoAlerta && saldo <= 0 && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
            <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700 font-medium">Pago completo — listo para entregar</p>
          </div>
        )}

        {(saldoAlerta || saldo > 0) && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-3">
              <AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-orange-700">Saldo pendiente</p>
                <p className="text-xs text-orange-600 mt-0.5">
                  El cliente debe {formatCOP(saldoAlerta || saldo)}. ¿Entregar igual?
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} className="rounded" />
              <span className="text-sm text-gray-700">Sí, entregar aunque quede saldo pendiente</span>
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutEntregar.isPending}
            disabled={saldoAlerta !== null && !forzar && saldo > 0}
            onClick={() => mutEntregar.mutate()}>
            Confirmar entrega
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: Sin reparar ───────────────────────────────────────────────────────

function ModalSinReparar({ orden, onClose, onExito }) {
  const [motivo, setMotivo] = useState('');
  const [precio, setPrecio] = useState('');
  const [error,  setError]  = useState('');

  const mutSinReparar = useMutation({
    mutationFn: () => sinReparar(orden.id, {
      motivo,
      precio_diagnostico: precio !== '' ? Number(precio) : null,
    }),
    onSuccess: () => { onExito(); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'Error'),
  });

  return (
    <Modal open onClose={onClose} title="Devolver sin reparar" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5">
          <p className="text-sm font-semibold text-orange-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-orange-600">{orden.cliente_nombre}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Motivo *</label>
          {MOTIVOS_SIN_REPARAR.map((m) => {
            const mKey = m;
            return (
              <label key={mKey} className="flex items-center gap-2 cursor-pointer py-1">
                <input type="radio" name="motivo" value={m} checked={motivo === m}
                  onChange={() => setMotivo(m)} />
                <span className="text-sm text-gray-700">{m}</span>
              </label>
            );
          })}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Cobro por diagnóstico <span className="text-gray-400 font-normal">(opcional — se paga ahora)</span>
          </label>
          <InputMoneda value={precio} onChange={setPrecio} placeholder="0"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutSinReparar.isPending}
            disabled={!motivo} onClick={() => mutSinReparar.mutate()}>
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: Garantía ─────────────────────────────────────────────────────────

function ModalGarantia({ orden, onClose, onExito }) {
  const [cobrable, setCobrable] = useState(false);
  const [notas,    setNotas]    = useState('');
  const [error,    setError]    = useState('');

  const mutGarantia = useMutation({
    mutationFn: () => abrirGarantia(orden.id, { cobrable, notas_tecnico: notas || null }),
    onSuccess:  () => { onExito(); onClose(); },
    onError:    (err) => setError(err.response?.data?.error || 'Error'),
  });

  return (
    <Modal open onClose={onClose} title="Activar garantía" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5">
          <p className="text-sm font-semibold text-purple-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-purple-600">{orden.cliente_nombre}</p>
          <p className="text-xs text-purple-400 mt-1">
            Reparado por {formatCOP(Number(orden.precio_final || 0))}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-gray-700">¿Es la misma falla?</p>
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
            <input type="radio" name="cobrable" checked={!cobrable}
              onChange={() => setCobrable(false)} className="mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-700">Sí — misma falla</p>
              <p className="text-xs text-gray-400">La reparación es gratis</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
            <input type="radio" name="cobrable" checked={cobrable}
              onChange={() => setCobrable(true)} className="mt-0.5" />
            <div>
              <p className="text-sm font-medium text-gray-700">No — falla diferente</p>
              <p className="text-xs text-gray-400">Se define nuevo precio al marcar listo</p>
            </div>
          </label>
        </div>

        <Input label="Notas (opcional)" placeholder="Describe la nueva falla..."
          value={notas} onChange={(e) => setNotas(e.target.value)} />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutGarantia.isPending}
            onClick={() => mutGarantia.mutate()}>
            Activar garantía
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: Detalle ───────────────────────────────────────────────────────────

function ModalDetalleOrden({ ordenId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['orden-detalle', ordenId],
    queryFn:  () => getOrdenById(ordenId).then((r) => r.data.data),
    enabled:  !!ordenId,
  });

  if (isLoading) return (
    <Modal open onClose={onClose} title="Detalle de orden" size="md"><Spinner className="py-10" /></Modal>
  );
  if (!data) return null;

  const estado = cfg(data.estado);
  const saldo  = Number(data.precio_final || 0) - Number(data.total_abonado || 0);

  return (
    <Modal open onClose={onClose} title={`#OS-${String(data.id).padStart(4, '0')}`} size="md">
      <div className="flex flex-col gap-4">

        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-bold text-gray-900">{nombreEquipo(data)}</p>
            {data.equipo_color  && <p className="text-xs text-gray-400">{data.equipo_color}</p>}
            {data.equipo_serial && <p className="text-xs text-gray-400 font-mono">Serial: {data.equipo_serial}</p>}
          </div>
          <Badge variant={estado.badge}>{estado.label}</Badge>
        </div>

        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-sm font-medium text-gray-800">{data.cliente_nombre}</p>
          {data.cliente_telefono && <p className="text-xs text-gray-400">{data.cliente_telefono}</p>}
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Falla reportada</p>
          <p className="text-sm text-gray-700">{data.falla_reportada}</p>
        </div>

        {data.notas_tecnico && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notas del técnico</p>
            <p className="text-sm text-gray-700">{data.notas_tecnico}</p>
          </div>
        )}

        {/* Precios en grid — estilo MetricCard */}
        <div className="grid grid-cols-2 gap-2">
          {data.costo_estimado && (
            <div className="bg-gray-50 rounded-xl px-3 py-2.5">
              <p className="text-xs text-gray-400">Estimado</p>
              <p className="text-sm font-bold text-gray-700">{formatCOP(Number(data.costo_estimado))}</p>
            </div>
          )}
          {data.precio_final && (
            <div className="bg-blue-50 rounded-xl px-3 py-2.5">
              <p className="text-xs text-blue-400">Precio final</p>
              <p className="text-sm font-bold text-blue-800">{formatCOP(Number(data.precio_final))}</p>
            </div>
          )}
          {data.costo_real && (
            <div className="bg-orange-50 rounded-xl px-3 py-2.5">
              <p className="text-xs text-orange-400">Costo reparación</p>
              <p className="text-sm font-bold text-orange-700">{formatCOP(Number(data.costo_real))}</p>
            </div>
          )}
          {data.utilidad != null && (
            <div className={`rounded-xl px-3 py-2.5 ${Number(data.utilidad) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className={`text-xs ${Number(data.utilidad) >= 0 ? 'text-green-400' : 'text-red-400'}`}>Utilidad</p>
              <p className={`text-sm font-bold ${Number(data.utilidad) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {formatCOP(Number(data.utilidad))}
              </p>
            </div>
          )}
        </div>

        {data.precio_final && (
          <div>
            <BarraCobro abonado={Number(data.total_abonado) || 0} total={Number(data.precio_final)} />
            {saldo > 0 && <p className="text-xs text-red-500 font-semibold mt-1">Saldo: {formatCOP(saldo)}</p>}
          </div>
        )}

        {data.abonos?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Historial de abonos</p>
            <div className="flex flex-col gap-1.5">
              {data.abonos.map((ab) => {
                const abId = ab.id;
                return (
                  <div key={abId} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                    <div>
                      <p className="text-xs text-gray-500">{formatFechaHora(ab.fecha)}</p>
                      <p className="text-xs text-gray-400">{ab.metodo}</p>
                    </div>
                    <p className="text-sm font-semibold text-green-600">{formatCOP(Number(ab.valor))}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data.motivo_sin_reparar && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5">
            <p className="text-xs font-semibold text-orange-600">Motivo de devolución</p>
            <p className="text-sm text-orange-700">{data.motivo_sin_reparar}</p>
          </div>
        )}

        <div className="flex justify-between text-xs text-gray-400">
          <span>Recibido: {formatFechaHora(data.fecha_recepcion)}</span>
          {data.fecha_entrega && <span>Entregado: {formatFechaHora(data.fecha_entrega)}</span>}
        </div>

        <Button variant="secondary" className="w-full" onClick={onClose}>Cerrar</Button>
      </div>
    </Modal>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ServiciosPage() {
  const queryClient = useQueryClient();

  const [busqueda,     setBusqueda]     = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [modalNueva,   setModalNueva]   = useState(false);
  const [accion,       setAccion]       = useState(null); // { tipo, orden }

  const { data: resumen, isLoading: loadingResumen } = useQuery({
    queryKey: ['servicios-resumen-hoy'],
    queryFn:  () => getResumenHoy().then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const { data: ordenesData, isLoading: loadingOrdenes } = useQuery({
    queryKey: ['ordenes-servicio', busqueda, filtroEstado],
    queryFn:  () => getOrdenes({
      busqueda:  busqueda     || undefined,
      estado:    filtroEstado || undefined,
    }).then((r) => r.data.data),
  });

  const ordenes  = ordenesData || [];
  const activas  = ordenes.filter((o) => ESTADOS_ACTIVOS.includes(o.estado));
  const cerradas = ordenes.filter((o) => ESTADOS_CERRADOS.includes(o.estado));

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['ordenes-servicio'],      exact: false });
    queryClient.invalidateQueries({ queryKey: ['servicios-resumen-hoy']              });
  };

  const mutEnReparacion = useMutation({
    mutationFn: (id) => marcarEnReparacion(id),
    onSuccess:  invalidar,
  });

  const handleAccion = (tipo, orden) => {
    if (tipo === 'en-reparacion') { mutEnReparacion.mutate(orden.id); return; }
    setAccion({ tipo, orden });
  };

  const cerrar = () => setAccion(null);

  const FILTROS = [
    { id: '',              label: 'Todas'         },
    { id: 'Recibido',      label: 'Recibidos'     },
    { id: 'En_reparacion', label: 'En reparación' },
    { id: 'Listo',         label: 'Listos'        },
    { id: 'Garantia',      label: 'Garantía'      },
    { id: 'Entregado',     label: 'Entregados'    },
    { id: 'Sin_reparar',   label: 'Sin reparar'   },
  ];

  return (
    <>
      <div className="flex flex-col gap-5 max-w-2xl mx-auto">

        {/* Métricas del día — estilo ReportesPage */}
        {loadingResumen ? (
          <div className="h-20 flex items-center"><Spinner /></div>
        ) : resumen && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard label="Órdenes hoy"     valor={resumen.ordenes_hoy}
              colorClass="bg-blue-50 text-blue-700" />
            <MetricCard label="Ingresos hoy"    valor={formatCOP(Number(resumen.ingresos_hoy) || 0)}
              colorClass="bg-green-50 text-green-700" />
            <MetricCard label="Utilidad hoy"    valor={formatCOP(Number(resumen.utilidad_hoy) || 0)}
              colorClass="bg-emerald-50 text-emerald-700" />
            <MetricCard label="Por cobrar"      valor={formatCOP(Number(resumen.pendiente_cobro) || 0)}
              colorClass="bg-orange-50 text-orange-700"
              sub={activas.filter((o) => ['Listo','Garantia'].includes(o.estado)).length > 0
                ? `${activas.filter((o) => ['Listo','Garantia'].includes(o.estado)).length} lista(s)`
                : undefined} />
          </div>
        )}

        {/* Barra de herramientas */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchInput value={busqueda} onChange={setBusqueda}
                placeholder="Buscar por cliente, equipo o #..." />
            </div>
            <Button onClick={() => setModalNueva(true)}>
              <Plus size={16} /> Nueva orden
            </Button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {FILTROS.map((f) => {
              const fKey = f.id || 'todas';
              return (
                <button key={fKey} onClick={() => setFiltroEstado(f.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex-shrink-0 transition-all
                    ${filtroEstado === f.id
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-100 text-gray-600 hover:border-gray-200'}`}>
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista */}
        {loadingOrdenes ? (
          <Spinner className="py-12" />
        ) : ordenes.length === 0 ? (
          <EmptyState icon={Wrench} titulo="Sin órdenes"
            descripcion={busqueda || filtroEstado ? 'Sin resultados' : 'Crea la primera orden de servicio'} />
        ) : (
          <div className="flex flex-col gap-5">

            {/* Activas */}
            {activas.length > 0 && (
              <div className="flex flex-col gap-2">
                {!filtroEstado && (
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    En proceso ({activas.length})
                  </p>
                )}
                {activas.map((o) => {
                  const oKey = o.id;
                  return <CardOrden key={oKey} orden={o} onAccion={handleAccion} />;
                })}
              </div>
            )}

            {/* Cerradas */}
            {cerradas.length > 0 && (
              <div className="flex flex-col gap-2">
                {!filtroEstado && activas.length > 0 && (
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Cerradas ({cerradas.length})
                  </p>
                )}
                {cerradas.map((o) => {
                  const oKey = o.id;
                  return <CardOrden key={oKey} orden={o} onAccion={handleAccion} />;
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modales */}
      {modalNueva && (
        <ModalNuevaOrden onClose={() => setModalNueva(false)} onCreada={invalidar} />
      )}
      {accion?.tipo === 'listo' && (
        <ModalMarcarListo orden={accion.orden} onClose={cerrar} onExito={invalidar} />
      )}
      {accion?.tipo === 'abono' && (
        <ModalAbono orden={accion.orden} onClose={cerrar} onExito={invalidar} />
      )}
      {accion?.tipo === 'entregar' && (
        <ModalEntregar orden={accion.orden} onClose={cerrar} onExito={invalidar} />
      )}
      {accion?.tipo === 'sin-reparar' && (
        <ModalSinReparar orden={accion.orden} onClose={cerrar} onExito={invalidar} />
      )}
      {accion?.tipo === 'garantia' && (
        <ModalGarantia orden={accion.orden} onClose={cerrar} onExito={invalidar} />
      )}
      {accion?.tipo === 'detalle' && (
        <ModalDetalleOrden ordenId={accion.orden.id} onClose={cerrar} />
      )}
    </>
  );
}