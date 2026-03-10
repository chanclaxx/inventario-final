const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');
const { enviarConfirmacionRegistro } = require('../email/email.service');

async function registrarNegocio({ nombre, nit, telefono, direccion, email }) {
  // Verificar que el email no esté en uso
  const existe = await pool.query(
    'SELECT id FROM negocios WHERE email = $1',
    [email]
  );
  if (existe.rows.length > 0) {
    const err = new Error('Ya existe un negocio registrado con ese email');
    err.status = 409;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Crear negocio en estado pendiente
    const { rows: [negocio] } = await client.query(
      `INSERT INTO negocios (nombre, nit, telefono, direccion, email, plan, estado_plan)
       VALUES ($1, $2, $3, $4, $5, 'trial', 'pendiente')
       RETURNING id, nombre, email`,
      [nombre, nit, telefono, direccion, email]
    );

    // Crear sucursal principal automáticamente
    await client.query(
      `INSERT INTO sucursales (negocio_id, nombre, direccion)
       VALUES ($1, 'Principal', $2)`,
      [negocio.id, direccion || 'Por definir']
    );

    await client.query('COMMIT');

    // Enviar email de confirmación (no bloquea si falla)
    enviarConfirmacionRegistro({ email, nombre_negocio: nombre }).catch((err) => {
      console.error('Error enviando email de confirmación:', err.message);
    });

    return negocio;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { registrarNegocio };