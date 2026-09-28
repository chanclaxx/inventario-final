// src/modules/servicios/servicios.pdf.controller.js

const { generarPdfServicio, generarPdfRecepcion } = require('./servicios.pdf');
const repo                   = require('./servicios.repository');
const garantiasRepo          = require('../garantias/garantias.repository');
const { pool }               = require('../../config/db');
const { configDocumento }    = require('../../utils/emisor.util');

const getPdfServicio = async (req, res, next) => {
  try {
    const negocioId = req.user.negocio_id;
    const id        = Number(req.params.id);

    const orden = await repo.findById(negocioId, id);
    if (!orden) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });

    const abonos = await repo.getAbonos(negocioId, id);

    const { rows: configRows } = await pool.query(
      'SELECT clave, valor FROM config_negocio WHERE negocio_id = $1',
      [negocioId],
    );
    const configNegocio = {};
    for (const row of configRows) configNegocio[row.clave] = row.valor;
    // El encabezado es el de la sucursal de la orden, si tiene datos propios.
    const config = await configDocumento(negocioId, orden.sucursal_id, configNegocio);

    const garantias = await garantiasRepo.findAll(negocioId);

    generarPdfServicio({ orden, abonos, config, garantias, res });
  } catch (err) {
    next(err);
  }
};

const getPdfRecepcion = async (req, res, next) => {
  try {
    const negocioId = req.user.negocio_id;
    const id        = Number(req.params.id);

    const orden = await repo.findById(negocioId, id);
    if (!orden) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });

    const { rows: configRows } = await pool.query(
      'SELECT clave, valor FROM config_negocio WHERE negocio_id = $1',
      [negocioId],
    );
    const configNegocio = {};
    for (const row of configRows) configNegocio[row.clave] = row.valor;
    // El encabezado es el de la sucursal de la orden, si tiene datos propios.
    const config = await configDocumento(negocioId, orden.sucursal_id, configNegocio);

    generarPdfRecepcion({ orden, config, res });
  } catch (err) {
    next(err);
  }
};

module.exports = { getPdfServicio, getPdfRecepcion };
