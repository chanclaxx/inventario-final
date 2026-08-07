// ─────────────────────────────────────────────────────────────────────────────
// Indicadores compartidos de las órdenes de compra.
//
// Dos señales INDEPENDIENTES, y por eso viven en componentes distintos y nunca
// en la misma columna: la barra es MERCANCÍA (qué llegó) y el chip es DINERO
// (cuándo vence la factura). Una orden puede estar completa y vencida.
//
// Ninguno bloquea nada: son información, no controles. En el momento en que una
// orden vencida impida trabajar, el negocio apaga la feature.
// ─────────────────────────────────────────────────────────────────────────────

const ESTADOS_PAGO = {
  vencida:     { clase: 'bg-red-100 text-red-700',       punto: 'bg-red-500'    },
  por_vencer:  { clase: 'bg-amber-100 text-amber-700',   punto: 'bg-amber-500'  },
  al_dia:      { clase: 'bg-green-100 text-green-700',   punto: 'bg-green-500'  },
  sin_plazo:   { clase: 'bg-gray-100 text-gray-500',     punto: 'bg-gray-300'   },
  sin_factura: { clase: 'bg-gray-100 text-gray-500',     punto: 'bg-gray-300'   },
};

const _dias = (n) => Math.abs(Number(n)) === 1 ? '1 día' : `${Math.abs(Number(n))} días`;

function etiquetaPago(estado, dias) {
  switch (estado) {
    case 'vencida':     return `Vencida hace ${_dias(dias)}`;
    case 'por_vencer':  return Number(dias) === 0 ? 'Vence hoy' : `Vence en ${_dias(dias)}`;
    case 'al_dia':      return 'Al día';
    case 'sin_plazo':   return 'Sin plazo';
    default:            return 'Sin factura';
  }
}

export function ChipPago({ estado, dias }) {
  const cfg = ESTADOS_PAGO[estado] || ESTADOS_PAGO.sin_factura;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cfg.clase}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.punto}`} />
      {etiquetaPago(estado, dias)}
    </span>
  );
}

const ESTADOS_GARANTIA = {
  vencida:      { clase: 'bg-red-100 text-red-700',     punto: 'bg-red-500'   },
  por_vencer:   { clase: 'bg-amber-100 text-amber-700', punto: 'bg-amber-500' },
  vigente:      { clase: 'bg-green-100 text-green-700', punto: 'bg-green-500' },
  sin_garantia: { clase: 'bg-gray-100 text-gray-500',   punto: 'bg-gray-300'  },
};

export function ChipGarantia({ estado, dias }) {
  const cfg = ESTADOS_GARANTIA[estado] || ESTADOS_GARANTIA.sin_garantia;
  const texto = estado === 'vencida'    ? 'Garantía vencida'
    : estado === 'por_vencer'           ? (Number(dias) === 0 ? 'Vence hoy' : `Vence en ${_dias(dias)}`)
      : estado === 'vigente'            ? `Garantía ${_dias(dias)}`
        : 'Sin garantía';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cfg.clase}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.punto}`} />
      {texto}
    </span>
  );
}

/**
 * Avance de mercancía. Verde solo cuando está completa: el azul de "va en
 * camino" y el verde de "ya está" tienen que distinguirse de un vistazo, sin
 * leer el número.
 */
export function BarraAvance({ recibidas, pedidas, compacta = false }) {
  const p = Number(pedidas   || 0);
  const r = Number(recibidas || 0);
  const pct = p > 0 ? Math.min(100, Math.round((r / p) * 100)) : 0;
  const completa = p > 0 && r >= p;

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            completa ? 'bg-green-500' : r > 0 ? 'bg-blue-500' : 'bg-gray-200'
          }`}
          style={{ width: `${r > 0 ? pct : 100}%` }}
        />
      </div>
      {!compacta && (
        <span className="text-xs text-gray-400 tabular-nums">
          {r > 0 ? `${r} de ${p} unidades` : 'Sin recibir'}
        </span>
      )}
    </div>
  );
}

const ESTADOS_ORDEN = {
  Borrador: 'bg-gray-100 text-gray-600',
  Emitida:  'bg-blue-100 text-blue-700',
  Cerrada:  'bg-gray-100 text-gray-500',
  Anulada:  'bg-red-50 text-red-400',
};

/**
 * Estado de la orden tal como lo entiende el usuario: mezcla la decisión humana
 * guardada (Borrador/Emitida/Cerrada/Anulada) con el avance derivado, que es lo
 * que de verdad quiere saber cuando la orden está emitida.
 */
export function ChipEstadoOrden({ estado, estadoRecepcion }) {
  const texto = estado === 'Emitida'
    ? (estadoRecepcion === 'completa' ? 'Completa'
      : estadoRecepcion === 'parcial' ? 'Parcial' : 'Por recibir')
    : estado;
  const clase = estado === 'Emitida' && estadoRecepcion === 'completa'
    ? 'bg-green-100 text-green-700'
    : ESTADOS_ORDEN[estado] || 'bg-gray-100 text-gray-600';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${clase}`}>
      {texto}
    </span>
  );
}
