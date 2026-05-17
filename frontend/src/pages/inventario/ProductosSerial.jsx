import { useState, useEffect, useRef }                                from 'react';
import { useQuery, useMutation, useQueryClient }                     from '@tanstack/react-query';
import {
  Package, Plus, ChevronRight, ChevronDown, Trash2, Lock,
  Palette, Search, CheckCircle, X, SlidersHorizontal,
} from 'lucide-react';
import { getProductosSerial, getSeriales, eliminarSerial, getLineas } from '../../api/productos.api';
import { SearchInput }               from '../../components/ui/SearchInput';
import { Badge }                     from '../../components/ui/Badge';
import { Button }                    from '../../components/ui/Button';
import { Spinner }                   from '../../components/ui/Spinner';
import { EmptyState }                from '../../components/ui/EmptyState';
import { formatCOP, formatFecha }     from '../../utils/formatters';
import useCarritoStore               from '../../store/carritoStore';
import { ModalPinEliminacion }       from './ModalPinEliminacion';
import { ModalEditarSerial }         from './ModalEditarSerial';
import { ModalEditarProductoSerial } from './ModalEditarProductoSerial';
import { useAuth }                   from '../../context/useAuth';
import { useSucursalKey }            from '../../hooks/useSucursalKey';
import api                           from '../../api/axios.config';

