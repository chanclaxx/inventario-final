-- Tabla para agrupar pagos totales (un pago que salda múltiples préstamos en FIFO)
CREATE TABLE IF NOT EXISTS public.abonos_totales (
  id           SERIAL PRIMARY KEY,
  tipo_persona VARCHAR(20)   NOT NULL,          -- 'prestatario' | 'cliente'
  persona_id   INTEGER       NOT NULL,
  sucursal_id  INTEGER       NOT NULL REFERENCES public.sucursales(id),
  fecha        TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL,
  valor_total  NUMERIC(12,2) NOT NULL,
  metodo       VARCHAR(50)   DEFAULT 'Efectivo',
  usuario_id   INTEGER       REFERENCES public.usuarios(id)
);

-- FK en abonos_prestamo para vincular abonos individuales a un pago total
ALTER TABLE public.abonos_prestamo
  ADD COLUMN IF NOT EXISTS abono_total_id INTEGER REFERENCES public.abonos_totales(id);
