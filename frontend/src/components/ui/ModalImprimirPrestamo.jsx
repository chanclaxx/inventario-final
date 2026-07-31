// src/components/ui/ModalImprimirPrestamo.jsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal }   from './Modal';
import { Spinner } from './Spinner';
import { Printer, FileDown, Share2, Loader2 } from 'lucide-react';
import useImprimirPrestamo from '../../hooks/useImprimirPrestamo';
import api from '../../api/axios.config';
import {
  getDocumentoPrestamo, descargarPdfAvisoMoraPrestamo, descargarPdfPazYSalvoPrestamo,
} from '../../api/prestamos.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import {
  DocumentoTermico, EncabezadoNegocio, Divisor, Fila, Firma,
} from '../documentos/DocumentoTermico';
import {
  EstadoObligacionTermico, HistorialAbonosTermico, CondicionesTermico,
} from '../documentos/BloqueObligacionTermico';
import { ModalDocumentosObligacion } from '../documentos/ModalDocumentosObligacion';

// ─── Comprobante de préstamo en ticket térmico ────────────────────────────────
//
// Antes esto era una vista previa en pantalla que llamaba a window.print() sobre
// toda la página: salía el layout de la app, no un ticket. Ahora usa la misma
// base térmica que la factura y el recibo de abono, y las mismas cifras que el
// PDF (el `resumen` que calcula el backend).

function PrestamoTermico({ prestamo, persona, resumen, descripcion, config, onClose }) {
  return (
    <DocumentoTermico
      id="prestamo-termico"
      config={config}
      tituloModal="Comprobante listo para imprimir"
      descripcionModal="Se enviará a la impresora térmica."
      onClose={onClose}
    >
      {({ fuenteSize }) => (
        <>
          <EncabezadoNegocio config={config} titulo="COMPROBANTE DE PRÉSTAMO" fuenteSize={fuenteSize} />

          <Fila label="No." valor={`#${String(resumen.numero).padStart(6, '0')}`} />
          <Fila label="Fecha:" valor={formatFechaHora(prestamo.fecha)} />
          <Fila label="Emitido:" valor={formatFechaHora(new Date())} />

          <Divisor />

          <div className="negrita">PRESTATARIO</div>
          <Fila label="Nombre:" valor={persona?.nombre || prestamo.prestatario} />
          {persona?.cedula && persona.cedula !== 'COMPANERO' && (
            <Fila label="CC:" valor={persona.cedula} />
          )}
          {persona?.celular && persona.celular !== '0000000000' && (
            <Fila label="Tel:" valor={persona.celular} />
          )}
          {prestamo.empleado_nombre && (
            <Fila label="Empleado:" valor={prestamo.empleado_nombre} />
          )}

          <Divisor />

          <div className="negrita">ARTÍCULO PRESTADO</div>
          <div className="negrita">{prestamo.nombre_producto}</div>
          {prestamo.imei && <div style={{ fontSize: '9px' }}>IMEI: {prestamo.imei}</div>}
          {!prestamo.imei && Number(prestamo.cantidad_prestada) > 1 && (
            <Fila label="Cantidad:" valor={String(prestamo.cantidad_prestada)} />
          )}
          {descripcion && descripcion !== prestamo.nombre_producto && (
            <div className="suave" style={{ fontSize: '11px' }}>{descripcion}</div>
          )}

          <EstadoObligacionTermico resumen={resumen} fuenteSize={fuenteSize} />
          <HistorialAbonosTermico  resumen={resumen} />
          <CondicionesTermico      resumen={resumen} />

          <Divisor />

          <div className="centrado" style={{ fontSize: '11px' }}>
            {resumen.pagada
              ? 'Préstamo cancelado en su totalidad. Gracias.'
              : 'Este comprobante es válido como constancia del préstamo.'}
          </div>

          <Firma
            titulo={resumen.fecha_limite ? 'Firma de aceptación' : 'Firma de recibido'}
            identificacion={[persona?.nombre || prestamo.prestatario,
              persona?.cedula && persona.cedula !== 'COMPANERO' ? `C.C. ${persona.cedula}` : null]
              .filter(Boolean).join(' · ')}
          />
          <div style={{ height: '10mm' }} />
        </>
      )}
    </DocumentoTermico>
  );
}