// ─── Helper: leer lista de colores desde config ───────────────────────────────
function parsearColoresConfig(configData) {
  try {
    const lista = JSON.parse(configData?.colores_serial_lista || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

// ─── Helper: agrupar seriales por color ──────────────────────────────────────
function agruparPorColor(seriales, coloresConfig) {
  const grupos = coloresConfig
    .map((color) => ({
      color,
      seriales: seriales.filter((s) => s.color === color),
    }))
    .filter((g) => g.seriales.length > 0);

  const sinColor = seriales.filter(
    (s) => !s.color || !coloresConfig.includes(s.color)
  );
  if (sinColor.length > 0) {
    grupos.push({ color: null, seriales: sinColor });
  }

  return grupos;
}

// ─── Cabecera de grupo de color ───────────────────────────────────────────────
function CabeceraGrupoColor({ color, cantidad }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5">
      <Palette size={13} className="text-gray-400 flex-shrink-0" />
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        {color ?? 'Sin color'}
      </span>
      <span className="text-xs text-gray-300 ml-auto">({cantidad})</span>
    </div>
  );
}

// ─── Tarjeta individual de serial ─────────────────────────────────────────────
function TarjetaSerial({ serial, precio, onAgregar, onEliminar, onEditar }) {
  const prestado = serial.prestado && !serial.vendido;

  const estiloContenedor = prestado
    ? 'bg-blue-50 border-blue-200 hover:border-blue-300'
    : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50/30';

  return (
    <div
      onDoubleClick={() => onEditar?.(serial)}
      className={`border rounded-xl p-3 flex items-center justify-between
        transition-colors select-none
        ${onEditar ? 'cursor-pointer' : 'cursor-default'}
        ${estiloContenedor}`}
      title={onEditar ? 'Doble click para editar serial' : undefined}
    >
      <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono font-medium text-gray-800 break-all">
            {serial.imei}
          </span>
          {prestado && (
            <Badge variant="blue">
              <Lock size={10} className="inline mr-0.5" /> Prestado
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">Entrada: {formatFecha(serial.fecha_entrada)}</span>
          {serial.cliente_origen && !prestado && (
            <Badge variant="purple">Retoma: {serial.cliente_origen}</Badge>
          )}
          {prestado && serial.cliente_origen && (
            <span className="text-xs text-blue-500">Prestado a: {serial.cliente_origen}</span>
          )}
        </div>
        {serial.caracteristicas && Object.keys(serial.caracteristicas).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {Object.entries(serial.caracteristicas).map(([k, v]) => (
              <span key={k}
                className="inline-flex items-center gap-1 text-xs bg-gray-100
                  text-gray-600 px-2 py-0.5 rounded-md">
                <span className="font-medium">{k}:</span>{v}
              </span>
            ))}
          </div>
        )}
        {prestado && (
          <p className="text-xs text-blue-400 mt-0.5">
            Debe ser devuelto antes de poder venderse
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-sm font-semibold ${prestado ? 'text-blue-400' : 'text-gray-700'}`}>
          {formatCOP(precio || 0)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onEliminar(serial); }}
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Eliminar serial"
        >
          <Trash2 size={15} />
        </button>
        <Button
          size="sm"
          disabled={prestado}
          title={prestado ? 'No se puede vender — está prestado' : 'Agregar al carrito'}
          onClick={(e) => { e.stopPropagation(); onAgregar(serial); }}
          className={prestado ? 'opacity-40 cursor-not-allowed' : ''}
        >
          {prestado ? <Lock size={14} /> : <Plus size={14} />}
          <span className="hidden sm:inline">{prestado ? 'Prestado' : 'Agregar'}</span>
        </Button>
      </div>
    </div>
  );
}

// ─── Bottom sheet buscable para móvil ─────────────────────────────────────────
function SelectorModeloMovil({ productos, lineas, productoSeleccionado, onSeleccionar }) {
  const [abierto,  setAbierto]  = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const inputRef               = useRef(null);

  // Enfocar input al abrir
  useEffect(() => {
    if (abierto) setTimeout(() => inputRef.current?.focus(), 80);
  }, [abierto]);

  // Bloquear scroll del body mientras el sheet está abierto
  useEffect(() => {
    document.body.style.overflow = abierto ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [abierto]);

  const cerrar = () => { setAbierto(false); setBusqueda(''); };

  const filtrados = productos.filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    (p.marca  ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
    (p.modelo ?? '').toLowerCase().includes(busqueda.toLowerCase())
  );

  // Agrupar por línea respetando el orden de lineas
  const grupos = [
    ...lineas
      .map((l) => ({ nombre: l.nombre, prods: filtrados.filter((p) => p.linea_id === l.id) }))
      .filter((g) => g.prods.length > 0),
    ...(filtrados.filter((p) => !p.linea_id).length > 0
      ? [{ nombre: 'Sin línea', prods: filtrados.filter((p) => !p.linea_id) }]
      : []),
  ];

  const mostrarEncabezadoGrupo = grupos.length > 1 || (grupos.length === 1 && grupos[0].nombre !== 'Sin línea');

  return (
    <>
      {/* Botón disparador */}
      <button
        onClick={() => setAbierto(true)}
        className="w-full flex items-center gap-3 px-4 py-3
          bg-white border border-gray-200 rounded-2xl text-left
          hover:border-blue-300 active:scale-[0.99] transition-all shadow-sm"
      >
        <SlidersHorizontal size={17} className="text-gray-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {productoSeleccionado ? (
            <>
              <p className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2">
                {productoSeleccionado.nombre}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {productoSeleccionado.disponibles} disponible(s)
                {Number(productoSeleccionado.prestados) > 0 &&
                  ` · ${productoSeleccionado.prestados} prestado(s)`}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400">Seleccionar modelo...</p>
          )}
        </div>
        <ChevronDown size={16} className="text-gray-300 flex-shrink-0" />
      </button>

      {/* Bottom sheet */}
      {abierto && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={cerrar}
          />

          {/* Sheet */}
          <div className="relative bg-white rounded-t-3xl flex flex-col"
            style={{ maxHeight: '85dvh' }}>

            {/* Handle + Cabecera */}
            <div className="flex-shrink-0 px-4 pt-3 pb-4">
              <div className="flex justify-center mb-3">
                <div className="w-10 h-1 bg-gray-200 rounded-full" />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-base font-bold text-gray-900">Seleccionar modelo</p>
                <button onClick={cerrar}
                  className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-400">
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {productos.length} modelo{productos.length !== 1 ? 's' : ''} disponibles
              </p>

              {/* Buscador */}
              <div className="relative mt-3">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Buscar por nombre, marca..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-gray-100 rounded-xl text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
                {busqueda && (
                  <button onClick={() => setBusqueda('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Lista scrollable */}
            <div className="overflow-y-auto flex-1 px-4 pb-8">
              {filtrados.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Package size={32} className="text-gray-200" />
                  <p className="text-sm text-gray-400">Sin resultados para "{busqueda}"</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {grupos.map((grupo) => (
                    <div key={grupo.nombre}>
                      {mostrarEncabezadoGrupo && (
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide
                          px-2 pt-3 pb-1.5 first:pt-0">
                          {grupo.nombre}
                        </p>
                      )}
                      <div className="flex flex-col gap-1">
                        {grupo.prods.map((p) => {
                          const seleccionado = productoSeleccionado?.id === p.id;
                          return (
                            <button
                              key={p.id}
                              onClick={() => { onSeleccionar(p); cerrar(); }}
                              className={`w-full flex items-center gap-3 p-3.5 rounded-xl text-left
                                border transition-all active:scale-[0.98]
                                ${seleccionado
                                  ? 'bg-blue-50 border-blue-200'
                                  : 'bg-gray-50 border-transparent hover:bg-gray-100'}`}
                            >
                              <div className="flex-1 min-w-0">
                                {/* Nombre completo sin truncar */}
                                <p className={`text-sm font-medium leading-snug
                                  ${seleccionado ? 'text-blue-800' : 'text-gray-800'}`}>
                                  {p.nombre}
                                </p>
                                {(p.marca || p.modelo) && (
                                  <p className="text-xs text-gray-400 mt-0.5">
                                    {[p.marca, p.modelo].filter(Boolean).join(' · ')}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1">
                                  <span className={`text-xs font-medium
                                    ${p.disponibles > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                    {p.disponibles} disp.
                                  </span>
                                  {Number(p.prestados) > 0 && (
                                    <span className="text-xs text-blue-500 font-medium">
                                      · {p.prestados} prest.
                                    </span>
                                  )}
                                </div>
                              </div>
                              {seleccionado && (
                                <CheckCircle size={18} className="text-blue-500 flex-shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Grupo de línea (siempre abierto, colapsable con click) ───────────────────
function GrupoLinea({ nombre, productos, productoSeleccionado, onSeleccionar, onEditarProducto, esAdmin }) {
  const [abierto, setAbierto] = useState(true);

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg
          hover:bg-gray-100 transition-colors text-left w-full group"
      >
        {abierto
          ? <ChevronDown  size={13} className="text-gray-400 flex-shrink-0" />
          : <ChevronRight size={13} className="text-gray-400 flex-shrink-0" />}
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {nombre}
        </span>
        <span className="text-xs text-gray-300 ml-auto">({productos.length})</span>
      </button>

      {abierto && (
        <div className="flex flex-col gap-1 ml-1 border-l-2 border-gray-100 pl-2">
          {productos.map((p) => (
            <button
              key={p.id}
              onClick={() => onSeleccionar(p)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (esAdmin) onEditarProducto(p);
              }}
              className={`flex items-center justify-between p-3 rounded-xl text-left group
                transition-all duration-150 border
                ${productoSeleccionado?.id === p.id
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50 text-gray-700'}`}
              title={p.nombre + (esAdmin ? ' · Doble click para editar' : '')}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium line-clamp-2 leading-snug group-hover:line-clamp-none">{p.nombre}</p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className={`text-xs ${p.disponibles > 0 ? 'text-gray-400' : 'text-red-400'}`}>
                    {p.disponibles} disp.
                  </span>
                  {Number(p.prestados) > 0 && (
                    <span className="text-xs text-blue-500 font-medium">
                      · {p.prestados} prest.
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={14} className="text-gray-300 flex-shrink-0 ml-2" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Panel de seriales agrupados por color ────────────────────────────────────
function ListaSeriales({ seriales, precio, onAgregar, onEliminar, onEditar, coloresActivo, coloresConfig }) {
  if (!coloresActivo) {
    return (
      <div className="flex flex-col gap-2">
        {seriales.map((s) => (
          <TarjetaSerial
            key={s.id}
            serial={s}
            precio={precio}
            onAgregar={onAgregar}
            onEliminar={onEliminar}
            onEditar={onEditar}
          />
        ))}
      </div>
    );
  }

  const grupos = agruparPorColor(seriales, coloresConfig);

  return (
    <div className="flex flex-col gap-3">
      {grupos.map((grupo) => {
        const grupoColor = grupo.color;
        return (
          <div key={grupoColor ?? '__sin_color__'} className="flex flex-col gap-1.5">
            <CabeceraGrupoColor color={grupoColor} cantidad={grupo.seriales.length} />
            <div className="flex flex-col gap-2 ml-1 border-l-2 border-gray-100 pl-2">
              {grupo.seriales.map((s) => (
                <TarjetaSerial
                  key={s.id}
                  serial={s}
                  precio={precio}
                  onAgregar={onAgregar}
                  onEliminar={onEliminar}
                  onEditar={onEditar}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function ProductosSerial({ onAgregarProducto }) {
  const queryClient                    = useQueryClient();
  const { puedeEditarProductos }       = useAuth();
  const { sucursalKey, sucursalLista } = useSucursalKey();

  const [productoSeleccionado, setProductoSeleccionado] = useState(null);
  const [busqueda,             setBusqueda]             = useState('');
  const [busquedaSerial,       setBusquedaSerial]       = useState('');
  const [serialAEliminar,      setSerialAEliminar]      = useState(null);
  const [serialAEditar,        setSerialAEditar]        = useState(null);
  const [productoAEditar,      setProductoAEditar]      = useState(null);

  const { data: productosData, isLoading } = useQuery({
    queryKey:  ['productos-serial', ...sucursalKey],
    queryFn:   () => getProductosSerial().then((r) => r.data.data),
    enabled:   sucursalLista,
    staleTime: 0,
  });

  const { data: lineasData } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  const { data: serialesData, isLoading: loadingSeriales } = useQuery({
    queryKey:  ['seriales', productoSeleccionado?.id, ...sucursalKey],
    queryFn:   () => getSeriales(productoSeleccionado.id, false).then((r) => r.data.data),
    enabled:   sucursalLista && !!productoSeleccionado,
    staleTime: 0,
  });

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  const coloresActivo  = configData?.colores_serial_activo === '1';
  const coloresConfig  = parsearColoresConfig(configData);
  const pinEliminacion = configData?.pin_eliminacion ?? '';

  const agregarItem = useCarritoStore((s) => s.agregarItem);

  const mutEliminar = useMutation({
    mutationFn: (serialId) => eliminarSerial(serialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seriales'],         exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'], exact: false });
      setSerialAEliminar(null);
    },
    onError: () => {}, // El error se muestra en ModalPinEliminacion
  });

  const productos = productosData || [];
  const lineas    = lineasData    || [];
  const seriales  = serialesData  || [];
  const esAdmin   = puedeEditarProductos();

  const productosFiltrados = productos.filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const grupos = [
    ...lineas
      .map((l) => ({
        key:       `linea-${l.id}`,
        nombre:    l.nombre,
        productos: productosFiltrados.filter((p) => p.linea_id === l.id),
      }))
      .filter((g) => g.productos.length > 0),
    ...(productosFiltrados.filter((p) => !p.linea_id).length > 0
      ? [{
          key:       'sin-linea',
          nombre:    'Sin línea',
          productos: productosFiltrados.filter((p) => !p.linea_id),
        }]
      : []),
  ];

  const serialesFiltrados = seriales.filter((s) =>
    s.imei.toLowerCase().includes(busquedaSerial.toLowerCase())
  );
  const disponibles       = serialesFiltrados.filter((s) => !s.vendido && !s.prestado);
  const prestados         = serialesFiltrados.filter((s) =>  s.prestado && !s.vendido);
  const vendidos          = serialesFiltrados.filter((s) =>  s.vendido);
  const serialesOrdenados = [...disponibles, ...prestados, ...vendidos];

  const handleSeleccionar = (p) => { setProductoSeleccionado(p); setBusquedaSerial(''); };

  const handleAgregarSerial = (serial) => {
    if (serial.prestado) return;
    agregarItem({
      key:         serial.imei,
      tipo:        'serial',
      nombre:      productoSeleccionado.nombre,
      imei:        serial.imei,
      precio:      Math.round(Number(productoSeleccionado.precio || 0)),
      cantidad:    1,
      serial_id:   serial.id,
      marca:       productoSeleccionado.marca    || null,
      modelo:      productoSeleccionado.modelo   || null,
      linea_id:    productoSeleccionado.linea_id || null,
    });
  };

  // ─── Panel de seriales (shared entre desktop y móvil) ────────────────────
  const PanelSeriales = productoSeleccionado ? (
    <div className="flex flex-col gap-3 flex-1">
      {/* Cabecera del producto seleccionado */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 leading-snug line-clamp-3">
            {productoSeleccionado.nombre}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {[productoSeleccionado.marca, productoSeleccionado.modelo]
              .filter(Boolean).join(' · ')}
            {productoSeleccionado.linea_nombre && (
              <span className="ml-2 text-blue-500 font-medium">
                {productoSeleccionado.linea_nombre}
              </span>
            )}
          </p>
        </div>
        {onAgregarProducto && (
          <Button size="sm" className="flex-shrink-0"
            onClick={() => onAgregarProducto(productoSeleccionado)}>
            <Plus size={14} />
            <span className="hidden sm:inline">Agregar IMEI</span>
          </Button>
        )}
      </div>

      <SearchInput value={busquedaSerial} onChange={setBusquedaSerial} placeholder="Buscar IMEI..." />

      {serialesOrdenados.length > 0 && (
        <div className="flex items-center gap-3 px-1 flex-wrap">
          <span className={`text-xs font-medium ${disponibles.length > 0 ? 'text-green-600' : 'text-gray-400'}`}>
            {disponibles.length} disponible(s)
          </span>
          {prestados.length > 0 && (
            <span className="text-xs text-blue-500 font-medium">· {prestados.length} prestado(s)</span>
          )}
          {esAdmin && (
            <span className="text-xs text-gray-300 italic hidden sm:inline">
              · Doble click en IMEI para editar
            </span>
          )}
        </div>
      )}

      {loadingSeriales ? (
        <Spinner className="py-10" />
      ) : serialesOrdenados.length === 0 ? (
        <EmptyState icon={Package} titulo="Sin seriales disponibles" />
      ) : (
        <div className="overflow-y-auto max-h-[55vh]">
          <ListaSeriales
            seriales={serialesOrdenados}
            precio={productoSeleccionado.precio}
            onAgregar={handleAgregarSerial}
            onEliminar={(serial) => setSerialAEliminar({ id: serial.id, imei: serial.imei })}
            onEditar={esAdmin ? setSerialAEditar : null}
            coloresActivo={coloresActivo}
            coloresConfig={coloresConfig}
          />
        </div>
      )}
    </div>
  ) : (
    <EmptyState icon={Package} titulo="Selecciona un modelo"
      descripcion="Elige un producto de la lista para ver sus seriales" />
  );

  // ─── Lista de productos para desktop ─────────────────────────────────────
  const ListaProductos = (
    <div className="w-64 flex-shrink-0 flex flex-col gap-3">
      <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar modelo..." />

      {esAdmin && (
        <p className="text-xs text-gray-400 px-1">
          Doble click en un modelo para editarlo
        </p>
      )}

      <div className="flex flex-col gap-3 overflow-y-auto max-h-[60vh]">
        {productosFiltrados.length === 0 ? (
          <EmptyState icon={Package} titulo="Sin productos" />
        ) : grupos.length === 0 ? (
          productosFiltrados.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSeleccionar(p)}
              onDoubleClick={(e) => { e.stopPropagation(); if (esAdmin) setProductoAEditar(p); }}
              className={`flex items-center justify-between p-3 rounded-xl text-left group
                transition-all duration-150 border
                ${productoSeleccionado?.id === p.id
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50 text-gray-700'}`}
              title={p.nombre}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium line-clamp-2 leading-snug group-hover:line-clamp-none">{p.nombre}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-gray-400">{p.disponibles} disp.</span>
                  {Number(p.prestados) > 0 && (
                    <span className="text-xs text-blue-500 font-medium">· {p.prestados} prest.</span>
                  )}
                </div>
              </div>
              <ChevronRight size={14} className="text-gray-300 flex-shrink-0 ml-2" />
            </button>
          ))
        ) : (
          grupos.map((g) => (
            <GrupoLinea
              key={g.key}
              nombre={g.nombre}
              productos={g.productos}
              productoSeleccionado={productoSeleccionado}
              onSeleccionar={handleSeleccionar}
              onEditarProducto={setProductoAEditar}
              esAdmin={esAdmin}
            />
          ))
        )}
      </div>
    </div>
  );

  if (isLoading) return <Spinner className="py-20" />;

  return (
    <>
      {/* ── Desktop: columna lista + panel seriales ── */}
      <div className="hidden lg:flex gap-4 h-full">
        {ListaProductos}
        <div className="flex-1 min-w-0">{PanelSeriales}</div>
      </div>

      {/* ── Móvil: bottom sheet selector + panel seriales ── */}
      <div className="flex flex-col gap-3 lg:hidden">
        {/* Selector con bottom sheet */}
        <SelectorModeloMovil
          productos={productos}
          lineas={lineas}
          productoSeleccionado={productoSeleccionado}
          onSeleccionar={handleSeleccionar}
        />

        {/* Chip "cambiar modelo" cuando hay uno seleccionado */}
        {productoSeleccionado && (
          <div className="flex items-center justify-between gap-2
            bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
            <p className="text-xs text-blue-700 font-medium leading-snug line-clamp-2 flex-1">
              {productoSeleccionado.nombre}
            </p>
            <button
              onClick={() => setProductoSeleccionado(null)}
              className="text-xs text-blue-400 hover:text-blue-600 flex-shrink-0 underline"
            >
              Cambiar
            </button>
          </div>
        )}

        {/* Panel de seriales o empty state */}
        {productoSeleccionado
          ? PanelSeriales
          : (
            <div className="py-8">
              <EmptyState icon={Package} titulo="Selecciona un modelo"
                descripcion="Toca el selector para ver los seriales disponibles" />
            </div>
          )}
      </div>

      {serialAEliminar && (
        <ModalPinEliminacion
          titulo="Eliminar serial"
          descripcion={`¿Eliminar el IMEI ${serialAEliminar.imei}? Esta acción no se puede deshacer.`}
          loading={mutEliminar.isPending}
          onConfirm={() => mutEliminar.mutateAsync(serialAEliminar.id)}
          onClose={() => setSerialAEliminar(null)}
        />
      )}

      {serialAEditar && (
        <ModalEditarSerial
          serial={serialAEditar}
          precioProducto={productoSeleccionado?.precio}
          productoId={productoSeleccionado?.id}
          onClose={() => setSerialAEditar(null)}
        />
      )}

      {productoAEditar && (
        <ModalEditarProductoSerial
          producto={productoAEditar}
          pinEliminacion={pinEliminacion}
          onClose={() => setProductoAEditar(null)}
        />
      )}
    </>
  );
}