import { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Modal }        from '../../components/ui/Modal';
import { Button }       from '../../components/ui/Button';
import { Input }        from '../../components/ui/Input';
import { Badge }        from '../../components/ui/Badge';
import { SearchInput }  from '../../components/ui/SearchInput';
import { InputMoneda }  from '../../components/ui/InputMoneda';
import { CambioDivisa } from '../../components/ui/CambioDivisa';
import { cambioInicial, cambioCompleto } from '../../utils/cambioDivisa';
import { formatCOP }    from '../../utils/formatters';
import { crearCompra }  from '../../api/compras.api';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import {
  getProductosSerial, crearProductoSerial,
  getProductosCantidad, crearProductoCantidad,
  verificarImei as verificarImeiApi,
} from '../../api/productos.api';
import { getAcreedores } from '../../api/acreedores.api';
import { getLineas }     from '../../api/lineas.api';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import api from '../../api/axios.config';
import { getArbol } from '../../api/variantesProductoApi';
import {
  Trash2, Package, ShoppingBag, ChevronRight, ChevronDown,
  RefreshCw, AlertTriangle, X, ChevronLeft, Layers, LayoutGrid,
} from 'lucide-react';
import { CuadriculaImei } from './CuadriculaImei';

// ─── Utilidad: normalizar respuesta de productos a array ─────────────────────
function normalizarProductos(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

// ─── Helper: parsear lista de colores desde config ────────────────────────────
function parsearColoresConfig(configData) {
  try {
    const lista = JSON.parse(configData?.colores_serial_lista || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function parsearCaracteristicasConfig(configData) {
  try {
    const lista = JSON.parse(configData?.caracteristicas_serial_lista || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

// ─── Helper: extraer string de imei desde item (string o { imei, color }) ────
function extraerImei(item) {
  if (typeof item === 'string') return item;
  return item.imei || '';
}

// ─── Helper: extraer color desde item ────────────────────────────────────────
function extraerColor(item) {
  if (typeof item === 'string') return null;
  return item.color?.trim() || null;
}

function extraerCaracteristicas(item) {
  if (typeof item === 'string') return {};
  return (item.caracteristicas && typeof item.caracteristicas === 'object')
    ? item.caracteristicas
    : {};
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
    prestados:     encontrados.filter((s) => s.prestado),
    paraReactivar: encontrados.filter((s) => s.vendido  && !s.prestado),
  };
}

// ─── Hook: verificación de IMEIs con estado de modales ───────────────────────
function useVerificacionImeis() {
  const [verificando,         setVerificando]          = useState(false);
  const [modalReactivar,      setModalReactivar]       = useState(false);
  const [modalYaEnInventario, setModalYaEnInventario]  = useState(false);
  const [modalPrestados,      setModalPrestados]       = useState(false);
  const [serialesReactivar,   setSerializesReactivar]  = useState([]);
  const [serialesDisponibles, setSerializesDisponibles] = useState([]);
  const [serialesPrestados,   setSerialesPrestados]    = useState([]);

  const reactivarMapRef    = useRef({});
  const pendingCallbackRef = useRef(null);

  const verificarYProceder = useCallback(async (imeis, onProceder) => {
    reactivarMapRef.current = {};
    setVerificando(true);
    const { disponibles, paraReactivar, prestados } = await verificarImeisDuplicados(imeis);
    setVerificando(false);

    // Prestados bloquean la compra: deben devolverse desde Préstamos
    if (prestados.length > 0) {
      setSerialesPrestados(prestados);
      setModalPrestados(true);
      return;
    }
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

  const handleCerrarPrestados = useCallback(() => {
    setModalPrestados(false);
    setSerialesPrestados([]);
  }, []);

  return {
    verificando, verificarYProceder,
    modalReactivar, serialesReactivar, handleConfirmarReactivar, handleCancelarReactivar,
    modalYaEnInventario, serialesDisponibles, handleCerrarDisponibles,
    modalPrestados, serialesPrestados, handleCerrarPrestados,
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
          <p className="text-sm text-gray-500 mt-1">{seriales.length === 1 ? 'Este equipo fue vendido — puedes reactivarlo con esta compra' : 'Estos equipos fueron vendidos — puedes reactivarlos con esta compra'}</p>
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

// ─── Modal: IMEIs prestados (bloqueante) ──────────────────────────────────────
function ModalImeisPrestados({ open, seriales, onCerrar }) {
  if (!seriales || seriales.length === 0) return null;
  return (
    <Modal open={open} onClose={onCerrar} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="w-14 h-14 rounded-full bg-red-50 border-2 border-red-200 flex items-center justify-center"><AlertTriangle size={26} className="text-red-500" /></div>
        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-900">{seriales.length === 1 ? 'IMEI prestado' : `${seriales.length} IMEIs prestados`}</h3>
          <p className="text-sm text-gray-500 mt-1">{seriales.length === 1 ? 'Este equipo está en un préstamo activo' : 'Estos equipos están en préstamos activos'}</p>
        </div>
        <FilasSerial seriales={seriales} />
        <p className="text-sm text-center text-gray-700 leading-relaxed">
          No se {seriales.length === 1 ? 'puede reactivar' : 'pueden reactivar'} desde una compra. Ve a la pestaña de <span className="font-semibold text-purple-700">Préstamos</span> y {seriales.length === 1 ? 'regístralo como devuelto' : 'regístralos como devueltos'} para que {seriales.length === 1 ? 'regrese' : 'regresen'} al inventario.
        </p>
        <Button className="w-full" onClick={onCerrar}>Entendido</Button>
      </div>
    </Modal>
  );
}

// ─── Panel de factor de conversión ───────────────────────────────────────────
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
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">TRM / Factor</label>
          <input type="number" value={factor}
            onChange={(e) => onChange('factor', e.target.value)}
            onWheel={noWheel} placeholder="4200"
            className="w-full px-2.5 py-1.5 bg-white border border-blue-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Valor traída (COP)</label>
          <InputMoneda value={traida} onChange={(val) => onChange('traida', val)} placeholder="0"
            className="w-full px-2.5 py-1.5 bg-white border border-blue-200 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
      </div>
      {Number(factor) > 0 && (
        <button onClick={onAplicarATodos}
          className="flex items-center gap-1.5 text-xs text-blue-600 font-medium
            hover:text-blue-800 transition-colors w-fit">
          <RefreshCw size={11} />
          Recalcular todos los precios
        </button>
      )}
      <p className="text-xs text-gray-400">Fórmula: precio COP = (precio USD × factor) + traída</p>
    </div>
  );
}

// ─── Multi-selector de variantes para compras ─────────────────────────────────
function MultiSelectorCompra({ hojas, nodosData, onActualizar }) {
  const [seleccionadas, setSeleccionadas] = useState(
    () => new Set(hojas.filter((h) => Number(nodosData[h.key]?.cantidad) > 0).map((h) => h.key))
  );

  const base = (h) => ({
    label: h.label, labelPadre: h.labelPadre, tipo: h.tipo, id: h.id,
    cantidad: '', costo: '',
    ...(nodosData[h.key] || {}),
  });

  const toggle = (h) => {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(h.key)) {
        next.delete(h.key);
        onActualizar(h.key, { ...base(h), cantidad: '', costo: '' });
      } else {
        next.add(h.key);
      }
      return next;
    });
  };

  const hojasSel    = hojas.filter((h) => seleccionadas.has(h.key));
  const nodosActivos = hojasSel.filter((h) => Number(nodosData[h.key]?.cantidad) > 0);
  const totalUds    = nodosActivos.reduce((s, h) => s + Number(nodosData[h.key]?.cantidad || 0), 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Chips de selección */}
      <div className="flex flex-wrap gap-1.5">
        {hojas.map((h) => {
          const activa = seleccionadas.has(h.key);
          const chipLabel = h.labelPadre ? `${h.labelPadre} / ${h.label}` : h.label;
          return (
            <button key={h.key} type="button" onClick={() => toggle(h)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium border transition-all
                ${activa
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-blue-200 hover:bg-blue-50/50'}`}>
              {chipLabel}
              {activa && <X size={9} />}
            </button>
          );
        })}
      </div>

      {/* Inputs solo para las seleccionadas */}
      {hojasSel.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <p className="flex-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">Variante</p>
            <p className="w-14 text-[11px] font-medium text-gray-400 text-center">Cant.</p>
            <p className="w-24 text-[11px] font-medium text-gray-400 text-center">Precio unit.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            {hojasSel.map((h) => {
              const data = base(h);
              return (
                <div key={h.key}
                  className="flex items-center gap-2 p-2 rounded-xl border border-blue-200 bg-blue-50/50">
                  <div className="flex-1 min-w-0">
                    {h.labelPadre && <p className="text-[10px] text-gray-400 leading-none mb-0.5">{h.labelPadre}</p>}
                    <p className="text-xs font-medium text-gray-800 leading-tight">{h.label}</p>
                    <p className="text-[10px] text-gray-400">{h.stock} en stock</p>
                  </div>
                  <input type="number" min="0" value={data.cantidad}
                    onChange={(e) => onActualizar(h.key, { ...base(h), cantidad: e.target.value })}
                    onWheel={noWheel} placeholder="0"
                    className="w-14 px-2 py-1.5 text-xs text-center bg-white border border-gray-200
                      rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400" />
                  <InputMoneda value={data.costo}
                    onChange={(val) => onActualizar(h.key, { ...base(h), costo: val })}
                    placeholder="$0"
                    className="w-24 px-2 py-1.5 text-xs bg-white border border-gray-200 rounded-lg
                      focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {nodosActivos.length > 0 && (
        <p className="text-xs text-blue-600 font-medium px-1">
          {nodosActivos.length} variante(s) — {totalUds} unidades totales
        </p>
      )}
    </div>
  );
}

// ─── Selector de variante/atributo (árbol navegable) ─────────────────────────
function MiniSelectorVariante({ arbolData, nodoSel, onSeleccionar }) {
  const [nivel,          setNivel]          = useState('atributos');
  const [atributoActivo, setAtributoActivo] = useState(null);

  const labelNodo = (n) => n.tipo_nombre ? `${n.tipo_nombre}: ${n.valor}` : n.valor;

  if (nodoSel) {
    return (
      <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
        <div className="flex items-center gap-2">
          <Layers size={13} className="text-blue-500" />
          <p className="text-sm font-semibold text-blue-800">{nodoSel.label}</p>
        </div>
        <button
          onClick={() => { onSeleccionar(null); setNivel('atributos'); setAtributoActivo(null); }}
          className="text-xs text-blue-400 hover:text-blue-600 underline"
        >
          Cambiar
        </button>
      </div>
    );
  }

  if (nivel === 'variantes' && atributoActivo) {
    return (
      <div className="flex flex-col gap-2">
        <button
          onClick={() => { setNivel('atributos'); setAtributoActivo(null); }}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors w-fit"
        >
          <ChevronLeft size={13} />
          {labelNodo(atributoActivo)}
        </button>
        <div className="grid grid-cols-2 gap-2">
          {(atributoActivo.variantes || []).map((v) => (
            <button
              key={v.id}
              onClick={() => onSeleccionar({
                id: v.id, tipo: 'variante',
                valor: v.valor, tipo_nombre: v.tipo_nombre,
                atributoId: atributoActivo.id,
                label: labelNodo(v),
              })}
              className="flex items-center justify-between p-2.5 rounded-xl border border-gray-200
                bg-white hover:border-blue-300 hover:bg-blue-50 transition-all text-left"
            >
              <span className="text-xs font-medium text-gray-800 leading-snug">{labelNodo(v)}</span>
              <span className="text-xs text-gray-400 ml-1 tabular-nums flex-shrink-0">{v.stock} uds</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {arbolData.map((a) => {
        const tieneHijos = Array.isArray(a.variantes) && a.variantes.length > 0;
        return (
          <button
            key={a.id}
            onClick={() => {
              if (tieneHijos) { setAtributoActivo(a); setNivel('variantes'); }
              else onSeleccionar({ id: a.id, tipo: 'atributo', valor: a.valor, tipo_nombre: a.tipo_nombre, label: labelNodo(a) });
            }}
            className="flex items-center justify-between p-2.5 rounded-xl border border-gray-200
              bg-white hover:border-blue-300 hover:bg-blue-50 transition-all text-left"
          >
            <span className="text-xs font-medium text-gray-800 leading-snug">{labelNodo(a)}</span>
            <span className="text-xs text-gray-400 ml-1 flex items-center gap-0.5 flex-shrink-0">
              {tieneHijos
                ? <ChevronRight size={11} className="text-blue-400" />
                : <span className="tabular-nums">{a.stock} uds</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Fila de producto por cantidad con selector de variante ───────────────────
function FilaProductoCantidad({
  productoSel, variantesActivo, usandoConversion,
  onCantidadChange, onPrecioUsdChange, onPrecioChange, onNodosDataChange, onEliminar,
}) {
  const sucursalId = productoSel.sucursal_id || null;
  const { data: arbolData = [], isLoading: arbolLoading } = useQuery({
    queryKey: ['arbol-producto', productoSel.id, sucursalId],
    queryFn:  () => getArbol(productoSel.id, sucursalId).then((r) => r.data.data),
    enabled:  !!productoSel.id && !!sucursalId && variantesActivo,
    staleTime: 0,
  });
  const tieneArbol = variantesActivo && arbolData.length > 0;

  const labelNodo = (n) => n.tipo_nombre ? `${n.tipo_nombre}: ${n.valor}` : n.valor;
  const hojas = tieneArbol ? arbolData.flatMap((atr) => {
    if (atr.variantes?.length > 0) {
      return atr.variantes.map((v) => ({
        key: `v-${v.id}`, id: v.id, tipo: 'variante',
        labelPadre: labelNodo(atr), label: labelNodo(v), stock: v.stock,
      }));
    }
    return [{ key: `a-${atr.id}`, id: atr.id, tipo: 'atributo', label: labelNodo(atr), stock: atr.stock }];
  }) : [];

  return (
    <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">{productoSel.nombre}</p>
        <button onClick={onEliminar} className="p-1 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </div>

      {tieneArbol ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
            <Layers size={11} /> Cantidad y precio por variante
          </label>
          <MultiSelectorCompra
            hojas={hojas}
            nodosData={productoSel.nodosData || {}}
            onActualizar={(key, fullData) => onNodosDataChange(key, fullData)}
          />
        </div>
      ) : (
        <>
          {variantesActivo && !arbolLoading && (
            <p className="text-xs text-gray-400 italic">Sin variantes — se suma al stock general</p>
          )}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Cantidad</label>
              <input type="number" value={productoSel.cantidad_comprada}
                onChange={(e) => onCantidadChange(Number(e.target.value))}
                onWheel={noWheel}
                className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {usandoConversion && (
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Precio USD</label>
                <input type="number" value={productoSel.precio_usd}
                  onChange={(e) => onPrecioUsdChange(e.target.value)}
                  onWheel={noWheel}
                  className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            )}
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">
                {usandoConversion ? 'Precio COP' : 'Precio compra'}
              </label>
              <InputMoneda value={productoSel.precio_compra}
                onChange={onPrecioChange} placeholder="0"
                className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </>
      )}
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

// ─── Select de filtro por línea (para buscadores) ────────────────────────────
function SelectFiltroLinea({ value, onChange }) {
  const lineas = useLineas();
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500 font-medium">Filtrar por línea</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded-xl text-xs
          text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400">
        <option value="">Todas las líneas</option>
        {lineas.map((l) => (
          <option key={l.id} value={l.id}>{l.nombre}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Fila de IMEI con color + características expandibles ────────────────────
function FilaImeiCompra({
  index, item, coloresActivo, coloresConfig,
  caracteristicasActivo, caracteristicasLista,
  esDuplicado, inputRef, onChange, onKeyDown, onEliminar, mostrarEliminar,
}) {
  const [expandido, setExpandido] = useState(false);

  const imeiValor      = extraerImei(item);
  const colorValor     = extraerColor(item) || '';
  const caracteristicas = extraerCaracteristicas(item);

  const usaObjeto = coloresActivo || (caracteristicasActivo && caracteristicasLista?.length > 0);

  const handleImeiChange = (valor) => {
    if (!usaObjeto) { onChange(valor); return; }
    onChange({ imei: valor, color: colorValor, caracteristicas });
  };

  const handleColorChange = (valor) => {
    onChange({ imei: imeiValor, color: valor, caracteristicas });
  };

  const handleCaracteristicaChange = (nombre, valor) => {
    onChange({ imei: imeiValor, color: colorValor, caracteristicas: { ...caracteristicas, [nombre]: valor } });
  };

  const tieneCaracteristicas = caracteristicasActivo && caracteristicasLista?.length > 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5 items-center">
        <input
          ref={inputRef}
          type="text"
          value={imeiValor}
          onChange={(e) => handleImeiChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`IMEI ${index + 1}`}
          className={`flex-1 px-2 py-1.5 border rounded-lg text-sm font-mono
            focus:outline-none focus:ring-2
            ${esDuplicado
              ? 'bg-red-50 border-red-400 text-red-700 focus:ring-red-400'
              : 'bg-white border-gray-200 focus:ring-blue-500'}`}
        />
        {coloresActivo && coloresConfig.length > 0 && (
          <select value={colorValor} onChange={(e) => handleColorChange(e.target.value)}
            className="w-24 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 flex-shrink-0">
            <option value="">Color...</option>
            {coloresConfig.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {tieneCaracteristicas && (
          <button type="button" onClick={() => setExpandido((v) => !v)}
            className={`p-2 rounded-lg border transition-colors flex-shrink-0
              ${expandido ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600'}`}>
            <ChevronDown size={13} className={`transition-transform ${expandido ? 'rotate-180' : ''}`} />
          </button>
        )}
        {mostrarEliminar && (
          <button onClick={onEliminar}
            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 flex-shrink-0">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {expandido && tieneCaracteristicas && (
        <div className="flex flex-col gap-1.5 pl-3 border-l-2 border-blue-100 ml-1">
          {caracteristicasLista.map((nombre) => (
            <div key={nombre} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 flex-shrink-0 truncate">{nombre}</span>
              <input type="text" value={caracteristicas[nombre] || ''}
                onChange={(e) => handleCaracteristicaChange(nombre, e.target.value)}
                placeholder={`${nombre}...`}
                className="flex-1 px-2 py-1.5 bg-white border border-gray-200 rounded-lg
                  text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Resumen compacto de IMEIs guardados con cuadrícula ──────────────────────
function ResumenImeis({ imeis, caracteristicasActivo, caracteristicasLista, onEditar }) {
  const [pagina, setPagina] = useState(0);
  const POR_PAGINA = 10;
  const validos = imeis.filter((i) => extraerImei(i).trim());
  const totalPaginas = Math.ceil(validos.length / POR_PAGINA);
  const visibles = validos.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700">
          {validos.length} serial(es) registrado(s)
        </p>
        <button
          type="button"
          onClick={onEditar}
          className="text-xs text-blue-600 hover:text-blue-800 font-medium underline"
        >
          Editar en cuadrícula
        </button>
      </div>
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-gray-500">IMEI</th>
              {caracteristicasActivo && (caracteristicasLista || []).map((n) => (
                <th key={n} className="px-2 py-1.5 text-left font-medium text-gray-500">{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((item, i) => {
              const imeiStr = extraerImei(item);
              const carac   = extraerCaracteristicas(item);
              return (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-2 py-1 font-mono text-gray-700 truncate max-w-[160px]">{imeiStr}</td>
                  {caracteristicasActivo && (caracteristicasLista || []).map((n) => (
                    <td key={n} className="px-2 py-1 text-gray-600">{carac[n] || '—'}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            disabled={pagina === 0}
            onClick={() => setPagina((p) => p - 1)}
            className="text-xs text-blue-500 disabled:text-gray-300 font-medium"
          >
            ← Anterior
          </button>
          <span className="text-xs text-gray-400">{pagina + 1} / {totalPaginas}</span>
          <button
            type="button"
            disabled={pagina >= totalPaginas - 1}
            onClick={() => setPagina((p) => p + 1)}
            className="text-xs text-blue-500 disabled:text-gray-300 font-medium"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Componente línea con IMEIs ───────────────────────────────────────────────
function LineaImeis({
  linea, factor, traida, imeisDuplicados,
  onActualizarPrecioUsd, onActualizarPrecioCOP,
  onActualizarImei, onAgregarCampo, onEliminarImei, onEliminarLinea,
  coloresActivo, coloresConfig, caracteristicasActivo, caracteristicasLista,
  guardadaConCuadricula, onAbrirCuadricula, onEditarCuadricula,
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

  const handleItemChange = (index, nuevoValor) => {
    onActualizarImei(linea.id, index, nuevoValor);
  };

  const imeisValidos = linea.imeis.filter((i) => extraerImei(i).trim()).length;

  return (
    <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">{linea.nombre}</p>
          {linea.linea_nombre && (
            <span className="text-xs text-blue-500 font-medium">{linea.linea_nombre}</span>
          )}
          <Badge variant="blue">{imeisValidos} IMEI(s)</Badge>
        </div>
        <button onClick={() => onEliminarLinea(linea.id)}
          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex gap-2">
        {usandoConversion && (
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">Precio USD</label>
            <input type="number" value={linea.precio_usd || ''}
              onChange={(e) => handlePrecioUsdChange(e.target.value)}
              onWheel={noWheel}
              className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0" />
          </div>
        )}
        <div className="flex-1">
          <label className="text-xs text-gray-400 mb-1 block">
            {usandoConversion ? 'Precio COP (calculado)' : 'Precio compra (COP)'}
          </label>
          <InputMoneda value={linea.precio_compra}
            onChange={(val) => onActualizarPrecioCOP(linea.id, val)} placeholder="0"
            className="w-full px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={onAbrirCuadricula}
          className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800
            font-medium border border-purple-200 bg-purple-50 hover:bg-purple-100
            px-3 py-1.5 rounded-lg transition-colors self-start"
        >
          <LayoutGrid size={12} /> Ingresar en cuadrícula
        </button>

        {guardadaConCuadricula ? (
          <ResumenImeis
            imeis={linea.imeis}
            caracteristicasActivo={caracteristicasActivo}
            caracteristicasLista={caracteristicasLista}
            onEditar={onEditarCuadricula}
          />
        ) : (
          <>
            {linea.imeis.map((item, index) => {
              const imeiVal     = extraerImei(item);
              const esDuplicado = imeiVal.trim() && imeisDuplicados.has(imeiVal.trim());
              return (
                <FilaImeiCompra
                  key={index}
                  index={index}
                  item={item}
                  coloresActivo={coloresActivo}
                  coloresConfig={coloresConfig}
                  caracteristicasActivo={caracteristicasActivo}
                  caracteristicasLista={caracteristicasLista}
                  esDuplicado={esDuplicado}
                  inputRef={(el) => { inputRefs.current[index] = el; }}
                  onChange={(val) => handleItemChange(index, val)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  onEliminar={() => onEliminarImei(linea.id, index)}
                  mostrarEliminar={linea.imeis.length > 1}
                />
              );
            })}
            {linea.imeis.some((i) => extraerImei(i).trim() && imeisDuplicados.has(extraerImei(i).trim())) && (
              <p className="text-xs text-red-500 font-medium">⚠ Algunos IMEIs están duplicados (marcados en rojo)</p>
            )}
            <button onClick={() => onAgregarCampo(linea.id)}
              className="text-xs text-blue-500 hover:text-blue-700 font-medium text-left mt-1">
              + Agregar IMEI
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Paso 2 Serial ────────────────────────────────────────────────────────────
function PasoLineaSerial({
  proveedorId, lineasIniciales, factorInicial, traidaInicial,
  verificando, sucursalKey, sucursalLista, onContinuar, onVolver,
  coloresActivo, coloresConfig, caracteristicasActivo, caracteristicasLista,
}) {
  const [busqueda,            setBusqueda]           = useState('');
  const [filtroLineaId,       setFiltroLineaId]      = useState('');
  const [creandoNueva,        setCreandoNueva]        = useState(false);
  const [nuevaLinea,          setNuevaLinea]          = useState({ nombre: '', marca: '', modelo: '', precio: '', linea_id: '' });
  const [lineasSeleccionadas, setLineasSeleccionadas] = useState(lineasIniciales);
  const [error,               setError]              = useState('');
  const [imeisDuplicados,     setImeisDuplicados]    = useState(new Set());
  const [factor,              setFactor]             = useState(factorInicial);
  const [traida,              setTraida]             = useState(traidaInicial);
  const [gridGuardado,        setGridGuardado]       = useState({});
  const [cuadriculaAbierta,   setCuadriculaAbierta]  = useState(null);
  const queryClient = useQueryClient();

  const itemVacio = () =>
    (coloresActivo || (caracteristicasActivo && caracteristicasLista?.length > 0))
      ? { imei: '', color: '', caracteristicas: {} }
      : '';

  const { data: productosData } = useQuery({
    queryKey: ['productos-serial', ...sucursalKey],
    queryFn:  () => getProductosSerial().then((r) => normalizarProductos(r.data.data)),
    enabled:  sucursalLista,
  });

  const productos = normalizarProductos(productosData)
    .filter((p) => p.nombre.toLowerCase().includes(busqueda.toLowerCase()))
    .filter((p) => !filtroLineaId || String(p.linea_id) === filtroLineaId);

  const mutCrearLinea = useMutation({
    mutationFn: () => crearProductoSerial({
      nombre:       nuevaLinea.nombre,
      marca:        nuevaLinea.marca,
      modelo:       nuevaLinea.modelo,
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
      imeis:         [itemVacio()],
      precio_usd:    '',
      precio_compra: Number(producto.precio) || 0,
    }]);
  };

  const eliminarLinea        = (id) => setLineasSeleccionadas((prev) => prev.filter((l) => l.id !== id));
  const actualizarPrecioUsd  = (id, valor) => setLineasSeleccionadas((prev) => prev.map((l) => l.id === id ? { ...l, precio_usd: valor } : l));
  const actualizarPrecioCOP  = (id, valor) => setLineasSeleccionadas((prev) => prev.map((l) => l.id === id ? { ...l, precio_compra: valor } : l));

  const actualizarImei = (lineaId, index, valor) =>
    setLineasSeleccionadas((prev) => prev.map((l) => {
      if (l.id !== lineaId) return l;
      const imeis = [...l.imeis];
      imeis[index] = valor;
      return { ...l, imeis };
    }));

  const agregarCampoImei = (lineaId) =>
    setLineasSeleccionadas((prev) => prev.map((l) =>
      l.id === lineaId ? { ...l, imeis: [...l.imeis, itemVacio()] } : l
    ));

  const eliminarImei = (lineaId, index) =>
    setLineasSeleccionadas((prev) => prev.map((l) => {
      if (l.id !== lineaId) return l;
      const imeis = l.imeis.filter((_, i) => i !== index);
      return { ...l, imeis: imeis.length === 0 ? [itemVacio()] : imeis };
    }));

  const handleAplicarATodos = useCallback(() => {
    setLineasSeleccionadas((prev) =>
      prev.map((l) => {
        if (!l.precio_usd) return l;
        return { ...l, precio_compra: calcularPrecioCOP(l.precio_usd, factor, traida) };
      })
    );
  }, [factor, traida]);

  const handleGuardarCuadricula = (lineaId, rows, costoGrupal) => {
    const usaObjeto = coloresActivo || (caracteristicasActivo && caracteristicasLista?.length > 0);
    const itemsImei = rows.map((r) =>
      usaObjeto
        ? {
            imei: r.imei,
            color: r.color || '',
            caracteristicas: r.caracteristicas || {},
            ...(r.costo !== null && r.costo !== '' ? { _costo_individual: Number(r.costo) } : {}),
          }
        : r.imei
    );
    setLineasSeleccionadas((prev) =>
      prev.map((l) => {
        if (l.id !== lineaId) return l;
        return {
          ...l,
          imeis: itemsImei,
          ...(costoGrupal !== null ? { precio_compra: costoGrupal } : {}),
        };
      })
    );
    setGridGuardado((prev) => ({ ...prev, [lineaId]: true }));
    setCuadriculaAbierta(null);
  };

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
      for (const item of linea.imeis) {
        const imei = extraerImei(item).trim();
        if (imei) todosImeis.push(imei);
      }
    }

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
      const imeisValidos = linea.imeis.filter((i) => extraerImei(i).trim());
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
        <SelectFiltroLinea value={filtroLineaId} onChange={setFiltroLineaId} />
        <div className="max-h-36 overflow-y-auto flex flex-col gap-1">
          {productos.map((p) => {
            const productoItem = p;
            const yaAgregado = !!lineasSeleccionadas.find((l) => l.id === productoItem.id);
            return (
              <button key={productoItem.id} onClick={() => agregarLinea(productoItem)}
                disabled={yaAgregado}
                className={`flex items-center justify-between p-2.5 rounded-xl text-left text-sm border transition-all
                  ${yaAgregado
                    ? 'bg-blue-50 border-blue-200 text-blue-600 opacity-60 cursor-not-allowed'
                    : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50'}`}>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{productoItem.nombre}</span>
                  {productoItem.linea_nombre && (
                    <span className="text-xs text-gray-400">{productoItem.linea_nombre}</span>
                  )}
                </div>
                <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
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
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-600 font-medium">Precio de venta</label>
            <InputMoneda id="nueva-precio" value={nuevaLinea.precio}
              onChange={(val) => setNuevaLinea({ ...nuevaLinea, precio: val })} placeholder="0"
              className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-400" />
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
                coloresActivo={coloresActivo}
                coloresConfig={coloresConfig}
                caracteristicasActivo={caracteristicasActivo}
                caracteristicasLista={caracteristicasLista}
                guardadaConCuadricula={!!gridGuardado[lineaItem.id]}
                onAbrirCuadricula={() => setCuadriculaAbierta(lineaItem.id)}
                onEditarCuadricula={() => setCuadriculaAbierta(lineaItem.id)}
              />
            );
          })}
        </div>
      )}

      {cuadriculaAbierta !== null && (() => {
        const la = lineasSeleccionadas.find((l) => l.id === cuadriculaAbierta);
        if (!la) return null;
        const filasIniciales = gridGuardado[cuadriculaAbierta]
          ? la.imeis.map((item) => ({
              imei: extraerImei(item),
              color: extraerColor(item) || '',
              caracteristicas: extraerCaracteristicas(item),
              costo: item._costo_individual || '',
            }))
          : null;
        return (
          <CuadriculaImei
            productoNombre={la.nombre}
            caracteristicasActivo={caracteristicasActivo}
            caracteristicasLista={caracteristicasLista}
            coloresActivo={coloresActivo}
            coloresConfig={coloresConfig}
            precioCopInicial={la.precio_compra}
            filasIniciales={filasIniciales}
            onGuardar={(rows, costoGrupal) => handleGuardarCuadricula(la.id, rows, costoGrupal)}
            onCerrar={() => setCuadriculaAbierta(null)}
          />
        );
      })()}

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
  sucursalKey, sucursalLista, onProductosListos, onVolver, variantesActivo,
}) {
  const [busqueda,               setBusqueda]              = useState('');
  const [filtroLineaId,          setFiltroLineaId]         = useState('');
  const [creandoNuevo,           setCreandoNuevo]          = useState(false);
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

  const productos = normalizarProductos(productosData)
    .filter((p) => p.nombre.toLowerCase().includes(busqueda.toLowerCase()))
    .filter((p) => !filtroLineaId || String(p.linea_id) === filtroLineaId);

  const mutCrear = useMutation({
    mutationFn: () => crearProductoCantidad({
      nombre:         nuevoProducto.nombre,
      unidad_medida:  nuevoProducto.unidad_medida,
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
      precio_compra:     Number(producto.costo_unitario) || 0,
      nodosData:         {},
    }]);
  };

  const actualizarCampo = (id, campo, valor) =>
    setProductosSeleccionados((prev) => prev.map((p) => p.id === id ? { ...p, [campo]: valor } : p));

  const actualizarNodosData = (id, key, fullData) =>
    setProductosSeleccionados((prev) => prev.map((p) =>
      p.id === id ? { ...p, nodosData: { ...p.nodosData, [key]: fullData } } : p
    ));

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
      const nodosActivos = Object.values(p.nodosData || {}).filter((d) => Number(d?.cantidad) > 0);
      if (nodosActivos.length === 0 && (!p.cantidad_comprada || p.cantidad_comprada < 1))
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
        <SelectFiltroLinea value={filtroLineaId} onChange={setFiltroLineaId} />
        <div className="max-h-36 overflow-y-auto flex flex-col gap-1">
          {productos.map((p) => {
            const productoItem = p;
            const yaAgregado = !!productosSeleccionados.find((s) => s.id === productoItem.id);
            return (
              <button key={productoItem.id} onClick={() => agregarProducto(productoItem)}
                disabled={yaAgregado}
                className={`flex items-center justify-between p-2.5 rounded-xl text-left text-sm border transition-all
                  ${yaAgregado
                    ? 'bg-green-50 border-green-200 opacity-60 cursor-not-allowed'
                    : 'bg-white border-gray-100 hover:border-green-200 hover:bg-green-50'}`}>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{productoItem.nombre}</span>
                  {productoItem.linea_nombre && (
                    <span className="text-xs text-gray-400">{productoItem.linea_nombre}</span>
                  )}
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">Stock: {productoItem.stock}</span>
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
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs text-gray-600 font-medium">Precio compra</label>
              <InputMoneda value={nuevoProducto.costo_unitario} onChange={(val) => setNuevoProducto({ ...nuevoProducto, costo_unitario: val })} placeholder="0"
                className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-400" />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs text-gray-600 font-medium">Precio venta</label>
              <InputMoneda value={nuevoProducto.precio} onChange={(val) => setNuevoProducto({ ...nuevoProducto, precio: val })} placeholder="0"
                className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-400" />
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
          {productosSeleccionados.map((p) => (
            <FilaProductoCantidad
              key={p.id}
              productoSel={p}
              variantesActivo={variantesActivo}
              usandoConversion={usandoConversion}
              onCantidadChange={(val) => actualizarCampo(p.id, 'cantidad_comprada', val)}
              onPrecioUsdChange={(val) => actualizarPrecioUsd(p.id, val)}
              onPrecioChange={(val) => actualizarCampo(p.id, 'precio_compra', val)}
              onNodosDataChange={(key, fullData) => actualizarNodosData(p.id, key, fullData)}
              onEliminar={() => setProductosSeleccionados((prev) => prev.filter((s) => s.id !== p.id))}
            />
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
        const imeisValidos = l.imeis.filter((i) => {
          const val = typeof i === 'string' ? i : (i.valor || i.imei || '');
          return val.trim();
        }).length;
        return s + (Number(l.precio_compra) * imeisValidos);
      }, 0);
    }
    return productos.reduce((s, p) => {
      const nodosActivos = Object.values(p.nodosData || {}).filter((d) => Number(d?.cantidad) > 0);
      if (nodosActivos.length > 0) {
        return s + nodosActivos.reduce((ns, d) => ns + Number(d.cantidad || 0) * Number(d.costo || 0), 0);
      }
      return s + (Number(p.precio_compra) * p.cantidad_comprada);
    }, 0);
  });
  const [registrarEnCaja,   setRegistrarEnCaja]   = useState(proveedor.tipo !== 'proveedor');
  const [numeroFactura,     setNumeroFactura]      = useState('');
  const [notas,             setNotas]              = useState('');
  const [error,             setError]              = useState('');
  const metodosPago = useMetodosPago();
  const [metodoPagoDetalle, setMetodoPagoDetalle] = useState('Efectivo');
  // Pago con divisa: dólares + tasa (o dólares + pesos). El panel resuelve el
  // trío { dolares, pesos, tasa }; los pesos son la parte de la deuda que salda.
  const [cambioDivisa, setCambioDivisa] = useState(() => cambioInicial());
  const hayDivisa = pagos.some((p) => p.metodo === 'Divisa');

  const { data: acreedoresRaw } = useQuery({
    queryKey: ['acreedores'],
    queryFn:  () => getAcreedores('').then((r) => r.data.data),
  });
  const acreedoresData    = normalizarProductos(acreedoresRaw);
  const acreedorVinculado = acreedoresData.find((a) => a.proveedor_id === proveedor.id) || null;
  const saldoActual       = acreedorVinculado ? Number(acreedorVinculado.saldo || 0) : 0;

  const handleConfirmar = () => {
    setError('');
    const esMetodoPagoFisico = (metodo) => metodo === 'Contado' || metodo === 'Transferencia';

    if (hayDivisa && !cambioCompleto(cambioDivisa)) {
      return setError('Completa el pago con Divisa: dólares y tasa (o dólares y pesos).');
    }
    // Divisa solo: la parte en pesos del panel es lo que se abona; no puede
    // superar el total de la compra (el resto quedaría como deuda del proveedor).
    if (pagos.length === 1 && hayDivisa && Number(cambioDivisa.pesos) > Number(totalCompra)) {
      return setError(`El pago en dólares (${formatCOP(cambioDivisa.pesos)}) supera el total de la compra (${formatCOP(totalCompra)}).`);
    }

    // El pago con Divisa aporta su parte en pesos (cambioDivisa.pesos), y lleva
    // los dólares entregados + la tasa: el backend descuenta los dólares de la
    // cuenta Divisa de Tesorería y salda esa parte de la deuda en pesos.
    const aplicarDivisa = (p) => (p.metodo === 'Divisa'
      ? { ...p, valor:     Number(cambioDivisa.pesos) || 0,
                valor_usd: Number(cambioDivisa.dolares),
                tasa:      Number(cambioDivisa.tasa) || undefined }
      : p);

    const pagosFinales = (pagos.length === 1
      ? [pagos[0].metodo === 'Divisa'
          ? pagos[0]
          : { ...pagos[0], metodo: esMetodoPagoFisico(pagos[0].metodo) ? metodoPagoDetalle : pagos[0].metodo, valor: totalCompra }]
      : pagos.map((p) => ({
          ...p,
          metodo: esMetodoPagoFisico(p.metodo) ? metodoPagoDetalle : p.metodo,
        }))
    ).map(aplicarDivisa);

    if (pagos.length > 1) {
      const pagado = pagosFinales.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      if (pagado !== Number(totalCompra)) {
        return setError(`El total asignado (${formatCOP(pagado)}) no coincide con el total (${formatCOP(totalCompra)})`);
      }
    }
    onConfirmar({ pagos: pagosFinales, totalCompra: Number(totalCompra), registrarEnCaja, numeroFactura, notas });
  };

   const resumen = tipo === 'serial'
    ? productos.map((l) => ({
        nombre:          l.nombre,
        cantidad:        l.imeis.filter((i) => {
          const val = typeof i === 'string' ? i : (i.valor || i.imei || '');
          return val.trim();
        }).length,
        precio_unitario: Number(l.precio_compra),
        precio_usd:      l.precio_usd || null,
      }))
    : productos.flatMap((p) => {
        const nodosActivos = Object.values(p.nodosData || {}).filter((d) => Number(d?.cantidad) > 0);
        if (nodosActivos.length > 0) {
          return nodosActivos.map((d) => ({
            nombre:          `${p.nombre}${d.labelPadre ? ` — ${d.labelPadre}` : ''}${d.label ? ` / ${d.label}` : ''}`,
            cantidad:        Number(d.cantidad),
            precio_unitario: Number(d.costo || 0),
            precio_usd:      null,
          }));
        }
        return [{
          nombre:          p.nombre,
          cantidad:        p.cantidad_comprada,
          precio_unitario: Number(p.precio_compra),
          precio_usd:      p.precio_usd || null,
        }];
      });

  const pagadoParcial = pagos.reduce((s, p) =>
    s + (p.metodo === 'Divisa' ? (Number(cambioDivisa.pesos) || 0) : (Number(p.valor) || 0)), 0);
  const diferencia    = Number(totalCompra) - pagadoParcial;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
        <p className="text-xs font-medium text-gray-500 mb-1">Resumen de compra</p>
        {resumen.map((r, i) => {
          const resumenItem = r;
          return (
            <div key={i} className="flex justify-between gap-2 text-sm">
              <span className="text-gray-700 flex-1 min-w-0 truncate">
                {resumenItem.nombre} x{resumenItem.cantidad}
                {resumenItem.precio_usd && <span className="text-xs text-gray-400 ml-1">(${resumenItem.precio_usd} USD)</span>}
              </span>
              <span className="font-medium flex-shrink-0">{formatCOP(resumenItem.precio_unitario * resumenItem.cantidad)}</span>
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

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">Total de la compra</label>
        <InputMoneda value={totalCompra} onChange={(val) => setTotalCompra(val)} placeholder="0"
          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
            focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <Input label="N° Factura proveedor (opcional)" placeholder="FAC-001"
        value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} />

      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Método de pago</p>
        <div className="grid grid-cols-2 gap-2">
          {['Contado', 'Transferencia', 'Credito', 'Fiado', 'Divisa'].map((m) => {
            const metodo       = m;
            const seleccionado = pagos.find((p) => p.metodo === metodo);
            return (
              <button key={metodo}
                onClick={() => {
                  if (seleccionado) {
                    setPagos((prev) => prev.filter((p) => p.metodo !== metodo));
                  } else {
                    setPagos((prev) => [...prev, { metodo, valor: '' }]);
                  }
                }}
                className={`py-2.5 rounded-xl text-sm font-medium border transition-all
                  ${seleccionado ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                {metodo === 'Divisa' ? 'Divisa (US$)' : metodo}
              </button>
            );
          })}
        </div>

        {pagos.length > 1 && (
          <div className="mt-3 flex flex-col gap-2">
            {pagos.filter((p) => p.metodo !== 'Divisa').map((p) => {
              const pagoItem = p;
              return (
                <div key={pagoItem.metodo} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-28 flex-shrink-0">{pagoItem.metodo}:</span>
                  <InputMoneda value={pagoItem.valor}
                    onChange={(val) => setPagos((prev) =>
                      prev.map((x) => x.metodo === pagoItem.metodo ? { ...x, valor: val } : x)
                    )} placeholder="0"
                    className="flex-1 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm
                      focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              );
            })}
            {hayDivisa && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-28 flex-shrink-0">Divisa (US$):</span>
                <span className="flex-1 px-2 py-1.5 text-sm text-gray-700 tabular-nums">
                  {cambioDivisa.pesos > 0 ? formatCOP(cambioDivisa.pesos) : '—'}
                  <span className="text-xs text-gray-400"> (se define abajo)</span>
                </span>
              </div>
            )}
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
         {pagos.length === 1 && !hayDivisa && (
          <p className="text-xs text-gray-400 mt-2 px-1">
            Se registrará el total completo ({formatCOP(totalCompra)}) como {pagos[0].metodo}
          </p>
        )}

        {pagos.some((p) => p.metodo === 'Credito' || p.metodo === 'Fiado') && saldoActual > 0 && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex flex-col gap-0.5">
            <p className="text-xs font-semibold text-amber-700">Deuda actual con este proveedor</p>
            <div className="flex justify-between text-xs text-amber-600">
              <span>Saldo anterior</span>
              <span className="font-medium tabular-nums">{formatCOP(saldoActual)}</span>
            </div>
            <div className="flex justify-between text-xs text-amber-800 border-t border-amber-200 mt-1 pt-1">
              <span className="font-semibold">Nueva deuda total</span>
              <span className="font-bold tabular-nums">{formatCOP(saldoActual + Number(totalCompra))}</span>
            </div>
          </div>
        )}

        {pagos.some((p) => p.metodo === 'Contado' || p.metodo === 'Transferencia') && (
          <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-gray-200">
            <label className="text-xs text-gray-500 font-medium">¿Con qué método se pagó?</label>
            <div className="flex gap-2 flex-wrap">
              {metodosPago.map((m) => {
                const mId    = m.id;
                const mLabel = m.label;
                return (
                  <button key={mId} type="button" onClick={() => setMetodoPagoDetalle(mId)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                      ${metodoPagoDetalle === mId
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {mLabel}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {hayDivisa && (
          <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-gray-200">
            <label className="text-xs text-gray-500 font-medium">Pago con Divisa (US$)</label>
            <CambioDivisa
              estado={cambioDivisa}
              onChange={setCambioDivisa}
              labelDolares="¿Cuántos dólares entregaste?"
              labelPesos="¿Cuánto abonas en pesos?"
            />
            {cambioDivisa.pesos > 0 && (
              <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-2.5">
                Salen US$ {cambioDivisa.dolares} de la cuenta Divisa y se abonan{' '}
                {formatCOP(cambioDivisa.pesos)} a la compra.
                {pagos.length === 1 && (() => {
                  const resto = Number(totalCompra) - Number(cambioDivisa.pesos);
                  if (resto > 0) return ` Queda debiendo ${formatCOP(resto)}.`;
                  if (resto < 0) return ` Supera el total en ${formatCOP(Math.abs(resto))}.`;
                  return ' Cubre el total exacto.';
                })()}
              </p>
            )}
            <p className="text-xs text-gray-400">
              Los dólares salen de la cuenta Divisa (USD) de Tesorería; la compra
              queda abonada por su equivalente en pesos.
            </p>
          </div>
        )}
      </div>

      {proveedor.tipo === 'proveedor' && (
        <div className={`rounded-xl p-3 border transition-all
          ${registrarEnCaja ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={registrarEnCaja}
              onChange={(e) => setRegistrarEnCaja(e.target.checked)}
              className="rounded accent-blue-600 w-4 h-4 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-gray-700">Registrar en caja</p>
              <p className="text-xs text-gray-400">Si no se marca, la compra no aparecerá en el resumen de caja del día</p>
            </div>
          </label>
        </div>
      )}

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

  // ── Config: colores de serial ─────────────────────────────────────────────
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  const coloresActivo          = configData?.colores_serial_activo === '1';
  const coloresConfig          = parsearColoresConfig(configData);
  const caracteristicasActivo  = configData?.caracteristicas_serial_activo === '1';
  const caracteristicasLista   = parsearCaracteristicasConfig(configData);
  const variantesActivo        = configData?.variantes_activo === '1';

  const {
    verificando, verificarYProceder,
    modalReactivar, serialesReactivar, handleConfirmarReactivar, handleCancelarReactivar,
    modalYaEnInventario, serialesDisponibles, handleCerrarDisponibles,
    modalPrestados, serialesPrestados, handleCerrarPrestados,
  } = useVerificacionImeis();

  const mutCompra = useMutation({
    mutationFn: (payload) => crearCompra(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['compras'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],         exact: false });
      onClose();
    },
  });

  const handleTipo     = (t) => { setTipo(t); setPaso(2); };
  const handleVolverA1 = () => setPaso(1);
  const handleVolverA2 = () => setPaso(2);

  const handleContinuarSerial = (imeis, lineasPayload, factor, traida) => {
    verificarYProceder(imeis, ({ reactivarMap }) => {
      const lineasEnriquecidas = lineasPayload.map((linea) => ({
        ...linea,
        imeis: linea.imeis.map((item) => {
          const imeiStr        = extraerImei(item).trim();
          const color          = extraerColor(item);
          const caracteristicas = extraerCaracteristicas(item);
          return {
            valor:               imeiStr,
            color:               color || null,
            caracteristicas:     Object.keys(caracteristicas).some((k) => caracteristicas[k]?.trim?.())
                                   ? caracteristicas
                                   : null,
            reactivar_serial_id: reactivarMap[imeiStr] || null,
          };
        }),
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
            .filter((i) => {
              const val = typeof i === 'string' ? i : i.valor;
              return val?.trim();
            })
            .map((i) => {
              const esObjeto          = typeof i !== 'string';
              const imeiValor         = esObjeto ? i.valor               : i;
              const reactivarSerialId = esObjeto ? i.reactivar_serial_id  : null;
              const color             = esObjeto ? (i.color || null)      : null;
              const caracteristicas   = esObjeto ? (i.caracteristicas || null) : null;
              return {
                nombre_producto:     linea.nombre,
                imei:                imeiValor.trim(),
                cantidad:            1,
                precio_unitario:     (esObjeto && i._costo_individual) ? Number(i._costo_individual) : Number(linea.precio_compra),
                precio_usd:          linea.precio_usd ? Number(linea.precio_usd) : null,
                factor_conversion:   linea.factor_conversion || null,
                valor_traida:        linea.valor_traida      || null,
                producto_id:         linea.id,
                reactivar_serial_id: reactivarSerialId,
                color,
                caracteristicas,
              };
            })
        )
      : productos.flatMap((p) => {
          const nodosActivos = Object.entries(p.nodosData || {}).filter(([, d]) => Number(d?.cantidad) > 0);
          if (nodosActivos.length > 0) {
            return nodosActivos.map(([, d]) => ({
              nombre_producto:   p.nombre,
              cantidad:          Number(d.cantidad),
              precio_unitario:   Number(d.costo || 0),
              precio_usd:        null,
              factor_conversion: p.factor_conversion || null,
              valor_traida:      p.valor_traida      || null,
              producto_id:       p.id,
              variante_id:       d.tipo === 'variante' ? d.id : null,
              atributo_id:       d.tipo === 'atributo' ? d.id : null,
            }));
          }
          return [{
            nombre_producto:   p.nombre,
            cantidad:          p.cantidad_comprada,
            precio_unitario:   Number(p.precio_compra),
            precio_usd:        p.precio_usd ? Number(p.precio_usd) : null,
            factor_conversion: p.factor_conversion || null,
            valor_traida:      p.valor_traida      || null,
            producto_id:       p.id,
            variante_id:       null,
            atributo_id:       null,
          }];
        });

    mutCompra.mutate({
      proveedor_id:        proveedor.id,
      numero_factura:      pagoData.numeroFactura,
      total:               pagoData.totalCompra,
      estado:              'Completada',
      notas:               pagoData.notas,
      lineas,
      pagos:             pagoData.pagos,
      registrar_en_caja: pagoData.registrarEnCaja,
    });
  };

  const titulos = ['Tipo de producto', 'Productos e IMEIs', 'Pago y confirmación'];

  const usaObjeto = coloresActivo || (caracteristicasActivo && caracteristicasLista?.length > 0);
  const lineasParaPaso2 = productos.map((l) => ({
    ...l,
    imeis: (l.imeis || []).map((i) => {
      if (typeof i === 'string') return i;
      if (usaObjeto) return { imei: i.valor || '', color: i.color || '', caracteristicas: i.caracteristicas || {} };
      return i.valor || '';
    }),
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
            coloresActivo={coloresActivo}
            coloresConfig={coloresConfig}
            caracteristicasActivo={caracteristicasActivo}
            caracteristicasLista={caracteristicasLista}
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
            variantesActivo={variantesActivo}
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
      <ModalImeisPrestados open={modalPrestados} seriales={serialesPrestados} onCerrar={handleCerrarPrestados} />
    </>
  );
}