const service = require('./proveedores.service');

const getProveedores = async (req, res, next) => {
  try {
    const tiposPermitidos = ['proveedor', 'cruce'];
    const tipo = tiposPermitidos.includes(req.query.tipo) ? req.query.tipo : null;

    // Si el usuario no es admin y tiene lista restringida, filtrar por IDs
    let ids = null;
    if (req.user.rol !== 'admin_negocio') {
      const permisos = req.user.permisos_proveedores;
      if (permisos && !permisos.ver_todos && Array.isArray(permisos.ver_lista) && permisos.ver_lista.length > 0) {
        ids = permisos.ver_lista;
      }
    }

    const data = await service.getProveedores(req.user.negocio_id, tipo, ids);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProveedorById = async (req, res, next) => {
  try {
    // Non-admin con lista restringida: validar acceso a este proveedor específico
    if (req.user.rol !== 'admin_negocio') {
      const permisos = req.user.permisos_proveedores;
      if (permisos && !permisos.ver_todos && Array.isArray(permisos.ver_lista)) {
        if (!permisos.ver_lista.includes(Number(req.params.id))) {
          return res.status(403).json({ ok: false, error: 'Sin acceso a este proveedor' });
        }
      }
    }
    const data = await service.getProveedorById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearProveedor = async (req, res, next) => {
  try {
    const data = await service.crearProveedor(req.user.negocio_id, req.body);
    res.status(201).json({ ok: true, data, message: 'Proveedor creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarProveedor = async (req, res, next) => {
  try {
    const data = await service.actualizarProveedor(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Proveedor actualizado correctamente' });
  } catch (err) { next(err); }
};

const eliminarProveedor = async (req, res, next) => {
  try {
    await service.eliminarProveedor(req.user.negocio_id, req.params.id);
    res.json({ ok: true, message: 'Proveedor eliminado correctamente' });
  } catch (err) { next(err); }
};

module.exports = { getProveedores, getProveedorById, crearProveedor, actualizarProveedor, eliminarProveedor };
