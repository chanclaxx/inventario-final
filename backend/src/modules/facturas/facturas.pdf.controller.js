// src/modules/facturas/facturas.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// Agrega el controlador getPdfFactura al controlador existente.
// IMPORTANTE: copiar solo la función nueva — el resto del controlador
// ya existe en tu proyecto y no debe tocarse.
// ─────────────────────────────────────────────────────────────────────────────

const { generarPdfFactura } = require('./facturas.pdf');
const garantiasRepo         = require('../garantias/garantias.repository');
const { pool }              = require('../../config/db');

/**
 * GET /facturas/:id/pdf
 *
 * Genera y descarga el PDF de una factura en formato A4.
 * Requiere que el usuario tenga acceso al negocio al que pertenece la factura.
 */
const getPdfFactura = async (req, res, next) => {
  try {
    // Reutiliza el mismo servicio que ya tienes
    const service = require('./facturas.service');

    const factura = await service.getFacturaById(
      req.user.negocio_id,
      req.params.id
    );

    // Carga configuración del negocio (misma tabla que usa FacturaTermica)
    const { rows: configRows } = await pool.query(
      `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`,
      [req.user.negocio_id]
    );
    const config = {};
    for (const row of configRows) config[row.clave] = row.valor;

    // Carga garantías activas para este negocio
    const garantias = await garantiasRepo.findPorFactura(factura.id);

    generarPdfFactura({ factura, config, garantias, res });
  } catch (err) {
    next(err);
  }
};

module.exports = { getPdfFactura };