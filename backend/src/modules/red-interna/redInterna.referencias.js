// ─────────────────────────────────────────────────────────────────────────────
// RESOLUCIÓN DE REFERENCIAS ENTRE SUCURSALES
//
// El catálogo es POR SUCURSAL: el mismo producto es una fila distinta en cada
// sede. Al mover mercancía hay que decidir a qué fila del destino aterriza.
//
// PROBLEMA QUE RESUELVE: hacerlo solo por nombre exacto crea referencias
// duplicadas (una "iPad 10 64GB" nueva junto a la "iPad 10ma gen 64GB" que el
// local ya tenía) y, peor, la fila nueva nace SIN código: el lector no la
// encuentra y el producto queda inservible en el mostrador.
//
// CÓMO LO RESUELVE: una cascada de criterios, del más fuerte al más débil, que
// además dice CUÁNTA CONFIANZA tiene. Con confianza alta se resuelve solo; con
// confianza baja se le pregunta al usuario en vez de inventar una referencia.
//
// AISLAMIENTO: esto NO comparte filas entre sucursales. Cada sucursal conserva
// su fila, su stock, su precio y sus seriales. Lo único que se decide aquí es
// a cuál fila YA EXISTENTE del destino apunta el movimiento.
// ─────────────────────────────────────────────────────────────────────────────

const { hayListasPrecios } = require('../../config/columnas');

// ── Listas de precios: el local nace con los de la bodega ────────────────────
//
// La referencia que se crea en el local ya hereda `precio`, `codigo` y la línea.
// Los precios de lista van con ellos: si no, la talla que acaba de llegar se
// vendería al precio normal aunque el negocio tenga tarifado ese producto, y el
// local tendría que volver a teclear los tres precios para algo que la bodega ya
// tenía escrito. Es un PUNTO DE PARTIDA, no una atadura — el local los cambia
// después, que es justo de lo que va la feature.
//
// Se interpola solo si la columna existe, y eso no es adorno: si la migración no
// hubiera llegado y este INSERT ya nombrara `precios`, lo que se caería no sería
// una pantalla nueva sino DESPACHAR, la operación diaria de un módulo que ya
// está en producción. Es la misma precaución que toman las dos columnas de los
// pedidos internos.
// No es entrada de usuario: son literales SQL fijos.
const COL_PRECIOS = () => (hayListasPrecios() ? ', precios' : '');
const SEL_PRECIOS = () => (hayListasPrecios() ? ', precios' : '');

// Normalización equivalente a `_norm` de traslados.repository.js, pero en SQL:
// minúsculas, sin tildes, guiones y guiones bajos como espacio, espacios
// internos colapsados y recortada.
const NORM = (col) => `
  regexp_replace(
    trim(
      translate(
        lower(COALESCE(${col}, '')),
        'áàäâãéèëêíìïîóòöôõúùüûñç-_',
        'aaaaaeeeeiiiiooooouuuunc  '
      )
    ),
    '[[:space:]]+', ' ', 'g'
  )
`;

// Variante que además quita TODOS los espacios. Se usa solo para `marca` y
// `modelo`, que son identificadores cortos donde el espacio no distingue nada:
// "128GB" y "128 gb" son el mismo modelo. En `nombre` NO se aplica, porque ahí
// las palabras sí importan ("cargador carro" ≠ "cargadorcarro").
const NORM_COMPACTO = (col) => `replace(${NORM(col)}, ' ', '')`;

// Niveles de confianza. Los dos primeros se aplican sin preguntar.
const NIVEL = {
  CODIGO:   'codigo',    // mismo código único → es el mismo producto, seguro
  EXACTO:   'exacto',    // mismo nombre normalizado (+ marca/modelo o línea)
  PROBABLE: 'probable',  // mismo nombre pero difiere la línea/el modelo
  NUEVO:    'nuevo',     // no hay nada parecido en el destino
};

const SEGUROS = new Set([NIVEL.CODIGO, NIVEL.EXACTO]);
const esSeguro = (nivel) => SEGUROS.has(nivel);

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTOS DE CANTIDAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide a qué producto de cantidad del destino corresponde el de origen.
 * NO escribe nada: solo informa. Determinista (ORDER BY id) para que repetir
 * la consulta dé siempre la misma respuesta.
 */
