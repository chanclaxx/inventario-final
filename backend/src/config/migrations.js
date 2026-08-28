const { pool } = require('./db');

// ── Aplicar DDL de arranque sin poder tumbar el servidor ─────────────────────
//
// `ALTER TABLE` pide ACCESS EXCLUSIVE sobre la tabla. Si hay UNA transacción
// abierta encima —una importación larga, una consulta colgada, una sesión que
// quedó `idle in transaction`— el ALTER se queda esperando. Sin tope esperaba
// hasta el statement_timeout y el arranque moría con **57014 (query_canceled)**,
// dejando a los 28 negocios sin backend por una migración que además ya estaba
// aplicada. Pasó en producción el 23-ago-2026, y murió en el PRIMER bloque
// (`nota`), que toca `productos_cantidad` y `seriales` — las tablas más
// calientes del sistema.
//
// Con `lock_timeout` falla en 3 segundos, se anota en el log y el servidor
// arranca igual; en el siguiente despliegue se aplica. Una feature apagada es un
// problema de una feature; un backend que no arranca es un problema de todos.
//
// Va sobre un client DEDICADO, no sobre `pool.query`: si un multi-statement con
// BEGIN falla a la mitad, la sesión queda en "aborted transaction", y un
// `pool.query('ROLLBACK')` suelto podría tomar OTRA conexión y dejar la rota en
// el pool para que la herede la primera consulta real. El `finally` devuelve el
// `lock_timeout` a su valor normal antes de soltar la conexión: nadie más debe
// heredar un tope de 3s.
const migrar = async (client, etiqueta, sql) => {
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`⚠️  ${etiqueta}: no aplicada, se reintenta en el próximo arranque —`, err.message);
    return false;
  }
};

// Un solo client para TODA la migración, con el tope de espera puesto una vez:
// así los bloques que NO pasan por `migrar()` —los que ya traen su propio
// try/catch— tampoco se quedan colgados esperando un lock. Sin esto no mataban
// el arranque, pero cada uno esperaba hasta el statement_timeout y el
// despliegue quedaba detenido igual.
//
// El `finally` devuelve el tope a su valor normal antes de soltar la conexión:
// ninguna consulta de la app debe heredar un lock_timeout de 3 segundos.
const runMigrations = async () => {
  const client = await pool.connect();
  try {
    await client.query("SET lock_timeout = '3s'");
    await aplicarMigraciones(client);
  } finally {
    await client.query('SET lock_timeout = DEFAULT').catch(() => {});
    client.release();
  }
};

