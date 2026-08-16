const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// BORRADORES DE VENTA
//
// El inventario NO se toca aquí. No hay UPDATE a `seriales` ni a
// `productos_cantidad.stock` en todo el archivo, y no debe haberlo: la reserva
// se DERIVA leyendo estas tablas, igual que la deuda de la red interna se
// deriva de las ventas. Un serial dentro de un borrador sigue vendido=false y
// sigue siendo vendible — el bloqueo es blando a propósito.
//
// ── Doble acotamiento, siempre ───────────────────────────────────────────────
// Toda consulta lleva `b.sucursal_id = $` Y `su.negocio_id = $`:
//   - negocio_id porque la BD es compartida por 28 negocios reales
//   - sucursal_id porque los borradores son POR SUCURSAL: los de Sansur no
//     existen para Principal
// El JOIN a sucursales no es decorativo; es lo que hace imposible que un id
// adivinado alcance el borrador de otro negocio.
// ─────────────────────────────────────────────────────────────────────────────

// Un borrador vencido no se lista y no reserva. Se filtra al leer en vez de
// barrerlo con un cron: sin proceso que mantener, y el borrador vuelve a la vida
// solo si alguien renueva su plazo.
const VIGENTE = `(b.expira_en IS NULL OR b.expira_en > NOW())`;

// Los ítems se traen agregados para no caer en N+1 al pintar la lista.
//
// El FILTER no es opcional: con LEFT JOIN, un borrador sin ítems produciría
// `[null]` en vez de `[]`, y el frontend intentaría leer `.nombre` de un null.
// Es la misma trampa del FILTER sobre LEFT JOIN que ya documentó procedencia.
const ITEMS_JSON = `
  COALESCE(
    json_agg(
      json_build_object(
        'id',             i.id,
        'item_key',       i.item_key,
        'tipo',           i.tipo,
        'nombre',         i.nombre,
        'serial_id',      i.serial_id,
        'imei',           i.imei,
        'producto_id',    i.producto_id,
        'atributo_id',    i.atributo_id,
        'variante_id',    i.variante_id,
        'atributo_label', i.atributo_label,
        'variante_label', i.variante_label,
        'cantidad',       i.cantidad,
        'precio',         i.precio,
        'precio_final',   i.precio_final,
        'costo',          i.costo,
        'tarifa_id',      i.tarifa_id,
        'origen_precio',  i.origen_precio,
        'linea_id',       i.linea_id
      )
      ORDER BY i.id
    ) FILTER (WHERE i.id IS NOT NULL),
    '[]'
  ) AS items`;

// El total se DERIVA con SUM, nunca se guarda. Quitar un ítem para llevarlo a
// otro carrito tiene que bajarlo; un total guardado quedaría inflado contra un
// contenido que ya cambió — el mismo error que documenta el pago total al
// acreedor.
const TOTAL_SQL = `COALESCE(SUM(i.precio_final * i.cantidad), 0)::numeric AS total`;

const _selectBase = (extraWhere = '') => `
  SELECT b.id,
         b.sucursal_id,
         b.usuario_id,
         b.titulo,
         b.destino,
         b.nota,
         b.expira_en,
         b.creado_en,
         b.actualizado_en,
         u.nombre AS usuario_nombre,
         COUNT(i.id)::int AS num_items,
         ${TOTAL_SQL},
         ${ITEMS_JSON}
  FROM      borradores       b
  JOIN      sucursales       su ON su.id = b.sucursal_id
  LEFT JOIN usuarios         u  ON u.id  = b.usuario_id
  LEFT JOIN borradores_items i  ON i.borrador_id = b.id
  WHERE b.sucursal_id = $1
    AND su.negocio_id = $2
    ${extraWhere}
  GROUP BY b.id, u.nombre`;

// ── Lectura ──────────────────────────────────────────────────────────────────

const listar = async (sucursalId, negocioId) => {
  const { rows } = await pool.query(
    `${_selectBase(`AND ${VIGENTE}`)} ORDER BY b.creado_en DESC`,
    [sucursalId, negocioId]
  );
  return rows;
};

