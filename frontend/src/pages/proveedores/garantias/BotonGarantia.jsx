import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useGarantiasProveedor } from '../../../hooks/useEnGarantia';
import { ModalNuevaGarantia }     from './ModalNuevaGarantia';
import { ModalDocumentoGarantia } from './ModalDocumentoGarantia';

// ─────────────────────────────────────────────────────────────────────────────
// La puerta a garantías desde cualquier documento: la línea de una factura, un
// préstamo, un equipo o un producto del inventario. Llega al mismo formulario
// con el origen ya puesto, así que nadie tiene que acordarse «por dónde se
// hacía». Sin la función encendida o sin el permiso de recibir, no pinta nada.
//
// `origen`: { linea_factura_id } | { prestamo_id } | { serial_id } |
//           { producto_id, atributo_id?, variante_id? }
// ─────────────────────────────────────────────────────────────────────────────
export function BotonGarantia({ origen, variante = 'chip', texto = 'Garantía', className = '', onCreada }) {
  const { puede } = useGarantiasProveedor();
  const [abierto, setAbierto]   = useState(false);
  const [imprimir, setImprimir] = useState(null);
  if (!puede('recibir')) return null;

  const clases = variante === 'boton'
    ? 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-rose-50 text-rose-700 hover:bg-rose-100'
    : variante === 'icono'
      ? 'p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50'
      : 'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border border-rose-200 text-rose-700 bg-white hover:bg-rose-50';

  return (
    <>
      <button type="button" title="Mandar a garantía con el proveedor"
        onClick={(e) => { e.stopPropagation(); setAbierto(true); }}
        className={`${clases} ${className}`}>
        <ShieldAlert size={variante === 'boton' ? 15 : 12} />
        {variante !== 'icono' && texto}
      </button>
      {abierto && (
        <ModalNuevaGarantia origen={origen} onClose={() => setAbierto(false)} onCreada={onCreada}
          onImprimir={(id) => { setAbierto(false); setImprimir(id); }} />
      )}
      {imprimir && <ModalDocumentoGarantia reclamoId={imprimir} onClose={() => setImprimir(null)} />}
    </>
  );
}
