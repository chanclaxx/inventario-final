import { Modal } from '../../../components/ui/Modal';
import { ArrowRightLeft, Truck, ChevronRight, Loader2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// «¿A DÓNDE VA?» — la bodega elige destino, y el destino decide el tipo
//
// Ocupa el mismo hueco del carrito que tenía «Despachar»: en un celular no se
// pierde ni un píxel. El tipo no se elige de memoria: las sedes propias van
// arriba (traslado, sin cuenta) y los locales abajo (despacho, genera cuenta),
// así que no hay forma de despacharle a la tienda propia por error. El backend
// lo rechaza igual si alguien lo intenta.
// ─────────────────────────────────────────────────────────────────────────────

function Opcion({ nombre, detalle, icono, onClick, cargando }) {
  const Icono = icono;
  return (
    <button type="button" onClick={onClick} disabled={cargando}
      className="w-full flex items-center gap-3 px-4 py-3.5 border-t border-gray-50 text-left hover:bg-gray-50 disabled:opacity-60">
      <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
        <Icono size={16} className="text-gray-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{nombre}</p>
        <p className="text-xs text-gray-400">{detalle}</p>
      </div>
      {cargando ? <Loader2 size={15} className="animate-spin text-gray-400" /> : <ChevronRight size={15} className="text-gray-300" />}
    </button>
  );
}

/**
 * @param {{ sedes: {id:number,nombre:string}[], locales: {id:number,nombre:string}[],
 *           cargando?: number|null, onTrasladar: Function, onDespachar: Function, onCerrar: Function }} props
 */
export function HojaEnviar({ sedes, locales, cargando = null, onTrasladar, onDespachar, onCerrar }) {
  return (
    <Modal open onClose={onCerrar} title="¿A dónde va?" size="sm">
      <div className="-mx-1 flex flex-col">
        {sedes.length > 0 && (
          <div className="rounded-xl border border-gray-100 overflow-hidden mb-3">
            <p className="px-4 py-2 text-[11px] font-semibold text-blue-700 bg-blue-50 uppercase">
              Tus sedes · traslado, sin cuenta
            </p>
            {sedes.map((s) => (
              <Opcion key={s.id} nombre={s.nombre} detalle="Trasladar" icono={ArrowRightLeft}
                cargando={cargando === s.id} onClick={() => onTrasladar(s.id)} />
            ))}
          </div>
        )}
        {locales.length > 0 && (
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <p className="px-4 py-2 text-[11px] font-semibold text-gray-500 bg-gray-50 uppercase">
              Locales · despacho, genera cuenta
            </p>
            {locales.map((s) => (
              <Opcion key={s.id} nombre={s.nombre} detalle="Despachar" icono={Truck}
                cargando={cargando === s.id} onClick={() => onDespachar(s.id)} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
