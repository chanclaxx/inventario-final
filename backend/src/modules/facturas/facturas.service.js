const { pool } = require('../../config/db');
const facturasRepo  = require('./facturas.repository');
const serialRepo    = require('../productos/productosSerial.repository');
const cantidadRepo  = require('../productos/productosCantidad.repository');
const clientesRepo  = require('../clientes/clientes.repository');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ES_COMPANERO = (cedula) => cedula === 'COMPANERO';

/**
 * Busca el cliente por cédula dentro de la transacción.
 * Si no existe lo crea. Retorna siempre el cliente_id.
 * Para compañeros retorna null sin consultar la DB.
 */
const resolverClienteId = async (client, negocioId, { cedula, nombre, celular, email, direccion }) => {
  if (ES_COMPANERO(cedula)) return null;

  const { rows } = await client.query(
    `SELECT id FROM clientes WHERE cedula = $1 AND negocio_id = $2`,
    [cedula, negocioId]
  );

  if (rows.length) return rows[0].id;

  const { rows: nuevos } = await client.query(
    `INSERT INTO clientes (negocio_id, nombre, cedula, celular, email, direccion)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [negocioId, nombre, cedula, celular || null, email || null, direccion || null]
  );
  return nuevos[0].id;
};

// ─── Queries de solo lectura (sin transacción) ────────────────────────────────

const getFacturas = (sucursalId, negocioId) =>
  facturasRepo.findAll(sucursalId, negocioId);

const getFacturaById = async (negocioId, id) => {
  const valida = await facturasRepo.perteneceAlNegocio(id, negocioId);
  if (!valida) throw { status: 404, message: 'Factura no encontrada' };

  const factura = await facturasRepo.findById(id);
  const [lineas, pagos, retoma] = await Promise.all([
    facturasRepo.getLineas(id),
    facturasRepo.getPagos(id),
    facturasRepo.getRetoma(id),
  ]);
  return { ...factura, lineas, pagos, retoma };
};

// ─── Crear factura ────────────────────────────────────────────────────────────

const crearFactura = async ({
  negocio_id, sucursal_id, usuario_id,
  nombre_cliente, cedula, celular, email, direccion, notas,
  lineas, pagos, retoma,
}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cliente_id = await resolverClienteId(client, negocio_id, {
      cedula,
      nombre: nombre_cliente,
      celular,
      email,
      direccion,
    });

    const factura = await facturasRepo.create(client, {
      sucursal_id, usuario_id, cliente_id,
      nombre_cliente, cedula, celular, notas,
    });

    for (const linea of lineas) {
      await facturasRepo.insertarLinea(client, {
        factura_id:      factura.id,
        nombre_producto: linea.nombre_producto,
        imei:            linea.imei || null,
        cantidad:        linea.cantidad,
        precio:          linea.precio,
      });

      if (linea.imei) {
        const { rows: serialRows } = await client.query(
          `SELECT s.id FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           WHERE s.imei = $1 AND ps.sucursal_id = $2`,
          [linea.imei, sucursal_id]
        );
        if (!serialRows.length) {
          throw {
            status: 400,
            message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal`,
          };
        }
        await client.query(
          'UPDATE seriales SET vendido = true, fecha_salida = CURRENT_DATE WHERE imei = $1',
          [linea.imei]
        );

      } else if (linea.producto_id) {
        const producto = await cantidadRepo.findById(linea.producto_id);
        if (!producto) {
          throw { status: 404, message: `Producto ${linea.nombre_producto} no encontrado` };
        }
        if (producto.sucursal_id !== sucursal_id) {
          throw {
            status: 400,
            message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal`,
          };
        }
        if (producto.stock < linea.cantidad) {
          throw { status: 400, message: `Stock insuficiente para ${linea.nombre_producto}` };
        }
        await cantidadRepo.ajustarStock(linea.producto_id, -linea.cantidad);
      }
    }

    if (pagos?.length) {
      for (const pago of pagos) {
        if (pago.valor > 0) {
          await facturasRepo.insertarPago(client, {
            factura_id: factura.id,
            metodo:     pago.metodo,
            valor:      pago.valor,
          });
        }
      }
    }

    if (retoma) {
      await facturasRepo.insertarRetoma(client, {
        factura_id:         factura.id,
        descripcion:        retoma.descripcion,
        valor_retoma:       retoma.valor_retoma,
        ingreso_inventario: retoma.ingreso_inventario || false,
        nombre_producto:    retoma.nombre_producto    || null,
        imei:               retoma.imei               || null,
      });

      if (retoma.ingreso_inventario && retoma.tipo_retoma === 'serial' && retoma.imei) {
        const existeSerial = await serialRepo.findSerialByIMEI(retoma.imei);

        if (retoma.reactivar_serial_id) {
          await client.query(
            `UPDATE seriales
             SET vendido = false, prestado = false, fecha_salida = NULL, cliente_origen = $1
             WHERE id = $2`,
            [nombre_cliente, retoma.reactivar_serial_id]
          );
        } else if (existeSerial) {
          if (retoma.producto_serial_id) {
            await client.query(
              `UPDATE seriales
               SET vendido = false, prestado = false, fecha_salida = NULL, cliente_origen = $1
               WHERE imei = $2`,
              [nombre_cliente, retoma.imei]
            );
          }
        } else if (retoma.producto_serial_id) {
          await serialRepo.insertarSerial({
            producto_id:    retoma.producto_serial_id,
            imei:           retoma.imei,
            fecha_entrada:  new Date().toISOString().split('T')[0],
            costo_compra:   retoma.valor_retoma,
            cliente_origen: nombre_cliente,
          });
        }
      }

      if (retoma.ingreso_inventario && retoma.tipo_retoma === 'cantidad' && retoma.producto_cantidad_id) {
        await cantidadRepo.ajustarStock(
          retoma.producto_cantidad_id,
          Number(retoma.cantidad_retoma || 1)
        );
      }
    }

    await client.query('COMMIT');
    return factura;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Cancelar factura ─────────────────────────────────────────────────────────

const cancelarFactura = async (negocioId, id) => {
  const valida = await facturasRepo.perteneceAlNegocio(id, negocioId);
  if (!valida) throw { status: 404, message: 'Factura no encontrada' };

  const factura = await facturasRepo.findById(id);
  if (factura.estado === 'Cancelada') {
    throw { status: 400, message: 'La factura ya está cancelada' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lineas = await facturasRepo.getLineas(id);
    for (const linea of lineas) {
      if (linea.imei) {
        await client.query(
          'UPDATE seriales SET vendido = false, fecha_salida = NULL WHERE imei = $1',
          [linea.imei]
        );
      } else {
        const { rows } = await client.query(
          'SELECT id FROM productos_cantidad WHERE nombre ILIKE $1 AND sucursal_id = $2',
          [linea.nombre_producto, factura.sucursal_id]
        );
        if (rows[0]) await cantidadRepo.ajustarStock(rows[0].id, linea.cantidad);
      }
    }

    await facturasRepo.cancelar(client, id);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Editar factura ───────────────────────────────────────────────────────────

const editarFactura = async (negocioId, id, {
  nombre_cliente, cedula, celular, email, direccion, notas,
  lineas, pagos, retoma,
}) => {
  const valida = await facturasRepo.perteneceAlNegocio(id, negocioId);
  if (!valida) throw { status: 404, message: 'Factura no encontrada' };

  const facturaActual = await facturasRepo.findById(id);
  if (facturaActual.estado === 'Cancelada') {
    throw { status: 400, message: 'No se puede editar una factura cancelada' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cliente_id = await resolverClienteId(client, negocioId, {
      cedula,
      nombre: nombre_cliente,
      celular,
      email,
      direccion,
    });

    await client.query(
      `UPDATE facturas
       SET nombre_cliente = $1, cedula = $2, celular = $3, notas = $4, cliente_id = $5
       WHERE id = $6`,
      [nombre_cliente, cedula, celular, notas, cliente_id, id]
    );

    for (const linea of lineas) {
      await client.query(
        `UPDATE lineas_factura SET precio = $1, cantidad = $2
         WHERE id = $3 AND factura_id = $4`,
        [linea.precio, linea.cantidad, linea.id, id]
      );
    }

    await client.query('DELETE FROM pagos_factura WHERE factura_id = $1', [id]);
    for (const pago of pagos) {
      if (Number(pago.valor) > 0) {
        await facturasRepo.insertarPago(client, {
          factura_id: id,
          metodo:     pago.metodo,
          valor:      Number(pago.valor),
        });
      }
    }

    if (retoma) {
      await facturasRepo.insertarRetoma(client, {
        factura_id:         id,
        descripcion:        retoma.descripcion,
        valor_retoma:       retoma.valor_retoma,
        ingreso_inventario: retoma.ingreso_inventario || false,
        nombre_producto:    retoma.nombre_producto    || null,
        imei:               retoma.imei               || null,
      });

      if (retoma.ingreso_inventario) {
        if (retoma.tipo_retoma === 'serial' && retoma.imei) {
          const existeSerial = await serialRepo.findSerialByIMEI(retoma.imei);
          if (retoma.producto_serial_id) {
            if (existeSerial) {
              await client.query(
                `UPDATE seriales
                 SET vendido = false, fecha_salida = NULL, cliente_origen = $1
                 WHERE imei = $2`,
                [nombre_cliente, retoma.imei]
              );
            } else {
              await serialRepo.insertarSerial({
                producto_id:    retoma.producto_serial_id,
                imei:           retoma.imei,
                fecha_entrada:  new Date().toISOString().split('T')[0],
                costo_compra:   retoma.valor_retoma,
                cliente_origen: nombre_cliente,
              });
            }
          }
        }

        if (retoma.tipo_retoma === 'cantidad' && retoma.producto_cantidad_id) {
          await cantidadRepo.ajustarStock(
            retoma.producto_cantidad_id,
            Number(retoma.cantidad_retoma || 1)
          );
        }
      }
    }

    await client.query('COMMIT');
    return await facturasRepo.findById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getFacturas, getFacturaById, crearFactura, cancelarFactura, editarFactura,
};