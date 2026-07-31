import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import {
  DocumentoTermico, EncabezadoNegocio, Divisor, Fila, Firma,
} from './DocumentoTermico';
import { HistorialAbonosTermico } from './BloqueObligacionTermico';

/**
 * PAZ Y SALVO / CUENTA SALDADA (POS).
 *
 * Versión en ticket del PDF de utils/obligacion.pdf.js. Solo se emite con saldo
 * en cero — la validación real está en el backend, aquí además se evita
 * renderizarlo por si acaso: es un documento que compromete al negocio.
 */
export function PazYSalvoTermico({ persona, resumen, descripcion, config = {}, onClose }) {
  if (!resumen || !resumen.pagada) return null;

  const fechaSaldado = resumen.fecha_ultimo_abono || new Date();

  return (
    <DocumentoTermico
      id="paz-y-salvo-termico"
      config={config}
      tituloModal="Paz y salvo listo"
      descripcionModal="Constancia de cancelación de la obligación."
      onClose={onClose}
    >
      {({ fuenteSize }) => (
        <>
          <EncabezadoNegocio config={config} titulo="PAZ Y SALVO" fuenteSize={fuenteSize} />

          <Fila
            label={resumen.tipo === 'credito' ? 'Factura:' : 'Préstamo:'}
            valor={`#${String(resumen.numero).padStart(6, '0')}`}
          />
          <Fila label="Emitido:" valor={formatFechaHora(new Date())} />

          <Divisor />

          <div className="recuadro centrado negrita" style={{ fontSize: `${fuenteSize}px` }}>
            CUENTA SALDADA
            <div style={{ fontSize: '11px', marginTop: '2px' }}>SIN SALDO PENDIENTE</div>
          </div>

          <div className="suave" style={{ fontSize: '11px', textAlign: 'justify', margin: '4px 0' }}>
            {config?.nombre_negocio || 'El establecimiento'} hace constar que {persona?.nombre}
            {persona?.cedula && persona.cedula !== 'COMPANERO'
              ? `, identificado(a) con C.C. ${persona.cedula},` : ''}{' '}
            canceló en su totalidad la obligación #{String(resumen.numero).padStart(6, '0')} y
            no presenta saldo pendiente alguno a la fecha.
          </div>

          <Divisor />

          <div className="negrita">{resumen.tipo === 'credito' ? 'CLIENTE' : 'PRESTATARIO'}</div>
          <Fila label="Nombre:" valor={persona?.nombre || '—'} />
          {persona?.cedula && persona.cedula !== 'COMPANERO' && (
            <Fila label="CC:" valor={persona.cedula} />
          )}
          {descripcion && (
            <div className="suave" style={{ fontSize: '11px', margin: '3px 0' }}>
              Concepto: {descripcion}
            </div>
          )}

          <Divisor />

          <div className="negrita">RESUMEN DE LA OBLIGACIÓN</div>
          <Fila
            label={resumen.tipo === 'credito' ? 'Valor original:' : 'Valor del préstamo:'}
            valor={formatCOP(resumen.valor_original)}
          />
          {resumen.devuelto > 0 && (
            <Fila label="Devoluciones:" valor={`- ${formatCOP(resumen.devuelto)}`} />
          )}
          {resumen.cuota_inicial > 0 && (
            <Fila label="Cuota inicial:" valor={formatCOP(resumen.cuota_inicial)} />
          )}
          <Fila
            label={`Total abonado (${resumen.num_abonos}):`}
            valor={formatCOP(resumen.total_abonado)}
          />
          <Fila label="Fecha de emisión:" valor={formatFecha(resumen.fecha_emision)} />
          {resumen.fecha_ultimo_abono && (
            <Fila label="Último pago:" valor={formatFecha(resumen.fecha_ultimo_abono)} />
          )}
          <Fila label="Saldada el:" valor={formatFecha(fechaSaldado)} />

          <div className="linea-punteada" />
          <Fila label="SALDO PENDIENTE:" valor={formatCOP(0)} negrita grande />

          <HistorialAbonosTermico resumen={resumen} />

          <Divisor />

          <div className="suave" style={{ fontSize: '10px', textAlign: 'justify' }}>
            Se expide la presente constancia a solicitud del interesado,
            el {formatFecha(new Date())}.
          </div>

          <Firma
            titulo="Firma y sello del establecimiento"
            identificacion={[config?.nombre_negocio, config?.nit ? `NIT ${config.nit}` : null]
              .filter(Boolean).join(' · ')}
          />
          <div style={{ height: '10mm' }} />
        </>
      )}
    </DocumentoTermico>
  );
}

export default PazYSalvoTermico;
