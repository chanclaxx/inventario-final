const service    = require('./creditos.service');
const pdfService = require('./creditos.pdf.service');
const audit      = require('../../utils/auditoria.util');
const { pool }   = require('../../config/db');

// La clave del cliente es `cedula` o, si no tiene, su nombre: la misma con la
// que la pantalla agrupa las tarjetas.
const _clave = (req) => String(req.query.clave ?? '').trim();

const _getLogoNegocio = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'logo_negocio'`,
    [negocioId]
  );
  return rows[0]?.valor || null;
};

const getCreditos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getCreditos(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getCreditoById = async (req, res, next) => {
  try {
    const data = await service.getCreditoById(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const data = await service.registrarAbono(req.user.negocio_id, Number(req.params.id), {
      ...req.body,
      usuario_id: req.user.id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Abono a crédito', 'creditos', Number(req.params.id), {
      sucursal_id: data.sucursal_id ?? null,
      monto:       Number(req.body.monto ?? 0),
      saldo_nuevo: Number(data.saldo    ?? 0),
    });
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const saldarCredito = async (req, res, next) => {
  try {
    await service.saldarCredito(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, message: 'Crédito saldado correctamente' });
  } catch (err) { next(err); }
};

const cancelarCredito = async (req, res, next) => {
  try {
    await service.cancelarCredito(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, message: 'Crédito cancelado correctamente' });
  } catch (err) { next(err); }
};

// ── Estado de cuenta ─────────────────────────────────────────────────────────

const getEstadoCuenta = async (req, res, next) => {
  try {
    const clave = _clave(req);
    if (!clave) return res.status(400).json({ ok: false, error: 'Falta la cédula o el nombre del cliente' });

    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getEstadoCuenta(req.user.negocio_id, clave, sucursalId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const exportarPdfEstadoCuenta = async (req, res, next) => {
  try {
    const clave = _clave(req);
    if (!clave) return res.status(400).json({ ok: false, error: 'Falta la cédula o el nombre del cliente' });

    const sucursalId  = req.todasSucursales ? null : req.sucursal_id;
    const logoNegocio = await _getLogoNegocio(req.user.negocio_id);

    const pdfStream = await pdfService.generarPdfEstadoCuenta({
      clave,
      negocioId:     req.user.negocio_id,
      negocioNombre: req.user?.negocio_nombre || '',
      logoNegocio,
      sucursalId,
    });

    const filename = `estado-cuenta-credito-${Date.now()}.pdf`;
    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfStream.pipe(res);
  } catch (err) { next(err); }
};

// ── Mora ─────────────────────────────────────────────────────────────────────

const fijarPlazo = async (req, res, next) => {
  try {
    const data = await service.fijarPlazo(req.user.negocio_id, Number(req.params.id), {
      fecha_limite: req.body.fecha_limite ?? null,
      condicion_id: req.body.condicion_id,
      rol:          req.user.rol,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Plazo de pago de crédito', 'creditos', Number(req.params.id), {
      fecha_limite: data.fecha_limite,
    });
    res.json({ ok: true, data, message: data.fecha_limite ? 'Plazo actualizado' : 'Plazo eliminado' });
  } catch (err) { next(err); }
};

const condonarMora = async (req, res, next) => {
  try {
    const data = await service.condonarMora(req.user.negocio_id, Number(req.params.id), {
      valor:      req.body.valor,
      motivo:     req.body.motivo,
      pin:        req.body.pin,
      quitar_plazo: req.body.quitar_plazo === true,
      usuario_id: req.user.id,
      rol:        req.user.rol,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Condonación de mora', 'creditos', Number(req.params.id), {
      valor:  Number(data.movimiento?.valor ?? 0),
      motivo: req.body.motivo,
    });
    res.json({ ok: true, data, message: 'Mora condonada' });
  } catch (err) { next(err); }
};

const cobrarMora = async (req, res, next) => {
  try {
    const data = await service.cobrarMora(req.user.negocio_id, Number(req.params.id), {
      valor:      req.body.valor,
      metodo:     req.body.metodo,
      usuario_id: req.user.id,
    });
    res.json({ ok: true, data, message: 'Mora cobrada' });
  } catch (err) { next(err); }
};

module.exports = {
  getCreditos, getCreditoById, registrarAbono, saldarCredito, cancelarCredito,
  getEstadoCuenta, exportarPdfEstadoCuenta,
  fijarPlazo, condonarMora, cobrarMora,
};