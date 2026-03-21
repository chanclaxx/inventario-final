import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const tipoLabel  = textoTipoRetoma(retoma);
  const nombreProd = retoma.nombre_producto_serial
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

// ─── Contenido de impresión (se renderiza dentro del portal) ──────────────────

function ContenidoFactura({ factura, garantias, config }) {
  const retomas = Array.isArray(factura.retomas)
    ? factura.retomas
    : factura.retoma
      ? [factura.retoma]
      : [];

  const hayRetomas   = retomas.length > 0;
  const total        = factura.lineas?.reduce((s, l) => s + Number(l.subtotal || 0), 0) || 0;
  const totalPagado  = factura.pagos?.reduce((s, p) => s + Number(p.valor    || 0), 0) || 0;
  const totalRetomas = retomas.reduce((s, r) => s + calcularValorRetoma(r), 0);
  const cambio       = totalPagado - (total - totalRetomas);

  return (
    <div id="factura-termica">
      {/* Encabezado */}
      <div className="centrado negrita" style={{ fontSize: '14px' }}>
        {config?.nombre_negocio || 'MI TIENDA'}
      </div>
      {config?.nit       && <div className="centrado">NIT: {config.nit}</div>}
      {config?.direccion && <div className="centrado">{config.direccion}</div>}
      {config?.telefono  && <div className="centrado">Tel: {config.telefono}</div>}

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

      {/* Retomas */}
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
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function FacturaTermica({ factura, garantias = [], onClose }) {
  const yaImprimio = useRef(false);
  const [portalContainer] = useState(() => {
    // Crear un div aislado que se monta directamente en document.body
    const el = document.createElement('div');
    el.id = 'factura-termica-portal';
    return el;
  });

  // Montar/desmontar el portal container
  useEffect(() => {
    document.body.appendChild(portalContainer);
    return () => {
      document.body.removeChild(portalContainer);
    };
  }, [portalContainer]);

  // Imprimir una sola vez
  useEffect(() => {
    if (yaImprimio.current || !factura) return;
    yaImprimio.current = true;
    const timer = setTimeout(() => {
      window.print();
    }, 300);
    return () => clearTimeout(timer);
  }, [factura]);

  if (!factura) return null;

  const config     = factura.config || {};
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
        #factura-termica-portal #factura-termica,
        #factura-termica-portal #factura-termica * {
          color: #000000 !important;
          font-weight: 600;
          -webkit-font-smoothing: none;
          font-smoothing: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        #factura-termica-portal #factura-termica {
          width: ${anchoPapelStr};
          font-family: 'Courier New', monospace;
          font-size: ${fuenteSizeStr};
          padding: ${paddingStr};
          box-sizing: border-box;
        }

        #factura-termica-portal .negrita {
          font-weight: 900 !important;
        }

        #factura-termica-portal .garantia-texto,
        #factura-termica-portal .retoma-linea {
          font-weight: 600 !important;
        }

        #factura-termica-portal .linea-divisor { border-top: 1.5px solid #000; margin: 5px 0; }
        #factura-termica-portal .centrado      { text-align: center; }
        #factura-termica-portal .fila          { display: flex; justify-content: space-between; margin: 3px 0; gap: 4px; }
        #factura-termica-portal .fila span:last-child { text-align: right; flex-shrink: 0; max-width: 45mm; word-break: break-word; }
        #factura-termica-portal .garantia-titulo { font-weight: 900 !important; margin-top: 6px; font-size: 12px; text-align: center; }
        #factura-termica-portal .garantia-texto  { font-size: 11px; line-height: 1.5; white-space: pre-wrap; text-align: justify; word-break: break-word; width: 100%; display: block; }
        #factura-termica-portal .retoma-bloque   { margin: 4px 0; }
        #factura-termica-portal .retoma-linea    { font-size: 12px; margin: 2px 0; }
        #factura-termica-portal .retoma-separador { border-top: 1px dashed #000; margin: 4px 0; }

        @media print {
          @page {
            margin: 0;
            size: ${anchoPapelStr} auto;
          }
          /* Ocultar TODO */
          body > * {
            display: none !important;
          }
          /* Mostrar SOLO el portal */
          body > #factura-termica-portal {
            display: block !important;
          }
          #factura-termica-portal #factura-termica {
            position: static;
            width: ${anchoPapelStr};
            padding: ${paddingStr};
            font-size: ${fuenteSizeStr};
            font-family: 'Courier New', monospace;
            transform: scale(${escala});
            transform-origin: top left;
          }
          /* Ocultar overlay de pantalla en impresión */
          #factura-termica-portal .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Overlay pantalla */}
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

      {/* Contenido factura */}
      <ContenidoFactura factura={factura} garantias={garantias} config={config} />
    </>,
    portalContainer
  );
}