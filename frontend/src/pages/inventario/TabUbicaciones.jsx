import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, ChevronRight, ChevronDown, Inbox, MapPin, FolderTree, AlertCircle,
  Map as MapIcon, List, Search, CornerDownRight,
} from 'lucide-react';
import { Button }     from '../../components/ui/Button';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { getArbolUbicaciones, getSinAsignar, buscarEnUbicaciones } from '../../api/ubicaciones.api';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { useAuth }        from '../../context/useAuth';
import { PanelUbicacion } from './PanelUbicacion';
import { ModalUbicacion } from './ModalUbicacion';
import { MapaUbicaciones } from './MapaUbicaciones';
import {
  ICONOS_UBICACION, ICONO_POR_DEFECTO, claseColor, rutaDe, TOPE_LISTA, NIVELES,
} from '../../utils/ubicaciones';

// ─────────────────────────────────────────────────────────────────────────────
// Pestaña "Ubicaciones" del inventario.
//
// Vive aquí y no en su propio módulo por la misma razón que el catálogo web:
// dónde se guarda la mercancía es una decisión sobre el inventario y hereda su
// permiso, así que no cambia el acceso de ningún usuario existente. El
// bodeguero es supervisor y ya tiene `inventario`.
//
// El modelo se invirtió: la ubicación es una fila con identidad y los productos
// se le cuelgan, en cualquier nivel del árbol (producto, atributo, variante,
// referencia o IMEI suelto) y mezclando lo que haga falta — "el Cajón B7 tiene
// correa y tiene estuches".
//
// DOS VISTAS SOBRE LOS MISMOS DATOS, y esa es la regla que manda: todo lo que
// se puede hacer en el mapa se puede hacer en la lista. El mapa es para
// explorar el espacio; la lista es la que funciona en un celular de 5" entre
// estantes, la que se navega con teclado y lector de pantalla, y la que sirve
// aunque nadie haya dibujado nada. El mapa nunca es requisito.
// ─────────────────────────────────────────────────────────────────────────────

const VISTAS = [
  { id: 'mapa',  label: 'Mapa',  Icn: MapIcon },
  { id: 'lista', label: 'Lista', Icn: List    },
];

function NodoArbol({ nodo, seleccion, onSeleccionar, expandidos, onExpandir, profundidad = 0 }) {
  const Icn        = ICONOS_UBICACION[nodo.tipo] ?? ICONO_POR_DEFECTO;
  const tieneHijas = nodo.hijas?.length > 0;
  const abierto    = expandidos.has(Number(nodo.id));
  const activo     = seleccion?.tipo === 'ubicacion' && Number(seleccion.id) === Number(nodo.id);

  return (
    <>
      <div
        className={`flex items-center gap-1 rounded-xl transition-colors
          ${activo ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
        style={{ paddingLeft: `${profundidad * 14}px` }}
      >
        {/* El desplegable es un botón aparte del de seleccionar: abrir una
            bodega para ver sus estantes y entrar en ella son dos intenciones
            distintas, y fundirlas obliga a entrar para poder mirar. */}
        <button
          type="button"
          onClick={() => onExpandir(Number(nodo.id))}
          aria-label={abierto ? 'Contraer' : 'Desplegar'}
          className={`p-1.5 rounded-lg flex-shrink-0 ${tieneHijas ? 'hover:bg-gray-200' : 'invisible'}`}
        >
          {abierto
            ? <ChevronDown  size={13} className="text-gray-400" />
            : <ChevronRight size={13} className="text-gray-400" />}
        </button>

        <button
          type="button"
          onClick={() => onSeleccionar({ tipo: 'ubicacion', id: Number(nodo.id) })}
          className="flex-1 min-w-0 flex items-center gap-2 py-2 pr-2 text-left"
        >
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${claseColor(nodo.color)}`} />
          <Icn size={15} className="text-gray-400 flex-shrink-0" />
          <span className={`flex-1 min-w-0 truncate text-sm
            ${activo ? 'text-blue-700 font-medium' : 'text-gray-800'}`}>
            {nodo.nombre}
          </span>
          {/* `items_total` incluye lo de las sub-ubicaciones: una bodega no
              guarda nada por sí misma, guardan sus estantes. */}
          {nodo.items_total > 0 && (
            <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
              {nodo.items_total}
            </span>
          )}
        </button>
      </div>

      {abierto && nodo.hijas.map((h) => (
        <NodoArbol
          key={h.id}
          nodo={h}
          seleccion={seleccion}
          onSeleccionar={onSeleccionar}
          expandidos={expandidos}
          onExpandir={onExpandir}
          profundidad={profundidad + 1}
        />
      ))}
    </>
  );
}

