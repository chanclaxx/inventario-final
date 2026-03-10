import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, Plus, AlertTriangle, Trash2 } from 'lucide-react';
import { getProductosCantidad, ajustarStockCantidad } from '../../api/productos.api';
import { SearchInput }               from '../../components/ui/SearchInput';
import { Badge }                     from '../../components/ui/Badge';
import { Button }                    from '../../components/ui/Button';
import { Input }                     from '../../components/ui/Input';
import { Spinner }                   from '../../components/ui/Spinner';
import { EmptyState }                from '../../components/ui/EmptyState';
import { formatCOP }                 from '../../utils/formatters';
import useCarritoStore               from '../../store/carritoStore';
import { ModalPinEliminacion }       from './ModalPinEliminacion';
import { ModalEditarProductoCantidad } from './ModalEditarProductoCantidad';

export function ProductosCantidad() {
  const queryClient = useQueryClient();
  const [busqueda,         setBusqueda]         = useState('');
  const [productoAReducir, setProductoAReducir] = useState(null);
  const [cantidadReducir,  setCantidadReducir]  = useState('1');
  const [productoAEditar,  setProductoAEditar]  = useState(null);

  const { data: productosData, isLoading } = useQuery({
  queryKey: ['productos-cantidad'],
  queryFn: () => getProductosCantidad().then((r) => r.data.data),
  staleTime: 0,
  gcTime: 0,
});

  const agregarItem = useCarritoStore((s) => s.agregarItem);

  const mutReducir = useMutation({
    mutationFn: ({ productoId, cantidad }) =>
      ajustarStockCantidad(productoId, { cantidad: -Math.abs(cantidad) }),
    onSuccess: () => {
      queryClient.invalidateQueries(['productos-cantidad']);
      setProductoAReducir(null);
      setCantidadReducir('1');
    },
  });

  const productos = productosData || [];

  const productosFiltrados = productos.filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const handleAgregar = (producto) => {
    agregarItem({
      key:         `cant-${producto.id}`,
      tipo:        'cantidad',
      nombre:      producto.nombre,
      producto_id: producto.id,
      precio:      producto.precio || producto.costo_unitario || 0,
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
        <SearchInput
          value={busqueda}
          onChange={setBusqueda}
          placeholder="Buscar producto..."
        />

        {productosFiltrados.length === 0 ? (
          <EmptyState icon={ShoppingBag} titulo="Sin productos" />
        ) : (
          <>
            <p className="text-xs text-gray-400 px-1">
              Doble click en una card para editar el producto
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {productosFiltrados.map((p) => (
                <div
                  key={p.id}
                  onDoubleClick={() => setProductoAEditar(p)}
                  className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3
                    cursor-pointer hover:border-blue-200 hover:bg-blue-50/20
                    transition-colors select-none w-full"
                  title="Doble click para editar"
                >
                  {/* Nombre y acciones */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm break-words leading-snug">
                        {p.nombre}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{p.unidad_medida}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {p.stock_bajo && (
                        <AlertTriangle size={15} className="text-yellow-500" />
                      )}
                      <button
                        onClick={(e) => handleAbrirReducir(e, p)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Reducir stock"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Stock y precio */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={p.stock > 0 ? 'green' : 'red'}>
                        Stock: {p.stock}
                      </Badge>
                      {p.stock_minimo > 0 && (
                        <span className="text-xs text-gray-400">mín. {p.stock_minimo}</span>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-gray-700">
                      {formatCOP(p.costo_unitario || 0)}
                    </span>
                  </div>

                  {/* Botón agregar */}
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={p.stock === 0}
                    onClick={(e) => { e.stopPropagation(); handleAgregar(p); }}
                  >
                    <Plus size={14} />
                    {p.stock === 0 ? 'Sin stock' : 'Agregar al carrito'}
                  </Button>
                </div>
              ))}
            </div>
          </>
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
              type="number"
              min="1"
              max={productoAReducir.stock}
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