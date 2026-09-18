import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Bell, CheckCircle2, ChevronRight, RefreshCw,
  Wallet, Truck, ShieldCheck, PackageSearch, ClipboardCheck, Banknote,
  CreditCard, Layers, FileClock, ChevronDown, Phone,
  Wrench,
} from 'lucide-react';
import { getResumenAvisos } from '../../api/notificaciones.api';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatCOP }  from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// AVISOS — el panel al que lleva el resumen del día
//
// ── De dónde salen estos datos ──────────────────────────────────────────────
// De `GET /notificaciones/resumen`, que es EXACTAMENTE el mismo motor que decide
// qué se notifica. No hay una consulta propia de esta pantalla, y eso es
// deliberado: si la pantalla calculara por su cuenta, el usuario abriría el
// resumen que le llegó al celular y encontraría algo distinto a lo que le
// avisaron. Un panel que contradice a la notificación destruye la confianza en
// las dos cosas a la vez.
//
// ── Por qué lo urgente va arriba y separado ─────────────────────────────────
// Es la misma división que usa el envío: lo urgente sonó solo, el resto llegó en
// un resumen. Si aquí se mezclaran, la pantalla estaría diciendo que todo pesa
// igual justo después de que la notificación dijo lo contrario.
//
// ── Lo que esta pantalla NO hace ────────────────────────────────────────────
// No resuelve nada. Cada tarjeta LLEVA al sitio donde se resuelve — la ficha del
// cliente, la orden, la entrada. Un panel que intente cobrar, confirmar y cerrar
// caja termina siendo una segunda versión peor de cuatro pantallas que ya
// existen.
// ─────────────────────────────────────────────────────────────────────────────

// El icono se saca por ACCESO A PROPIEDAD, nunca de una función: para el linter
// una llamada durante el render puede estar creando un componente nuevo cada vez
// (`react-hooks/static-components`).
const ICONOS = {
  cobros:      Wallet,
  proveedores: CreditCard,
  garantias:   ShieldCheck,
  pedidos:     Truck,
  entradas:    ClipboardCheck,
  caja:        Banknote,
  plan:        FileClock,
  borradores:  Layers,
  inventario:  PackageSearch,
  tecnicos:    Wrench,
};
const ICONO_POR_DEFECTO = Bell;

// ── Cobros: la tarjeta que dice A QUIÉN ─────────────────────────────────────
//
// «5 cobros vencidos» llevaba a la pestaña general de Préstamos y ahí había que
// buscar uno por uno. La tarjeta de cobros se DESPLIEGA con la lista de personas
// —sale de `detalle.cartera`, el mismo cálculo que decidió el aviso— y cada fila
// abre la ficha de esa persona con el enlace que ya arma la alerta (el mismo que
// lleva el push individual). «Ver en Préstamos» va a la lista filtrada.
//
// Se agrupa por ese enlace porque es la persona tal como la agrupa su pantalla:
// dos préstamos de la misma persona son UNA llamada. Un ítem sin persona ligada
// (préstamo escrito a mano, sin ficha) se queda en su propia fila.
const TOPE_PERSONAS = 10;

