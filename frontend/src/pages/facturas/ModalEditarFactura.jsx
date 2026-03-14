import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal }          from '../../components/ui/Modal';
import { Button }         from '../../components/ui/Button';
import { Input }          from '../../components/ui/Input';
import { Badge }          from '../../components/ui/Badge';
import { Spinner }        from '../../components/ui/Spinner';
import { formatCOP }      from '../../utils/formatters';
import { getProductosSerial, getProductosCantidad } from '../../api/productos.api';
import { getFacturaById, editarFactura }             from '../../api/facturas.api';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { User, Users, Package, ShoppingBag }         from 'lucide-react';
import api from '../../api/axios.config';

// ─── Constantes ───────────────────────────────────────────────────────────────

const METODOS_PAGO = [
  { id: 'Efectivo'      },
  { id: 'Nequi'        },
  { id: 'Daviplata'    },
  { id: 'Transferencia'},
  { id: 'Tarjeta'      },
];

const RETOMA_VACIA = {
  descripcion:          '',
  valor_retoma:         '',
  ingreso_inventario:   false,
  tipo_retoma:          'serial',
  imei:                 '',
  nombre_producto:      '',
  producto_serial_id:   null,
  producto_cantidad_id: null,
  cantidad_retoma:      '1',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pagosArrayAMapa(pagosArr) {
  const mapa = {};
  METODOS_PAGO.forEach(({ id }) => { mapa[id] = 0; });
  (pagosArr || []).forEach((p) => { mapa[p.metodo] = Number(p.valor || 0); });
  return mapa;
}

/**
 * Construye el estado inicial del form a partir de los datos del servidor.
 * - email y direccion se toman desde el cliente vinculado (cliente_email /
 *   cliente_direccion) si existe; en facturas antiguas quedan vacíos.
 */
function buildEstadoInicial(data) {
  if (!data) return null;
  const esCompanero  = data.cedula === 'COMPANERO';
  const tieneCliente = !!data.cliente_id;

  return {
    tipoCliente: esCompanero ? 'companero' : 'cliente',
    form: {
      nombre:    data.nombre_cliente || '',
      cedula:    esCompanero ? '' : (data.cedula   || ''),
      celular:   esCompanero ? '' : (data.celular  || ''),
      // Solo disponibles en facturas nuevas con cliente vinculado
      email:     tieneCliente ? (data.cliente_email     || '') : '',
      direccion: tieneCliente ? (data.cliente_direccion || '') : '',
      notas:     data.notas || '',
    },
    tieneCliente,
    lineas: (data.lineas || []).map((l) => ({
      id:              l.id,
      nombre_producto: l.nombre_producto,
      imei:            l.imei || null,
      cantidad:        l.cantidad,
      precio:          Number(l.precio || 0),
    })),
    pagos:  pagosArrayAMapa(data.pagos),
    retoma: data.retoma ? {
      descripcion:         data.retoma.descripcion       || '',
      valor_retoma:        data.retoma.valor_retoma       || 0,
      ingreso_inventario:  data.retoma.ingreso_inventario || false,
      tipo_retoma:         'serial',
      imei:                data.retoma.imei              || '',
      nombre_producto:     data.retoma.nombre_producto   || '',
      producto_serial_id:  null,
      producto_cantidad_id: null,
      cantidad_retoma:     '1',
    } : null,
  };
}

// ─── Retoma serial ────────────────────────────────────────────────────────────

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
          <span className="text-gray-400 font-normal">(elige existente o déjalo vacío)</span>
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
  );
}

// ─── Retoma cantidad ──────────────────────────────────────────────────────────

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
            ✓ Producto: {retoma.nombre_producto}
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

// ─── Panel retoma ─────────────────────────────────────────────────────────────

