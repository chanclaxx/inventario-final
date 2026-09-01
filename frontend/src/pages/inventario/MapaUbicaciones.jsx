import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Pencil, Check, ChevronRight, Move, Home, MapPin,
} from 'lucide-react';
import { Button }     from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { guardarGeometriaUbicaciones } from '../../api/ubicaciones.api';
import {
  MUNDO, REJILLA, disponerEnLienzo, aRejilla, colorHex, rutaDe,
  encuadreDe, camaraHacia, transformCamara,
} from '../../utils/ubicaciones';

// ─────────────────────────────────────────────────────────────────────────────
// El mapa: navegar el espacio en vez de buscar el producto.
//
// ── La cámara, no un modal ──────────────────────────────────────────────────
// Al tocar una ubicación, el nivel actual se AGRANDA hasta que esa ubicación
// llena la pantalla, y entonces aparece lo que hay dentro. La diferencia con
// abrir un modal no es estética: el rectángulo que tocaste crece hacia ti, así
// que el usuario nunca pierde el hilo de dónde está. Volver es la misma curva
// al revés.
//
// Se anima con la Web Animations API y no con un efecto de React a propósito:
// `element.animate()` devuelve una promesa que se resuelve al terminar, así que
// el cambio de nivel se encadena desde el propio manejador del clic. Con un
// `useEffect` haría falta sincronizar estado en el efecto, que es una cascada de
// renders y además el linter lo rechaza.
//
// ── Un nivel del árbol es un nivel de zoom ──────────────────────────────────
// Solo se dibuja el nivel actual. Renderizar los cuatro niveles a la vez a
// escala real haría que un bin dentro de un estante dentro de una bodega fuera
// una mota de tres píxeles: ilegible arriba e inútil abajo. Por eso agregar un
// nivel («Nivel 2» dentro de «Estante 1») no toca nada del mapa — es una fila
// más con `padre_id`, y la cámara ya sabe entrar en ella.
//
// ── El mapa es una VISTA ────────────────────────────────────────────────────
// Todo lo que se hace aquí se puede hacer en la pestaña Lista, que es la que
// funciona en un celular de 5" entre estantes y la que se navega con teclado.
// Un negocio que no ha dibujado nada tiene igualmente sus ubicaciones colocadas
// solas en cuadrícula: el mapa nunca es requisito para usar la feature.
// ─────────────────────────────────────────────────────────────────────────────

const DURACION = 340;

const sinMovimiento = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Punto del evento en coordenadas del lienzo. `getScreenCTM` incluye el
// viewBox y el tamaño real en pantalla, así que el arrastre funciona igual en
// un monitor que en un móvil sin tener que saber cuánto mide el SVG.
const puntoMundo = (svg, e) => {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
};

