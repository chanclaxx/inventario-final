const service = require('./vendedores.service');

// ── getVendedores ─────────────────────────────────────────────────────────────
// Gestión del admin: todos los vendedores del negocio (con su sucursal).
// Filtro opcional ?sucursal_id=X.

const getVendedores = async (req, res, next) => {
  try {
    const sucursalId = req.query.sucursal_id ? Number(req.query.sucursal_id) : undefined;
    const data = await service.getVendedores(req.user.negocio_id, { sucursalId });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ── getVendedoresActivos ──────────────────────────────────────────────────────
// Para el desplegable de facturación: solo vendedores ACTIVOS de la sucursal
// resuelta por el middleware (req.sucursal_id). Funciona para todos los roles.

const getVendedoresActivos = async (req, res, next) => {
  try {
    const data = await service.getVendedores(req.user.negocio_id, {
      sucursalId:  req.sucursal_id,
      soloActivos: true,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearVendedor = async (req, res, next) => {
  try {
    const data = await service.crearVendedor(req.user.negocio_id, req.body);
    res.status(201).json({ ok: true, data, message: 'Vendedor creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarVendedor = async (req, res, next) => {
  try {
    const data = await service.actualizarVendedor(
      req.user.negocio_id, Number(req.params.id), req.body
    );
    res.json({ ok: true, data, message: 'Vendedor actualizado correctamente' });
  } catch (err) { next(err); }
};

module.exports = {
  getVendedores,
  getVendedoresActivos,
  crearVendedor,
  actualizarVendedor,
};
