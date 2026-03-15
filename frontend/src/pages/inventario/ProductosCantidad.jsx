import { useState }                                      from 'react';
import { useQuery, useMutation, useQueryClient }         from '@tanstack/react-query';
import { ShoppingBag, Plus, AlertTriangle, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { getProductosCantidad, ajustarStockCantidad, getLineas } from '../../api/productos.api';
import { SearchInput }                                   from '../../components/ui/SearchInput';
import { Badge }                                         from '../../components/ui/Badge';
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

// ── Tarjeta de producto cantidad ──────────────────────────────────────────────
function TarjetaProducto({ p, esAdmin, onAgregar, onReducir, onEditar }) {
  return (
    <div
      onDoubleClick={() => esAdmin && onEditar(p)}
      className={`bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3
        transition-colors select-none w-full
        ${esAdmin ? 'cursor-pointer hover:border-blue-200 hover:bg-blue-50/20' : 'cursor-default'}`}
      title={esAdmin ? 'Doble click para editar' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm break-words leading-snug">{p.nombre}</p>
          <p className="text-xs text-gray-400 mt-0.5">{p.unidad_medida}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {p.stock_bajo && <AlertTriangle size={15} className="text-yellow-500" />}
          <button
            onClick={(e) => { e.stopPropagation(); onReducir(e, p); }}
            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Reducir stock"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={p.stock > 0 ? 'green' : 'red'}>Stock: {p.stock}</Badge>
          {p.stock_minimo > 0 && <span className="text-xs text-gray-400">mín. {p.stock_minimo}</span>}
        </div>
        <span className="text-sm font-semibold text-gray-700">{formatCOP(p.precio || 0)}</span>
      </div>
      <Button
        size="sm" className="w-full"
        disabled={p.stock === 0}
        onClick={(e) => { e.stopPropagation(); onAgregar(p); }}
      >
        <Plus size={14} />
        {p.stock === 0 ? 'Sin stock' : 'Agregar al carrito'}
      </Button>
    </div>
  );
}

// ── Acordeón de línea ─────────────────────────────────────────────────────────
function AcordeonLinea({ nombre, productos, esAdmin, onAgregar, onReducir, onEditar }) {
  const [abierto, setAbierto] = useState(true);

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl
          bg-gray-50 hover:bg-gray-100 transition-colors text-left w-full"
      >
        {abierto
          ? <ChevronDown size={14} className="text-gray-400" />
          : <ChevronRight size={14} className="text-gray-400" />}
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{nombre}</span>
        <span className="text-xs text-gray-400">({productos.length})</span>
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
    gcTime:    0,
  });

  const { data: lineasData } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  const agregarItem = useCarritoStore((s) => s.agregarItem);

  const mutReducir = useMutation({
    mutationFn: ({ productoId, cantidad }) =>
      ajustarStockCantidad(productoId, { cantidad: -Math.abs(cantidad) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      setProductoAReducir(null);
      setCantidadReducir('1');
    },
  });

  const productos = Array.isArray(productosData?.items) ? productosData.items : [];
  const lineas    = lineasData || [];
  const esAdmin   = esAdminNegocio();

  const productosFiltrados = productos.filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  // ── Agrupar por línea ──
  const sinLinea = productosFiltrados.filter((p) => !p.linea_id);
  const porLinea = lineas.map((l) => ({
    linea:     l,
    productos: productosFiltrados.filter((p) => p.linea_id === l.id),
  })).filter((g) => g.productos.length > 0);

  const handleAgregar = (producto) => {
    agregarItem({
      key:         `cant-${producto.id}`,
      tipo:        'cantidad',
      nombre:      producto.nombre,
      producto_id: producto.id,
      precio:      Math.round(Number(producto.precio || producto.costo_unitario || 0)),
      stock:       producto.stock,
      cantidad:    1,
    });
  };

  const handleAbrirReducir = (e, producto) => {
    e.stopPropagation();
    setProductoAReducir(producto);
    setCantidadReducir('1');
  };

  const handleConfirmarReducir = () => {
    const cant = parseInt(cantidadReducir, 10);
    if (!cant || cant <= 0) return;
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
            {/* Productos con línea — acordeón */}
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

            {/* Sin línea */}
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
          onClose={() => setProductoAEditar(null)}
        />
      )}
    </>
  );
}