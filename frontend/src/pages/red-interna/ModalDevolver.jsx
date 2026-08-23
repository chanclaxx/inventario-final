import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { previsualizarDevolucion, devolverABodega } from '../../api/redInterna.api';
import { formatCOP } from '../../utils/formatters';
import { useClaveIdempotencia } from '../../utils/claveIdempotencia';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import {
  Undo2, Package, ShoppingBag, AlertTriangle, Truck, Store, Info,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// DEVOLVER A BODEGA
//
// No todo lo que hay en un local vino de bodega: puede ser una retoma de
// cliente, una compra propia o el inventario con el que arrancó. Por eso lo
// primero es preguntarle al backend de dónde viene cada cosa:
//
//   De bodega  → cancela su consignación. Sin decisiones que tomar.
//   Propio     → la bodega lo recibe igual, pero hay que decir si se lo
//                queda gratis (traslado) o se lo compra (saldo a favor).
//
// La devolución queda EN TRÁNSITO: el inventario se mueve cuando la bodega
// confirma que la recibió, igual que un despacho al revés.
// ─────────────────────────────────────────────────────────────────────────────

const clave = (i) => (i.tipo === 'serial' ? `s-${i.serial_id}` : `c-${i.producto_id}`);

function FilaPropia({ item, decision, onDecidir }) {
  const compra = decision?.saldo_favor === true;
  return (
    <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-3">
      <div className="flex items-start gap-2 mb-2">
        <Store size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{item.nombre}</p>
          <p className="text-xs text-gray-400">
            {item.imei || `${item.cantidad} unidad(es)`} · Este producto es del local
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 pl-6">
        <button
          onClick={() => onDecidir({ saldo_favor: false })}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all
            ${!compra ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-gray-200 hover:border-blue-300'}`}
        >
          <Truck size={13} className="flex-shrink-0" />
          <span className="text-sm flex-1">Solo trasladarlo — sin efecto en la cuenta</span>
        </button>
        <button
          onClick={() => onDecidir({ saldo_favor: true })}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all
            ${compra ? 'bg-blue-600 border-blue-600 text-white'
                     : 'bg-white border-gray-200 hover:border-blue-300'}`}
        >
          <Undo2 size={13} className="flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm">Que la bodega me lo pague</p>
            <p className={`text-xs ${compra ? 'text-blue-100' : 'text-gray-400'}`}>
              Genera {formatCOP(item.valor_interno)} a tu favor
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}

export function ModalDevolver({ items, bodegaNombre = 'la bodega', onCerrar, onListo }) {
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const [decisiones, setDecisiones] = useState({});
  const claveIdem = useClaveIdempotencia();

  // Paso previo: el backend dice de dónde viene cada unidad.
  const revisar = useMutation({
    mutationFn: () => previsualizarDevolucion(
      items.map((i) => ({
        tipo: i.tipo, serial_id: i.serial_id,
        producto_id: i.producto_id, cantidad: i.cantidad || 1,
      }))
    ).then((r) => r.data.data),
    onError: (err) => setError(err.response?.data?.error || 'No se pudo revisar la devolución'),
  });

  useEffect(() => { revisar.mutate(); /* solo al abrir */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const prev = revisar.data;

  const enviar = useMutation({
    mutationFn: () => devolverABodega({
      lineas: (prev?.items || []).filter((i) => !i.error && !i.bloqueado).map((i) => ({
        tipo: i.tipo,
        serial_id: i.serial_id,
        producto_id: i.producto_id,
        cantidad: i.cantidad || 1,
        nombre_producto: i.nombre,
        // El saldo a favor solo aplica a lo propio, y solo si se pidió.
        genera_saldo_favor: i.origen !== 'bodega' && decisiones[clave(i)]?.saldo_favor === true,
      })),
      notas: notas.trim() || null,
      clave_idempotencia: claveIdem(),
    }).then((r) => r.data.data),
    onSuccess: onListo,
    onError: (err) => setError(err.response?.data?.error || 'No se pudo registrar la devolución'),
  });

  if (revisar.isPending || !prev) {
    return (
      <Modal open onClose={onCerrar} title={`Devolver a ${bodegaNombre}`} size="md">
        <div className="py-10 flex justify-center"><Spinner /></div>
        {error && <p className="text-sm text-red-500 text-center">{error}</p>}
      </Modal>
    );
  }

  const deBodega  = prev.items.filter((i) => i.origen === 'bodega' && !i.error);
  const propios   = prev.items.filter((i) => i.origen !== 'bodega' && !i.error);
  const problemas = prev.items.filter((i) => i.error || i.bloqueado);
  const utiles    = prev.items.filter((i) => !i.error && !i.bloqueado);
  const aFavor    = propios
    .filter((i) => decisiones[clave(i)]?.saldo_favor)
    .reduce((s, i) => s + Number(i.valor_interno || 0) * (i.cantidad || 1), 0);

  return (
    <Modal open onClose={onCerrar} title={`Devolver a ${bodegaNombre}`} size="md">
      <div className="flex flex-col gap-4">

        {problemas.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-sm text-red-700 font-medium mb-1">
              {problemas.length} producto(s) no se pueden devolver:
            </p>
            <ul className="text-xs text-red-600 space-y-0.5">
              {problemas.map((p, n) => (
                <li key={n}>· {p.nombre || 'Producto'} — {p.error || p.bloqueado}</li>
              ))}
            </ul>
          </div>
        )}

        {deBodega.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
              Vinieron de bodega ({deBodega.length})
            </p>
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              {deBodega.map((i) => {
                const Icono = i.tipo === 'serial' ? Package : ShoppingBag;
                return (
                  <div key={clave(i)}
                    className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0">
                    <Icono size={15} className="text-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{i.nombre}</p>
                      <p className="text-xs text-gray-400">
                        {i.imei || `${i.cantidad} unidad(es)`}
                        {i.remision_numero ? ` · envío #${i.remision_numero}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* No manda `origen_unidad`: el backend lo resuelve. Para un
                accesorio (que es fungible) mira cuántas unidades le mandó la
                bodega y todavía no le ha devuelto. */}
            <p className="text-xs text-gray-400 mt-1.5">
              Cuando la bodega las reciba, tu deuda baja{' '}
              {formatCOP(deBodega.reduce(
                (s, i) => s + Number(i.valor_interno || 0) * (i.cantidad || 1), 0))}.
            </p>
          </div>
        )}

        {propios.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">
              Son del local ({propios.length}) — ¿qué hacemos?
            </p>
            <div className="flex flex-col gap-2">
              {propios.map((i) => (
                <FilaPropia
                  key={clave(i)}
                  item={i}
                  decision={decisiones[clave(i)]}
                  onDecidir={(d) => setDecisiones((p) => ({ ...p, [clave(i)]: d }))}
                />
              ))}
            </div>
          </div>
        )}

        {aFavor > 0 && (
          <div className="bg-blue-50 rounded-xl px-4 py-3">
            <p className="text-sm text-blue-800 font-medium">
              La bodega te quedará debiendo {formatCOP(aFavor)}
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              Se descontará de lo que tengas por liquidar.
            </p>
          </div>
        )}

        <input
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Motivo (opcional) — no rotó, dañado, cambio de local…"
          className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
            placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-500 flex items-start gap-2">
            <Info size={13} className="mt-0.5 flex-shrink-0" />
            <span>
              La mercancía queda <strong>en tránsito</strong> hasta que {bodegaNombre} confirme
              que la recibió. Hasta entonces sigue contando en tu inventario.
            </span>
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-500 flex items-center gap-1.5">
            <AlertTriangle size={14} /> {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={utiles.length === 0}
            loading={enviar.isPending}
            onClick={() => enviar.mutate()}
          >
            <Undo2 size={15} /> Enviar {utiles.length} producto(s)
          </Button>
        </div>
      </div>
    </Modal>
  );
}
