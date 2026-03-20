import { useEffect } from 'react';
import { formatCOP, formatFechaHora } from '../utils/formatters';

/**
 * ReciboAcreedor — recibo térmico para movimientos de acreedores.
 *
 * Props:
 *   acreedor  { nombre, cedula, telefono }
 *   movimiento { id, tipo, descripcion, valor, fecha, firma,
 *                saldo_antes, saldo_despues }
 *   config    { nombre_negocio, nit, direccion, telefono,
 *               impresion_escala, impresion_ancho_papel,
 *               impresion_fuente_size, impresion_padding }
 *   onClose   () => void
 *
 * Los 4 parámetros de impresión se leen de config_negocio,
 * misma fuente que usa FacturaTermica. Fallback = valores originales.
 */
export function ReciboAcreedor({ acreedor, movimiento, config = {}, onClose }) {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);

  if (!acreedor || !movimiento) return null;

  // ── Configuración dinámica de impresora — idéntico a FacturaTermica ───────
  const escala     = Number(config.impresion_escala      || 1.5);
  const anchoPapel = Number(config.impresion_ancho_papel || 80);
  const fuenteSize = Number(config.impresion_fuente_size || 13);
  const padding    = Number(config.impresion_padding     || 2);

  const anchoPapelStr = `${anchoPapel}mm`;
  const fuenteSizeStr = `${fuenteSize}px`;
  const paddingStr    = `${padding}mm`;

  const esCargo = movimiento.tipo === 'Cargo';

  return (
    <>
      <style>{`
        /* ── BASE: todo el recibo fuerza negro y peso mínimo 600 ── */
        #recibo-acreedor,
        #recibo-acreedor * {
          color: #000000 !important;
          font-weight: 600;
          -webkit-font-smoothing: none;
          font-smoothing: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        #recibo-acreedor {
          width: ${anchoPapelStr};
          font-family: 'Courier New', monospace;
          font-size: ${fuenteSizeStr};
          padding: ${paddingStr};
          box-sizing: border-box;
        }

        #recibo-acreedor .negrita { font-weight: 900 !important; }

        .linea-divisor { border-top: 1.5px solid #000; margin: 5px 0; }
        .centrado      { text-align: center; }
        .fila          { display: flex; justify-content: space-between; margin: 3px 0; gap: 4px; }
        .fila span:last-child { text-align: right; flex-shrink: 0; max-width: 45mm; word-break: break-word; }

        /* ── IMPRESIÓN ── */
        @media print {
          @page {
            margin: 0;
            size: ${anchoPapelStr} auto;
          }
          body * { visibility: hidden; }
          #recibo-acreedor,
          #recibo-acreedor * { visibility: visible; }
          #recibo-acreedor {
            position: fixed;
            top: 0; left: 0;
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
          <h2 className="font-bold text-gray-900">Recibo listo para imprimir</h2>
          <p className="text-sm text-gray-500">El recibo se enviará a la impresora térmica.</p>
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

      {/* Contenido recibo */}
      <div id="recibo-acreedor">

        {/* Encabezado negocio */}
        <div className="centrado negrita" style={{ fontSize: `${fuenteSize + 1}px` }}>
          {config.nombre_negocio || 'MI TIENDA'}
        </div>
        {config.nit       && <div className="centrado">NIT: {config.nit}</div>}
        {config.direccion && <div className="centrado">{config.direccion}</div>}
        {config.telefono  && <div className="centrado">Tel: {config.telefono}</div>}

        <div className="linea-divisor" />

        <div className="centrado negrita">RECIBO DE {movimiento.tipo.toUpperCase()}</div>
        <div className="fila">
          <span>No. Mov:</span>
          <span>{String(movimiento.id).padStart(6, '0')}</span>
        </div>
        <div className="fila">
          <span>Fecha:</span>
          <span>{formatFechaHora(movimiento.fecha)}</span>
        </div>

        <div className="linea-divisor" />

        {/* Acreedor */}
        <div className="negrita">ACREEDOR</div>
        <div className="fila">
          <span>Nombre:</span>
          <span style={{ maxWidth: '50mm', textAlign: 'right' }}>{acreedor.nombre}</span>
        </div>
        <div className="fila">
          <span>CC:</span>
          <span>{acreedor.cedula}</span>
        </div>
        {acreedor.telefono && (
          <div className="fila">
            <span>Tel:</span>
            <span>{acreedor.telefono}</span>
          </div>
        )}

        <div className="linea-divisor" />

        {/* Detalle movimiento */}
        <div className="negrita">DETALLE</div>
        <div className="fila">
          <span>Tipo:</span>
          <span className="negrita">{movimiento.tipo}</span>
        </div>
        <div style={{ margin: '2px 0' }}>
          <span>Concepto: </span>
          <span>{movimiento.descripcion}</span>
        </div>

        <div className="linea-divisor" />

        {/* Valores y saldos */}
        <div className="fila">
          <span>Saldo anterior:</span>
          <span>{formatCOP(movimiento.saldo_antes)}</span>
        </div>
        <div className="fila negrita" style={{ fontSize: `${fuenteSize + 1}px` }}>
          <span>{esCargo ? 'Cargo:' : 'Abono:'}</span>
          <span>{esCargo ? '+' : '-'}{formatCOP(movimiento.valor)}</span>
        </div>
        <div className="fila negrita">
          <span>Saldo nuevo:</span>
          <span>{formatCOP(movimiento.saldo_despues)}</span>
        </div>

        <div className="linea-divisor" />

        {/* Firma si existe */}
        {movimiento.firma && (
          <>
            <div className="centrado" style={{ fontSize: `${fuenteSize - 2}px`, marginBottom: '4px' }}>
              Firma
            </div>
            <div className="centrado">
              <img
                src={movimiento.firma}
                alt="firma"
                style={{ maxWidth: '70mm', height: 'auto' }}
              />
            </div>
            <div className="linea-divisor" />
          </>
        )}

        {/* Pie */}
        <div className="centrado" style={{ marginTop: '6px', fontSize: `${fuenteSize - 2}px` }}>
          Este recibo es válido como comprobante de {movimiento.tipo.toLowerCase()}.
        </div>
        <div style={{ height: '10mm' }} />
      </div>
    </>
  );
}