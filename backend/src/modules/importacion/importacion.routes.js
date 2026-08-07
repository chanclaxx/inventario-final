const router = require('express').Router();
const multer = require('multer');
const { requireNivel } = require('../../middlewares/role.middleware');
const ctrl = require('./importacion.controller');

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

// Descarga la plantilla generada dinámicamente según la config del negocio
router.get('/plantilla',   requireNivel('supervisor'), ctrl.generarPlantilla);

// Previsualiza: corre la importación completa dentro de una transacción que se
// revierte, y devuelve el informe de lo que pasaría. NO escribe nada.
router.post('/analizar',   requireNivel('supervisor'), upload.single('archivo'), ctrl.analizarInventario);

// Importa el archivo Excel al inventario
router.post('/inventario', requireNivel('supervisor'), upload.single('archivo'), ctrl.importarInventario);

module.exports = router;
