import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Badge }       from '../../components/ui/Badge';
import { SearchInput } from '../../components/ui/SearchInput';
import { useAuth }     from '../../context/useAuth';
import { crearCompra } from '../../api/compras.api';
import {
  getProductosSerial,   crearProductoSerial,   agregarSerial,
  getProductosCantidad, crearProductoCantidad, ajustarStockCantidad,
} from '../../api/productos.api';
import api from '../../api/axios.config';
import {
  Package, ShoppingBag, ChevronRight, Trash2,
  ShoppingCart, CreditCard, Banknote,
} from 'lucide-react';

// --- Helper: construir payload de crearCompra -----------------------------------
// El backend maneja en una sola transaccion: seriales/stock + compra + acreedor.
function buildPayloadCompra({ proveedorId, monto, modoPago, lineas }) {
  return {
    proveedor_id:        Number(proveedorId),
    total:               monto,
    estado:              'Completada',
    agregarComoAcreedor: modoPago === 'credito',
    lineas,
    pagos: [{
      metodo: modoPago === 'credito' ? 'Credito' : 'Contado',
      valor:  monto,
    }],
  };
}

// --- Panel info de compra (solo admin) -----------------------------------------
// Sin proveedor: muestra solo el campo precio de compra.
// Con proveedor: muestra ademas los botones contado / credito.
// Reemplaza solo el componente InfoCompra en ModalAgregarProducto.jsx

function InfoCompra({
  proveedorId, setProveedorId,
  costoCompra, setCostoCompra,
  modoPago,    setModoPago,
}) {
  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get('/proveedores').then((r) => r.data.data),
  });

  const { data: acreedores = [] } = useQuery({
    queryKey: ['acreedores'],
    queryFn: () => api.get('/acreedores').then((r) => r.data.data),
    enabled: Boolean(proveedorId),
  });

  const handleCambiarProveedor = (valor) => {
    setProveedorId(valor);
    if (!valor) setModoPago(null);
  };

  // Detectar si el proveedor seleccionado ya tiene acreedor vinculado
  const proveedorIdNum = Number(proveedorId) || null;
  const yaEsAcreedor = proveedorIdNum
    ? acreedores.some((a) => a.proveedor_id === proveedorIdNum)
    : false;

  const labelCredito = yaEsAcreedor
    ? 'Registrar cargo'
    : 'A crédito';

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <ShoppingCart size={13} className="text-amber-600" />
        <p className="text-xs font-semibold text-amber-700">Informacion de compra</p>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs text-amber-700 font-medium">Proveedor</label>
          <select
            value={proveedorId}
            onChange={(e) => handleCambiarProveedor(e.target.value)}
            className="w-full px-2.5 py-2 bg-white border border-amber-200 rounded-lg
              text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
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
            type="number"
            placeholder="0"
            value={costoCompra}
            onChange={(e) => setCostoCompra(e.target.value)}
            onWheel={(e) => e.target.blur()}
            className="w-full px-2.5 py-2 bg-white border border-amber-200 rounded-lg
              text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
      </div>

      {Boolean(proveedorId) && (
        <div className="flex gap-2 pt-1 border-t border-amber-200">
          <button
            onClick={() => setModoPago('contado')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
              border text-xs font-medium transition-all
              ${modoPago === 'contado'
                ? 'bg-green-100 border-green-400 text-green-700'
                : 'bg-white border-amber-200 text-gray-600 hover:border-green-300 hover:bg-green-50'}`}
          >
            <Banknote size={13} />
            Pagado / Contado
          </button>
          <button
            onClick={() => setModoPago('credito')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
              border text-xs font-medium transition-all
              ${modoPago === 'credito'
                ? 'bg-orange-100 border-orange-400 text-orange-700'
                : 'bg-white border-amber-200 text-gray-600 hover:border-orange-300 hover:bg-orange-50'}`}
          >
            <CreditCard size={13} />
            {labelCredito}
          </button>
        </div>
      )}

      {/* Indicador visual si ya es acreedor */}
      {Boolean(proveedorId) && yaEsAcreedor && (
        <p className="text-xs text-orange-600 font-medium">
          Este proveedor ya tiene cuenta como acreedor — se registrará el cargo directamente.
        </p>
      )}
    </div>
  );
}

