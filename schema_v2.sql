-- ============================================================
-- INVENTARIO v2 — ESQUEMA POSTGRESQL COMPLETO
-- Estructura: Negocios → Sucursales → Todo lo demás
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. NEGOCIOS (empresa que contrata el SaaS) ───────────────
CREATE TABLE negocios (
    id                  SERIAL PRIMARY KEY,
    nombre              VARCHAR(150) NOT NULL,
    email               VARCHAR(150) NOT NULL UNIQUE,
    telefono            VARCHAR(20),
    direccion           TEXT,
    nit                 VARCHAR(30),
    plan                VARCHAR(30)  NOT NULL DEFAULT 'trial'
                        CHECK (plan IN ('trial','mensual','premium')),
    estado_plan         VARCHAR(20)  NOT NULL DEFAULT 'pendiente'
                        CHECK (estado_plan IN ('activo','vencido','suspendido','pendiente')),
    fecha_inicio        TIMESTAMP    NOT NULL DEFAULT NOW(),
    fecha_vencimiento   TIMESTAMP    NOT NULL DEFAULT (NOW() + INTERVAL '15 days'),
    max_sucursales      INTEGER      NOT NULL DEFAULT 1,
    max_usuarios        INTEGER      NOT NULL DEFAULT 5,
    notas_admin         TEXT,
    activo              BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en           TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── 2. SUCURSALES (sedes del negocio) ────────────────────────
CREATE TABLE sucursales (
    id          SERIAL PRIMARY KEY,
    negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre      VARCHAR(100) NOT NULL,
    direccion   TEXT,
    telefono    VARCHAR(20),
    activa      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(negocio_id, nombre)
);

-- ── 3. ROLES Y USUARIOS ──────────────────────────────────────
-- admin_negocio: ve y gestiona todas las sucursales del negocio
-- supervisor: gestiona una sucursal específica
-- vendedor: opera en una sucursal específica
CREATE TYPE rol_usuario AS ENUM ('admin_negocio', 'supervisor', 'vendedor');

CREATE TABLE usuarios (
    id              SERIAL PRIMARY KEY,
    negocio_id      INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    sucursal_id     INTEGER REFERENCES sucursales(id) ON DELETE SET NULL,
    -- sucursal_id es NULL para admin_negocio (accede a todas)
    nombre          VARCHAR(100) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    rol             rol_usuario NOT NULL DEFAULT 'vendedor',
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMP NOT NULL DEFAULT NOW(),
    ultimo_acceso   TIMESTAMP
);

-- ── 4. SUPERADMINS (dueños del SaaS) ────────────────────────
CREATE TABLE superadmins (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(100) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── 5. PLANES DISPONIBLES ────────────────────────────────────
CREATE TABLE planes (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(50)   NOT NULL UNIQUE,
    precio_mensual  NUMERIC(10,2) NOT NULL,
    max_sucursales  INTEGER       NOT NULL DEFAULT 1,
    max_usuarios    INTEGER       NOT NULL DEFAULT 5,
    descripcion     TEXT,
    activo          BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO planes (nombre, precio_mensual, max_sucursales, max_usuarios, descripcion) VALUES
  ('trial',   0,      1,  5,  'Prueba gratuita 15 días'),
  ('mensual', 79000,  3,  10, 'Plan mensual — hasta 3 sucursales'),
  ('premium', 149000, 10, 30, 'Plan premium — hasta 10 sucursales');

-- ── 6. PAGOS DE MENSUALIDAD ──────────────────────────────────
CREATE TABLE pagos_plan (
    id              SERIAL PRIMARY KEY,
    negocio_id      INTEGER NOT NULL REFERENCES negocios(id),
    fecha           TIMESTAMP NOT NULL DEFAULT NOW(),
    valor           NUMERIC(10,2) NOT NULL,
    plan            VARCHAR(30) NOT NULL,
    metodo          VARCHAR(50) NOT NULL DEFAULT 'Manual',
    referencia      VARCHAR(100),
    meses           INTEGER NOT NULL DEFAULT 1,
    fecha_desde     TIMESTAMP NOT NULL,
    fecha_hasta     TIMESTAMP NOT NULL,
    registrado_por  INTEGER REFERENCES superadmins(id),
    notas           TEXT
);

-- ── 7. CONFIGURACIÓN POR NEGOCIO ─────────────────────────────
CREATE TABLE config_negocio (
    id          SERIAL PRIMARY KEY,
    negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    clave       VARCHAR(100) NOT NULL,
    valor       TEXT NOT NULL DEFAULT '',
    descripcion TEXT,
    UNIQUE(negocio_id, clave)
);

-- ── 8. PROVEEDORES (por negocio) ─────────────────────────────
CREATE TABLE proveedores (
    id          SERIAL PRIMARY KEY,
    negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre      VARCHAR(150) NOT NULL,
    nit         VARCHAR(30),
    telefono    VARCHAR(20),
    email       VARCHAR(150),
    direccion   TEXT,
    contacto    VARCHAR(100),
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(negocio_id, nombre)
);

-- ── 9. PRODUCTOS SERIAL (por sucursal) ───────────────────────
CREATE TABLE productos_serial (
    id              SERIAL PRIMARY KEY,
    sucursal_id     INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
    proveedor_id    INTEGER REFERENCES proveedores(id),
    nombre          VARCHAR(150) NOT NULL,
    marca           VARCHAR(100),
    modelo          VARCHAR(100),
    precio          NUMERIC(12,2),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(nombre, sucursal_id)
);

CREATE TABLE seriales (
    id              SERIAL PRIMARY KEY,
    producto_id     INTEGER NOT NULL REFERENCES productos_serial(id) ON DELETE CASCADE,
    imei            VARCHAR(50) NOT NULL UNIQUE,
    fecha_entrada   DATE NOT NULL DEFAULT CURRENT_DATE,
    vendido         BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_salida    DATE,
    cliente_origen  VARCHAR(150),
    prestado        BOOLEAN NOT NULL DEFAULT FALSE,
    costo_compra    NUMERIC(12,2),
    creado_en       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── 10. PRODUCTOS POR CANTIDAD (por sucursal) ────────────────
CREATE TABLE productos_cantidad (
    id              SERIAL PRIMARY KEY,
    sucursal_id     INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
    proveedor_id    INTEGER REFERENCES proveedores(id),
    nombre          VARCHAR(150) NOT NULL,
    stock           INTEGER NOT NULL DEFAULT 0,
    stock_minimo    INTEGER NOT NULL DEFAULT 0,
    cliente_origen  VARCHAR(150),
    unidad_medida   VARCHAR(30) DEFAULT 'unidad',
    costo_unitario  NUMERIC(12,2),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(nombre, sucursal_id)
);

-- ── 11. CLIENTES (por negocio — compartidos entre sucursales) ─
CREATE TABLE clientes (
    id              SERIAL PRIMARY KEY,
    negocio_id      INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre          VARCHAR(150) NOT NULL,
    cedula          VARCHAR(30) NOT NULL,
    celular         VARCHAR(20),
    email           VARCHAR(150),
    direccion       TEXT,
    fecha_registro  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(negocio_id, cedula)
);

-- ── 12. COMPRAS A PROVEEDORES ────────────────────────────────
CREATE TABLE compras (
    id              SERIAL PRIMARY KEY,
    sucursal_id     INTEGER NOT NULL REFERENCES sucursales(id),
    proveedor_id    INTEGER NOT NULL REFERENCES proveedores(id),
    usuario_id      INTEGER REFERENCES usuarios(id),
    fecha           TIMESTAMP NOT NULL DEFAULT NOW(),
    numero_factura  VARCHAR(50),
    total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado          VARCHAR(20) NOT NULL DEFAULT 'Completada'
                    CHECK (estado IN ('Completada','Pendiente','Cancelada')),
    notas           TEXT,
    creado_en       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE lineas_compra (
    id                  SERIAL PRIMARY KEY,
    compra_id           INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
    nombre_producto     VARCHAR(150) NOT NULL,
    imei                VARCHAR(50),
    cantidad            INTEGER NOT NULL DEFAULT 1,
    precio_unitario     NUMERIC(12,2) NOT NULL,
    subtotal            NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);

-- ── 13. FACTURAS DE VENTA ────────────────────────────────────
CREATE TABLE facturas (
    id              SERIAL PRIMARY KEY,
    sucursal_id     INTEGER NOT NULL REFERENCES sucursales(id),
    usuario_id      INTEGER REFERENCES usuarios(id),
    cliente_id      INTEGER REFERENCES clientes(id),
    nombre_cliente  VARCHAR(150) NOT NULL,
    cedula          VARCHAR(30) NOT NULL,
    celular         VARCHAR(20) NOT NULL,
    fecha           TIMESTAMP NOT NULL DEFAULT NOW(),
    estado          VARCHAR(20) NOT NULL DEFAULT 'Activa'
                    CHECK (estado IN ('Activa','Cancelada','Credito')),
    notas           TEXT,
    creado_en       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE lineas_factura (
    id                  SERIAL PRIMARY KEY,
    factura_id          INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    nombre_producto     VARCHAR(150) NOT NULL,
    imei                VARCHAR(50),
    cantidad            INTEGER NOT NULL DEFAULT 1,
    precio              NUMERIC(12,2) NOT NULL,
    subtotal            NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio) STORED
);

CREATE TABLE pagos_factura (
    id          SERIAL PRIMARY KEY,
    factura_id  INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    metodo      VARCHAR(30) NOT NULL
                CHECK (metodo IN ('Efectivo','Transferencia','Tarjeta','Nequi','Daviplata','Credito','Otro')),
    valor       NUMERIC(12,2) NOT NULL
);

-- ── 14. RETOMAS ──────────────────────────────────────────────
CREATE TABLE retomas (
    id                  SERIAL PRIMARY KEY,
    factura_id          INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    descripcion         TEXT NOT NULL,
    valor_retoma        NUMERIC(12,2) NOT NULL,
    ingreso_inventario  BOOLEAN NOT NULL DEFAULT FALSE,
    nombre_producto     VARCHAR(150),
    imei                VARCHAR(50)
);

-- ── 15. CRÉDITOS ─────────────────────────────────────────────
CREATE TABLE creditos (
    id              SERIAL PRIMARY KEY,
    factura_id      INTEGER NOT NULL REFERENCES facturas(id),
    cliente_id      INTEGER REFERENCES clientes(id),
    sucursal_id     INTEGER NOT NULL REFERENCES sucursales(id),
    valor_total     NUMERIC(12,2) NOT NULL,
    total_abonado   NUMERIC(12,2) NOT NULL DEFAULT 0,
    num_cuotas      INTEGER NOT NULL DEFAULT 1,
    estado          VARCHAR(20) NOT NULL DEFAULT 'Activo'
                    CHECK (estado IN ('Activo','Saldado','Vencido')),
    fecha_limite    DATE,
    creado_en       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE abonos_credito (
    id          SERIAL PRIMARY KEY,
    credito_id  INTEGER NOT NULL REFERENCES creditos(id) ON DELETE CASCADE,
    usuario_id  INTEGER REFERENCES usuarios(id),
    fecha       TIMESTAMP NOT NULL DEFAULT NOW(),
    valor       NUMERIC(12,2) NOT NULL,
    metodo      VARCHAR(30) NOT NULL DEFAULT 'Efectivo',
    notas       TEXT
);

-- ── 16. PRÉSTAMOS ────────────────────────────────────────────
CREATE TABLE prestamos (
    id                  SERIAL PRIMARY KEY,
    sucursal_id         INTEGER NOT NULL REFERENCES sucursales(id),
    usuario_id          INTEGER REFERENCES usuarios(id),
    fecha               TIMESTAMP NOT NULL DEFAULT NOW(),
    prestatario         VARCHAR(150) NOT NULL,
    cedula              VARCHAR(30) NOT NULL,
    telefono            VARCHAR(20) NOT NULL,
    nombre_producto     VARCHAR(150) NOT NULL,
    imei                VARCHAR(50),
    producto_id         INTEGER REFERENCES productos_cantidad(id),
    cantidad_prestada   INTEGER NOT NULL DEFAULT 1,
    valor_prestamo      NUMERIC(12,2) NOT NULL,
    total_abonado       NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado              VARCHAR(20) NOT NULL DEFAULT 'Activo'
                        CHECK (estado IN ('Activo','Saldado','Devuelto'))
);

CREATE TABLE abonos_prestamo (
    id          SERIAL PRIMARY KEY,
    prestamo_id INTEGER NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
    fecha       TIMESTAMP NOT NULL DEFAULT NOW(),
    valor       NUMERIC(12,2) NOT NULL
);

-- ── 17. ACREEDORES (por negocio) ─────────────────────────────
CREATE TABLE acreedores (
    id          SERIAL PRIMARY KEY,
    negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre      VARCHAR(150) NOT NULL,
    cedula      VARCHAR(30) NOT NULL,
    telefono    VARCHAR(20),
    creado_en   TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(negocio_id, cedula)
);

CREATE TABLE movimientos_acreedor (
    id              SERIAL PRIMARY KEY,
    acreedor_id     INTEGER NOT NULL REFERENCES acreedores(id) ON DELETE CASCADE,
    usuario_id      INTEGER REFERENCES usuarios(id),
    fecha           TIMESTAMP NOT NULL DEFAULT NOW(),
    tipo            VARCHAR(10) NOT NULL DEFAULT 'Abono'
                    CHECK (tipo IN ('Abono','Cargo')),
    valor           NUMERIC(12,2) NOT NULL,
    descripcion     TEXT NOT NULL,
    firma           BYTEA
);

-- ── 18. CAJA (por sucursal) ───────────────────────────────────
CREATE TABLE aperturas_caja (
    id              SERIAL PRIMARY KEY,
    sucursal_id     INTEGER NOT NULL REFERENCES sucursales(id),
    usuario_id      INTEGER REFERENCES usuarios(id),
    fecha_apertura  TIMESTAMP NOT NULL DEFAULT NOW(),
    monto_inicial   NUMERIC(12,2) NOT NULL DEFAULT 0,
    fecha_cierre    TIMESTAMP,
    monto_cierre    NUMERIC(12,2),
    estado          VARCHAR(10) NOT NULL DEFAULT 'Abierta'
                    CHECK (estado IN ('Abierta','Cerrada'))
);

CREATE TABLE movimientos_caja (
    id              SERIAL PRIMARY KEY,
    caja_id         INTEGER NOT NULL REFERENCES aperturas_caja(id),
    usuario_id      INTEGER REFERENCES usuarios(id),
    fecha           TIMESTAMP NOT NULL DEFAULT NOW(),
    tipo            VARCHAR(10) NOT NULL CHECK (tipo IN ('Ingreso','Egreso')),
    concepto        VARCHAR(150) NOT NULL,
    valor           NUMERIC(12,2) NOT NULL,
    referencia_id   INTEGER,
    referencia_tipo VARCHAR(50)
);

-- ── 19. GARANTÍAS (por negocio) ───────────────────────────────
CREATE TABLE garantias (
    id          SERIAL PRIMARY KEY,
    negocio_id  INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    titulo      VARCHAR(150) NOT NULL,
    texto       TEXT NOT NULL,
    orden       INTEGER NOT NULL DEFAULT 0
);

-- ── 20. AUDITORÍA ────────────────────────────────────────────
CREATE TABLE auditoria (
    id          SERIAL PRIMARY KEY,
    negocio_id  INTEGER REFERENCES negocios(id),
    usuario_id  INTEGER REFERENCES usuarios(id),
    fecha       TIMESTAMP NOT NULL DEFAULT NOW(),
    accion      VARCHAR(100) NOT NULL,
    tabla       VARCHAR(100),
    registro_id INTEGER,
    detalle     TEXT
);

-- ── ÍNDICES ──────────────────────────────────────────────────
CREATE INDEX idx_sucursales_negocio      ON sucursales(negocio_id);
CREATE INDEX idx_usuarios_negocio        ON usuarios(negocio_id);
CREATE INDEX idx_usuarios_sucursal       ON usuarios(sucursal_id);
CREATE INDEX idx_productos_serial_suc    ON productos_serial(sucursal_id);
CREATE INDEX idx_productos_cant_suc      ON productos_cantidad(sucursal_id);
CREATE INDEX idx_seriales_producto       ON seriales(producto_id);
CREATE INDEX idx_seriales_imei           ON seriales(imei);
CREATE INDEX idx_seriales_vendido        ON seriales(vendido);
CREATE INDEX idx_facturas_sucursal       ON facturas(sucursal_id);
CREATE INDEX idx_facturas_fecha          ON facturas(fecha);
CREATE INDEX idx_facturas_cedula         ON facturas(cedula);
CREATE INDEX idx_clientes_negocio        ON clientes(negocio_id);
CREATE INDEX idx_clientes_cedula         ON clientes(negocio_id, cedula);
CREATE INDEX idx_creditos_estado         ON creditos(estado);
CREATE INDEX idx_prestamos_estado        ON prestamos(estado);
CREATE INDEX idx_acreedores_negocio      ON acreedores(negocio_id);
CREATE INDEX idx_mov_acreedor            ON movimientos_acreedor(acreedor_id);
CREATE INDEX idx_caja_sucursal           ON aperturas_caja(sucursal_id);
CREATE INDEX idx_mov_caja                ON movimientos_caja(caja_id);
CREATE INDEX idx_config_negocio          ON config_negocio(negocio_id);
CREATE INDEX idx_proveedores_negocio     ON proveedores(negocio_id);
CREATE INDEX idx_negocios_estado         ON negocios(estado_plan);
CREATE INDEX idx_negocios_vencimiento    ON negocios(fecha_vencimiento);
CREATE INDEX idx_auditoria_negocio       ON auditoria(negocio_id);
CREATE INDEX idx_auditoria_fecha         ON auditoria(fecha);
CREATE INDEX idx_garantias_negocio       ON garantias(negocio_id);

-- ── DATOS INICIALES — negocio y usuario de prueba ─────────────
INSERT INTO negocios (nombre, email, telefono, plan, estado_plan, fecha_vencimiento)
VALUES ('Mi Negocio', 'admin@inventario.com', '', 'mensual', 'activo', NOW() + INTERVAL '365 days');

INSERT INTO sucursales (negocio_id, nombre, direccion)
VALUES (1, 'Principal', 'Por configurar');

INSERT INTO usuarios (negocio_id, sucursal_id, nombre, email, password_hash, rol)
VALUES (1, NULL, 'Administrador', 'admin@inventario.com',
        '$2a$10$placeholder_cambiar_en_primer_inicio', 'admin_negocio');

INSERT INTO config_negocio (negocio_id, clave, valor, descripcion) VALUES
  (1, 'nombre_negocio',  'Mi Negocio', 'Nombre del establecimiento'),
  (1, 'nit',             '',           'NIT o identificación fiscal'),
  (1, 'direccion',       '',           'Dirección principal'),
  (1, 'telefono',        '',           'Teléfono de contacto'),
  (1, 'pin_eliminacion', '1234',       'PIN para confirmar eliminaciones'),
  (1, 'moneda',          'COP',        'Moneda del sistema');
