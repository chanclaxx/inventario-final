import { useState } from 'react';
import { ToggleLeft, ToggleRight, Tag, Trash2, Plus, Info, AlertTriangle } from 'lucide-react';
import { parsearListas, MAX_LISTAS, MAX_NOMBRE } from '../../utils/listasPrecios';

// ─────────────────────────────────────────────────────────────────────────────
// LISTAS DE PRECIOS (feature opt-in por negocio)
//
// El negocio nombra sus listas —«1 Pasamano», «Al por mayor», «Cliente final»—
// y después le pone a cada producto su precio en cada una. En el mostrador el
// vendedor toca un chip y el carrito se reprecifica.
//
// Aquí solo se definen los NOMBRES. Los precios se ponen producto por producto
// desde el inventario, que es donde el usuario ya está mirando el producto.
//
// Todo lo que se escribe aquí son claves de `config_negocio`:
//   listas_precios_activo · listas_precios_lista
// Un negocio que no encienda el primer flag no ve absolutamente nada de esto.
// ─────────────────────────────────────────────────────────────────────────────

const COLORES = [
  { id: 'green',  clase: 'bg-emerald-500' },
  { id: 'blue',   clase: 'bg-blue-500'    },
  { id: 'purple', clase: 'bg-purple-500'  },
  { id: 'amber',  clase: 'bg-amber-500'   },
  { id: 'gray',   clase: 'bg-gray-400'    },
];

/**
 * Id estable derivado del nombre. Se genera UNA vez, al crear la lista.
 *
 * Esto NO es cosmético: el id es la clave con la que cada producto guarda su
 * precio. Renombrar «Pasamano» a «Mostrador» no puede cambiarlo, o los precios
 * de los 473 productos quedarían colgando de una clave que ya no existe.
 *
 * Determinista a propósito (nada de Date.now/Math.random): queda legible dentro
 * del JSON de config y no depende del reloj del navegador. Mismo criterio que
 * el de las tarifas.
 */
const _generarId = (nombre, idsExistentes) => {
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'lista';

  let id = base;
  let n = 2;
  while (idsExistentes.has(id)) id = `${base}-${n++}`;
  return id;
};

function Toggle({ enabled, onChange, label, description, disabled }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <span className="text-xs text-gray-400">{description}</span>}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className="flex-shrink-0 transition-colors"
        aria-pressed={enabled}
      >
        {enabled
          ? <ToggleRight size={28} className="text-blue-600" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </button>
    </div>
  );
}

