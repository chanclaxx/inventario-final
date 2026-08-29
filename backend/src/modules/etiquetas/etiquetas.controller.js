const service = require('./etiquetas.service');

// Todas las acciones son por SUCURSAL: el código de un nodo es único por sede y
// el stock que decide cuántas etiquetas imprimir también lo es. Sin sucursal
// resuelta no hay pregunta que responder, igual que en la exportación.
const _exigirSucursal = (req, res) => {
  if (req.sucursal_id) return true;
  res.status(400).json({
    ok: false,
    error: 'Selecciona una sucursal para imprimir sus etiquetas',
  });
  return false;
};

const getFormatos = (req, res) => {
  res.json({ ok: true, data: service.listarFormatos() });
};

const getNodos = async (req, res, next) => {
  try {
    if (!_exigirSucursal(req, res)) return;
    const data = await service.listar(req.user.negocio_id, req.sucursal_id, {
      q:            req.query.q,
      lineaId:      req.query.linea_id,
      ubicacion:    req.query.ubicacion,
      soloConStock: req.query.con_stock === '1',
      codigo:       req.query.codigo,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const postPlan = async (req, res, next) => {
  try {
    if (!_exigirSucursal(req, res)) return;
    const data = await service.planear(req.user.negocio_id, req.sucursal_id, req.body || {});
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// El PDF se escribe directo en la respuesta (stream), como el de facturas. Por
// eso el try/catch solo puede atrapar lo que falle ANTES del primer byte: una
// vez empezó a salir el PDF ya no se le pueden poner cabeceras de error.
const postPdf = async (req, res, next) => {
  try {
    if (!_exigirSucursal(req, res)) return;
    await service.construirPdf(req.user.negocio_id, req.sucursal_id, req.body || {}, res);
  } catch (err) { next(err); }
};

const postGenerarCodigos = async (req, res, next) => {
  try {
    if (!_exigirSucursal(req, res)) return;
    const data = await service.generarCodigos(req.user.negocio_id, req.sucursal_id, req.body || {});
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = { getFormatos, getNodos, postPlan, postPdf, postGenerarCodigos };
