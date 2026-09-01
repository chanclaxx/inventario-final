import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { crearUbicacion, actualizarUbicacion } from '../../api/ubicaciones.api';
import {
  TIPOS_UBICACION, COLORES_UBICACION, aplanarArbol, ramaDe,
} from '../../utils/ubicaciones';

// ─────────────────────────────────────────────────────────────────────────────
// Crear o renombrar una ubicación.
//
// Renombrar es UNA fila. En el modelo viejo era un UPDATE masivo de texto libre
// sobre cada producto, y un error de tecleo bifurcaba el estante en silencio.
//
// El tope de 60 caracteres es el mismo del backend (utils/ubicacion.util.js) y
// se avisa aquí para no gastar un viaje al servidor en un error de forma.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NOMBRE = 60;

export function ModalUbicacion({ open, onClose, ubicacion, arbol, padrePorDefecto = null }) {
  const queryClient = useQueryClient();
  const editando    = !!ubicacion;

  // El componente solo existe mientras el modal está abierto (lo monta y
  // desmonta `TabUbicaciones`), así que el estado inicial ES el de la ubicación
  // que se está editando. Sin eso haría falta un efecto que resincronizara al
  // abrir, que es una cascada de renders y además deja una ventana en la que el
  // formulario muestra los datos del anterior.
  const [nombre,      setNombre]      = useState(ubicacion?.nombre ?? '');
  const [tipo,        setTipo]        = useState(ubicacion?.tipo ?? '');
  const [padreId,     setPadreId]     = useState(String(ubicacion?.padre_id ?? padrePorDefecto ?? ''));
  const [color,       setColor]       = useState(ubicacion?.color ?? '');
  const [descripcion, setDescripcion] = useState(ubicacion?.descripcion ?? '');
  const [error,       setError]       = useState(null);

  // No se ofrece como padre la propia ubicación ni nada que cuelgue de ella:
  // sería un ciclo y el árbol dejaría de poder recorrerse. El backend lo
  // rechaza igual; esto solo evita ofrecer una opción condenada a fallar.
  const posiblesPadres = useMemo(() => {
    const planas  = aplanarArbol(arbol);
    const excluir = editando ? ramaDe(arbol, ubicacion.id) : new Set();
    // El backend permite 4 niveles: una ubicación de profundidad 4 ya no puede
    // ser padre de nadie.
    return planas.filter((p) => !excluir.has(Number(p.id)) && p.profundidad < 3);
  }, [arbol, editando, ubicacion]);

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        nombre,
        tipo:        tipo || null,
        color:       color || null,
        descripcion: descripcion || null,
        padre_id:    padreId ? Number(padreId) : null,
      };
      return editando
        ? actualizarUbicacion(ubicacion.id, cuerpo)
        : crearUbicacion(cuerpo);
    },
    onSuccess: () => {
      // El catálogo plano también cambia: alimenta el autocompletado del
      // inventario, que no sabe nada de este modal.
      queryClient.invalidateQueries({ queryKey: ['ubicaciones-arbol'] });
      queryClient.invalidateQueries({ queryKey: ['ubicaciones'] });
      onClose();
    },
    onError: (err) => {
      setError(err?.response?.data?.error ?? 'No se pudo guardar la ubicación');
    },
  });

  const enviar = (e) => {
    e.preventDefault();
    const limpio = nombre.trim();
    if (!limpio) { setError('Ponle un nombre a la ubicación'); return; }
    if (limpio.length > MAX_NOMBRE) {
      setError(`El nombre no puede pasar de ${MAX_NOMBRE} caracteres`);
      return;
    }
    setError(null);
    guardar.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editando ? 'Editar ubicación' : 'Nueva ubicación'}
    >
      <form onSubmit={enviar} className="p-5 flex flex-col gap-5">

        {/* ── Nombre ── */}
        <div className="flex flex-col gap-1">
          <label htmlFor="ubi-nombre" className="text-sm font-medium text-gray-700">
            Nombre
          </label>
          <input
            id="ubi-nombre"
            type="text"
            autoFocus
            maxLength={MAX_NOMBRE}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Estante A-3, Vitrina 2, Cajón B7"
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
              placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all"
          />
          <span className="text-xs text-gray-400">
            {nombre.length}/{MAX_NOMBRE}
          </span>
        </div>

        {/* ── Dentro de ── */}
        {posiblesPadres.length > 0 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="ubi-padre" className="text-sm font-medium text-gray-700">
              Dentro de <span className="text-gray-400 font-normal text-xs">(opcional)</span>
            </label>
            <select
              id="ubi-padre"
              value={padreId}
              onChange={(e) => setPadreId(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            >
              <option value="">— Nivel principal —</option>
              {posiblesPadres.map((p) => (
                <option key={p.id} value={p.id}>
                  {'  '.repeat(p.profundidad)}{p.profundidad > 0 ? '└ ' : ''}{p.nombre}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-400">
              Bodega A → Estante 1 → Nivel 2. Hasta 4 niveles.
            </span>
          </div>
        )}

        {/* ── Tipo ── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-700">
            Tipo <span className="text-gray-400 font-normal text-xs">(solo cambia el icono)</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {TIPOS_UBICACION.map((t) => {
              // El icono se saca del objeto en el cuerpo, no destructurando el
              // parámetro: sin eslint-plugin-react, el uso dentro de JSX no
              // cuenta como referencia y un parámetro destructurado no entra en
              // `varsIgnorePattern`. Como `const`, sí.
              const Icn = t.Icn;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTipo(tipo === t.id ? '' : t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm
                    border transition-colors ${tipo === t.id
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  <Icn size={14} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Color ── */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-gray-700">
            Color <span className="text-gray-400 font-normal text-xs">(para el mapa)</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {COLORES_UBICACION.map(({ id, clase, anillo }) => (
              <button
                key={id}
                type="button"
                aria-label={`Color ${id}`}
                onClick={() => setColor(color === id ? '' : id)}
                className={`w-8 h-8 rounded-full ${clase} transition-all
                  ${color === id ? `ring-2 ring-offset-2 ${anillo}` : 'hover:scale-110'}`}
              />
            ))}
          </div>
        </div>

        {/* ── Nota ── */}
        <div className="flex flex-col gap-1">
          <label htmlFor="ubi-desc" className="text-sm font-medium text-gray-700">
            Nota <span className="text-gray-400 font-normal text-xs">(opcional)</span>
          </label>
          <input
            id="ubi-desc"
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: al fondo a la izquierda, junto a la puerta"
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
              placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={guardar.isPending}>
            {editando ? 'Guardar' : 'Crear ubicación'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
