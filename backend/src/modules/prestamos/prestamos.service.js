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
      'UPDATE seriales SET prestado = true WHERE id = $1',
      [rows[0].id]
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

// ─── Helper: crear factura desde un préstamo saldado ─────────────────────────
// Se ejecuta dentro de la transacción del abono para garantizar atomicidad.

const _crearFacturaDesdePrestamo = async (client, prestamo, metodo, negocioId) => {
  // Cedula: si es compañero o no tiene cédula real → 'COMPANERO'
  const esCompanero = !prestamo.cedula || prestamo.cedula === 'COMPANERO';
  const cedula      = esCompanero ? 'COMPANERO' : prestamo.cedula;
  const celular     = !prestamo.telefono || prestamo.telefono === '0000000000'
    ? '0000000000'
    : prestamo.telefono;

  // Resolver cliente_id si existe
  const clienteId = prestamo.cliente_id || null;

  // Insertar factura
  const { rows: facturaRows } = await client.query(`
    INSERT INTO facturas(
      sucursal_id, usuario_id, cliente_id,
      nombre_cliente, cedula, celular,
      notas, estado
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'Activa')
    RETURNING id
  `, [
    prestamo.sucursal_id,
    null,                        // no hay usuario en este contexto, se deja null
    clienteId,
    prestamo.prestatario || '',
    cedula,
    celular,
    `Factura generada por saldo de préstamo #${prestamo.id}`,
  ]);

  const facturaId = facturaRows[0].id;

  // Insertar línea del producto
  await client.query(`
    INSERT INTO lineas_factura(
      factura_id, nombre_producto, imei,
      cantidad, precio, producto_id
    )
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [
    facturaId,
    prestamo.nombre_producto,
    prestamo.imei     || null,
    prestamo.imei ? 1 : Number(prestamo.cantidad_prestada || 1),
    Number(prestamo.valor_prestamo),
    prestamo.imei ? null : (prestamo.producto_id || null),
  ]);

  // Insertar pago con el método del abono
  await client.query(`
    INSERT INTO pagos_factura(factura_id, metodo, valor)
    VALUES ($1, $2, $3)
  `, [
    facturaId,
    metodo || 'Efectivo',
    Number(prestamo.valor_prestamo),
  ]);

  // Marcar serial como vendido si aplica
  if (prestamo.imei) {
    await client.query(`
      UPDATE seriales s
      SET vendido      = true,
          prestado     = false,
          fecha_salida = CURRENT_DATE
      FROM productos_serial ps
      WHERE s.imei         = $1
        AND ps.id          = s.producto_id
        AND ps.sucursal_id = $2
    `, [prestamo.imei, prestamo.sucursal_id]);
  }

  return facturaId;
};

// ─── Servicio: obtener ────────────────────────────────────────────────────────

const getPrestamos = (sucursalId, negocioId) => repo.findAll(sucursalId, negocioId);

const getPrestamoById = async (negocioId, id) => {
  const prestamo = await repo.findByIdYNegocio(id, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  const abonos = await repo.getAbonos(id);
  return { ...prestamo, abonos };
};

// ─── Servicio: crear un préstamo ──────────────────────────────────────────────

const crearPrestamo = async ({
  sucursal_id, usuario_id, negocio_id,
  prestatario, cedula, telefono,
  nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
  prestatario_id, empleado_id, cliente_id,
}) => {
  await _verificarSucursal(sucursal_id, negocio_id);
  await _verificarCliente(cliente_id, negocio_id);
  await _verificarPrestatario(prestatario_id, negocio_id);

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

// ─── Servicio: crear múltiples préstamos ──────────────────────────────────────

const crearPrestamos = async ({
  sucursal_id, usuario_id, negocio_id,
  prestatario, cedula, telefono,
  prestatario_id, empleado_id, cliente_id,
  items,
  aplicar_saldo_favor = false,
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
      const esSerial   = !!item.imei;
      const productoId = esSerial ? null : (item.producto_id || null);

      const prestamo = await repo.create(client, {
        sucursal_id, usuario_id, prestatario, cedula, telefono,
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

    // ── Aplicar saldo a favor dentro de la misma transacción ─────────────────
    if (aplicar_saldo_favor && (prestatario_id || cliente_id)) {
      const tipo      = prestatario_id ? 'prestatario' : 'cliente';
      const personaId = prestatario_id || cliente_id;

      let saldoRestante = await repo.getSaldoAFavorPersona(client, tipo, personaId);

      if (saldoRestante > 0) {
        for (const prestamo of prestamosCreados) {
          if (saldoRestante <= 0) break;

          const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
          if (saldoPendiente <= 0) continue;

          const montoAbono = Math.min(saldoRestante, saldoPendiente);
          const resultado  = await repo.insertarAbono(client, {
            prestamo_id: prestamo.id,
            valor:       montoAbono,
            metodo:      'Saldo a favor',
          });
          saldoRestante -= montoAbono;

          if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
            await repo.updateEstado(client, prestamo.id, 'Saldado');
            if (prestamo.imei) {
              await repo.salarSerial(client, prestamo.imei, sucursal_id);
            }
          }
        }

        await repo.setearSaldoAFavorPersona(client, tipo, personaId, saldoRestante);
      }
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

// ─── Servicio: registrar/actualizar saldo a favor de una persona ──────────────

const registrarSaldoAFavor = async (negocioId, tipo, personaId, monto) => {
  if (tipo === 'prestatario') {
    await _verificarPrestatario(personaId, negocioId);
  } else {
    await _verificarCliente(personaId, negocioId);
  }

  await repo.setearSaldoAFavorPersona(pool, tipo, personaId, monto);
  return { saldo_a_favor: monto };
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

    let saldado    = false;
    let factura_id = null;

    if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
      saldado = true;
      await repo.updateEstado(client, prestamoId, 'Saldado');

      // Crear factura automáticamente al saldar
      factura_id = await _crearFacturaDesdePrestamo(client, prestamo, metodo, negocioId);
    }

    await client.query('COMMIT');

    return {
      ...resultado,
      saldado,
      factura_id,
    };
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

// ─── Servicio: devolución parcial ─────────────────────────────────────────────

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

// ─── Servicio: intercambio — pago con producto (retoma) ───────────────────────
// El prestatario entrega un producto en vez de pagar en efectivo.
// El producto retomado ingresa al inventario y su valor se aplica como abono
// sobre el préstamo existente (no se crea un préstamo nuevo).

const intercambiarPrestamo = async (negocioId, prestamoId, {
  tipo_retoma = 'serial',    // 'serial' | 'cantidad'

  // Retoma serial
  imei_retoma,               // IMEI del equipo que entrega el prestatario
  producto_serial_id,        // FK a productos_serial (tipo/línea del equipo)
  color_retoma,

  // Retoma cantidad
  producto_cantidad_id,      // FK a productos_cantidad
  cantidad_retoma = 1,

  // Comunes
  valor_retoma,
  costo_retoma = 0,
  descripcion,
  ingreso_inventario = true, // si false: solo aplica el valor como abono, sin tocar inventario
}) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  if (prestamo.estado !== 'Activo') {
    throw { status: 400, message: 'Solo se pueden aplicar intercambios a préstamos activos' };
  }

  const sucursalId     = prestamo.sucursal_id;
  const nombrePersona  = prestamo.prestatario || '';
  const tipoPers       = prestamo.prestatario_id ? 'prestatario' : 'cliente';
  const personaId      = prestamo.prestatario_id || prestamo.cliente_id;
  const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolver nombre del producto retomado
    let nombreProductoRetoma = descripcion || 'Producto retomado';
    if (tipo_retoma === 'serial' && producto_serial_id) {
      const { rows } = await client.query(
        'SELECT nombre FROM productos_serial WHERE id = $1',
        [producto_serial_id],
      );
      nombreProductoRetoma = rows[0]?.nombre || nombreProductoRetoma;
    } else if (tipo_retoma === 'cantidad' && producto_cantidad_id) {
      const { rows } = await client.query(
        'SELECT nombre FROM productos_cantidad WHERE id = $1',
        [producto_cantidad_id],
      );
      nombreProductoRetoma = rows[0]?.nombre || nombreProductoRetoma;
    }

    // 2. Ingresar producto retomado al inventario (si aplica)
    let retomaIngresoReal = false;

    if (ingreso_inventario) {
      if (tipo_retoma === 'serial' && imei_retoma && producto_serial_id) {
        const { rows: psRows } = await client.query(
          'SELECT id FROM productos_serial WHERE id = $1 AND sucursal_id = $2',
          [producto_serial_id, sucursalId],
        );
        if (!psRows.length) {
          throw { status: 400, message: 'El producto serial no pertenece a esta sucursal' };
        }
        await repo.insertarSerialParaRetoma(client, {
          producto_id:    producto_serial_id,
          imei:           imei_retoma.trim(),
          costo_compra:   Number(costo_retoma) || 0,
          color:          color_retoma || null,
          cliente_origen: nombrePersona,
        });
        retomaIngresoReal = true;

      } else if (tipo_retoma === 'cantidad' && producto_cantidad_id) {
        const { rows: pcRows } = await client.query(
          'SELECT sucursal_id FROM productos_cantidad WHERE id = $1',
          [producto_cantidad_id],
        );
        if (!pcRows.length || pcRows[0].sucursal_id !== sucursalId) {
          throw { status: 400, message: 'El producto no pertenece a esta sucursal' };
        }
        await repo.ajustarStockConHistorialEnTx(client, {
          producto_id:    producto_cantidad_id,
          sucursal_id:    sucursalId,
          cantidad:       Number(cantidad_retoma || 1),
          costo_unitario: Number(costo_retoma) || null,
          cliente_origen: nombrePersona,
          tipo:           'retoma',
        });
        retomaIngresoReal = true;
      }
    }

    // 3. Registrar la retoma en la tabla retomas
    await repo.insertarRetoma(client, {
      prestamo_id:         prestamoId,
      nombre_producto:     nombreProductoRetoma,
      imei:                tipo_retoma === 'serial' ? (imei_retoma || null) : null,
      valor_retoma:        Number(valor_retoma),
      cantidad_retoma:     tipo_retoma === 'cantidad' ? Number(cantidad_retoma || 1) : 1,
      descripcion:         descripcion || `Retoma de ${nombreProductoRetoma} — ${nombrePersona}`,
      ingreso_inventario:  retomaIngresoReal,
      tipo_retoma,
      producto_serial_id:   tipo_retoma === 'serial'   ? (producto_serial_id   || null) : null,
      producto_cantidad_id: tipo_retoma === 'cantidad' ? (producto_cantidad_id || null) : null,
      costo_retoma:        Number(costo_retoma) || 0,
      color:               color_retoma || null,
    });

    // 4. Aplicar el valor de retoma como abono sobre el préstamo existente
    const montoAbono = Math.min(Number(valor_retoma), saldoPendiente);
    const resultado  = await repo.insertarAbono(client, {
      prestamo_id: prestamoId,
      valor:       montoAbono,
      metodo:      'Intercambio',
    });

    let saldado       = false;
    let factura_id    = null;
    let saldo_a_favor = 0;

    if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
      saldado    = true;
      await repo.updateEstado(client, prestamoId, 'Saldado');
      factura_id = await _crearFacturaDesdePrestamo(client, prestamo, 'Intercambio', negocioId);
    }

    if (Number(valor_retoma) > saldoPendiente && personaId) {
      const excess      = Number(valor_retoma) - saldoPendiente;
      const saldoActual = await repo.getSaldoAFavorPersona(client, tipoPers, personaId);
      await repo.setearSaldoAFavorPersona(client, tipoPers, personaId, saldoActual + excess);
      saldo_a_favor = excess;
    }

    await client.query('COMMIT');

    return {
      prestamo_id:     prestamoId,
      valor_retoma:    Number(valor_retoma),
      montoAbono,
      saldado,
      factura_id,
      saldo_a_favor,
      saldo_pendiente: saldado ? 0 : Math.max(0, saldoPendiente - montoAbono),
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
  registrarSaldoAFavor,
  intercambiarPrestamo,
};