const resolverCantidad = async (client, { productoOrigenId, sucursalDestinoId }) => {
  const { rows: orig } = await client.query(
    `SELECT id, nombre, codigo, linea_id, unidad_medida, precio, costo_unitario, stock_minimo
       ${SEL_PRECIOS()}
     FROM productos_cantidad WHERE id = $1`,
    [productoOrigenId]
  );
  if (!orig.length) throw { status: 404, message: 'Producto de origen no encontrado' };
  const o = orig[0];

  // 1. Por CÓDIGO — la identidad más fuerte que existe en el sistema.
  if (o.codigo) {
    const { rows } = await client.query(`
      SELECT id, nombre, codigo, stock, linea_id FROM productos_cantidad
      WHERE sucursal_id = $1 AND activo = true
        AND UPPER(TRIM(codigo)) = UPPER(TRIM($2))
      ORDER BY id LIMIT 1
    `, [sucursalDestinoId, o.codigo]);
    if (rows.length) return { nivel: NIVEL.CODIGO, destino: rows[0], origen: o };
  }

  // 2. Por NOMBRE normalizado + misma línea.
  const { rows: exacto } = await client.query(`
    SELECT id, nombre, codigo, stock, linea_id FROM productos_cantidad
    WHERE sucursal_id = $1 AND activo = true
      AND ${NORM('nombre')} = ${NORM('$2')}
      AND linea_id IS NOT DISTINCT FROM $3
    ORDER BY id LIMIT 1
  `, [sucursalDestinoId, o.nombre, o.linea_id]);
  if (exacto.length) return { nivel: NIVEL.EXACTO, destino: exacto[0], origen: o };

  // 3. Mismo nombre pero en otra línea → probable, se muestra para confirmar.
  const { rows: probable } = await client.query(`
    SELECT id, nombre, codigo, stock, linea_id FROM productos_cantidad
    WHERE sucursal_id = $1 AND activo = true
      AND ${NORM('nombre')} = ${NORM('$2')}
    ORDER BY id LIMIT 1
  `, [sucursalDestinoId, o.nombre]);
  if (probable.length) return { nivel: NIVEL.PROBABLE, destino: probable[0], origen: o };

  // 4. Candidatos por código igual con nombre distinto: casi siempre es el
  //    mismo producto escrito de otra forma. Se sugiere, nunca se asume.
  if (o.codigo) {
    const { rows: sugerencias } = await client.query(`
      SELECT id, nombre, codigo, stock, linea_id FROM productos_cantidad
      WHERE sucursal_id = $1 AND activo = true
        AND UPPER(TRIM(COALESCE(codigo, ''))) = UPPER(TRIM($2))
      ORDER BY id LIMIT 5
    `, [sucursalDestinoId, o.codigo]);
    if (sugerencias.length) {
      return { nivel: NIVEL.PROBABLE, destino: sugerencias[0], origen: o, sugerencias };
    }
  }

  return { nivel: NIVEL.NUEVO, destino: null, origen: o };
};

/**
 * El local ELIMINÓ antes este mismo producto: se REACTIVA en vez de crearlo.
 *
 * Eliminar es baja lógica (`activo = false`) y la fila conserva su nombre, pero
 * `productos_cantidad_nombre_sucursal_id_key` es `(nombre, sucursal_id)` SIN
 * filtro de `activo`: el INSERT de abajo chocaba con la fila eliminada y la
 * recepción moría con «Ya existe un registro con ese valor único», sin decir
 * qué producto (Tesla → Bunny Mobile, envío #75, 29-sep-2026). El código no
 * choca porque su índice sí es parcial (`AND activo`).
 *
 * Es el mismo producto lógico (mismo nombre exacto en la misma sede), así que
 * reactivarlo no inventa nada y conserva su historia. Lo que tuviera de stock al
 * eliminarse se DESCARTA con su renglón en el historial: eliminar lo sacó del
 * inventario, y revivir esas unidades sumaría mercancía que nadie ha contado.
 * Desde que eliminar exige stock 0 (`productosCantidad.service.eliminarProducto`)
 * eso solo le pasa a lo eliminado antes de ese arreglo.
 *
 * El código: si otro producto activo de la sede ya usa el suyo, se suelta (si
 * no, el índice parcial rechazaría la reactivación); si queda sin código, hereda
 * el del origen cuando está libre — la misma regla de la creación.
 */
