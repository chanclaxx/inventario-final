import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal }        from '../../components/ui/Modal';
import { Button }       from '../../components/ui/Button';
import { Input }        from '../../components/ui/Input';
import { Badge }        from '../../components/ui/Badge';
import { SearchInput }  from '../../components/ui/SearchInput';
import { useAuth }      from '../../context/useAuth';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { crearCompra }  from '../../api/compras.api';
import { buscarPorCedula, crearCliente, getClientes } from '../../api/clientes.api';
import {
  getProductosSerial,   agregarSerial,
  getProductosCantidad, crearProductoCantidad, ajustarStockCantidad,
  verificarImei as verificarImeiApi,
} from '../../api/productos.api';
import api from '../../api/axios.config';
import { SelectorLinea } from './SelectorLinea';
import {
  Package, ShoppingBag, ChevronRight, Trash2,
  ShoppingCart, CreditCard, Banknote,
  AlertTriangle, RefreshCw, X, User, Search, CheckCircle,
} from 'lucide-react';

// ─── Utilidad: normalizar respuesta de productos a array ──────────────────────
function normalizarProductos(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

// ─── Helper: payload de crearCompra ───────────────────────────────────────────
function buildPayloadCompra({ proveedorId, monto, modoPago, lineas }) {
  return {
    proveedor_id:        Number(proveedorId),
    total:               monto,
    estado:              'Completada',
    agregarComoAcreedor: modoPago === 'credito',
    lineas,
    pagos: [{ metodo: modoPago === 'credito' ? 'Credito' : 'Contado', valor: monto }],
  };
}

// ─── Helper: verificar IMEIs en paralelo ──────────────────────────────────────
async function verificarImeis(imeis) {
  const resultados = await Promise.all(
    imeis.map(async (imei) => {
      try {
        const { data } = await verificarImeiApi(imei.trim());
        if (data.data.existe) return data.data.serial;
        return null;
      } catch { return null; }
    })
  );
  return resultados.filter(Boolean);
}

// ─── FilasSerial ───────────────────────────────────────────────────────────────
function FilasSerial({ seriales }) {
  return (
    <div className="w-full flex flex-col gap-2 max-h-52 overflow-y-auto">
      {seriales.map((serial) => {
        const estadoLabel = serial.vendido
          ? 'Vendido'
          : serial.prestado ? 'Prestado' : 'En inventario';
        const estadoColor = serial.vendido
          ? 'text-red-600 bg-red-50 border-red-200'
          : serial.prestado
          ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
          : 'text-green-700 bg-green-50 border-green-200';
        return (
          <div key={serial.id} className="w-full rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">IMEI</span>
              <span className="font-mono font-medium text-gray-900">{serial.imei}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Producto</span>
              <span className="font-medium text-gray-900 text-right max-w-[60%]">
                {serial.producto_nombre}{serial.marca ? ` · ${serial.marca}` : ''}
              </span>
            </div>
            <div className="flex justify-between text-sm items-center">
              <span className="text-gray-500">Estado</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${estadoColor}`}>
                {estadoLabel}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Modal reactivar seriales ──────────────────────────────────────────────────
function ModalReactivarSeriales({ open, seriales, onReactivar, onCancelar }) {
  if (!seriales || seriales.length === 0) return null;
  return (
    <Modal open={open} onClose={onCancelar} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="w-14 h-14 rounded-full bg-amber-50 border-2 border-amber-200 flex items-center justify-center">
          <AlertTriangle size={26} className="text-amber-500" />
        </div>
        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-900">
            {seriales.length === 1 ? 'IMEI ya registrado' : `${seriales.length} IMEIs ya registrados`}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {seriales.length === 1
              ? 'Este equipo fue vendido o prestado — puedes reactivarlo'
              : 'Estos equipos fueron vendidos o prestados — puedes reactivarlos'}
          </p>
        </div>
        <FilasSerial seriales={seriales} />
        <p className="text-sm text-center text-gray-700 leading-relaxed">
          ¿Deseas <span className="font-semibold text-purple-700">reactivar estos seriales</span> en
          el inventario? Se marcarán como disponibles nuevamente.
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
            className="flex-1 flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
            onClick={onReactivar}
          >
            <RefreshCw size={14} /> Sí, reactivar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal ya en inventario ────────────────────────────────────────────────────
function ModalYaEnInventario({ open, seriales, onCerrar }) {
  if (!seriales || seriales.length === 0) return null;
  return (
    <Modal open={open} onClose={onCerrar} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="w-14 h-14 rounded-full bg-blue-50 border-2 border-blue-200 flex items-center justify-center">
          <Package size={26} className="text-blue-500" />
        </div>
        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-900">
            {seriales.length === 1 ? 'IMEI ya disponible' : `${seriales.length} IMEIs ya disponibles`}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {seriales.length === 1
              ? 'Este equipo ya está en inventario como disponible'
              : 'Estos equipos ya están en inventario como disponibles'}
          </p>
        </div>
        <FilasSerial seriales={seriales} />
        <p className="text-sm text-center text-gray-700 leading-relaxed">
          No es necesario agregarlo nuevamente. Puedes continuar con los demás IMEIs o cancelar.
        </p>
        <Button className="w-full" onClick={onCerrar}>Entendido</Button>
      </div>
    </Modal>
  );
}

// ─── Panel info de compra por proveedor (solo admin) ──────────────────────────
function InfoCompra({ proveedorId, setProveedorId, costoCompra, setCostoCompra, modoPago, setModoPago }) {
  const queryClient = useQueryClient();
  const [creandoProveedor, setCreandoProveedor] = useState(false);
  const [nuevoProveedor,   setNuevoProveedor]   = useState({ nombre: '', nit: '', telefono: '', direccion: '' });
  const [errorProveedor,   setErrorProveedor]   = useState('');

  const { data: proveedoresRaw } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => api.get('/proveedores').then((r) => r.data.data),
  });
  const { data: acreedoresRaw } = useQuery({
    queryKey: ['acreedores'],
    queryFn:  () => api.get('/acreedores').then((r) => r.data.data),
    enabled:  Boolean(proveedorId),
  });

  const proveedores  = normalizarProductos(proveedoresRaw);
  const acreedores   = normalizarProductos(acreedoresRaw);
  const proveedorNum = Number(proveedorId) || null;
  const yaEsAcreedor = proveedorNum
    ? acreedores.some((a) => a.proveedor_id === proveedorNum)
    : false;

  const mutCrearProveedor = useMutation({
    mutationFn: () => api.post('/proveedores', {
      nombre:    nuevoProveedor.nombre.trim(),
      nit:       nuevoProveedor.nit.trim()       || null,
      telefono:  nuevoProveedor.telefono.trim()  || null,
      direccion: nuevoProveedor.direccion.trim() || null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['proveedores'], exact: false });
      setProveedorId(String(res.data.data.id));
      setNuevoProveedor({ nombre: '', nit: '', telefono: '', direccion: '' });
      setErrorProveedor('');
      setCreandoProveedor(false);
    },
    onError: (e) => setErrorProveedor(e.response?.data?.error || 'Error al crear el proveedor'),
  });

  const handleCrearProveedor = () => {
    setErrorProveedor('');
    if (!nuevoProveedor.nombre.trim()) return setErrorProveedor('El nombre es requerido');
    mutCrearProveedor.mutate();
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <ShoppingCart size={13} className="text-amber-600" />
        <p className="text-xs font-semibold text-amber-700">Información de compra</p>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs text-amber-700 font-medium">Proveedor</label>
          <select
            value={proveedorId}
            onChange={(e) => { setProveedorId(e.target.value); if (!e.target.value) setModoPago(null); }}
            className="w-full px-2.5 py-2 bg-white border border-amber-200 rounded-lg text-xs
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            <option value="">Sin proveedor</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs text-amber-700 font-medium">Precio compra</label>
          <input
            type="number" placeholder="0"
            value={costoCompra}
            onChange={(e) => setCostoCompra(e.target.value)}
            onWheel={(e) => e.target.blur()}
            className="w-full px-2.5 py-2 bg-white border border-amber-200 rounded-lg text-xs
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
      </div>

      {!creandoProveedor ? (
        <button
          onClick={() => setCreandoProveedor(true)}
          className="text-xs text-amber-600 hover:text-amber-800 font-medium text-left w-fit"
        >
          + Crear nuevo proveedor
        </button>
      ) : (
        <div className="bg-white border border-amber-200 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-amber-700">Nuevo proveedor</p>
          <Input
            placeholder="Nombre *"
            value={nuevoProveedor.nombre}
            onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, nombre: e.target.value })}
            autoFocus
          />
          <div className="flex gap-2">
            <Input
              placeholder="NIT (opcional)"
              value={nuevoProveedor.nit}
              onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, nit: e.target.value })}
            />
            <Input
              placeholder="Teléfono (opcional)"
              value={nuevoProveedor.telefono}
              onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, telefono: e.target.value })}
            />
          </div>
          <Input
            placeholder="Dirección (opcional)"
            value={nuevoProveedor.direccion}
            onChange={(e) => setNuevoProveedor({ ...nuevoProveedor, direccion: e.target.value })}
          />
          {errorProveedor && <p className="text-xs text-red-500">{errorProveedor}</p>}
          <div className="flex gap-2">
            <Button
              variant="secondary" size="sm" className="flex-1"
              onClick={() => {
                setCreandoProveedor(false);
                setNuevoProveedor({ nombre: '', nit: '', telefono: '', direccion: '' });
                setErrorProveedor('');
              }}
            >
              Cancelar
            </Button>
            <Button
              size="sm" className="flex-1"
              loading={mutCrearProveedor.isPending}
              onClick={handleCrearProveedor}
              disabled={!nuevoProveedor.nombre.trim()}
            >
              Crear y seleccionar
            </Button>
          </div>
        </div>
      )}

      {Boolean(proveedorId) && (
        <div className="flex gap-2 pt-1 border-t border-amber-200">
          <button
            onClick={() => setModoPago('contado')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border
              text-xs font-medium transition-all
              ${modoPago === 'contado'
                ? 'bg-green-100 border-green-400 text-green-700'
                : 'bg-white border-amber-200 text-gray-600 hover:border-green-300 hover:bg-green-50'}`}
          >
            <Banknote size={13} /> Pagado / Contado
          </button>
          <button
            onClick={() => setModoPago('credito')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border
              text-xs font-medium transition-all
              ${modoPago === 'credito'
                ? 'bg-orange-100 border-orange-400 text-orange-700'
                : 'bg-white border-amber-200 text-gray-600 hover:border-orange-300 hover:bg-orange-50'}`}
          >
            <CreditCard size={13} /> {yaEsAcreedor ? 'Registrar cargo' : 'A crédito'}
          </button>
        </div>
      )}

      {Boolean(proveedorId) && yaEsAcreedor && (
        <p className="text-xs text-orange-600 font-medium">
          Este proveedor ya tiene cuenta como acreedor — se registrará el cargo directamente.
        </p>
      )}
    </div>
  );
}

// ─── Buscador de cliente ───────────────────────────────────────────────────────
function BuscadorCliente({ clienteSeleccionado, onClienteSeleccionado }) {
  const [busqueda,     setBusqueda]     = useState('');
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [nuevoCliente, setNuevoCliente] = useState({ nombre: '', cedula: '', celular: '' });
  const [buscando,     setBuscando]     = useState(false);
  const [error,        setError]        = useState('');
  const queryClient = useQueryClient();

  const esCedula = /^\d{5,}$/.test(busqueda.trim());

  const { data: clientesRaw } = useQuery({
    queryKey: ['clientes-busqueda', busqueda],
    queryFn:  () => getClientes(busqueda).then((r) => r.data.data),
    enabled:  !esCedula && busqueda.trim().length >= 2,
  });
  const clientesFiltrados = normalizarProductos(clientesRaw);

  const handleBuscarPorCedula = async () => {
    if (!busqueda.trim()) return;
    setBuscando(true); setError('');
    try {
      const { data } = await buscarPorCedula(busqueda.trim());
      if (data.data) { onClienteSeleccionado(data.data); setBusqueda(''); }
      else setError('No se encontró un cliente con esa cédula.');
    } catch { setError('No se encontró un cliente con esa cédula.'); }
    finally { setBuscando(false); }
  };

  const mutCrear = useMutation({
    mutationFn: () => crearCliente({
      nombre:  nuevoCliente.nombre.trim(),
      cedula:  nuevoCliente.cedula.trim(),
      celular: nuevoCliente.celular.trim() || null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['clientes'], exact: false });
      onClienteSeleccionado(res.data.data);
      setCreandoNuevo(false);
      setNuevoCliente({ nombre: '', cedula: '', celular: '' });
      setBusqueda('');
      setError('');
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear el cliente'),
  });

  const handleCrear = () => {
    setError('');
    if (!nuevoCliente.nombre.trim()) return setError('El nombre es requerido');
    if (!nuevoCliente.cedula.trim()) return setError('La cédula es requerida');
    mutCrear.mutate();
  };

  if (clienteSeleccionado) {
    return (
      <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <User size={13} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-emerald-800">{clienteSeleccionado.nombre}</p>
            <p className="text-xs text-emerald-500">
              CC {clienteSeleccionado.cedula}
              {clienteSeleccionado.celular ? ` · ${clienteSeleccionado.celular}` : ''}
            </p>
          </div>
        </div>
        <button
          onClick={() => onClienteSeleccionado(null)}
          className="text-xs text-emerald-400 hover:text-emerald-600 underline flex-shrink-0"
        >
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-700">Cliente que vende</p>
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar por nombre o cédula..."
            value={busqueda}
            onChange={(e) => { setBusqueda(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && esCedula) handleBuscarPorCedula(); }}
            className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
          />
        </div>
        {esCedula && (
          <Button size="sm" variant="secondary" loading={buscando} onClick={handleBuscarPorCedula}>
            Buscar
          </Button>
        )}
      </div>

      {!esCedula && busqueda.trim().length >= 2 && (
        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto rounded-xl border border-gray-100 bg-white">
          {clientesFiltrados.length === 0
            ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados para "{busqueda}"</p>
            : clientesFiltrados.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { onClienteSeleccionado(c); setBusqueda(''); }}
                  className="text-left px-3 py-2.5 text-sm hover:bg-emerald-50 transition-all
                    flex items-center justify-between gap-2"
                >
                  <div>
                    <span className="font-medium text-gray-800">{c.nombre}</span>
                    <span className="text-xs text-gray-400 ml-2">CC {c.cedula}</span>
                  </div>
                  {c.celular && <span className="text-xs text-gray-400 flex-shrink-0">{c.celular}</span>}
                </button>
              ))
          }
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={() => { setCreandoNuevo(!creandoNuevo); setError(''); }}
        className="text-xs text-emerald-600 hover:text-emerald-700 font-medium text-left"
      >
        + Crear nuevo cliente
      </button>

      {creandoNuevo && (
        <div className="bg-emerald-50 rounded-xl p-3 flex flex-col gap-2 border border-emerald-100">
          <p className="text-xs font-semibold text-emerald-700">Nuevo cliente</p>
          <Input
            placeholder="Nombre completo"
            value={nuevoCliente.nombre}
            onChange={(e) => setNuevoCliente({ ...nuevoCliente, nombre: e.target.value })}
          />
          <div className="flex gap-2">
            <Input
              placeholder="Cédula"
              value={nuevoCliente.cedula}
              onChange={(e) => setNuevoCliente({ ...nuevoCliente, cedula: e.target.value })}
            />
            <Input
              placeholder="Celular (opcional)"
              value={nuevoCliente.celular}
              onChange={(e) => setNuevoCliente({ ...nuevoCliente, celular: e.target.value })}
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="secondary" size="sm" className="flex-1"
              onClick={() => { setCreandoNuevo(false); setError(''); }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              loading={mutCrear.isPending}
              onClick={handleCrear}
            >
              Crear y seleccionar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Paso 1: Tipo ──────────────────────────────────────────────────────────────
function PasoTipo({ onSelect }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">¿Qué tipo de producto vas a agregar?</p>
      <div className="flex gap-3">
        <button
          onClick={() => onSelect('serial')}
          className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-50 border border-gray-200
            rounded-2xl hover:bg-blue-50 hover:border-blue-300 transition-all"
        >
          <Package size={24} className="text-blue-600" />
          <span className="text-sm font-medium text-gray-700">Con Serial / IMEI</span>
          <span className="text-xs text-gray-400 text-center">Proveedor · Celulares, tablets</span>
        </button>
        <button
          onClick={() => onSelect('cantidad')}
          className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-50 border border-gray-200
            rounded-2xl hover:bg-green-50 hover:border-green-300 transition-all"
        >
          <ShoppingBag size={24} className="text-green-600" />
          <span className="text-sm font-medium text-gray-700">Por Cantidad</span>
          <span className="text-xs text-gray-400 text-center">Proveedor · Accesorios</span>
        </button>
      </div>
      <button
        onClick={() => onSelect('cliente')}
        className="w-full flex items-center gap-3 p-4 bg-gray-50 border border-gray-200
          rounded-2xl hover:bg-emerald-50 hover:border-emerald-300 transition-all"
      >
        <User size={24} className="text-emerald-600 flex-shrink-0" />
        <div className="text-left">
          <p className="text-sm font-medium text-gray-700">Compra a cliente</p>
          <p className="text-xs text-gray-400">Producto que un cliente vende al negocio</p>
        </div>
      </button>
    </div>
  );
}

// ─── Badge de línea seleccionada (reutilizable) ────────────────────────────────
function LineaSeleccionadaBadge({ linea, colorBg, colorText, colorSub, onCambiar }) {
  return (
    <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${colorBg}`}>
      <div>
        <p className={`text-sm font-semibold ${colorText}`}>{linea.nombre}</p>
        <p className={`text-xs ${colorSub}`}>Línea seleccionada</p>
      </div>
      <button onClick={onCambiar} className={`text-xs underline ${colorSub} hover:opacity-80`}>
        Cambiar
      </button>
    </div>
  );
}

// ─── Paso Compra a Cliente ─────────────────────────────────────────────────────
function PasoCompraCliente({ sucursalKey, sucursalLista, onExito, onDuplicadosEncontrados }) {
  const queryClient        = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const esAdmin            = esAdminNegocio();

  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [tipoProducto,        setTipoProducto]        = useState('serial');

  // Serial state
  
  const [lineaSel,       setLineaSel]       = useState(null);
  const [imeis,          setImeis]          = useState(['']);
  const [verificando,    setVerificando]    = useState(false);

  // Cantidad state
  const [busquedaCantidad, setBusquedaCantidad] = useState('');
  const [productoSel,      setProductoSel]      = useState(null);
  const [creandoProducto,  setCreandoProducto]  = useState(false);
  const [nuevoProducto,    setNuevoProducto]    = useState({
    nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '',
  });
  const [cantidad, setCantidad] = useState(1);

  // Shared state
  const [costoCompra, setCostoCompra] = useState('');
  const [error,       setError]       = useState('');

  const reactivarMapRef = useRef({});
  const inputRefs       = useRef([]);

 
  const { data: productosCantidadRaw } = useQuery({
    queryKey: ['productos-cantidad', ...sucursalKey],
    queryFn:  () => getProductosCantidad().then((r) => normalizarProductos(r.data.data)),
    enabled:  sucursalLista && tipoProducto === 'cantidad',
  });

  const productosCantidad = normalizarProductos(productosCantidadRaw).filter((p) =>
    p.nombre.toLowerCase().includes(busquedaCantidad.toLowerCase())
  );

  const imeisValidos  = imeis.filter((i) => i.trim()).length;
  const costo         = costoCompra ? Number(costoCompra) : null;
  const nombreCliente = clienteSeleccionado?.nombre || '';

  const mutCrearProducto = useMutation({
    mutationFn: () => crearProductoCantidad({
      nombre:         nuevoProducto.nombre,
      unidad_medida:  nuevoProducto.unidad_medida,
      costo_unitario: nuevoProducto.costo_unitario ? Number(nuevoProducto.costo_unitario) : null,
      precio:         nuevoProducto.precio         ? Number(nuevoProducto.precio)         : null,
      cliente_origen: nombreCliente,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      setProductoSel(res.data.data);
      setCreandoProducto(false);
      setNuevoProducto({ nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '' });
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear producto'),
  });

  const mutConfirmarSerial = useMutation({
    mutationFn: async () => {
      await Promise.all(
        imeis.filter((i) => i.trim()).map((imei) =>
          agregarSerial(lineaSel.id, {
            imei:               imei.trim(),
            fecha_entrada:      new Date().toISOString().split('T')[0],
            costo_compra:       costo,
            cliente_origen:     nombreCliente,
            reactivar_serial_id: reactivarMapRef.current[imei.trim()] || null,
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'], exact: false });
      onExito();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al agregar seriales'),
  });

  const mutConfirmarCantidad = useMutation({
    mutationFn: async () => {
      await ajustarStockCantidad(productoSel.id, {
        cantidad:       Number(cantidad),
        costo_unitario: costo,
        cliente_origen: nombreCliente,
        cedula_cliente: clienteSeleccionado?.cedula || null,
        tipo:           'compra_cliente',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      onExito();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al ajustar stock'),
  });

  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const sig = inputRefs.current[index + 1];
      if (sig) {
        sig.focus();
      } else {
        setImeis((prev) => [...prev, '']);
        setTimeout(() => inputRefs.current[index + 1]?.focus(), 50);
      }
    }
  };

  const confirmarConReactivacion = (seriales) => {
    seriales.forEach((s) => { reactivarMapRef.current[s.imei] = s.id; });
    mutConfirmarSerial.mutate();
  };

  const handleConfirmarSerial = async () => {
    setError('');
    if (!clienteSeleccionado) return setError('Selecciona el cliente que vende');
    if (!lineaSel)            return setError('Selecciona una línea de producto');
    if (imeisValidos === 0)   return setError('Ingresa al menos un IMEI');
    const imeisLimpios = imeis.filter((i) => i.trim());
    setVerificando(true);
    const encontrados = await verificarImeis(imeisLimpios);
    setVerificando(false);
    if (encontrados.length > 0) {
      onDuplicadosEncontrados(
        {
          disponibles:  encontrados.filter((s) => !s.vendido && !s.prestado),
          paraReactivar: encontrados.filter((s) => s.vendido || s.prestado),
        },
        confirmarConReactivacion
      );
      return;
    }
    mutConfirmarSerial.mutate();
  };

  const handleConfirmarCantidad = () => {
    setError('');
    if (!clienteSeleccionado)      return setError('Selecciona el cliente que vende');
    if (!productoSel)              return setError('Selecciona un producto');
    if (!cantidad || cantidad < 1) return setError('La cantidad debe ser mayor a 0');
    mutConfirmarCantidad.mutate();
  };

  const isPending   = mutConfirmarSerial.isPending || mutConfirmarCantidad.isPending;
  const hayProducto = tipoProducto === 'serial' ? !!lineaSel : !!productoSel;

  return (
    <div className="flex flex-col gap-4">

      {/* 1. Cliente */}
      <BuscadorCliente
        clienteSeleccionado={clienteSeleccionado}
        onClienteSeleccionado={setClienteSeleccionado}
      />

      {/* 2. Tipo de producto */}
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1.5">Tipo de producto</p>
        <div className="flex gap-2">
          {[
            { id: 'serial',   label: 'Con serial / IMEI', Icn: Package    },
            { id: 'cantidad', label: 'Por cantidad',       Icn: ShoppingBag },
          ].map((opt) => {
            const OptIcon = opt.Icn;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  setTipoProducto(opt.id);
                  setLineaSel(null);
                  setProductoSel(null);
                  setImeis(['']);
                  setCantidad(1);
                  setError('');
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                  text-xs font-medium border transition-all
                  ${tipoProducto === opt.id
                    ? 'bg-emerald-100 border-emerald-400 text-emerald-800'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
              >
                <OptIcon size={13} /> {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3a. Producto serial */}
      {tipoProducto === 'serial' && (
        <div className="flex flex-col gap-3">
          {!lineaSel ? (
            <SelectorLinea
              onSeleccionar={(linea) => { setLineaSel(linea); setError(''); }}
              colorScheme="emerald"
            />
          ) : (
            <div className="flex flex-col gap-3">
              <LineaSeleccionadaBadge
                linea={lineaSel}
                colorBg="bg-emerald-50"
                colorText="text-emerald-800"
                colorSub="text-emerald-500"
                onCambiar={() => { setLineaSel(null); setImeis(['']); reactivarMapRef.current = {}; }}
              />
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">IMEIs / Seriales</p>
                <Badge variant="blue">{imeisValidos} ingresado(s)</Badge>
              </div>
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                {imeis.map((imei, index) => (
                  <div key={index} className="flex gap-1.5">
                    <input
                      ref={(el) => { inputRefs.current[index] = el; }}
                      type="text"
                      value={imei}
                      autoFocus={index === 0}
                      onChange={(e) => {
                        const next = [...imeis];
                        next[index] = e.target.value;
                        setImeis(next);
                      }}
                      onKeyDown={(e) => handleKeyDown(e, index)}
                      placeholder={`IMEI ${index + 1} — Enter para siguiente`}
                      className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-xl
                        text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                    {imeis.length > 1 && (
                      <button
                        onClick={() => setImeis((prev) => prev.filter((_, i) => i !== index))}
                        className="p-2 rounded-xl hover:bg-red-50 text-gray-300 hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setImeis((prev) => [...prev, ''])}
                className="text-xs text-emerald-500 hover:text-emerald-700 font-medium text-left"
              >
                + Agregar campo
              </button>
            </div>
          )}
        </div>
      )}

      {/* 3b. Producto cantidad */}
      {tipoProducto === 'cantidad' && (
        <div className="flex flex-col gap-3">
          {!productoSel ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-gray-700">Producto</p>
              <SearchInput
                value={busquedaCantidad}
                onChange={setBusquedaCantidad}
                placeholder="Buscar producto..."
              />
              <div className="max-h-36 overflow-y-auto flex flex-col gap-1">
                {productosCantidad.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setProductoSel(p); setError(''); }}
                    className="flex items-center justify-between p-2.5 rounded-xl text-left text-sm
                      bg-white border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50 transition-all"
                  >
                    <div>
                      <span className="font-medium text-gray-800">{p.nombre}</span>
                      <span className="text-xs text-gray-400 ml-2">Stock: {p.stock}</span>
                    </div>
                    <ChevronRight size={14} className="text-gray-400" />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCreandoProducto(!creandoProducto)}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium text-left"
              >
                + Crear nuevo producto
              </button>
              {creandoProducto && (
                <div className="bg-emerald-50 rounded-xl p-3 flex flex-col gap-2 border border-emerald-100">
                  <p className="text-xs font-semibold text-emerald-700">Nuevo producto</p>
                  <Input
                    placeholder="Nombre del producto"
                    value={nuevoProducto.nombre}
                    onChange={(e) => setNuevoProducto({ ...nuevoProducto, nombre: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Input
                      type="number" placeholder="Precio compra"
                      value={nuevoProducto.costo_unitario}
                      onChange={(e) => setNuevoProducto({ ...nuevoProducto, costo_unitario: e.target.value })}
                    />
                    <Input
                      type="number" placeholder="Precio venta"
                      value={nuevoProducto.precio}
                      onChange={(e) => setNuevoProducto({ ...nuevoProducto, precio: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => setCreandoProducto(false)}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm" className="flex-1"
                      loading={mutCrearProducto.isPending}
                      onClick={() => mutCrearProducto.mutate()}
                    >
                      Crear y seleccionar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between bg-emerald-50 rounded-xl px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-emerald-800">{productoSel.nombre}</p>
                  <p className="text-xs text-emerald-500">Stock actual: {productoSel.stock ?? 0}</p>
                </div>
                <button
                  onClick={() => { setProductoSel(null); setCantidad(1); }}
                  className="text-xs text-emerald-400 hover:text-emerald-600 underline"
                >
                  Cambiar
                </button>
              </div>
              <Input
                label="Cantidad a agregar"
                type="number"
                autoFocus
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                onWheel={(e) => e.target.blur()}
              />
            </div>
          )}
        </div>
      )}

      {/* 4. Precio pagado al cliente (solo admin) */}
      {esAdmin && hayProducto && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <CheckCircle size={13} className="text-emerald-600" />
            <p className="text-xs font-semibold text-emerald-700">Precio pagado al cliente</p>
          </div>
          <input
            type="number" placeholder="0"
            value={costoCompra}
            onChange={(e) => setCostoCompra(e.target.value)}
            onWheel={(e) => e.target.blur()}
            className="w-full px-2.5 py-2 bg-white border border-emerald-200 rounded-lg text-sm
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <p className="text-xs text-emerald-600">Se registrará en el costo del producto como referencia.</p>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {hayProducto && (
        <Button
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
          loading={isPending || verificando}
          onClick={tipoProducto === 'serial' ? handleConfirmarSerial : handleConfirmarCantidad}
        >
          {verificando
            ? 'Verificando IMEIs...'
            : tipoProducto === 'serial'
            ? `Registrar ${imeisValidos} serial(es) — compra a cliente`
            : `Agregar ${cantidad} unidad(es) — compra a cliente`}
        </Button>
      )}
    </div>
  );
}

// ─── Paso Serial (proveedor) ───────────────────────────────────────────────────
function PasoSerial({ sucursalKey, onExito, onDuplicadosEncontrados }) {
  const queryClient        = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const esAdmin            = esAdminNegocio();

  const [lineaSel,    setLineaSel]    = useState(null);
  const [imeis,       setImeis]       = useState(['']);
  const [proveedorId, setProveedorId] = useState('');
  const [costoCompra, setCostoCompra] = useState('');
  const [modoPago,    setModoPago]    = useState(null);
  const [error,       setError]       = useState('');
  const [verificando, setVerificando] = useState(false);

  const reactivarMapRef = useRef({});
  const inputRefs       = useRef([]);

  // Query solo necesaria para confirmarConReactivacion (buscar la línea por id)
  const { data: productosData } = useQuery({
    queryKey: ['productos-serial', ...sucursalKey],
    queryFn:  () => getProductosSerial().then((r) => normalizarProductos(r.data.data)),
  });

  const handleSeleccionarLinea = (linea) => {
    setLineaSel(linea);
    setError('');
    // Si la línea viene de productos-serial puede traer proveedor_id
    if (esAdmin && linea.proveedor_id) setProveedorId(String(linea.proveedor_id));
  };

  const mutConfirmar = useMutation({
    mutationFn: async () => {
      const imeisValidos = imeis.filter((i) => i.trim());
      const costo = esAdmin && costoCompra ? Number(costoCompra) : null;
      if (proveedorId && modoPago) {
        await crearCompra(buildPayloadCompra({
          proveedorId,
          monto: costo ? costo * imeisValidos.length : 0,
          modoPago,
          lineas: imeisValidos.map((imei) => ({
            nombre_producto:    lineaSel.nombre,
            imei:               imei.trim(),
            cantidad:           1,
            precio_unitario:    costo || 0,
            producto_id:        lineaSel.id,
            reactivar_serial_id: reactivarMapRef.current[imei.trim()] || null,
          })),
        }));
      } else {
        await Promise.all(
          imeisValidos.map((imei) =>
            agregarSerial(lineaSel.id, {
              imei:               imei.trim(),
              fecha_entrada:      new Date().toISOString().split('T')[0],
              costo_compra:       costo,
              reactivar_serial_id: reactivarMapRef.current[imei.trim()] || null,
            })
          )
        );
        if (esAdmin && proveedorId && !lineaSel.proveedor_id) {
          await api.patch(`/productos/serial/${lineaSel.id}`, { proveedor_id: Number(proveedorId) });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['compras'],           exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],        exact: false });
      onExito();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al agregar seriales'),
  });

  const imeisValidos = imeis.filter((i) => i.trim()).length;

  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const sig = inputRefs.current[index + 1];
      if (sig) {
        sig.focus();
      } else {
        setImeis((prev) => [...prev, '']);
        setTimeout(() => inputRefs.current[index + 1]?.focus(), 50);
      }
    }
  };

  const confirmarConReactivacion = (seriales) => {
    seriales.forEach((s) => { reactivarMapRef.current[s.imei] = s.id; });
    const primerSerial = seriales[0];
    if (primerSerial && (!lineaSel || lineaSel.id !== primerSerial.producto_id)) {
      const lineaEncontrada = normalizarProductos(productosData).find(
        (p) => p.id === primerSerial.producto_id
      );
      if (lineaEncontrada) handleSeleccionarLinea(lineaEncontrada);
    }
    mutConfirmar.mutate();
  };

  const handleConfirmar = async () => {
    setError('');
    if (!lineaSel)        return setError('Selecciona una línea de producto');
    if (imeisValidos === 0) return setError('Ingresa al menos un IMEI');
    if (proveedorId && !modoPago) return setError('Selecciona si fue pagado o a crédito');
    const imeisLimpios = imeis.filter((i) => i.trim());
    setVerificando(true);
    const encontrados = await verificarImeis(imeisLimpios);
    setVerificando(false);
    if (encontrados.length > 0) {
      onDuplicadosEncontrados(
        {
          disponibles:   encontrados.filter((s) => !s.vendido && !s.prestado),
          paraReactivar: encontrados.filter((s) => s.vendido || s.prestado),
        },
        confirmarConReactivacion
      );
      return;
    }
    mutConfirmar.mutate();
  };

  const labelBoton = () => {
    const cant = imeisValidos > 0 ? `${imeisValidos} serial(es)` : 'al inventario';
    if (modoPago === 'contado') return `Agregar ${cant} — compra en contado`;
    if (modoPago === 'credito') return `Agregar ${cant} — registrar como crédito`;
    return `Agregar ${cant}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {!lineaSel ? (
        // ── SelectorLinea maneja lista + búsqueda + creación ──
        <SelectorLinea
          onSeleccionar={handleSeleccionarLinea}
          colorScheme="blue"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <LineaSeleccionadaBadge
            linea={lineaSel}
            colorBg="bg-blue-50"
            colorText="text-blue-800"
            colorSub="text-blue-500"
            onCambiar={() => {
              setLineaSel(null);
              setImeis(['']);
              setProveedorId('');
              setCostoCompra('');
              setModoPago(null);
              reactivarMapRef.current = {};
            }}
          />

          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">IMEIs / Seriales</p>
            <Badge variant="blue">{imeisValidos} ingresado(s)</Badge>
          </div>

          <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
            {imeis.map((imei, index) => (
              <div key={index} className="flex gap-1.5">
                <input
                  ref={(el) => { inputRefs.current[index] = el; }}
                  type="text"
                  value={imei}
                  autoFocus={index === 0}
                  onChange={(e) => {
                    const next = [...imeis];
                    next[index] = e.target.value;
                    setImeis(next);
                  }}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  placeholder={`IMEI ${index + 1} — Enter para siguiente`}
                  className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {imeis.length > 1 && (
                  <button
                    onClick={() => setImeis((prev) => prev.filter((_, i) => i !== index))}
                    className="p-2 rounded-xl hover:bg-red-50 text-gray-300 hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => setImeis((prev) => [...prev, ''])}
            className="text-xs text-blue-500 hover:text-blue-700 font-medium text-left"
          >
            + Agregar campo
          </button>

          {esAdmin && (
            <InfoCompra
              proveedorId={proveedorId}
              setProveedorId={setProveedorId}
              costoCompra={costoCompra}
              setCostoCompra={setCostoCompra}
              modoPago={modoPago}
              setModoPago={setModoPago}
            />
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {lineaSel && (
        <Button
          className="w-full"
          loading={mutConfirmar.isPending || verificando}
          onClick={handleConfirmar}
        >
          {verificando ? 'Verificando IMEIs...' : labelBoton()}
        </Button>
      )}
    </div>
  );
}

// ─── Paso Cantidad (proveedor) ─────────────────────────────────────────────────
function PasoCantidad({ sucursalKey, onExito }) {
  const queryClient        = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const esAdmin            = esAdminNegocio();

  const [busqueda,      setBusqueda]      = useState('');
  const [productoSel,   setProductoSel]   = useState(null);
  const [creandoNuevo,  setCreandoNuevo]  = useState(false);
  const [lineaParaNuevo, setLineaParaNuevo] = useState(null);
  const [nuevoProducto, setNuevoProducto] = useState({
    nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '',
  });
  const [cantidad,    setCantidad]    = useState(1);
  const [proveedorId, setProveedorId] = useState('');
  const [costoCompra, setCostoCompra] = useState('');
  const [modoPago,    setModoPago]    = useState(null);
  const [error,       setError]       = useState('');

  const { data: productosData } = useQuery({
    queryKey: ['productos-cantidad', ...sucursalKey],
    queryFn:  () => getProductosCantidad().then((r) => normalizarProductos(r.data.data)),
  });

  const productos = normalizarProductos(productosData).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const handleSeleccionarProducto = (producto) => {
    setProductoSel(producto);
    setError('');
    if (esAdmin) {
      if (producto.proveedor_id)    setProveedorId(String(producto.proveedor_id));
      if (producto.costo_unitario)  setCostoCompra(String(producto.costo_unitario));
    }
  };

  const mutCrear = useMutation({
    mutationFn: () => crearProductoCantidad({
      nombre:         nuevoProducto.nombre,
      unidad_medida:  nuevoProducto.unidad_medida,
      costo_unitario: nuevoProducto.costo_unitario ? Number(nuevoProducto.costo_unitario) : null,
      precio:         nuevoProducto.precio         ? Number(nuevoProducto.precio)         : null,
      proveedor_id:   proveedorId                  ? Number(proveedorId)                  : null,
      linea_id:       lineaParaNuevo?.id            ?? null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      setProductoSel(res.data.data);
      setCreandoNuevo(false);
      setLineaParaNuevo(null);
    },
    onError: (e) => setError(e.response?.data?.error || 'Error'),
  });

  const mutConfirmar = useMutation({
    mutationFn: async () => {
      const cantidadNum = Number(cantidad);
      const costo = esAdmin
        ? (costoCompra ? Number(costoCompra) : null)
        : (productoSel?.costo_unitario || null);
      if (proveedorId && modoPago) {
        await crearCompra(buildPayloadCompra({
          proveedorId,
          monto: costo ? costo * cantidadNum : 0,
          modoPago,
          lineas: [{
            nombre_producto: productoSel.nombre,
            cantidad:        cantidadNum,
            precio_unitario: costo || 0,
            producto_id:     productoSel.id,
          }],
        }));
      } else {
        await ajustarStockCantidad(productoSel.id, {
          cantidad:    cantidadNum,
          costo_unitario: costo,
          proveedor_id: esAdmin && proveedorId ? Number(proveedorId) : undefined,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['compras'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],         exact: false });
      onExito();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al ajustar stock'),
  });

  const handleConfirmar = () => {
    setError('');
    if (!productoSel)              return setError('Selecciona un producto');
    if (!cantidad || cantidad < 1) return setError('La cantidad debe ser mayor a 0');
    if (proveedorId && !modoPago)  return setError('Selecciona si fue pagado o a crédito');
    mutConfirmar.mutate();
  };

  const labelBoton = () => {
    if (modoPago === 'contado') return `Agregar ${cantidad} unidad(es) — compra en contado`;
    if (modoPago === 'credito') return `Agregar ${cantidad} unidad(es) — registrar como crédito`;
    return `Agregar ${cantidad} unidad(es) al stock`;
  };

  return (
    <div className="flex flex-col gap-4">
      {!productoSel ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-700">Seleccionar producto</p>
          <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar producto..." />
          <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
            {productos.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSeleccionarProducto(p)}
                className="flex items-center justify-between p-2.5 rounded-xl text-left text-sm
                  bg-white border border-gray-100 hover:border-green-200 hover:bg-green-50 transition-all"
              >
                <div>
                  <span className="font-medium text-gray-800">{p.nombre}</span>
                  <span className="text-xs text-gray-400 ml-2">Stock: {p.stock}</span>
                </div>
                <ChevronRight size={14} className="text-gray-400" />
              </button>
            ))}
          </div>

          <button
            onClick={() => setCreandoNuevo(!creandoNuevo)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium text-left"
          >
            + Crear nuevo producto
          </button>

          {creandoNuevo && (
            <div className="bg-green-50 rounded-xl p-3 flex flex-col gap-2 border border-green-100">
              <p className="text-xs font-semibold text-green-700">Nuevo producto</p>
              <Input
                placeholder="Nombre del producto"
                value={nuevoProducto.nombre}
                onChange={(e) => setNuevoProducto({ ...nuevoProducto, nombre: e.target.value })}
              />
              <div className="flex gap-2">
                <Input
                  type="number" placeholder="Precio compra"
                  value={nuevoProducto.costo_unitario}
                  onChange={(e) => setNuevoProducto({ ...nuevoProducto, costo_unitario: e.target.value })}
                />
                <Input
                  type="number" placeholder="Precio venta"
                  value={nuevoProducto.precio}
                  onChange={(e) => setNuevoProducto({ ...nuevoProducto, precio: e.target.value })}
                />
              </div>

              {/* ── Selector de línea para el nuevo producto ── */}
              {!lineaParaNuevo ? (
                <SelectorLinea
                  onSeleccionar={(linea) => { setLineaParaNuevo(linea); setError(''); }}
                  colorScheme="green"
                />
              ) : (
                <LineaSeleccionadaBadge
                  linea={lineaParaNuevo}
                  colorBg="bg-green-100"
                  colorText="text-green-800"
                  colorSub="text-green-500"
                  onCambiar={() => setLineaParaNuevo(null)}
                />
              )}

              <div className="flex gap-2">
                <Button
                  variant="secondary" size="sm" className="flex-1"
                  onClick={() => { setCreandoNuevo(false); setLineaParaNuevo(null); }}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm" className="flex-1"
                  loading={mutCrear.isPending}
                  onClick={() => mutCrear.mutate()}
                >
                  Crear y seleccionar
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between bg-green-50 rounded-xl px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-green-800">{productoSel.nombre}</p>
              <p className="text-xs text-green-500">Stock actual: {productoSel.stock ?? 0}</p>
            </div>
            <button
              onClick={() => {
                setProductoSel(null);
                setCantidad(1);
                setCostoCompra('');
                setProveedorId('');
                setModoPago(null);
              }}
              className="text-xs text-green-400 hover:text-green-600 underline"
            >
              Cambiar
            </button>
          </div>
          <Input
            label="Cantidad a agregar"
            type="number"
            autoFocus
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            onWheel={(e) => e.target.blur()}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmar(); }}
          />
          {esAdmin && (
            <InfoCompra
              proveedorId={proveedorId}
              setProveedorId={setProveedorId}
              costoCompra={costoCompra}
              setCostoCompra={setCostoCompra}
              modoPago={modoPago}
              setModoPago={setModoPago}
            />
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {productoSel && (
        <Button className="w-full" loading={mutConfirmar.isPending} onClick={handleConfirmar}>
          {labelBoton()}
        </Button>
      )}
    </div>
  );
}

// ─── Modal principal ───────────────────────────────────────────────────────────
export function ModalAgregarProducto({ onClose }) {
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const [tipo,  setTipo]  = useState(null);
  const [exito, setExito] = useState(false);

  const [modalReactivar,      setModalReactivar]       = useState(false);
  const [serialesDuplicados,  setSerializesDuplicados] = useState([]);
  const confirmarReactivarRef = useRef(null);
  const [serialesDisponibles, setSerializesDisponibles] = useState([]);
  const [modalYaEnInventario, setModalYaEnInventario]   = useState(false);

  const handleDuplicadosEncontrados = ({ disponibles, paraReactivar }, confirmarFn) => {
    confirmarReactivarRef.current = confirmarFn;
    if (disponibles.length > 0)   { setSerializesDisponibles(disponibles); setModalYaEnInventario(true); }
    if (paraReactivar.length > 0) { setSerializesDuplicados(paraReactivar); setModalReactivar(true); }
  };

  const handleReactivar = () => {
    confirmarReactivarRef.current?.(serialesDuplicados);
    setModalReactivar(false);
    setSerializesDuplicados([]);
  };
  const handleCancelarReactivar = () => {
    setModalReactivar(false);
    setSerializesDuplicados([]);
  };

  const tituloModal = tipo === 'serial'   ? 'Agregar seriales'
    : tipo === 'cantidad' ? 'Agregar stock'
    : tipo === 'cliente'  ? 'Compra a cliente'
    : 'Agregar producto';

  if (exito) {
    return (
      <Modal open onClose={onClose} title="Producto agregado" size="sm">
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
            <span className="text-2xl">✓</span>
          </div>
          <p className="text-sm text-gray-600 text-center">
            El inventario fue actualizado correctamente.
          </p>
          <div className="flex gap-2 w-full">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button>
            <Button className="flex-1" onClick={() => { setTipo(null); setExito(false); }}>
              Agregar otro
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal open onClose={onClose} title={tituloModal} size="md">
        {!tipo && <PasoTipo onSelect={setTipo} />}
        {tipo === 'serial'   && (
          <PasoSerial
            sucursalKey={sucursalKey}
            sucursalLista={sucursalLista}
            onExito={() => setExito(true)}
            onDuplicadosEncontrados={handleDuplicadosEncontrados}
          />
        )}
        {tipo === 'cantidad' && (
          <PasoCantidad
            sucursalKey={sucursalKey}
            sucursalLista={sucursalLista}
            onExito={() => setExito(true)}
          />
        )}
        {tipo === 'cliente'  && (
          <PasoCompraCliente
            sucursalKey={sucursalKey}
            sucursalLista={sucursalLista}
            onExito={() => setExito(true)}
            onDuplicadosEncontrados={handleDuplicadosEncontrados}
          />
        )}
        {tipo && (
          <button
            onClick={() => setTipo(null)}
            className="mt-3 text-xs text-gray-400 hover:text-gray-600 w-full text-center"
          >
            ← Volver a selección de tipo
          </button>
        )}
      </Modal>

      <ModalReactivarSeriales
        open={modalReactivar}
        seriales={serialesDuplicados}
        onReactivar={handleReactivar}
        onCancelar={handleCancelarReactivar}
      />
      <ModalYaEnInventario
        open={modalYaEnInventario}
        seriales={serialesDisponibles}
        onCerrar={() => { setModalYaEnInventario(false); setSerializesDisponibles([]); }}
      />
    </>
  );
}