import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SearchInput } from '../../components/ui/SearchInput';
import { useAuth } from '../../context/useAuth';
import {
  getProductosSerial, crearProductoSerial,
  getProductosCantidad, crearProductoCantidad,
} from '../../api/productos.api';
import api from '../../api/axios.config';
import { Package, ShoppingBag, ChevronRight, Trash2, ShoppingCart } from 'lucide-react';

// ── Recuadro info compra (solo admin) ────────────────────────
function InfoCompra({ proveedorId, setProveedorId, costoCompra, setCostoCompra }) {
  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => api.get('/proveedores').then((r) => r.data.data),
  });

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
            onChange={(e) => setProveedorId(e.target.value)}
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
            className="w-full px-2.5 py-2 bg-white border border-amber-200 rounded-lg
              text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
      </div>
    </div>
  );
}

// ── Paso 1: Tipo ─────────────────────────────────────────────
function PasoTipo({ onSelect }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">¿Qué tipo de producto vas a agregar?</p>
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

// ── Serial: línea + IMEIs ────────────────────────────────────
function PasoSerial({ onExito }) {
  const queryClient                     = useQueryClient();
  const { esAdminNegocio }              = useAuth();
  const esAdmin                         = esAdminNegocio();
  const [busqueda, setBusqueda]         = useState('');
  const [lineaSeleccionada, setLinea]   = useState(null);
  const [creandoLinea, setCreandoLinea] = useState(false);
  const [nuevaLinea, setNuevaLinea]     = useState({ nombre: '', marca: '', modelo: '', precio: '' });
  const [imeis, setImeis]               = useState(['']);
  const [proveedorId, setProveedorId]   = useState('');
  const [costoCompra, setCostoCompra]   = useState('');
  const [error, setError]               = useState('');
  const inputRefs                       = useRef([]);

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
      setLinea(res.data.data);
      setCreandoLinea(false);
      setNuevaLinea({ nombre: '', marca: '', modelo: '', precio: '' });
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear línea'),
  });

  const mutAgregarSeriales = useMutation({
    mutationFn: () => {
      const imeisValidos = imeis.filter((i) => i.trim());
      // Para no-admin usar costo_compra del producto si existe
      const costo = esAdmin
        ? (costoCompra ? Number(costoCompra) : null)
        : (lineaSeleccionada?.ultimo_costo || null);

      return Promise.all(
        imeisValidos.map((imei) =>
          import('../../api/productos.api').then(({ agregarSerial }) =>
            agregarSerial(lineaSeleccionada.id, {
              imei,
              fecha_entrada: new Date().toISOString().split('T')[0],
              costo_compra:  costo,
            })
          )
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['productos-serial']);
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
    if (!lineaSeleccionada) return setError('Selecciona una línea de producto');
    if (imeisValidos === 0)  return setError('Ingresa al menos un IMEI');
    mutAgregarSeriales.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      {!lineaSeleccionada ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-700">Seleccionar línea de producto</p>
          <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar modelo..." />
          <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
            {productos.map((p) => (
              <button
                key={p.id}
                onClick={() => { setLinea(p); setError(''); }}
                className="flex items-center justify-between p-2.5 rounded-xl text-left
                  text-sm bg-white border border-gray-100 hover:border-blue-200
                  hover:bg-blue-50 transition-all"
              >
                <div>
                  <span className="font-medium text-gray-800">{p.nombre}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {p.disponibles ?? 0} en stock
                  </span>
                </div>
                <ChevronRight size={14} className="text-gray-400" />
              </button>
            ))}
          </div>
          <button
            onClick={() => setCreandoLinea(!creandoLinea)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium text-left"
          >
            + Crear nueva línea
          </button>

          {creandoLinea && (
            <div className="bg-blue-50 rounded-xl p-3 flex flex-col gap-2">
              <p className="text-xs font-semibold text-blue-700">Nueva línea</p>
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
              <p className="text-sm font-semibold text-blue-800">{lineaSeleccionada.nombre}</p>
              <p className="text-xs text-blue-500">Línea seleccionada</p>
            </div>
            <button
              onClick={() => { setLinea(null); setImeis(['']); }}
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

          {/* Info compra solo para admin */}
          {esAdmin && (
            <InfoCompra
              proveedorId={proveedorId}
              setProveedorId={setProveedorId}
              costoCompra={costoCompra}
              setCostoCompra={setCostoCompra}
            />
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {lineaSeleccionada && (
        <Button
          className="w-full"
          loading={mutAgregarSeriales.isPending}
          onClick={handleConfirmar}
        >
          Agregar {imeisValidos > 0 ? `${imeisValidos} serial(es)` : 'al inventario'}
        </Button>
      )}
    </div>
  );
}

// ── Cantidad: producto + stock ───────────────────────────────
function PasoCantidad({ onExito }) {
  const queryClient                           = useQueryClient();
  const { esAdminNegocio }                    = useAuth();
  const esAdmin                               = esAdminNegocio();
  const [busqueda, setBusqueda]               = useState('');
  const [productoSel, setProductoSel]         = useState(null);
  const [creandoNuevo, setCreandoNuevo]       = useState(false);
  const [nuevoProducto, setNuevoProducto]     = useState({ nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '' });
  const [cantidadAgregar, setCantidadAgregar] = useState(1);
  const [proveedorId, setProveedorId]         = useState('');
  const [costoCompra, setCostoCompra]         = useState('');
  const [error, setError]                     = useState('');

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

  const mutAjustar = useMutation({
    mutationFn: () =>
      import('../../api/productos.api').then(({ ajustarStockCantidad }) =>
        ajustarStockCantidad(productoSel.id, {
          cantidad:       Number(cantidadAgregar),
          costo_unitario: esAdmin
            ? (costoCompra ? Number(costoCompra) : null)
            : (productoSel?.costo_unitario || null),
          proveedor_id: esAdmin && proveedorId ? Number(proveedorId) : undefined,
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries(['productos-cantidad']);
      onExito();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al ajustar stock'),
  });

  const productos = (productosData || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const handleConfirmar = () => {
    setError('');
    if (!productoSel) return setError('Selecciona un producto');
    if (!cantidadAgregar || cantidadAgregar < 1) return setError('La cantidad debe ser mayor a 0');
    mutAjustar.mutate();
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
                  // Pre-llenar precio compra con el último registrado
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
              onClick={() => { setProductoSel(null); setCantidadAgregar(1); setCostoCompra(''); setProveedorId(''); }}
              className="text-xs text-green-400 hover:text-green-600 underline"
            >
              Cambiar
            </button>
          </div>

          <Input
            label="Cantidad a agregar"
            type="number"
            autoFocus
            value={cantidadAgregar}
            onChange={(e) => setCantidadAgregar(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
          />

          {/* Info compra solo para admin */}
          {esAdmin && (
            <InfoCompra
              proveedorId={proveedorId}
              setProveedorId={setProveedorId}
              costoCompra={costoCompra}
              setCostoCompra={setCostoCompra}
            />
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {productoSel && (
        <Button
          className="w-full"
          loading={mutAjustar.isPending}
          onClick={handleConfirmar}
        >
          Agregar {cantidadAgregar} unidad(es) al stock
        </Button>
      )}
    </div>
  );
}

// ── Modal principal ──────────────────────────────────────────
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
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Cerrar
            </Button>
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
          ← Volver a selección de tipo
        </button>
      )}
    </Modal>
  );
}