const { generarPdfCuentaAcreedor, generarPdfResumenDeuda } = require('./acreedores.pdf');
const service = require('./acreedores.service');
const repo    = require('./acreedores.repository');
const { pool } = require('../../config/db');

const getPdfCuentaAcreedor = async (req, res, next) => {
  try {
    const { negocio_id } = req.user;
    const acreedorId = req.params.id;
    const formato = req.query.formato === 'resumen' ? 'resumen' : 'estado';

    const acreedor = await repo.findById(negocio_id, acreedorId);
    if (!acreedor) return next({ status: 404, message: 'Acreedor no encontrado' });

    const { rows: configRows } = await pool.query(
      `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`,
      [negocio_id]
    );
    const config = {};
    for (const row of configRows) config[row.clave] = row.valor;

    const saldoAFavor = await repo.getSaldoAFavor(negocio_id, acreedorId);

    if (formato === 'resumen') {
      const cargos = await repo.getComprasConSaldo(negocio_id, acreedorId);
      generarPdfResumenDeuda({ acreedor, cargos, saldoAFavor, config, res });
    } else {
      const movimientos = await repo.getMovimientos(negocio_id, acreedorId);
      generarPdfCuentaAcreedor({ acreedor, movimientos, saldoAFavor, config, res });
    }
  } catch (err) {
    next(err);
  }
};

module.exports = { getPdfCuentaAcreedor };
