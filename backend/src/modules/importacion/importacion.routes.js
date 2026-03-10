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

router.post('/inventario', requireNivel('supervisor'), upload.single('archivo'), ctrl.importarInventario);

module.exports = router;