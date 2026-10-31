import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSedesTraslado, cerrarCuentaSede } from '../../api/redInterna.api';
import { formatCOP } from '../../utils/formatters';
import { ArrowRightLeft, AlertTriangle, CheckCircle, Info } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// SEDES PROPIAS — a cuáles se les TRASLADA (sin cuenta) en vez de despachar
//
// Claves de `config_negocio`:
//   red_interna_sedes_propias       arreglo JSON de ids (ausente = ninguna)
//   red_interna_traslados_confirmar '1' = el destino confirma; ausente = directo
//   red_interna_traslados_rutas     'bodega' (defecto) | 'entre_sedes'
//
// Una sede con cuenta abierta no se puede marcar: primero se cierra en $0 con
// el botón de su fila, que deja UN ajuste explicando por qué (no borra nada).
// El backend lo vuelve a exigir al guardar.
// Quién traslada no se decide aquí: es el permiso «Traslados» de cada usuario.
// ─────────────────────────────────────────────────────────────────────────────

const leerIds = (raw) => {
  try { const l = JSON.parse(raw || '[]'); return Array.isArray(l) ? l.map(Number) : []; } catch { return []; }
};

function FilaSede({ sede, marcada, onToggle, onCerrada }) {
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState('');
  const cerrar = useMutation({
    mutationFn: () => cerrarCuentaSede(sede.sucursal_id).then((r) => r.data.data),
    onSuccess: () => { setConfirmando(false); onCerrada(); },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo cerrar la cuenta'),
  });
  // Marcada en pantalla pero todavía no guardada como propia, y con cuenta.
  const bloqueada = marcada && !sede.es_propia && !sede.lista;
  const monto = sede.total_a_pagar > 0 ? sede.total_a_pagar : sede.saldo_a_favor;

  return (
    <div className="py-2.5">
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={marcada} onChange={onToggle} className="w-4 h-4 rounded accent-blue-600" />
        <span className="text-sm text-gray-700 flex-1">{sede.nombre}</span>
        {sede.es_propia
          ? <span className="text-[11px] text-blue-600">sede propia</span>
          : sede.lista
            ? <span className="text-[11px] text-gray-400">sin cuenta pendiente</span>
            : <span className="text-[11px] text-amber-600">
                {sede.pendientes.length ? 'con movimientos en camino' : sede.total_a_pagar > 0 ? `debe ${formatCOP(monto)}` : `a favor ${formatCOP(monto)}`}
              </span>}
      </label>

      {bloqueada && (
        <div className="ml-7 mt-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
          {sede.pendientes.length ? (
            <p className="text-xs text-amber-700 flex gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <span>Antes hay que resolver: {sede.pendientes.join(', ')}.</span>
            </p>
          ) : (
            <>
              <p className="text-xs text-amber-700 flex gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                <span>
                  Tiene cuenta con la bodega ({sede.total_a_pagar > 0 ? `debe ${formatCOP(monto)}` : `a favor ${formatCOP(monto)}`}).
                  Para que sea sede propia, la cuenta se cierra en $0 con un ajuste que dice: «por decisión de diseño
                  esta sucursal pasó a recibir traslados». Los envíos y abonos de antes no se borran.
                </span>
              </p>
              {!confirmando ? (
                <button type="button" onClick={() => { setError(''); setConfirmando(true); }}
                  className="mt-2 text-xs font-semibold text-blue-600">
                  Cerrar la cuenta en $0
                </button>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-600">¿Seguro?</span>
                  <button type="button" disabled={cerrar.isPending} onClick={() => cerrar.mutate()}
                    className="text-xs font-semibold text-white bg-blue-600 px-3 py-1.5 rounded-lg disabled:opacity-50">
                    {cerrar.isPending ? 'Cerrando…' : 'Sí, cerrarla'}
                  </button>
                  <button type="button" onClick={() => setConfirmando(false)} className="text-xs text-gray-500">Cancelar</button>
                </div>
              )}
              {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            </>
          )}
        </div>
      )}
      {marcada && !sede.es_propia && sede.lista && (
        <p className="ml-7 mt-1 text-[11px] text-green-600 flex items-center gap-1">
          <CheckCircle size={11} /> Lista: guarda los cambios para que reciba traslados.
        </p>
      )}
    </div>
  );
}

export function SedesPropiasConfig({ valores, set }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['red-traslados-sedes'],
    queryFn:  () => getSedesTraslado().then((r) => r.data.data),
    retry: false,
  });
  const marcadas = leerIds(valores.red_interna_sedes_propias);
  const toggle = (id) => {
    const nueva = marcadas.includes(id) ? marcadas.filter((x) => x !== id) : [...marcadas, id];
    set('red_interna_sedes_propias', JSON.stringify(nueva.sort((a, b) => a - b)));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <ArrowRightLeft size={16} className="text-gray-400 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-gray-700">Sedes propias: traslados sin cuenta</p>
          <p className="text-xs text-gray-400">
            A estas sucursales la bodega les TRASLADA en vez de despacharles: la mercancía se mueve con su costo
            real y no genera deuda. A los demás locales se les sigue despachando igual que hoy.
          </p>
        </div>
      </div>

      {isLoading && <p className="text-xs text-gray-400">Cargando sucursales…</p>}
      {isError && (
        <p className="text-xs text-amber-600">
          {error?.response?.status === 404 || error?.response?.status === 409
            ? 'Guarda primero la distribución desde bodega (activa y con la bodega elegida) para configurar las sedes propias.'
            : (error?.response?.data?.error || 'No se pudieron cargar las sucursales')}
        </p>
      )}
      {data && !data.instalado && (
        <p className="text-xs text-amber-600">Los traslados todavía no están instalados en la base de datos.</p>
      )}
      {data && (
        <div className="divide-y divide-gray-50">
          {data.sedes.map((s) => (
            <FilaSede key={s.sucursal_id} sede={s} marcada={marcadas.includes(s.sucursal_id)}
              onToggle={() => toggle(s.sucursal_id)}
              onCerrada={() => qc.invalidateQueries({ queryKey: ['red-traslados-sedes'] })} />
          ))}
        </div>
      )}

      {marcadas.length > 0 && (
        <div className="flex flex-col gap-3 pt-1">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 mt-0.5 rounded accent-blue-600"
              checked={valores.red_interna_traslados_confirmar === '1'}
              onChange={(e) => set('red_interna_traslados_confirmar', e.target.checked ? '1' : '0')} />
            <span>
              <span className="text-sm text-gray-700">El destino confirma lo que le llegó</span>
              <span className="block text-xs text-gray-400">
                Apagado, el traslado entra directo a su inventario. Encendido, queda «en camino» (reservado, sin
                poder venderse ni moverse) hasta que alguien de la sede lo revise y lo reciba.
              </span>
            </span>
          </label>

          <div>
            <p className="text-sm text-gray-700 mb-1.5">¿Entre quiénes se traslada?</p>
            {[
              ['bodega', 'Solo entre la bodega y sus sedes', 'Bodega → sede y sede → bodega.'],
              ['entre_sedes', 'También entre sedes propias', 'Además, una sede propia le puede trasladar a otra. Los locales con cuenta nunca entran.'],
            ].map(([v, titulo, desc]) => (
              <label key={v} className="flex items-start gap-3 py-1 cursor-pointer">
                <input type="radio" name="traslados_rutas" className="mt-1 accent-blue-600"
                  checked={(valores.red_interna_traslados_rutas || 'bodega') === v}
                  onChange={() => set('red_interna_traslados_rutas', v)} />
                <span>
                  <span className="text-sm text-gray-700">{titulo}</span>
                  <span className="block text-xs text-gray-400">{desc}</span>
                </span>
              </label>
            ))}
          </div>

          <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2.5 flex gap-2">
            <Info size={13} className="mt-0.5 flex-shrink-0 text-gray-400" />
            <span>
              Trasladar lo puede quien tenga el permiso <b>Traslados</b> en Ajustes → Usuarios (los supervisores lo
              traen por defecto; a un vendedor hay que marcárselo). Recibir lo puede cualquiera de la sede con el
              módulo Bodega. Nadie ve costos ni precios en un traslado; solo el administrador ve lo que costó.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
