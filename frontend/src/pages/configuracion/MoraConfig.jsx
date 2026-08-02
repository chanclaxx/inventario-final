import { useState } from 'react';
import {
  ToggleLeft, ToggleRight, CalendarClock, Trash2, Plus, AlertTriangle, Info,
} from 'lucide-react';
import {
  parsearCondiciones, describirCondicion,
  TIPO_MENSUAL, TIPO_DIARIA_FIJA, MAX_CONDICIONES,
} from '../../utils/mora';
import { formatCOP } from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// MORA POR PAGO TARDÍO (feature opt-in por negocio)
//
// El admin pregraba varias condiciones ("Suave 1% mensual", "Estricta 3%") y el
// vendedor elige una al vender a crédito o prestar, junto con la fecha límite.
//
// Claves de `config_negocio`:
//   mora_activa · mora_lista · mora_default_id · mora_plazo_default_dias
//   mora_tope_tasa_mensual · mora_aviso_previo_dias
//
// Un negocio que no encienda el flag no ve absolutamente nada de esto: ni el
// campo de plazo en la venta, ni la mora en los cobros. Y sus créditos y
// préstamos actuales siguen sin plazo, así que nunca generan mora.
// ─────────────────────────────────────────────────────────────────────────────

const COLORES = [
  { id: 'green',  clase: 'bg-emerald-500' },
  { id: 'amber',  clase: 'bg-amber-500'   },
  { id: 'red',    clase: 'bg-red-500'     },
  { id: 'blue',   clase: 'bg-blue-500'    },
  { id: 'gray',   clase: 'bg-gray-400'    },
];

// Ejemplo de referencia para la vista previa: una deuda de $1.000.000 con 30
// días de atraso. Sin ejemplo, un porcentaje mensual no le dice nada a nadie.
const SALDO_EJEMPLO = 1_000_000;
const DIAS_EJEMPLO  = 30;

function Toggle({ enabled, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <span className="text-xs text-gray-400">{description}</span>}
      </div>
      <button type="button" onClick={() => onChange(!enabled)}
        className="flex-shrink-0 transition-colors" aria-pressed={enabled}>
        {enabled
          ? <ToggleRight size={28} className="text-blue-600" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </button>
    </div>
  );
}

/** Id estable derivado del nombre: renombrar después no rompe los documentos
 *  que ya guardaron la condición. Determinista (sin Date.now ni Math.random). */
const _generarId = (nombre, existentes) => {
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'mora';
  let id = base; let n = 2;
  while (existentes.has(id)) id = `${base}-${n++}`;
  return id;
};

/** Mora del ejemplo. Réplica de la fórmula del backend SOLO para la vista
 *  previa de esta pantalla; el cobro real siempre lo calcula el servidor. */
const _moraEjemplo = (c) => {
  const dias = Math.max(0, DIAS_EJEMPLO - (c.dias_gracia || 0));
  if (!dias) return 0;
  const bruto = c.tipo === TIPO_DIARIA_FIJA
    ? c.valor * dias
    : SALDO_EJEMPLO * (c.valor / 100) * (dias / 30);
  const conTope = c.tope_pct ? Math.min(bruto, SALDO_EJEMPLO * (c.tope_pct / 100)) : bruto;
  return Math.round(conTope);
};

