import { formatCOP, formatFechaHora } from '../utils/formatters';
import { fechaLegible } from '../utils/mora';
import {
  DocumentoTermico, EncabezadoNegocio, Divisor, Fila,
} from './documentos/DocumentoTermico';

/**
 * ReciboAbono — recibo térmico de un abono a crédito o préstamo.
 *
 * Desglosa CAPITAL y MORA por separado: es lo que el cliente necesita para
 * saber qué se le abonó a la deuda y qué se pagó de intereses, y lo que le
 * sirve al negocio como comprobante de que la mora se cobró.
 *
 * Comparte la base térmica con la factura, el comprobante de préstamo, el aviso
 * de mora y el paz y salvo: misma línea gráfica y mismo método de impresión.
 *
 * Props:
 *   abono   { valor, capital, mora, metodo, fecha, saldo_antes, saldo_despues,
 *             mora_pendiente, notas }
 *   deuda   { tipo: 'credito'|'prestamo', numero, persona, cedula,
 *             descripcion, fecha_limite, dias_mora }
 *   config  config_negocio
 *   onClose () => void
 */
export function ReciboAbono({ abono, deuda, config = {}, onClose }) {
  if (!abono || !deuda) return null;

  const capital     = Number(abono.capital || 0);
  const mora        = Number(abono.mora    || 0);
  const interes     = Number(abono.interes || 0);
  const total       = capital + mora + interes;
  const hubieronDos = capital > 0 && (mora + interes) > 0;
  const esCredito   = deuda.tipo === 'credito';
  const saldado     = Number(abono.saldo_despues ?? 0) <= 0
                   && Number(abono.mora_pendiente || 0) <= 0;

  return (
    <DocumentoTermico
      id="recibo-abono"
      config={config}
      tituloModal="Recibo de abono listo"
      descripcionModal={`Se enviará a la impresora térmica${
        hubieronDos ? ', con el desglose de capital y mora.' : '.'}`}
      onClose={onClose}
    >
      {({ fuenteSize }) => (
        <>
          <EncabezadoNegocio config={config} titulo="RECIBO DE ABONO" fuenteSize={fuenteSize} />

          {deuda.numero != null && (
            <Fila
              label={esCredito ? 'Factura:' : 'Préstamo:'}
              valor={`#${String(deuda.numero).padStart(6, '0')}`}
            />
          )}
          <Fila label="Fecha:" valor={formatFechaHora(abono.fecha || new Date())} />
          {abono.metodo && <Fila label="Forma de pago:" valor={abono.metodo} />}

          <Divisor />

          <div className="negrita">{esCredito ? 'CLIENTE' : 'PRESTATARIO'}</div>
          <Fila label="Nombre:" valor={deuda.persona} />
          {deuda.cedula && deuda.cedula !== 'COMPANERO' && (
            <Fila label="CC:" valor={deuda.cedula} />
          )}
          {deuda.descripcion && (
            <div className="suave" style={{ fontSize: '11px', margin: '2px 0' }}>
              Concepto: {deuda.descripcion}
            </div>
          )}

          <Divisor />

          {/* ── El desglose: es la razón de ser de este recibo ── */}
          <div className="negrita">DETALLE DEL PAGO</div>
          <Fila label="Abono a capital:" valor={formatCOP(capital)} />
          {interes > 0 && <Fila label="Interés financiación:" valor={formatCOP(interes)} />}
          {mora > 0 && <Fila label="Intereses de mora:" valor={formatCOP(mora)} />}
          <Fila label="TOTAL RECIBIDO:" valor={formatCOP(total)} negrita grande />

          <Divisor />

          {/* ── Cómo queda la deuda ── */}
          <div className="negrita">SALDO</div>
          {abono.saldo_antes != null && (
            <Fila label="Deuda anterior:" valor={formatCOP(abono.saldo_antes)} />
          )}
          <Fila label="Deuda actual:" valor={formatCOP(abono.saldo_despues ?? 0)} negrita />
          {Number(abono.interes_pendiente || 0) > 0 && (
            <Fila label="Interés pendiente:" valor={formatCOP(abono.interes_pendiente)} negrita />
          )}
          {Number(abono.mora_pendiente || 0) > 0 && (
            <Fila label="Mora pendiente:" valor={formatCOP(abono.mora_pendiente)} negrita />
          )}

          {/* Si sigue con plazo, se recuerda: es lo que evita reclamos después */}
          {deuda.fecha_limite && (
            <>
              <Divisor />
              <Fila label="Fecha límite de pago:" valor={fechaLegible(deuda.fecha_limite)} />
              {Number(deuda.dias_mora || 0) > 0 && (
                <Fila label="Días de atraso:" valor={String(deuda.dias_mora)} />
              )}
            </>
          )}

          {abono.notas && (
            <>
              <Divisor />
              <div className="suave" style={{ fontSize: '11px' }}>
                Observaciones: {abono.notas}
              </div>
            </>
          )}

          <Divisor />

          <div className="centrado" style={{ marginTop: '6px', fontSize: `${fuenteSize - 2}px` }}>
            {saldado
              ? 'Deuda cancelada en su totalidad. Gracias.'
              : 'Este recibo es válido como comprobante de abono.'}
          </div>
          <div style={{ height: '10mm' }} />
        </>
      )}
    </DocumentoTermico>
  );
}

export default ReciboAbono;
