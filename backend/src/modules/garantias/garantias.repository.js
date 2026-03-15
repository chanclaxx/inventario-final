const { pool } = require('../../config/db');

// ── Helper: reemplaza todas las líneas de una garantía ────────────────────────
const _sincronizarLineas = async (client, garantiaId, lineas = []) => {
  await client.query(
    'DELETE FROM garantias_lineas WHERE garantia_id = $1',
    [garantiaId]
  );
  for (const lineaId of lineas) {
    await client.query(
      'INSERT INTO garantias_lineas (garantia_id, linea_id) VALUES ($1, $2)',
      [garantiaId, lineaId]
    );
  }
};

const findAll = async (negocioId) => {
  const { rows } = await pool.query(`
    SELECT
      g.id, g.titulo, g.texto, g.orden,
      COALESCE(
        JSON_AGG(gl.linea_id ORDER BY gl.linea_id) FILTER (WHERE gl.linea_id IS NOT NULL),
        '[]'
      ) AS lineas
    FROM garantias g
    LEFT JOIN garantias_lineas gl ON gl.garantia_id = g.id
    WHERE g.negocio_id = $1
    GROUP BY g.id
    ORDER BY g.orden ASC, g.id ASC
  `, [negocioId]);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(`
    SELECT
      g.id, g.titulo, g.texto, g.orden,
      COALESCE(
        JSON_AGG(gl.linea_id ORDER BY gl.linea_id) FILTER (WHERE gl.linea_id IS NOT NULL),
        '[]'
      ) AS lineas
    FROM garantias g
    LEFT JOIN garantias_lineas gl ON gl.garantia_id = g.id
    WHERE g.id = $1 AND g.negocio_id = $2
    GROUP BY g.id
  `, [id, negocioId]);
  return rows[0] || null;
};

const create = async (negocioId, { titulo, texto, orden, lineas = [] }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      INSERT INTO garantias(negocio_id, titulo, texto, orden)
      VALUES ($1, $2, $3, $4)
      RETURNING id, titulo, texto, orden
    `, [negocioId, titulo, texto, orden || 0]);

    const garantia = rows[0];
    await _sincronizarLineas(client, garantia.id, lineas);

    await client.query('COMMIT');
    return { ...garantia, lineas };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const update = async (negocioId, id, { titulo, texto, orden, lineas = [] }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      UPDATE garantias
      SET titulo = $1, texto = $2, orden = $3
      WHERE id = $4 AND negocio_id = $5
      RETURNING id, titulo, texto, orden
    `, [titulo, texto, orden, id, negocioId]);

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    await _sincronizarLineas(client, id, lineas);

    await client.query('COMMIT');
    return { ...rows[0], lineas };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const eliminar = async (negocioId, id) => {
  // ON DELETE CASCADE elimina garantias_lineas automáticamente
  const { rowCount } = await pool.query(
    'DELETE FROM garantias WHERE id = $1 AND negocio_id = $2',
    [id, negocioId]
  );
  return rowCount > 0;
};

// ── Garantías aplicables a una factura según las líneas de sus productos ──────
const findPorFactura = async (facturaId) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT g.id, g.titulo, g.texto, g.orden
    FROM garantias g
    JOIN garantias_lineas gl ON gl.garantia_id = g.id
    JOIN lineas_factura   lf ON lf.factura_id  = $1
    LEFT JOIN seriales        s  ON s.imei = lf.imei
    LEFT JOIN productos_serial ps ON ps.id = s.producto_id
    LEFT JOIN productos_cantidad pc ON pc.id = lf.producto_id
    WHERE gl.linea_id = COALESCE(ps.linea_id, pc.linea_id)
    ORDER BY g.orden ASC, g.id ASC
  `, [facturaId]);
  return rows;
};

module.exports = { findAll, findById, create, update, eliminar, findPorFactura };