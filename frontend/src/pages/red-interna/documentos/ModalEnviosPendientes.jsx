import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, FileDown, Share2, Loader2, ChevronRight, Receipt, Truck } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import api from '../../../api/axios.config';
import { formatCOP, formatFecha, formatFechaHora } from '../../../utils/formatters';
import useExportarPdfRedInterna from '../../../hooks/useExportarPdfRedInterna';
import {
  DocumentoTermico, EncabezadoNegocio, Divisor, Fila, Firma,
} from '../../../components/documentos/DocumentoTermico';
import { ModalDocumentoEnvio } from './ModalDocumentoEnvio';

// ─────────────────────────────────────────────────────────────────────────────
// LOS ENVÍOS QUE FALTAN POR PAGAR de un local — como «Préstamos activos».
//
// Primero se ve la lista: cada envío con saldo (fecha, cargo, abonado, saldo),
// los cargos sueltos y el total. Tocar un envío abre SU documento (POS, PDF o
// compartir). Abajo, el documento de todos juntos: ticket de cobro en la
// impresora POS, PDF A4 o compartir.
//
// Todo sale del estado de cuenta que la pantalla ya tiene cargado (el mismo que
// arma el PDF en el backend), así que las cifras no pueden discrepar. El total
// es el de los totales del local, no la suma de la lista: la lista viene topada
// y sumarla daría menos de lo que se debe.
// ─────────────────────────────────────────────────────────────────────────────

const n = (v) => Number(v || 0);
const numeroDe = (e) => e?.numero ?? e?.id;

// Lo que se debe de UN envío: su mercancía y su mora (la calcula el backend).
const debeEnvio = (e) => n(e.saldo) + n(e.mora?.pendiente);
const fechaDMA = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

function PendientesTermico({ nombreLocal, envios, cargos, deuda, aFavor, mora = 0, config, onClose }) {
  return (
    <DocumentoTermico
      id="envios-pendientes-termico"
      config={config}
      tituloModal="Cuenta de envíos lista para imprimir"
      descripcionModal="Se enviará a la impresora térmica."
      onClose={onClose}
    >
      {({ fuenteSize }) => (
        <>
          <EncabezadoNegocio config={config} titulo="ENVÍOS PENDIENTES DE PAGO" fuenteSize={fuenteSize} />
          <Fila label="Local:" valor={nombreLocal} negrita />
          <Fila label="Fecha:" valor={formatFechaHora(new Date())} />
          <Divisor />
          {envios.map((e) => (
            <div key={e.id} style={{ marginTop: '3px' }}>
              <Fila label={`Envío #${numeroDe(e)} · ${formatFecha(e.fecha_recepcion || e.fecha_emision)}`}
                valor={formatCOP(debeEnvio(e))} negrita />
              <div style={{ fontSize: '9px' }}>
                Cargo {formatCOP(e.cargo)} · abonado {formatCOP(e.abonado)}
                {` · ${(e.lineas || []).length} producto(s)`}
              </div>
              {e.mora?.aplica && (
                <div style={{ fontSize: '9px' }}>
                  {e.mora.en_mora
                    ? `VENCIDO hace ${e.mora.dias_vencidos} día(s)${n(e.mora.pendiente) > 0 ? ` · mora ${formatCOP(e.mora.pendiente)}` : ''}`
                    : `Vence ${fechaDMA(e.mora.fecha_limite)}`}
                </div>
              )}
            </div>
          ))}
          {cargos.length > 0 && (
            <>
              <Divisor />
              <div className="negrita">CARGOS</div>
              {cargos.map((c) => (
                <Fila key={c.id} label={`${formatFecha(c.fecha)} ${c.concepto || 'Cargo'}`} valor={formatCOP(c.saldo)} />
              ))}
            </>
          )}
          <Divisor />
          {mora > 0 && <Fila label="Mora por pagar tarde:" valor={formatCOP(mora)} />}
          <Fila label="TOTAL QUE DEBE:" valor={formatCOP(deuda)} negrita grande />
          {aFavor > 0 && <Fila label="Saldo a favor:" valor={formatCOP(aFavor)} />}
          <Firma titulo="Recibí el estado de cuenta" identificacion={nombreLocal} />
          <div className="centrado" style={{ fontSize: '9px', marginTop: '8px' }}>
            Documento interno entre sedes. No es factura de venta.
          </div>
          <div style={{ height: '10mm' }} />
        </>
      )}
    </DocumentoTermico>
  );
}

/**
 * @param {object} props
 * @param {number} props.sucursalId
 * @param {string} props.nombreLocal
 * @param {Array}  props.envios   envíos del estado de cuenta (se filtran los que tienen saldo)
 * @param {Array}  props.cargos
 * @param {number} props.deuda    deuda total del local (de los totales, no de la lista)
 * @param {number} [props.aFavor]
 */
