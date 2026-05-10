UPDATE superadmins SET password_hash = '$2a$10$6Mq.QZaqBTD8ZcXwLvxPruPb0HiWPxeRvpFGR9PHNo77SCS552dne' WHERE email = 'super@admin.com';

-- Migración: vincular servicio técnico completado con su factura generada automáticamente
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS factura_id INTEGER REFERENCES facturas(id) ON DELETE SET NULL;

-- Migración: método de pago en movimientos manuales de caja
ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS metodo VARCHAR(50) NULL;