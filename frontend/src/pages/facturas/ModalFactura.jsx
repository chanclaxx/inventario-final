import { useState } from 'react';
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
import { getProductosSerial, getProductosCantidad } from '../../api/productos.api';
import { FacturaTermica } from '../../components/FacturaTermica';
import api from '../../api/axios.config';
import useCarritoStore from '../../store/carritoStore';
import {
  User, Users, CreditCard, Banknote, Smartphone,
  ArrowLeftRight, Package, ShoppingBag,
} from 'lucide-react';

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
};

// ─── Sección retoma serial ────────────────────────────────────────────────────
function RetomaSerial({ retoma, setRetomaField, productosSerial }) {
  const [busqueda, setBusqueda] = useState('');

  const filtrados = (productosSerial || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="IMEI del equipo retomado"
        placeholder="Ej: 356789012345678"
        value={retoma.imei}
        onChange={(e) => setRetomaField('imei', e.target.value)}
      />

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
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto rounded-xl border border-gray-100 bg-white">
            {filtrados.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-2">
                Sin resultados — se creará nueva línea con nombre "{busqueda}"
              </p>
            ) : (
              filtrados.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setRetomaField('producto_serial_id', p.id);
                    setRetomaField('nombre_producto', p.nombre);
                    setBusqueda(p.nombre);
                  }}
                  className={`text-left px-3 py-2 text-sm transition-all
                    ${retoma.producto_serial_id === p.id
                      ? 'bg-purple-100 text-purple-800'
                      : 'hover:bg-gray-50 text-gray-700'}`}
                >
                  {p.nombre}
                  <span className="text-xs text-gray-400 ml-2">{p.disponibles} disp.</span>
                </button>
              ))
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
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto rounded-xl border border-gray-100 bg-white">
            {filtrados.length === 0 ? (
              <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
            ) : (
              filtrados.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setRetomaField('producto_cantidad_id', p.id);
                    setRetomaField('nombre_producto', p.nombre);
                    setBusqueda(p.nombre);
                  }}
                  className={`text-left px-3 py-2 text-sm transition-all
                    ${retoma.producto_cantidad_id === p.id
                      ? 'bg-purple-100 text-purple-800'
                      : 'hover:bg-gray-50 text-gray-700'}`}
                >
                  {p.nombre}
                  <span className="text-xs text-gray-400 ml-2">Stock: {p.stock}</span>
                </button>
              ))
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
      // no encontrado
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
                {/* ── CAMBIO: precio editable con formato de miles ── */}
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

          {/* ── RETOMA ── */}
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

                {/* ── CAMBIO: valor retoma con formato de miles ── */}
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

                {/* Checkbox ingreso inventario */}
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
              {METODOS_PAGO.map(({ id, label }, index) => {
                const siguiente = METODOS_PAGO[index + 1];
                return (
                  <div key={id} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-28">{label}</span>
                    {/* ── CAMBIO: pago con formato de miles ── */}
                    <InputMoneda
                      id={id.toLowerCase()}
                      value={pagos[id] || ''}
                      onChange={(val) => handlePago(id, val)}
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