// ─── Modal selector de documentos ─────────────────────────────────────────────

export function ModalImprimirPrestamo({ prestamo, onClose }) {
  const { descargando, descargarPdf, compartirPdf } = useImprimirPrestamo();
  const [vista, setVista] = useState('menu'); // 'menu' | 'comprobante' | 'pos'

  // Resumen y persona: los mismos que imprime el PDF.
  const { data: doc, isLoading } = useQuery({
    queryKey: ['documento-obligacion', prestamo.id],
    queryFn:  () => getDocumentoPrestamo(prestamo.id).then((r) => r.data.data),
    enabled:  !!prestamo.id,
    staleTime: 0,
  });
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });

  if (vista === 'pos') {
    return (
      <PrestamoTermico
        prestamo={prestamo}
        persona={doc?.persona}
        resumen={doc?.resumen}
        descripcion={doc?.descripcion}
        config={config}
        onClose={onClose}
      />
    );
  }

  if (vista === 'comprobante') {
    return (
      <Modal open onClose={onClose} title="Imprimir comprobante" size="sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500 text-center">
            ¿Cómo deseas imprimir el comprobante?
          </p>

          <button
            onClick={() => setVista('pos')}
            disabled={!doc?.resumen}
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200
              hover:border-blue-300 hover:bg-blue-50/30 transition-all text-left group
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0
              group-hover:bg-blue-200 transition-colors">
              {isLoading ? <Loader2 size={20} className="text-blue-600 animate-spin" />
                         : <Printer size={20} className="text-blue-600" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Impresora POS</p>
              <p className="text-xs text-gray-400">
                Ticket térmico con saldo, historial de abonos y condiciones
              </p>
            </div>
          </button>

          <button
            onClick={() => descargarPdf(prestamo.id, prestamo.numero ?? prestamo.id)}
            disabled={descargando}
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200
              hover:border-purple-300 hover:bg-purple-50/30 transition-all text-left group
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0
              group-hover:bg-purple-200 transition-colors">
              {descargando ? <Loader2 size={20} className="text-purple-600 animate-spin" />
                           : <FileDown size={20} className="text-purple-600" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Formato PDF</p>
              <p className="text-xs text-gray-400">Documento A4 con la misma información</p>
            </div>
          </button>

          {typeof navigator !== 'undefined' && navigator.share && (
            <button
              onClick={() => compartirPdf(prestamo.id, prestamo.prestatario, prestamo.numero ?? prestamo.id)}
              disabled={descargando}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl
                text-sm font-medium border-2 border-dashed border-green-300
                text-green-700 bg-green-50 hover:bg-green-100 transition-colors
                disabled:opacity-50"
            >
              <Share2 size={15} /> Compartir (WhatsApp, Telegram…)
            </button>
          )}

          <button onClick={() => setVista('menu')}
            className="w-full py-2 rounded-xl border border-gray-200 text-gray-500 text-sm
              hover:bg-gray-50 transition-colors">
            Volver
          </button>
        </div>
      </Modal>
    );
  }

  // ── Menú: comprobante + aviso de mora / paz y salvo ───────────────────────
  if (isLoading) {
    return (
      <Modal open onClose={onClose} title="Documentos del préstamo" size="sm">
        <Spinner className="py-10" />
      </Modal>
    );
  }

  const tarjetaComprobante = (
    <button
      onClick={() => setVista('comprobante')}
      className="rounded-xl border border-blue-200 bg-blue-50 p-3 flex items-start gap-2.5 text-left
        hover:shadow-sm transition-all">
      <Printer size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-blue-700">Comprobante de préstamo</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-snug">
          Artículo, estado de la deuda, historial de abonos y condiciones. POS o PDF.
          {doc?.resumen && ` Saldo ${formatCOP(doc.resumen.saldo)}.`}
        </p>
      </div>
    </button>
  );

  return (
    <ModalDocumentosObligacion
      id={prestamo.id}
      config={config}
      onClose={onClose}
      extra={tarjetaComprobante}
      api={{
        getDocumento: getDocumentoPrestamo,
        pdfAvisoMora: descargarPdfAvisoMoraPrestamo,
        pdfPazYSalvo: descargarPdfPazYSalvoPrestamo,
      }}
    />
  );
}

export default ModalImprimirPrestamo;
