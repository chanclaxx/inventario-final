import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  buscarParaDespacho, buscarAccesorios, despachar, previsualizarDestino,
} from '../../api/redInterna.api';
import { PanelRevisionDestino } from './PanelRevisionDestino';
import { claveItem } from './claveItem';
import { formatCOP } from '../../utils/formatters';
import { useClaveIdempotencia } from '../../utils/claveIdempotencia';
import api from '../../api/axios.config';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { InputMoneda } from '../../components/ui/InputMoneda';
import {
  Truck, Trash2, Check, AlertTriangle, Store, Package, ShoppingBag,
  Plus, Minus, Search, X,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// DESPACHAR
//
// Dos formas de agregar productos, ninguna excluyente:
//
//   1. ESCÁNER (el camino principal): un único campo que acepta IMEI de equipo
//      O código único de accesorio. El operario no tiene que decidir cuál es:
//      el backend prueba ambos. Escanear el mismo accesorio otra vez suma +1,
//      igual que en el carrito de inventario.
//
//   2. LISTA DE ACCESORIOS: para los que no tienen código impreso. Se abre solo
//      cuando se pide, para no llenar la pantalla de opciones.
//
// El VALOR de cada línea viene con el costo real puesto (modo "a costo") pero
// es editable: es lo que el local tendrá que liquidar al vender, y hay casos
// —equipos sin costo registrado, valores acordados— donde hay que ajustarlo.
// Si el producto venía del carrito con un precio distinto, se ofrece aplicarlo
// con un toque; nunca se aplica solo, porque un precio de VENTA usado como
// valor de remisión le cobraría de más al local.
// ─────────────────────────────────────────────────────────────────────────────

// Identifica el NODO, no el producto: dos tallas del mismo producto son dos
// líneas distintas del envío, con su propio stock y su propio valor.
const claveDe = (i) => (i.tipo === 'serial'
  ? `s-${i.serial_id}`
  : `c-${i.producto_id}-${i.atributo_id ?? ''}-${i.variante_id ?? ''}`);

// ── Valor de la línea: visible y editable ───────────────────────────────────
// Es lo que el local tendrá que liquidar cuando venda. Viene con el costo real
// puesto, pero se puede cambiar: hace falta cuando el equipo entró sin costo
// (saldría en $0) o cuando se acuerda otro valor para esa entrega.
function ValorLinea({ item, onCambiar }) {
  const unitario = Number(item.valor_interno || 0);
  const cantidad = item.tipo === 'cantidad' ? (item.cantidad || 1) : 1;
  const sugerido = Number(item.precio_carrito || 0);
  const difiere  = sugerido > 0 && Math.round(sugerido) !== Math.round(unitario);

  // Un dedazo típico es un cero de más o de menos. Si el valor se aleja diez
  // veces del costo real, se avisa — sin bloquear: hay entregas con valores
  // acordados que se salen del costo a propósito.
  const costoReal = Number(item.costo_real || 0);
  const dedazo = costoReal > 0 && unitario > 0
    && (unitario >= costoReal * 10 || unitario * 10 <= costoReal);

  return (
    <div className="flex flex-col items-end gap-0.5 w-36 flex-shrink-0">
      <InputMoneda
        value={Math.round(unitario)}
        onChange={(v) => onCambiar(v === '' ? 0 : Number(v))}
        className={`w-full px-2.5 py-1.5 bg-gray-100 border rounded-lg text-sm text-right
          tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500
          ${item.sin_costo ? 'border-amber-400 bg-amber-50'
            : dedazo ? 'border-red-300 bg-red-50' : 'border-transparent'}`}
      />
      {item.sin_costo && (
        <span className="text-[11px] text-amber-600 font-medium">sin costo — escríbelo</span>
      )}
      {dedazo && !item.sin_costo && (
        <span className="text-[11px] text-red-500 font-medium">
          ¿seguro? el costo es {formatCOP(costoReal)}
        </span>
      )}
      {cantidad > 1 && (
        <span className="text-[11px] text-gray-400">
          × {cantidad} = {formatCOP(unitario * cantidad)}
        </span>
      )}
      {difiere && (
        <button
          onClick={() => onCambiar(Math.round(sugerido))}
          className="text-[11px] text-blue-600 hover:text-blue-700"
          title="Usar el precio que pusiste en el carrito"
        >
          usar {formatCOP(sugerido)}
        </button>
      )}
    </div>
  );
}

// ── Selector de accesorios (progressive disclosure: oculto hasta pedirlo) ────
function PanelAccesorios({ yaEnLista, onAgregar, onCerrar }) {
  const [q, setQ] = useState('');
  const { data: accesorios = [], isLoading } = useQuery({
    queryKey: ['red-accesorios', q],
    queryFn:  () => buscarAccesorios(q).then((r) => r.data.data),
  });

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar accesorio por nombre o código…"
          autoFocus
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400"
        />
        <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600">
          <X size={15} />
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto">
        {isLoading ? (
          <div className="py-6 flex justify-center"><Spinner /></div>
        ) : accesorios.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            {q ? 'Nada con ese nombre o código' : 'La bodega no tiene accesorios con stock'}
          </p>
        ) : accesorios.map((a) => {
          const puesto = yaEnLista.has(claveDe(a));
          return (
            <button
              key={claveDe(a)}
              onClick={() => onAgregar(a)}
              className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-gray-50
                last:border-0 hover:bg-blue-50 transition-colors text-left"
            >
              <ShoppingBag size={15} className="text-green-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {a.nombre_base || a.nombre}
                  </p>
                  {a.variante_label && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md bg-blue-50
                      text-blue-600 text-[11px] font-semibold">
                      {a.variante_label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  {a.codigo && <span className="font-mono">{a.codigo} · </span>}
                  {a.stock} disponible(s){a.linea_nombre ? ` · ${a.linea_nombre}` : ''}
                </p>
              </div>
              <span className="text-sm text-gray-500 flex-shrink-0">{formatCOP(a.valor_interno)}</span>
              {puesto
                ? <Check size={15} className="text-green-500 flex-shrink-0" />
                : <Plus  size={15} className="text-blue-500 flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ModalDespachar({ locales, itemsIniciales = null, descartados = [], onCerrar, onListo }) {
  const [destino,     setDestino]     = useState(locales.length === 1 ? locales[0].id : null);
  const [items,       setItems]       = useState(itemsIniciales || []);
  const [texto,       setTexto]       = useState('');
  const [error,       setError]       = useState('');
  const [aviso,       setAviso]       = useState('');
  const [notas,       setNotas]       = useState('');
  // Confirmación explícita de entregar productos sin cobrarlos.
  const [sinCobro,    setSinCobro]    = useState(false);
  const [verAccesorios, setVerAccesorios] = useState(false);
  // Revisión de destino: null = no se ha pedido; objeto = hay dudas que resolver.
  const [revision,   setRevision]   = useState(null);
  const [decisiones, setDecisiones] = useState({});
  const inputRef = useRef(null);
  const clave = useClaveIdempotencia();

  // Si el negocio no usa códigos únicos, el escáner solo sirve para IMEI: el
  // texto lo dice para no prometer algo que no va a funcionar.
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const codigoActivo = configData?.codigo_producto_activo === '1';

  useEffect(() => { if (destino && !verAccesorios) inputRef.current?.focus(); }, [destino, verAccesorios]);

  const claves = new Set(items.map(claveDe));

  // Agrega, o suma +1 si el accesorio ya está (tope: stock disponible).
  const agregar = (nuevo) => {
    const k = claveDe(nuevo);
    const existente = items.find((i) => claveDe(i) === k);

    if (!existente) {
      // `costo_real` se congela al agregar: es contra lo que se compara el
      // valor que escriba el usuario para avisar de un dedazo (un 0 de más).
      setItems((prev) => [...prev, {
        ...nuevo,
        cantidad: nuevo.cantidad || 1,
        costo_real: Number(nuevo.valor_interno || 0),
      }]);
      setAviso(`${nuevo.nombre} agregado`);
      return;
    }
    if (nuevo.tipo === 'serial') {
      setError('Ese equipo ya está en la lista');
      return;
    }
    const tope = Number(existente.stock ?? Infinity);
    if ((existente.cantidad || 1) >= tope) {
      setError(`"${existente.nombre}": ya pusiste todo el stock (${tope})`);
      return;
    }
    setItems((prev) => prev.map((i) =>
      claveDe(i) === k ? { ...i, cantidad: (i.cantidad || 1) + 1 } : i
    ));
    setAviso(`${existente.nombre} ×${(existente.cantidad || 1) + 1}`);
  };

  const cambiarCantidad = (k, delta) => setItems((prev) => prev.map((i) => {
    if (claveDe(i) !== k || i.tipo !== 'cantidad') return i;
    const tope = Number(i.stock ?? Infinity);
    return { ...i, cantidad: Math.min(tope, Math.max(1, (i.cantidad || 1) + delta)) };
  }));

  // El valor editado viaja al backend en la línea; `sin_costo` deja de aplicar
  // en cuanto el usuario le pone un valor.
  const cambiarValor = (k, valor) => setItems((prev) => prev.map((i) =>
    claveDe(i) === k ? { ...i, valor_interno: valor, sin_costo: Number(valor) === 0 } : i
  ));

  const buscar = useMutation({
    mutationFn: (valor) => buscarParaDespacho(valor).then((r) => r.data.data),
    onSuccess: (encontrado) => { setError(''); agregar(encontrado); setTexto(''); inputRef.current?.focus(); },
    onError: (err) => {
      setAviso('');
      setError(err.response?.data?.error || 'No se encontró');
      setTexto('');
      inputRef.current?.focus();
    },
  });

  // ── Líneas a enviar, aplicando las decisiones de la revisión ──────────────
  const construirLineas = () => items.map((i) => {
    const base = i.tipo === 'serial'
      ? { tipo: 'serial',   serial_id:   i.serial_id }
      : {
          tipo: 'cantidad', producto_id: i.producto_id, cantidad: i.cantidad || 1,
          // Sin esto el backend no sabe qué talla sale, y con variantes activas
          // la rechaza (VARIANTE_REQUERIDA).
          atributo_id: i.atributo_id ?? null,
          variante_id: i.variante_id ?? null,
        };

    // Valor con el que sale la línea (editable en pantalla).
    base.valor_interno = Number(i.valor_interno || 0);

    // Si el usuario decidió el destino en la revisión, viaja con la línea.
    // 'nueva' se manda sin destino: el backend creará la referencia al recibir.
    const d = decisionDe(i);
    if (d?.tipo === 'existente') base.producto_destino_id = d.id;
    return base;
  });

  // Busca la decisión tomada para este ítem (las claves se generan igual que
  // en el panel de revisión, respetando el orden de la previsualización).
  const decisionDe = (item) => {
    if (!revision) return null;
    const dudosos = revision.items.filter((x) => !x.seguro);
    const n = dudosos.findIndex((x) => (
      item.tipo === 'serial'
        ? Number(x.serial_id) === Number(item.serial_id)
        : Number(x.producto_id) === Number(item.producto_id)
    ));
    return n === -1 ? null : decisiones[claveItem(dudosos[n], n)];
  };

  // Paso previo: preguntar al backend a qué referencia iría cada producto.
  // Si todo se resuelve solo, se despacha de una — el usuario no ve nada extra.
  const revisar = useMutation({
    mutationFn: () => previsualizarDestino({
      sucursal_destino_id: destino,
      lineas: items.map((i) => ({
        tipo: i.tipo, serial_id: i.serial_id, producto_id: i.producto_id,
        cantidad: i.cantidad || 1, nombre: i.nombre,
      })),
    }).then((r) => r.data.data),
    onSuccess: (data) => {
      if (!data.requiere_confirmacion) { enviar.mutate(sinCobro); return; }
      setRevision(data);
    },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo revisar el destino'),
  });

  // Productos que saldrían en $0. El valor de la línea ES lo que el local va a
  // deber, así que un 0 se los regala; el backend lo bloquea y aquí se pide
  // confirmar. Entregarlos sin cobro es legítimo (una muestra, un obsequio),
  // pero tiene que ser una decisión y no un descuido.
  const enCero = items.filter((i) => Number(i.valor_interno || 0) === 0);

  const enviar = useMutation({
    mutationFn: (confirmadoSinCobro = false) => despachar({
      sucursal_destino_id: destino,
      lineas: construirLineas(),
      notas: notas.trim() || null,
      clave_idempotencia: clave(),
      permitir_valor_cero: confirmadoSinCobro,
    }).then((r) => r.data.data),
    onSuccess: onListo,
    onError: (err) => setError(err.response?.data?.error || 'No se pudo despachar'),
  });

  const total = items.reduce(
    (s, i) => s + Number(i.valor_interno || 0) * (i.tipo === 'cantidad' ? (i.cantidad || 1) : 1), 0
  );
  const unidades = items.reduce((s, i) => s + (i.tipo === 'cantidad' ? (i.cantidad || 1) : 1), 0);
  const sinCosto = items.filter((i) => i.sin_costo).length;
  const localName = locales.find((l) => l.id === destino)?.nombre;

  const onSubmitScan = (e) => {
    e.preventDefault();
    const v = texto.trim();
    if (v.length >= 3) buscar.mutate(v);
  };

  // Hay dudas por resolver: la pantalla se dedica solo a eso.
  if (revision) {
    return (
      <Modal open onClose={onCerrar} title="¿A qué producto del local va?" size="lg">
        <PanelRevisionDestino
          revision={revision}
          localNombre={localName || 'el local'}
          decisiones={decisiones}
          onDecidir={(k, d) => setDecisiones((p) => ({ ...p, [k]: d }))}
          onVolver={() => { setRevision(null); setError(''); }}
          onConfirmar={() => enviar.mutate(sinCobro)}
          enviando={enviar.isPending}
        />
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      </Modal>
    );
  }

  return (
    <Modal open onClose={onCerrar} title="Despachar a un local" size="lg">
      <div className="flex flex-col gap-4">

        {/* Productos que no se pudieron traer del carrito */}
        {descartados.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-sm text-amber-700 font-medium mb-1">
              {descartados.length} producto(s) no se pueden despachar:
            </p>
            <ul className="text-xs text-amber-600 space-y-0.5">
              {descartados.map((d, n) => <li key={n}>· {d.nombre} — {d.motivo}</li>)}
            </ul>
          </div>
        )}

        {/* Paso 1 — a cuál local */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">1 · ¿A cuál local?</p>
          <div className="flex flex-wrap gap-2">
            {locales.map((l) => (
              <button
                key={l.id}
                onClick={() => setDestino(l.id)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all
                  ${destino === l.id
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300'}`}
              >
                <Store size={14} className="inline mr-1.5 -mt-0.5" />{l.nombre}
              </button>
            ))}
          </div>
        </div>

        {/* Paso 2 — agregar productos */}
        <div className={destino ? '' : 'opacity-40 pointer-events-none'}>
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">2 · Agrega los productos</p>

          <form onSubmit={onSubmitScan}>
            <input
              ref={inputRef}
              value={texto}
              onChange={(e) => { setTexto(e.target.value); setError(''); setAviso(''); }}
              placeholder={codigoActivo
                ? 'Escanea IMEI o código — o escribe y pulsa Enter'
                : 'Escanea el IMEI — o escríbelo y pulsa Enter'}
              autoComplete="off"
              className="w-full px-4 py-3 bg-gray-100 border-0 rounded-xl text-gray-900
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                focus:bg-white transition-all font-mono"
            />
          </form>

          <div className="flex items-center justify-between mt-2 min-h-[20px]">
            <div className="text-sm">
              {error && (
                <span className="text-red-500 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {error}
                </span>
              )}
              {!error && aviso && <span className="text-green-600">✓ {aviso}</span>}
            </div>
            {!verAccesorios && (
              <button
                onClick={() => setVerAccesorios(true)}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex-shrink-0"
              >
                + {codigoActivo ? 'Buscar accesorio sin código' : 'Agregar accesorios'}
              </button>
            )}
          </div>

          {verAccesorios && (
            <div className="mt-2">
              <PanelAccesorios
                yaEnLista={claves}
                onAgregar={(a) => { setError(''); agregar(a); }}
                onCerrar={() => setVerAccesorios(false)}
              />
            </div>
          )}

          {items.length > 0 && (
            <div className="mt-3 border border-gray-100 rounded-xl overflow-hidden">
              {items.map((i) => {
                const k = claveDe(i);
                const esSerial = i.tipo === 'serial';
                const Icono = esSerial ? Package : ShoppingBag;
                return (
                  <div key={k}
                    className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0">
                    <Icono size={15} className={`flex-shrink-0 ${esSerial ? 'text-blue-500' : 'text-green-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {i.nombre_base || i.nombre}
                        </p>
                        {/* La talla, explícita: dos líneas del mismo producto en
                            tallas distintas tienen que distinguirse de un vistazo. */}
                        {i.variante_label && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md bg-blue-50
                            text-blue-600 text-[11px] font-semibold">
                            {i.variante_label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 font-mono">
                        {esSerial ? i.imei : (i.codigo || `${i.stock} en bodega`)}
                      </p>
                    </div>

                    {/* Los accesorios llevan contador; los equipos son uno y ya */}
                    {!esSerial && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => cambiarCantidad(k, -1)}
                          className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200
                            flex items-center justify-center transition-colors">
                          <Minus size={12} className="text-gray-600" />
                        </button>
                        <span className="w-7 text-center text-sm font-semibold text-gray-800">
                          {i.cantidad || 1}
                        </span>
                        <button onClick={() => cambiarCantidad(k, 1)}
                          disabled={(i.cantidad || 1) >= Number(i.stock ?? Infinity)}
                          className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30
                            flex items-center justify-center transition-colors">
                          <Plus size={12} className="text-gray-600" />
                        </button>
                      </div>
                    )}

                    <ValorLinea item={i} onCambiar={(v) => cambiarValor(k, v)} />
                    <button
                      onClick={() => setItems((p) => p.filter((x) => claveDe(x) !== k))}
                      className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
              <div className="flex justify-between items-center px-3 py-2.5 bg-gray-50">
                <span className="text-sm text-gray-500">
                  {items.length} producto(s) · {unidades} unidad(es)
                </span>
                <span className="text-base font-bold text-gray-900">{formatCOP(total)}</span>
              </div>
            </div>
          )}

          {sinCosto > 0 && (
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1.5">
              <AlertTriangle size={13} />
              {sinCosto} producto(s) van en $0: el local no tendrá que liquidarlos.
              Escribe el valor a la derecha si quieres cobrárselos.
            </p>
          )}
        </div>

        {/* Paso 3 — enviar */}
        {items.length > 0 && (
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Nota (opcional) — quién lo lleva, observaciones…"
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
              placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}

        {enCero.length > 0 && (
          <label className="flex items-start gap-2.5 bg-amber-50 border border-amber-200
            rounded-xl px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={sinCobro}
              onChange={(e) => { setSinCobro(e.target.checked); setError(''); }}
              className="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0"
            />
            <span className="text-xs text-amber-800">
              <strong>{enCero.length} producto(s) van en $0</strong> y el local no
              los va a deber: {enCero.slice(0, 3).map((i) => i.nombre).join(', ')}
              {enCero.length > 3 ? '…' : ''}. Escribe su valor arriba, o marca esta
              casilla si de verdad se los entregas sin cobro.
            </span>
          </label>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={!destino || items.length === 0 || (enCero.length > 0 && !sinCobro)}
            loading={revisar.isPending || enviar.isPending}
            onClick={() => { setError(''); revisar.mutate(); }}
          >
            <Truck size={15} /> Despachar {unidades || ''} {localName ? `a ${localName}` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
