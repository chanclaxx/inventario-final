-- ─────────────────────────────────────────────────────────────────────────────
-- SERVICIO TÉCNICO — anular una orden y corregir sus valores (pedido del
-- usuario, 26-oct-2026: «en caso de equivocaciones»).
--
-- · Estado nuevo 'Anulado'. La orden NO se borra: queda con quién la anuló,
--   cuándo, por qué y en qué estado estaba. Los reportes filtran por estados
--   explícitos, así que una anulada deja de contar sola.
-- · Corregir valores no necesita columnas: el rastro va en `auditoria`
--   («Valores de servicio corregidos», con antes y después).
--
-- Aditiva: sin esta migración (`hayServicioAnulacion()` en falso) las rutas
-- nuevas responden 503 y todo lo demás sigue igual. El runner de arranque lee
-- ESTE MISMO archivo.
--
-- Rollback (solo si no hay órdenes anuladas):
--   ALTER TABLE ordenes_servicio DROP CONSTRAINT ordenes_servicio_estado_check;
--   ALTER TABLE ordenes_servicio ADD CONSTRAINT ordenes_servicio_estado_check CHECK (estado IN
--     ('Recibido','En_reparacion','Listo','Entregado','Pendiente_pago','Sin_reparar','Garantia'));
--   ALTER TABLE ordenes_servicio DROP COLUMN anulado_motivo, DROP COLUMN anulado_por,
--     DROP COLUMN anulado_en, DROP COLUMN estado_anterior;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS anulado_motivo  TEXT;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS anulado_por     INTEGER;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS anulado_en      TIMESTAMP;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS estado_anterior TEXT;

-- El CHECK de estados gana 'Anulado'. Se reemplaza solo si todavía no lo
-- admite: así correr el archivo dos veces no vuelve a validar la tabla.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ordenes_servicio_estado_check'
      AND pg_get_constraintdef(oid) LIKE '%Anulado%'
  ) THEN
    ALTER TABLE ordenes_servicio DROP CONSTRAINT IF EXISTS ordenes_servicio_estado_check;
    ALTER TABLE ordenes_servicio ADD CONSTRAINT ordenes_servicio_estado_check CHECK (estado IN
      ('Recibido','En_reparacion','Listo','Entregado','Pendiente_pago','Sin_reparar','Garantia','Anulado'));
  END IF;
END $$;
