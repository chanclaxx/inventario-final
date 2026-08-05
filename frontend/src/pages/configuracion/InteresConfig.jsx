import { useState } from 'react';
import {
  ToggleLeft, ToggleRight, Percent, Trash2, Plus, AlertTriangle, Info,
  ChevronDown, ChevronRight, Sparkles,
} from 'lucide-react';
import {
  parsearPlanes, describirPlan, describirPlanCompleto, proyectar,
  diasDePeriodo, unidadPeriodo,
  PERIODICIDADES, PLANTILLAS, MAX_PLANES,
  TIPO_PORCENTAJE, TIPO_FIJO, DEVENGO_DIARIO, DEVENGO_PERIODO,
  BASE_SALDO, BASE_ORIGINAL, AL_VENCER_SUSTITUYE, AL_VENCER_CONTINUA,
} from '../../utils/interes';
import { formatCOP } from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// INTERÉS CORRIENTE (feature opt-in por negocio, independiente de la mora)
//
// El interés es el PRECIO DEL PLAZO: lo que se cobra por financiar, esté el
// cliente al día o no. La mora es otra cosa — la sanción por atrasarse — y vive
// en su propia pestaña. Se puede usar una, la otra, las dos o ninguna.
//
// Claves de `config_negocio`:
//   interes_activa · interes_lista · interes_default_id · interes_techo_mensual
//
// PROBLEMA DE USABILIDAD QUE RESUELVE ESTA PANTALLA: el motor acepta diez
// opciones, y diez opciones en blanco no las llena nadie. Por eso:
//   · se arranca con PLANTILLAS (un clic deja el plan listo),
//   · lo raro vive detrás de "Opciones avanzadas",
//   · y hay una TABLA DE PROYECCIÓN en vivo, porque un porcentaje no le dice
//     nada a nadie hasta que ve cuánto debería el cliente a los 30, 60 y 90 días.
// ─────────────────────────────────────────────────────────────────────────────

const COLORES = [
  { id: 'teal',   clase: 'bg-teal-500'    },
  { id: 'blue',   clase: 'bg-blue-500'    },
  { id: 'green',  clase: 'bg-emerald-500' },
  { id: 'purple', clase: 'bg-purple-500'  },
  { id: 'gray',   clase: 'bg-gray-400'    },
];

// Ejemplo de referencia para la proyección. Una deuda redonda para que la
// aritmética se pueda seguir de cabeza.
const BASE_EJEMPLO = 1_000_000;
const CORTES = [15, 30, 60, 90, 180];

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
          ? <ToggleRight size={28} className="text-teal-600" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </button>
    </div>
  );
}

