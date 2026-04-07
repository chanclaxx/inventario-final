const { pool }     = require('../../config/db');
const repo         = require('./prestamos.repository');

// ─── Helpers privados ─────────────────────────────────────────────────────────

const _verificarSucursal = async (sucursal_id, negocio_id) => {
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };
};

const _verificarCliente = async (cliente_id, negocio_id) => {
  if (!cliente_id) return;
  const { rows } = await pool.query(
    'SELECT id FROM clientes WHERE id = $1 AND negocio_id = $2',
    [cliente_id, negocio_id]
  );
  if (!rows.length) throw { status: 403, message: 'El cliente no pertenece a este negocio' };
};

const _verificarPrestatario = async (prestatario_id, negocio_id) => {
  if (!prestatario_id) return;
  const { rows } = await pool.query(
    'SELECT id FROM prestatarios WHERE id = $1 AND negocio_id = $2',
    [prestatario_id, negocio_id]
  );
  if (!rows.length) throw { status: 403, message: 'El prestatario no pertenece a este negocio' };
};

// Procesa un ítem dentro de una transacción ya abierta: marca serial o descuenta stock
const _procesarItemPrestamo = async (client, { imei, producto_id, nombre_producto, cantidad_prestada, sucursal_id, prestatario }) => {
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
      'UPDATE seriales SET prestado = true, cliente_origen = $1 WHERE id = $2',
      [prestatario || null, rows[0].id]
    );
  } else if (producto_id) {
    const { rows: prodRows } = await client.query(
      `SELECT id, stock, sucursal_id FROM productos_cantidad WHERE id = $1`,
      [producto_id]
    );
    const producto = prodRows[0];
    if (!producto) throw { status: 404, message: `Producto ${nombre_producto} no encontrado` };
    if (producto.sucursal_id !== sucursal_id) {
      throw { status: 400, message: `El producto ${nombre_producto} no pertenece a esta sucursal` };
    }
    if (producto.stock < cantidad_prestada) {
      throw { status: 400, message: `Stock insuficiente para ${nombre_producto}` };
    }
    await repo.ajustarStock(client, producto_id, -cantidad_prestada);
  }
};

// ─── Servicio: obtener ────────────────────────────────────────────────────────

const getPrestamos = (sucursalId, negocioId) => repo.findAll(sucursalId, negocioId);

