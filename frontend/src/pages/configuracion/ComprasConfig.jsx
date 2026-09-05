import {
  ToggleLeft, ToggleRight, ClipboardList, Info, AlertTriangle,
  ShieldCheck, Barcode, CheckCircle2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE LA COMPRA POR ÓRDENES
//
// Son TRES interruptores independientes, no uno. Un negocio puede querer
// reclamar garantías sin llevar órdenes de compra, o traducir las referencias
// del proveedor sin nada más. Amarrarlos obligaría a tragarse el módulo
// completo para usar una sola pieza.
//
// Claves de `config_negocio` que se escriben aquí:
//   ordenes_compra_activas · ordenes_compra_modo_cargo · ordenes_compra_dias_aviso
//   garantia_proveedor_activa · garantia_proveedor_dias_aviso
//   codigos_proveedor_activos
//
// Sin el primer flag el backend responde 404 y la pestaña Órdenes no aparece:
// para ese negocio el módulo no existe y el flujo de compra sigue siendo el de
// siempre (registrar la mercancía que llegó, sin pedido previo).
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

// El modo de cargo decide CUÁNDO nace la deuda con el proveedor. No es un
// detalle contable: cambia qué pasa al recibir mercancía, así que se explica
// con el caso real de cada uno en vez de con el nombre técnico.
const MODOS = [
  {
    id:      'recepcion',
    titulo:  'Al recibir la mercancía',
    resumen: 'Cada entrega genera su propia cuenta por pagar.',
    detalle: 'El proveedor te factura cada entrega. Si un pedido llega en tres '
           + 'partes, se registran tres deudas. Es lo más común y es como funciona '
           + 'el sistema hoy.',
  },
  {
    id:      'orden',
    titulo:  'Al facturar la orden',
    resumen: 'La deuda completa nace con la factura, antes de que llegue nada.',
    detalle: 'El proveedor te factura el pedido completo por adelantado. Las '
           + 'entregas van descontando de esa única deuda. Tendrás que registrar '
           + 'la factura en la orden antes de poder recibir mercancía.',
  },
];

function SelectorModo({ valor, onChange }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-gray-700">¿Cuándo le debes al proveedor?</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {MODOS.map((m) => {
          const activo = valor === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange(m.id)}
              aria-pressed={activo}
              className={`text-left rounded-xl border p-4 transition-colors ${
                activo
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className={`text-sm font-semibold ${activo ? 'text-blue-900' : 'text-gray-800'}`}>
                  {m.titulo}
                </span>
                {activo && <CheckCircle2 size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />}
              </div>
              <p className={`text-xs mt-1 ${activo ? 'text-blue-800' : 'text-gray-500'}`}>
                {m.resumen}
              </p>
              <p className={`text-xs mt-2 leading-relaxed ${activo ? 'text-blue-700' : 'text-gray-400'}`}>
                {m.detalle}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CampoDias({ label, description, valor, onChange, placeholder }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <span className="text-xs text-gray-400">{description}</span>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <input
          type="number"
          min="0"
          max="365"
          value={valor}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 text-sm text-right tabular-nums border border-gray-200 rounded-lg px-2 py-1.5
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <span className="text-xs text-gray-400">días</span>
      </div>
    </div>
  );
}

export function ComprasConfig({ valores, set }) {
  const activas     = valores.ordenes_compra_activas    === '1';
  const modoCargo   = valores.ordenes_compra_modo_cargo === 'orden' ? 'orden' : 'recepcion';
  const garantia    = valores.garantia_proveedor_activa === '1';
  const codigos     = valores.codigos_proveedor_activos === '1';
  const codigoInterno = valores.codigo_producto_activo  === '1';
  const detalleNodo   = valores.ordenes_compra_detalle_nodo === '1';
  // Prerrequisito, igual que los códigos del proveedor exigen el código interno:
  // sin árbol de variantes no hay talla ni color que pedir, y el selector no
  // podría seleccionar nada. El backend lo vuelve a comprobar al guardar.
  const variantes     = valores.variantes_activo        === '1';

  return (
    <div className="flex flex-col gap-6">
      {/* ── Órdenes de compra ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-gray-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Órdenes de compra</h3>
            <p className="text-xs text-gray-400">
              Registra lo que le pediste al proveedor y ve qué falta por llegar.
            </p>
          </div>
        </div>

        <Toggle
          label="Pedir antes de recibir"
          description="Agrega la pestaña Órdenes y permite recibir la mercancía por partes"
          enabled={activas}
          onChange={(val) => set('ordenes_compra_activas', val ? '1' : '0')}
        />

        {!activas && (
          <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-start gap-2">
            <Info size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500">
              Apagado, sigues registrando la mercancía cuando llega, sin pedido previo.
              Es lo que necesita la mayoría de negocios.
            </p>
          </div>
        )}

        {activas && (
          <div className="flex flex-col gap-5 border-l-2 border-blue-100 pl-4">
            <SelectorModo
              valor={modoCargo}
              onChange={(v) => set('ordenes_compra_modo_cargo', v)}
            />

            {modoCargo === 'orden' && (
              <div className="bg-amber-50 rounded-xl px-4 py-3 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  Con este modo <strong>no podrás recibir mercancía de una orden sin
                  factura registrada</strong>. Si recibieras antes, la mercancía entraría
                  sin deuda asociada y al facturar después te la cobrarías dos veces.
                </p>
              </div>
            )}

            <CampoDias
              label="Avisarme antes de que venza la factura"
              description="Pinta la orden en amarillo y manda el aviso de la mañana"
              placeholder="3"
              valor={valores.ordenes_compra_dias_aviso ?? ''}
              onChange={(v) => set('ordenes_compra_dias_aviso', v)}
            />

            {/* ── Pedir la variante ──────────────────────────────────────── */}
            <div className="flex flex-col gap-3">
              <Toggle
                label="Pedir la variante, no solo el producto"
                description="«50 de 25W y 50 de 20W» en vez de «100 cargadores»"
                enabled={detalleNodo}
                disabled={!variantes}
                onChange={(val) => set('ordenes_compra_detalle_nodo', val ? '1' : '0')}
              />

              {!variantes && (
                <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-start gap-2">
                  <Info size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-500">
                    Para esto necesitas primero las <strong>variantes de producto</strong>
                    {' '}activadas: sin ellas no hay talla ni color que pedir.
                  </p>
                </div>
              )}

              {detalleNodo && (
                <div className="bg-purple-50 rounded-xl p-4 flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-purple-800">Qué cambia al recibir</p>
                  <p className="text-xs text-purple-700">
                    • Cada línea del pedido puede decir <strong>qué variante</strong> quieres.
                    Puedes seguir pidiendo «el producto completo» donde de verdad da igual.
                  </p>
                  <p className="text-xs text-purple-700">
                    • Si el proveedor manda <strong>otra variante</strong>, hay que aceptarlo a
                    propósito y queda anotado como novedad suya. Antes entraba en silencio y
                    el pedido se marcaba cumplido sin que nadie supiera.
                  </p>
                  <p className="text-xs text-purple-700">
                    • Si llegan <strong>de más</strong>, decides ahí mismo: te quedas con ellas
                    o se las devuelves. Antes el sistema simplemente no dejaba recibirlas.
                  </p>
                  <p className="text-xs text-purple-700">
                    • Si el bodeguero se equivoca, <strong>corrige la entrada</strong> sin
                    volver a capturarla — mientras no la hayas confirmado con la factura.
                    Cada cambio queda registrado con su nombre.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-blue-50 rounded-xl p-4 flex flex-col gap-1.5">
              <p className="text-xs font-medium text-blue-800">Cómo funciona</p>
              <p className="text-xs text-blue-700">
                • Creas la orden con lo que pediste. Mientras sea borrador puedes cambiarla;
                al emitirla queda en firme y ya se puede recibir contra ella.
              </p>
              <p className="text-xs text-blue-700">
                • Cuando llega mercancía tocas «Recibir»: viene precargado lo que falta,
                y si llegó menos, bajas el número. El resto queda pendiente solo.
              </p>
              <p className="text-xs text-blue-700">
                • Los equipos con IMEI se piden por modelo y cantidad; los IMEI se capturan
                al recibir, que es cuando se conocen.
              </p>
              <p className="text-xs text-blue-700">
                • Si un pedido ya no va a llegar, cierras la orden con el motivo. No toca
                inventario ni deuda: lo que llegó ya se registró.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100" />

      {/* ── Garantía del proveedor ────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-gray-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Garantía que te da el proveedor</h3>
            <p className="text-xs text-gray-400">
              Cuántos días responde por la mercancía que te vendió.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-start gap-2">
          <Info size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500">
            No la confundas con las <strong>garantías del catálogo</strong>, que son los
            textos que se imprimen en la factura de tus clientes. Esta va al revés:
            es la que tú le reclamas a tu proveedor.
          </p>
        </div>

        <Toggle
          label="Llevar la garantía del proveedor"
          description="Guarda el plazo al recibir y te avisa cuándo se vence por producto"
          enabled={garantia}
          onChange={(val) => set('garantia_proveedor_activa', val ? '1' : '0')}
        />

        {garantia && (
          <div className="flex flex-col gap-4 border-l-2 border-blue-100 pl-4">
            <CampoDias
              label="Avisarme antes de que se venza"
              description="Para revisar el stock de ese lote mientras todavía se puede reclamar"
              placeholder="15"
              valor={valores.garantia_proveedor_dias_aviso ?? ''}
              onChange={(v) => set('garantia_proveedor_dias_aviso', v)}
            />
            <div className="bg-blue-50 rounded-xl p-4 flex flex-col gap-1.5">
              <p className="text-xs font-medium text-blue-800">Cómo funciona</p>
              <p className="text-xs text-blue-700">
                • Cada proveedor puede tener su plazo habitual, y cada producto pedido
                puede llevar el suyo. El plazo se guarda tal como estaba el día que
                entró la mercancía: cambiarlo después no altera lo ya recibido.
              </p>
              <p className="text-xs text-blue-700">
                • El reloj arranca cuando recibes, no cuando pides.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100" />

      {/* ── Códigos del proveedor ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Barcode size={18} className="text-gray-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Códigos del proveedor</h3>
            <p className="text-xs text-gray-400">
              Guarda con qué referencia llama cada proveedor a tus productos.
            </p>
          </div>
        </div>

        {!codigoInterno && (
          <div className="bg-amber-50 rounded-xl px-4 py-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Primero tienes que activar el <strong>código único de producto</strong> (en la
              pestaña Códigos). La referencia del proveedor apunta a tu código interno,
              así que sin él no hay a qué apuntar.
            </p>
          </div>
        )}

        <Toggle
          label="Traducir las referencias del proveedor"
          description="Al recibir, escribes el código de su remisión y resuelve a tu producto"
          enabled={codigos}
          disabled={!codigoInterno}
          onChange={(val) => set('codigos_proveedor_activos', val ? '1' : '0')}
        />

        {codigos && codigoInterno && (
          <div className="bg-blue-50 rounded-xl p-4 flex flex-col gap-1.5 border-l-2 border-blue-100">
            <p className="text-xs font-medium text-blue-800">Cómo funciona</p>
            <p className="text-xs text-blue-700">
              • No tienes que capturar nada por adelantado: la primera vez que llegue una
              referencia desconocida eliges a qué producto tuyo corresponde y queda
              guardada. La siguiente vez ya se resuelve sola.
            </p>
            <p className="text-xs text-blue-700">
              • Dos proveedores pueden llamar distinto al mismo producto, y está bien:
              es justamente lo que se guarda.
            </p>
            <p className="text-xs text-blue-700">
              • Las órdenes que le imprimas al proveedor salen con sus referencias,
              para que las lea sin traducir.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ComprasConfig;
