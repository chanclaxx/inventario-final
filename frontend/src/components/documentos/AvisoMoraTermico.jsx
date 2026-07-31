import { formatCOP, formatFechaHora } from '../../utils/formatters';
import {
  DocumentoTermico, EncabezadoNegocio, Divisor, Fila, Firma,
} from './DocumentoTermico';
import {
  EstadoObligacionTermico, HistorialAbonosTermico, CondicionesTermico,
} from './BloqueObligacionTermico';

/**
 * AVISO DE MORA (POS) — requerimiento de pago de una obligación vencida.
 *
 * Es la versión en ticket del PDF que genera utils/obligacion.pdf.js: mismas
 * cifras, mismos bloques, adaptados al ancho del papel.
 *
 * Props:
 *   persona     { nombre, cedula, celular }
 *   resumen     resumen de la obligación (backend)
 *   descripcion texto de la obligación (productos / artículo prestado)
 *   config      config_negocio
 */
export function AvisoMoraTermico({ persona, resumen, descripcion, config = {}, onClose }) {
  if (!resumen) return null;

  const moraPendiente = Number(resumen.mora?.pendiente || 0);
  const totalHoy      = resumen.saldo + moraPendiente;

  return (
    <DocumentoTermico
      id="aviso-mora-termico"
      config={config}
      tituloModal="Aviso de mora listo"
      descripcionModal="Se enviará a la impresora térmica."
      onClose={onClose}
    >
      {({ fuenteSize }) => (
        <>
          <EncabezadoNegocio config={config} titulo="AVISO DE MORA" fuenteSize={fuenteSize} />

          <Fila
            label={resumen.tipo === 'credito' ? 'Factura:' : 'Préstamo:'}
            valor={`#${String(resumen.numero).padStart(6, '0')}`}
          />
          <Fila label="Emitido:" valor={formatFechaHora(new Date())} />

          <Divisor />

          {/* El motivo del documento, imposible de pasar por alto */}
          <div className="recuadro centrado negrita" style={{ fontSize: `${fuenteSize}px` }}>
            OBLIGACIÓN VENCIDA
            <div style={{ fontSize: '11px', marginTop: '2px' }}>
              {resumen.dias_atraso} día(s) de atraso
            </div>
            <div style={{ fontSize: '11px' }}>desde el {resumen.fecha_limite_txt}</div>
          </div>

          <Divisor />

          <div className="negrita">{resumen.tipo === 'credito' ? 'CLIENTE' : 'PRESTATARIO'}</div>
          <Fila label="Nombre:" valor={persona?.nombre || '—'} />
          {persona?.cedula && persona.cedula !== 'COMPANERO' && (
            <Fila label="CC:" valor={persona.cedula} />
          )}
          {persona?.celular && persona.celular !== '0000000000' && (
            <Fila label="Tel:" valor={persona.celular} />
          )}
          {descripcion && (
            <div className="suave" style={{ fontSize: '11px', margin: '3px 0' }}>
              Concepto: {descripcion}
            </div>
          )}

          <Divisor />

          <div className="negrita">DETALLE DE LA DEUDA</div>
          <Fila label="Saldo de capital:"  valor={formatCOP(resumen.saldo)} />
          <Fila label="Intereses de mora:" valor={formatCOP(moraPendiente)} />
          <div className="linea-punteada" />
          <Fila label="TOTAL A PAGAR:" valor={formatCOP(totalHoy)} negrita grande />

          <EstadoObligacionTermico resumen={resumen} fuenteSize={fuenteSize} />
          <HistorialAbonosTermico resumen={resumen} />
          <CondicionesTermico resumen={resumen} />

          <Divisor />

          <div className="negrita">TÉRMINOS Y CONDICIONES</div>
          <div className="suave" style={{ fontSize: '10px', textAlign: 'justify' }}>
            Este documento constituye un requerimiento de pago por la obligación vencida
            descrita arriba. Los intereses de mora se liquidan sobre el saldo de capital
            pendiente, por los días de atraso, conforme a la condición pactada al momento
            de la venta. Se solicita ponerse al día o acercarse al establecimiento a
            acordar un plan de pago.
          </div>

          <Firma
            titulo="Firma de recibido del cliente"
            identificacion={[persona?.nombre, persona?.cedula ? `C.C. ${persona.cedula}` : null]
              .filter(Boolean).join(' · ')}
          />
          <div style={{ height: '10mm' }} />
        </>
      )}
    </DocumentoTermico>
  );
}

export default AvisoMoraTermico;