const getPrestamoById = async (negocioId, id) => {
  const prestamo = await repo.findByIdYNegocio(id, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  const abonos = await repo.getAbonos(id);
  return { ...prestamo, abonos };
};

// ─── Servicio: crear un préstamo (mantiene compatibilidad) ────────────────────

const crearPrestamo = async ({
  sucursal_id, usuario_id, negocio_id,
  prestatario, cedula, telefono,
  nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
  prestatario_id, empleado_id, cliente_id,
}) => {
  await _verificarSucursal(sucursal_id, negocio_id);
  await _verificarCliente(cliente_id, negocio_id);
  await _verificarPrestatario(prestatario_id, negocio_id);

  // ── FIX: si hay imei es serial, producto_id debe ser null ──
  const esSerial   = !!imei;
  const productoId = esSerial ? null : (producto_id || null);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prestamo = await repo.create(client, {
      sucursal_id, usuario_id, prestatario, cedula, telefono,
      nombre_producto, imei: imei || null,
      producto_id:       productoId,
      cantidad_prestada: esSerial ? 1 : (cantidad_prestada || 1),
      valor_prestamo,
      prestatario_id:    prestatario_id || null,
      empleado_id:       empleado_id   || null,
      cliente_id:        cliente_id    || null,
    });

    await _procesarItemPrestamo(client, {
      imei, producto_id: productoId,
      nombre_producto,
      cantidad_prestada: esSerial ? 1 : (cantidad_prestada || 1),
      sucursal_id,
      prestatario,
    });

    await client.query('COMMIT');
    return prestamo;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: crear múltiples préstamos desde el carrito ────────────────────

const crearPrestamos = async ({
  sucursal_id, usuario_id, negocio_id,
  prestatario, cedula, telefono,
  prestatario_id, empleado_id, cliente_id,
  items,
}) => {
  if (!items?.length) throw { status: 400, message: 'Se requiere al menos un ítem para el préstamo' };

  await _verificarSucursal(sucursal_id, negocio_id);
  await _verificarCliente(cliente_id, negocio_id);
  await _verificarPrestatario(prestatario_id, negocio_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prestamosCreados = [];

    for (const item of items) {
      // ── FIX: si hay imei es serial, producto_id debe ser null ──
      const esSerial   = !!item.imei;
      const productoId = esSerial ? null : (item.producto_id || null);

      const prestamo = await repo.create(client, {
        sucursal_id,
        usuario_id,
        prestatario,
        cedula,
        telefono,
        nombre_producto:   item.nombre_producto,
        imei:              item.imei || null,
        producto_id:       productoId,
        cantidad_prestada: esSerial ? 1 : (item.cantidad_prestada || 1),
        valor_prestamo:    item.valor_prestamo,
        prestatario_id:    prestatario_id || null,
        empleado_id:       empleado_id   || null,
        cliente_id:        cliente_id    || null,
      });

      await _procesarItemPrestamo(client, {
        imei:              item.imei,
        producto_id:       productoId,
        nombre_producto:   item.nombre_producto,
        cantidad_prestada: esSerial ? 1 : (item.cantidad_prestada || 1),
        sucursal_id,
        prestatario,
      });

      prestamosCreados.push(prestamo);
    }

    await client.query('COMMIT');
    return prestamosCreados;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: registrar abono ────────────────────────────────────────────────

const registrarAbono = async (negocioId, prestamoId, valor, metodo) => {
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

   const resultado = await repo.insertarAbono(client, { prestamo_id: prestamoId, valor, metodo });

    if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
      await repo.updateEstado(client, prestamoId, 'Saldado');

      // ── Si el préstamo tenía un serial, marcarlo como vendido al saldarse.
      // Solo aplica cuando hay imei; los productos por cantidad no tienen este flujo.
      if (prestamo.imei) {
        await repo.salarSerial(client, prestamo.imei, prestamo.sucursal_id);
      }
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

// ─── Servicio: devolver préstamo completo ─────────────────────────────────────

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

// ─── Servicio: devolución parcial (solo para productos por cantidad) ──────────

const devolverParcial = async (negocioId, prestamoId, cantidad_devuelta) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  if (prestamo.estado === 'Devuelto') throw { status: 400, message: 'El préstamo ya fue devuelto' };
  if (prestamo.imei) throw { status: 400, message: 'La devolución parcial solo aplica a productos por cantidad' };
  if (!prestamo.producto_id) throw { status: 400, message: 'El préstamo no tiene producto asociado' };

  const cantidadActual = Number(prestamo.cantidad_prestada);
  if (cantidad_devuelta < 1 || cantidad_devuelta > cantidadActual) {
    throw {
      status: 400,
      message: `La cantidad a devolver debe estar entre 1 y ${cantidadActual}`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await repo.ajustarStock(client, prestamo.producto_id, cantidad_devuelta);

    if (cantidad_devuelta === cantidadActual) {
      await repo.updateEstado(client, prestamoId, 'Devuelto');
    } else {
      const valorTotal       = Number(prestamo.valor_prestamo);
      const cantidadRestante = cantidadActual - cantidad_devuelta;
      const precioUnitario   = valorTotal / cantidadActual;
      const nuevoValor       = Math.round(precioUnitario * cantidadRestante);

      await repo.actualizarCantidadYValor(client, prestamoId, cantidadRestante, nuevoValor);

      if (Number(prestamo.total_abonado) >= nuevoValor) {
        await repo.updateEstado(client, prestamoId, 'Saldado');
      }
    }

    await client.query('COMMIT');
    return {
      devuelto:  cantidad_devuelta,
      pendiente: cantidadActual - cantidad_devuelta,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getPrestamos, getPrestamoById,
  crearPrestamo, crearPrestamos,
  registrarAbono,
  devolverPrestamo, devolverParcial,
};