export function ModalEnviosPendientes({
  sucursalId, nombreLocal, envios = [], cargos = [], deuda, aFavor = 0, mora = 0, onClose,
}) {
  const [vista, setVista] = useState('lista'); // 'lista' | 'pos'
  const [envioAbierto, setEnvioAbierto] = useState(null);
  const { exportando, error, exportar, puedeCompartir } = useExportarPdfRedInterna();
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });

  // Del más viejo al más nuevo: es el orden en que se cobran (el pago total los
  // tapa en ese mismo orden).
  // Por pagar = mercancía o mora: un envío con el producto cubierto y la mora
  // pendiente todavía se debe.
  const pendientes = envios.filter((e) => debeEnvio(e) > 0)
    .sort((a, b) => new Date(a.fecha_recepcion || a.fecha_emision) - new Date(b.fecha_recepcion || b.fecha_emision));
  const cargosPend = cargos.filter((c) => n(c.saldo) > 0);
  // `deuda` es la de la mercancía (de los totales del local); la mora va aparte.
  const total = n(deuda) + n(mora);

  if (envioAbierto) {
    return <ModalDocumentoEnvio remisionId={envioAbierto} onClose={() => setEnvioAbierto(null)} />;
  }
  if (vista === 'pos') {
    return (
      <PendientesTermico nombreLocal={nombreLocal} envios={pendientes} cargos={cargosPend}
        deuda={total} aFavor={n(aFavor)} mora={n(mora)} config={config} onClose={onClose} />
    );
  }

  const pdf = {
    ruta: `/red-interna/envios-activos/${sucursalId}/pdf`,
    nombreArchivo: `envios-pendientes-${nombreLocal}.pdf`,
    titulo: `Envíos pendientes · ${nombreLocal}`,
    texto: `Envíos pendientes de pago de ${nombreLocal}: ${formatCOP(total)}`,
  };
  const nada = pendientes.length === 0 && cargosPend.length === 0;

  return (
    <Modal open onClose={onClose} title="Envíos por pagar" size="md">
      <div className="flex flex-col gap-4">
        {/* El total arriba: es lo primero que se pregunta. */}
        <div className={`rounded-xl px-4 py-3 flex items-center justify-between
          ${total > 0 ? 'bg-red-50 border border-red-100' : 'bg-green-50 border border-green-100'}`}>
          <div>
            <p className="text-xs text-gray-500">{nombreLocal} debe en total</p>
            <p className={`text-xl font-bold ${total > 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCOP(total)}</p>
          </div>
          <p className="text-xs text-gray-500 text-right">
            {pendientes.length} envío(s){cargosPend.length ? ` · ${cargosPend.length} cargo(s)` : ''}
            {n(mora) > 0 && <><br /><span className="text-red-600">incluye {formatCOP(mora)} de mora</span></>}
            {n(aFavor) > 0 && <><br />a favor {formatCOP(aFavor)}</>}
          </p>
        </div>

        {nada ? (
          <p className="text-sm text-gray-500 text-center py-4">No tiene envíos ni cargos pendientes de pago.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
            {pendientes.map((e) => {
              const pagado = n(e.cargo) > 0 ? Math.min(100, Math.round((n(e.abonado) / n(e.cargo)) * 100)) : 0;
              return (
                <button key={e.id} type="button" onClick={() => setEnvioAbierto(e.id)}
                  className="flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
                  <Truck size={15} className="text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">
                      Envío #{numeroDe(e)}
                      <span className="text-xs font-normal text-gray-400"> · {formatFecha(e.fecha_recepcion || e.fecha_emision)}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      Cargo {formatCOP(e.cargo)} · abonado {formatCOP(e.abonado)} · {(e.lineas || []).length} producto(s)
                    </p>
                    {e.mora?.aplica && (
                      <p className={`text-xs ${e.mora.en_mora ? 'text-red-600' : 'text-gray-400'}`}>
                        {e.mora.en_mora
                          ? `Vencido hace ${e.mora.dias_vencidos} día(s)${n(e.mora.pendiente) > 0 ? ` · mora ${formatCOP(e.mora.pendiente)}` : ''}`
                          : `Vence el ${fechaDMA(e.mora.fecha_limite)}`}
                      </p>
                    )}
                    <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${pagado}%` }} />
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-red-600 tabular-nums">{formatCOP(debeEnvio(e))}</span>
                  <ChevronRight size={15} className="text-gray-300 flex-shrink-0" />
                </button>
              );
            })}
            {cargosPend.map((c) => (
              <div key={`c${c.id}`} className="flex items-center gap-3 px-3 py-2.5">
                <Receipt size={15} className="text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.concepto || 'Cargo'}</p>
                  <p className="text-xs text-gray-500">{formatFecha(c.fecha)} · cargo aparte de la bodega</p>
                </div>
                <span className="text-sm font-semibold text-red-600 tabular-nums">{formatCOP(c.saldo)}</span>
              </div>
            ))}
          </div>
        )}
        {!nada && <p className="text-[11px] text-gray-400 -mt-2">Toca un envío para imprimir solo ese.</p>}

        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Imprimir todos</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button onClick={() => setVista('pos')} disabled={nada}
            className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-blue-300
              hover:bg-blue-50/30 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Printer size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Impresora POS</p>
              <p className="text-xs text-gray-400">Ticket de cobro con cada saldo</p>
            </div>
          </button>
          <button onClick={() => exportar(pdf, 'descargar')} disabled={exportando || nada}
            className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-purple-300
              hover:bg-purple-50/30 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed">
            <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
              {exportando ? <Loader2 size={18} className="text-purple-600 animate-spin" />
                          : <FileDown size={18} className="text-purple-600" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Formato PDF</p>
              <p className="text-xs text-gray-400">A4 con productos, abonos y saldo de cada envío</p>
            </div>
          </button>
        </div>

        {puedeCompartir && !nada && (
          <button onClick={() => exportar(pdf, 'compartir')} disabled={exportando}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium
              border-2 border-dashed border-green-300 text-green-700 bg-green-50 hover:bg-green-100
              transition-colors disabled:opacity-50">
            <Share2 size={15} /> Compartir con el local (WhatsApp, Telegram…)
          </button>
        )}

        {error && <p className="text-xs text-red-500 text-center">{error}</p>}

        <button onClick={onClose}
          className="w-full py-2 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition-colors">
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
