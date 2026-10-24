const service = require('./reclamosGarantia.service');
const audit   = require('../../utils/auditoria.util');
const { puedeGarantias, MENSAJES_GARANTIAS } = require('../../middlewares/role.middleware');

const _ok = (res, data, extra = {}) => res.json({ ok: true, data, ...extra });

// Lo que mueve plata o una unidad DENTRO de otra operación (la respuesta al
// cliente al recibir) se decide aquí, con la misma llave que su propia ruta:
// si no, recibir con reembolso sería la puerta de atrás.
const _exigirLlaveCliente = (user, tipo) => {
  if (!tipo) return;
  const llave = tipo === 'reembolso' ? 'reembolsar' : 'cliente';
  if (!puedeGarantias(user, llave)) throw { status: 403, message: MENSAJES_GARANTIAS[llave] };
};

const _enviarPdf = (res, doc, nombre) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
  doc.pipe(res);
};

const archivos = require('./reclamosGarantia.archivos');

// Para la pantalla: la función, el umbral y si hay dónde guardar fotos.
const config = (req, res) => _ok(res, { ...req.reclamosCfg, fotos_activas: archivos.activas() });

const estadoCuenta = async (req, res, next) => {
  try {
    _ok(res, await service.estadoCuentaProveedor(req.user, req.sucursal_id, Number(req.params.proveedorId), req.query));
  } catch (err) { next(err); }
};

const pdfEstadoCuenta = async (req, res, next) => {
  try {
    const pdf = require('./reclamosGarantia.pdf');
    const doc = await pdf.generarPdfEstadoCuenta(req.user, req.sucursal_id, Number(req.params.proveedorId), req.query);
    _enviarPdf(res, doc, `garantias-proveedor-${req.params.proveedorId}.pdf`);
  } catch (err) { next(err); }
};

const adjuntarFoto = async (req, res, next) => {
  try {
    const data = await archivos.adjuntar(req.user, Number(req.params.id), req.file, { nota: req.body?.nota });
    audit.registrar(req.user.negocio_id, req.user.id, 'Garantía: foto adjunta', 'reclamos_garantia_archivos', data.id, {
      reclamo_id: Number(req.params.id), nombre: data.nombre_original, bytes: data.tamano_bytes,
    });
    res.status(201).json({ ok: true, data, message: 'Foto guardada' });
  } catch (err) { next(err); }
};

const descargarFoto = async (req, res, next) => {
  try {
    const { buffer, mime, nombre } = await archivos.descargar(req.user, Number(req.params.archivoId));
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  } catch (err) { next(err); }
};

const anularFoto = async (req, res, next) => {
  try {
    const data = await archivos.anular(req.user, Number(req.params.archivoId), req.body?.motivo);
    audit.registrar(req.user.negocio_id, req.user.id, 'Garantía: foto anulada', 'reclamos_garantia_archivos', data.id, { motivo: data.anulado_motivo });
    _ok(res, data, { message: 'Foto anulada' });
  } catch (err) { next(err); }
};

const candidatos = async (req, res, next) => {
  try { _ok(res, await service.buscarCandidatos(req.user, req.sucursal_id, req.query)); } catch (err) { next(err); }
};

const enInventario = async (req, res, next) => {
  try { _ok(res, await service.enInventario(req.user, req.sucursal_id)); } catch (err) { next(err); }
};

const listar = async (req, res, next) => {
  try { _ok(res, await service.listar(req.user, req.sucursal_id, req.query, req.reclamosCfg)); } catch (err) { next(err); }
};

const detalle = async (req, res, next) => {
  try { _ok(res, await service.detalle(req.user, Number(req.params.id))); } catch (err) { next(err); }
};

const crear = async (req, res, next) => {
  try {
    _exigirLlaveCliente(req.user, req.body?.resolucion_cliente?.tipo);
    const data = await service.crear(req.user, req.sucursal_id, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Producto recibido en garantía', 'reclamos_garantia', data.reclamo.id, {
      numero: data.reclamo.numero, origen: data.reclamo.origen_tipo, producto: data.linea.nombre_producto,
      imei: data.linea.imei, cantidad: data.linea.cantidad, cliente: data.movimiento_cliente?.tipo || null,
    });
    res.status(201).json({ ok: true, data, message: `Garantía #${data.reclamo.numero ?? data.reclamo.id} registrada` });
  } catch (err) { next(err); }
};

