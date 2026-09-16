-- ─────────────────────────────────────────────────────────────────────────────
-- CÓDIGO DEL PROVEEDOR EN LAS ETIQUETAS  (opt-in: config_negocio.proveedor_codigo_activo)
--
-- Cada proveedor recibe un código NOMBRE-NIT-CIUDAD-consecutivo
-- (DIS-900-CAL-001) que viaja impreso en las etiquetas de la mercancía que se
-- le compró. Ver utils/codigoProveedor.util.js para las reglas.
--
-- Dos columnas y un índice. Nada más:
--   · `ciudad` no existía y es uno de los tres segmentos.
--   · `codigo` se escribe UNA vez y no se vuelve a tocar: ya está impreso en la
--     mercancía, así que editar el nombre o el NIT después no lo reescribe.
--   · El consecutivo vive en `contadores_documento` (tipo 'codigo_proveedor',
--     columna TEXT libre): no necesita migración.
--
-- Está replicada inline en src/config/migrations.js, que es la que corre de
-- verdad al arrancar. Sin estas columnas, `hayCodigoProveedor()` queda en falso
-- y proveedores funciona exactamente como antes.
--
-- Rollback (la feature se apaga sola sin las columnas):
--   DROP INDEX IF EXISTS uq_proveedores_codigo;
--   ALTER TABLE proveedores DROP COLUMN IF EXISTS codigo;
--   ALTER TABLE proveedores DROP COLUMN IF EXISTS ciudad;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS proveedores ADD COLUMN IF NOT EXISTS ciudad TEXT;
ALTER TABLE IF EXISTS proveedores ADD COLUMN IF NOT EXISTS codigo TEXT;

-- Único por NEGOCIO: el consecutivo es del negocio, no de la sucursal, porque
-- el proveedor tampoco es de una sucursal.
CREATE UNIQUE INDEX IF NOT EXISTS uq_proveedores_codigo
  ON proveedores (negocio_id, codigo) WHERE codigo IS NOT NULL;
