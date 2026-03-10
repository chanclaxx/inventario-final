const router = require('express').Router();
const { auth } = require('../../middlewares/auth.middleware');
const ctrl = require('./auth.controller');

router.post('/login',   ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout',  ctrl.logout);
router.get('/me',       auth, ctrl.me);

module.exports = router;