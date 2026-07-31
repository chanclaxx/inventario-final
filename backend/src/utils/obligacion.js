'use strict';

/**
 * ESTADO DE UNA OBLIGACIÓN — única fuente de verdad para todos los documentos.
 *
 * Créditos y préstamos son la misma cosa desde el punto de vista del cliente:
 * una deuda con saldo, abonos y (a veces) plazo y mora. Este módulo la resume
 * UNA vez, y de aquí beben la factura PDF, el ticket POS, el aviso de mora, el
 * paz y salvo y el comprobante de préstamo.
 *
 * Nadie más debe recalcular un saldo ni deducir un estado: si mañana cambia la
 * regla, cambia aquí y cambia en los cinco documentos a la vez.
 *
 * NO calcula la mora — esa fórmula vive en mora.util.js y llega ya resuelta.
 */

const num = (v) => Number(v || 0);

/**
 * Estados posibles, con el color/semántica que usan los documentos.
 *
 * La etiqueta concuerda con el sujeto: una FACTURA está "PAGADA", un PRÉSTAMO
 * está "PAGADO". Un préstamo tampoco se "anula": se devuelve el artículo.
 */
const ESTADOS = {
  pendiente: { credito: 'PENDIENTE', prestamo: 'PENDIENTE', tono: 'naranja', descripcion: 'Sin abonos registrados'       },
  parcial:   { credito: 'ABONADA',   prestamo: 'ABONADO',   tono: 'azul',    descripcion: 'Con abonos, saldo pendiente'  },
  pagada:    { credito: 'PAGADA',    prestamo: 'PAGADO',    tono: 'verde',   descripcion: 'Obligación cancelada'         },
  vencida:   { credito: 'VENCIDA',   prestamo: 'VENCIDO',   tono: 'rojo',    descripcion: 'Pasó la fecha límite de pago' },
  anulada:   { credito: 'ANULADA',   prestamo: 'DEVUELTO',  tono: 'gris',    descripcion: 'Documento sin efecto'         },
};

/** dd/mm/aaaa a partir de un DATE o TIMESTAMP, sin corrimiento de zona. */
const fechaCorta = (valor) => {
  if (!valor) return null;
  const f = String(valor instanceof Date ? valor.toISOString() : valor).slice(0, 10);
  const [a, m, d] = f.split('-');
  if (!a || !m || !d) return null;
  return `${d}/${m}/${a}`;
};

