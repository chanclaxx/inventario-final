const router = require('express').Router();
const multer = require('multer');
const { requireNivel }  = require('../../middlewares/role.middleware');
const { requireModulo } = require('../../middlewares/modulo.middleware');
const { requireCatalogo } = require('./catalogo.middleware');
const ctrl = require('./catalogo.controller');

// El filtro real de imágenes se hace por magic bytes en catalogo.storage.js —
// el `mimetype` que llega aquí lo escribe el navegador y se puede falsificar.
// Este filtro solo evita gastar ancho de banda en lo obviamente incorrecto.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_, file, cb) => cb(null, /^image\//.test(file.mimetype || '')),
});

router.use(requireCatalogo);

// ── Vitrina ────────────────────────────────────────────────────────────────
// Leerla la puede cualquiera del equipo: compartir el enlace con el cliente es
// justamente el trabajo del vendedor. Configurarla, solo el dueño del negocio.
router.get('/vitrina',      requireNivel('vendedor'),      ctrl.getVitrina);
router.get('/vitrinas',     requireNivel('admin_negocio'), ctrl.listarVitrinas);
router.put('/vitrina',      requireNivel('admin_negocio'), ctrl.guardarVitrina);

// ── Fichas de producto — quien administra el inventario ────────────────────
// No se crea una clave de módulo nueva a propósito: publicar es una acción
// sobre el inventario, así que hereda ese permiso y no cambia los permisos de
// ningún usuario existente.
router.get('/items',            requireModulo('inventario'), requireNivel('supervisor'), ctrl.listarItems);
router.put('/items',            requireModulo('inventario'), requireNivel('supervisor'), ctrl.guardarItem);
router.patch('/items/publicar', requireModulo('inventario'), requireNivel('supervisor'), ctrl.publicarMasivo);
// Detalle con las URLs de las fotos. Va DESPUÉS de /items/publicar para que esa
// ruta no se coma como :id — aunque los métodos difieran, el orden es lo que
// mantiene la intención legible.
router.get('/items/:id',        requireModulo('inventario'), requireNivel('supervisor'), ctrl.getItem);

// ── Imágenes ───────────────────────────────────────────────────────────────
router.post('/items/:id/imagenes',  requireModulo('inventario'), requireNivel('supervisor'), upload.single('imagen'), ctrl.subirImagen);
router.patch('/items/:id/imagenes', requireModulo('inventario'), requireNivel('supervisor'), ctrl.reordenarImagenes);
router.delete('/imagenes/:id',      requireModulo('inventario'), requireNivel('supervisor'), ctrl.eliminarImagen);

module.exports = router;
