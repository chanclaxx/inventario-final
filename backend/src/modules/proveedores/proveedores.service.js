const { pool } = require('../../config/db');
const repo = require('./proveedores.repository');

const getProveedores = (negocioId, tipo = null) => repo.findAll(negocioId, tipo);

const getProveedorById = async (negocioId, id) => {
  const p = await repo.findById(negocioId, id);
  if (!p) throw { status: 404, message: 'Proveedor no encontrado' };
  return p;
};

// ─── Crear proveedor + acreedor automático ────────────────────────────────────

const crearProveedor = async (negocioId, datos) => {
  if (datos.nit) {
    const existe = await repo.findByNit(negocioId, datos.nit);
    if (existe) throw { status: 409, message: `Ya existe un proveedor con el NIT ${datos.nit}` };
  }

  const proveedor = await repo.create(negocioId, datos);

  // Crear acreedor vinculado automáticamente (si no existe ya)
  await vincularOCrearAcreedor(negocioId, proveedor);

  return proveedor;
};

const actualizarProveedor = async (negocioId, id, datos) => {
  const p = await repo.update(negocioId, id, datos);
  if (!p) throw { status: 404, message: 'Proveedor no encontrado' };

  // Sincronizar datos del acreedor vinculado (si existe)
  await sincronizarAcreedor(negocioId, p);

  return p;
};

const eliminarProveedor = async (negocioId, id) => {
  const dependencias = await repo.contarDependenciasActivas(negocioId, id);
  if (dependencias.productos > 0) {
    throw {
      status: 409,
      message: `No se puede eliminar: el proveedor tiene ${dependencias.productos} producto(s) activo(s) vinculado(s)`,
    };
  }
  const ok = await repo.eliminar(negocioId, id);
  if (!ok) throw { status: 404, message: 'Proveedor no encontrado' };
};

// ─── Helper: vincular o crear acreedor para un proveedor ──────────────────────
//
// Lógica segura contra duplicados:
// 1. Si ya existe un acreedor con proveedor_id = proveedor.id → no hacer nada
// 2. Si existe un acreedor con la misma cédula (NIT) sin proveedor_id → vincularlo
// 3. Si la cédula ya está ocupada por otro proveedor → usar fallback prov-{id}
// 4. Si no existe ninguno → crear nuevo
//
// Usa transacción con FOR UPDATE para evitar race conditions.

async function vincularOCrearAcreedor(negocioId, proveedor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. ¿Ya existe un acreedor vinculado a este proveedor?
    const { rows: yaVinculado } = await client.query(
      `SELECT id FROM acreedores
       WHERE negocio_id = $1 AND proveedor_id = $2
       LIMIT 1 FOR UPDATE`,
      [negocioId, proveedor.id]
    );
    if (yaVinculado.length > 0) {
      await client.query('COMMIT');
      return;
    }

    const cedulaAcreedor = proveedor.nit?.trim() || `prov-${proveedor.id}`;

    // 2. ¿Existe un acreedor con esa cédula pero sin proveedor vinculado?
    const { rows: porCedula } = await client.query(
      `SELECT id FROM acreedores
       WHERE negocio_id = $1 AND cedula = $2 AND proveedor_id IS NULL
       LIMIT 1 FOR UPDATE`,
      [negocioId, cedulaAcreedor]
    );
    if (porCedula.length > 0) {
      await client.query(
        `UPDATE acreedores SET proveedor_id = $1, nombre = $2
         WHERE id = $3`,
        [proveedor.id, proveedor.nombre, porCedula[0].id]
      );
      await client.query('COMMIT');
      return;
    }

    // 3. ¿Cédula ocupada por otro proveedor? → usar fallback
    const { rows: cedulaOcupada } = await client.query(
      `SELECT id FROM acreedores
       WHERE negocio_id = $1 AND cedula = $2
       LIMIT 1`,
      [negocioId, cedulaAcreedor]
    );
    if (cedulaOcupada.length > 0) {
      await client.query(
        `INSERT INTO acreedores(negocio_id, nombre, cedula, telefono, proveedor_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [negocioId, proveedor.nombre, `prov-${proveedor.id}`, proveedor.telefono || '', proveedor.id]
      );
      await client.query('COMMIT');
      return;
    }

    // 4. Crear nuevo
    await client.query(
      `INSERT INTO acreedores(negocio_id, nombre, cedula, telefono, proveedor_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [negocioId, proveedor.nombre, cedulaAcreedor, proveedor.telefono || '', proveedor.id]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // No lanzar error — el proveedor ya fue creado exitosamente.
    // Si el acreedor falla se puede vincular manualmente después.
    console.error(`[proveedores.service] Error al crear acreedor para proveedor ${proveedor.id}:`, err.message || err);
  } finally {
    client.release();
  }
}

// ─── Helper: sincronizar datos del acreedor cuando se edita el proveedor ─────
//
// Actualiza nombre y teléfono del acreedor vinculado.
// Si el proveedor no tiene acreedor aún, lo crea (por si es un proveedor viejo).

async function sincronizarAcreedor(negocioId, proveedor) {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM acreedores
       WHERE negocio_id = $1 AND proveedor_id = $2
       LIMIT 1`,
      [negocioId, proveedor.id]
    );

    if (rows.length > 0) {
      // Actualizar nombre y teléfono del acreedor existente
      await pool.query(
        `UPDATE acreedores SET nombre = $1, telefono = $2
         WHERE id = $3`,
        [proveedor.nombre, proveedor.telefono || '', rows[0].id]
      );
    } else {
      // Proveedor viejo sin acreedor — crearlo ahora
      await vincularOCrearAcreedor(negocioId, proveedor);
    }
  } catch (err) {
    console.error(`[proveedores.service] Error al sincronizar acreedor del proveedor ${proveedor.id}:`, err.message || err);
  }
}

module.exports = {
  getProveedores, getProveedorById,
  crearProveedor, actualizarProveedor, eliminarProveedor,
};