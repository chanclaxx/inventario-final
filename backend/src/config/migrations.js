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