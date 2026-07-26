const service = require('./redInterna.service');
const audit   = require('../../utils/auditoria.util');

// ── Panel principal: una sola ruta, dos caras ────────────────────────────────
// La UI no elige la vista: la decide el backend según la sucursal activa.
// Así el usuario de un local nunca ve las opciones de la bodega, ni al revés.
const getPanel = async (req, res, next) => {
  try {
    const data = req.esBodega
      ? await service.getPanelBodega(req)
      : await service.getPanelLocal(req);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getSucursales = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getSucursalesRed(req) });
  } catch (err) { next(err); }
};

// ── Remisiones ───────────────────────────────────────────────────────────────

const buscarParaDespacho = async (req, res, next) => {
  try {
    const data = await service.buscarParaDespacho(req, req.query.imei);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const despachar = async (req, res, next) => {
  try {
    const { sucursal_destino_id, lineas, notas, clave_idempotencia } = req.body;
    const data = await service.despachar(req, {
      sucursal_destino_id, lineas, notas, clave_idempotencia,
    });
    if (!data.repetido) {
      audit.registrar(req.user.negocio_id, req.user.id, 'Remisión despachada', 'red_interna', data.id, {
        sucursal_id:         Number(req.sucursal_id),
        sucursal_destino_id: Number(sucursal_destino_id),
        items:               (lineas || []).length,
        valor_total:         data.valor_total,
      });
    }
    res.status(201).json({ ok: true, data, message: 'Remisión enviada' });
  } catch (err) { next(err); }
};

const recibir = async (req, res, next) => {
  try {
    const { lineas_recibidas, cantidades } = req.body;
    const data = await service.recibir(req, Number(req.params.id), {
      lineas_recibidas, cantidades,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Remisión recibida', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
      recibidas:   data.recibidas,
      faltantes:   data.faltantes,
    });
    res.json({
      ok: true, data,
      message: data.faltantes
        ? `Recibiste ${data.recibidas}. ${data.faltantes} quedaron reportados como no llegados.`
        : 'Recepción confirmada',
    });
  } catch (err) { next(err); }
};

const anularRemision = async (req, res, next) => {
  try {
    const data = await service.anularRemision(req, Number(req.params.id));
    audit.registrar(req.user.negocio_id, req.user.id, 'Remisión anulada', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
    });
    res.json({ ok: true, data, message: 'Remisión anulada' });
  } catch (err) { next(err); }
};

const devolver = async (req, res, next) => {
  try {
    const { lineas, notas } = req.body;
    const data = await service.devolver(req, { lineas, notas });
    audit.registrar(req.user.negocio_id, req.user.id, 'Devolución a bodega', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
      items:       (lineas || []).length,
    });
    res.status(201).json({ ok: true, data, message: 'Devolución registrada' });
  } catch (err) { next(err); }
};

const listarRemisiones = async (req, res, next) => {
  try {
    const data = await service.listarRemisiones(req, {
      estado: req.query.estado,
      limit:  Math.min(Number(req.query.limit) || 50, 200),
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getRemision = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getRemision(req, Number(req.params.id)) });
  } catch (err) { next(err); }
};

// ── Remesas de efectivo ──────────────────────────────────────────────────────

const enviarRemesa = async (req, res, next) => {
  try {
    const { valor, notas, clave_idempotencia } = req.body;
    const data = await service.enviarRemesa(req, { valor, notas, clave_idempotencia });
    if (!data.repetido) {
      audit.registrar(req.user.negocio_id, req.user.id, 'Remesa enviada', 'red_interna', data.id, {
        sucursal_id: Number(req.sucursal_id), valor: data.valor,
      });
    }
    res.status(201).json({ ok: true, data, message: 'Remesa enviada' });
  } catch (err) { next(err); }
};

const confirmarRemesa = async (req, res, next) => {
  try {
    const data = await service.confirmarRemesa(req, Number(req.params.id));
    audit.registrar(req.user.negocio_id, req.user.id, 'Remesa confirmada', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id), valor: data.valor,
    });
    res.json({ ok: true, data, message: 'Remesa confirmada' });
  } catch (err) { next(err); }
};

const anularRemesa = async (req, res, next) => {
  try {
    const data = await service.anularRemesa(req, Number(req.params.id));
    audit.registrar(req.user.negocio_id, req.user.id, 'Remesa anulada', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
    });
    res.json({ ok: true, data, message: 'Remesa anulada' });
  } catch (err) { next(err); }
};

const listarRemesas = async (req, res, next) => {
  try {
    const data = await service.listarRemesas(req, {
      estado: req.query.estado,
      limit:  Math.min(Number(req.query.limit) || 50, 200),
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ── Cuenta interna ───────────────────────────────────────────────────────────

const gastoAutorizado = async (req, res, next) => {
  try {
    const data = await service.registrarGastoAutorizado(req, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Gasto por cuenta de bodega', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id), valor: data.valor,
    });
    res.status(201).json({ ok: true, data, message: 'Gasto registrado' });
  } catch (err) { next(err); }
};

const ajuste = async (req, res, next) => {
  try {
    const data = await service.registrarAjuste(req, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Ajuste de cuenta interna', 'red_interna', data.id, {
      sucursal_id: Number(req.body.sucursal_id), valor: data.valor,
    });
    res.status(201).json({ ok: true, data, message: 'Ajuste registrado' });
  } catch (err) { next(err); }
};

const getMovimientosCuenta = async (req, res, next) => {
  try {
    const data = await service.getMovimientosCuenta(req, req.query.sucursal);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ── Conciliación y salud ─────────────────────────────────────────────────────

const getConciliacion = async (req, res, next) => {
  try {
    const data = await service.getConciliacion(req, req.params.sucursalId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getSalud = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getSalud(req) });
  } catch (err) { next(err); }
};

module.exports = {
  getPanel, getSucursales,
  buscarParaDespacho, despachar, recibir, anularRemision, devolver,
  listarRemisiones, getRemision,
  enviarRemesa, confirmarRemesa, anularRemesa, listarRemesas,
  gastoAutorizado, ajuste, getMovimientosCuenta,
  getConciliacion, getSalud,
};
