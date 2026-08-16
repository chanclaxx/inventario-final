import { Bookmark } from 'lucide-react';
import useCarritoStore from '../../store/carritoStore';
import { unidadesLibres } from '../../utils/reservas';

// ─────────────────────────────────────────────────────────────────────────────
// «Esto está apartado en un borrador».
//
// El aviso va en la lista, ANTES de tocar «Agregar», para que el modal de
// conflicto sea la excepción y no un peaje en cada venta. No deshabilita nada:
// la reserva es blanda y el producto se puede vender igual.
//
// Vive en un componente propio porque el mismo chip hace falta en los cuatro
// sitios donde se agrega mercancía al carrito —seriales, productos por
// cantidad, atributos y variantes—, y cada uno arma su clave distinto:
//
//   serial   → el IMEI
//   cantidad → 'cant-<producto_id>'
//   atributo → 'cant-<pid>-a-<atributo_id>'
//   variante → 'cant-<pid>-v-<variante_id>'
//
// Sin reserva no renderiza nada, así que ponerlo no cuesta espacio. Con la
// feature apagada `reservas` es {} y esto nunca se pinta.
// ─────────────────────────────────────────────────────────────────────────────

export function ChipApartado({ itemKey, stock, tipo = 'cantidad', className = '' }) {
  const reserva = useCarritoStore((s) => s.reservas[itemKey]);
  if (!reserva?.total) return null;

  const esSerial = tipo === 'serial';
  const libres   = unidadesLibres(stock, reserva);

  // Un serial es una unidad física: o está apartado o no. Un producto por
  // cantidad necesita decir CUÁNTAS, porque de eso depende que el vendedor
  // tenga o no que pedir permiso.
  const texto = esSerial
    ? 'Apartado'
    : `${reserva.total} apartada${reserva.total !== 1 ? 's' : ''}`
      + (libres == null ? '' : libres > 0
        ? ` · ${libres} libre${libres !== 1 ? 's' : ''}`
        : ' · sin libres');

  const donde = reserva.entradas.length === 1
    ? `Apartado en el borrador «${reserva.entradas[0].titulo}»`
    : `Apartado en ${reserva.entradas.length} borradores`;

  return (
    <span
      title={donde}
      className={`inline-flex items-center gap-1 text-[11px] font-medium
        text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5
        rounded-md ${className}`}
    >
      <Bookmark size={10} className="flex-shrink-0" />
      {texto}
    </span>
  );
}
