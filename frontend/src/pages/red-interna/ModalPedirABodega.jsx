import { useState, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { catalogoPedido, crearPedido } from '../../api/redInterna.api';
import { useClaveIdempotencia } from '../../utils/claveIdempotencia';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import {
  Search, Plus, Minus, Trash2, Package, ShoppingBag, Check,
  Send, AlertTriangle, Zap, PenLine,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// PEDIR A LA BODEGA
//
// El espejo de ModalDespachar, y a propósito NO se parece del todo: despachar
// es una operación de bodega —escáner, IMEI, valores— y pedir es una lista de
// compras. Aquí no hay ni un peso en pantalla, y no por diseño visual: el
// catálogo que sirve el backend NO TRAE los costos, porque son los de la
// bodega. Esta pantalla no podría mostrarlos ni queriendo.
//
// Dos formas de agregar, ninguna excluyente:
//
//   1. BUSCAR EN EL CATÁLOGO de la bodega. Devuelve nodos hoja (la talla, no el
//      producto) y muestra cuántos hay — incluido lo que está en cero, porque
//      lo que se acabó es justamente lo que hay que pedir.
//   2. ESCRIBIRLO A MANO, para lo que la bodega todavía no tiene en su
//      catálogo. Sin esa puerta, un pedido solo serviría para reponer, que es
//      la mitad del problema.
//
// Los EQUIPOS se piden por modelo y cantidad, nunca por IMEI: quién tiene los
// IMEI es la bodega y el local no puede saber cuál le van a mandar.
// ─────────────────────────────────────────────────────────────────────────────

// Identifica el NODO. Dos tallas del mismo producto son dos líneas distintas,
// igual que en el despacho.
const claveDe = (i) => (i.tipo === 'serial'
  ? `s-${i.producto_id}`
  : `c-${i.producto_id ?? 'libre'}-${i.atributo_id ?? ''}-${i.variante_id ?? ''}-${i.nombre ?? ''}`);

function Catalogo({ yaEnLista, onAgregar }) {
  const [q, setQ] = useState('');
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['red-catalogo-pedido', q],
    queryFn:  () => catalogoPedido(q).then((r) => r.data.data),
  });

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en el catálogo de la bodega…"
          autoFocus
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400"
        />
      </div>

      <div className="max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="py-6 flex justify-center"><Spinner /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            {q ? 'Nada con ese nombre — escríbelo a mano abajo' : 'La bodega no tiene catálogo todavía'}
          </p>
        ) : items.map((a) => {
          const puesto = yaEnLista.has(claveDe(a));
          const esSerial = a.tipo === 'serial';
          const Icono = esSerial ? Package : ShoppingBag;
          return (
            <button
              key={claveDe(a)}
              onClick={() => onAgregar(a)}
              className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-gray-50
                last:border-0 hover:bg-blue-50 transition-colors text-left"
            >
              <Icono size={15} className={`flex-shrink-0 ${esSerial ? 'text-blue-500' : 'text-green-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{a.nombre_base || a.nombre}</p>
                  {a.variante_label && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md bg-blue-50
                      text-blue-600 text-[11px] font-semibold">
                      {a.variante_label}
                    </span>
                  )}
                </div>
                {/* Disponibilidad, no valor: sirve para saber si hay que
                    esperar. Lo que está en cero también se puede pedir. */}
                <p className={`text-xs ${a.disponibles > 0 ? 'text-gray-400' : 'text-amber-600'}`}>
                  {a.disponibles > 0
                    ? `${a.disponibles} en bodega`
                    : 'agotado en bodega — se puede pedir igual'}
                  {a.linea_nombre ? ` · ${a.linea_nombre}` : ''}
                </p>
              </div>
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

export function ModalPedirABodega({ onCerrar, onListo }) {
  const [items,    setItems]    = useState([]);
  const [notas,    setNotas]    = useState('');
  const [urgente,  setUrgente]  = useState(false);
  const [libre,    setLibre]    = useState('');
  const [error,    setError]    = useState('');
  const [aviso,    setAviso]    = useState('');
  const libreRef = useRef(null);
  const clave = useClaveIdempotencia();

  const claves = new Set(items.map(claveDe));

  // El error se limpia AQUÍ y no en un efecto sobre `items`: el linter rechaza
  // sincronizar estado desde un efecto (`react-hooks/set-state-in-effect`), y
  // el momento en que deja de aplicar es exactamente este.
  const agregar = (nuevo) => {
    setError('');
    const k = claveDe(nuevo);
    const existente = items.find((i) => claveDe(i) === k);
    if (existente) {
      setItems((prev) => prev.map((i) =>
        claveDe(i) === k ? { ...i, cantidad: (i.cantidad || 1) + 1 } : i));
      setAviso(`${existente.nombre} ×${(existente.cantidad || 1) + 1}`);
      return;
    }
    setItems((prev) => [...prev, { ...nuevo, cantidad: 1 }]);
    setAviso(`${nuevo.nombre} agregado`);
  };

  // Lo que la bodega no tiene en su catálogo. Va sin `producto_id`: el backend
  // lo acepta con el nombre y la bodega lo resuelve a mano al despachar.
  const agregarLibre = (e) => {
    e.preventDefault();
    const texto = libre.trim();
    if (texto.length < 2) return;
    agregar({ tipo: 'cantidad', producto_id: null, nombre: texto, libre: true });
    setLibre('');
    libreRef.current?.focus();
  };

  const cambiarCantidad = (k, delta) => setItems((prev) => prev.map((i) =>
    claveDe(i) === k ? { ...i, cantidad: Math.max(1, (i.cantidad || 1) + delta) } : i));

  const enviar = useMutation({
    mutationFn: () => crearPedido({
      prioridad: urgente ? 'urgente' : 'normal',
      notas: notas.trim() || null,
      clave_idempotencia: clave(),
      lineas: items.map((i) => ({
        tipo: i.tipo,
        producto_id: i.producto_id ?? null,
        atributo_id: i.atributo_id ?? null,
        variante_id: i.variante_id ?? null,
        nombre_producto: i.nombre,
        cantidad_pedida: i.cantidad || 1,
      })),
    }).then((r) => r.data),
    onSuccess: (res) => onListo(res.message || 'Pedido enviado a la bodega'),
    onError: (err) => setError(err.response?.data?.error || 'No se pudo enviar el pedido'),
  });

  const unidades = items.reduce((s, i) => s + (i.cantidad || 1), 0);

  return (
    <Modal open onClose={onCerrar} title="Pedir a la bodega" size="lg">
      <div className="flex flex-col gap-4">

        <div className="flex items-start gap-2 bg-blue-50 rounded-xl px-4 py-3">
          <Send size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Arma la lista de lo que necesitas. No pasa nada con tu inventario ni
            con tu cuenta hasta que la bodega despache.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">1 · ¿Qué necesitas?</p>
          <Catalogo yaEnLista={claves} onAgregar={agregar} />

          {/* Lo que la bodega todavía no tiene en su catálogo */}
          <form onSubmit={agregarLibre} className="flex gap-2 mt-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-xl">
              <PenLine size={14} className="text-gray-400 flex-shrink-0" />
              <input
                ref={libreRef}
                value={libre}
                onChange={(e) => setLibre(e.target.value)}
                placeholder="…o escríbelo a mano si no está en la lista"
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={libre.trim().length < 2}>
              <Plus size={14} /> Agregar
            </Button>
          </form>

          <div className="min-h-[20px] mt-1.5 text-sm">
            {error && (
              <span className="text-red-500 flex items-center gap-1.5">
                <AlertTriangle size={14} /> {error}
              </span>
            )}
            {!error && aviso && <span className="text-green-600 text-xs">✓ {aviso}</span>}
          </div>
        </div>

        {items.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">2 · Tu pedido</p>
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              {items.map((i) => {
                const k = claveDe(i);
                const Icono = i.libre ? PenLine : i.tipo === 'serial' ? Package : ShoppingBag;
                return (
                  <div key={k}
                    className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0">
                    <Icono size={15} className={`flex-shrink-0 ${
                      i.libre ? 'text-gray-400' : i.tipo === 'serial' ? 'text-blue-500' : 'text-green-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {i.nombre_base || i.nombre}
                        </p>
                        {i.variante_label && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md bg-blue-50
                            text-blue-600 text-[11px] font-semibold">
                            {i.variante_label}
                          </span>
                        )}
                      </div>
                      {i.libre && (
                        <p className="text-xs text-gray-400">
                          no está en el catálogo — la bodega decide qué mandar
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => cambiarCantidad(k, -1)}
                        className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200
                          flex items-center justify-center transition-colors">
                        <Minus size={12} className="text-gray-600" />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold text-gray-800">
                        {i.cantidad || 1}
                      </span>
                      <button onClick={() => cambiarCantidad(k, 1)}
                        className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200
                          flex items-center justify-center transition-colors">
                        <Plus size={12} className="text-gray-600" />
                      </button>
                    </div>

                    <button
                      onClick={() => setItems((p) => p.filter((x) => claveDe(x) !== k))}
                      className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
              <div className="px-3 py-2.5 bg-gray-50 text-sm text-gray-500">
                {items.length} producto(s) · {unidades} unidad(es)
              </div>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Nota para la bodega (opcional) — para cuándo lo necesitas, quién lo recoge…"
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={urgente}
                onChange={(e) => setUrgente(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0"
              />
              <span className="text-xs text-gray-600">
                <Zap size={12} className="inline -mt-0.5 text-amber-500" />{' '}
                <strong>Es urgente.</strong> Le llega marcado a la bodega y sale
                de primero en su bandeja. Úsalo solo cuando de verdad lo sea.
              </span>
            </label>
          </>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={items.length === 0}
            loading={enviar.isPending}
            onClick={() => { setError(''); enviar.mutate(); }}
          >
            <Send size={15} /> Enviar pedido {unidades ? `(${unidades})` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
