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
  verificarImei as verificarImeiApi,
} from '../../api/productos.api';
import api from '../../api/axios.config';
import {
  Package, ShoppingBag, ChevronRight, Trash2,
  ShoppingCart, CreditCard, Banknote,
  AlertTriangle, RefreshCw, X,
} from 'lucide-react';

// ─── Helper: payload de crearCompra ──────────────────────────────────────────

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

// ─── Helper: verificar lista de IMEIs en paralelo ────────────────────────────
// Retorna solo los que ya existen en el negocio

async function verificarImeis(imeis) {
  const resultados = await Promise.all(
    imeis.map(async (imei) => {
      try {
        const { data } = await verificarImeiApi(imei.trim());
        if (data.data.existe) return data.data.serial;
        return null;
      } catch {
        return null;
      }
    })
  );
  return resultados.filter(Boolean);
}

// ─── Modal de reactivación múltiple ──────────────────────────────────────────

function ModalReactivarSeriales({ open, seriales, onReactivar, onCancelar }) {
  if (!seriales || seriales.length === 0) return null;

  return (
    <Modal open={open} onClose={onCancelar} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-2">

        <div className="w-14 h-14 rounded-full bg-amber-50 border-2 border-amber-200
          flex items-center justify-center">
          <AlertTriangle size={26} className="text-amber-500" />
        </div>

        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-900">
            {seriales.length === 1
              ? 'Este IMEI ya está registrado'
              : `${seriales.length} IMEIs ya están registrados`}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {seriales.length === 1
              ? 'Este equipo aparece en el historial del inventario'
              : 'Estos equipos aparecen en el historial del inventario'}
          </p>
        </div>

        <div className="w-full flex flex-col gap-2 max-h-52 overflow-y-auto">
          {seriales.map((serial) => {
            const estadoLabel = serial.vendido  ? 'Vendido'
              : serial.prestado                 ? 'Prestado'
              :                                   'En inventario';

            const estadoColor = serial.vendido
              ? 'text-red-600 bg-red-50 border-red-200'
              : serial.prestado
              ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
              : 'text-green-700 bg-green-50 border-green-200';

            return (
              <div
                key={serial.id}
                className="w-full rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-1.5"
              >
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

        <p className="text-sm text-center text-gray-700 leading-relaxed">
          ¿Deseas{' '}
          <span className="font-semibold text-purple-700">reactivar estos seriales</span>
          {' '}en el inventario? Se marcarán como disponibles nuevamente.
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

// ─── Panel info de compra (solo admin) ───────────────────────────────────────

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

  const proveedorIdNum = Number(proveedorId) || null;
  const yaEsAcreedor  = proveedorIdNum
    ? acreedores.some((a) => a.proveedor_id === proveedorIdNum)
    : false;

  const labelCredito = yaEsAcreedor ? 'Registrar cargo' : 'A crédito';

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

      {Boolean(proveedorId) && yaEsAcreedor && (
        <p className="text-xs text-orange-600 font-medium">
          Este proveedor ya tiene cuenta como acreedor — se registrará el cargo directamente.
        </p>
      )}
    </div>
  );
}

// ─── Paso 1: Tipo ─────────────────────────────────────────────────────────────

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

// ─── Paso Serial ──────────────────────────────────────────────────────────────

function PasoSerial({ onExito, onDuplicadosEncontrados }) {
  const queryClient                     = useQueryClient();
  const { esAdminNegocio }              = useAuth();
  const esAdmin                         = esAdminNegocio();
  const [busqueda,     setBusqueda]     = useState('');
  const [lineaSel,     setLineaSel]     = useState(null);
  const [creandoLinea, setCreandoLinea] = useState(false);
  const [nuevaLinea,   setNuevaLinea]   = useState({ nombre: '', marca: '', modelo: '', precio: '' });
  const [imeis,        setImeis]        = useState(['']);
  const [proveedorId,  setProveedorId]  = useState('');
  const [costoCompra,  setCostoCompra]  = useState('');
  const [modoPago,     setModoPago]     = useState(null);
  const [error,        setError]        = useState('');
  const [verificando,  setVerificando]  = useState(false);

  // Map de imei → reactivar_serial_id para los que el usuario confirmó reactivar
  // Se llena desde el padre cuando el usuario confirma reactivar en el modal
  const reactivarMapRef = useRef({});

  const inputRefs = useRef([]);

  const { data: productosData } = useQuery({
    queryKey: ['productos-serial'],
    queryFn: () => getProductosSerial().then((r) => r.data.data),
  });

  const handleSeleccionarLinea = (producto) => {
    setLineaSel(producto);
    setError('');
    if (esAdmin) {
      if (producto.proveedor_id) setProveedorId(String(producto.proveedor_id));
      if (producto.ultimo_costo) setCostoCompra(String(producto.ultimo_costo));
    }
  };

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
        await crearCompra(buildPayloadCompra({
          proveedorId,
          monto:  costo ? costo * imeisValidos.length : 0,
          modoPago,
          lineas: imeisValidos.map((imei) => ({
            nombre_producto:  lineaSel.nombre,
            imei:             imei.trim(),
            cantidad:         1,
            precio_unitario:  costo || 0,
            producto_id:      lineaSel.id,
            // Si este IMEI fue marcado para reactivar, enviarlo al backend
            reactivar_serial_id: reactivarMapRef.current[imei.trim()] || null,
          })),
        }));
      } else {
        await Promise.all(
          imeisValidos.map((imei) =>
            agregarSerial(lineaSel.id, {
              imei:                imei.trim(),
              fecha_entrada:       new Date().toISOString().split('T')[0],
              costo_compra:        costo,
              reactivar_serial_id: reactivarMapRef.current[imei.trim()] || null,
            })
          )
        );
        if (esAdmin && proveedorId && !lineaSel.proveedor_id) {
          await api.patch(`/productos/serial/${lineaSel.id}`, {
            proveedor_id: Number(proveedorId),
          });
        }
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

  // Al confirmar: primero verificar duplicados, luego proceder
  const handleConfirmar = async () => {
    setError('');
    if (!lineaSel)          return setError('Selecciona una linea de producto');
    if (imeisValidos === 0) return setError('Ingresa al menos un IMEI');
    if (proveedorId && !modoPago) return setError('Selecciona si fue pagado o a credito');

    const imeisLimpios = imeis.filter((i) => i.trim());

    setVerificando(true);
    const encontrados = await verificarImeis(imeisLimpios);
    setVerificando(false);

    if (encontrados.length > 0) {
      // Delegar al padre — él maneja el modal y llama confirmarConReactivacion
      onDuplicadosEncontrados(encontrados, confirmarConReactivacion);
      return;
    }

    // Sin duplicados — proceder directo
    mutConfirmar.mutate();
  };

  // Llamado por el padre cuando el usuario confirma reactivar en el modal
  const confirmarConReactivacion = (seriales) => {
    // Guardar el map imei → id para que mutConfirmar lo use
    seriales.forEach((serial) => {
      reactivarMapRef.current[serial.imei] = serial.id;
    });

    // Auto-seleccionar la línea del primer serial si la actual no coincide
    const primerSerial = seriales[0];
    if (primerSerial && (!lineaSel || lineaSel.id !== primerSerial.producto_id)) {
      const lineaEncontrada = (productosData || []).find(
        (p) => p.id === primerSerial.producto_id
      );
      if (lineaEncontrada) {
        handleSeleccionarLinea(lineaEncontrada);
      }
    }

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
                  onClick={() => handleSeleccionarLinea(p)}
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
                onClick={() => {
                  setLineaSel(null);
                  setImeis(['']);
                  setProveedorId('');
                  setCostoCompra('');
                  setModoPago(null);
                  reactivarMapRef.current = {};
                }}
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
              {imeis.map((imei, index) => {
                const imeiVal = imei;
                return (
                  <div key={index} className="flex gap-1.5">
                    <input
                      ref={(el) => { inputRefs.current[index] = el; }}
                      type="text"
                      value={imeiVal}
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
                );
              })}
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

// ─── Paso Cantidad ────────────────────────────────────────────────────────────

function PasoCantidad({ onExito }) {
  const queryClient                       = useQueryClient();
  const { esAdminNegocio }                = useAuth();
  const esAdmin                           = esAdminNegocio();
  const [busqueda,      setBusqueda]      = useState('');
  const [productoSel,   setProductoSel]   = useState(null);
  const [creandoNuevo,  setCreandoNuevo]  = useState(false);
  const [nuevoProducto, setNuevoProducto] = useState({ nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '' });
  const [cantidad,      setCantidad]      = useState(1);
  const [proveedorId,   setProveedorId]   = useState('');
  const [costoCompra,   setCostoCompra]   = useState('');
  const [modoPago,      setModoPago]      = useState(null);
  const [error,         setError]         = useState('');

  const { data: productosData } = useQuery({
    queryKey: ['productos-cantidad'],
    queryFn: () => getProductosCantidad().then((r) => r.data.data),
  });

  const handleSeleccionarProducto = (producto) => {
    setProductoSel(producto);
    setError('');
    if (esAdmin) {
      if (producto.proveedor_id)   setProveedorId(String(producto.proveedor_id));
      if (producto.costo_unitario) setCostoCompra(String(producto.costo_unitario));
    }
  };

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
                onClick={() => handleSeleccionarProducto(p)}
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

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalAgregarProducto({ onClose }) {
  const [tipo,  setTipo]  = useState(null);
  const [exito, setExito] = useState(false);

  // Estado del modal de reactivación — vive aquí para renderizarlo fuera del Modal principal
  const [modalReactivar,     setModalReactivar]     = useState(false);
  const [serialesDuplicados, setSerializesDuplicados] = useState([]);
  const confirmarReactivarRef = useRef(null);

  const handleDuplicadosEncontrados = (seriales, confirmarFn) => {
    confirmarReactivarRef.current = confirmarFn;
    setSerializesDuplicados(seriales);
    setModalReactivar(true);
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
        {tipo === 'serial'   && <PasoSerial   onExito={() => setExito(true)} onDuplicadosEncontrados={handleDuplicadosEncontrados} />}
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

      {/* ModalReactivarSeriales fuera del Modal principal — evita conflicto de z-index */}
      <ModalReactivarSeriales
        open={modalReactivar}
        seriales={serialesDuplicados}
        onReactivar={handleReactivar}
        onCancelar={handleCancelarReactivar}
      />
    </>
  );
}