import { Search, X } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// El cuadro para buscar una variante dentro de un producto. Recibe el objeto de
// `useBuscadorVariantes` y NO pinta nada mientras la lista sea corta: quien lo
// monta no tiene que preguntar si hace falta.
//
// `onUnico` (opcional): qué hacer al pulsar Enter cuando queda UNA sola
// coincidencia. Es lo que vuelve esto rápido con teclado —«38 neg», Enter— y
// con el lector, que teclea el código de la etiqueta y pulsa Enter él solo.
// Con varias coincidencias Enter no elige nada: adivinar cuál sería peor que
// pedir una letra más.
// ─────────────────────────────────────────────────────────────────────────────
export function BuscadorVariantes({ buscador, onUnico, placeholder = 'Buscar variante…', autoFocus = false }) {
  if (!buscador.activo) return null;

  const { consulta, setConsulta, limpiar, visibles, total } = buscador;
  const hayTexto = consulta.trim() !== '';
  const unica    = hayTexto && visibles.length === 1;

  const alTeclear = (e) => {
    if (e.key === 'Enter') {
      // Siempre se frena: dentro de un formulario, Enter lo enviaría.
      e.preventDefault();
      if (unica && onUnico) onUnico(visibles[0]);
    } else if (e.key === 'Escape' && hayTexto) {
      // Escape borra la búsqueda antes de dejar que cierre lo que haya debajo.
      e.stopPropagation();
      limpiar();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={alTeclear}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-label="Buscar variante"
          className="w-full pl-8 pr-20 py-1.5 bg-white border border-gray-200 rounded-lg text-xs
            text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400
            focus:border-transparent"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400 tabular-nums">
            {hayTexto ? `${visibles.length} de ${total}` : `${total}`}
          </span>
          {hayTexto && (
            <button type="button" onClick={limpiar} aria-label="Borrar la búsqueda"
              className="text-gray-400 hover:text-gray-600 transition-colors">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {hayTexto && visibles.length === 0 && (
        <p className="text-[11px] text-gray-400 px-1">
          Ninguna variante coincide con «{consulta.trim()}»
        </p>
      )}
      {unica && onUnico && (
        <p className="text-[11px] text-blue-500 px-1">Enter para elegirla</p>
      )}
    </div>
  );
}

export default BuscadorVariantes;
