import { Tag } from 'lucide-react';

// En una sede que vende solo con listas de precios (opt-in por sede) los
// formularios de un producto por cantidad no piden «Precio de venta»: ese
// número ya no se cobra. Esto va en su lugar, para que no parezca que falta.
export function AvisoSoloListas({ className = '' }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs text-gray-500 ${className}`}>
      <Tag size={12} className="text-gray-400 flex-shrink-0" />
      El precio de venta se pone en «Precios por lista».
    </p>
  );
}

export default AvisoSoloListas;
