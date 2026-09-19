import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Trash2, Plus, Minus, FileText, Handshake, ArrowRightLeft,
  Truck, Undo2, Bookmark, Route, Search, X, Info,
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
import { BarraEscaneo }   from '../../components/ui/BarraEscaneo';
import { ChipsVariante } from '../../components/ui/ChipsVariante';
import { useEscanerCarrito } from '../../hooks/useEscanerCarrito';
import { ModalTraslado } from './ModalTraslado';
import { ModalRutaRecogida } from './ModalRutaRecogida';
import { ModalDespachar } from '../red-interna/ModalDespachar';
import { ModalDevolver }  from '../red-interna/ModalDevolver';
import { ListaBorradores }      from './ListaBorradores';
import { useBorradores }        from '../../hooks/useBorradores';
import { unidadesLibres }       from '../../utils/reservas';
import { filtrarCarrito, MINIMO_PARA_BUSCAR } from '../../utils/carritoBusqueda';
import { useListasPrecios } from '../../hooks/useListasPrecios';
import { usePrecioMinimo } from '../../hooks/usePrecioMinimo';
import { pisoItemCarrito, bajoMinimo, itemsBajoMinimo } from '../../utils/precioMinimo';
import { SelectorListaPrecio, ListaPrecioItem } from '../../components/ui/SelectorListaPrecio';
import { contarSinPrecio } from '../../utils/listasPrecios';

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

// ─────────────────────────────────────────────────────────────────────────────
// Buscar dentro del carrito.
//
// Comparte fila con el escáner en vez de ocupar una propia. En una columna de
// 288px no caben dos campos de texto lado a lado —el escáner es el principal y
// necesita todo el ancho—, así que la lupa INTERCAMBIA los dos: mientras se
// busca, el escáner cede su sitio. Buscar dura tres segundos; escanear es todo
// el día.
//
// Aparece solo desde `MINIMO_PARA_BUSCAR` ítems: con tres productos a la vista
// un campo de búsqueda es ruido encima de justo lo que se quiere mirar.
//
// Cuando hay filtro puesto la lupa se queda MARCADA aunque el campo esté
// cerrado: sin eso, esconder el buscador escondería también el hecho de que la
// lista está recortada, y eso sí que sería una trampa.
// ─────────────────────────────────────────────────────────────────────────────
function BuscadorCarrito({ valor, onCambiar, onCerrar, mostrados, total }) {
  const filtrando = valor.trim().length > 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          autoFocus
          value={valor}
          onChange={(e) => onCambiar(e.target.value)}
          // Escape cierra y devuelve el carrito completo de un toque: es el
          // gesto que ya espera cualquiera que haya usado un buscador.
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCambiar(''); onCerrar(); } }}
          placeholder="Buscar: nombre, talla, color, IMEI…"
          className="w-full pl-9 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
            text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
            focus:bg-white transition-all"
        />
        <button
          type="button"
          onClick={() => { onCambiar(''); onCerrar(); }}
          aria-label="Cerrar la búsqueda"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg
            text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Mientras haya filtro, decir SIEMPRE cuántos se están escondiendo. Es
          lo que evita el susto de ver tres líneas y creer que el carrito se
          vació —o peor, agregar de nuevo algo que ya estaba abajo, oculto. */}
      {filtrando && (
        <p className="flex items-center justify-between gap-2 text-[11px] text-gray-500 px-1">
          <span>Mostrando <b className="text-gray-700">{mostrados}</b> de {total}</span>
          <button type="button" onClick={() => onCambiar('')}
            className="flex-shrink-0 text-blue-600 hover:text-blue-700 font-medium">
            Ver todos
          </button>
        </p>
      )}
    </div>
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

