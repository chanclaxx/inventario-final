import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Trash2, Plus, Minus, FileText, Handshake, ArrowRightLeft,
  Truck, Undo2, Bookmark,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { formatCOP } from '../../utils/formatters';
import { getSucursales } from '../../api/sucursales.api';
import api from '../../api/axios.config';
import { getContextoRed, resolverItemsCarrito } from '../../api/redInterna.api';
import useCarritoStore from '../../store/carritoStore';
import { useTarifas }   from '../../hooks/useTarifas';
import { SelectorTarifa, TarifaItem } from '../../components/ui/SelectorTarifa';
import { ModalTraslado } from './ModalTraslado';
import { ModalDespachar } from '../red-interna/ModalDespachar';
import { ModalDevolver }  from '../red-interna/ModalDevolver';
import { ListaBorradores }      from './ListaBorradores';
import { ModalGuardarBorrador } from './ModalGuardarBorrador';
import { useBorradores }        from '../../hooks/useBorradores';
import { unidadesLibres }       from '../../utils/reservas';

// ─────────────────────────────────────────────────────────────────────────────
// Aviso cuando la cantidad del carrito se come lo apartado en un borrador.
//
// Aquí NO se abre el modal de conflicto ni se topa la cifra: el producto ya
// está en el carrito y el vendedor está ajustando a mano. Frenarlo sería
// convertir el bloqueo blando en duro, y además la venta es legítima — el stock
// existe de verdad. Lo que corresponde es decirle a quién le está quitando.
//
// Solo aplica a productos por cantidad: un serial es una unidad y su choque ya
// se resolvió al agregarlo.
// ─────────────────────────────────────────────────────────────────────────────
function AvisoApartado({ item }) {
  const reserva = useCarritoStore((s) => s.reservas[item.key]);
  if (item.tipo === 'serial' || !reserva?.total) return null;

  const libres = unidadesLibres(item.stock, reserva);
  if (libres == null || (item.cantidad || 1) <= libres) return null;

  const titulos = [...new Set(reserva.entradas.map((e) => e.titulo))];
  return (
    <p className="flex items-start gap-1 text-[11px] text-amber-700 bg-amber-50
      border border-amber-100 rounded-lg px-2 py-1">
      <Bookmark size={10} className="flex-shrink-0 mt-0.5" />
      <span>
        {reserva.total} apartada{reserva.total !== 1 ? 's' : ''} en{' '}
        {titulos.length === 1 ? `«${titulos[0]}»` : `${titulos.length} borradores`}
        {libres > 0 ? ` · quedaban ${libres} libre${libres !== 1 ? 's' : ''}` : ''}
      </span>
    </p>
  );
}

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
  const {
    items, eliminarItem, actualizarPrecio, actualizarCantidad, limpiarCarrito, totalCarrito,
    aplicarTarifa, aplicarTarifaATodos,
  } = useCarritoStore();
  const total = totalCarrito();
  const queryClient = useQueryClient();

  // ── Tarifas porcentuales sobre el costo (feature opt-in) ──────────────────
  // Con la feature apagada `activo` es false y nada de esto se renderiza:
  // el carrito queda exactamente como estaba.
  const tarifasCfg = useTarifas();

  // Tarifa aplicada a TODO el carrito: solo se marca como activa si todos los
  // ítems que admiten tarifa comparten la misma, para no mentir cuando el
  // vendedor mezcla tarifas ítem por ítem.
  const conTarifa    = items.filter((i) => i.costo != null);
  const tarifaComun  = conTarifa.length > 0
    && conTarifa.every((i) => i.tarifa_id && i.tarifa_id === conTarifa[0].tarifa_id)
    ? conTarifa[0].tarifa_id
    : null;
  const sinCosto     = items.length > 0 && conTarifa.length === 0;

  const [modalTraslado, setModalTraslado] = useState(false);
  const [despacho,      setDespacho]      = useState(null); // { items, descartados }
  const [devolucion,    setDevolucion]    = useState(false);
  const [errorRed,      setErrorRed]      = useState('');

  // ── Borradores de venta (feature opt-in) ──────────────────────────────────
  // Con la feature apagada `activo` es false, no se pide nada al backend y ni
  // el botón ni la lista se renderizan: el carrito queda idéntico al de hoy.
  const { activo: borradoresActivos, guardar, descartar, borradores } = useBorradores();
  const borradorOrigenId = useCarritoStore((s) => s.borradorOrigenId);
  // Si el carrito vino de un borrador, guardar lo ACTUALIZA: el modal arranca
  // con sus datos en vez de en blanco, para que no parezca que se crea otro.
  const borradorOrigen = borradorOrigenId
    ? borradores.find((b) => b.id === borradorOrigenId)
    : null;
  const [modalBorrador,  setModalBorrador]  = useState(false);
  const [errorBorrador,  setErrorBorrador]  = useState('');

  const handleGuardarBorrador = (datos) => {
    setErrorBorrador('');
    guardar.mutate(
      { ...datos, items },
      {
        onSuccess: () => {
          // Si este carrito venía de un borrador, guardar equivale a
          // ACTUALIZARLO: el viejo se descarta. Sin esto quedarían dos
          // borradores apartando la misma mercancía —el mismo IMEI en dos
          // sitios—, que es justo lo que la reserva existe para evitar.
          // Silencioso: el borrador nuevo ya está guardado y un error aquí solo
          // deja uno de más, que el usuario puede borrar.
          if (borradorOrigenId) {
            descartar.mutate(borradorOrigenId, { onError: () => {} });
          }
          setModalBorrador(false);
          // El carrito se vacía: la mercancía queda apartada en el borrador y
          // el vendedor puede atender al siguiente cliente de una vez, que es
          // justo para lo que se guarda. (limpiarCarrito resetea también
          // borradorOrigenId.)
          limpiarCarrito();
        },
        onError: (e) => setErrorBorrador(e.response?.data?.error || 'No se pudo guardar el borrador'),
      }
    );
  };

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

        {/* Tarifa aplicada a todo el carrito (feature opt-in) */}
        {tarifasCfg.activo && items.length > 0 && (
          <div className="mb-3 p-3 bg-gray-50 rounded-xl flex flex-col gap-1.5">
            <SelectorTarifa
              label="Tarifa para toda la venta"
              tarifas={tarifasCfg.tarifas}
              valor={tarifaComun}
              verPorcentaje={tarifasCfg.verPorcentaje}
              disabled={sinCosto}
              motivoDisabled="Ningún producto del carrito admite tarifa"
              onChange={(t) => aplicarTarifaATodos(t, {
                modo: tarifasCfg.modo, redondeo: tarifasCfg.redondeo,
              })}
            />
            {!sinCosto && conTarifa.length < items.length && (
              <span className="text-[11px] text-gray-400">
                {items.length - conTarifa.length} producto(s) no admiten tarifa y conservan
                su precio de lista — revísalos abajo uno por uno
              </span>
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

                  {/* La cantidad se comió lo que otro cliente tenía apartado */}
                  <AvisoApartado item={item} />

                  {/* Tarifa de este ítem (feature opt-in) */}
                  {tarifasCfg.activo && (
                    <TarifaItem
                      item={item}
                      config={tarifasCfg}
                      onAplicar={aplicarTarifa}
                    />
                  )}

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

            {/* Guardar el carrito para después. Va al final y en ghost: es la
                salida secundaria, no compite con Facturar ni Prestar. */}
            {borradoresActivos && (
              <button
                onClick={() => { setErrorBorrador(''); setModalBorrador(true); }}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs
                  font-medium text-amber-700 bg-amber-50 hover:bg-amber-100
                  border border-amber-100 rounded-xl transition-colors"
              >
                <Bookmark size={14} /> Guardar como borrador
              </button>
            )}

            {errorRed && <p className="text-xs text-red-500 text-center">{errorRed}</p>}
          </div>
        )}

        {/* Borradores guardados de esta sucursal. Se renderiza fuera del bloque
            de arriba a propósito: la lista tiene que verse también con el
            carrito vacío, que es justo cuando se va a cargar uno. */}
        <ListaBorradores />
      </div>

      {modalTraslado && (
        <ModalTraslado open={modalTraslado} onClose={() => setModalTraslado(false)} />
      )}

      {/* Montado solo mientras está abierto: al cerrarse se desmonta y el
          formulario queda limpio para el siguiente cliente, sin un efecto que
          lo resetee a mano. */}
      {borradoresActivos && modalBorrador && (
        <ModalGuardarBorrador
          open={modalBorrador}
          onClose={() => setModalBorrador(false)}
          items={items}
          total={total}
          origen={borradorOrigen}
          guardando={guardar.isPending}
          error={errorBorrador}
          onGuardar={handleGuardarBorrador}
        />
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