/** Días calendario entre dos fechas (solo la parte de fecha, sin horas). */
const diasEntre = (desde, hasta) => {
  if (!desde || !hasta) return null;
  const a = new Date(String(desde).slice(0, 10) + 'T00:00:00Z');
  const b = new Date(String(hasta).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
};

/**
 * Resume una obligación para los documentos.
 *
 * @param {object} opts
 * @param {'credito'|'prestamo'} opts.tipo
 * @param {object} opts.documento  — fila de `creditos` o de `prestamos`
 * @param {Array}  opts.abonos     — filas de abonos_credito / abonos_prestamo (cronológicas)
 * @param {object} [opts.mora]     — estado de mora ya calculado por mora.service
 * @param {number} [opts.devuelto] — valor devuelto (solo créditos), para el valor original
 */
const resumirObligacion = ({ tipo, documento, abonos = [], mora = null, devuelto = 0 }) => {
  const esCredito = tipo === 'credito';

  // ── Cifras base ───────────────────────────────────────────────────────────
  // En créditos `valor_total` YA viene rebajado por las devoluciones, así que el
  // valor original de la venta se reconstruye sumándolas (mismo criterio que el
  // estado de cuenta: cargo − devoluciones = valor_total).
  const valorActual   = esCredito ? num(documento.valor_total) : num(documento.valor_prestamo);
  const valorOriginal = valorActual + num(devuelto);
  const cuotaInicial  = esCredito ? num(documento.cuota_inicial) : 0;
  const totalAbonado  = num(documento.total_abonado);
  const financiado    = Math.max(0, valorActual - cuotaInicial);
  const saldo         = Math.max(0, valorActual - cuotaInicial - totalAbonado);
  const pagado        = cuotaInicial + totalAbonado;

  // ── Fechas y plazo ────────────────────────────────────────────────────────
  const fechaEmision = esCredito ? documento.creado_en : documento.fecha;
  const fechaLimite  = documento.fecha_limite || null;
  const plazoDias    = fechaLimite ? diasEntre(fechaEmision, fechaLimite) : null;

  // ── Estado ────────────────────────────────────────────────────────────────
  const anulado = esCredito
    ? documento.estado === 'Cancelado'
    : documento.estado === 'Devuelto';

  let clave;
  if (anulado)                     clave = 'anulada';
  else if (saldo <= 0)             clave = 'pagada';
  else if (mora?.vencido)          clave = 'vencida';
  else if (pagado > 0)             clave = 'parcial';
  else                             clave = 'pendiente';

  // ── Historial de abonos con saldo corrido ─────────────────────────────────
  // El saldo arranca en lo financiado (el valor menos la cuota inicial, que ya
  // se pagó al momento de la venta) y baja con cada abono. Es exactamente la
  // columna "Saldo" que el cliente quiere ver en el recibo.
  let corriendo = financiado;
  const historial = [...abonos]
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
    .map((ab) => {
      const valor = num(ab.valor);
      corriendo = Math.max(0, corriendo - valor);
      return {
        id:            ab.id,
        fecha:         ab.fecha,
        valor,
        metodo:        ab.metodo || 'Efectivo',
        notas:         ab.notas || null,
        // Se conserva el nombre original del campo: esta lista ES la que
        // consume el historial de la pantalla, no una copia paralela.
        usuario_nombre: ab.usuario_nombre || null,
        saldo_despues: corriendo,
      };
    });

  const ultimoAbono = historial.length ? historial[historial.length - 1] : null;

  return {
    tipo,
    numero:        esCredito ? (documento.factura_numero ?? documento.factura_id) : (documento.numero ?? documento.id),
    estado:        clave,
    estado_label:  ESTADOS[clave][tipo],
    estado_tono:   ESTADOS[clave].tono,
    estado_desc:   ESTADOS[clave].descripcion,
    anulado,
    pagada:        saldo <= 0 && !anulado,

    valor_original: valorOriginal,
    valor_actual:   valorActual,
    devuelto:       num(devuelto),
    cuota_inicial:  cuotaInicial,
    financiado,
    total_abonado:  totalAbonado,
    total_pagado:   pagado,
    saldo,
    // Porcentaje cubierto, para la barra de progreso de los documentos.
    avance_pct:     valorActual > 0 ? Math.min(100, Math.round((pagado / valorActual) * 100)) : 0,

    fecha_emision:  fechaEmision,
    fecha_emision_txt: fechaCorta(fechaEmision),
    fecha_limite:   fechaLimite,
    fecha_limite_txt: fechaCorta(fechaLimite),
    plazo_dias:     plazoDias,
    dias_atraso:    mora?.dias_vencidos ?? 0,
    vencido:        !!mora?.vencido,

    mora:           mora || null,
    condicion:      documento.mora_condicion || null,

    abonos:         historial,
    num_abonos:     historial.length,
    ultimo_abono:   ultimoAbono,
    fecha_ultimo_abono:     ultimoAbono?.fecha ?? null,
    fecha_ultimo_abono_txt: fechaCorta(ultimoAbono?.fecha),
  };
};

/** Texto legible de la condición de mora pactada. */
const describirCondicion = (cond) => {
  if (!cond) return null;
  const base = cond.tipo === 'diaria_fija'
    ? `$${Math.round(num(cond.valor)).toLocaleString('es-CO')} por cada día de atraso`
    : `${cond.valor}% mensual sobre el saldo pendiente`;
  const extras = [];
  if (num(cond.dias_gracia) > 0) extras.push(`${cond.dias_gracia} día(s) de gracia`);
  if (cond.tope_pct)             extras.push(`tope ${cond.tope_pct}% del saldo`);
  return extras.length ? `${base} (${extras.join(', ')})` : base;
};

module.exports = { resumirObligacion, describirCondicion, ESTADOS, fechaCorta, diasEntre };
