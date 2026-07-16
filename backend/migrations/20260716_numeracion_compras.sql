-- ─────────────────────────────────────────────────────────────────────────────
-- NUMERACIÓN DE COMPRAS POR NEGOCIO
--
-- Extiende 20260716_numeracion_documentos_por_negocio.sql al documento COMPRA.
-- El "número" interno de compra que se muestra (Compra #00123) era el id global
-- de la tabla; ahora cada negocio lleva su consecutivo en `compras.numero`
-- usando la misma tabla `contadores_documento` (tipo = 'compra').
--
-- OJO: `compras.numero_factura` es el número de factura DEL PROVEEDOR
-- (digitado por el usuario) y NO se toca.
--
-- 100% ADITIVA e IDEMPOTENTE: se puede ejecutar varias veces sin efecto.
-- Requiere que la migración 20260716_numeracion_documentos_por_negocio.sql
-- ya esté aplicada (crea contadores_documento).
--
--   * Negocios EXISTENTES: contador sembrado en MAX(id) de sus compras →
--     su numeración continúa sin saltos hacia atrás. Compras viejas quedan
--     con numero = NULL y siguen mostrando el id de siempre.
--   * CALIWOOD: sus compras existentes se renumeran 1..N y contador = N.
--   * Negocios NUEVOS: primera compra = 1.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE compras ADD COLUMN IF NOT EXISTS numero INTEGER;

DO $$
DECLARE
  v_caliwood INTEGER;
  v_offset   INTEGER;
BEGIN
  IF to_regclass('public.contadores_documento') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar 20260716_numeracion_documentos_por_negocio.sql (contadores_documento no existe)';
  END IF;

  SELECT id INTO v_caliwood FROM negocios WHERE nombre ILIKE '%caliwood%' LIMIT 1;

  IF v_caliwood IS NULL THEN
    RAISE NOTICE 'Negocio Caliwood no encontrado — se omite la renumeración.';
  ELSE
    RAISE NOTICE 'Caliwood = negocio %', v_caliwood;

    -- COMPRAS de Caliwood: renumerar 1..N las que no tengan numero.
    SELECT GREATEST(
             COALESCE((SELECT MAX(c.numero) FROM compras c
                       JOIN sucursales s ON s.id = c.sucursal_id
                       WHERE s.negocio_id = v_caliwood), 0),
             COALESCE((SELECT ultimo_numero FROM contadores_documento
                       WHERE negocio_id = v_caliwood AND tipo = 'compra'), 0)
           ) INTO v_offset;

    UPDATE compras c SET numero = t.rn + v_offset
    FROM (
      SELECT c2.id, ROW_NUMBER() OVER (ORDER BY c2.id) AS rn
      FROM compras c2
      JOIN sucursales s ON s.id = c2.sucursal_id
      WHERE s.negocio_id = v_caliwood AND c2.numero IS NULL
    ) t
    WHERE c.id = t.id;

    INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
    SELECT v_caliwood, 'compra',
           COALESCE((SELECT MAX(c.numero) FROM compras c
                     JOIN sucursales s ON s.id = c.sucursal_id
                     WHERE s.negocio_id = v_caliwood), 0)
    ON CONFLICT (negocio_id, tipo)
    DO UPDATE SET ultimo_numero = GREATEST(contadores_documento.ultimo_numero, EXCLUDED.ultimo_numero);
  END IF;

  -- Resto de negocios: sembrar contador en MAX(id) de sus compras.
  INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
  SELECT s.negocio_id, 'compra', MAX(c.id)
  FROM compras c JOIN sucursales s ON s.id = c.sucursal_id
  WHERE v_caliwood IS NULL OR s.negocio_id <> v_caliwood
  GROUP BY s.negocio_id
  ON CONFLICT (negocio_id, tipo) DO NOTHING;
END $$;

-- Rollback manual (si algún día se necesita):
--   ALTER TABLE compras DROP COLUMN IF EXISTS numero;
--   DELETE FROM contadores_documento WHERE tipo = 'compra';
