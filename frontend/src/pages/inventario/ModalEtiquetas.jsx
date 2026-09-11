import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Printer, Download, AlertTriangle, Wand2, Check, ChevronRight, Package,
  Ruler, Palette, Settings2, ExternalLink,
} from 'lucide-react';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Spinner }     from '../../components/ui/Spinner';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState }  from '../../components/ui/EmptyState';
import { getLineas }        from '../../api/productos.api';
import { getUbicaciones }   from '../../api/ubicaciones.api';
import api                  from '../../api/axios.config';
import {
  getFormatosEtiqueta, getCatalogoEtiquetas, getNodosEtiqueta, planEtiquetas, generarCodigosEtiqueta,
} from '../../api/etiquetas.api';
import { useAuth }        from '../../context/useAuth';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import useEtiquetas, { leerPreferencias, guardarPreferencias, calibracionDe } from '../../hooks/useEtiquetas';
import { Opcion, Seccion, Casilla } from './etiquetas/ui';
import { SelectorFormato } from './etiquetas/SelectorFormato';
import { PanelDiseno }     from './etiquetas/PanelDiseno';
import { PanelImpresora }  from './etiquetas/PanelImpresora';
import { resolverElegido, resumenCalibracion, mm } from './etiquetas/etiquetasUi';

// ─────────────────────────────────────────────────────────────────────────────
// IMPRIMIR ETIQUETAS — masivo e individual en la misma pantalla
//
// Son el mismo trabajo con distinto alcance, así que es un solo modal: abierto
// desde una tarjeta llega con `nodoInicial` y se salta la selección; abierto
// desde la barra de Inventario empieza por elegir qué etiquetar. Dos pantallas
// separadas acabarían con dos juegos de opciones que se contradicen.
//
// Tres secciones, en el orden en que se resuelve el problema de verdad:
//   · PAPEL: qué rollo o plancha hay en la impresora (del catálogo, ajustado o
//     a medida y guardado), con el diagrama de la retícula;
//   · DISEÑO: qué lleva la etiqueta;
//   · IMPRESORA: la calibración de ESTA impresora y la hoja de prueba.
//
// La VISTA PREVIA es el PDF de verdad recortado a una página, no un dibujo
// hecho aquí: el reparto del espacio de la etiqueta vive en el backend
// (`etiquetas.layout.js`) y reimplementarlo en el navegador es cómo las dos
// copias acaban diciendo cosas distintas. El diagrama del papel también sale
// del backend (`plan.geometria`).
// ─────────────────────────────────────────────────────────────────────────────

const clave = (n) => `${n.nivel}:${n.producto_id}:${n.atributo_id ?? ''}:${n.variante_id ?? ''}`;
const idNodo = (n) => ({
  nivel: n.nivel,
  producto_id: n.producto_id,
  atributo_id: n.atributo_id ?? null,
  variante_id: n.variante_id ?? null,
});

const TEXTO_AVISO = {
  modulo_estrecho:         'El código queda demasiado apretado para esta etiqueta: puede que el lector falle. Usa un formato más grande, códigos más cortos o cambia a QR.',
  resolucion_insuficiente: 'Con la resolución de tu impresora no cabe ni un punto por barra: el código no se podrá leer. Usa QR, una etiqueta más grande o un código más corto.',
  sin_espacio_pie:         'No cabe el texto al pie y se quitó.',
  sin_espacio_precio:      'No cabe el precio y se quitó.',
  sin_espacio_encabezado:  'No cabe el encabezado y se quitó.',
  sin_espacio_variante:    'No cabe la variante y se quitó.',
  sin_espacio_nombre:      'No cabe el nombre y se quitó.',
  rollo_ancho:             'El rollo mide más de 108 mm: las impresoras de etiquetas de 4 pulgadas no imprimen tan ancho y lo que quede por fuera no saldrá.',
  calibracion_fuera:       'Con ese desvío o esa escala, parte de alguna etiqueta queda fuera de la página y no se imprimirá.',
};
const AVISOS_GRAVES = new Set(['modulo_estrecho', 'resolucion_insuficiente', 'calibracion_fuera']);

