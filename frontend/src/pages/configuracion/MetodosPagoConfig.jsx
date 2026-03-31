import { useState } from 'react';
import { Plus, Trash2, GripVertical, CreditCard } from 'lucide-react';

const METODOS_DEFAULT = ['Efectivo', 'Nequi', 'Daviplata', 'Transferencia', 'Tarjeta'];

export function MetodosPagoConfig({ valores, set }) {
  const listaRaw = valores['metodos_pago'];
  const metodos  = (() => {
    try {
      const parsed = JSON.parse(listaRaw || '[]');
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : METODOS_DEFAULT;
    } catch {
      return METODOS_DEFAULT;
    }
  })();

  const [nuevoMetodo, setNuevoMetodo] = useState('');
  const [error,       setError]       = useState('');

  const setMetodos = (nuevaLista) => {
    set('metodos_pago', JSON.stringify(nuevaLista));
  };

  const handleAgregar = () => {
    const limpio = nuevoMetodo.trim();
    if (!limpio)                  return setError('El nombre del método es requerido');
    if (metodos.includes(limpio)) return setError('Este método ya existe');
    setMetodos([...metodos, limpio]);
    setNuevoMetodo('');
    setError('');
  };

  const handleEliminar = (metodo) => {
    const nuevaLista = metodos.filter((m) => m !== metodo);
    if (nuevaLista.length === 0) return setError('Debe haber al menos un método de pago');
    setMetodos(nuevaLista);
  };

  const handleRestaurar = () => {
    setMetodos(METODOS_DEFAULT);
    setError('');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <CreditCard size={15} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-700">Métodos de pago</h3>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Personaliza los métodos de pago disponibles al facturar y registrar abonos.
        Los datos históricos no se ven afectados.
      </p>

      {metodos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-2">
          Sin métodos configurados
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {metodos.map((metodo) => {
            const metodoNombre = metodo;
            return (
              <div key={metodoNombre}
                className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <GripVertical size={15} className="text-gray-300 flex-shrink-0" />
                <p className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">
                  {metodoNombre}
                </p>
                <button
                  onClick={() => handleEliminar(metodoNombre)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400
                    hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={nuevoMetodo}
          onChange={(e) => { setNuevoMetodo(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAgregar(); }}
          placeholder="Ej: PSE, Bancolombia, Crypto..."
          className="flex-1 px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
            text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2
            focus:ring-blue-500 focus:bg-white transition-all"
        />
        <button
          onClick={handleAgregar}
          className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center
            hover:bg-blue-700 transition-colors flex-shrink-0"
        >
          <Plus size={15} className="text-white" />
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={handleRestaurar}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors w-fit"
      >
        Restaurar métodos por defecto
      </button>
    </div>
  );
}