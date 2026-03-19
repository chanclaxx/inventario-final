import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal }         from '../../components/ui/Modal';
import { Button }        from '../../components/ui/Button';
import { Input }         from '../../components/ui/Input';
import { Spinner }       from '../../components/ui/Spinner';
import { Badge }         from '../../components/ui/Badge';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { crearPrestamos } from '../../api/prestamos.api';
import {
  getPrestatarios, crearPrestatario,
  getEmpleados,    crearEmpleado,
} from '../../api/prestatarios.api';
import { getClientes, crearCliente } from '../../api/clientes.api';
import {
  getDomiciliarios,
  getEntregas,
  getEntregaById,
  registrarAbono,
  marcarDevolucion,
} from '../../api/domiciliarios.api';
import useCarritoStore from '../../store/carritoStore';
import {
  User, Users, Bike, Plus, Minus, ChevronLeft,
  Search, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { InputMoneda } from '../../components/ui/InputMoneda';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'prestamo',     label: 'Préstamo',     Icn: Users },
  { id: 'domiciliario', label: 'Domiciliarios', Icn: Bike  },
];

const TIPOS_CLIENTE = [
  { id: 'companero', label: 'Compañero', Icn: User  },
  { id: 'cliente',   label: 'Cliente',   Icn: Users },
];

const ESTADO_BADGE = {
  Pendiente:    'yellow',
  Entregado:    'green',
  No_entregado: 'red',
};

const ESTADO_LABEL = {
  Pendiente:    'Pendiente',
  Entregado:    'Entregado',
  No_entregado: 'No entregado',
};

// ─── Componentes reutilizables ────────────────────────────────────────────────

