import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatCOP, formatFechaHora } from '../utils/formatters';

// ─── Contenido de impresión ───────────────────────────────────────────────────

function ContenidoRecepcion({ orden, config }) {
  return (
    <div id="recibo-recepcion">
      {/* Encabezado negocio */}
      <div className="rr-centrado negrita" style={{ fontSize: '14px' }}>
        {config?.nombre_negocio || 'MI TIENDA'}
      </div>
      {config?.nit       && <div className="rr-centrado">NIT: {config.nit}</div>}
      {config?.direccion && <div className="rr-centrado">{config.direccion}</div>}
      {config?.telefono  && <div className="rr-centrado">Tel: {config.telefono}</div>}

      <div className="rr-divisor" />

      <div className="rr-centrado negrita">RECIBO DE RECEPCIÓN</div>
      <div className="rr-centrado negrita">ORDEN DE SERVICIO</div>
      <div className="rr-fila" style={{ marginTop: '4px' }}>
        <span>Orden:</span>
        <span>#OS-{String(orden.id).padStart(4, '0')}</span>
      </div>
      <div className="rr-fila">
        <span>Fecha:</span>
        <span>{formatFechaHora(orden.fecha_recepcion || orden.creado_en || new Date())}</span>
      </div>

      <div className="rr-divisor" />

      {/* Cliente */}
      <div className="negrita">CLIENTE</div>
      <div className="rr-fila">
        <span>Nombre:</span>
        <span style={{ maxWidth: '55mm', textAlign: 'right' }}>{orden.cliente_nombre}</span>
      </div>
      {orden.cliente_cedula && (
        <div className="rr-fila"><span>CC:</span><span>{orden.cliente_cedula}</span></div>
      )}
      {orden.cliente_telefono && (
        <div className="rr-fila"><span>Tel:</span><span>{orden.cliente_telefono}</span></div>
      )}

      <div className="rr-divisor" />

      {/* Equipo */}
      <div className="negrita">EQUIPO RECIBIDO</div>
      {orden.equipo_tipo && (
        <div className="rr-fila"><span>Tipo:</span><span>{orden.equipo_tipo}</span></div>
      )}
      {orden.equipo_nombre && (
        <div className="rr-fila">
          <span>Producto:</span>
          <span style={{ maxWidth: '50mm', textAlign: 'right' }}>{orden.equipo_nombre}</span>
        </div>
      )}
      {orden.equipo_serial && (
        <div className="rr-fila"><span>Serial/IMEI:</span><span>{orden.equipo_serial}</span></div>
      )}

      <div className="rr-divisor" />

      {/* Falla */}
      <div className="negrita">FALLA REPORTADA</div>
      <div style={{ margin: '3px 0', whiteSpace: 'pre-wrap' }}>
        {orden.falla_reportada}
      </div>

      {/* Costo estimado */}
      {orden.costo_estimado && Number(orden.costo_estimado) > 0 && (
        <>
          <div className="rr-divisor" />
          <div className="rr-fila">
            <span>Costo estimado:</span>
            <span className="negrita">{formatCOP(Number(orden.costo_estimado))}</span>
          </div>
          <div style={{ fontSize: '10px', marginTop: '2px' }}>
            * El precio final puede variar según el diagnóstico
          </div>
        </>
      )}

      <div className="rr-divisor" />

      {/* Aviso importante */}
      <div className="rr-centrado negrita" style={{ fontSize: '11px', margin: '4px 0' }}>
        IMPORTANTE
      </div>
      <div style={{ fontSize: '10px', lineHeight: '1.5', textAlign: 'justify' }}>
        Conserve este recibo para reclamar su equipo.
        No se entregan equipos sin presentar este
        comprobante o documento de identidad del
        titular.
      </div>

      <div className="rr-divisor" />

      {/* Firmas */}
      <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '10px' }}>
        Firma cliente: ___________________________
      </div>
      <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '10px' }}>
        Firma técnico: ___________________________
      </div>
      <div style={{ height: '10mm' }} />
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ReciboRecepcion({ orden, config = {}, onClose }) {
  const yaImprimio = useRef(false);
  const [portalContainer] = useState(() => {
    const el = document.createElement('div');
    el.id = 'recibo-recepcion-portal';
    return el;
  });

  useEffect(() => {
    document.body.appendChild(portalContainer);
    return () => {
      document.body.removeChild(portalContainer);
    };
  }, [portalContainer]);

  useEffect(() => {
    if (yaImprimio.current || !orden) return;
    yaImprimio.current = true;
    const timer = setTimeout(() => {
      window.print();
    }, 300);
    return () => clearTimeout(timer);
  }, [orden]);

  if (!orden) return null;

  const escala     = Number(config.impresion_escala      || 1.5);
  const anchoPapel = Number(config.impresion_ancho_papel || 80);
  const fuenteSize = Number(config.impresion_fuente_size || 13);
  const padding    = Number(config.impresion_padding     || 2);

  const anchoPapelStr = `${anchoPapel}mm`;
  const fuenteSizeStr = `${fuenteSize}px`;
  const paddingStr    = `${padding}mm`;

  return createPortal(
    <>
      <style>{`
        #recibo-recepcion-portal #recibo-recepcion,
        #recibo-recepcion-portal #recibo-recepcion * {
          color: #000000 !important;
          font-weight: 600;
          -webkit-font-smoothing: none;
          font-smoothing: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        #recibo-recepcion-portal #recibo-recepcion {
          width: ${anchoPapelStr};
          font-family: 'Courier New', monospace;
          font-size: ${fuenteSizeStr};
          padding: ${paddingStr};
          box-sizing: border-box;
        }

        #recibo-recepcion-portal .negrita { font-weight: 900 !important; }
        #recibo-recepcion-portal .rr-divisor  { border-top: 1.5px solid #000; margin: 5px 0; }
        #recibo-recepcion-portal .rr-centrado { text-align: center; }
        #recibo-recepcion-portal .rr-fila     { display: flex; justify-content: space-between; margin: 3px 0; gap: 4px; }
        #recibo-recepcion-portal .rr-fila span:last-child { text-align: right; flex-shrink: 0; max-width: 45mm; word-break: break-word; }

        @media print {
          @page {
            margin: 0;
            size: ${anchoPapelStr} auto;
          }
          body > * {
            display: none !important;
          }
          body > #recibo-recepcion-portal {
            display: block !important;
          }
          #recibo-recepcion-portal #recibo-recepcion {
            position: static;
            width: ${anchoPapelStr};
            padding: ${paddingStr};
            font-size: ${fuenteSizeStr};
            font-family: 'Courier New', monospace;
            transform: scale(${escala});
            transform-origin: top left;
          }
          #recibo-recepcion-portal .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Overlay pantalla */}
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center no-print">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
          <h2 className="font-bold text-gray-900">Recibo de recepción</h2>
          <p className="text-sm text-gray-500">Se imprimirá el comprobante para el cliente.</p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-gray-100 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              Cerrar
            </button>
            <button
              onClick={() => window.print()}
              className="flex-1 py-2 bg-blue-600 rounded-xl text-sm font-medium text-white hover:bg-blue-700"
            >
              Reimprimir
            </button>
          </div>
        </div>
      </div>

      <ContenidoRecepcion orden={orden} config={config} />
    </>,
    portalContainer
  );
}