-- ─────────────────────────────────────────────────────────────────────────────
-- TÉCNICOS EXTERNOS — un equipo NUESTRO sale a que alguien de afuera lo repare
--
-- La orden de servicio que ya existe va en el sentido contrario: el cliente nos
-- trae SU equipo, nosotros lo reparamos y le cobramos. Esto es lo inverso: una
-- retoma a la que hay que cambiarle la batería sale del inventario hacia un
-- técnico, él la repara, nos cobra, y lo que cobró SUBE EL COSTO del equipo.
--
-- Cuatro tablas y un trigger. Esta es la copia legible; la que corre de verdad
-- en producción está replicada en src/config/migrations.js («Técnicos
-- externos»), y la prueba 54 compara las dos.
--
-- ── Qué se escribe y qué se deriva ──────────────────────────────────────────
--   · LO QUE SE LE DEBE al técnico NO se guarda: sale de los equipos que ya
--     volvieron (`equipos_tecnico.costo`). Mismo criterio que el cargo de un
--     envío de la red interna: un saldo guardado se descuadra con la primera
--     anulación que nadie vaya a corregir.
--   · LO QUE SE LE PAGA sí se escribe (`pagos_tecnico`): a qué salida va un
--     anticipo lo decide una persona, no se puede derivar de ninguna tabla.
--   · El SALDO A FAVOR tampoco se guarda: es el saldo de la cuenta cuando da
--     negativo, y el siguiente trabajo lo consume solo, por construcción.
--   · El VENCIMIENTO de la garantía se deriva (regreso + días): el plazo se
--     congela en la línea, la fecha se calcula.
--
-- ── El bloqueo del equipo ───────────────────────────────────────────────────
-- Mientras un equipo está donde el técnico no se puede vender, prestar, mover
-- de referencia ni borrar. Hay más de veinte sitios del backend que escriben en
-- `seriales`; ponerle la regla a cada uno dejaría fuera justo el que nadie
-- recuerde. El trigger la pone UNA vez y en el único punto por el que todos
-- pasan. Sin salidas abiertas no encuentra nada y no cambia el comportamiento
-- de nadie: los negocios que no usan la feature no la notan.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_serial_en_tecnico ON seriales;
--   DROP FUNCTION IF EXISTS fn_serial_en_tecnico();
--   DROP TABLE IF EXISTS pagos_tecnico, equipos_tecnico, salidas_tecnico, tecnicos;
--   ALTER TABLE usuarios DROP COLUMN IF EXISTS permisos_tecnicos;
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tecnicos (
  id                    SERIAL PRIMARY KEY,
  negocio_id            INTEGER NOT NULL,
  nombre                TEXT    NOT NULL,
  telefono              TEXT,
  cedula                TEXT,
  especialidad          TEXT,
  -- Se PRECARGA al recibir cada equipo; lo que manda es lo escrito en la línea.
  garantia_dias_default INTEGER,
  notas                 TEXT,
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en             TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tecnicos_negocio ON tecnicos (negocio_id);

CREATE TABLE IF NOT EXISTS salidas_tecnico (
  id                SERIAL PRIMARY KEY,
  negocio_id        INTEGER NOT NULL,
  sucursal_id       INTEGER NOT NULL,
  tecnico_id        INTEGER NOT NULL REFERENCES tecnicos(id),
  numero            INTEGER,
  usuario_id        INTEGER,
  -- La orden del CLIENTE desde la que salió (equipo ya vendido que vuelve por
  -- garantía, o equipo del cliente). NULL = salió del inventario.
  orden_servicio_id INTEGER,
  notas             TEXT,
  fecha             TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salidas_tecnico_negocio ON salidas_tecnico (negocio_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_salidas_tecnico_tecnico ON salidas_tecnico (tecnico_id);

CREATE TABLE IF NOT EXISTS equipos_tecnico (
  id                    SERIAL PRIMARY KEY,
  salida_id             INTEGER NOT NULL REFERENCES salidas_tecnico(id) ON DELETE CASCADE,
  negocio_id            INTEGER NOT NULL,
  sucursal_id           INTEGER NOT NULL,
  tecnico_id            INTEGER NOT NULL REFERENCES tecnicos(id),
  -- SIN llave foránea a propósito: la historia de un trabajo no puede impedir
  -- borrar después una referencia, y el IMEI y el nombre van congelados.
  serial_id             INTEGER,
  imei                  TEXT,
  descripcion_equipo    TEXT,
  trabajo               TEXT    NOT NULL,
  -- 'inventario' = equipo nuestro sin vender (su costo SUBE)
  -- 'vendido'    = equipo que vendimos y vuelve (su costo NO sube)
  -- 'cliente'    = equipo de un cliente, sin fila en nuestro inventario
  origen                TEXT    NOT NULL DEFAULT 'inventario'
                        CHECK (origen IN ('inventario', 'vendido', 'cliente')),
  estado                TEXT    NOT NULL DEFAULT 'En_tecnico'
                        CHECK (estado IN ('En_tecnico', 'Reparado', 'Sin_reparar', 'Anulado')),
  fecha_regreso         TIMESTAMP,
  costo                 NUMERIC NOT NULL DEFAULT 0 CHECK (costo >= 0),
  garantia_dias         INTEGER CHECK (garantia_dias IS NULL OR garantia_dias >= 0),
  -- Un reclamo de garantía es OTRA salida del mismo equipo al mismo técnico,
  -- sin costo, ligada al trabajo que falló.
  reclamo_de_id         INTEGER REFERENCES equipos_tecnico(id),
  -- A DÓNDE fue a parar lo que cobró el técnico. Congelado al recibir:
  --   'costo_compra'  → sumado a seriales.costo_compra (equipo propio)
  --   'valor_interno' → equipo consignado en un LOCAL de la red: su costo es el
  --                     de la remisión, y costo_compra es la verdad de la BODEGA,
  --                     que no se toca. Los reportes lo suman sobre el valor
  --                     interno (utils/costoRed.util).
  --   'venta'         → equipo ya vendido y el usuario decidió cargárselo a esa
  --                     venta (factura_cargo_id). Baja la utilidad de la venta.
  --   'orden'         → a la orden de servicio del cliente (su costo).
  --   NULL            → sin costo, o aún no ha vuelto.
  costo_aplicado_a      TEXT CHECK (costo_aplicado_a IS NULL OR costo_aplicado_a IN
                          ('costo_compra', 'valor_interno', 'venta', 'orden')),
  costo_serial_anterior NUMERIC,
  costo_serial_nuevo    NUMERIC,
  precio_anterior       NUMERIC,
  precio_nuevo          NUMERIC,
  factura_cargo_id      INTEGER,
  orden_servicio_id     INTEGER,
  notas_regreso         TEXT,
  usuario_regreso_id    INTEGER,
  anulado_motivo        TEXT
);
CREATE INDEX IF NOT EXISTS idx_equipos_tecnico_salida  ON equipos_tecnico (salida_id);
CREATE INDEX IF NOT EXISTS idx_equipos_tecnico_tecnico ON equipos_tecnico (tecnico_id);
CREATE INDEX IF NOT EXISTS idx_equipos_tecnico_imei    ON equipos_tecnico (imei);
-- El que consulta el trigger en cada venta de un serial: tiene que ser barato.
CREATE INDEX IF NOT EXISTS idx_equipos_tecnico_abiertos
  ON equipos_tecnico (serial_id) WHERE estado = 'En_tecnico';
-- Un equipo no puede estar donde DOS técnicos a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_equipos_tecnico_serial_abierto
  ON equipos_tecnico (serial_id) WHERE estado = 'En_tecnico' AND serial_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pagos_tecnico (
  id             SERIAL PRIMARY KEY,
  negocio_id     INTEGER NOT NULL,
  tecnico_id     INTEGER NOT NULL REFERENCES tecnicos(id),
  -- La caja de la sucursal que PAGA (o que recibe una devolución).
  sucursal_id    INTEGER NOT NULL,
  usuario_id     INTEGER,
  -- Anticipo y Pago sacan plata; Devolucion la trae de vuelta.
  tipo           TEXT    NOT NULL CHECK (tipo IN ('Anticipo', 'Pago', 'Devolucion')),
  valor          NUMERIC NOT NULL CHECK (valor > 0),
  metodo         TEXT    NOT NULL DEFAULT 'Efectivo',
  salida_id      INTEGER REFERENCES salidas_tecnico(id),
  notas          TEXT,
  fecha          TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Nunca se borra: se anula con su razón, como los abonos de préstamos.
  anulado        BOOLEAN NOT NULL DEFAULT FALSE,
  anulado_motivo TEXT,
  anulado_por    INTEGER,
  anulado_en     TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pagos_tecnico_tecnico  ON pagos_tecnico (tecnico_id, fecha);
CREATE INDEX IF NOT EXISTS idx_pagos_tecnico_sucursal ON pagos_tecnico (sucursal_id, fecha);

-- Permisos granulares. NULL = permisos base del rol (ver role.middleware).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos_tecnicos JSONB;

-- ── El candado ──────────────────────────────────────────────────────────────
-- ST001 es un SQLSTATE propio: error.middleware lo convierte en un 409 con el
-- mensaje, que dice dónde está el equipo y qué hacer.
CREATE OR REPLACE FUNCTION fn_serial_en_tecnico() RETURNS trigger AS $$
DECLARE
  v_tecnico TEXT;
  v_salida  INTEGER;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.vendido     IS NOT DISTINCT FROM OLD.vendido
     AND NEW.prestado    IS NOT DISTINCT FROM OLD.prestado
     AND NEW.producto_id IS NOT DISTINCT FROM OLD.producto_id THEN
    RETURN NEW;
  END IF;

  SELECT t.nombre, COALESCE(s.numero, s.id)
    INTO v_tecnico, v_salida
    FROM equipos_tecnico e
    JOIN tecnicos        t ON t.id = e.tecnico_id
    JOIN salidas_tecnico s ON s.id = e.salida_id
   WHERE e.serial_id = OLD.id
     AND e.estado    = 'En_tecnico'
   LIMIT 1;

  IF v_tecnico IS NOT NULL THEN
    RAISE EXCEPTION 'El equipo % está donde el técnico % (salida #%). Recíbelo en Servicios → Técnicos antes de venderlo, prestarlo o moverlo.',
      OLD.imei, v_tecnico, v_salida
      USING ERRCODE = 'ST001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_serial_en_tecnico ON seriales;
CREATE TRIGGER trg_serial_en_tecnico
  BEFORE UPDATE OF vendido, prestado, producto_id OR DELETE ON seriales
  FOR EACH ROW EXECUTE FUNCTION fn_serial_en_tecnico();