// --- Paso 1: Tipo --------------------------------------------------------------
function PasoTipo({ onSelect }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">Que tipo de producto vas a agregar?</p>
      <div className="flex gap-3">
        <button
          onClick={() => onSelect('serial')}
          className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-50 border
            border-gray-200 rounded-2xl hover:bg-blue-50 hover:border-blue-300 transition-all"
        >
          <Package size={24} className="text-blue-600" />
          <span className="text-sm font-medium text-gray-700">Con Serial / IMEI</span>
          <span className="text-xs text-gray-400 text-center">Celulares, tablets, etc.</span>
        </button>
        <button
          onClick={() => onSelect('cantidad')}
          className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-50 border
            border-gray-200 rounded-2xl hover:bg-green-50 hover:border-green-300 transition-all"
        >
          <ShoppingBag size={24} className="text-green-600" />
          <span className="text-sm font-medium text-gray-700">Por Cantidad</span>
          <span className="text-xs text-gray-400 text-center">Accesorios, repuestos, etc.</span>
        </button>
      </div>
    </div>
  );
}

// --- Paso Serial ---------------------------------------------------------------
function PasoSerial({ onExito }) {
  const queryClient                       = useQueryClient();
  const { esAdminNegocio }                = useAuth();
  const esAdmin                           = esAdminNegocio();
  const [busqueda,     setBusqueda]       = useState('');
  const [lineaSel,     setLineaSel]       = useState(null);
  const [creandoLinea, setCreandoLinea]   = useState(false);
  const [nuevaLinea,   setNuevaLinea]     = useState({ nombre: '', marca: '', modelo: '', precio: '' });
  const [imeis,        setImeis]          = useState(['']);
  const [proveedorId,  setProveedorId]    = useState('');
  const [costoCompra,  setCostoCompra]    = useState('');
  const [modoPago,     setModoPago]       = useState(null);
  const [error,        setError]          = useState('');
  const inputRefs                         = useRef([]);

  const { data: productosData } = useQuery({
    queryKey: ['productos-serial'],
    queryFn: () => getProductosSerial().then((r) => r.data.data),
  });

  const mutCrearLinea = useMutation({
    mutationFn: () => crearProductoSerial({
      nombre:       nuevaLinea.nombre,
      marca:        nuevaLinea.marca,
      modelo:       nuevaLinea.modelo,
      precio:       Number(nuevaLinea.precio),
      proveedor_id: proveedorId ? Number(proveedorId) : null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['productos-serial']);
      setLineaSel(res.data.data);
      setCreandoLinea(false);
      setNuevaLinea({ nombre: '', marca: '', modelo: '', precio: '' });
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear linea'),
  });

  const mutConfirmar = useMutation({
    mutationFn: async () => {
      const imeisValidos = imeis.filter((i) => i.trim());
      const costo = esAdmin
        ? (costoCompra ? Number(costoCompra) : null)
        : (lineaSel?.ultimo_costo || null);

      if (proveedorId && modoPago) {
        // Con proveedor: el backend maneja serial + compra + acreedor en una sola transaccion
        await crearCompra(buildPayloadCompra({
          proveedorId,
          monto:  costo ? costo * imeisValidos.length : 0,
          modoPago,
          lineas: imeisValidos.map((imei) => ({
            nombre_producto: lineaSel.nombre,
            imei,
            cantidad:        1,
            precio_unitario: costo || 0,
            producto_id:     lineaSel.id,
          })),
        }));
      } else {
        // Sin proveedor: solo insertar seriales al inventario
        await Promise.all(
          imeisValidos.map((imei) =>
            agregarSerial(lineaSel.id, {
              imei,
              fecha_entrada: new Date().toISOString().split('T')[0],
              costo_compra:  costo,
            })
          )
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['productos-serial']);
      queryClient.invalidateQueries(['compras']);
      queryClient.invalidateQueries(['acreedores']);
      onExito();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al agregar seriales'),
  });

  const productos = (productosData || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const siguiente = inputRefs.current[index + 1];
      if (siguiente) {
        siguiente.focus();
      } else {
        setImeis((prev) => [...prev, '']);
        setTimeout(() => inputRefs.current[index + 1]?.focus(), 50);
      }
    }
  };

  const imeisValidos = imeis.filter((i) => i.trim()).length;

  const handleConfirmar = () => {
    setError('');
    if (!lineaSel)          return setError('Selecciona una linea de producto');
    if (imeisValidos === 0) return setError('Ingresa al menos un IMEI');
    if (proveedorId && !modoPago) return setError('Selecciona si fue pagado o a credito');
    mutConfirmar.mutate();
  };

  const labelBoton = () => {
    const cant = imeisValidos > 0 ? `${imeisValidos} serial(es)` : 'al inventario';
    if (modoPago === 'contado') return `Agregar ${cant} — compra en contado`;
    if (modoPago === 'credito') return `Agregar ${cant} — registrar como credito`;
    return `Agregar ${cant}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {!lineaSel ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-700">Seleccionar linea de producto</p>
          <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar modelo..." />
          <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
            {productos.map((p) => (
              <button
                key={p.id}
                onClick={() => { setLineaSel(p); setError(''); }}
                className="flex items-center justify-between p-2.5 rounded-xl text-left
                  text-sm bg-white border border-gray-100 hover:border-blue-200
                  hover:bg-blue-50 transition-all"
              >
                <div>
                  <span className="font-medium text-gray-800">{p.nombre}</span>
                  <span className="text-xs text-gray-400 ml-2">{p.disponibles ?? 0} en stock</span>
                </div>
                <ChevronRight size={14} className="text-gray-400" />
              </button>
            ))}
          </div>
          <button
            onClick={() => setCreandoLinea(!creandoLinea)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium text-left"
          >
            + Crear nueva linea
          </button>

          {creandoLinea && (
            <div className="bg-blue-50 rounded-xl p-3 flex flex-col gap-2">
              <p className="text-xs font-semibold text-blue-700">Nueva linea</p>
              <Input
                id="sl-nombre"
                placeholder="Nombre (ej: iPhone 15 Pro Max)"
                value={nuevaLinea.nombre}
                onChange={(e) => setNuevaLinea({ ...nuevaLinea, nombre: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && document.getElementById('sl-marca')?.focus()}
              />
              <div className="flex gap-2">
                <Input
                  id="sl-marca"
                  placeholder="Marca"
                  value={nuevaLinea.marca}
                  onChange={(e) => setNuevaLinea({ ...nuevaLinea, marca: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && document.getElementById('sl-modelo')?.focus()}
                />
                <Input
                  id="sl-modelo"
                  placeholder="Modelo"
                  value={nuevaLinea.modelo}
                  onChange={(e) => setNuevaLinea({ ...nuevaLinea, modelo: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && document.getElementById('sl-precio')?.focus()}
                />
              </div>
              <Input
                id="sl-precio"
                type="number"
                placeholder="Precio de venta"
                value={nuevaLinea.precio}
                onChange={(e) => setNuevaLinea({ ...nuevaLinea, precio: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && mutCrearLinea.mutate()}
              />
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1"
                  onClick={() => setCreandoLinea(false)}>Cancelar</Button>
                <Button size="sm" className="flex-1"
                  loading={mutCrearLinea.isPending} onClick={() => mutCrearLinea.mutate()}>
                  Crear y seleccionar
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between bg-blue-50 rounded-xl px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-blue-800">{lineaSel.nombre}</p>
              <p className="text-xs text-blue-500">Linea seleccionada</p>
            </div>
            <button
              onClick={() => { setLineaSel(null); setImeis(['']); }}
              className="text-xs text-blue-400 hover:text-blue-600 underline"
            >
              Cambiar
            </button>
          </div>

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
        <Button className="w-full" loading={mutConfirmar.isPending} onClick={handleConfirmar}>
          {labelBoton()}
        </Button>
      )}
    </div>
  );
}

// --- Paso Cantidad -------------------------------------------------------------
function PasoCantidad({ onExito }) {
  const queryClient                         = useQueryClient();
  const { esAdminNegocio }                  = useAuth();
  const esAdmin                             = esAdminNegocio();
  const [busqueda,     setBusqueda]         = useState('');
  const [productoSel,  setProductoSel]      = useState(null);
  const [creandoNuevo, setCreandoNuevo]     = useState(false);
  const [nuevoProducto, setNuevoProducto]   = useState({ nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '' });
  const [cantidad,     setCantidad]         = useState(1);
  const [proveedorId,  setProveedorId]      = useState('');
  const [costoCompra,  setCostoCompra]      = useState('');
  const [modoPago,     setModoPago]         = useState(null);
  const [error,        setError]            = useState('');

  const { data: productosData } = useQuery({
    queryKey: ['productos-cantidad'],
    queryFn: () => getProductosCantidad().then((r) => r.data.data),
  });

  const mutCrear = useMutation({
    mutationFn: () => crearProductoCantidad({
      nombre:         nuevoProducto.nombre,
      unidad_medida:  nuevoProducto.unidad_medida,
      costo_unitario: nuevoProducto.costo_unitario ? Number(nuevoProducto.costo_unitario) : null,
      precio:         nuevoProducto.precio ? Number(nuevoProducto.precio) : null,
      proveedor_id:   proveedorId ? Number(proveedorId) : null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['productos-cantidad']);
      setProductoSel(res.data.data);
      setCreandoNuevo(false);
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
        // Con proveedor: el backend maneja stock + compra + acreedor en una sola transaccion
        await crearCompra(buildPayloadCompra({
          proveedorId,
          monto:  costo ? costo * cantidadNum : 0,
          modoPago,
          lineas: [{
            nombre_producto: productoSel.nombre,
            cantidad:        cantidadNum,
            precio_unitario: costo || 0,
            producto_id:     productoSel.id,
          }],
        }));
      } else {
        // Sin proveedor: solo ajustar stock
        await ajustarStockCantidad(productoSel.id, {
          cantidad:       cantidadNum,
          costo_unitario: costo,
          proveedor_id:   esAdmin && proveedorId ? Number(proveedorId) : undefined,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['productos-cantidad']);
      queryClient.invalidateQueries(['compras']);
      queryClient.invalidateQueries(['acreedores']);
      onExito();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al ajustar stock'),
  });

  const productos = (productosData || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const handleConfirmar = () => {
    setError('');
    if (!productoSel)              return setError('Selecciona un producto');
    if (!cantidad || cantidad < 1) return setError('La cantidad debe ser mayor a 0');
    if (proveedorId && !modoPago)  return setError('Selecciona si fue pagado o a credito');
    mutConfirmar.mutate();
  };

  const labelBoton = () => {
    if (modoPago === 'contado') return `Agregar ${cantidad} unidad(es) — compra en contado`;
    if (modoPago === 'credito') return `Agregar ${cantidad} unidad(es) — registrar como credito`;
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
                onClick={() => {
                  setProductoSel(p);
                  setError('');
                  if (esAdmin && p.costo_unitario) setCostoCompra(String(p.costo_unitario));
                  if (esAdmin && p.proveedor_id)   setProveedorId(String(p.proveedor_id));
                }}
                className="flex items-center justify-between p-2.5 rounded-xl text-left
                  text-sm bg-white border border-gray-100 hover:border-green-200
                  hover:bg-green-50 transition-all"
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
            <div className="bg-green-50 rounded-xl p-3 flex flex-col gap-2">
              <p className="text-xs font-semibold text-green-700">Nuevo producto</p>
              <Input
                placeholder="Nombre del producto"
                value={nuevoProducto.nombre}
                onChange={(e) => setNuevoProducto({ ...nuevoProducto, nombre: e.target.value })}
              />
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Precio compra"
                  value={nuevoProducto.costo_unitario}
                  onChange={(e) => setNuevoProducto({ ...nuevoProducto, costo_unitario: e.target.value })}
                />
                <Input
                  type="number"
                  placeholder="Precio venta"
                  value={nuevoProducto.precio}
                  onChange={(e) => setNuevoProducto({ ...nuevoProducto, precio: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" className="flex-1"
                  onClick={() => setCreandoNuevo(false)}>Cancelar</Button>
                <Button size="sm" className="flex-1"
                  loading={mutCrear.isPending} onClick={() => mutCrear.mutate()}>
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
            onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
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

// --- Modal principal ----------------------------------------------------------
export function ModalAgregarProducto({ onClose }) {
  const [tipo,  setTipo]  = useState(null);
  const [exito, setExito] = useState(false);

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
    <Modal
      open
      onClose={onClose}
      title={
        tipo === 'serial'   ? 'Agregar seriales' :
        tipo === 'cantidad' ? 'Agregar stock'    :
        'Agregar producto'
      }
      size="md"
    >
      {!tipo && <PasoTipo onSelect={setTipo} />}
      {tipo === 'serial'   && <PasoSerial   onExito={() => setExito(true)} />}
      {tipo === 'cantidad' && <PasoCantidad onExito={() => setExito(true)} />}

      {tipo && (
        <button
          onClick={() => setTipo(null)}
          className="mt-3 text-xs text-gray-400 hover:text-gray-600 w-full text-center"
        >
          Volver a seleccion de tipo
        </button>
      )}
    </Modal>
  );
}