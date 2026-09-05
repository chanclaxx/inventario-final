-- ─────────────────────────────────────────────────────────────────────────────
-- PEDIDO DETALLADO — pedir la VARIANTE, conciliarla al recibir, corregir sin
-- rehacer.
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
-- Una orden pide "100 cargadores", no "50 de 25W y 50 de 20W". Al llegar, el
-- bodeguero reparte por variante contra una expectativa que no existe, y de ahi
-- salen tres mentiras silenciosas:
--
--   * si el proveedor manda 20W donde se pidio 25W, la recepcion lo atribuye a
--     la linea del 25W y la orden se marca cumplida. El inventario queda bien;
--     el pedido queda mintiendo, y nadie se entera nunca de que ese proveedor
--     manda otra cosa;
--   * si llegan de mas, _validarRecepcionContraOrden responde 400 y manda a
--     "registrarlas como compra aparte" — mientras la pantalla del bodeguero le
--     dice que el sobrante "queda anotado en la entrada". Una de las dos miente;
--   * si el bodeguero se equivoca de talla, su unica salida es cancelar la
--     entrada COMPLETA y volver a teclearla.
--
-- ── Lo que esta migracion NO crea ───────────────────────────────────────────
-- Ni una columna en lineas_orden_compra ni una en lineas_compra. El nodo pedido
-- YA existe (variante_id / atributo_id, migracion 20260806): las columnas
-- estaban, las leian cuatro consultas, y ningun frontend las escribia jamas. No
-- hay modelo nuevo que inventar; hay un cable suelto que conectar.
--
-- Y las dos nociones nuevas se DERIVAN, igual que el avance de la orden, la
-- deuda de la red interna y lo pendiente de mora:
--
--   SUSTITUCION = la linea de la orden trae nodo Y la de la recepcion trae otro.
--   EXCESO      = recibida - cantidad_pedida, cuando es positivo.
--
-- Guardarlas seria abrir la misma puerta que ya se cerro en todas partes:
-- cancelar una recepcion o devolver unidades jamas iria a corregir un contador,
-- y ese contador quedaria contando algo que ya no existe.
--
-- Que el usuario lo haya CONFIRMADO tampoco necesita columna: sin el flag
-- explicito en la peticion, el backend responde 409. Que la fila exista ya
-- prueba que alguien dijo que si.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Dos novedades mas del proveedor
-- ═══════════════════════════════════════════════════════════════════════════
--
-- novedades_proveedor ya existe, ya es append-only y —lo importante— ya cuelga
-- del PROVEEDOR y no de la orden. Ahi es donde el dueno va a ver "este proveedor
-- siempre me cambia las caracteristicas", que es la pregunta que de verdad
-- importa. Un log nuevo para esto habria partido esa historia en dos.
--
-- El DO es por si el negocio nunca aplico 20260806: sin la tabla, esto no hace
-- nada en vez de abortar la migracion entera.
DO $$
BEGIN
  IF to_regclass('public.novedades_proveedor') IS NOT NULL THEN
    ALTER TABLE novedades_proveedor DROP CONSTRAINT IF EXISTS novedades_proveedor_tipo_chk;
    ALTER TABLE novedades_proveedor ADD  CONSTRAINT novedades_proveedor_tipo_chk
      CHECK (tipo IN ('faltante', 'demora', 'garantia', 'acuerdo', 'cierre', 'nota',
                      'sustitucion', 'exceso', 'no_pedido'));
  END IF;
END $$;

