const service = require('./archivosCompra.service');
const audit   = require('../../utils/auditoria.util');
const { _proveedorIds } = require('./compras.controller');

// Los anulados (verlos y bajarlos) son del admin: es quien anula y quien tiene
// que poder revisar qué se anuló.
const _alcance = (user) => ({
  proveedorIds: _proveedorIds(user),
  conAnulados:  user.rol === 'admin_negocio',
});

const listar = async (req, res, next) => {
  try {
    const data = await service.listar(req.user.negocio_id, req.params.id, _alcance(req.user));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const adjuntar = async (req, res, next) => {
  try {
    const data = await service.adjuntar(req.user.negocio_id, req.params.id, {
      usuarioId:        req.user.id,
      proveedorIds:     _proveedorIds(req.user),
      buffer:           req.file?.buffer,
      // El nombre viaja también como campo de texto: el que trae el archivo
      // llega en latin1 y deja las tildes hechas «Ã³».
      nombre:           req.body.nombre || req.file?.originalname,
      tipo:             req.body.tipo,
      numero_documento: req.body.numero_documento,
      fecha_documento:  req.body.fecha_documento,
      nota:             req.body.nota,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Archivo adjuntado a compra', 'compras', data.compra_id, {
      sucursal_id:      data.sucursal_id,
      numero:           data.compra_numero,
      archivo_id:       data.id,
      tipo:             data.tipo,
      numero_documento: data.numero_documento,
      nombre:           data.nombre_original,
      bytes:            data.bytes,
    });
    res.status(201).json({ ok: true, data, message: 'Archivo adjuntado' });
  } catch (err) { next(err); }
};

const descargar = async (req, res, next) => {
  try {
    const { ficha, buffer } = await service.descargar(
      req.user.negocio_id, req.params.archivoId, _alcance(req.user));
    // Siempre como adjunto y sin que el navegador adivine el tipo: el archivo
    // lo subió una persona, y aunque el tipo se decidió por su contenido, no
    // se le da la oportunidad de ejecutarse en el origen de la API.
    res.setHeader('Content-Type', ficha.mime);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(ficha.nombre_original)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buffer);
  } catch (err) { next(err); }
};

const anular = async (req, res, next) => {
  try {
    const data = await service.anular(req.user.negocio_id, req.params.archivoId, {
      usuarioId: req.user.id,
      motivo:    req.body.motivo,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Archivo de compra anulado', 'compras', data.compra_id, {
      archivo_id: data.id,
      tipo:       data.tipo,
      nombre:     data.nombre_original,
      motivo:     data.motivo_anulacion,
    });
    res.json({ ok: true, data, message: 'Archivo anulado. Sigue guardado.' });
  } catch (err) { next(err); }
};

module.exports = { listar, adjuntar, descargar, anular };