const _reactivarEliminado = async (client, { origen, sucursalDestinoId }) => {
  const { rows } = await client.query(
    `SELECT id, nombre, codigo, stock, costo_unitario FROM productos_cantidad
     WHERE sucursal_id = $1 AND nombre = $2 AND activo = false
     ORDER BY id LIMIT 1
     FOR UPDATE`,
    [sucursalDestinoId, origen.nombre]
  );
  if (!rows.length) return null;
  const p = rows[0];

  const ocupado = async (codigo) => {
    const { rows: r } = await client.query(
      `SELECT 1 FROM productos_cantidad
       WHERE sucursal_id = $1 AND activo = true AND id <> $2
         AND UPPER(TRIM(codigo)) = UPPER(TRIM($3)) LIMIT 1`,
      [sucursalDestinoId, p.id, codigo]
    );
    return r.length > 0;
  };
  let codigo = p.codigo || null;
  if (codigo && await ocupado(codigo)) codigo = null;
  if (!codigo && origen.codigo && !(await ocupado(origen.codigo))) codigo = origen.codigo;

  const stockPrevio = Number(p.stock) || 0;
  if (stockPrevio !== 0) {
    await client.query(
      `UPDATE variantes_atributo SET stock = 0
       WHERE atributo_id IN (SELECT id FROM atributos_producto WHERE producto_id = $1)`,
      [p.id]
    );
    await client.query(`UPDATE atributos_producto SET stock = 0 WHERE producto_id = $1`, [p.id]);
    await client.query(
      `INSERT INTO historial_stock_cantidad
         (producto_id, sucursal_id, cantidad, costo_unitario, tipo, notas)
       VALUES ($1, $2, $3, $4, 'ajuste', $5)`,
      [p.id, sucursalDestinoId, -stockPrevio, p.costo_unitario,
       `Se reactivó al recibir de la red interna: se descartan ${stockPrevio} uds que tenía al eliminarse`]
    );
  }

  const { rows: act } = await client.query(
    `UPDATE productos_cantidad SET activo = true, stock = 0, codigo = $2
     WHERE id = $1 RETURNING id, nombre, codigo`,
    [p.id, codigo]
  );
  return { ...act[0], reactivado: true };
};

/**
 * Crea la referencia en el destino heredando el código del negocio.
 *
 * El código se hereda con la MISMA regla que ya usa
 * productosCantidad.repository.codigoHeredado: el mismo producto lógico (mismo
 * nombre) en otra sucursal debe llevar el mismo código, y solo se hereda si en
 * el destino ese código está libre (si no, chocaría con uq_productos_cantidad_codigo).
 *
 * Sin esto, el producto despachado nace mudo para el lector.
 */
