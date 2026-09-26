// ─────────────────────────────────────────────────────────────────────────────
// DE QUIÉN VINO UNA RETOMA — una sola lectura para todas las pantallas.
//
// Una fila de `retomas` nace por tres puertas y cada una guarda a la persona en
// un sitio distinto:
//
//   · factura   → `factura_id`: el cliente está en la factura (nombre, cédula y
//                 celular copiados) y en `clientes` si se eligió de la lista.
//   · préstamo  → `prestamo_id`: el equipo lo entregó quien tenía el préstamo;
//                 la ficha es el prestatario (compañero) o el cliente.
//   · directa   → ni factura ni préstamo: `tipo_persona` + `persona_id`.
//
// La búsqueda por IMEI y la pestaña Retomas de Proveedores leían SOLO la
// primera (`JOIN facturas`), así que una retoma hecha desde Préstamos no
// aparecía en la línea de tiempo del equipo, y en Proveedores salía como
// «Compra a cliente» sin cédula. Las dos consultas usan este fragmento para no
// volver a separarse.
//
// La sucursal sale de la puerta (factura / préstamo / la retoma misma) y el
// alcance de NEGOCIO lo pone quien consulta sobre `negocio_id` — que cae a la
// ficha de la persona cuando una retoma directa vieja no guardó sucursal.
// ─────────────────────────────────────────────────────────────────────────────

const JOINS_ORIGEN_RETOMA = `
  LEFT JOIN facturas     f   ON f.id   = r.factura_id
  LEFT JOIN clientes     cf  ON cf.id  = f.cliente_id
  LEFT JOIN prestamos    p   ON p.id   = r.prestamo_id
  LEFT JOIN prestatarios prp ON prp.id = p.prestatario_id
  LEFT JOIN clientes     cp  ON cp.id  = p.cliente_id
  LEFT JOIN prestatarios prd ON prd.id = r.persona_id
        AND r.factura_id IS NULL AND r.prestamo_id IS NULL AND r.tipo_persona = 'prestatario'
  LEFT JOIN clientes     cd  ON cd.id  = r.persona_id
        AND r.factura_id IS NULL AND r.prestamo_id IS NULL AND r.tipo_persona = 'cliente'
  LEFT JOIN sucursales   su  ON su.id  = COALESCE(f.sucursal_id, p.sucursal_id, r.sucursal_id)
  LEFT JOIN usuarios     ur  ON ur.id  = COALESCE(f.usuario_id, p.usuario_id)
`;

// NULLIF(…, '') en los textos copiados: una factura sin cédula la guarda como
// cadena vacía y el COALESCE se quedaría con ella en vez de ir a la ficha.
const COLUMNAS_ORIGEN_RETOMA = `
  CASE WHEN r.factura_id  IS NOT NULL THEN 'factura'
       WHEN r.prestamo_id IS NOT NULL THEN 'prestamo'
       ELSE 'directa' END                                            AS origen,
  COALESCE(f.numero, f.id)                                           AS factura_numero,
  f.id                                                               AS factura_id,
  COALESCE(p.numero, p.id)                                           AS prestamo_numero,
  p.id                                                               AS prestamo_id,
  COALESCE(f.fecha, r.fecha, p.fecha)                                AS fecha,
  to_char(COALESCE(f.fecha, r.fecha, p.fecha), 'YYYY-MM-DD')         AS dia,
  f.estado                                                           AS estado_factura,
  COALESCE(NULLIF(BTRIM(f.nombre_cliente), ''), cf.nombre,
           prp.nombre, cp.nombre, NULLIF(BTRIM(p.prestatario), ''),
           prd.nombre, cd.nombre)                                    AS nombre_cliente,
  COALESCE(NULLIF(BTRIM(f.cedula), ''), cf.cedula,
           prp.cedula, cp.cedula, NULLIF(BTRIM(p.cedula), ''),
           prd.cedula, cd.cedula)                                    AS cedula_cliente,
  COALESCE(NULLIF(BTRIM(f.celular), ''), cf.celular,
           prp.telefono, cp.celular, NULLIF(BTRIM(p.telefono), ''),
           prd.telefono, cd.celular)                                 AS celular_cliente,
  CASE WHEN prp.id IS NOT NULL OR prd.id IS NOT NULL
       THEN 'companero' ELSE 'cliente' END                           AS persona_tipo,
  su.id                                                              AS sucursal_id,
  su.nombre                                                          AS sucursal_nombre,
  ur.nombre                                                          AS usuario_nombre
`;

// El negocio de la fila. La sucursal manda; la ficha cubre la retoma directa
// sin sucursal (el estado de cuenta de Préstamos ya las admite así).
const NEGOCIO_RETOMA = 'COALESCE(su.negocio_id, prd.negocio_id, cd.negocio_id)';

module.exports = { JOINS_ORIGEN_RETOMA, COLUMNAS_ORIGEN_RETOMA, NEGOCIO_RETOMA };
