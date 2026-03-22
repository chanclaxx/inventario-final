import { useState, useRef, useCallback } from 'react';

// ─── Constantes ───────────────────────────────────────────────────────────────

const GRID_SIZE   = 3;
const NODOS       = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => i + 1);
const NODE_RADIUS = 18;
const GRID_GAP    = 72;
const PADDING     = 30;
const SVG_SIZE    = PADDING * 2 + GRID_GAP * (GRID_SIZE - 1);

function getPos(nodo) {
  const idx = nodo - 1;
  const col = idx % GRID_SIZE;
  const row = Math.floor(idx / GRID_SIZE);
  return { x: PADDING + col * GRID_GAP, y: PADDING + row * GRID_GAP };
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function PatronGrid({ value = [], onChange, readOnly = false }) {
  const [drawing, setDrawing]     = useState(false);
  const [current, setCurrent]     = useState(value);
  const [pointer, setPointer]     = useState(null);
  const svgRef = useRef(null);

  const getNodeFromEvent = useCallback((e) => {
    const svg  = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = ((clientX - rect.left) / rect.width) * SVG_SIZE;
    const y = ((clientY - rect.top) / rect.height) * SVG_SIZE;

    for (const nodo of NODOS) {
      const pos = getPos(nodo);
      const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
      if (dist < NODE_RADIUS + 8) return nodo;
    }
    return null;
  }, []);

  const handleStart = useCallback((e) => {
    if (readOnly) return;
    e.preventDefault();
    const nodo = getNodeFromEvent(e);
    if (nodo) {
      setDrawing(true);
      setCurrent([nodo]);
    }
  }, [readOnly, getNodeFromEvent]);

  const handleMove = useCallback((e) => {
    if (!drawing || readOnly) return;
    e.preventDefault();
    const svg  = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = ((clientX - rect.left) / rect.width) * SVG_SIZE;
    const y = ((clientY - rect.top) / rect.height) * SVG_SIZE;
    setPointer({ x, y });

    const nodo = getNodeFromEvent(e);
    if (nodo && !current.includes(nodo)) {
      setCurrent((prev) => [...prev, nodo]);
    }
  }, [drawing, readOnly, current, getNodeFromEvent]);

  const handleEnd = useCallback(() => {
    if (!drawing || readOnly) return;
    setDrawing(false);
    setPointer(null);
    if (current.length >= 2) {
      onChange(current);
    } else {
      setCurrent(value.length > 0 ? value : []);
    }
  }, [drawing, readOnly, current, onChange, value]);

  const handleClear = () => {
    if (readOnly) return;
    setCurrent([]);
    onChange([]);
  };

  // Líneas entre nodos seleccionados
  const lines = [];
  for (let i = 1; i < current.length; i++) {
    const from = getPos(current[i - 1]);
    const to   = getPos(current[i]);
    lines.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, key: `${current[i-1]}-${current[i]}` });
  }

  // Línea hacia el puntero mientras dibuja
  if (drawing && pointer && current.length > 0) {
    const last = getPos(current[current.length - 1]);
    lines.push({ x1: last.x, y1: last.y, x2: pointer.x, y2: pointer.y, key: 'pointer' });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          Patrón de desbloqueo
        </label>
        {current.length > 0 && !readOnly && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            Borrar
          </button>
        )}
      </div>

      <div className="flex justify-center">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          width={SVG_SIZE}
          height={SVG_SIZE}
          className="touch-none select-none rounded-xl bg-gray-50 border border-gray-200"
          style={{ maxWidth: '100%', cursor: readOnly ? 'default' : 'pointer' }}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        >
          {/* Líneas */}
          {lines.map((line) => (
            <line
              key={line.key}
              x1={line.x1} y1={line.y1}
              x2={line.x2} y2={line.y2}
              stroke={line.key === 'pointer' ? '#93c5fd' : '#3b82f6'}
              strokeWidth={line.key === 'pointer' ? 2 : 3}
              strokeLinecap="round"
              opacity={line.key === 'pointer' ? 0.5 : 0.8}
            />
          ))}

          {/* Nodos */}
          {NODOS.map((nodo) => {
            const pos        = getPos(nodo);
            const isSelected = current.includes(nodo);
            const order      = current.indexOf(nodo);
            return (
              <g key={nodo}>
                {/* Círculo exterior */}
                <circle
                  cx={pos.x} cy={pos.y} r={NODE_RADIUS}
                  fill={isSelected ? '#dbeafe' : '#f9fafb'}
                  stroke={isSelected ? '#3b82f6' : '#d1d5db'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                {/* Punto interior */}
                <circle
                  cx={pos.x} cy={pos.y}
                  r={isSelected ? 6 : 4}
                  fill={isSelected ? '#3b82f6' : '#9ca3af'}
                />
                {/* Número de orden */}
                {isSelected && (
                  <text
                    x={pos.x} y={pos.y - NODE_RADIUS - 6}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#3b82f6"
                  >
                    {order + 1}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {current.length > 0 && (
        <p className="text-xs text-center text-gray-400 font-mono">
          Patrón: {current.join(' → ')}
        </p>
      )}
      {current.length === 0 && !readOnly && (
        <p className="text-xs text-center text-gray-400">
          Dibuja el patrón arrastrando entre los puntos
        </p>
      )}
    </div>
  );
}