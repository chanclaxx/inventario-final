import { formatFechaHora } from '../../utils/formatters';
import { Badge } from '../../components/ui/Badge';
import { ClipboardList, Zap, ChevronRight, Store, CheckCircle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// LAS DOS LISTAS DE PEDIDOS — la bandeja de la bodega y "mis pedidos" del local
//
// Viven juntas y comparten `FilaPedido` porque muestran EXACTAMENTE lo mismo
// visto desde los dos lados: quién pide, cuánto falta y en qué va. Separarlas
// en dos archivos es cómo empiezan a divergir dos pantallas que deberían decir
// lo mismo — ya pasó con las dos listas de módulos.
//
// El número de "faltan N" no está guardado en ninguna columna: se deriva de las
// remisiones en cada lectura. Por eso la bandeja se vacía sola al despachar y
// vuelve a llenarse si ese envío se anula o el local reporta un faltante.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_AVANCE = {
  'Sin despachar': 'gray',
  Parcial:         'yellow',
  Despachado:      'green',
};

function FilaPedido({ p, mostrarLocal, onAbrir }) {
  const pendientes = Number(p.unidades_pendientes || 0);
  return (
    <button
      onClick={() => onAbrir(p.id)}
      className="w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50
        last:border-0 hover:bg-gray-50 transition-colors text-left"
    >
      {mostrarLocal && (
        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
          <Store size={15} className="text-gray-500" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">
          {mostrarLocal ? p.sucursal_nombre : `Pedido #${p.numero ?? p.id}`}
          {p.prioridad === 'urgente' && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md
              bg-amber-100 text-amber-700 text-[11px] font-semibold align-middle">
              <Zap size={10} /> urgente
            </span>
          )}
        </p>
        <p className="text-xs text-gray-400">
          {mostrarLocal && `#${p.numero ?? p.id} · `}
          {pendientes > 0
            ? `${pendientes} de ${p.unidades_pedidas} unidad(es) por despachar`
            : `${p.unidades_pedidas} unidad(es), todo despachado`}
          {' · '}{formatFechaHora(p.fecha)}
        </p>
      </div>
      <Badge variant={p.estado === 'Enviado' ? (COLOR_AVANCE[p.avance] || 'gray')
                    : p.estado === 'Cerrado' ? 'gray' : 'red'}>
        {p.estado === 'Enviado' ? p.avance : p.estado}
      </Badge>
      <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
    </button>
  );
}

/**
 * Bandeja de la BODEGA: lo que los locales pidieron y espera respuesta.
 *
 * Los urgentes primero. Es lo único que hace la prioridad, y basta: un pedido
 * urgente enterrado bajo diez normales no es urgente para nadie.
 */
export function BandejaPedidos({ pedidos, onAbrir }) {
  if (!pedidos || pedidos.length === 0) return null;

  const ordenados = [...pedidos].sort((a, b) =>
    (b.prioridad === 'urgente' ? 1 : 0) - (a.prioridad === 'urgente' ? 1 : 0));

  return (
    <div className="bg-white border border-blue-200 rounded-2xl mb-4">
      <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
        <ClipboardList size={16} className="text-blue-600" />
        <p className="text-sm font-semibold text-gray-800">
          {pedidos.length} pedido(s) de los locales
        </p>
      </div>
      <div className="divide-y divide-gray-50">
        {ordenados.map((p) => (
          <FilaPedido key={p.id} p={p} mostrarLocal onAbrir={onAbrir} />
        ))}
      </div>
      <p className="px-5 py-2 text-xs text-gray-400 border-t border-gray-50">
        Al despachar contra un pedido, lo que salga se descuenta solo de lo que
        pidieron. Si no vas a mandar algo, ciérralo con una razón.
      </p>
    </div>
  );
}

/**
 * "Mis pedidos" del LOCAL: lo que pidió y todavía espera.
 *
 * Fuera de las pestañas, como los envíos por recibir: es algo que está pasando
 * ahora, no información para consultar.
 */
export function MisPedidos({ pedidos, onAbrir }) {
  if (!pedidos || pedidos.length === 0) return null;

  return (
    <div className="border border-blue-200 bg-blue-50/60 rounded-2xl overflow-hidden mb-3">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-blue-100">
        <ClipboardList size={15} className="text-blue-600" />
        <p className="text-sm font-semibold text-blue-900">
          {pedidos.length} pedido{pedidos.length > 1 ? 's' : ''} esperando a la bodega
        </p>
      </div>
      <div className="bg-white/70">
        {pedidos.map((p) => <FilaPedido key={p.id} p={p} onAbrir={onAbrir} />)}
      </div>
      <p className="px-4 py-2 text-xs text-blue-700 border-t border-blue-100">
        <CheckCircle size={11} className="inline -mt-0.5" />{' '}
        Pedir no mueve tu inventario ni tu cuenta: eso pasa cuando recibes el envío.
      </p>
    </div>
  );
}
