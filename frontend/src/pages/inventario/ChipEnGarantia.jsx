import { ShieldAlert } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// «Esto está en garantía con el proveedor» — al lado de `ChipEnCamino`.
//
// Por cantidad, esas unidades YA salieron del stock (están dañadas, afuera o
// esperando salir): el chip dice cuántas son para que nadie las busque en el
// estante. Un serial queda bloqueado por la base hasta que el proveedor
// responda; el chip lo dice antes de tocar «Agregar».
//
// `reserva` sale de `useEnGarantia()` (el padre lo pide UNA vez y lo reparte).
// Sin reserva no pinta nada.
// ─────────────────────────────────────────────────────────────────────────────

export function ChipEnGarantia({ reserva, tipo = 'cantidad', className = '' }) {
  if (!reserva?.cantidad) return null;
  const casos = [...new Set(reserva.casos || [])];
  const texto = tipo === 'serial'
    ? `En garantía #${casos[0] ?? ''}`
    : `${reserva.cantidad} en garantía · no cuentan`;
  return (
    <span
      title={`Garantía${casos.length > 1 ? 's' : ''} ${casos.map((c) => `#${c}`).join(', ')} con el proveedor. `
        + (tipo === 'serial'
          ? 'No se puede vender ni mover hasta que el proveedor responda.'
          : 'Estas unidades no están en el stock disponible.')}
      className={`inline-flex items-center gap-1 text-[11px] font-medium
        text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5
        rounded-md ${className}`}
    >
      <ShieldAlert size={10} className="flex-shrink-0" />
      {texto}
    </span>
  );
}
