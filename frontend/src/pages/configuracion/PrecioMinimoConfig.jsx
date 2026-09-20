import { ToggleLeft, ToggleRight, ShieldCheck, AlertTriangle, Gift } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// PRECIO MÍNIMO DE VENTA (feature opt-in: `precio_minimo_activo`)
//
// Encendido, nadie factura, presta ni despacha a un local por debajo del menor
// de los precios escritos del producto: el predeterminado y, con listas de
// precios, el de cada lista. Lo impone el backend (utils/precioMinimo.util.js); ausente
// o en '0' todo sigue como siempre. Excluyente con las tarifas porcentuales.
// ─────────────────────────────────────────────────────────────────────────────

export function PrecioMinimoConfig({ valores, set }) {
  const activo = valores.precio_minimo_activo === '1';
  const tarifasActivas = valores.tarifas_activo === '1';
  const listasActivas  = valores.listas_precios_activo === '1';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-blue-600" />
        <h3 className="font-semibold text-gray-900">Precio mínimo</h3>
      </div>

      {tarifasActivas && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50
          border border-amber-100 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Tienes las <b>tarifas porcentuales</b> activas: calculan el precio desde el
            costo y este candado las rechazaría. Apágalas antes de encender esto.
          </span>
        </div>
      )}

      <div className={`flex items-center justify-between gap-4 ${tarifasActivas ? 'opacity-40' : ''}`}>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-gray-700">No vender por debajo del precio</span>
          <span className="text-xs text-gray-400">
            Al facturar, prestar o despachar a un local, el precio no puede quedar por
            debajo del precio de venta del producto
            {listasActivas ? ' ni del más bajo de sus listas de precios' : ''}.
            Un producto sin precio registrado no tiene mínimo.
          </span>
        </div>
        <button
          type="button"
          disabled={tarifasActivas}
          onClick={() => set('precio_minimo_activo', activo ? '0' : '1')}
          className="flex-shrink-0 transition-colors"
          aria-pressed={activo}
        >
          {activo
            ? <ToggleRight size={28} className="text-blue-600" />
            : <ToggleLeft  size={28} className="text-gray-300" />}
        </button>
      </div>

      {/* Los obsequios son la salida que el candado necesita: sin ellos, para
          regalar un vidrio habría que cobrarlo al mínimo o inventar un
          descuento en el equipo. Solo aparecen con el candado encendido, que es
          cuando poner $0 a mano deja de ser posible. */}
      {activo && (
        <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50
          border border-emerald-100 rounded-xl px-3 py-2.5">
          <Gift size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            <b>Obsequios.</b> Con esto encendido, el carrito gana el botón «Marcar como
            obsequio»: ese producto se factura en <b>$0</b> —la factura y el recibo dicen
            «Obsequio»— y <b>su costo se sigue descontando de la utilidad</b>. Así, un
            celular entregado con vidrio y estuche de regalo reporta el costo de los tres
            productos y una utilidad menor, que es lo que de verdad pasó.
          </span>
        </div>
      )}
    </div>
  );
}

export default PrecioMinimoConfig;
