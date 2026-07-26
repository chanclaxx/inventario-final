import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Trash2, Plus, Minus, FileText, Handshake, ArrowRightLeft,
  Truck, Undo2,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { formatCOP } from '../../utils/formatters';
import { getSucursales } from '../../api/sucursales.api';
import api from '../../api/axios.config';
import { getContextoRed, resolverItemsCarrito } from '../../api/redInterna.api';
import useCarritoStore from '../../store/carritoStore';
import { ModalTraslado } from './ModalTraslado';
import { ModalDespachar } from '../red-interna/ModalDespachar';
import { ModalDevolver }  from '../red-interna/ModalDevolver';

function CantidadInput({ valor, stock, onCambiar }) {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => { setTexto(String(valor)); }, [valor]);

  const confirmar = () => {
    const n = parseInt(texto, 10);
    if (!isNaN(n) && n >= 1 && n <= stock) onCambiar(n);
    else setTexto(String(valor));
  };

  return (
    <input
      type="number"
      min={1}
      max={stock}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => e.key === 'Enter' && confirmar()}
      className="w-10 text-center text-sm font-semibold text-gray-800 bg-white
        border border-gray-200 rounded-lg py-1
        focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  );
}

export function Carrito({ onFacturar, onPrestar, sinHeader = false }) {
  const { items, eliminarItem, actualizarPrecio, actualizarCantidad, limpiarCarrito, totalCarrito } =
    useCarritoStore();
  const total = totalCarrito();
  const queryClient = useQueryClient();

  const [modalTraslado, setModalTraslado] = useState(false);
  const [despacho,      setDespacho]      = useState(null); // { items, descartados }
  const [devolucion,    setDevolucion]    = useState(false);
  const [errorRed,      setErrorRed]      = useState('');

  const { data: sucursalesRaw } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
  });
  const sucursales       = sucursalesRaw || [];
  const hayMultiSucursal = sucursales.length > 1;

  // ── Red interna ────────────────────────────────────────────────────────────
  // Con la distribución desde bodega activa, el traslado libre está cerrado en
  // el backend: dejar el botón "Trasladar" sería un botón muerto. Se reemplaza
  // por la acción que corresponde a dónde estoy parado.
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const redActiva = configData?.red_interna_activa === '1';

  const { data: contextoRed } = useQuery({
    queryKey: ['red-contexto'],
    queryFn:  () => getContextoRed().then((r) => r.data.data),
    enabled:  redActiva,          // sin la feature no se pide nunca
    retry:    false,
    staleTime: 5 * 60 * 1000,
  });
  const esBodega = contextoRed?.es_bodega === true;
  const redLista = redActiva && !!contextoRed;

  // El carrito guarda el precio de VENTA; el despacho va al costo. El backend
  // re-resuelve cada ítem (y de paso valida stock, propiedad y disponibilidad).
  const prepararDespacho = useMutation({
    mutationFn: () => resolverItemsCarrito(
      items.map((i) => ({
        tipo:        i.tipo,
        serial_id:   i.serial_id,
        producto_id: i.producto_id,
        cantidad:    i.cantidad || 1,
        nombre:      i.nombre,
        // El precio del carrito es de VENTA, no de costo: viaja solo como
        // sugerencia para que la pantalla de despacho lo ofrezca con un toque.
        precio_carrito: i.precioFinal ?? i.precio ?? null,
      }))
    ).then((r) => r.data.data),
    onSuccess: (data) => {
      if (!data.items.length) {
        setErrorRed('Ninguno de los productos del carrito se puede despachar.');
        return;
      }
      setErrorRed('');
      setDespacho(data);
    },
    onError: (err) => setErrorRed(err.response?.data?.error || 'No se pudo preparar el despacho'),
  });

  const cerrarYLimpiar = () => {
    setDespacho(null);
    setDevolucion(false);
    limpiarCarrito();
    queryClient.invalidateQueries({ queryKey: ['red-panel'] });
    queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
    queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
  };

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        {!sinHeader && (
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
        )}

        {/* Items */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-2.5">
          {items.length === 0 ? (
            <EmptyState icon={ShoppingCart} titulo="Carrito vacío"
              descripcion="Agrega productos desde el inventario" />
          ) : (
            <>
              {sinHeader && (
                <div className="flex justify-end mb-1">
                  <button onClick={limpiarCarrito}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors">
                    Vaciar todo
                  </button>
                </div>
              )}
              {items.map((item) => (
                <div key={item.key} className="bg-gray-50 rounded-xl p-3.5 flex flex-col gap-2.5">
                  {/* Nombre + eliminar */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 line-clamp-2 leading-snug">
                        {item.nombre}
                      </p>
                      {item.imei && (
                        <span className="inline-flex items-center font-mono text-xs
                          bg-white border border-gray-200 rounded-md px-1.5 py-0.5
                          text-gray-500 mt-1">
                          {item.imei}
                        </span>
                      )}
                      {(item.atributo_label || item.variante_label) && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.atributo_label && (
                            <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">
                              {item.atributo_label}
                            </span>
                          )}
                          {item.variante_label && (
                            <span className="text-xs bg-purple-50 text-purple-600 border border-purple-100 px-2 py-0.5 rounded-full">
                              {item.variante_label}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <button onClick={() => eliminarItem(item.key)}
                      className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 p-0.5">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Controles cantidad + precio */}
                  <div className="flex items-center gap-2">
                    {item.tipo === 'cantidad' ? (
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <button
                          onClick={() => actualizarCantidad(item.key, (item.cantidad || 1) - 1)}
                          className="w-7 h-7 rounded-lg bg-white border border-gray-200
                            hover:bg-gray-100 flex items-center justify-center
                            transition-colors shadow-sm flex-shrink-0">
                          <Minus size={12} />
                        </button>
                        <CantidadInput
                          valor={item.cantidad || 1}
                          stock={item.stock}
                          onCambiar={(n) => actualizarCantidad(item.key, n)}
                        />
                        <button
                          onClick={() => actualizarCantidad(item.key, (item.cantidad || 1) + 1)}
                          disabled={(item.cantidad || 1) >= item.stock}
                          className="w-7 h-7 rounded-lg bg-white border border-gray-200
                            hover:bg-gray-100 flex items-center justify-center transition-colors
                            shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                          <Plus size={12} />
                        </button>
                        <span className="text-xs text-gray-400 flex-shrink-0">/ {item.stock}</span>
                      </div>
                    ) : (
                      <div className="flex-1" />
                    )}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-xs text-gray-400">$</span>
                      <InputMoneda
                        value={item.precioFinal}
                        onChange={(val) => actualizarPrecio(item.key, val)}
                        className="w-28 text-right text-sm font-semibold text-gray-800 bg-white
                          border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none
                          focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* Subtotal cuando hay más de 1 unidad */}
                  {item.tipo === 'cantidad' && (item.cantidad || 1) > 1 && (
                    <div className="flex justify-between items-center pt-1.5 border-t border-gray-200">
                      <span className="text-xs text-gray-400">
                        {item.cantidad} × {formatCOP(item.precioFinal)}
                      </span>
                      <span className="text-xs font-semibold text-gray-700">
                        {formatCOP((item.cantidad || 1) * (item.precioFinal || 0))}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer con total y acciones */}
        {items.length > 0 && (
          <div className="border-t border-gray-100 pt-4 mt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Total</span>
              <span className="text-xl font-bold text-gray-900">{formatCOP(total)}</span>
            </div>
            <Button className="w-full" onClick={onFacturar}>
              <FileText size={16} /> Hacer Factura
            </Button>
            <Button variant="secondary" className="w-full" onClick={onPrestar}>
              <Handshake size={16} /> Prestar
            </Button>

            {/* Con la red interna activa el traslado libre no existe: la
                mercancía se mueve por remisiones. El botón se adapta a dónde
                estoy — despachar si soy la bodega, devolver si soy un local. */}
            {redLista ? (
              esBodega ? (
                <Button variant="secondary" className="w-full"
                  loading={prepararDespacho.isPending}
                  onClick={() => prepararDespacho.mutate()}>
                  <Truck size={16} /> Despachar a un local
                </Button>
              ) : (
                <Button variant="secondary" className="w-full"
                  onClick={() => { setErrorRed(''); setDevolucion(true); }}>
                  <Undo2 size={16} /> Devolver a {contextoRed.bodega_nombre}
                </Button>
              )
            ) : (
              hayMultiSucursal && !redActiva && (
                <Button variant="secondary" className="w-full" onClick={() => setModalTraslado(true)}>
                  <ArrowRightLeft size={16} /> Trasladar a otra sucursal
                </Button>
              )
            )}

            {errorRed && <p className="text-xs text-red-500 text-center">{errorRed}</p>}
          </div>
        )}
      </div>

      {modalTraslado && (
        <ModalTraslado open={modalTraslado} onClose={() => setModalTraslado(false)} />
      )}

      {despacho && (
        <ModalDespachar
          locales={contextoRed?.locales || []}
          itemsIniciales={despacho.items}
          descartados={despacho.descartados}
          onCerrar={() => setDespacho(null)}
          onListo={cerrarYLimpiar}
        />
      )}

      {devolucion && (
        <ModalDevolver
          items={items}
          bodegaNombre={contextoRed?.bodega_nombre}
          onCerrar={() => setDevolucion(false)}
          onListo={cerrarYLimpiar}
        />
      )}
    </>
  );
}
