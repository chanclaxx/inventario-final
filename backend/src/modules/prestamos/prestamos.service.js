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
  // ── Verificar que sucursal_id pertenece al negocio (segunda capa) ──
  const { rows: sucRows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!sucRows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

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
      await client.query('UPDATE seriales SET prestado = true WHERE imei = $1', [imei]);

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
      // ── Ajuste de stock dentro de la transacción ──
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
  // ── Una sola query: ownership + datos ──
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  if (prestamo.estado !== 'Activo') throw { status: 400, message: 'El préstamo no está activo' };

  // ── Validar saldo pendiente ──
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
      await client.query('UPDATE seriales SET prestado = false WHERE imei = $1', [prestamo.imei]);
    } else if (prestamo.producto_id) {
      // ── Ajuste de stock dentro de la transacción ──
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