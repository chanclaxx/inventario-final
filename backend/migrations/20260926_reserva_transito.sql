-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE VA EN CAMINO NO SE TOCA — reserva de la mercancía de la red interna
--
-- 100% ADITIVA e IDEMPOTENTE. La corre el runner (src/config/migrations.js)
-- leyendo ESTE archivo, en su propio bloque: si fallara, todo sigue como hoy.
--
-- ── El problema ─────────────────────────────────────────────────────────────
-- Despachar NO mueve inventario: el stock sale de la bodega hasta que el local
-- RECIBE. Mientras tanto la mercancía ya no está en la bodega, pero el sistema
-- la sigue mostrando y dejando usar ahí: se podía VENDER, PRESTAR, AJUSTAR o
-- TRASLADAR lo que ya iba en el camión. Al recibir, la unidad ya no estaba y el
-- envío quedaba imposible de recibir (Tesla, envío #21, sep-2026), o el stock
-- de la bodega quedaba por debajo de lo despachado.
-- Solo dos candados existían, ambos dentro de la red: un IMEI no va en dos
-- envíos, y no se despacha más de lo que queda sin comprometer. Nada fuera de
-- la red interna miraba los envíos en camino.
--
-- ── La decisión: RESERVAR, no descontar ─────────────────────────────────────
-- El stock sigue en la sucursal que despacha, pero BLOQUEADO: ninguna operación
-- puede llevarlo por debajo de lo que va en camino, y un IMEI en camino no se
-- vende, presta, cambia de referencia ni borra. Recibir sigue moviendo el stock
-- como siempre; anular el envío o marcar una línea como faltante lo libera solo
-- (la reserva se DERIVA de las líneas 'Pendiente', no se guarda en ningún lado).
-- Descontar al despachar habría obligado a devolver stock en faltantes y
-- anulaciones y a re-tocar costo promedio y reportes.
--
-- ── Por qué un TRIGGER ──────────────────────────────────────────────────────
-- Más de veinte sitios escriben stock y seriales (ventas, préstamos, ajustes,
-- traslados, importación, retomas, compras, devoluciones…). Ponerle la regla a
-- cada uno dejaría fuera justo el que nadie recuerde. Es el mismo criterio del
-- candado de técnicos externos (fn_serial_en_tecnico).
--
-- ── Quién SÍ puede mover lo reservado ───────────────────────────────────────
-- Solo la propia recepción del envío (y la confirmación de una devolución),
-- que marcan su transacción con  set_config('app.red_transito_libre','1',true).
-- El `true` hace que la marca muera con la transacción.
--
-- Solo se mira lo que BAJA: subir stock nunca se bloquea, aunque siga por
-- debajo de lo reservado (esa es justamente la forma de arreglarlo).
--
-- ROLLBACK manual:
--   DROP TRIGGER IF EXISTS trg_serial_en_transito ON seriales;
--   DROP TRIGGER IF EXISTS trg_stock_transito_producto ON productos_cantidad;
--   DROP TRIGGER IF EXISTS trg_stock_transito_atributo ON atributos_producto;
--   DROP TRIGGER IF EXISTS trg_stock_transito_variante ON variantes_atributo;
--   DROP FUNCTION IF EXISTS fn_serial_en_transito(), fn_stock_en_transito();
-- ─────────────────────────────────────────────────────────────────────────────

-- Índices parciales: solo las líneas que van en camino. Un envío recibido deja
-- de estar aquí, así que el índice se queda del tamaño de lo que viaja HOY.
CREATE INDEX IF NOT EXISTS idx_lr_transito_serial
  ON lineas_remision (serial_id)
  WHERE estado_linea = 'Pendiente' AND serial_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lr_transito_nodo
  ON lineas_remision (producto_origen_id, atributo_origen_id, variante_origen_id)
  WHERE estado_linea = 'Pendiente' AND tipo = 'cantidad';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Un IMEI en camino no se vende, presta, cambia de referencia ni borra
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_serial_en_transito() RETURNS trigger AS $$
DECLARE
  v_envio   TEXT;
  v_tipo    TEXT;
  v_destino TEXT;
BEGIN
  IF current_setting('app.red_transito_libre', true) = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Solo lo que saca la unidad de su sitio: venderla, prestarla, moverla de
  -- referencia o borrarla. Cambiar su precio o su nota no molesta a nadie.
  IF TG_OP = 'UPDATE'
     AND (NEW.vendido  IS NOT DISTINCT FROM OLD.vendido  OR NEW.vendido  IS NOT TRUE)
     AND (NEW.prestado IS NOT DISTINCT FROM OLD.prestado OR NEW.prestado IS NOT TRUE)
     AND NEW.producto_id IS NOT DISTINCT FROM OLD.producto_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(r.numero::text, r.id::text), r.tipo, sd.nombre
    INTO v_envio, v_tipo, v_destino
    FROM lineas_remision lr
    JOIN remisiones r  ON r.id  = lr.remision_id
    JOIN sucursales sd ON sd.id = r.sucursal_destino_id
   WHERE lr.serial_id = OLD.id
     AND lr.estado_linea = 'Pendiente'
     AND r.estado = 'En transito'
   LIMIT 1;

  IF v_envio IS NOT NULL THEN
    RAISE EXCEPTION 'El equipo % va en camino en % #% hacia %. No se puede vender, prestar ni mover hasta que se reciba o se anule.',
      OLD.imei,
      CASE WHEN v_tipo = 'devolucion' THEN 'la devolución' ELSE 'el envío' END,
      v_envio, v_destino
      USING ERRCODE = 'RT001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_serial_en_transito ON seriales;
CREATE TRIGGER trg_serial_en_transito
  BEFORE UPDATE OR DELETE ON seriales
  FOR EACH ROW EXECUTE FUNCTION fn_serial_en_transito();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. El stock por cantidad no baja de lo que va en camino
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Se mira el NODO exacto de la línea, igual que `_comprometidoSinRecibir` del
-- despacho: la variante, el atributo (sin variante) o el producto (sin
-- atributo). Un CONTENEDOR (producto con tallas, talla con colores) tiene un
-- stock DERIVADO que la sincronización recalcula como suma de sus hijos; los
-- hijos ya están protegidos, y bloquear al contenedor frenaría esa suma — por
-- eso se salta.
CREATE OR REPLACE FUNCTION fn_stock_en_transito() RETURNS trigger AS $$
DECLARE
  v_reservado INTEGER;
  v_envios    TEXT;
  v_baja      BOOLEAN;
  v_nuevo     INTEGER;
BEGIN
  IF current_setting('app.red_transito_libre', true) = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_baja  := TRUE;
    v_nuevo := 0;
  ELSE
    -- Desactivar también cuenta como sacarlo: la recepción no encontraría el
    -- producto de origen.
    v_baja  := COALESCE(NEW.stock, 0) < COALESCE(OLD.stock, 0)
               OR (OLD.activo IS TRUE AND NEW.activo IS NOT TRUE);
    v_nuevo := CASE WHEN OLD.activo IS TRUE AND NEW.activo IS NOT TRUE THEN 0
                    ELSE COALESCE(NEW.stock, 0) END;
  END IF;
  IF NOT v_baja THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'productos_cantidad' THEN
    SELECT COALESCE(SUM(lr.cantidad), 0), string_agg(DISTINCT '#' || COALESCE(r.numero::text, r.id::text), ', ')
      INTO v_reservado, v_envios
      FROM lineas_remision lr JOIN remisiones r ON r.id = lr.remision_id
     WHERE lr.tipo = 'cantidad' AND lr.estado_linea = 'Pendiente' AND r.estado = 'En transito'
       AND lr.producto_origen_id = OLD.id
       AND lr.atributo_origen_id IS NULL AND lr.variante_origen_id IS NULL;
  ELSIF TG_TABLE_NAME = 'atributos_producto' THEN
    SELECT COALESCE(SUM(lr.cantidad), 0), string_agg(DISTINCT '#' || COALESCE(r.numero::text, r.id::text), ', ')
      INTO v_reservado, v_envios
      FROM lineas_remision lr JOIN remisiones r ON r.id = lr.remision_id
     WHERE lr.tipo = 'cantidad' AND lr.estado_linea = 'Pendiente' AND r.estado = 'En transito'
       AND lr.atributo_origen_id = OLD.id AND lr.variante_origen_id IS NULL;
  ELSE
    SELECT COALESCE(SUM(lr.cantidad), 0), string_agg(DISTINCT '#' || COALESCE(r.numero::text, r.id::text), ', ')
      INTO v_reservado, v_envios
      FROM lineas_remision lr JOIN remisiones r ON r.id = lr.remision_id
     WHERE lr.tipo = 'cantidad' AND lr.estado_linea = 'Pendiente' AND r.estado = 'En transito'
       AND lr.variante_origen_id = OLD.id;
  END IF;

  -- Lo normal es que nada vaya en camino: se sale aquí sin más consultas.
  IF v_reservado = 0 OR v_nuevo >= v_reservado THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Un CONTENEDOR con hijos activos tiene stock derivado (la suma de sus
  -- hijos, que ya están protegidos): no se le bloquea la sincronización.
  IF (TG_TABLE_NAME = 'productos_cantidad'
        AND EXISTS (SELECT 1 FROM atributos_producto a WHERE a.producto_id = OLD.id AND a.activo))
     OR (TG_TABLE_NAME = 'atributos_producto'
        AND EXISTS (SELECT 1 FROM variantes_atributo v WHERE v.atributo_id = OLD.id AND v.activo)) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TRUE THEN
    RAISE EXCEPTION '% unidad(es) van en camino en el envío % sin recibir: el stock no puede quedar en % (mínimo %). Recibe o anula el envío primero.',
      v_reservado, v_envios, v_nuevo, v_reservado
      USING ERRCODE = 'RT001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_transito_producto ON productos_cantidad;
CREATE TRIGGER trg_stock_transito_producto
  BEFORE UPDATE OF stock, activo OR DELETE ON productos_cantidad
  FOR EACH ROW EXECUTE FUNCTION fn_stock_en_transito();

DROP TRIGGER IF EXISTS trg_stock_transito_atributo ON atributos_producto;
CREATE TRIGGER trg_stock_transito_atributo
  BEFORE UPDATE OF stock, activo OR DELETE ON atributos_producto
  FOR EACH ROW EXECUTE FUNCTION fn_stock_en_transito();

DROP TRIGGER IF EXISTS trg_stock_transito_variante ON variantes_atributo;
CREATE TRIGGER trg_stock_transito_variante
  BEFORE UPDATE OF stock, activo OR DELETE ON variantes_atributo
  FOR EACH ROW EXECUTE FUNCTION fn_stock_en_transito();
