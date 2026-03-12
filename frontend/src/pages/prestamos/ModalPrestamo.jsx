import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal }          from '../../components/ui/Modal';
import { Button }         from '../../components/ui/Button';
import { Input }          from '../../components/ui/Input';
import { Spinner }        from '../../components/ui/Spinner';
import { formatCOP }      from '../../utils/formatters';
import { crearPrestamo }  from '../../api/prestamos.api';
import {
  getPrestatarios, crearPrestatario,
  getEmpleados,    crearEmpleado,
} from '../../api/prestatarios.api';
import useCarritoStore from '../../store/carritoStore';
import { User, Users, Plus, ChevronLeft } from 'lucide-react';

// ── Subcomponente: selector con opción de crear ────────────────────────────
function SelectorOCrear({ items, onSeleccionar, onCrear, placeholder, labelCrear, loading }) {
  const [modo,   setModo]   = useState('seleccionar'); // 'seleccionar' | 'crear'
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
              {item.nombre}
              {item.telefono && (
                <span className="text-xs text-gray-400 ml-2">{item.telefono}</span>
              )}
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

// ── Modal principal ────────────────────────────────────────────────────────
export function ModalPrestamo({ open, onClose }) {
  const queryClient = useQueryClient();
  const { items, totalCarrito, limpiarCarrito } = useCarritoStore();
  const total = totalCarrito();

  const [tipoCliente,          setTipoCliente]          = useState('companero');
  const [paso,                 setPaso]                 = useState(1); // solo para compañero
  const [prestatarioSel,       setPrestatarioSel]       = useState(null);
  const [empleadoSel,          setEmpleadoSel]          = useState(null);
  const [valorPrestamo,        setValorPrestamo]        = useState(String(total));
  const [formCliente,          setFormCliente]          = useState({ nombre: '', cedula: '', telefono: '' });
  const [error,                setError]                = useState('');

  // ── Queries ──
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

  // ── Mutations ──
  const mutCrearPrestatario = useMutation({
    mutationFn: (nombre) => crearPrestatario({ nombre }),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['prestatarios']);
      setPrestatarioSel(res.data.data);
      setPaso(2);
    },
  });

  const mutCrearEmpleado = useMutation({
    mutationFn: (nombre) => crearEmpleado(prestatarioSel.id, { nombre }),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['empleados', prestatarioSel.id]);
      setEmpleadoSel(res.data.data);
    },
  });

  const mutPrestamo = useMutation({
    mutationFn: crearPrestamo,
    onSuccess: () => {
      queryClient.invalidateQueries(['productos-serial']);
      queryClient.invalidateQueries(['productos-cantidad']);
      queryClient.invalidateQueries(['prestamos']);
      limpiarCarrito();
      onClose();
      resetForm();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar el préstamo'),
  });

  const resetForm = () => {
    setTipoCliente('companero');
    setPaso(1);
    setPrestatarioSel(null);
    setEmpleadoSel(null);
    setValorPrestamo(String(total));
    setFormCliente({ nombre: '', cedula: '', telefono: '' });
    setError('');
  };

  const handleSubmit = () => {
    setError('');
    if (items.length === 0)  return setError('El carrito está vacío');
    if (items.length > 1)    return setError('Solo se puede prestar un producto a la vez');

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
      });
    } else {
      if (!formCliente.nombre.trim()) return setError('El nombre es requerido');

      mutPrestamo.mutate({
        prestatario:       formCliente.nombre,
        cedula:            formCliente.cedula   || 'S/C',
        telefono:          formCliente.telefono || '0000000000',
        nombre_producto:   item.nombre,
        imei:              item.imei        || null,
        producto_id:       item.producto_id || null,
        cantidad_prestada: item.cantidad    || 1,
        valor_prestamo:    Number(valorPrestamo || total),
        prestatario_id:    null,
        empleado_id:       null,
      });
    }
  };

  const prestatarios = prestatariosData || [];
  const empleados    = empleadosData    || [];

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
        setPaso(1);
        setPrestatarioSel(null);
        setEmpleadoSel(null);
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

            {/* Paso 1: prestatario */}
            <div className={`flex flex-col gap-2 ${paso < 1 ? 'opacity-40 pointer-events-none' : ''}`}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                1. Prestatario (negocio)
              </p>
              {prestatarioSel ? (
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                  <span className="text-sm font-medium text-blue-800">{prestatarioSel.nombre}</span>
                  <button
                    onClick={() => { setPrestatarioSel(null); setEmpleadoSel(null); setPaso(1); }}
                    className="text-xs text-blue-400 hover:text-blue-600"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <SelectorOCrear
                  items={prestatarios}
                  loading={loadingPrestatarios}
                  placeholder="Aún no hay prestatarios registrados"
                  labelCrear="Agregar prestatario"
                  onSeleccionar={(p) => { setPrestatarioSel(p); setPaso(2); }}
                  onCrear={(nombre) => mutCrearPrestatario.mutate(nombre)}
                />
              )}
            </div>

            {/* Paso 2: empleado */}
            <div className={`flex flex-col gap-2 ${!prestatarioSel ? 'opacity-40 pointer-events-none' : ''}`}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                2. Empleado
              </p>
              {empleadoSel ? (
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                  <span className="text-sm font-medium text-blue-800">{empleadoSel.nombre}</span>
                  <button
                    onClick={() => setEmpleadoSel(null)}
                    className="text-xs text-blue-400 hover:text-blue-600"
                  >
                    Cambiar
                  </button>
                </div>
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
          <div className="flex flex-col gap-3">
            <Input
              label="Nombre completo"
              placeholder="Nombre del cliente"
              value={formCliente.nombre}
              onChange={(e) => setFormCliente({ ...formCliente, nombre: e.target.value })}
            />
            <Input
              label="Cédula"
              placeholder="123456789"
              value={formCliente.cedula}
              onChange={(e) => setFormCliente({ ...formCliente, cedula: e.target.value })}
            />
            <Input
              label="Teléfono"
              placeholder="3001234567"
              value={formCliente.telefono}
              onChange={(e) => setFormCliente({ ...formCliente, telefono: e.target.value })}
            />
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