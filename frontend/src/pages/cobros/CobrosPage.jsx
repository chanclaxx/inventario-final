import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Phone, MessageCircle, CalendarClock, AlertTriangle, ArrowRight, Search } from 'lucide-react';
import { getCobros } from '../../api/notificaciones.api';
import { formatCOP } from '../../utils/formatters';
import { Spinner }   from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';

// ─────────────────────────────────────────────────────────────────────────────
// COBROS — a quién hay que llamar hoy.
//
// Es la pantalla que abre el aviso de cartera vencida, y sale de la MISMA
// consulta que cuenta los vencidos en el aviso: si la notificación dice 5, aquí
// hay 5. Ordenada por días de atraso, porque el que lleva 40 días es más urgente
// que el que lleva 2 aunque deba menos.
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

const mensajeCobro = (item, negocio) => {
  const saludo = `Hola ${String(item.persona || '').split(' ')[0] || ''}`.trim();
  const doc = item.tipo === 'prestamo' ? `préstamo #${item.numero}` : `factura #${item.numero}`;
  const texto = `${saludo}, te escribimos de ${negocio || 'nuestra tienda'} para recordarte el pago `
    + `de tu ${doc}. Saldo pendiente: ${formatCOP(item.total)}. ¿Cuándo podemos contar con el pago?`;
  return encodeURIComponent(texto);
};

// ── Tarjeta de un cobro ──────────────────────────────────────────────────────

function TarjetaCobro({ item, negocio, onIr }) {
  const wa  = paraWhatsApp(item.telefono);
  const dias = item.dias_vencidos;

  // El color sube con el atraso: es la señal que ordena el trabajo del día.
  const tono = dias >= 30 ? 'border-red-200 bg-red-50/40'
    : dias >= 8           ? 'border-orange-200 bg-orange-50/40'
    :                       'border-amber-200 bg-amber-50/30';

  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-3 ${tono}`}>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{item.persona}</p>
          <p className="text-xs text-gray-500 truncate mt-0.5">
            {item.tipo === 'prestamo' ? 'Préstamo' : 'Factura'} #{item.numero}
            {item.detalle ? ` · ${item.detalle}` : ''}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">{item.sucursal_nombre}</p>
        </div>
        <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap
          ${dias >= 30 ? 'bg-red-100 text-red-700' : dias >= 8 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
          <CalendarClock size={11} />
          {dias} día{dias === 1 ? '' : 's'}
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
          <span className="text-xs font-medium text-gray-600">Total a cobrar</span>
          <span className="text-sm font-bold text-red-600">{formatCOP(item.total)}</span>
        </div>
      </div>

      {/* Acciones: llamar es lo primero, es para lo que se abre esta pantalla */}
      <div className="flex flex-wrap gap-2">
        {item.telefono ? (
          <>
            <a href={`tel:${item.telefono}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                bg-emerald-600 text-white hover:bg-emerald-700 transition-colors">
              <Phone size={13} /> Llamar
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
  const [busca, setBusca] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['cobros'],
    queryFn:  () => getCobros().then((r) => r.data.data),
    // Cobrar es una actividad de minutos: si alguien abona mientras se llama,
    // la lista tiene que reflejarlo pronto.
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    const lista = data?.items ?? [];
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((i) =>
      String(i.persona).toLowerCase().includes(q)
      || String(i.numero).includes(q)
      || String(i.telefono ?? '').includes(q));
  }, [data, busca]);

  if (isLoading) return <Spinner className="py-32" />;

  const total = data?.total ?? 0;

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
            Clientes con el plazo vencido, del más atrasado al menos.
          </p>
        </div>
      </div>

      {(data?.items?.length ?? 0) === 0 ? (
        <EmptyState
          icon={CalendarClock}
          titulo="No hay nada por cobrar"
          descripcion="Ningún crédito ni préstamo tiene el plazo vencido. Aparecerán aquí en cuanto se pase la fecha límite."
        />
      ) : (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Clientes',  String(data.total_clientes),  'text-gray-900'],
              ['Producto',  formatCOP(data.capital),      'text-gray-900'],
              ['Mora',      formatCOP(data.mora),         'text-amber-600'],
            ].map(([label, valor, clase]) => (
              <div key={label} className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm">
                <p className="text-[11px] text-gray-400">{label}</p>
                <p className={`text-sm font-bold mt-0.5 truncate ${clase}`}>{valor}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
            <span className="text-sm font-medium text-red-700">Total por cobrar</span>
            <span className="text-lg font-bold text-red-600">{formatCOP(total)}</span>
          </div>

          {/* Buscador: con 30 vencidos, encontrar al que acaba de contestar */}
          {data.items.length > 6 && (
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
                onIr={(it) => navigate(it.tipo === 'prestamo' ? '/prestamos' : '/prestamos')}
              />
            ))}
          </div>

          {items.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">
              Ningún cobro coincide con “{busca}”.
            </p>
          )}

          {/* Nota sobre la mora */}
          {data.mora > 0 && (
            <div className="flex gap-2.5 bg-amber-50 border border-amber-100 rounded-xl p-3">
              <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-relaxed">
                La mora se cobra aparte del producto y con su propio botón, desde el préstamo o
                el crédito. Mientras quede mora pendiente, la deuda no queda saldada.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
