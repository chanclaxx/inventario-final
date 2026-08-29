import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Printer, Download, Barcode, QrCode, AlertTriangle, Wand2, Check,
  ChevronDown, ChevronRight, Sliders, Package,
} from 'lucide-react';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Spinner }     from '../../components/ui/Spinner';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState }  from '../../components/ui/EmptyState';
import { getLineas }        from '../../api/productos.api';
import { getUbicaciones }   from '../../api/ubicaciones.api';
import {
  getFormatosEtiqueta, getNodosEtiqueta, planEtiquetas, generarCodigosEtiqueta,
} from '../../api/etiquetas.api';
import { useAuth }        from '../../context/useAuth';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import useEtiquetas, { leerPreferencias, guardarPreferencias } from '../../hooks/useEtiquetas';

// ─────────────────────────────────────────────────────────────────────────────
// IMPRIMIR ETIQUETAS — masivo e individual en la misma pantalla
//
// Son el mismo trabajo con distinto alcance, así que es un solo modal: abierto
// desde una tarjeta llega con `nodoInicial` y se salta la selección; abierto
// desde la barra de Inventario empieza por elegir qué etiquetar. Dos pantallas
// separadas acabarían con dos juegos de opciones que se contradicen.
//
// La VISTA PREVIA es el PDF de verdad recortado a una página, no un dibujo
// hecho aquí: el reparto del espacio de la etiqueta vive en el backend
// (`etiquetas.layout.js`) y reimplementarlo en el navegador es cómo las dos
// copias acaban diciendo cosas distintas. Lo que se ve en el recuadro es
// literalmente lo que sale por la impresora.
// ─────────────────────────────────────────────────────────────────────────────

const clave = (n) => `${n.nivel}:${n.producto_id}:${n.atributo_id ?? ''}:${n.variante_id ?? ''}`;
const idNodo = (n) => ({
  nivel: n.nivel,
  producto_id: n.producto_id,
  atributo_id: n.atributo_id ?? null,
  variante_id: n.variante_id ?? null,
});

const TEXTO_AVISO = {
  modulo_estrecho:      'El código queda demasiado apretado para esta etiqueta: puede que el lector falle. Usa un formato más grande, códigos más cortos o cambia a QR.',
  sin_espacio_precio:   'No cabe el precio y se quitó.',
  sin_espacio_encabezado: 'No cabe el encabezado y se quitó.',
  sin_espacio_variante: 'No cabe la variante y se quitó.',
  sin_espacio_nombre:   'No cabe el nombre y se quitó.',
};

// ── Tarjeta de opción (mismo patrón que Exportar inventario) ─────────────────
function Opcion({ activo, onClick, icon: Icono, titulo, desc, className = '' }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`flex flex-col gap-1 p-3 rounded-xl border-2 text-left transition-all
        ${activo ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'} ${className}`}
    >
      <span className="flex items-center gap-2">
        {Icono && <Icono size={15} className={activo ? 'text-blue-600' : 'text-gray-400'} />}
        <span className={`text-sm font-semibold ${activo ? 'text-blue-700' : 'text-gray-700'}`}>{titulo}</span>
      </span>
      {desc && <span className="text-xs text-gray-400 leading-snug">{desc}</span>}
    </button>
  );
}

function Casilla({ activo, onClick, children }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
        ${activo ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
    >
      {activo && <Check size={12} />}
      {children}
    </button>
  );
}

