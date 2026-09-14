// src/modules/facturas/facturas.controller.js
// ─────────────────────────────────────────────────────────────────────────────
// Agrega el controlador getPdfFactura al controlador existente.
// IMPORTANTE: copiar solo la función nueva — el resto del controlador
// ya existe en tu proyecto y no debe tocarse.
// ─────────────────────────────────────────────────────────────────────────────

const { generarPdfFactura } = require('./facturas.pdf');
const garantiasRepo         = require('../garantias/garantias.repository');
const { pool }              = require('../../config/db');


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

    // Toda venta a crédito imprime el estado de la obligación: saldo, abonos y
    // —si se pactó plazo— las condiciones de mora junto a la firma (en Colombia
    // el interés moratorio solo es exigible si se pactó por escrito).
    //
    // `getFacturaById` ya devuelve el crédito con su mora, sus abonos y el
    // resumen ya calculado; una venta de contado no trae crédito y el PDF sale
    // exactamente como antes.
    const credito = factura.credito?.resumen ? factura.credito : null;

    // Lo que se editó o corrigió después de emitida, contado en el PDF. Solo en
    // crédito: es donde una cifra distinta a la de la venta confunde la cuenta.
    // Leer la auditoría nunca puede impedir que el PDF salga.
    let ajustes = [];
    if (credito) {
      try {
        const facturasRepo = require('./facturas.repository');
        const { describirAjustes } = require('../../utils/ajustesFactura');
        ajustes = describirAjustes(
          await facturasRepo.getAjustesAuditoria(req.user.negocio_id, factura.id),
          { abonos: factura.credito.abonos || [], lineas: factura.lineas || [] },
        );
      } catch (err) {
        console.warn('[facturas] Ajustes no incluidos en el PDF:', err.message);
      }
    }

    generarPdfFactura({ factura, config, garantias, credito, ajustes, res });
  } catch (err) {
    next(err);
  }
};

module.exports = { getPdfFactura };