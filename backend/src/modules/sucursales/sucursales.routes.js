const router = require('express').Router();
const { pool }         = require('../../config/db');
const { requireNivel } = require('../../middlewares/role.middleware');

// GET /api/sucursales — lista sucursales del negocio
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, direccion, telefono, activa
       FROM sucursales WHERE negocio_id = $1 ORDER BY id`,
      [req.user.negocio_id]
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DATOS DE LA SUCURSAL PARA LOS DOCUMENTOS (`sucursales_documento`)
//
// Nombre comercial, NIT, dirección, teléfono y logo con que se imprimen las
// facturas, préstamos, recibos y demás documentos de ESA sede. Campo vacío =
// se hereda del negocio (Ajustes → Negocio). Ver `utils/emisor.util.js`.
// ─────────────────────────────────────────────────────────────────────────────
const { hayDatosDocumentoSucursal } = require('../../config/columnas');
const CAMPOS_DOC = ['nombre_comercial', 'nit', 'direccion', 'telefono'];
const TOPE_TEXTO = 200;
const TOPE_LOGO  = 1024 * 1024;   // el navegador lo comprime a 400 px en JPEG

const _sinTabla = (res) => res.status(503).json({
  ok: false, error: 'Los datos por sucursal aún no están instalados en la base de datos.',
});

// GET /api/sucursales/documentos — los datos de TODAS las sedes del negocio,
// SIN el logo: los tickets POS no lo imprimen, y así cualquier usuario los
// resuelve sin bajar imágenes. Sin la tabla, lista vacía (todo hereda).
router.get('/documentos', async (req, res, next) => {
  try {
    if (!hayDatosDocumentoSucursal()) return res.json({ ok: true, data: [] });
    const { rows } = await pool.query(
      `SELECT sd.sucursal_id, sd.nombre_comercial, sd.nit, sd.direccion, sd.telefono,
              (sd.logo IS NOT NULL AND sd.logo <> '') AS tiene_logo
       FROM sucursales_documento sd
       JOIN sucursales s ON s.id = sd.sucursal_id
       WHERE s.negocio_id = $1
       ORDER BY sd.sucursal_id`,
      [req.user.negocio_id]
    );
    res.json({ ok: true, data: rows });
  } catch (err) { next(err); }
});

// GET /api/sucursales/:id/documento — la de una sede, CON logo (para editarla).
router.get('/:id/documento', requireNivel('admin_negocio'), async (req, res, next) => {
  try {
    const { rows: [suc] } = await pool.query(
      'SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2', [req.params.id, req.user.negocio_id]);
    if (!suc) return res.status(404).json({ ok: false, error: 'Sucursal no encontrada' });
    if (!hayDatosDocumentoSucursal()) return res.json({ ok: true, data: null });
    const { rows } = await pool.query(
      `SELECT sucursal_id, nombre_comercial, nit, direccion, telefono, logo
       FROM sucursales_documento WHERE sucursal_id = $1`, [suc.id]);
    res.json({ ok: true, data: rows[0] || null });
  } catch (err) { next(err); }
});

// PUT /api/sucursales/:id/documento — guarda los datos; todo vacío borra la fila.
router.put('/:id/documento', requireNivel('admin_negocio'), async (req, res, next) => {
  try {
    if (!hayDatosDocumentoSucursal()) return _sinTabla(res);
    const { rows: [suc] } = await pool.query(
      'SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2', [req.params.id, req.user.negocio_id]);
    if (!suc) return res.status(404).json({ ok: false, error: 'Sucursal no encontrada' });

    const datos = {};
    for (const c of CAMPOS_DOC) {
      const v = req.body?.[c] == null ? '' : String(req.body[c]).trim();
      if (v.length > TOPE_TEXTO) {
        return res.status(400).json({ ok: false, error: `El campo ${c.replace('_', ' ')} es demasiado largo` });
      }
      datos[c] = v || null;
    }
    const logo = req.body?.logo == null ? '' : String(req.body.logo).trim();
    if (logo && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(logo)) {
      return res.status(400).json({ ok: false, error: 'El logo tiene que ser una imagen PNG, JPG o WEBP' });
    }
    if (logo.length > TOPE_LOGO) {
      return res.status(400).json({ ok: false, error: 'El logo es demasiado grande' });
    }
    datos.logo = logo || null;

    // Todo vacío = la sede vuelve a heredar del negocio: no queda fila.
    if (Object.values(datos).every((v) => v == null)) {
      await pool.query('DELETE FROM sucursales_documento WHERE sucursal_id = $1', [suc.id]);
      return res.json({ ok: true, data: null });
    }
    const { rows: [fila] } = await pool.query(
      `INSERT INTO sucursales_documento
         (sucursal_id, nombre_comercial, nit, direccion, telefono, logo, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (sucursal_id) DO UPDATE SET
         nombre_comercial = EXCLUDED.nombre_comercial, nit = EXCLUDED.nit,
         direccion = EXCLUDED.direccion, telefono = EXCLUDED.telefono,
         logo = EXCLUDED.logo, actualizado_en = NOW()
       RETURNING sucursal_id, nombre_comercial, nit, direccion, telefono, logo`,
      [suc.id, datos.nombre_comercial, datos.nit, datos.direccion, datos.telefono, datos.logo]
    );
    res.json({ ok: true, data: fila });
  } catch (err) { next(err); }
});

// POST /api/sucursales — crear sucursal (solo admin_negocio)
// POST — crear sucursal
router.post('/', requireNivel('admin_negocio'), async (req, res, next) => {
  try {
    const { nombre, direccion, telefono } = req.body;
    if (!nombre?.trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre es requerido' });
    }

    const { rows: [negocio] } = await pool.query(
      'SELECT max_sucursales FROM negocios WHERE id = $1',
      [req.user.negocio_id]
    );
    const { rows: [conteo] } = await pool.query(
      'SELECT COUNT(*) AS total FROM sucursales WHERE negocio_id = $1 AND activa = true',
      [req.user.negocio_id]
    );
    if (parseInt(conteo.total) >= negocio.max_sucursales) {
      return res.status(400).json({
        ok: false,
        error: `Tu plan permite máximo ${negocio.max_sucursales} sucursal(es)`,
      });
    }

    const { rows: [nueva] } = await pool.query(
      `INSERT INTO sucursales(negocio_id, nombre, direccion, telefono)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, direccion, telefono, activa`,
      [req.user.negocio_id, nombre.trim(), direccion || null, telefono || null]
    );
    res.status(201).json({ ok: true, data: nueva });
  } catch (err) { next(err); }
});

// PUT — editar sucursal
router.put('/:id', requireNivel('admin_negocio'), async (req, res, next) => {
  try {
    const { nombre, direccion, telefono } = req.body;
    if (!nombre?.trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre es requerido' });
    }

    const { rows: [actualizada] } = await pool.query(
      `UPDATE sucursales SET nombre = $1, direccion = $2, telefono = $3
       WHERE id = $4 AND negocio_id = $5
       RETURNING id, nombre, direccion, telefono, activa`,
      [nombre.trim(), direccion || null, telefono || null,
       req.params.id, req.user.negocio_id]
    );
    if (!actualizada) {
      return res.status(404).json({ ok: false, error: 'Sucursal no encontrada' });
    }
    res.json({ ok: true, data: actualizada });
  } catch (err) { next(err); }
});

// PATCH — toggle activa/inactiva
router.patch('/:id/toggle', requireNivel('admin_negocio'), async (req, res, next) => {
  try {
    const { rows: [sucursal] } = await pool.query(
      'SELECT id, activa FROM sucursales WHERE id = $1 AND negocio_id = $2',
      [req.params.id, req.user.negocio_id]
    );
    if (!sucursal) {
      return res.status(404).json({ ok: false, error: 'Sucursal no encontrada' });
    }

    // ── Impedir desactivar la última sucursal activa ──────────────
    if (sucursal.activa) {
      const { rows: [conteo] } = await pool.query(
        'SELECT COUNT(*) AS total FROM sucursales WHERE negocio_id = $1 AND activa = true',
        [req.user.negocio_id]
      );
      if (parseInt(conteo.total) <= 1) {
        return res.status(400).json({
          ok: false,
          error: 'No puedes desactivar la única sucursal activa del negocio',
        });
      }
    }

    const { rows: [actualizada] } = await pool.query(
      'UPDATE sucursales SET activa = $1 WHERE id = $2 RETURNING id, nombre, activa',
      [!sucursal.activa, req.params.id]
    );
    res.json({ ok: true, data: actualizada });
  } catch (err) { next(err); }
});
module.exports = router;