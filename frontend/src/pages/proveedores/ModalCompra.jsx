import { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Badge }       from '../../components/ui/Badge';
import { SearchInput } from '../../components/ui/SearchInput';
import { formatCOP }   from '../../utils/formatters';
import { crearCompra } from '../../api/compras.api';
import {
  getProductosSerial, crearProductoSerial,
  getProductosCantidad, crearProductoCantidad,
} from '../../api/productos.api';
import { getAcreedores } from '../../api/acreedores.api';
import { Trash2, Package, ShoppingBag, ChevronRight, RefreshCw } from 'lucide-react';

// ─── Utilidad: bloquear ruedita en inputs numéricos ───────────────────────────
const noWheel = (e) => e.target.blur();

// ─── Utilidad: calcular precio COP desde USD ──────────────────────────────────
function calcularPrecioCOP(precioUsd, factor, traida) {
  const f = Number(factor) || 0;
  const t = Number(traida) || 0;
  const u = Number(precioUsd) || 0;
  if (f === 0) return 0;
  return Math.round((u * f) + t);
}

// ─── Panel de factor de conversión ───────────────────────────────────────────
function PanelConversion({ factor, traida, onChange, onAplicarATodos }) {
  const precioEjemplo = factor > 0 ? (10 * factor) + Number(traida || 0) : null;

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-blue-700">Factor de conversión USD → COP</p>
        {precioEjemplo && (
          <span className="text-xs text-blue-400">
            Ej: $10 USD = {formatCOP(precioEjemplo)}
          </span>
        )}
      </div>
      <div className="flex gap-2">
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
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Valor traída (COP)</label>
          <input
            type="number"
            value={traida}
            onChange={(e) => onChange('traida', e.target.value)}
            onWheel={noWheel}
            placeholder="0"
            className="w-full px-2.5 py-1.5 bg-white border border-blue-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      </div>
      {factor > 0 && (
        <button
          onClick={onAplicarATodos}
          className="flex items-center gap-1.5 text-xs text-blue-600 font-medium
            hover:text-blue-800 transition-colors w-fit"
        >
          <RefreshCw size={11} />
          Recalcular todos los precios
        </button>
      )}
      <p className="text-xs text-gray-400">
        Fórmula: precio COP = (precio USD × factor) + traída
      </p>
    </div>
  );
}

// ─── Paso 1: Seleccionar tipo ─────────────────────────────────────────────────
function PasoTipo({ onSelect }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">¿Qué tipo de productos estás comprando?</p>
      <div className="flex gap-3">
        <button
          onClick={() => onSelect('serial')}
          className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-50 border border-gray-200
            rounded-2xl hover:bg-blue-50 hover:border-blue-300 transition-all"
        >
          <Package size={24} className="text-blue-600" />
          <span className="text-sm font-medium text-gray-700">Con Serial / IMEI</span>
          <span className="text-xs text-gray-400 text-center">Celulares, tablets, etc.</span>
        </button>
        <button
          onClick={() => onSelect('cantidad')}
          className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-50 border border-gray-200
            rounded-2xl hover:bg-blue-50 hover:border-blue-300 transition-all"
        >
          <ShoppingBag size={24} className="text-green-600" />
          <span className="text-sm font-medium text-gray-700">Por Cantidad</span>
          <span className="text-xs text-gray-400 text-center">Accesorios, repuestos, etc.</span>
        </button>
      </div>
    </div>
  );
}

