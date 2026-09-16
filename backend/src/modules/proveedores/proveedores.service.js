const { pool } = require('../../config/db');
const repo = require('./proveedores.repository');

const configRepo = require('../config/config.repository');
const codigoProveedor = require('../../utils/codigoProveedor.util');
const { hayCodigoProveedor } = require('../../config/columnas');

// ── Código del proveedor ─────────────────────────────────────────────────────
//
// Lo que le falta a un proveedor para recibir código se DERIVA al leer, nunca se
// guarda: basta con que alguien complete la ciudad para que deje de faltar, y un
// campo guardado se quedaría diciendo lo contrario. Solo se anota a quien no
// tiene código — el que ya lo tiene no pierde nada si después le borran el NIT.
const _anotarCodigo = (p) => {
  if (!p || !hayCodigoProveedor()) return p;
  return { ...p, codigo_faltantes: p.codigo ? [] : codigoProveedor.faltantes(p) };
};

const _codigoActivo = async (negocioId) =>
  hayCodigoProveedor() && codigoProveedor.activo(await configRepo.getMap(negocioId));

/**
 * Después de guardar: si la feature está encendida y el proveedor no tiene
 * código, intenta dárselo. Tolerante — el proveedor ya quedó guardado y un
 * código que no se pudo asignar no puede convertir eso en un error.
 */
const _asignarSiToca = async (negocioId, proveedor) => {
  if (proveedor.codigo || !(await _codigoActivo(negocioId))) return proveedor;
  await codigoProveedor.asignarCodigos(negocioId, { ids: [proveedor.id], tolerante: true });
  return (await repo.findById(negocioId, proveedor.id)) || proveedor;
};

const getProveedores = async (negocioId, tipo = null, ids = null) => {
  const filas = ids !== null
    ? await repo.findByIds(negocioId, ids, tipo)
    : await repo.findAll(negocioId, tipo);
  return filas.map(_anotarCodigo);
};

const getProveedorById = async (negocioId, id) => {
  const p = await repo.findById(negocioId, id);
  if (!p) throw { status: 404, message: 'Proveedor no encontrado' };
  return _anotarCodigo(p);
};

/**
 * «Asignar códigos pendientes» de la pantalla de proveedores. No es tolerante:
 * aquí el usuario pidió exactamente esto, y el error es la respuesta.
 */
const asignarCodigosPendientes = async (negocioId) => {
  if (!(await _codigoActivo(negocioId))) {
    throw { status: 400, message: 'Activa el código de proveedor en Ajustes antes de asignar códigos.' };
  }
  return codigoProveedor.asignarCodigos(negocioId);
};

// ─── Crear proveedor + acreedor automático ────────────────────────────────────

const crearProveedor = async (negocioId, datos) => {
  if (datos.nit) {
    const existe = await repo.findByNit(negocioId, datos.nit);
    if (existe) throw { status: 409, message: `Ya existe un proveedor con el NIT ${datos.nit}` };
  }

  if (datos.nombre?.trim()) {
    const existeNombre = await repo.findByNombre(negocioId, datos.nombre);
    if (existeNombre) throw { status: 409, message: 'Este nombre ya existe, coloca uno diferente' };
  }

  const proveedor = await repo.create(negocioId, datos);

  // Crear acreedor vinculado automáticamente (si no existe ya)
  await vincularOCrearAcreedor(negocioId, proveedor);

  return _anotarCodigo(await _asignarSiToca(negocioId, proveedor));
};

const actualizarProveedor = async (negocioId, id, datos) => {
  if (datos.nombre?.trim()) {
    const existeNombre = await repo.findByNombre(negocioId, datos.nombre, Number(id));
    if (existeNombre) throw { status: 409, message: 'Este nombre ya existe, coloca uno diferente' };
  }

  const p = await repo.update(negocioId, id, datos);
  if (!p) throw { status: 404, message: 'Proveedor no encontrado' };

  // Sincronizar datos del acreedor vinculado (si existe)
  await sincronizarAcreedor(negocioId, p);

  // Completar la ciudad o el NIT de un proveedor sin código es justo lo que le
  // faltaba para recibirlo. Uno que ya lo tiene no cambia: está impreso.
  return _anotarCodigo(await _asignarSiToca(negocioId, p));
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
  asignarCodigosPendientes,
};