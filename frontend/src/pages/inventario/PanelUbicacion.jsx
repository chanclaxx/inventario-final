import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ScanLine, Pencil, Trash2, Inbox, PackageOpen, Check,
  ChevronRight, Loader2, Boxes, History, Package,
} from 'lucide-react';
import { Button }      from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/SearchInput';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { getItemsUbicacion, getSinAsignar, eliminarUbicacion, moverAUbicacion } from '../../api/ubicaciones.api';
import { escanearCodigo } from '../../api/busqueda.api';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { ModalMoverUbicacion } from './ModalMoverUbicacion';
import { HistorialUbicacion } from './HistorialUbicacion';
import {
  NIVELES, ESTADOS, claveNodo, ICONOS_UBICACION, ICONO_POR_DEFECTO, claseColor, TOPE_LISTA,
} from '../../utils/ubicaciones';

// ─────────────────────────────────────────────────────────────────────────────
// Qué hay en una ubicación (o en la bandeja de "Sin ubicar").
//
// Dos cosas hacen que esto se mantenga vivo en una bodega real y no se vuelva
// decorativo a las dos semanas:
//
//   1. ESCANEAR PARA GUARDAR. El lector es un teclado: teclea el código y manda
//      Enter. Reusamos `GET /busqueda/escaneo/:codigo`, que ya resuelve los tres
//      niveles del árbol y los IMEI, así que "guardar en el estante" es apuntar
//      y pitar. Escribir a mano lo que ya está impreso en la caja no lo hace
//      nadie dos días seguidos.
//   2. MOVER EN LOTE. El caso real es "agarro seis cosas y las paso al Cajón B7".
//
// A diferencia del carrito, aquí NO hace falta bajar al nodo hoja: la ubicación
// describe, no mueve stock, así que escanear el código del producto y decir
// "toda la correa está aquí" es una respuesta válida y útil.
// ─────────────────────────────────────────────────────────────────────────────

const PESTANAS = [
  { id: 'contenido', label: 'Contenido', Icn: Package },
  { id: 'historial', label: 'Historial', Icn: History },
];

function ChipNivel({ nivel }) {
  const def = NIVELES[nivel];
  if (!def) return null;
  return (
    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${def.clase}`}>
      {def.label}
    </span>
  );
}

function ChipEstado({ estado }) {
  const def = ESTADOS[estado];
  if (!def) return null;
  return (
    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${def.clase}`}>
      {def.label}
    </span>
  );
}

