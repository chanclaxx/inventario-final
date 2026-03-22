import { useState }                                                  from 'react';
import { useQuery, useMutation, useQueryClient }                     from '@tanstack/react-query';
import { Package, Plus, ChevronRight, ChevronDown, Trash2, Lock }   from 'lucide-react';
import { getProductosSerial, getSeriales, eliminarSerial, getLineas } from '../../api/productos.api';
import { SearchInput }               from '../../components/ui/SearchInput';
import { Badge }                     from '../../components/ui/Badge';
import { Button }                    from '../../components/ui/Button';
import { Spinner }                   from '../../components/ui/Spinner';
import { EmptyState }                from '../../components/ui/EmptyState';
import { formatCOP }                 from '../../utils/formatters';
import useCarritoStore               from '../../store/carritoStore';
import { ModalPinEliminacion }       from './ModalPinEliminacion';
import { ModalEditarSerial }         from './ModalEditarSerial';
import { ModalEditarProductoSerial } from './ModalEditarProductoSerial';
import { useAuth }                   from '../../context/useAuth';
import { useSucursalKey }            from '../../hooks/useSucursalKey';
import api                           from '../../api/axios.config';

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
          <span className="text-xs text-gray-400">Entrada: {serial.fecha_entrada}</span>
          {serial.cliente_origen && !prestado && (
            <Badge variant="purple">Retoma: {serial.cliente_origen}</Badge>
          )}
          {prestado && serial.cliente_origen && (
            <span className="text-xs text-blue-500">Prestado a: {serial.cliente_origen}</span>
          )}
        </div>
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

// ─── Selector dropdown móvil ──────────────────────────────────────────────────
function SelectorModelo({ productos, productoSeleccionado, onSeleccionar }) {
  return (
    <select
      value={productoSeleccionado?.id || ''}
      onChange={(e) => {
        const p = productos.find((x) => x.id === Number(e.target.value));
        if (p) onSeleccionar(p);
      }}
      className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
        text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500
        focus:bg-white transition-all appearance-none cursor-pointer"
    >
      <option value="">Seleccionar modelo...</option>
      {productos.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nombre} — {p.disponibles} disp.
          {Number(p.prestados) > 0 ? ` · ${p.prestados} prest.` : ''}
        </option>
      ))}
    </select>
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
          ? <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
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
              className={`flex items-center justify-between p-3 rounded-xl text-left
                transition-all duration-150 border
                ${productoSeleccionado?.id === p.id
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50 text-gray-700'}`}
              title={esAdmin ? 'Click para ver seriales · Doble click para editar' : undefined}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{p.nombre}</p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-xs text-gray-400">{p.disponibles} disp.</span>
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

// ─── Componente principal ─────────────────────────────────────────────────────
export function ProductosSerial({ onAgregarProducto }) {
  const queryClient                    = useQueryClient();
  const { esAdminNegocio }             = useAuth();
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
    gcTime:    0,
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
    gcTime:    0,
  });

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    enabled:  sucursalLista && esAdminNegocio(),
  });
  const pinEliminacion = configData?.pin_eliminacion ?? '';

  const agregarItem = useCarritoStore((s) => s.agregarItem);

  const mutEliminar = useMutation({
    mutationFn: (serialId) => eliminarSerial(serialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seriales'],         exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'], exact: false });
      setSerialAEliminar(null);
    },
  });

  const productos = productosData || [];
  const lineas    = lineasData    || [];
  const seriales  = serialesData  || [];
  const esAdmin   = esAdminNegocio();

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
      producto_id: productoSeleccionado.id,
      marca:       productoSeleccionado.marca    || null,
      modelo:      productoSeleccionado.modelo   || null,
      linea_id:    productoSeleccionado.linea_id || null,
    });
  };

  const PanelSeriales = productoSeleccionado ? (
    <div className="flex flex-col gap-3 flex-1">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{productoSeleccionado.nombre}</h3>
          <p className="text-xs text-gray-400">
            {[productoSeleccionado.marca, productoSeleccionado.modelo, productoSeleccionado.color]
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
          <span className="text-xs text-gray-400">{disponibles.length} disponible(s)</span>
          {prestados.length > 0 && (
            <span className="text-xs text-blue-500 font-medium">· {prestados.length} prestado(s)</span>
          )}
          {esAdmin && (
            <span className="text-xs text-gray-300 italic">· Doble click en IMEI para editar serial</span>
          )}
        </div>
      )}

      {loadingSeriales ? (
        <Spinner className="py-10" />
      ) : serialesOrdenados.length === 0 ? (
        <EmptyState icon={Package} titulo="Sin seriales disponibles" />
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[55vh]">
          {serialesOrdenados.map((s) => (
            <TarjetaSerial
              key={s.id}
              serial={s}
              precio={productoSeleccionado.precio}
              onAgregar={handleAgregarSerial}
              onEliminar={(serial) => setSerialAEliminar({ id: serial.id, imei: serial.imei })}
              onEditar={esAdmin ? setSerialAEditar : null}
            />
          ))}
        </div>
      )}
    </div>
  ) : (
    <EmptyState icon={Package} titulo="Selecciona un modelo"
      descripcion="Elige un producto de la lista para ver sus seriales" />
  );

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
              className={`flex items-center justify-between p-3 rounded-xl text-left
                transition-all duration-150 border
                ${productoSeleccionado?.id === p.id
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50 text-gray-700'}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{p.nombre}</p>
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
      <div className="hidden lg:flex gap-4 h-full">
        {ListaProductos}
        <div className="flex-1 min-w-0">{PanelSeriales}</div>
      </div>

      <div className="flex flex-col gap-4 lg:hidden">
        <SelectorModelo
          productos={productos}
          productoSeleccionado={productoSeleccionado}
          onSeleccionar={handleSeleccionar}
        />
        {productoSeleccionado
          ? PanelSeriales
          : <EmptyState icon={Package} titulo="Selecciona un modelo"
              descripcion="Usa el selector para ver los seriales" />}
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