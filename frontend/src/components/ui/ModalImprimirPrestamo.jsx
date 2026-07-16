// src/components/ui/ModalImprimirPrestamo.jsx
import { useState } from 'react';
import { Modal }   from './Modal';
import { Button }  from './Button';
import { Printer, FileDown, Share2 } from 'lucide-react';
import useImprimirPrestamo from '../../hooks/useImprimirPrestamo';

// ─── Componente POS térmico para préstamo ─────────────────────────────────────

function PrestamoTermico({ prestamo, abonos, onClose }) {
  const formatCOP = (v) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v) || 0);

  const formatFecha = (f) => {
    if (!f) return '—';
    return new Date(f).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Bogota' });
  };

  const saldo = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full flex flex-col gap-3 overflow-hidden">
        {/* Header */}
        <div className="bg-[#1E3A5F] px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-white font-bold text-sm">Comprobante de Préstamo</p>
            <p className="text-blue-300 text-xs mt-0.5">#{String(prestamo.numero ?? prestamo.id).padStart(6, '0')}</p>
          </div>
          <span className={`text-xs font-bold px-3 py-1 rounded-full
            ${prestamo.estado === 'Saldado' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
            {prestamo.estado}
          </span>
        </div>

        <div className="px-5 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
          {/* Prestatario */}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400">Prestatario</p>
            <p className="text-sm font-semibold text-gray-800">{prestamo.prestatario}</p>
            {prestamo.empleado_nombre && (
              <p className="text-xs text-blue-500">Empleado: {prestamo.empleado_nombre}</p>
            )}
            {prestamo.cedula && prestamo.cedula !== 'COMPANERO' && (
              <p className="text-xs text-gray-500">CC: {prestamo.cedula}</p>
            )}
          </div>

          {/* Producto */}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400">Producto</p>
            <p className="text-sm font-semibold text-gray-800">{prestamo.nombre_producto}</p>
            {prestamo.imei && <p className="text-xs text-gray-400 font-mono">{prestamo.imei}</p>}
            <p className="text-xs text-gray-400">{formatFecha(prestamo.fecha)}</p>
          </div>

          {/* Abonos */}
          {abonos?.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-gray-500 uppercase">Abonos</p>
              {abonos.map((a) => {
                const abonoId = a.id;
                return (
                  <div key={abonoId} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-gray-500">{formatFecha(a.fecha)}</span>
                    <span className="text-xs font-semibold text-blue-600">+ {formatCOP(a.valor)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Totales */}
          <div className="bg-blue-50 rounded-xl p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Valor préstamo</span>
              <span className="font-medium text-gray-800">{formatCOP(prestamo.valor_prestamo)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Total abonado</span>
              <span className="font-medium text-green-700">{formatCOP(prestamo.total_abonado)}</span>
            </div>
            <div className="border-t border-blue-200 pt-1.5 flex justify-between">
              <span className="text-sm font-bold text-gray-700">Saldo pendiente</span>
              <span className={`text-sm font-bold ${saldo > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {formatCOP(saldo)}
              </span>
            </div>
          </div>
        </div>

        <div className="px-5 pb-4">
          <button onClick={() => { window.print(); onClose(); }}
            className="w-full py-2.5 rounded-xl bg-[#1E3A5F] text-white text-sm font-medium
              hover:bg-[#1e4a7f] transition-colors mb-2">
            Imprimir ahora
          </button>
          <button onClick={onClose}
            className="w-full py-2 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal selector POS / PDF ─────────────────────────────────────────────────

export function ModalImprimirPrestamo({ prestamo, abonos, onClose }) {
  const { descargando, descargarPdf, compartirPdf } = useImprimirPrestamo();
  const [mostrarPos, setMostrarPos] = useState(false);

  if (mostrarPos) {
    return (
      <PrestamoTermico
        prestamo={prestamo}
        abonos={abonos}
        onClose={() => { setMostrarPos(false); onClose(); }}
      />
    );
  }

  return (
    <Modal open onClose={onClose} title="Imprimir préstamo" size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-500 text-center">
          ¿Cómo deseas imprimir el comprobante?
        </p>

        {/* Opción POS */}
        <button
          onClick={() => setMostrarPos(true)}
          className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200
            hover:border-blue-300 hover:bg-blue-50/30 transition-all text-left group"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0
            group-hover:bg-blue-200 transition-colors">
            <Printer size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Impresora POS</p>
            <p className="text-xs text-gray-400">Comprobante para impresora térmica</p>
          </div>
        </button>

        {/* Opción PDF */}
        <button
          onClick={() => descargarPdf(prestamo.id, prestamo.numero ?? prestamo.id)}
          disabled={descargando}
          className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200
            hover:border-green-300 hover:bg-green-50/30 transition-all text-left group
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0
            group-hover:bg-green-200 transition-colors">
            <FileDown size={20} className="text-green-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Descargar PDF</p>
            <p className="text-xs text-gray-400">Documento PDF completo con abonos</p>
          </div>
        </button>

        {/* Opción compartir (móvil) */}
        {navigator.canShare && (
          <button
            onClick={() => compartirPdf(prestamo.id, prestamo.numero ?? prestamo.id)}
            disabled={descargando}
            className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200
              hover:border-purple-300 hover:bg-purple-50/30 transition-all text-left group
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0
              group-hover:bg-purple-200 transition-colors">
              <Share2 size={20} className="text-purple-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Compartir PDF</p>
              <p className="text-xs text-gray-400">Enviar por WhatsApp, correo u otra app</p>
            </div>
          </button>
        )}

        <Button variant="secondary" className="w-full" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </Modal>
  );
}