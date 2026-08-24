// ─────────────────────────────────────────────────────────────────────────────
// EL COSTO DE UNA UNIDAD SEGÚN DÓNDE ESTÉ PARADA — fragmentos SQL compartidos.
//
// En un negocio con red interna conviven DOS verdades de costo, y las dos son
// correctas:
//
//   · `seriales.costo_compra`      → lo que el NEGOCIO le pagó a un proveedor
//                                    externo. Es la verdad de la BODEGA y del
//                                    margen consolidado del grupo. Nunca se
//                                    reescribe al remisionar, a propósito.
//   · `lineas_remision.valor_interno` → lo que la BODEGA le cobra al LOCAL. Es
//                                    el costo del local: lo que tendrá que
//                                    liquidar cuando venda.
//
// La mercancía por CANTIDAD no necesita nada de esto: al recibir, la remisión
// reescribe el `costo_unitario` de la hoja con el promedio ponderado sobre
// `valor_interno`, así que quien lee esa columna ya ve el costo del local. Los
// SERIALES sí, porque `moverSerial` solo cambia `producto_id`.
//
// Todo lo de aquí son fragmentos de SQL que se interpolan en consultas más
// grandes. NO reciben entrada de usuario: los argumentos son nombres de alias
// que escribe el llamador (`'l.imei'`, `'f.sucursal_id'`). Nunca pasar aquí un
// valor que venga del request — va como parámetro `$n` de la consulta.
//
// EL OPT-IN ES ESTRUCTURAL, no un flag: si el negocio no usa la red no hay
// filas en `lineas_remision`, las subconsultas dan NULL y todo cae al costo de
// siempre. Por eso ningún consumidor necesita leer `config_negocio` — meter esa
// lectura aquí acoplaría el módulo y castigaría a los negocios sin red.
// ─────────────────────────────────────────────────────────────────────────────

// `r.tipo = 'entrega'` es lo que excluye a la BODEGA: las entregas van
// bodega → local, y en una devolución el destino es ella, que debe seguir
// usando su propio costo de compra. Perder ese filtro haría que la bodega se
// valorara a sí misma al precio que le cobra a sus locales.
const _ENTREGA_VIVA = `
        r.tipo    = 'entrega'
    AND r.estado <> 'Anulada'
    AND lr.estado_linea = 'Recibida'
    AND lr.valor_interno IS NOT NULL`;

/**
 * Valor interno de la entrega con la que esta unidad llegó al local, para una
 * venta YA OCURRIDA.
 *
 * Se toma la entrega más reciente ANTERIOR a la venta: una misma unidad puede
 * haberse enviado, devuelto y vuelto a enviar con otro valor.
 *
 * El cruce va por IMEI y no por `serial_id` porque quien llama parte de
 * `lineas_factura`, que no guarda el id. Acotarlo a la sucursal destino y a la
 * fecha es lo que evita el fan-out del IMEI (un mismo IMEI tiene varias filas
 * históricas en `seriales`).
 *
 * Devuelve NULL cuando no aplica (negocio sin red, unidad propia del local,
 * retoma): el llamador cae entonces a `costo_compra`, que ahí sí es lo correcto.
 */
const sqlValorInternoPorImei = (imeiAlias, sucursalAlias, fechaAlias = null) => `
    (
      SELECT lr.valor_interno
      FROM lineas_remision lr
      JOIN remisiones r ON r.id = lr.remision_id
      WHERE r.sucursal_destino_id = ${sucursalAlias}
        AND ${_ENTREGA_VIVA}
        AND lr.tipo = 'serial'
        AND UPPER(TRIM(lr.imei)) = UPPER(TRIM(${imeiAlias}))
        ${fechaAlias ? `AND r.fecha_emision <= ${fechaAlias}` : ''}
      ORDER BY r.fecha_emision DESC, lr.id DESC
      LIMIT 1
    )`;

/**
 * Costo de una unidad vendida, resuelto en cascada:
 *   valor interno de la remisión → costo de compra propio → promedio del
 *   producto en esa sucursal → 0.
 */
const sqlCostoPorImei = (imeiAlias, sucursalAlias, fechaAlias = null) => `
  COALESCE(
    ${sqlValorInternoPorImei(imeiAlias, sucursalAlias, fechaAlias)},
    (
      SELECT s.costo_compra
      FROM seriales s
      JOIN productos_serial ps ON ps.id = s.producto_id
      WHERE s.imei = ${imeiAlias}
        AND ps.sucursal_id = ${sucursalAlias}
      LIMIT 1
    ),
    (
      SELECT AVG(s2.costo_compra)
      FROM seriales s2
      JOIN productos_serial ps2 ON ps2.id = s2.producto_id
      JOIN seriales s3 ON s3.imei = ${imeiAlias}
      WHERE s2.producto_id = s3.producto_id
        AND ps2.sucursal_id = ${sucursalAlias}
        AND s2.costo_compra IS NOT NULL
    ),
    0
  )
`;

/**
 * Valor interno de una unidad que TODAVÍA ESTÁ EN EL LOCAL (stock sin vender).
 *
 * Es el gemelo de `sqlValorInternoPorImei` para valorizar inventario, y se
 * diferencia en dos cosas:
 *
 *   · cruza por `serial_id` —quien valoriza parte de `seriales`, donde el id sí
 *     existe— así que no hay fan-out de IMEI que evitar;
 *   · no hay fecha de venta contra la cual comparar, y en su lugar exige que la
 *     unidad NO se haya facturado en esa sucursal después de la entrega. Sin esa
 *     condición, un equipo vendido y devuelto en retoma —que ya es del local,
 *     no de la bodega— seguiría valorándose como consignado. Es la misma regla
 *     con la que `getValorConsignacionSeriales` alimenta las tarifas, y se
 *     corrige sola: si esa factura se cancela, la unidad vuelve a ser de bodega.
 */
const sqlValorInternoEnStock = (serialIdAlias, sucursalAlias) => `
    (
      SELECT lr.valor_interno
      FROM lineas_remision lr
      JOIN remisiones r ON r.id = lr.remision_id
      WHERE r.sucursal_destino_id = ${sucursalAlias}
        AND ${_ENTREGA_VIVA}
        AND lr.tipo = 'serial'
        AND lr.serial_id = ${serialIdAlias}
        AND NOT EXISTS (
          SELECT 1
          FROM lineas_factura lf
          JOIN facturas f ON f.id = lf.factura_id
          WHERE UPPER(TRIM(lf.imei)) = UPPER(TRIM(lr.imei))
            AND f.sucursal_id = r.sucursal_destino_id
            AND f.estado     <> 'Cancelada'
            AND f.fecha      >= r.fecha_emision
        )
      ORDER BY r.fecha_emision DESC, lr.id DESC
      LIMIT 1
    )`;

module.exports = {
  sqlValorInternoPorImei,
  sqlCostoPorImei,
  sqlValorInternoEnStock,
};
