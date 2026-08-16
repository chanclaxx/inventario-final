import { useState } from 'react';
import { Bookmark, AlertTriangle, User, Clock } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import useCarritoStore from '../../store/carritoStore';
import { useBorradores } from '../../hooks/useBorradores';
import { unidadesLibres } from '../../utils/reservas';

// ─────────────────────────────────────────────────────────────────────────────
// «Ese producto está apalabrado en otro borrador».
//
// Se monta UNA sola vez, en InventarioPage, y lee el choque del carritoStore.
// Por eso los nueve sitios que agregan al carrito no saben que esto existe: el
// chequeo pasa dentro de agregarItem y aquí solo se resuelve.
//
// El bloqueo es BLANDO: esto no impide vender nada. Informa quién lo apartó y
// ofrece quitárselo. Si el vendedor dice que sí, el producto sale de aquel
// borrador y entra a este carrito.
// ─────────────────────────────────────────────────────────────────────────────

const hace = (iso) => {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1)  return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
};

export function ModalConflictoBorrador() {
  const conflicto         = useCarritoStore((s) => s.conflicto);
  const cancelarConflicto = useCarritoStore((s) => s.cancelarConflicto);
  const forzarAgregar     = useCarritoStore((s) => s.forzarAgregar);
  const { liberarItem }   = useBorradores();

  const [elegido, setElegido] = useState(null); // borrador_id elegido cuando hay varios
  const [error,   setError]   = useState('');

  if (!conflicto) return null;

  const { item, reserva } = conflicto;
  const entradas = reserva?.entradas || [];
  const varios   = entradas.length > 1;

  // Por defecto, el más antiguo: lleva más tiempo esperando y es el candidato
  // natural. Con uno solo no hay nada que elegir.
  const objetivo = varios
    ? entradas.find((e) => e.borrador_id === elegido) || entradas[0]
    : entradas[0];

  const cerrar = () => { setElegido(null); setError(''); cancelarConflicto(); };

  const confirmar = () => {
    if (!objetivo) return;
    setError('');
    liberarItem.mutate(
      { borradorId: objetivo.borrador_id, itemId: objetivo.item_id },
      {
        onSuccess: () => { setElegido(null); forzarAgregar(item); },
        onError: (e) => setError(
          e.response?.data?.error || 'No se pudo quitar del borrador'
        ),
      }
    );
  };

  const esSerial = item.tipo === 'serial';
  const libre    = unidadesLibres(item.stock, reserva);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={cerrar} />

      <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full z-10
        max-h-[85vh] flex flex-col">

        <div className="p-5 pb-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center
              justify-center flex-shrink-0">
              <AlertTriangle size={18} className="text-amber-600" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900">Producto apartado</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {esSerial
                  ? 'Este equipo está en un borrador.'
                  : libre != null && libre <= 0
                    ? 'Todas las unidades libres están apartadas.'
                    : `Quedan ${Math.max(0, libre ?? 0)} sin apartar.`}
              </p>
            </div>
          </div>

          {/* Qué se intentó agregar */}
          <div className="mt-3 bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-sm font-medium text-gray-800 leading-snug">{item.nombre}</p>
            {item.imei && (
              <span className="inline-block font-mono text-[11px] text-gray-500 mt-0.5">
                {item.imei}
              </span>
            )}
            {(item.atributo_label || item.variante_label) && (
              <span className="block text-[11px] text-gray-400 mt-0.5">
                {[item.atributo_label, item.variante_label].filter(Boolean).join(' / ')}
              </span>
            )}
          </div>
        </div>

        {/* En qué borrador(es) está */}
        <div className="px-5 pb-3 overflow-y-auto">
          <p className="text-xs font-medium text-gray-500 mb-1.5">
            {varios ? '¿De cuál lo quitamos?' : 'Está en:'}
          </p>
          <div className="flex flex-col gap-1.5">
            {entradas.map((e) => {
              const activo = objetivo?.borrador_id === e.borrador_id;
              return (
                <button
                  key={e.borrador_id}
                  onClick={() => varios && setElegido(e.borrador_id)}
                  disabled={!varios}
                  className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-left
                    transition-all duration-150
                    ${varios && activo
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                      : 'border-gray-200 bg-white'}
                    ${varios ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
                >
                  <Bookmark size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">{e.titulo}</p>
                    <p className="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
                      {e.usuario_nombre && (
                        <span className="inline-flex items-center gap-1">
                          <User size={9} /> {e.usuario_nombre}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Clock size={9} /> {hace(e.creado_en)}
                      </span>
                      {!esSerial && e.cantidad > 1 && <span>· {e.cantidad} unidades</span>}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>

        <div className="p-5 pt-2 flex flex-col gap-2">
          <p className="text-[11px] text-gray-400 text-center leading-snug">
            Si continúas, {esSerial ? 'el equipo saldrá' : 'esas unidades saldrán'} de
            «{objetivo?.titulo}» y {esSerial ? 'quedará' : 'quedarán'} en tu carrito.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={cerrar}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={confirmar} loading={liberarItem.isPending}>
              Quitar y agregar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
