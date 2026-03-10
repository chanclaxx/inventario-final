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

// POST /api/sucursales — crear sucursal (solo admin_negocio)
router.post('/', requireNivel('admin_negocio'), async (req, res, next) => {
  try {
    const { nombre, direccion, telefono } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

    // Verificar límite del plan
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
        error: `Tu plan permite máximo ${negocio.max_sucursales} sucursal(es)`,
      });
    }

    const { rows: [nueva] } = await pool.query(
      `INSERT INTO sucursales (negocio_id, nombre, direccion, telefono)
       VALUES ($1, $2, $3, $4) RETURNING id, nombre, direccion, telefono, activa`,
      [req.user.negocio_id, nombre, direccion || null, telefono || null]
    );
    res.status(201).json({ ok: true, data: nueva });
  } catch (err) { next(err); }
});

// PUT /api/sucursales/:id — editar sucursal
router.put('/:id', requireNivel('admin_negocio'), async (req, res, next) => {
  try {
    const { nombre, direccion, telefono } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

    const { rows: [actualizada] } = await pool.query(
      `UPDATE sucursales SET nombre = $1, direccion = $2, telefono = $3
       WHERE id = $4 AND negocio_id = $5
       RETURNING id, nombre, direccion, telefono, activa`,
      [nombre, direccion || null, telefono || null, req.params.id, req.user.negocio_id]
    );
    if (!actualizada) return res.status(404).json({ error: 'Sucursal no encontrada' });
    res.json({ ok: true, data: actualizada });
  } catch (err) { next(err); }
});

// PATCH /api/sucursales/:id/toggle — activar/desactivar
router.patch('/:id/toggle', requireNivel('admin_negocio'), async (req, res, next) => {
  try {
    const { rows: [sucursal] } = await pool.query(
      'SELECT id, activa FROM sucursales WHERE id = $1 AND negocio_id = $2',
      [req.params.id, req.user.negocio_id]
    );
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });

    const { rows: [actualizada] } = await pool.query(
      `UPDATE sucursales SET activa = $1 WHERE id = $2 RETURNING id, nombre, activa`,
      [!sucursal.activa, req.params.id]
    );
    res.json({ ok: true, data: actualizada });
  } catch (err) { next(err); }
});

module.exports = router;