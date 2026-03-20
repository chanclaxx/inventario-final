import { useState }                               from 'react';
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query';
import {
  getOrdenes, getOrdenById, getResumenHoy,
  crearOrden, marcarEnReparacion, marcarListo,
  registrarAbono, entregarOrden, sinReparar,
  abrirGarantia,
} from '../../api/servicios.api';
import { getClientes }              from '../../api/clientes.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Badge }        from '../../components/ui/Badge';
import { Button }       from '../../components/ui/Button';
import { Modal }        from '../../components/ui/Modal';
import { Input }        from '../../components/ui/Input';
import { InputMoneda }  from '../../components/ui/InputMoneda';
import { Spinner }      from '../../components/ui/Spinner';
import { EmptyState }   from '../../components/ui/EmptyState';
import { SearchInput }  from '../../components/ui/SearchInput';
import {
  Wrench, Plus, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, RefreshCw, Search,
  ClipboardList, Smartphone,
} from 'lucide-react';

// ─── Constantes ───────────────────────────────────────────────────────────────

const ESTADOS_BADGE = {
  Recibido:      'blue',
  En_reparacion: 'yellow',
  Listo:         'green',
  Entregado:     'gray',
  Sin_reparar:   'gray',
  Garantia:      'purple',
};

const ESTADOS_LABEL = {
  Recibido:      'Recibido',
  En_reparacion: 'En reparación',
  Listo:         'Listo',
  Entregado:     'Entregado',
  Sin_reparar:   'Sin reparar',
  Garantia:      'Garantía',
};

const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Otro'];

const MOTIVOS_SIN_REPARAR = [
  'No fue posible reparar',
  'Cliente no aceptó el precio',
  'Falta de repuestos',
  'Otro',
];

