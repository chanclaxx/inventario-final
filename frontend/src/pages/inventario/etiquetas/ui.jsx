import { Check, ChevronDown, ChevronRight } from 'lucide-react';

// ── Piezas de la pantalla de etiquetas ───────────────────────────────────────
// Mismo patrón visual que Exportar inventario: tarjetas de opción con borde
// azul al elegirlas, chips redondos para lo que se enciende y se apaga.

/** Tarjeta de opción (una de varias). */
export function Opcion({ activo, onClick, icon: Icono, titulo, desc, className = '' }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`flex flex-col gap-1 p-3 rounded-xl border-2 text-left transition-all
        ${activo ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'} ${className}`}
    >
      <span className="flex items-center gap-2">
        {Icono && <Icono size={15} className={activo ? 'text-blue-600' : 'text-gray-400'} />}
        <span className={`text-sm font-semibold ${activo ? 'text-blue-700' : 'text-gray-700'}`}>{titulo}</span>
      </span>
      {desc && <span className="text-xs text-gray-400 leading-snug">{desc}</span>}
    </button>
  );
}

/** Chip que se enciende y se apaga. */
export function Casilla({ activo, onClick, children }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
        ${activo ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
    >
      {activo && <Check size={12} />}
      {children}
    </button>
  );
}

/**
 * Sección plegable. Plegada muestra el RESUMEN de lo que tiene adentro: con
 * tres secciones de ajustes, lo que el usuario necesita ver de un vistazo es
 * «Rollo 3 columnas · 32 × 25 mm», no un botón que dice «Papel».
 */
export function Seccion({ icon: Icono, titulo, resumen, abierta, onAlternar, children, alerta = false }) {
  return (
    <div className={`rounded-xl border ${alerta ? 'border-amber-300' : 'border-gray-200'} bg-white`}>
      <button
        type="button" onClick={onAlternar}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        {abierta ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
        {Icono && <Icono size={14} className="text-gray-500 flex-shrink-0" />}
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex-shrink-0">{titulo}</span>
        {resumen && (
          <span className="text-xs text-gray-400 truncate min-w-0 flex-1 text-right">{resumen}</span>
        )}
      </button>
      {abierta && <div className="px-3 pb-3 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

/**
 * Campo numérico en milímetros. Vacío es un valor legítimo (significa
 * «automático»: centrado, todo el espacio…), así que no se convierte a 0.
 */
export function CampoMm({ label, value, onChange, placeholder, min, max, step = '0.5', sufijo = 'mm', ayuda }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <span className="relative">
        <input
          type="number" inputMode="decimal"
          value={value ?? ''} min={min} max={max} step={step} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onWheel={(e) => e.currentTarget.blur()}
          className="w-full pl-3 pr-9 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
            placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
        />
        {sufijo && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">{sufijo}</span>
        )}
      </span>
      {ayuda && <span className="text-[11px] text-gray-400 leading-snug">{ayuda}</span>}
    </label>
  );
}

/** Selector de pocas opciones, en una fila. */
export function Segmentado({ opciones, valor, onCambiar, etiqueta }) {
  return (
    <div className="flex flex-col gap-1">
      {etiqueta && <span className="text-xs font-medium text-gray-600">{etiqueta}</span>}
      <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-xl">
        {opciones.map((o) => (
          <button
            key={String(o.valor)} type="button" onClick={() => onCambiar(o.valor)}
            className={`flex-1 min-w-[3rem] px-2 py-1.5 rounded-lg text-xs font-medium transition-all
              ${String(valor) === String(o.valor) ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {o.texto}
          </button>
        ))}
      </div>
    </div>
  );
}