const resolverCliente = async (req, res, next) => {
  try {
    _exigirLlaveCliente(req.user, req.body?.tipo || 'cambio');
    const data = await service.resolverCliente(req.user, Number(req.params.id), req.body);
    audit.registrar(req.user.negocio_id, req.user.id, `Garantía: ${data.tipo === 'reembolso' ? 'dinero devuelto al cliente' : 'otra unidad al cliente'}`,
      'reclamos_garantia_movimientos', data.id, { valor: Number(data.valor), cantidad: data.cantidad, imei: data.imei });
    res.status(201).json({ ok: true, data, message: data.tipo === 'reembolso' ? 'Devolución registrada' : 'Entrega registrada' });
  } catch (err) { next(err); }
};

const crearEnvio = async (req, res, next) => {
  try {
    const data = await service.crearEnvio(req.user, req.sucursal_id, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Envío de garantía al proveedor', 'envios_garantia', data.id, {
      numero: data.numero, proveedor: data.proveedor_nombre, lineas: data.lineas,
    });
    res.status(201).json({ ok: true, data, message: `Envío #${data.numero ?? data.id} registrado` });
  } catch (err) { next(err); }
};

const getEnvio = async (req, res, next) => {
  try { _ok(res, await service.getEnvio(req.user, Number(req.params.id))); } catch (err) { next(err); }
};

const anularEnvio = async (req, res, next) => {
  try {
    const data = await service.anularEnvio(req.user, Number(req.params.id), req.body?.motivo);
    audit.registrar(req.user.negocio_id, req.user.id, 'Envío de garantía anulado', 'envios_garantia', data.id, { motivo: data.anulado_motivo });
    _ok(res, data, { message: 'Envío anulado' });
  } catch (err) { next(err); }
};

const resolverProveedor = async (req, res, next) => {
  try {
    const data = await service.resolverProveedor(req.user, Number(req.params.id), req.body);
    audit.registrar(req.user.negocio_id, req.user.id, `Garantía: respuesta del proveedor (${data.tipo})`,
      'reclamos_garantia_movimientos', data.id, { valor: Number(data.valor), cantidad: data.cantidad, destino: data.destino, imei: data.imei });
    res.status(201).json({ ok: true, data, message: 'Respuesta del proveedor registrada' });
  } catch (err) { next(err); }
};

const anularMovimiento = async (req, res, next) => {
  try {
    const data = await service.anularMovimiento(req.user, Number(req.params.id), req.body?.motivo);
    audit.registrar(req.user.negocio_id, req.user.id, 'Garantía: movimiento anulado', 'reclamos_garantia_movimientos', data.id, {
      tipo: data.tipo, motivo: data.anulado_motivo,
    });
    _ok(res, data, { message: 'Movimiento anulado' });
  } catch (err) { next(err); }
};

const anularReclamo = async (req, res, next) => {
  try {
    const data = await service.anularReclamo(req.user, Number(req.params.id), req.body?.motivo);
    audit.registrar(req.user.negocio_id, req.user.id, 'Garantía anulada', 'reclamos_garantia', data.id, { motivo: data.anulado_motivo });
    _ok(res, data, { message: 'Garantía anulada' });
  } catch (err) { next(err); }
};

const pdfReclamo = async (req, res, next) => {
  try {
    const pdf = require('./reclamosGarantia.pdf');
    const doc = await pdf.generarPdfReclamo(req.user, Number(req.params.id));
    _enviarPdf(res, doc, `garantia-${req.params.id}.pdf`);
  } catch (err) { next(err); }
};

const pdfEnvio = async (req, res, next) => {
  try {
    const pdf = require('./reclamosGarantia.pdf');
    const doc = await pdf.generarPdfEnvio(req.user, Number(req.params.id));
    _enviarPdf(res, doc, `envio-garantia-${req.params.id}.pdf`);
  } catch (err) { next(err); }
};

module.exports = {
  config, candidatos, enInventario, listar, detalle, crear, resolverCliente,
  crearEnvio, getEnvio, anularEnvio, resolverProveedor, anularMovimiento, anularReclamo,
  pdfReclamo, pdfEnvio, estadoCuenta, pdfEstadoCuenta, adjuntarFoto, descargarFoto, anularFoto,
};
