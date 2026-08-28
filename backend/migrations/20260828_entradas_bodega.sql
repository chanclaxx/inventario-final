-- ─────────────────────────────────────────────────────────────────────────────
-- ENTRADAS DE BODEGA — recibir mercancía sin ver ni teclear precios
--
-- El bodeguero cuenta lo que llegó; administración le pone la plata después.
-- Son dos actos distintos, los hacen dos personas y ocurren en momentos
-- distintos; hasta hoy el sistema los obligaba a ser el mismo formulario
-- (`POST /compras` exige proveedor y precio > 0).
--
-- ── NO se crea un ciclo de compra paralelo ──────────────────────────────────
-- Una Entrada ES una compra: la misma fila, el mismo consecutivo, la misma
-- `registrarCompra()` que ya mete inventario, calcula el costo promedio, crea
-- el cargo al acreedor y sabe revertirse. Lo único que cambia es QUIÉN la
-- dispara y QUÉ ve mientras lo hace. Por eso esta migración son dos columnas y
-- no un modelo nuevo.
--
-- ── Por qué la entrada SÍ se valoriza ───────────────────────────────────────
-- Recibir en 0 y "valorizar" después NO es reversible: la corrección de precios
-- reparte el delta sobre el stock actual y da una cifra equivocada. En cambio,
-- recibir al ÚLTIMO COSTO CONOCIDO del producto no mueve el promedio ni un peso
-- —mezclar unidades al mismo costo que ya tenían deja el promedio igual— y la
-- corrección posterior aterriza EXACTAMENTE donde habría quedado una compra
-- normal al precio real. Es una identidad algebraica, comprobada contra las dos
-- funciones del repositorio en 180 combinaciones (prueba 33).
--
-- Orden de la fuente del precio provisional:
--   1. `precio_estimado` de la línea de la orden, si la entrada viene de una
--   2. el último costo conocido del nodo que recibe
--   3. nada: la unidad entra sin costo y sale en el panel «productos sin costo»
--      de Reportes, que ya existe. No se inventa una cifra.
--
-- 100% ADITIVA. `factura_confirmada` nace en TRUE, así que TODAS las compras
-- que ya existen quedan como confirmadas y ninguna aparece de golpe en la
-- bandeja de pendientes de los 28 negocios.
-- ─────────────────────────────────────────────────────────────────────────────

-- Una compra registrada por administración con sus precios nace confirmada.
-- Una Entrada de bodega nace en FALSE y espera la factura del proveedor.
ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS factura_confirmada BOOLEAN NOT NULL DEFAULT TRUE;

-- Qué compra entró por bodega. Se marca en vez de deducirse: "sin proveedor" o
-- "no toca caja" también describen a una compra a crédito registrada desde
-- Proveedores, y esa no es una Entrada ni tiene por qué salir en la pantalla
-- del bodeguero. FALSE por defecto deja todo el historial como lo que es.
ALTER TABLE compras
  ADD COLUMN IF NOT EXISTS es_entrada BOOLEAN NOT NULL DEFAULT FALSE;

-- Sin orden previa no hay proveedor que asignar: lo pone administración al
-- confirmar. `registrarCompra` ya trata el proveedor como opcional en todo su
-- cuerpo (`if (proveedor_id)` alrededor del bloque del acreedor); lo único que
-- lo impedía era el validador de la ruta. Si la columna ya es nullable, esto no
-- hace nada.
ALTER TABLE compras ALTER COLUMN proveedor_id DROP NOT NULL;

-- La bandeja de administración pregunta siempre lo mismo: qué falta por
-- confirmar, lo más viejo primero. Índice PARCIAL porque lo pendiente es el
-- conjunto chico y lo confirmado no se consulta por aquí nunca.
CREATE INDEX IF NOT EXISTS idx_compras_por_confirmar
  ON compras (sucursal_id, fecha)
  WHERE factura_confirmada = FALSE;
