const router = require('express').Router();
const { register } = require('./registro.controller');

router.post('/', register);

module.exports = router;