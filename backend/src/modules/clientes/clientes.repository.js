const { pool } = require('../../config/db');

const findAll = async (negocioId, filtro) => {
  let query = `
    SELECT c.id, c.nombre, c.cedula, c.celular, c.email,
           c.direccion, c.fecha_registro,
           COUNT(f.id) AS total_compras,
           COALESCE(SUM(l.subtotal), 0) AS total_gastado
    FROM clientes c
    LEFT JOIN facturas f
      ON f.cedula = c.cedula
      AND f.estado != 'Cancelada'
      AND f.sucursal_id IN (
        SELECT id FROM sucursales WHERE negocio_id = $1
      )
    LEFT JOIN lineas_factura l ON l.factura_id = f.id
    WHERE c.negocio_id = $1
  `;
  const params = [negocioId];

  if (filtro) {
    // ── Mismo escape que aplicamos en acreedores ──
    const filtroSeguro = filtro
      .toLowerCase()
      .replace(/[%_\\]/g, '\\$&')
      .slice(0, 100);

    params.push(`%${filtroSeguro}%`);
    query += ` AND (LOWER(c.nombre) LIKE $2 ESCAPE '\\' OR c.cedula LIKE $2 ESCAPE '\\' OR c.celular LIKE $2 ESCAPE '\\')`;
  }

  query += ` GROUP BY c.id ORDER BY c.nombre`;
  const { rows } = await pool.query(query, params);
  return rows;
};

// Búsqueda para el autocompletado de clientes al facturar.
//
// Deliberadamente NO reusa findAll: aquel cruza facturas + lineas_factura y
// agrupa para calcular total_compras/total_gastado, un costo que crece con el
// historial del negocio. Aquí se dispara una consulta por cada tecleo, así que
// solo se leen los datos que rellenan el formulario, con LIMIT.
//
// El aislamiento es el mismo del resto del módulo: negocio_id sale del JWT,
// nunca del request, así que un negocio jamás ve clientes de otro.
const BUSQUEDA_MIN = 2;
const BUSQUEDA_LIMITE = 12;

// Acentos: la columna se normaliza con TRANSLATE (no requiere la extensión
// unaccent, que puede no estar instalada) y el término se normaliza en JS con
// el mismo criterio, para que "maria" encuentre a "María".
const NOMBRE_NORMALIZADO = `TRANSLATE(LOWER(nombre), 'áéíóúüñ', 'aeiouun')`;

const buscar = async (negocioId, termino) => {
  const q = (termino || '').trim();
  if (q.length < BUSQUEDA_MIN) return [];

  // Mismo escape que findAll/acreedores + normalización de acentos.
  // El recorte va ANTES del escape: cortar después podría partir un `\`
  // introducido por el escape y dejar un patrón LIKE inválido.
  const filtroSeguro = q
    .slice(0, 100)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[%_\\]/g, '\\$&');

  const { rows } = await pool.query(`
    SELECT id, nombre, cedula, celular, email, direccion
    FROM clientes
    WHERE negocio_id = $1
      AND cedula IS DISTINCT FROM 'COMPANERO'
      AND (
        ${NOMBRE_NORMALIZADO} LIKE $2 ESCAPE '\\'
        OR LOWER(cedula)  LIKE $2 ESCAPE '\\'
        OR LOWER(celular) LIKE $2 ESCAPE '\\'
      )
    ORDER BY
      CASE
        WHEN ${NOMBRE_NORMALIZADO} LIKE $3 ESCAPE '\\' THEN 0
        WHEN LOWER(cedula)         LIKE $3 ESCAPE '\\' THEN 1
        ELSE 2
      END,
      nombre
    LIMIT ${BUSQUEDA_LIMITE}
  `, [negocioId, `%${filtroSeguro}%`, `${filtroSeguro}%`]);

  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(
    `SELECT * FROM clientes WHERE id = $1 AND negocio_id = $2`,
    [id, negocioId]
  );
  return rows[0] || null;
};

const findByCedula = async (negocioId, cedula) => {
  const { rows } = await pool.query(
    `SELECT * FROM clientes WHERE cedula = $1 AND negocio_id = $2`,
    [cedula, negocioId]
  );
  return rows[0] || null;
};

const getHistorialCompras = async (negocioId, cedula) => {
  const { rows } = await pool.query(`
    SELECT f.id, f.fecha, f.estado, f.sucursal_id,
           s.nombre AS sucursal_nombre,
           COALESCE(SUM(l.subtotal), 0) AS total
    FROM facturas f
    JOIN sucursales s ON s.id = f.sucursal_id
    LEFT JOIN lineas_factura l ON l.factura_id = f.id
    WHERE f.cedula = $1 AND s.negocio_id = $2
    GROUP BY f.id, s.nombre
    ORDER BY f.fecha DESC
  `, [cedula, negocioId]);
  return rows;
};

const create = async (negocioId, { nombre, cedula, celular, email, direccion }) => {
  const { rows } = await pool.query(`
    INSERT INTO clientes(negocio_id, nombre, cedula, celular, email, direccion)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [negocioId, nombre, cedula, celular, email, direccion]);
  return rows[0];
};

// Actualización parcial: un campo ausente (undefined/null) conserva su valor
// actual. Así una edición que solo manda el nombre no borra email/dirección.
const update = async (negocioId, id, { nombre, celular, email, direccion }) => {
  const { rows } = await pool.query(`
    UPDATE clientes
    SET nombre    = COALESCE(NULLIF($1, ''), nombre),
        celular   = COALESCE($2, celular),
        email     = COALESCE($3, email),
        direccion = COALESCE($4, direccion)
    WHERE id = $5 AND negocio_id = $6
    RETURNING *
  `, [nombre ?? null, celular ?? null, email ?? null, direccion ?? null, id, negocioId]);
  return rows[0] || null;
};

const findFrecuentes = async (sucursalId) => {
  const { rows } = await pool.query(`
    SELECT c.id, c.nombre, c.cedula, c.celular, c.email, c.direccion
    FROM clientes_frecuentes cf
    JOIN clientes c ON c.id = cf.cliente_id
    WHERE cf.sucursal_id = $1
    ORDER BY c.nombre
  `, [sucursalId]);
  return rows;
};
 
const agregarFrecuente = async (sucursalId, clienteId) => {
  const { rows } = await pool.query(`
    INSERT INTO clientes_frecuentes(sucursal_id, cliente_id)
    VALUES ($1, $2)
    ON CONFLICT (sucursal_id, cliente_id) DO NOTHING
    RETURNING *
  `, [sucursalId, clienteId]);
  return rows[0] || null;
};
 
const quitarFrecuente = async (sucursalId, clienteId) => {
  const { rows } = await pool.query(`
    DELETE FROM clientes_frecuentes
    WHERE sucursal_id = $1 AND cliente_id = $2
    RETURNING id
  `, [sucursalId, clienteId]);
  return rows[0] || null;
};

module.exports = { findAll, buscar, findById, findByCedula, getHistorialCompras, create, update,findFrecuentes,agregarFrecuente,quitarFrecuente };