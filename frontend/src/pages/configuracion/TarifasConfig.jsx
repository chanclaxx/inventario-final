import { useState } from 'react';
import {
  ToggleLeft, ToggleRight, Percent, Trash2, Plus, AlertTriangle, Info,
} from 'lucide-react';
import {
  parsearTarifas, calcularPrecioTarifa,
  MODO_MARKUP, MODO_MARGEN, OPCIONES_REDONDEO, MAX_TARIFAS,
} from '../../utils/tarifas';
import { formatCOP } from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// TARIFAS PORCENTUALES SOBRE EL COSTO (feature opt-in por negocio)
//
// El negocio pregraba tarifas con nombre y porcentaje ("Frecuente +5%"). En el
// carrito el vendedor elige una con un toque y el precio se calcula desde el
// COSTO del producto en lugar de usar el precio de lista.
//
// Todo lo que se escribe aquí son claves de `config_negocio`:
//   tarifas_activo · tarifas_lista · tarifas_modo · tarifas_redondeo
//   tarifas_ver_porcentaje · tarifas_avisar_bajo_costo
// Un negocio que no encienda el primer flag no ve absolutamente nada de esto:
// el carrito y las pantallas de venta quedan idénticas a como estaban.
// ─────────────────────────────────────────────────────────────────────────────

const COLORES = [
  { id: 'green',  clase: 'bg-emerald-500' },
  { id: 'blue',   clase: 'bg-blue-500'    },
  { id: 'purple', clase: 'bg-purple-500'  },
  { id: 'amber',  clase: 'bg-amber-500'   },
  { id: 'gray',   clase: 'bg-gray-400'    },
];

// Costo de referencia para la vista previa. Sin decimales para que el efecto
// del redondeo se vea de una.
const COSTO_EJEMPLO = 1_000_000;

/**
 * Id estable derivado del nombre. Se genera UNA vez, al crear la tarifa:
 * renombrarla después no lo cambia, así que un carrito abierto que ya guardó
 * la referencia sigue resolviéndola.
 *
 * Determinista a propósito (nada de Date.now/Math.random): el id queda legible
 * dentro del JSON de config y no depende del reloj del navegador.
 */
const _generarId = (nombre, idsExistentes) => {
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    // ̀-ͯ = marcas diacríticas que NFD separa de la letra base

    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'tarifa';

  let id = base;
  let n = 2;
  while (idsExistentes.has(id)) id = `${base}-${n++}`;
  return id;
};

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

