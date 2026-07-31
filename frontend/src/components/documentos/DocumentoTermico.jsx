import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * BASE DE TODOS LOS DOCUMENTOS TÉRMICOS (POS).
 *
 * Encapsula lo que antes estaba copiado en cada recibo: el portal aislado, los
 * estilos de impresión, los parámetros de la impresora del negocio y el overlay
 * de "listo para imprimir". Cada documento solo aporta su contenido.
 *
 * Se imprime mediante un portal montado en <body> y una regla que oculta todo
 * lo demás: es lo que evita que se cuele el layout de la app en el ticket.
 */

// ─── Primitivas de maquetación del ticket ────────────────────────────────────

export function Divisor() {
  return <div className="linea-divisor" />;
}

export function Titulo({ children, centrado = false }) {
  return <div className={`negrita${centrado ? ' centrado' : ''}`}>{children}</div>;
}

export function Fila({ label, valor, negrita = false, grande = false }) {
  return (
    <div className={`fila${negrita ? ' negrita' : ''}`} style={grande ? { fontSize: '14px' } : undefined}>
      <span>{label}</span>
      <span>{valor}</span>
    </div>
  );
}

/** Encabezado con los datos del establecimiento. */
export function EncabezadoNegocio({ config, titulo, fuenteSize }) {
  return (
    <>
      <div className="centrado negrita" style={{ fontSize: `${fuenteSize + 1}px` }}>
        {config?.nombre_negocio || 'MI TIENDA'}
      </div>
      {config?.nit       && <div className="centrado">NIT: {config.nit}</div>}
      {config?.direccion && <div className="centrado">{config.direccion}</div>}
      {config?.telefono  && <div className="centrado">Tel: {config.telefono}</div>}
      <Divisor />
      {titulo && <div className="centrado negrita">{titulo}</div>}
    </>
  );
}

/** Línea de firma al pie del ticket. */
export function Firma({ titulo = 'Firma', identificacion = null }) {
  return (
    <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '10px' }}>
      <div>_______________________________</div>
      <div style={{ marginTop: '2px' }}>{titulo}</div>
      {identificacion && <div style={{ fontSize: '9px' }}>{identificacion}</div>}
    </div>
  );
}

// ─── Contenedor ───────────────────────────────────────────────────────────────

/**
 * @param {object}   config      — config_negocio (parámetros de impresión)
 * @param {string}   id          — id del nodo raíz (uno por tipo de documento)
 * @param {string}   tituloModal — texto del overlay en pantalla
 * @param {string}   [descripcionModal]
 * @param {Function} onClose
 * @param {node}     children    — contenido del ticket
 */
export function DocumentoTermico({
  config = {}, id, tituloModal, descripcionModal, onClose, children,
}) {
  const yaImprimio = useRef(false);
  const [portalContainer] = useState(() => {
    const el = document.createElement('div');
    el.id = `${id}-portal`;
    return el;
  });

  useEffect(() => {
    document.body.appendChild(portalContainer);
    return () => { document.body.removeChild(portalContainer); };
  }, [portalContainer]);

  useEffect(() => {
    if (yaImprimio.current) return;
    yaImprimio.current = true;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);

  // Mismos cuatro parámetros de impresora en todos los documentos.
  const escala     = Number(config.impresion_escala      || 1.5);
  const anchoPapel = Number(config.impresion_ancho_papel || 80);
  const fuenteSize = Number(config.impresion_fuente_size || 13);
  const padding    = Number(config.impresion_padding     || 2);

  const anchoPapelStr = `${anchoPapel}mm`;
  const fuenteSizeStr = `${fuenteSize}px`;
  const paddingStr    = `${padding}mm`;

  const portalId = `${id}-portal`;

  return createPortal(
    <>
      <style>{`
        #${portalId} #${id},
        #${portalId} #${id} * {
          color: #000000 !important;
          font-weight: 600;
          -webkit-font-smoothing: none;
          font-smoothing: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        #${portalId} #${id} {
          width: ${anchoPapelStr};
          font-family: 'Courier New', monospace;
          font-size: ${fuenteSizeStr};
          padding: ${paddingStr};
          box-sizing: border-box;
        }

        #${portalId} .negrita { font-weight: 900 !important; }
        #${portalId} .suave,
        #${portalId} .garantia-texto,
        #${portalId} .retoma-linea { font-weight: 600 !important; }

        #${portalId} .linea-divisor  { border-top: 1.5px solid #000; margin: 5px 0; }
        #${portalId} .linea-punteada { border-top: 1px dashed #000;  margin: 4px 0; }
        #${portalId} .centrado       { text-align: center; }
        #${portalId} .fila           { display: flex; justify-content: space-between; margin: 3px 0; gap: 4px; }
        #${portalId} .fila span:last-child { text-align: right; flex-shrink: 0; max-width: 45mm; word-break: break-word; }
        #${portalId} .recuadro       { border: 1.5px solid #000; padding: 3px 4px; margin: 4px 0; }
        #${portalId} .garantia-titulo { font-weight: 900 !important; margin-top: 6px; font-size: 12px; text-align: center; }
        #${portalId} .garantia-texto  { font-size: 11px; line-height: 1.5; white-space: pre-wrap; text-align: justify; word-break: break-word; width: 100%; display: block; }
        #${portalId} .retoma-bloque    { margin: 4px 0; }
        #${portalId} .retoma-linea     { font-size: 12px; margin: 2px 0; }
        #${portalId} .retoma-separador { border-top: 1px dashed #000; margin: 4px 0; }
        #${portalId} .tabla-abonos     { width: 100%; font-size: 11px; border-collapse: collapse; }
        #${portalId} .tabla-abonos th  { text-align: left; border-bottom: 1px solid #000; padding: 2px 0; font-weight: 900; }
        #${portalId} .tabla-abonos td  { padding: 2px 0; vertical-align: top; }
        #${portalId} .tabla-abonos .der { text-align: right; }

        @media print {
          @page { margin: 0; size: ${anchoPapelStr} auto; }
          body > * { display: none !important; }
          body > #${portalId} { display: block !important; }
          #${portalId} #${id} {
            position: static;
            width: ${anchoPapelStr};
            padding: ${paddingStr};
            font-size: ${fuenteSizeStr};
            font-family: 'Courier New', monospace;
            transform: scale(${escala});
            transform-origin: top left;
          }
          #${portalId} .no-print { display: none !important; }
        }
      `}</style>

      {/* Overlay en pantalla */}
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center no-print">
        <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
          <h2 className="font-bold text-gray-900">{tituloModal}</h2>
          {descripcionModal && <p className="text-sm text-gray-500">{descripcionModal}</p>}
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

      <div id={id}>
        {typeof children === 'function' ? children({ fuenteSize }) : children}
      </div>
    </>,
    portalContainer,
  );
}
