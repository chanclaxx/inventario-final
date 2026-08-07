-- ─────────────────────────────────────────────────────────────────────────────
-- ÓRDENES DE COMPRA, RECEPCIÓN PARCIAL, PROCEDENCIA Y GARANTÍA DE PROVEEDOR
--
-- 100% ADITIVA e IDEMPOTENTE. Se puede ejecutar varias veces sin efecto.
-- Se auto-aplica al arrancar el backend (src/config/migrations.js), dentro de
-- su propio try/catch: runMigrations() corre ANTES de app.listen(), así que un
-- fallo aquí no puede dejar sin servidor a los otros negocios.
--
-- ── El diseño en una frase ──────────────────────────────────────────────────
-- NO se crea un ciclo de compra paralelo. `registrarCompra()` YA es un evento
-- de recepción (mete inventario, calcula costo promedio, crea el cargo al
-- acreedor, toca caja y tesorería, y sabe revertirse). La orden se le pone
-- ENCIMA: una orden, N compras. Recepción parcial = N recepciones contra una
-- orden, sin una sola línea nueva de lógica de inventario.
--
-- ── Lo que NO se guarda ─────────────────────────────────────────────────────
-- El avance de la orden (recibido / pendiente) se DERIVA siempre de
-- lineas_compra. Misma regla que rige la deuda de la red interna, el pendiente
-- de mora y el total de un pago a acreedor, y por la misma razón:
-- cancelarCompra() revierte inventario y borra los movimientos del acreedor,
-- pero jamás iría a corregir un contador guardado en la orden — ese contador
-- quedaría inflado contra una recepción que ya no existe.
--
-- Por eso `ordenes_compra.estado` solo guarda lo que es una DECISIÓN humana
-- (Borrador / Emitida / Cerrada / Anulada). Si está parcial o completa se
-- calcula al leer.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. cantidad_devuelta — va primero porque es la única que toca código vivo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- devolverCompra() revierte el inventario y emite la nota crédito, pero hoy NO
-- toca lineas_compra.cantidad: qué unidades volvieron vive únicamente en el
-- texto libre de movimientos_acreedor.descripcion. Eso rompe DOS cosas:
--
--   * el avance de la orden — marcaría 100/100 después de devolver 40 unidades,
--     y esas 40 nunca se volverían a pedir;
--   * la procedencia — atribuiría a un proveedor unidades que ya le regresaron,
--     que es el peor error posible en una pantalla cuyo propósito es señalar
--     responsables.
--
-- El backfill es 0 a propósito: no hay forma confiable de reconstruir las
-- devoluciones históricas desde el texto libre, y adivinar sería peor que
-- admitir que no se sabe.
ALTER TABLE IF EXISTS lineas_compra
  ADD COLUMN IF NOT EXISTS cantidad_devuelta INTEGER NOT NULL DEFAULT 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Órdenes de compra
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id                 BIGSERIAL     PRIMARY KEY,
  negocio_id         INTEGER       NOT NULL REFERENCES negocios(id)    ON DELETE RESTRICT,
  numero             INTEGER,
  sucursal_id        INTEGER       NOT NULL REFERENCES sucursales(id)  ON DELETE RESTRICT,
  proveedor_id       INTEGER       NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
  usuario_id         INTEGER,

  -- Solo decisiones humanas. Parcial/Completa se derivan de lineas_compra.
  estado             TEXT          NOT NULL DEFAULT 'Borrador',

  fecha_emision      TIMESTAMP     NOT NULL DEFAULT NOW(),
  -- DATE (se lee en UTC), a diferencia de fecha_emision que es TIMESTAMP y se
  -- lee en Bogotá. Mezclarlos corre un día: es el bug que ya costó dos veces
  -- en mora.service._inicioInteres.
  fecha_esperada     DATE,

  -- ── Compromiso de pago ────────────────────────────────────────────────────
  numero_factura     TEXT,
  fecha_factura      DATE,
  dias_plazo         INTEGER,
  fecha_vencimiento  DATE,

  total_estimado     NUMERIC(14,2) NOT NULL DEFAULT 0,
  notas              TEXT,

  -- Cierre anticipado ("ya no va a llegar"): deja el saldo sin recibir y el
  -- motivo, pero no toca inventario ni deuda.
  motivo_cierre      TEXT,
  cerrada_en         TIMESTAMP,
  usuario_cierre_id  INTEGER,

  clave_idempotencia TEXT,

  CONSTRAINT ordenes_compra_estado_chk
    CHECK (estado IN ('Borrador', 'Emitida', 'Cerrada', 'Anulada'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_compra_idem
  ON ordenes_compra (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_negocio
  ON ordenes_compra (negocio_id, estado, fecha_emision DESC);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_sucursal
  ON ordenes_compra (sucursal_id, fecha_emision DESC);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor
  ON ordenes_compra (proveedor_id, fecha_emision DESC);
-- Para el semáforo de cartera y el cron de avisos: solo órdenes vivas con plazo.
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_vencimiento
  ON ordenes_compra (negocio_id, fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL AND estado = 'Emitida';


CREATE TABLE IF NOT EXISTS lineas_orden_compra (
  id              BIGSERIAL     PRIMARY KEY,
  orden_id        BIGINT        NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,

  -- 'serial' | 'cantidad'. Los seriales NO se pueden pedir por IMEI: el IMEI
  -- solo se conoce cuando se abre la caja. La orden pide modelo + cantidad y la
  -- recepción captura los IMEI con la cuadrícula que ya existe.
  tipo            TEXT          NOT NULL,

  producto_id     INTEGER,
  nombre_producto TEXT          NOT NULL,
  variante_id     INTEGER,
  atributo_id     INTEGER,

  cantidad_pedida INTEGER       NOT NULL,
  -- Referencia, NUNCA costo. El costo promedio se calcula siempre con el precio
  -- efectivamente recibido; si el estimado mandara, una orden mal cotizada
  -- corrompería la utilidad de las ventas.
  precio_estimado NUMERIC(14,2),

  -- Garantía pactada al pedir. La que cuenta es la de lineas_compra: el reloj
  -- arranca cuando la mercancía entra, no cuando se pide.
  garantia_dias   INTEGER,

  notas           TEXT,
  orden           INTEGER       NOT NULL DEFAULT 0,

  CONSTRAINT lineas_orden_compra_tipo_chk CHECK (tipo IN ('serial', 'cantidad')),
  CONSTRAINT lineas_orden_compra_cant_chk CHECK (cantidad_pedida > 0)
);

CREATE INDEX IF NOT EXISTS idx_lineas_orden_compra_orden
  ON lineas_orden_compra (orden_id, orden, id);
CREATE INDEX IF NOT EXISTS idx_lineas_orden_compra_producto
  ON lineas_orden_compra (producto_id) WHERE producto_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Enlace compra → orden. Una compra pasa a ser una RECEPCIÓN.
-- ═══════════════════════════════════════════════════════════════════════════
-- Ambas NULL-ables: una compra suelta (el flujo de siempre, y el único que
-- existe con la feature apagada) las deja vacías y nadie más las consulta.
ALTER TABLE IF EXISTS compras
  ADD COLUMN IF NOT EXISTS orden_compra_id BIGINT REFERENCES ordenes_compra(id) ON DELETE RESTRICT;

ALTER TABLE IF EXISTS lineas_compra
  ADD COLUMN IF NOT EXISTS orden_linea_id BIGINT REFERENCES lineas_orden_compra(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_compras_orden
  ON compras (orden_compra_id) WHERE orden_compra_id IS NOT NULL;
-- El índice que sostiene TODO el cálculo de avance de la orden.
CREATE INDEX IF NOT EXISTS idx_lineas_compra_orden_linea
  ON lineas_compra (orden_linea_id) WHERE orden_linea_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Compromiso de pago en el acreedor
-- ═══════════════════════════════════════════════════════════════════════════
-- Hoy NINGÚN cargo de acreedor tiene fecha límite: es la única pieza contable
-- genuinamente nueva de todo este trabajo.
--
-- orden_compra_id existe para el modo de cargo POR ORDEN (ver más abajo): en
-- ese modo el Cargo nace al registrar la factura de la orden, antes de que
-- llegue nada, y las recepciones no crean cargo propio.
ALTER TABLE IF EXISTS movimientos_acreedor
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;
ALTER TABLE IF EXISTS movimientos_acreedor
  ADD COLUMN IF NOT EXISTS orden_compra_id BIGINT REFERENCES ordenes_compra(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_mov_acreedor_vencimiento
  ON movimientos_acreedor (fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL AND tipo = 'Cargo';
CREATE INDEX IF NOT EXISTS idx_mov_acreedor_orden
  ON movimientos_acreedor (orden_compra_id) WHERE orden_compra_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Garantía del proveedor
-- ═══════════════════════════════════════════════════════════════════════════
-- OJO: NADA que ver con el módulo `garantias` que ya existe. Ese es un catálogo
-- de TEXTOS de garantía atados a lineas_producto, que se imprimen en el PDF de
-- la factura: va del negocio HACIA EL CLIENTE. Esto va en la dirección
-- contraria y no existía en ninguna parte (`garantia_dias` tenía cero
-- ocurrencias en todo el repositorio antes de esta migración).
--
-- El plazo se CONGELA en la línea de compra, igual que los pactos de mora e
-- interés se congelan en el documento: subir el default del proveedor en
-- Ajustes no puede alterar una garantía ya otorgada.
--
-- El vencimiento se DERIVA, nunca se guarda:
--   (c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias
-- El AT TIME ZONE no es opcional: compras.fecha es TIMESTAMP y se lee en
-- Bogotá; sin él, una compra registrada a las 8 p.m. vence un día antes.
ALTER TABLE IF EXISTS lineas_compra
  ADD COLUMN IF NOT EXISTS garantia_dias INTEGER;
ALTER TABLE IF EXISTS proveedores
  ADD COLUMN IF NOT EXISTS garantia_dias_default INTEGER;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Bitácora de novedades del proveedor
-- ═══════════════════════════════════════════════════════════════════════════
-- NO cuelga de la orden, a propósito. Un lote malo aparece meses después, en
-- una compra que quizá nunca tuvo orden — y los negocios con las órdenes
-- apagadas también reclaman garantías. Si la bitácora viviera dentro de
-- ordenes_compra, esos reclamos no tendrían dónde existir.
--
-- Append-only. Todo NULL-able menos negocio y proveedor.
CREATE TABLE IF NOT EXISTS novedades_proveedor (
  id           BIGSERIAL   PRIMARY KEY,
  negocio_id   INTEGER     NOT NULL REFERENCES negocios(id)    ON DELETE RESTRICT,
  proveedor_id INTEGER     NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,

  tipo         TEXT        NOT NULL,
  orden_id     BIGINT      REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  compra_id    INTEGER,
  producto_id  INTEGER,
  imei         TEXT,
  cantidad     INTEGER,

  texto        TEXT,
  usuario_id   INTEGER,
  fecha        TIMESTAMP   NOT NULL DEFAULT NOW(),
  resuelta_en  TIMESTAMP,

  CONSTRAINT novedades_proveedor_tipo_chk
    CHECK (tipo IN ('faltante', 'demora', 'garantia', 'acuerdo', 'cierre', 'nota'))
);

CREATE INDEX IF NOT EXISTS idx_novedades_proveedor_prov
  ON novedades_proveedor (negocio_id, proveedor_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_novedades_proveedor_orden
  ON novedades_proveedor (orden_id, fecha DESC) WHERE orden_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_novedades_proveedor_abiertas
  ON novedades_proveedor (negocio_id, fecha DESC) WHERE resuelta_en IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Códigos del proveedor ↔ código interno
-- ═══════════════════════════════════════════════════════════════════════════
-- Apunta al CÓDIGO INTERNO, no al producto_id. Un proveedor le vende al
-- NEGOCIO, pero productos_cantidad tiene una fila por sucursal: el mismo
-- producto lógico vive en N filas. Con producto_id harían falta N filas por
-- equivalencia y a la primera sucursal nueva empezarían a derivar.
--
-- Resolución:  codigo_proveedor → codigo_interno → productos_cantidad
--                                                  WHERE sucursal_id = $1
--                                                    AND codigo = $2 AND activo
--
-- Esto EXIGE codigo_producto_activo. Permitir un fallback por producto_id
-- crearía una segunda noción de identidad de producto; el repositorio ya tiene
-- tres conviviendo (índice único por (nombre, sucursal_id) exacto, búsqueda del
-- importador por LOWER(nombre), y una UI que no valida nada) y de ahí salen los
-- duplicados que hay hoy en producción. Una cuarta sería peor negocio que
-- pedirle al usuario que encienda los códigos internos.
CREATE TABLE IF NOT EXISTS codigos_proveedor (
  id                    BIGSERIAL  PRIMARY KEY,
  negocio_id            INTEGER    NOT NULL REFERENCES negocios(id)    ON DELETE RESTRICT,
  proveedor_id          INTEGER    NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,

  codigo_proveedor      TEXT       NOT NULL,
  codigo_interno        TEXT       NOT NULL,
  descripcion_proveedor TEXT,

  usuario_id            INTEGER,
  creado_en             TIMESTAMP  NOT NULL DEFAULT NOW()
);

-- Un código suyo apunta a UN producto tuyo. Case-insensitive: las remisiones
-- llegan en mayúsculas o minúsculas según quién las imprima.
CREATE UNIQUE INDEX IF NOT EXISTS uq_codigos_proveedor_codigo
  ON codigos_proveedor (proveedor_id, UPPER(BTRIM(codigo_proveedor)));
-- Búsqueda inversa: "¿cómo llama cada proveedor a mi producto X?".
-- NO es único a propósito: tres proveedores venden el mismo cargador con tres
-- referencias distintas, y esa es exactamente la información que se guarda.
CREATE INDEX IF NOT EXISTS idx_codigos_proveedor_interno
  ON codigos_proveedor (negocio_id, codigo_interno);


-- ═══════════════════════════════════════════════════════════════════════════
-- Configuración (NO requiere migración: config_negocio es clave-valor)
-- ═══════════════════════════════════════════════════════════════════════════
--   ordenes_compra_activas      '1' | '0'          (default apagado)
--   ordenes_compra_modo_cargo   'recepcion' | 'orden'
--       recepcion → cada recepción crea su Cargo (comportamiento de siempre;
--                   el proveedor factura cada remesa)
--       orden     → el Cargo nace al registrar la factura de la orden y las
--                   recepciones NO crean cargo propio (el proveedor factura el
--                   pedido completo por adelantado)
--   ordenes_compra_dias_aviso   entero, default 3  (semáforo de vencimiento)
--   garantia_proveedor_activa   '1' | '0'
--   codigos_proveedor_activos   '1' | '0'          (exige codigo_producto_activo)
-- ═══════════════════════════════════════════════════════════════════════════


-- Rollback manual (si algún día se necesita):
--   DROP TABLE IF EXISTS codigos_proveedor;
--   DROP TABLE IF EXISTS novedades_proveedor;
--   ALTER TABLE compras              DROP COLUMN IF EXISTS orden_compra_id;
--   ALTER TABLE lineas_compra        DROP COLUMN IF EXISTS orden_linea_id;
--   ALTER TABLE lineas_compra        DROP COLUMN IF EXISTS garantia_dias;
--   ALTER TABLE movimientos_acreedor DROP COLUMN IF EXISTS orden_compra_id;
--   ALTER TABLE movimientos_acreedor DROP COLUMN IF EXISTS fecha_vencimiento;
--   ALTER TABLE proveedores          DROP COLUMN IF EXISTS garantia_dias_default;
--   DROP TABLE IF EXISTS lineas_orden_compra;
--   DROP TABLE IF EXISTS ordenes_compra;
--   -- cantidad_devuelta NO se revierte: la usa devolverCompra() y perderla
--   -- volvería a inflar la procedencia.
