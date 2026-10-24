-- ─────────────────────────────────────────────────────────────────────────────
-- GARANTÍAS CON PROVEEDORES — una unidad dañada vuelve al proveedor
--
-- No confundir con `garantias` (los TEXTOS que se imprimen en la factura del
-- cliente: van del negocio hacia el cliente). Esto va al revés: el proveedor
-- responde por lo que nos vendió. Por eso las tablas se llaman
-- `reclamos_garantia*` y en pantalla la pestaña es Proveedores → Garantías.
--
-- Un CASO tiene DOS caminos independientes:
--   · con el CLIENTE (si la unidad salió en una venta o un préstamo): se le
--     entrega otra unidad, se le devuelve la plata (se deshace la venta de esa
--     línea) o queda esperando;
--   · con el PROVEEDOR: la unidad sale en un ENVÍO (la caja que se le manda) y
--     él responde: repone, repara, da nota crédito, devuelve plata o no lo cubre.
--
-- ── Qué se escribe y qué se deriva ──────────────────────────────────────────
--   · Lo que ocurre se ESCRIBE en `reclamos_garantia_movimientos` (se anula
--     con motivo, nunca se borra).
--   · El estado de cada camino se DERIVA de los movimientos al leer. Las dos
--     cantidades acumuladas de la línea (`cantidad_cliente`, `cantidad_resuelta`)
--     se mantienen en la misma transacción que el movimiento, como
--     `lineas_compra.cantidad_devuelta`: son las que el candado y los topes
--     tienen que leer sin sumar el historial en cada venta.
--
-- ── El inventario ───────────────────────────────────────────────────────────
-- La unidad en garantía NO cuenta en el stock vendible:
--   · por CANTIDAD se descuenta del nodo hoja al apartarla (si venía de una
--     venta o un préstamo, "vuelve al inventario y sale a garantía": las dos
--     escrituras se anulan y no se toca el stock), y vuelve a sumar cuando el
--     proveedor repone o repara;
--   · un SERIAL conserva su fila (jamás se borra: es su historia) y el trigger
--     `fn_serial_en_garantia` impide venderlo, prestarlo, cambiarlo de
--     referencia o borrarlo mientras su línea esté abierta. El listado de
--     inventario lo deja fuera de los disponibles.
--
-- El runner de arranque (src/config/migrations.js) lee ESTE MISMO archivo.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_serial_en_garantia ON seriales;
--   DROP FUNCTION IF EXISTS fn_serial_en_garantia();
--   DROP TABLE IF EXISTS reclamos_garantia_movimientos, reclamos_garantia_lineas,
--                        envios_garantia, reclamos_garantia;
--   ALTER TABLE usuarios DROP COLUMN IF EXISTS permisos_garantias;
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reclamos_garantia (
  id               SERIAL PRIMARY KEY,
  negocio_id       INTEGER   NOT NULL,
  sucursal_id      INTEGER   NOT NULL,
  numero           INTEGER,
  -- NULL = todavía no se sabe a quién reclamarle (se elige al enviar).
  proveedor_id     INTEGER,
  -- De dónde salió la unidad. Un despacho o un traslado NO son origen: el
  -- local le devuelve la unidad a la bodega por la devolución que ya existe y
  -- la bodega la reclama desde su inventario (decisión del negocio).
  origen_tipo      TEXT      NOT NULL CHECK (origen_tipo IN ('inventario', 'factura', 'prestamo')),
  factura_id       INTEGER,
  prestamo_id      INTEGER,
  -- Copiados al crear: el documento puede cambiar después.
  cliente_nombre   TEXT,
  cliente_cedula   TEXT,
  cliente_telefono TEXT,
  falla            TEXT      NOT NULL,
  estado_fisico    TEXT,
  accesorios       JSONB,
  notas            TEXT,
  usuario_id       INTEGER,
  fecha            TIMESTAMP NOT NULL DEFAULT NOW(),
  anulado          BOOLEAN   NOT NULL DEFAULT FALSE,
  anulado_motivo   TEXT,
  anulado_por      INTEGER,
  anulado_en       TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reclamos_garantia_negocio ON reclamos_garantia (negocio_id, sucursal_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_reclamos_garantia_factura ON reclamos_garantia (factura_id) WHERE factura_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reclamos_garantia_prestamo ON reclamos_garantia (prestamo_id) WHERE prestamo_id IS NOT NULL;

-- La CAJA que sale hacia el proveedor: varias unidades de varios casos, una
-- guía. Es el documento que se imprime para el proveedor.
CREATE TABLE IF NOT EXISTS envios_garantia (
  id              SERIAL PRIMARY KEY,
  negocio_id      INTEGER   NOT NULL,
  sucursal_id     INTEGER   NOT NULL,
  numero          INTEGER,
  proveedor_id    INTEGER   NOT NULL,
  transportadora  TEXT,
  guia            TEXT,
  notas           TEXT,
  usuario_id      INTEGER,
  fecha           TIMESTAMP NOT NULL DEFAULT NOW(),
  anulado         BOOLEAN   NOT NULL DEFAULT FALSE,
  anulado_motivo  TEXT,
  anulado_por     INTEGER,
  anulado_en      TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_envios_garantia_negocio ON envios_garantia (negocio_id, sucursal_id, fecha DESC);

CREATE TABLE IF NOT EXISTS reclamos_garantia_lineas (
  id                       SERIAL PRIMARY KEY,
  reclamo_id               INTEGER NOT NULL REFERENCES reclamos_garantia(id) ON DELETE RESTRICT,
  negocio_id               INTEGER NOT NULL,
  sucursal_id              INTEGER NOT NULL,
  tipo                     TEXT    NOT NULL CHECK (tipo IN ('serial', 'cantidad')),
  -- SIN llave foránea a propósito (criterio de técnicos): la historia de un
  -- reclamo no puede impedir borrar después una referencia, y el IMEI y el
  -- nombre van congelados.
  serial_id                INTEGER,
  imei                     TEXT,
  -- productos_serial.id (serial) o productos_cantidad.id (cantidad).
  producto_id              INTEGER,
  atributo_id              INTEGER,
  variante_id              INTEGER,
  nombre_producto          TEXT    NOT NULL,
  variante_texto           TEXT,
  cantidad                 INTEGER NOT NULL CHECK (cantidad > 0),
  -- Congelado al apartar: es lo que la unidad le costó al negocio.
  costo_unitario           NUMERIC,
  -- Precio de venta de la línea de origen (tope del reembolso al cliente).
  precio_venta             NUMERIC,
  linea_factura_id         INTEGER,
  -- La compra de la que vino (procedencia), congelada con su garantía.
  compra_id                INTEGER,
  linea_compra_id          INTEGER,
  garantia_proveedor_hasta DATE,
  envio_id                 INTEGER REFERENCES envios_garantia(id),
  -- Lo ya resuelto con el cliente (cambio o reembolso) y con el proveedor.
  cantidad_cliente         INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_cliente >= 0),
  cantidad_resuelta        INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_resuelta >= 0),
  -- Verdadero cuando el proveedor resolvió TODO (o el caso se anuló). Es lo
  -- que mira el candado del serial en cada venta: tiene que ser barato.
  cerrada                  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Lo que el apartado pisó en el serial (vendido, fecha_salida, prestado),
  -- para restaurarlo si el caso se anula.
  estado_anterior          JSONB,
  CONSTRAINT reclamos_garantia_lineas_topes_chk
    CHECK (cantidad_cliente <= cantidad AND cantidad_resuelta <= cantidad)
);
CREATE INDEX IF NOT EXISTS idx_reclamos_lineas_reclamo ON reclamos_garantia_lineas (reclamo_id);
CREATE INDEX IF NOT EXISTS idx_reclamos_lineas_envio   ON reclamos_garantia_lineas (envio_id) WHERE envio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reclamos_lineas_imei    ON reclamos_garantia_lineas (imei) WHERE imei IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reclamos_lineas_abiertas
  ON reclamos_garantia_lineas (sucursal_id) WHERE NOT cerrada;
-- Un equipo no puede estar en DOS garantías abiertas a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reclamos_lineas_serial_abierto
  ON reclamos_garantia_lineas (serial_id) WHERE serial_id IS NOT NULL AND NOT cerrada;

CREATE TABLE IF NOT EXISTS reclamos_garantia_movimientos (
  id                     SERIAL PRIMARY KEY,
  linea_id               INTEGER NOT NULL REFERENCES reclamos_garantia_lineas(id) ON DELETE RESTRICT,
  reclamo_id             INTEGER NOT NULL,
  negocio_id             INTEGER NOT NULL,
  sucursal_id            INTEGER NOT NULL,
  lado                   TEXT    NOT NULL CHECK (lado IN ('cliente', 'proveedor')),
  --   cliente:   cambio (se le entregó otra unidad) | reembolso (se deshizo la venta de la línea)
  --   proveedor: reposicion | reparacion | nota_credito | reembolso_proveedor | rechazo
  tipo                   TEXT    NOT NULL CHECK (tipo IN (
                           'cambio', 'reembolso',
                           'reposicion', 'reparacion', 'nota_credito', 'reembolso_proveedor', 'rechazo')),
  -- Solo en un rechazo: la unidad vuelve al inventario o se da de baja.
  destino                TEXT    CHECK (destino IS NULL OR destino IN ('reingreso', 'baja')),
  cantidad               INTEGER NOT NULL CHECK (cantidad > 0),
  valor                  NUMERIC NOT NULL DEFAULT 0 CHECK (valor >= 0),
  metodo                 TEXT,
  -- La unidad que se le entregó al cliente (cambio) o la que entró (reposición).
  serial_id              INTEGER,
  imei                   TEXT,
  producto_id            INTEGER,
  atributo_id            INTEGER,
  variante_id            INTEGER,
  nombre_producto        TEXT,
  -- Garantía de la unidad repuesta o reparada (personalizable al registrarla).
  garantia_hasta         DATE,
  movimiento_caja_id     INTEGER,
  movimiento_acreedor_id INTEGER,
  -- Lo que hay que deshacer si se anula (préstamo cambiado, stock movido…).
  rastro                 JSONB,
  notas                  TEXT,
  usuario_id             INTEGER,
  fecha                  TIMESTAMP NOT NULL DEFAULT NOW(),
  anulado                BOOLEAN NOT NULL DEFAULT FALSE,
  anulado_motivo         TEXT,
  anulado_por            INTEGER,
  anulado_en             TIMESTAMP,
  CONSTRAINT reclamos_mov_lado_tipo_chk CHECK (
    (lado = 'cliente'   AND tipo IN ('cambio', 'reembolso')) OR
    (lado = 'proveedor' AND tipo IN ('reposicion', 'reparacion', 'nota_credito', 'reembolso_proveedor', 'rechazo'))
  ),
  CONSTRAINT reclamos_mov_destino_chk CHECK ((tipo = 'rechazo') = (destino IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_reclamos_mov_linea   ON reclamos_garantia_movimientos (linea_id);
CREATE INDEX IF NOT EXISTS idx_reclamos_mov_reclamo ON reclamos_garantia_movimientos (reclamo_id);
CREATE INDEX IF NOT EXISTS idx_reclamos_mov_imei    ON reclamos_garantia_movimientos (imei) WHERE imei IS NOT NULL;

-- Permisos granulares. NULL = permisos base del rol (ver role.middleware).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos_garantias JSONB;

-- ── El candado ──────────────────────────────────────────────────────────────
-- GP001 es un SQLSTATE propio: error.middleware lo convierte en un 409 con el
-- mensaje, que dice en qué garantía está el equipo y qué hacer. Mismo criterio
-- que técnicos: hay más de veinte sitios que escriben en `seriales` y la regla
-- se pone UNA vez, en el único punto por el que todos pasan. Sin líneas
-- abiertas no encuentra nada y no cambia el comportamiento de nadie.
CREATE OR REPLACE FUNCTION fn_serial_en_garantia() RETURNS trigger AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.vendido     IS NOT DISTINCT FROM OLD.vendido
     AND NEW.prestado    IS NOT DISTINCT FROM OLD.prestado
     AND NEW.producto_id IS NOT DISTINCT FROM OLD.producto_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(r.numero, r.id)
    INTO v_numero
    FROM reclamos_garantia_lineas l
    JOIN reclamos_garantia        r ON r.id = l.reclamo_id
   WHERE l.serial_id = OLD.id
     AND NOT l.cerrada
     AND NOT r.anulado
   LIMIT 1;

  IF v_numero IS NOT NULL THEN
    RAISE EXCEPTION 'El equipo % está en garantía con el proveedor (garantía #%). Resuélvela en Proveedores → Garantías antes de venderlo, prestarlo o moverlo.',
      OLD.imei, v_numero
      USING ERRCODE = 'GP001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_serial_en_garantia ON seriales;
CREATE TRIGGER trg_serial_en_garantia
  BEFORE UPDATE OF vendido, prestado, producto_id OR DELETE ON seriales
  FOR EACH ROW EXECUTE FUNCTION fn_serial_en_garantia();
