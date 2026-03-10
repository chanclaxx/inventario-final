const { pool } = require('../../config/db');
const repo         = require('./prestamos.repository');
const cantidadRepo = require('../productos/productosCantidad.repository');

const getPrestamos = (sucursalId) => repo.findAll(sucursalId);

const getPrestamoById = async (negocioId, id) => {
  const valido = await repo.perteneceAlNegocio(id, negocioId);
  if (!valido) throw { status: 404, message: 'Préstamo no encontrado' };
  const prestamo = await repo.findById(id);
  const abonos   = await repo.getAbonos(id);
  return { ...prestamo, abonos };
};

const crearPrestamo = async ({ sucursal_id, usuario_id, prestatario, cedula, telefono, nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prestamo = await repo.create(client, {
      sucursal_id, usuario_id, prestatario, cedula, telefono,
      nombre_producto, imei: imei || null,
      producto_id: producto_id || null,
      cantidad_prestada: cantidad_prestada || 1,
      valor_prestamo,
    });

    if (imei) {
      await client.query(
        'UPDATE seriales SET prestado = true WHERE imei = $1',
        [imei]
      );
    } else if (producto_id) {
      const producto = await cantidadRepo.findById(producto_id);
      if (!producto) throw { status: 404, message: 'Producto no encontrado' };
      if (producto.stock < cantidad_prestada) {
        throw { status: 400, message: 'Stock insuficiente para el préstamo' };
      }
      await cantidadRepo.ajustarStock(producto_id, -cantidad_prestada);
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
  const valido = await repo.perteneceAlNegocio(prestamoId, negocioId);
  if (!valido) throw { status: 404, message: 'Préstamo no encontrado' };

  const prestamo = await repo.findById(prestamoId);
  if (prestamo.estado !== 'Activo') throw { status: 400, message: 'El préstamo no está activo' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await repo.insertarAbono(client, { prestamo_id: prestamoId, valor });

    // Forzar Number para evitar comparación de strings de PostgreSQL
    const totalAbonado  = Number(resultado.total_abonado);
    const valorPrestamo = Number(resultado.valor_prestamo);

    if (totalAbonado >= valorPrestamo) {
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
  const valido = await repo.perteneceAlNegocio(prestamoId, negocioId);
  if (!valido) throw { status: 404, message: 'Préstamo no encontrado' };

  const prestamo = await repo.findById(prestamoId);
  if (prestamo.estado === 'Devuelto') throw { status: 400, message: 'El préstamo ya fue devuelto' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (prestamo.imei) {
      await client.query('UPDATE seriales SET prestado = false WHERE imei = $1', [prestamo.imei]);
    } else if (prestamo.producto_id) {
      await cantidadRepo.ajustarStock(prestamo.producto_id, prestamo.cantidad_prestada);
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

module.exports = { getPrestamos, getPrestamoById, crearPrestamo, registrarAbono, devolverPrestamo };