import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Phone, MessageCircle, CalendarClock, AlertTriangle, ArrowRight, Search, BellRing } from 'lucide-react';
import { getCobros } from '../../api/notificaciones.api';
import { formatCOP } from '../../utils/formatters';
import { Spinner }   from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';

// ─────────────────────────────────────────────────────────────────────────────
// COBROS — a quién hay que llamar hoy.
//
// Dos pestañas, dos trabajos distintos:
//   · VENCIDOS  → ya se pasaron de la fecha; se cobra, y hay mora corriendo.
//   · PRÓXIMOS  → vencen dentro de la ventana de aviso; se RECUERDA, para que no
//                 lleguen a mora. Es lo que pidió el negocio: atacar antes.
//
// Sale de la MISMA consulta que alimenta los avisos push: si la notificación
// dice 5, aquí hay 5. Los vencidos van del más atrasado al menos, y los próximos
// del más cercano al más lejano.
//
// Los botones de llamar y WhatsApp son el punto de la pantalla: el negocio
// cobra por teléfono, no leyendo una tabla.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Número en formato internacional para WhatsApp.
 *
 * Los celulares colombianos se guardan a 10 dígitos empezando por 3, y wa.me
 * exige el indicativo. Si el número ya viene con 57 o con otra longitud, se deja
 * como está: es preferible abrir un chat vacío a inventarle un país.
 */
const paraWhatsApp = (tel) => {
  const solo = String(tel || '').replace(/\D/g, '');
  if (!solo) return null;
  if (solo.length === 10 && solo.startsWith('3')) return `57${solo}`;
  return solo;
};

/** dd/mm a partir de una fecha del backend, sin corrimiento de zona. */
const fechaCorta = (v) => {
  const f = String(v instanceof Date ? v.toISOString() : v || '').slice(0, 10);
  const [, m, d] = f.split('-');
  return m && d ? `${d}/${m}` : '';
};

/**
 * El mensaje cambia según el grupo, y eso importa: al que todavía no vence se le
 * RECUERDA (y ahí se gana el cliente), al vencido se le COBRA. Mandarle un
 * reclamo a alguien que aún está en plazo es la forma más rápida de molestarlo.
 */
const mensajeCobro = (item, negocio) => {
  const saludo = `Hola ${String(item.persona || '').split(' ')[0] || ''}`.trim();
  const doc    = item.tipo === 'prestamo' ? `préstamo #${item.numero}` : `factura #${item.numero}`;
  const firma  = negocio || 'nuestra tienda';

  const texto = item.estado === 'por_vencer'
    ? `${saludo}, te saludamos de ${firma}. Te recordamos que el pago de tu ${doc} `
      + `${item.dias_restantes === 0 ? 'vence hoy' : item.dias_restantes === 1 ? 'vence mañana' : `vence el ${fechaCorta(item.fecha_limite)}`}`
      + `. Valor: ${formatCOP(item.total)}. ¡Gracias!`
    : `${saludo}, te escribimos de ${firma} para recordarte el pago de tu ${doc}. `
      + `Saldo pendiente: ${formatCOP(item.total)}. ¿Cuándo podemos contar con el pago?`;

  return encodeURIComponent(texto);
};

// ── Tarjeta de un cobro ──────────────────────────────────────────────────────