const TIPOS_EQUIPO = ['Celular', 'Tablet', 'Computador', 'Portátil', 'Consola', 'Otro'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nombreEquipo = (orden) => {
  const partes = [orden.equipo_marca, orden.equipo_modelo].filter(Boolean);
  return partes.length > 0 ? partes.join(' ') : orden.equipo_tipo || 'Equipo';
};

// ─── Métricas del día ─────────────────────────────────────────────────────────

function PanelMetricas({ resumen, loading }) {
  if (loading) return <div className="h-20 flex items-center justify-center"><Spinner /></div>;
  if (!resumen) return null;

  const metricas = [
    { label: 'Órdenes hoy',      valor: resumen.ordenes_hoy,     tipo: 'numero' },
    { label: 'Ingresos hoy',     valor: resumen.ingresos_hoy,    tipo: 'cop'    },
    { label: 'Utilidad hoy',     valor: resumen.utilidad_hoy,    tipo: 'cop',   color: 'text-green-600' },
    { label: 'Pendiente cobro',  valor: resumen.pendiente_cobro, tipo: 'cop',   color: 'text-orange-500' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {metricas.map((m) => {
        const metricaKey = m.label;
        return (
          <div key={metricaKey} className="bg-gray-50 rounded-xl px-3 py-2.5 flex flex-col gap-0.5">
            <p className="text-xs text-gray-400">{m.label}</p>
            <p className={`text-sm font-bold ${m.color || 'text-gray-900'}`}>
              {m.tipo === 'cop' ? formatCOP(Number(m.valor) || 0) : m.valor}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─── Barra de progreso de cobro ───────────────────────────────────────────────

function BarraCobro({ abonado, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((abonado / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>Abonado: {formatCOP(abonado)}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300 bg-green-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Tarjeta de orden ─────────────────────────────────────────────────────────

function CardOrden({ orden, onAccion }) {
  const [expandida, setExpandida] = useState(false);
  const saldo      = Number(orden.saldo_pendiente) || 0;
  const tieneSaldo = saldo > 0 && orden.precio_final;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3">

      {/* Cabecera */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 font-mono">
              #OS-{String(orden.id).padStart(4, '0')}
            </span>
            <Badge variant={ESTADOS_BADGE[orden.estado] || 'gray'}>
              {ESTADOS_LABEL[orden.estado] || orden.estado}
            </Badge>
          </div>
          <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">
            {nombreEquipo(orden)}
            {orden.equipo_color ? ` · ${orden.equipo_color}` : ''}
          </p>
          <p className="text-xs text-gray-500 truncate">{orden.cliente_nombre}</p>
          {orden.cliente_telefono && (
            <p className="text-xs text-gray-400">{orden.cliente_telefono}</p>
          )}
        </div>
        <button
          onClick={() => setExpandida((v) => !v)}
          className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex-shrink-0"
        >
          {expandida ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {/* Falla + fecha */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-gray-600 flex-1 line-clamp-2">{orden.falla_reportada}</p>
        <p className="text-xs text-gray-400 flex-shrink-0">{formatFechaHora(orden.fecha_recepcion)}</p>
      </div>

      {/* Precios */}
      {(orden.costo_estimado || orden.precio_final) && (
        <div className="flex gap-4 text-xs">
          {orden.costo_estimado && (
            <span className="text-gray-400">
              Estimado: <span className="text-gray-600">{formatCOP(Number(orden.costo_estimado))}</span>
            </span>
          )}
          {orden.precio_final && (
            <span className="text-gray-400">
              Final: <span className="font-semibold text-gray-800">{formatCOP(Number(orden.precio_final))}</span>
            </span>
          )}
        </div>
      )}

      {/* Barra de cobro — solo si tiene precio_final */}
      {orden.precio_final && orden.estado !== 'Sin_reparar' && (
        <BarraCobro
          abonado={Number(orden.total_abonado) || 0}
          total={Number(orden.precio_final)}
        />
      )}

      {/* Saldo pendiente destacado */}
      {tieneSaldo && ['Listo', 'Garantia'].includes(orden.estado) && (
        <p className="text-xs font-semibold text-red-500">
          Saldo pendiente: {formatCOP(saldo)}
        </p>
      )}

      {/* Detalle expandido */}
      {expandida && (
        <div className="border-t border-gray-50 pt-3 flex flex-col gap-1.5">
          {orden.equipo_tipo  && <p className="text-xs text-gray-500">Tipo: {orden.equipo_tipo}</p>}
          {orden.equipo_serial && <p className="text-xs text-gray-500 font-mono">Serial: {orden.equipo_serial}</p>}
          {orden.notas_tecnico && (
            <p className="text-xs text-gray-500">Notas: {orden.notas_tecnico}</p>
          )}
          {orden.motivo_sin_reparar && (
            <p className="text-xs text-orange-600">Motivo: {orden.motivo_sin_reparar}</p>
          )}
          {orden.utilidad != null && (
            <p className="text-xs text-green-600 font-medium">
              Utilidad: {formatCOP(Number(orden.utilidad))}
            </p>
          )}
          {orden.costo_real && (
            <p className="text-xs text-gray-400">
              Costo reparación: {formatCOP(Number(orden.costo_real))}
            </p>
          )}
        </div>
      )}

      {/* Acciones */}
      <AccionesOrden orden={orden} onAccion={onAccion} />
    </div>
  );
}

// ─── Acciones por estado ──────────────────────────────────────────────────────

function AccionesOrden({ orden, onAccion }) {
  const estado = orden.estado;

  return (
    <div className="flex gap-2 flex-wrap">
      {/* Botón Ver detalle siempre visible */}
      <button
        onClick={() => onAccion('detalle', orden)}
        className="text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2"
      >
        Ver detalle
      </button>

      {estado === 'Recibido' && (
        <>
          <Button size="sm" onClick={() => onAccion('en-reparacion', orden)}>
            En reparación
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAccion('sin-reparar', orden)}>
            Sin reparar
          </Button>
        </>
      )}

      {estado === 'En_reparacion' && (
        <>
          <Button size="sm" onClick={() => onAccion('listo', orden)}>
            Marcar listo
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAccion('sin-reparar', orden)}>
            Sin reparar
          </Button>
        </>
      )}

      {estado === 'Listo' && (
        <>
          <Button size="sm" onClick={() => onAccion('abono', orden)}>
            <Plus size={13} /> Abono
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAccion('entregar', orden)}>
            <CheckCircle size={13} /> Entregar
          </Button>
        </>
      )}

      {estado === 'Garantia' && (
        <>
          <Button size="sm" onClick={() => onAccion('listo', orden)}>
            Marcar listo
          </Button>
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

// ─── Modal: Nueva orden ───────────────────────────────────────────────────────

function ModalNuevaOrden({ onClose, onCreada }) {
  const [form, setForm] = useState({
    cliente_nombre:    '',
    cliente_telefono:  '',
    cliente_id:        '',
    equipo_tipo:       '',
    equipo_marca:      '',
    equipo_modelo:     '',
    equipo_color:      '',
    equipo_serial:     '',
    falla_reportada:   '',
    contrasena_equipo: '',
    notas_tecnico:     '',
    costo_estimado:    '',
  });
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [error, setError] = useState('');

  const { data: clientesData } = useQuery({
    queryKey: ['clientes-servicio', busquedaCliente],
    queryFn:  () => getClientes({ busqueda: busquedaCliente }).then((r) => r.data.data),
    enabled:  busquedaCliente.trim().length > 1,
  });
  const clientes = clientesData || [];

  const set = (campo, val) => setForm((f) => ({ ...f, [campo]: val }));

  const mutCrear = useMutation({
    mutationFn: () => crearOrden({
      cliente_nombre:    form.cliente_nombre.trim(),
      cliente_telefono:  form.cliente_telefono || null,
      cliente_id:        form.cliente_id       || null,
      equipo_tipo:       form.equipo_tipo       || null,
      equipo_marca:      form.equipo_marca      || null,
      equipo_modelo:     form.equipo_modelo     || null,
      equipo_color:      form.equipo_color      || null,
      equipo_serial:     form.equipo_serial     || null,
      falla_reportada:   form.falla_reportada.trim(),
      contrasena_equipo: form.contrasena_equipo || null,
      notas_tecnico:     form.notas_tecnico     || null,
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

  return (
    <Modal open onClose={onClose} title="Nueva orden de servicio" size="md">
      <div className="flex flex-col gap-4">

        {/* Sección cliente */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</p>

          {/* Búsqueda cliente registrado */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar cliente registrado..."
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl
                text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
          {clientes.length > 0 && busquedaCliente.trim().length > 1 && (
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              {clientes.slice(0, 4).map((c) => {
                const clienteId = c.id;
                return (
                  <button key={clienteId} onClick={() => seleccionarCliente(c)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50
                      last:border-0 text-sm text-gray-800">
                    {c.nombre} {c.cedula && <span className="text-gray-400 text-xs">· CC {c.cedula}</span>}
                  </button>
                );
              })}
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
        </div>

        {/* Sección equipo */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Equipo</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Tipo</label>
              <select value={form.equipo_tipo} onChange={(e) => set('equipo_tipo', e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700">
                <option value="">Seleccionar...</option>
                {TIPOS_EQUIPO.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <Input label="Marca" placeholder="Samsung, Apple..."
              value={form.equipo_marca}
              onChange={(e) => set('equipo_marca', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Modelo" placeholder="Galaxy A32, iPhone 12..."
              value={form.equipo_modelo}
              onChange={(e) => set('equipo_modelo', e.target.value)} />
            <Input label="Color" placeholder="Negro, blanco..."
              value={form.equipo_color}
              onChange={(e) => set('equipo_color', e.target.value)} />
          </div>
          <Input label="Serial / IMEI (opcional)" placeholder="Ej: 358123456789012"
            value={form.equipo_serial}
            onChange={(e) => set('equipo_serial', e.target.value)} />
        </div>

        {/* Sección falla */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Falla y diagnóstico</p>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Falla reportada *</label>
            <textarea
              placeholder="Describe la falla que reporta el cliente..."
              value={form.falla_reportada}
              onChange={(e) => set('falla_reportada', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Costo estimado</label>
              <InputMoneda
                value={form.costo_estimado}
                onChange={(val) => set('costo_estimado', val)}
                placeholder="0"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                  text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Input label="Contraseña / patrón (uso interno)"
              placeholder="Solo para el técnico"
              value={form.contrasena_equipo}
              onChange={(e) => set('contrasena_equipo', e.target.value)} />
          </div>

          {form.contrasena_equipo && (
            <p className="text-xs text-orange-500">
              Esta información es solo para uso del técnico y no aparece en comprobantes.
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Notas internas (opcional)</label>
            <textarea
              placeholder="Observaciones del técnico..."
              value={form.notas_tecnico}
              onChange={(e) => set('notas_tecnico', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutCrear.isPending}
            disabled={!form.cliente_nombre.trim() || !form.falla_reportada.trim()}
            onClick={() => mutCrear.mutate()}>
            Crear orden
          </Button>
        </div>
      </div>
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

        <div className="bg-blue-50 rounded-xl px-3 py-2.5">
          <p className="text-sm font-medium text-blue-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-blue-600">{orden.cliente_nombre}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            ¿Cuánto te costó el arreglo? <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <InputMoneda value={costoReal} onChange={setCostoReal} placeholder="0"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-gray-400">Repuestos + mano de obra. Se usa para calcular tu utilidad.</p>
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
          <div className={`rounded-xl px-3 py-2 text-sm font-medium
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

// ─── Modal: Registrar abono ───────────────────────────────────────────────────

function ModalAbono({ orden, onClose, onExito }) {
  const [valor,  setValor]  = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [notas,  setNotas]  = useState('');
  const [error,  setError]  = useState('');

  const saldo = Number(orden.precio_final || 0) - Number(orden.total_abonado || 0);

  const mutAbono = useMutation({
    mutationFn: () => registrarAbono(orden.id, { valor: Number(valor), metodo, notas: notas || null }),
    onSuccess: () => { onExito(); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'Error al registrar el abono'),
  });

  return (
    <Modal open onClose={onClose} title="Registrar abono" size="sm">
      <div className="flex flex-col gap-4">

        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-sm font-medium text-gray-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-gray-500">{orden.cliente_nombre}</p>
          <div className="flex gap-4 mt-1 text-xs">
            <span className="text-gray-400">Total: {formatCOP(Number(orden.precio_final))}</span>
            <span className="text-gray-400">Abonado: {formatCOP(Number(orden.total_abonado))}</span>
            <span className="text-red-500 font-medium">Saldo: {formatCOP(saldo)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor del abono *</label>
          <InputMoneda value={valor} onChange={setValor} placeholder="0"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Método de pago</label>
          <div className="flex gap-2 flex-wrap">
            {METODOS_PAGO.map((m) => {
              const metodoKey = m;
              return (
                <button key={metodoKey} onClick={() => setMetodo(m)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                    ${metodo === m
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
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
            disabled={!valor || Number(valor) <= 0}
            onClick={() => mutAbono.mutate()}>
            Registrar abono
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: Entregar ──────────────────────────────────────────────────────────

function ModalEntregar({ orden, onClose, onExito }) {
  const [forzar,    setForzar]    = useState(false);
  const [saldoAlerta, setSaldoAlerta] = useState(null);
  const [error,     setError]     = useState('');

  const saldo = Number(orden.precio_final || 0) - Number(orden.total_abonado || 0);

  const mutEntregar = useMutation({
    mutationFn: () => entregarOrden(orden.id, forzar),
    onSuccess: () => { onExito(); onClose(); },
    onError:   (err) => {
      if (err.response?.status === 409) {
        setSaldoAlerta(err.response.data.saldo);
      } else {
        setError(err.response?.data?.error || 'Error al entregar');
      }
    },
  });

  return (
    <Modal open onClose={onClose} title="Entregar equipo" size="sm">
      <div className="flex flex-col gap-4">

        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-sm font-medium text-gray-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-gray-500">{orden.cliente_nombre}</p>
        </div>

        {/* Primera vez: sin saldo pendiente */}
        {!saldoAlerta && saldo <= 0 && (
          <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2.5">
            <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">
              Pago completo — {formatCOP(Number(orden.precio_final))}
            </p>
          </div>
        )}

        {/* Alerta de saldo pendiente — pide confirmación */}
        {(saldoAlerta || saldo > 0) && !forzar && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-3">
              <AlertTriangle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-orange-700">Saldo pendiente</p>
                <p className="text-xs text-orange-600 mt-0.5">
                  El cliente debe {formatCOP(saldoAlerta || saldo)}.
                  ¿Deseas entregar el equipo igual?
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)}
                className="rounded" />
              <span className="text-sm text-gray-700">
                Sí, entregar aunque quede saldo pendiente
              </span>
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
  const [motivo,    setMotivo]    = useState('');
  const [precio,    setPrecio]    = useState('');
  const [error,     setError]     = useState('');

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
          <p className="text-sm font-medium text-orange-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-orange-600">{orden.cliente_nombre}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Motivo *</label>
          <div className="flex flex-col gap-1.5">
            {MOTIVOS_SIN_REPARAR.map((m) => {
              const motivoKey = m;
              return (
                <label key={motivoKey} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="motivo" value={m} checked={motivo === m}
                    onChange={() => setMotivo(m)} />
                  <span className="text-sm text-gray-700">{m}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Cobro por diagnóstico <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <InputMoneda value={precio} onChange={setPrecio} placeholder="0"
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-gray-400">Si no cobras diagnóstico, deja en 0.</p>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutSinReparar.isPending}
            disabled={!motivo}
            onClick={() => mutSinReparar.mutate()}>
            Confirmar devolución
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: Abrir garantía ────────────────────────────────────────────────────

function ModalGarantia({ orden, onClose, onExito }) {
  const [cobrable, setCobrable] = useState(false);
  const [notas,    setNotas]    = useState('');
  const [error,    setError]    = useState('');

  const mutGarantia = useMutation({
    mutationFn: () => abrirGarantia(orden.id, { cobrable, notas_tecnico: notas || null }),
    onSuccess: () => { onExito(); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'Error'),
  });

  return (
    <Modal open onClose={onClose} title="Activar garantía" size="sm">
      <div className="flex flex-col gap-4">

        <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5">
          <p className="text-sm font-medium text-purple-800">{nombreEquipo(orden)}</p>
          <p className="text-xs text-purple-600">{orden.cliente_nombre}</p>
          <p className="text-xs text-purple-500 mt-1">
            Reparado anteriormente · {formatCOP(Number(orden.precio_final || 0))}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-gray-700">¿La garantía es cobrable?</p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="radio" name="cobrable" checked={!cobrable}
              onChange={() => setCobrable(false)} className="mt-0.5" />
            <div>
              <p className="text-sm text-gray-700">No — misma falla</p>
              <p className="text-xs text-gray-400">La reparación es gratis</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="radio" name="cobrable" checked={cobrable}
              onChange={() => setCobrable(true)} className="mt-0.5" />
            <div>
              <p className="text-sm text-gray-700">Sí — falla diferente</p>
              <p className="text-xs text-gray-400">Se definirá un nuevo precio al marcar listo</p>
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

// ─── Modal: Detalle de orden ──────────────────────────────────────────────────

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
  const saldo = Number(data.precio_final || 0) - Number(data.total_abonado || 0);

  return (
    <Modal open onClose={onClose} title={`Orden #OS-${String(data.id).padStart(4, '0')}`} size="md">
      <div className="flex flex-col gap-4">

        {/* Estado + equipo */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-base font-semibold text-gray-900">{nombreEquipo(data)}</p>
            {data.equipo_color  && <p className="text-xs text-gray-400">{data.equipo_color}</p>}
            {data.equipo_serial && <p className="text-xs text-gray-400 font-mono">Serial: {data.equipo_serial}</p>}
          </div>
          <Badge variant={ESTADOS_BADGE[data.estado] || 'gray'}>
            {ESTADOS_LABEL[data.estado] || data.estado}
          </Badge>
        </div>

        {/* Cliente */}
        <div className="bg-gray-50 rounded-xl px-3 py-2.5">
          <p className="text-sm font-medium text-gray-800">{data.cliente_nombre}</p>
          {data.cliente_telefono && <p className="text-xs text-gray-500">{data.cliente_telefono}</p>}
        </div>

        {/* Falla + notas */}
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Falla reportada</p>
          <p className="text-sm text-gray-700">{data.falla_reportada}</p>
        </div>
        {data.notas_tecnico && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Notas del técnico</p>
            <p className="text-sm text-gray-700">{data.notas_tecnico}</p>
          </div>
        )}

        {/* Precios */}
        <div className="grid grid-cols-2 gap-3">
          {data.costo_estimado && (
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-400">Estimado</p>
              <p className="text-sm font-semibold text-gray-700">{formatCOP(Number(data.costo_estimado))}</p>
            </div>
          )}
          {data.precio_final && (
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-400">Precio final</p>
              <p className="text-sm font-bold text-gray-900">{formatCOP(Number(data.precio_final))}</p>
            </div>
          )}
          {data.costo_real && (
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-400">Costo reparación</p>
              <p className="text-sm font-semibold text-gray-700">{formatCOP(Number(data.costo_real))}</p>
            </div>
          )}
          {data.utilidad != null && (
            <div className={`rounded-xl px-3 py-2 ${Number(data.utilidad) >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className="text-xs text-gray-400">Utilidad</p>
              <p className={`text-sm font-bold ${Number(data.utilidad) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                {formatCOP(Number(data.utilidad))}
              </p>
            </div>
          )}
        </div>

        {/* Cobro */}
        {data.precio_final && (
          <div>
            <BarraCobro
              abonado={Number(data.total_abonado) || 0}
              total={Number(data.precio_final)}
            />
            {saldo > 0 && (
              <p className="text-xs text-red-500 font-medium mt-1">
                Saldo pendiente: {formatCOP(saldo)}
              </p>
            )}
          </div>
        )}

        {/* Historial de abonos */}
        {data.abonos?.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Historial de abonos
            </p>
            {data.abonos.map((ab) => {
              const abonoId = ab.id;
              return (
                <div key={abonoId}
                  className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                  <div>
                    <p className="text-xs text-gray-500">{formatFechaHora(ab.fecha)}</p>
                    <p className="text-xs text-gray-400">{ab.metodo}</p>
                  </div>
                  <p className="text-sm font-semibold text-green-600">{formatCOP(Number(ab.valor))}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Motivo sin reparar */}
        {data.motivo_sin_reparar && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5">
            <p className="text-xs font-semibold text-orange-700">Motivo de devolución</p>
            <p className="text-sm text-orange-600">{data.motivo_sin_reparar}</p>
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

  const [busqueda,       setBusqueda]       = useState('');
  const [filtroEstado,   setFiltroEstado]   = useState('');
  const [modalNueva,     setModalNueva]     = useState(false);
  const [accionActual,   setAccionActual]   = useState(null); // { tipo, orden }

  const { data: resumenData, isLoading: loadingResumen } = useQuery({
    queryKey: ['servicios-resumen-hoy'],
    queryFn:  () => getResumenHoy().then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const { data: ordenesData, isLoading: loadingOrdenes } = useQuery({
    queryKey: ['ordenes-servicio', busqueda, filtroEstado],
    queryFn:  () => getOrdenes({ busqueda: busqueda || undefined, estado: filtroEstado || undefined })
                      .then((r) => r.data.data),
  });

  const ordenes = ordenesData || [];

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['ordenes-servicio'],     exact: false });
    queryClient.invalidateQueries({ queryKey: ['servicios-resumen-hoy'] });
  };

  const mutEnReparacion = useMutation({
    mutationFn: (id) => marcarEnReparacion(id),
    onSuccess:  invalidar,
  });

  const handleAccion = (tipo, orden) => {
    if (tipo === 'en-reparacion') {
      mutEnReparacion.mutate(orden.id);
      return;
    }
    setAccionActual({ tipo, orden });
  };

  const cerrarModal = () => setAccionActual(null);

  const ESTADOS_FILTRO = [
    { id: '',             label: 'Todas'         },
    { id: 'Recibido',     label: 'Recibidos'     },
    { id: 'En_reparacion',label: 'En reparación' },
    { id: 'Listo',        label: 'Listos'        },
    { id: 'Garantia',     label: 'Garantía'      },
    { id: 'Entregado',    label: 'Entregados'    },
    { id: 'Sin_reparar',  label: 'Sin reparar'   },
  ];

  return (
    <>
      <div className="flex flex-col gap-4 max-w-2xl mx-auto">

        {/* Métricas */}
        <PanelMetricas resumen={resumenData} loading={loadingResumen} />

        {/* Barra de herramientas */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <SearchInput
                value={busqueda}
                onChange={setBusqueda}
                placeholder="Buscar por cliente, equipo o #..."
              />
            </div>
            <Button onClick={() => setModalNueva(true)}>
              <Plus size={16} /> Nueva orden
            </Button>
          </div>

          {/* Filtros de estado */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {ESTADOS_FILTRO.map((e) => {
              const estadoKey = e.id || 'todas';
              return (
                <button key={estadoKey} onClick={() => setFiltroEstado(e.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex-shrink-0 transition-all
                    ${filtroEstado === e.id
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-100 text-gray-600 hover:border-gray-200'}`}>
                  {e.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista de órdenes */}
        {loadingOrdenes ? (
          <Spinner className="py-12" />
        ) : ordenes.length === 0 ? (
          <EmptyState
            icon={Wrench}
            titulo="Sin órdenes"
            descripcion={busqueda || filtroEstado
              ? 'Sin resultados para ese filtro'
              : 'Crea la primera orden de servicio'}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {ordenes.map((orden) => {
              const ordenKey = orden.id;
              return (
                <CardOrden key={ordenKey} orden={orden} onAccion={handleAccion} />
              );
            })}
          </div>
        )}

      </div>

      {/* Modales */}
      {modalNueva && (
        <ModalNuevaOrden
          onClose={() => setModalNueva(false)}
          onCreada={invalidar}
        />
      )}

      {accionActual?.tipo === 'listo' && (
        <ModalMarcarListo
          orden={accionActual.orden}
          onClose={cerrarModal}
          onExito={invalidar}
        />
      )}

      {accionActual?.tipo === 'abono' && (
        <ModalAbono
          orden={accionActual.orden}
          onClose={cerrarModal}
          onExito={invalidar}
        />
      )}

      {accionActual?.tipo === 'entregar' && (
        <ModalEntregar
          orden={accionActual.orden}
          onClose={cerrarModal}
          onExito={invalidar}
        />
      )}

      {accionActual?.tipo === 'sin-reparar' && (
        <ModalSinReparar
          orden={accionActual.orden}
          onClose={cerrarModal}
          onExito={invalidar}
        />
      )}

      {accionActual?.tipo === 'garantia' && (
        <ModalGarantia
          orden={accionActual.orden}
          onClose={cerrarModal}
          onExito={invalidar}
        />
      )}

      {accionActual?.tipo === 'detalle' && (
        <ModalDetalleOrden
          ordenId={accionActual.orden.id}
          onClose={cerrarModal}
        />
      )}
    </>
  );
}