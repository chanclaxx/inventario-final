import { formatCOP, formatFechaHora } from '../utils/formatters';
import { DocumentoTermico, Firma } from './documentos/DocumentoTermico';
import {
  EstadoObligacionTermico, HistorialAbonosTermico, CondicionesTermico,
} from './documentos/BloqueObligacionTermico';

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

function ContenidoFactura({ factura, garantias, config, fuenteSize }) {
  // Resumen de la obligación calculado por el backend. Es el mismo objeto que
  // imprime el PDF, así que ticket y PDF no pueden mostrar cifras distintas.
  const resumen = factura.credito?.resumen || null;

  const retomas = Array.isArray(factura.retomas)
    ? factura.retomas
    : factura.retoma
      ? [factura.retoma]
      : [];

  const hayRetomas   = retomas.length > 0;

  // Solo mostrar líneas con cantidad neta > 0 (excluir totalmente devueltas)
  const lineasActivas = (factura.lineas || []).filter((l) => {
    const cantNeta = Number(l.cantidad) - Number(l.cantidad_devuelta || 0);
    return cantNeta > 0;
  });

  // Líneas que tienen al menos una unidad devuelta
  const lineasConDevolucion = (factura.lineas || []).filter((l) => Number(l.cantidad_devuelta || 0) > 0);

  const total        = (factura.lineas || []).reduce((s, l) => {
    const cantNeta = Math.max(0, Number(l.cantidad) - Number(l.cantidad_devuelta || 0));
    return s + Number(l.precio) * cantNeta;
  }, 0);
  const totalPagado  = factura.pagos?.reduce((s, p) => s + Number(p.valor    || 0), 0) || 0;
  const totalRetomas = retomas.reduce((s, r) => s + calcularValorRetoma(r), 0);
  const cambio       = totalPagado - (total - totalRetomas);

  return (
    <>
      {/* Encabezado */}
      <div className="centrado negrita" style={{ fontSize: '14px' }}>
        {config?.nombre_negocio || 'MI TIENDA'}
      </div>
      {config?.nit       && <div className="centrado">NIT: {config.nit}</div>}
      {config?.direccion && <div className="centrado">{config.direccion}</div>}
      {config?.telefono  && <div className="centrado">Tel: {config.telefono}</div>}

      <div className="linea-divisor" />

      <div className="centrado negrita">
        {resumen ? 'FACTURA DE VENTA A CRÉDITO' : 'FACTURA DE VENTA'}
      </div>
      <div className="fila">
        <span>No.</span>
        <span>{String(factura.numero ?? factura.id).padStart(6, '0')}</span>
      </div>
      <div className="fila">
        <span>Fecha:</span>
        <span>{formatFechaHora(factura.fecha)}</span>
      </div>
      {factura.vendedor_nombre && (
        <div className="fila">
          <span>Vendedor:</span>
          <span>{factura.vendedor_nombre}</span>
        </div>
      )}

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

      {/* Productos (excluye los totalmente devueltos) */}
      <div className="negrita">PRODUCTOS</div>
      {lineasActivas.map((l, i) => {
        const cantNeta     = Number(l.cantidad) - Number(l.cantidad_devuelta || 0);
        const subtotalNeto = Number(l.precio) * cantNeta;
        return (
          <div key={i} style={{ marginBottom: '4px' }}>
            <div className="negrita">{l.nombre_producto}</div>
            {l.imei && <div style={{ fontSize: '9px' }}>IMEI: {l.imei}</div>}
            <div className="fila">
              <span>{cantNeta} x {formatCOP(l.precio)}</span>
              <span>{formatCOP(subtotalNeto)}</span>
            </div>
          </div>
        );
      })}

      {/* Devoluciones */}
      {lineasConDevolucion.length > 0 && (
        <>
          <div className="linea-divisor" />
          <div className="negrita">DEVOLUCIONES</div>
          {lineasConDevolucion.map((l, i) => {
            const cantDev    = Number(l.cantidad_devuelta);
            const valorDev   = Number(l.precio) * cantDev;
            return (
              <div key={i} style={{ marginBottom: '4px' }}>
                <div className="negrita">{l.nombre_producto}</div>
                {l.imei && <div style={{ fontSize: '9px' }}>IMEI: {l.imei}</div>}
                <div className="fila">
                  <span>Devuelto: {cantDev} ud{cantDev !== 1 ? 's' : ''}.</span>
                  <span>- {formatCOP(valorDev)}</span>
                </div>
              </div>
            );
          })}
        </>
      )}

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

      {/* ── Venta a crédito: estado de la deuda, historial y condiciones ──
          Mismos bloques y mismas cifras que el PDF: el cliente puede saber en
          qué va su obligación sin entrar al sistema. */}
      {resumen && (
        <>
          <EstadoObligacionTermico resumen={resumen} fuenteSize={fuenteSize} />
          <HistorialAbonosTermico  resumen={resumen} />
          <CondicionesTermico      resumen={resumen} />
        </>
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
      {/* En una venta a crédito la firma es la prueba del pacto, así que se
          identifica a quien firma. La venta de contado conserva su línea de
          siempre: no había motivo para cambiarle el pie. */}
      {resumen ? (
        <Firma
          titulo="Firma de aceptación del cliente"
          identificacion={[factura.nombre_cliente,
            factura.cedula && factura.cedula !== 'COMPANERO' ? `C.C. ${factura.cedula}` : null]
            .filter(Boolean).join(' · ')}
        />
      ) : (
        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '10px' }}>
          Firma: ___________________________
        </div>
      )}
      <div style={{ height: '10mm' }} />
    </>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function FacturaTermica({ factura, garantias = [], onClose }) {
  if (!factura) return null;

  const config = factura.config || {};

  return (
    <DocumentoTermico
      id="factura-termica"
      config={config}
      tituloModal="Factura lista para imprimir"
      descripcionModal="La factura se enviará a la impresora térmica."
      onClose={onClose}
    >
      {({ fuenteSize }) => (
        <ContenidoFactura
          factura={factura}
          garantias={garantias}
          config={config}
          fuenteSize={fuenteSize}
        />
      )}
    </DocumentoTermico>
  );
}