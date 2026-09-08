// ─────────────────────────────────────────────────────────────────────────────
// EL REINGRESO DE UNA UNIDAD RETOMADA — una sola verdad para las cuatro rutas.
//
// Retomar un equipo con IMEI se hace desde cuatro sitios: la venta con retoma,
// la edición de esa factura, el intercambio contra un préstamo y la retoma
// directa. Los cuatro tenían el mismo bloque copiado, y los cuatro se habían
// separado:
//
//   · factura      → serial nuevo con `costo_compra`; al reactivar, ni costo ni
//                    fecha ni precio.
//   · préstamos    → serial nuevo con `precio` = valor de la retoma y SIN costo;
//                    al reactivar, otra vez `precio`.
//
// O sea que lo que pagaste acababa en el costo, en el precio de venta o en
// ninguno de los dos según por qué pantalla hubieras entrado.
//
// ── La regla ────────────────────────────────────────────────────────────────
// UNA UNIDAD QUE VUELVE ES UNA UNIDAD QUE ENTRA. Da igual que sea mi propio
// equipo o uno ajeno, y da igual que el sistema resuelva creando una fila o
// reactivando la que ya tenía: los campos que describen "cómo entró esto" se
// escriben con los datos de HOY.
//
//   costo_compra  = lo que estoy pagando por él ahora
//   fecha_entrada = hoy
//   proveedor_id  = NULL (no vino de un proveedor, vino de un cliente)
//   producto_id   = la referencia que eligió el usuario
//
// No es una regla nueva: es la que ya aplica la compra a proveedor cuando
// reactiva un serial (compras.service.js). Lo nuevo es que la retoma la
// cumpla también.
//
// ── Por qué el costo importa tanto ──────────────────────────────────────────
// La utilidad de una venta con IMEI se calcula contra `seriales.costo_compra`
// (utils/costoRed.util.js). Vendo en 800.000 algo que me costó 600.000, lo
// retomo por 400.000 y lo revendo en 500.000: con el costo viejo el sistema
// reporta 500.000 − 600.000 = −100.000 y ese producto "da pérdida" para
// siempre.
//
// ── El precio de venta NO se toca salvo que lo manden ───────────────────────
// Antes, préstamos escribía `precio = valor_retoma`: el precio de venta del
// usado quedaba en lo que acababas de pagar por él, o sea revenderlo con cero
// utilidad. Y dejarlo intacto tampoco sirve, porque el usado se quedaría
// ofrecido al precio de nuevo. La única salida honesta es que lo decida una
// persona, así que llega en `precio_venta` y sin él el precio no se cambia.
//
// ── Qué se guarda para poder deshacer ───────────────────────────────────────
// Anular una retoma hacía `DELETE FROM seriales`. Sobre una reactivación eso no
// borra "lo que la retoma creó": borra la unidad ORIGINAL, con su costo, su
// proveedor y su vínculo con la compra, y deja la línea de la factura que la
// vendió apuntando a un serial que ya no existe. Por eso el reingreso devuelve
// un `rastro` con a qué serial entró, si lo reactivó y qué valores pisó, que el
// llamador guarda en la retoma y `revertirIngresoSerial` usa para volver atrás.
// ─────────────────────────────────────────────────────────────────────────────

const { hayRetomaReingreso } = require('../config/columnas');

// Los campos que el reingreso sobrescribe. La lista es la MISMA en el snapshot
// y en la restauración a propósito: si se separan, anular dejaría alguno con el
// valor de la retoma. Cualquier campo que se agregue al UPDATE va aquí.
const CAMPOS_PISADOS = [
  'producto_id', 'costo_compra', 'precio', 'fecha_entrada', 'fecha_salida',
  'proveedor_id', 'cliente_origen', 'color', 'caracteristicas', 'vendido', 'prestado',
];

