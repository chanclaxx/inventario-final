import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';

// Las variantes de un producto NO cargaron (límite de peticiones, corte de 30 s,
// sin señal). Antes esto se pintaba igual que «este producto no tiene
// atributos», con el botón de agregar el producto ENTERO: la venta salía sin
// talla, bajaba el total y ninguna talla, y el árbol quedaba descuadrado
// (Tesla, facturas #172 y #199 y préstamos de Bunny, sep-2026).
// Aquí no se ofrece agregar nada: sin saber qué variantes hay, cualquier
// botón sería adivinar. Solo reintentar.
export function ErrorArbolVariantes({ error, onReintentar, reintentando }) {
  const status  = error?.response?.status;
  const detalle = status === 429
    ? 'Se hicieron demasiadas consultas en poco tiempo. Espera unos segundos y reintenta.'
    : (error?.response?.data?.error || 'Revisa la conexión y reintenta.');
  return (
    <div className="flex flex-col items-center gap-3 py-10 px-4 text-center">
      <AlertTriangle size={22} className="text-amber-500" />
      <p className="text-sm font-medium text-gray-700">No se pudieron cargar las variantes de este producto</p>
      <p className="text-xs text-gray-500">{detalle}</p>
      <Button variant="secondary" size="sm" disabled={reintentando} onClick={onReintentar}>
        <RefreshCw size={14} className={reintentando ? 'animate-spin' : ''} />
        {reintentando ? 'Cargando…' : 'Reintentar'}
      </Button>
    </div>
  );
}