function agruparPorPersona(items = []) {
  const mapa = new Map();
  for (const i of items) {
    const clave = i.url && i.url.includes('persona=') ? i.url : `${i.tipo}-${i.id}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave, url: i.url, persona: i.persona, telefono: i.telefono,
        sucursal: i.sucursal_nombre, tipos: new Set(), n: 0, total: 0,
        dias_vencidos: 0, dias_restantes: null,
      });
    }
    const g = mapa.get(clave);
    g.tipos.add(i.tipo);
    g.n += 1;
    g.total += Number(i.total || 0);
    g.dias_vencidos = Math.max(g.dias_vencidos, Number(i.dias_vencidos || 0));
    if (i.estado === 'por_vencer' && i.dias_restantes != null) {
      g.dias_restantes = g.dias_restantes == null
        ? Number(i.dias_restantes) : Math.min(g.dias_restantes, Number(i.dias_restantes));
    }
  }
  // Mismo orden que la alerta: el más atrasado (o el que vence antes) arriba.
  return [...mapa.values()].sort((a, b) =>
    (b.dias_vencidos - a.dias_vencidos)
    || ((a.dias_restantes ?? 0) - (b.dias_restantes ?? 0))
    || (b.total - a.total));
}

const _dias = (n) => (n === 1 ? '1 día' : `${n} días`);

function textoPlazo(p, vencido) {
  if (vencido) return p.dias_vencidos > 0 ? ` · vencido hace ${_dias(p.dias_vencidos)}` : '';
  if (p.dias_restantes === 0) return ' · vence hoy';
  return p.dias_restantes != null ? ` · vence en ${_dias(p.dias_restantes)}` : '';
}

function FilaPersonaCobro({ p, vencido }) {
  const que = p.tipos.size > 1 ? (p.n === 1 ? 'deuda' : 'deudas')
    : p.tipos.has('credito') ? (p.n === 1 ? 'factura a crédito' : 'facturas a crédito')
    : (p.n === 1 ? 'préstamo' : 'préstamos');
  const destino = p.url || '/prestamos';
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 bg-white">
      <Link to={destino} className="flex-1 min-w-0 group">
        <p className="text-sm font-medium text-gray-800 truncate group-hover:text-blue-700">
          {p.persona}
        </p>
        <p className="text-xs text-gray-500 truncate">
          {p.n} {que}{textoPlazo(p, vencido)}{p.sucursal ? ` · ${p.sucursal}` : ''}
        </p>
      </Link>
      <span className="text-sm font-semibold text-gray-700 tabular-nums flex-shrink-0">
        {formatCOP(p.total)}
      </span>
      {p.telefono && (
        <a href={`tel:${p.telefono}`} title={`Llamar a ${p.persona}`}
          className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 flex-shrink-0">
          <Phone size={14} />
        </a>
      )}
      <Link to={destino} className="flex-shrink-0" aria-label={`Abrir la cuenta de ${p.persona}`}>
        <ChevronRight size={15} className="text-gray-300" />
      </Link>
    </div>
  );
}

function TarjetaCobros({ senal, grupo }) {
  const urgente  = senal.prioridad === 'urgente';
  // Lo vencido llega abierto: es lo que se vino a ver.
  const [abierta, setAbierta] = useState(urgente);
  const vencido  = senal.clave === 'cobros_vencidos';
  const personas = agruparPorPersona(grupo?.items);
  const visibles = personas.slice(0, TOPE_PERSONAS);
  const Icono    = ICONOS.cobros;

  return (
    <div className={`rounded-xl border overflow-hidden ${urgente ? 'border-red-200' : 'border-gray-100'}`}>
      <button type="button" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}
        className={`w-full flex items-center gap-3 p-3.5 text-left transition-colors
          ${urgente ? 'bg-red-50/50 hover:bg-red-50' : 'bg-white hover:bg-gray-50/60'}`}>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
          ${urgente ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
          <Icono size={17} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${urgente ? 'text-red-900' : 'text-gray-800'}`}>
            {senal.titulo}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {abierta ? 'Toca a una persona para abrir su cuenta.' : 'Toca para ver quiénes son.'}
          </p>
        </div>
        {senal.valor > 0 && (
          <span className="text-sm font-semibold text-gray-700 tabular-nums flex-shrink-0 hidden sm:block">
            {formatCOP(senal.valor)}
          </span>
        )}
        <ChevronDown size={16}
          className={`text-gray-400 flex-shrink-0 transition-transform ${abierta ? 'rotate-180' : ''}`} />
      </button>

      {abierta && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {visibles.map((p) => <FilaPersonaCobro key={p.clave} p={p} vencido={vencido} />)}
          <Link to={senal.url || '/prestamos'}
            className="flex items-center justify-center gap-1 px-3 py-2.5 text-xs font-medium
                       text-blue-600 hover:bg-blue-50 bg-white">
            {personas.length > visibles.length
              ? `Ver los ${personas.length} en Préstamos`
              : 'Ver en Préstamos'}
            <ChevronRight size={13} />
          </Link>
        </div>
      )}
    </div>
  );
}

