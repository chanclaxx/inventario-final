import { useEffect } from 'react';
import { formatCOP, formatFechaHora } from '../utils/formatters';

// ─── Utilidades ───────────────────────────────────────────────────────────────

function textoTipoRetoma(retoma) {
  if (!retoma) return '';
  if (retoma.tipo_retoma === 'serial')   return 'Equipo con serial';
  if (retoma.tipo_retoma === 'cantidad') return 'Producto por cantidad';
  return '';
}

function calcularValorRetoma(retoma) {
  return Number(retoma?.valor_retoma || 0);
}

// ─── Subcomponente: bloque de una retoma individual ──────────────────────────

function BloqueRetoma({ retoma }) {
  const tipoLabel    = textoTipoRetoma(retoma);
  const nombreProd   = retoma.nombre_producto_serial
    || retoma.nombre_producto_cantidad
    || retoma.nombre_producto
    || null;

  return (
    <div className="retoma-bloque">
      {retoma.descripcion && (
        <div className="retoma-linea">{retoma.descripcion}</div>
      )}
      {tipoLabel && (
        <div className="retoma-linea">Tipo: {tipoLabel}</div>
      )}
      {retoma.imei && (
        <div className="retoma-linea">IMEI: {retoma.imei}</div>
      )}
      {nombreProd && (
        <div className="retoma-linea">Producto: {nombreProd}</div>
      )}
      {retoma.tipo_retoma === 'cantidad' && Number(retoma.cantidad_retoma) > 0 && (
        <div className="retoma-linea">Cantidad: {retoma.cantidad_retoma}</div>
      )}
      {retoma.ingreso_inventario && (
        <div className="retoma-linea">✓ Ingresado al inventario</div>
      )}
      <div className="fila negrita" style={{ marginTop: '2px' }}>
        <span>Valor retoma:</span>
        <span>- {formatCOP(calcularValorRetoma(retoma))}</span>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function FacturaTermica({ factura, garantias = [], onClose }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.print();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  if (!factura) return null;

  // El backend retorna "retomas" (array). Se normaliza siempre a array.
  const retomas = Array.isArray(factura.retomas)
    ? factura.retomas
    : factura.retoma
      ? [factura.retoma]   // compatibilidad con respuestas antiguas que usen singular
      : [];

  const hayRetomas = retomas.length > 0;

  const total         = factura.lineas?.reduce((s, l) => s + Number(l.subtotal || 0), 0) || 0;
  const totalPagado   = factura.pagos?.reduce((s, p) => s + Number(p.valor    || 0), 0) || 0;
  const totalRetomas  = retomas.reduce((s, r) => s + calcularValorRetoma(r), 0);
  const cambio        = totalPagado - (total - totalRetomas);

  return (
    <>
      <style>{`
        /* ── BASE ── */
        #factura-termica,
        #factura-termica * {
          color: #000000 !important;
          font-weight: 600;
          -webkit-font-smoothing: none;
          font-smoothing: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        #factura-termica {
          width: 80mm;
          font-family: 'Courier New', monospace;
          font-size: 13px;
          padding: 2mm;
          box-sizing: border-box;
        }

        #factura-termica .negrita {
          font-weight: 900 !important;
        }

        #factura-termica .garantia-texto,
        #factura-termica .retoma-linea {
          font-weight: 600 !important;
        }

        .linea-divisor { border-top: 1.5px solid #000; margin: 5px 0; }
        .centrado      { text-align: center; }
        .fila          { display: flex; justify-content: space-between; margin: 3px 0; gap: 4px; }
        .fila span:last-child { text-align: right; flex-shrink: 0; max-width: 45mm; word-break: break-word; }
        .garantia-titulo { font-weight: 900 !important; margin-top: 6px; font-size: 12px; text-align: center; }
        .garantia-texto  { font-size: 11px; line-height: 1.5; white-space: pre-wrap; text-align: justify; word-break: break-word; width: 100%; display: block; }
        .retoma-bloque   { margin: 4px 0; }
        .retoma-linea    { font-size: 12px; margin: 2px 0; }
        .retoma-separador { border-top: 1px dashed #000; margin: 4px 0; }

        @media print {
          @page {
            margin: 0;
            size: 80mm auto;
          }
          body * { visibility: hidden; }
          #factura-termica,
          #factura-termica * { visibility: visible; }
          #factura-termica {
            position: fixed;
            top: 0; left: 0;
            width: 80mm;
            padding: 2mm;
            font-size: 13px;
            font-family: 'Courier New', monospace;
            transform: scale(1.5);
            transform-origin: top left;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* ── Overlay pantalla ── */}
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center no-print">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
          <h2 className="font-bold text-gray-900">Factura lista para imprimir</h2>
          <p className="text-sm text-gray-500">La factura se enviará a la impresora térmica.</p>
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

      {/* ── Contenido factura ── */}
      <div id="factura-termica">

        {/* Encabezado */}
        <div className="centrado negrita" style={{ fontSize: '14px' }}>
          {factura.config?.nombre_negocio || 'MI TIENDA'}
        </div>
        {factura.config?.nit       && <div className="centrado">NIT: {factura.config.nit}</div>}
        {factura.config?.direccion && <div className="centrado">{factura.config.direccion}</div>}
        {factura.config?.telefono  && <div className="centrado">Tel: {factura.config.telefono}</div>}

        <div className="linea-divisor" />

        <div className="centrado negrita">FACTURA DE VENTA</div>
        <div className="fila">
          <span>No.</span>
          <span>{String(factura.id).padStart(6, '0')}</span>
        </div>
        <div className="fila">
          <span>Fecha:</span>
          <span>{formatFechaHora(factura.fecha)}</span>
        </div>

        <div className="linea-divisor" />

        {/* Cliente */}
        <div className="negrita">CLIENTE</div>
        <div className="fila">
          <span>Nombre:</span>
          <span style={{ maxWidth: '55mm', textAlign: 'right' }}>{factura.nombre_cliente}</span>
        </div>
        {factura.cedula !== 'COMPANERO' && (
          <div className="fila"><span>CC:</span><span>{factura.cedula}</span></div>
        )}
        {factura.celular !== '0000000000' && (
          <div className="fila"><span>Tel:</span><span>{factura.celular}</span></div>
        )}

        <div className="linea-divisor" />

        {/* Productos */}
        <div className="negrita">PRODUCTOS</div>
        {factura.lineas?.map((l, i) => (
          <div key={i} style={{ marginBottom: '4px' }}>
            <div className="negrita">{l.nombre_producto}</div>
            {l.imei && <div style={{ fontSize: '9px' }}>IMEI: {l.imei}</div>}
            <div className="fila">
              <span>{l.cantidad} x {formatCOP(l.precio)}</span>
              <span>{formatCOP(l.subtotal)}</span>
            </div>
          </div>
        ))}

        <div className="linea-divisor" />

        {/* Retomas — se renderizan todas las del array */}
        {hayRetomas && (
          <>
            <div className="negrita">
              {retomas.length === 1 ? 'RETOMA' : `RETOMAS (${retomas.length})`}
            </div>
            {retomas.map((retoma, i) => (
              <div key={retoma.id ?? i}>
                {retomas.length > 1 && (
                  <div className="retoma-linea negrita">Retoma {i + 1}</div>
                )}
                <BloqueRetoma retoma={retoma} />
                {i < retomas.length - 1 && <div className="retoma-separador" />}
              </div>
            ))}
            <div className="linea-divisor" />
          </>
        )}

        {/* Totales */}
        <div className="fila negrita" style={{ fontSize: '14px' }}>
          <span>TOTAL:</span>
          <span>{formatCOP(total - totalRetomas)}</span>
        </div>

        {/* Pagos */}
        {factura.pagos?.map((p, i) => (
          <div key={i} className="fila">
            <span>{p.metodo}:</span>
            <span>{formatCOP(p.valor)}</span>
          </div>
        ))}

        {cambio > 0 && (
          <div className="fila">
            <span>Cambio:</span>
            <span>{formatCOP(cambio)}</span>
          </div>
        )}

        <div className="linea-divisor" />

        {/* Garantías */}
        {garantias.length > 0 && (
          <>
            <div className="centrado negrita" style={{ fontSize: '11px' }}>
              TÉRMINOS Y GARANTÍAS
            </div>
            {garantias
              .sort((a, b) => a.orden - b.orden)
              .map((g) => (
                <div key={g.id}>
                  <div className="garantia-titulo">{g.titulo}</div>
                  <div className="garantia-texto">{g.texto}</div>
                </div>
              ))}
            <div className="linea-divisor" />
          </>
        )}

        {/* Pie */}
        <div className="centrado" style={{ marginTop: '8px', fontSize: '11px' }}>
          ¡Gracias por su compra!
        </div>
        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px' }}>
          Firma: ___________________________
        </div>
        <div style={{ height: '10mm' }} />
      </div>
    </>
  );
}