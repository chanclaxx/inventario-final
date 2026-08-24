-- ─────────────────────────────────────────────────────────────────────────────
-- Esquema para las pruebas de IMPORTACIÓN.
--
-- A diferencia de `esquema.sql`, este NO es un mínimo cómodo: replica las
-- restricciones REALES de producción, porque son justo lo que está bajo prueba.
-- Verificadas contra la base el 2026-08-06 con pg_index:
--
--   productos_cantidad_nombre_sucursal_id_key  UNIQUE (nombre, sucursal_id)
--       ← EXACTO, sensible a mayúsculas y espacios. El importador busca con
--         LOWER(nombre), así que los dos no coinciden y ahí nacen los
--         duplicados `[11PRO]` / `[11Pro]` que hay en producción.
--   uq_productos_cantidad_codigo  UNIQUE (sucursal_id, codigo)
--                                 WHERE codigo IS NOT NULL AND activo
--   productos_serial_nombre_sucursal_id_key    UNIQUE (nombre, sucursal_id)
--   seriales_imei_negocio_unique               UNIQUE (imei, producto_id)
--       ← ojo: por (imei, producto_id), NO por imei. La base PERMITE el mismo
--         IMEI en dos sucursales; quien lo impide es el importador.
--
-- Un fixture más permisivo dejaría pasar exactamente los bugs que buscamos.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE negocios   (id SERIAL PRIMARY KEY, nombre TEXT);
CREATE TABLE sucursales (id SERIAL PRIMARY KEY, negocio_id INT REFERENCES negocios(id),
                         nombre TEXT, activa BOOLEAN DEFAULT TRUE);
CREATE TABLE config_negocio (negocio_id INT, clave TEXT, valor TEXT,
                             PRIMARY KEY (negocio_id, clave));

-- Columnas copiadas de information_schema en producción (2026-08-06): los
-- repositorios de líneas y proveedores piden `creado_en`, y sin ella la
-- generación de la plantilla revienta con "column does not exist".
CREATE TABLE lineas_producto (
  id SERIAL PRIMARY KEY, negocio_id INT, nombre VARCHAR,
  creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE proveedores (
  id SERIAL PRIMARY KEY, negocio_id INT, nombre VARCHAR, nit VARCHAR,
  telefono VARCHAR, email VARCHAR, direccion TEXT, contacto VARCHAR,
  activo BOOLEAN DEFAULT TRUE, creado_en TIMESTAMP DEFAULT NOW(),
  tipo VARCHAR DEFAULT 'proveedor'
);

CREATE TABLE productos_serial (
  id SERIAL PRIMARY KEY,
  sucursal_id INT REFERENCES sucursales(id),
  proveedor_id INT,
  nombre VARCHAR,
  marca VARCHAR, modelo VARCHAR,
  precio NUMERIC,
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMP DEFAULT NOW(),
  linea_id INT,
  nota TEXT,
  ubicacion TEXT,
  CONSTRAINT productos_serial_nombre_sucursal_id_key UNIQUE (nombre, sucursal_id)
);

CREATE TABLE seriales (
  id SERIAL PRIMARY KEY,
  producto_id INT REFERENCES productos_serial(id) ON DELETE CASCADE,
  imei VARCHAR,
  fecha_entrada DATE DEFAULT CURRENT_DATE,
  vendido BOOLEAN DEFAULT FALSE,
  fecha_salida DATE,
  cliente_origen VARCHAR,
  prestado BOOLEAN DEFAULT FALSE,
  costo_compra NUMERIC,
  creado_en TIMESTAMP DEFAULT NOW(),
  proveedor_id INT,
  color VARCHAR,
  caracteristicas JSONB,
  precio NUMERIC,
  nota TEXT,
  CONSTRAINT seriales_imei_negocio_unique UNIQUE (imei, producto_id)
);

CREATE TABLE productos_cantidad (
  id SERIAL PRIMARY KEY,
  sucursal_id INT REFERENCES sucursales(id),
  proveedor_id INT,
  nombre VARCHAR,
  stock INT DEFAULT 0,
  stock_minimo INT DEFAULT 0,
  cliente_origen VARCHAR,
  unidad_medida VARCHAR DEFAULT 'unidad',
  costo_unitario NUMERIC,
  activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMP DEFAULT NOW(),
  precio NUMERIC,
  linea_id INT,
  nota TEXT,
  codigo TEXT,
  ubicacion TEXT,
  CONSTRAINT productos_cantidad_nombre_sucursal_id_key UNIQUE (nombre, sucursal_id)
);

CREATE UNIQUE INDEX uq_productos_cantidad_codigo
  ON productos_cantidad (sucursal_id, codigo)
  WHERE codigo IS NOT NULL AND activo;

-- `codigo` en los tres niveles: lo escaneable es el NODO, no el producto
-- (ver migrations/20260823_codigo_variantes.sql). Los índices únicos van con
-- los mismos predicados que producción — sin ellos, la prueba no cazaría un
-- código repetido.
CREATE TABLE atributos_producto (
  id SERIAL PRIMARY KEY,
  producto_id INT REFERENCES productos_cantidad(id) ON DELETE CASCADE,
  sucursal_id INT, tipo_id INT,
  valor TEXT, stock INT DEFAULT 0, stock_minimo INT DEFAULT 0,
  precio NUMERIC, activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMP DEFAULT NOW(),
  costo_unitario NUMERIC,
  codigo TEXT
);

CREATE UNIQUE INDEX uq_atributos_producto_codigo
  ON atributos_producto (sucursal_id, codigo)
  WHERE codigo IS NOT NULL AND activo;

CREATE TABLE variantes_atributo (
  id SERIAL PRIMARY KEY,
  atributo_id INT REFERENCES atributos_producto(id) ON DELETE CASCADE,
  tipo_id INT,
  valor TEXT, stock INT DEFAULT 0, stock_minimo INT DEFAULT 0,
  precio NUMERIC, activo BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMP DEFAULT NOW(),
  costo_unitario NUMERIC,
  codigo TEXT
);

CREATE UNIQUE INDEX uq_variantes_atributo_codigo
  ON variantes_atributo (atributo_id, codigo)
  WHERE codigo IS NOT NULL AND activo;
