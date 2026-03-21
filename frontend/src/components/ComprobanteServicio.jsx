import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatCOP, formatFechaHora } from '../utils/formatters';

// ─── Contenido de impresión ───────────────────────────────────────────────────

function ContenidoComprobante({ orden, config, garantias }) {
  const precioFinal  = Number(orden.precio_final || 0);
  const totalAbonado = Number(orden.total_abonado || 0);
  const saldo        = precioFinal - totalAbonado;
  const abonos       = Array.isArray(orden.abonos) ? orden.abonos : [];
  const precioGarantia = Number(orden.precio_garantia || 0);
  const tieneGarantia  = precioGarantia > 0;

  return (
    <div id="comprobante-servicio">
      <div className="cs-centrado negrita" style={{ fontSize: '14px' }}>
        {config?.nombre_negocio || 'MI TIENDA'}
      </div>
      {config?.nit       && <div className="cs-centrado">NIT: {config.nit}</div>}
      {config?.direccion && <div className="cs-centrado">{config.direccion}</div>}
      {config?.telefono  && <div className="cs-centrado">Tel: {config.telefono}</div>}

      <div className="cs-divisor" />

      <div className="cs-centrado negrita">COMPROBANTE DE SERVICIO</div>
      <div className="cs-fila">
        <span>Orden:</span>
        <span>#OS-{String(orden.id).padStart(4, '0')}</span>
      </div>
      <div className="cs-fila">
        <span>Fecha entrega:</span>
        <span>{formatFechaHora(orden.fecha_entrega || new Date())}</span>
      </div>

      <div className="cs-divisor" />

      <div className="negrita">CLIENTE</div>
      <div className="cs-fila">
        <span>Nombre:</span>
        <span style={{ maxWidth: '55mm', textAlign: 'right' }}>{orden.cliente_nombre}</span>
      </div>
      {orden.cliente_cedula && (
        <div className="cs-fila"><span>CC:</span><span>{orden.cliente_cedula}</span></div>
      )}
      {orden.cliente_telefono && (
        <div className="cs-fila"><span>Tel:</span><span>{orden.cliente_telefono}</span></div>
      )}

      <div className="cs-divisor" />

      <div className="negrita">EQUIPO</div>
      {orden.equipo_tipo && (
        <div className="cs-fila"><span>Tipo:</span><span>{orden.equipo_tipo}</span></div>
      )}
      {orden.equipo_nombre && (
        <div className="cs-fila">
          <span>Producto:</span>
          <span style={{ maxWidth: '50mm', textAlign: 'right' }}>{orden.equipo_nombre}</span>
        </div>
      )}
      {orden.equipo_serial && (
        <div className="cs-fila"><span>Serial/IMEI:</span><span>{orden.equipo_serial}</span></div>
      )}

      <div className="cs-divisor" />

      <div className="negrita">DIAGNÓSTICO</div>
      <div style={{ margin: '3px 0' }}>
        <span style={{ fontWeight: 900 }}>Falla: </span>
        <span>{orden.falla_reportada}</span>
      </div>
      {orden.notas_tecnico && (
        <div style={{ margin: '3px 0' }}>
          <span style={{ fontWeight: 900 }}>Notas: </span>
          <span>{orden.notas_tecnico}</span>
        </div>
      )}

      <div className="cs-divisor" />

      <div className="cs-fila negrita" style={{ fontSize: '14px' }}>
        <span>TOTAL:</span>
        <span>{formatCOP(precioFinal)}</span>
      </div>

      {tieneGarantia && (
        <div className="cs-fila">
          <span>Cobro garantía:</span>
          <span>{formatCOP(precioGarantia)}</span>
        </div>
      )}

      <div className="cs-divisor" />

      {abonos.length > 0 && (
        <>
          <div className="negrita">PAGOS REALIZADOS</div>
          {abonos.map((ab, i) => (
            <div key={ab.id || i} className="cs-fila">
              <span>{ab.metodo} · {formatFechaHora(ab.fecha)}</span>
              <span>{formatCOP(Number(ab.valor))}</span>
            </div>
          ))}
          <div className="cs-divisor" />
          <div className="cs-fila">
            <span>Total abonado:</span>
            <span>{formatCOP(totalAbonado)}</span>
          </div>
        </>
      )}

      {saldo > 0 ? (
        <div className="cs-fila negrita">
          <span>SALDO PENDIENTE:</span>
          <span>{formatCOP(saldo)}</span>
        </div>
      ) : (
        <div className="cs-centrado negrita" style={{ margin: '4px 0' }}>
          PAGADO EN SU TOTALIDAD
        </div>
      )}

      <div className="cs-divisor" />

      <div className="cs-fila" style={{ fontSize: '11px' }}>
        <span>Recibido:</span>
        <span>{formatFechaHora(orden.fecha_recepcion)}</span>
      </div>
      {orden.fecha_entrega && (
        <div className="cs-fila" style={{ fontSize: '11px' }}>
          <span>Entregado:</span>
          <span>{formatFechaHora(orden.fecha_entrega)}</span>
        </div>
      )}

      {garantias.length > 0 && (
        <>
          <div className="cs-divisor" />
          <div className="cs-centrado negrita" style={{ fontSize: '11px' }}>
            TÉRMINOS Y GARANTÍAS
          </div>
          {garantias
            .sort((a, b) => a.orden - b.orden)
            .map((g) => (
              <div key={g.id}>
                <div className="cs-garantia-titulo">{g.titulo}</div>
                <div className="cs-garantia-texto">{g.texto}</div>
              </div>
            ))}
        </>
      )}

      <div className="cs-divisor" />
      <div className="cs-centrado" style={{ marginTop: '8px', fontSize: '11px' }}>
        ¡Gracias por su confianza!
      </div>
      <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px' }}>
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

export function ComprobanteServicio({ orden, config = {}, garantias = [], onClose }) {
  const yaImprimio = useRef(false);
  const [portalContainer] = useState(() => {
    const el = document.createElement('div');
    el.id = 'comprobante-servicio-portal';
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
        #comprobante-servicio-portal #comprobante-servicio,
        #comprobante-servicio-portal #comprobante-servicio * {
          color: #000000 !important;
          font-weight: 600;
          -webkit-font-smoothing: none;
          font-smoothing: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        #comprobante-servicio-portal #comprobante-servicio {
          width: ${anchoPapelStr};
          font-family: 'Courier New', monospace;
          font-size: ${fuenteSizeStr};
          padding: ${paddingStr};
          box-sizing: border-box;
        }

        #comprobante-servicio-portal .negrita { font-weight: 900 !important; }
        #comprobante-servicio-portal .cs-garantia-texto { font-weight: 600 !important; }
        #comprobante-servicio-portal .cs-divisor  { border-top: 1.5px solid #000; margin: 5px 0; }
        #comprobante-servicio-portal .cs-centrado { text-align: center; }
        #comprobante-servicio-portal .cs-fila     { display: flex; justify-content: space-between; margin: 3px 0; gap: 4px; }
        #comprobante-servicio-portal .cs-fila span:last-child { text-align: right; flex-shrink: 0; max-width: 45mm; word-break: break-word; }
        #comprobante-servicio-portal .cs-garantia-titulo { font-weight: 900 !important; margin-top: 6px; font-size: 12px; text-align: center; }
        #comprobante-servicio-portal .cs-garantia-texto  { font-size: 11px; line-height: 1.5; white-space: pre-wrap; text-align: justify; word-break: break-word; width: 100%; display: block; }

        @media print {
          @page {
            margin: 0;
            size: ${anchoPapelStr} auto;
          }
          body > * {
            display: none !important;
          }
          body > #comprobante-servicio-portal {
            display: block !important;
          }
          #comprobante-servicio-portal #comprobante-servicio {
            position: static;
            width: ${anchoPapelStr};
            padding: ${paddingStr};
            font-size: ${fuenteSizeStr};
            font-family: 'Courier New', monospace;
            transform: scale(${escala});
            transform-origin: top left;
          }
          #comprobante-servicio-portal .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center no-print">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
          <h2 className="font-bold text-gray-900">Comprobante de servicio</h2>
          <p className="text-sm text-gray-500">El comprobante se enviará a la impresora.</p>
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

      <ContenidoComprobante orden={orden} config={config} garantias={garantias} />
    </>,
    portalContainer
  );
}