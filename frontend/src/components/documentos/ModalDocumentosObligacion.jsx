import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal }   from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { Printer, FileDown, Loader2, AlertTriangle, CheckCircle, FileText } from 'lucide-react';
import { AvisoMoraTermico }  from './AvisoMoraTermico';
import { PazYSalvoTermico }  from './PazYSalvoTermico';
import { formatCOP } from '../../utils/formatters';

/**
 * Selector de documentos de una obligación (crédito o préstamo).
 *
 * Un solo sitio decide QUÉ documentos proceden y en qué formato, para créditos y
 * préstamos por igual:
 *   · Aviso de mora  → solo si la obligación está vencida.
 *   · Paz y salvo    → solo si el saldo está en cero.
 * Las mismas reglas se validan otra vez en el backend, que es donde mandan.
 *
 * @param {object}   api      { getDocumento, pdfAvisoMora, pdfPazYSalvo }
 * @param {number}   id       id del crédito o del préstamo
 * @param {object}   config   config_negocio (parámetros de impresión)
 * @param {node}     [extra]  documentos propios del módulo (ej. la factura)
 */
export function ModalDocumentosObligacion({ api, id, config = {}, onClose, extra = null }) {
  const [pos,      setPos]      = useState(null);   // 'mora' | 'paz'
  const [cargando, setCargando] = useState(null);
  const [error,    setError]    = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['documento-obligacion', id],
    queryFn:  () => api.getDocumento(id).then((r) => r.data.data),
    enabled:  !!id,
    staleTime: 0,
  });

  const resumen     = data?.resumen;
  const persona     = data?.persona;
  const descripcion = data?.descripcion;

  const descargar = async (tipo) => {
    setError('');
    setCargando(`${tipo}-pdf`);
    try {
      const fn  = tipo === 'mora' ? api.pdfAvisoMora : api.pdfPazYSalvo;
      const res = await fn(id);
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement('a');
      a.href = url;
      a.download = `${tipo === 'mora' ? 'aviso-mora' : 'paz-y-salvo'}-${resumen?.numero ?? id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo generar el documento.');
    } finally {
      setCargando(null);
    }
  };

  // ── Impresión POS ─────────────────────────────────────────────────────────
  if (pos === 'mora') {
    return (
      <AvisoMoraTermico
        persona={persona} resumen={resumen} descripcion={descripcion}
        config={config} onClose={onClose}
      />
    );
  }
  if (pos === 'paz') {
    return (
      <PazYSalvoTermico
        persona={persona} resumen={resumen} descripcion={descripcion}
        config={config} onClose={onClose}
      />
    );
  }

  const documentos = [];
  if (resumen?.vencido) {
    documentos.push({
      id:     'mora',
      Icn:    AlertTriangle,
      titulo: 'Aviso de mora',
      detalle: `${resumen.dias_atraso} día(s) de atraso · total a pagar `
        + `${formatCOP(resumen.saldo + Number(resumen.mora?.pendiente || 0))}`,
      clase:  'border-red-200 bg-red-50 text-red-700',
      icono:  'text-red-500',
    });
  }
  if (resumen?.pagada) {
    documentos.push({
      id:     'paz',
      Icn:    CheckCircle,
      titulo: 'Paz y salvo',
      detalle: `Obligación cancelada · ${resumen.num_abonos} abono(s) por `
        + `${formatCOP(resumen.total_abonado)}`,
      clase:  'border-green-200 bg-green-50 text-green-700',
      icono:  'text-green-500',
    });
  }

  return (
    <Modal open onClose={onClose} title="Documentos de la obligación" size="sm">
      {isLoading ? <Spinner className="py-10" /> : (
        <div className="flex flex-col gap-3">

          {resumen && (
            <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">
                  #{String(resumen.numero).padStart(6, '0')} · {persona?.nombre}
                </p>
                <p className="text-xs text-gray-400">
                  Saldo {formatCOP(resumen.saldo)} · {resumen.num_abonos} abono(s)
                </p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                resumen.estado_tono === 'verde'   ? 'bg-green-100 text-green-700'  :
                resumen.estado_tono === 'rojo'    ? 'bg-red-100 text-red-700'      :
                resumen.estado_tono === 'naranja' ? 'bg-amber-100 text-amber-700'  :
                resumen.estado_tono === 'azul'    ? 'bg-blue-100 text-blue-700'    :
                'bg-gray-100 text-gray-600'
              }`}>
                {resumen.estado_label}
              </span>
            </div>
          )}

          {/* Documentos propios del módulo (la factura, el comprobante…) */}
          {extra}

          {documentos.map((d) => (
            <div key={d.id} className={`rounded-xl border p-3 flex flex-col gap-2.5 ${d.clase}`}>
              <div className="flex items-start gap-2.5">
                <d.Icn size={18} className={`flex-shrink-0 mt-0.5 ${d.icono}`} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{d.titulo}</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug">{d.detalle}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPos(d.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
                    text-xs font-medium bg-white border border-gray-200 text-gray-700
                    hover:bg-gray-50 transition-colors">
                  <Printer size={13} /> Imprimir POS
                </button>
                <button
                  onClick={() => descargar(d.id)}
                  disabled={!!cargando}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg
                    text-xs font-medium bg-white border border-gray-200 text-gray-700
                    hover:bg-gray-50 transition-colors disabled:opacity-50">
                  {cargando === `${d.id}-pdf`
                    ? <Loader2 size={13} className="animate-spin" />
                    : <FileDown size={13} />}
                  Descargar PDF
                </button>
              </div>
            </div>
          ))}

          {documentos.length === 0 && !extra && (
            <div className="flex items-start gap-2 bg-gray-50 rounded-xl px-3 py-3">
              <FileText size={15} className="text-gray-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-500 leading-snug">
                Esta obligación está al día y aún tiene saldo pendiente, así que no procede
                ni un aviso de mora ni un paz y salvo. Estos documentos aparecen cuando la
                deuda se vence o cuando queda saldada.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-500 text-center">{error}</p>}

          <button
            onClick={onClose}
            className="mt-1 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-50
              transition-colors border border-gray-200">
            Cerrar
          </button>
        </div>
      )}
    </Modal>
  );
}
