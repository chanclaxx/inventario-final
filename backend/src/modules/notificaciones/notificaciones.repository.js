const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICACIONES PUSH — repositorio.
//
// La clave de una suscripción es el ENDPOINT, no el usuario: una persona tiene
// varios dispositivos (celular, PC del local, tablet) y cada uno recibe su
// propio endpoint del navegador. Si la clave fuera el usuario, activar las
// notificaciones en el celular apagaría las del computador.
//
// Un endpoint puede cambiar de dueño (el mismo navegador, otro usuario que
// inicia sesión en el equipo del local), por eso el UPSERT reasigna
// usuario/negocio/sucursal en vez de crear una fila nueva.
// ─────────────────────────────────────────────────────────────────────────────

const CAMPOS = `id, usuario_id, negocio_id, sucursal_id, endpoint, p256dh, auth,
                user_agent, preferencias, activa, creado_en, ultimo_ok, fallos`;

/** Alta o reactivación de un dispositivo. Idempotente por endpoint. */
const upsert = async ({
  usuario_id, negocio_id, sucursal_id = null,
  endpoint, p256dh, auth, user_agent = null, preferencias = {},
}) => {
  const { rows } = await pool.query(`
    INSERT INTO push_suscripciones
      (usuario_id, negocio_id, sucursal_id, endpoint, p256dh, auth, user_agent, preferencias)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    ON CONFLICT (endpoint) DO UPDATE SET
      usuario_id   = EXCLUDED.usuario_id,
      negocio_id   = EXCLUDED.negocio_id,
      sucursal_id  = EXCLUDED.sucursal_id,
      p256dh       = EXCLUDED.p256dh,
      auth         = EXCLUDED.auth,
      user_agent   = EXCLUDED.user_agent,
      preferencias = EXCLUDED.preferencias,
      activa       = TRUE,
      fallos       = 0
    RETURNING ${CAMPOS}
  `, [
    usuario_id, negocio_id, sucursal_id, endpoint, p256dh, auth,
    user_agent, JSON.stringify(preferencias || {}),
  ]);
  return rows[0];
};

/**
 * Baja de un dispositivo. Se BORRA la fila en vez de marcarla inactiva: el
 * usuario dijo "no quiero avisos aquí" y guardar sus claves de cifrado después
 * de eso no aporta nada.
 *
 * Filtra por usuario para que nadie pueda desuscribir el dispositivo de otro
 * mandando un endpoint ajeno.
 */
const eliminarPorEndpoint = async (endpoint, usuarioId) => {
  const { rows } = await pool.query(
    `DELETE FROM push_suscripciones
     WHERE endpoint = $1 AND usuario_id = $2
     RETURNING id`,
    [endpoint, usuarioId]
  );
  return rows.length > 0;
};

/** Borra por endpoint sin importar el dueño. Solo para endpoints muertos (404/410). */
const eliminarMuerto = async (endpoint) => {
  await pool.query(`DELETE FROM push_suscripciones WHERE endpoint = $1`, [endpoint]);
};

const findPorEndpoint = async (endpoint) => {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM push_suscripciones WHERE endpoint = $1`, [endpoint]);
  return rows[0] || null;
};

/** Dispositivos activos de UN usuario. Es lo que alimenta el envío de prueba. */
const findPorUsuario = async (usuarioId) => {
  const { rows } = await pool.query(
    `SELECT ${CAMPOS} FROM push_suscripciones
     WHERE usuario_id = $1 AND activa
     ORDER BY creado_en DESC`,
    [usuarioId]
  );
  return rows;
};

/**
 * Destinatarios de un aviso.
 *
 * `negocioId` NO es opcional: es la frontera multi-tenant. Todo envío se resuelve
 * dentro de un negocio y jamás puede cruzar a otro.
 *
 * - `roles`: si se pasa, solo esos roles (ej. solo el admin recibe cartera vencida).
 * - `sucursalId`: dispositivos de esa sucursal. El `admin_negocio` entra siempre,
 *   porque él ve todas las sucursales y su dispositivo puede no tener ninguna fija.
 */
const findDestinatarios = async ({ negocioId, sucursalId = null, roles = null, usuarioId = null }) => {
  const { rows } = await pool.query(`
    SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.usuario_id, ps.preferencias,
           u.rol, u.nombre AS usuario_nombre
    FROM push_suscripciones ps
    JOIN usuarios u ON u.id = ps.usuario_id
    WHERE ps.activa
      AND ps.negocio_id = $1
      AND u.activo
      AND ($2::int  IS NULL OR ps.sucursal_id = $2 OR u.rol = 'admin_negocio')
      -- usuarios.rol es un ENUM (rol_usuario), no texto: sin el cast explícito
      -- Postgres responde "operator does not exist: rol_usuario = text" y el
      -- envío se cae entero.
      AND ($3::text[] IS NULL OR u.rol::text = ANY($3))
      AND ($4::int  IS NULL OR ps.usuario_id = $4)
  `, [negocioId, sucursalId, roles, usuarioId]);
  return rows;
};

/** Marca un envío exitoso. Reinicia el contador de fallos. */
const marcarOk = async (endpoint) => {
  await pool.query(
    `UPDATE push_suscripciones SET ultimo_ok = NOW(), fallos = 0 WHERE endpoint = $1`,
    [endpoint]
  );
};

/**
 * Suma un fallo. A los 5 seguidos el dispositivo se desactiva: no se borra
 * (puede ser una caída temporal del servicio de push) pero deja de intentarse
 * en cada envío.
 */
const marcarFallo = async (endpoint) => {
  await pool.query(`
    UPDATE push_suscripciones
    SET fallos = fallos + 1,
        activa = (fallos + 1) < 5
    WHERE endpoint = $1
  `, [endpoint]);
};

// ── Bitácora de envíos ───────────────────────────────────────────────────────

/**
 * Reserva un envío del día. Devuelve false si ese aviso YA se mandó hoy.
 *
 * Es el antídoto contra el aviso repetido: Railway reinicia el contenedor, el
 * cron vuelve a correr y al usuario le llegan tres veces la misma alerta. El
 * índice único (negocio, tipo, referencia, día) hace que el segundo intento
 * choque, y el ON CONFLICT DO NOTHING lo convierte en "ya estaba".
 */
const reservarEnvio = async ({ negocio_id, tipo, referencia_id = '', titulo = null, cuerpo = null }) => {
  const { rows } = await pool.query(`
    INSERT INTO notificaciones_enviadas (negocio_id, tipo, referencia_id, titulo, cuerpo)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (negocio_id, tipo, referencia_id, dia) DO NOTHING
    RETURNING id
  `, [negocio_id, tipo, String(referencia_id ?? ''), titulo, cuerpo]);
  return rows[0]?.id ?? null;
};

/** Cierra la bitácora con el resultado real del fan-out. */
const cerrarEnvio = async (id, { enviados, fallidos }) => {
  if (!id) return;
  await pool.query(
    `UPDATE notificaciones_enviadas SET enviados = $2, fallidos = $3 WHERE id = $1`,
    [id, enviados, fallidos]
  );
};

module.exports = {
  upsert, eliminarPorEndpoint, eliminarMuerto, findPorEndpoint, findPorUsuario,
  findDestinatarios, marcarOk, marcarFallo,
  reservarEnvio, cerrarEnvio,
};
