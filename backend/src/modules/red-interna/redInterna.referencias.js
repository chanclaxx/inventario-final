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

  const { rows: nuevo } = await client.query(`
    INSERT INTO productos_cantidad
      (nombre, stock, stock_minimo, unidad_medida, costo_unitario, precio,
       sucursal_id, linea_id, codigo)
    VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, nombre, codigo
  `, [origen.nombre, origen.stock_minimo || 0, origen.unidad_medida || 'unidad',
      origen.costo_unitario, origen.precio, sucursalDestinoId, origen.linea_id, codigo]);

  return nuevo[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTOS SERIALES
// `productos_serial` no tiene columna `codigo`: la identidad es nombre+marca+modelo.
// ─────────────────────────────────────────────────────────────────────────────

const resolverSerial = async (client, { productoOrigenId, sucursalDestinoId }) => {
  const { rows: orig } = await client.query(
    `SELECT id, nombre, marca, modelo, precio, linea_id
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
  const { rows: nuevo } = await client.query(`
    INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, nombre, marca, modelo
  `, [origen.nombre, origen.marca, origen.modelo, origen.precio, sucursalDestinoId, origen.linea_id]);
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
 */
const obtenerODcrear = async (client, {
  tipo, productoOrigenId, sucursalDestinoId, negocioId, preferido = null,
}) => {
  if (preferido) {
    const tabla = tipo === 'serial' ? 'productos_serial' : 'productos_cantidad';
    const { rows } = await client.query(
      `SELECT id FROM ${tabla} WHERE id = $1 AND sucursal_id = $2`,
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
