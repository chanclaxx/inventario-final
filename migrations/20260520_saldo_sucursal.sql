-- Saldo a favor por sucursal (aditivo, no destruye la columna global saldo_a_favor)
CREATE TABLE IF NOT EXISTS saldo_a_favor_sucursal (
  id           SERIAL       PRIMARY KEY,
  tipo_persona TEXT         NOT NULL CHECK (tipo_persona IN ('prestatario', 'cliente')),
  persona_id   INTEGER      NOT NULL,
  sucursal_id  INTEGER      NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  saldo        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tipo_persona, persona_id, sucursal_id)
);

-- Historial de movimientos del saldo a favor por sucursal
CREATE TABLE IF NOT EXISTS historial_saldo_sucursal (
  id              SERIAL       PRIMARY KEY,
  tipo_persona    TEXT         NOT NULL CHECK (tipo_persona IN ('prestatario', 'cliente')),
  persona_id      INTEGER      NOT NULL,
  sucursal_id     INTEGER      NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  concepto        TEXT         NOT NULL,
  monto           NUMERIC(12,2) NOT NULL,
  tipo_movimiento TEXT         NOT NULL CHECK (tipo_movimiento IN ('credito', 'debito')),
  referencia_id   INTEGER,
  usuario_id      INTEGER      REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_saldo_persona
  ON historial_saldo_sucursal (tipo_persona, persona_id, sucursal_id);

-- ─── Migración inicial: llevar saldo_a_favor global a la sucursal con más préstamos ───

-- Prestatarios
INSERT INTO saldo_a_favor_sucursal (tipo_persona, persona_id, sucursal_id, saldo)
SELECT
  'prestatario',
  pr.id,
  top_suc.sucursal_id,
  pr.saldo_a_favor
FROM prestatarios pr
JOIN LATERAL (
  SELECT p.sucursal_id
  FROM prestamos p
  WHERE p.prestatario_id = pr.id
  GROUP BY p.sucursal_id
  ORDER BY COUNT(*) DESC
  LIMIT 1
) top_suc ON true
WHERE pr.saldo_a_favor > 0
ON CONFLICT (tipo_persona, persona_id, sucursal_id) DO NOTHING;

INSERT INTO historial_saldo_sucursal
  (tipo_persona, persona_id, sucursal_id, concepto, monto, tipo_movimiento)
SELECT
  'prestatario',
  pr.id,
  top_suc.sucursal_id,
  'Saldo inicial — migración desde saldo global',
  pr.saldo_a_favor,
  'credito'
FROM prestatarios pr
JOIN LATERAL (
  SELECT p.sucursal_id
  FROM prestamos p
  WHERE p.prestatario_id = pr.id
  GROUP BY p.sucursal_id
  ORDER BY COUNT(*) DESC
  LIMIT 1
) top_suc ON true
WHERE pr.saldo_a_favor > 0
  AND NOT EXISTS (
    SELECT 1 FROM historial_saldo_sucursal h
    WHERE h.tipo_persona = 'prestatario' AND h.persona_id = pr.id
      AND h.sucursal_id = top_suc.sucursal_id
  );

-- Clientes
INSERT INTO saldo_a_favor_sucursal (tipo_persona, persona_id, sucursal_id, saldo)
SELECT
  'cliente',
  c.id,
  top_suc.sucursal_id,
  c.saldo_a_favor
FROM clientes c
JOIN LATERAL (
  SELECT p.sucursal_id
  FROM prestamos p
  WHERE p.cliente_id = c.id
  GROUP BY p.sucursal_id
  ORDER BY COUNT(*) DESC
  LIMIT 1
) top_suc ON true
WHERE c.saldo_a_favor > 0
ON CONFLICT (tipo_persona, persona_id, sucursal_id) DO NOTHING;

INSERT INTO historial_saldo_sucursal
  (tipo_persona, persona_id, sucursal_id, concepto, monto, tipo_movimiento)
SELECT
  'cliente',
  c.id,
  top_suc.sucursal_id,
  'Saldo inicial — migración desde saldo global',
  c.saldo_a_favor,
  'credito'
FROM clientes c
JOIN LATERAL (
  SELECT p.sucursal_id
  FROM prestamos p
  WHERE p.cliente_id = c.id
  GROUP BY p.sucursal_id
  ORDER BY COUNT(*) DESC
  LIMIT 1
) top_suc ON true
WHERE c.saldo_a_favor > 0
  AND NOT EXISTS (
    SELECT 1 FROM historial_saldo_sucursal h
    WHERE h.tipo_persona = 'cliente' AND h.persona_id = c.id
      AND h.sucursal_id = top_suc.sucursal_id
  );