/** Selector de opciones en fila, estilo segmented control. */
function Segmento({ valor, onChange, opciones, size = 'normal' }) {
  return (
    <div className="flex gap-1 bg-gray-200 p-1 rounded-xl">
      {opciones.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          title={o.hint || undefined}
          className={`flex-1 rounded-lg font-medium transition-all
            ${size === 'small' ? 'py-1 text-[11px]' : 'py-1.5 text-xs'}
            ${valor === o.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Id estable derivado del nombre: renombrar después no rompe los documentos
 *  que ya guardaron el plan. Determinista (sin Date.now ni Math.random). */
const _generarId = (nombre, existentes) => {
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'interes';
  let id = base; let n = 2;
  while (existentes.has(id)) id = `${base}-${n++}`;
  return id;
};

const FORM_INICIAL = {
  nombre: '',
  tipo: TIPO_PORCENTAJE,
  valor: '',
  periodicidad: 'mensual',
  cada_dias: '',
  devengo: DEVENGO_DIARIO,
  base: BASE_SALDO,
  inicia_tras_dias: '',
  max_periodos: '',
  tope_pct: '',
  al_vencer: AL_VENCER_SUSTITUYE,
  color: 'teal',
};

export function InteresConfig({ valores, set }) {
  const activo   = valores.interes_activa === '1';
  const planes   = parsearPlanes(valores.interes_lista);
  const defaultId = valores.interes_default_id || '';
  const techo    = valores.interes_techo_mensual ?? '';

  const [form, setForm]         = useState(FORM_INICIAL);
  const [avanzado, setAvanzado] = useState(false);
  const [error, setError]       = useState('');

  const campo = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setError(''); };
  const setPlanes = (lista) => set('interes_lista', JSON.stringify(lista));

  // El plan que se está armando, ya normalizado, para la vista previa en vivo.
  const previo = (() => {
    const v = Number(String(form.valor).replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return null;
    const dias = diasDePeriodo(form.periodicidad, form.cada_dias);
    if (!dias) return null;
    return {
      tipo: form.tipo, valor: v,
      periodicidad: form.periodicidad, dias_periodo: dias,
      devengo: form.devengo, base: form.base,
      inicia_tras_dias: Math.max(0, Math.floor(Number(form.inicia_tras_dias) || 0)),
      max_periodos: Number(form.max_periodos) > 0 ? Math.floor(Number(form.max_periodos)) : null,
      tope_pct:     Number(form.tope_pct) > 0 ? Number(form.tope_pct) : null,
      al_vencer: form.al_vencer,
    };
  })();

  const aplicarPlantilla = (t) => {
    setForm({ ...FORM_INICIAL, ...t.plan, nombre: t.nombre, valor: String(t.plan.valor) });
    setError('');
  };

  const handleAgregar = () => {
    const limpio = form.nombre.trim();
    if (!limpio) return setError('Ponle un nombre al plan');
    if (planes.length >= MAX_PLANES) return setError(`Máximo ${MAX_PLANES} planes`);
    if (planes.some((p) => p.nombre.toLowerCase() === limpio.toLowerCase())) {
      return setError('Ya existe un plan con ese nombre');
    }
    const v = Number(String(form.valor).replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return setError('El valor debe ser mayor a 0');
    if (form.tipo === TIPO_PORCENTAJE && v > 100) return setError('Un porcentaje mayor a 100 no es válido');

    const dias = diasDePeriodo(form.periodicidad, form.cada_dias);
    if (!dias) return setError('Indica cada cuántos días se cobra');

    const id = _generarId(limpio, new Set(planes.map((p) => p.id)));
    setPlanes([...planes, {
      id, nombre: limpio,
      tipo: form.tipo, valor: v,
      periodicidad: form.periodicidad,
      cada_dias: form.periodicidad === 'cada_n_dias' ? dias : null,
      devengo: form.devengo,
      base: form.base,
      inicia_tras_dias: Math.max(0, Math.floor(Number(form.inicia_tras_dias) || 0)),
      max_periodos: Number(form.max_periodos) > 0 ? Math.floor(Number(form.max_periodos)) : null,
      tope_pct:     Number(form.tope_pct) > 0 ? Number(form.tope_pct) : null,
      al_vencer: form.al_vencer,
      color: form.color,
    }]);
    setForm(FORM_INICIAL);
    setAvanzado(false);
  };

  const eliminar = (id) => {
    setPlanes(planes.filter((p) => p.id !== id));
    if (defaultId === id) set('interes_default_id', '');
  };

  // Aviso de usura: la tasa legal máxima la publica la Superfinanciera cada mes,
  // así que el sistema no la conoce — avisa contra el techo que fije el negocio.
  // Se compara a escala mensual para que un plan diario no parezca inocente.
  const mensualEquivalente = (p) =>
    p.tipo === TIPO_PORCENTAJE ? (p.valor * 30) / p.dias_periodo : null;
  const excedeTecho = (p) => {
    const m = mensualEquivalente(p);
    return techo && m != null && m > Number(techo);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Percent size={15} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-700">Interés por financiar</h3>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Lo que cobras por prestar o por dar plazo, esté el cliente al día o no.
        Es distinto de la <strong>mora</strong>, que es la sanción por pasarse de la fecha
        y se configura en su propia pestaña. Puedes usar uno, el otro o los dos.
      </p>

      <Toggle
        label="Activar interés por financiar"
        description="Muestra el selector de plan al vender a crédito y al prestar"
        enabled={activo}
        onChange={(val) => set('interes_activa', val ? '1' : '0')}
      />

      {activo && (
        <div className="flex flex-col gap-5">

          {/* ── Planes configurados ── */}
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-gray-500">
              Planes que podrá elegir el vendedor
            </span>

            {planes.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-2">
                Sin planes configurados — agrega al menos uno para que el vendedor pueda cobrar interés
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {planes.map((p) => {
                  const swatch = COLORES.find((x) => x.id === p.color) || COLORES[0];
                  const esDefault = defaultId === p.id;
                  return (
                    <div key={p.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${swatch.clase}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.nombre}</p>
                          {esDefault && (
                            <span className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              por defecto
                            </span>
                          )}
                          {excedeTecho(p) && (
                            <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              sobre el techo
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{describirPlanCompleto(p)}</p>
                        <p className="text-[11px] text-gray-400 mt-1">
                          Sobre {formatCOP(BASE_EJEMPLO)}:
                          {' '}<span className="font-medium text-gray-600">
                            {formatCOP(proyectar(p, BASE_EJEMPLO, 30))} a 30 días
                          </span>
                          {' · '}
                          <span className="font-medium text-gray-600">
                            {formatCOP(proyectar(p, BASE_EJEMPLO, 90))} a 90 días
                          </span>
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={() => set('interes_default_id', esDefault ? '' : p.id)}
                          className={`text-[11px] px-2 py-1 rounded-lg transition-colors
                            ${esDefault ? 'text-teal-600 hover:bg-teal-50' : 'text-gray-400 hover:bg-gray-100'}`}
                        >
                          {esDefault ? 'quitar' : 'por defecto'}
                        </button>
                        <button onClick={() => eliminar(p.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors self-end">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Plantillas ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Sparkles size={13} className="text-teal-500" />
              <span className="text-xs font-medium text-gray-500">
                Empieza con una forma común y ajústala
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PLANTILLAS.map((t) => (
                <button key={t.id} type="button" onClick={() => aplicarPlantilla(t)}
                  className="text-left p-3 bg-white border border-gray-200 rounded-xl
                    hover:border-teal-400 hover:bg-teal-50/40 transition-colors">
                  <p className="text-xs font-semibold text-gray-800">{t.nombre}</p>
                  <p className="text-[11px] text-teal-700 mt-0.5">{t.resumen}</p>
                  <p className="text-[11px] text-gray-400 mt-1">{t.para}</p>
                </button>
              ))}
            </div>
          </div>

          {/* ── Formulario ── */}
          <div className="flex flex-col gap-3 p-3 bg-gray-50 rounded-xl">
            <input
              type="text" value={form.nombre}
              onChange={(e) => campo('nombre', e.target.value)}
              placeholder="Nombre del plan: Financiación 2%, Cobro diario..."
              className="w-full px-3 py-2 bg-white border-0 rounded-xl text-sm text-gray-900
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
            />

            {/* Cuánto */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-gray-500">¿Cuánto cobras?</span>
              <div className="flex gap-2">
                <div className="w-32">
                  <Segmento
                    valor={form.tipo} onChange={(v) => campo('tipo', v)} size="small"
                    opciones={[
                      { id: TIPO_PORCENTAJE, label: '%' },
                      { id: TIPO_FIJO,       label: '$ fijo' },
                    ]}
                  />
                </div>
                <div className="relative flex-1">
                  <input type="number" min="0" step="0.5" value={form.valor}
                    onChange={(e) => campo('valor', e.target.value)}
                    placeholder={form.tipo === TIPO_PORCENTAJE ? '2' : '50000'}
                    className="w-full pl-3 pr-7 py-2 bg-white border-0 rounded-xl text-sm
                      placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    {form.tipo === TIPO_PORCENTAJE ? '%' : '$'}
                  </span>
                </div>
              </div>
            </div>

            {/* Cada cuánto */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-gray-500">¿Cada cuánto?</span>
              <div className="flex gap-2">
                <select value={form.periodicidad}
                  onChange={(e) => campo('periodicidad', e.target.value)}
                  className="flex-1 px-3 py-2 bg-white border-0 rounded-xl text-sm text-gray-800
                    focus:outline-none focus:ring-2 focus:ring-teal-500">
                  {PERIODICIDADES.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                {form.periodicidad === 'cada_n_dias' && (
                  <input type="number" min="1" value={form.cada_dias}
                    onChange={(e) => campo('cada_dias', e.target.value)}
                    placeholder="días"
                    className="w-24 px-3 py-2 bg-white border-0 rounded-xl text-sm
                      placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                )}
              </div>
            </div>

            {/* Cómo se causa — la opción que más confunde, así que va explicada */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-gray-500">¿Cómo sube?</span>
              <Segmento
                valor={form.devengo} onChange={(v) => campo('devengo', v)}
                opciones={[
                  { id: DEVENGO_DIARIO,  label: 'Poco a poco' },
                  { id: DEVENGO_PERIODO, label: 'De una vez' },
                ]}
              />
              <span className="text-[11px] text-gray-400">
                {form.devengo === DEVENGO_DIARIO
                  ? `Sube todos los días un poquito. A media ${unidadPeriodo(previo || { periodicidad: form.periodicidad, dias_periodo: 30 })} lleva la mitad.`
                  : `No cobra nada hasta cumplir ${unidadPeriodo(previo || { periodicidad: form.periodicidad, dias_periodo: 30 })} completo, y ahí sube todo junto.`}
              </span>
            </div>

            {/* Sobre qué */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-gray-500">¿Sobre qué valor?</span>
              <Segmento
                valor={form.base} onChange={(v) => campo('base', v)}
                opciones={[
                  { id: BASE_SALDO,    label: 'Lo que aún debe' },
                  { id: BASE_ORIGINAL, label: 'El valor total' },
                ]}
              />
              <span className="text-[11px] text-gray-400">
                {form.base === BASE_SALDO
                  ? 'Si el cliente abona, el interés baja con la deuda. Es lo más común y lo más fácil de defender.'
                  : 'El interés no baja aunque el cliente abone. Ojo: si paga anticipado tiene derecho a que se le rebaje la parte no causada.'}
              </span>
            </div>

            {/* Avanzado */}
            <button type="button" onClick={() => setAvanzado((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 self-start">
              {avanzado ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Opciones avanzadas
            </button>

            {avanzado && (
              <div className="flex flex-col gap-3 pl-3 border-l-2 border-gray-200">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-gray-500">Empieza a cobrar después de (días)</span>
                  <input type="number" min="0" value={form.inicia_tras_dias}
                    onChange={(e) => campo('inicia_tras_dias', e.target.value)}
                    placeholder="0 = desde la entrega"
                    className="w-full px-3 py-2 bg-white border-0 rounded-xl text-sm
                      placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  <span className="text-[11px] text-gray-400">
                    Pon 30 si das un mes de plazo sin recargo.
                  </span>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-gray-500">Máximo de períodos</span>
                    <input type="number" min="1" value={form.max_periodos}
                      onChange={(e) => campo('max_periodos', e.target.value)}
                      placeholder="sin límite"
                      className="w-full px-3 py-2 bg-white border-0 rounded-xl text-sm
                        placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                  <div className="flex-1 flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-gray-500">Tope (% del valor)</span>
                    <input type="number" min="0" step="0.5" value={form.tope_pct}
                      onChange={(e) => campo('tope_pct', e.target.value)}
                      placeholder="sin tope"
                      className="w-full px-3 py-2 bg-white border-0 rounded-xl text-sm
                        placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500" />
                  </div>
                </div>
                <span className="text-[11px] text-gray-400 -mt-1">
                  Una deuda olvidada dos años sin tope llega a una cifra que nadie paga y que en
                  cobro judicial se cae. Ponerle techo es lo que hacen las entidades serias.
                </span>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-gray-500">Si el cliente se pasa de la fecha límite</span>
                  <Segmento
                    valor={form.al_vencer} onChange={(v) => campo('al_vencer', v)}
                    opciones={[
                      { id: AL_VENCER_SUSTITUYE, label: 'Para y entra la mora' },
                      { id: AL_VENCER_CONTINUA,  label: 'Sigue + la mora' },
                    ]}
                  />
                  <span className={`text-[11px] ${form.al_vencer === AL_VENCER_CONTINUA ? 'text-amber-600' : 'text-gray-400'}`}>
                    {form.al_vencer === AL_VENCER_SUSTITUYE
                      ? 'Recomendado: mientras está al día paga interés; si se atrasa, pasa a mora. Una sola tasa a la vez.'
                      : 'Cobra las dos cosas al mismo tiempo sobre la misma deuda. En Colombia eso es discutible: solo úsalo si lo pactaste así por escrito.'}
                  </span>
                </div>
              </div>
            )}

            {/* Proyección en vivo — la parte que de verdad enseña */}
            {previo && (
              <div className="bg-white rounded-xl p-3 border border-teal-100">
                <p className="text-[11px] font-medium text-gray-600 mb-2">
                  Si le prestas {formatCOP(BASE_EJEMPLO)} y no te abona nada, te debería:
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-gray-400">
                        <th className="text-left font-medium pb-1">A los…</th>
                        {CORTES.map((d) => (
                          <th key={d} className="text-right font-medium pb-1 pl-2 whitespace-nowrap">{d} días</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="text-gray-500">
                        <td className="py-0.5">Interés</td>
                        {CORTES.map((d) => (
                          <td key={d} className="text-right py-0.5 pl-2 tabular-nums whitespace-nowrap">
                            {formatCOP(proyectar(previo, BASE_EJEMPLO, d))}
                          </td>
                        ))}
                      </tr>
                      <tr className="text-gray-800 font-semibold border-t border-gray-100">
                        <td className="py-0.5">Total a pagar</td>
                        {CORTES.map((d) => (
                          <td key={d} className="text-right py-0.5 pl-2 tabular-nums whitespace-nowrap">
                            {formatCOP(BASE_EJEMPLO + proyectar(previo, BASE_EJEMPLO, d))}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {describirPlan(previo)}
                  {previo.inicia_tras_dias > 0 && ` · sin cobro los primeros ${previo.inicia_tras_dias} días`}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Color:</span>
                {COLORES.map((c) => (
                  <button key={c.id} type="button" onClick={() => campo('color', c.id)} aria-label={c.id}
                    className={`w-5 h-5 rounded-full ${c.clase} transition-all
                      ${form.color === c.id ? 'ring-2 ring-offset-2 ring-gray-400' : 'opacity-60 hover:opacity-100'}`} />
                ))}
              </div>
              <button onClick={handleAgregar}
                className="flex items-center gap-1.5 bg-teal-600 text-white text-xs font-medium
                  px-3 py-2 rounded-xl hover:bg-teal-700 transition-colors">
                <Plus size={14} /> Agregar plan
              </button>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          {/* ── Techo de aviso ── */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-gray-500">Techo de aviso (% mensual equivalente)</span>
            <input type="number" min="0" step="0.1" value={techo}
              onChange={(e) => set('interes_techo_mensual', e.target.value)}
              placeholder="Ej: 3.2"
              className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:bg-white" />
            <span className="text-[11px] text-gray-400">
              Si un plan supera este porcentaje al mes, se marca en rojo. Un plan diario se
              compara ya convertido a mes, para que no parezca inocente. Solo avisa, no bloquea.
            </span>
          </div>

          {/* ── Advertencia legal ── */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex gap-2.5">
            <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-amber-800">Antes de cobrar interés, ten en cuenta</p>
              <p className="text-xs text-amber-700">
                • El interés solo es exigible si se pactó <strong>por escrito</strong>. Por eso la
                factura y el comprobante imprimen el plan y una línea de firma: hazla firmar al entregar.
              </p>
              <p className="text-xs text-amber-700">
                • Existe un <strong>tope legal</strong> (la tasa de usura, que publica cada mes la
                Superintendencia Financiera). Cobrar por encima es delito y hace perder los intereses.
              </p>
              <p className="text-xs text-amber-700">
                • Si el cliente <strong>paga anticipado</strong> tiene derecho a que le rebajes los
                intereses que aún no se habían causado. Con la base "lo que aún debe" eso pasa solo;
                con "el valor total" te toca descontarlo a mano.
              </p>
              <p className="text-xs text-amber-700">
                • Nunca se cobra <strong>interés sobre el interés</strong>. El sistema no lo hace y
                no tiene cómo activarse.
              </p>
            </div>
          </div>

          <div className="bg-teal-50 rounded-xl p-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Info size={13} className="text-teal-500 flex-shrink-0" />
              <p className="text-xs font-medium text-teal-800">Cómo funciona</p>
            </div>
            <p className="text-xs text-teal-700">
              • <strong>Interés y mora son cosas distintas.</strong> El interés se cobra por dar
              plazo; la mora, por incumplirlo. Puedes usar solo uno, los dos, o ninguno.
            </p>
            <p className="text-xs text-teal-700">
              • <strong>Sin plan elegido no hay interés.</strong> Si a un cliente (o a un compañero)
              no le pones plan, nunca se le cobra nada. Tus créditos y préstamos actuales no cambian.
            </p>
            <p className="text-xs text-teal-700">
              • El interés <strong>no se suma a la utilidad del producto</strong>: aparece como
              ingreso aparte en Caja y en Reportes, para que tu margen real no se distorsione.
            </p>
            <p className="text-xs text-teal-700">
              • Al recibir un abono se cubre primero la <strong>mora</strong>, después el
              <strong> interés</strong> y lo que sobre baja la deuda — o eliges tú el reparto.
            </p>
            <p className="text-xs text-teal-700">
              • Si te olvidaste de ponerle plan al facturar, puedes agregárselo después desde el
              detalle. Empieza a correr <strong>desde ese día</strong>, nunca hacia atrás.
            </p>
            <p className="text-xs text-teal-700">
              • Un "mes" son <strong>30 días</strong>, y una quincena 15. No se cuenta por calendario.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default InteresConfig;
