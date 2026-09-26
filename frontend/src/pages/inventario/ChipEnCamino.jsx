import { Truck } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// «Esto va en camino» — mercancía reservada por un envío de la red interna.
//
// A diferencia de `ChipApartado` (una reserva BLANDA de un borrador), esta sí
// bloquea: la base no deja vender, prestar ni bajar el stock de lo que va en un
// envío sin recibir. El chip lo dice antes de tocar «Agregar», para que el
// error del backend sea la excepción y no la forma de enterarse.
//
// `reserva` sale de `useEnTransito()` (el padre lo pide UNA vez y lo reparte);
// `itemKey` usa las mismas claves que `ChipApartado`. Sin reserva no pinta nada.
// ─────────────────────────────────────────────────────────────────────────────

export function ChipEnCamino({ reserva, stock, tipo = 'cantidad', className = '' }) {
  if (!reserva?.cantidad) return null;

  const envio = reserva.envios?.[0];
  const doc = envio ? `${envio.tipo === 'devolucion' ? 'devolución' : 'envío'} #${envio.numero}` : 'un envío';
  const libres = stock != null ? Math.max(0, Number(stock) - Number(reserva.cantidad)) : null;

  const texto = tipo === 'serial'
    ? `En camino · ${doc}`
    : `${reserva.cantidad} en camino`
      + (libres == null ? '' : ` · ${libres} libre${libres !== 1 ? 's' : ''}`);

  const donde = (reserva.envios || [])
    .map((e) => `${e.tipo === 'devolucion' ? 'Devolución' : 'Envío'} #${e.numero} hacia ${e.destino}`)
    .join(' · ');

  return (
    <span
      title={`${donde}. No se puede vender ni mover hasta que se reciba o se anule.`}
      className={`inline-flex items-center gap-1 text-[11px] font-medium
        text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5
        rounded-md ${className}`}
    >
      <Truck size={10} className="flex-shrink-0" />
      {texto}
    </span>
  );
}