const crearReferenciaCantidad = async (client, { origen, sucursalDestinoId, negocioId }) => {
  const reactivado = await _reactivarEliminado(client, { origen, sucursalDestinoId });
  if (reactivado) return reactivado;

  let codigo = origen.codigo || null;

  if (!codigo) {
    // ¿Ese nombre ya tiene código en otra sucursal del negocio?
    const { rows } = await client.query(`
      SELECT pc.codigo FROM productos_cantidad pc
      JOIN sucursales su ON su.id = pc.sucursal_id
      WHERE su.negocio_id = $1 AND pc.activo = true AND pc.codigo IS NOT NULL
        AND ${NORM('pc.nombre')} = ${NORM('$2')}
      ORDER BY pc.id LIMIT 1
    `, [negocioId, origen.nombre]);
    codigo = rows[0]?.codigo || null;
  }

  // Solo se hereda si en el destino está libre; si no, la fila nace sin código
  // (mejor sin código que romper la creación por un choque de índice).
  if (codigo) {
    const { rows: ocupado } = await client.query(
      `SELECT 1 FROM productos_cantidad
       WHERE sucursal_id = $1 AND activo = true AND codigo = $2 LIMIT 1`,
      [sucursalDestinoId, codigo]
    );
    if (ocupado.length) codigo = null;
  }

  const conPrecios = hayListasPrecios();
  const { rows: nuevo } = await client.query(`
    INSERT INTO productos_cantidad
      (nombre, stock, stock_minimo, unidad_medida, costo_unitario, precio,
       sucursal_id, linea_id, codigo${COL_PRECIOS()})
    VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8${conPrecios ? ', $9' : ''})
    RETURNING id, nombre, codigo
  `, [origen.nombre, origen.stock_minimo || 0, origen.unidad_medida || 'unidad',
      origen.costo_unitario, origen.precio, sucursalDestinoId, origen.linea_id, codigo,
      ...(conPrecios ? [origen.precios ?? null] : [])]);

  return nuevo[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTOS SERIALES
// `productos_serial` no tiene columna `codigo`: la identidad es nombre+marca+modelo.
// ─────────────────────────────────────────────────────────────────────────────

const resolverSerial = async (client, { productoOrigenId, sucursalDestinoId }) => {
  const { rows: orig } = await client.query(
    `SELECT id, nombre, marca, modelo, precio, linea_id ${SEL_PRECIOS()}
     FROM productos_serial WHERE id = $1`,
    [productoOrigenId]
  );
  if (!orig.length) throw { status: 404, message: 'Producto de origen no encontrado' };
  const o = orig[0];

  // 1. Nombre + marca + modelo. Marca y modelo se comparan sin espacios, así
  //    "128GB" y "128 gb" cuentan como el mismo modelo y no hay que preguntar.
  const { rows: exacto } = await client.query(`
    SELECT id, nombre, marca, modelo, linea_id FROM productos_serial
    WHERE sucursal_id = $1
      AND ${NORM('nombre')}          = ${NORM('$2')}
      AND ${NORM_COMPACTO('marca')}  = ${NORM_COMPACTO('$3')}
      AND ${NORM_COMPACTO('modelo')} = ${NORM_COMPACTO('$4')}
    ORDER BY id LIMIT 1
  `, [sucursalDestinoId, o.nombre, o.marca, o.modelo]);
  if (exacto.length) return { nivel: NIVEL.EXACTO, destino: exacto[0], origen: o };

  // 2. Mismo nombre y marca, modelo distinto o vacío → probable.
  const { rows: probable } = await client.query(`
    SELECT id, nombre, marca, modelo, linea_id FROM productos_serial
    WHERE sucursal_id = $1
      AND ${NORM('nombre')}         = ${NORM('$2')}
      AND ${NORM_COMPACTO('marca')} = ${NORM_COMPACTO('$3')}
    ORDER BY id LIMIT 5
  `, [sucursalDestinoId, o.nombre, o.marca]);
  if (probable.length) {
    return { nivel: NIVEL.PROBABLE, destino: probable[0], origen: o, sugerencias: probable };
  }

  // 3. Solo el nombre → probable, con varias sugerencias.
  const { rows: porNombre } = await client.query(`
    SELECT id, nombre, marca, modelo, linea_id FROM productos_serial
    WHERE sucursal_id = $1 AND ${NORM('nombre')} = ${NORM('$2')}
    ORDER BY id LIMIT 5
  `, [sucursalDestinoId, o.nombre]);
  if (porNombre.length) {
    return { nivel: NIVEL.PROBABLE, destino: porNombre[0], origen: o, sugerencias: porNombre };
  }

  return { nivel: NIVEL.NUEVO, destino: null, origen: o };
};

const crearReferenciaSerial = async (client, { origen, sucursalDestinoId }) => {
  const conPrecios = hayListasPrecios();
  const { rows: nuevo } = await client.query(`
    INSERT INTO productos_serial
      (nombre, marca, modelo, precio, sucursal_id, linea_id${COL_PRECIOS()})
    VALUES ($1, $2, $3, $4, $5, $6${conPrecios ? ', $7' : ''})
    RETURNING id, nombre, marca, modelo
  `, [origen.nombre, origen.marca, origen.modelo, origen.precio, sucursalDestinoId, origen.linea_id,
      ...(conPrecios ? [origen.precios ?? null] : [])]);
  return nuevo[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// API unificada
// ─────────────────────────────────────────────────────────────────────────────

const resolver = (client, { tipo, productoOrigenId, sucursalDestinoId }) =>
  (tipo === 'serial' ? resolverSerial : resolverCantidad)(
    client, { productoOrigenId, sucursalDestinoId }
  );

/**
 * Devuelve el id del producto destino, creándolo SOLO si hace falta.
 *
 * `preferido` es la decisión que ya tomó el usuario al despachar (guardada en
 * `lineas_remision.producto_destino_id`). Se valida que siga existiendo en la
 * sucursal correcta antes de usarla: si alguien la borró entre el despacho y la
 * recepción, se vuelve a resolver en vez de fallar.
 *
 * En cantidad el preferido además tiene que estar ACTIVO: uno eliminado después
 * del despacho recibiría el stock sin que nadie lo viera en el inventario. Cae
 * a la resolución normal, que lo reactiva si es el mismo producto.
 */
const obtenerODcrear = async (client, {
  tipo, productoOrigenId, sucursalDestinoId, negocioId, preferido = null,
}) => {
  if (preferido) {
    const tabla = tipo === 'serial' ? 'productos_serial' : 'productos_cantidad';
    const soloActivo = tipo === 'serial' ? '' : ' AND activo = true';
    const { rows } = await client.query(
      `SELECT id FROM ${tabla} WHERE id = $1 AND sucursal_id = $2${soloActivo}`,
      [preferido, sucursalDestinoId]
    );
    if (rows.length) return { producto_id: rows[0].id, creado: false, nivel: 'preferido' };
  }

  const r = await resolver(client, { tipo, productoOrigenId, sucursalDestinoId });
  if (r.destino) return { producto_id: r.destino.id, creado: false, nivel: r.nivel };

  const creado = tipo === 'serial'
    ? await crearReferenciaSerial(client,  { origen: r.origen, sucursalDestinoId })
    : await crearReferenciaCantidad(client, { origen: r.origen, sucursalDestinoId, negocioId });
  return { producto_id: creado.id, creado: true, nivel: NIVEL.NUEVO };
};

module.exports = {
  NORM, NORM_COMPACTO, NIVEL, esSeguro,
  resolver, resolverSerial, resolverCantidad,
  crearReferenciaSerial, crearReferenciaCantidad,
  obtenerODcrear,
};
