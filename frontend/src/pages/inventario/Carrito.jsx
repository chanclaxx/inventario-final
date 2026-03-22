import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, Trash2, Plus, Minus, FileText, Handshake, ArrowRightLeft } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { formatCOP } from '../../utils/formatters';
import { getSucursales } from '../../api/sucursales.api';
import useCarritoStore from '../../store/carritoStore';
import { ModalTraslado } from './ModalTraslado';

export function Carrito({ onFacturar, onPrestar }) {
  const { items, eliminarItem, actualizarPrecio, actualizarCantidad, limpiarCarrito, totalCarrito } =
    useCarritoStore();
  const total = totalCarrito();

  const [modalTraslado, setModalTraslado] = useState(false);

  // Cargar sucursales para saber si hay más de 1
  const { data: sucursalesRaw } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
  });
  const sucursales       = sucursalesRaw || [];
  const hayMultiSucursal = sucursales.length > 1;

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-blue-600" />
            <span className="font-semibold text-gray-900">Carrito</span>
            <span className="bg-blue-100 text-blue-600 text-xs font-medium px-2 py-0.5 rounded-full">
              {items.length}
            </span>
          </div>
          {items.length > 0 && (
            <button onClick={limpiarCarrito}
              className="text-xs text-red-400 hover:text-red-600 transition-colors">
              Limpiar
            </button>
          )}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-2">
          {items.length === 0 ? (
            <EmptyState icon={ShoppingCart} titulo="Carrito vacío"
              descripcion="Agrega productos desde el inventario" />
          ) : (
            items.map((item) => (
              <div key={item.key} className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.nombre}</p>
                    {item.imei && <p className="text-xs text-gray-400 font-mono">{item.imei}</p>}
                  </div>
                  <button onClick={() => eliminarItem(item.key)}
                    className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  {item.tipo === 'cantidad' && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => actualizarCantidad(item.key, (item.cantidad || 1) - 1)}
                        className="w-6 h-6 rounded-lg bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors">
                        <Minus size={12} />
                      </button>
                      <span className="text-sm font-medium w-6 text-center">{item.cantidad || 1}</span>
                      <button onClick={() => actualizarCantidad(item.key, (item.cantidad || 1) + 1)}
                        disabled={(item.cantidad || 1) >= item.stock}
                        className="w-6 h-6 rounded-lg bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition-colors disabled:opacity-40">
                        <Plus size={12} />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-xs text-gray-400">$</span>
                    <InputMoneda value={item.precioFinal}
                      onChange={(val) => actualizarPrecio(item.key, val)}
                      className="w-24 text-right text-sm font-semibold text-gray-800 bg-white
                        border border-gray-200 rounded-lg px-2 py-1 focus:outline-none
                        focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer con total y acciones */}
        {items.length > 0 && (
          <div className="border-t border-gray-100 pt-4 mt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Total</span>
              <span className="text-lg font-bold text-gray-900">{formatCOP(total)}</span>
            </div>
            <Button className="w-full" onClick={onFacturar}>
              <FileText size={16} /> Hacer Factura
            </Button>
            <Button variant="secondary" className="w-full" onClick={onPrestar}>
              <Handshake size={16} /> Prestar
            </Button>
            {hayMultiSucursal && (
              <Button variant="secondary" className="w-full" onClick={() => setModalTraslado(true)}>
                <ArrowRightLeft size={16} /> Trasladar a otra sucursal
              </Button>
            )}
          </div>
        )}
      </div>

      {modalTraslado && (
        <ModalTraslado open={modalTraslado} onClose={() => setModalTraslado(false)} />
      )}
    </>
  );
}