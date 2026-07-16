-- ─────────────────────────────────────────────────────────────────────────────
-- NUMERACIÓN DE DOCUMENTOS POR NEGOCIO
--
-- Problema: el "número" visible de facturas, préstamos y órdenes de servicio
-- era el id GLOBAL de la tabla (compartido entre todos los negocios), por lo
-- que un negocio recién creado arranca en #6733 en vez de #1 (caso Caliwood).
--
-- Solución: columna `numero` (consecutivo POR NEGOCIO) + tabla de contadores.
-- La app asigna `numero` al crear el documento; para mostrar se usa
-- `numero ?? id`, así los documentos históricos (numero = NULL) conservan
-- exactamente el número que siempre han mostrado.
--
-- 100% ADITIVA e IDEMPOTENTE: se puede ejecutar varias veces sin efecto.
-- No borra ni modifica datos existentes, salvo asignar `numero` a los
-- documentos de Caliwood que aún lo tengan en NULL (pedido del cliente).
--
-- Diseño:
--   * contadores_documento(negocio_id, tipo) → ultimo_numero.
--   * La app incrementa con INSERT … ON CONFLICT DO UPDATE … RETURNING
--     (atómico; el lock de fila serializa creaciones concurrentes del mismo
--     negocio y el incremento se revierte con el ROLLBACK de la transacción).
--   * Negocios EXISTENTES: contador sembrado en MAX(id) de sus documentos →
--     su numeración continúa sin saltos hacia atrás (ej: iban por #2487,
--     siguen en #2488). Sus documentos viejos quedan con numero = NULL y
--     siguen mostrando el id de siempre.
--   * Negocios NUEVOS (sin documentos): sin fila de contador → el primer
--     documento recibe el número 1.
--   * CALIWOOD (pedido explícito del cliente): sus documentos existentes se
--     renumeran 1..N y su contador queda en N.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabla de contadores por negocio y tipo de documento
CREATE TABLE IF NOT EXISTS contadores_documento (
  negocio_id    INTEGER NOT NULL,
  tipo          TEXT    NOT NULL,   -- 'factura' | 'prestamo' | 'orden_servicio'
  ultimo_numero INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (negocio_id, tipo)
);

-- 2. Columna `numero` en los documentos emitidos (NULL = documento histórico,
--    se sigue mostrando su id global de siempre)
ALTER TABLE facturas         ADD COLUMN IF NOT EXISTS numero INTEGER;
ALTER TABLE prestamos        ADD COLUMN IF NOT EXISTS numero INTEGER;
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS numero INTEGER;

-- 3. Renumeración de Caliwood + siembra de contadores
DO $$
DECLARE
  v_caliwood INTEGER;
  v_offset   INTEGER;
BEGIN
  -- Caliwood: negocio 35 ('New Store Caliwood') al momento de escribir esto.
  -- Se resuelve por nombre para no depender del id.
  SELECT id INTO v_caliwood FROM negocios WHERE nombre ILIKE '%caliwood%' LIMIT 1;

  IF v_caliwood IS NULL THEN
    RAISE NOTICE 'Negocio Caliwood no encontrado — se omite la renumeración.';
  ELSE
    RAISE NOTICE 'Caliwood = negocio %', v_caliwood;

    -- 3a. FACTURAS de Caliwood: renumerar 1..N las que no tengan numero.
    --     El offset arranca donde vaya el contador (0 en la primera corrida),
    --     así re-ejecutar la migración solo numera filas nuevas en NULL.
    SELECT GREATEST(
             COALESCE((SELECT MAX(f.numero) FROM facturas f
                       JOIN sucursales s ON s.id = f.sucursal_id
                       WHERE s.negocio_id = v_caliwood), 0),
             COALESCE((SELECT ultimo_numero FROM contadores_documento
                       WHERE negocio_id = v_caliwood AND tipo = 'factura'), 0)
           ) INTO v_offset;

    UPDATE facturas f SET numero = t.rn + v_offset
    FROM (
      SELECT f2.id, ROW_NUMBER() OVER (ORDER BY f2.id) AS rn
      FROM facturas f2
      JOIN sucursales s ON s.id = f2.sucursal_id
      WHERE s.negocio_id = v_caliwood AND f2.numero IS NULL
    ) t
    WHERE f.id = t.id;

    INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
    SELECT v_caliwood, 'factura',
           COALESCE((SELECT MAX(f.numero) FROM facturas f
                     JOIN sucursales s ON s.id = f.sucursal_id
                     WHERE s.negocio_id = v_caliwood), 0)
    ON CONFLICT (negocio_id, tipo)
    DO UPDATE SET ultimo_numero = GREATEST(contadores_documento.ultimo_numero, EXCLUDED.ultimo_numero);

    -- 3b. PRÉSTAMOS de Caliwood (hoy no tiene: queda listo por si crea)
    SELECT GREATEST(
             COALESCE((SELECT MAX(p.numero) FROM prestamos p
                       JOIN sucursales s ON s.id = p.sucursal_id
                       WHERE s.negocio_id = v_caliwood), 0),
             COALESCE((SELECT ultimo_numero FROM contadores_documento
                       WHERE negocio_id = v_caliwood AND tipo = 'prestamo'), 0)
           ) INTO v_offset;

    UPDATE prestamos p SET numero = t.rn + v_offset
    FROM (
      SELECT p2.id, ROW_NUMBER() OVER (ORDER BY p2.id) AS rn
      FROM prestamos p2
      JOIN sucursales s ON s.id = p2.sucursal_id
      WHERE s.negocio_id = v_caliwood AND p2.numero IS NULL
    ) t
    WHERE p.id = t.id;

    INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
    SELECT v_caliwood, 'prestamo',
           COALESCE((SELECT MAX(p.numero) FROM prestamos p
                     JOIN sucursales s ON s.id = p.sucursal_id
                     WHERE s.negocio_id = v_caliwood), 0)
    ON CONFLICT (negocio_id, tipo)
    DO UPDATE SET ultimo_numero = GREATEST(contadores_documento.ultimo_numero, EXCLUDED.ultimo_numero);

    -- 3c. ÓRDENES DE SERVICIO de Caliwood
    SELECT GREATEST(
             COALESCE((SELECT MAX(os.numero) FROM ordenes_servicio os
                       WHERE os.negocio_id = v_caliwood), 0),
             COALESCE((SELECT ultimo_numero FROM contadores_documento
                       WHERE negocio_id = v_caliwood AND tipo = 'orden_servicio'), 0)
           ) INTO v_offset;

    UPDATE ordenes_servicio os SET numero = t.rn + v_offset
    FROM (
      SELECT os2.id, ROW_NUMBER() OVER (ORDER BY os2.id) AS rn
      FROM ordenes_servicio os2
      WHERE os2.negocio_id = v_caliwood AND os2.numero IS NULL
    ) t
    WHERE os.id = t.id;

    INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
    SELECT v_caliwood, 'orden_servicio',
           COALESCE((SELECT MAX(os.numero) FROM ordenes_servicio os
                     WHERE os.negocio_id = v_caliwood), 0)
    ON CONFLICT (negocio_id, tipo)
    DO UPDATE SET ultimo_numero = GREATEST(contadores_documento.ultimo_numero, EXCLUDED.ultimo_numero);
  END IF;

  -- 3d. Resto de negocios: sembrar contador en MAX(id) de sus documentos para
  --     que su numeración continúe donde va (sin renumerar lo histórico).
  --     DO NOTHING → nunca pisa un contador ya sembrado o ya avanzado.
  INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
  SELECT s.negocio_id, 'factura', MAX(f.id)
  FROM facturas f JOIN sucursales s ON s.id = f.sucursal_id
  WHERE v_caliwood IS NULL OR s.negocio_id <> v_caliwood
  GROUP BY s.negocio_id
  ON CONFLICT (negocio_id, tipo) DO NOTHING;

  INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
  SELECT s.negocio_id, 'prestamo', MAX(p.id)
  FROM prestamos p JOIN sucursales s ON s.id = p.sucursal_id
  WHERE v_caliwood IS NULL OR s.negocio_id <> v_caliwood
  GROUP BY s.negocio_id
  ON CONFLICT (negocio_id, tipo) DO NOTHING;

  INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
  SELECT os.negocio_id, 'orden_servicio', MAX(os.id)
  FROM ordenes_servicio os
  WHERE v_caliwood IS NULL OR os.negocio_id <> v_caliwood
  GROUP BY os.negocio_id
  ON CONFLICT (negocio_id, tipo) DO NOTHING;
END $$;

-- Rollback manual (si algún día se necesita):
--   ALTER TABLE facturas         DROP COLUMN IF EXISTS numero;
--   ALTER TABLE prestamos        DROP COLUMN IF EXISTS numero;
--   ALTER TABLE ordenes_servicio DROP COLUMN IF EXISTS numero;
--   DROP TABLE IF EXISTS contadores_documento;
