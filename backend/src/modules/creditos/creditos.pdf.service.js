'use strict';

/**
 * PDF de estado de cuenta de un cliente a crédito.
 *
 * Solo carga datos: el dibujo lo hace utils/estadoCuenta.pdf.js (el mismo que
 * usan los préstamos) y los movimientos los calcula creditos.service, que es la
 * única fuente de verdad del saldo. Por eso el PDF, el Excel y la pantalla no
 * pueden mostrar cifras distintas.
 */

const { pool } = require('../../config/db');
const { construirPdfEstadoCuenta } = require('../../utils/estadoCuenta.pdf');
const service = require('./creditos.service');

// Mismos colores que los badges de la pantalla (EstadoCuentaCredito.jsx).
const TIPO_LABEL = {
  credito:          { label: 'Factura',      bg: '#FFFBEB', text: '#D97706' },
  cuota_inicial:    { label: 'Cuota inic.',  bg: '#EFF6FF', text: '#2563EB' },
  abono:            { label: 'Abono',        bg: '#ECFDF5', text: '#059669' },
  devolucion:       { label: 'Devolución',   bg: '#FFF7ED', text: '#EA580C' },
  ajuste:           { label: 'Ajuste',       bg: '#F5F3FF', text: '#7C3AED' },
  mora_cobro:       { label: 'Mora',         bg: '#FEF2F2', text: '#DC2626' },
  mora_condonacion: { label: 'Mora cond.',   bg: '#F3F4F6', text: '#6B7280' },
};

const generarPdfEstadoCuenta = async ({ clave, negocioId, negocioNombre, logoNegocio, sucursalId = null }) => {
  const { persona, movimientos, saldoFinal } =
    await service.getResumenCuenta(negocioId, clave, sucursalId);

  const { rows: configRows } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`,
    [negocioId]
  );
  const config = {};
  for (const row of configRows) config[row.clave] = row.valor;

  // Los créditos anulados se listan en gris y sin saldo, igual que un préstamo
  // devuelto: quedan como constancia pero no arrastran deuda.
  const movsPdf = movimientos.map((m) => {
    const anulado = m.credito_estado === 'Cancelado';
    return { ...m, nota: anulado ? 'Anulado' : null, atenuado: anulado };
  });

  return construirPdfEstadoCuenta({
    persona,
    subtitulo: 'Cliente · Facturas a crédito',
    movimientos: movsPdf,
    saldoFinal,
    config,
    logoNegocio,
    tipoLabels: TIPO_LABEL,
    negocioNombre,
  });
};

module.exports = { generarPdfEstadoCuenta, TIPO_LABEL };