const aplicarMigraciones = async (client) => {
  // ── Auto-aplicadas al arrancar (100% aditivas e idempotentes) ──────────────
  // Notas / post-it de inventario — ver migrations/20260710_notas_inventario.sql
  await migrar(client, 'Notas de inventario', `
    ALTER TABLE IF EXISTS seriales           ADD COLUMN IF NOT EXISTS nota TEXT;
    ALTER TABLE IF EXISTS productos_serial   ADD COLUMN IF NOT EXISTS nota TEXT;
    ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS nota TEXT;
  `);

  // Código único de producto (tipo supermercado) — ver migrations/20260714_codigo_producto.sql
  // 100% aditiva e idempotente. Columna nullable: negocios sin la feature no la notan.
  // Unicidad por sucursal solo entre productos activos (permite reusar código tras borrado lógico).
  await migrar(client, 'Código único de producto', `
    ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS codigo TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_cantidad_codigo
      ON productos_cantidad (sucursal_id, codigo)
      WHERE codigo IS NOT NULL AND activo;
  `);

  // Código único en variantes — ver migrations/20260823_codigo_variantes.sql
  // 100% aditiva e idempotente, sin backfill: quien ya tenía código en el
  // producto sigue escaneando igual. Con variantes activas lo que se escanea es
  // el atributo (la talla 38MM), no el producto, y antes no había dónde ponerlo.
  // `variantes_atributo` no tiene sucursal_id, así que su índice es por atributo;
  // el alcance de sucursal y la unicidad entre los tres niveles la impone
  // src/utils/codigo.util.js.
  await migrar(client, 'Código en variantes', `
    ALTER TABLE IF EXISTS atributos_producto ADD COLUMN IF NOT EXISTS codigo TEXT;
    ALTER TABLE IF EXISTS variantes_atributo ADD COLUMN IF NOT EXISTS codigo TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_atributos_producto_codigo
      ON atributos_producto (sucursal_id, codigo)
      WHERE codigo IS NOT NULL AND activo;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_variantes_atributo_codigo
      ON variantes_atributo (atributo_id, codigo)
      WHERE codigo IS NOT NULL AND activo;
  `);

  // La línea de remisión apunta a un NODO — ver migrations/20260823_remision_variantes.sql
  // Sin esto, despachar un producto por variantes movía stock y costo en el
  // nivel del producto: el inventario quedaba descuadrado en las dos sedes, la
  // tarifa del local se quedaba sin base, y el primer ajuste sobre cualquier
  // variante borraba lo recibido mientras el local lo seguía debiendo.
  await migrar(client, 'Variantes en remisiones', `
    ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS atributo_origen_id  INT;
    ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS variante_origen_id  INT;
    ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS atributo_destino_id INT;
    ALTER TABLE IF EXISTS lineas_remision ADD COLUMN IF NOT EXISTS variante_destino_id INT;
    CREATE INDEX IF NOT EXISTS idx_lineas_remision_atributo_origen
      ON lineas_remision (atributo_origen_id) WHERE atributo_origen_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_lineas_remision_atributo_destino
      ON lineas_remision (atributo_destino_id) WHERE atributo_destino_id IS NOT NULL;
    ALTER TABLE IF EXISTS historial_stock_cantidad ADD COLUMN IF NOT EXISTS atributo_id INT;
    ALTER TABLE IF EXISTS historial_stock_cantidad ADD COLUMN IF NOT EXISTS variante_id INT;
  `);

  // La línea de entrega por cantidad es un LOTE — ver migrations/20260823_lotes_cantidad.sql
  // Sin esto, devolver mercancía fungible se acreditaba con agregados por
  // producto y promedios: el local podía bajar su deuda devolviendo una talla
  // que la bodega nunca le envió, y a un precio que no era el de ninguna unidad.
  await migrar(client, 'Lotes de cantidad', `
    ALTER TABLE IF EXISTS lineas_remision
      ADD COLUMN IF NOT EXISTS cantidad_devuelta INT NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_lineas_remision_lote_pendiente
      ON lineas_remision (producto_destino_id, atributo_destino_id, variante_destino_id)
      WHERE tipo = 'cantidad' AND estado_linea = 'Recibida';
  `);

  // Costo de la BODEGA congelado en la línea — ver migrations/20260824_costo_origen_remision.sql
  // Sin esto, la utilidad de la bodega por lo que despacha no se puede calcular
  // para la mercancía por cantidad: su costo es un promedio ponderado que se
  // mueve con cada compra y no hay forma de reconstruir el que tenía al salir.
  await migrar(client, 'Costo de origen en la remisión', `
    ALTER TABLE IF EXISTS lineas_remision
      ADD COLUMN IF NOT EXISTS costo_origen NUMERIC(14,2);
  `);

  // Crédito real de una línea de devolución — ver migrations/20260823_valor_acreditado.sql
  // El extracto necesita un movimiento que explique por qué bajó la deuda: sin
  // él, el cargo bajaba solo y el saldo del extracto dejaba de cuadrar con
  // `deuda_total`. No se puede derivar del `valor_interno` de la línea, porque
  // una devolución que cruza dos lotes se acredita a dos precios distintos.
  await migrar(client, 'Crédito de devolución', `
    ALTER TABLE IF EXISTS lineas_remision
      ADD COLUMN IF NOT EXISTS valor_acreditado NUMERIC(14,2);
  `);

  // Abonos anulados con motivo — ver migrations/20260825_abonos_anulados.sql
  // Un abono puede dejar de contar sin desaparecer: cuando su producto se
  // devuelve, y cuando el mismo pago se registró dos veces por un doble clic.
  // Borrar la fila cuadraría el número pero borraría la explicación.
  await migrar(client, 'Abonos anulados con motivo', `
    ALTER TABLE abonos_prestamo
      ADD COLUMN IF NOT EXISTS anulado          BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS valor_anulado    NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT,
      ADD COLUMN IF NOT EXISTS anulado_en       TIMESTAMPTZ;
    ALTER TABLE abonos_credito
      ADD COLUMN IF NOT EXISTS anulado          BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS valor_anulado    NUMERIC(14,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT,
      ADD COLUMN IF NOT EXISTS anulado_en       TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_abonos_prestamo_anulado
      ON abonos_prestamo (prestamo_id) WHERE anulado;
    CREATE INDEX IF NOT EXISTS idx_abonos_credito_anulado
      ON abonos_credito (credito_id) WHERE anulado;
  `);

  // Pago total en créditos — ver migrations/20260825_pago_total_credito.sql
  // `destino` NO es opcional: `abonos_totales` ya se usa para préstamos hechos
  // a un cliente, y sin distinguir, un pago total de créditos saldría también
  // en el extracto de préstamos de esa persona, restando sin nada detrás.
  await migrar(client, 'Pago total en créditos', `
    ALTER TABLE abonos_totales
      ADD COLUMN IF NOT EXISTS destino TEXT NOT NULL DEFAULT 'prestamo';
    ALTER TABLE abonos_credito
      ADD COLUMN IF NOT EXISTS abono_total_id INTEGER;
    CREATE INDEX IF NOT EXISTS idx_abonos_credito_abono_total
      ON abonos_credito (abono_total_id) WHERE abono_total_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_abonos_totales_destino
      ON abonos_totales (destino, tipo_persona, persona_id);
  `);

  // Permiso por usuario para editar y cancelar facturas emitidas
  // — ver migrations/20260828_permisos_facturas.sql
  //
  // NULL = permisos base del rol, o sea exactamente lo de antes de la columna:
  // supervisor y admin pueden, vendedor no. Por eso aplicarla no le cambia el
  // acceso a nadie; solo habilita ajustarlo usuario por usuario.
  await migrar(client, 'Permisos de facturas por usuario', `
    ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS permisos_facturas JSONB;
  `);

  // Entradas de bodega — ver migrations/20260828_entradas_bodega.sql
  //
  // Una Entrada ES una compra: misma fila, mismo consecutivo, misma
  // `registrarCompra()`. Estas dos columnas son todo el modelo nuevo.
  // `factura_confirmada` nace en TRUE para que ninguna compra existente
  // aparezca de golpe en la bandeja de pendientes.
  await migrar(client, 'Entradas de bodega', `
    ALTER TABLE compras
      ADD COLUMN IF NOT EXISTS factura_confirmada BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE compras ALTER COLUMN proveedor_id DROP NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_compras_por_confirmar
      ON compras (sucursal_id, fecha)
      WHERE factura_confirmada = FALSE;
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
    await client.query(`
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
  await client.query(`
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
    await client.query(`
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
    await client.query(`
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
    await client.query(`
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

    // v3 — EL ENVÍO ES LA DEUDA. Ver migrations/20260822_red_interna_envios.sql.
    //
    // El local pasa a pagar todo lo que recibe (antes solo lo vendido), y cada
    // envío lleva su propia cuenta. El CARGO se sigue derivando de las líneas;
    // lo que hay que guardar es el ABONO, porque a qué envío se imputa un pago
    // lo decide una persona y no se puede leer de ninguna otra tabla.
    await client.query(`
      CREATE TABLE IF NOT EXISTS abonos_remision (
        id            BIGSERIAL     PRIMARY KEY,
        negocio_id    INTEGER       NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
        sucursal_id   INTEGER       NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
        remision_id   BIGINT        NOT NULL REFERENCES remisiones(id) ON DELETE CASCADE,
        origen        TEXT          NOT NULL,
        remesa_id     BIGINT        REFERENCES remesas(id)                    ON DELETE CASCADE,
        movimiento_id BIGINT        REFERENCES movimientos_cuenta_interna(id) ON DELETE CASCADE,
        valor         NUMERIC(14,2) NOT NULL CHECK (valor > 0),
        fecha         TIMESTAMP     NOT NULL DEFAULT NOW(),
        usuario_id    INTEGER,
        notas         TEXT,
        anulado       BOOLEAN       NOT NULL DEFAULT FALSE,
        CONSTRAINT abonos_remision_origen_chk
          CHECK (origen IN ('remesa', 'gasto', 'ajuste', 'saldo_favor')),
        CONSTRAINT abonos_remision_fuente_chk
          CHECK ((origen = 'remesa' AND remesa_id IS NOT NULL)
              OR (origen IN ('gasto', 'ajuste') AND movimiento_id IS NOT NULL)
              OR  origen = 'saldo_favor')
      );
      CREATE INDEX IF NOT EXISTS idx_abonos_remision_remision
        ON abonos_remision (remision_id) WHERE NOT anulado;
      CREATE INDEX IF NOT EXISTS idx_abonos_remision_local
        ON abonos_remision (negocio_id, sucursal_id, fecha DESC) WHERE NOT anulado;
      CREATE INDEX IF NOT EXISTS idx_abonos_remision_remesa
        ON abonos_remision (remesa_id) WHERE remesa_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_abonos_remision_movimiento
        ON abonos_remision (movimiento_id) WHERE movimiento_id IS NOT NULL;
    `);

    // Backfill del cambio de modelo. Ver
    // migrations/20260822_red_interna_envios_backfill.sql — este bloque es el
    // mismo, replicado aquí porque es lo que corre de verdad en producción.
    //
    // Imputa los pagos que ya existían a los envíos, en orden cronológico y
    // FIFO. Se salta cualquier local que YA tenga abonos, así que después de la
    // primera pasada es un no-op: puede correr en cada arranque sin duplicar
    // un peso. Lo que sobre queda sin imputar y se lee como saldo a favor.
    await client.query(`
      DO $backfill$
      DECLARE
        v_local  RECORD; v_pago RECORD; v_envio RECORD;
        v_resto NUMERIC(14,2); v_aplica NUMERIC(14,2);
      BEGIN
        FOR v_local IN
          SELECT DISTINCT r.negocio_id, r.sucursal_destino_id AS sucursal_id
          FROM remisiones r
          JOIN config_negocio c ON c.negocio_id = r.negocio_id
                               AND c.clave = 'red_interna_activa' AND c.valor = '1'
          WHERE r.tipo = 'entrega' AND r.estado <> 'Anulada'
            AND NOT EXISTS (
              SELECT 1 FROM abonos_remision a
              WHERE a.negocio_id = r.negocio_id
                AND a.sucursal_id = r.sucursal_destino_id
            )
          ORDER BY 1, 2
        LOOP
          FOR v_pago IN
            SELECT * FROM (
              SELECT 'remesa'::text AS origen, r.id AS ref_id, r.valor AS valor,
                     COALESCE(r.fecha_recepcion, r.fecha_envio) AS fecha
              FROM remesas r
              WHERE r.negocio_id = v_local.negocio_id
                AND r.sucursal_origen_id = v_local.sucursal_id
                AND r.estado = 'Recibida'
              UNION ALL
              SELECT CASE WHEN m.tipo = 'GastoAutorizado' THEN 'gasto' ELSE 'ajuste' END,
                     m.id, m.valor, m.fecha
              FROM movimientos_cuenta_interna m
              WHERE m.negocio_id = v_local.negocio_id
                AND m.sucursal_id = v_local.sucursal_id
                AND NOT m.anulado
                AND m.tipo IN ('GastoAutorizado', 'Ajuste')
                AND m.valor > 0
            ) p
            ORDER BY p.fecha, p.origen, p.ref_id
          LOOP
            v_resto := v_pago.valor;
            FOR v_envio IN
              SELECT r.id, (cargo.total - COALESCE(ab.total, 0)) AS saldo
              FROM remisiones r
              JOIN LATERAL (
                SELECT COALESCE(SUM(
                  lr.valor_interno * CASE WHEN lr.tipo = 'serial' THEN 1
                                          ELSE COALESCE(lr.cantidad_recibida, lr.cantidad, 0) END
                ), 0) AS total
                FROM lineas_remision lr
                WHERE lr.remision_id = r.id AND lr.estado_linea = 'Recibida'
              ) cargo ON TRUE
              LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(a.valor), 0) AS total
                FROM abonos_remision a
                WHERE a.remision_id = r.id AND NOT a.anulado
              ) ab ON TRUE
              WHERE r.negocio_id = v_local.negocio_id
                AND r.sucursal_destino_id = v_local.sucursal_id
                AND r.tipo = 'entrega' AND r.estado <> 'Anulada'
                AND (cargo.total - COALESCE(ab.total, 0)) > 0
              ORDER BY COALESCE(r.fecha_recepcion, r.fecha_emision), r.id
            LOOP
              EXIT WHEN v_resto <= 0;
              v_aplica := LEAST(v_resto, v_envio.saldo);
              IF v_aplica > 0 THEN
                INSERT INTO abonos_remision
                  (negocio_id, sucursal_id, remision_id, origen,
                   remesa_id, movimiento_id, valor, fecha, notas)
                VALUES (
                  v_local.negocio_id, v_local.sucursal_id, v_envio.id, v_pago.origen,
                  CASE WHEN v_pago.origen = 'remesa'  THEN v_pago.ref_id END,
                  CASE WHEN v_pago.origen <> 'remesa' THEN v_pago.ref_id END,
                  v_aplica, v_pago.fecha,
                  'Imputado al migrar al modelo de envío a crédito'
                );
                v_resto := v_resto - v_aplica;
              END IF;
            END LOOP;
          END LOOP;
        END LOOP;
      END
      $backfill$;
    `);

    // v4 — que nadie cambie la cuenta a espaldas del otro.
    // Ver migrations/20260823_red_interna_control.sql.
    //
    // Aprobación de los movimientos de cuenta (un gasto del local ya no baja su
    // deuda hasta que la bodega lo apruebe) y motivo de la devolución, para
    // distinguir "lo regresé" de "nunca llegó".
    //
    // 'Aprobado' por DEFAULT y no 'Por aprobar': al revés, todo lo ya
    // registrado quedaría en el limbo y la deuda de cada local cambiaría solo
    // por aplicar la migración.
    await client.query(`
      ALTER TABLE IF EXISTS movimientos_cuenta_interna
        ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'Aprobado';
      ALTER TABLE IF EXISTS movimientos_cuenta_interna
        ADD COLUMN IF NOT EXISTS usuario_aprueba_id INTEGER;
      ALTER TABLE IF EXISTS movimientos_cuenta_interna
        ADD COLUMN IF NOT EXISTS fecha_aprobacion TIMESTAMP;
      ALTER TABLE IF EXISTS remisiones
        ADD COLUMN IF NOT EXISTS motivo TEXT;

      CREATE INDEX IF NOT EXISTS idx_mci_por_aprobar
        ON movimientos_cuenta_interna (negocio_id, estado)
        WHERE estado = 'Por aprobar' AND NOT anulado;
    `);

    // v5 — un CARGO también es un documento que se paga.
    // Ver migrations/20260823_red_interna_cargos_pagables.sql.
    //
    // Un ajuste en contra subía la deuda pero no era un documento: nadie le
    // podía imputar un abono, así que no se podía pagar NUNCA. Con los envíos
    // al día, el dinero que entraba se volvía saldo a favor y el cargo se
    // quedaba ahí — deber y tener a favor al mismo tiempo.
    await client.query(`
      ALTER TABLE IF EXISTS abonos_remision ALTER COLUMN remision_id DROP NOT NULL;
      ALTER TABLE IF EXISTS abonos_remision ADD COLUMN IF NOT EXISTS cargo_id BIGINT
        REFERENCES movimientos_cuenta_interna(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_abonos_remision_cargo
        ON abonos_remision (cargo_id) WHERE cargo_id IS NOT NULL AND NOT anulado;
    `);

    // Los CHECK van aparte: ADD CONSTRAINT no admite IF NOT EXISTS.
    await client.query(`
      DO $chk$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mci_estado_chk') THEN
          ALTER TABLE movimientos_cuenta_interna ADD CONSTRAINT mci_estado_chk
            CHECK (estado IN ('Por aprobar', 'Aprobado', 'Rechazado'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remisiones_motivo_chk') THEN
          ALTER TABLE remisiones ADD CONSTRAINT remisiones_motivo_chk
            CHECK (motivo IS NULL OR motivo IN ('devolucion', 'faltante'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'abonos_remision_destino_chk') THEN
          ALTER TABLE abonos_remision ADD CONSTRAINT abonos_remision_destino_chk
            CHECK ((remision_id IS NOT NULL AND cargo_id IS NULL)
                OR (remision_id IS NULL     AND cargo_id IS NOT NULL));
        END IF;
      END
      $chk$;
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
    await client.query(`
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

  // Interés corriente en créditos y préstamos — ver migrations/20260804_interes_corriente.sql
  //
  // Hermana de la mora: aquella sanciona el ATRASO, esta cobra el PLAZO. Son
  // independientes — se puede tener una, la otra, las dos o ninguna.
  //
  // 100% aditiva: 4 columnas nullable, 3 índices parciales y una columna
  // discriminadora en `movimientos_mora`. `concepto` es la única con DEFAULT, y
  // al ser constante NO reescribe la tabla (PostgreSQL 11+); las filas que ya
  // existen quedan como 'mora', que es exactamente lo que son.
  //
  // `interes_condicion IS NULL` ⇒ el documento no causa interés, así que los
  // créditos y préstamos que ya existen no cambian ni al migrar ni al activar la
  // feature con `interes_activa`.
  //
  // El interés cobrado vive en `movimientos_mora` y NUNCA en `total_abonado`,
  // por la misma razón que la mora: los reportes calculan la utilidad como
  // (abonado − costo) y lo contarían como margen comercial. Es ingreso financiero.
  //
  // Propio try/catch: un fallo aquí no puede dejar el servidor sin arrancar.
  try {
    await client.query(`
      ALTER TABLE IF EXISTS creditos  ADD COLUMN IF NOT EXISTS interes_condicion JSONB;
      ALTER TABLE IF EXISTS creditos  ADD COLUMN IF NOT EXISTS interes_desde     DATE;
      ALTER TABLE IF EXISTS prestamos ADD COLUMN IF NOT EXISTS interes_condicion JSONB;
      ALTER TABLE IF EXISTS prestamos ADD COLUMN IF NOT EXISTS interes_desde     DATE;

      CREATE INDEX IF NOT EXISTS idx_creditos_interes
        ON creditos (id) WHERE interes_condicion IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_prestamos_interes
        ON prestamos (id) WHERE interes_condicion IS NOT NULL;

      ALTER TABLE IF EXISTS movimientos_mora
        ADD COLUMN IF NOT EXISTS concepto TEXT NOT NULL DEFAULT 'mora';

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'movimientos_mora_concepto_chk'
        ) THEN
          ALTER TABLE movimientos_mora
            ADD CONSTRAINT movimientos_mora_concepto_chk
            CHECK (concepto IN ('mora', 'interes'));
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_mov_mora_concepto
        ON movimientos_mora (sucursal_id, concepto, fecha DESC) WHERE NOT anulado;
    `);
  } catch (err) {
    console.error('⚠️  Migración de interés no aplicada (el resto del sistema sigue normal):', err.message);
  }

  // Pago total a acreedores: marca de agrupación — ver migrations/20260805_pago_total_acreedor.sql
  //
  // El pago se sigue repartiendo entre los cargos abiertos (una fila por cargo);
  // esta columna solo dice cuáles filas salieron del mismo pago para que el
  // estado de cuenta las muestre como un movimiento. No guarda importes: el
  // total se DERIVA con SUM sobre las hijas, así que anular una compra o editar
  // un abono ajusta el pago mostrado sin descuadrar el saldo.
  //
  // 100% aditiva e idempotente. Sin la columna todo funciona como antes.
  try {
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS pago_total_acreedor_seq;

      ALTER TABLE IF EXISTS movimientos_acreedor
        ADD COLUMN IF NOT EXISTS pago_total_id BIGINT;

      CREATE INDEX IF NOT EXISTS idx_mov_acreedor_pago_total
        ON movimientos_acreedor (pago_total_id) WHERE pago_total_id IS NOT NULL;
    `);

    // Backfill de los pagos ya registrados. Las filas de un mismo pago se
    // insertaron en una transacción, así que comparten `fecha` al microsegundo.
    await client.query(`
      WITH grupos AS (
        SELECT acreedor_id, fecha, metodo,
               nextval('pago_total_acreedor_seq') AS nuevo_id
        FROM movimientos_acreedor
        WHERE tipo          = 'Abono'
          AND descripcion   = 'Pago total distribuido'
          AND pago_total_id IS NULL
        GROUP BY acreedor_id, fecha, metodo
      )
      UPDATE movimientos_acreedor m
      SET pago_total_id = g.nuevo_id
      FROM grupos g
      WHERE m.tipo          = 'Abono'
        AND m.descripcion   = 'Pago total distribuido'
        AND m.pago_total_id IS NULL
        AND m.acreedor_id   = g.acreedor_id
        AND m.fecha         = g.fecha
        AND m.metodo        IS NOT DISTINCT FROM g.metodo
    `);
  } catch (err) {
    console.error('⚠️  Migración de pago total a acreedores no aplicada (el resto del sistema sigue normal):', err.message);
  }

  // Descripción del pago total — ver migrations/20260813_descripcion_pago_total.sql
  //
  // Texto libre para los dos pagos que se reparten en FIFO (abono total a los
  // préstamos de una persona y pago total a un acreedor): por qué se hizo. No
  // entra en ningún cálculo.
  //
  // 100% aditiva e idempotente: dos columnas nullable y sin DEFAULT, así que no
  // reescriben una sola fila. Lo ya registrado queda con NULL, es decir, igual
  // que hoy. En `movimientos_acreedor` va en columna propia y no en
  // `descripcion`, que es la del abono individual y la que usa el backfill de
  // 20260805 para reconocer los pagos totales viejos.
  try {
    await client.query(`
      ALTER TABLE IF EXISTS abonos_totales
        ADD COLUMN IF NOT EXISTS descripcion TEXT;
      ALTER TABLE IF EXISTS movimientos_acreedor
        ADD COLUMN IF NOT EXISTS pago_total_descripcion TEXT;
    `);
  } catch (err) {
    console.error('⚠️  Descripción del pago total no aplicada (los pagos totales siguen normales):', err.message);
  }

  // Notificaciones push (Web Push / VAPID) — ver migrations/20260801_push_notificaciones.sql
  //
  // 100% aditiva e idempotente. Un negocio que no active las notificaciones no
  // escribe una sola fila, y sin las variables VAPID_* el módulo ni se monta.
  // Va en su propio try/catch por la misma razón que las demás: un fallo aquí
  // (permisos, BD antigua) solo debe dejar sin notificaciones a quien las use,
  // nunca sin servidor a los otros negocios.
  try {
    await client.query(`
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
    await client.query(`
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

  // Órdenes de compra, recepción parcial, procedencia y garantía de proveedor
  // — ver migrations/20260806_ordenes_compra.sql para el detalle del diseño.
  //
  // 100% aditiva: 4 tablas nuevas y solo columnas NULL-ables (más una con
  // DEFAULT 0) sobre las existentes. Un negocio sin los flags jamás escribe en
  // ellas, así que para el resto son tablas vacías sin costo ni efecto.
  //
  // Va en su propio try/catch A PROPÓSITO: runMigrations() corre antes de
  // app.listen(), así que un fallo aquí (permisos, tipo de FK inesperado en una
  // BD vieja) dejaría el servidor sin arrancar para TODOS los negocios. Ante un
  // error se registra y se sigue: solo esta feature queda sin infraestructura,
  // y su middleware ya responde 503 si las tablas no existen.
  try {
    await client.query(`
      -- cantidad_devuelta va primero porque es la única que toca código vivo:
      -- devolverCompra() revierte inventario y emite la nota crédito, pero hoy
      -- no registra QUÉ unidades volvieron. Sin esto, una orden marcaría 100/100
      -- tras devolver 40, y la procedencia le atribuiría a un proveedor unidades
      -- que ya le regresaron. Backfill 0: las devoluciones históricas solo
      -- existen como texto libre y adivinarlas sería peor que no saberlas.
      ALTER TABLE IF EXISTS lineas_compra
        ADD COLUMN IF NOT EXISTS cantidad_devuelta INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS ordenes_compra (
        id                 BIGSERIAL     PRIMARY KEY,
        negocio_id         INTEGER       NOT NULL REFERENCES negocios(id)    ON DELETE RESTRICT,
        numero             INTEGER,
        sucursal_id        INTEGER       NOT NULL REFERENCES sucursales(id)  ON DELETE RESTRICT,
        proveedor_id       INTEGER       NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,
        usuario_id         INTEGER,
        -- Solo decisiones humanas. Parcial/Completa se DERIVAN de lineas_compra:
        -- cancelarCompra() nunca iría a corregir un contador guardado aquí.
        estado             TEXT          NOT NULL DEFAULT 'Borrador',
        fecha_emision      TIMESTAMP     NOT NULL DEFAULT NOW(),
        fecha_esperada     DATE,
        numero_factura     TEXT,
        fecha_factura      DATE,
        dias_plazo         INTEGER,
        fecha_vencimiento  DATE,
        total_estimado     NUMERIC(14,2) NOT NULL DEFAULT 0,
        notas              TEXT,
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
      CREATE INDEX IF NOT EXISTS idx_ordenes_compra_vencimiento
        ON ordenes_compra (negocio_id, fecha_vencimiento)
        WHERE fecha_vencimiento IS NOT NULL AND estado = 'Emitida';

      CREATE TABLE IF NOT EXISTS lineas_orden_compra (
        id              BIGSERIAL     PRIMARY KEY,
        orden_id        BIGINT        NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
        tipo            TEXT          NOT NULL,
        producto_id     INTEGER,
        nombre_producto TEXT          NOT NULL,
        variante_id     INTEGER,
        atributo_id     INTEGER,
        cantidad_pedida INTEGER       NOT NULL,
        -- Referencia, NUNCA costo: el costo promedio se calcula siempre con el
        -- precio efectivamente recibido.
        precio_estimado NUMERIC(14,2),
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

      -- Una compra pasa a ser una RECEPCIÓN. Ambas columnas NULL-ables: la
      -- compra suelta de siempre las deja vacías y nadie más las consulta.
      ALTER TABLE IF EXISTS compras
        ADD COLUMN IF NOT EXISTS orden_compra_id BIGINT REFERENCES ordenes_compra(id) ON DELETE RESTRICT;
      ALTER TABLE IF EXISTS lineas_compra
        ADD COLUMN IF NOT EXISTS orden_linea_id BIGINT REFERENCES lineas_orden_compra(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_compras_orden
        ON compras (orden_compra_id) WHERE orden_compra_id IS NOT NULL;
      -- El índice que sostiene TODO el cálculo de avance de la orden.
      CREATE INDEX IF NOT EXISTS idx_lineas_compra_orden_linea
        ON lineas_compra (orden_linea_id) WHERE orden_linea_id IS NOT NULL;

      -- Hoy NINGÚN cargo de acreedor tiene fecha límite. orden_compra_id existe
      -- para el modo de cargo POR ORDEN: ahí el Cargo nace al registrar la
      -- factura y las recepciones no crean cargo propio.
      ALTER TABLE IF EXISTS movimientos_acreedor
        ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;
      ALTER TABLE IF EXISTS movimientos_acreedor
        ADD COLUMN IF NOT EXISTS orden_compra_id BIGINT REFERENCES ordenes_compra(id) ON DELETE RESTRICT;
      CREATE INDEX IF NOT EXISTS idx_mov_acreedor_vencimiento
        ON movimientos_acreedor (fecha_vencimiento)
        WHERE fecha_vencimiento IS NOT NULL AND tipo = 'Cargo';
      CREATE INDEX IF NOT EXISTS idx_mov_acreedor_orden
        ON movimientos_acreedor (orden_compra_id) WHERE orden_compra_id IS NOT NULL;

      -- Garantía del PROVEEDOR. Nada que ver con el módulo garantias (a secas),
      -- que es un catálogo de textos que van del negocio HACIA EL CLIENTE. Ese
      -- va en la dirección contraria a este. El plazo se
      -- congela en la línea de compra: subir el default del proveedor no puede
      -- alterar una garantía ya otorgada.
      ALTER TABLE IF EXISTS lineas_compra
        ADD COLUMN IF NOT EXISTS garantia_dias INTEGER;
      ALTER TABLE IF EXISTS proveedores
        ADD COLUMN IF NOT EXISTS garantia_dias_default INTEGER;

      -- Bitácora. NO cuelga de la orden a propósito: un lote malo aparece meses
      -- después, en una compra que quizá nunca tuvo orden, y los negocios con
      -- las órdenes apagadas también reclaman garantías.
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

      -- Códigos del proveedor. Apunta al CÓDIGO INTERNO, no al producto_id: un
      -- proveedor le vende al negocio, pero productos_cantidad tiene una fila
      -- por sucursal. Con producto_id harían falta N filas por equivalencia y
      -- derivarían a la primera sucursal nueva.
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
      -- Case-insensitive: las remisiones llegan en mayúsculas o minúsculas
      -- según quién las imprima.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_codigos_proveedor_codigo
        ON codigos_proveedor (proveedor_id, UPPER(BTRIM(codigo_proveedor)));
      -- NO único a propósito: tres proveedores venden el mismo cargador con tres
      -- referencias distintas, y esa es justamente la información que se guarda.
      CREATE INDEX IF NOT EXISTS idx_codigos_proveedor_interno
        ON codigos_proveedor (negocio_id, codigo_interno);
    `);
  } catch (err) {
    console.error('⚠️  Órdenes de compra no aplicadas (el resto del sistema sigue normal):', err.message);
  }

  // Borradores de venta (carritos guardados) — ver migrations/20260815_borradores.sql
  //
  // 100% aditiva e idempotente. Tablas nuevas: ningún negocio las nota hasta
  // encender `borradores_activo` en Configuración.
  //
  // El inventario NO se toca desde aquí: la reserva se DERIVA leyendo estas
  // tablas. Un serial en un borrador sigue vendido=false y sigue siendo
  // vendible — el bloqueo es blando a propósito.
  //
  // Va en su propio try/catch porque runMigrations() corre antes de app.listen():
  // un fallo aquí solo debe dejar sin borradores a quien los use, nunca sin
  // servidor a los otros negocios.
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS borradores (
        id             SERIAL      PRIMARY KEY,
        sucursal_id    INTEGER     NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
        usuario_id     INTEGER,
        titulo         TEXT        NOT NULL,
        destino        TEXT        NOT NULL DEFAULT 'indefinido',
        nota           TEXT,
        -- Lo diligenciado en el modal de factura/préstamo cuando el cliente
        -- interrumpió. Blob opaco: el backend no lo interpreta.
        datos          JSONB,
        expira_en      TIMESTAMP,
        creado_en      TIMESTAMP   NOT NULL DEFAULT NOW(),
        actualizado_en TIMESTAMP   NOT NULL DEFAULT NOW(),
        CONSTRAINT borradores_destino_chk
          CHECK (destino IN ('factura', 'prestamo', 'indefinido'))
      );

      -- El total no se guarda: se deriva con SUM. Quitar un ítem tiene que
      -- bajarlo, y un total guardado quedaría inflado contra el contenido real.
      CREATE TABLE IF NOT EXISTS borradores_items (
        id             SERIAL       PRIMARY KEY,
        borrador_id    INTEGER      NOT NULL REFERENCES borradores(id) ON DELETE CASCADE,
        item_key       TEXT         NOT NULL,
        tipo           TEXT         NOT NULL,
        nombre         TEXT         NOT NULL,
        serial_id      INTEGER      REFERENCES seriales(id)           ON DELETE CASCADE,
        imei           TEXT,
        producto_id    INTEGER      REFERENCES productos_cantidad(id) ON DELETE CASCADE,
        atributo_id    INTEGER,
        variante_id    INTEGER,
        atributo_label TEXT,
        variante_label TEXT,
        cantidad       INTEGER      NOT NULL DEFAULT 1,
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

      CREATE INDEX IF NOT EXISTS idx_borradores_sucursal
        ON borradores (sucursal_id, creado_en DESC);
      CREATE INDEX IF NOT EXISTS idx_borradores_expira
        ON borradores (expira_en) WHERE expira_en IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_borradores_items_borrador
        ON borradores_items (borrador_id);
      CREATE INDEX IF NOT EXISTS idx_borradores_items_serial
        ON borradores_items (serial_id) WHERE serial_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_borradores_items_producto
        ON borradores_items (producto_id) WHERE producto_id IS NOT NULL;

      -- Para las bases donde la tabla ya se creó sin esta columna: el
      -- CREATE TABLE IF NOT EXISTS de arriba no la habría agregado.
      ALTER TABLE borradores ADD COLUMN IF NOT EXISTS datos JSONB;
    `);
  } catch (err) {
    console.error('⚠️  Borradores no aplicados (el resto del sistema sigue normal):', err.message);
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