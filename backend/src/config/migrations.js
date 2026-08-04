const { pool } = require('./db');

const runMigrations = async () => {
  // ── Auto-aplicadas al arrancar (100% aditivas e idempotentes) ──────────────
  // Notas / post-it de inventario — ver migrations/20260710_notas_inventario.sql
  await pool.query(`
    ALTER TABLE IF EXISTS seriales           ADD COLUMN IF NOT EXISTS nota TEXT;
    ALTER TABLE IF EXISTS productos_serial   ADD COLUMN IF NOT EXISTS nota TEXT;
    ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS nota TEXT;
  `);

  // Código único de producto (tipo supermercado) — ver migrations/20260714_codigo_producto.sql
  // 100% aditiva e idempotente. Columna nullable: negocios sin la feature no la notan.
  // Unicidad por sucursal solo entre productos activos (permite reusar código tras borrado lógico).
  await pool.query(`
    ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS codigo TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_cantidad_codigo
      ON productos_cantidad (sucursal_id, codigo)
      WHERE codigo IS NOT NULL AND activo;
  `);

  // Ubicación espacial de productos — ver migrations/20260730_ubicacion_producto.sql
  //
  // 100% aditiva e idempotente. Columnas nullable: un negocio sin la feature no
  // las nota. Va en su propio try/catch porque runMigrations() corre antes de
  // app.listen(): un fallo aquí (permisos, BD antigua) solo debe dejar sin
  // ubicación a quien la use, nunca sin servidor a los otros negocios.
  // La detección de src/config/columnas.js se encarga de apagar la feature si
  // el ALTER no llegó a aplicarse.
  try {
    await pool.query(`
      ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS ubicacion TEXT;
      ALTER TABLE IF EXISTS productos_serial   ADD COLUMN IF NOT EXISTS ubicacion TEXT;
      CREATE INDEX IF NOT EXISTS idx_productos_cantidad_ubicacion
        ON productos_cantidad (sucursal_id, LOWER(BTRIM(ubicacion)))
        WHERE ubicacion IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_productos_serial_ubicacion
        ON productos_serial (sucursal_id, LOWER(BTRIM(ubicacion)))
        WHERE ubicacion IS NOT NULL;
    `);
  } catch (err) {
    console.error('⚠️  Ubicación de productos no aplicada (el inventario sigue normal):', err.message);
  }

  // Gastos fijos mensuales por sucursal (Proyección) — ver migrations/20260712_gastos_fijos.sql
  // 100% aditiva e idempotente. Alimenta la utilidad neta y el punto de equilibrio.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gastos_fijos (
      id             SERIAL        PRIMARY KEY,
      sucursal_id    INTEGER       NOT NULL,
      nombre         TEXT          NOT NULL,
      valor          NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
      activo         BOOLEAN       NOT NULL DEFAULT TRUE,
      creado_en      TIMESTAMP     NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMP     NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_gastos_fijos_sucursal
      ON gastos_fijos (sucursal_id) WHERE activo;
  `);

  // Índices para la exportación de inventario — ver migrations/20260727_indices_export_inventario.sql
  //
  // La exportación cruza cada serial contra facturas, compras y préstamos POR IMEI
  // (texto). Sin estos índices cada serial dispara un seq scan de esas tablas, así
  // que el costo total crece con seriales × líneas_factura: un negocio con miles de
  // seriales tumba la petición por timeout.
  //
  // El índice sobre clientes es funcional porque el JOIN normaliza con
  // LOWER(TRIM(...)) y un índice normal sobre `nombre` no aplicaría.
  //
  // Va en su propio try/catch: son puramente de rendimiento, y un fallo aquí (una BD
  // vieja sin alguna de estas columnas) no debe impedir que arranque el servidor.
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lineas_factura_imei
        ON lineas_factura (imei) WHERE imei IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_lineas_compra_imei
        ON lineas_compra (imei) WHERE imei IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_prestamos_imei_fecha
        ON prestamos (imei, fecha DESC) WHERE imei IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_seriales_producto
        ON seriales (producto_id);
      CREATE INDEX IF NOT EXISTS idx_productos_serial_sucursal
        ON productos_serial (sucursal_id);
      CREATE INDEX IF NOT EXISTS idx_clientes_negocio_nombre_norm
        ON clientes (negocio_id, LOWER(BTRIM(nombre)));
    `);
  } catch (err) {
    console.error('⚠️  Índices de exportación no creados (la exportación sigue, más lenta):', err.message);
  }

  // Red interna (bodega → locales, modelo consignación) — ver migrations/20260725_red_interna.sql
  //
  // 100% aditiva: crea 4 tablas nuevas y NINGÚN ALTER sobre tablas existentes.
  // Un negocio sin el flag `red_interna_activa` jamás escribe en ellas, así que
  // para el resto de clientes son 4 tablas vacías sin costo ni efecto.
  //
  // Va en su propio try/catch A PROPÓSITO: runMigrations() corre antes de
  // app.listen(), así que un fallo aquí (permisos, tipo de FK inesperado en una
  // BD vieja) dejaría el servidor sin arrancar para TODOS los negocios. Ante un
  // error se registra y se sigue: solo la red interna queda sin infraestructura,
  // y su middleware ya responde 503 si las tablas no existen.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS remisiones (
        id                  BIGSERIAL     PRIMARY KEY,
        negocio_id          INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
        numero              INTEGER,
        tipo                TEXT          NOT NULL DEFAULT 'entrega',
        sucursal_origen_id  INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
        sucursal_destino_id INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
        traslado_id         INTEGER       REFERENCES traslados(id)           ON DELETE RESTRICT,
        estado              TEXT          NOT NULL DEFAULT 'En transito',
        valor_total         NUMERIC(14,2) NOT NULL DEFAULT 0,
        usuario_emisor_id   INTEGER,
        usuario_receptor_id INTEGER,
        fecha_emision       TIMESTAMP     NOT NULL DEFAULT NOW(),
        fecha_recepcion     TIMESTAMP,
        clave_idempotencia  TEXT,
        notas               TEXT,
        CONSTRAINT remisiones_tipo_chk   CHECK (tipo   IN ('entrega', 'devolucion')),
        CONSTRAINT remisiones_estado_chk CHECK (estado IN ('En transito', 'Recibida', 'Parcial', 'Anulada')),
        CONSTRAINT remisiones_suc_distintas_chk CHECK (sucursal_origen_id <> sucursal_destino_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_remisiones_idem
        ON remisiones (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_remisiones_negocio_destino
        ON remisiones (negocio_id, sucursal_destino_id, estado);
      CREATE INDEX IF NOT EXISTS idx_remisiones_origen
        ON remisiones (sucursal_origen_id, fecha_emision DESC);

      CREATE TABLE IF NOT EXISTS lineas_remision (
        id                  BIGSERIAL     PRIMARY KEY,
        remision_id         BIGINT        NOT NULL REFERENCES remisiones(id) ON DELETE CASCADE,
        tipo                TEXT          NOT NULL,
        serial_id           INTEGER       REFERENCES seriales(id)            ON DELETE RESTRICT,
        imei                TEXT,
        producto_origen_id  INTEGER,
        producto_destino_id INTEGER,
        cantidad            INTEGER       NOT NULL DEFAULT 1,
        cantidad_recibida   INTEGER,
        valor_interno       NUMERIC(14,2) NOT NULL DEFAULT 0,
        estado_linea        TEXT          NOT NULL DEFAULT 'Pendiente',
        nombre_producto     TEXT,
        CONSTRAINT lineas_remision_tipo_chk   CHECK (tipo IN ('serial', 'cantidad')),
        CONSTRAINT lineas_remision_estado_chk CHECK (estado_linea IN ('Pendiente', 'Recibida', 'Faltante', 'Devuelta'))
      );
      CREATE INDEX IF NOT EXISTS idx_lineas_remision_remision ON lineas_remision (remision_id);
      CREATE INDEX IF NOT EXISTS idx_lineas_remision_serial   ON lineas_remision (serial_id) WHERE serial_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_lineas_remision_producto ON lineas_remision (producto_destino_id) WHERE tipo = 'cantidad';
      CREATE UNIQUE INDEX IF NOT EXISTS uq_lineas_remision_serial_viva
        ON lineas_remision (serial_id)
        WHERE serial_id IS NOT NULL AND estado_linea IN ('Pendiente', 'Recibida');

      CREATE TABLE IF NOT EXISTS remesas (
        id                  BIGSERIAL     PRIMARY KEY,
        negocio_id          INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
        numero              INTEGER,
        sucursal_origen_id  INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
        sucursal_destino_id INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
        cuenta_origen_id    INTEGER,
        cuenta_transito_id  INTEGER,
        cuenta_destino_id   INTEGER,
        valor               NUMERIC(14,2) NOT NULL CHECK (valor > 0),
        metodo              TEXT,
        estado              TEXT          NOT NULL DEFAULT 'En transito',
        mov_salida_id       BIGINT,
        mov_transito_id     BIGINT,
        mov_entrada_id      BIGINT,
        usuario_envia_id    INTEGER,
        usuario_recibe_id   INTEGER,
        fecha_envio         TIMESTAMP     NOT NULL DEFAULT NOW(),
        fecha_recepcion     TIMESTAMP,
        clave_idempotencia  TEXT,
        notas               TEXT,
        CONSTRAINT remesas_estado_chk CHECK (estado IN ('En transito', 'Recibida', 'Anulada'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_remesas_idem
        ON remesas (clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_remesas_origen  ON remesas (negocio_id, sucursal_origen_id, estado);
      CREATE INDEX IF NOT EXISTS idx_remesas_destino ON remesas (negocio_id, sucursal_destino_id, estado);

      CREATE TABLE IF NOT EXISTS movimientos_cuenta_interna (
        id              BIGSERIAL     PRIMARY KEY,
        negocio_id      INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
        sucursal_id     INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
        tipo            TEXT          NOT NULL,
        valor           NUMERIC(14,2) NOT NULL DEFAULT 0,
        saldo_congelado NUMERIC(14,2),
        mov_dinero_id   BIGINT,
        concepto        TEXT,
        usuario_id      INTEGER,
        fecha           TIMESTAMP     NOT NULL DEFAULT NOW(),
        anulado         BOOLEAN       NOT NULL DEFAULT FALSE,
        CONSTRAINT mci_tipo_chk CHECK (tipo IN ('GastoAutorizado', 'Ajuste', 'Corte'))
      );
      CREATE INDEX IF NOT EXISTS idx_mci_sucursal
        ON movimientos_cuenta_interna (negocio_id, sucursal_id, fecha DESC) WHERE NOT anulado;
    `);
    // v2 — devoluciones auditables y corrección de valores.
    // Ver migrations/20260726_red_interna_v2.sql. Solo toca tablas de la red
    // interna; ninguna tabla del sistema original se modifica.
    await pool.query(`
      ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS origen_unidad TEXT;
      ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS genera_saldo_favor BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS valor_original NUMERIC(14,2);
      ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS remision_tipo TEXT;

      UPDATE lineas_remision lr SET remision_tipo = r.tipo
      FROM remisiones r
      WHERE r.id = lr.remision_id AND lr.remision_tipo IS DISTINCT FROM r.tipo;

      DROP INDEX IF EXISTS uq_lineas_remision_serial_viva;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_lineas_remision_serial_viva
        ON lineas_remision (serial_id)
        WHERE serial_id IS NOT NULL AND remision_tipo = 'entrega'
          AND estado_linea IN ('Pendiente', 'Recibida');
      CREATE UNIQUE INDEX IF NOT EXISTS uq_lineas_remision_serial_devolviendo
        ON lineas_remision (serial_id)
        WHERE serial_id IS NOT NULL AND remision_tipo = 'devolucion'
          AND estado_linea = 'Pendiente';

      CREATE TABLE IF NOT EXISTS correcciones_remision (
        id             BIGSERIAL     PRIMARY KEY,
        negocio_id     INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
        sucursal_id    INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
        linea_id       BIGINT        NOT NULL REFERENCES lineas_remision(id) ON DELETE CASCADE,
        valor_anterior NUMERIC(14,2) NOT NULL,
        valor_nuevo    NUMERIC(14,2) NOT NULL,
        diferencia     NUMERIC(14,2) NOT NULL,
        motivo         TEXT,
        usuario_id     INTEGER,
        fecha          TIMESTAMP     NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_correcciones_sucursal
        ON correcciones_remision (negocio_id, sucursal_id, fecha DESC);
      CREATE INDEX IF NOT EXISTS idx_correcciones_linea
        ON correcciones_remision (linea_id);
    `);
  } catch (err) {
    console.error('⚠️  Migración red interna no aplicada (el resto del sistema sigue normal):', err.message);
  }

  // Mora por pago tardío en créditos y préstamos — ver migrations/20260730_mora_credito.sql
  //
  // 100% aditiva: 4 columnas nullable (sin DEFAULT, así que no reescriben filas)
  // y 1 tabla nueva. `fecha_limite IS NULL` ⇒ el documento no tiene mora, así que
  // los créditos y préstamos que ya existen no cambian ni al migrar ni al activar
  // la feature con `mora_activa`.
  //
  // La mora vive en `movimientos_mora` y NUNCA en `total_abonado`: los reportes
  // calculan la utilidad del producto como (abonado − costo), así que sumarla ahí
  // la contaría como margen comercial. Es un ingreso financiero y se reporta aparte.
  //
  // Propio try/catch, por la misma razón que la red interna: un fallo aquí no
  // puede dejar el servidor sin arrancar para todos los negocios.
  try {
    await pool.query(`
      ALTER TABLE IF EXISTS creditos  ADD COLUMN IF NOT EXISTS fecha_limite   DATE;
      ALTER TABLE IF EXISTS creditos  ADD COLUMN IF NOT EXISTS mora_condicion JSONB;
      ALTER TABLE IF EXISTS prestamos ADD COLUMN IF NOT EXISTS fecha_limite   DATE;
      ALTER TABLE IF EXISTS prestamos ADD COLUMN IF NOT EXISTS mora_condicion JSONB;

      CREATE INDEX IF NOT EXISTS idx_creditos_fecha_limite
        ON creditos (fecha_limite) WHERE fecha_limite IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_prestamos_fecha_limite
        ON prestamos (fecha_limite) WHERE fecha_limite IS NOT NULL;

      CREATE TABLE IF NOT EXISTS movimientos_mora (
        id                BIGSERIAL     PRIMARY KEY,
        negocio_id        INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
        sucursal_id       INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
        credito_id        INTEGER       REFERENCES creditos(id)  ON DELETE CASCADE,
        prestamo_id       INTEGER       REFERENCES prestamos(id) ON DELETE CASCADE,
        tipo              TEXT          NOT NULL,
        valor             NUMERIC(14,2) NOT NULL CHECK (valor > 0),
        dias_mora         INTEGER,
        saldo_base        NUMERIC(14,2),
        condicion         JSONB,
        metodo            TEXT,
        motivo            TEXT,
        abono_credito_id  INTEGER       REFERENCES abonos_credito(id)  ON DELETE SET NULL,
        abono_prestamo_id INTEGER       REFERENCES abonos_prestamo(id) ON DELETE SET NULL,
        usuario_id        INTEGER,
        fecha             TIMESTAMP     NOT NULL DEFAULT NOW(),
        anulado           BOOLEAN       NOT NULL DEFAULT FALSE,
        CONSTRAINT movimientos_mora_tipo_chk
          CHECK (tipo IN ('Cobro', 'Condonacion')),
        CONSTRAINT movimientos_mora_un_origen_chk
          CHECK ((credito_id IS NOT NULL) <> (prestamo_id IS NOT NULL))
      );

      CREATE INDEX IF NOT EXISTS idx_mov_mora_credito
        ON movimientos_mora (credito_id)  WHERE credito_id  IS NOT NULL AND NOT anulado;
      CREATE INDEX IF NOT EXISTS idx_mov_mora_prestamo
        ON movimientos_mora (prestamo_id) WHERE prestamo_id IS NOT NULL AND NOT anulado;
      CREATE INDEX IF NOT EXISTS idx_mov_mora_sucursal_fecha
        ON movimientos_mora (sucursal_id, fecha DESC) WHERE NOT anulado;
    `);
  } catch (err) {
    console.error('⚠️  Migración de mora no aplicada (el resto del sistema sigue normal):', err.message);
  }

  // Notificaciones push (Web Push / VAPID) — ver migrations/20260801_push_notificaciones.sql
  //
  // 100% aditiva e idempotente. Un negocio que no active las notificaciones no
  // escribe una sola fila, y sin las variables VAPID_* el módulo ni se monta.
  // Va en su propio try/catch por la misma razón que las demás: un fallo aquí
  // (permisos, BD antigua) solo debe dejar sin notificaciones a quien las use,
  // nunca sin servidor a los otros negocios.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_suscripciones (
        id            SERIAL PRIMARY KEY,
        usuario_id    INTEGER     NOT NULL REFERENCES usuarios(id)   ON DELETE CASCADE,
        negocio_id    INTEGER     NOT NULL REFERENCES negocios(id)   ON DELETE CASCADE,
        sucursal_id   INTEGER              REFERENCES sucursales(id) ON DELETE SET NULL,
        endpoint      TEXT        NOT NULL UNIQUE,
        p256dh        TEXT        NOT NULL,
        auth          TEXT        NOT NULL,
        user_agent    TEXT,
        preferencias  JSONB       NOT NULL DEFAULT '{}'::jsonb,
        activa        BOOLEAN     NOT NULL DEFAULT TRUE,
        creado_en     TIMESTAMP   NOT NULL DEFAULT NOW(),
        ultimo_ok     TIMESTAMP,
        fallos        INTEGER     NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_push_susc_negocio
        ON push_suscripciones (negocio_id, sucursal_id) WHERE activa;
      CREATE INDEX IF NOT EXISTS idx_push_susc_usuario
        ON push_suscripciones (usuario_id) WHERE activa;

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
    `);
  } catch (err) {
    console.error('⚠️  Migración de notificaciones push no aplicada (el resto del sistema sigue normal):', err.message);
  }

  // Catálogo web público — ver migrations/20260803_catalogo_publico.sql
  //
  // 100% aditiva: crea 3 tablas nuevas y NINGÚN ALTER sobre tablas existentes.
  // La vitrina es DELIBERADAMENTE independiente del inventario: la marca, la
  // descripción comercial y las fotos viven solo aquí, así que publicar un
  // producto no cambia ni un byte de `productos_cantidad` / `productos_serial`.
  //
  // El catálogo es POR SUCURSAL: cada sucursal tiene su propio slug y publica
  // sus propias filas. Como los productos ya cuelgan de `sucursal_id`, la ficha
  // se ata al id real del producto y no hay ninguna clave por nombre que se
  // pueda romper al renombrar.
  //
  // Un negocio que no cree una vitrina no escribe una sola fila: para él son 3
  // tablas vacías sin costo ni efecto. Propio try/catch por la misma razón que
  // la red interna: un fallo aquí no puede dejar el servidor sin arrancar.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalogo_sucursal (
        id                     SERIAL      PRIMARY KEY,
        negocio_id             INTEGER     NOT NULL REFERENCES negocios(id)   ON DELETE CASCADE,
        sucursal_id            INTEGER     NOT NULL UNIQUE REFERENCES sucursales(id) ON DELETE CASCADE,
        slug                   TEXT        NOT NULL,
        activo                 BOOLEAN     NOT NULL DEFAULT FALSE,
        titulo                 TEXT,
        descripcion            TEXT,
        whatsapp               TEXT,
        direccion              TEXT,
        horario                TEXT,
        color_primario         TEXT,
        mostrar_precios        BOOLEAN     NOT NULL DEFAULT TRUE,
        mostrar_disponibilidad BOOLEAN     NOT NULL DEFAULT TRUE,
        ocultar_agotados       BOOLEAN     NOT NULL DEFAULT FALSE,
        creado_en              TIMESTAMP   NOT NULL DEFAULT NOW(),
        actualizado_en         TIMESTAMP   NOT NULL DEFAULT NOW()
      );

      -- El slug es la URL pública: único en TODA la plataforma, no por negocio.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_sucursal_slug
        ON catalogo_sucursal (LOWER(slug));
      CREATE INDEX IF NOT EXISTS idx_catalogo_sucursal_negocio
        ON catalogo_sucursal (negocio_id);

      CREATE TABLE IF NOT EXISTS catalogo_items (
        id              BIGSERIAL     PRIMARY KEY,
        negocio_id      INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE CASCADE,
        sucursal_id     INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
        tipo            TEXT          NOT NULL,
        producto_id     INTEGER       NOT NULL,
        publicado       BOOLEAN       NOT NULL DEFAULT FALSE,
        titulo          TEXT,
        descripcion     TEXT,
        marca           TEXT,
        precio_publico  NUMERIC(14,2),
        mostrar_precio  BOOLEAN       NOT NULL DEFAULT TRUE,
        destacado       BOOLEAN       NOT NULL DEFAULT FALSE,
        orden           INTEGER       NOT NULL DEFAULT 0,
        creado_en       TIMESTAMP     NOT NULL DEFAULT NOW(),
        actualizado_en  TIMESTAMP     NOT NULL DEFAULT NOW(),
        CONSTRAINT catalogo_items_tipo_chk CHECK (tipo IN ('serial', 'cantidad'))
      );

      -- Una ficha por producto y sucursal. Sin FK a productos_* porque el tipo
      -- decide la tabla destino; la validación de pertenencia vive en el service.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_items_producto
        ON catalogo_items (sucursal_id, tipo, producto_id);
      CREATE INDEX IF NOT EXISTS idx_catalogo_items_publicados
        ON catalogo_items (sucursal_id, destacado DESC, orden, id) WHERE publicado;

      CREATE TABLE IF NOT EXISTS catalogo_imagenes (
        id           BIGSERIAL   PRIMARY KEY,
        item_id      BIGINT      NOT NULL REFERENCES catalogo_items(id) ON DELETE CASCADE,
        storage_path TEXT        NOT NULL,
        url          TEXT        NOT NULL,
        alt          TEXT,
        bytes        INTEGER,
        orden        INTEGER     NOT NULL DEFAULT 0,
        usuario_id   INTEGER,
        creado_en    TIMESTAMP   NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_catalogo_imagenes_item
        ON catalogo_imagenes (item_id, orden);
    `);
  } catch (err) {
    console.error('⚠️  Migración del catálogo público no aplicada (el resto del sistema sigue normal):', err.message);
  }

  // Aplicadas manualmente en producción:
  // - lineas_traslado: revertida_por_usuario_id, fecha_reversion
  // - traslados: revertido_por_usuario_id, fecha_reversion
  // - lineas_compra: producto_id (para revertir stock de productos cantidad simples al cancelar)
  //   ALTER TABLE lineas_compra ADD COLUMN IF NOT EXISTS producto_id integer REFERENCES productos_cantidad(id);
  // - movimientos_acreedor: sucursal_id (caja de proveedores por sucursal) — ver migrations/20260628_movimientos_acreedor_sucursal.sql
  //   ALTER TABLE movimientos_acreedor ADD COLUMN IF NOT EXISTS sucursal_id integer; + backfill por compra
  // - vendedores: catálogo de vendedores por negocio/sucursal + facturas.vendedor_id — ver migrations/20260706_vendedores.sql
  //   CREATE TABLE vendedores(...); ALTER TABLE facturas ADD COLUMN IF NOT EXISTS vendedor_id integer;
  //
  // Pendiente de aplicar manualmente (opcional, 100% aditiva):
  // - auditoria_eliminaciones: papelera ante borrados por error — ver migrations/20260709_auditoria_eliminaciones.sql
  //   CREATE TABLE auditoria_eliminaciones(...) + triggers BEFORE DELETE en tablas de negocio. Idempotente.
  // - tesoreria: cuentas de dinero + movimientos + arqueos — ver migrations/20260709_tesoreria.sql
  //   CREATE TABLE cuentas_dinero / movimientos_dinero / arqueos_cuenta. Idempotente. REQUERIDA para el módulo Tesorería.
  // - tesoreria divisa (USD): columnas moneda y tasa_cambio — ver migrations/20260710_tesoreria_divisa.sql
  //   Idempotente; aplicar después de 20260709_tesoreria.sql (la versión actual de 20260709 ya las incluye).
  // - tesoreria pago-compra: proveedor_id/compra_id en movimientos_dinero — ver migrations/20260710_tesoreria_pago_compra.sql
  //   Idempotente; permite asignar "Pagué mercancía" a proveedor/compra y bloquear dobles pagos.
  // - tesoreria abono espejo: mov_dinero_id en movimientos_acreedor + backfill — ver migrations/20260710_tesoreria_abono_espejo.sql
  //   Idempotente; un pago de compra desde Tesorería crea un Abono (registrar_en_caja=FALSE) que salda la deuda del acreedor.
  console.log('✅ Migraciones: sin pendientes.');
};

module.exports = { runMigrations };