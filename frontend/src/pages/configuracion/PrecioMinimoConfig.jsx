import { ToggleLeft, ToggleRight, ShieldCheck, AlertTriangle } from 'lucide-react';

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
    </div>
  );
}

export default PrecioMinimoConfig;
