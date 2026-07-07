const { pool } = require('../../config/db');
const repo     = require('./vendedores.repository');

// ── _validarSucursalDelNegocio ────────────────────────────────────────────────
// Impide asignar un vendedor a una sucursal que no sea del negocio autenticado.

const _validarSucursalDelNegocio = async (sucursalId, negocioId) => {
  const { rows } = await pool.query(
    'SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2',
    [sucursalId, negocioId]
  );
  if (!rows.length) {
    throw { status: 403, message: 'La sucursal no pertenece a este negocio' };
  }
};

// ── getVendedores ─────────────────────────────────────────────────────────────
// filtros: { sucursalId, soloActivos }

const getVendedores = (negocioId, filtros = {}) => repo.findAll(negocioId, filtros);

// ── crearVendedor ─────────────────────────────────────────────────────────────

const crearVendedor = async (negocioId, { nombre, sucursal_id }) => {
  if (!nombre?.trim()) {
    throw { status: 400, message: 'El nombre del vendedor es requerido' };
  }
  if (!sucursal_id) {
    throw { status: 400, message: 'Debes asignar una sucursal al vendedor' };
  }
  await _validarSucursalDelNegocio(sucursal_id, negocioId);

  try {
    return await repo.create({ negocioId, sucursalId: sucursal_id, nombre: nombre.trim() });
  } catch (err) {
    if (err.code === '23505') {
      throw { status: 409, message: 'Ya existe un vendedor con ese nombre en esa sucursal' };
    }
    throw err;
  }
};

// ── actualizarVendedor ────────────────────────────────────────────────────────

const actualizarVendedor = async (negocioId, id, { nombre, sucursal_id, activo }) => {
  const vendedor = await repo.findById(id, negocioId);
  if (!vendedor) throw { status: 404, message: 'Vendedor no encontrado' };

  if (sucursal_id) {
    await _validarSucursalDelNegocio(sucursal_id, negocioId);
  }

  try {
    const actualizado = await repo.update(id, negocioId, {
      nombre:      nombre?.trim() || undefined,
      sucursalId:  sucursal_id,
      activo,
    });
    if (!actualizado) throw { status: 404, message: 'Vendedor no encontrado' };
    return actualizado;
  } catch (err) {
    if (err.code === '23505') {
      throw { status: 409, message: 'Ya existe un vendedor con ese nombre en esa sucursal' };
    }
    throw err;
  }
};

module.exports = {
  getVendedores,
  crearVendedor,
  actualizarVendedor,
};
