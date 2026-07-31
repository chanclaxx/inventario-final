import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { getUbicaciones } from '../../api/ubicaciones.api';
import { useSucursalKey } from '../../hooks/useSucursalKey';

// ─── Campo de ubicación con autocompletado ───────────────────────────────────
//
// Un solo componente para todos los sitios donde se captura la ubicación
// (alta de producto serial, alta por cantidad, compra a cliente y los dos
// modales de edición), para que se comporte igual en todos.
//
// El autocompletado no está para ahorrar tecleo, sino para que la misma
// ubicación no acabe escrita de tres formas: si "Estante A-3" ya existe, el
// bodeguero la ve y la elige en vez de inventar "estante a3".
//
// La lista de ubicaciones de una sucursal es corta por naturaleza (son sitios
// físicos), así que se trae completa una vez y se filtra en memoria — sin una
// petición por cada tecla.

const MAX_SUGERENCIAS = 8;

// Compara ignorando tildes y mayus/minus: "estante a3" encuentra "Estante A3".
const normalizar = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export function InputUbicacion({
  value,
  onChange,
  label = 'Ubicación',
  placeholder = 'Ej: Estante A-3, Vitrina 2...',
  id,
  autoFocus = false,
}) {
  const [abierto, setAbierto] = useState(false);
  const { sucursalKey, sucursalLista } = useSucursalKey();

  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ubicaciones', ...sucursalKey],
    queryFn:  () => getUbicaciones().then((r) => r.data.data),
    enabled:  sucursalLista,
    staleTime: 60_000,
  });

  const sugerencias = useMemo(() => {
    const q = normalizar(value);
    const lista = q
      ? ubicaciones.filter((u) => normalizar(u.ubicacion).includes(q))
      : ubicaciones;
    // Si lo escrito coincide exacto con la única sugerencia, no vale la pena
    // tapar el formulario con una lista de un solo elemento ya elegido.
    if (lista.length === 1 && normalizar(lista[0].ubicacion) === q) return [];
    return lista.slice(0, MAX_SUGERENCIAS);
  }, [ubicaciones, value]);

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
          <MapPin size={14} className="text-gray-400" />
          {label}
          <span className="text-gray-400 font-normal text-xs">(opcional)</span>
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          type="text"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value || ''}
          onChange={(e) => { onChange(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Escape') setAbierto(false); }}
          className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
            placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
            focus:bg-white transition-all"
        />

        {abierto && sugerencias.length > 0 && (
          <div className="absolute z-30 left-0 right-0 mt-1 flex flex-col max-h-48
            overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
            {sugerencias.map((u) => (
              <button
                key={u.ubicacion}
                type="button"
                // onMouseDown + preventDefault: con onClick, el blur del input
                // cerraría la lista antes de que el clic llegue al botón.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(u.ubicacion);
                  setAbierto(false);
                }}
                className="flex items-center justify-between gap-2 text-left px-3 py-2
                  hover:bg-blue-50 transition-colors"
              >
                <span className="text-sm text-gray-800 truncate">{u.ubicacion}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {u.productos} {u.productos === 1 ? 'producto' : 'productos'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Chip de ubicación (solo lectura) ────────────────────────────────────────
// Para las tarjetas y listas del inventario. No renderiza nada si el producto
// no tiene ubicación, así que es seguro llamarlo siempre.
export function UbicacionChip({ ubicacion, className = '' }) {
  if (!ubicacion || !String(ubicacion).trim()) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md
        bg-sky-50 border border-sky-100 text-[11px] text-sky-700 max-w-full ${className}`}
      title={`Ubicación: ${ubicacion}`}
    >
      <MapPin size={10} className="flex-shrink-0" />
      <span className="truncate">{ubicacion}</span>
    </span>
  );
}