// ── Panel: generar códigos a los que no tienen ───────────────────────────────
//
// Sin esto la impresión masiva no sirve de nada. Un negocio que acaba de
// encender la feature tiene cientos de nodos sin código, y nadie va a abrirlos
// uno por uno para escribirlo a mano.
function PanelGenerar({ nodos, onListo, onCerrar }) {
  const [prefijo,  setPrefijo]  = useState('');
  const [longitud, setLongitud] = useState(6);
  const [corriendo, setCorriendo] = useState(false);
  const [avance,   setAvance]   = useState(0);
  const [error,    setError]    = useState('');

  const TANDA = 200;

  const generar = async () => {
    setCorriendo(true); setError(''); setAvance(0);
    try {
      let hechos = 0;
      // Por tandas: cada llamada escribe, hereda y propaga varias consultas por
      // nodo, y una sola petición con 800 nodos se pasaría del tiempo de espera
      // del navegador — que desde la pantalla se ve como "no se pudo", sobre una
      // operación que en realidad iba por la mitad.
      for (let i = 0; i < nodos.length; i += TANDA) {
        const lote = nodos.slice(i, i + TANDA).map(idNodo);
        const { data } = await generarCodigosEtiqueta({ seleccion: lote, prefijo, longitud });
        hechos += data.data.asignados;
        setAvance(Math.min(i + TANDA, nodos.length));
      }
      await onListo(hechos);
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudieron generar los códigos');
    } finally { setCorriendo(false); }
  };

  return (
    <div className="flex flex-col gap-3 p-3 rounded-xl border-2 border-amber-200 bg-amber-50">
      <p className="text-sm text-amber-800">
        <strong>{nodos.length}</strong> {nodos.length === 1 ? 'producto no tiene' : 'productos no tienen'} código.
        Sin código no hay nada que imprimir en ellos.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-28">
          <Input label="Prefijo (opcional)" value={prefijo} maxLength={8}
            placeholder="Ej: AC"
            onChange={(e) => setPrefijo(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} />
        </div>
        <div className="w-24">
          <Input label="Dígitos" type="number" min="4" max="10" value={longitud}
            onChange={(e) => setLongitud(e.target.value)} />
        </div>
        <Button size="sm" onClick={generar} loading={corriendo} className="mb-0.5">
          <Wand2 size={14} />
          {corriendo ? `${avance}/${nodos.length}...` : 'Generar códigos'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCerrar} disabled={corriendo} className="mb-0.5">
          Ahora no
        </Button>
      </div>
      <p className="text-xs text-amber-700">
        Se numeran de forma consecutiva y solo se tocan los que están vacíos: un código
        ya impreso nunca se cambia. Sin prefijo salen puramente numéricos, que es lo
        que hace el código de barras más angosto y más fácil de leer.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ── Fila de la lista de selección ────────────────────────────────────────────
function FilaNodo({ n, marcado, onToggle, cantidad, onCantidad, modoManual }) {
  const sinCodigo = !n.codigo;
  return (
    <div
      onClick={() => !sinCodigo && onToggle()}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors
        ${sinCodigo ? 'border-gray-100 bg-gray-50 opacity-60'
          : marcado ? 'border-blue-300 bg-blue-50 cursor-pointer'
            : 'border-gray-100 bg-white hover:border-gray-300 cursor-pointer'}`}
    >
      <div className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center
        ${marcado ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
        {marcado && <Check size={11} className="text-white" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate">{n.nombre}</p>
        <p className="text-xs text-gray-400 truncate">
          {n.variante_label && <span className="text-gray-500">{n.variante_label} · </span>}
          {sinCodigo
            ? <span className="text-amber-600 font-medium">sin código</span>
            : <span className="font-mono">{n.codigo}</span>}
          {n.ubicacion && <span> · {n.ubicacion}</span>}
        </p>
      </div>

      <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">{n.stock} uds</span>

      {modoManual && marcado && (
        <input
          type="number" min="0" max="999" value={cantidad}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onCantidad(e.target.value)}
          className="w-14 px-1.5 py-1 text-xs text-center border border-gray-200 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export function ModalEtiquetas({ onClose, nodoInicial = null, ubicacionActiva = false }) {
  const { esAdminNegocio } = useAuth();
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const queryClient = useQueryClient();
  const { generando, error, imprimir, descargar, previsualizar } = useEtiquetas();

  const individual = !!nodoInicial;

  const [prefs, setPrefs] = useState(leerPreferencias);
  const cambiar = (parcial) => {
    const nuevo = { ...prefs, ...parcial };
    setPrefs(nuevo);
    guardarPreferencias(nuevo);
  };

  // ── Selección ──────────────────────────────────────────────────────────────
  const [busqueda,   setBusqueda]   = useState('');
  const [lineaId,    setLineaId]    = useState('');
  const [ubicacion,  setUbicacion]  = useState('');
  const [conStock,   setConStock]   = useState(false);
  const [soloSinCod, setSoloSinCod] = useState(false);
  const [marcados,   setMarcados]   = useState({});   // clave → cantidad
  const [mostrarGenerar, setMostrarGenerar] = useState(false);
  const [avanzado,   setAvanzado]   = useState(false);
  const [cantidadIndividual, setCantidadIndividual] = useState(1);

  const { data: formatos = [] } = useQuery({
    queryKey: ['etiquetas-formatos'],
    queryFn:  () => getFormatosEtiqueta().then((r) => r.data.data),
    staleTime: Infinity,   // el catálogo no cambia mientras la app está abierta
  });

  const { data: lineas = [] } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
    enabled:  !individual,
  });

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', ...sucursalKey],
    queryFn:  () => getUbicaciones().then((r) => r.data.data),
    enabled:  !individual && ubicacionActiva && sucursalLista,
    staleTime: 60_000,
  });

  const { data: listado, isLoading: cargandoNodos, refetch: recargarNodos } = useQuery({
    queryKey: ['etiquetas-nodos', ...sucursalKey, busqueda, lineaId, ubicacion, conStock, soloSinCod],
    queryFn:  () => getNodosEtiqueta({
      q: busqueda || undefined,
      linea_id:  lineaId || undefined,
      ubicacion: ubicacion || undefined,
      con_stock: conStock ? '1' : undefined,
      codigo:    soloSinCod ? 'sin' : undefined,
    }).then((r) => r.data.data),
    enabled: !individual && sucursalLista,
  });

  const nodos = useMemo(() => listado?.nodos || [], [listado]);
  const sinCodigoFiltrados = useMemo(() => nodos.filter((n) => !n.codigo), [nodos]);

  const seleccion = useMemo(() => {
    if (individual) {
      return [{ ...idNodo(nodoInicial), cantidad: Number(cantidadIndividual) || 1 }];
    }
    return nodos.filter((n) => marcados[clave(n)] !== undefined)
      .map((n) => ({ ...idNodo(n), cantidad: marcados[clave(n)] }));
  }, [individual, nodoInicial, cantidadIndividual, nodos, marcados]);

  // ── Cuerpo compartido por previa, plan y PDF ───────────────────────────────
  const cuerpo = useMemo(() => ({
    seleccion,
    formato:      prefs.formato,
    personalizado: prefs.formato === 'personalizado' ? prefs.personalizado : undefined,
    simbologia:   prefs.simbologia,
    mostrar:      prefs.mostrar,
    marco:        prefs.marco,
    ajuste:       prefs.ajuste,
    desde:        prefs.desde || 1,
    // En individual la cantidad la pone el input; en masivo manda el modo.
    cantidadModo: individual ? 'manual' : prefs.cantidadModo,
  }), [seleccion, prefs, individual]);

  // ── Plan (cuántas etiquetas, cuántas hojas, qué puede salir mal) ───────────
  //
  // Con retardo, no en cada tecla: marcar veinte productos seguidos dispararía
  // veinte peticiones y el usuario vería parpadear cifras que ya no valen.
  // Todo `setState` va DENTRO del temporizador — hacerlo en el cuerpo del efecto
  // encadena renders (y lo prohíbe la regla del compilador de React).
  const [plan, setPlan] = useState(null);
  const hayItems = seleccion.length > 0;
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      if (!hayItems) { setPlan(null); return; }
      planEtiquetas(cuerpo)
        .then((r) => { if (vivo) setPlan(r.data.data); })
        .catch(() => { if (vivo) setPlan(null); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [cuerpo, hayItems]);

  // ── Vista previa: el PDF real, una página ─────────────────────────────────
  //
  // Retardo más largo que el del plan: la previa cuesta generar un PDF, y lo que
  // el usuario está tocando cuando importa (formato, simbología) cambia de golpe,
  // no letra a letra.
  const [previa, setPrevia] = useState(null);
  const previaAnterior = useRef(null);
  const porPagina = plan?.porPagina;
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      if (!hayItems) { setPrevia(null); return; }
      const url = await previsualizar({ ...cuerpo, limite: porPagina || 12 });
      if (!vivo) { if (url) URL.revokeObjectURL(url); return; }
      // Liberar la anterior recién ahora: revocarla antes deja el recuadro en
      // blanco mientras se genera la nueva.
      if (previaAnterior.current) URL.revokeObjectURL(previaAnterior.current);
      previaAnterior.current = url;
      setPrevia(url);
    }, 600);
    return () => { vivo = false; clearTimeout(t); };
  }, [cuerpo, hayItems, porPagina, previsualizar]);

  useEffect(() => () => {
    if (previaAnterior.current) URL.revokeObjectURL(previaAnterior.current);
  }, []);

  const formatoActual = formatos.find((f) => f.id === prefs.formato)
    || (prefs.formato === 'personalizado' ? { medio: prefs.personalizado.medio, porHoja: null } : null);
  const esHoja = formatoActual?.medio === 'hoja';

  const alternar = (n) => setMarcados((m) => {
    const k = clave(n);
    const copia = { ...m };
    if (k in copia) delete copia[k];
    else copia[k] = 1;
    return copia;
  });

  const marcarTodos = () => setMarcados(
    Object.fromEntries(nodos.filter((n) => n.codigo).map((n) => [clave(n), 1])),
  );

  const totalSeleccionado = seleccion.length;
  const avisosReales = (plan?.avisos || []).filter((a) => TEXTO_AVISO[a]);

  return (
    <Modal
      open onClose={onClose}
      size={individual ? 'xl' : '2xl'}
      title={individual ? 'Imprimir etiqueta' : 'Imprimir etiquetas'}
    >
      <div className={`grid gap-5 ${individual ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'}`}>

        {/* ══ Columna 1 — qué imprimir ══════════════════════════════════════ */}
        {!individual && (
          <div className="flex flex-col gap-3 min-w-0">
            <SearchInput value={busqueda} onChange={setBusqueda}
              placeholder="Buscar producto, variante o código..." />

            <div className="flex flex-wrap items-center gap-2">
              {lineas.length > 0 && (
                <select
                  value={lineaId} onChange={(e) => setLineaId(e.target.value)}
                  className="flex-1 min-w-[8rem] px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                >
                  <option value="">Todas las líneas</option>
                  {lineas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
              )}
              {ubicacionActiva && ubicaciones.length > 0 && (
                <select
                  value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}
                  className="flex-1 min-w-[8rem] px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                >
                  <option value="">Todas las ubicaciones</option>
                  {ubicaciones.map((u) => (
                    <option key={u.ubicacion} value={u.ubicacion}>{u.ubicacion} ({u.productos})</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Casilla activo={conStock}   onClick={() => setConStock((v) => !v)}>Solo con stock</Casilla>
              <Casilla activo={soloSinCod} onClick={() => setSoloSinCod((v) => !v)}>Solo sin código</Casilla>
            </div>

            {/* Generar códigos: la puerta de entrada real a la impresión masiva */}
            {sinCodigoFiltrados.length > 0 && esAdminNegocio() && (
              mostrarGenerar ? (
                <PanelGenerar
                  nodos={sinCodigoFiltrados}
                  onCerrar={() => setMostrarGenerar(false)}
                  onListo={async () => {
                    setMostrarGenerar(false);
                    await recargarNodos();
                    // El código nuevo cambia lo que ven el inventario y el escáner.
                    queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
                    queryClient.invalidateQueries({ queryKey: ['arbol-variantes'],    exact: false });
                  }}
                />
              ) : (
                <button
                  type="button" onClick={() => setMostrarGenerar(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200
                    text-left text-xs text-amber-800 hover:bg-amber-100 transition-colors"
                >
                  <Wand2 size={14} className="flex-shrink-0" />
                  <span className="flex-1">
                    <strong>{sinCodigoFiltrados.length}</strong> sin código — generarlos ahora
                  </span>
                  <ChevronRight size={14} />
                </button>
              )
            )}

            <div className="flex items-center justify-between text-xs text-gray-500 px-0.5">
              <span>{nodos.length} productos · {totalSeleccionado} marcados</span>
              <div className="flex gap-2">
                <button type="button" onClick={marcarTodos} className="text-blue-600 hover:underline">
                  Marcar todos
                </button>
                <button type="button" onClick={() => setMarcados({})} className="text-gray-400 hover:underline">
                  Ninguno
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1 max-h-[22rem] overflow-y-auto pr-1">
              {cargandoNodos
                ? <Spinner className="py-10" />
                : nodos.length === 0
                  ? <EmptyState icon={Package} titulo="Sin productos" />
                  : nodos.map((n) => (
                    <FilaNodo
                      key={clave(n)} n={n}
                      marcado={marcados[clave(n)] !== undefined}
                      onToggle={() => alternar(n)}
                      cantidad={marcados[clave(n)] ?? 1}
                      onCantidad={(v) => setMarcados((m) => ({ ...m, [clave(n)]: Number(v) || 0 }))}
                      modoManual={prefs.cantidadModo === 'manual'}
                    />
                  ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cuántas de cada uno</p>
              <div className="grid grid-cols-3 gap-1.5">
                <Opcion activo={prefs.cantidadModo === 'uno'} onClick={() => cambiar({ cantidadModo: 'uno' })}
                  titulo="Una" desc="Para el estante" />
                <Opcion activo={prefs.cantidadModo === 'stock'} onClick={() => cambiar({ cantidadModo: 'stock' })}
                  titulo="Por unidad" desc="Una por cada existencia" />
                <Opcion activo={prefs.cantidadModo === 'manual'} onClick={() => cambiar({ cantidadModo: 'manual' })}
                  titulo="A mano" desc="La escribes tú" />
              </div>
            </div>
          </div>
        )}

        {/* ══ Columna 2 — cómo se ve e impresión ════════════════════════════ */}
        <div className="flex flex-col gap-4 min-w-0">

          {individual && (
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{nodoInicial.nombre}</p>
                <p className="text-xs text-gray-400 truncate">
                  {nodoInicial.variante_label && `${nodoInicial.variante_label} · `}
                  <span className="font-mono">{nodoInicial.codigo}</span>
                  {' · '}{nodoInicial.stock} uds
                </p>
              </div>
              <div className="w-28 flex-shrink-0">
                <Input label="Etiquetas" type="number" min="1" max="999" value={cantidadIndividual}
                  onChange={(e) => setCantidadIndividual(e.target.value)} />
              </div>
              <Button size="sm" variant="secondary" className="mb-0.5 flex-shrink-0"
                onClick={() => setCantidadIndividual(nodoInicial.stock || 1)}>
                = stock
              </Button>
            </div>
          )}

          {/* Simbología */}
          <div className="grid grid-cols-2 gap-2">
            <Opcion
              activo={prefs.simbologia === 'barras'} onClick={() => cambiar({ simbologia: 'barras' })}
              icon={Barcode} titulo="Código de barras"
              desc="Para el lector láser de siempre. Es el más rápido de escanear."
            />
            <Opcion
              activo={prefs.simbologia === 'qr'} onClick={() => cambiar({ simbologia: 'qr' })}
              icon={QrCode} titulo="QR"
              desc="Se lee con la cámara del celular y aguanta códigos largos en etiquetas pequeñas."
            />
          </div>

          {/* Formato */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tamaño de etiqueta</label>
            <select
              value={prefs.formato} onChange={(e) => cambiar({ formato: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
            >
              <optgroup label="Plancha adhesiva (impresora normal)">
                {formatos.filter((f) => f.medio === 'hoja').map((f) => (
                  <option key={f.id} value={f.id}>{f.nombre}</option>
                ))}
              </optgroup>
              <optgroup label="Rollo (impresora térmica)">
                {formatos.filter((f) => f.medio === 'rollo').map((f) => (
                  <option key={f.id} value={f.id}>{f.nombre}</option>
                ))}
              </optgroup>
              <option value="personalizado">A medida...</option>
            </select>

            {prefs.formato === 'personalizado' && (
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-gray-50 border border-gray-200">
                <div className="grid grid-cols-2 gap-2">
                  <Opcion activo={prefs.personalizado.medio === 'rollo'} titulo="Rollo" desc="Una por página"
                    onClick={() => cambiar({ personalizado: { ...prefs.personalizado, medio: 'rollo' } })} />
                  <Opcion activo={prefs.personalizado.medio === 'hoja'} titulo="Plancha" desc="Retícula en A4"
                    onClick={() => cambiar({ personalizado: { ...prefs.personalizado, medio: 'hoja' } })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {['ancho', 'alto'].map((campo) => (
                    <Input key={campo} label={`${campo === 'ancho' ? 'Ancho' : 'Alto'} (mm)`} type="number" min="10"
                      value={prefs.personalizado[campo]}
                      onChange={(e) => cambiar({ personalizado: { ...prefs.personalizado, [campo]: Number(e.target.value) } })} />
                  ))}
                </div>
                {prefs.personalizado.medio === 'hoja' && (
                  <div className="grid grid-cols-2 gap-2">
                    {['columnas', 'filas'].map((campo) => (
                      <Input key={campo} label={campo === 'columnas' ? 'Columnas' : 'Filas'} type="number" min="1"
                        value={prefs.personalizado[campo]}
                        onChange={(e) => cambiar({ personalizado: { ...prefs.personalizado, [campo]: Number(e.target.value) } })} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Qué lleva la etiqueta */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Qué lleva</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                ['nombre',     'Nombre'],
                ['variante',   'Variante'],
                ['precio',     'Precio'],
                ['encabezado', 'Nombre del negocio'],
              ].map(([k, etiqueta]) => (
                <Casilla key={k} activo={prefs.mostrar[k]}
                  onClick={() => cambiar({ mostrar: { ...prefs.mostrar, [k]: !prefs.mostrar[k] } })}>
                  {etiqueta}
                </Casilla>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">
              El código escrito va siempre: si el símbolo se raya o el lector falla, alguien tiene que poder teclearlo.
            </p>
          </div>

          {/* Ajustes finos */}
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setAvanzado((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {avanzado ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Sliders size={13} /> Ajuste de impresión
            </button>
            {avanzado && (
              <div className="flex flex-col gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
                {esHoja && (
                  <div className="flex items-end gap-2">
                    <div className="w-28">
                      <Input label="Empezar en la etiqueta" type="number" min="1"
                        max={formatoActual?.porHoja || 999}
                        value={prefs.desde || 1}
                        onChange={(e) => cambiar({ desde: Math.max(1, Number(e.target.value) || 1) })} />
                    </div>
                    <p className="text-[11px] text-gray-500 pb-2 flex-1">
                      Para aprovechar una plancha a medio gastar: salta las casillas ya despegadas.
                    </p>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="w-24">
                    <Input label="Desviar → (mm)" type="number" step="0.5" value={prefs.ajuste.x}
                      onChange={(e) => cambiar({ ajuste: { ...prefs.ajuste, x: Number(e.target.value) } })} />
                  </div>
                  <div className="w-24">
                    <Input label="Desviar ↓ (mm)" type="number" step="0.5" value={prefs.ajuste.y}
                      onChange={(e) => cambiar({ ajuste: { ...prefs.ajuste, y: Number(e.target.value) } })} />
                  </div>
                  <p className="text-[11px] text-gray-500 pb-2 flex-1">
                    Si sale corrido, mide el desvío en la hoja impresa y ponlo aquí. Se recuerda para la próxima.
                  </p>
                </div>
                <Casilla activo={prefs.marco} onClick={() => cambiar({ marco: !prefs.marco })}>
                  Dibujar el borde de cada etiqueta
                </Casilla>
                <p className="text-[11px] text-gray-500">
                  Útil para verificar la alineación antes de gastar una plancha, o para recortar
                  cuando se imprime en papel normal.
                </p>
              </div>
            )}
          </div>

          {/* Vista previa + resumen */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vista previa</p>
            <div className="relative rounded-xl border border-gray-200 bg-gray-100 overflow-hidden"
              style={{ height: '15rem' }}>
              {previa
                ? <iframe title="Vista previa de etiquetas" src={`${previa}#toolbar=0&navpanes=0&view=Fit`}
                    className="w-full h-full bg-white" />
                : (
                  <div className="w-full h-full flex items-center justify-center text-center px-6">
                    {generando
                      ? <Spinner />
                      : <p className="text-xs text-gray-400">
                          {totalSeleccionado ? 'Preparando la previa...' : 'Marca al menos un producto para ver cómo queda.'}
                        </p>}
                  </div>
                )}
            </div>

            {plan && (
              <p className="text-xs text-gray-500">
                <strong className="text-gray-800">{plan.total}</strong> etiquetas
                {esHoja && <> en <strong className="text-gray-800">{plan.paginas}</strong> {plan.paginas === 1 ? 'hoja' : 'hojas'}</>}
                {plan.moduloMm != null && <> · barra fina {plan.moduloMm.toFixed(2)} mm</>}
              </p>
            )}

            {plan?.recortado && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                Se cortó en {plan.maximo} etiquetas. Imprime por línea o por ubicación para no
                generar un archivo que la impresora no pueda abrir.
              </p>
            )}

            {/* Un producto que ya no vende por variantes conserva sus atributos
                marcados como activos, así que sigue siendo un CONTENEDOR y su
                código no es lo que se pega en el estante. Sin este aviso el
                usuario vería una previa vacía y ningún motivo. */}
            {individual && plan && plan.total === 0 && plan.sinCodigo.length === 0 && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                Este producto se vende por variantes: la etiqueta va en cada talla o color.
                Ábrelo desde el inventario e imprime desde ahí, o usa Etiquetas para hacerlo en masa.
              </p>
            )}

            {plan?.sinCodigo?.length > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                {plan.sinCodigo.length} de los marcados no tienen código y no se van a imprimir.
              </p>
            )}

            {avisosReales.map((a) => (
              <p key={a} className={`flex items-start gap-1.5 text-xs
                ${a === 'modulo_estrecho' ? 'text-red-600' : 'text-gray-500'}`}>
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                {TEXTO_AVISO[a]}
              </p>
            ))}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={generando}>Cerrar</Button>
            <Button variant="secondary" className="flex-1" disabled={!plan?.total || generando}
              onClick={() => descargar(cuerpo)}>
              <Download size={15} /> Descargar
            </Button>
            <Button className="flex-1" loading={generando} disabled={!plan?.total}
              onClick={() => imprimir(cuerpo)}>
              <Printer size={15} /> Imprimir
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default ModalEtiquetas;