function PanelRetoma({ retoma, setRetoma, esNueva, sucursalKey, sucursalLista }) {
  const setRetomaField = (campo, valor) =>
    setRetoma((r) => ({ ...r, [campo]: valor }));

  const { data: productosSerial } = useQuery({
    queryKey: ['productos-serial', ...sucursalKey],
    queryFn:  () => getProductosSerial().then((r) => r.data.data?.items ?? r.data.data ?? []),
    enabled:  sucursalLista && retoma?.ingreso_inventario && retoma?.tipo_retoma === 'serial',
  });

  const { data: productosCantidad } = useQuery({
    queryKey: ['productos-cantidad', ...sucursalKey],
    queryFn:  () => getProductosCantidad().then((r) => r.data.data?.items ?? r.data.data ?? []),
    enabled:  sucursalLista && retoma?.ingreso_inventario && retoma?.tipo_retoma === 'cantidad',
  });

  return (
    <div className="bg-purple-50 rounded-xl p-3 flex flex-col gap-3 border border-purple-100">
      <p className="text-xs font-medium text-purple-700">
        {esNueva ? 'Nueva retoma' : 'Retoma'}
      </p>

      {esNueva && (
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
                  onClick={() => setRetoma({ ...RETOMA_VACIA, tipo_retoma: opt.id })}
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
      )}

      <Input
        label="Descripción de la retoma"
        placeholder="Ej: iPhone 12 Pro en buen estado"
        value={retoma.descripcion}
        onChange={(e) => setRetomaField('descripcion', e.target.value)}
      />

      <Input
        label="Valor retoma"
        type="number"
        placeholder="0"
        value={retoma.valor_retoma}
        onChange={(e) => setRetomaField('valor_retoma', e.target.value)}
        onWheel={(e) => e.target.blur()}
      />

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={retoma.ingreso_inventario}
          onChange={(e) => setRetomaField('ingreso_inventario', e.target.checked)}
          className="rounded accent-purple-600"
        />
        Ingresa al inventario
      </label>

      {retoma.ingreso_inventario && retoma.tipo_retoma === 'serial' && (
        <RetomaSerial
          retoma={retoma}
          setRetomaField={setRetomaField}
          productosSerial={productosSerial}
        />
      )}
      {retoma.ingreso_inventario && retoma.tipo_retoma === 'cantidad' && (
        <RetomaCantidad
          retoma={retoma}
          setRetomaField={setRetomaField}
          productosCantidad={productosCantidad}
        />
      )}
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalEditarFactura({ facturaId, onClose, onGuardado }) {
  const queryClient                    = useQueryClient();
  const { sucursalKey, sucursalLista } = useSucursalKey();

  const { data, isLoading } = useQuery({
    queryKey: ['factura-detalle', facturaId],
    queryFn:  () => getFacturaById(facturaId).then((r) => r.data.data),
    enabled:  !!facturaId,
  });

  // Config del negocio para saber qué campos opcionales mostrar
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });

  const estadoInicial = useMemo(() => buildEstadoInicial(data), [data]);

  const [tipoCliente, setTipoCliente] = useState(null);
  const [form,        setForm]        = useState(null);
  const [lineas,      setLineas]      = useState(null);
  const [pagos,       setPagos]       = useState(null);
  const [retoma,      setRetoma]      = useState(undefined);
  const [conRetoma,   setConRetoma]   = useState(null);
  const [error,       setError]       = useState('');

  // Valores efectivos: estado local si fue modificado, sino el inicial del servidor
  const tipoClienteEfectivo = tipoCliente ?? estadoInicial?.tipoCliente  ?? 'cliente';
  const formEfectivo        = form        ?? estadoInicial?.form         ?? {};
  const lineasEfectivas     = lineas      ?? estadoInicial?.lineas       ?? [];
  const pagosEfectivos      = pagos       ?? estadoInicial?.pagos        ?? {};
  const retomaEfectiva      = retoma !== undefined ? retoma : (estadoInicial?.retoma ?? null);
  const conRetomaEfectivo   = conRetoma !== null   ? conRetoma : !!estadoInicial?.retoma;
  const retomaEsNueva       = !estadoInicial?.retoma;

  // Campos opcionales habilitados según config del negocio
  const mostrarEmail     = configData?.campo_email_cliente     === '1';
  const mostrarDireccion = configData?.campo_direccion_cliente === '1';

  // Una factura antigua (sin cliente_id) no tiene email/dirección para editar
  const tieneClienteVinculado = estadoInicial?.tieneCliente ?? false;

  const mutEditar = useMutation({
    mutationFn: () => editarFactura(facturaId, {
      nombre_cliente: formEfectivo.nombre,
      cedula:         tipoClienteEfectivo === 'companero' ? 'COMPANERO'   : formEfectivo.cedula,
      celular:        tipoClienteEfectivo === 'companero' ? '0000000000'  : formEfectivo.celular,
      email:          tipoClienteEfectivo === 'cliente'   ? (formEfectivo.email     || null) : null,
      direccion:      tipoClienteEfectivo === 'cliente'   ? (formEfectivo.direccion || null) : null,
      notas:          formEfectivo.notas || null,
      lineas:         lineasEfectivas,
      pagos:          Object.entries(pagosEfectivos)
        .filter(([, v]) => Number(v) > 0)
        .map(([metodo, valor]) => ({ metodo, valor: Number(valor) })),
      retoma:        conRetomaEfectivo ? retomaEfectiva : null,
      esRetomaNueva: retomaEsNueva && conRetomaEfectivo,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['facturas'],           exact: false });
      queryClient.invalidateQueries({ queryKey: ['factura-detalle'],    exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['clientes'],           exact: false });
      onGuardado?.();
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al guardar los cambios'),
  });

  const handleToggleRetoma = () => {
    const nuevo = !conRetomaEfectivo;
    setConRetoma(nuevo);
    if (nuevo)  setRetoma({ ...RETOMA_VACIA });
    if (!nuevo) setRetoma(null);
  };

  const handleSubmit = () => {
    setError('');
    if (!formEfectivo.nombre?.trim()) return setError('El nombre es requerido');
    if (tipoClienteEfectivo === 'cliente' && !formEfectivo.cedula?.trim())
      return setError('La cédula es requerida');
    if (tipoClienteEfectivo === 'cliente' && !formEfectivo.celular?.trim())
      return setError('El celular es requerido');
    if (conRetomaEfectivo && retomaEfectiva?.ingreso_inventario) {
      if (retomaEfectiva.tipo_retoma === 'serial' && !retomaEfectiva.imei?.trim())
        return setError('El IMEI es requerido para ingresar al inventario');
      if (retomaEfectiva.tipo_retoma === 'cantidad' && !retomaEfectiva.producto_cantidad_id)
        return setError('Selecciona el producto para ingresar al inventario');
    }
    mutEditar.mutate();
  };

  const totalLineas = lineasEfectivas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const valorRetoma = conRetomaEfectivo && retomaEfectiva
    ? Number(retomaEfectiva.valor_retoma || 0) : 0;
  const totalNeto   = totalLineas - valorRetoma;
  const totalPagado = Object.values(pagosEfectivos).reduce((s, v) => s + Number(v || 0), 0);
  const diferencia  = totalPagado - totalNeto;

  if (isLoading || !estadoInicial) {
    return (
      <Modal open onClose={onClose} title="Editar Factura" size="lg">
        <Spinner className="py-10" />
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar Factura #${String(facturaId).padStart(6, '0')}`}
      size="lg"
    >
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
                  ${tipoClienteEfectivo === item.id
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
          {tipoClienteEfectivo === 'cliente' && (
            <Input
              label="Cédula"
              placeholder="123456789"
              value={formEfectivo.cedula}
              onChange={(e) => setForm({ ...formEfectivo, cedula: e.target.value })}
            />
          )}

          <Input
            label="Nombre"
            placeholder="Nombre completo"
            value={formEfectivo.nombre}
            onChange={(e) => setForm({ ...formEfectivo, nombre: e.target.value })}
          />

          {tipoClienteEfectivo === 'cliente' && (
            <Input
              label="Celular"
              placeholder="3001234567"
              value={formEfectivo.celular}
              onChange={(e) => setForm({ ...formEfectivo, celular: e.target.value })}
            />
          )}

          {/* Email y dirección: solo si la config los habilita Y la factura
              tiene cliente vinculado. Facturas antiguas no los muestran. */}
          {tipoClienteEfectivo === 'cliente' && tieneClienteVinculado && mostrarEmail && (
            <Input
              label="Email"
              type="email"
              placeholder="correo@ejemplo.com"
              value={formEfectivo.email}
              onChange={(e) => setForm({ ...formEfectivo, email: e.target.value })}
            />
          )}

          {tipoClienteEfectivo === 'cliente' && tieneClienteVinculado && mostrarDireccion && (
            <Input
              label="Dirección"
              placeholder="Calle 10 # 5-20"
              value={formEfectivo.direccion}
              onChange={(e) => setForm({ ...formEfectivo, direccion: e.target.value })}
            />
          )}
        </div>

        {/* ── Descripción / Notas ── */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Descripción{' '}
            <span className="text-gray-400 font-normal text-xs">(opcional)</span>
          </label>
          <textarea
            rows={2}
            placeholder="Observaciones de la venta..."
            value={formEfectivo.notas}
            onChange={(e) => setForm({ ...formEfectivo, notas: e.target.value })}
            className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
              placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all resize-none"
          />
        </div>

        {/* ── Productos (solo precio editable) ── */}
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-medium text-gray-500 mb-1">
            Productos{' '}
            <span className="text-gray-400 font-normal">(solo se puede editar el precio)</span>
          </p>
          {lineasEfectivas.map((linea, index) => (
            <div key={linea.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 truncate">{linea.nombre_producto}</p>
                {linea.imei && (
                  <p className="text-xs text-gray-400 font-mono">{linea.imei}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-xs text-gray-400">{linea.cantidad}x</span>
                <input
                  type="number"
                  value={linea.precio}
                  onChange={(e) => {
                    const next = [...lineasEfectivas];
                    next[index] = { ...next[index], precio: Number(e.target.value) };
                    setLineas(next);
                  }}
                  onWheel={(e) => e.target.blur()}
                  className="w-28 text-right text-sm font-semibold text-gray-900 bg-white
                    border border-gray-200 rounded-lg px-2 py-1 focus:outline-none
                    focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          ))}
          <div className="border-t border-gray-200 mt-1 pt-2 flex justify-between">
            <span className="text-sm font-medium text-gray-700">Subtotal</span>
            <span className="text-sm font-bold text-gray-900">{formatCOP(totalLineas)}</span>
          </div>
        </div>

        {/* ── Retoma ── */}
        <div>
          {retomaEsNueva && (
            <button
              onClick={handleToggleRetoma}
              className={`w-full py-2.5 rounded-xl text-sm font-medium border transition-all
                ${conRetomaEfectivo
                  ? 'bg-purple-50 border-purple-300 text-purple-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}
            >
              {conRetomaEfectivo ? '✓ Con retoma' : '+ Agregar retoma'}
            </button>
          )}
          {conRetomaEfectivo && retomaEfectiva && (
            <div className={retomaEsNueva ? 'mt-3' : ''}>
              <PanelRetoma
                retoma={retomaEfectiva}
                setRetoma={setRetoma}
                esNueva={retomaEsNueva}
                sucursalKey={sucursalKey}
                sucursalLista={sucursalLista}
              />
            </div>
          )}
        </div>

        {/* ── Métodos de pago ── */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Métodos de pago</p>
          <div className="flex flex-col gap-2">
            {METODOS_PAGO.map(({ id }) => (
              <div key={id} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-28">{id}</span>
                <input
                  type="number"
                  placeholder="0"
                  value={pagosEfectivos[id] || ''}
                  onChange={(e) => setPagos({ ...pagosEfectivos, [id]: e.target.value })}
                  onWheel={(e) => e.target.blur()}
                  className="flex-1 px-3 py-2 bg-gray-100 rounded-xl text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Resumen financiero ── */}
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
          {conRetomaEfectivo && valorRetoma > 0 && (
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
          <Button className="flex-1" loading={mutEditar.isPending} onClick={handleSubmit}>
            Guardar cambios
          </Button>
        </div>

      </div>
    </Modal>
  );
}