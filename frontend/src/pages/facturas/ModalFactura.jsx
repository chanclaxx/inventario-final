import { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { formatCOP } from '../../utils/formatters';
import { crearFactura, getFacturaById } from '../../api/facturas.api';
import { buscarPorCedula } from '../../api/clientes.api';
import { getGarantias } from '../../api/garantias.api';
import { getProductosSerial, getProductosCantidad, verificarImei as verificarImeiApi } from '../../api/productos.api';
import { FacturaTermica } from '../../components/FacturaTermica';
import api from '../../api/axios.config';
import useCarritoStore from '../../store/carritoStore';
import {
  User, Users, Package, ShoppingBag,
  Loader2, CheckCircle, XCircle, AlertCircle,
  AlertTriangle, RefreshCw, X,
} from 'lucide-react';

// ─── Constantes ───────────────────────────────────────────────────────────────

const METODOS_PAGO = [
  { id: 'Efectivo',      label: 'Efectivo'      },
  { id: 'Nequi',         label: 'Nequi'         },
  { id: 'Daviplata',     label: 'Daviplata'     },
  { id: 'Transferencia', label: 'Transferencia' },
  { id: 'Tarjeta',       label: 'Tarjeta'       },
];

const RETOMA_INICIAL = {
  tipo_retoma:          'serial',
  descripcion:          '',
  valor_retoma:         '',
  ingreso_inventario:   false,
  imei:                 '',
  producto_serial_id:   null,
  nombre_producto:      '',
  producto_cantidad_id: null,
  cantidad_retoma:      '1',
  reactivar_serial_id:  null,
};

const IMEI_MIN_LENGTH = 8;
const DEBOUNCE_MS     = 600;

// ─── Hook: verificación de IMEI en tiempo real ────────────────────────────────

function useVerificarImei() {
  const [estado, setEstado] = useState({ tipo: 'idle' });
  const timerRef = useRef(null);

  const verificar = useCallback((imei, { onEncontrado } = {}) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const imeiLimpio = imei?.trim() ?? '';
    if (imeiLimpio.length < IMEI_MIN_LENGTH) {
      setEstado({ tipo: 'idle' });
      return;
    }

    setEstado({ tipo: 'cargando' });

    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await verificarImeiApi(imeiLimpio);
        if (data.data.existe) {
          const serial = data.data.serial;
          setEstado({ tipo: 'encontrado', serial });
          onEncontrado?.(serial);
        } else {
          setEstado({ tipo: 'libre' });
        }
      } catch (err) {
        setEstado({
          tipo:    'error',
          mensaje: err.response?.data?.error || 'Error al verificar IMEI',
        });
      }
    }, DEBOUNCE_MS);
  }, []);

  const limpiar = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setEstado({ tipo: 'idle' });
  }, []);

  return { estado, verificar, limpiar };
}

// ─── Sub-componentes: indicadores de estado del IMEI ─────────────────────────

function ImeiEstadoIcono({ estado }) {
  if (estado.tipo === 'cargando')  return <Loader2      size={15} className="text-gray-400 animate-spin" />;
  if (estado.tipo === 'libre')     return <CheckCircle  size={15} className="text-green-500" />;
  if (estado.tipo === 'encontrado') return <AlertCircle size={15} className="text-amber-500" />;
  if (estado.tipo === 'error')     return <XCircle      size={15} className="text-red-400" />;
  return null;
}

function ImeiEstadoMensaje({ estado, onAbrirModal }) {
  if (estado.tipo === 'cargando') {
    return <p className="text-xs text-gray-400">Verificando IMEI...</p>;
  }
  if (estado.tipo === 'libre') {
    return <p className="text-xs text-green-600">✓ IMEI disponible, no existe en el inventario</p>;
  }
  if (estado.tipo === 'encontrado') {
    return (
      <button
        type="button"
        onClick={onAbrirModal}
        className="text-xs text-amber-700 underline underline-offset-2 text-left
          hover:text-amber-900 transition-colors"
      >
        ⚠ Este IMEI ya existe en el negocio — ver detalles y reactivar
      </button>
    );
  }
  if (estado.tipo === 'error') {
    return <p className="text-xs text-red-500">{estado.mensaje}</p>;
  }
  return null;
}

// ─── Modal de reactivación de serial ─────────────────────────────────────────

