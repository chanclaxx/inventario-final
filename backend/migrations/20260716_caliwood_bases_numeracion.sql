-- ─────────────────────────────────────────────────────────────────────────────
-- BASES DE NUMERACIÓN PARA CALIWOOD (solo negocio Caliwood)
--
-- Pedido del cliente: que su numeración arranque en estas bases, contando
-- también los documentos que ya existen:
--   * Ventas (facturas):        desde 6500
--   * Compras:                  desde 2900
--   * Recibos (préstamos):      desde 1450
-- (Órdenes de servicio no se tocan: siguen arrancando en 1.)
--
-- Renumera TODOS los documentos de Caliwood de forma determinística
-- (base + posición ordenada por id) y deja el contador en base + total - 1.
-- Ejecutarla de nuevo recalcula exactamente los mismos números → IDEMPOTENTE.
-- No toca ningún otro negocio.
--
-- Requiere: 20260716_numeracion_documentos_por_negocio.sql y
--           20260716_numeracion_compras.sql ya aplicadas.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_caliwood INTEGER;
  BASE_FACTURA  CONSTANT INTEGER := 6500;
  BASE_COMPRA   CONSTANT INTEGER := 2900;
  BASE_PRESTAMO CONSTANT INTEGER := 1450;
BEGIN
  SELECT id INTO v_caliwood FROM negocios WHERE nombre ILIKE '%caliwood%' LIMIT 1;
  IF v_caliwood IS NULL THEN
    RAISE EXCEPTION 'Negocio Caliwood no encontrado';
  END IF;
  RAISE NOTICE 'Caliwood = negocio %', v_caliwood;

  -- ── FACTURAS: renumerar 6500, 6501, … en orden de creación ────────────────
  UPDATE facturas f SET numero = t.rn + BASE_FACTURA - 1
  FROM (
    SELECT f2.id, ROW_NUMBER() OVER (ORDER BY f2.id) AS rn
    FROM facturas f2
    JOIN sucursales s ON s.id = f2.sucursal_id
    WHERE s.negocio_id = v_caliwood
  ) t
  WHERE f.id = t.id
    AND f.numero IS DISTINCT FROM t.rn + BASE_FACTURA - 1;

  INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
  SELECT v_caliwood, 'factura',
         BASE_FACTURA - 1 + (SELECT COUNT(*) FROM facturas f
                             JOIN sucursales s ON s.id = f.sucursal_id
                             WHERE s.negocio_id = v_caliwood)
  ON CONFLICT (negocio_id, tipo)
  DO UPDATE SET ultimo_numero = GREATEST(contadores_documento.ultimo_numero, EXCLUDED.ultimo_numero);

  -- ── COMPRAS: renumerar 2900, 2901, … ──────────────────────────────────────
  UPDATE compras c SET numero = t.rn + BASE_COMPRA - 1
  FROM (
    SELECT c2.id, ROW_NUMBER() OVER (ORDER BY c2.id) AS rn
    FROM compras c2
    JOIN sucursales s ON s.id = c2.sucursal_id
    WHERE s.negocio_id = v_caliwood
  ) t
  WHERE c.id = t.id
    AND c.numero IS DISTINCT FROM t.rn + BASE_COMPRA - 1;

  INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
  SELECT v_caliwood, 'compra',
         BASE_COMPRA - 1 + (SELECT COUNT(*) FROM compras c
                            JOIN sucursales s ON s.id = c.sucursal_id
                            WHERE s.negocio_id = v_caliwood)
  ON CONFLICT (negocio_id, tipo)
  DO UPDATE SET ultimo_numero = GREATEST(contadores_documento.ultimo_numero, EXCLUDED.ultimo_numero);

  -- ── PRÉSTAMOS (recibos): renumerar 1450, 1451, … ──────────────────────────
  -- (hoy Caliwood no tiene préstamos → solo queda el contador en 1449 y el
  --  primero que se cree recibirá el 1450)
  UPDATE prestamos p SET numero = t.rn + BASE_PRESTAMO - 1
  FROM (
    SELECT p2.id, ROW_NUMBER() OVER (ORDER BY p2.id) AS rn
    FROM prestamos p2
    JOIN sucursales s ON s.id = p2.sucursal_id
    WHERE s.negocio_id = v_caliwood
  ) t
  WHERE p.id = t.id
    AND p.numero IS DISTINCT FROM t.rn + BASE_PRESTAMO - 1;

  INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
  SELECT v_caliwood, 'prestamo',
         BASE_PRESTAMO - 1 + (SELECT COUNT(*) FROM prestamos p
                              JOIN sucursales s ON s.id = p.sucursal_id
                              WHERE s.negocio_id = v_caliwood)
  ON CONFLICT (negocio_id, tipo)
  DO UPDATE SET ultimo_numero = GREATEST(contadores_documento.ultimo_numero, EXCLUDED.ultimo_numero);
END $$;
