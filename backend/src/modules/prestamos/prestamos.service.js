const { pool }     = require('../../config/db');
const repo         = require('./prestamos.repository');
const cantidadRepo = require('../productos/productosCantidad.repository');

const getPrestamos    = (sucursalId, negocioId) => repo.findAll(sucursalId, negocioId);

const getPrestamoById = async (negocioId, id) => {
  const prestamo = await repo.findByIdYNegocio(id, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  const abonos = await repo.getAbonos(id);
  return { ...prestamo, abonos };
};

const crearPrestamo = async ({
  sucursal_id, usuario_id, negocio_id,
  prestatario, cedula, telefono,
  nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
  prestatario_id, empleado_id, cliente_id,
}) => {
  // ── Verificar sucursal pertenece al negocio ──────────────────────────────
  const { rows: sucRows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!sucRows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  // ── Verificar que cliente_id pertenece al negocio si viene informado ──
  if (cliente_id) {
    const { rows: clienteRows } = await pool.query(
      'SELECT id FROM clientes WHERE id = $1 AND negocio_id = $2',
      [cliente_id, negocio_id]
    );
    if (!clienteRows.length) {
      throw { status: 403, message: 'El cliente no pertenece a este negocio' };
    }
  }

  // ── Verificar que prestatario_id pertenece al negocio si viene informado ──
  if (prestatario_id) {
    const { rows: prestatarioRows } = await pool.query(
      'SELECT id FROM prestatarios WHERE id = $1 AND negocio_id = $2',
      [prestatario_id, negocio_id]
    );
    if (!prestatarioRows.length) {
      throw { status: 403, message: 'El prestatario no pertenece a este negocio' };
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prestamo = await repo.create(client, {
      sucursal_id, usuario_id, prestatario, cedula, telefono,
      nombre_producto, imei: imei || null,
      producto_id:       producto_id       || null,
      cantidad_prestada: cantidad_prestada || 1,
      valor_prestamo,
      prestatario_id:    prestatario_id    || null,
      empleado_id:       empleado_id       || null,
      cliente_id:        cliente_id        || null,
    });

    if (imei) {
      const { rows } = await client.query(
        `SELECT s.id FROM seriales s
         JOIN productos_serial ps ON ps.id = s.producto_id
         WHERE s.imei = $1 AND ps.sucursal_id = $2`,
        [imei, sucursal_id]
      );
      if (!rows.length) {
        throw { status: 400, message: `El producto ${nombre_producto} no pertenece a esta sucursal` };
      }
      await client.query(
        'UPDATE seriales SET prestado = true WHERE id = $1',
        [rows[0].id]
      );

    } else if (producto_id) {
      const { rows: prodRows } = await client.query(
        `SELECT id, stock, sucursal_id FROM productos_cantidad WHERE id = $1`,
        [producto_id]
      );
      const producto = prodRows[0];
      if (!producto) throw { status: 404, message: 'Producto no encontrado' };
      if (producto.sucursal_id !== sucursal_id) {
        throw { status: 400, message: `El producto ${nombre_producto} no pertenece a esta sucursal` };
      }
      if (producto.stock < cantidad_prestada) {
        throw { status: 400, message: 'Stock insuficiente para el préstamo' };
      }
      await repo.ajustarStock(client, producto_id, -cantidad_prestada);
    }

    await client.query('COMMIT');
    return prestamo;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const registrarAbono = async (negocioId, prestamoId, valor) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  if (prestamo.estado !== 'Activo') throw { status: 400, message: 'El préstamo no está activo' };

  const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
  if (valor > saldoPendiente) {
    throw { status: 400, message: `El abono supera el saldo pendiente (${saldoPendiente.toFixed(2)})` };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await repo.insertarAbono(client, { prestamo_id: prestamoId, valor });
    if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
      await repo.updateEstado(client, prestamoId, 'Saldado');
    }
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const devolverPrestamo = async (negocioId, prestamoId) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  if (prestamo.estado === 'Devuelto') throw { status: 400, message: 'El préstamo ya fue devuelto' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (prestamo.imei) {
      const { rows: serialRows } = await client.query(
        `SELECT s.id FROM seriales s
         JOIN productos_serial ps ON ps.id = s.producto_id
         JOIN prestamos         p  ON p.sucursal_id = ps.sucursal_id
         WHERE s.imei = $1 AND p.id = $2`,
        [prestamo.imei, prestamoId]
      );
      if (serialRows.length) {
        await client.query(
          'UPDATE seriales SET prestado = false WHERE id = $1',
          [serialRows[0].id]
        );
      }
    } else if (prestamo.producto_id) {
      await repo.ajustarStock(client, prestamo.producto_id, prestamo.cantidad_prestada);
    }

    await repo.updateEstado(client, prestamoId, 'Devuelto');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getPrestamos, getPrestamoById, crearPrestamo, registrarAbono, devolverPrestamo,
};