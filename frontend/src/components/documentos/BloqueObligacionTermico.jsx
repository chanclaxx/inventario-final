import { formatCOP, formatFecha } from '../../utils/formatters';
import { Divisor, Fila } from './DocumentoTermico';

/**
 * Estado de la obligación e historial de abonos, en formato ticket.
 *
 * Consume el objeto `resumen` que calcula el backend (utils/obligacion.js), el
 * MISMO que imprime el PDF. Aquí no se suma ni se deduce nada: si el ticket y
 * el PDF pudieran calcular por su cuenta, tarde o temprano dirían cosas
 * distintas y el cliente se quedaría con el papel que le convenga.
 */

/** Texto legible de la condición de mora pactada (espejo del backend). */
function describirCondicion(cond) {
  if (!cond) return null;
  const base = cond.tipo === 'diaria_fija'
    ? `${formatCOP(cond.valor)} por día de atraso`
    : `${cond.valor}% mensual sobre el saldo`;
  const extras = [];
  if (Number(cond.dias_gracia) > 0) extras.push(`${cond.dias_gracia} día(s) de gracia`);
  if (cond.tope_pct)                extras.push(`tope ${cond.tope_pct}%`);
  return extras.length ? `${base} (${extras.join(', ')})` : base;
}

// ─── Estado y cifras ──────────────────────────────────────────────────────────

export function EstadoObligacionTermico({ resumen, fuenteSize = 13 }) {
  if (!resumen) return null;

  return (
    <>
      <Divisor />
      <div className="centrado negrita">
        {resumen.tipo === 'credito' ? 'VENTA A CRÉDITO' : 'PRÉSTAMO'}
      </div>
      <div className="recuadro centrado negrita" style={{ fontSize: `${fuenteSize}px` }}>
        ESTADO: {resumen.estado_label}
      </div>

      {resumen.devuelto > 0 && (
        <>
          <Fila label="Valor original:" valor={formatCOP(resumen.valor_original)} />
          <Fila label="Devoluciones:"   valor={`- ${formatCOP(resumen.devuelto)}`} />
        </>
      )}
      <Fila
        label={resumen.tipo === 'credito' ? 'Valor de la venta:' : 'Valor del préstamo:'}
        valor={formatCOP(resumen.valor_actual)}
      />
      {resumen.cuota_inicial > 0 && (
        <>
          <Fila label="Cuota inicial:"   valor={`- ${formatCOP(resumen.cuota_inicial)}`} />
          <Fila label="Valor financiado:" valor={formatCOP(resumen.financiado)} />
        </>
      )}
      <Fila
        label={`Total abonado (${resumen.num_abonos}):`}
        valor={`- ${formatCOP(resumen.total_abonado)}`}
      />

      <div className="linea-punteada" />
      <Fila label="SALDO PENDIENTE:" valor={formatCOP(resumen.saldo)} negrita grande />

      {/* Fechas y plazo */}
      {(resumen.fecha_limite || resumen.fecha_ultimo_abono) && (
        <>
          <div className="linea-punteada" />
          <Fila label="Emisión:" valor={formatFecha(resumen.fecha_emision)} />
          {resumen.fecha_limite && (
            <>
              <Fila label="Vence:" valor={resumen.fecha_limite_txt} />
              {resumen.plazo_dias != null && (
                <Fila label="Plazo:" valor={`${resumen.plazo_dias} día(s)`} />
              )}
            </>
          )}
          {resumen.fecha_ultimo_abono && (
            <Fila label="Último abono:" valor={formatFecha(resumen.fecha_ultimo_abono)} />
          )}
          {resumen.vencido && resumen.dias_atraso > 0 && (
            <Fila label="Días de atraso:" valor={String(resumen.dias_atraso)} negrita />
          )}
          {Number(resumen.mora?.pendiente || 0) > 0 && (
            <Fila label="Mora causada:" valor={formatCOP(resumen.mora.pendiente)} negrita />
          )}
        </>
      )}
    </>
  );
}

// ─── Historial de abonos ──────────────────────────────────────────────────────

/**
 * Fecha · método · valor · saldo restante. La última columna es la que hace del
 * ticket un historial de pagos y no solo un comprobante suelto.
 */
export function HistorialAbonosTermico({ resumen }) {
  if (!resumen) return null;

  const abonos     = resumen.abonos || [];
  const hayInicial = resumen.cuota_inicial > 0;
  if (!abonos.length && !hayInicial) {
    return (
      <>
        <Divisor />
        <div className="negrita">HISTORIAL DE PAGOS</div>
        <div className="suave" style={{ fontSize: '11px' }}>Sin abonos registrados a la fecha.</div>
      </>
    );
  }

  return (
    <>
      <Divisor />
      <div className="negrita">HISTORIAL DE PAGOS</div>
      <table className="tabla-abonos">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Forma</th>
            <th className="der">Valor</th>
            <th className="der">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {hayInicial && (
            <tr>
              <td>{formatFecha(resumen.fecha_emision)}</td>
              <td className="negrita">Cuota inic.</td>
              <td className="der">{formatCOP(resumen.cuota_inicial)}</td>
              <td className="der">{formatCOP(resumen.financiado)}</td>
            </tr>
          )}
          {abonos.map((ab, i) => (
            <tr key={ab.id ?? i}>
              <td>{formatFecha(ab.fecha)}</td>
              <td>{ab.metodo}</td>
              <td className="der">{formatCOP(ab.valor)}</td>
              <td className="der">{formatCOP(ab.saldo_despues)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="linea-punteada" />
      <Fila label="Total abonado:" valor={formatCOP(resumen.total_abonado)} negrita />
      <Fila label="Saldo restante:" valor={formatCOP(resumen.saldo)} negrita />
    </>
  );
}

// ─── Condiciones de pago ──────────────────────────────────────────────────────

export function CondicionesTermico({ resumen }) {
  if (!resumen?.fecha_limite) return null;
  const desc = describirCondicion(resumen.condicion);

  return (
    <>
      <Divisor />
      <div className="negrita">CONDICIONES DE PAGO</div>
      <Fila label="Saldo a pagar:" valor={formatCOP(resumen.saldo)} />
      <Fila label="Fecha límite:"  valor={resumen.fecha_limite_txt} />
      {desc && (
        <div className="suave" style={{ fontSize: '11px', margin: '2px 0' }}>
          Interés por mora: {desc}
        </div>
      )}
      <div className="suave" style={{ fontSize: '10px', marginTop: '3px', textAlign: 'justify' }}>
        {desc
          ? 'El cliente declara conocer y aceptar el plazo y el interés de mora aquí pactados. '
            + 'La mora se liquida sobre el saldo de capital pendiente, por los días de atraso.'
          : 'El cliente declara conocer y aceptar el plazo de pago aquí pactado.'}
      </div>
    </>
  );
}
