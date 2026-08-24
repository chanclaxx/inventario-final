-- ─────────────────────────────────────────────────────────────────────────────
-- LA LÍNEA DE ENTREGA POR CANTIDAD ES UN LOTE
--
-- Un SERIAL tiene identidad: `serial_id` une la línea de entrega con la de
-- devolución, y marcar esa línea 'Devuelta' hace que el cargo del envío deje de
-- contarla. La mercancía por CANTIDAD no tiene identidad — una unidad es
-- indistinguible de otra— y hasta ahora el sistema lo resolvía con agregados por
-- PRODUCTO y promedios ponderados. De ahí salían tres defectos, los tres
-- silenciosos y los tres sobre dinero:
--
--   1. `_origenUnidadCantidad` consultaba por `producto_destino_id`, no por
--      nodo: el local podía devolver una talla que la bodega NUNCA le envió y
--      el sistema la acreditaba contra su deuda, porque el producto sí tenía
--      unidades pendientes en otra talla;
--   2. el valor acreditado era el promedio ponderado de todos los envíos, así
--      que devolver 2 unidades acreditaba un precio que no era el de ninguna
--      unidad real;
--   3. lo reclamable de cada línea se calculaba contra el stock completo sin
--      descontar lo que otras líneas ya reclamaban: con dos envíos de la misma
--      talla se podía reclamar el doble de lo que había.
--
-- La estrategia: cada línea de entrega es un LOTE (cantidad + su valor propio).
-- Lo que el local debe de un nodo es Σ entregado − Σ devuelto DE ESE NODO, y una
-- devolución consume lotes del más viejo al más nuevo acreditando cada uno A SU
-- PROPIO VALOR. Si no quedan lotes pendientes, la mercancía es del local y no se
-- acredita nada.
--
-- 100% ADITIVA e IDEMPOTENTE. `cantidad_devuelta` arranca en 0, que es
-- exactamente lo que valían todas las líneas existentes.
--
-- Se auto-aplica al arrancar el backend (src/config/migrations.js).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS lineas_remision
  ADD COLUMN IF NOT EXISTS cantidad_devuelta INT NOT NULL DEFAULT 0;

-- Buscar los lotes pendientes de un nodo, en orden FIFO.
CREATE INDEX IF NOT EXISTS idx_lineas_remision_lote_pendiente
  ON lineas_remision (producto_destino_id, atributo_destino_id, variante_destino_id)
  WHERE tipo = 'cantidad' AND estado_linea = 'Recibida';

-- Rollback manual (si algún día se necesita):
--   DROP INDEX IF EXISTS idx_lineas_remision_lote_pendiente;
--   ALTER TABLE lineas_remision DROP COLUMN IF EXISTS cantidad_devuelta;
