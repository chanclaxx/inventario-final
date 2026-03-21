import { useState }                               from 'react';
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query';
import {
  getOrdenes, getOrdenById, getResumenHoy,
  crearOrden, marcarEnReparacion, marcarListo,
  registrarAbono, entregarOrden, sinReparar,
  abrirGarantia,
} from '../../api/servicios.api';
import { buscarPorCedula, crearCliente } from '../../api/clientes.api';
import { useCedulaCliente }            from '../../hooks/useCedulaCliente';
import { ModalConflictoCedula }        from '../../components/ui/ModalConflictoCedula';
import { formatCOP, formatFechaHora }  from '../../utils/formatters';
import { ComprobanteServicio }         from './ComprobanteServicio';
import { Badge }       from '../../components/ui/Badge';
import { Button }      from '../../components/ui/Button';
import { Modal }       from '../../components/ui/Modal';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { useAuth }     from '../../context/useAuth';
import api             from '../../api/axios.config';
import {
  Wrench, Plus, ChevronRight, ChevronLeft,
  AlertTriangle, CheckCircle, RefreshCw,
  ChevronDown, ChevronUp, User, Clock, Lock,
  Loader2,
} from 'lucide-react';

// ─── Constantes ───────────────────────────────────────────────────────────────

const ESTADOS_CONFIG = {
  Recibido:       { badge: 'blue',   label: 'Recibido',         border: 'border-l-blue-400'   },
  En_reparacion:  { badge: 'yellow', label: 'En reparación',    border: 'border-l-amber-400'  },
  Listo:          { badge: 'green',  label: 'Listo',            border: 'border-l-green-400'  },
  Pendiente_pago: { badge: 'orange', label: 'Pendiente de pago',border: 'border-l-orange-400' },
  Entregado:      { badge: 'gray',   label: 'Entregado',        border: 'border-l-gray-200'   },
  Sin_reparar:    { badge: 'red',    label: 'Sin reparar',      border: 'border-l-red-200'    },
  Garantia:       { badge: 'purple', label: 'Garantía',         border: 'border-l-purple-400' },
};