function SelectorOCrear({ items, onSeleccionar, onCrear, placeholder, labelCrear, loading, renderItem }) {
  const [modo,   setModo]   = useState('seleccionar');
  const [nombre, setNombre] = useState('');

  if (loading) return <Spinner className="py-4" />;

  if (modo === 'crear') {
    return (
      <div className="flex flex-col gap-2">
        <button
          onClick={() => { setModo('seleccionar'); setNombre(''); }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-fit"
        >
          <ChevronLeft size={13} /> Volver
        </button>
        <Input label={labelCrear} placeholder="Nombre..." value={nombre}
          onChange={(e) => setNombre(e.target.value)} autoFocus />
        <Button size="sm" disabled={!nombre.trim()}
          onClick={() => { onCrear(nombre.trim()); setNombre(''); setModo('seleccionar'); }}>
          Guardar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 ? (
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {items.map((item) => {
            const itemId = item.id;
            return (
              <button key={itemId} onClick={() => onSeleccionar(item)}
                className="text-left px-3 py-2 rounded-xl border border-gray-100
                  hover:border-blue-200 hover:bg-blue-50/30 transition-colors text-sm text-gray-800">
                {renderItem ? renderItem(item) : item.nombre}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-400 px-1">{placeholder}</p>
      )}
      <button onClick={() => setModo('crear')}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 w-fit">
        <Plus size={13} /> {labelCrear}
      </button>
    </div>
  );
}

function SelectorOCrearCliente({ items, onSeleccionar, onCrear, loading }) {
  const [modo,     setModo]     = useState('seleccionar');
  const [busqueda, setBusqueda] = useState('');
  const [form,     setForm]     = useState({ nombre: '', cedula: '', celular: '', direccion: '', notas: '' });

  const mostrarResultados = busqueda.trim().length > 0;
  const clientesFiltrados = mostrarResultados
    ? items.filter((c) => {
        const q = busqueda.toLowerCase();
        return c.nombre?.toLowerCase().includes(q) || c.cedula?.toLowerCase().includes(q);
      })
    : [];

  const handleCrear = () => {
    if (!form.nombre.trim() || !form.cedula.trim()) return;
    onCrear(form);
    setForm({ nombre: '', cedula: '', celular: '', direccion: '', notas: '' });
    setModo('seleccionar');
  };

  if (loading) return <Spinner className="py-4" />;

  if (modo === 'crear') {
    return (
      <div className="flex flex-col gap-3">
        <button onClick={() => setModo('seleccionar')}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-fit">
          <ChevronLeft size={13} /> Volver
        </button>
        <Input label="Nombre completo *" placeholder="Nombre del cliente"
          value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} autoFocus />
        <Input label="Cédula *" placeholder="123456789"
          value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })} />
        <Input label="Celular" placeholder="3001234567"
          value={form.celular} onChange={(e) => setForm({ ...form, celular: e.target.value })} />
        <Input label="Dirección" placeholder="Calle 123..."
          value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
        <Button size="sm" disabled={!form.nombre.trim() || !form.cedula.trim()} onClick={handleCrear}>
          Guardar cliente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Buscar por nombre o cédula..."
          value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl
            text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
      </div>
      {mostrarResultados && (
        clientesFiltrados.length > 0 ? (
          <div className="flex flex-col gap-1 max-h-44 overflow-y-auto rounded-xl border border-gray-100 bg-white">
            {clientesFiltrados.map((item) => {
              const itemId = item.id;
              return (
                <button key={itemId} onClick={() => onSeleccionar(item)}
                  className="text-left px-3 py-2.5 hover:bg-blue-50 transition-colors
                    border-b border-gray-50 last:border-0">
                  <p className="text-sm font-medium text-gray-800">{item.nombre}</p>
                  <p className="text-xs text-gray-400">
                    CC: {item.cedula}{item.celular ? ` · Tel: ${item.celular}` : ''}
                  </p>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400 px-1">Sin resultados para "{busqueda}"</p>
        )
      )}
      <button onClick={() => setModo('crear')}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 w-fit">
        <Plus size={13} /> Agregar cliente
      </button>
    </div>
  );
}

function ChipSeleccionado({ nombre, onCambiar }) {
  return (
    <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
      <span className="text-sm font-medium text-blue-800">{nombre}</span>
      <button onClick={onCambiar} className="text-xs text-blue-400 hover:text-blue-600">Cambiar</button>
    </div>
  );
}

function ResumenCarrito({ items, onActualizarPrecio, onActualizarCantidad }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-3">
      <p className="text-xs font-medium text-gray-500">
        Producto{items.length > 1 ? `s a prestar (${items.length})` : ' a prestar'}
      </p>
      {items.map((item) => (
        <div key={item.key} className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-gray-800 truncate">{item.nombre}</p>
          {item.imei && <p className="text-xs text-gray-400 font-mono">{item.imei}</p>}
          <div className="flex items-center gap-2">
            {item.tipo === 'cantidad' && (
              <div className="flex items-center gap-1">
                <button onClick={() => onActualizarCantidad(item.key, (item.cantidad || 1) - 1)}
                  className="w-6 h-6 rounded-lg bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors">
                  <Minus size={11} />
                </button>
                <span className="text-sm font-medium w-6 text-center">{item.cantidad || 1}</span>
                <button onClick={() => onActualizarCantidad(item.key, (item.cantidad || 1) + 1)}
                  disabled={(item.cantidad || 1) >= item.stock}
                  className="w-6 h-6 rounded-lg bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors disabled:opacity-40">
                  <Plus size={11} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs text-gray-400">$</span>
              <InputMoneda value={item.precioFinal} onChange={(val) => onActualizarPrecio(item.key, val)}
                className="w-28 text-right text-sm font-semibold text-gray-800 bg-white
                  border border-gray-200 rounded-lg px-2 py-1 focus:outline-none
                  focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tab domiciliarios ────────────────────────────────────────────────────────

function BarraProgreso({ abonado, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((abonado / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>Abonado: {formatCOP(abonado)}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-orange-400 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>Pendiente: {formatCOP(Math.max(0, total - abonado))}</span>
        <span>Total: {formatCOP(total)}</span>
      </div>
    </div>
  );
}

function TarjetaEntrega({ entrega, onSeleccionar }) {
  const estadoBadge = ESTADO_BADGE[entrega.estado] || 'gray';
  const estadoLabel = ESTADO_LABEL[entrega.estado] || entrega.estado;

  return (
    <button
      onClick={() => onSeleccionar(entrega)}
      className="w-full text-left bg-white border border-gray-100 rounded-xl p-3
        hover:border-orange-200 hover:bg-orange-50/20 transition-colors flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">
            {entrega.nombre_cliente}
          </p>
          <p className="text-xs text-gray-400">
            Factura #{String(entrega.factura_id).padStart(6, '0')}
          </p>
          {entrega.direccion_entrega && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{entrega.direccion_entrega}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Badge variant={estadoBadge}>{estadoLabel}</Badge>
          <span className="text-xs text-gray-400">{formatFechaHora(entrega.fecha_asignacion)}</span>
        </div>
      </div>

      {entrega.estado === 'Pendiente' && (
        <BarraProgreso
          abonado={Number(entrega.total_abonado)}
          total={Number(entrega.valor_total)}
        />
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-orange-600 font-medium">
          {entrega.domiciliario_nombre}
        </span>
        <ChevronRight size={14} className="text-gray-300" />
      </div>
    </button>
  );
}

function PanelDetalleEntrega({ entregaId, onVolver, queryClient }) {
  const [valorAbono, setValorAbono]   = useState('');
  const [notasAbono, setNotasAbono]   = useState('');
  const [errorLocal, setErrorLocal]   = useState('');
  const [confirmarDev, setConfirmarDev] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['entrega-detalle', entregaId],
    queryFn:  () => getEntregaById(entregaId).then((r) => r.data.data),
    enabled:  !!entregaId,
  });

  const mutAbono = useMutation({
    mutationFn: (datos) => registrarAbono(entregaId, datos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entregas-domicilio'], exact: false });
      refetch();
      setValorAbono('');
      setNotasAbono('');
      setErrorLocal('');
    },
    onError: (err) => setErrorLocal(err.response?.data?.error || 'Error al registrar abono'),
  });

  const mutDevolucion = useMutation({
    mutationFn: () => marcarDevolucion(entregaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entregas-domicilio'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],           exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],  exact: false });
      refetch();
      setConfirmarDev(false);
    },
    onError: (err) => setErrorLocal(err.response?.data?.error || 'Error al procesar devolución'),
  });

  const handleAbono = () => {
    setErrorLocal('');
    const val = Number(valorAbono);
    if (!val || val <= 0) return setErrorLocal('El valor debe ser mayor a 0');
    mutAbono.mutate({ valor: val, notas: notasAbono || null });
  };

  if (isLoading) return <Spinner className="py-10" />;

  const e             = data;
  const saldoPendiente = Math.max(0, Number(e?.valor_total || 0) - Number(e?.total_abonado || 0));
  const esPendiente    = e?.estado === 'Pendiente';

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onVolver}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-fit">
        <ChevronLeft size={13} /> Volver a la lista
      </button>

      {/* Cabecera */}
      <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">{e?.nombre_cliente}</p>
          <Badge variant={ESTADO_BADGE[e?.estado] || 'gray'}>
            {ESTADO_LABEL[e?.estado] || e?.estado}
          </Badge>
        </div>
        <p className="text-xs text-gray-500">
          Factura #{String(e?.factura_id || 0).padStart(6, '0')}
          {e?.cliente_celular ? ` · ${e.cliente_celular}` : ''}
        </p>
        <p className="text-xs text-orange-600 font-medium">
          Domiciliario: {e?.domiciliario_nombre}
          {e?.domiciliario_telefono ? ` · ${e.domiciliario_telefono}` : ''}
        </p>
        {e?.direccion_entrega && (
          <p className="text-xs text-gray-500">{e.direccion_entrega}</p>
        )}
        {e?.notas && (
          <p className="text-xs text-gray-400 italic">{e.notas}</p>
        )}
        <p className="text-xs text-gray-400">{formatFechaHora(e?.fecha_asignacion)}</p>
      </div>

      {/* Barra de progreso */}
      <BarraProgreso
        abonado={Number(e?.total_abonado || 0)}
        total={Number(e?.valor_total || 0)}
      />

      {/* Historial de abonos */}
      {e?.abonos?.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Historial de abonos
          </p>
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
            {e.abonos.map((abono) => {
              const abonoId = abono.id;
              return (
                <div key={abonoId}
                  className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                  <div>
                    <p className="text-xs text-gray-500">{formatFechaHora(abono.fecha)}</p>
                    {abono.notas && <p className="text-xs text-gray-400 italic">{abono.notas}</p>}
                    {abono.usuario_nombre && (
                      <p className="text-xs text-gray-400">por {abono.usuario_nombre}</p>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-green-600">
                    + {formatCOP(abono.valor)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Formulario de abono — solo si está pendiente */}
      {esPendiente && (
        <div className="flex flex-col gap-2 p-3 bg-green-50 border border-green-100 rounded-xl">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">
            Registrar abono
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">
              Valor (máx. {formatCOP(saldoPendiente)})
            </label>
            <InputMoneda
              value={valorAbono}
              onChange={setValorAbono}
              placeholder="0"
              className="w-full px-3 py-2 bg-white border border-green-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-green-400 transition-all"
            />
          </div>
          <Input
            label="Notas (opcional)"
            placeholder="Observaciones del abono..."
            value={notasAbono}
            onChange={(e) => setNotasAbono(e.target.value)}
          />
          <Button
            size="sm"
            loading={mutAbono.isPending}
            disabled={!valorAbono || Number(valorAbono) <= 0}
            onClick={handleAbono}
            className="bg-green-600 hover:bg-green-700"
          >
            Registrar abono
          </Button>
        </div>
      )}

      {/* Botón devolución — solo si está pendiente */}
      {esPendiente && !confirmarDev && (
        <button
          onClick={() => setConfirmarDev(true)}
          className="w-full py-2.5 rounded-xl text-sm font-medium border border-red-200
            text-red-500 bg-red-50 hover:bg-red-100 transition-colors"
        >
          Marcar como no entregado (devolución)
        </button>
      )}

      {esPendiente && confirmarDev && (
        <div className="flex flex-col gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">
              Esto cancelará la factura y revertirá el stock al inventario.
              Esta acción no se puede deshacer.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1"
              onClick={() => setConfirmarDev(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="flex-1 bg-red-500 hover:bg-red-600"
              loading={mutDevolucion.isPending}
              onClick={() => mutDevolucion.mutate()}>
              Confirmar devolución
            </Button>
          </div>
        </div>
      )}

      {errorLocal && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-sm text-red-600">{errorLocal}</p>
        </div>
      )}
    </div>
  );
}

function TabDomiciliarios({ open }) {
  const queryClient = useQueryClient();
  const [filtroDomiciliario, setFiltroDomiciliario] = useState('');
  const [filtroEstado,       setFiltroEstado]       = useState('');
  const [entregaSeleccionada, setEntregaSeleccionada] = useState(null);

  const { data: domiciliariosData } = useQuery({
    queryKey: ['domiciliarios'],
    queryFn:  () => getDomiciliarios().then((r) => r.data.data),
    enabled:  open,
  });

  const { data: entregasData, isLoading } = useQuery({
    queryKey: ['entregas-domicilio', filtroDomiciliario, filtroEstado],
    queryFn:  () => getEntregas({
      domiciliario_id: filtroDomiciliario || undefined,
      estado:          filtroEstado       || undefined,
    }).then((r) => r.data.data),
    enabled: open,
  });

  const domiciliarios = domiciliariosData || [];
  const entregas      = entregasData      || [];

  if (entregaSeleccionada) {
    return (
      <PanelDetalleEntrega
        entregaId={entregaSeleccionada}
        onVolver={() => setEntregaSeleccionada(null)}
        queryClient={queryClient}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {domiciliarios.length > 0 && (
          <select
            value={filtroDomiciliario}
            onChange={(e) => setFiltroDomiciliario(e.target.value)}
            className="flex-1 min-w-[140px] py-2 px-3 bg-gray-50 border border-gray-200
              rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400
              focus:bg-white transition-all text-gray-700"
          >
            <option value="">Todos los domiciliarios</option>
            {domiciliarios.map((d) => {
              const domId = d.id;
              return (
                <option key={domId} value={domId}>{d.nombre}</option>
              );
            })}
          </select>
        )}
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="flex-1 min-w-[120px] py-2 px-3 bg-gray-50 border border-gray-200
            rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400
            focus:bg-white transition-all text-gray-700"
        >
          <option value="">Todos los estados</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Entregado">Entregado</option>
          <option value="No_entregado">No entregado</option>
        </select>
      </div>

      {/* Lista */}
      {isLoading ? (
        <Spinner className="py-8" />
      ) : entregas.length === 0 ? (
        <div className="py-8 text-center">
          <Bike size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Sin pedidos domiciliarios</p>
          <p className="text-xs text-gray-300 mt-1">
            Los pedidos aparecen al crear facturas con domicilio
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
          {entregas.map((entrega) => {
            const entregaId = entrega.id;
            return (
              <TarjetaEntrega
                key={entregaId}
                entrega={entrega}
                onSeleccionar={(e) => setEntregaSeleccionada(e.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab préstamos ────────────────────────────────────────────────────────────

function TabPrestamo({ open, onClose }) {
  const queryClient = useQueryClient();
  const { items, totalCarrito, limpiarCarrito, actualizarPrecio, actualizarCantidad } = useCarritoStore();
  const total = totalCarrito();

  const [tipoCliente,    setTipoCliente]    = useState('companero');
  const [prestatarioSel, setPrestatarioSel] = useState(null);
  const [empleadoSel,    setEmpleadoSel]    = useState(null);
  const [clienteSel,     setClienteSel]     = useState(null);
  const [error,          setError]          = useState('');

  const { data: prestatariosData, isLoading: loadingPrestatarios } = useQuery({
    queryKey: ['prestatarios'],
    queryFn:  () => getPrestatarios().then((r) => r.data.data),
    enabled:  open && tipoCliente === 'companero',
  });

  const { data: empleadosData, isLoading: loadingEmpleados } = useQuery({
    queryKey: ['empleados', prestatarioSel?.id],
    queryFn:  () => getEmpleados(prestatarioSel.id).then((r) => r.data.data),
    enabled:  !!prestatarioSel,
  });

  const { data: clientesData, isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes-prestamo'],
    queryFn:  () => getClientes().then((r) => r.data.data),
    enabled:  open && tipoCliente === 'cliente',
  });

  const mutCrearPrestatario = useMutation({
    mutationFn: (nombre) => crearPrestatario({ nombre }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestatarios'], exact: false });
      setPrestatarioSel(res.data.data);
    },
  });

  const mutCrearEmpleado = useMutation({
    mutationFn: (nombre) => crearEmpleado(prestatarioSel.id, { nombre }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['empleados', prestatarioSel.id], exact: false });
      setEmpleadoSel(res.data.data);
    },
  });

  const mutCrearCliente = useMutation({
    mutationFn: (datos) => crearCliente({
      nombre:    datos.nombre,
      cedula:    datos.cedula,
      celular:   datos.celular   || '',
      direccion: datos.direccion || '',
      email:     '',
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['clientes-prestamo'], exact: false });
      setClienteSel(res.data.data);
    },
  });

  const mutPrestamos = useMutation({
    mutationFn: crearPrestamos,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['prestamos'],           exact: false });
      limpiarCarrito();
      onClose();
      resetForm();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar el préstamo'),
  });

  const resetForm = () => {
    setTipoCliente('companero');
    setPrestatarioSel(null);
    setEmpleadoSel(null);
    setClienteSel(null);
    setError('');
  };

  const buildItems = () =>
    items.map((item) => ({
      nombre_producto:   item.nombre,
      imei:              item.imei        || null,
      producto_id:       item.producto_id || null,
      cantidad_prestada: item.cantidad    || 1,
      valor_prestamo:    item.precioFinal,
    }));

  const handleSubmit = () => {
    setError('');
    if (items.length === 0) return setError('El carrito está vacío');
    if (tipoCliente === 'companero') {
      if (!prestatarioSel) return setError('Selecciona o crea un prestatario');
      if (!empleadoSel)    return setError('Selecciona o agrega un empleado');
      mutPrestamos.mutate({
        prestatario:    prestatarioSel.nombre,
        cedula:         'COMPANERO',
        telefono:       '0000000000',
        prestatario_id: prestatarioSel.id,
        empleado_id:    empleadoSel.id,
        cliente_id:     null,
        items:          buildItems(),
      });
    } else {
      if (!clienteSel) return setError('Selecciona o crea un cliente');
      mutPrestamos.mutate({
        prestatario:    clienteSel.nombre,
        cedula:         clienteSel.cedula  || 'S/C',
        telefono:       clienteSel.celular || '0000000000',
        prestatario_id: null,
        empleado_id:    null,
        cliente_id:     clienteSel.id,
        items:          buildItems(),
      });
    }
  };

  const prestatarios = prestatariosData || [];
  const empleados    = empleadosData    || [];
  const clientes     = clientesData     || [];

  return (
    <div className="flex flex-col gap-5">
      {/* Tipo de destinatario */}
      <div className="flex gap-2">
        {TIPOS_CLIENTE.map((tab) => {
          const tabId    = tab.id;
          const tabLabel = tab.label;
          const TabIcon  = tab.Icn;
          return (
            <button key={tabId}
              onClick={() => {
                setTipoCliente(tabId);
                setPrestatarioSel(null);
                setEmpleadoSel(null);
                setClienteSel(null);
                setError('');
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
                text-sm font-medium border transition-all
                ${tipoCliente === tabId
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              <TabIcon size={16} /> {tabLabel}
            </button>
          );
        })}
      </div>

      {items.length > 0 && (
        <ResumenCarrito items={items} onActualizarPrecio={actualizarPrecio} onActualizarCantidad={actualizarCantidad} />
      )}

      {tipoCliente === 'companero' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">1. Prestatario (negocio)</p>
            {prestatarioSel ? (
              <ChipSeleccionado nombre={prestatarioSel.nombre}
                onCambiar={() => { setPrestatarioSel(null); setEmpleadoSel(null); }} />
            ) : (
              <SelectorOCrear items={prestatarios} loading={loadingPrestatarios}
                placeholder="Sin prestatarios registrados" labelCrear="Agregar prestatario"
                onSeleccionar={(p) => setPrestatarioSel(p)}
                onCrear={(nombre) => mutCrearPrestatario.mutate(nombre)} />
            )}
          </div>
          <div className={`flex flex-col gap-2 ${!prestatarioSel ? 'opacity-40 pointer-events-none' : ''}`}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">2. Empleado</p>
            {empleadoSel ? (
              <ChipSeleccionado nombre={empleadoSel.nombre} onCambiar={() => setEmpleadoSel(null)} />
            ) : (
              <SelectorOCrear items={empleados} loading={loadingEmpleados}
                placeholder="Sin empleados registrados" labelCrear="Agregar empleado"
                onSeleccionar={(e) => setEmpleadoSel(e)}
                onCrear={(nombre) => mutCrearEmpleado.mutate(nombre)} />
            )}
          </div>
        </div>
      )}

      {tipoCliente === 'cliente' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</p>
          {clienteSel ? (
            <ChipSeleccionado nombre={clienteSel.nombre} onCambiar={() => setClienteSel(null)} />
          ) : (
            <SelectorOCrearCliente items={clientes} loading={loadingClientes}
              onSeleccionar={(c) => setClienteSel(c)}
              onCrear={(datos) => mutCrearCliente.mutate(datos)} />
          )}
        </div>
      )}

      <div className="bg-gray-50 rounded-xl px-3 py-2.5 flex justify-between items-center">
        <span className="text-sm text-gray-600">Total{items.length > 1 ? ` (${items.length} productos)` : ''}</span>
        <span className="text-sm font-bold text-gray-900">{formatCOP(total)}</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1" loading={mutPrestamos.isPending} onClick={handleSubmit}>
          Registrar Préstamo{items.length > 1 ? `s (${items.length})` : ''}
        </Button>
      </div>
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalPrestamo({ open, onClose }) {
  const [tabActivo, setTabActivo] = useState('prestamo');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tabActivo === 'prestamo' ? 'Registrar Préstamo' : 'Domiciliarios'}
      size="md"
    >
      {/* Selector de tab */}
      <div className="flex gap-2 mb-5">
        {TABS.map((tab) => {
          const tabId    = tab.id;
          const tabLabel = tab.label;
          const TabIcon  = tab.Icn;
          return (
            <button key={tabId}
              onClick={() => setTabActivo(tabId)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
                text-sm font-medium border transition-all
                ${tabActivo === tabId
                  ? tabId === 'domiciliario'
                    ? 'bg-orange-50 border-orange-300 text-orange-700'
                    : 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              <TabIcon size={16} /> {tabLabel}
            </button>
          );
        })}
      </div>

      {tabActivo === 'prestamo' && (
        <TabPrestamo open={open} onClose={onClose} />
      )}
      {tabActivo === 'domiciliario' && (
        <TabDomiciliarios open={open} />
      )}
    </Modal>
  );
}