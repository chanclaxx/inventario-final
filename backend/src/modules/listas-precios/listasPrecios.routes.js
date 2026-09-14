const router = require('express').Router();
const multer = require('multer');
const ctrl   = require('./listasPrecios.controller');
const { requireNivel, requirePermisoPreciosLista } = require('../../middlewares/role.middleware');

// Mismos límites y filtro que la importación de inventario: un .xlsx en memoria,
// 10MB. La plantilla más grande posible de un negocio como el más grande de hoy
// (3 sedes × 2.250 nodos × 8 columnas) no llega ni a 1MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const validos = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    cb(null, validos.includes(file.mimetype));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// LEER los precios de lista va con el inventario: son precios de VENTA y el
// vendedor los necesita en el mostrador. No pasan por el candado de costos
// (`costos_solo_admin`) a propósito — esconderle a un vendedor el precio al que
// tiene que vender no protege nada y le impide trabajar.
//
// ESCRIBIRLOS es otra cosa: una lista de precios es la política comercial de la
// empresa y cambiar «Al por mayor» mueve el margen de todas las ventas
// mayoristas de todos los locales a la vez. Por defecto, solo admin_negocio.
//
// DESCARGAR la plantilla también exige el permiso de escritura aunque sea una
// lectura: es el archivo que se edita para volver a subirlo, y ofrecérselo a
// quien después va a recibir un 403 al aplicarlo no ayuda a nadie.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/producto/:productoId', requireNivel('vendedor'), ctrl.getPreciosProducto);

router.put('/nodos', requirePermisoPreciosLista, ctrl.guardarPrecios);

// ── Excel: el mismo archivo de ida y de vuelta ───────────────────────────────
router.get('/plantilla', requirePermisoPreciosLista, ctrl.descargarPlantilla);

// Analiza sin escribir NADA y devuelve qué pasaría. Lo resuelve la misma
// función que después aplica, para que no puedan discrepar.
router.post('/analizar', requirePermisoPreciosLista, upload.single('archivo'), ctrl.analizarExcel);
router.post('/importar', requirePermisoPreciosLista, upload.single('archivo'), ctrl.importarExcel);

module.exports = router;