function ModalReactivarSerial({ open, serial, onReactivar, onCancelar }) {
  if (!serial) return null;

  const estadoLabel = serial.vendido  ? 'Vendido'
    : serial.prestado                 ? 'Prestado'
    :                                   'En inventario';

  const estadoColor = serial.vendido
    ? 'text-red-600 bg-red-50 border-red-200'
    : serial.prestado
    ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
    : 'text-green-700 bg-green-50 border-green-200';

  return (
    <Modal open={open} onClose={onCancelar} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-2">

        <div className="w-14 h-14 rounded-full bg-amber-50 border-2 border-amber-200
          flex items-center justify-center">
          <AlertTriangle size={26} className="text-amber-500" />
        </div>

        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-900">
            IMEI ya registrado en el negocio
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Este equipo aparece en el historial del inventario
          </p>
        </div>

        <div className="w-full rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">IMEI</span>
            <span className="font-mono font-medium text-gray-900">{serial.imei}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Producto</span>
            <span className="font-medium text-gray-900 text-right max-w-[60%]">
              {serial.producto_nombre}
              {serial.marca ? ` · ${serial.marca}` : ''}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Sucursal</span>
            <span className="text-gray-700">{serial.sucursal_nombre}</span>
          </div>
          {serial.cliente_origen && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Cliente origen</span>
              <span className="text-gray-700">{serial.cliente_origen}</span>
            </div>
          )}
          <div className="flex justify-between text-sm items-center">
            <span className="text-gray-500">Estado actual</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${estadoColor}`}>
              {estadoLabel}
            </span>
          </div>
        </div>

        <p className="text-sm text-center text-gray-700 leading-relaxed">
          ¿Deseas{' '}
          <span className="font-semibold text-purple-700">reactivar este serial</span>
          {' '}en el inventario? Se marcará como disponible nuevamente.
        </p>

        <div className="flex gap-2 w-full">
          <Button
            variant="secondary"
            className="flex-1 flex items-center justify-center gap-1.5"
            onClick={onCancelar}
          >
            <X size={14} /> Cancelar
          </Button>
          <Button
            className="flex-1 flex items-center justify-center gap-1.5
              bg-purple-600 hover:bg-purple-700 text-white"
            onClick={onReactivar}
          >
            <RefreshCw size={14} /> Sí, reactivar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Sección retoma serial (con verificación de IMEI) ────────────────────────

function RetomaSerial({ retoma, setRetomaField, productosSerial }) {
  const [busqueda,       setBusqueda]       = useState('');
  const [modalReactivar, setModalReactivar] = useState(false);

  const { estado, verificar, limpiar } = useVerificarImei();

  const filtrados = (productosSerial || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const handleImeiChange = (e) => {
    const valor = e.target.value;
    setRetomaField('imei', valor);
    setRetomaField('reactivar_serial_id', null);
    limpiar();

    if (valor.trim().length >= IMEI_MIN_LENGTH) {
      // El callback se pasa en cada llamada — siempre tiene la referencia
      // fresca a setModalReactivar sin necesitar refs ni effects adicionales
      verificar(valor, { onEncontrado: () => setModalReactivar(true) });
    }
  };

  const handleReactivar = () => {
    const serial = estado.serial;
    setRetomaField('producto_serial_id',  serial.producto_id);
    setRetomaField('nombre_producto',     serial.producto_nombre);
    setRetomaField('reactivar_serial_id', serial.id);
    setBusqueda(serial.producto_nombre);
    setModalReactivar(false);
  };

  const handleCancelarReactivar = () => {
    setRetomaField('imei', '');
    setRetomaField('reactivar_serial_id', null);
    limpiar();
    setModalReactivar(false);
  };

  return (
    <>
      <div className="flex flex-col gap-3">

        {/* Campo IMEI con indicador de estado */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">
            IMEI del equipo retomado
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="Ej: 356789012345678"
              value={retoma.imei}
              onChange={handleImeiChange}
              className="w-full px-3 py-2 pr-9 bg-white border border-gray-200 rounded-xl
                text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <ImeiEstadoIcono estado={estado} />
            </span>
          </div>
          <ImeiEstadoMensaje
            estado={estado}
            onAbrirModal={() => setModalReactivar(true)}
          />
        </div>

        {/* Selector de línea de producto */}
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">
            Línea de producto{' '}
            <span className="text-gray-400 font-normal">
              (elige existente o déjalo vacío para nueva línea)
            </span>
          </p>
          <input
            type="text"
            placeholder="Buscar modelo..."
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setRetomaField('producto_serial_id', null);
              setRetomaField('nombre_producto', '');
            }}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-purple-400 mb-1"
          />
          {busqueda.length > 0 && (
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto rounded-xl
              border border-gray-100 bg-white">
              {filtrados.length === 0 ? (
                <p className="text-xs text-gray-400 px-3 py-2">
                  Sin resultados — se creará nueva línea con nombre "{busqueda}"
                </p>
              ) : (
                filtrados.map((p) => {
                  const productoId = p.id;
                  return (
                    <button
                      key={productoId}
                      onClick={() => {
                        setRetomaField('producto_serial_id', productoId);
                        setRetomaField('nombre_producto', p.nombre);
                        setBusqueda(p.nombre);
                      }}
                      className={`text-left px-3 py-2 text-sm transition-all
                        ${retoma.producto_serial_id === productoId
                          ? 'bg-purple-100 text-purple-800'
                          : 'hover:bg-gray-50 text-gray-700'}`}
                    >
                      {p.nombre}
                      <span className="text-xs text-gray-400 ml-2">{p.disponibles} disp.</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
          {retoma.producto_serial_id && (
            <p className="text-xs text-purple-600 mt-1">
              ✓ Línea seleccionada: {retoma.nombre_producto}
            </p>
          )}
        </div>
      </div>

      <ModalReactivarSerial
        open={modalReactivar}
        serial={estado.tipo === 'encontrado' ? estado.serial : null}
        onReactivar={handleReactivar}
        onCancelar={handleCancelarReactivar}
      />
    </>
  );
}

// ─── Sección retoma cantidad ──────────────────────────────────────────────────

function RetomaCantidad({ retoma, setRetomaField, productosCantidad }) {
  const [busqueda, setBusqueda] = useState('');

  const filtrados = (productosCantidad || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Producto en inventario</p>
        <input
          type="text"
          placeholder="Buscar producto..."
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value);
            setRetomaField('producto_cantidad_id', null);
            setRetomaField('nombre_producto', '');
          }}
          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
            focus:outline-none focus:ring-2 focus:ring-purple-400 mb-1"
        />
        {busqueda.length > 0 && (
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto rounded-xl
            border border-gray-100 bg-white">
            {filtrados.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
            ) : (
              filtrados.map((p) => {
                const productoId = p.id;
                return (
                  <button
                    key={productoId}
                    onClick={() => {
                      setRetomaField('producto_cantidad_id', productoId);
                      setRetomaField('nombre_producto', p.nombre);
                      setBusqueda(p.nombre);
                    }}
                    className={`text-left px-3 py-2 text-sm transition-all
                      ${retoma.producto_cantidad_id === productoId
                        ? 'bg-purple-100 text-purple-800'
                        : 'hover:bg-gray-50 text-gray-700'}`}
                  >
                    {p.nombre}
                    <span className="text-xs text-gray-400 ml-2">Stock: {p.stock}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
        {retoma.producto_cantidad_id && (
          <p className="text-xs text-purple-600 mt-1">
            ✓ Producto seleccionado: {retoma.nombre_producto}
          </p>
        )}
      </div>

      <Input
        label="Cantidad retomada"
        type="number"
        min="1"
        placeholder="1"
        value={retoma.cantidad_retoma}
        onChange={(e) => setRetomaField('cantidad_retoma', e.target.value)}
      />
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalFactura({ open, onClose }) {
  const queryClient = useQueryClient();
  const { items, totalCarrito, limpiarCarrito, actualizarPrecio } = useCarritoStore();
  const total = totalCarrito();

  const [facturaCreada,    setFacturaCreada]    = useState(null);
  const [mostrarImpresion, setMostrarImpresion] = useState(false);
  const [tipoCliente,      setTipoCliente]      = useState('cliente');
  const [form,             setForm]             = useState({ nombre: '', cedula: '', celular: '', notas: '' });
  const [pagos,            setPagos]            = useState({ Efectivo: '' });
  const [conRetoma,        setConRetoma]        = useState(false);
  const [retoma,           setRetoma]           = useState(RETOMA_INICIAL);
  const [error,            setError]            = useState('');
  const [buscandoCliente,  setBuscandoCliente]  = useState(false);

  const { data: garantiasData } = useQuery({
    queryKey: ['garantias'],
    queryFn: () => getGarantias().then((r) => r.data.data),
  });

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get('/config').then((r) => r.data.data),
  });

  const { data: productosSerial } = useQuery({
    queryKey: ['productos-serial'],
    queryFn: () => getProductosSerial().then((r) => r.data.data),
    enabled: conRetoma && retoma.tipo_retoma === 'serial',
  });

  const { data: productosCantidad } = useQuery({
    queryKey: ['productos-cantidad'],
    queryFn: () => getProductosCantidad().then((r) => r.data.data),
    enabled: conRetoma && retoma.tipo_retoma === 'cantidad',
  });

  const mutation = useMutation({
    mutationFn: crearFactura,
    onSuccess: async (res) => {
      queryClient.invalidateQueries(['productos-serial']);
      queryClient.invalidateQueries(['productos-cantidad']);
      queryClient.invalidateQueries(['seriales']);
      queryClient.invalidateQueries({ queryKey: ['ventas-rango'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-top'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      try {
        const { data } = await getFacturaById(res.data.data.id);
        setFacturaCreada({ ...data.data, config: configData });
        setMostrarImpresion(true);
      } catch {
        limpiarCarrito();
        onClose();
        resetForm();
      }
    },
    onError: (err) => {
      setError(err.response?.data?.error || 'Error al crear la factura');
    },
  });

  const resetForm = () => {
    setForm({ nombre: '', cedula: '', celular: '', notas: '' });
    setPagos({ Efectivo: '' });
    setConRetoma(false);
    setRetoma(RETOMA_INICIAL);
    setError('');
    setTipoCliente('cliente');
  };

  const setRetomaField = (campo, valor) =>
    setRetoma((r) => ({ ...r, [campo]: valor }));

  const buscarCliente = async () => {
    if (!form.cedula) return;
    setBuscandoCliente(true);
    try {
      const { data } = await buscarPorCedula(form.cedula);
      if (data.data) {
        setForm((f) => ({ ...f, nombre: data.data.nombre, celular: data.data.celular || '' }));
      }
    } catch {
      // cliente no encontrado — se continúa normalmente
    } finally {
      setBuscandoCliente(false);
    }
  };

  const totalPagado = Object.values(pagos).reduce((s, v) => s + Number(v || 0), 0);
  const valorRetoma = conRetoma ? Number(retoma.valor_retoma || 0) : 0;
  const totalNeto   = total - valorRetoma;
  const diferencia  = totalPagado - totalNeto;

  const handlePago = (metodo, valor) =>
    setPagos((p) => ({ ...p, [metodo]: valor }));

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
      else handleSubmit();
    }
  };

  const handleSubmit = () => {
    setError('');
    if (!form.nombre.trim()) return setError('El nombre es requerido');
    if (tipoCliente === 'cliente' && !form.cedula.trim())  return setError('La cédula es requerida');
    if (tipoCliente === 'cliente' && !form.celular.trim()) return setError('El celular es requerido');

    if (conRetoma && retoma.ingreso_inventario) {
      if (retoma.tipo_retoma === 'serial' && !retoma.imei.trim()) {
        return setError('El IMEI es requerido para ingresar al inventario');
      }
      if (retoma.tipo_retoma === 'cantidad' && !retoma.producto_cantidad_id) {
        return setError('Selecciona el producto para ingresar al inventario');
      }
    }

    const lineas = items.map((item) => ({
      nombre_producto: item.nombre,
      imei:            item.imei        || null,
      producto_id:     item.producto_id || null,
      cantidad:        item.cantidad    || 1,
      precio:          item.precioFinal,
    }));

    const pagosArray = Object.entries(pagos)
      .filter(([, v]) => Number(v) > 0)
      .map(([metodo, valor]) => ({ metodo, valor: Number(valor) }));

    const retomaPayload = conRetoma ? {
      tipo_retoma:          retoma.tipo_retoma,
      descripcion:          retoma.descripcion,
      valor_retoma:         Number(retoma.valor_retoma || 0),
      ingreso_inventario:   retoma.ingreso_inventario,
      imei:                 retoma.tipo_retoma === 'serial'   ? retoma.imei                                    : null,
      nombre_producto:      retoma.tipo_retoma === 'serial'   ? (retoma.nombre_producto || retoma.descripcion) : retoma.nombre_producto,
      producto_serial_id:   retoma.tipo_retoma === 'serial'   ? retoma.producto_serial_id                      : null,
      producto_cantidad_id: retoma.tipo_retoma === 'cantidad' ? retoma.producto_cantidad_id                    : null,
      cantidad_retoma:      retoma.tipo_retoma === 'cantidad' ? Number(retoma.cantidad_retoma || 1)             : 1,
      reactivar_serial_id:  retoma.reactivar_serial_id || null,
    } : null;

    mutation.mutate({
      nombre_cliente: form.nombre,
      cedula:         tipoCliente === 'cliente' ? form.cedula  : 'COMPANERO',
      celular:        tipoCliente === 'cliente' ? form.celular : '0000000000',
      notas:          form.notas,
      lineas,
      pagos:          pagosArray,
      retoma:         retomaPayload,
    });
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Nueva Factura" size="lg">
        <div className="flex flex-col gap-5">

          {/* ── Tipo de cliente ── */}
          <div className="flex gap-2">
            {[
              { id: 'companero', label: 'Compañero', Icn: User  },
              { id: 'cliente',   label: 'Cliente',   Icn: Users },
            ].map((item) => {
              const ItemIcon = item.Icn;
              return (
                <button
                  key={item.id}
                  onClick={() => setTipoCliente(item.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
                    text-sm font-medium border transition-all
                    ${tipoCliente === item.id
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600'}`}
                >
                  <ItemIcon size={16} /> {item.label}
                </button>
              );
            })}
          </div>

          {/* ── Datos del cliente ── */}
          <div className="flex flex-col gap-3">
            {tipoCliente === 'cliente' && (
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Input
                    id="cedula"
                    label="Cédula"
                    placeholder="123456789"
                    value={form.cedula}
                    onChange={(e) => setForm({ ...form, cedula: e.target.value })}
                    onBlur={buscarCliente}
                    onKeyDown={(e) => handleKeyDown(e, 'nombre')}
                  />
                </div>
                {buscandoCliente && (
                  <span className="text-xs text-gray-400 pb-2">Buscando...</span>
                )}
              </div>
            )}
            <Input
              id="nombre"
              label="Nombre"
              placeholder={tipoCliente === 'companero' ? 'Nombre del compañero' : 'Nombre completo'}
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              onKeyDown={(e) => handleKeyDown(e, tipoCliente === 'cliente' ? 'celular' : 'efectivo')}
            />
            {tipoCliente === 'cliente' && (
              <Input
                id="celular"
                label="Celular"
                placeholder="3001234567"
                value={form.celular}
                onChange={(e) => setForm({ ...form, celular: e.target.value })}
                onKeyDown={(e) => handleKeyDown(e, 'efectivo')}
              />
            )}
          </div>

          {/* ── Resumen de productos ── */}
          <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
            <p className="text-xs font-medium text-gray-500 mb-1">Productos ({items.length})</p>
            {items.map((item) => (
              <div key={item.key} className="flex items-center justify-between text-sm gap-2">
                <span className="text-gray-700 truncate flex-1">{item.nombre}</span>
                {item.imei && (
                  <span className="text-xs text-gray-400 font-mono">{item.imei}</span>
                )}
                <InputMoneda
                  value={item.precioFinal}
                  onChange={(val) => actualizarPrecio(item.key, val)}
                  className="w-28 text-right text-sm font-semibold text-gray-900 bg-white
                    border border-gray-200 rounded-lg px-2 py-1 focus:outline-none
                    focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
            <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between">
              <span className="text-sm font-medium text-gray-700">Subtotal</span>
              <span className="text-sm font-bold text-gray-900">{formatCOP(total)}</span>
            </div>
          </div>

          {/* ── Retoma ── */}
          <div>
            <button
              onClick={() => { setConRetoma(!conRetoma); setRetoma(RETOMA_INICIAL); }}
              className={`w-full py-2.5 rounded-xl text-sm font-medium border transition-all
                ${conRetoma
                  ? 'bg-purple-50 border-purple-300 text-purple-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}
            >
              {conRetoma ? '✓ Con retoma' : '+ Agregar retoma'}
            </button>

            {conRetoma && (
              <div className="mt-3 flex flex-col gap-3 p-3 bg-purple-50 rounded-xl border border-purple-100">

                {/* Paso 1 — tipo */}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1.5">Tipo de producto retomado</p>
                  <div className="flex gap-2">
                    {[
                      { id: 'serial',   label: 'Con serial / IMEI', Icn: Package     },
                      { id: 'cantidad', label: 'Por cantidad',       Icn: ShoppingBag },
                    ].map((opt) => {
                      const OptIcon = opt.Icn;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => setRetoma({ ...RETOMA_INICIAL, tipo_retoma: opt.id })}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2
                            rounded-xl text-xs font-medium border transition-all
                            ${retoma.tipo_retoma === opt.id
                              ? 'bg-purple-100 border-purple-400 text-purple-800'
                              : 'bg-white border-gray-200 text-gray-500'}`}
                        >
                          <OptIcon size={13} /> {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Paso 2 — datos según tipo */}
                {retoma.tipo_retoma === 'serial' && (
                  <RetomaSerial
                    retoma={retoma}
                    setRetomaField={setRetomaField}
                    productosSerial={productosSerial}
                  />
                )}
                {retoma.tipo_retoma === 'cantidad' && (
                  <RetomaCantidad
                    retoma={retoma}
                    setRetomaField={setRetomaField}
                    productosCantidad={productosCantidad}
                  />
                )}

                {/* Paso 3 — descripción y valor */}
                <Input
                  label="Descripción de la retoma"
                  placeholder="Ej: iPhone 12 Pro en buen estado"
                  value={retoma.descripcion}
                  onChange={(e) => setRetomaField('descripcion', e.target.value)}
                />

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Valor retoma</label>
                  <InputMoneda
                    value={retoma.valor_retoma}
                    onChange={(val) => setRetomaField('valor_retoma', val)}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                      focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={retoma.ingreso_inventario}
                    onChange={(e) => setRetomaField('ingreso_inventario', e.target.checked)}
                    className="rounded accent-purple-600"
                  />
                  Ingresa al inventario
                </label>
              </div>
            )}
          </div>

          {/* ── Métodos de pago ── */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Método de pago</p>
            <div className="flex flex-col gap-2">
              {METODOS_PAGO.map((metodo, index) => {
                const metodoId    = metodo.id;
                const metodoLabel = metodo.label;
                const siguiente   = METODOS_PAGO[index + 1];
                return (
                  <div key={metodoId} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-28">{metodoLabel}</span>
                    <InputMoneda
                      id={metodoId.toLowerCase()}
                      value={pagos[metodoId] || ''}
                      onChange={(val) => handlePago(metodoId, val)}
                      onKeyDown={(e) => handleKeyDown(e, siguiente ? siguiente.id.toLowerCase() : null)}
                      placeholder="0"
                      className="flex-1 px-3 py-2 bg-gray-100 rounded-xl text-sm
                        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Resumen financiero ── */}
          <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
            {conRetoma && valorRetoma > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-purple-600">Retoma</span>
                <span className="text-purple-600">- {formatCOP(valorRetoma)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total a pagar</span>
              <span className="font-bold text-gray-900">{formatCOP(totalNeto)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total pagado</span>
              <span className="font-medium">{formatCOP(totalPagado)}</span>
            </div>
            {diferencia !== 0 && (
              <div className="flex justify-between text-sm border-t border-gray-200 pt-1.5 mt-1">
                <span className={diferencia > 0 ? 'text-green-600' : 'text-red-500'}>
                  {diferencia > 0 ? 'Cambio' : 'Falta'}
                </span>
                <Badge variant={diferencia > 0 ? 'green' : 'red'}>
                  {formatCOP(Math.abs(diferencia))}
                </Badge>
              </div>
            )}
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
              loading={mutation.isPending}
              onClick={handleSubmit}
            >
              Confirmar Factura
            </Button>
          </div>
        </div>
      </Modal>

      {mostrarImpresion && facturaCreada && (
        <FacturaTermica
          factura={facturaCreada}
          garantias={garantiasData || []}
          onClose={() => {
            setMostrarImpresion(false);
            limpiarCarrito();
            onClose();
            resetForm();
          }}
        />
      )}
    </>
  );
}