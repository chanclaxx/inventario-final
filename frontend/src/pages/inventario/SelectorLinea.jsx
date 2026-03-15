import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { Input }  from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/SearchInput';
import { getLineas, crearLinea } from '../../api/lineas.api';

// ─── Normaliza la respuesta del endpoint a un array seguro ────────────────────
function normalizarLineas(data) {
  if (Array.isArray(data))              return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  return [];
}

/**
 * SelectorLinea
 *
 * Muestra la lista de líneas existentes con buscador y permite crear una nueva.
 * Al seleccionar o crear llama a `onSeleccionar(linea)`.
 *
 * Props
 * ─────
 * @param {function} onSeleccionar   Callback que recibe el objeto línea seleccionada/creada
 * @param {string}   colorScheme     Esquema de color: 'blue' | 'green' | 'emerald'  (default 'blue')
 */
export function SelectorLinea({ onSeleccionar, colorScheme = 'blue' }) {
  const queryClient = useQueryClient();

  const [busqueda,      setBusqueda]      = useState('');
  const [creandoLinea,  setCreandoLinea]  = useState(false);
  const [nombreNuevo,   setNombreNuevo]   = useState('');
  const [error,         setError]         = useState('');

  // ── Colores dinámicos según esquema ──────────────────────────────────────
  const colores = {
    blue: {
      hover:      'hover:border-blue-200 hover:bg-blue-50',
      boton:      'text-blue-600 hover:text-blue-700',
      form:       'bg-blue-50 border border-blue-100',
      label:      'text-blue-700',
      ring:       'focus:ring-blue-500',
      btnPrimary: '',
    },
    green: {
      hover:      'hover:border-green-200 hover:bg-green-50',
      boton:      'text-green-600 hover:text-green-700',
      form:       'bg-green-50 border border-green-100',
      label:      'text-green-700',
      ring:       'focus:ring-green-400',
      btnPrimary: 'bg-green-600 hover:bg-green-700 text-white',
    },
    emerald: {
      hover:      'hover:border-emerald-200 hover:bg-emerald-50',
      boton:      'text-emerald-600 hover:text-emerald-700',
      form:       'bg-emerald-50 border border-emerald-100',
      label:      'text-emerald-700',
      ring:       'focus:ring-emerald-400',
      btnPrimary: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    },
  }[colorScheme] ?? {};

  // ── Query: líneas existentes ──────────────────────────────────────────────
  const { data: lineasRaw, isLoading } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
  });

  const lineasFiltradas = normalizarLineas(lineasRaw).filter((l) =>
    l.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  // ── Mutation: crear nueva línea ───────────────────────────────────────────
  const mutCrear = useMutation({
    mutationFn: () => crearLinea(nombreNuevo.trim()),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['lineas'], exact: false });
      onSeleccionar(res.data.data);
      setCreandoLinea(false);
      setNombreNuevo('');
      setError('');
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear la línea'),
  });

  const handleCrear = () => {
    setError('');
    if (!nombreNuevo.trim()) return setError('El nombre es requerido');
    mutCrear.mutate();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-gray-700">Línea de producto</p>

      <SearchInput
        value={busqueda}
        onChange={setBusqueda}
        placeholder="Buscar línea..."
      />

      {isLoading ? (
        <p className="text-xs text-gray-400 py-2">Cargando líneas...</p>
      ) : (
        <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
          {lineasFiltradas.length === 0 && (
            <p className="text-xs text-gray-400 px-1 py-2">
              {busqueda ? `Sin resultados para "${busqueda}"` : 'No hay líneas creadas aún'}
            </p>
          )}
          {lineasFiltradas.map((linea) => (
            <button
              key={linea.id}
              onClick={() => onSeleccionar(linea)}
              className={`flex items-center justify-between p-2.5 rounded-xl text-left text-sm
                bg-white border border-gray-100 transition-all ${colores.hover}`}
            >
              <span className="font-medium text-gray-800">{linea.nombre}</span>
              <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* ── Toggle formulario creación ── */}
      <button
        onClick={() => { setCreandoLinea((v) => !v); setError(''); setNombreNuevo(''); }}
        className={`text-xs font-medium text-left ${colores.boton}`}
      >
        {creandoLinea ? '− Cancelar' : '+ Crear nueva línea'}
      </button>

      {creandoLinea && (
        <div className={`rounded-xl p-3 flex flex-col gap-2 ${colores.form}`}>
          <p className={`text-xs font-semibold ${colores.label}`}>Nueva línea</p>
          <Input
            placeholder="Nombre (ej: Accesorios, Samsung, Apple…)"
            value={nombreNuevo}
            onChange={(e) => { setNombreNuevo(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCrear(); }}
            autoFocus
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => { setCreandoLinea(false); setNombreNuevo(''); setError(''); }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className={`flex-1 ${colores.btnPrimary}`}
              loading={mutCrear.isPending}
              disabled={!nombreNuevo.trim()}
              onClick={handleCrear}
            >
              Crear y seleccionar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}