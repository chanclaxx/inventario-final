-- ─────────────────────────────────────────────────────────────────────────────
-- Pago total en CRÉDITOS
--
-- Los créditos solo permitían abonar de a uno. Un cliente con cuatro compras a
-- crédito tenía que registrar cuatro abonos y repartir a mano — que es
-- exactamente el trabajo que el pago total de préstamos vino a quitar.
--
-- Se reusa `abonos_totales` en vez de crear otra tabla, pero eso obliga a algo
-- que NO es opcional: **distinguir a qué se aplicó el pago**. Esa tabla ya se
-- usa para préstamos hechos a un CLIENTE (`tipo_persona = 'cliente'`), así que
-- sin `destino` un pago total de créditos aparecería también en el extracto de
-- préstamos de esa misma persona — como una línea que resta sin tener ningún
-- abono detrás. La cuenta quedaría descuadrada justo del modo que esta sesión
-- se dedicó a cerrar.
--
-- `destino` arranca en 'prestamo' para que las 2.000+ filas que ya existen
-- sigan comportándose igual: todas son de préstamos.
--
-- `abonos_credito.abono_total_id` es el equivalente de lo que ya tiene
-- `abonos_prestamo`: ata cada pedazo del reparto con el pago que lo originó.
-- Sin él, el extracto no podría mostrar el pago como UNA línea ni saber qué
-- porción anular cuando se devuelve algo.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE abonos_totales
  ADD COLUMN IF NOT EXISTS destino TEXT NOT NULL DEFAULT 'prestamo';

ALTER TABLE abonos_credito
  ADD COLUMN IF NOT EXISTS abono_total_id INTEGER;

-- El extracto de un crédito busca los pedazos de un pago; sin índice recorre
-- toda la tabla por cada línea.
CREATE INDEX IF NOT EXISTS idx_abonos_credito_abono_total
  ON abonos_credito (abono_total_id) WHERE abono_total_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_abonos_totales_destino
  ON abonos_totales (destino, tipo_persona, persona_id);
