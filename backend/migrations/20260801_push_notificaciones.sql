-- ─────────────────────────────────────────────────────────────────────────────
-- NOTIFICACIONES PUSH (Web Push / VAPID) — migración 100% ADITIVA e IDEMPOTENTE
--
-- Fase 1: infraestructura. Guarda a qué dispositivos hay que empujar y lleva la
-- cuenta de lo ya enviado. No toca ninguna tabla existente.
--
-- GARANTÍAS PARA PRODUCCIÓN:
--   • Solo CREATE TABLE / CREATE INDEX IF NOT EXISTS → re-ejecutable sin efectos.
--   • Un negocio que no active las notificaciones no escribe una sola fila.
--   • Sin las variables VAPID_* el backend ni siquiera monta el módulo.
--
-- POR QUÉ EL ENDPOINT ES LA CLAVE Y NO EL USUARIO:
--   Una persona tiene varios dispositivos (celular, PC del local, tablet) y cada
--   uno recibe su propio endpoint del navegador. Si la clave fuera el usuario,
--   activar las notificaciones en el celular apagaría las del computador.
--
-- ROLLBACK manual:
--   DROP TABLE IF EXISTS push_suscripciones;
--   DROP TABLE IF EXISTS notificaciones_enviadas;
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Dispositivos suscritos ────────────────────────────────────────────────
--
-- `endpoint` es la URL que da el navegador (FCM, Mozilla, Apple…) y es única en
-- el mundo: sirve de clave natural y hace idempotente el "activar" (si el mismo
-- dispositivo vuelve a suscribirse, se actualiza la fila, no se duplica).
--
-- `p256dh` y `auth` son las claves con las que se cifra el payload. Sin ellas el
-- envío no se puede hacer: son parte de la suscripción, no un dato opcional.
--
-- ON DELETE CASCADE sobre usuarios: si se borra el usuario, sus dispositivos se
-- van con él. Nadie debe seguir recibiendo avisos de un negocio al que ya no
-- pertenece.
CREATE TABLE IF NOT EXISTS push_suscripciones (
  id            SERIAL PRIMARY KEY,
  usuario_id    INTEGER     NOT NULL REFERENCES usuarios(id)    ON DELETE CASCADE,
  negocio_id    INTEGER     NOT NULL REFERENCES negocios(id)    ON DELETE CASCADE,
  sucursal_id   INTEGER              REFERENCES sucursales(id)  ON DELETE SET NULL,
  endpoint      TEXT        NOT NULL UNIQUE,
  p256dh        TEXT        NOT NULL,
  auth          TEXT        NOT NULL,
  user_agent    TEXT,
  -- Qué avisos quiere este dispositivo. Vacío = todos los de su rol; la fase 3
  -- llenará esto desde la pantalla de Ajustes.
  preferencias  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  activa        BOOLEAN     NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMP   NOT NULL DEFAULT NOW(),
  ultimo_ok     TIMESTAMP,
  -- Envíos fallidos seguidos. Un 404/410 borra la fila de una vez (el navegador
  -- dice que el endpoint ya no existe); este contador es para los demás errores.
  fallos        INTEGER     NOT NULL DEFAULT 0
);

-- El envío siempre resuelve destinatarios por negocio (y a veces por sucursal),
-- nunca por usuario suelto: este índice es el que usa el fan-out.
CREATE INDEX IF NOT EXISTS idx_push_susc_negocio
  ON push_suscripciones (negocio_id, sucursal_id) WHERE activa;

CREATE INDEX IF NOT EXISTS idx_push_susc_usuario
  ON push_suscripciones (usuario_id) WHERE activa;

-- ── 2. Bitácora de lo ya enviado ─────────────────────────────────────────────
--
-- Es el antídoto contra el aviso repetido: Railway reinicia el contenedor, el
-- cron vuelve a correr y al cliente le llegan tres veces la misma alerta de
-- mora. Con la clave única (negocio, tipo, referencia, día) el segundo intento
-- choca y no envía.
--
-- `dia` es DATE a propósito: la ventana de deduplicación es el día del negocio
-- (America/Bogota), no las 24 horas exactas.
CREATE TABLE IF NOT EXISTS notificaciones_enviadas (
  id            SERIAL PRIMARY KEY,
  negocio_id    INTEGER     NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  tipo          TEXT        NOT NULL,
  referencia_id TEXT        NOT NULL DEFAULT '',
  dia           DATE        NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Bogota')::date,
  titulo        TEXT,
  cuerpo        TEXT,
  enviados      INTEGER     NOT NULL DEFAULT 0,
  fallidos      INTEGER     NOT NULL DEFAULT 0,
  creado_en     TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_enviadas_dia
  ON notificaciones_enviadas (negocio_id, tipo, referencia_id, dia);