// ─── Componente línea con IMEIs ───────────────────────────────────────────────
function LineaImeis({
  linea, factor, traida, imeisDuplicados,
  onActualizarPrecioUsd, onActualizarPrecioCOP,
  onActualizarImei, onAgregarCampo, onEliminarImei, onEliminarLinea,
}) {
  const inputRefs = useRef([]);
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
        <button
          onClick={() => onEliminarLinea(linea.id)}
          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Precios */}
      <div className="flex gap-2">
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
        <div className="flex-1">
          <label className="text-xs text-gray-400 mb-1 block">
            {usandoConversion ? 'Precio COP (calculado)' : 'Precio compra (COP)'}
          </label>
          <input
            type="number"
            value={linea.precio_compra}
            onChange={(e) => onActualizarPrecioCOP(linea.id, e.target.value)}
            onWheel={noWheel}
            className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0"
          />
        </div>
      </div>

      {/* IMEIs */}
      <div className="flex flex-col gap-1.5">
        {linea.imeis.map((imei, index) => {
          const esDuplicado = imei.trim() && imeisDuplicados.has(imei.trim());
          return (
            <div key={index} className="flex gap-1.5">
              <input
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text"
                value={imei}
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
                <button
                  onClick={() => onEliminarImei(linea.id, index)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
        {/* Mensajes de duplicados para esta línea */}
        {linea.imeis.some((i) => i.trim() && imeisDuplicados.has(i.trim())) && (
          <p className="text-xs text-red-500 font-medium">
            ⚠ Algunos IMEIs están duplicados (marcados en rojo)
          </p>
        )}
        <button
          onClick={() => onAgregarCampo(linea.id)}
          className="text-xs text-blue-500 hover:text-blue-700 font-medium text-left mt-1"
        >
          + Agregar IMEI
        </button>
      </div>
    </div>
  );
}

// ─── Paso 2 Serial ────────────────────────────────────────────────────────────
function PasoLineaSerial({ proveedorId, lineasIniciales, factorInicial, traidaInicial, onLineasListas, onVolver }) {
  const [busqueda,            setBusqueda]           = useState('');
  const [creandoNueva,        setCreandoNueva]        = useState(false);
  const [nuevaLinea,          setNuevaLinea]          = useState({ nombre: '', marca: '', modelo: '', precio: '' });
  const [lineasSeleccionadas, setLineasSeleccionadas] = useState(lineasIniciales);
  const [error,               setError]              = useState('');
  const [imeisDuplicados,     setImeisDuplicados]    = useState(new Set());
  const [factor,              setFactor]             = useState(factorInicial);
  const [traida,              setTraida]             = useState(traidaInicial);
  const queryClient = useQueryClient();

  const { data: productosData } = useQuery({
    queryKey: ['productos-serial'],
    queryFn: () => getProductosSerial().then((r) => r.data.data),
  });

  const mutCrearLinea = useMutation({
    mutationFn: () => crearProductoSerial({
      nombre:       nuevaLinea.nombre,
      marca:        nuevaLinea.marca,
      modelo:       nuevaLinea.modelo,
      precio:       nuevaLinea.precio ? Number(nuevaLinea.precio) : null,
      proveedor_id: proveedorId,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['productos-serial']);
      agregarLinea(res.data.data);
      setCreandoNueva(false);
      setNuevaLinea({ nombre: '', marca: '', modelo: '', precio: '' });
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear línea'),
  });

  const productos = (productosData || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const agregarLinea = (producto) => {
    if (lineasSeleccionadas.find((l) => l.id === producto.id)) return;
    setLineasSeleccionadas((prev) => [...prev, {
      ...producto,
      imeis:         [''],
      precio_usd:    '',
      precio_compra: producto.precio || 0,
    }]);
  };

  const eliminarLinea = (id) =>
    setLineasSeleccionadas((prev) => prev.filter((l) => l.id !== id));

  const actualizarPrecioUsd = (id, valor) =>
    setLineasSeleccionadas((prev) =>
      prev.map((l) => l.id === id ? { ...l, precio_usd: valor } : l)
    );

  const actualizarPrecioCOP = (id, valor) =>
    setLineasSeleccionadas((prev) =>
      prev.map((l) => l.id === id ? { ...l, precio_compra: valor } : l)
    );

  const actualizarImei = (lineaId, index, valor) =>
    setLineasSeleccionadas((prev) =>
      prev.map((l) => {
        if (l.id !== lineaId) return l;
        const imeis = [...l.imeis];
        imeis[index] = valor;
        return { ...l, imeis };
      })
    );

  const agregarCampoImei = (lineaId) =>
    setLineasSeleccionadas((prev) =>
      prev.map((l) => l.id === lineaId ? { ...l, imeis: [...l.imeis, ''] } : l)
    );

  const eliminarImei = (lineaId, index) =>
    setLineasSeleccionadas((prev) =>
      prev.map((l) => {
        if (l.id !== lineaId) return l;
        const imeis = l.imeis.filter((_, i) => i !== index);
        return { ...l, imeis: imeis.length === 0 ? [''] : imeis };
      })
    );

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

    // Recolectar todos los IMEIs válidos para detectar duplicados
    const todosImeis = [];
    for (const linea of lineasSeleccionadas) {
      for (const imei of linea.imeis) {
        if (imei.trim()) todosImeis.push(imei.trim());
      }
    }

    // Detectar duplicados entre todas las líneas
    const vistos = new Set();
    const duplicados = new Set();
    for (const imei of todosImeis) {
      if (vistos.has(imei)) duplicados.add(imei);
      else vistos.add(imei);
    }

    if (duplicados.size > 0) {
      setImeisDuplicados(duplicados);
      return setError(`IMEIs duplicados detectados: ${[...duplicados].join(', ')}`);
    }

    for (const linea of lineasSeleccionadas) {
      const imeisValidos = linea.imeis.filter((i) => i.trim());
      if (imeisValidos.length === 0)
        return setError(`La línea "${linea.nombre}" debe tener al menos un IMEI`);
    }

    onLineasListas(
      lineasSeleccionadas.map((l) => ({
        ...l,
        factor_conversion: Number(factor) || null,
        valor_traida:      Number(traida) || null,
      })),
      factor,
      traida,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PanelConversion
        factor={factor}
        traida={traida}
        onChange={handleConversionChange}
        onAplicarATodos={handleAplicarATodos}
      />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">Seleccionar línea de producto</p>
        <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar modelo..." />
        <div className="max-h-36 overflow-y-auto flex flex-col gap-1">
          {productos.map((p) => (
            <button
              key={p.id}
              onClick={() => agregarLinea(p)}
              disabled={!!lineasSeleccionadas.find((l) => l.id === p.id)}
              className={`flex items-center justify-between p-2.5 rounded-xl text-left text-sm
                border transition-all
                ${lineasSeleccionadas.find((l) => l.id === p.id)
                  ? 'bg-blue-50 border-blue-200 text-blue-600 opacity-60 cursor-not-allowed'
                  : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50'}`}
            >
              <span className="font-medium">{p.nombre}</span>
              <ChevronRight size={14} className="text-gray-400" />
            </button>
          ))}
        </div>
        <button
          onClick={() => setCreandoNueva(!creandoNueva)}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium text-left"
        >
          + Crear nueva línea
        </button>
      </div>

      {creandoNueva && (
        <div className="bg-blue-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-blue-700">Nueva línea de producto</p>
          <Input
            id="nueva-nombre"
            placeholder="Nombre (ej: iPhone 15 Pro Max)"
            value={nuevaLinea.nombre}
            onChange={(e) => setNuevaLinea({ ...nuevaLinea, nombre: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && document.getElementById('nueva-marca')?.focus()}
          />
          <div className="flex gap-2">
            <Input
              id="nueva-marca"
              placeholder="Marca"
              value={nuevaLinea.marca}
              onChange={(e) => setNuevaLinea({ ...nuevaLinea, marca: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('nueva-modelo')?.focus()}
            />
            <Input
              id="nueva-modelo"
              placeholder="Modelo"
              value={nuevaLinea.modelo}
              onChange={(e) => setNuevaLinea({ ...nuevaLinea, modelo: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('nueva-precio')?.focus()}
            />
          </div>
          <Input
            id="nueva-precio"
            type="number"
            placeholder="Precio de venta"
            value={nuevaLinea.precio}
            onChange={(e) => setNuevaLinea({ ...nuevaLinea, precio: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && mutCrearLinea.mutate()}
          />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setCreandoNueva(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="flex-1" loading={mutCrearLinea.isPending} onClick={() => mutCrearLinea.mutate()}>
              Crear y agregar
            </Button>
          </div>
        </div>
      )}

      {lineasSeleccionadas.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-gray-700">IMEIs por línea</p>
          {lineasSeleccionadas.map((linea) => (
            <LineaImeis
              key={linea.id}
              linea={linea}
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
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onVolver}>← Volver</Button>
        <Button className="flex-1" onClick={handleContinuar} disabled={lineasSeleccionadas.length === 0}>
          Continuar <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}

// ─── Paso 2 Cantidad ──────────────────────────────────────────────────────────
function PasoCantidad({ proveedorId, productosIniciales, factorInicial, traidaInicial, onProductosListos, onVolver }) {
  const [busqueda,               setBusqueda]              = useState('');
  const [creandoNuevo,           setCreandoNuevo]          = useState(false);
  const [nuevoProducto,          setNuevoProducto]         = useState({ nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '' });
  const [productosSeleccionados, setProductosSeleccionados] = useState(productosIniciales);
  const [error,                  setError]                 = useState('');
  const [factor,                 setFactor]                = useState(factorInicial);
  const [traida,                 setTraida]                = useState(traidaInicial);
  const queryClient = useQueryClient();

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
      proveedor_id:   proveedorId,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['productos-cantidad']);
      agregarProducto(res.data.data);
      setCreandoNuevo(false);
      setNuevoProducto({ nombre: '', unidad_medida: 'unidad', precio: '', costo_unitario: '' });
    },
    onError: (e) => setError(e.response?.data?.error || 'Error'),
  });

  const productos = (productosData || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const agregarProducto = (producto) => {
    if (productosSeleccionados.find((p) => p.id === producto.id)) return;
    setProductosSeleccionados((prev) => [...prev, {
      ...producto,
      cantidad_comprada: 1,
      precio_usd:        '',
      precio_compra:     producto.costo_unitario || 0,
    }]);
  };

  const actualizarCampo = (id, campo, valor) =>
    setProductosSeleccionados((prev) =>
      prev.map((p) => p.id === id ? { ...p, [campo]: valor } : p)
    );

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
      factor,
      traida,
    );
  };

  const usandoConversion = Number(factor) > 0;

  return (
    <div className="flex flex-col gap-4">
      <PanelConversion
        factor={factor}
        traida={traida}
        onChange={handleConversionChange}
        onAplicarATodos={handleAplicarATodos}
      />

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">Seleccionar producto</p>
        <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar producto..." />
        <div className="max-h-36 overflow-y-auto flex flex-col gap-1">
          {productos.map((p) => (
            <button
              key={p.id}
              onClick={() => agregarProducto(p)}
              disabled={!!productosSeleccionados.find((s) => s.id === p.id)}
              className={`flex items-center justify-between p-2.5 rounded-xl text-left text-sm
                border transition-all
                ${productosSeleccionados.find((s) => s.id === p.id)
                  ? 'bg-green-50 border-green-200 opacity-60 cursor-not-allowed'
                  : 'bg-white border-gray-100 hover:border-green-200 hover:bg-green-50'}`}
            >
              <span className="font-medium">{p.nombre}</span>
              <span className="text-xs text-gray-400">Stock: {p.stock}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setCreandoNuevo(!creandoNuevo)}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium text-left"
        >
          + Crear nuevo producto
        </button>
      </div>

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
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setCreandoNuevo(false)}>Cancelar</Button>
            <Button size="sm" className="flex-1" loading={mutCrear.isPending} onClick={() => mutCrear.mutate()}>Crear y agregar</Button>
          </div>
        </div>
      )}

      {productosSeleccionados.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-gray-700">Cantidades y precios</p>
          {productosSeleccionados.map((p) => (
            <div key={p.id} className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">{p.nombre}</p>
                <button
                  onClick={() => setProductosSeleccionados((prev) => prev.filter((s) => s.id !== p.id))}
                  className="p-1 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
                  <input
                    type="number"
                    value={p.cantidad_comprada}
                    onChange={(e) => actualizarCampo(p.id, 'cantidad_comprada', Number(e.target.value))}
                    onWheel={noWheel}
                    className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                      focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {usandoConversion && (
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">Precio USD</label>
                    <input
                      type="number"
                      value={p.precio_usd}
                      onChange={(e) => actualizarPrecioUsd(p.id, e.target.value)}
                      onWheel={noWheel}
                      className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                        focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">
                    {usandoConversion ? 'Precio COP' : 'Precio compra'}
                  </label>
                  <input
                    type="number"
                    value={p.precio_compra}
                    onChange={(e) => actualizarCampo(p.id, 'precio_compra', Number(e.target.value))}
                    onWheel={noWheel}
                    className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                      focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          ))}
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
        const imeisValidos = l.imeis.filter((i) => i.trim()).length;
        return s + (Number(l.precio_compra) * imeisValidos);
      }, 0);
    }
    return productos.reduce((s, p) => s + (Number(p.precio_compra) * p.cantidad_comprada), 0);
  });
  const [agregarComoAcreedor, setAgregarComoAcreedor] = useState(false);
  const [numeroFactura,       setNumeroFactura]        = useState('');
  const [notas,               setNotas]                = useState('');
  const [error,               setError]                = useState('');

  const { data: acreedoresData } = useQuery({
    queryKey: ['acreedores'],
    queryFn: () => getAcreedores('').then((r) => r.data.data),
  });

  const proveedorYaEsAcreedor = (acreedoresData || []).some(
    (a) => a.nombre.toLowerCase() === proveedor.nombre.toLowerCase()
  );

  const handleConfirmar = () => {
    setError('');
    const pagosFinales = pagos.length === 1
      ? [{ ...pagos[0], valor: totalCompra }]
      : pagos;

    if (pagos.length > 1) {
      const pagado = pagosFinales.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      if (pagado !== Number(totalCompra)) {
        return setError(
          `El total asignado (${formatCOP(pagado)}) no coincide con el total (${formatCOP(totalCompra)})`
        );
      }
    }

    onConfirmar({ pagos: pagosFinales, totalCompra: Number(totalCompra), agregarComoAcreedor, numeroFactura, notas });
  };

  const resumen = tipo === 'serial'
    ? productos.map((l) => ({
        nombre:          l.nombre,
        cantidad:        l.imeis.filter((i) => i.trim()).length,
        precio_unitario: Number(l.precio_compra),
        precio_usd:      l.precio_usd || null,
      }))
    : productos.map((p) => ({
        nombre:          p.nombre,
        cantidad:        p.cantidad_comprada,
        precio_unitario: Number(p.precio_compra),
        precio_usd:      p.precio_usd || null,
      }));

  const pagadoParcial = pagos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const diferencia    = Number(totalCompra) - pagadoParcial;

  return (
    <div className="flex flex-col gap-4">
      {/* Resumen */}
      <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
        <p className="text-xs font-medium text-gray-500 mb-1">Resumen de compra</p>
        {resumen.map((r, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-gray-700">
              {r.nombre} x{r.cantidad}
              {r.precio_usd && (
                <span className="text-xs text-gray-400 ml-1">(${r.precio_usd} USD)</span>
              )}
            </span>
            <span className="font-medium">{formatCOP(r.precio_unitario * r.cantidad)}</span>
          </div>
        ))}
        <div className="border-t border-gray-200 mt-1 pt-1.5 flex justify-between">
          <span className="text-sm font-semibold">Total estimado</span>
          <span className="text-sm font-bold text-gray-900">
            {formatCOP(resumen.reduce((s, r) => s + r.precio_unitario * r.cantidad, 0))}
          </span>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Total de la compra</label>
        <input
          type="number"
          value={totalCompra}
          onChange={(e) => setTotalCompra(e.target.value)}
          onWheel={noWheel}
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
            const seleccionado = pagos.find((p) => p.metodo === m);
            return (
              <button
                key={m}
                onClick={() => {
                  if (seleccionado) {
                    setPagos((prev) => prev.filter((p) => p.metodo !== m));
                  } else {
                    setPagos((prev) => [...prev, { metodo: m, valor: '' }]);
                    if (m === 'Credito' || m === 'Fiado') setAgregarComoAcreedor(true);
                  }
                }}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-all
                  ${seleccionado
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600'}`}
              >
                {m}
              </button>
            );
          })}
        </div>

        {pagos.length > 1 && (
          <div className="mt-3 flex flex-col gap-2">
            {pagos.map((p) => (
              <div key={p.metodo} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-28 flex-shrink-0">{p.metodo}:</span>
                <input
                  type="number"
                  value={p.valor}
                  onChange={(e) => setPagos((prev) =>
                    prev.map((x) => x.metodo === p.metodo ? { ...x, valor: e.target.value } : x)
                  )}
                  onWheel={noWheel}
                  placeholder="0"
                  className="flex-1 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
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

      <div className={`rounded-xl p-3 border transition-all
        ${agregarComoAcreedor ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={agregarComoAcreedor}
            onChange={(e) => setAgregarComoAcreedor(e.target.checked)}
            className="rounded"
          />
          <div>
            <p className="text-sm font-medium text-gray-700">
              {proveedorYaEsAcreedor
                ? `Registrar cargo a ${proveedor.nombre}`
                : `Agregar ${proveedor.nombre} como acreedor`}
            </p>
            <p className="text-xs text-gray-400">
              {proveedorYaEsAcreedor
                ? 'Se registrará el monto pendiente en su cuenta'
                : 'Se creará un acreedor con el monto pendiente de esta compra'}
            </p>
          </div>
        </label>
      </div>

      <Input
        label="Notas (opcional)"
        placeholder="Observaciones de la compra"
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
      />

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onVolver}>← Volver</Button>
        <Button className="flex-1" loading={loading} onClick={handleConfirmar}>
          Confirmar Compra
        </Button>
      </div>
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────
export function ModalCompra({ proveedor, onClose }) {
  const queryClient = useQueryClient();
  const [paso,      setPaso]      = useState(1);
  const [tipo,      setTipo]      = useState(null);
  // Estado persistente entre pasos para no perder lo ingresado
  const [productos,      setProductos]      = useState([]);
  const [factorGuardado, setFactorGuardado] = useState('');
  const [traidaGuardada, setTraidaGuardada] = useState('');

  const mutCompra = useMutation({
    mutationFn: (payload) => crearCompra(payload),
    onSuccess: () => {
      queryClient.invalidateQueries(['productos-serial']);
      queryClient.invalidateQueries(['productos-cantidad']);
      queryClient.invalidateQueries(['compras']);
      queryClient.invalidateQueries(['acreedores']);
      onClose();
    },
  });

  const handleTipo = (t) => {
    setTipo(t);
    setPaso(2);
  };

  // Al volver del paso 2 al paso 1 se conserva el tipo para poder regresar sin perder nada
  const handleVolverA1 = () => setPaso(1);
  const handleVolverA2 = () => setPaso(2);

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
            .filter((i) => i.trim())
            .map((imei) => ({
              nombre_producto:   linea.nombre,
              imei,
              cantidad:          1,
              precio_unitario:   Number(linea.precio_compra),
              precio_usd:        linea.precio_usd ? Number(linea.precio_usd) : null,
              factor_conversion: linea.factor_conversion || null,
              valor_traida:      linea.valor_traida      || null,
              producto_id:       linea.id,
            }))
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

  return (
    <Modal open onClose={onClose} title={`Compra a ${proveedor.nombre}`} size="lg">
      {/* Indicador de pasos — clic en paso anterior para navegar */}
      <div className="flex items-center gap-2 mb-5">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex items-center gap-2 flex-1">
            <button
              onClick={() => {
                if (n < paso) {
                  if (n === 1) handleVolverA1();
                  if (n === 2) handleVolverA2();
                }
              }}
              disabled={n >= paso}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                flex-shrink-0 transition-all
                ${paso > n
                  ? 'bg-blue-100 text-blue-600 hover:bg-blue-200 cursor-pointer'
                  : paso === n
                    ? 'bg-blue-600 text-white cursor-default'
                    : 'bg-gray-100 text-gray-400 cursor-default'}`}
            >
              {n}
            </button>
            <span className={`text-xs hidden sm:block ${paso >= n ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
              {titulos[n - 1]}
            </span>
            {n < 3 && <div className={`flex-1 h-px ${paso > n ? 'bg-blue-300' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {paso === 1 && <PasoTipo onSelect={handleTipo} />}

      {paso === 2 && tipo === 'serial' && (
        <PasoLineaSerial
          proveedorId={proveedor.id}
          lineasIniciales={productos}
          factorInicial={factorGuardado}
          traidaInicial={traidaGuardada}
          onLineasListas={handleProductosListos}
          onVolver={handleVolverA1}
        />
      )}
      {paso === 2 && tipo === 'cantidad' && (
        <PasoCantidad
          proveedorId={proveedor.id}
          productosIniciales={productos}
          factorInicial={factorGuardado}
          traidaInicial={traidaGuardada}
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
  );
}