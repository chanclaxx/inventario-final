import { Clock, ShoppingCart } from 'lucide-react';

// ─── Antigüedad de producto en inventario ─────────────────────────────────────
// Los días llegan calculados desde el backend (SQL, zona America/Bogota) en el
// campo `dias_en_inventario`, así la fecha siempre es la correcta sin depender
// de la zona horaria del navegador.

// Umbrales en días para clasificar cuánto tiempo lleva un producto guardado.
const UMBRAL_MEDIO   = 30;  // a partir de aquí: ya lleva tiempo
const UMBRAL_ANTIGUO = 90;  // a partir de aquí: candidato a promoción / liquidación

function nivelAntiguedad(dias) {
  if (dias == null || dias < 0) return null;
  if (dias >= UMBRAL_ANTIGUO) return 'antiguo';
  if (dias >= UMBRAL_MEDIO)   return 'medio';
  return 'reciente';
}

const ESTILOS = {
  reciente: 'bg-green-50 text-green-600 border-green-100',
  medio:    'bg-amber-50 text-amber-600 border-amber-100',
  antiguo:  'bg-red-50 text-red-600 border-red-100',
};

const TITULOS = {
  reciente: 'lleva poco tiempo en inventario',
  medio:    'lleva tiempo en inventario',
  antiguo:  'lleva mucho tiempo en inventario — considera una promoción',
};

function textoDias(dias) {
  if (dias == null || dias < 0) return '';
  if (dias === 0) return 'Hoy';
  if (dias === 1) return '1 día';
  return `${dias} días`;
}

// Texto para "cuándo se vendió por última vez".
function textoVenta(dias) {
  if (dias == null || dias < 0) return '';
  if (dias === 0) return 'Vendido hoy';
  if (dias === 1) return 'Vendido ayer';
  return `Vendido hace ${dias} días`;
}

// Badge compacto con ícono de reloj y el número de días en inventario.
export function AntiguedadBadge({ dias, className = '' }) {
  const nivel = nivelAntiguedad(dias);
  if (!nivel) return null;

  return (
    <span
      title={`${textoDias(dias)} en inventario — ${TITULOS[nivel]}`}
      className={`inline-flex items-center gap-1 text-xs font-medium
        px-1.5 py-0.5 rounded-md border ${ESTILOS[nivel]} ${className}`}
    >
      <Clock size={11} className="flex-shrink-0" />
      {textoDias(dias)}
    </span>
  );
}

// Badge de rotación para productos por cantidad: muestra cuándo se vendió por
// última vez. Si nunca se ha vendido, avisa "Sin ventas" coloreado según cuánto
// tiempo lleva el producto guardado en inventario.
export function UltimaVentaBadge({ diasSinVenta, tieneVentas, diasEnInventario, className = '' }) {
  if (!tieneVentas) {
    const nivel = nivelAntiguedad(diasEnInventario);
    if (!nivel) return null;
    return (
      <span
        title={`Sin ventas registradas — ${textoDias(diasEnInventario)} en inventario`}
        className={`inline-flex items-center gap-1 text-xs font-medium
          px-1.5 py-0.5 rounded-md border ${ESTILOS[nivel]} ${className}`}
      >
        <ShoppingCart size={11} className="flex-shrink-0" />
        Sin ventas
      </span>
    );
  }

  const nivel = nivelAntiguedad(diasSinVenta);
  if (!nivel) return null;
  return (
    <span
      title={textoVenta(diasSinVenta)}
      className={`inline-flex items-center gap-1 text-xs font-medium
        px-1.5 py-0.5 rounded-md border ${ESTILOS[nivel]} ${className}`}
    >
      <ShoppingCart size={11} className="flex-shrink-0" />
      {textoVenta(diasSinVenta)}
    </span>
  );
}
