-- ─────────────────────────────────────────────────────────────────────────────
-- DATOS DE CADA SUCURSAL PARA LOS DOCUMENTOS (28-sep-2026)
--
-- Todo documento imprimía el encabezado del NEGOCIO (config_negocio:
-- nombre_negocio, nit, direccion, telefono, logo_negocio). Un negocio con
-- sucursales de nombre distinto (Tesla → «Bunny Mobile») entregaba al cliente
-- de Bunny facturas, préstamos y recibos con el nombre de Tesla.
--
-- Una fila por sucursal que quiera datos PROPIOS. Cada campo vacío (NULL) se
-- hereda del negocio, y sin fila la sucursal imprime exactamente lo de antes:
-- la feature es aditiva para los 28 negocios.
--
-- Tabla aparte y no columnas en `sucursales`: el logo es una imagen en base64,
-- y `sucursales` se lee con `SELECT *` en decenas de sitios (selectores,
-- permisos, reportes). Colgarle el logo ahí inflaría cada una de esas
-- respuestas. Y `sucursales.direccion`/`telefono` NO se usan como respaldo
-- automático: existían sin salir en ningún documento, y empezar a imprimirlos
-- en silencio cambiaría las facturas de negocios que no lo pidieron. La
-- pantalla los ofrece como punto de partida.
--
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sucursales_documento (
  sucursal_id      INTEGER PRIMARY KEY REFERENCES sucursales(id) ON DELETE CASCADE,
  nombre_comercial TEXT,
  nit              TEXT,
  direccion        TEXT,
  telefono         TEXT,
  logo             TEXT,
  actualizado_en   TIMESTAMP NOT NULL DEFAULT NOW()
);
