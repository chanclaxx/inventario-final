-- ─────────────────────────────────────────────────────────────────────────────
-- BORRADORES DE VENTA (carritos guardados con reserva blanda)
--
-- Un borrador es el carrito de un cliente que "ya vuelvo": se guarda con su
-- nombre, conserva el precio negociado y advierte a los demás vendedores de que
-- esa mercancía está apalabrada.
--
-- ── El inventario NO se toca ─────────────────────────────────────────────────
-- Aquí no se marca `seriales.reservado` ni se baja `productos_cantidad.stock`.
-- Un serial dentro de un borrador sigue con vendido=false, prestado=false y
-- SIGUE SIENDO VENDIBLE. La reserva se DERIVA leyendo esta tabla, igual que la
-- deuda de la red interna se deriva de las ventas y los saldos de tesorería de
-- las transaccionales.
--
-- La razón es práctica, no estética: escribir la reserva en el inventario haría
-- desaparecer la unidad del conteo, de los reportes, del catálogo web y de las
-- alertas de stock bajo; un borrador abandonado congelaría mercancía hasta que
-- alguien lo notara; y habría que restaurar stock al descartar, con todo lo que
-- eso puede fallar. El bloqueo es BLANDO a propósito.
--
-- ── Alcance: la sucursal, nunca el negocio ───────────────────────────────────
-- `sucursal_id NOT NULL`. Los borradores de Sansur no existen para Principal.
-- Cambiar de sucursal cambia la lista entera.
--
-- 100% aditiva. Ningún negocio la nota hasta encender `borradores_activo` en
-- Configuración.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS borradores (
  id             SERIAL      PRIMARY KEY,
  sucursal_id    INTEGER     NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  usuario_id     INTEGER,                       -- etiqueta "guardado por"; sobrevive al borrado del usuario
  titulo         TEXT        NOT NULL,          -- cliente o identificador libre
  destino        TEXT        NOT NULL DEFAULT 'indefinido',
  nota           TEXT,
  -- NULL = no vence. El plazo sale de config_negocio.borradores_dias y se
  -- renueva al cargar el borrador al carrito.
  expira_en      TIMESTAMP,
  creado_en      TIMESTAMP   NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMP   NOT NULL DEFAULT NOW(),
  CONSTRAINT borradores_destino_chk
    CHECK (destino IN ('factura', 'prestamo', 'indefinido'))
);

-- El total NO se guarda: se deriva con SUM sobre los ítems.
--
-- Quitar un ítem de un borrador (el "robo" para llevarlo a otro carrito) tiene
-- que bajar el total. Un total guardado quedaría inflado contra un contenido que
-- ya cambió — exactamente el error que documenta el pago total al acreedor.
CREATE TABLE IF NOT EXISTS borradores_items (
  id             SERIAL       PRIMARY KEY,
  borrador_id    INTEGER      NOT NULL REFERENCES borradores(id) ON DELETE CASCADE,

  -- La MISMA clave que usa el carrito del frontend para deduplicar:
  --   serial   → el IMEI
  --   cantidad → 'cant-<producto_id>' | 'cant-<pid>-a-<atributo_id>' | 'cant-<pid>-v-<variante_id>'
  -- Es lo que se compara en memoria para decidir si un producto está reservado,
  -- sin ir a la BD en cada toque de la lista de inventario.
  item_key       TEXT         NOT NULL,
  tipo           TEXT         NOT NULL,

  -- Congelado para poder pintar el borrador sin JOIN a cuatro tablas.
  nombre         TEXT         NOT NULL,

  -- CASCADE: si el producto desaparece del inventario, su renglón se va solo.
  -- Un borrador no tiene valor contable (a diferencia de una línea de factura),
  -- así que cascadear es seguro y evita reservas fantasma.
  serial_id      INTEGER      REFERENCES seriales(id)            ON DELETE CASCADE,
  imei           TEXT,
  producto_id    INTEGER      REFERENCES productos_cantidad(id)  ON DELETE CASCADE,
  atributo_id    INTEGER,
  variante_id    INTEGER,
  atributo_label TEXT,
  variante_label TEXT,

  cantidad       INTEGER      NOT NULL DEFAULT 1,

  -- `precio_final` es la razón de ser del borrador: "le dije $450.000 al
  -- cliente" es justo lo que hoy se pierde al vaciar el carrito.
  precio         NUMERIC(14,2),
  precio_final   NUMERIC(14,2) NOT NULL,
  costo          NUMERIC(14,2),
  tarifa_id      INTEGER,
  origen_precio  TEXT,
  linea_id       INTEGER,

  CONSTRAINT borradores_items_tipo_chk     CHECK (tipo IN ('serial', 'cantidad')),
  CONSTRAINT borradores_items_cantidad_chk CHECK (cantidad > 0),
  CONSTRAINT borradores_items_key_unica    UNIQUE (borrador_id, item_key)
);

-- Listado por sucursal, lo vivo primero.
CREATE INDEX IF NOT EXISTS idx_borradores_sucursal
  ON borradores (sucursal_id, creado_en DESC);

-- Barrido de vencidos.
CREATE INDEX IF NOT EXISTS idx_borradores_expira
  ON borradores (expira_en) WHERE expira_en IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_borradores_items_borrador
  ON borradores_items (borrador_id);

-- Para responder "¿este serial está reservado?" sin escanear la tabla.
CREATE INDEX IF NOT EXISTS idx_borradores_items_serial
  ON borradores_items (serial_id) WHERE serial_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_borradores_items_producto
  ON borradores_items (producto_id) WHERE producto_id IS NOT NULL;