function Segmento({ opciones, valor, onChange }) {
  return (
    <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all
            ${String(valor) === String(o.id)
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TarifasConfig({ valores, set }) {
  const activo   = valores.tarifas_activo === '1';
  const tarifas  = parsearTarifas(valores.tarifas_lista);
  const modo     = valores.tarifas_modo === MODO_MARGEN ? MODO_MARGEN : MODO_MARKUP;
  const redondeoRaw = Number(valores.tarifas_redondeo);
  const redondeo = OPCIONES_REDONDEO.includes(redondeoRaw) ? redondeoRaw : 100;

  // Las tarifas SÍ funcionan con la red interna, pero cambian de base: en un
  // local calculan sobre el valor interno de la remisión (lo que le debe a la
  // bodega), no sobre el costo de compra. Se explica en pantalla porque cambia
  // el significado del porcentaje según dónde esté parado el vendedor.
  const redActiva = valores.red_interna_activa === '1';

  const [nombre,  setNombre]  = useState('');
  const [pct,     setPct]     = useState('');
  const [color,   setColor]   = useState('blue');
  const [error,   setError]   = useState('');

  const setTarifas = (lista) => set('tarifas_lista', JSON.stringify(lista));

  const handleAgregar = () => {
    const limpio = nombre.trim();
    if (!limpio)                  return setError('El nombre de la tarifa es requerido');
    if (tarifas.length >= MAX_TARIFAS) return setError(`Máximo ${MAX_TARIFAS} tarifas`);
    if (tarifas.some((t) => t.nombre.toLowerCase() === limpio.toLowerCase())) {
      return setError('Ya existe una tarifa con ese nombre');
    }
    const p = Number(String(pct).replace(',', '.'));
    if (!Number.isFinite(p) || p < 0 || p > 1000) {
      return setError('El porcentaje debe ser un número entre 0 y 1000');
    }
    if (modo === MODO_MARGEN && p >= 100) {
      return setError('En modo margen el porcentaje debe ser menor a 100');
    }

    const id = _generarId(limpio, new Set(tarifas.map((t) => t.id)));

    setTarifas([...tarifas, { id, nombre: limpio, porcentaje: p, color }]);
    setNombre('');
    setPct('');
    setError('');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Percent size={15} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-700">Tarifas sobre el costo</h3>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Precios de venta calculados como un porcentaje sobre el costo del producto.
        El vendedor elige la tarifa en el carrito con un toque y puede seguir
        ajustando el precio a mano.
      </p>

      <Toggle
        label="Activar tarifas porcentuales"
        description="Muestra el selector de tarifa en el carrito y en las pantallas de venta"
        enabled={activo}
        onChange={(val) => set('tarifas_activo', val ? '1' : '0')}
      />

      {activo && redActiva && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2.5">
          <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-amber-800">Con la red interna activa</p>
            <p className="text-xs text-amber-700">
              • En la <strong>bodega</strong> el porcentaje se calcula sobre el costo
              de compra, como siempre.
            </p>
            <p className="text-xs text-amber-700">
              • En un <strong>local</strong> se calcula sobre el <strong>valor interno
              de la remisión</strong> — lo que le debe a la bodega — para que el
              porcentaje sea la ganancia real del local.
            </p>
            <p className="text-xs text-amber-700">
              • Los equipos <strong>propios del local</strong> (retomas, compras suyas)
              no admiten tarifa: el vendedor ve el aviso y pone el precio a mano.
            </p>
            <p className="text-xs text-amber-700">
              • Si tienes activo “ocultar costos a los vendedores” en la red, el
              porcentaje queda oculto para ellos aunque lo enciendas aquí abajo.
            </p>
          </div>
        </div>
      )}

      {activo && (
        <div className="flex flex-col gap-5">

          {/* ── Lista de tarifas ── */}
          <div className="flex flex-col gap-3">
            {tarifas.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-2">
                Sin tarifas configuradas — agrega al menos una para que el selector aparezca
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {tarifas.map((t) => {
                  const previo = calcularPrecioTarifa(COSTO_EJEMPLO, t, { modo, redondeo });
                  const swatch = COLORES.find((c) => c.id === t.color) || COLORES[1];
                  return (
                    <div key={t.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${swatch.clase}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{t.nombre}</p>
                        <p className="text-xs text-gray-400">
                          {modo === MODO_MARGEN ? 'Margen' : 'Recargo'} {t.porcentaje}%
                          {previo != null && ` · ejemplo: ${formatCOP(previo)}`}
                        </p>
                      </div>
                      <button
                        onClick={() => setTarifas(tarifas.filter((x) => x.id !== t.id))}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
                <p className="text-xs text-gray-400 px-1">
                  Ejemplos calculados sobre un costo de {formatCOP(COSTO_EJEMPLO)}.
                </p>
              </div>
            )}

            {/* ── Agregar ── */}
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="text" value={nombre}
                  onChange={(e) => { setNombre(e.target.value); setError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAgregar(); }}
                  placeholder="Ej: Frecuente, Ocasional, Mostrador..."
                  className="flex-1 min-w-0 px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                    placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
                <div className="relative w-24 flex-shrink-0">
                  <input
                    type="number" min="0" max="1000" step="0.5" value={pct}
                    onChange={(e) => { setPct(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAgregar(); }}
                    placeholder="5"
                    className="w-full pl-3 pr-6 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                      placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                </div>
                <button onClick={handleAgregar}
                  className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors flex-shrink-0">
                  <Plus size={15} className="text-white" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Color:</span>
                {COLORES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColor(c.id)}
                    aria-label={c.id}
                    className={`w-5 h-5 rounded-full ${c.clase} transition-all
                      ${color === c.id ? 'ring-2 ring-offset-2 ring-gray-400' : 'opacity-60 hover:opacity-100'}`}
                  />
                ))}
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          </div>

          {/* ── Modo de cálculo ── */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-gray-500">Cómo se calcula el precio</span>
            <Segmento
              valor={modo}
              onChange={(v) => set('tarifas_modo', v)}
              opciones={[
                { id: MODO_MARKUP, label: 'Recargo sobre el costo' },
                { id: MODO_MARGEN, label: 'Margen sobre la venta' },
              ]}
            />
            <p className="text-xs text-gray-400">
              {modo === MODO_MARGEN
                ? 'Margen: costo ÷ (1 − %). Con 5% sobre un costo de $1.000.000 el precio es $1.052.600 y la ganancia es el 5% de la venta.'
                : 'Recargo: costo × (1 + %). Con 5% sobre un costo de $1.000.000 el precio es $1.050.000 y la ganancia es $50.000.'}
            </p>
          </div>

          {/* ── Redondeo ── */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-gray-500">Redondeo del precio calculado</span>
            <Segmento
              valor={redondeo}
              onChange={(v) => set('tarifas_redondeo', String(v))}
              opciones={[
                { id: 0,    label: 'Exacto'  },
                { id: 100,  label: '$100'    },
                { id: 500,  label: '$500'    },
                { id: 1000, label: '$1.000'  },
              ]}
            />
          </div>

          {/* ── Opciones ── */}
          <div className="flex flex-col gap-4 pt-1">
            <Toggle
              label="Mostrar el porcentaje al vendedor"
              description="Si se apaga, el vendedor solo ve el nombre de la tarifa"
              enabled={valores.tarifas_ver_porcentaje === '1'}
              onChange={(val) => set('tarifas_ver_porcentaje', val ? '1' : '0')}
            />
            <Toggle
              label="Avisar cuando el precio quede por debajo del costo"
              description="Marca en rojo el ítem, pero no impide vender"
              enabled={valores.tarifas_avisar_bajo_costo !== '0'}
              onChange={(val) => set('tarifas_avisar_bajo_costo', val ? '1' : '0')}
            />
          </div>

          <div className="bg-blue-50 rounded-xl p-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Info size={13} className="text-blue-500 flex-shrink-0" />
              <p className="text-xs font-medium text-blue-800">Ten en cuenta</p>
            </div>
            <p className="text-xs text-blue-700">
              • Al mostrar un precio calculado sobre el costo, quien vende puede deducir
              cuánto costó el producto. Mantén apagado “Mostrar el porcentaje” si no
              quieres facilitarlo.
            </p>
            <p className="text-xs text-blue-700">
              • Solo se puede aplicar a productos con costo registrado. Los que no lo
              tengan aparecen con la tarifa deshabilitada y conservan su precio de lista.
            </p>
            <p className="text-xs text-blue-700">
              • El costo se actualiza solo con cada compra (costo promedio), así que los
              precios sugeridos se mueven con él. Lo ya facturado nunca cambia.
            </p>
            <p className="text-xs text-blue-700">
              • Aplicar una tarifa no bloquea el precio: el vendedor puede seguir
              ajustándolo a mano antes de cerrar la venta.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default TarifasConfig;
