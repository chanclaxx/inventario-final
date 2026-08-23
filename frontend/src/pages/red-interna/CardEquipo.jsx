import { formatCOP, formatFecha } from '../../utils/formatters';
import {
  ShoppingBag, HandCoins, Store, Undo2, Truck, AlertTriangle, PackageX,
  User, FileText, ArrowRight,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// UN EQUIPO DE LA BODEGA, CONTADO COMPLETO
//
// Tres preguntas en un solo card, siempre en el mismo orden:
//   1. QUÉ es          → nombre e IMEI
//   2. EN QUÉ ESTADO   → una etiqueta en palabras, con color, sin abreviar
//   3. A DÓNDE FUE     → a quién se vendió o prestó, con su documento y fecha
//
// Y una cuarta cuando algo no cuadra: si la bodega despachó "iPhone 11 Pro Max"
// y en el local el equipo quedó bajo otra referencia, se dice. El catálogo es
// por sucursal, así que la diferencia puede ser solo de escritura — o puede ser
// que se despachó el equipo equivocado. El card lo señala; decide una persona.
//
// Lo usan la página del local y el detalle de cada envío: un solo card para que
// el equipo se vea igual en toda la aplicación.
// ─────────────────────────────────────────────────────────────────────────────

const ESTILO = {
  'Por liquidar':    { Icn: ShoppingBag, punto: 'bg-amber-500',  texto: 'text-amber-700',  fondo: 'bg-amber-50'  },
  'En recaudo':      { Icn: ShoppingBag, punto: 'bg-purple-500', texto: 'text-purple-700', fondo: 'bg-purple-50' },
  'En prestamo':     { Icn: HandCoins,   punto: 'bg-blue-500',   texto: 'text-blue-700',   fondo: 'bg-blue-50'   },
  'En consignacion': { Icn: Store,       punto: 'bg-gray-300',   texto: 'text-gray-600',   fondo: 'bg-gray-50'   },
  'Devuelta':        { Icn: Undo2,       punto: 'bg-green-500',  texto: 'text-green-700',  fondo: 'bg-green-50'  },
  'En transito':     { Icn: Truck,       punto: 'bg-blue-400',   texto: 'text-blue-700',   fondo: 'bg-blue-50'   },
  'Faltante':        { Icn: PackageX,    punto: 'bg-red-500',    texto: 'text-red-700',    fondo: 'bg-red-50'    },
  'Sin ubicar':      { Icn: AlertTriangle, punto: 'bg-red-500',  texto: 'text-red-700',    fondo: 'bg-red-50'    },
  'Movida':          { Icn: AlertTriangle, punto: 'bg-red-500',  texto: 'text-red-700',    fondo: 'bg-red-50'    },
};

const POR_DEFECTO = ESTILO['En consignacion'];

// El icono del destino cambia con lo que pasó: una persona si alguien se lo
// llevó, un camión si volvió a la bodega.
const ICONO_DESTINO = { venta: User, prestamo: User, devolucion: Truck };

export function CardEquipo({ u, mostrarEnvio = true }) {
  const est = ESTILO[u.estado_unidad] || POR_DEFECTO;
  const d   = u.destino || {};
  const IconoEstado   = est.Icn;
  const IconoDestino  = ICONO_DESTINO[d.tipo];
  const cantidad = u.tipo === 'cantidad'
    ? Number(u.cantidad_recibida ?? u.cantidad ?? 0)
    : null;

  return (
    <div className="px-4 py-3 border-b border-gray-50 last:border-0">
      {/* 1 · qué es */}
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${est.fondo}`}>
          <IconoEstado size={16} className={est.texto} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {u.nombre_producto || u.producto_nombre}
            {cantidad != null && <span className="font-normal text-gray-400"> × {cantidad}</span>}
          </p>
          {u.imei && (
            <p className="text-xs text-gray-400 font-mono truncate">{u.imei}</p>
          )}

          {/* 2 · en qué estado, en palabras */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${est.punto}`} />
            <span className={`text-xs font-semibold uppercase tracking-wide ${est.texto}`}>
              {u.etiqueta_estado}
            </span>
          </div>
        </div>

        {/* Plata a la derecha — ausente para quien no puede ver costos.
            Es el valor con el que la bodega se lo cargó al local, y se muestra
            igual esté vendido o no: desde el cambio de modelo la deuda no
            depende de la venta, así que ya no hay un "por pagar" por unidad. */}
        <div className="text-right flex-shrink-0">
          {u.valor_interno != null && (
            <p className="text-sm font-semibold text-gray-500">{formatCOP(u.valor_interno)}</p>
          )}
        </div>
      </div>

      {/* 3 · a dónde fue */}
      {(d.quien || d.documento || d.nota) && (
        <div className="mt-2 ml-12 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {d.quien && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-700">
              {IconoDestino
                ? <IconoDestino size={12} className="text-gray-400" />
                : <ArrowRight size={12} className="text-gray-400" />}
              <strong className="font-medium">{d.quien}</strong>
            </span>
          )}
          {d.documento && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <FileText size={11} className="text-gray-300" /> {d.documento}
            </span>
          )}
          {d.fecha && <span className="text-xs text-gray-400">{formatFecha(d.fecha)}</span>}
          {d.nota && !d.quien && <span className="text-xs text-gray-400">{d.nota}</span>}
        </div>
      )}

      {/* Procedencia — de qué envío salió */}
      {mostrarEnvio && (u.remision_numero != null || u.remision_id != null) && (
        <p className="mt-1 ml-12 text-xs text-gray-400">
          Envío #{u.remision_numero ?? u.remision_id}
          {u.fecha_recepcion ? ` · recibido ${formatFecha(u.fecha_recepcion)}` : ''}
        </p>
      )}

      {/* 4 · la referencia no coincide entre bodega y local */}
      {u.referencia_difiere && (
        <div className="mt-2 ml-12 flex items-start gap-1.5 bg-amber-50 border border-amber-200
          rounded-lg px-2.5 py-1.5">
          <AlertTriangle size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            En bodega es <strong>{u.nombre_producto_bodega}</strong> y aquí quedó
            como <strong>{u.nombre_producto_local}</strong>. Revisa que sea el
            equipo correcto.
          </p>
        </div>
      )}
    </div>
  );
}
