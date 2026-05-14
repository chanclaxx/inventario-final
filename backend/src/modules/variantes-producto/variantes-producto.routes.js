const router           = require('express').Router();
const ctrl             = require('./variantes-producto.controller');
const { requireNivel } = require('../../middlewares/role.middleware');

// Árbol de un producto (todos los roles)
router.get('/:productoId/arbol', ctrl.getArbol);

// Atributos (nivel 1)
router.post('/:productoId/atributos',      requireNivel('admin_negocio'), ctrl.crearAtributo);
router.put('/atributos/:id',               requireNivel('admin_negocio'), ctrl.actualizarAtributo);
router.delete('/atributos/:id',            requireNivel('admin_negocio'), ctrl.eliminarAtributo);
router.patch('/atributos/:id/stock',       requireNivel('admin_negocio'), ctrl.ajustarStockAtributo);

// Variantes (nivel 2)
router.post('/atributos/:atributoId/variantes', requireNivel('admin_negocio'), ctrl.crearVariante);
router.put('/variantes/:id',                    requireNivel('admin_negocio'), ctrl.actualizarVariante);
router.delete('/variantes/:id',                 requireNivel('admin_negocio'), ctrl.eliminarVariante);
router.patch('/variantes/:id/stock',            requireNivel('admin_negocio'), ctrl.ajustarStockVariante);

module.exports = router;