const _hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Solo un objeto plano con al menos un valor no vacío. Cualquier otra cosa
// (null, string, array, objeto vacío) devuelve null, para que el COALESCE del
// UPDATE conserve las características que la unidad ya tenía.
const caracteristicasJson = (valor) => {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const limpio = {};
  for (const [k, v] of Object.entries(valor)) {
    const texto = String(v ?? '').trim();
    if (texto) limpio[k] = texto;
  }
  return Object.keys(limpio).length ? JSON.stringify(limpio) : null;
};

/**
 * Todas las filas de ese IMEI en el negocio. Son varias a propósito: el índice
 * es UNIQUE (imei, producto_id), así que el mismo aparato puede tener historia
 * en más de una referencia (se vendió como "iPhone 11" y antes existió como
 * "iPhone 11 usado"). Traerlas todas y decidir en JS es lo que permite elegir
 * la del producto destino en vez de chocar contra el índice al mover.
 */
const _filasDelImei = async (client, imei, negocioId) => {
  const { rows } = await client.query(
    `SELECT s.id, s.vendido, s.prestado, s.producto_id, s.costo_compra, s.precio,
            -- Como TEXTO, no como DATE: node-postgres devuelve un DATE como
            -- objeto Date, y el viaje a JSON y de vuelta lo hace depender de la
            -- zona del servidor (UTC en Railway). Restaurar una fecha corrida un
            -- día es justo el error que ya mordió dos veces en mora.
            to_char(s.fecha_entrada, 'YYYY-MM-DD') AS fecha_entrada,
            to_char(s.fecha_salida,  'YYYY-MM-DD') AS fecha_salida,
            s.proveedor_id, s.cliente_origen,
            s.color, s.caracteristicas, ps.sucursal_id
     FROM seriales s
     JOIN productos_serial ps ON ps.id = s.producto_id
     JOIN sucursales       su ON su.id = ps.sucursal_id
     WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2
     ORDER BY s.id DESC`,
    [imei, negocioId]
  );
  return rows;
};

const _errorPrestado = (imei) => ({
  status: 409,
  code: 'IMEI_PRESTADO',
  message: `El IMEI ${imei} está prestado. Ve a la pestaña de Préstamos y regístralo como devuelto para que regrese al inventario; no se puede ingresar como retoma.`,
});

const _errorDisponible = (imei) => ({
  status: 409,
  message: `El IMEI ${imei} ya está registrado y disponible en el inventario.`,
});

/**
 * Ingresa al inventario la unidad con IMEI que entra por una retoma.
 *
 * Reactiva la fila que ya existe si el equipo es uno que este negocio vendió; si
 * no, crea una. En los dos casos escribe los datos de HOY.
 *
 * @param client              cliente en transacción (obligatorio)
 * @param negocioId
 * @param sucursalId          sucursal donde ocurre la retoma; acota a qué
 *                            referencias puede entrar
 * @param imei
 * @param productoSerialId    la referencia elegida. Al reactivar MUEVE la
 *                            unidad hasta ahí — es lo que permite recibir un
 *                            equipo propio como "usado" en vez de devolverlo a
 *                            la referencia de nuevo.
 * @param valorRetoma         lo que se está pagando por él → costo_compra
 * @param precioVenta         opcional; sin él no se toca el precio de venta
 * @param clienteOrigen       de quién viene
 * @param color, caracteristicas
 * @param reactivarSerialId   opcional; el id que el frontend ya resolvió. Se
 *                            valida igual, nunca se cree a ciegas.
 *
 * @returns {{ serialId, reactivado, estadoAnterior }} el rastro para deshacer
 */