export function MoraConfig({ valores, set }) {
  const activo      = valores.mora_activa === '1';
  const condiciones = parsearCondiciones(valores.mora_lista);
  const defaultId   = valores.mora_default_id || '';
  const plazoDef    = valores.mora_plazo_default_dias ?? '';
  const techo       = valores.mora_tope_tasa_mensual ?? '';
  const avisoPrevio = valores.mora_aviso_previo_dias ?? '';

  const [nombre, setNombre] = useState('');
  const [tipo,   setTipo]   = useState(TIPO_MENSUAL);
  const [valor,  setValor]  = useState('');
  const [gracia, setGracia] = useState('');
  const [tope,   setTope]   = useState('');
  const [color,  setColor]  = useState('amber');
  const [error,  setError]  = useState('');

  const setCondiciones = (lista) => set('mora_lista', JSON.stringify(lista));

  const handleAgregar = () => {
    const limpio = nombre.trim();
    if (!limpio) return setError('Ponle un nombre a la condición');
    if (condiciones.length >= MAX_CONDICIONES) return setError(`Máximo ${MAX_CONDICIONES} condiciones`);
    if (condiciones.some((c) => c.nombre.toLowerCase() === limpio.toLowerCase())) {
      return setError('Ya existe una condición con ese nombre');
    }
    const v = Number(String(valor).replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return setError('El valor debe ser mayor a 0');
    if (tipo === TIPO_MENSUAL && v > 100) return setError('Un porcentaje mensual mayor a 100 no es válido');

    const g = gracia === '' ? 0 : Number(gracia);
    if (!Number.isFinite(g) || g < 0) return setError('Los días de gracia deben ser 0 o más');
    const t = tope === '' ? null : Number(tope);
    if (t !== null && (!Number.isFinite(t) || t <= 0)) return setError('El tope debe ser un porcentaje mayor a 0');

    const id = _generarId(limpio, new Set(condiciones.map((c) => c.id)));
    setCondiciones([...condiciones, {
      id, nombre: limpio, tipo, valor: v,
      dias_gracia: Math.floor(g), tope_pct: t, color,
    }]);
    setNombre(''); setValor(''); setGracia(''); setTope(''); setError('');
  };

  const eliminar = (id) => {
    setCondiciones(condiciones.filter((c) => c.id !== id));
    if (defaultId === id) set('mora_default_id', '');
  };

  // Aviso de usura: la tasa legal máxima la publica la Superfinanciera cada mes,
  // así que el sistema no la conoce — avisa contra el techo que fije el negocio.
  const excedeTecho = (c) =>
    techo && c.tipo === TIPO_MENSUAL && Number(c.valor) > Number(techo);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <CalendarClock size={15} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-700">Plazo de pago y mora</h3>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Permite ponerle una fecha límite a las ventas a crédito y a los préstamos.
        Si el cliente se pasa del plazo, se calcula una mora sobre el saldo pendiente.
      </p>

      <Toggle
        label="Activar plazo de pago y mora"
        description="Muestra el campo de fecha límite al vender a crédito y al prestar"
        enabled={activo}
        onChange={(val) => set('mora_activa', val ? '1' : '0')}
      />

      {activo && (
        <div className="flex flex-col gap-5">

          {/* ── Condiciones ── */}
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-gray-500">
              Condiciones que podrá elegir el vendedor
            </span>

            {condiciones.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-2">
                Sin condiciones configuradas — agrega al menos una para que el vendedor pueda poner plazos
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {condiciones.map((c) => {
                  const swatch = COLORES.find((x) => x.id === c.color) || COLORES[1];
                  const esDefault = defaultId === c.id;
                  return (
                    <div key={c.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${swatch.clase}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-800 truncate">{c.nombre}</p>
                          {esDefault && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              por defecto
                            </span>
                          )}
                          {excedeTecho(c) && (
                            <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              sobre el techo
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">{describirCondicion(c)}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          Ejemplo: {formatCOP(SALDO_EJEMPLO)} con {DIAS_EJEMPLO} días de atraso
                          {' → '}<span className="font-medium text-gray-600">{formatCOP(_moraEjemplo(c))}</span> de mora
                        </p>
                      </div>
                      <button
                        onClick={() => set('mora_default_id', esDefault ? '' : c.id)}
                        className={`text-[11px] px-2 py-1 rounded-lg transition-colors flex-shrink-0
                          ${esDefault ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-400 hover:bg-gray-100'}`}
                      >
                        {esDefault ? 'quitar' : 'por defecto'}
                      </button>
                      <button onClick={() => eliminar(c.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Agregar condición ── */}
            <div className="flex flex-col gap-2 p-3 bg-gray-50 rounded-xl">
              <input
                type="text" value={nombre}
                onChange={(e) => { setNombre(e.target.value); setError(''); }}
                placeholder="Nombre: Suave, Normal, Estricta..."
                className="w-full px-3 py-2 bg-white border-0 rounded-xl text-sm text-gray-900
                  placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
              <div className="flex gap-1 bg-gray-200 p-1 rounded-xl">
                {[
                  { id: TIPO_MENSUAL,     label: '% mensual'    },
                  { id: TIPO_DIARIA_FIJA, label: '$ fijo al día' },
                ].map((o) => (
                  <button key={o.id} type="button" onClick={() => { setTipo(o.id); setError(''); }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all
                      ${tipo === o.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input type="number" min="0" step="0.5" value={valor}
                    onChange={(e) => { setValor(e.target.value); setError(''); }}
                    placeholder={tipo === TIPO_MENSUAL ? '2' : '2000'}
                    className="w-full pl-3 pr-7 py-2 bg-white border-0 rounded-xl text-sm
                      placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    {tipo === TIPO_MENSUAL ? '%' : '$'}
                  </span>
                </div>
                <input type="number" min="0" value={gracia}
                  onChange={(e) => { setGracia(e.target.value); setError(''); }}
                  placeholder="gracia (días)"
                  className="flex-1 px-3 py-2 bg-white border-0 rounded-xl text-sm
                    placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" min="0" value={tope}
                  onChange={(e) => { setTope(e.target.value); setError(''); }}
                  placeholder="tope %"
                  className="flex-1 px-3 py-2 bg-white border-0 rounded-xl text-sm
                    placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Color:</span>
                  {COLORES.map((c) => (
                    <button key={c.id} type="button" onClick={() => setColor(c.id)} aria-label={c.id}
                      className={`w-5 h-5 rounded-full ${c.clase} transition-all
                        ${color === c.id ? 'ring-2 ring-offset-2 ring-gray-400' : 'opacity-60 hover:opacity-100'}`} />
                  ))}
                </div>
                <button onClick={handleAgregar}
                  className="flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium
                    px-3 py-2 rounded-xl hover:bg-blue-700 transition-colors">
                  <Plus size={14} /> Agregar
                </button>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          </div>

          {/* ── Ajustes generales ── */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-gray-500">Plazo sugerido al vender (días)</span>
              <input type="number" min="1" value={plazoDef}
                onChange={(e) => set('mora_plazo_default_dias', e.target.value)}
                placeholder="Ej: 30"
                className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
                  placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
              <span className="text-[11px] text-gray-400">
                La fecha límite llega precargada con estos días, y el vendedor la puede cambiar o dejar vacía.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-gray-500">Avisar antes del vencimiento (días)</span>
              <input type="number" min="1" max="30" value={avisoPrevio}
                onChange={(e) => set('mora_aviso_previo_dias', e.target.value)}
                placeholder="3"
                className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
                  placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
              <span className="text-[11px] text-gray-400">
                Cuántos días antes te llega la notificación de los pagos que se acercan, para
                recordárselos al cliente antes de que se venzan. Por defecto 3.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-gray-500">Techo de aviso (% mensual)</span>
              <input type="number" min="0" step="0.1" value={techo}
                onChange={(e) => set('mora_tope_tasa_mensual', e.target.value)}
                placeholder="Ej: 3.2"
                className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
                  placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
              <span className="text-[11px] text-gray-400">
                Si configuras una condición por encima de este porcentaje, se marca en rojo. Solo avisa, no bloquea.
              </span>
            </div>
          </div>

          {/* ── Advertencia legal ── */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-2.5">
            <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-amber-800">Antes de cobrar mora, ten en cuenta</p>
              <p className="text-xs text-amber-700">
                • La mora solo es exigible si se pactó <strong>por escrito</strong> con el cliente.
                Por eso la factura y el comprobante de préstamo imprimen el plazo, el interés y
                una línea de firma: hazla firmar al entregar.
              </p>
              <p className="text-xs text-amber-700">
                • Existe un <strong>tope legal</strong> (la tasa de usura, que publica cada mes la
                Superintendencia Financiera). Cobrar por encima es delito y hace perder los
                intereses. Consulta la tasa vigente y ponla en el techo de aviso.
              </p>
              <p className="text-xs text-amber-700">
                • La mora se liquida sobre el <strong>saldo de capital</strong>, con interés simple.
                Nunca se cobra interés sobre la mora acumulada.
              </p>
            </div>
          </div>

          <div className="bg-blue-50 rounded-xl p-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Info size={13} className="text-blue-500 flex-shrink-0" />
              <p className="text-xs font-medium text-blue-800">Cómo funciona</p>
            </div>
            <p className="text-xs text-blue-700">
              • <strong>Sin fecha límite no hay mora.</strong> Si a un cliente (o a un compañero) no
              le pones plazo, nunca se le cobra nada. Tus créditos y préstamos actuales no cambian.
            </p>
            <p className="text-xs text-blue-700">
              • La mora <strong>no se suma a la utilidad del producto</strong>: aparece como
              ingreso aparte en Caja y en Reportes, para que tu margen real no se distorsione.
            </p>
            <p className="text-xs text-blue-700">
              • Al recibir un abono eliges si cubre <strong>mora y capital</strong>, solo capital,
              o un reparto personalizado.
            </p>
            <p className="text-xs text-blue-700">
              • Si se pasó por poco, el administrador puede <strong>condonar</strong> la mora
              (total o parcial) con un motivo y el PIN. Queda registrado quién y por qué.
            </p>
            <p className="text-xs text-blue-700">
              • Si olvidaste ponerle el plazo al facturar, puedes agregárselo después desde el
              detalle del crédito o del préstamo.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default MoraConfig;