export function ListasPreciosConfig({ valores, set }) {
  const activo = valores.listas_precios_activo === '1';
  const listas = parsearListas(valores.listas_precios_lista);

  // Las tarifas porcentuales contestan la misma pregunta con el mismo gesto, y
  // el backend no deja tener las dos encendidas. Se dice ANTES de que el
  // usuario intente guardar y reciba un 400 sin entender por qué.
  const tarifasActivas = valores.tarifas_activo === '1';

  const [nombre, setNombre] = useState('');
  const [color,  setColor]  = useState('blue');
  const [error,  setError]  = useState('');

  const setListas = (lista) => set('listas_precios_lista', JSON.stringify(lista));

  const handleAgregar = () => {
    const limpio = nombre.trim();
    if (!limpio)                      return setError('La lista necesita un nombre');
    if (limpio.length > MAX_NOMBRE)   return setError(`El nombre no puede pasar de ${MAX_NOMBRE} caracteres`);
    if (listas.length >= MAX_LISTAS)  return setError(`Máximo ${MAX_LISTAS} listas`);
    if (listas.some((l) => l.nombre.toLowerCase() === limpio.toLowerCase())) {
      return setError('Ya existe una lista con ese nombre');
    }

    const id = _generarId(limpio, new Set(listas.map((l) => l.id)));
    setListas([...listas, { id, nombre: limpio, color }]);
    setNombre('');
    setError('');
  };

  // Borrar la lista NO borra los precios que los productos tengan guardados en
  // ella: se quedan en el JSONB, invisibles. Se recuperan volviendo a crear una
  // lista con el mismo id — cosa que el generador hace sola si se reescribe el
  // mismo nombre. Es la razón de que el id se derive del nombre y no de un
  // contador: equivocarse borrando tiene vuelta atrás.
  const handleBorrar = (id) => {
    setListas(listas.filter((l) => l.id !== id));
    setError('');
  };

  const handleRenombrar = (id, nuevo) => {
    setListas(listas.map((l) => (l.id === id ? { ...l, nombre: nuevo.slice(0, MAX_NOMBRE) } : l)));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Tag size={18} className="text-blue-600" />
        <h3 className="font-semibold text-gray-900">Listas de precios</h3>
      </div>

      <p className="text-sm text-gray-500 leading-relaxed">
        Varios precios de venta por producto —por ejemplo «Al por mayor» y «Cliente
        final»— y el vendedor elige cuál con un toque al agregar al carrito.
        Los precios de cada producto se ponen desde el inventario.
      </p>

      {tarifasActivas && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50
          border border-amber-100 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Tienes las <b>tarifas porcentuales</b> activas. Las dos deciden el precio de
            venta en el carrito, así que no pueden convivir: apaga las tarifas antes de
            encender esto.
            <br />
            La diferencia: una tarifa <b>calcula</b> el precio desde el costo; una lista
            lo trae <b>escrito</b> producto por producto. Si tus precios son números
            redondos, o hay productos sin costo registrado, lo tuyo son las listas.
          </span>
        </div>
      )}

      <Toggle
        enabled={activo}
        disabled={tarifasActivas}
        onChange={(v) => set('listas_precios_activo', v ? '1' : '0')}
        label="Activar listas de precios"
        description="Apagado, cada producto se vende a su precio de siempre"
      />

      {activo && (
        <>
          <div className="flex flex-col gap-2">
            {listas.length === 0 && (
              <p className="text-xs text-gray-400">
                Todavía no has creado ninguna lista. Mientras no haya al menos una, el
                carrito se comporta como siempre.
              </p>
            )}
            {listas.map((l) => (
              <div key={l.id}
                className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0
                  ${COLORES.find((c) => c.id === l.color)?.clase || 'bg-blue-500'}`} />
                <input
                  value={l.nombre}
                  onChange={(e) => handleRenombrar(l.id, e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-sm text-gray-800
                    focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500
                    rounded-lg px-1.5 py-0.5"
                />
                <button type="button" onClick={() => handleBorrar(l.id)}
                  aria-label={`Borrar la lista ${l.nombre}`}
                  className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-gray-100 pt-4">
            <span className="text-xs font-medium text-gray-500">Agregar una lista</span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={nombre}
                onChange={(e) => { setNombre(e.target.value); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAgregar(); } }}
                placeholder="Ej: Al por mayor"
                maxLength={MAX_NOMBRE}
                className="flex-1 min-w-[160px] border border-gray-200 rounded-xl px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-1.5">
                {COLORES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={`Color ${c.id}`}
                    onClick={() => setColor(c.id)}
                    className={`w-6 h-6 rounded-full ${c.clase} transition-all
                      ${color === c.id ? 'ring-2 ring-offset-2 ring-gray-400' : 'opacity-50'}`}
                  />
                ))}
              </div>
              <button type="button" onClick={handleAgregar}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 text-white
                  text-sm font-medium hover:bg-blue-700 transition-colors">
                <Plus size={15} /> Agregar
              </button>
            </div>
            {error && <span className="text-xs text-red-500">{error}</span>}
          </div>

          <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50
            border border-gray-100 rounded-xl px-3 py-2.5">
            <Info size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />
            <span>
              Un producto sin precio en la lista elegida se cobra a su precio normal y el
              carrito lo avisa: nunca sale en $0.
              <br />
              Cambiar los precios de una lista es solo para administradores. Para que otro
              usuario pueda, dale el permiso en <b>Equipo → Usuarios</b>.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default ListasPreciosConfig;
