import { Barcode, Loader2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Campo de escaneo (lector USB/BT = teclado + Enter).
//
// Es solo la presentación: quién resuelve el código y qué entra al carrito lo
// decide `useEscanerCarrito`. Se usa en el inventario y arriba del carrito.
// ─────────────────────────────────────────────────────────────────────────────
export function BarraEscaneo({
  value, onChange, onEnter, mensaje, buscando = false,
  placeholder = 'Escanear código o IMEI y Enter → agrega al carrito',
  autoFocus = false,
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2 bg-blue-50/60 border border-blue-200 rounded-xl text-sm
            text-gray-800 placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500
            focus:bg-white transition-all"
        />
        {buscando && (
          <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 animate-spin" />
        )}
      </div>
      {mensaje && (
        <p className={`text-xs px-1 ${mensaje.tipo === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}
