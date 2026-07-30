import { useEffect } from 'react';
import { formatCOP, formatFechaHora } from '../utils/formatters';
import { fechaLegible } from '../utils/mora';

/**
 * ReciboAbono — recibo térmico de un abono a crédito o préstamo.
 *
 * Desglosa CAPITAL y MORA por separado: es lo que el cliente necesita para
 * saber qué se le abonó a la deuda y qué se pagó de intereses, y lo que le
 * sirve al negocio como comprobante de que la mora se cobró.
 *
 * Props:
 *   abono   { valor, capital, mora, metodo, fecha, saldo_antes, saldo_despues,
 *             mora_pendiente, notas }
 *   deuda   { tipo: 'credito'|'prestamo', numero, persona, cedula,
 *             descripcion, fecha_limite, dias_mora }
 *   config  config_negocio (mismos 4 parámetros de impresión que FacturaTermica)
 *   onClose () => void
 */
export function ReciboAbono({ abono, deuda, config = {}, onClose }) {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);

  if (!abono || !deuda) return null;

  // Misma configuración de impresora que el resto de recibos del sistema.
  const escala     = Number(config.impresion_escala      || 1.5);
  const anchoPapel = Number(config.impresion_ancho_papel || 80);
  const fuenteSize = Number(config.impresion_fuente_size || 13);
  const padding    = Number(config.impresion_padding     || 2);

  const anchoPapelStr = `${anchoPapel}mm`;
  const fuenteSizeStr = `${fuenteSize}px`;
  const paddingStr    = `${padding}mm`;

  const capital = Number(abono.capital || 0);
  const mora    = Number(abono.mora    || 0);
  const total   = capital + mora;
  const hubieronDos = capital > 0 && mora > 0;
  const esCredito = deuda.tipo === 'credito';

  return (
    <>
      <style>{`
        #recibo-abono,
        #recibo-abono * {
          color: #000000 !important;
          font-weight: 600;
          -webkit-font-smoothing: none;
          font-smoothing: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        #recibo-abono {
          width: ${anchoPapelStr};
          font-family: 'Courier New', monospace;
          font-size: ${fuenteSizeStr};
          padding: ${paddingStr};
          box-sizing: border-box;
        }
        #recibo-abono .negrita { font-weight: 900 !important; }
        .linea-divisor { border-top: 1.5px solid #000; margin: 5px 0; }
        .centrado      { text-align: center; }
        .fila          { display: flex; justify-content: space-between; margin: 3px 0; gap: 4px; }
        .fila span:last-child { text-align: right; flex-shrink: 0; max-width: 45mm; word-break: break-word; }

        @media print {
          @page { margin: 0; size: ${anchoPapelStr} auto; }
          body * { visibility: hidden; }
          #recibo-abono, #recibo-abono * { visibility: visible; }
          #recibo-abono {
            position: fixed; top: 0; left: 0;
            width: ${anchoPapelStr};
            padding: ${paddingStr};
            font-size: ${fuenteSizeStr};
            font-family: 'Courier New', monospace;
            transform: scale(${escala});
            transform-origin: top left;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Overlay pantalla */}
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center no-print">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
          <h2 className="font-bold text-gray-900">Recibo de abono listo</h2>
          <p className="text-sm text-gray-500">
            Se enviará a la impresora térmica
            {hubieronDos ? ', con el desglose de capital y mora.' : '.'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 py-2 bg-gray-100 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-200">
              Cerrar
            </button>
            <button onClick={() => window.print()}
              className="flex-1 py-2 bg-blue-600 rounded-xl text-sm font-medium text-white hover:bg-blue-700">
              Reimprimir
            </button>
          </div>
        </div>
      </div>

      {/* Recibo */}
      <div id="recibo-abono">

        <div className="centrado negrita" style={{ fontSize: `${fuenteSize + 1}px` }}>
          {config.nombre_negocio || 'MI TIENDA'}
        </div>
        {config.nit       && <div className="centrado">NIT: {config.nit}</div>}
        {config.direccion && <div className="centrado">{config.direccion}</div>}
        {config.telefono  && <div className="centrado">Tel: {config.telefono}</div>}

        <div className="linea-divisor" />

        <div className="centrado negrita">RECIBO DE ABONO</div>
        {deuda.numero != null && (
          <div className="fila">
            <span>{esCredito ? 'Factura:' : 'Préstamo:'}</span>
            <span>#{String(deuda.numero).padStart(6, '0')}</span>
          </div>
        )}
        <div className="fila">
          <span>Fecha:</span>
          <span>{formatFechaHora(abono.fecha || new Date())}</span>
        </div>
        {abono.metodo && (
          <div className="fila">
            <span>Forma de pago:</span>
            <span>{abono.metodo}</span>
          </div>
        )}

        <div className="linea-divisor" />

        <div className="negrita">{esCredito ? 'CLIENTE' : 'PRESTATARIO'}</div>
        <div className="fila">
          <span>Nombre:</span>
          <span style={{ maxWidth: '50mm', textAlign: 'right' }}>{deuda.persona}</span>
        </div>
        {deuda.cedula && deuda.cedula !== 'COMPANERO' && (
          <div className="fila"><span>CC:</span><span>{deuda.cedula}</span></div>
        )}
        {deuda.descripcion && (
          <div style={{ margin: '2px 0' }}>
            <span>Concepto: </span><span>{deuda.descripcion}</span>
          </div>
        )}

        <div className="linea-divisor" />

        {/* ── El desglose: es la razón de ser de este recibo ── */}
        <div className="negrita">DETALLE DEL PAGO</div>
        <div className="fila">
          <span>Abono a capital:</span>
          <span>{formatCOP(capital)}</span>
        </div>
        {mora > 0 && (
          <div className="fila">
            <span>Intereses de mora:</span>
            <span>{formatCOP(mora)}</span>
          </div>
        )}
        <div className="fila negrita" style={{ fontSize: `${fuenteSize + 1}px` }}>
          <span>TOTAL RECIBIDO:</span>
          <span>{formatCOP(total)}</span>
        </div>

        <div className="linea-divisor" />

        {/* ── Cómo queda la deuda ── */}
        <div className="negrita">SALDO</div>
        {abono.saldo_antes != null && (
          <div className="fila">
            <span>Deuda anterior:</span>
            <span>{formatCOP(abono.saldo_antes)}</span>
          </div>
        )}
        <div className="fila negrita">
          <span>Deuda actual:</span>
          <span>{formatCOP(abono.saldo_despues ?? 0)}</span>
        </div>
        {Number(abono.mora_pendiente || 0) > 0 && (
          <div className="fila negrita">
            <span>Mora pendiente:</span>
            <span>{formatCOP(abono.mora_pendiente)}</span>
          </div>
        )}

        {/* Si sigue con plazo, se recuerda: es lo que evita reclamos después */}
        {deuda.fecha_limite && (
          <>
            <div className="linea-divisor" />
            <div className="fila">
              <span>Fecha límite de pago:</span>
              <span>{fechaLegible(deuda.fecha_limite)}</span>
            </div>
            {Number(deuda.dias_mora || 0) > 0 && (
              <div className="fila">
                <span>Días de atraso:</span>
                <span>{deuda.dias_mora}</span>
              </div>
            )}
          </>
        )}

        {abono.notas && (
          <>
            <div className="linea-divisor" />
            <div style={{ margin: '2px 0' }}>
              <span>Observaciones: </span><span>{abono.notas}</span>
            </div>
          </>
        )}

        <div className="linea-divisor" />

        <div className="centrado" style={{ marginTop: '6px', fontSize: `${fuenteSize - 2}px` }}>
          {Number(abono.saldo_despues ?? 0) <= 0 && Number(abono.mora_pendiente || 0) <= 0
            ? 'Deuda cancelada en su totalidad. Gracias.'
            : 'Este recibo es válido como comprobante de abono.'}
        </div>
        <div style={{ height: '10mm' }} />
      </div>
    </>
  );
}

export default ReciboAbono;