const ingresarSerialRetomado = async (client, {
  negocioId, sucursalId, imei, productoSerialId, valorRetoma,
  precioVenta = null, clienteOrigen = null, color = null, caracteristicas = null,
  reactivarSerialId = null,
}) => {
  const imeiLimpio = String(imei || '').trim();
  if (!imeiLimpio) throw { status: 400, message: 'IMEI requerido para ingresar la retoma' };

  const colorFinal = color?.trim?.() || color || null;
  const caractJson = caracteristicasJson(caracteristicas);
  const costo      = Number(valorRetoma) > 0 ? Number(valorRetoma) : null;
  const precio     = Number(precioVenta) > 0 ? Number(precioVenta) : null;

  // La referencia destino tiene que ser de ESTA sucursal. Sin esta validación,
  // un `producto_serial_id` de otra sede movería el equipo a un inventario que
  // no es donde está el aparato.
  let destinoId = null;
  if (productoSerialId) {
    const { rows } = await client.query(
      `SELECT ps.id FROM productos_serial ps
       JOIN sucursales su ON su.id = ps.sucursal_id
       WHERE ps.id = $1 AND su.negocio_id = $2
         AND ($3::int IS NULL OR ps.sucursal_id = $3)`,
      [productoSerialId, negocioId, sucursalId ?? null]
    );
    if (!rows.length) {
      throw { status: 403, message: 'El producto de retoma no pertenece a esta sucursal' };
    }
    destinoId = rows[0].id;
  }

  const filas = await _filasDelImei(client, imeiLimpio, negocioId);

  // Un equipo prestado no se retoma: tiene que volver por Préstamos, que es
  // quien sabe cerrar esa obligación. Y uno disponible ya está adentro.
  if (filas.some((f) => f.prestado)) throw _errorPrestado(imeiLimpio);
  if (filas.some((f) => !f.vendido))  throw _errorDisponible(imeiLimpio);

  if (reactivarSerialId && !filas.some((f) => f.id === Number(reactivarSerialId))) {
    throw { status: 403, message: 'El serial a reactivar no pertenece a este negocio' };
  }

  // Con `reactivarSerialId` manda la fila que el frontend resolvió. Si no, la
  // del producto destino — así mover no choca contra UNIQUE (imei, producto_id)
  // cuando ese IMEI ya tuvo historia ahí — y en última instancia la más
  // reciente.
  const existente =
    (reactivarSerialId && filas.find((f) => f.id === Number(reactivarSerialId)))
    || (destinoId && filas.find((f) => f.producto_id === destinoId))
    || filas[0]
    || null;

  if (existente) {
    // Lo que este UPDATE está a punto de pisar. Se guarda ANTES de tocarlo:
    // después ya no hay de dónde sacarlo.
    const estadoAnterior = {};
    for (const campo of CAMPOS_PISADOS) estadoAnterior[campo] = existente[campo] ?? null;

    await client.query(
      `UPDATE seriales
       SET vendido         = false,
           prestado        = false,
           fecha_salida    = NULL,
           producto_id     = COALESCE($1, producto_id),
           costo_compra    = COALESCE($2, costo_compra),
           fecha_entrada   = $3,
           proveedor_id    = NULL,
           precio          = COALESCE($4, precio),
           cliente_origen  = $5,
           color           = COALESCE($6, color),
           caracteristicas = COALESCE($7::jsonb, caracteristicas)
       WHERE id = $8`,
      [destinoId, costo, _hoy(), precio, clienteOrigen, colorFinal, caractJson, existente.id]
    );

    return { serialId: existente.id, reactivado: true, estadoAnterior, ingresado: true };
  }

  // Sin fila previa y sin referencia elegida no hay dónde meter el equipo. NO se
  // lanza: hasta hoy este caso pasaba en silencio y la retoma quedaba grabada
  // diciendo `ingreso_inventario = true` sin haber ingresado nada. Devolverlo
  // como `ingresado: false` deja que el llamador grabe la verdad —la retoma se
  // registra, el ingreso no— sin bloquear una venta que hoy sí se cierra.
  if (!destinoId) {
    return { serialId: null, reactivado: false, estadoAnterior: null, ingresado: false };
  }

  const { rows } = await client.query(
    `INSERT INTO seriales
       (producto_id, imei, fecha_entrada, costo_compra, precio, cliente_origen,
        color, caracteristicas, vendido, prestado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, false, false)
     RETURNING id`,
    [destinoId, imeiLimpio, _hoy(), costo, precio, clienteOrigen, colorFinal, caractJson]
  );

  return { serialId: rows[0].id, reactivado: false, estadoAnterior: null, ingresado: true };
};

