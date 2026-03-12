const crearPrestamo = async ({
  sucursal_id, usuario_id, prestatario, cedula, telefono,
  nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
  prestatario_id, empleado_id, cliente_id,
}) => {
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
      await client.query(
        'UPDATE seriales SET prestado = true WHERE imei = $1', [imei]
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