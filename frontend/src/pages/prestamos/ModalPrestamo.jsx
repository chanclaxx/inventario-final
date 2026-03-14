import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal }         from '../../components/ui/Modal';
import { Button }        from '../../components/ui/Button';
import { Input }         from '../../components/ui/Input';
import { Spinner }       from '../../components/ui/Spinner';
import { formatCOP }     from '../../utils/formatters';
import { crearPrestamo } from '../../api/prestamos.api';
import {
  getPrestatarios, crearPrestatario,
  getEmpleados,    crearEmpleado,
} from '../../api/prestatarios.api';
import { getClientes, crearCliente } from '../../api/clientes.api';
import useCarritoStore from '../../store/carritoStore';
import { User, Users, Plus, ChevronLeft, Search } from 'lucide-react';

// ── Selector genérico (para prestatarios y empleados) ─────────────────────
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
        <Input
          label={labelCrear}
          placeholder="Nombre..."
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
        />
        <Button
          size="sm"
          disabled={!nombre.trim()}
          onClick={() => { onCrear(nombre.trim()); setNombre(''); setModo('seleccionar'); }}
        >
          Guardar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 ? (
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => onSeleccionar(item)}
              className="text-left px-3 py-2 rounded-xl border border-gray-100
                hover:border-blue-200 hover:bg-blue-50/30 transition-colors text-sm text-gray-800"
            >
              {renderItem ? renderItem(item) : item.nombre}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 px-1">{placeholder}</p>
      )}
      <button
        onClick={() => setModo('crear')}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 w-fit"
      >
        <Plus size={13} /> {labelCrear}
      </button>
    </div>
  );
}

