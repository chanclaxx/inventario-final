import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Share2, Loader2 } from 'lucide-react';
import { getEstadoCuentaGarantias, rutaPdfEstadoCuentaGarantias } from '../../../api/garantiasProveedor.api';
import useExportarPdfGarantia from '../../../hooks/useExportarPdfGarantia';
import useSucursalStore from '../../../store/sucursalStore';
import { Modal }   from '../../../components/ui/Modal';
import { Spinner } from '../../../components/ui/Spinner';
import { formatCOP, formatFecha } from '../../../utils/formatters';
import { ESTADO_PROVEEDOR } from './garantiasUi';

// ─────────────────────────────────────────────────────────────────────────────
// Estado de cuenta de las garantías con UN proveedor: qué tiene nuestro hoy, qué
// devolvió y cuánto se recuperó, para sentarse con él (o mandárselo por
// WhatsApp). Lo abierto sale siempre, sea de cuando sea; el período filtra lo
// ya resuelto. Los números los calcula el backend; aquí solo se pintan.
// ─────────────────────────────────────────────────────────────────────────────

const hace = (dias) => {
  const d = new Date(); d.setDate(d.getDate() - dias);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
};

const respuesta = (l) => [
  Number(l.uds_repuestas) ? `repuso ${l.uds_repuestas}` : null,
  Number(l.uds_reparadas) ? `reparó ${l.uds_reparadas}` : null,
  Number(l.valor_nota_credito) ? `NC ${formatCOP(l.valor_nota_credito)}` : null,
  Number(l.valor_dinero) ? `devolvió ${formatCOP(l.valor_dinero)}` : null,
  Number(l.uds_no_cubiertas) ? `no cubrió ${l.uds_no_cubiertas}` : null,
].filter(Boolean).join(' · ');

export function ModalEstadoCuentaGarantias({ proveedor, onClose }) {
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);
  const [desde, setDesde] = useState(() => hace(90));
  const [hasta, setHasta] = useState('');
  const { exportando, error, exportar, puedeCompartir } = useExportarPdfGarantia();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['garantias-estado-cuenta', proveedor.id, sucursalActiva, desde, hasta],
    queryFn:  () => getEstadoCuentaGarantias(proveedor.id, { desde: desde || undefined, hasta: hasta || undefined })
      .then((r) => r.data.data),
  });
  const r = data?.resumen;
  const pdf = {
    ruta: rutaPdfEstadoCuentaGarantias(proveedor.id, { desde, hasta }),
    nombreArchivo: `garantias-${proveedor.nombre}.pdf`.replace(/\s+/g, '-'),
    titulo: `Garantías con ${proveedor.nombre}`,
    texto: `Estado de las garantías con ${proveedor.nombre}`,
  };

  return (
    <Modal open onClose={onClose} title={`Garantías con ${proveedor.nombre}`} size="xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Resueltas desde</span>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Hasta</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
          </label>
          <p className="text-[11px] text-gray-400 flex-1 min-w-[180px]">Lo que sigue abierto sale siempre, sea de la fecha que sea.</p>
        </div>

        {isLoading ? <Spinner className="py-8" /> : isError || !r ? (
          <p className="text-sm text-red-600 text-center py-6">No se pudo cargar el estado de cuenta.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['Tiene nuestro', `${r.por_enviar + r.afuera} ud(s)`, r.valor_afuera != null ? formatCOP(r.valor_afuera) : `${r.afuera} con él · ${r.por_enviar} por enviar`],
                ['Repuso / reparó', `${r.repuestas} / ${r.reparadas}`, 'unidades'],
                ['Recuperado', formatCOP(r.recuperado), `NC ${formatCOP(r.nota_credito)} · dinero ${formatCOP(r.dinero)}`],
                ['No cubrió', `${r.no_cubiertas} ud(s)`, r.dias_respuesta != null ? `responde en ~${r.dias_respuesta} día(s)` : 'sin respuestas aún'],
              ].map(([t, v, s]) => (
                <div key={t} className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                  <p className="text-xs text-gray-500">{t}</p>
                  <p className="text-lg font-bold text-gray-900">{v}</p>
                  <p className="text-[11px] text-gray-400 truncate">{s}</p>
                </div>
              ))}
            </div>
            <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {data.lineas.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Nada con este proveedor en el período.</p>
              ) : data.lineas.map((l) => {
                const ep = ESTADO_PROVEEDOR[l.estado_proveedor];
                return (
                  <div key={l.id} className="px-3 py-2 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{l.cantidad} × {l.nombre_producto}{l.imei ? ` · ${l.imei}` : ''}</p>
                      <p className="text-xs text-gray-500 truncate">
                        #{l.reclamo_numero} · {formatFecha(l.reclamo_fecha)} · {l.falla}
                        {l.envio_numero ? ` · envío #${l.envio_numero}` : ''}
                      </p>
                      {respuesta(l) && <p className="text-xs text-green-700">{respuesta(l)}</p>}
                    </div>
                    {ep && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border flex-shrink-0 ${ep.clase}`}>{ep.texto}</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button type="button" onClick={() => exportar(pdf, 'descargar')} disabled={exportando}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50">
            {exportando ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} Descargar PDF
          </button>
          {puedeCompartir && (
            <button type="button" onClick={() => exportar(pdf, 'compartir')} disabled={exportando}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border-2 border-dashed border-green-300 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50">
              <Share2 size={15} /> Compartir con el proveedor
            </button>
          )}
          <button type="button" onClick={onClose}
            className="py-2.5 px-4 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50">Cerrar</button>
        </div>
        {error && <p className="text-xs text-red-500 text-center">{error}</p>}
      </div>
    </Modal>
  );
}