/**
 * Deshace lo que hizo `ingresarSerialRetomado`.
 *
 * Una unidad REACTIVADA no se borra: vuelve a como estaba, vendida y con su
 * costo original. Una unidad que la retoma CREÓ sí se borra, porque sin la
 * retoma no existiría.
 *
 * Sin rastro (una retoma anterior a esta migración, o la migración sin aplicar)
 * se cae al comportamiento de siempre — borrar la fila disponible de ese IMEI —,
 * pero acotado al NEGOCIO: la consulta vieja buscaba `WHERE imei = $1` a secas,
 * y en una base compartida por 28 negocios eso puede alcanzar la fila de otro.
 *
 * @returns {'restaurado'|'eliminado'|'sin_cambio'} qué se hizo
 */
const revertirIngresoSerial = async (client, {
  negocioId, imei, serialId = null, reactivado = false, estadoAnterior = null,
}) => {
  if (reactivado && serialId && estadoAnterior) {
    const { rowCount } = await client.query(
      `UPDATE seriales
       SET vendido         = COALESCE($1, true),
           prestado        = COALESCE($2, false),
           producto_id     = COALESCE($3, producto_id),
           costo_compra    = $4,
           precio          = $5,
           fecha_entrada   = COALESCE($6, fecha_entrada),
           fecha_salida    = $7,
           proveedor_id    = $8,
           cliente_origen  = $9,
           color           = $10,
           caracteristicas = $11::jsonb
       WHERE id = $12`,
      [
        estadoAnterior.vendido, estadoAnterior.prestado, estadoAnterior.producto_id,
        estadoAnterior.costo_compra ?? null, estadoAnterior.precio ?? null,
        estadoAnterior.fecha_entrada, estadoAnterior.fecha_salida ?? null,
        estadoAnterior.proveedor_id ?? null, estadoAnterior.cliente_origen ?? null,
        estadoAnterior.color ?? null,
        estadoAnterior.caracteristicas ? JSON.stringify(estadoAnterior.caracteristicas) : null,
        serialId,
      ]
    );
    return rowCount ? 'restaurado' : 'sin_cambio';
  }

  // La retoma creó la fila: se borra. Se exige que siga disponible — si ya se
  // vendió o se prestó, quien la tiene es otro documento y borrarla se llevaría
  // por delante esa historia.
  const idBuscado = serialId ?? null;
  const { rows } = await client.query(
    `SELECT s.id FROM seriales s
     JOIN productos_serial ps ON ps.id = s.producto_id
     JOIN sucursales       su ON su.id = ps.sucursal_id
     WHERE su.negocio_id = $1
       AND s.vendido = false AND s.prestado = false
       AND (($2::int IS NOT NULL AND s.id = $2)
            OR ($2::int IS NULL AND UPPER(TRIM(s.imei)) = UPPER(TRIM($3))))
     LIMIT 1`,
    [negocioId, idBuscado, String(imei || '').trim()]
  );
  if (!rows.length) return 'sin_cambio';

  await client.query('DELETE FROM seriales WHERE id = $1', [rows[0].id]);
  return 'eliminado';
};

/**
 * El rastro, listo para `insertarRetoma`. Devuelve un objeto vacío cuando la
 * migración no está aplicada, para que el INSERT no nombre columnas que no
 * existen: guardar el rastro es un extra, retomar es la operación diaria.
 */
const rastroParaRetoma = (rastro) => {
  if (!rastro || !hayRetomaReingreso()) return {};
  return {
    serial_id:       rastro.serialId ?? null,
    reactivado:      !!rastro.reactivado,
    estado_anterior: rastro.estadoAnterior ? JSON.stringify(rastro.estadoAnterior) : null,
  };
};

module.exports = {
  ingresarSerialRetomado, revertirIngresoSerial, rastroParaRetoma,
  caracteristicasJson, CAMPOS_PISADOS,
};
