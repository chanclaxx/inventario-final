-- Esquema para la SUITE DE AISLAMIENTO.
-- Amplía `esquema.sql` con las tablas que necesitan los repositorios reales
-- de préstamos, garantías, búsqueda y reportes.
--
-- Solo las columnas que tocan las consultas bajo prueba. Si en producción
-- cambia alguna de ellas, hay que reflejarlo aquí.

-- Columnas que usan los repositorios reales y que `esquema.sql` (recortado para
-- la red interna) no necesitaba. Se agregan aparte para no alterar ese archivo.
ALTER TABLE productos_cantidad ADD COLUMN IF NOT EXISTS cliente_origen TEXT;
ALTER TABLE productos_cantidad ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP DEFAULT NOW();
ALTER TABLE productos_serial   ADD COLUMN IF NOT EXISTS creado_en TIMESTAMP DEFAULT NOW();
ALTER TABLE productos_serial   ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE productos_serial   ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;
ALTER TABLE productos_cantidad ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE seriales           ADD COLUMN IF NOT EXISTS nota TEXT;
ALTER TABLE facturas           ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE historial_stock_cantidad ADD COLUMN IF NOT EXISTS cliente_origen TEXT;
ALTER TABLE historial_stock_cantidad ADD COLUMN IF NOT EXISTS cedula_cliente TEXT;
ALTER TABLE historial_stock_cantidad ADD COLUMN IF NOT EXISTS proveedor_id INT;
ALTER TABLE historial_stock_cantidad ADD COLUMN IF NOT EXISTS usuario_id INT;

CREATE TABLE IF NOT EXISTS proveedores (
  id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, nit TEXT,
  telefono TEXT, email TEXT, direccion TEXT, contacto TEXT,
  tipo TEXT DEFAULT 'proveedor', activo BOOLEAN DEFAULT TRUE
);

-- `codigo` en los dos niveles: lo escaneable es el NODO, no el producto
-- (ver migrations/20260823_codigo_variantes.sql).
CREATE TABLE IF NOT EXISTS atributos_producto (
  id SERIAL PRIMARY KEY, producto_id INT, sucursal_id INT, tipo_id INT,
  valor TEXT, stock INT DEFAULT 0, stock_minimo INT DEFAULT 0,
  precio NUMERIC, costo_unitario NUMERIC, activo BOOLEAN DEFAULT TRUE,
  codigo TEXT
);
CREATE TABLE IF NOT EXISTS variantes_atributo (
  id SERIAL PRIMARY KEY, atributo_id INT, producto_id INT, tipo_id INT,
  valor TEXT, stock INT DEFAULT 0, stock_minimo INT DEFAULT 0,
  precio NUMERIC, costo_unitario NUMERIC, activo BOOLEAN DEFAULT TRUE,
  codigo TEXT
);

