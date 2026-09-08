import { useQuery } from '@tanstack/react-query';
import { getArbol } from '../../api/variantesProductoApi';
import { hojasDelArbol } from '../../pages/proveedores/capturaMercancia.utils';
import { Spinner } from './Spinner';

// ─────────────────────────────────────────────────────────────────────────────
// A QUÉ VARIANTE ENTRA LA MERCANCÍA RETOMADA.
//
// Con la feature «Variantes» activa el stock vive en la HOJA del árbol y el del
// producto es un DERIVADO. Una retoma que escriba arriba deja el producto
// diciendo 5 con sus tallas en 0, y el primer ajuste sobre cualquier variante
// dispara la sincronización, que recalcula producto = Σ variantes y BORRA lo
// retomado. Es el mismo error que ya costó corregir en la red interna y en el
// código escaneable.
//
// Vive en components/ui y no dentro de una pantalla porque lo comparten las
// tres puertas de retoma —venta, intercambio contra un préstamo y retoma
// directa— y la de préstamos ni siquiera está en la misma carpeta. Una copia
// por pantalla es exactamente cómo se separaron las cuatro rutas de retoma en
// el backend.
//
// Se ofrece la HOJA, igual que en el despacho de la red interna y en las
// etiquetas: un contenedor con variantes debajo no es un sitio donde pueda
// haber stock.
//
// Si el producto NO tiene variantes no pinta nada y no estorba: la inmensa
// mayoría de los negocios no usa la feature y para ellos la pantalla queda
// exactamente como estaba.
// ─────────────────────────────────────────────────────────────────────────────

export function SelectorNodoRetoma({ productoId, sucursalId, atributoId, varianteId, onElegir }) {
  const { data: arbol = [], isLoading } = useQuery({
    queryKey: ['arbol-producto', productoId, sucursalId],
    queryFn:  () => getArbol(productoId, sucursalId).then((r) => r.data.data),
    enabled:  Boolean(productoId) && Boolean(sucursalId),
    staleTime: 30_000,
  });

  const hojas = hojasDelArbol(arbol);
  if (!productoId) return null;
  if (isLoading) return <Spinner className="py-2 scale-75" />;
  // Producto sin variantes: el stock vive en el producto y no hay nada que elegir.
  if (hojas.length === 0) return null;

  const actual = varianteId ? `v-${varianteId}` : atributoId ? `a-${atributoId}` : null;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">
        ¿A cuál entra? <span className="text-red-400">*</span>
      </label>
      <div className="max-h-32 overflow-y-auto flex flex-col gap-0.5 rounded-xl border border-gray-100 bg-white p-1">
        {hojas.map((h) => (
          <button
            key={h.key} type="button"
            onClick={() => onElegir({
              atributo_id: h.tipo === 'atributo' ? h.id : null,
              variante_id: h.tipo === 'variante' ? h.id : null,
              label:       h.labelPadre ? `${h.labelPadre} · ${h.label}` : h.label,
            })}
            className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-left text-xs transition-colors
              ${h.key === actual
                ? 'bg-purple-100 text-purple-800 font-medium'
                : 'text-gray-700 hover:bg-gray-50'}`}>
            <span className="truncate">{h.labelPadre ? `${h.labelPadre} · ` : ''}{h.label}</span>
            <span className="flex-shrink-0 text-gray-400">{h.stock} en stock</span>
          </button>
        ))}
      </div>
      {!actual && (
        <p className="text-xs text-amber-600">
          Este producto se maneja por variantes: elige a cuál entra o el stock quedaría en el sitio equivocado.
        </p>
      )}
    </div>
  );
}
