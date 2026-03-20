import { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Modal }        from '../../components/ui/Modal';
import { Button }       from '../../components/ui/Button';
import { Input }        from '../../components/ui/Input';
import { Badge }        from '../../components/ui/Badge';
import { SearchInput }  from '../../components/ui/SearchInput';
import { InputMoneda }  from '../../components/ui/InputMoneda';
import { formatCOP }    from '../../utils/formatters';
import { crearCompra }  from '../../api/compras.api';
import {
  getProductosSerial, crearProductoSerial,
  getProductosCantidad, crearProductoCantidad,
  verificarImei as verificarImeiApi,
} from '../../api/productos.api';
import { getAcreedores } from '../../api/acreedores.api';
import { getLineas }     from '../../api/lineas.api';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import {
  Trash2, Package, ShoppingBag, ChevronRight,
  RefreshCw, AlertTriangle, X,
} from 'lucide-react';

// ─── Utilidad: normalizar respuesta de productos a array ─────────────────────
function normalizarProductos(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

// ─── Utilidad: bloquear ruedita en inputs numéricos ──────────────────────────
const noWheel = (e) => e.target.blur();

// ─── Utilidad: calcular precio COP desde USD ─────────────────────────────────
function calcularPrecioCOP(precioUsd, factor, traida) {
  const f = Number(factor) || 0;
  const t = Number(traida) || 0;
  const u = Number(precioUsd) || 0;
  if (f === 0) return 0;
  return Math.round((u * f) + t);
}

// ─── Lógica de verificación de IMEIs duplicados ──────────────────────────────
async function verificarImeisDuplicados(imeis) {
  const resultados = await Promise.all(
    imeis.map(async (imei) => {
      try {
        const { data } = await verificarImeiApi(imei.trim());
        if (data.data.existe) return data.data.serial;
        return null;
      } catch { return null; }
    })
  );
  const encontrados = resultados.filter(Boolean);
  return {
    disponibles:   encontrados.filter((s) => !s.vendido && !s.prestado),
    paraReactivar: encontrados.filter((s) => s.vendido  || s.prestado),
  };
}

// ─── Hook: verificación de IMEIs con estado de modales ───────────────────────
function useVerificacionImeis() {
  const [verificando,         setVerificando]          = useState(false);
  const [modalReactivar,      setModalReactivar]       = useState(false);
  const [modalYaEnInventario, setModalYaEnInventario]  = useState(false);
  const [serialesReactivar,   setSerializesReactivar]  = useState([]);
  const [serialesDisponibles, setSerializesDisponibles] = useState([]);

  const reactivarMapRef    = useRef({});
  const pendingCallbackRef = useRef(null);

  const verificarYProceder = useCallback(async (imeis, onProceder) => {
    reactivarMapRef.current = {};
    setVerificando(true);
    const { disponibles, paraReactivar } = await verificarImeisDuplicados(imeis);
    setVerificando(false);

    if (disponibles.length > 0) {
      setSerializesDisponibles(disponibles);
      setModalYaEnInventario(true);
      return;
    }
    if (paraReactivar.length > 0) {
      setSerializesReactivar(paraReactivar);
      pendingCallbackRef.current = onProceder;
      setModalReactivar(true);
      return;
    }
    onProceder({ reactivarMap: {} });
  }, []);

  const handleConfirmarReactivar = useCallback(() => {
    serialesReactivar.forEach((serial) => {
      reactivarMapRef.current[serial.imei] = serial.id;
    });
    setModalReactivar(false);
    setSerializesReactivar([]);
    pendingCallbackRef.current?.({ reactivarMap: reactivarMapRef.current });
    pendingCallbackRef.current = null;
  }, [serialesReactivar]);

  const handleCancelarReactivar = useCallback(() => {
    setModalReactivar(false);
    setSerializesReactivar([]);
    pendingCallbackRef.current = null;
  }, []);

  const handleCerrarDisponibles = useCallback(() => {
    setModalYaEnInventario(false);
    setSerializesDisponibles([]);
  }, []);

  return {
    verificando, verificarYProceder,
    modalReactivar, serialesReactivar, handleConfirmarReactivar, handleCancelarReactivar,
    modalYaEnInventario, serialesDisponibles, handleCerrarDisponibles,
  };
}

// ─── Componentes de fila para los modales de duplicados ──────────────────────
function FilasSerial({ seriales }) {
  return (
    <div className="w-full flex flex-col gap-2 max-h-52 overflow-y-auto">
      {seriales.map((serial) => {
        const serialItem  = serial;
        const estadoLabel = serialItem.vendido  ? 'Vendido'
          : serialItem.prestado                 ? 'Prestado'
          :                                       'En inventario';
        const estadoColor = serialItem.vendido
          ? 'text-red-600 bg-red-50 border-red-200'
          : serialItem.prestado
          ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
          : 'text-green-700 bg-green-50 border-green-200';
        return (
          <div key={serialItem.id} className="w-full rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-sm"><span className="text-gray-500">IMEI</span><span className="font-mono font-medium text-gray-900">{serialItem.imei}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Producto</span><span className="font-medium text-gray-900 text-right max-w-[60%]">{serialItem.producto_nombre}{serialItem.marca ? ` · ${serialItem.marca}` : ''}</span></div>
            <div className="flex justify-between text-sm items-center"><span className="text-gray-500">Estado</span><span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${estadoColor}`}>{estadoLabel}</span></div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Modal: IMEIs que requieren reactivación ─────────────────────────────────
function ModalReactivarSeriales({ open, seriales, onReactivar, onCancelar }) {
  if (!seriales || seriales.length === 0) return null;
  return (
    <Modal open={open} onClose={onCancelar} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="w-14 h-14 rounded-full bg-amber-50 border-2 border-amber-200 flex items-center justify-center"><AlertTriangle size={26} className="text-amber-500" /></div>
        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-900">{seriales.length === 1 ? 'IMEI ya registrado' : `${seriales.length} IMEIs ya registrados`}</h3>
          <p className="text-sm text-gray-500 mt-1">{seriales.length === 1 ? 'Este equipo fue vendido o prestado — puedes reactivarlo con esta compra' : 'Estos equipos fueron vendidos o prestados — puedes reactivarlos con esta compra'}</p>
        </div>
        <FilasSerial seriales={seriales} />
        <p className="text-sm text-center text-gray-700 leading-relaxed">¿Deseas <span className="font-semibold text-purple-700">reactivar estos seriales</span> y registrarlos en esta compra? Se marcarán como disponibles nuevamente.</p>
        <div className="flex gap-2 w-full">
          <Button variant="secondary" className="flex-1 flex items-center justify-center gap-1.5" onClick={onCancelar}><X size={14} /> Cancelar</Button>
          <Button className="flex-1 flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white" onClick={onReactivar}><RefreshCw size={14} /> Sí, reactivar</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal: IMEIs ya disponibles en inventario ────────────────────────────────
function ModalYaEnInventario({ open, seriales, onCerrar }) {
  if (!seriales || seriales.length === 0) return null;
  return (
    <Modal open={open} onClose={onCerrar} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="w-14 h-14 rounded-full bg-blue-50 border-2 border-blue-200 flex items-center justify-center"><Package size={26} className="text-blue-500" /></div>
        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-900">{seriales.length === 1 ? 'IMEI ya disponible' : `${seriales.length} IMEIs ya disponibles`}</h3>
          <p className="text-sm text-gray-500 mt-1">{seriales.length === 1 ? 'Este equipo ya está en inventario como disponible' : 'Estos equipos ya están en inventario como disponibles'}</p>
        </div>
        <FilasSerial seriales={seriales} />
        <p className="text-sm text-center text-gray-700 leading-relaxed">Corrige los IMEIs marcados antes de continuar con la compra.</p>
        <Button className="w-full" onClick={onCerrar}>Entendido</Button>
      </div>
    </Modal>
  );
}

// ─── Panel de factor de conversión ───────────────────────────────────────────
// factor (TRM) mantiene type=number: es un multiplicador que puede tener decimales (ej: 4200.5)
// traida → InputMoneda: es un valor COP entero (ej: 50000)
function PanelConversion({ factor, traida, onChange, onAplicarATodos }) {
  const precioEjemplo = factor > 0 ? (10 * Number(factor)) + Number(traida || 0) : null;

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-blue-700">Factor de conversión USD → COP</p>
        {precioEjemplo && (
          <span className="text-xs text-blue-400">Ej: $10 USD = {formatCOP(precioEjemplo)}</span>
        )}
      </div>
      <div className="flex gap-2">
        {/* factor: type=number porque puede tener decimales (TRM) */}
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">TRM / Factor</label>
          <input
            type="number"
            value={factor}
            onChange={(e) => onChange('factor', e.target.value)}
            onWheel={noWheel}
            placeholder="4200"
            className="w-full px-2.5 py-1.5 bg-white border border-blue-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        {/* traida: InputMoneda — es un valor COP entero */}
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Valor traída (COP)</label>
          <InputMoneda
            value={traida}
            onChange={(val) => onChange('traida', val)}
            placeholder="0"
            className="w-full px-2.5 py-1.5 bg-white border border-blue-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      </div>
      {Number(factor) > 0 && (
        <button
          onClick={onAplicarATodos}
          className="flex items-center gap-1.5 text-xs text-blue-600 font-medium
            hover:text-blue-800 transition-colors w-fit"
        >
          <RefreshCw size={11} />
          Recalcular todos los precios
        </button>
      )}
      <p className="text-xs text-gray-400">Fórmula: precio COP = (precio USD × factor) + traída</p>
    </div>
  );
}

// ─── Paso 1: Seleccionar tipo ─────────────────────────────────────────────────
function PasoTipo({ onSelect }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">¿Qué tipo de productos estás comprando?</p>
      <div className="flex gap-3">
        <button onClick={() => onSelect('serial')}
          className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-50 border border-gray-200 rounded-2xl hover:bg-blue-50 hover:border-blue-300 transition-all">
          <Package size={24} className="text-blue-600" />
          <span className="text-sm font-medium text-gray-700">Con Serial / IMEI</span>
          <span className="text-xs text-gray-400 text-center">Celulares, tablets, etc.</span>
        </button>
        <button onClick={() => onSelect('cantidad')}
          className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-50 border border-gray-200 rounded-2xl hover:bg-blue-50 hover:border-blue-300 transition-all">
          <ShoppingBag size={24} className="text-green-600" />
          <span className="text-sm font-medium text-gray-700">Por Cantidad</span>
          <span className="text-xs text-gray-400 text-center">Accesorios, repuestos, etc.</span>
        </button>
      </div>
    </div>
  );
}

// ─── Hook: carga las líneas de producto del negocio ──────────────────────────
function useLineas() {
  const { data } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
  });
  return Array.isArray(data) ? data : [];
}

// ─── Select de línea reutilizable ────────────────────────────────────────────
function SelectLinea({ value, onChange }) {
  const lineas = useLineas();
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-600 font-medium">Línea de producto *</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-xs
          text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="">Seleccionar línea...</option>
        {lineas.map((l) => (
          <option key={l.id} value={l.id}>{l.nombre}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Componente línea con IMEIs ───────────────────────────────────────────────
function LineaImeis({
  linea, factor, traida, imeisDuplicados,
  onActualizarPrecioUsd, onActualizarPrecioCOP,
  onActualizarImei, onAgregarCampo, onEliminarImei, onEliminarLinea,
}) {
  const inputRefs        = useRef([]);
  const usandoConversion = Number(factor) > 0;

  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const siguiente = inputRefs.current[index + 1];
      if (siguiente) {
        siguiente.focus();
      } else {
        onAgregarCampo(linea.id);
        setTimeout(() => inputRefs.current[index + 1]?.focus(), 50);
      }
    }
  };

  const handlePrecioUsdChange = (valor) => {
    onActualizarPrecioUsd(linea.id, valor);
    if (Number(factor) > 0) {
      const cop = calcularPrecioCOP(valor, factor, traida);
      onActualizarPrecioCOP(linea.id, cop);
    }
  };

  const imeisValidos = linea.imeis.filter((i) => i.trim()).length;

  return (
    <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">{linea.nombre}</p>
          <Badge variant="blue">{imeisValidos} IMEI(s)</Badge>
        </div>
        <button onClick={() => onEliminarLinea(linea.id)}
          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex gap-2">
        {/* precio_usd: type=number porque puede tener decimales */}
        {usandoConversion && (
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">Precio USD</label>
            <input
              type="number"
              value={linea.precio_usd || ''}
              onChange={(e) => handlePrecioUsdChange(e.target.value)}
              onWheel={noWheel}
              className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0"
            />
          </div>
        )}
        {/* precio_compra (COP): InputMoneda */}
        <div className="flex-1">
          <label className="text-xs text-gray-400 mb-1 block">
            {usandoConversion ? 'Precio COP (calculado)' : 'Precio compra (COP)'}
          </label>
          <InputMoneda
            value={linea.precio_compra}
            onChange={(val) => onActualizarPrecioCOP(linea.id, val)}
            placeholder="0"
            className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {linea.imeis.map((imei, index) => {
          const imeiVal     = imei;
          const esDuplicado = imeiVal.trim() && imeisDuplicados.has(imeiVal.trim());
          return (
            <div key={index} className="flex gap-1.5">
              <input
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text"
                value={imeiVal}
                onChange={(e) => onActualizarImei(linea.id, index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                placeholder={`IMEI ${index + 1}`}
                className={`flex-1 px-2 py-1.5 border rounded-lg text-sm font-mono
                  focus:outline-none focus:ring-2
                  ${esDuplicado
                    ? 'bg-red-50 border-red-400 text-red-700 focus:ring-red-400'
                    : 'bg-white border-gray-200 focus:ring-blue-500'}`}
              />
              {linea.imeis.length > 1 && (
                <button onClick={() => onEliminarImei(linea.id, index)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
        {linea.imeis.some((i) => i.trim() && imeisDuplicados.has(i.trim())) && (
          <p className="text-xs text-red-500 font-medium">⚠ Algunos IMEIs están duplicados (marcados en rojo)</p>
        )}
        <button onClick={() => onAgregarCampo(linea.id)}
          className="text-xs text-blue-500 hover:text-blue-700 font-medium text-left mt-1">
          + Agregar IMEI
        </button>
      </div>
    </div>
  );
}

// ─── Paso 2 Serial ────────────────────────────────────────────────────────────
function PasoLineaSerial({
  proveedorId, lineasIniciales, factorInicial, traidaInicial,
  verificando, sucursalKey, sucursalLista, onContinuar, onVolver,
}) {
  const [busqueda,            setBusqueda]           = useState('');
  const [creandoNueva,        setCreandoNueva]        = useState(false);
  // nuevaLinea.precio: empieza en '' → InputMoneda trata vacío como ''
  const [nuevaLinea,          setNuevaLinea]          = useState({ nombre: '', marca: '', modelo: '', precio: '', linea_id: '' });
  const [lineasSeleccionadas, setLineasSeleccionadas] = useState(lineasIniciales);
  const [error,               setError]              = useState('');
  const [imeisDuplicados,     setImeisDuplicados]    = useState(new Set());
  const [factor,              setFactor]             = useState(factorInicial);
  const [traida,              setTraida]             = useState(traidaInicial);
  const queryClient = useQueryClient();

  const { data: productosData } = useQuery({
    queryKey: ['productos-serial', ...sucursalKey],
    queryFn:  () => getProductosSerial().then((r) => normalizarProductos(r.data.data)),
    enabled:  sucursalLista,
  });

  const productos = normalizarProductos(productosData).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const mutCrearLinea = useMutation({
    mutationFn: () => crearProductoSerial({
      nombre:       nuevaLinea.nombre,
      marca:        nuevaLinea.marca,
      modelo:       nuevaLinea.modelo,
      // nuevaLinea.precio ya es number (viene de InputMoneda) o '' → conversión segura
      precio:       nuevaLinea.precio !== '' ? Number(nuevaLinea.precio) : null,
      proveedor_id: proveedorId,
      linea_id:     nuevaLinea.linea_id ? Number(nuevaLinea.linea_id) : null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'], exact: false });
      agregarLinea(res.data.data);
      setCreandoNueva(false);
      setNuevaLinea({ nombre: '', marca: '', modelo: '', precio: '', linea_id: '' });
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear línea'),
  });

  const agregarLinea = (producto) => {
    if (lineasSeleccionadas.find((l) => l.id === producto.id)) return;
    setLineasSeleccionadas((prev) => [...prev, {
      ...producto,
      imeis: [''],
      precio_usd: '',
      // Number() limpia posibles decimales de Postgres ('850000.00' → 850000)
      precio_compra: Number(producto.precio) || 0,
    }]);
  };

  const eliminarLinea        = (id) => setLineasSeleccionadas((prev) => prev.filter((l) => l.id !== id));
  const actualizarPrecioUsd  = (id, valor) => setLineasSeleccionadas((prev) => prev.map((l) => l.id === id ? { ...l, precio_usd: valor } : l));
  const actualizarPrecioCOP  = (id, valor) => setLineasSeleccionadas((prev) => prev.map((l) => l.id === id ? { ...l, precio_compra: valor } : l));
  const actualizarImei       = (lineaId, index, valor) => setLineasSeleccionadas((prev) => prev.map((l) => { if (l.id !== lineaId) return l; const imeis = [...l.imeis]; imeis[index] = valor; return { ...l, imeis }; }));
  const agregarCampoImei     = (lineaId) => setLineasSeleccionadas((prev) => prev.map((l) => l.id === lineaId ? { ...l, imeis: [...l.imeis, ''] } : l));
  const eliminarImei         = (lineaId, index) => setLineasSeleccionadas((prev) => prev.map((l) => { if (l.id !== lineaId) return l; const imeis = l.imeis.filter((_, i) => i !== index); return { ...l, imeis: imeis.length === 0 ? [''] : imeis }; }));

  const handleAplicarATodos = useCallback(() => {
    setLineasSeleccionadas((prev) =>
      prev.map((l) => {
        if (!l.precio_usd) return l;
        return { ...l, precio_compra: calcularPrecioCOP(l.precio_usd, factor, traida) };
      })
    );
  }, [factor, traida]);

  const handleConversionChange = (campo, valor) => {
    if (campo === 'factor') setFactor(valor);
    if (campo === 'traida') setTraida(valor);
  };

  const handleContinuar = () => {
    setError('');
    setImeisDuplicados(new Set());
    if (lineasSeleccionadas.length === 0) return setError('Agrega al menos una línea');

    const todosImeis = [];
    for (const linea of lineasSeleccionadas) {
      for (const imei of linea.imeis) {
        if (imei.trim()) todosImeis.push(imei.trim());
      }
    }

    const vistos = new Set(); const duplicados = new Set();
    for (const imei of todosImeis) {
      if (vistos.has(imei)) duplicados.add(imei);
      else vistos.add(imei);
    }
    if (duplicados.size > 0) { setImeisDuplicados(duplicados); return setError(`IMEIs duplicados detectados: ${[...duplicados].join(', ')}`); }

    for (const linea of lineasSeleccionadas) {
      const imeisValidos = linea.imeis.filter((i) => i.trim());
      if (imeisValidos.length === 0) return setError(`La línea "${linea.nombre}" debe tener al menos un IMEI`);
    }

    const lineasPayload = lineasSeleccionadas.map((l) => ({
      ...l,
      factor_conversion: Number(factor) || null,
      valor_traida:      Number(traida) || null,
    }));

    onContinuar(todosImeis, lineasPayload, factor, traida);
  };

  return (
    <div className="flex flex-col gap-4">
      <PanelConversion factor={factor} traida={traida} onChange={handleConversionChange} onAplicarATodos={handleAplicarATodos} />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">Seleccionar línea de producto</p>
        <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar modelo..." />
        <div className="max-h-36 overflow-y-auto flex flex-col gap-1">
          {productos.map((p) => {
            const productoItem = p;
            return (
              <button key={productoItem.id} onClick={() => agregarLinea(productoItem)}
                disabled={!!lineasSeleccionadas.find((l) => l.id === productoItem.id)}
                className={`flex items-center justify-between p-2.5 rounded-xl text-left text-sm border transition-all
                  ${lineasSeleccionadas.find((l) => l.id === productoItem.id)
                    ? 'bg-blue-50 border-blue-200 text-blue-600 opacity-60 cursor-not-allowed'
                    : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50'}`}>
                <span className="font-medium">{productoItem.nombre}</span>
                <ChevronRight size={14} className="text-gray-400" />
              </button>
            );
          })}
        </div>
        <button onClick={() => setCreandoNueva(!creandoNueva)} className="text-xs text-blue-600 hover:text-blue-700 font-medium text-left">+ Crear nueva línea</button>
      </div>

      {creandoNueva && (
        <div className="bg-blue-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-blue-700">Nueva línea de producto</p>
          <Input id="nueva-nombre" placeholder="Nombre (ej: iPhone 15 Pro Max)" value={nuevaLinea.nombre}
            onChange={(e) => setNuevaLinea({ ...nuevaLinea, nombre: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && document.getElementById('nueva-marca')?.focus()} />
          <div className="flex gap-2">
            <Input id="nueva-marca" placeholder="Marca" value={nuevaLinea.marca}
              onChange={(e) => setNuevaLinea({ ...nuevaLinea, marca: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('nueva-modelo')?.focus()} />
            <Input id="nueva-modelo" placeholder="Modelo" value={nuevaLinea.modelo}
              onChange={(e) => setNuevaLinea({ ...nuevaLinea, modelo: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('nueva-precio')?.focus()} />
          </div>
          {/* CAMBIO: Input type=number → InputMoneda para precio de venta COP */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-600 font-medium">Precio de venta</label>
            <InputMoneda
              id="nueva-precio"
              value={nuevaLinea.precio}
              onChange={(val) => setNuevaLinea({ ...nuevaLinea, precio: val })}
              placeholder="0"
              className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <SelectLinea value={nuevaLinea.linea_id} onChange={(val) => setNuevaLinea({ ...nuevaLinea, linea_id: val })} />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setCreandoNueva(false)}>Cancelar</Button>
            <Button size="sm" className="flex-1" loading={mutCrearLinea.isPending} disabled={!nuevaLinea.linea_id} onClick={() => mutCrearLinea.mutate()}>Crear y agregar</Button>
          </div>
        </div>
      )}

      {lineasSeleccionadas.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-gray-700">IMEIs por línea</p>
          {lineasSeleccionadas.map((linea) => {
            const lineaItem = linea;
            return (
              <LineaImeis
                key={lineaItem.id}
                linea={lineaItem}
                factor={factor}
                traida={traida}
                imeisDuplicados={imeisDuplicados}
                onActualizarPrecioUsd={actualizarPrecioUsd}
                onActualizarPrecioCOP={actualizarPrecioCOP}
                onActualizarImei={actualizarImei}
                onAgregarCampo={agregarCampoImei}
                onEliminarImei={eliminarImei}
                onEliminarLinea={eliminarLinea}
              />
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onVolver}>← Volver</Button>
        <Button className="flex-1" loading={verificando} onClick={handleContinuar} disabled={lineasSeleccionadas.length === 0}>
          {verificando ? 'Verificando IMEIs...' : <>Continuar <ChevronRight size={16} /></>}
        </Button>
      </div>
    </div>
  );
}

// ─── Paso 2 Cantidad ──────────────────────────────────────────────────────────
function PasoCantidad({
  proveedorId, productosIniciales, factorInicial, traidaInicial,
  sucursalKey, sucursalLista, onProductosListos, onVolver,
}) {
  const [busqueda,               setBusqueda]              = useState('');
  const [creandoNuevo,           setCreandoNuevo]          = useState(false);
  // nuevoProducto precios: '' inicial → InputMoneda trata vacío como ''
  const [nuevoProducto,          setNuevoProducto]         = useState({ nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '', linea_id: '' });
  const [productosSeleccionados, setProductosSeleccionados] = useState(productosIniciales);
  const [error,                  setError]                 = useState('');
  const [factor,                 setFactor]                = useState(factorInicial);
  const [traida,                 setTraida]                = useState(traidaInicial);
  const queryClient = useQueryClient();

  const { data: productosData } = useQuery({
    queryKey: ['productos-cantidad', ...sucursalKey],
    queryFn:  () => getProductosCantidad().then((r) => normalizarProductos(r.data.data)),
    enabled:  sucursalLista,
  });

  const productos = normalizarProductos(productosData).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const mutCrear = useMutation({
    mutationFn: () => crearProductoCantidad({
      nombre:         nuevoProducto.nombre,
      unidad_medida:  nuevoProducto.unidad_medida,
      // ya son number (de InputMoneda) o '' → Number('') = 0, condición !== '' lo filtra
      costo_unitario: nuevoProducto.costo_unitario !== '' ? Number(nuevoProducto.costo_unitario) : null,
      precio:         nuevoProducto.precio         !== '' ? Number(nuevoProducto.precio)         : null,
      proveedor_id:   proveedorId,
      linea_id:       nuevoProducto.linea_id ? Number(nuevoProducto.linea_id) : null,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      agregarProducto(res.data.data);
      setCreandoNuevo(false);
      setNuevoProducto({ nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '', linea_id: '' });
    },
    onError: (e) => setError(e.response?.data?.error || 'Error'),
  });

  const agregarProducto = (producto) => {
    if (productosSeleccionados.find((p) => p.id === producto.id)) return;
    setProductosSeleccionados((prev) => [...prev, {
      ...producto,
      cantidad_comprada: 1,
      precio_usd:        '',
      // Number() limpia posibles decimales de Postgres ('150000.00' → 150000)
      precio_compra:     Number(producto.costo_unitario) || 0,
    }]);
  };

  const actualizarCampo = (id, campo, valor) =>
    setProductosSeleccionados((prev) => prev.map((p) => p.id === id ? { ...p, [campo]: valor } : p));

  const actualizarPrecioUsd = (id, valor) =>
    setProductosSeleccionados((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const cop = calcularPrecioCOP(valor, factor, traida);
        return { ...p, precio_usd: valor, precio_compra: cop || p.precio_compra };
      })
    );

  const handleAplicarATodos = useCallback(() => {
    setProductosSeleccionados((prev) =>
      prev.map((p) => {
        if (!p.precio_usd) return p;
        return { ...p, precio_compra: calcularPrecioCOP(p.precio_usd, factor, traida) };
      })
    );
  }, [factor, traida]);

  const handleConversionChange = (campo, valor) => {
    if (campo === 'factor') setFactor(valor);
    if (campo === 'traida') setTraida(valor);
  };

  const handleContinuar = () => {
    setError('');
    if (productosSeleccionados.length === 0) return setError('Agrega al menos un producto');
    for (const p of productosSeleccionados) {
      if (!p.cantidad_comprada || p.cantidad_comprada < 1)
        return setError(`"${p.nombre}" debe tener cantidad mayor a 0`);
    }
    onProductosListos(
      productosSeleccionados.map((p) => ({
        ...p,
        factor_conversion: Number(factor) || null,
        valor_traida:      Number(traida) || null,
      })),
      factor, traida,
    );
  };

  const usandoConversion = Number(factor) > 0;

  return (
    <div className="flex flex-col gap-4">
      <PanelConversion factor={factor} traida={traida} onChange={handleConversionChange} onAplicarATodos={handleAplicarATodos} />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">Seleccionar producto</p>
        <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar producto..." />
        <div className="max-h-36 overflow-y-auto flex flex-col gap-1">
          {productos.map((p) => {
            const productoItem = p;
            return (
              <button key={productoItem.id} onClick={() => agregarProducto(productoItem)}
                disabled={!!productosSeleccionados.find((s) => s.id === productoItem.id)}
                className={`flex items-center justify-between p-2.5 rounded-xl text-left text-sm border transition-all
                  ${productosSeleccionados.find((s) => s.id === productoItem.id)
                    ? 'bg-green-50 border-green-200 opacity-60 cursor-not-allowed'
                    : 'bg-white border-gray-100 hover:border-green-200 hover:bg-green-50'}`}>
                <span className="font-medium">{productoItem.nombre}</span>
                <span className="text-xs text-gray-400">Stock: {productoItem.stock}</span>
              </button>
            );
          })}
        </div>
        <button onClick={() => setCreandoNuevo(!creandoNuevo)} className="text-xs text-blue-600 hover:text-blue-700 font-medium text-left">+ Crear nuevo producto</button>
      </div>

      {creandoNuevo && (
        <div className="bg-green-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-green-700">Nuevo producto</p>
          <Input placeholder="Nombre del producto" value={nuevoProducto.nombre}
            onChange={(e) => setNuevoProducto({ ...nuevoProducto, nombre: e.target.value })} />
          {/* CAMBIO: Inputs type=number → InputMoneda para precios COP */}
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs text-gray-600 font-medium">Precio compra</label>
              <InputMoneda
                value={nuevoProducto.costo_unitario}
                onChange={(val) => setNuevoProducto({ ...nuevoProducto, costo_unitario: val })}
                placeholder="0"
                className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-xs
                  focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs text-gray-600 font-medium">Precio venta</label>
              <InputMoneda
                value={nuevoProducto.precio}
                onChange={(val) => setNuevoProducto({ ...nuevoProducto, precio: val })}
                placeholder="0"
                className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-xs
                  focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
          </div>
          <SelectLinea value={nuevoProducto.linea_id} onChange={(val) => setNuevoProducto({ ...nuevoProducto, linea_id: val })} />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setCreandoNuevo(false)}>Cancelar</Button>
            <Button size="sm" className="flex-1" loading={mutCrear.isPending} disabled={!nuevoProducto.linea_id} onClick={() => mutCrear.mutate()}>Crear y agregar</Button>
          </div>
        </div>
      )}

      {productosSeleccionados.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-700">Cantidades y precios</p>
          {productosSeleccionados.map((p) => {
            const productoSel = p;
            return (
              <div key={productoSel.id} className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">{productoSel.nombre}</p>
                  <button onClick={() => setProductosSeleccionados((prev) => prev.filter((s) => s.id !== productoSel.id))}
                    className="p-1 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex gap-2">
                  {/* cantidad_comprada: type=number (es conteo, no precio) */}
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
                    <input type="number" value={productoSel.cantidad_comprada}
                      onChange={(e) => actualizarCampo(productoSel.id, 'cantidad_comprada', Number(e.target.value))}
                      onWheel={noWheel}
                      className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                        focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  {/* precio_usd: type=number (puede tener decimales) */}
                  {usandoConversion && (
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1 block">Precio USD</label>
                      <input type="number" value={productoSel.precio_usd}
                        onChange={(e) => actualizarPrecioUsd(productoSel.id, e.target.value)}
                        onWheel={noWheel}
                        className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                          focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}
                  {/* precio_compra (COP): InputMoneda */}
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">
                      {usandoConversion ? 'Precio COP' : 'Precio compra'}
                    </label>
                    <InputMoneda
                      value={productoSel.precio_compra}
                      onChange={(val) => actualizarCampo(productoSel.id, 'precio_compra', val)}
                      placeholder="0"
                      className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                        focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onVolver}>← Volver</Button>
        <Button className="flex-1" onClick={handleContinuar} disabled={productosSeleccionados.length === 0}>
          Continuar <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}

// ─── Paso 3: Pago y confirmación ──────────────────────────────────────────────
function PasoPago({ proveedor, productos, tipo, onConfirmar, onVolver, loading }) {
  const [pagos,               setPagos]               = useState([{ metodo: 'Contado', valor: '' }]);
  const [totalCompra,         setTotalCompra]          = useState(() => {
    if (tipo === 'serial') {
      return productos.reduce((s, l) => {
        const imeisValidos = l.imeis.filter((i) => {
          const valor = typeof i === 'string' ? i : i.valor;
          return valor.trim();
        }).length;
        return s + (Number(l.precio_compra) * imeisValidos);
      }, 0);
    }
    return productos.reduce((s, p) => s + (Number(p.precio_compra) * p.cantidad_comprada), 0);
  });
  const [agregarComoAcreedor, setAgregarComoAcreedor] = useState(false);
  const [numeroFactura,       setNumeroFactura]        = useState('');
  const [notas,               setNotas]                = useState('');
  const [error,               setError]                = useState('');

  const { data: acreedoresRaw } = useQuery({
    queryKey: ['acreedores'],
    queryFn:  () => getAcreedores('').then((r) => r.data.data),
  });
  const acreedoresData = normalizarProductos(acreedoresRaw);
  const proveedorYaEsAcreedor = acreedoresData.some((a) => a.proveedor_id === proveedor.id);

  const handleConfirmar = () => {
    setError('');
    const pagosFinales = pagos.length === 1
      ? [{ ...pagos[0], valor: totalCompra }]
      : pagos;

    if (pagos.length > 1) {
      const pagado = pagosFinales.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      if (pagado !== Number(totalCompra)) {
        return setError(`El total asignado (${formatCOP(pagado)}) no coincide con el total (${formatCOP(totalCompra)})`);
      }
    }
    onConfirmar({ pagos: pagosFinales, totalCompra: Number(totalCompra), agregarComoAcreedor, numeroFactura, notas });
  };

  const contarImeisValidos = (linea) =>
    linea.imeis.filter((i) => { const valor = typeof i === 'string' ? i : i.valor; return valor.trim(); }).length;

  const resumen = tipo === 'serial'
    ? productos.map((l) => ({ nombre: l.nombre, cantidad: contarImeisValidos(l), precio_unitario: Number(l.precio_compra), precio_usd: l.precio_usd || null }))
    : productos.map((p) => ({ nombre: p.nombre, cantidad: p.cantidad_comprada, precio_unitario: Number(p.precio_compra), precio_usd: p.precio_usd || null }));

  const pagadoParcial = pagos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const diferencia    = Number(totalCompra) - pagadoParcial;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
        <p className="text-xs font-medium text-gray-500 mb-1">Resumen de compra</p>
        {resumen.map((r, i) => {
          const resumenItem = r;
          return (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-gray-700">
                {resumenItem.nombre} x{resumenItem.cantidad}
                {resumenItem.precio_usd && <span className="text-xs text-gray-400 ml-1">(${resumenItem.precio_usd} USD)</span>}
              </span>
              <span className="font-medium">{formatCOP(resumenItem.precio_unitario * resumenItem.cantidad)}</span>
            </div>
          );
        })}
        <div className="border-t border-gray-200 mt-1 pt-1.5 flex justify-between">
          <span className="text-sm font-semibold">Total estimado</span>
          <span className="text-sm font-bold text-gray-900">
            {formatCOP(resumen.reduce((s, r) => s + r.precio_unitario * r.cantidad, 0))}
          </span>
        </div>
      </div>

      {/* CAMBIO: input type=number → InputMoneda para total COP */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Total de la compra</label>
        <InputMoneda
          value={totalCompra}
          onChange={(val) => setTotalCompra(val)}
          placeholder="0"
          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
            focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <Input
        label="N° Factura proveedor (opcional)"
        placeholder="FAC-001"
        value={numeroFactura}
        onChange={(e) => setNumeroFactura(e.target.value)}
      />

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Método de pago</p>
        <div className="grid grid-cols-2 gap-2">
          {['Contado', 'Transferencia', 'Credito', 'Fiado'].map((m) => {
            const metodo       = m;
            const seleccionado = pagos.find((p) => p.metodo === metodo);
            return (
              <button key={metodo}
                onClick={() => {
                  if (seleccionado) {
                    setPagos((prev) => prev.filter((p) => p.metodo !== metodo));
                  } else {
                    setPagos((prev) => [...prev, { metodo, valor: '' }]);
                    if (metodo === 'Credito' || metodo === 'Fiado') setAgregarComoAcreedor(true);
                  }
                }}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-all
                  ${seleccionado ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                {metodo}
              </button>
            );
          })}
        </div>

        {pagos.length > 1 && (
          <div className="mt-3 flex flex-col gap-2">
            {pagos.map((p) => {
              const pagoItem = p;
              return (
                <div key={pagoItem.metodo} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-28 flex-shrink-0">{pagoItem.metodo}:</span>
                  {/* CAMBIO: input type=number → InputMoneda para montos de pago COP */}
                  <InputMoneda
                    value={pagoItem.valor}
                    onChange={(val) => setPagos((prev) =>
                      prev.map((x) => x.metodo === pagoItem.metodo ? { ...x, valor: val } : x)
                    )}
                    placeholder="0"
                    className="flex-1 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                      focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              );
            })}
            {diferencia > 0 && (
              <div className="flex justify-between text-xs px-1 mt-1 text-orange-500">
                <span>Pendiente por asignar</span>
                <span className="font-semibold">{formatCOP(diferencia)}</span>
              </div>
            )}
            {diferencia < 0 && (
              <div className="flex justify-between text-xs px-1 mt-1 text-red-500">
                <span>Excede el total</span>
                <span className="font-semibold">{formatCOP(Math.abs(diferencia))}</span>
              </div>
            )}
            {diferencia === 0 && pagadoParcial > 0 && (
              <div className="flex justify-between text-xs px-1 mt-1 text-green-600">
                <span>✓ Total cubierto</span>
                <span className="font-semibold">{formatCOP(pagadoParcial)}</span>
              </div>
            )}
          </div>
        )}
        {pagos.length === 1 && (
          <p className="text-xs text-gray-400 mt-2 px-1">
            Se registrará el total completo ({formatCOP(totalCompra)}) como {pagos[0].metodo}
          </p>
        )}
      </div>

      <div className={`rounded-xl p-3 border transition-all ${agregarComoAcreedor ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={agregarComoAcreedor}
            onChange={(e) => setAgregarComoAcreedor(e.target.checked)} className="rounded" />
          <div>
            <p className="text-sm font-medium text-gray-700">
              {proveedorYaEsAcreedor ? `Registrar cargo a ${proveedor.nombre}` : `Agregar ${proveedor.nombre} como acreedor`}
            </p>
            <p className="text-xs text-gray-400">
              {proveedorYaEsAcreedor ? 'Se registrará el monto pendiente en su cuenta' : 'Se creará un acreedor con el monto pendiente de esta compra'}
            </p>
          </div>
        </label>
      </div>

      <Input label="Notas (opcional)" placeholder="Observaciones de la compra"
        value={notas} onChange={(e) => setNotas(e.target.value)} />

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onVolver}>← Volver</Button>
        <Button className="flex-1" loading={loading} onClick={handleConfirmar}>Confirmar Compra</Button>
      </div>
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────
export function ModalCompra({ proveedor, onClose }) {
  const queryClient                    = useQueryClient();
  const { sucursalKey, sucursalLista } = useSucursalKey();

  const [paso,           setPaso]           = useState(1);
  const [tipo,           setTipo]           = useState(null);
  const [productos,      setProductos]      = useState([]);
  const [factorGuardado, setFactorGuardado] = useState('');
  const [traidaGuardada, setTraidaGuardada] = useState('');

  const {
    verificando, verificarYProceder,
    modalReactivar, serialesReactivar, handleConfirmarReactivar, handleCancelarReactivar,
    modalYaEnInventario, serialesDisponibles, handleCerrarDisponibles,
  } = useVerificacionImeis();

  const mutCompra = useMutation({
    mutationFn: (payload) => crearCompra(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['compras'],             exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],          exact: false });
      onClose();
    },
  });

  const handleTipo       = (t) => { setTipo(t); setPaso(2); };
  const handleVolverA1   = () => setPaso(1);
  const handleVolverA2   = () => setPaso(2);

  const handleContinuarSerial = (imeis, lineasPayload, factor, traida) => {
    verificarYProceder(imeis, ({ reactivarMap }) => {
      const lineasEnriquecidas = lineasPayload.map((linea) => ({
        ...linea,
        imeis: linea.imeis.map((imei) => ({
          valor:               imei,
          reactivar_serial_id: reactivarMap[imei.trim()] || null,
        })),
      }));
      setProductos(lineasEnriquecidas);
      setFactorGuardado(factor);
      setTraidaGuardada(traida);
      setPaso(3);
    });
  };

  const handleProductosListos = (prods, factor, traida) => {
    setProductos(prods);
    setFactorGuardado(factor);
    setTraidaGuardada(traida);
    setPaso(3);
  };

  const handleConfirmar = (pagoData) => {
    const lineas = tipo === 'serial'
      ? productos.flatMap((linea) =>
          linea.imeis
            .filter((i) => { const valor = typeof i === 'string' ? i : i.valor; return valor.trim(); })
            .map((i) => {
              const esObjeto          = typeof i !== 'string';
              const imeiValor         = esObjeto ? i.valor          : i;
              const reactivarSerialId = esObjeto ? i.reactivar_serial_id : null;
              return {
                nombre_producto:     linea.nombre,
                imei:                imeiValor.trim(),
                cantidad:            1,
                precio_unitario:     Number(linea.precio_compra),
                precio_usd:          linea.precio_usd ? Number(linea.precio_usd) : null,
                factor_conversion:   linea.factor_conversion || null,
                valor_traida:        linea.valor_traida      || null,
                producto_id:         linea.id,
                reactivar_serial_id: reactivarSerialId,
              };
            })
        )
      : productos.map((p) => ({
          nombre_producto:   p.nombre,
          cantidad:          p.cantidad_comprada,
          precio_unitario:   Number(p.precio_compra),
          precio_usd:        p.precio_usd ? Number(p.precio_usd) : null,
          factor_conversion: p.factor_conversion || null,
          valor_traida:      p.valor_traida      || null,
          producto_id:       p.id,
        }));

    mutCompra.mutate({
      proveedor_id:        proveedor.id,
      numero_factura:      pagoData.numeroFactura,
      total:               pagoData.totalCompra,
      estado:              'Completada',
      notas:               pagoData.notas,
      lineas,
      pagos:               pagoData.pagos,
      agregarComoAcreedor: pagoData.agregarComoAcreedor,
    });
  };

  const titulos = ['Tipo de producto', 'Productos e IMEIs', 'Pago y confirmación'];

  const lineasParaPaso2 = productos.map((l) => ({
    ...l,
    imeis: (l.imeis || []).map((i) => (typeof i === 'string' ? i : i.valor)),
  }));

  return (
    <>
      <Modal open onClose={onClose} title={`Compra a ${proveedor.nombre}`} size="lg">
        <div className="flex items-center gap-2 mb-5">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-2 flex-1">
              <button
                onClick={() => { if (n < paso) { if (n === 1) handleVolverA1(); if (n === 2) handleVolverA2(); } }}
                disabled={n >= paso}
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all
                  ${paso > n ? 'bg-blue-100 text-blue-600 hover:bg-blue-200 cursor-pointer' : paso === n ? 'bg-blue-600 text-white cursor-default' : 'bg-gray-100 text-gray-400 cursor-default'}`}>
                {n}
              </button>
              <span className={`text-xs hidden sm:block ${paso >= n ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{titulos[n - 1]}</span>
              {n < 3 && <div className={`flex-1 h-px ${paso > n ? 'bg-blue-300' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {paso === 1 && <PasoTipo onSelect={handleTipo} />}

        {paso === 2 && tipo === 'serial' && (
          <PasoLineaSerial
            proveedorId={proveedor.id}
            lineasIniciales={lineasParaPaso2}
            factorInicial={factorGuardado}
            traidaInicial={traidaGuardada}
            verificando={verificando}
            sucursalKey={sucursalKey}
            sucursalLista={sucursalLista}
            onContinuar={handleContinuarSerial}
            onVolver={handleVolverA1}
          />
        )}
        {paso === 2 && tipo === 'cantidad' && (
          <PasoCantidad
            proveedorId={proveedor.id}
            productosIniciales={productos}
            factorInicial={factorGuardado}
            traidaInicial={traidaGuardada}
            sucursalKey={sucursalKey}
            sucursalLista={sucursalLista}
            onProductosListos={handleProductosListos}
            onVolver={handleVolverA1}
          />
        )}

        {paso === 3 && (
          <PasoPago
            proveedor={proveedor}
            productos={productos}
            tipo={tipo}
            onConfirmar={handleConfirmar}
            onVolver={handleVolverA2}
            loading={mutCompra.isPending}
          />
        )}
      </Modal>

      <ModalReactivarSeriales open={modalReactivar} seriales={serialesReactivar} onReactivar={handleConfirmarReactivar} onCancelar={handleCancelarReactivar} />
      <ModalYaEnInventario open={modalYaEnInventario} seriales={serialesDisponibles} onCerrar={handleCerrarDisponibles} />
    </>
  );
}