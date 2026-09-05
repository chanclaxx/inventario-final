import { useQuery } from '@tanstack/react-query';
import { getSucursales } from '../../api/sucursales.api';
import {
  ToggleLeft, ToggleRight, Warehouse, Info, AlertTriangle,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE LA RED INTERNA (bodega → locales)
//
// Se configura UNA vez y desaparece: el vendedor de un local nunca ve ninguna
// de estas opciones. Por eso el día a día solo tiene dos botones.
//
// Todo lo que se escribe aquí son claves de `config_negocio`:
//   red_interna_activa · red_interna_bodega_id · red_interna_modo_precio
//   red_interna_confirmar_recepcion · red_interna_confirmar_remesa
//   red_interna_bloquear_traslados
// Un negocio que no active el primer flag no tiene la funcionalidad: el
// backend responde 404 y el menú no muestra nada.
// ─────────────────────────────────────────────────────────────────────────────

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

export function RedInternaConfig({ valores, set }) {
  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const activa   = valores.red_interna_activa === '1';
  const bodegaId = valores.red_interna_bodega_id || '';
  const activas  = sucursales.filter((s) => s.activa);

  const sinBodega = activa && !bodegaId;
  const pocasSuc  = activas.length < 2;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Warehouse size={18} className="text-gray-400" />
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Distribución desde bodega</h3>
          <p className="text-xs text-gray-400">
            Una sucursal surte a las demás y lleva la cuenta de lo entregado.
          </p>
        </div>
      </div>

      {pocasSuc && (
        <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-start gap-2">
          <Info size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-gray-500">
            Necesitas al menos dos sucursales activas para usar esta modalidad.
          </p>
        </div>
      )}

      <Toggle
        enabled={activa}
        disabled={pocasSuc}
        onChange={(v) => set('red_interna_activa', v ? '1' : '0')}
        label="Activar distribución desde bodega"
        description="Los locales reciben mercancía en consignación y remiten el efectivo."
      />

      {activa && (
        <div className="flex flex-col gap-4 pl-1 border-l-2 border-blue-100 ml-1">
          <div className="pl-4 flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">¿Cuál sucursal es la bodega?</label>
            <select
              value={bodegaId}
              onChange={(e) => set('red_interna_bodega_id', e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Selecciona…</option>
              {activas.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.nombre}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400">
              Puede seguir vendiendo al público con normalidad: sus ventas propias
              no se mezclan con la distribución.
            </p>
          </div>

          {sinBodega && (
            <div className="pl-4">
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Elige la bodega para que el módulo funcione.
              </p>
            </div>
          )}

          <div className="pl-4">
            <Toggle
              enabled={valores.red_interna_confirmar_recepcion !== '0'}
              onChange={(v) => set('red_interna_confirmar_recepcion', v ? '1' : '0')}
              label="El local confirma la recepción"
              description="La mercancía viaja 'en tránsito' hasta que el local la revisa. Recomendado."
            />
          </div>

          <div className="pl-4">
            <Toggle
              enabled={valores.red_interna_confirmar_remesa !== '0'}
              onChange={(v) => set('red_interna_confirmar_remesa', v ? '1' : '0')}
              label="La bodega confirma las remesas"
              description="El efectivo queda 'en tránsito' hasta que la bodega lo recibe. Recomendado."
            />
          </div>

          <div className="pl-4">
            <Toggle
              enabled={valores.red_interna_bloquear_traslados !== '0'}
              onChange={(v) => set('red_interna_bloquear_traslados', v ? '1' : '0')}
              label="Cerrar los traslados libres"
              description="Impide mover mercancía por fuera de las remisiones. Apágalo solo si necesitas traslados directos entre locales."
            />
          </div>

          {/* Ausente = ENCENDIDO, al revés que casi todo lo demás. Es
              deliberado: la distribución desde bodega ya se activó a mano
              arriba, y pedir no compromete inventario, ni caja, ni deuda — no
              pasa nada hasta que la bodega despacha. El interruptor está aquí
              para la bodega que NO quiere que los locales pidan. */}
          <div className="pl-4">
            <Toggle
              enabled={valores.red_interna_pedidos !== '0'}
              onChange={(v) => set('red_interna_pedidos', v ? '1' : '0')}
              label="Los locales pueden hacer pedidos"
              description="El local arma su lista y la bodega decide qué despacha. No mueve inventario ni cuentas: la deuda sigue naciendo al recibir el envío."
            />
          </div>

          <div className="pl-4">
            <div className="bg-blue-50 rounded-xl px-4 py-3">
              <p className="text-xs text-blue-700 leading-relaxed">
                <strong>Cómo funciona el dinero:</strong> la mercancía entregada
                <strong> no es deuda</strong>. El local solo liquida lo que vende.
                Si vende a crédito, va liquidando a medida que cobra — la bodega
                recupera su valor primero y el margen le queda al local.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
