import { useState }                                      from 'react';
import { useQuery, useMutation, useQueryClient }         from '@tanstack/react-query';
import { ShoppingBag, Plus, AlertTriangle, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { getProductosCantidad, ajustarStockCantidad, getLineas } from '../../api/productos.api';
import { SearchInput }                                   from '../../components/ui/SearchInput';
import { Button }                                        from '../../components/ui/Button';
import { Input }                                         from '../../components/ui/Input';
import { Spinner }                                       from '../../components/ui/Spinner';
import { EmptyState }                                    from '../../components/ui/EmptyState';
import { formatCOP }                                     from '../../utils/formatters';
import useCarritoStore                                   from '../../store/carritoStore';
import { ModalPinEliminacion }                           from './ModalPinEliminacion';
import { ModalEditarProductoCantidad }                   from './ModalEditarProductoCantidad';
import { useAuth }                                       from '../../context/useAuth';
import { useSucursalKey }                                from '../../hooks/useSucursalKey';
import api                                               from '../../api/axios.config';

// ── Tarjeta de producto cantidad ──────────────────────────────────────────────
function TarjetaProducto({ p, esAdmin, onAgregar, onReducir, onEditar }) {
  const sinStock  = p.stock === 0;
  const stockBajo = !sinStock && p.stock_bajo;

  const cardBg     = sinStock  ? 'bg-gray-50'
                   : stockBajo ? 'bg-amber-50/40'
                   : 'bg-white';
  const cardBorder = sinStock  ? 'border-gray-200'
                   : stockBajo ? 'border-amber-200'
                   : 'border-green-100';
  const hoverBorder = sinStock  ? 'hover:border-gray-300'
                    : stockBajo ? 'hover:border-amber-300'
                    : 'hover:border-green-200';

  // Progreso: stock / (2 × mínimo), máximo 100%
  const progreso = p.stock_minimo > 0
    ? Math.min(p.stock / (p.stock_minimo * 2), 1)
    : p.stock > 0 ? 1 : 0;

  const colorBarra = sinStock  ? 'bg-gray-300'
                   : stockBajo ? 'bg-amber-400'
                   : 'bg-green-500';

  return (
    <div
      onDoubleClick={() => esAdmin && onEditar(p)}
      className={`border rounded-2xl p-4 flex flex-col gap-3
        transition-colors select-none w-full
        ${cardBg} ${cardBorder}
        ${esAdmin ? `cursor-pointer ${hoverBorder}` : 'cursor-default'}`}
      title={esAdmin ? 'Doble click para editar' : undefined}
    >
      {/* Nombre + eliminar */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm break-words leading-snug
            ${sinStock ? 'text-gray-400' : 'text-gray-900'}`}>
            {p.nombre}
          </p>
          {p.unidad_medida && (
            <p className="text-xs text-gray-400 mt-0.5">{p.unidad_medida}</p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onReducir(e, p); }}
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Reducir stock"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* Stock + precio + barra de progreso */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold tabular-nums leading-none
              ${sinStock ? 'text-gray-300' : stockBajo ? 'text-amber-600' : 'text-gray-900'}`}>
              {p.stock}
            </span>
            <span className="text-xs text-gray-400">
              {sinStock ? 'sin stock' : stockBajo ? 'bajo mín.' : 'en stock'}
            </span>
          </div>
          <span className="text-sm font-semibold text-gray-700">{formatCOP(p.precio || 0)}</span>
        </div>

        {p.stock_minimo > 0 && (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${colorBarra}`}
                style={{ width: `${progreso * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-400">Mín. {p.stock_minimo}</p>
          </div>
        )}
      </div>

      <Button
        size="sm" className="w-full"
        disabled={sinStock}
        onClick={(e) => { e.stopPropagation(); onAgregar(p); }}
      >
        <Plus size={14} />
        {sinStock ? 'Sin stock' : 'Agregar al carrito'}
      </Button>
    </div>
  );
}

// ── Acordeón de línea ─────────────────────────────────────────────────────────
function AcordeonLinea({ nombre, productos, esAdmin, onAgregar, onReducir, onEditar }) {
  const [abierto, setAbierto] = useState(true);

  const alertas    = productos.filter((p) => p.stock_bajo || p.stock === 0).length;
  const totalStock = productos.reduce((s, p) => s + (Number(p.stock) || 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl
          bg-gray-50 hover:bg-gray-100 transition-colors text-left w-full"
      >
        {abierto
          ? <ChevronDown  size={14} className="text-gray-400" />
          : <ChevronRight size={14} className="text-gray-400" />}
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex-1">
          {nombre}
        </span>
        <div className="flex items-center gap-1.5">
          {alertas > 0 && (
            <span className="flex items-center gap-0.5 bg-amber-100 text-amber-600
              text-xs font-medium px-2 py-0.5 rounded-full">
              <AlertTriangle size={11} />
              {alertas}
            </span>
          )}
          <span className="text-xs text-gray-400">
            {productos.length} prod · {totalStock} uds
          </span>
        </div>
      </button>

      {abierto && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pl-2">
          {productos.map((p) => (
            <TarjetaProducto
              key={p.id}
              p={p}
              esAdmin={esAdmin}
              onAgregar={onAgregar}
              onReducir={onReducir}
              onEditar={onEditar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function ProductosCantidad() {
  const queryClient = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const { sucursalKey, sucursalLista } = useSucursalKey();

  const [busqueda,         setBusqueda]         = useState('');
  const [productoAReducir, setProductoAReducir] = useState(null);
  const [cantidadReducir,  setCantidadReducir]  = useState('1');
  const [productoAEditar,  setProductoAEditar]  = useState(null);

  const { data: productosData, isLoading } = useQuery({
    queryKey:  ['productos-cantidad', ...sucursalKey],
    queryFn:   () => getProductosCantidad().then((r) => r.data.data),
    enabled:   sucursalLista,
    staleTime: 0,
  });

  const { data: lineasData } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    enabled:  sucursalLista && esAdminNegocio(),
  });
  const pinEliminacion = configData?.pin_eliminacion ?? '';

  const agregarItem = useCarritoStore((s) => s.agregarItem);

  const mutReducir = useMutation({
    mutationFn: ({ productoId, cantidad }) =>
      ajustarStockCantidad(productoId, { cantidad: -Math.abs(cantidad) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      setProductoAReducir(null);
      setCantidadReducir('1');
    },
    onError: () => {}, // El error se muestra en ModalPinEliminacion
  });

  const productos = Array.isArray(productosData)
    ? productosData
    : (Array.isArray(productosData?.items) ? productosData.items : []);
  const lineas    = lineasData || [];
  const esAdmin   = esAdminNegocio();

  const productosFiltrados = productos.filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const sinLinea = productosFiltrados.filter((p) => !p.linea_id);
  const porLinea = lineas
    .map((l) => ({
      linea:     l,
      productos: productosFiltrados.filter((p) => p.linea_id === l.id),
    }))
    .filter((g) => g.productos.length > 0);

  const handleAgregar = (producto) => {
    agregarItem({
      key:         `cant-${producto.id}`,
      tipo:        'cantidad',
      nombre:      producto.nombre,
      producto_id: producto.id,
      precio:      Math.round(Number(producto.precio || producto.costo_unitario || 0)),
      stock:       producto.stock,
      cantidad:    1,
      linea_id:    producto.linea_id || null,
    });
  };

  const handleAbrirReducir = (e, producto) => {
    e.stopPropagation();
    setProductoAReducir(producto);
    setCantidadReducir('1');
  };

  const handleConfirmarReducir = () => {
    const cant = parseInt(cantidadReducir, 10);
    if (!cant || cant <= 0) throw new Error('La cantidad debe ser mayor a 0');
    if (cant > productoAReducir.stock)
      throw new Error(`Stock insuficiente. Stock actual: ${productoAReducir.stock}`);
    return mutReducir.mutateAsync({ productoId: productoAReducir.id, cantidad: cant });
  };

  if (isLoading) return <Spinner className="py-20" />;

  return (
    <>
      <div className="flex flex-col gap-4">
        <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar producto..." />

        {esAdmin && (
          <p className="text-xs text-gray-400 px-1">Doble click en una card para editar el producto</p>
        )}

        {productosFiltrados.length === 0 ? (
          <EmptyState icon={ShoppingBag} titulo="Sin productos" />
        ) : (
          <div className="flex flex-col gap-4">
            {porLinea.map(({ linea, productos: prods }) => (
              <AcordeonLinea
                key={linea.id}
                nombre={linea.nombre}
                productos={prods}
                esAdmin={esAdmin}
                onAgregar={handleAgregar}
                onReducir={handleAbrirReducir}
                onEditar={setProductoAEditar}
              />
            ))}

            {sinLinea.length > 0 && (
              <AcordeonLinea
                key="sin-linea"
                nombre="Sin línea"
                productos={sinLinea}
                esAdmin={esAdmin}
                onAgregar={handleAgregar}
                onReducir={handleAbrirReducir}
                onEditar={setProductoAEditar}
              />
            )}
          </div>
        )}
      </div>

      {productoAReducir && (
        <ModalPinEliminacion
          titulo="Reducir stock"
          descripcion={`Reducir stock de "${productoAReducir.nombre}". Stock actual: ${productoAReducir.stock} unidades.`}
          loading={mutReducir.isPending}
          onConfirm={handleConfirmarReducir}
          onClose={() => { setProductoAReducir(null); setCantidadReducir('1'); }}
          extraContent={
            <Input
              label="Cantidad a reducir"
              type="number" min="1" max={productoAReducir.stock}
              value={cantidadReducir}
              onChange={(e) => setCantidadReducir(e.target.value)}
            />
          }
        />
      )}

      {productoAEditar && (
        <ModalEditarProductoCantidad
          producto={productoAEditar}
          pinEliminacion={pinEliminacion}
          onClose={() => setProductoAEditar(null)}
        />
      )}
    </>
  );
}