// ── Panel: generar códigos a los que no tienen ───────────────────────────────
//
// Con el código automático los productos nuevos ya nacen con el suyo; esto es
// para lo que se creó ANTES de encenderlo. Usa el prefijo y los dígitos de
// Ajustes por defecto, para que lo generado en masa se vea igual que lo que
// nace solo.
function PanelGenerar({ nodos, onListo, onCerrar, prefijoDefecto = '', digitosDefecto = 6 }) {
  const [prefijo,  setPrefijo]  = useState(prefijoDefecto);
  const [longitud, setLongitud] = useState(digitosDefecto);
  const [corriendo, setCorriendo] = useState(false);
  const [avance,   setAvance]   = useState(0);
  const [error,    setError]    = useState('');
  const [bloqueados, setBloqueados] = useState([]);

  const TANDA = 200;

  const generar = async () => {
    setCorriendo(true); setError(''); setAvance(0); setBloqueados([]);
    try {
      let hechos = 0;
      const sinCodigo = [];
      // Por tandas: cada llamada bloquea el contador del negocio mientras dura,
      // y una sola petición con 800 nodos se pasaría del tiempo de espera del
      // navegador — que desde la pantalla se ve como "no se pudo", sobre una
      // operación que en realidad iba por la mitad.
      for (let i = 0; i < nodos.length; i += TANDA) {
        const lote = nodos.slice(i, i + TANDA).map(idNodo);
        const { data } = await generarCodigosEtiqueta({ seleccion: lote, prefijo, longitud });
        hechos += data.data.asignados;
        sinCodigo.push(...(data.data.bloqueados || []));
        setAvance(Math.min(i + TANDA, nodos.length));
      }
      setBloqueados(sinCodigo);
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
        ya impreso nunca se cambia. Si el mismo producto ya tiene código en otra sucursal,
        lleva ese mismo.
      </p>
      {bloqueados.length > 0 && (
        <div className="text-xs text-amber-800 bg-white/70 rounded-lg px-2.5 py-2">
          <p className="font-semibold mb-1">
            {bloqueados.length} no {bloqueados.length === 1 ? 'recibió' : 'recibieron'} código: en otra sucursal
            ya tienen uno, pero aquí ese código lo usa otro producto.
          </p>
          {bloqueados.slice(0, 5).map((b) => (
            <p key={`${b.nivel}:${b.id}`}>
              {b.nombre}{b.variante_label ? ` · ${b.variante_label}` : ''} — {b.codigo} lo tiene «{b.bloqueadoPor}»
            </p>
          ))}
        </div>
      )}
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
  const { generando, error, imprimir, descargar, previsualizar, abrir } = useEtiquetas();

  const individual = !!nodoInicial;

  const [prefs, setPrefs] = useState(leerPreferencias);
  const cambiar = (parcial) => {
    const nuevo = { ...prefs, ...parcial };
    setPrefs(nuevo);
    guardarPreferencias(nuevo);
  };

  // «Empezar en la etiqueta N» NO se recuerda: sirve para la plancha a medio
  // gastar de HOY. Recordado, la próxima impresión volvería a saltarse las
  // mismas casillas en una plancha nueva.
  const [desde, setDesde] = useState(1);

  const [abiertas, setAbiertas] = useState({ papel: true, diseno: false, impresora: false });
  const alternarSeccion = (k) => setAbiertas((a) => ({ ...a, [k]: !a[k] }));

  // ── Selección ──────────────────────────────────────────────────────────────
  const [busqueda,   setBusqueda]   = useState('');
  const [lineaId,    setLineaId]    = useState('');
  const [ubicacion,  setUbicacion]  = useState('');
  const [conStock,   setConStock]   = useState(false);
  const [soloSinCod, setSoloSinCod] = useState(false);
  const [marcados,   setMarcados]   = useState({});   // clave → cantidad
  const [mostrarGenerar, setMostrarGenerar] = useState(false);
  const [cantidadIndividual, setCantidadIndividual] = useState(1);

  // El catálogo con papeles y topes; con un backend que aún no lo tiene
  // (Vercel y Railway se despliegan por separado) se cae a la lista de siempre.
  const { data: catalogo } = useQuery({
    queryKey: ['etiquetas-catalogo'],
    queryFn:  async () => {
      try { return (await getCatalogoEtiquetas()).data.data; }
      catch {
        const r = await getFormatosEtiqueta();
        return { formatos: r.data.data, papeles: [], limites: null };
      }
    },
    staleTime: Infinity,   // el catálogo no cambia mientras la app está abierta
  });
  const formatos = useMemo(() => catalogo?.formatos || [], [catalogo]);
  const papeles  = useMemo(() => catalogo?.papeles  || [], [catalogo]);

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
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

  // ── Formato elegido y su calibración ───────────────────────────────────────
  const elegido = useMemo(() => resolverElegido(prefs, formatos), [prefs, formatos]);
  const cal     = useMemo(() => calibracionDe(prefs, elegido.clave), [prefs, elegido.clave]);
  const cambiarCal = (parcial) => cambiar({
    calibracion: { ...prefs.calibracion, [elegido.clave]: { ...cal, ...parcial } },
  });

  // ── Cuerpo compartido por plan, previa y PDF ───────────────────────────────
  //
  // Depende solo de valores ESTABLES (el estado y la selección memoizada): si
  // dependiera de un objeto derivado que se rehace en cada render, el efecto
  // del plan pediría un plan nuevo en cada render, en bucle.
  const cuerpo = useMemo(() => {
    const el = resolverElegido(prefs, []);
    const c  = calibracionDe(prefs, el.clave);
    return {
      seleccion,
      formato:         el.formato,
      personalizado:   el.personalizado,
      simbologia:      prefs.simbologia,
      mostrar:         prefs.mostrar,
      encabezadoTexto: prefs.encabezadoTexto,
      pieTexto:        prefs.pieTexto,
      diseno:          prefs.diseno,
      marco:           prefs.marco,
      ajuste:          c.ajuste,
      impresora:       { rotacion: c.rotacion, escala: c.escala, dpi: c.dpi },
      desde,
      // En individual la cantidad la pone el input; en masivo manda el modo.
      cantidadModo: individual ? 'manual' : prefs.cantidadModo,
    };
  }, [prefs, seleccion, desde, individual]);

  // ── Plan (cuántas etiquetas, la retícula, qué puede salir mal) ─────────────
  //
  // Se pide SIEMPRE, también sin productos marcados: el editor de formato
  // necesita la geometría —y el «no caben en el rollo»— mientras el usuario
  // mide. Con retardo, no en cada tecla; y todo `setState` va DENTRO del
  // temporizador — hacerlo en el cuerpo del efecto encadena renders (y lo
  // prohíbe la regla del compilador de React).
  const [plan, setPlan] = useState(null);
  const [errorPlan, setErrorPlan] = useState('');
  const hayItems = seleccion.length > 0;
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      planEtiquetas(cuerpo)
        .then((r) => { if (vivo) { setPlan(r.data.data); setErrorPlan(''); } })
        .catch((e) => {
          if (!vivo) return;
          setPlan(null);
          setErrorPlan(e?.response?.data?.error || 'No se pudo calcular el formato');
        });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [cuerpo]);

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
      if (!hayItems || errorPlan) { setPrevia(null); return; }
      const url = await previsualizar({ ...cuerpo, limite: porPagina || 12 });
      if (!vivo) { if (url) URL.revokeObjectURL(url); return; }
      // Liberar la anterior recién ahora: revocarla antes deja el recuadro en
      // blanco mientras se genera la nueva.
      if (previaAnterior.current) URL.revokeObjectURL(previaAnterior.current);
      previaAnterior.current = url;
      setPrevia(url);
    }, 600);
    return () => { vivo = false; clearTimeout(t); };
  }, [cuerpo, hayItems, porPagina, previsualizar, errorPlan]);

  useEffect(() => () => {
    if (previaAnterior.current) URL.revokeObjectURL(previaAnterior.current);
  }, []);

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
  const geometria = plan?.geometria;

  const resumenDiseno = [
    prefs.simbologia === 'qr' ? 'QR' : 'Código de barras',
    ...['nombre', 'variante', 'precio', 'encabezado', 'pie'].filter((k) => prefs.mostrar[k]),
  ].join(' · ');
  // El nombre que da el backend describe el formato a medida con sus medidas
  // («Rollo 3 columnas · 32 × 25 mm»); uno guardado se reconoce por el suyo.
  const resumenPapel = elegido.guardado ? elegido.nombre : (plan?.formato?.nombre || elegido.nombre);

  const cuerpoPrueba = { ...cuerpo, prueba: true, seleccion: [] };

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

            {/* Generar códigos: para lo que se creó antes del código automático */}
            {sinCodigoFiltrados.length > 0 && esAdminNegocio() && (
              mostrarGenerar ? (
                <PanelGenerar
                  nodos={sinCodigoFiltrados}
                  prefijoDefecto={config?.codigo_auto_prefijo || ''}
                  digitosDefecto={Number(config?.codigo_auto_digitos) || 6}
                  onCerrar={() => setMostrarGenerar(false)}
                  onListo={async () => {
                    await recargarNodos();
                    // El código nuevo cambia lo que ven el inventario y el escáner.
                    queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
                    queryClient.invalidateQueries({ queryKey: ['arbol-variantes'],    exact: false });
                    queryClient.invalidateQueries({ queryKey: ['arbol-producto'],     exact: false });
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

        {/* ══ Columna 2 — papel, diseño, impresora y vista previa ═══════════ */}
        <div className="flex flex-col gap-3 min-w-0">

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

          <Seccion icon={Ruler} titulo="Papel" resumen={resumenPapel}
            abierta={abiertas.papel} onAlternar={() => alternarSeccion('papel')} alerta={!!errorPlan}>
            <SelectorFormato
              prefs={prefs} cambiar={cambiar}
              formatos={formatos} papeles={papeles}
              plan={plan} errorFormato={errorPlan}
            />
          </Seccion>

          <Seccion icon={Palette} titulo="Diseño" resumen={resumenDiseno}
            abierta={abiertas.diseno} onAlternar={() => alternarSeccion('diseno')}>
            <PanelDiseno prefs={prefs} cambiar={cambiar} negocioNombre={config?.nombre_negocio} />
          </Seccion>

          <Seccion icon={Settings2} titulo="Impresora" resumen={resumenCalibracion(cal)}
            abierta={abiertas.impresora} onAlternar={() => alternarSeccion('impresora')}
            alerta={avisosReales.includes('calibracion_fuera')}>
            <PanelImpresora
              cal={cal} cambiarCal={cambiarCal} plan={plan}
              desde={desde} setDesde={setDesde} porPagina={plan?.porPagina || 1}
              generando={generando}
              onImprimirPrueba={() => imprimir(cuerpoPrueba)}
              onDescargarPrueba={() => descargar(cuerpoPrueba, 'prueba-alineacion.pdf')}
            />
          </Seccion>

          {/* Vista previa + resumen */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vista previa</p>
              {previa && (
                // Los navegadores de celular no pintan un PDF dentro de un
                // iframe: el recuadro queda en blanco. Abrirlo aparte funciona.
                <button type="button" onClick={() => abrir({ ...cuerpo, limite: porPagina || 12 })}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  <ExternalLink size={12} /> Abrir aparte
                </button>
              )}
            </div>
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
                          {errorPlan
                            ? 'Corrige las medidas del papel para ver cómo queda.'
                            : totalSeleccionado ? 'Preparando la previa...' : 'Marca al menos un producto para ver cómo queda.'}
                        </p>}
                  </div>
                )}
            </div>
            {geometria?.papel?.rotacion ? (
              <p className="text-[11px] text-gray-400">
                La página va girada {geometria.papel.rotacion}° hacia la impresora; la impresora la endereza al imprimir.
              </p>
            ) : null}

            {plan && plan.total > 0 && (
              <p className="text-xs text-gray-500">
                <strong className="text-gray-800">{plan.total}</strong> etiquetas
                {' en '}<strong className="text-gray-800">{plan.paginas}</strong>{' '}
                {geometria?.medio === 'rollo'
                  ? (plan.paginas === 1 ? 'fila del rollo' : 'filas del rollo')
                  : (plan.paginas === 1 ? 'hoja' : 'hojas')}
                {plan.moduloMm != null && (
                  <> · barra fina {mm(plan.moduloMm)} mm{plan.puntosModulo ? ` (${plan.puntosModulo} puntos)` : ''}</>
                )}
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
                ${AVISOS_GRAVES.has(a) ? 'text-red-600' : 'text-gray-500'}`}>
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                {TEXTO_AVISO[a]}
              </p>
            ))}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={generando}>Cerrar</Button>
            <Button variant="secondary" className="flex-1" disabled={!plan?.total || generando || !!errorPlan}
              onClick={() => descargar(cuerpo)}>
              <Download size={15} /> Descargar
            </Button>
            <Button className="flex-1" loading={generando} disabled={!plan?.total || !!errorPlan}
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
