import { useState } from 'react';
import { Tag, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCOP } from '../../utils/formatters';
import { precioEnLista, buscarLista } from '../../utils/listasPrecios';

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
// La lista de UN ítem — COLAPSADA salvo que se toque.
//
// Antes esto pintaba los tres chips con su precio en cada producto. En una
// columna de 288px, «Al por mayor $5.800» mide unos 116px, así que los tres se
// partían en dos o tres renglones: ~50px permanentes POR PRODUCTO, y eso se
// multiplica. Con el panel acotado a la pantalla, el carrito quedaba enseñando
// un producto y medio y el resto era información.
//
// La proporción estaba al revés: la lista de la venta se elige ARRIBA y una
// sola vez; cambiársela a UNA línea suelta es la excepción —«todo va al por
// mayor menos este»—. Lo excepcional no puede cobrar alto en cada fila.
//
// Colapsado es un renglón que dice en qué lista está y se puede tocar. Lo que
// NO se esconde nunca es el aviso de que el precio no vino de la lista elegida:
// ese es justo el que hay que ver antes de cobrar.
// ─────────────────────────────────────────────────────────────────────────────
export function ListaPrecioItem({ item, listas, onAplicar }) {
  const [abierto, setAbierto] = useState(false);
  const activa = buscarLista(listas, item.lista_precio_id);

  // Qué dice el renglón cuando está cerrado. «Precio normal» y no un hueco en
  // blanco: sin lista elegida el producto SÍ se está cobrando a algo, y decirlo
  // es lo que evita que alguien crea que falta configurar cada línea.
  const etiqueta = activa ? activa.nombre : 'Precio normal';

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex items-center gap-1 text-[11px] text-gray-500
          hover:text-gray-700 transition-colors w-full text-left"
      >
        <Tag size={10} className="text-gray-300 flex-shrink-0" />
        <span className={`truncate ${activa ? 'text-gray-600 font-medium' : ''}`}>{etiqueta}</span>
        {item.sin_precio_en_lista && (
          <span className="text-amber-600 flex-shrink-0">· sin precio en esa lista</span>
        )}
        <ChevronDown size={11} className="text-gray-300 flex-shrink-0 ml-auto" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <SelectorListaPrecio
        compacto
        listas={listas}
        valor={item.lista_precio_id || null}
        precios={item.precios}
        onChange={(l) => { onAplicar(item.key, l); setAbierto(false); }}
      />
      {item.sin_precio_en_lista && (
        <span className="text-[11px] text-amber-600">
          Sin precio en esa lista — va a su precio normal
        </span>
      )}
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600"
      >
        <ChevronUp size={11} /> Cerrar
      </button>
    </div>
  );
}

export default SelectorListaPrecio;