function Tarjeta({ senal }) {
  const urgente = senal.prioridad === 'urgente';
  // `const` en mayúscula en el cuerpo, no destructurando el parámetro del map:
  // no hay eslint-plugin-react, así que el uso en JSX no cuenta como referencia
  // y solo los `const` en mayúscula entran en `varsIgnorePattern`.
  const Icono = ICONOS[senal.categoria] ?? ICONO_POR_DEFECTO;

  return (
    <Link
      to={senal.url || '/'}
      className={`flex items-center gap-3 p-3.5 rounded-xl border transition-colors
        ${urgente
          ? 'border-red-200 bg-red-50/50 hover:bg-red-50'
          : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/60'}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
        ${urgente ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
        <Icono size={17} />
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${urgente ? 'text-red-900' : 'text-gray-800'}`}>
          {senal.titulo}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{senal.cuerpo}</p>
      </div>

      {senal.valor > 0 && (
        <span className="text-sm font-semibold text-gray-700 tabular-nums flex-shrink-0 hidden sm:block">
          {formatCOP(senal.valor)}
        </span>
      )}
      <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
    </Link>
  );
}

export default function AvisosPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['avisos-resumen'],
    queryFn:  () => getResumenAvisos().then((r) => r.data.data),
    // Recorre cartera, proveedores, garantías y stock: no es una consulta barata
    // y su respuesta no cambia de un minuto a otro.
    staleTime: 2 * 60 * 1000,
  });

  const urgentes = data?.urgentes || [];
  const normales = data?.normales || [];

  // Las dos tarjetas de cobros se despliegan con la lista de personas; el resto
  // sigue siendo un enlace. Sin detalle (backend viejo), enlace como antes.
  const grupoCobros = {
    cobros_vencidos:   data?.detalle?.cartera?.vencidos,
    cobros_por_vencer: data?.detalle?.cartera?.por_vencer,
  };
  const pintar = (s) => (grupoCobros[s.clave]?.items?.length
    ? <TarjetaCobros key={s.clave} senal={s} grupo={grupoCobros[s.clave]} />
    : <Tarjeta key={s.clave} senal={s} />);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Avisos</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Lo que el sistema encontró pendiente hoy.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-500
                     hover:text-gray-800 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {isLoading ? <Spinner className="py-16" /> : isError ? (
        // Sin esto, un endpoint lento o caído se ve como "no tienes nada
        // pendiente" — que es la mentira más cara que puede decir esta pantalla.
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-800 font-medium">No se pudieron cargar los avisos</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Esto no significa que no haya nada pendiente. Vuelve a intentarlo.
            </p>
          </div>
        </div>
      ) : (urgentes.length === 0 && normales.length === 0) ? (
        <EmptyState
          icon={CheckCircle2}
          titulo="Todo al día"
          descripcion="No hay cobros vencidos, garantías por vencerse ni pedidos atrasados."
        />
      ) : (
        <>
          {urgentes.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide flex items-center gap-1.5">
                <AlertTriangle size={12} /> Para hoy
              </p>
              {urgentes.map(pintar)}
            </div>
          )}

          {normales.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Cuando puedas
              </p>
              {normales.map(pintar)}
            </div>
          )}

          <p className="text-xs text-gray-400 text-center">
            Estos son los mismos avisos que llegan al celular. Lo urgente suena
            aparte; lo demás va en el resumen de la mañana.
          </p>
        </>
      )}
    </div>
  );
}
