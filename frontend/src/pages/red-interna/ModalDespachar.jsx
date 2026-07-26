import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  buscarParaDespacho, buscarAccesorios, despachar,
} from '../../api/redInterna.api';
import { formatCOP } from '../../utils/formatters';
import { useClaveIdempotencia } from '../../utils/claveIdempotencia';
import api from '../../api/axios.config';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import {
  Truck, Trash2, Check, AlertTriangle, Store, Package, ShoppingBag,
  Plus, Minus, Search, X,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// DESPACHAR — sin un solo campo de precio.
//
// En modo "a costo" el valor lo pone el sistema, así que el usuario solo elige
// el local y agrega productos. Dos formas de agregar, ninguna excluyente:
//
//   1. ESCÁNER (el camino principal): un único campo que acepta IMEI de equipo
//      O código único de accesorio. El operario no tiene que decidir cuál es:
//      el backend prueba ambos. Escanear el mismo accesorio otra vez suma +1,
//      igual que en el carrito de inventario.
//
//   2. LISTA DE ACCESORIOS: para los que no tienen código impreso. Se abre solo
//      cuando se pide, para no llenar la pantalla de opciones.
// ─────────────────────────────────────────────────────────────────────────────

const claveDe = (i) => (i.tipo === 'serial' ? `s-${i.serial_id}` : `c-${i.producto_id}`);

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
          const puesto = yaEnLista.has(`c-${a.producto_id}`);
          return (
            <button
              key={a.producto_id}
              onClick={() => onAgregar(a)}
              className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-gray-50
                last:border-0 hover:bg-blue-50 transition-colors text-left"
            >
              <ShoppingBag size={15} className="text-green-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{a.nombre}</p>
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
  const [verAccesorios, setVerAccesorios] = useState(false);
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
      setItems((prev) => [...prev, { ...nuevo, cantidad: nuevo.cantidad || 1 }]);
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

  const enviar = useMutation({
    mutationFn: () => despachar({
      sucursal_destino_id: destino,
      lineas: items.map((i) => (i.tipo === 'serial'
        ? { tipo: 'serial',   serial_id:   i.serial_id }
        : { tipo: 'cantidad', producto_id: i.producto_id, cantidad: i.cantidad || 1 })),
      notas: notas.trim() || null,
      clave_idempotencia: clave(),
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
                      <p className="text-sm font-medium text-gray-800 truncate">{i.nombre}</p>
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

                    <span className={`text-sm font-semibold w-24 text-right flex-shrink-0
                      ${i.sin_costo ? 'text-amber-500' : 'text-gray-700'}`}>
                      {formatCOP(Number(i.valor_interno || 0) * (esSerial ? 1 : (i.cantidad || 1)))}
                    </span>
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
              {sinCosto} producto(s) sin costo registrado: se despachan en $0 y el local
              no tendrá que liquidarlos.
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

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={!destino || items.length === 0}
            loading={enviar.isPending}
            onClick={() => enviar.mutate()}
          >
            <Truck size={15} /> Despachar {unidades || ''} {localName ? `a ${localName}` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
