import { Tag } from 'lucide-react';
import { formatCOP } from '../../utils/formatters';
import { precioEnLista } from '../../utils/listasPrecios';

// ─────────────────────────────────────────────────────────────────────────────
// Chips de lista de precios.
//
// Deliberadamente el MISMO gesto y la misma forma que `SelectorTarifa`: el
// vendedor no tiene por qué aprender dos interacciones para contestar la misma
// pregunta. Son componentes separados —y no uno con un `modo`— porque lo que
// muestran es distinto: una tarifa enseña un porcentaje que hay que esconderle
// al vendedor, y una lista enseña el precio de verdad, que es justo lo que
// tiene que ver. Fundirlos obligaría a un condicional por cada línea.
//
// Se usa en dos escalas:
//   · `compacto = false` → barra del carrito, aplica a toda la venta.
//   · `compacto = true`  → chip por ítem.
//
// `valor` es el id de la lista activa, o null = precio de siempre / manual.
// Volver a tocar la lista activa la deselecciona.
// ─────────────────────────────────────────────────────────────────────────────

const COLORES = {
  green:  'bg-emerald-50 border-emerald-300 text-emerald-700',
  blue:   'bg-blue-50 border-blue-300 text-blue-700',
  purple: 'bg-purple-50 border-purple-300 text-purple-700',
  amber:  'bg-amber-50 border-amber-300 text-amber-700',
  gray:   'bg-gray-100 border-gray-300 text-gray-700',
};

const INACTIVO = 'bg-white border-gray-200 text-gray-500 hover:border-gray-300';

export function SelectorListaPrecio({
  listas,
  valor,
  onChange,
  compacto = false,
  label,
  // Precios de ESTE ítem, para poder pintar cuánto cuesta en cada lista sin
  // tener que tocarlas una por una para averiguarlo.
  precios = null,
}) {
  if (!listas?.length) return null;

  const tamano = compacto ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <div className="flex items-center gap-1.5">
          <Tag size={12} className="text-gray-400 flex-shrink-0" />
          <span className="text-xs font-medium text-gray-500">{label}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {listas.map((l) => {
          const activo = valor === l.id;
          const suyo   = precios ? precioEnLista(precios, l.id) : null;
          return (
            <button
              key={l.id}
              type="button"
              // Tocar la lista activa la quita: devuelve el precio de siempre.
              onClick={() => onChange(activo ? null : l)}
              title={precios && suyo == null
                ? `Este producto no tiene precio en "${l.nombre}" — se cobra su precio normal`
                : undefined}
              className={`rounded-full border font-medium transition-colors ${tamano}
                ${activo ? (COLORES[l.color] || COLORES.blue) : INACTIVO}`}
            >
              {l.nombre}
              {/* El precio va en el propio chip cuando se conoce: es la
                  diferencia que hace que el vendedor no tenga que ir tocando
                  chips para ver cuánto cuesta en cada lista. */}
              {suyo != null && (
                <span className="ml-1 opacity-70">{formatCOP(suyo)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chip de lista para UN ítem del carrito, con el aviso de cuándo el precio que
// se está cobrando NO es el de la lista elegida.
//
// Ese aviso es la pieza que evita el error caro: con una lista a medio llenar,
// el producto que nadie tarifó se cobraría a su precio normal sin que nada lo
// diga, y en una venta al por mayor eso es cobrar de más y perder al cliente.
// ─────────────────────────────────────────────────────────────────────────────
export function ListaPrecioItem({ item, listas, onAplicar }) {
  return (
    <div className="flex flex-col gap-1">
      <SelectorListaPrecio
        compacto
        listas={listas}
        valor={item.lista_precio_id || null}
        precios={item.precios}
        onChange={(l) => onAplicar(item.key, l)}
      />
      {item.sin_precio_en_lista && (
        <span className="text-[11px] text-amber-600">
          Sin precio en esa lista — va a su precio normal
        </span>
      )}
    </div>
  );
}

export default SelectorListaPrecio;
