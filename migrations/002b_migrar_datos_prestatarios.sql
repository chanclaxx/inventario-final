-- ============================================================
-- Migración 002b: Datos históricos → movimientos_prestatario
-- IDEMPOTENTE: solo procesa prestatarios con cc_migrado = false
-- REVERSIBLE:  TRUNCATE movimientos_prestatario + UPDATE prestatarios SET cc_migrado=false
-- ============================================================

-- Paso 1: Migrar préstamos Activos/Saldados de prestatarios → entrega_producto
INSERT INTO movimientos_prestatario (
    prestatario_id, sucursal_id, usuario_id, fecha,
    tipo, signo, valor, descripcion,
    nombre_producto, imei, cantidad
)
SELECT
    p.prestatario_id,
    p.sucursal_id,
    p.usuario_id,
    p.fecha,
    'entrega_producto',
    1,
    p.valor_prestamo,
    CONCAT('[Migrado] Préstamo #', p.id, ' — ', p.nombre_producto),
    p.nombre_producto,
    p.imei,
    p.cantidad_prestada
FROM prestamos p
JOIN prestatarios pr ON pr.id = p.prestatario_id
WHERE p.prestatario_id IS NOT NULL
  AND p.estado IN ('Activo', 'Saldado')
  AND pr.cc_migrado = false;

-- Paso 2: Migrar abonos de esos préstamos → pago_recibido
INSERT INTO movimientos_prestatario (
    prestatario_id, sucursal_id, usuario_id, fecha,
    tipo, signo, valor, descripcion, metodo
)
SELECT
    p.prestatario_id,
    p.sucursal_id,
    a.usuario_id,
    a.fecha,
    'pago_recibido',
    -1,
    a.valor,
    CONCAT('[Migrado] Abono del préstamo #', p.id, ' — ', p.nombre_producto),
    COALESCE(a.metodo, 'Efectivo')
FROM abonos_prestamo a
JOIN prestamos p ON p.id = a.prestamo_id
JOIN prestatarios pr ON pr.id = p.prestatario_id
WHERE p.prestatario_id IS NOT NULL
  AND p.estado IN ('Activo', 'Saldado')
  AND pr.cc_migrado = false;

-- Paso 3: Migrar retomas directas de prestatarios → recibo_producto
INSERT INTO movimientos_prestatario (
    prestatario_id, sucursal_id, fecha,
    tipo, signo, valor, descripcion,
    nombre_producto, imei, cantidad,
    producto_serial_id, producto_cantidad_id,
    ingreso_inventario, costo_producto
)
SELECT
    r.persona_id,
    r.sucursal_id,
    NOW(),
    'recibo_producto',
    -1,
    r.valor_retoma,
    COALESCE(r.descripcion, CONCAT('[Migrado] Retoma — ', COALESCE(r.nombre_producto, 'producto'))),
    r.nombre_producto,
    r.imei,
    r.cantidad_retoma,
    r.producto_serial_id,
    r.producto_cantidad_id,
    r.ingreso_inventario,
    r.valor_retoma
FROM retomas r
JOIN prestatarios pr ON pr.id = r.persona_id
WHERE r.tipo_persona = 'prestatario'
  AND r.prestamo_id IS NULL
  AND pr.cc_migrado = false;

-- Paso 4: Marcar prestatarios como migrados
UPDATE prestatarios
SET cc_migrado = true
WHERE cc_migrado = false;

-- ============================================================
-- Verificación post-migración (ejecutar como SELECT, no INSERT):
-- Comparar saldo nuevo vs saldo_a_favor antiguo + saldo de préstamos
-- ============================================================
-- SELECT
--   p.id, p.nombre,
--   p.saldo_a_favor AS saldo_viejo,
--   COALESCE(
--     (SELECT SUM(valor_prestamo - total_abonado)
--      FROM prestamos
--      WHERE prestatario_id = p.id AND estado = 'Activo'), 0
--   ) AS deuda_activa_vieja,
--   COALESCE(
--     (SELECT SUM(m.valor * m.signo)
--      FROM movimientos_prestatario m
--      WHERE m.prestatario_id = p.id AND NOT m.anulado), 0
--   ) AS saldo_nuevo
-- FROM prestatarios p
-- WHERE p.cc_migrado = true
-- ORDER BY p.nombre;
