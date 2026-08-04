const service  = require('./catalogo.service');
const storage  = require('./catalogo.storage');
const refresco = require('./catalogo.revalidar');
const audit    = require('../../utils/auditoria.util');

// ── Vitrina ─────────────────────────────────────────────────────────────────

const getVitrina = async (req, res, next) => {
  try {
    const data = await service.getVitrina(req.user.negocio_id, req.sucursal_id);
    res.json({
      ok: true,
      data,
      // El frontend necesita saber si puede ofrecer la subida de fotos antes de
      // que el usuario intente subir una y se lleve un 503.
      imagenes_activas: storage.estaActivo(),
      // Mismo criterio para el botón de "Actualizar ahora": si el refresco
      // inmediato no está configurado, no se ofrece.
      refresco_activo:  refresco.estaActivo(),
    });
  } catch (err) { next(err); }
};

const listarVitrinas = async (req, res, next) => {
  try {
    const data = await service.listarVitrinas(req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const guardarVitrina = async (req, res, next) => {
  try {
    const data = await service.guardarVitrina(req.user.negocio_id, req.sucursal_id, req.body);
    audit.registrar(
      req.user.negocio_id, req.user.id,
      data.activo ? 'Catálogo web activado' : 'Catálogo web actualizado',
      'catalogo_sucursal', data.id,
      { sucursal_id: req.sucursal_id, slug: data.slug, activo: data.activo }
    );
    res.json({ ok: true, data, message: 'Catálogo guardado correctamente' });
  } catch (err) { next(err); }
};

// ── Fichas ──────────────────────────────────────────────────────────────────

const listarItems = async (req, res, next) => {
  try {
    const data = await service.listarItems(req.sucursal_id, req.query.tipo);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getItem = async (req, res, next) => {
  try {
    const data = await service.getItemDetalle(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const guardarItem = async (req, res, next) => {
  try {
    const data = await service.guardarItem(req.user.negocio_id, req.sucursal_id, req.body);
    res.json({ ok: true, data, message: 'Ficha guardada correctamente' });
  } catch (err) { next(err); }
};

const publicarMasivo = async (req, res, next) => {
  try {
    const data = await service.publicarMasivo(req.user.negocio_id, req.sucursal_id, req.body);
    audit.registrar(
      req.user.negocio_id, req.user.id,
      req.body.publicado === false ? 'Productos retirados del catálogo' : 'Productos publicados en el catálogo',
      'catalogo_items', null,
      { sucursal_id: req.sucursal_id, tipo: req.body.tipo, cantidad: data.afectados }
    );
    res.json({
      ok: true,
      data,
      message: `${data.afectados} producto${data.afectados === 1 ? '' : 's'} actualizado${data.afectados === 1 ? '' : 's'}`,
    });
  } catch (err) { next(err); }
};

// ── Imágenes ────────────────────────────────────────────────────────────────

const subirImagen = async (req, res, next) => {
  try {
    const data = await service.subirImagen(
      req.user.negocio_id, Number(req.params.id), req.file, req.user.id
    );
    res.status(201).json({ ok: true, data, message: 'Imagen subida correctamente' });
  } catch (err) { next(err); }
};

const eliminarImagen = async (req, res, next) => {
  try {
    await service.eliminarImagen(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, message: 'Imagen eliminada' });
  } catch (err) { next(err); }
};

const reordenarImagenes = async (req, res, next) => {
  try {
    const data = await service.reordenarImagenes(
      req.user.negocio_id, Number(req.params.id), req.body.ids
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const refrescar = async (req, res, next) => {
  try {
    const data = await service.refrescarManual(req.sucursal_id);
    res.json({ ok: true, data, message: 'Catálogo actualizado' });
  } catch (err) { next(err); }
};

// ── Públicos (sin sesión) ───────────────────────────────────────────────────

const getPublico = async (req, res, next) => {
  try {
    const data = await service.getCatalogoPublico(req.params.slug);
    // Cache en el CDN, alineado con el ISR de 30 min de la app pública: un pico
    // de visitas no se traduce en un pico de consultas contra la BD del POS
    // (que además está en el plan gratuito de Supabase, con cupo de salida
    // compartido con la facturación).
    res.set('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600');
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const listarSlugsPublicos = async (req, res, next) => {
  try {
    const data = await service.listarSlugsActivos();
    res.set('Cache-Control', 'public, max-age=900, s-maxage=3600');
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getVitrina, listarVitrinas, guardarVitrina,
  listarItems, getItem, guardarItem, publicarMasivo,
  subirImagen, eliminarImagen, reordenarImagenes, refrescar,
  getPublico, listarSlugsPublicos,
};