-- Nombre del tipo de característica (Talla, Color…). El escaneo lo usa para
-- rotular el nodo que devuelve: "Talla: M" en vez de "M" a secas.
CREATE TABLE IF NOT EXISTS tipos_caracteristica (
  id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, orden INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prestatarios (
  id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, cedula TEXT,
  telefono TEXT, saldo_a_favor NUMERIC DEFAULT 0
);
CREATE TABLE IF NOT EXISTS empleados_prestatario (
  id SERIAL PRIMARY KEY, prestatario_id INT, nombre TEXT
);
CREATE TABLE IF NOT EXISTS prestamos (
  id SERIAL PRIMARY KEY, numero INT, sucursal_id INT, usuario_id INT,
  prestatario TEXT, cedula TEXT, telefono TEXT, imei TEXT,
  producto_id INT, prestatario_id INT, empleado_id INT, cliente_id INT,
  valor NUMERIC, valor_prestamo NUMERIC,
  costo_producto NUMERIC,
  total_abonado NUMERIC DEFAULT 0, estado TEXT DEFAULT 'Activo',
  nombre_producto TEXT, cantidad INT DEFAULT 1, cantidad_prestada INT DEFAULT 1,
  variante_id INT, atributo_id INT,
  fecha TIMESTAMP DEFAULT NOW(), fecha_devolucion TIMESTAMP, notas TEXT
);
CREATE TABLE IF NOT EXISTS abonos_prestamo (
  id SERIAL PRIMARY KEY, prestamo_id INT, usuario_id INT, valor NUMERIC,
  metodo TEXT, abono_total_id INT, fecha TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS abonos_totales (
  id SERIAL PRIMARY KEY, sucursal_id INT, persona_id INT, tipo_persona TEXT,
  valor_total NUMERIC, metodo TEXT, fecha TIMESTAMP DEFAULT NOW(),
  -- Nota libre del usuario sobre el pago (20260813_descripcion_pago_total.sql)
  descripcion TEXT
);
CREATE TABLE IF NOT EXISTS saldo_a_favor_sucursal (
  id SERIAL PRIMARY KEY, sucursal_id INT, persona_id INT, tipo_persona TEXT, saldo NUMERIC DEFAULT 0
);
CREATE TABLE IF NOT EXISTS historial_saldo_sucursal (
  id SERIAL PRIMARY KEY, sucursal_id INT, persona_id INT, tipo_persona TEXT,
  valor NUMERIC, tipo TEXT, fecha TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS garantias (
  id SERIAL PRIMARY KEY, negocio_id INT, nombre TEXT, orden INT DEFAULT 0
);
CREATE TABLE IF NOT EXISTS garantias_lineas (
  id SERIAL PRIMARY KEY, garantia_id INT, linea_id INT
);

CREATE TABLE IF NOT EXISTS retomas (
  id SERIAL PRIMARY KEY, factura_id INT, descripcion TEXT, valor_retoma NUMERIC,
  ingreso_inventario BOOLEAN DEFAULT FALSE, nombre_producto TEXT, imei TEXT,
  cantidad_retoma INT DEFAULT 1, color TEXT
);
CREATE TABLE IF NOT EXISTS ordenes_servicio (
  id SERIAL PRIMARY KEY, numero INT, sucursal_id INT, factura_id INT,
  cliente_nombre TEXT, equipo_nombre TEXT, equipo_tipo TEXT, equipo_serial TEXT,
  estado TEXT, falla_reportada TEXT, notas_tecnico TEXT, motivo_sin_reparar TEXT,
  precio_final NUMERIC, precio_garantia NUMERIC, costo_real NUMERIC,
  costo_garantia NUMERIC, garantia_cobrable BOOLEAN DEFAULT FALSE,
  total_abonado NUMERIC DEFAULT 0,
  fecha_recepcion TIMESTAMP DEFAULT NOW(), fecha_entrega TIMESTAMP
);
CREATE TABLE IF NOT EXISTS abonos_servicio (
  id SERIAL PRIMARY KEY, orden_id INT, usuario_id INT, valor NUMERIC,
  metodo TEXT, fecha TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS entregas_domicilio (
  id SERIAL PRIMARY KEY, factura_id INT, domiciliario_id INT, estado TEXT,
  valor_total NUMERIC, total_abonado NUMERIC DEFAULT 0, fecha_asignacion TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS domiciliarios (id SERIAL PRIMARY KEY, nombre TEXT);
CREATE TABLE IF NOT EXISTS gastos_fijos (
  id SERIAL PRIMARY KEY, sucursal_id INT, nombre TEXT, valor NUMERIC, activo BOOLEAN DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS compras (
  id SERIAL PRIMARY KEY, numero INT, sucursal_id INT, proveedor_id INT, usuario_id INT,
  numero_factura TEXT, total NUMERIC, notas TEXT, estado TEXT DEFAULT 'Activa',
  registrar_en_caja BOOLEAN DEFAULT TRUE, metodo TEXT, fecha TIMESTAMP DEFAULT NOW()
);
-- Líneas de compra: de aquí sale la garantía del proveedor, que el listado de
-- seriales resuelve con un LATERAL para pintar el semáforo de vencimiento.
-- Solo las columnas que esa consulta toca (ver productosSerial.repository).
-- OJO: las suites 10 y 19 declaran su propia lineas_compra con MÁS columnas.
-- Como este archivo se carga primero, su CREATE TABLE IF NOT EXISTS queda en
-- nada; por eso esta definición tiene que ser la UNIÓN de todas. Si aquí falta
-- una columna, el INSERT de esas suites revienta.
CREATE TABLE IF NOT EXISTS lineas_compra (
  id SERIAL PRIMARY KEY, compra_id INT, producto_id INT, nombre_producto TEXT,
  imei TEXT, cantidad INT DEFAULT 1, cantidad_devuelta INT DEFAULT 0,
  precio_unitario NUMERIC DEFAULT 0, precio_usd NUMERIC,
  factor_conversion NUMERIC, valor_traida NUMERIC,
  variante_id INT, atributo_id INT, orden_linea_id INT,
  garantia_dias INT
);
CREATE TABLE IF NOT EXISTS vendedores (
  id SERIAL PRIMARY KEY, negocio_id INT, sucursal_id INT, nombre TEXT, activo BOOLEAN DEFAULT TRUE
);

-- El índice único real del código (migración 20260714)
CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_cantidad_codigo
  ON productos_cantidad (sucursal_id, codigo)
  WHERE codigo IS NOT NULL AND activo;
