import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { trasladar, buscarParaTraslado } from '../../../api/redInterna.api';
import { useClaveIdempotencia } from '../../../utils/claveIdempotencia';
import { useCorregirGuiones } from '../../../hooks/useCorregirGuiones';
import { corregirGuiones } from '../../../utils/codigoEscaneado';
import { Modal }   from '../../../components/ui/Modal';
import { Button }  from '../../../components/ui/Button';
import { ModalDocumentoEnvio } from '../documentos/ModalDocumentoEnvio';
import {
  ArrowRightLeft, ScanLine, X, Minus, Plus, AlertTriangle, CheckCircle, Printer, Info,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// TRASLADAR — mover mercancía entre sedes propias, sin cuenta
//
// Una sola pantalla, no un asistente: destino arriba, la lista en el medio y
// el botón abajo. Frente al traslado viejo:
//   · no hay que emparejar cada producto con el de la otra sede (el backend
//     resuelve la referencia, y la crea si no existe);
//   · el producto con tallas pide la talla EN SU LÍNEA, no con un error al final;
//   · se puede escanear aquí mismo (la bodega arma la caja con el lector);
//   · al terminar ofrece la guía para mandar con la mercancía.
// No muestra ni un peso: el traslado no genera cuenta y la respuesta del
// backend no trae costos ni precios.
// ─────────────────────────────────────────────────────────────────────────────

const claveDe = (i) => (i.tipo === 'serial'
  ? `s-${i.serial_id}`
  : `c-${i.producto_id}-${i.atributo_id ?? ''}-${i.variante_id ?? ''}`);

const unidadesDe = (lista) => lista.reduce((n, i) => n + (i.tipo === 'serial' ? 1 : Number(i.cantidad || 1)), 0);

const RECORDAR = 'traslado:ultimo-destino';
const leerUltimo = () => { try { return Number(localStorage.getItem(RECORDAR)) || null; } catch { return null; } };
const guardarUltimo = (id) => { try { localStorage.setItem(RECORDAR, String(id)); } catch { /* sin almacenamiento */ } };

/** Une dos listas de líneas: lo repetido suma (cantidad) o se ignora (IMEI). */
const fusionar = (base, nuevos) => {
  const mapa = new Map(base.map((i) => [claveDe(i), i]));
  for (const n of nuevos) {
    const k = claveDe(n);
    const ya = mapa.get(k);
    if (!ya) { mapa.set(k, { ...n }); continue; }
    if (n.tipo === 'cantidad') {
      const tope = Number(ya.stock || n.stock || Infinity);
      mapa.set(k, { ...ya, cantidad: Math.min(tope, Number(ya.cantidad || 1) + Number(n.cantidad || 1)) });
    }
  }
  return [...mapa.values()];
};

function Linea({ item, onCantidad, onQuitar }) {
  const tope = Number(item.stock || 0) || null;
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{item.nombre}</p>
        <p className="text-xs text-gray-400 font-mono truncate">
          {item.tipo === 'serial' ? item.imei : (item.codigo || 'Sin código')}
          {item.tipo === 'cantidad' && tope != null && <span className="font-sans"> · hay {tope}</span>}
        </p>
      </div>
      {item.tipo === 'cantidad' && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" aria-label="Menos"
            onClick={() => onCantidad(Math.max(1, Number(item.cantidad) - 1))}
            className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 disabled:opacity-30"
            disabled={Number(item.cantidad) <= 1}>
            <Minus size={13} />
          </button>
          <input
            type="number" inputMode="numeric" min={1} max={tope || undefined}
            value={item.cantidad}
            onChange={(e) => {
              const v = Math.floor(Number(e.target.value));
              if (!Number.isFinite(v)) return;
              onCantidad(Math.max(1, tope ? Math.min(tope, v) : v));
            }}
            className="w-12 text-center text-sm font-semibold border border-gray-200 rounded-lg py-1.5"
          />
          <button type="button" aria-label="Más"
            onClick={() => onCantidad(tope ? Math.min(tope, Number(item.cantidad) + 1) : Number(item.cantidad) + 1)}
            className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 disabled:opacity-30"
            disabled={tope != null && Number(item.cantidad) >= tope}>
            <Plus size={13} />
          </button>
        </div>
      )}
      <button type="button" onClick={onQuitar} aria-label="Quitar"
        className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 flex-shrink-0">
        <X size={15} />
      </button>
    </div>
  );
}