function CajaUbicacion({
  nodo, editando, seleccionada, onEntrar, onArrastrar, onSoltar,
}) {
  const color = colorHex(nodo.color);
  const { x, y, w, h } = nodo;

  // Con la caja muy pequeña el texto sale encima de sí mismo; se prefiere una
  // caja limpia con su contador a una ilegible con tres líneas.
  const cabeNombre  = w > 90 && h > 60;
  const cabeContador = w > 60 && h > 40;

  const arrastre = useRef(null);

  const alBajar = (e) => {
    if (!editando) return;
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement;
    const p = puntoMundo(svg, e);
    arrastre.current = { modo: 'mover', dx: p.x - x, dy: p.y - y, movido: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const alBajarAsa = (e) => {
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement;
    const p = puntoMundo(svg, e);
    arrastre.current = { modo: 'redimensionar', dx: p.x - (x + w), dy: p.y - (y + h), movido: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const alMover = (e) => {
    if (!arrastre.current) return;
    const svg = e.currentTarget.ownerSVGElement;
    const p = puntoMundo(svg, e);
    arrastre.current.movido = true;

    if (arrastre.current.modo === 'mover') {
      onArrastrar(nodo.id, {
        x: aRejilla(p.x - arrastre.current.dx, 0, MUNDO - w),
        y: aRejilla(p.y - arrastre.current.dy, 0, MUNDO - h),
        w, h,
      });
    } else {
      // Mínimo de dos casillas: por debajo de eso la caja deja de poder
      // tocarse con el dedo y no hay forma de recuperarla.
      onArrastrar(nodo.id, {
        x, y,
        w: aRejilla(p.x - arrastre.current.dx - x, REJILLA * 2, MUNDO - x),
        h: aRejilla(p.y - arrastre.current.dy - y, REJILLA * 2, MUNDO - y),
      });
    }
  };

  const alSubir = (e) => {
    if (!arrastre.current) return;
    const movido = arrastre.current.movido;
    arrastre.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (movido) onSoltar();
  };

  return (
    <g
      onPointerDown={alBajar}
      onPointerMove={alMover}
      onPointerUp={alSubir}
      onPointerCancel={alSubir}
      onClick={() => { if (!editando) onEntrar(nodo); }}
      style={{ cursor: editando ? 'move' : 'pointer' }}
    >
      <rect
        x={x} y={y} width={w} height={h} rx={14}
        fill={color}
        fillOpacity={seleccionada ? 0.3 : 0.14}
        stroke={color}
        strokeWidth={seleccionada ? 5 : 3}
        strokeDasharray={nodo.auto ? '10 8' : undefined}
      />

      {cabeNombre && (
        <text
          x={x + 16} y={y + 38}
          fontSize={26} fontWeight={600} fill="#1f2937"
          style={{ pointerEvents: 'none' }}
        >
          {nodo.nombre.length > Math.floor(w / 14)
            ? `${nodo.nombre.slice(0, Math.floor(w / 14))}…`
            : nodo.nombre}
        </text>
      )}

      {cabeContador && (
        <text
          x={x + 16} y={y + h - 18}
          fontSize={22} fill="#6b7280"
          style={{ pointerEvents: 'none' }}
        >
          {nodo.items_total} {nodo.items_total === 1 ? 'producto' : 'productos'}
        </text>
      )}

      {/* Marca de que hay más adentro: es lo que invita a seguir bajando. */}
      {nodo.hijas?.length > 0 && (
        <>
          <circle cx={x + w - 26} cy={y + 26} r={15} fill={color} fillOpacity={0.9} />
          <text
            x={x + w - 26} y={y + 33} textAnchor="middle"
            fontSize={20} fontWeight={700} fill="#fff"
            style={{ pointerEvents: 'none' }}
          >
            {nodo.hijas.length}
          </text>
        </>
      )}

      {editando && (
        <rect
          x={x + w - 22} y={y + h - 22} width={26} height={26} rx={6}
          fill="#fff" stroke={color} strokeWidth={3}
          style={{ cursor: 'nwse-resize' }}
          onPointerDown={alBajarAsa}
          onPointerMove={alMover}
          onPointerUp={alSubir}
        />
      )}
    </g>
  );
}

// `padreId` (en qué nivel está la cámara) vive en el CONTENEDOR, no aquí: el
// buscador de "¿dónde está esto?" tiene que poder llevar el mapa a un estante
// concreto, y para eso necesita mandar sobre el nivel. Con el estado dentro del
// mapa haría falta un efecto que lo sincronizara desde fuera — cascada de
// renders, y el linter lo rechaza.
export function MapaUbicaciones({ arbol, esAdmin, seleccion, onSeleccionar, padreId, onNivel }) {
  const queryClient = useQueryClient();
  const svgRef   = useRef(null);
  const grupoRef = useRef(null);

  const [editando, setEditando] = useState(false);
  // Geometría en curso mientras se arrastra. Solo se manda al servidor al
  // soltar: guardar por píxel arrastrado son cientos de peticiones.
  const [borrador, setBorrador] = useState({});

  const guardar = useMutation({
    mutationFn: (posiciones) => guardarGeometriaUbicaciones(posiciones),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ubicaciones-arbol'] }),
  });

  const ruta   = useMemo(() => (padreId ? rutaDe(arbol, padreId) : []), [arbol, padreId]);
  const actual = ruta[ruta.length - 1] ?? null;

  const nodos = useMemo(() => {
    const hermanas = actual ? (actual.hijas ?? []) : arbol;
    return disponerEnLienzo(hermanas).map((n) => ({ ...n, ...(borrador[n.id] ?? {}) }));
  }, [arbol, actual, borrador]);

  const encuadre = useMemo(() => encuadreDe(nodos, editando), [nodos, editando]);

  // ── La cámara ─────────────────────────────────────────────────────────────
  const entrar = (nodo) => {
    // Una hoja no tiene adentro: se abre su detalle y la cámara se queda donde
    // está, porque bajar a un sitio vacío desorienta sin enseñar nada.
    if (!nodo.hijas?.length) {
      onSeleccionar({ tipo: 'ubicacion', id: Number(nodo.id) });
      return;
    }

    if (sinMovimiento() || !grupoRef.current?.animate) {
      onNivel(Number(nodo.id));
      onSeleccionar({ tipo: 'ubicacion', id: Number(nodo.id) });
      return;
    }

    grupoRef.current.animate(
      [{ transform: 'none', opacity: 1 },
       { transform: transformCamara(camaraHacia(nodo, encuadre)), opacity: 0 }],
      { duration: DURACION, easing: 'cubic-bezier(.4,0,.2,1)' }
    ).finished.then(() => {
      onNivel(Number(nodo.id));
      onSeleccionar({ tipo: 'ubicacion', id: Number(nodo.id) });
    }).catch(() => {});
  };

  const salir = () => {
    const salida = actual;
    const padre  = ruta.length > 1 ? Number(ruta[ruta.length - 2].id) : null;
    onNivel(padre);
    onSeleccionar(padre ? { tipo: 'ubicacion', id: padre } : null);

    if (sinMovimiento() || !grupoRef.current?.animate || !salida) return;

    // Al volver, el nivel de arriba entra DESDE el encuadre de la hija que se
    // deja: la misma curva al revés, así que el ojo sigue el recorrido.
    const caja = disponerEnLienzo(
      padre ? (rutaDe(arbol, padre).at(-1)?.hijas ?? []) : arbol
    ).find((n) => Number(n.id) === Number(salida.id));
    if (!caja) return;

    grupoRef.current.animate(
      [{ transform: transformCamara(camaraHacia(caja, encuadre)), opacity: 0 },
       { transform: 'none', opacity: 1 }],
      { duration: DURACION, easing: 'cubic-bezier(.4,0,.2,1)' }
    );
  };

  const irA = (id) => {
    onNivel(id);
    onSeleccionar(id ? { tipo: 'ubicacion', id } : null);
  };

  // ── El editor ─────────────────────────────────────────────────────────────
  const arrastrar = (id, caja) => setBorrador((prev) => ({ ...prev, [id]: caja }));

  const soltar = () => {
    const posiciones = Object.entries(borrador).map(([id, c]) => ({
      id: Number(id), pos_x: c.x, pos_y: c.y, ancho: c.w, alto: c.h,
    }));
    if (posiciones.length) guardar.mutate(posiciones);
  };

  // Al salir del modo edición se limpia el borrador: lo guardado ya volvió en
  // el árbol y quedarse con la copia local haría que un cambio hecho desde otra
  // pantalla no se viera.
  const alternarEdicion = () => {
    setEditando((e) => !e);
    setBorrador({});
  };

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Migas de pan y controles ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 flex-wrap">
        {padreId !== null && (
          <button
            type="button"
            onClick={salir}
            className="p-1.5 -ml-1 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Volver al nivel anterior"
          >
            <ArrowLeft size={16} className="text-gray-600" />
          </button>
        )}

        {/* Una animación dice cómo llegaste, no dónde estás. Las migas sí. */}
        <nav className="flex items-center gap-1 text-sm min-w-0 flex-1 flex-wrap">
          <button
            type="button"
            onClick={() => irA(null)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md
              hover:bg-gray-100 transition-colors
              ${padreId === null ? 'text-gray-900 font-medium' : 'text-gray-500'}`}
          >
            <Home size={13} />
            Toda la sede
          </button>

          {ruta.map((r, i) => (
            <span key={r.id} className="inline-flex items-center gap-1 min-w-0">
              <ChevronRight size={13} className="text-gray-300 flex-shrink-0" />
              <button
                type="button"
                onClick={() => irA(Number(r.id))}
                className={`px-1.5 py-0.5 rounded-md hover:bg-gray-100 transition-colors truncate
                  ${i === ruta.length - 1 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}
              >
                {r.nombre}
              </button>
            </span>
          ))}
        </nav>

        {esAdmin && nodos.length > 0 && (
          <Button
            size="sm"
            variant={editando ? 'success' : 'ghost'}
            onClick={alternarEdicion}
            loading={guardar.isPending}
          >
            {editando ? <Check size={15} /> : <Pencil size={15} />}
            {editando ? 'Listo' : 'Acomodar'}
          </Button>
        )}
      </div>

      {editando && (
        <p className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-xs text-blue-700">
          <Move size={13} className="flex-shrink-0" />
          Arrastra las cajas para acomodarlas como está la bodega de verdad.
          El cuadrito de la esquina cambia el tamaño. Se guarda al soltar.
        </p>
      )}

      {/* ── El lienzo ── */}
      <div className="flex-1 min-h-0 bg-gray-50 overflow-hidden">
        {nodos.length === 0 ? (
          <EmptyState
            icon={MapPin}
            titulo={actual ? `${actual.nombre} no tiene sub-ubicaciones` : 'Todavía no hay ubicaciones'}
            descripcion={actual
              ? 'Lo que hay guardado aquí se ve en el panel de la derecha.'
              : 'Crea la primera desde la pestaña Lista y aparecerá aquí sola.'}
          />
        ) : (
          <svg
            ref={svgRef}
            viewBox={`${encuadre.x} ${encuadre.y} ${encuadre.w} ${encuadre.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full"
            style={{ touchAction: editando ? 'none' : 'auto' }}
          >
            <g ref={grupoRef}>
              {nodos.map((nodo) => (
                <CajaUbicacion
                  key={nodo.id}
                  nodo={nodo}
                  editando={editando}
                  seleccionada={seleccion?.tipo === 'ubicacion'
                    && Number(seleccion.id) === Number(nodo.id)}
                  onEntrar={entrar}
                  onArrastrar={arrastrar}
                  onSoltar={soltar}
                />
              ))}
            </g>
          </svg>
        )}
      </div>

      {/* Las cajas de raya discontinua son las que nadie ha colocado: se
          acomodaron solas para que el mapa sirva desde el primer día. */}
      {!editando && nodos.some((n) => n.auto) && esAdmin && (
        <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
          Las cajas punteadas están acomodadas automáticamente. Usa «Acomodar»
          para ponerlas como está la bodega de verdad.
        </p>
      )}
    </div>
  );
}