// ── Selector de clientes con búsqueda y formulario completo ──────────────
function SelectorOCrearCliente({ items, onSeleccionar, onCrear, loading }) {
  const [modo,     setModo]     = useState('seleccionar');
  const [busqueda, setBusqueda] = useState('');
  const [form,     setForm]     = useState({
    nombre: '', cedula: '', celular: '', direccion: '', notas: '',
  });

  const clientesFiltrados = items.filter((c) => {
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return (
      c.nombre?.toLowerCase().includes(q) ||
      c.cedula?.toLowerCase().includes(q)
    );
  });

  const handleCrear = () => {
    if (!form.nombre.trim() || !form.cedula.trim()) return;
    onCrear(form);
    setForm({ nombre: '', cedula: '', celular: '', direccion: '', notas: '' });
    setModo('seleccionar');
  };

  const volverASeleccionar = () => {
    setModo('seleccionar');
    setForm({ nombre: '', cedula: '', celular: '', direccion: '', notas: '' });
  };

  if (loading) return <Spinner className="py-4" />;

  if (modo === 'crear') {
    return (
      <div className="flex flex-col gap-3">
        <button
          onClick={volverASeleccionar}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-fit"
        >
          <ChevronLeft size={13} /> Volver
        </button>
        <Input
          label="Nombre completo *"
          placeholder="Nombre del cliente"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          autoFocus
        />
        <Input
          label="Cédula *"
          placeholder="123456789"
          value={form.cedula}
          onChange={(e) => setForm({ ...form, cedula: e.target.value })}
        />
        <Input
          label="Celular"
          placeholder="3001234567"
          value={form.celular}
          onChange={(e) => setForm({ ...form, celular: e.target.value })}
        />
        <Input
          label="Dirección"
          placeholder="Calle 123..."
          value={form.direccion}
          onChange={(e) => setForm({ ...form, direccion: e.target.value })}
        />
        <Input
          label="Notas"
          placeholder="Observaciones opcionales..."
          value={form.notas}
          onChange={(e) => setForm({ ...form, notas: e.target.value })}
        />
        <Button
          size="sm"
          disabled={!form.nombre.trim() || !form.cedula.trim()}
          onClick={handleCrear}
        >
          Guardar cliente
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ── Buscador ── */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar por nombre o cédula..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl
            text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
        />
      </div>

      {/* ── Lista filtrada ── */}
      {clientesFiltrados.length > 0 ? (
        <div className="flex flex-col gap-1 max-h-44 overflow-y-auto">
          {clientesFiltrados.map((item) => (
            <button
              key={item.id}
              onClick={() => onSeleccionar(item)}
              className="text-left px-3 py-2 rounded-xl border border-gray-100
                hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
            >
              <p className="text-sm font-medium text-gray-800">{item.nombre}</p>
              {item.cedula && (
                <p className="text-xs text-gray-400">CC: {item.cedula}</p>
              )}
              {item.celular && (
                <p className="text-xs text-gray-400">Tel: {item.celular}</p>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 px-1">
          {busqueda.trim()
            ? `Sin resultados para "${busqueda}"`
            : 'Sin clientes registrados'}
        </p>
      )}

      <button
        onClick={() => setModo('crear')}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 w-fit"
      >
        <Plus size={13} /> Agregar cliente
      </button>
    </div>
  );
}

// ── Chip de selección confirmada ──────────────────────────────────────────
function ChipSeleccionado({ nombre, onCambiar }) {
  return (
    <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
      <span className="text-sm font-medium text-blue-800">{nombre}</span>
      <button
        onClick={onCambiar}
        className="text-xs text-blue-400 hover:text-blue-600"
      >
        Cambiar
      </button>
    </div>
  );
}

// ── Modal principal ───────────────────────────────────────────────────────
export function ModalPrestamo({ open, onClose }) {
  const queryClient = useQueryClient();
  const { items, totalCarrito, limpiarCarrito } = useCarritoStore();
  const total = totalCarrito();

  const [tipoCliente,    setTipoCliente]    = useState('companero');
  const [prestatarioSel, setPrestatarioSel] = useState(null);
  const [empleadoSel,    setEmpleadoSel]    = useState(null);
  const [clienteSel,     setClienteSel]     = useState(null);
  const [valorPrestamo,  setValorPrestamo]  = useState(String(total));
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

  const mutPrestamo = useMutation({
    mutationFn: crearPrestamo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['prestamos'],          exact: false });
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
    setValorPrestamo(String(total));
    setError('');
  };

  const handleSubmit = () => {
    setError('');
    if (items.length === 0) return setError('El carrito está vacío');
    if (items.length > 1)   return setError('Solo se puede prestar un producto a la vez');

    const item = items[0];

    if (tipoCliente === 'companero') {
      if (!prestatarioSel) return setError('Selecciona o crea un prestatario');
      if (!empleadoSel)    return setError('Selecciona o agrega un empleado');

      mutPrestamo.mutate({
        prestatario:       prestatarioSel.nombre,
        cedula:            'COMPANERO',
        telefono:          '0000000000',
        nombre_producto:   item.nombre,
        imei:              item.imei        || null,
        producto_id:       item.producto_id || null,
        cantidad_prestada: item.cantidad    || 1,
        valor_prestamo:    Number(valorPrestamo || total),
        prestatario_id:    prestatarioSel.id,
        empleado_id:       empleadoSel.id,
        cliente_id:        null,
      });
    } else {
      if (!clienteSel) return setError('Selecciona o crea un cliente');

      mutPrestamo.mutate({
        prestatario:       clienteSel.nombre,
        cedula:            clienteSel.cedula  || 'S/C',
        telefono:          clienteSel.celular || '0000000000',
        nombre_producto:   item.nombre,
        imei:              item.imei        || null,
        producto_id:       item.producto_id || null,
        cantidad_prestada: item.cantidad    || 1,
        valor_prestamo:    Number(valorPrestamo || total),
        prestatario_id:    null,
        empleado_id:       null,
        cliente_id:        clienteSel.id,
      });
    }
  };

  const prestatarios = prestatariosData || [];
  const empleados    = empleadosData    || [];
  const clientes     = clientesData     || [];

  return (
    <Modal open={open} onClose={onClose} title="Registrar Préstamo" size="md">
      <div className="flex flex-col gap-5">

        {/* Tipo */}
        <div className="flex gap-2">
          {[
            { id: 'companero', label: 'Compañero', icon: User  },
            { id: 'cliente',   label: 'Cliente',   icon: Users },
          ].map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setTipoCliente(tab.id);
                  setPrestatarioSel(null);
                  setEmpleadoSel(null);
                  setClienteSel(null);
                  setError('');
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
                  text-sm font-medium border transition-all
                  ${tipoCliente === tab.id
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600'}`}
              >
                <TabIcon size={16} /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* Producto */}
        {items.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs font-medium text-gray-500 mb-1">Producto a prestar</p>
            <p className="text-sm font-medium text-gray-800">{items[0].nombre}</p>
            {items[0].imei && (
              <p className="text-xs text-gray-400 font-mono">{items[0].imei}</p>
            )}
          </div>
        )}

        {/* ── Flujo Compañero ── */}
        {tipoCliente === 'companero' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                1. Prestatario (negocio)
              </p>
              {prestatarioSel ? (
                <ChipSeleccionado
                  nombre={prestatarioSel.nombre}
                  onCambiar={() => { setPrestatarioSel(null); setEmpleadoSel(null); }}
                />
              ) : (
                <SelectorOCrear
                  items={prestatarios}
                  loading={loadingPrestatarios}
                  placeholder="Sin prestatarios registrados"
                  labelCrear="Agregar prestatario"
                  onSeleccionar={(p) => setPrestatarioSel(p)}
                  onCrear={(nombre) => mutCrearPrestatario.mutate(nombre)}
                />
              )}
            </div>

            <div className={`flex flex-col gap-2 ${!prestatarioSel ? 'opacity-40 pointer-events-none' : ''}`}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                2. Empleado
              </p>
              {empleadoSel ? (
                <ChipSeleccionado
                  nombre={empleadoSel.nombre}
                  onCambiar={() => setEmpleadoSel(null)}
                />
              ) : (
                <SelectorOCrear
                  items={empleados}
                  loading={loadingEmpleados}
                  placeholder="Sin empleados registrados"
                  labelCrear="Agregar empleado"
                  onSeleccionar={(e) => setEmpleadoSel(e)}
                  onCrear={(nombre) => mutCrearEmpleado.mutate(nombre)}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Flujo Cliente ── */}
        {tipoCliente === 'cliente' && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Cliente
            </p>
            {clienteSel ? (
              <ChipSeleccionado
                nombre={clienteSel.nombre}
                onCambiar={() => setClienteSel(null)}
              />
            ) : (
              <SelectorOCrearCliente
                items={clientes}
                loading={loadingClientes}
                onSeleccionar={(c) => setClienteSel(c)}
                onCrear={(datos) => mutCrearCliente.mutate(datos)}
              />
            )}
          </div>
        )}

        {/* Valor */}
        <div className="flex flex-col gap-2">
          <Input
            label="Valor del préstamo"
            type="number"
            value={valorPrestamo}
            onChange={(e) => setValorPrestamo(e.target.value)}
          />
          <div className="bg-gray-50 rounded-xl p-3 flex justify-between">
            <span className="text-sm text-gray-600">Valor sugerido</span>
            <span className="text-sm font-bold text-gray-900">{formatCOP(total)}</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1"
            loading={mutPrestamo.isPending}
            onClick={handleSubmit}
          >
            Registrar Préstamo
          </Button>
        </div>
      </div>
    </Modal>
  );
}