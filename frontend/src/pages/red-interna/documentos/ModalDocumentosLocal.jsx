import { useState } from 'react';
import { FileText, LayoutList, Download, Share2, Loader2, ChevronRight } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { formatCOP } from '../../../utils/formatters';
import useExportarPdfRedInterna from '../../../hooks/useExportarPdfRedInterna';
import { ModalEnviosPendientes } from './ModalEnviosPendientes';

// ─────────────────────────────────────────────────────────────────────────────
// Los documentos de la CUENTA de un local, en un solo botón — como «Exportar
// PDF» de préstamos (ModalExportarCuenta): una tarjeta por documento que dice
// qué trae antes de pedirlo. Aquí además cada tarjeta muestra la cifra que va
// a salir (cuánto debe, cuántos envíos), para no generar un PDF a ciegas.
//
// Las cifras de las tarjetas vienen del estado de cuenta que la pantalla ya
// tiene cargado: el PDF sale de las MISMAS funciones del backend, así que
// dicen lo mismo.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR = {
  blue:   { border: 'border-blue-200',   bg: 'bg-blue-50',   text: 'text-blue-700',   icon: 'text-blue-500'   },
  purple: { border: 'border-purple-200', bg: 'bg-purple-50', text: 'text-purple-700', icon: 'text-purple-500' },
};

/**
 * @param {object} props
 * @param {number} props.sucursalId
 * @param {string} props.nombreLocal
 * @param {object} props.data   estado de cuenta ya cargado (totales, envios, extracto)
 */
export function ModalDocumentosLocal({ sucursalId, nombreLocal, data, onClose }) {
  const { exportando, error, exportar, puedeCompartir } = useExportarPdfRedInterna();
  const [pendientes, setPendientes] = useState(false);

  const t = data?.totales || {};
  const conSaldo = (data?.envios || [])
    .filter((e) => Number(e.saldo) > 0 || Number(e.mora?.pendiente || 0) > 0).length;
  const cargos = (data?.cargos || []).filter((c) => Number(c.saldo) > 0).length;
  const movimientos = (data?.extracto || []).length;
  const deuda = Number(t.deuda_total || 0);
  const aFavor = Number(t.saldo_a_favor || 0);
  // La mora de los envíos vencidos: va aparte de la deuda de mercancía y se
  // suma en lo que el local tiene que entregar.
  const mora = Number(t.mora_pendiente || 0);

  const opciones = [
    {
      id: 'pendientes', Icn: FileText, color: 'blue',
      titulo: 'Envíos pendientes de pago',
      descripcion: 'Cada envío con saldo: sus productos, abonos y lo que falta. Más los cargos y lo que va en camino. Para cobrarle al local.',
      cifra: deuda + mora > 0
        ? `Debe ${formatCOP(deuda + mora)}${mora > 0 ? ` (con ${formatCOP(mora)} de mora)` : ''} · ${conSaldo} envío(s)${cargos ? ` · ${cargos} cargo(s)` : ''}`
        : 'Al día: no debe nada',
      abre: true,
      pdf: {
        ruta: `/red-interna/envios-activos/${sucursalId}/pdf`,
        nombreArchivo: `envios-pendientes-${nombreLocal}.pdf`,
        titulo: `Envíos pendientes · ${nombreLocal}`,
        texto: `Envíos pendientes de pago de ${nombreLocal}`,
      },
    },
    {
      id: 'cuenta', Icn: LayoutList, color: 'purple',
      titulo: 'Estado de cuenta',
      descripcion: 'Todos los movimientos en orden —envíos, pagos, devoluciones, gastos y ajustes— con el saldo acumulado. El historial completo.',
      cifra: `${movimientos}${movimientos >= 300 ? '+' : ''} movimiento(s) · saldo ${aFavor > 0 ? `a favor ${formatCOP(aFavor)}` : formatCOP(deuda)}`,
      pdf: {
        ruta: `/red-interna/estado-cuenta/${sucursalId}/pdf`,
        nombreArchivo: `estado-cuenta-${nombreLocal}.pdf`,
        titulo: `Estado de cuenta · ${nombreLocal}`,
        texto: `Estado de cuenta de ${nombreLocal} con la bodega`,
      },
    },
  ];

  if (pendientes) {
    return (
      <ModalEnviosPendientes
        sucursalId={sucursalId} nombreLocal={nombreLocal}
        envios={data?.envios || []} cargos={data?.cargos || []}
        deuda={deuda} aFavor={aFavor} mora={mora}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal open onClose={onClose} title="Documentos de la cuenta" size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-gray-400">
          Cuenta de <span className="font-semibold text-gray-600">{nombreLocal}</span> con la bodega
        </p>

        {opciones.map((op) => {
          const Icn = op.Icn;
          const c = COLOR[op.color];
          return (
            <div key={op.id} className={`rounded-xl border ${c.border} ${c.bg} overflow-hidden`}>
              <button type="button" disabled={exportando}
                onClick={() => (op.abre ? setPendientes(true) : exportar(op.pdf, 'descargar'))}
                className="w-full flex items-start gap-3 p-4 text-left hover:brightness-[0.98] disabled:opacity-60 disabled:cursor-not-allowed">
                <div className={`mt-0.5 flex-shrink-0 ${c.icon}`}>
                  {exportando ? <Loader2 size={20} className="animate-spin" /> : <Icn size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${c.text}`}>{op.titulo}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug">{op.descripcion}</p>
                  <p className={`text-xs font-medium mt-1.5 ${c.text}`}>{op.cifra}</p>
                </div>
                {op.abre
                  ? <ChevronRight size={16} className={`mt-1 flex-shrink-0 ${c.icon} opacity-70`} />
                  : <Download size={14} className={`mt-1 flex-shrink-0 ${c.icon} opacity-60`} />}
              </button>
              {puedeCompartir && !op.abre && (
                <button type="button" disabled={exportando} onClick={() => exportar(op.pdf, 'compartir')}
                  className={`w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-t ${c.border}
                    ${c.text} bg-white/60 hover:bg-white disabled:opacity-60`}>
                  <Share2 size={13} /> Compartir
                </button>
              )}
            </div>
          );
        })}

        {error && <p className="text-xs text-red-500 text-center">{error}</p>}

        <button onClick={onClose}
          className="mt-1 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50 transition-colors border border-gray-200">
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
