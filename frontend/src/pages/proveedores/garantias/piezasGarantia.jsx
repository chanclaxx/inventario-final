import { Smartphone, Package, AlertTriangle, ShieldCheck } from 'lucide-react';
import { formatCOP } from '../../../utils/formatters';
import { SEMAFORO, fechaDia, textoOrigen } from './garantiasUi';

// Piezas compartidas por los modales de garantías con proveedores.

/** El semáforo de la garantía del proveedor, con la fecha. */
export function SemaforoGarantia({ procedencia }) {
  if (!procedencia) {
    return <span className="text-[11px] text-gray-400">Sin compra registrada: no se sabe de qué proveedor vino</span>;
  }
  if (procedencia.via === 'cliente') {
    return (
      <span className="text-[11px] text-amber-700">
        Entró por compra a cliente ({procedencia.cliente_origen}): no hay proveedor a quien reclamarle
      </span>
    );
  }
  const s = SEMAFORO[procedencia.estado] || SEMAFORO.sin_garantia;
  const hasta = fechaDia(procedencia.garantia_hasta);
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md border ${s.clase}`}>
      <ShieldCheck size={11} />
      {s.texto}{hasta ? ` · ${procedencia.estado === 'vencida' ? 'venció' : 'vence'} ${hasta}` : ''}
    </span>
  );
}

/**
 * Una unidad candidata a garantía: qué es, de dónde salió y a quién se le
 * reclama. `onElegir` la vuelve un botón; con `bloqueo` no se puede elegir y
 * dice por qué.
 */
export function TarjetaCandidato({ c, elegido = false, onElegir, compacta = false }) {
  const Icono = c.tipo === 'serial' ? Smartphone : Package;
  const bloqueada = !!c.bloqueo;
  const contenido = (
    <>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
        ${bloqueada ? 'bg-gray-100' : 'bg-rose-50'}`}>
        <Icono size={17} className={bloqueada ? 'text-gray-400' : 'text-rose-600'} />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-semibold text-gray-800 truncate">
          {c.nombre_producto}
          {c.variante_texto && <span className="font-normal text-gray-500"> · {c.variante_texto}</span>}
        </p>
        {c.imei && <p className="text-xs text-gray-500 font-mono">{c.imei}</p>}
        {!compacta && c.tipo && <p className="text-xs text-gray-500 mt-0.5">{textoOrigen(c)}</p>}
        {!compacta && c.tipo === 'cantidad' && c.cantidad_max > 0 && (
          <p className="text-[11px] text-gray-400">
            {c.origen_tipo === 'inventario' ? `${c.cantidad_max} en stock` : `Hasta ${c.cantidad_max} unidad(es)`}
            {c.precio_venta ? ` · vendido a ${formatCOP(c.precio_venta)}` : ''}
          </p>
        )}
        {!compacta && c.tipo && !bloqueada && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {c.procedencia?.proveedor_nombre && (
              <span className="text-[11px] text-gray-600">
                {c.procedencia.via === 'reposicion' ? `Repuesto en la garantía #${c.procedencia.reclamo_numero} · ` : ''}
                Proveedor: <b>{c.procedencia.proveedor_nombre}</b>
                {c.procedencia.compra_numero ? ` · compra #${c.procedencia.compra_numero}` : ''}
              </span>
            )}
            <SemaforoGarantia procedencia={c.procedencia} />
          </div>
        )}
        {bloqueada && (
          <p className="text-xs text-red-600 mt-1 flex items-start gap-1">
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> {c.bloqueo}
          </p>
        )}
      </div>
    </>
  );
  if (!onElegir) {
    return <div className="flex gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">{contenido}</div>;
  }
  return (
    <button type="button" disabled={bloqueada} onClick={() => onElegir(c)}
      className={`w-full flex gap-3 p-3 rounded-xl border-2 transition-all
        ${elegido ? 'border-rose-400 bg-rose-50/40' : 'border-gray-100 hover:border-rose-200'}
        disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:border-gray-100`}>
      {contenido}
    </button>
  );
}

/** Una opción grande de radio (heurística: reconocer, no recordar). */
export function OpcionGrande({ activa, onClick, icono, titulo, descripcion, deshabilitada = false, nota = null, color = 'blue' }) {
  const Icono = icono;
  const colores = {
    blue:   { borde: 'border-blue-400 bg-blue-50/40',   icono: 'bg-blue-100 text-blue-600' },
    green:  { borde: 'border-green-400 bg-green-50/40', icono: 'bg-green-100 text-green-600' },
    amber:  { borde: 'border-amber-400 bg-amber-50/40', icono: 'bg-amber-100 text-amber-600' },
    rose:   { borde: 'border-rose-400 bg-rose-50/40',   icono: 'bg-rose-100 text-rose-600' },
    gray:   { borde: 'border-gray-400 bg-gray-50',      icono: 'bg-gray-100 text-gray-600' },
  }[color];
  return (
    <button type="button" onClick={onClick} disabled={deshabilitada}
      className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all
        ${activa ? colores.borde : 'border-gray-100 hover:border-gray-200'}
        disabled:opacity-50 disabled:cursor-not-allowed`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${colores.icono}`}>
        <Icono size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{titulo}</p>
        <p className="text-xs text-gray-500">{descripcion}</p>
        {nota && <p className="text-[11px] text-amber-700 mt-0.5">{nota}</p>}
      </div>
    </button>
  );
}

/** Los pasos de arriba del formulario. */
export function Pasos({ pasos, actual }) {
  return (
    <div className="flex items-center gap-2" aria-label="Pasos">
      {pasos.map((p, i) => {
        const hecho = i < actual;
        const activo = i === actual;
        return (
          <div key={p} className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center flex-shrink-0
              ${activo ? 'bg-rose-600 text-white' : hecho ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-400'}`}>
              {i + 1}
            </span>
            <span className={`text-xs truncate ${activo ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{p}</span>
            {i < pasos.length - 1 && <span className="flex-1 h-px bg-gray-200 hidden sm:block" />}
          </div>
        );
      })}
    </div>
  );
}
