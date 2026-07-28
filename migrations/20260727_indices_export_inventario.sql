-- Índices de rendimiento para la exportación de inventario
--
-- Problema: la exportación cruza cada serial contra facturas, compras y préstamos
-- por IMEI (texto). Sin índice, cada uno de esos LATERAL recorre la tabla entera
-- una vez POR SERIAL, así que el costo crece con seriales × líneas_factura. Un
-- negocio con miles de seriales se pasa del timeout y la exportación nunca baja.
--
-- 100% aditiva e idempotente. Se aplica sola al arrancar (config/migrations.js);
-- este archivo queda como referencia y para aplicarla a mano si hace falta.
--
-- Nota: en producción, con la tabla en uso, conviene aplicarlos con CONCURRENTLY
-- para no bloquear escrituras mientras se construyen (CONCURRENTLY no puede correr
-- dentro de una transacción, por eso el runner automático usa la forma normal —
-- en tablas de este tamaño tarda segundos).

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

-- Funcional: el JOIN normaliza con LOWER(TRIM(...)), un índice sobre `nombre` no aplica.
CREATE INDEX IF NOT EXISTS idx_clientes_negocio_nombre_norm
  ON clientes (negocio_id, LOWER(BTRIM(nombre)));
