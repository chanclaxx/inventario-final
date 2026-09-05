-- ─────────────────────────────────────────────────────────────────────────────
-- PEDIDOS INTERNOS — el local le pide a la bodega
--
-- 100% ADITIVA e IDEMPOTENTE. Se puede ejecutar varias veces sin efecto.
-- Se auto-aplica al arrancar el backend (src/config/migrations.js), dentro de
-- su propio bloque `migrar()`: un fallo aquí se anota y el servidor arranca
-- igual — la red interna, que ya está operando en producción, no puede quedarse
-- sin arrancar por una tabla nueva que todavía no usa nadie.
--
-- ── El diseño en una frase ──────────────────────────────────────────────────
-- NO se crea un segundo circuito de mercancía. `despachar()` YA es el evento
-- que emite el documento, resuelve el nodo y la referencia de destino, valoriza
-- la línea, bloquea los $0 y sabe anularse; `recibir()` YA mueve el inventario
-- y genera la deuda. El pedido se les pone ENCIMA: un pedido, N remisiones.
-- Despacho parcial = N despachos contra un pedido, sin una sola línea nueva de
-- lógica de inventario ni de cuenta.
--
-- Es la misma decisión que 20260806_ordenes_compra tomó frente a `compras`, y
-- por la misma razón.
--
-- ── Lo que NO se guarda ─────────────────────────────────────────────────────
-- El avance del pedido (despachado / pendiente) se DERIVA siempre de
-- `lineas_remision`. Un contador guardado quedaría mintiendo en cuanto pasara
-- cualquiera de las cuatro cosas que ya pueden pasarle a una línea despachada:
-- anular la remisión, marcarla 'Faltante' al recibir, devolverla, o devolver
-- parte de un lote por cantidad. Ninguna de esas iría a corregir el contador, y
-- el pedido nunca volvería a pedir lo que no llegó.
--
-- Por eso `pedidos_internos.estado` solo guarda lo que es una DECISIÓN humana
-- (Borrador / Enviado / Cerrado / Anulado). Si está pendiente, parcial o
-- completo se calcula al leer.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. El pedido
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pedidos_internos (
  id                 BIGSERIAL PRIMARY KEY,
  negocio_id         INTEGER   NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
  numero             INTEGER,

  -- Quién pide y a quién. La bodega se CONGELA en la fila en vez de leerse de
  -- `red_interna_bodega_id` al mostrar: esa clave se puede cambiar en Ajustes,
  -- y un pedido histórico tiene que seguir diciendo a qué bodega se le hizo.
  sucursal_id        INTEGER   NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  sucursal_bodega_id INTEGER   NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,

  -- Solo decisiones humanas. Pendiente/Parcial/Completo se derivan.
  estado             TEXT      NOT NULL DEFAULT 'Borrador',
  prioridad          TEXT      NOT NULL DEFAULT 'normal',

  usuario_id         INTEGER,
  fecha              TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_envio        TIMESTAMP,

  notas              TEXT,
  -- Lo que la bodega contesta al cerrar ("no hay stock hasta el lunes"). Es la
  -- pieza que evita que cerrar un pedido se vea, desde el local, igual que
  -- ignorarlo.
  respuesta          TEXT,
  cerrado_en         TIMESTAMP,
  usuario_cierre_id  INTEGER,

  clave_idempotencia TEXT,

  CONSTRAINT pedidos_internos_estado_chk
    CHECK (estado IN ('Borrador', 'Enviado', 'Cerrado', 'Anulado')),
  CONSTRAINT pedidos_internos_prioridad_chk
    CHECK (prioridad IN ('normal', 'urgente')),
  CONSTRAINT pedidos_internos_suc_distintas_chk
    CHECK (sucursal_id <> sucursal_bodega_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_internos_idem
  ON pedidos_internos (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedidos_internos_local
  ON pedidos_internos (negocio_id, sucursal_id, fecha DESC);
-- La bandeja de la bodega: el índice que sostiene la única consulta que se
-- hace en cada carga del panel.
CREATE INDEX IF NOT EXISTS idx_pedidos_internos_bandeja
  ON pedidos_internos (negocio_id, sucursal_bodega_id, fecha DESC)
  WHERE estado = 'Enviado';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Las líneas
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lineas_pedido_interno (
  id              BIGSERIAL PRIMARY KEY,
  pedido_id       BIGINT    NOT NULL REFERENCES pedidos_internos(id) ON DELETE CASCADE,

  -- 'serial' | 'cantidad'. Los seriales NO se piden por IMEI: quién tiene los
  -- IMEI es la bodega, y el local no puede saber cuál le van a mandar. El
  -- pedido dice modelo + cantidad y el despacho escanea las unidades reales,
  -- igual que una orden de compra pide modelo y la recepción captura los IMEI.
  tipo            TEXT      NOT NULL,

  -- La referencia de la BODEGA (productos_serial o productos_cantidad según
  -- `tipo`), más el nodo si el pedido baja a la talla. Sin FK a propósito: es
  -- polimórfica entre dos tablas, igual que `lineas_orden_compra.producto_id`.
  --
  -- NULL es legítimo: es el pedido a TEXTO LIBRE ("mándame cargadores tipo C"),
  -- que existe porque un local pide cosas que la bodega todavía no tiene en su
  -- catálogo. La bodega lo resuelve a mano al despachar.
  producto_id     INTEGER,
  atributo_id     INTEGER,
  variante_id     INTEGER,

  nombre_producto TEXT      NOT NULL,
  cantidad_pedida INTEGER   NOT NULL,

  notas           TEXT,
  orden           INTEGER   NOT NULL DEFAULT 0,

  CONSTRAINT lineas_pedido_interno_tipo_chk CHECK (tipo IN ('serial', 'cantidad')),
  CONSTRAINT lineas_pedido_interno_cant_chk CHECK (cantidad_pedida > 0)
);

CREATE INDEX IF NOT EXISTS idx_lineas_pedido_interno_pedido
  ON lineas_pedido_interno (pedido_id, orden, id);
-- Sostiene la atribución automática al despachar: "¿qué línea de este pedido
-- pide justo este nodo?".
CREATE INDEX IF NOT EXISTS idx_lineas_pedido_interno_producto
  ON lineas_pedido_interno (producto_id) WHERE producto_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Enlace remisión → pedido. Un despacho pasa a ser una RESPUESTA.
-- ═══════════════════════════════════════════════════════════════════════════
-- Las dos NULL-ables: un despacho suelto (el flujo de siempre, y el único que
-- existe hoy en los negocios que ya operan) las deja vacías y nadie más las
-- consulta.
--
-- RESTRICT en la cabecera y SET NULL en la línea, igual que
-- compras.orden_compra_id / lineas_compra.orden_linea_id: borrar un pedido que
-- ya movió mercancía tiene que fallar, pero perder el vínculo de una línea
-- jamás puede llevarse por delante la línea, que mueve stock y deuda reales.
ALTER TABLE IF EXISTS remisiones
  ADD COLUMN IF NOT EXISTS pedido_id BIGINT REFERENCES pedidos_internos(id) ON DELETE RESTRICT;

ALTER TABLE IF EXISTS lineas_remision
  ADD COLUMN IF NOT EXISTS pedido_linea_id BIGINT
    REFERENCES lineas_pedido_interno(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_remisiones_pedido
  ON remisiones (pedido_id) WHERE pedido_id IS NOT NULL;
-- El índice que sostiene TODO el cálculo de avance del pedido.
CREATE INDEX IF NOT EXISTS idx_lineas_remision_pedido_linea
  ON lineas_remision (pedido_linea_id) WHERE pedido_linea_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- Configuración (NO requiere migración: config_negocio es clave-valor)
-- ═══════════════════════════════════════════════════════════════════════════
--   red_interna_pedidos   '1' | '0'   — AUSENTE = ENCENDIDO
--
-- Al revés que casi todo lo demás, y a propósito: la red interna YA es opt-in.
-- Quien llegó hasta aquí encendió a mano la distribución desde bodega, y pedir
-- no compromete inventario, ni caja, ni deuda — no pasa nada hasta que la
-- bodega despacha. El interruptor existe para la bodega que NO quiere que los
-- locales pidan, no para esconder la función. Es el mismo criterio de
-- `confirmar_recepcion`, `confirmar_remesa` y `ocultar_costos`, que también
-- resuelven su default dentro del módulo ya activado.
-- ═══════════════════════════════════════════════════════════════════════════


-- Rollback manual (si algún día se necesita):
--   ALTER TABLE lineas_remision DROP COLUMN IF EXISTS pedido_linea_id;
--   ALTER TABLE remisiones      DROP COLUMN IF EXISTS pedido_id;
--   DROP TABLE IF EXISTS lineas_pedido_interno;
--   DROP TABLE IF EXISTS pedidos_internos;