function TarjetaCobro({ item, negocio, onIr }) {
  const wa = paraWhatsApp(item.telefono);
  const porVencer = item.estado === 'por_vencer';

  // El color ordena el trabajo del día: verde el que todavía está en plazo, y de
  // amarillo a rojo según crece el atraso.
  const tono = porVencer
    ? (item.dias_restantes === 0 ? 'border-blue-200 bg-blue-50/40' : 'border-emerald-200 bg-emerald-50/30')
    : item.dias_vencidos >= 30   ? 'border-red-200 bg-red-50/40'
    : item.dias_vencidos >= 8    ? 'border-orange-200 bg-orange-50/40'
    :                              'border-amber-200 bg-amber-50/30';

  const badge = porVencer
    ? (item.dias_restantes === 0 ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700')
    : item.dias_vencidos >= 30   ? 'bg-red-100 text-red-700'
    : item.dias_vencidos >= 8    ? 'bg-orange-100 text-orange-700'
    :                              'bg-amber-100 text-amber-700';

  const textoPlazo = porVencer
    ? (item.dias_restantes === 0 ? 'Vence hoy'
      : item.dias_restantes === 1 ? 'Vence mañana'
      : `En ${item.dias_restantes} días`)
    : `${item.dias_vencidos} día${item.dias_vencidos === 1 ? '' : 's'}`;

  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-3 ${tono}`}>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{item.persona}</p>
          <p className="text-xs text-gray-500 truncate mt-0.5">
            {item.tipo === 'prestamo' ? 'Préstamo' : 'Factura'} #{item.numero}
            {item.detalle ? ` · ${item.detalle}` : ''}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {item.sucursal_nombre}
            {porVencer ? ` · vence ${fechaCorta(item.fecha_limite)}` : ''}
          </p>
        </div>
        <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${badge}`}>
          <CalendarClock size={11} />
          {textoPlazo}
        </span>
      </div>

      {/* Cifras: capital y mora SEPARADOS, que es como funciona la deuda */}
      <div className="bg-white/70 rounded-xl p-2.5 flex flex-col gap-1">
        <div className="flex justify-between">
          <span className="text-[11px] text-gray-500">Producto</span>
          <span className="text-xs font-semibold text-gray-700">{formatCOP(item.capital)}</span>
        </div>
        {item.mora > 0 && (
          <div className="flex justify-between">
            <span className="text-[11px] text-amber-600">Mora</span>
            <span className="text-xs font-semibold text-amber-700">{formatCOP(item.mora)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-gray-100 pt-1 mt-0.5">
          <span className="text-xs font-medium text-gray-600">
            {porVencer ? 'Total a pagar' : 'Total a cobrar'}
          </span>
          <span className={`text-sm font-bold ${porVencer ? 'text-gray-800' : 'text-red-600'}`}>
            {formatCOP(item.total)}
          </span>
        </div>
      </div>

      {/* Acciones: llamar es lo primero, es para lo que se abre esta pantalla */}
      <div className="flex flex-wrap gap-2">
        {item.telefono ? (
          <>
            <a href={`tel:${item.telefono}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                text-white transition-colors
                ${porVencer ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
              <Phone size={13} /> {porVencer ? 'Recordar' : 'Llamar'}
            </a>
            {wa && (
              <a href={`https://wa.me/${wa}?text=${mensajeCobro(item, negocio)}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                  bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors">
                <MessageCircle size={13} /> WhatsApp
              </a>
            )}
          </>
        ) : (
          <span className="text-[11px] text-gray-400 italic py-1.5">Sin teléfono registrado</span>
        )}

        <button onClick={() => onIr(item)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium
            text-gray-500 hover:text-gray-700 hover:bg-white transition-colors ml-auto">
          Ver deuda <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export default function CobrosPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useState('');

  // La pestaña viaja en la URL para que el aviso push pueda abrir directamente
  // la de próximos (`/cobros?tab=proximos`).
  const tab = params.get('tab') === 'proximos' ? 'proximos' : 'vencidos';
  const irATab = (t) => {
    setParams(t === 'proximos' ? { tab: 'proximos' } : {}, { replace: true });
    setBusca('');
  };

  const { data, isLoading } = useQuery({
    queryKey: ['cobros'],
    queryFn:  () => getCobros().then((r) => r.data.data),
    // Cobrar es una actividad de minutos: si alguien abona mientras se llama,
    // la lista tiene que reflejarlo pronto.
    staleTime: 30_000,
  });

  const grupo = tab === 'proximos' ? data?.por_vencer : data?.vencidos;

  const items = useMemo(() => {
    const lista = grupo?.items ?? [];
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((i) =>
      String(i.persona).toLowerCase().includes(q)
      || String(i.numero).includes(q)
      || String(i.telefono ?? '').includes(q));
  }, [grupo, busca]);

  if (isLoading) return <Spinner className="py-32" />;

  const nVencidos  = data?.vencidos?.items?.length   ?? 0;
  const nProximos  = data?.por_vencer?.items?.length ?? 0;
  const hayAlgo    = nVencidos + nProximos > 0;
  const esProximos = tab === 'proximos';

  return (
    <div className="flex flex-col gap-5">

      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Phone size={19} className="text-red-500" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-900">Cobros del día</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            A quién cobrarle y a quién recordarle antes de que se le venza.
          </p>
        </div>
      </div>

      {!hayAlgo ? (
        <EmptyState
          icon={CalendarClock}
          titulo="No hay nada por cobrar"
          descripcion={`Ningún crédito ni préstamo está vencido ni vence en los próximos ${data?.dias_aviso ?? 3} días.`}
        />
      ) : (
        <>
          {/* Pestañas: dos trabajos distintos, no una lista revuelta */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            <button type="button" onClick={() => irATab('vencidos')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg
                text-xs font-medium transition-all
                ${tab === 'vencidos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <AlertTriangle size={13} className={tab === 'vencidos' ? 'text-red-500' : 'text-gray-400'} />
              Vencidos
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full
                ${nVencidos === 0 ? 'bg-gray-100 text-gray-400' : 'bg-red-100 text-red-600'}`}>
                {nVencidos}
              </span>
            </button>
            <button type="button" onClick={() => irATab('proximos')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg
                text-xs font-medium transition-all
                ${tab === 'proximos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <BellRing size={13} className={tab === 'proximos' ? 'text-blue-500' : 'text-gray-400'} />
              Próximos
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full
                ${nProximos === 0 ? 'bg-gray-100 text-gray-400' : 'bg-blue-100 text-blue-600'}`}>
                {nProximos}
              </span>
            </button>
          </div>

          {(grupo?.items?.length ?? 0) === 0 ? (
            <EmptyState
              icon={esProximos ? BellRing : CalendarClock}
              titulo={esProximos ? 'Nada por vencer' : 'Nada vencido'}
              descripcion={esProximos
                ? `Ningún pago vence en los próximos ${data?.dias_aviso ?? 3} días. Puedes cambiar ese número en Ajustes → Mora.`
                : 'Ningún crédito ni préstamo se pasó de la fecha límite. Bien ahí.'}
            />
          ) : (
            <>
              {/* Resumen del grupo */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  ['Clientes',  String(grupo.total_clientes), 'text-gray-900'],
                  ['Producto',  formatCOP(grupo.capital),     'text-gray-900'],
                  ['Mora',      formatCOP(grupo.mora),        'text-amber-600'],
                ].map(([label, valor, clase]) => (
                  <div key={label} className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
                    <p className="text-[11px] text-gray-400">{label}</p>
                    <p className={`text-sm font-bold mt-0.5 truncate ${clase}`}>{valor}</p>
                  </div>
                ))}
              </div>

              <div className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 border
                ${esProximos ? 'bg-blue-50 border-blue-100' : 'bg-red-50 border-red-100'}`}>
                <span className={`text-sm font-medium ${esProximos ? 'text-blue-700' : 'text-red-700'}`}>
                  {esProximos ? 'Total por vencer' : 'Total por cobrar'}
                </span>
                <span className={`text-lg font-bold ${esProximos ? 'text-blue-600' : 'text-red-600'}`}>
                  {formatCOP(grupo.total)}
                </span>
              </div>

              {/* Buscador: con 30 en la lista, encontrar al que acaba de contestar */}
              {grupo.items.length > 6 && (
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por nombre, número o teléfono"
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  />
                </div>
              )}

              {/* Lista */}
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((i) => (
                  <TarjetaCobro
                    key={`${i.tipo}-${i.id}`}
                    item={i}
                    negocio={data.negocio_nombre}
                    onIr={() => navigate('/prestamos')}
                  />
                ))}
              </div>

              {items.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">
                  Ninguno coincide con “{busca}”.
                </p>
              )}
            </>
          )}

          {/* Nota sobre la mora: solo donde aplica */}
          {!esProximos && grupo?.mora > 0 && (
            <div className="flex gap-2.5 bg-amber-50 border border-amber-100 rounded-xl p-3">
              <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-relaxed">
                La mora se cobra aparte del producto y con su propio botón, desde el préstamo o
                el crédito. Mientras quede mora pendiente, la deuda no queda saldada.
              </p>
            </div>
          )}
          {esProximos && (
            <div className="flex gap-2.5 bg-blue-50 border border-blue-100 rounded-xl p-3">
              <BellRing size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 leading-relaxed">
                Estos todavía no deben mora. Un recordatorio a tiempo es lo que evita que
                pasen a la pestaña de vencidos.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
