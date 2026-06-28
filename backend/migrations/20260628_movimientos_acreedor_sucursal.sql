-- 20260628_movimientos_acreedor_sucursal.sql
-- Agrega sucursal_id a movimientos_acreedor para atribuir correctamente los
-- pagos a proveedores a la caja de cada sucursal (antes se contaban en TODAS).
-- Es ADITIVA y reversible: columna nullable + backfill. No modifica otras columnas.
-- Aplicar ANTES de desplegar el código que escribe/lee sucursal_id.

-- 1) Columna nueva (nullable, sin FK para evitar locks; la app garantiza integridad)
ALTER TABLE movimientos_acreedor ADD COLUMN IF NOT EXISTS sucursal_id integer;

-- 2) Índice para la consulta de caja por sucursal
CREATE INDEX IF NOT EXISTS idx_mov_acreedor_sucursal ON movimientos_acreedor(sucursal_id);

-- 3a) Backfill directo: movimientos con compra_id (cargos, pago al momento, devoluciones)
UPDATE movimientos_acreedor ma
SET sucursal_id = c.sucursal_id
FROM compras c
WHERE c.id = ma.compra_id AND ma.sucursal_id IS NULL;

-- 3b) Backfill por cargo→compra: abonos ligados a un cargo que tiene compra
UPDATE movimientos_acreedor ma
SET sucursal_id = c.sucursal_id
FROM movimientos_acreedor cg
JOIN compras c ON c.id = cg.compra_id
WHERE cg.id = ma.cargo_id AND ma.sucursal_id IS NULL;

-- Nota: los cargos manuales (sin compra) y los pagos adelantados (sin cargo)
-- quedan con sucursal_id = NULL a propósito (no tienen sucursal asociada en el
-- histórico). Los nuevos movimientos sí la guardarán desde el código.

-- ROLLBACK (si fuese necesario):
--   DROP INDEX IF EXISTS idx_mov_acreedor_sucursal;
--   ALTER TABLE movimientos_acreedor DROP COLUMN IF EXISTS sucursal_id;
