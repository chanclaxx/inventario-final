// ─────────────────────────────────────────────────────────────────────────────
// Técnicos INTERNOS de servicio técnico (quién reparó una orden).
//
// Ver migrations/20261025_servicio_abonos_tecnicos.sql. Opt-in por negocio:
// `servicios_tecnicos_activo` = '1' (ausente = apagado) Y la tabla presente.
// Apagado, ninguna pantalla pide técnico y ninguna consulta nombra la tabla.
//
// Es una LISTA, como la de vendedores: un técnico puede no tener usuario en la
// app. Los técnicos EXTERNOS siguen en su propio módulo (`tecnicos`): cuando el
// equipo de una orden se reparó afuera, quién lo hizo se lee de
// `equipos_tecnico` (`sqlTecnicoExterno`), nunca se copia aquí.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../config/db');
const { hayTecnicosServicio, hayTecnicos } = require('../../config/columnas');

const CLAVE_CONFIG = 'servicios_tecnicos_activo';

/** ¿El negocio encendió la función (y existe la tabla)? */
const activos = async (negocioId, executor = pool) => {
  if (!hayTecnicosServicio()) return false;
  const { rows } = await executor.query(
    'SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = $2',
    [negocioId, CLAVE_CONFIG],
  );
  return rows[0]?.valor === '1';
};

const _entero = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * El técnico externo que REPARÓ el equipo de una orden (el último que lo
 * devolvió reparado). Fragmento para un SELECT con `os` en el alcance; sin las
 * tablas de técnicos externos devuelve NULL.
 */
const sqlTecnicoExterno = (alias = 'os') => (hayTecnicos() ? `(
    SELECT t.nombre FROM equipos_tecnico e JOIN tecnicos t ON t.id = e.tecnico_id
    WHERE e.orden_servicio_id = ${alias}.id AND e.estado = 'Reparado'
    ORDER BY e.fecha_regreso DESC NULLS LAST, e.id DESC LIMIT 1)` : 'NULL::text');

// ─── Lista ───────────────────────────────────────────────────────────────────

const listar = async (negocioId, { sucursalId = null, todos = false } = {}) => {
  if (!hayTecnicosServicio()) return [];
  const { rows } = await pool.query(`
    SELECT ts.id, ts.nombre, ts.sucursal_id, ts.usuario_id, ts.activo, ts.creado_en,
           su.nombre AS sucursal_nombre, u.nombre AS usuario_nombre
    FROM tecnicos_servicio ts
    LEFT JOIN sucursales su ON su.id = ts.sucursal_id
    LEFT JOIN usuarios   u  ON u.id  = ts.usuario_id
    WHERE ts.negocio_id = $1
      AND ($2::boolean OR ts.activo)
      AND ($3::int IS NULL OR ts.sucursal_id IS NULL OR ts.sucursal_id = $3)
    ORDER BY ts.activo DESC, LOWER(ts.nombre)
  `, [negocioId, !!todos, sucursalId]);
  return rows;
};

const _validarDatos = async (negocioId, { nombre, sucursal_id, usuario_id }) => {
  const limpio = String(nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!limpio) throw { status: 400, message: 'El nombre del técnico es requerido' };
  if (limpio.length > 100) throw { status: 400, message: 'El nombre no puede pasar de 100 caracteres' };
  const sucursalId = sucursal_id === '' || sucursal_id == null ? null : _entero(sucursal_id);
  if (sucursal_id != null && sucursal_id !== '' && !sucursalId) throw { status: 400, message: 'Sede inválida' };
  if (sucursalId) {
    const { rows } = await pool.query('SELECT 1 FROM sucursales WHERE id = $1 AND negocio_id = $2', [sucursalId, negocioId]);
    if (!rows.length) throw { status: 400, message: 'Esa sede no es de tu negocio' };
  }
  const usuarioId = usuario_id === '' || usuario_id == null ? null : _entero(usuario_id);
  if (usuario_id != null && usuario_id !== '' && !usuarioId) throw { status: 400, message: 'Usuario inválido' };
  if (usuarioId) {
    const { rows } = await pool.query('SELECT 1 FROM usuarios WHERE id = $1 AND negocio_id = $2', [usuarioId, negocioId]);
    if (!rows.length) throw { status: 400, message: 'Ese usuario no es de tu negocio' };
  }
  return { nombre: limpio, sucursalId, usuarioId };
};