function FilaItem({ item, seleccionado, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(item)}
      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left
        transition-colors ${seleccionado ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
    >
      <span className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center
        ${seleccionado ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}`}>
        {seleccionado && <Check size={11} className="text-white" strokeWidth={3} />}
      </span>

      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-900 truncate">
          {item.nombre}
        </span>
        {item.detalle && (
          <span className="block text-xs text-gray-500 truncate">{item.detalle}</span>
        )}
        <span className="flex flex-wrap items-center gap-1 mt-1">
          <ChipNivel nivel={item.nivel} />
          <ChipEstado estado={item.estado} />
          {/* `parcial` no habla del producto sino de la UBICACIÓN: parte de sus
              ramas o de sus unidades está guardada en otro sitio. Sin este
              aviso, la cifra de al lado sería una media verdad. */}
          {item.parcial && (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-orange-50 text-orange-700">
              parte en otro sitio
            </span>
          )}
          {item.imei && (
            <span className="text-[10px] text-gray-400 font-mono">{item.imei}</span>
          )}
          {item.codigo && !item.imei && (
            <span className="text-[10px] text-gray-400 font-mono">{item.codigo}</span>
          )}
        </span>
      </span>

      <span className="text-right flex-shrink-0">
        <span className="block text-sm font-semibold text-gray-900 tabular-nums">
          {item.stock}
        </span>
        <span className="block text-[10px] text-gray-400">
          {item.stock === 1 ? 'unidad' : 'unidades'}
        </span>
      </span>
    </button>
  );
}

// ── Escanear para guardar aquí ──────────────────────────────────────────────
function BarraEscanearAqui({ ubicacionId, onAsignado }) {
  const [codigo,  setCodigo]  = useState('');
  const [mensaje, setMensaje] = useState(null); // { tipo: 'ok'|'error', texto }
  const [ocupado, setOcupado] = useState(false);
  const inputRef = useRef(null);

  const resolverYGuardar = async (valor) => {
    const limpio = valor.trim();
    if (!limpio) return;

    setOcupado(true);
    setMensaje(null);
    try {
      const { data } = await escanearCodigo(limpio);
      const res = data?.data;

      let item = null;
      let etiqueta = '';

      if (res?.tipo === 'serial') {
        // Una unidad concreta. Este es el caso que hace personalizable la
        // granularidad: un equipo en la vitrina y otro idéntico en la caja
        // fuerte, sin que haga falta ningún interruptor.
        item = { nivel: 'unidad', id: res.serial.id };
        etiqueta = `${res.serial.producto_nombre} · ${res.serial.imei}`;
      } else if (res?.tipo === 'cantidad') {
        const nodos = res.nodos ?? [];
        if (nodos.length !== 1) {
          // El módulo garantiza un código = un nodo por sucursal, así que esto
          // solo pasa si los datos se rompieron. Se dice, no se adivina.
          setMensaje({
            tipo: 'error',
            texto: `Ese código está en ${nodos.length} sitios del catálogo. Búscalo y muévelo a mano.`,
          });
          return;
        }
        item = { nivel: nodos[0].nivel, id: nodos[0].id };
        etiqueta = nodos[0].etiqueta;
      } else {
        setMensaje({ tipo: 'error', texto: 'Código o IMEI no encontrado' });
        return;
      }

      await moverAUbicacion({ ubicacion_id: ubicacionId, items: [item] });
      setMensaje({ tipo: 'ok', texto: `${etiqueta} guardado aquí` });
      onAsignado();
    } catch (err) {
      setMensaje({
        tipo: 'error',
        texto: err?.response?.data?.error ?? 'No se pudo guardar',
      });
    } finally {
      setOcupado(false);
      setCodigo('');
      // El lector encadena lecturas: si el foco se pierde, la siguiente se
      // teclea en cualquier parte de la página.
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={codigo}
          disabled={ocupado}
          onChange={(e) => setCodigo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); resolverYGuardar(codigo); }
          }}
          placeholder="Escanea un código o IMEI para guardarlo aquí"
          className="w-full pl-9 pr-9 py-2.5 bg-white border border-blue-200 rounded-xl text-sm
            text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2
            focus:ring-blue-500 transition-all disabled:opacity-60"
        />
        {ocupado && (
          <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-500 animate-spin" />
        )}
      </div>

      {mensaje && (
        <p className={`text-xs px-1 ${mensaje.tipo === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}

export function PanelUbicacion({ modo, ubicacion, arbol, esAdmin, onVolver, onEditar }) {
  const queryClient = useQueryClient();
  const { sucursalKey, sucursalLista } = useSucursalKey();

  const esBandeja = modo === 'sin-ubicar';

  // No hace falta limpiar esto al cambiar de ubicación: `TabUbicaciones` le pone
  // una `key` por sitio, así que el panel se remonta y todo nace vacío.
  // Arrastrar marcados de un estante al siguiente terminaría moviendo cosas que
  // nadie quiso mover.
  const [pestana,     setPestana]     = useState('contenido');
  const [busqueda,    setBusqueda]    = useState('');
  const [marcados,    setMarcados]    = useState(new Set());
  const [modalMover,  setModalMover]  = useState(false);
  const [errorBorrar, setErrorBorrar] = useState(null);

  const idUbicacion = ubicacion?.id ?? null;
  // La bandeja no tiene historial: no es un sitio del que algo entre o salga.
  const verContenido = esBandeja || pestana === 'contenido';

  const { data: items = [], isLoading } = useQuery({
    queryKey: esBandeja
      ? ['ubicaciones-sin-asignar', ...sucursalKey, busqueda]
      : ['ubicaciones-items', ...sucursalKey, idUbicacion, busqueda],
    // 500 es el tope que acepta el backend. No hay paginación: una ubicación
    // física con más de 500 nodos distintos no existe en la práctica, y si
    // apareciera, el aviso de abajo manda a usar el buscador en vez de mentir
    // con una lista cortada en silencio.
    queryFn: () => (esBandeja
      ? getSinAsignar({ q: busqueda || undefined, limit: TOPE_LISTA })
      : getItemsUbicacion(idUbicacion, { q: busqueda || undefined, limit: TOPE_LISTA })
    ).then((r) => r.data.data),
    enabled: sucursalLista && (esBandeja || !!idUbicacion),
    // El buscador escribe letra a letra; sin esto cada tecla es un viaje.
    staleTime: 15_000,
  });

  const borrar = useMutation({
    mutationFn: () => eliminarUbicacion(idUbicacion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ubicaciones-arbol'] });
      queryClient.invalidateQueries({ queryKey: ['ubicaciones'] });
      onVolver();
    },
    // El backend responde 409 con un mensaje que ya explica qué hacer
    // ("todavía tiene 4 productos. Muévelos antes de eliminarla").
    onError: (err) => setErrorBorrar(
      err?.response?.data?.error ?? 'No se pudo eliminar la ubicación'
    ),
  });

  const alternar = (item) => {
    const clave = claveNodo(item);
    setMarcados((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });
  };

  const seleccionados = useMemo(
    () => items.filter((i) => marcados.has(claveNodo(i))),
    [items, marcados]
  );

  const todosMarcados = items.length > 0 && seleccionados.length === items.length;

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['ubicaciones-items'] });
    queryClient.invalidateQueries({ queryKey: ['ubicaciones-sin-asignar'] });
    queryClient.invalidateQueries({ queryKey: ['ubicaciones-arbol'] });
    queryClient.invalidateQueries({ queryKey: ['ubicaciones-movimientos'] });
  };

  const Icono = esBandeja ? Inbox : (ICONOS_UBICACION[ubicacion?.tipo] ?? ICONO_POR_DEFECTO);

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Cabecera ── */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onVolver}
            aria-label="Volver a la lista"
            className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            <ArrowLeft size={18} className="text-gray-600" />
          </button>

          <div className="flex-1 min-w-0">
            {/* Migas de pan: una transición dice cómo llegaste, no dónde estás. */}
            {!esBandeja && ubicacion?.ruta?.length > 1 && (
              <p className="flex items-center gap-1 text-xs text-gray-400 mb-0.5 flex-wrap">
                {ubicacion.ruta.slice(0, -1).map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1">
                    {r.nombre}
                    <ChevronRight size={11} />
                  </span>
                ))}
              </p>
            )}

            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              {!esBandeja && (
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${claseColor(ubicacion?.color)}`} />
              )}
              <Icono size={18} className="text-gray-400 flex-shrink-0" />
              <span className="truncate">{esBandeja ? 'Sin ubicar' : ubicacion?.nombre}</span>
            </h2>

            <p className="text-xs text-gray-400 mt-0.5">
              {esBandeja
                ? 'Productos que no se pueden encontrar: sin ubicación propia ni heredada.'
                // El conteo sale del árbol (una agregación del backend), no de
                // `items.length`, que es solo lo que se alcanzó a traer.
                : (ubicacion?.descripcion
                   || `${ubicacion?.items ?? items.length} ${(ubicacion?.items ?? items.length) === 1 ? 'producto' : 'productos'}`)}
            </p>
          </div>

          {!esBandeja && esAdmin && (
            <div className="flex gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => onEditar(ubicacion)}
                aria-label="Editar ubicación"
                className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
              >
                <Pencil size={16} className="text-gray-500" />
              </button>
              <button
                type="button"
                onClick={() => borrar.mutate()}
                disabled={borrar.isPending}
                aria-label="Eliminar ubicación"
                className="p-2 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                <Trash2 size={16} className="text-red-500" />
              </button>
            </div>
          )}
        </div>

        {errorBorrar && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {errorBorrar}
          </p>
        )}

        {/* El historial es de un SITIO, así que no aplica a la bandeja: "sin
            ubicar" no es un lugar del que algo entre o salga. */}
        {!esBandeja && (
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {PESTANAS.map((p) => {
              const Icn = p.Icn;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPestana(p.id)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium
                    transition-all ${pestana === p.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Icn size={13} />
                  {p.label}
                </button>
              );
            })}
          </div>
        )}

        {verContenido && (
          <>
            {!esBandeja && (
              <BarraEscanearAqui ubicacionId={idUbicacion} onAsignado={refrescar} />
            )}

            <SearchInput
              value={busqueda}
              onChange={setBusqueda}
              placeholder={esBandeja ? 'Buscar entre lo que falta ubicar…' : 'Buscar aquí dentro…'}
            />
          </>
        )}
      </div>

      {!verContenido && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <HistorialUbicacion ubicacionId={idUbicacion} />
        </div>
      )}

      {/* ── Lista ──
          Se OCULTA en vez de desmontarse: volver del historial es instantáneo y
          la selección múltiple sigue donde estaba. */}
      <div className={`flex-1 min-h-0 overflow-y-auto px-1 py-2 ${verContenido ? '' : 'hidden'}`}>
        {isLoading ? (
          <Spinner className="py-16" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={esBandeja ? Check : PackageOpen}
            titulo={esBandeja
              ? (busqueda ? 'Nada coincide' : 'Todo está ubicado')
              : (busqueda ? 'Nada coincide' : 'Esta ubicación está vacía')}
            descripcion={esBandeja
              ? (busqueda ? 'Prueba con otro texto.' : 'Cada producto del inventario tiene un sitio donde encontrarlo.')
              : (busqueda ? 'Prueba con otro texto.' : 'Escanea un código arriba para guardar algo aquí.')}
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <FilaItem
                key={claveNodo(item)}
                item={item}
                seleccionado={marcados.has(claveNodo(item))}
                onToggle={alternar}
              />
            ))}

            {items.length >= TOPE_LISTA && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 m-2">
                Se muestran los primeros {TOPE_LISTA}. Usa el buscador para
                encontrar algo concreto.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Barra de selección ── */}
      {verContenido && seleccionados.length > 0 && (
        <div className="border-t border-gray-100 bg-white px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMarcados(todosMarcados
              ? new Set()
              : new Set(items.map(claveNodo)))}
            className="text-xs text-blue-600 hover:underline flex-shrink-0"
          >
            {todosMarcados ? 'Quitar todo' : `Todos (${items.length})`}
          </button>

          <span className="text-sm text-gray-600 flex-1 min-w-0 truncate">
            {seleccionados.length} {seleccionados.length === 1 ? 'seleccionado' : 'seleccionados'}
          </span>

          <Button size="sm" onClick={() => setModalMover(true)}>
            <Boxes size={15} />
            Mover
          </Button>
        </div>
      )}

      <ModalMoverUbicacion
        open={modalMover}
        onClose={() => setModalMover(false)}
        items={seleccionados}
        arbol={arbol}
        origenId={idUbicacion}
        onMovido={() => setMarcados(new Set())}
      />
    </div>
  );
}