/** Un producto con tallas que llegó del carrito sin talla elegida. */
function PedirTalla({ pendiente, onElegir, onDescartar }) {
  const [opciones, setOpciones] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const ver = async () => {
    setCargando(true); setError('');
    try {
      const { data } = await buscarParaTraslado(pendiente.nombre);
      const lista = (data.data.opciones || []).filter((o) => o.producto_id === pendiente.producto_id);
      setOpciones(lista);
      if (!lista.length) setError('Ninguna talla de este producto tiene stock aquí');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudieron cargar las tallas');
    } finally { setCargando(false); }
  };
  return (
    <div className="px-3 py-2.5 border-b border-amber-100 bg-amber-50/60 last:border-0">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
        <p className="text-sm text-amber-800 flex-1 min-w-0 truncate">
          <b>{pendiente.nombre}</b>: ¿cuál talla?
        </p>
        {opciones == null && (
          <button type="button" onClick={ver} disabled={cargando}
            className="text-xs font-medium text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50">
            {cargando ? 'Cargando…' : 'Elegir'}
          </button>
        )}
        <button type="button" onClick={onDescartar} aria-label="Quitar"
          className="w-7 h-7 flex items-center justify-center text-amber-400 hover:text-red-500">
          <X size={14} />
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      {opciones?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {opciones.map((o) => (
            <button key={claveDe(o)} type="button"
              onClick={() => onElegir({ ...o, cantidad: Math.min(Number(o.stock), pendiente.cantidad || 1) })}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-amber-200 bg-white text-gray-700 hover:border-blue-300">
              {o.variante_label || o.nombre} <span className="text-gray-400">· {o.stock}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @param {{
 *   destinos: {id:number, nombre:string}[], destinoInicial?: number|null,
 *   itemsIniciales?: object[], descartados?: object[], sinVariante?: object[],
 *   confirmar?: boolean, origenNombre?: string, onCerrar: Function, onListo: Function,
 * }} props
 */
export function ModalTrasladar({
  destinos, destinoInicial = null, itemsIniciales = [], descartados = [], sinVariante = [],
  confirmar = false, origenNombre, onCerrar, onListo,
}) {
  const ids = destinos.map((d) => Number(d.id));
  const ultimo = leerUltimo();
  const [destino, setDestino] = useState(() => (
    destinoInicial && ids.includes(Number(destinoInicial)) ? Number(destinoInicial)
      : ids.length === 1 ? ids[0]
        : ultimo && ids.includes(ultimo) ? ultimo : null));
  const [items, setItems]           = useState(() => fusionar([], itemsIniciales));
  const [pendientes, setPendientes] = useState(sinVariante);
  const [texto, setTexto]           = useState('');
  const [opciones, setOpciones]     = useState([]);
  const [buscando, setBuscando]     = useState(false);
  const [aviso, setAviso]           = useState('');
  const [error, setError]           = useState('');
  const [notas, setNotas]           = useState('');
  const [listo, setListo]           = useState(null);   // el traslado ya hecho
  const [imprimir, setImprimir]     = useState(false);
  const clave = useClaveIdempotencia();
  const corregir = useCorregirGuiones();
  const inputRef = useRef(null);

  const agregar = (nuevos, texto = '') => {
    setItems((prev) => fusionar(prev, nuevos));
    setAviso(texto);
    setError('');
  };

  const buscar = async () => {
    const q = texto.trim();
    if (q.length < 2) return;
    setBuscando(true); setError(''); setAviso(''); setOpciones([]);
    const intentar = async (valor) => (await buscarParaTraslado(valor)).data.data;
    try {
      let r;
      try { r = await intentar(q); } catch (err) {
        // El lector en inglés manda ' en vez de - : se reintenta corregido.
        const otra = corregir ? corregirGuiones(q) : q;
        if (otra === q || err.response?.status === 409) throw err;
        r = await intentar(otra);
      }
      if (r.item) {
        agregar([r.item], `Agregado: ${r.item.nombre}`);
        setTexto('');
      } else if (r.opciones?.length) {
        setOpciones(r.opciones);
      } else {
        setError(`"${q}" no está en esta sucursal (ni como IMEI, ni como código, ni por nombre)`);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo buscar');
    } finally {
      setBuscando(false);
      inputRef.current?.focus();
    }
  };

  const enviar = useMutation({
    mutationFn: () => trasladar({
      sucursal_destino_id: destino,
      notas: notas.trim() || null,
      clave_idempotencia: clave(),
      lineas: items.map((i) => (i.tipo === 'serial'
        ? { tipo: 'serial', serial_id: i.serial_id }
        : { tipo: 'cantidad', producto_id: i.producto_id, atributo_id: i.atributo_id, variante_id: i.variante_id, cantidad: Number(i.cantidad) })),
    }).then((r) => r.data.data),
    onSuccess: (t) => { guardarUltimo(destino); setListo(t); },
    onError: (err) => setError(
      err.response?.data?.error
      || (err.response ? 'No se pudo trasladar'
        : 'El servidor tardó en responder. Actualiza antes de repetir: puede que el traslado sí haya quedado hecho.')),
  });

  const nombreDestino = destinos.find((d) => Number(d.id) === Number(destino))?.nombre;
  const unidades = unidadesDe(items);

  if (imprimir && listo) {
    return <ModalDocumentoEnvio remisionId={listo.id} onClose={() => { setImprimir(false); onListo(listo); }} />;
  }

  // ── Hecho ──────────────────────────────────────────────────────────────────
  if (listo) {
    const directo = listo.recibido_directo;
    return (
      <Modal open onClose={() => onListo(listo)} title={`Traslado T-${listo.numero ?? listo.id}`} size="sm">
        <div className="flex flex-col gap-4">
          <div className={`rounded-xl px-4 py-4 flex items-start gap-3 ${directo ? 'bg-green-50' : 'bg-blue-50'}`}>
            <CheckCircle size={20} className={directo ? 'text-green-600' : 'text-blue-600'} />
            <div>
              <p className={`text-sm font-semibold ${directo ? 'text-green-800' : 'text-blue-900'}`}>
                {directo ? `Ya está en ${listo.sucursal_destino_nombre}` : `En camino a ${listo.sucursal_destino_nombre}`}
              </p>
              <p className={`text-xs mt-0.5 ${directo ? 'text-green-700' : 'text-blue-700'}`}>
                {listo.unidades} unidad(es).{' '}
                {directo
                  ? 'Entró a su inventario en este momento.'
                  : 'Queda reservado aquí hasta que lo confirmen allá: no se puede vender ni volver a mover.'}
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => setImprimir(true)}>
            <Printer size={15} /> Imprimir guía para la mercancía
          </Button>
          <Button onClick={() => onListo(listo)}>Listo</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onCerrar} title="Trasladar entre sedes" size="md">
      <div className="flex flex-col gap-4">
        {/* Destino: si solo hay uno, es un rótulo; si hay varios, chips. */}
        <div>
          <p className="text-xs text-gray-400 mb-1.5">
            {origenNombre ? <>De <b className="text-gray-600">{origenNombre}</b> a</> : 'Destino'}
          </p>
          {destinos.length === 1 ? (
            <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5">
              <ArrowRightLeft size={15} className="text-blue-600" />
              <span className="text-sm font-semibold text-blue-900">{destinos[0].nombre}</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {destinos.map((d) => (
                <button key={d.id} type="button" onClick={() => setDestino(Number(d.id))}
                  className={`px-3 py-2 rounded-xl text-sm border transition-colors
                    ${Number(destino) === Number(d.id)
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300'}`}>
                  {d.nombre}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Escáner o búsqueda: un solo campo, como en el carrito. */}
        <div>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 bg-gray-100 rounded-xl">
              <ScanLine size={15} className="text-gray-400 flex-shrink-0" />
              <input
                ref={inputRef}
                value={texto}
                onChange={(e) => { setTexto(e.target.value); setOpciones([]); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }}
                placeholder="Escanea o escribe para agregar…"
                className="flex-1 bg-transparent py-2.5 text-sm focus:outline-none min-w-0"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={buscar} loading={buscando} disabled={texto.trim().length < 2}>
              Agregar
            </Button>
          </div>
          {aviso && <p className="text-xs text-green-600 mt-1">{aviso}</p>}
          {opciones.length > 0 && (
            <div className="mt-2 border border-gray-100 rounded-xl max-h-44 overflow-y-auto">
              {opciones.map((o) => (
                <button key={claveDe(o)} type="button"
                  onClick={() => { agregar([o], `Agregado: ${o.nombre}`); setOpciones([]); setTexto(''); }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <span className="text-sm text-gray-700 truncate">{o.nombre}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">hay {o.stock}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* La lista */}
        <div className="border border-gray-100 rounded-xl overflow-hidden max-h-[45vh] overflow-y-auto">
          {pendientes.map((p) => (
            <PedirTalla key={`p-${p.producto_id}`} pendiente={p}
              onElegir={(o) => { agregar([o]); setPendientes((prev) => prev.filter((x) => x.producto_id !== p.producto_id)); }}
              onDescartar={() => setPendientes((prev) => prev.filter((x) => x.producto_id !== p.producto_id))} />
          ))}
          {items.map((i) => (
            <Linea key={claveDe(i)} item={i}
              onCantidad={(c) => setItems((prev) => prev.map((x) => (claveDe(x) === claveDe(i) ? { ...x, cantidad: c } : x)))}
              onQuitar={() => setItems((prev) => prev.filter((x) => claveDe(x) !== claveDe(i)))} />
          ))}
          {!items.length && !pendientes.length && (
            <p className="text-sm text-gray-400 text-center py-8 px-4">
              Escanea los productos o agrégalos desde el carrito del inventario.
            </p>
          )}
        </div>

        {descartados.length > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            <p className="text-xs font-medium text-amber-700 mb-0.5">No se pueden trasladar:</p>
            {descartados.slice(0, 5).map((d, k) => (
              <p key={k} className="text-xs text-amber-700">· {d.nombre}: {d.motivo}</p>
            ))}
            {descartados.length > 5 && <p className="text-xs text-amber-600">…y {descartados.length - 5} más</p>}
          </div>
        )}

        <input
          value={notas}
          onChange={(e) => setNotas(e.target.value.slice(0, 300))}
          placeholder="Nota (opcional): para qué va, quién lo lleva…"
          className="w-full px-3 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="flex items-start gap-2 text-xs text-gray-500 px-1">
          <Info size={13} className="mt-0.5 flex-shrink-0 text-gray-400" />
          <span>
            {confirmar
              ? `${nombreDestino || 'El destino'} confirma lo que le llegó. Mientras tanto queda reservado aquí.`
              : `Entra directo al inventario de ${nombreDestino || 'el destino'}.`}
            {' '}No genera cuenta ni deuda.
          </span>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button className="flex-1"
            disabled={!destino || !items.length || pendientes.length > 0}
            loading={enviar.isPending}
            onClick={() => enviar.mutate()}>
            <ArrowRightLeft size={15} />
            {items.length ? `Trasladar ${unidades} ud${unidades !== 1 ? 's' : ''}` : 'Trasladar'}
          </Button>
        </div>
        {pendientes.length > 0 && (
          <p className="text-xs text-amber-600 text-center -mt-2">Elige la talla de los productos marcados (o quítalos).</p>
        )}
      </div>
    </Modal>
  );
}
