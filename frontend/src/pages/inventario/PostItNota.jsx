import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { StickyNote, Trash2, Check, X } from 'lucide-react';

const ANCHO_POPOVER = 256; // w-64

// ─── Franja visible tipo post-it (solo lectura) ──────────────────────────────
// Se muestra en tarjetas y cabeceras cuando el ítem tiene una nota.
export function NotaStrip({ nota, className = '' }) {
  if (!nota || !String(nota).trim()) return null;
  return (
    <div
      className={`flex items-start gap-1.5 bg-amber-50 border border-amber-200
        rounded-lg px-2 py-1 ${className}`}
    >
      <StickyNote size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <span className="text-xs text-amber-800 leading-snug whitespace-pre-wrap break-words">
        {nota}
      </span>
    </div>
  );
}

// ─── Botón + popover para crear / editar / borrar la nota ─────────────────────
// onGuardar(texto) debe devolver una promesa; texto === '' significa borrar.
// El popover se renderiza en un portal con posición fija para no recortarse
// dentro de contenedores con overflow (listas scrollables).
export function PostItNota({ nota, onGuardar, titulo = 'Nota / recordatorio' }) {
  const [abierto,   setAbierto]   = useState(false);
  const [texto,     setTexto]     = useState(nota || '');
  const [guardando, setGuardando] = useState(false);
  const [error,     setError]     = useState('');
  const [coords,    setCoords]    = useState({ top: 0, left: 0 });
  const triggerRef  = useRef(null);
  const popoverRef  = useRef(null);
  const textareaRef = useRef(null);

  const tieneNota = !!(nota && String(nota).trim());

  const recomputarPos = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const alto = popoverRef.current?.offsetHeight || 190;
    let left = rect.right - ANCHO_POPOVER;
    left = Math.max(8, Math.min(left, window.innerWidth - ANCHO_POPOVER - 8));
    // Abre abajo; si no cabe, abre arriba
    let top = rect.bottom + 4;
    if (top + alto > window.innerHeight - 8) top = Math.max(8, rect.top - alto - 4);
    setCoords({ top, left });
  }, []);

  // Sincroniza el texto al abrir (por si la nota cambió desde afuera)
  useEffect(() => {
    if (abierto) {
      setTexto(nota || '');
      setError('');
      setTimeout(() => textareaRef.current?.focus(), 40);
    }
  }, [abierto, nota]);

  // Posiciona el popover y lo mantiene pegado al botón al hacer scroll/resize
  useLayoutEffect(() => {
    if (!abierto) return;
    recomputarPos();
    const onScroll = () => recomputarPos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [abierto, recomputarPos]);

  // Cerrar al hacer click fuera (botón o popover)
  useEffect(() => {
    if (!abierto) return;
    const handler = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setAbierto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [abierto]);

  const guardar = async (valor) => {
    setGuardando(true);
    setError('');
    try {
      await onGuardar(valor);
      setAbierto(false);
    } catch (err) {
      setError(err?.response?.data?.error || 'No se pudo guardar la nota');
    } finally {
      setGuardando(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); setAbierto(false); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      guardar(texto.trim());
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setAbierto((v) => !v); }}
        title={tieneNota ? 'Editar nota' : 'Agregar nota'}
        className={`p-1.5 rounded-lg transition-colors flex-shrink-0
          ${tieneNota
            ? 'text-amber-500 bg-amber-50 hover:bg-amber-100'
            : 'text-gray-300 hover:text-amber-500 hover:bg-amber-50'}`}
      >
        <StickyNote size={15} />
      </button>

      {abierto && createPortal(
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: ANCHO_POPOVER }}
          className="z-[60] bg-white border border-amber-200 rounded-xl shadow-lg p-3
            flex flex-col gap-2"
        >
          <div className="flex items-center gap-1.5">
            <StickyNote size={13} className="text-amber-500" />
            <span className="text-xs font-semibold text-gray-600">{titulo}</span>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="ml-auto text-gray-300 hover:text-gray-500"
            >
              <X size={14} />
            </button>
          </div>

          <textarea
            ref={textareaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            maxLength={280}
            placeholder="Ej: Está donde el técnico, lo tiene Juan..."
            className="w-full px-2.5 py-2 bg-amber-50/60 border border-amber-200 rounded-lg
              text-xs text-gray-700 resize-none placeholder:text-amber-300
              focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all"
          />

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center gap-2">
            {tieneNota && (
              <button
                type="button"
                onClick={() => guardar('')}
                disabled={guardando}
                className="flex items-center gap-1 text-xs font-medium text-red-400
                  hover:text-red-600 disabled:opacity-50 transition-colors"
                title="Borrar nota"
              >
                <Trash2 size={13} /> Borrar
              </button>
            )}
            <button
              type="button"
              onClick={() => guardar(texto.trim())}
              disabled={guardando || texto.trim() === (nota || '').trim()}
              className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg
                bg-amber-500 text-white text-xs font-medium
                hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Check size={13} /> {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
