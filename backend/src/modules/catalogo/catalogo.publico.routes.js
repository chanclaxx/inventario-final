const router = require('express').Router();
const { requireCatalogo } = require('./catalogo.middleware');
const ctrl = require('./catalogo.controller');

// ─────────────────────────────────────────────────────────────────────────────
// Rutas PÚBLICAS del catálogo — sin autenticación, sin cookies, solo GET.
//
// Se montan antes que las rutas protegidas y fuera del rate limiter global de
// 60 req/min (ver index.js): ese límite está pensado para una sesión humana, y
// aquí el tráfico llega desde el renderizador de la app pública, es decir desde
// unas pocas IPs con volumen agregado.
//
// Todo lo que responden sale de catalogo.publico.repository.js, que tiene lista
// blanca de columnas. Ninguna ruta de aquí escribe en la base de datos.
// ─────────────────────────────────────────────────────────────────────────────

router.use(requireCatalogo);

// Slugs activos — alimenta el prerenderizado y el sitemap de la app pública.
router.get('/slugs',  ctrl.listarSlugsPublicos);

router.get('/:slug',  ctrl.getPublico);

module.exports = router;