const _duplicado = (err) => {
  if (err?.code === '23505') {
    return { status: 409, code: 'TECNICO_DUPLICADO', message: 'Ya hay un técnico activo con ese nombre' };
  }
  return err;
};

const crear = async (negocioId, datos) => {
  if (!hayTecnicosServicio()) throw { status: 503, message: 'Falta la migración de técnicos de servicio' };
  const d = await _validarDatos(negocioId, datos);
  try {
    const { rows } = await pool.query(`
      INSERT INTO tecnicos_servicio (negocio_id, sucursal_id, nombre, usuario_id)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [negocioId, d.sucursalId, d.nombre, d.usuarioId]);
    return rows[0];
  } catch (err) { throw _duplicado(err); }
};

const actualizar = async (negocioId, id, datos) => {
  if (!hayTecnicosServicio()) throw { status: 503, message: 'Falta la migración de técnicos de servicio' };
  const { rows: actual } = await pool.query(
    'SELECT * FROM tecnicos_servicio WHERE id = $1 AND negocio_id = $2', [id, negocioId]);
  if (!actual.length) throw { status: 404, message: 'Técnico no encontrado' };
  const t = actual[0];
  const d = await _validarDatos(negocioId, {
    nombre:      datos.nombre      !== undefined ? datos.nombre      : t.nombre,
    sucursal_id: datos.sucursal_id !== undefined ? datos.sucursal_id : t.sucursal_id,
    usuario_id:  datos.usuario_id  !== undefined ? datos.usuario_id  : t.usuario_id,
  });
  const activo = datos.activo !== undefined ? datos.activo === true || datos.activo === 'true' : t.activo;
  try {
    const { rows } = await pool.query(`
      UPDATE tecnicos_servicio SET nombre = $3, sucursal_id = $4, usuario_id = $5, activo = $6
      WHERE id = $1 AND negocio_id = $2 RETURNING *
    `, [id, negocioId, d.nombre, d.sucursalId, d.usuarioId, activo]);
    return rows[0];
  } catch (err) { throw _duplicado(err); }
};

/**
 * Valida que un técnico se pueda ASIGNAR a una orden de esa sede: del negocio,
 * activo y que trabaje en esa sede (o en todas). Devuelve el id o null.
 */
const validarAsignable = async (executor, negocioId, tecnicoId, sucursalId) => {
  if (tecnicoId === null || tecnicoId === undefined || tecnicoId === '') return null;
  const id = _entero(tecnicoId);
  if (!id) throw { status: 400, message: 'Técnico inválido' };
  if (!hayTecnicosServicio()) throw { status: 400, message: 'La lista de técnicos no está disponible' };
  const { rows } = await executor.query(
    'SELECT activo, sucursal_id FROM tecnicos_servicio WHERE id = $1 AND negocio_id = $2', [id, negocioId]);
  if (!rows.length) throw { status: 400, code: 'TECNICO_INVALIDO', message: 'Ese técnico no es de tu negocio' };
  if (!rows[0].activo) throw { status: 400, code: 'TECNICO_INACTIVO', message: 'Ese técnico está desactivado' };
  if (rows[0].sucursal_id && sucursalId && Number(rows[0].sucursal_id) !== Number(sucursalId)) {
    throw { status: 400, code: 'TECNICO_OTRA_SEDE', message: 'Ese técnico no trabaja en la sede de la orden' };
  }
  return id;
};

module.exports = {
  CLAVE_CONFIG, activos, listar, crear, actualizar, validarAsignable, sqlTecnicoExterno,
};