-- Los tres desenlaces que se salen del guion de la orden:
--
--   sustitucion → se pidio 25W y llego 20W (misma linea, otro nodo)
--   exceso      → se pidieron 50 y llegaron 60 de LO MISMO
--   no_pedido   → llego una variante que no estaba en la orden. Se pidieron 50
--                 blancos y 50 verdes, y ademas llegaron 20 rosados: no es
--                 sustitucion (nadie dejo de mandar lo pedido) ni exceso de una
--                 linea (no hay linea de rosado contra la cual excederse). Es su
--                 propia pregunta —"¿que me manda este proveedor que yo no pedi?"—
--                 y con un solo tipo para las dos cosas no se podria responder.
--
-- Que nodo llego cuando no fue el que se pidio. Van en la novedad y no en la
-- linea de compra porque la linea de compra ya dice que llego: lo que no tenia
-- donde vivir es la RELACION entre lo pedido y lo recibido.
--
-- Las dos etiquetas van CONGELADAS, no unidas: si manana renombran la talla, un
-- JOIN reescribiria el pasado y la novedad diria que el proveedor mando algo que
-- nunca se llamo asi. Mismo criterio que movimientos_ubicacion.desde_nombre.
ALTER TABLE IF EXISTS novedades_proveedor
  ADD COLUMN IF NOT EXISTS orden_linea_id BIGINT REFERENCES lineas_orden_compra(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS novedades_proveedor
  ADD COLUMN IF NOT EXISTS pedido_etiqueta   TEXT;
ALTER TABLE IF EXISTS novedades_proveedor
  ADD COLUMN IF NOT EXISTS recibido_etiqueta TEXT;

CREATE INDEX IF NOT EXISTS idx_novedades_proveedor_orden_linea
  ON novedades_proveedor (orden_linea_id) WHERE orden_linea_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Bitacora de correcciones de una entrada
-- ═══════════════════════════════════════════════════════════════════════════
--
-- "Corregi esto y se dano el inventario, y no hay como rastrearlo" es el unico
-- desenlace inaceptable de poder corregir. Por eso la correccion y su bitacora
-- son la MISMA transaccion: aqui el log no es un extra que pueda fallar aparte,
-- es la mitad de la operacion.
--
-- Eso es lo contrario de movimientos_ubicacion, y a proposito: alla el log
-- cuelga de mover una caja, que es la operacion diaria de un modulo que ya
-- estaba en produccion, y por eso se consulta la bandera ANTES de insertar. Aca
-- la operacion NUEVA es la correccion entera: sin la tabla el endpoint no existe
-- (hayCorreccionesEntrada() en columnas.js lo apaga) y no se pierde nada que hoy
-- funcione. Ninguna recepcion normal toca esta tabla.
--
-- ── Todo va CONGELADO ───────────────────────────────────────────────────────
-- El nombre del producto y la etiqueta del nodo se copian, no se unen, por la
-- misma razon que arriba. usuario_id SI se une —quien es una persona es un dato
-- vivo—, igual que en movimientos_ubicacion.
CREATE TABLE IF NOT EXISTS correcciones_entrada (
  id               BIGSERIAL  PRIMARY KEY,
  negocio_id       INTEGER    NOT NULL REFERENCES negocios(id) ON DELETE RESTRICT,
  compra_id        INTEGER    NOT NULL,

  -- NULL-able: una correccion que ELIMINA la linea la deja sin id al que
  -- apuntar. La bitacora tiene que sobrevivir a lo que describe.
  linea_id         BIGINT,

  accion           TEXT       NOT NULL,

  producto_id      INTEGER,
  nombre_producto  TEXT,

  antes_cantidad   INTEGER,
  despues_cantidad INTEGER,

  antes_variante_id   INTEGER,
  antes_atributo_id   INTEGER,
  despues_variante_id INTEGER,
  despues_atributo_id INTEGER,

  -- Como se llamaba el nodo en el momento de la correccion.
  antes_etiqueta   TEXT,
  despues_etiqueta TEXT,

  antes_imei       TEXT,
  despues_imei     TEXT,

  motivo           TEXT,
  usuario_id       INTEGER,
  fecha            TIMESTAMP  NOT NULL DEFAULT NOW(),

  CONSTRAINT correcciones_entrada_accion_chk
    CHECK (accion IN ('cantidad', 'nodo', 'imei', 'agregar', 'quitar'))
);

-- La consulta es siempre la misma: la historia de ESTA entrada, lo mas reciente
-- primero.
CREATE INDEX IF NOT EXISTS idx_correcciones_entrada_compra
  ON correcciones_entrada (compra_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_correcciones_entrada_negocio
  ON correcciones_entrada (negocio_id, fecha DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- Configuracion (NO requiere migracion: config_negocio es clave-valor)
-- ═══════════════════════════════════════════════════════════════════════════
--   ordenes_compra_detalle_nodo  '1' | '0'   (default APAGADO)
--       Enciende el selector de variante en la orden y la conciliacion por nodo
--       al recibir. Apagado, las ordenes se siguen pidiendo por producto y todo
--       se comporta EXACTAMENTE como hoy — que es lo que tienen los 28 negocios.
--
--       Ojo: el interruptor habilita la CAPACIDAD, no la obliga. Una misma orden
--       mezcla lineas al nodo y lineas al producto, porque el nodo en NULL ya
--       significa hoy "el producto en general" y esa lectura no cambia.
-- ═══════════════════════════════════════════════════════════════════════════


-- Rollback manual (si algun dia se necesita):
--   DROP TABLE IF EXISTS correcciones_entrada;
--   ALTER TABLE novedades_proveedor DROP COLUMN IF EXISTS orden_linea_id;
--   ALTER TABLE novedades_proveedor DROP COLUMN IF EXISTS pedido_etiqueta;
--   ALTER TABLE novedades_proveedor DROP COLUMN IF EXISTS recibido_etiqueta;
--   -- El CHECK de tipo se deja: quitarle 'sustitucion' y 'exceso' con filas de
--   -- esos tipos ya escritas haria fallar el ALTER.