export function TabUbicaciones() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin_negocio';
  const { sucursalKey, sucursalLista } = useSucursalKey();

  const [vista,      setVista]      = useState('mapa');
  const [seleccion,  setSeleccion]  = useState(null);
  // En qué nivel está la cámara del mapa. Vive aquí y no dentro del mapa para
  // que el buscador pueda llevarlo a un estante concreto.
  const [padreId,    setPadreId]    = useState(null);
  const [consulta,   setConsulta]   = useState('');
  const [expandidos, setExpandidos] = useState(new Set());
  const [modalNueva, setModalNueva] = useState(false);
  const [editando,   setEditando]   = useState(null);

  const { data: arbol = [], isLoading, error } = useQuery({
    queryKey: ['ubicaciones-arbol', ...sucursalKey],
    queryFn:  () => getArbolUbicaciones().then((r) => r.data.data),
    enabled:  sucursalLista,
    staleTime: 30_000,
  });

  // Misma queryKey QUE EL PANEL con la búsqueda vacía: React Query la comparte
  // y el contador de la bandeja no cuesta una petición extra. Por eso el
  // `limit` tiene que ser el mismo en los dos sitios — con límites distintos el
  // contador diría 200 o 500 según cuál se montara primero.
  const { data: sinAsignar = [] } = useQuery({
    queryKey: ['ubicaciones-sin-asignar', ...sucursalKey, ''],
    queryFn:  () => getSinAsignar({ limit: TOPE_LISTA }).then((r) => r.data.data),
    enabled:  sucursalLista,
    staleTime: 30_000,
  });

  // El backend exige 2 caracteres; se respeta aquí para no gastar el viaje.
  const { data: hallazgos = [], isFetching: buscando } = useQuery({
    queryKey: ['ubicaciones-buscar', ...sucursalKey, consulta.trim()],
    queryFn:  () => buscarEnUbicaciones({ q: consulta.trim() }).then((r) => r.data.data),
    enabled:  sucursalLista && consulta.trim().length >= 2,
    staleTime: 15_000,
  });

  const expandir = (id) => setExpandidos((prev) => {
    const siguiente = new Set(prev);
    if (siguiente.has(id)) siguiente.delete(id);
    else siguiente.add(id);
    return siguiente;
  });

  // El nodo seleccionado con su cadena de ancestros, calculada sobre el árbol
  // que ya está en memoria.
  const ubicacionActiva = useMemo(() => {
    if (seleccion?.tipo !== 'ubicacion') return null;
    const ruta = rutaDe(arbol, seleccion.id);
    const nodo = ruta[ruta.length - 1];
    return nodo ? { ...nodo, ruta } : null;
  }, [arbol, seleccion]);

  // Al crear una ubicación desde dentro de otra, la nueva nace dentro de ella.
  const padreSugerido = seleccion?.tipo === 'ubicacion' ? seleccion.id : null;

  // Llevar la pantalla hasta una ubicación concreta, venga de donde venga.
  // En el mapa la cámara se planta en el nivel del PADRE con la caja marcada:
  // aterrizar ya dentro escondería justo el contexto que se busca ("está en el
  // Estante 1, que está en la Bodega A").
  const irAUbicacion = (id) => {
    setConsulta('');
    if (!id) { setSeleccion({ tipo: 'sin-ubicar' }); setVista('lista'); return; }

    const ruta  = rutaDe(arbol, id);
    const padre = ruta.length > 1 ? Number(ruta[ruta.length - 2].id) : null;
    setPadreId(padre);
    setSeleccion({ tipo: 'ubicacion', id: Number(id) });
  };

  // "Bodega A › Estante 1" salido del árbol que ya está en memoria. Pedirle la
  // ruta al servidor por cada resultado sería una consulta recursiva por fila.
  const rutaTexto = (id) => {
    if (!id) return null;
    const ruta = rutaDe(arbol, id);
    return ruta.length ? ruta.map((r) => r.nombre).join(' › ') : null;
  };

  const irASinUbicar = () => {
    setVista('lista');
    setSeleccion({ tipo: 'sin-ubicar' });
  };

  // Sin las tablas el backend responde 503 y la feature se apaga sola. Se dice
  // en vez de dejar una pantalla vacía que parece un error de datos.
  if (error?.response?.status === 503) {
    return (
      <EmptyState
        icon={AlertCircle}
        titulo="Las ubicaciones no están disponibles en este servidor"
        descripcion="La actualización todavía no se ha aplicado. El inventario funciona normal mientras tanto."
      />
    );
  }

  const hayPanel = seleccion !== null;

  const panel = (
    // La `key` remonta el panel al cambiar de sitio, así que la selección y el
    // buscador nacen limpios sin sincronizar estado en un efecto. Arrastrar
    // marcados de un estante al siguiente terminaría moviendo cosas que nadie
    // quiso mover.
    <PanelUbicacion
      key={seleccion?.tipo === 'sin-ubicar' ? 'sin-ubicar' : `u-${seleccion?.id}`}
      modo={seleccion?.tipo === 'sin-ubicar' ? 'sin-ubicar' : 'ubicacion'}
      ubicacion={ubicacionActiva}
      arbol={arbol}
      esAdmin={esAdmin}
      onVolver={() => setSeleccion(null)}
      onEditar={setEditando}
    />
  );

  const consultaLista = consulta.trim().length >= 2;

  return (
    <div className="flex flex-col gap-3">

      {/* ── "¿Dónde está esto?" ──
          El módulo entero responde "¿qué hay en este estante?", pero en una
          bodega grande la pregunta que más se hace es la contraria. Va arriba
          del todo y en las dos vistas porque es la puerta de entrada real
          cuando ya hay cientos de productos ubicados. */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setConsulta(''); }}
          placeholder="¿Dónde está…? Busca un producto, un código o un IMEI"
          className="w-full pl-9 pr-9 py-2.5 bg-white border border-gray-200 rounded-xl text-sm
            text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2
            focus:ring-blue-500 transition-all"
        />
        {consulta && (
          <button
            type="button"
            onClick={() => setConsulta('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        )}

        {consultaLista && (
          <div className="absolute z-30 left-0 right-0 mt-1 max-h-80 overflow-y-auto
            rounded-xl border border-gray-200 bg-white shadow-lg">
            {buscando && !hallazgos.length ? (
              <Spinner className="py-6" />
            ) : !hallazgos.length ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">
                Nada coincide con «{consulta.trim()}».
              </p>
            ) : hallazgos.map((h) => (
              <button
                key={`${h.nivel}:${h.nodo_id}`}
                type="button"
                onClick={() => irAUbicacion(h.ubicacion_id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left
                  hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-gray-900 truncate">{h.nombre}</span>
                  {(h.detalle || h.imei) && (
                    <span className="block text-xs text-gray-500 truncate">
                      {h.detalle}{h.detalle && h.imei ? ' · ' : ''}{h.imei}
                    </span>
                  )}
                </span>

                <span className="text-right flex-shrink-0 max-w-[45%]">
                  {h.ubicacion_id ? (
                    <>
                      <span className="flex items-center justify-end gap-1 text-xs
                        text-gray-800 truncate">
                        <MapPin size={11} className="text-gray-400 flex-shrink-0" />
                        <span className="truncate">{rutaTexto(h.ubicacion_id)}</span>
                      </span>
                      {/* Heredada = "no está marcada esta talla, sino el producto
                          entero". Se dice, porque cambia lo que vas a encontrar
                          al llegar al estante. */}
                      {h.heredada && (
                        <span className="flex items-center justify-end gap-1 text-[10px] text-gray-400">
                          <CornerDownRight size={9} />
                          heredado del producto
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                      <Inbox size={11} />
                      sin ubicar
                    </span>
                  )}
                  <span className="block text-[10px] text-gray-400 tabular-nums">
                    {h.stock} {h.stock === 1 ? 'unidad' : 'unidades'}
                    {NIVELES[h.nivel] ? ` · ${NIVELES[h.nivel].label}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Barra: vista, bandeja y creación ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {VISTAS.map((v) => {
            const Icn = v.Icn;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setVista(v.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                  transition-all ${vista === v.id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Icn size={15} />
                {v.label}
              </button>
            );
          })}
        </div>

        {/* La bandeja va en la barra y no solo en la lista: es la puerta de
            entrada real de la feature y desde el mapa no se vería. */}
        {sinAsignar.length > 0 && (
          <button
            type="button"
            onClick={irASinUbicar}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs
              font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
          >
            <Inbox size={14} />
            {sinAsignar.length >= TOPE_LISTA ? `${TOPE_LISTA}+` : sinAsignar.length} sin ubicar
          </button>
        )}

        {esAdmin && (
          <Button size="sm" variant="secondary" className="ml-auto"
            onClick={() => setModalNueva(true)}>
            <Plus size={15} />
            Nueva ubicación
          </Button>
        )}
      </div>

      {isLoading ? (
        <Spinner className="py-16" />

      ) : vista === 'mapa' ? (
        // ── Mapa: el detalle entra ENCIMA, no en otra pantalla ──
        // En escritorio como columna; en móvil como hoja inferior, para que el
        // mapa siga de contexto detrás en vez de desaparecer.
        <div className="relative lg:grid lg:grid-cols-[1fr_360px] lg:gap-4
          h-[62vh] lg:h-[calc(100vh-300px)]">

          <div className="h-full bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <MapaUbicaciones
              arbol={arbol}
              esAdmin={esAdmin}
              seleccion={seleccion}
              onSeleccionar={setSeleccion}
              padreId={padreId}
              onNivel={setPadreId}
            />
          </div>

          {hayPanel && (
            <>
              <div className="hidden lg:flex flex-col min-h-0 bg-white rounded-2xl
                border border-gray-100 overflow-hidden">
                {panel}
              </div>

              <div className="lg:hidden absolute inset-x-0 bottom-0 z-20 max-h-[70%]
                flex flex-col bg-white rounded-t-3xl border border-gray-200 shadow-2xl">
                {panel}
              </div>
            </>
          )}
        </div>

      ) : (
        // ── Lista: el árbol a la izquierda, su contenido a la derecha ──
        <div className="lg:grid lg:grid-cols-[300px_1fr] lg:gap-4 lg:h-[calc(100vh-300px)]">

          <div className={`${hayPanel ? 'hidden lg:flex' : 'flex'} flex-col min-h-0
            bg-white rounded-2xl border border-gray-100 overflow-hidden`}>

            <div className="px-3 py-3 border-b border-gray-100">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <FolderTree size={15} className="text-gray-400" />
                Ubicaciones
              </h2>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-0.5">
              {arbol.map((nodo) => (
                <NodoArbol
                  key={nodo.id}
                  nodo={nodo}
                  seleccion={seleccion}
                  onSeleccionar={setSeleccion}
                  expandidos={expandidos}
                  onExpandir={expandir}
                />
              ))}

              {!arbol.length && (
                <EmptyState
                  icon={MapPin}
                  titulo="Todavía no hay ubicaciones"
                  descripcion={esAdmin
                    ? 'Crea la primera: una bodega, un estante, una vitrina.'
                    : 'Pídele a un administrador que cree las ubicaciones de esta sede.'}
                />
              )}

              <button
                type="button"
                onClick={() => setSeleccion({ tipo: 'sin-ubicar' })}
                className={`mt-2 flex items-center gap-2 px-3 py-2.5 rounded-xl text-left
                  border border-dashed transition-colors
                  ${seleccion?.tipo === 'sin-ubicar'
                    ? 'bg-blue-50 border-blue-300'
                    : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <Inbox size={15} className="text-gray-400 flex-shrink-0" />
                <span className={`flex-1 text-sm truncate
                  ${seleccion?.tipo === 'sin-ubicar' ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>
                  Sin ubicar
                </span>
                {sinAsignar.length > 0 && (
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5
                    rounded-md tabular-nums flex-shrink-0">
                    {sinAsignar.length >= TOPE_LISTA ? `${TOPE_LISTA}+` : sinAsignar.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className={`${hayPanel ? 'flex' : 'hidden lg:flex'} flex-col min-h-0
            bg-white rounded-2xl border border-gray-100 overflow-hidden`}>
            {hayPanel ? panel : (
              <EmptyState
                icon={MapPin}
                titulo="Elige una ubicación"
                descripcion="Navega por el espacio y mira qué hay guardado en cada sitio."
              />
            )}
          </div>
        </div>
      )}

      {/* Se montan solo mientras están abiertos: el formulario nace con los
          valores que toca y no hace falta un efecto que lo resincronice al
          abrir. La `key` del de edición fuerza el remonte al pasar de una
          ubicación a otra sin cerrar. */}
      {modalNueva && (
        <ModalUbicacion
          open
          onClose={() => setModalNueva(false)}
          ubicacion={null}
          arbol={arbol}
          padrePorDefecto={padreSugerido}
        />
      )}

      {editando && (
        <ModalUbicacion
          open
          key={`edit-${editando.id}`}
          onClose={() => setEditando(null)}
          ubicacion={editando}
          arbol={arbol}
        />
      )}
    </div>
  );
}
