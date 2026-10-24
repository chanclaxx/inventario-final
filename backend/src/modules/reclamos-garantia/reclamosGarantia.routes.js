// Garantías con proveedores — ver migrations/20261023_reclamos_garantia.sql.
//
// Dos candados, en orden: la función encendida en el negocio (404 si no) y la
// llave granular de cada acción (`permisos_garantias`, null = base del rol).
// No se exige un módulo: se entra desde Facturas, Préstamos, Inventario y
// Proveedores, y cada una de esas pantallas ya exige el suyo.
// Las rutas literales van ANTES de las que llevan `:id`.
const router = require('express').Router();
const { requirePermisoGarantias, puedeGarantias } = require('../../middlewares/role.middleware');
const { requireReclamosGarantia } = require('../../middlewares/reclamosGarantia.middleware');
const ctrl = require('./reclamosGarantia.controller');

router.use(requireReclamosGarantia);

// Un id que no es número (una ruta mal escrita que cae en `/:id`) es un 404,
// no un error de la base al castear «NaN».
for (const p of ['id', 'archivoId', 'proveedorId']) {
  router.param(p, (req, res, next, v) => (/^\d+$/.test(v) && Number(v) > 0
    ? next()
    : res.status(404).json({ ok: false, error: 'No encontrado' })));
}

// Ver un caso para imprimirlo lo puede quien lo recibe aunque no tenga la
// pestaña: el vendedor que entrega el comprobante en el mostrador.
const verOImprimir = (req, res, next) => {
  if (puedeGarantias(req.user, 'ver') || puedeGarantias(req.user, 'recibir')) return next();
  return res.status(403).json({ ok: false, error: 'No tienes permiso para ver las garantías con proveedores' });
};

router.get('/config',       ctrl.config);
// Solo ids y cantidades (el chip «en garantía» del inventario): sin permiso propio.
router.get('/en-inventario', ctrl.enInventario);
router.get('/candidatos',   requirePermisoGarantias('recibir'), ctrl.candidatos);

router.post('/envios',             requirePermisoGarantias('enviar'), ctrl.crearEnvio);
router.get('/envios/:id/pdf',      requirePermisoGarantias('ver'),    ctrl.pdfEnvio);
router.get('/envios/:id',          requirePermisoGarantias('ver'),    ctrl.getEnvio);
router.patch('/envios/:id/anular', requirePermisoGarantias('enviar'), ctrl.anularEnvio);

// Estado de cuenta de las garantías con un proveedor (pantalla y PDF).
router.get('/proveedores/:proveedorId/estado-cuenta/pdf', requirePermisoGarantias('ver'), ctrl.pdfEstadoCuenta);
router.get('/proveedores/:proveedorId/estado-cuenta',     requirePermisoGarantias('ver'), ctrl.estadoCuenta);

// Fotos del producto dañado. Adjuntar lo puede quien recibe; anular, quien
// anula. multer va DESPUÉS de los permisos: quien no puede, no sube 15 MB.
const multer = require('multer');
const { MAX_BYTES } = require('../archivos/archivos.storage');
const _subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 }, defParamCharset: 'utf8' });
const recibirFoto = (req, res, next) => _subida.single('archivo')(req, res, (err) => {
  if (!err) return next();
  return res.status(400).json({
    ok: false,
    error: err.code === 'LIMIT_FILE_SIZE' ? `La foto supera los ${Math.round(MAX_BYTES / 1024 / 1024)} MB` : 'No se pudo leer la foto enviada',
  });
});
router.get('/archivos/:archivoId/descargar', verOImprimir, ctrl.descargarFoto);
router.patch('/archivos/:archivoId/anular',  requirePermisoGarantias('anular'), ctrl.anularFoto);
router.post('/:id/archivos', requirePermisoGarantias('recibir'), recibirFoto, ctrl.adjuntarFoto);

router.post('/lineas/:id/cliente',   ctrl.resolverCliente); // la llave depende del tipo (controlador)
router.post('/lineas/:id/proveedor', requirePermisoGarantias('resolver'), ctrl.resolverProveedor);
router.patch('/movimientos/:id/anular', requirePermisoGarantias('anular'), ctrl.anularMovimiento);

router.get('/',             requirePermisoGarantias('ver'),     ctrl.listar);
router.post('/',            requirePermisoGarantias('recibir'), ctrl.crear);
router.get('/:id/pdf',      verOImprimir,                      ctrl.pdfReclamo);
router.get('/:id',          verOImprimir,                      ctrl.detalle);
router.patch('/:id/anular', requirePermisoGarantias('anular'),  ctrl.anularReclamo);

module.exports = router;
