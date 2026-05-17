const { pool } = require('../config/db');

/**
 * Registra una acción en la tabla auditoria.
 * Fire-and-forget: nunca bloquea el request ni propaga errores.
 *
 * @param {number} negocioId
 * @param {number} usuarioId
 * @param {string} accion       - Texto corto descriptivo, ej: 'Venta registrada'
 * @param {string} tabla        - Módulo/tabla afectada, ej: 'facturas'
 * @param {number|null} registroId - ID del registro creado/modificado
 * @param {object} detalle      - Datos adicionales (se almacena como JSON)
 *   Campos estándar recomendados en detalle:
 *     sucursal_id, sucursal (nombre), valor, descripcion, + campos específicos por módulo
 */
const registrar = (negocioId, usuarioId, accion, tabla, registroId, detalle = {}) => {
  pool.query(
    `INSERT INTO auditoria(negocio_id, usuario_id, accion, tabla, registro_id, detalle)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [negocioId, usuarioId, accion, tabla, registroId ?? null, JSON.stringify(detalle)]
  ).catch((err) => {
    console.warn('[auditoria] Error al registrar:', err?.message ?? err);
  });
};

module.exports = { registrar };