export function Carrito({ onFacturar, onPrestar, onBorradorCargado, sinHeader = false }) {
  const [modalRuta, setModalRuta] = useState(false);
  const [busqueda,  setBusqueda]  = useState('');
  const [buscando,  setBuscando]  = useState(false);
  const [verAyuda,  setVerAyuda]  = useState(false);
  const {
    items, eliminarItem, actualizarPrecio, actualizarCantidad, limpiarCarrito, totalCarrito,
    aplicarTarifa, aplicarTarifaATodos,
    listaPrecioActiva, aplicarListaPrecio, aplicarListaPreciosATodos,
  } = useCarritoStore();
  const total = totalCarrito();
  const queryClient = useQueryClient();

  // ── Buscar dentro del carrito ─────────────────────────────────────────────
  // `itemsVisibles` es SOLO para pintar la lista. Todo lo demás —el total, el
  // contador del header, la tarifa para toda la venta, facturar, prestar,
  // despachar, devolver y la ruta de recogida— sigue trabajando sobre `items`,
  // el carrito completo. Un buscador que además recortara lo que se vende sería
  // la forma más rápida de facturar de menos sin que nadie se entere.
  const hayBuscador  = items.length >= MINIMO_PARA_BUSCAR;
  const itemsVisibles = hayBuscador ? filtrarCarrito(items, busqueda) : items;
  const filtrando     = itemsVisibles.length !== items.length;

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

  // ── Listas de precios (feature opt-in) ────────────────────────────────────
  // Excluyente con las tarifas: el backend no deja tener las dos encendidas
  // (`saveConfig`), así que aquí nunca se pintan los dos selectores a la vez.
  const listasCfg = useListasPrecios();

  // De los ítems del carrito, cuántos NO están en la lista elegida. Se dice
  // ARRIBA y con el número, porque es lo que hay que saber antes de cobrar: un
  // producto que la lista no menciona se cobra a su precio normal, y en una
  // venta al por mayor eso es cobrar de más sin que nada lo advierta.
  const sinPrecioEnLista = listasCfg.activo && listaPrecioActiva
    ? contarSinPrecio(items, listaPrecioActiva.id)
    : 0;

  // ── Precio mínimo (feature opt-in) ────────────────────────────────────────
  // El backend rechaza la factura igual; esto lo dice ANTES, en la línea.
  const reglaPrecio = usePrecioMinimo();
  const bajoElMinimo = itemsBajoMinimo(items, reglaPrecio);
  const pisoPorKey   = new Map(items.map((i) => [i.key, pisoItemCarrito(i, reglaPrecio)]));

  const [modalTraslado, setModalTraslado] = useState(false);
  const [despacho,      setDespacho]      = useState(null); // { items, descartados }
  const [devolucion,    setDevolucion]    = useState(false);
  const [errorRed,      setErrorRed]      = useState('');

  // ── Borradores de venta (feature opt-in) ──────────────────────────────────
  // Aquí SOLO se lista. El botón de guardar vive dentro de ModalFactura y
  // ModalPrestamo, no aquí: cuando el cliente interrumpe, el modal ya está
  // abierto con su cédula a medio escribir, y mandarlo al carrito a rellenar
  // otro formulario es exactamente la fricción que la feature evita.
  const { activo: borradoresActivos } = useBorradores();

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
  const redActiva      = configData?.red_interna_activa === '1';
  const variantesActivo = configData?.variantes_activo    === '1';
  const codigoActivo    = configData?.codigo_producto_activo === '1';
  const ubicacionActiva = configData?.ubicacion_activa       === '1';

  // ── Escáner: el atajo más corto entre el mostrador y la venta ─────────────
  //
  // Aquí no hay lista en memoria ni forma de abrir el árbol de variantes (el
  // carrito es una columna al lado del inventario, no una pantalla): todo lo
  // resuelve el backend, y un código de producto con variantes activas se
  // explica en vez de agregarse a ciegas.
  //
  // Se muestra siempre, no solo con el código único encendido: el IMEI existe
  // en todos los negocios que venden seriales, sin configurar nada.
  const escaner = useEscanerCarrito({ variantesActivo });

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
        // La talla que el usuario ya eligió en el inventario. Sin esto el
        // backend resolvía solo el producto y el despacho la volvía a pedir.
        atributo_id: i.atributo_id ?? null,
        variante_id: i.variante_id ?? null,
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

  // Las explicaciones que antes vivían fijas bajo los botones. Se arman aquí
  // para que la ⓘ solo aparezca cuando de verdad hay algo que contar.
  const ayudas = [
    redLista && !esBodega && contextoRed?.bodega_nombre
      ? `Para despachar a un local, entra con la sucursal ${contextoRed.bodega_nombre}.`
      : null,
    borradoresActivos
      ? '¿El cliente vuelve luego? Guarda el borrador desde Factura o Préstamo, con sus datos incluidos.'
      : null,
  ].filter(Boolean);

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
      <div className="flex flex-col h-full min-h-0">
        {/* ── Zona fija de arriba ───────────────────────────────────────────
            Nunca entra en el scroll: el escáner es la puerta de entrada al
            carrito y perderlo de vista al bajar por los ítems obliga a subir
            entre cada lectura. */}
        <div className="flex-shrink-0">
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
                // Con un filtro puesto se ven tres líneas pero el botón borra
                // las cuarenta. Decir el número es lo que evita ese vaciado sin
                // querer; el contador azul de al lado ya es el del carrito
                // completo por la misma razón.
                <button onClick={limpiarCarrito}
                  className="text-xs text-red-400 hover:text-red-600 transition-colors">
                  {filtrando ? `Limpiar los ${items.length}` : 'Limpiar'}
                </button>
              )}
            </div>
          )}

          {/* Escaneo directo al carrito y búsqueda dentro de él, en UNA fila.
              Los dos son campos de texto y la columna mide 288px: apilarlos
              costaba 50px fijos que salían del espacio de los productos. */}
          <div className="mb-3">
            {buscando && hayBuscador ? (
              <BuscadorCarrito
                valor={busqueda}
                onCambiar={setBusqueda}
                onCerrar={() => setBuscando(false)}
                mostrados={itemsVisibles.length}
                total={items.length}
              />
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <BarraEscaneo
                    value={escaner.scan}
                    onChange={(v) => { escaner.setScan(v); if (escaner.scanMsg) escaner.setScanMsg(null); }}
                    // Agregar con un filtro puesto escondería justo lo que acaba
                    // de entrar, y el vendedor lo escanearía otra vez. Se limpia
                    // aquí, en el manejador del evento, y no con un efecto que
                    // vigile `items.length` (el linter rechaza sincronizar estado
                    // en un efecto, y con razón: sería un render de más en cada
                    // toque).
                    onEnter={() => { setBusqueda(''); escaner.handleScan(); }}
                    mensaje={escaner.scanMsg}
                    buscando={escaner.buscando}
                    placeholder={codigoActivo ? 'Escanear código o IMEI…' : 'Escanear IMEI…'}
                  />
                </div>
                {hayBuscador && (
                  // La lupa se queda MARCADA con el filtro puesto: cerrar el
                  // buscador no puede esconder que la lista está recortada.
                  <button
                    type="button"
                    onClick={() => setBuscando(true)}
                    aria-label="Buscar en el carrito"
                    title="Buscar en el carrito"
                    className={`flex-shrink-0 p-2 rounded-xl border transition-colors
                      ${filtrando
                        ? 'bg-blue-50 border-blue-300 text-blue-600'
                        : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'}`}
                  >
                    <Search size={16} />
                  </button>
                )}
              </div>
            )}
            {/* Con el buscador cerrado pero filtrando, el recorte se sigue
                diciendo: si no, faltarían productos sin explicación. */}
            {!buscando && filtrando && (
              <p className="flex items-center justify-between gap-2 text-[11px] text-gray-500 px-1 mt-1">
                <span>Mostrando <b className="text-gray-700">{itemsVisibles.length}</b> de {items.length}</span>
                <button type="button" onClick={() => setBusqueda('')}
                  className="flex-shrink-0 text-blue-600 hover:text-blue-700 font-medium">
                  Ver todos
                </button>
              </p>
            )}
          </div>

          {/* Ruta de recogida — el carrito es la lista, la bodega el recorrido.
              En una bodega grande, juntar ocho productos en el orden en que se
              escribieron significa cruzarla ocho veces. Opt-in con
              `ubicacion_activa`, igual que el resto de la feature. */}
          {ubicacionActiva && items.length > 0 && (
            <button
              type="button"
              onClick={() => setModalRuta(true)}
              className="w-full mb-3 flex items-center justify-center gap-2 px-3 py-2 rounded-xl
                border border-blue-200 bg-blue-50/60 text-sm text-blue-700
                hover:bg-blue-100 transition-colors"
            >
              <Route size={15} />
              Ver ruta de recogida
            </button>
          )}

          {/* Lista de precios para toda la venta (feature opt-in).
              Se muestra aunque el carrito esté vacío: elegir la lista ANTES de
              escanear es el flujo normal del mostrador, y la elección se pega a
              todo lo que entre después. */}
          {listasCfg.activo && (
            <div className="mb-3 flex flex-col gap-1">
              {/* Sin caja gris, sin etiqueta y sin el texto de ayuda permanente:
                  eran ~60px fijos para explicar algo que se entiende tocando un
                  chip. El aviso que SÍ se queda es el único que cuesta dinero
                  si no se lee — el de los productos que no están en la lista. */}
              <SelectorListaPrecio
                listas={listasCfg.listas}
                valor={listaPrecioActiva?.id || null}
                onChange={aplicarListaPreciosATodos}
              />
              {sinPrecioEnLista > 0 && (
                <span className="text-[11px] text-amber-600">
                  {sinPrecioEnLista} sin precio en «{listaPrecioActiva.nombre}» — van a su precio normal
                </span>
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
        </div>

        {/* ── Ítems: el ÚNICO que scrollea ──────────────────────────────────
            `min-h-0` es lo que hace que `flex-1` pueda encogerse por debajo de
            su contenido; sin él la columna crece con los ítems, el panel se
            estira más allá de la pantalla y para ver el final del carrito hay
            que scrollear la página entera —o sea, los mil productos del
            inventario que están al lado—. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain
          flex flex-col gap-2.5 pr-1 -mr-1">
          {items.length === 0 ? (
            <EmptyState icon={ShoppingCart} titulo="Carrito vacío"
              descripcion="Agrega productos desde el inventario" />
          ) : (
            <>
              {sinHeader && (
                <div className="flex justify-end mb-1">
                  <button onClick={limpiarCarrito}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors">
                    {filtrando ? `Vaciar los ${items.length} del carrito` : 'Vaciar todo'}
                  </button>
                </div>
              )}
              {itemsVisibles.map((item) => (
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
                      <ChipsVariante item={item} className="mt-1" />
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
                        className={`w-28 text-right text-sm font-semibold text-gray-800 bg-white
                          border rounded-lg px-2 py-1.5 focus:outline-none
                          focus:ring-2 focus:ring-blue-500 focus:border-transparent
                          ${bajoMinimo(item.precioFinal, pisoPorKey.get(item.key))
                            ? 'border-red-400' : 'border-gray-200'}`}
                      />
                    </div>
                  </div>

                  {bajoMinimo(item.precioFinal, pisoPorKey.get(item.key)) && (
                    <button
                      type="button"
                      onClick={() => actualizarPrecio(item.key, pisoPorKey.get(item.key))}
                      className="self-end text-xs text-red-600 hover:text-red-700"
                    >
                      El precio mínimo es {formatCOP(pisoPorKey.get(item.key))} · usarlo
                    </button>
                  )}

                  {/* La cantidad se comió lo que otro cliente tenía apartado */}
                  <AvisoApartado item={item} />

                  {/* Lista de precios de este ítem (feature opt-in). Sirve
                      para la excepción: casi toda la venta va al por mayor pero
                      esta línea concreta va a precio de cliente final. */}
                  {listasCfg.activo && (
                    <ListaPrecioItem
                      item={item}
                      listas={listasCfg.listas}
                      onAplicar={aplicarListaPrecio}
                    />
                  )}

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

              {/* El carrito tiene cosas, pero ninguna coincide. Se dice cuántas
                  hay para que quede claro que no se borró nada. */}
              {itemsVisibles.length === 0 && (
                <div className="text-center py-8 px-4">
                  <Search size={22} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">
                    Ningún producto del carrito coincide con «{busqueda.trim()}»
                  </p>
                  <button
                    type="button"
                    onClick={() => setBusqueda('')}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Ver los {items.length} del carrito
                  </button>
                </div>
              )}
            </>
          )}

          {/* Borradores guardados de esta sucursal. Van DENTRO del scroll y no
              debajo del footer: la lista no tiene tope de alto y, fija abajo,
              empujaría fuera de la pantalla justo el botón de facturar. Se
              renderiza fuera del bloque de ítems a propósito: tiene que verse
              también con el carrito vacío, que es cuando se va a cargar uno. */}
          <ListaBorradores onCargado={onBorradorCargado} />
        </div>

        {/* ── Footer fijo: total y acciones ─────────────────────────────────
            Anclado abajo del panel, nunca dentro del scroll: cerrar la venta no
            puede depender de haber bajado hasta el último ítem. */}
        {items.length > 0 && (
          // pt-3/mt-3 en vez de pt-4/mt-4: ocho píxeles que salían del único
          // sitio que de verdad los necesita, la lista de productos.
          <div className="flex-shrink-0 border-t border-gray-100 pt-3 mt-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Total</span>
              <span className="text-xl font-bold text-gray-900">{formatCOP(total)}</span>
            </div>

            {/* Facturar es LA acción y conserva todo el ancho. Prestar y la
                acción de red interna comparten fila porque son alternativas
                entre sí, no pasos de lo mismo: apiladas cobraban 54px cada una
                al espacio de los productos. */}
            {bajoElMinimo.length > 0 && (
              <p className="text-xs text-red-600 text-center">
                {bajoElMinimo.length === 1
                  ? '1 producto está por debajo de su precio mínimo'
                  : `${bajoElMinimo.length} productos están por debajo de su precio mínimo`}
              </p>
            )}
            <Button className="w-full" onClick={onFacturar} disabled={bajoElMinimo.length > 0}>
              <FileText size={16} /> Hacer Factura
            </Button>

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1 min-w-0" onClick={onPrestar}>
                <Handshake size={16} /> Prestar
              </Button>

              {/* Con la red interna activa el traslado libre no existe: la
                  mercancía se mueve por remisiones. El botón se adapta a dónde
                  estoy — despachar si soy la bodega, devolver si soy un local. */}
              {redLista && (
                esBodega ? (
                  <Button variant="secondary" className="flex-1 min-w-0"
                    loading={prepararDespacho.isPending}
                    onClick={() => prepararDespacho.mutate()}>
                    <Truck size={16} /> Despachar
                  </Button>
                ) : (
                  <Button variant="secondary" className="flex-1 min-w-0"
                    onClick={() => { setErrorRed(''); setDevolucion(true); }}>
                    <Undo2 size={16} /> Devolver
                  </Button>
                )
              )}
              {!redLista && hayMultiSucursal && !redActiva && (
                <Button variant="secondary" className="flex-1 min-w-0" onClick={() => setModalTraslado(true)}>
                  <ArrowRightLeft size={16} /> Trasladar
                </Button>
              )}

              {/* Las dos ayudas que antes vivían fijas aquí abajo —«para
                  despachar entra con la bodega» y «guarda el borrador desde
                  Factura»— pesaban ~60px SIEMPRE para decir algo que se lee una
                  vez en la vida. Ahora esperan detrás de la ⓘ. No es un
                  `title`: en el celular no existe el hover. */}
              {(ayudas.length > 0) && (
                <button
                  type="button"
                  onClick={() => setVerAyuda((v) => !v)}
                  aria-label="Ayuda"
                  aria-expanded={verAyuda}
                  className={`flex-shrink-0 px-2.5 rounded-xl border transition-colors
                    ${verAyuda
                      ? 'bg-gray-100 border-gray-300 text-gray-600'
                      : 'bg-white border-gray-200 text-gray-300 hover:text-gray-500'}`}
                >
                  <Info size={15} />
                </button>
              )}
            </div>

            {verAyuda && ayudas.map((texto, i) => (
              <p key={i} className="text-[11px] text-gray-400 leading-snug">{texto}</p>
            ))}

            {/* La red está encendida pero el contexto no llegó: sin esto la
                zona quedaba en blanco y parecía que el botón de despachar no
                existía. Este aviso NO se esconde tras la ⓘ: es un fallo que hay
                que resolver, no una explicación. */}
            {redActiva && !contextoRed && (
              <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100
                rounded-lg px-2.5 py-2 leading-snug">
                No se pudo cargar la distribución desde bodega. Revisa que este
                usuario tenga el módulo <b>Bodega</b> en Ajustes → Equipo → Usuarios.
              </p>
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

      {modalRuta && (
        <ModalRutaRecogida
          open
          onClose={() => setModalRuta(false)}
          items={items}
        />
      )}
    </>
  );
}
