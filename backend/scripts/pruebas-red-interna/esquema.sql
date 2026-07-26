-- Esquema mínimo que replica las tablas reales que toca la red interna.
-- Solo las columnas que usan las queries bajo prueba.

CREATE TABLE negocios   (id SERIAL PRIMARY KEY, nombre TEXT);
CREATE TABLE sucursales (id SERIAL PRIMARY KEY, negocio_id INT REFERENCES negocios(id),
                         nombre TEXT, activa BOOLEAN DEFAULT TRUE);
CREATE TABLE usuarios   (id SERIAL PRIMARY KEY, nombre TEXT);
CREATE TABLE config_negocio (negocio_id INT, clave TEXT, valor TEXT, PRIMARY KEY (negocio_id, clave));
CREATE TABLE lineas_producto (id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT);
CREATE TABLE clientes  (id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT);

CREATE TABLE productos_serial (
  id SERIAL PRIMARY KEY, nombre TEXT, marca TEXT, modelo TEXT,
  precio NUMERIC, sucursal_id INT REFERENCES sucursales(id), linea_id INT, proveedor_id INT
);
CREATE TABLE seriales (
  id SERIAL PRIMARY KEY, producto_id INT REFERENCES productos_serial(id),
  imei TEXT, vendido BOOLEAN DEFAULT FALSE, prestado BOOLEAN DEFAULT FALSE,
  costo_compra NUMERIC, fecha_entrada DATE DEFAULT CURRENT_DATE, fecha_salida DATE,
  proveedor_id INT, color TEXT, caracteristicas JSONB, cliente_origen TEXT
);
CREATE TABLE productos_cantidad (
  id SERIAL PRIMARY KEY, nombre TEXT, stock INT DEFAULT 0, stock_minimo INT DEFAULT 0,
  unidad_medida TEXT DEFAULT 'unidad', costo_unitario NUMERIC, precio NUMERIC,
  sucursal_id INT REFERENCES sucursales(id), linea_id INT, proveedor_id INT,
  activo BOOLEAN DEFAULT TRUE, codigo TEXT
);
CREATE TABLE historial_stock_cantidad (
  id SERIAL PRIMARY KEY, producto_id INT, sucursal_id INT, cantidad INT,
  costo_unitario NUMERIC, tipo TEXT, notas TEXT, fecha TIMESTAMP DEFAULT NOW()
);

CREATE TABLE facturas (
  id SERIAL PRIMARY KEY, numero INT, sucursal_id INT REFERENCES sucursales(id),
  usuario_id INT, cliente_id INT, vendedor_id INT,
  nombre_cliente TEXT, cedula TEXT, celular TEXT, notas TEXT,
  estado TEXT DEFAULT 'Activa', fecha TIMESTAMP DEFAULT NOW()
);
CREATE TABLE lineas_factura (
  id SERIAL PRIMARY KEY, factura_id INT REFERENCES facturas(id),
  nombre_producto TEXT, imei TEXT, cantidad INT, precio NUMERIC,
  subtotal NUMERIC GENERATED ALWAYS AS (cantidad * precio) STORED,
  producto_id INT, atributo_id INT, variante_id INT, cantidad_devuelta INT DEFAULT 0
);
CREATE TABLE pagos_factura (
  id SERIAL PRIMARY KEY, factura_id INT, metodo TEXT, valor NUMERIC
);
CREATE TABLE creditos (
  id SERIAL PRIMARY KEY, factura_id INT REFERENCES facturas(id), cliente_id INT,
  sucursal_id INT, valor_total NUMERIC, cuota_inicial NUMERIC DEFAULT 0,
  total_abonado NUMERIC DEFAULT 0, estado TEXT DEFAULT 'Activo', creado_en TIMESTAMP DEFAULT NOW()
);
CREATE TABLE abonos_credito (
  id SERIAL PRIMARY KEY, credito_id INT, usuario_id INT, valor NUMERIC,
  metodo TEXT, notas TEXT, fecha TIMESTAMP DEFAULT NOW()
);

CREATE TABLE traslados (
  id SERIAL PRIMARY KEY, negocio_id INT, sucursal_origen_id INT, sucursal_destino_id INT,
  usuario_id INT, notas TEXT, estado TEXT DEFAULT 'Completado', fecha TIMESTAMP DEFAULT NOW()
);
CREATE TABLE lineas_traslado (
  id SERIAL PRIMARY KEY, traslado_id INT REFERENCES traslados(id), tipo TEXT,
  serial_id INT, producto_serial_origen_id INT, producto_serial_destino_id INT, imei TEXT,
  producto_cantidad_origen_id INT, producto_cantidad_destino_id INT, cantidad INT,
  nombre_producto TEXT, revertida BOOLEAN DEFAULT FALSE
);

CREATE TABLE cuentas_dinero (
  id SERIAL PRIMARY KEY, negocio_id INT, sucursal_id INT, nombre TEXT,
  tipo TEXT DEFAULT 'otro', metodos_pago TEXT[] DEFAULT '{}',
  porcentaje_comision NUMERIC DEFAULT 0, moneda TEXT DEFAULT 'COP',
  activa BOOLEAN DEFAULT TRUE, creada_en TIMESTAMP DEFAULT NOW()
);
CREATE TABLE movimientos_dinero (
  id BIGSERIAL PRIMARY KEY, cuenta_id INT REFERENCES cuentas_dinero(id),
  tipo TEXT, categoria TEXT, valor NUMERIC, concepto TEXT, grupo_traslado UUID,
  usuario_id INT, tasa_cambio NUMERIC, fecha TIMESTAMP DEFAULT NOW(),
  activo BOOLEAN DEFAULT TRUE, clave_idempotencia TEXT,
  proveedor_id INT, compra_id INT
);
CREATE TABLE aperturas_caja (
  id SERIAL PRIMARY KEY, sucursal_id INT, estado TEXT DEFAULT 'Abierta',
  fecha_apertura TIMESTAMP DEFAULT NOW(), fecha_cierre TIMESTAMP
);
CREATE TABLE movimientos_caja (
  id SERIAL PRIMARY KEY, caja_id INT, usuario_id INT, tipo TEXT, concepto TEXT,
  valor NUMERIC, referencia_id INT, referencia_tipo TEXT, metodo TEXT,
  activo BOOLEAN DEFAULT TRUE, fecha TIMESTAMP DEFAULT NOW()
);
CREATE TABLE contadores_documento (
  negocio_id INT, tipo TEXT, ultimo_numero INT, PRIMARY KEY (negocio_id, tipo)
);