// Sin filtro de vigencia a propósito: si el vendedor abre un borrador vencido
// desde un enlace viejo, es mejor mostrárselo (y dejar que lo renueve) que
// decirle que no existe.
const obtener = async (id, sucursalId, negocioId) => {
  const { rows } = await pool.query(
    _selectBase('AND b.id = $3'),
    [sucursalId, negocioId, id]
  );
  return rows[0] || null;
};

// ── Escritura ────────────────────────────────────────────────────────────────

// `expira_en` se calcula EN SQL, nunca en JS.
//
// La BD corre con timezone America/Bogota y `NOW()` ya está en esa zona;
// construir la fecha con `new Date()` en Node la mezclaría con la zona del
// proceso (UTC en Railway) y el borrador vencería un día antes o después. Es la
// misma confusión de relojes que ya costó dos veces en mora.service.
//
// `dias = 0` significa "no vencen": expira_en queda NULL, que es lo que la
// consulta lee como "vive para siempre".
const EXPIRA_SQL = (idx) =>
  `CASE WHEN $${idx}::int > 0 THEN NOW() + ($${idx}::int || ' days')::interval ELSE NULL END`;

const crear = async ({ sucursalId, usuarioId, titulo, destino, nota, dias, items }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO borradores (sucursal_id, usuario_id, titulo, destino, nota, expira_en)
       VALUES ($1, $2, $3, $4, $5, ${EXPIRA_SQL(6)})
       RETURNING id`,
      [sucursalId, usuarioId, titulo, destino, nota, dias]
    );
    const borradorId = rows[0].id;

    await _insertarItems(client, borradorId, items);

    await client.query('COMMIT');
    return borradorId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// unnest en vez de N INSERTs: un carrito de 30 líneas es un solo viaje.
const _insertarItems = async (client, borradorId, items) => {
  if (!items.length) return;

  await client.query(
    `INSERT INTO borradores_items (
       borrador_id, item_key, tipo, nombre, serial_id, imei, producto_id,
       atributo_id, variante_id, atributo_label, variante_label, cantidad,
       precio, precio_final, costo, tarifa_id, origen_precio, linea_id
     )
     SELECT $1,
            u.item_key, u.tipo, u.nombre, u.serial_id, u.imei, u.producto_id,
            u.atributo_id, u.variante_id, u.atributo_label, u.variante_label,
            u.cantidad, u.precio, u.precio_final, u.costo, u.tarifa_id,
            u.origen_precio, u.linea_id
     FROM unnest(
       $2::text[],    $3::text[],    $4::text[],    $5::int[],
       $6::text[],    $7::int[],     $8::int[],     $9::int[],
       $10::text[],   $11::text[],   $12::int[],    $13::numeric[],
       $14::numeric[], $15::numeric[], $16::int[],  $17::text[],
       $18::int[]
     ) AS u(item_key, tipo, nombre, serial_id, imei, producto_id, atributo_id,
            variante_id, atributo_label, variante_label, cantidad, precio,
            precio_final, costo, tarifa_id, origen_precio, linea_id)`,
    [
      borradorId,
      items.map((i) => i.item_key),
      items.map((i) => i.tipo),
      items.map((i) => i.nombre),
      items.map((i) => i.serial_id),
      items.map((i) => i.imei),
      items.map((i) => i.producto_id),
      items.map((i) => i.atributo_id),
      items.map((i) => i.variante_id),
      items.map((i) => i.atributo_label),
      items.map((i) => i.variante_label),
      items.map((i) => i.cantidad),
      items.map((i) => i.precio),
      items.map((i) => i.precio_final),
      items.map((i) => i.costo),
      items.map((i) => i.tarifa_id),
      items.map((i) => i.origen_precio),
      items.map((i) => i.linea_id),
    ]
  );
};

/**
 * Actualiza la cabecera. Solo escribe los campos presentes en `campos`:
 * renombrar un borrador no puede borrarle la nota.
 */
const actualizar = async (id, sucursalId, negocioId, campos) => {
  const sets   = [];
  const params = [id, sucursalId, negocioId];

  for (const [col, valor] of Object.entries(campos)) {
    params.push(valor);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return false;

  const { rowCount } = await pool.query(
    `UPDATE borradores b
        SET ${sets.join(', ')}, actualizado_en = NOW()
       FROM sucursales su
      WHERE b.id = $1
        AND b.sucursal_id = $2
        AND su.id = b.sucursal_id
        AND su.negocio_id = $3`,
    params
  );
  return rowCount > 0;
};

/**
 * Renueva el plazo: el borrador que se sigue trabajando no debería vencerse.
 * Se llama al cargarlo al carrito.
 */
const renovar = async (id, sucursalId, negocioId, dias) => {
  const { rowCount } = await pool.query(
    `UPDATE borradores b
        SET expira_en = ${EXPIRA_SQL(4)}, actualizado_en = NOW()
       FROM sucursales su
      WHERE b.id = $1
        AND b.sucursal_id = $2
        AND su.id = b.sucursal_id
        AND su.negocio_id = $3`,
    [id, sucursalId, negocioId, dias]
  );
  return rowCount > 0;
};

// El acotamiento por sucursal aquí no es redundante: cierra el caso de cargar
// un borrador en Sansur, cambiar a Principal y facturar allá. Sin esta cláusula
// el borrador de Sansur —que nadie vendió— se borraría.
const eliminar = async (id, sucursalId, negocioId) => {
  const { rowCount } = await pool.query(
    `DELETE FROM borradores b
      USING sucursales su
      WHERE b.id = $1
        AND b.sucursal_id = $2
        AND su.id = b.sucursal_id
        AND su.negocio_id = $3`,
    [id, sucursalId, negocioId]
  );
  return rowCount > 0;
};

/**
 * Quita un ítem de un borrador — el "robo" para llevarlo a otro carrito.
 * Devuelve `{ borrado, restantes }` para que el service decida si el borrador
 * quedó vacío y hay que descartarlo.
 */
const eliminarItem = async (borradorId, itemId, sucursalId, negocioId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(
      `DELETE FROM borradores_items i
        USING borradores b, sucursales su
        WHERE i.id = $1
          AND i.borrador_id = $2
          AND b.id = i.borrador_id
          AND b.sucursal_id = $3
          AND su.id = b.sucursal_id
          AND su.negocio_id = $4`,
      [itemId, borradorId, sucursalId, negocioId]
    );

    if (!rowCount) {
      await client.query('ROLLBACK');
      return { borrado: false, restantes: null };
    }

    const { rows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM borradores_items WHERE borrador_id = $1',
      [borradorId]
    );
    const restantes = rows[0].n;

    await client.query('UPDATE borradores SET actualizado_en = NOW() WHERE id = $1', [borradorId]);
    await client.query('COMMIT');
    return { borrado: true, restantes };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Mantenimiento ────────────────────────────────────────────────────────────

// Días de gracia tras el vencimiento antes de borrar de verdad.
//
// El borrador vencido ya es invisible (VIGENTE lo filtra) y no reserva nada,
// así que borrarlo el mismo día no le ahorra nada a nadie y sí impide recuperar
// un dato si alguien se equivocó con la vigencia en Ajustes. Un mes de colchón
// no pesa: son dos tablas diminutas.
const DIAS_GRACIA = 30;

/**
 * Borra los borradores vencidos hace más de DIAS_GRACIA, de TODOS los negocios.
 *
 * Corre desde el job diario, así que no hay usuario ni sucursal que acotar —
 * es mantenimiento de la tabla, no una operación de negocio. Los ítems se van
 * en cascada.
 */
const purgarVencidos = async () => {
  const { rowCount } = await pool.query(
    `DELETE FROM borradores
      WHERE expira_en IS NOT NULL
        AND expira_en < NOW() - ($1 || ' days')::interval`,
    [DIAS_GRACIA]
  );
  return rowCount;
};

/**
 * Borradores que vencen dentro de `dias` días, agrupados por sucursal.
 * Alimenta el aviso push: si nadie los atiende, su mercancía se libera sola.
 */
const porVencer = async (negocioId, dias = 1) => {
  const { rows } = await pool.query(
    `SELECT b.sucursal_id,
            su.nombre                     AS sucursal_nombre,
            COUNT(*)::int                 AS cuantos,
            (ARRAY_AGG(b.titulo ORDER BY b.expira_en ASC))[1:3] AS ejemplos
       FROM borradores b
       JOIN sucursales su ON su.id = b.sucursal_id
      WHERE su.negocio_id = $1
        AND b.expira_en IS NOT NULL
        AND b.expira_en > NOW()
        AND b.expira_en <= NOW() + ($2 || ' days')::interval
      GROUP BY b.sucursal_id, su.nombre
      ORDER BY cuantos DESC`,
    [negocioId, dias]
  );
  return rows;
};

// ── Disponibilidad (revalidación al cargar) ──────────────────────────────────
//
// Se consulta en DOS viajes separados, uno por familia de producto, en vez de
// un UNION. No es capricho: unir seriales con productos_cantidad obliga a
// castear a mano los NULL de cada columna, y un `NULL::text` contra una columna
// que en producción es de otro tipo tumba la consulta entera. Ya pasó con
// `movimientos_acreedor.firma` (BYTEA en producción, TEXT en el fixture).
//
// Además, cada familia responde una pregunta distinta: el serial es unitario
// (está o no está), el producto por cantidad se mide contra su stock.

/** Estado actual de los seriales de un borrador, acotado a la sucursal. */
const estadoSeriales = async (serialIds, sucursalId, negocioId) => {
  if (!serialIds.length) return [];
  // `seriales` no tiene sucursal_id: la sucursal se resuelve por su producto.
  // Por eso el JOIN a productos_serial es obligatorio y no un adorno — sin él,
  // un traslado a otra sede pasaría desapercibido.
  // `marca` y `modelo` viajan de vuelta aunque el borrador no los guarde: el
  // JOIN a productos_serial ya está aquí, y el payload del traslado los lee
  // del ítem del carrito (ModalTraslado). Sin ellos, un traslado armado desde
  // un borrador cargado saldría sin marca ni modelo.
  const { rows } = await pool.query(
    `SELECT s.id, s.imei, s.vendido, s.prestado,
            ps.sucursal_id, ps.marca, ps.modelo
       FROM seriales        s
       JOIN productos_serial ps ON ps.id = s.producto_id
       JOIN sucursales       su ON su.id = ps.sucursal_id
      WHERE s.id = ANY($1::int[])
        AND su.negocio_id = $2`,
    [serialIds, negocioId]
  );
  return rows.map((r) => ({
    ...r,
    // Fuera de la sucursal del borrador la unidad no se puede vender aquí,
    // aunque siga viva en el negocio.
    en_sucursal: Number(r.sucursal_id) === Number(sucursalId),
  }));
};

/** Stock actual de los productos por cantidad de un borrador. */
const estadoProductosCantidad = async (productoIds, sucursalId, negocioId) => {
  if (!productoIds.length) return [];
  const { rows } = await pool.query(
    `SELECT pc.id, pc.stock, pc.activo
       FROM productos_cantidad pc
       JOIN sucursales         su ON su.id = pc.sucursal_id
      WHERE pc.id = ANY($1::int[])
        AND pc.sucursal_id = $2
        AND su.negocio_id  = $3`,
    [productoIds, sucursalId, negocioId]
  );
  return rows;
};

/** Stock de atributos y variantes (productos con árbol). */
const estadoAtributos = async (atributoIds, sucursalId) => {
  if (!atributoIds.length) return [];
  const { rows } = await pool.query(
    `SELECT id, stock FROM atributos_producto
      WHERE id = ANY($1::int[]) AND sucursal_id = $2`,
    [atributoIds, sucursalId]
  );
  return rows;
};

const estadoVariantes = async (varianteIds, sucursalId) => {
  if (!varianteIds.length) return [];
  const { rows } = await pool.query(
    `SELECT v.id, v.stock
       FROM variantes_atributo v
       JOIN atributos_producto a ON a.id = v.atributo_id
      WHERE v.id = ANY($1::int[]) AND a.sucursal_id = $2`,
    [varianteIds, sucursalId]
  );
  return rows;
};

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  renovar,
  eliminar,
  eliminarItem,
  purgarVencidos,
  porVencer,
  DIAS_GRACIA,
  estadoSeriales,
  estadoProductosCantidad,
  estadoAtributos,
  estadoVariantes,
};
