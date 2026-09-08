-- ─────────────────────────────────────────────────────────────────────────────
-- RETOMAS — el equipo que YO vendi y vuelve reingresa con su costo de HOY.
--
-- 100% ADITIVA e IDEMPOTENTE. Se auto-aplica al arrancar el backend
-- (src/config/migrations.js), dentro de su propio try/catch.
--
-- OJO: este archivo esta replicado inline en migrations.js dentro de un
-- template literal de JavaScript. Por eso NO lleva ni una sola comilla
-- invertida, ni siquiera en los comentarios: una sola cierra el literal a media
-- consulta y el backend deja de arrancar entero. Ya paso dos veces.
--
-- ── El problema ─────────────────────────────────────────────────────────────
-- Cuando entra una retoma con IMEI, el sistema busca ese IMEI en el negocio. Si
-- lo encuentra VENDIDO no crea nada: REACTIVA la fila que ya existe. Y esa fila
-- trae encima toda la historia de la primera vez.
--
-- Reactivar y crear no escribian los mismos campos, aunque fisicamente son el
-- mismo hecho: una unidad entra al inventario a un costo nuevo.
--
--   serial NUEVO (equipo ajeno)   -> costo_compra = valor_retoma, entrada = hoy
--   serial REACTIVADO (el mio)    -> costo, fecha, precio y proveedor INTACTOS
--
-- Vendo en 800.000 algo que me costo 600.000. A los 4 meses lo retomo por
-- 400.000 y lo revendo en 500.000. La utilidad real es 100.000; el sistema
-- calcula 500.000 - 600.000 = MENOS 100.000 y reporta perdida. No se ve como un
-- error: se ve como que ese producto da perdida.
--
-- El contraste que lo delata: la COMPRA a proveedor ya lo hace bien. Al
-- reactivar escribe costo_compra = precio_unitario y proveedor_id
-- (compras.service.js). La retoma, en la misma situacion, no.
--
-- ── Lo que esta migracion agrega, y por que son solo tres columnas ──────────
-- El reingreso en si no necesita ni una: es escribir las columnas que ya
-- existen. Estas tres existen para poder DESHACER.
--
-- Anular una retoma hacia DELETE FROM seriales. Si la retoma fue una
-- reactivacion, ese DELETE no borra "lo que la retoma creo" — borra la unidad
-- ORIGINAL, con su costo, su proveedor y su vinculo con la compra, y deja la
-- linea de la factura que la vendio apuntando a un serial inexistente. El
-- codigo no podia distinguir los dos casos porque la retoma no guardaba ni cual
-- serial toco ni si lo habia reactivado.
--
--   serial_id       -> a que unidad entro. ON DELETE SET NULL: si alguien borra
--                      el serial, la retoma sigue siendo historia valida.
--   reactivado      -> si fue mi propio equipo que volvio. Es una MARCA
--                      EXPLICITA, no se deduce: "el IMEI ya existia" tambien es
--                      verdad de un re-import correctivo.
--   estado_anterior -> lo que la retoma piso, para devolverlo tal cual al
--                      anular. NO es derivable de ningun lado: es justo lo que
--                      el UPDATE esta a punto de sobrescribir.
--
-- Va en JSONB y no en seis columnas porque nada de ahi dentro se consulta, se
-- suma ni se filtra: se escribe entero al retomar y se lee entero al anular.
-- Seis columnas serian seis ALTER mas el dia que el reingreso toque un campo
-- mas. Es el mismo criterio de borradores.datos: un blob opaco que el resto del
-- backend no interpreta.
--
-- ── Que NO cambia ───────────────────────────────────────────────────────────
-- Nada para las retomas ya registradas: nacen todas con reactivado = FALSE y
-- estado_anterior NULL, que es exactamente como se comporta el codigo viejo.
-- Los equipos ya reingresados con el costo antiguo se quedan como estan — se
-- decidio no hacer backfill, porque reescribir el costo de una unidad que
-- quiza ya se revendio cambiaria la utilidad de una venta ya reportada.
--
-- Sin estas columnas (migracion no aplicada) el reingreso sigue funcionando y
-- lo unico que se pierde es poder deshacerlo bien — igual que hoy. La bandera
-- hayRetomaReingreso() en src/config/columnas.js es la que lo decide.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS retomas
  ADD COLUMN IF NOT EXISTS serial_id INTEGER REFERENCES seriales(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS retomas
  ADD COLUMN IF NOT EXISTS reactivado BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS retomas
  ADD COLUMN IF NOT EXISTS estado_anterior JSONB;

-- Anular una retoma parte de la retoma, nunca del IMEI: buscar por IMEI es lo
-- que hacia el codigo viejo y por eso podia alcanzar la fila equivocada.
CREATE INDEX IF NOT EXISTS idx_retomas_serial
  ON retomas (serial_id) WHERE serial_id IS NOT NULL;
