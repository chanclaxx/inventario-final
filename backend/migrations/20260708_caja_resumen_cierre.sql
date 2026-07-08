-- 20260708_caja_resumen_cierre.sql
-- Congela el resumen de la caja al cerrarla: guarda una "foto" (snapshot) del
-- resumen completo por grupos/totales en el momento del cierre. A partir de esto,
-- ver una caja YA CERRADA devuelve la foto y no un recálculo en vivo, para que
-- cancelar/editar transacciones de días pasados no altere cajas ya cerradas.
-- Es ADITIVA y reversible: columna nullable. Las cajas cerradas antes de esta
-- migración quedan con NULL y siguen recalculándose en vivo (comportamiento previo).
-- Aplicar ANTES de desplegar el código que escribe/lee resumen_cierre.

ALTER TABLE aperturas_caja ADD COLUMN IF NOT EXISTS resumen_cierre jsonb;

-- ROLLBACK (si fuese necesario):
--   ALTER TABLE aperturas_caja DROP COLUMN IF EXISTS resumen_cierre;