const METODOS_PAGO        = ['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Otro'];
const TIPOS_EQUIPO        = ['Celular', 'Tablet', 'Computador', 'Portátil', 'Consola', 'Otro'];
const MOTIVOS_SIN_REPARAR = [
  'No fue posible reparar',
  'Cliente no aceptó el precio',
  'Falta de repuestos',
  'Otro',
];
const ESTADOS_ACTIVOS  = ['Recibido', 'En_reparacion', 'Listo', 'Pendiente_pago', 'Garantia'];
const ESTADOS_CERRADOS = ['Entregado', 'Sin_reparar'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const cfg          = (e) => ESTADOS_CONFIG[e] || { badge: 'gray', label: e, border: 'border-l-gray-200' };
const nombreEquipo = (o) => o.equipo_nombre || o.equipo_tipo || 'Equipo';

const agruparPorCliente = (ordenes) => {
  const map = new Map();
  ordenes.forEach((o) => {
    const key = o.cliente_nombre;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(o);
  });
  return Array.from(map.entries()).map(([nombre, items]) => ({ nombre, items }));
};

// ─── Hook: config del negocio ─────────────────────────────────────────────────

function useConfig() {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
  return data || {};
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

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

// ─── Card de orden activa ────────────────────────────────────────────────────

function CardOrden({ orden, onAccion, esAdmin = false }) {
  const [expandida, setExpandida] = useState(false);
  const estado = cfg(orden.estado);
  const saldo  = Number(orden.saldo_pendiente) || 0;

  return (
    <div className={`bg-white border border-gray-100 border-l-4 ${estado.border}
      rounded-xl overflow-hidden shadow-sm`}>

      <div className="px-4 pt-3 pb-2 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={estado.badge}>{estado.label}</Badge>
            <span className="text-sm font-semibold text-gray-700 truncate">{nombreEquipo(orden)}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-gray-400 font-mono">
              #OS-{String(orden.id).padStart(4,'0')}
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock size={10} /> {formatFechaHora(orden.fecha_recepcion)}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {(orden.estado === 'Garantia' && orden.garantia_cobrable && orden.precio_garantia)
            ? <p className="text-sm font-bold text-purple-700">{formatCOP(Number(orden.precio_garantia))}</p>
            : orden.precio_final
              ? <p className="text-sm font-bold text-gray-900">{formatCOP(Number(orden.precio_final))}</p>
              : orden.costo_estimado
                ? <p className="text-xs text-gray-400">Est. {formatCOP(Number(orden.costo_estimado))}</p>
                : null
          }
          {saldo > 0 && ['Listo','Pendiente_pago','Garantia'].includes(orden.estado) && (
            <span className="text-xs font-semibold text-red-500">{formatCOP(saldo)}</span>
          )}
          <button onClick={() => setExpandida((v) => !v)}
            className="p-1 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-50 mt-0.5">
            {expandida ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      <div className="px-4 pb-3 flex items-center gap-2 flex-wrap border-t border-gray-50 pt-2">
        <button onClick={() => onAccion('detalle', orden)}
          className="text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2">
          Ver detalle
        </button>
        <AccionesOrden orden={orden} onAccion={onAccion} />
      </div>

      {expandida && (
        <div className="px-4 pb-4 flex flex-col gap-2 bg-gray-50 border-t border-gray-100">
          <p className="text-sm text-gray-600 pt-3 italic">{orden.falla_reportada}</p>

          {(() => {
            const totalBarra = (orden.estado === 'Garantia' && orden.garantia_cobrable && orden.precio_garantia)
              ? Number(orden.precio_garantia)
              : Number(orden.precio_final || 0);
            return totalBarra > 0 && orden.estado !== 'Sin_reparar' ? (
              <BarraCobro abonado={Number(orden.total_abonado) || 0} total={totalBarra} />
            ) : null;
          })()}

          <div className="flex flex-col gap-1">
            {orden.equipo_serial    && <p className="text-xs text-gray-400 font-mono">Serial: {orden.equipo_serial}</p>}
            {orden.notas_tecnico    && <p className="text-xs text-gray-500">Notas: {orden.notas_tecnico}</p>}
            {orden.motivo_sin_reparar && <p className="text-xs text-orange-600">Motivo: {orden.motivo_sin_reparar}</p>}
            {esAdmin && orden.utilidad != null && (
              <p className={`text-xs font-semibold ${Number(orden.utilidad) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                Utilidad: {formatCOP(Number(orden.utilidad))}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Acciones por estado ──────────────────────────────────────────────────────

function AccionesOrden({ orden, onAccion }) {
  const estado = orden.estado;
  return (
    <>
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
      {estado === 'Pendiente_pago' && (
        <Button size="sm" onClick={() => onAccion('abono', orden)}>
          <Plus size={13} /> Registrar pago
        </Button>
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
      {(estado === 'Entregado' || estado === 'Pendiente_pago') && (
        <Button size="sm" variant="secondary" onClick={() => onAccion('garantia', orden)}>
          <RefreshCw size={13} /> Garantía
        </Button>
      )}
    </>
  );
}

// ─── Grupo de órdenes por cliente ────────────────────────────────────────────

function GrupoCliente({ nombre, items, onAccion, esAdmin = false }) {
  const [expandido, setExpandido] = useState(true);
  const tieneAlerta = items.some((o) => {
    const s = Number(o.saldo_pendiente) || 0;
    return s > 0 && ['Listo','Garantia'].includes(o.estado);
  });

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={() => setExpandido((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 bg-white hover:bg-gray-50
          transition-colors text-left">
        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <User size={13} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{nombre}</p>
          <p className="text-xs text-gray-400">{items.length} {items.length === 1 ? 'equipo' : 'equipos'} en servicio</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {tieneAlerta && (
            <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
          )}
          {expandido ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </button>

      {expandido && (
        <div className="flex flex-col gap-px bg-gray-100">
          {items.map((o) => {
            const oKey = o.id;
            return (
              <div key={oKey} className="bg-white">
                <CardOrden orden={o} onAccion={onAccion} esAdmin={esAdmin} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Card de orden cerrada ───────────────────────────────────────────────────

function CardOrdenCerrada({ orden, onAccion, esAdmin = false }) {
  const [expandida, setExpandida] = useState(false);
  const estado = cfg(orden.estado);

  return (
    <div className={`bg-white border border-gray-100 border-l-4 ${estado.border}
      rounded-xl overflow-hidden`}>

      <button onClick={() => setExpandida((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left">
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-300 font-mono">#OS-{String(orden.id).padStart(4,'0')}</span>
          <Badge variant={estado.badge}>{estado.label}</Badge>
          <span className="text-xs font-medium text-gray-600 truncate">{nombreEquipo(orden)}</span>
          <span className="text-xs text-gray-400 truncate hidden sm:block">{orden.cliente_nombre}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {orden.precio_final && (
            <span className="text-xs font-semibold text-gray-500">
              {formatCOP(Number(orden.precio_final))}
            </span>
          )}
          {expandida ? <ChevronUp size={13} className="text-gray-300" /> : <ChevronDown size={13} className="text-gray-300" />}
        </div>
      </button>

      {expandida && (
        <div className="px-4 pb-3 flex flex-col gap-2 border-t border-gray-50 bg-gray-50">
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div>
              <p className="text-xs text-gray-400">Cliente</p>
              <p className="text-sm font-medium text-gray-700">{orden.cliente_nombre}</p>
              {orden.cliente_telefono && (
                <p className="text-xs text-gray-400">{orden.cliente_telefono}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-400">Equipo</p>
              <p className="text-sm font-medium text-gray-700">{nombreEquipo(orden)}</p>
              {orden.equipo_serial && (
                <p className="text-xs text-gray-400 font-mono">{orden.equipo_serial}</p>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-500 italic">{orden.falla_reportada}</p>

          {orden.notas_tecnico && (
            <p className="text-xs text-gray-500">Notas: {orden.notas_tecnico}</p>
          )}
          {orden.motivo_sin_reparar && (
            <p className="text-xs text-orange-600">Motivo: {orden.motivo_sin_reparar}</p>
          )}

          {orden.precio_final && (
            <BarraCobro
              abonado={Number(orden.total_abonado) || 0}
              total={Number(orden.precio_final)}
            />
          )}

          {esAdmin && orden.utilidad != null && (
            <p className={`text-xs font-semibold ${Number(orden.utilidad) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              Utilidad: {formatCOP(Number(orden.utilidad))}
            </p>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button onClick={() => onAccion('detalle', orden)}
              className="text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2">
              Ver detalle completo
            </button>
            <AccionesOrden orden={orden} onAccion={onAccion} />
          </div>
        </div>
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
            <div className={`w-6 h-6 rounded-full flex items-center justify-center
              text-xs font-bold flex-shrink-0 transition-all
              ${paso > n ? 'bg-blue-100 text-blue-600'
                : paso === n ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-400'}`}>
              {n}
            </div>
            <span className={`text-xs hidden sm:block truncate
              ${paso >= n ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
              {labels[i]}
            </span>
            {n < total && (
              <div className={`flex-1 h-px ${paso > n ? 'bg-blue-300' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Modal: Nueva orden (wizard 3 pasos) ─────────────────────────────────────

function ModalNuevaOrden({ onClose, onCreada }) {
  const [paso, setPaso] = useState(1);
  const [form, setForm] = useState({
    cliente_cedula: '', cliente_nombre: '', cliente_telefono: '', cliente_id: '',
    cliente_email: '', cliente_direccion: '',
    equipo_tipo: '', equipo_nombre: '', equipo_serial: '',
    falla_reportada: '', contrasena_equipo: '', notas_tecnico: '', costo_estimado: '',
  });
  const [buscandoCedula, setBuscandoCedula] = useState(false);
  const [error, setError] = useState('');

  const { conflictoCliente, verificarCedula, reescribirCliente, cancelarConflicto } = useCedulaCliente();
  const set = (campo, val) => setForm((f) => ({ ...f, [campo]: val }));

  const handleBlurCedula = async () => {
    const cedula = form.cliente_cedula?.trim();
    if (!cedula) return;
    if (form.cliente_nombre.trim() || form.cliente_telefono.trim()) return;
    setBuscandoCedula(true);
    try {
      const { data } = await buscarPorCedula(cedula);
      const encontrado = data.data;
      if (encontrado) {
        setForm((f) => ({
          ...f,
          cliente_nombre:    encontrado.nombre    || f.cliente_nombre,
          cliente_telefono:  encontrado.celular   || f.cliente_telefono,
          cliente_id:        String(encontrado.id),
          cliente_email:     encontrado.email     || '',
          cliente_direccion: encontrado.direccion || '',
        }));
      }
    } catch { /* usuario llena manual */ }
    finally { setBuscandoCedula(false); }
  };

  const mutCrear = useMutation({
    mutationFn: async () => {
      let clienteId = form.cliente_id || null;
      if (form.cliente_cedula.trim() && !clienteId) {
        try {
          const res = await crearCliente({
            nombre:  form.cliente_nombre.trim(),
            cedula:  form.cliente_cedula.trim(),
            celular: form.cliente_telefono || null,
          });
          clienteId = String(res.data.data.id);
        } catch (e) {
          if (e.response?.status === 409) {
            try {
              const { data } = await buscarPorCedula(form.cliente_cedula.trim());
              if (data.data) clienteId = String(data.data.id);
            } catch { /* continuar */ }
          }
        }
      }
      return crearOrden({
        cliente_nombre:    form.cliente_nombre.trim(),
        cliente_telefono:  form.cliente_telefono  || null,
        cliente_id:        clienteId,
        cliente_cedula:    form.cliente_cedula    || null,
        equipo_tipo:       form.equipo_tipo        || null,
        equipo_nombre:     form.equipo_nombre      || null,
        equipo_serial:     form.equipo_serial      || null,
        falla_reportada:   form.falla_reportada.trim(),
        contrasena_equipo: form.contrasena_equipo  || null,
        notas_tecnico:     form.notas_tecnico      || null,
        costo_estimado:    form.costo_estimado !== '' ? Number(form.costo_estimado) : null,
      });
    },
    onSuccess: (res) => { onCreada(res.data.data); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'Error al crear la orden'),
  });

  const validarPaso1 = () => {
    if (!form.cliente_nombre.trim()) { setError('El nombre del cliente es requerido'); return false; }
    return true;
  };
  const validarPaso3 = () => {
    if (!form.falla_reportada.trim()) { setError('La falla reportada es requerida'); return false; }
    return true;
  };

  const irPaso = (n) => { setError(''); setPaso(n); };

  const siguiente = async () => {
    if (paso === 1) {
      if (!validarPaso1()) return;
      if (form.cliente_cedula.trim()) {
        const ok = await verificarCedula({
          cedula:    form.cliente_cedula,
          nombre:    form.cliente_nombre,
          celular:   form.cliente_telefono,
          email:     form.cliente_email,
          direccion: form.cliente_direccion,
        });
        if (!ok) return;
      }
    }
    irPaso(paso + 1);
  };

  const handleReescribir    = async () => { await reescribirCliente(); irPaso(2); };
  const handleCancelarConflicto = () => cancelarConflicto(setForm);

  return (
    <>
      <Modal open onClose={onClose} title="Nueva orden de servicio" size="md">
        <PasoIndicador paso={paso} total={3} labels={['Cliente', 'Equipo', 'Falla']} />

        {paso === 1 && (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Input label="Cédula / Documento" placeholder="123456789 (opcional)"
                value={form.cliente_cedula}
                onChange={(e) => set('cliente_cedula', e.target.value)}
                onBlur={handleBlurCedula} autoFocus />
              {buscandoCedula && (
                <Loader2 size={14} className="absolute right-3 top-9 text-gray-400 animate-spin" />
              )}
            </div>

            {form.cliente_id && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                <User size={14} className="text-blue-500 flex-shrink-0" />
                <p className="text-sm text-blue-700 font-medium flex-1 truncate">{form.cliente_nombre}</p>
                <button onClick={() => setForm((f) => ({
                  ...f, cliente_id: '', cliente_cedula: '',
                  cliente_nombre: '', cliente_telefono: '',
                }))} className="text-xs text-blue-400 hover:text-blue-600 flex-shrink-0">
                  Cambiar
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input label="Nombre *" placeholder="Nombre del cliente"
                value={form.cliente_nombre}
                onChange={(e) => set('cliente_nombre', e.target.value)} />
              <Input label="Teléfono" placeholder="3001234567"
                value={form.cliente_telefono}
                onChange={(e) => set('cliente_telefono', e.target.value)} />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
              <Button className="flex-1" onClick={siguiente}>
                Siguiente <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        )}

        {paso === 2 && (
          <div className="flex flex-col gap-3">
            <div className="bg-blue-50 rounded-xl px-3 py-2">
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

            <Input label="Producto"
              placeholder="Ej: iPhone 12 Pro negro, Samsung A32 azul..."
              value={form.equipo_nombre}
              onChange={(e) => set('equipo_nombre', e.target.value)} autoFocus />

            <Input label="Serial / IMEI" placeholder="Opcional"
              value={form.equipo_serial}
              onChange={(e) => set('equipo_serial', e.target.value)} />

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
                  {form.equipo_nombre || form.equipo_tipo || '—'}
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
              <Input label="Contraseña / patrón" placeholder="Solo para técnico"
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

      <ModalConflictoCedula
        open={!!conflictoCliente}
        conflicto={conflictoCliente}
        onReescribir={handleReescribir}
        onCancelar={handleCancelarConflicto}
        guardando={false}
      />
    </>
  );
}

// ─── Modal: Marcar listo ──────────────────────────────────────────────────────

function ModalMarcarListo({ orden, onClose, onExito }) {
  const esGarantia      = orden.estado === 'Garantia';
  const esGarantiaCobr  = esGarantia && orden.garantia_cobrable;
  const esGarantiaGratis= esGarantia && !orden.garantia_cobrable;

  const [costoReal,      setCostoReal]      = useState('');
  const [precioFinal,    setPrecioFinal]    = useState(
    !esGarantia && orden.costo_estimado ? Number(orden.costo_estimado) : ''
  );
  const [costoGarantia,  setCostoGarantia]  = useState('');
  const [precioGarantia, setPrecioGarantia] = useState('');
  const [notas, setNotas] = useState(orden.notas_tecnico || '');
  const [error, setError] = useState('');

  const mutListo = useMutation({
    mutationFn: () => {
      if (esGarantiaCobr) {
        return marcarListo(orden.id, {
          es_garantia:     true,
          precio_garantia: Number(precioGarantia),
          costo_garantia:  costoGarantia !== '' ? Number(costoGarantia) : null,
          notas_tecnico:   notas || null,
        });
      }
      if (esGarantiaGratis) {
        return marcarListo(orden.id, {
          es_garantia_gratis: true,
          notas_tecnico:      notas || null,
        });
      }
      return marcarListo(orden.id, {
        costo_real:    costoReal   !== '' ? Number(costoReal)   : null,
        precio_final:  precioFinal !== '' ? Number(precioFinal) : null,
        notas_tecnico: notas || null,
      });
    },
    onSuccess: () => { onExito(); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'Error'),
  });

  const utilidad = costoReal !== '' && precioFinal !== ''
    ? Number(precioFinal) - Number(costoReal) : null;
  const utilGarantia = costoGarantia !== '' && precioGarantia !== ''
    ? Number(precioGarantia) - Number(costoGarantia) : null;

  const puedeGuardar = esGarantiaCobr
    ? precioGarantia !== ''
    : esGarantiaGratis
      ? true
      : precioFinal !== '';

  return (
    <Modal open onClose={onClose} title="Marcar como listo" size="sm">
      <div className="flex flex-col gap-4">
        <div className={`border rounded-xl px-3 py-2.5
          ${esGarantia ? 'bg-purple-50 border-purple-200' : 'bg-green-50 border-green-200'}`}>
          <p className={`text-sm font-semibold ${esGarantia ? 'text-purple-800' : 'text-green-800'}`}>
            {nombreEquipo(orden)}
          </p>
          <p className={`text-xs ${esGarantia ? 'text-purple-600' : 'text-green-600'}`}>
            {orden.cliente_nombre}
          </p>
          {esGarantia && (
            <p className="text-xs text-purple-400 mt-1">
              {esGarantiaCobr ? 'Garantía cobrable — falla diferente' : 'Garantía gratis — misma falla'}
            </p>
          )}
          {esGarantia && orden.precio_final && (
            <p className="text-xs text-purple-400">
              Reparación original: {formatCOP(Number(orden.precio_final))} (no se modifica)
            </p>
          )}
        </div>

        {esGarantiaGratis && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
            <p className="text-sm text-blue-700">
              No se genera ningún cobro. El equipo se entrega sin costo adicional.
            </p>
          </div>
        )}

        {esGarantiaCobr && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">
                Costo de la garantía <span className="text-gray-400 font-normal">(repuestos + trabajo)</span>
              </label>
              <InputMoneda value={costoGarantia} onChange={setCostoGarantia} placeholder="0"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                  text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">¿Cuánto le cobras al cliente? *</label>
              <InputMoneda value={precioGarantia} onChange={setPrecioGarantia} placeholder="0"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                  text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {utilGarantia !== null && (
              <div className={`rounded-xl px-3 py-2.5 text-sm font-semibold
                ${utilGarantia >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                Utilidad garantía: {formatCOP(utilGarantia)}
              </div>
            )}
          </>
        )}

        {!esGarantia && (
          <>
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
          </>
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
            disabled={!puedeGuardar} onClick={() => mutListo.mutate()}>
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
          <div className="bg-gray-50 rounded-xl px-3 py-2">
            <p className="text-xs text-gray-400">Total</p>
            <p className="text-sm font-bold text-gray-800">{formatCOP(Number(orden.precio_final))}</p>
          </div>
          <div className="bg-green-50 rounded-xl px-3 py-2">
            <p className="text-xs text-green-500">Abonado</p>
            <p className="text-sm font-bold text-green-700">{formatCOP(Number(orden.total_abonado))}</p>
          </div>
          <div className="bg-red-50 rounded-xl px-3 py-2">
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
                    ${metodo === m ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
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
            disabled={!valor || Number(valor) <= 0} onClick={() => mutAbono.mutate()}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: Entregar (con comprobante automático) ─────────────────────────────

function ModalEntregar({ orden, onClose, onExito }) {
  const [error, setError] = useState('');
  const [ordenEntregada, setOrdenEntregada] = useState(null);
  const config = useConfig();

  const esGarantia = orden.estado === 'Garantia' && orden.garantia_cobrable;
  const totalCobro = esGarantia
    ? Number(orden.precio_garantia || 0)
    : Number(orden.precio_final   || 0);
  const saldo = totalCobro - Number(orden.total_abonado || 0);

  // Traer detalle completo de la orden para el comprobante (incluye abonos)
  const { data: ordenDetalle } = useQuery({
    queryKey: ['orden-detalle-comprobante', orden.id],
    queryFn:  () => getOrdenById(orden.id).then((r) => r.data.data),
    enabled:  !!ordenEntregada,
  });

  const mutEntregar = useMutation({
    mutationFn: () => entregarOrden(orden.id),
    onSuccess:  () => {
      onExito();
      setOrdenEntregada(orden);
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al entregar'),
  });

  // Si ya se entregó y tenemos el detalle, mostrar comprobante
  if (ordenEntregada && ordenDetalle) {
    return (
      <ComprobanteServicio
        orden={ordenDetalle}
        config={config}
        garantias={[]}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal open onClose={onClose} title="Entregar equipo" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-sm font-semibold text-gray-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-gray-500">{orden.cliente_nombre}</p>
          {totalCobro > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Total: {formatCOP(totalCobro)} · Abonado: {formatCOP(Number(orden.total_abonado))}
            </p>
          )}
        </div>

        {saldo <= 0 ? (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
            <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700 font-medium">Pago completo — listo para entregar</p>
          </div>
        ) : (
          <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-3">
            <AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-700">Queda saldo pendiente</p>
              <p className="text-xs text-orange-600 mt-0.5">
                El cliente debe {formatCOP(saldo)}. El equipo se entrega
                y quedará como <strong>Pendiente de pago</strong> hasta saldar.
              </p>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutEntregar.isPending}
            onClick={() => mutEntregar.mutate()}>
            {saldo > 0 ? 'Entregar con saldo pendiente' : 'Confirmar entrega'}
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
                <input type="radio" name="motivo" value={m}
                  checked={motivo === m} onChange={() => setMotivo(m)} />
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
    <Modal open onClose={onClose} title="Detalle de orden" size="md">
      <Spinner className="py-10" />
    </Modal>
  );
  if (!data) return null;

  const estado = cfg(data.estado);
  const saldo  = Number(data.precio_final || 0) - Number(data.total_abonado || 0);

  return (
    <Modal open onClose={onClose} title={`#OS-${String(data.id).padStart(4,'0')}`} size="md">
      <div className="flex flex-col gap-4">

        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-bold text-gray-900">{nombreEquipo(data)}</p>
            {data.equipo_serial && (
              <p className="text-xs text-gray-400 font-mono">Serial: {data.equipo_serial}</p>
            )}
          </div>
          <Badge variant={estado.badge}>{estado.label}</Badge>
        </div>

        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-sm font-medium text-gray-800">{data.cliente_nombre}</p>
          {data.cliente_telefono && (
            <p className="text-xs text-gray-400">{data.cliente_telefono}</p>
          )}
          {data.cliente_cedula && (
            <p className="text-xs text-gray-400">CC: {data.cliente_cedula}</p>
          )}
        </div>

        {data.contrasena_equipo && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <Lock size={14} className="text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-amber-600 font-medium">Contraseña / patrón del equipo</p>
              <p className="text-sm font-mono font-bold text-amber-800 tracking-widest">
                {data.contrasena_equipo}
              </p>
              <p className="text-xs text-amber-500 mt-0.5">Solo para uso del técnico</p>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Falla reportada
          </p>
          <p className="text-sm text-gray-700">{data.falla_reportada}</p>
        </div>

        {data.notas_tecnico && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Notas del técnico
            </p>
            <p className="text-sm text-gray-700">{data.notas_tecnico}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {data.costo_estimado && (
            <div className="bg-gray-50 rounded-xl px-3 py-2.5">
              <p className="text-xs text-gray-400">Estimado</p>
              <p className="text-sm font-bold text-gray-700">{formatCOP(Number(data.costo_estimado))}</p>
            </div>
          )}
          {data.precio_final && (
            <div className="bg-blue-50 rounded-xl px-3 py-2.5">
              <p className="text-xs text-blue-400">Precio reparación</p>
              <p className="text-sm font-bold text-blue-800">{formatCOP(Number(data.precio_final))}</p>
            </div>
          )}
          {data.precio_garantia > 0 && (
            <div className="bg-purple-50 rounded-xl px-3 py-2.5">
              <p className="text-xs text-purple-400">Precio garantía</p>
              <p className="text-sm font-bold text-purple-800">{formatCOP(Number(data.precio_garantia))}</p>
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
              <p className={`text-xs ${Number(data.utilidad) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                Utilidad reparación
              </p>
              <p className={`text-sm font-bold ${Number(data.utilidad) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {formatCOP(Number(data.utilidad))}
              </p>
            </div>
          )}
          {data.utilidad_garantia != null && (
            <div className={`rounded-xl px-3 py-2.5 ${Number(data.utilidad_garantia) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className={`text-xs ${Number(data.utilidad_garantia) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                Utilidad garantía
              </p>
              <p className={`text-sm font-bold ${Number(data.utilidad_garantia) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {formatCOP(Number(data.utilidad_garantia))}
              </p>
            </div>
          )}
        </div>

        {data.precio_final && (
          <div>
            <BarraCobro
              abonado={Number(data.total_abonado) || 0}
              total={Number(data.precio_final)}
            />
            {saldo > 0 && (
              <p className="text-xs text-red-500 font-semibold mt-1">
                Saldo: {formatCOP(saldo)}
              </p>
            )}
          </div>
        )}

        {data.abonos?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Historial de abonos
            </p>
            <div className="flex flex-col gap-1.5">
              {data.abonos.map((ab) => {
                const abId = ab.id;
                return (
                  <div key={abId}
                    className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                    <div>
                      <p className="text-xs text-gray-500">{formatFechaHora(ab.fecha)}</p>
                      <p className="text-xs text-gray-400">{ab.metodo}</p>
                    </div>
                    <p className="text-sm font-semibold text-green-600">
                      {formatCOP(Number(ab.valor))}
                    </p>
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
          {data.fecha_entrega && (
            <span>Entregado: {formatFechaHora(data.fecha_entrega)}</span>
          )}
        </div>

        <Button variant="secondary" className="w-full" onClick={onClose}>Cerrar</Button>
      </div>
    </Modal>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ServiciosPage() {
  const queryClient = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const esAdmin = esAdminNegocio();

  const [busqueda,        setBusqueda]        = useState('');
  const [filtroEstado,    setFiltroEstado]    = useState('');
  const [modalNueva,      setModalNueva]      = useState(false);
  const [accion,          setAccion]          = useState(null);
  const [cerradasVisible, setCerradasVisible] = useState(false);

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
  const grupos   = agruparPorCliente(activas);

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
      <div className="flex flex-col gap-5 max-w-5xl mx-auto">

        {loadingResumen ? (
          <div className="h-20 flex items-center"><Spinner /></div>
        ) : resumen && (
          <div className={`grid gap-3 ${esAdmin ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2'}`}>
            <MetricCard label="Órdenes hoy"  valor={resumen.ordenes_hoy}
              colorClass="bg-blue-50 text-blue-700" />
            {esAdmin && (
              <MetricCard label="Ingresos hoy" valor={formatCOP(Number(resumen.ingresos_hoy) || 0)}
                colorClass="bg-green-50 text-green-700" />
            )}
            {esAdmin && (
              <MetricCard label="Utilidad hoy" valor={formatCOP(Number(resumen.utilidad_hoy) || 0)}
                colorClass="bg-emerald-50 text-emerald-700" />
            )}
            {esAdmin && (
              <MetricCard label="Por cobrar"   valor={formatCOP(Number(resumen.pendiente_cobro) || 0)}
                colorClass="bg-orange-50 text-orange-700"
                sub={activas.filter((o) => ['Listo','Garantia'].includes(o.estado)).length > 0
                  ? `${activas.filter((o) => ['Listo','Garantia'].includes(o.estado)).length} lista(s)`
                  : undefined} />
            )}
          </div>
        )}

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

        {loadingOrdenes ? (
          <Spinner className="py-12" />
        ) : ordenes.length === 0 ? (
          <EmptyState icon={Wrench} titulo="Sin órdenes"
            descripcion={busqueda || filtroEstado
              ? 'Sin resultados para ese filtro'
              : 'Crea la primera orden de servicio'} />
        ) : (
          <div className="flex flex-col gap-6">
            {activas.length > 0 && (
              <div className="flex flex-col gap-2">
                {!filtroEstado && (
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    En proceso ({activas.length})
                  </p>
                )}
                <div className="flex flex-col gap-3">
                  {grupos.map((g) => {
                    const gKey = g.nombre;
                    return (
                      <GrupoCliente key={gKey} nombre={g.nombre}
                        items={g.items} onAccion={handleAccion} esAdmin={esAdmin} />
                    );
                  })}
                </div>
              </div>
            )}

            {cerradas.length > 0 && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setCerradasVisible((v) => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-gray-400
                    uppercase tracking-wide hover:text-gray-600 transition-colors w-fit">
                  {cerradasVisible
                    ? <ChevronUp size={13} />
                    : <ChevronDown size={13} />}
                  {cerradasVisible ? 'Ocultar' : 'Ver'} cerradas ({cerradas.length})
                </button>

                {cerradasVisible && (
                  <div className="flex flex-col gap-1.5">
                    {cerradas.map((o) => {
                      const oKey = o.id;
                      return (
                        <CardOrdenCerrada key={oKey} orden={o} onAccion={handleAccion} esAdmin={esAdmin} />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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