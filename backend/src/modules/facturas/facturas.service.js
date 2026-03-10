const { pool } = require('../../config/db');
const facturasRepo = require('./facturas.repository');
const serialRepo   = require('../productos/productosSerial.repository');
const cantidadRepo = require('../productos/productosCantidad.repository');

const getFacturas = (sucursalId) => facturasRepo.findAll(sucursalId);

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

const crearFactura = async ({ sucursal_id, usuario_id, nombre_cliente, cedula, celular, notas, lineas, pagos, retoma }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const factura = await facturasRepo.create(client, {
      sucursal_id, usuario_id, cliente_id: null,
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
        await client.query(
          'UPDATE seriales SET vendido = true, fecha_salida = CURRENT_DATE WHERE imei = $1',
          [linea.imei]
        );
      } else if (linea.producto_id) {
        const producto = await cantidadRepo.findById(linea.producto_id);
        if (!producto) throw { status: 404, message: `Producto ${linea.nombre_producto} no encontrado` };
        if (producto.stock < linea.cantidad) {
          throw { status: 400, message: `Stock insuficiente para ${linea.nombre_producto}` };
        }
        await cantidadRepo.ajustarStock(linea.producto_id, -linea.cantidad);
      }
    }

    if (pagos && pagos.length > 0) {
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

      if (retoma.ingreso_inventario && retoma.imei && retoma.producto_id) {
        const existeSerial = await serialRepo.findSerialByIMEI(retoma.imei);
        if (existeSerial) {
          await client.query(
            'UPDATE seriales SET vendido = false, fecha_salida = NULL, cliente_origen = $1 WHERE imei = $2',
            [nombre_cliente, retoma.imei]
          );
        } else {
          await serialRepo.insertarSerial({
            producto_id:    retoma.producto_id,
            imei:           retoma.imei,
            fecha_entrada:  new Date().toISOString().split('T')[0],
            costo_compra:   retoma.valor_retoma,
            cliente_origen: nombre_cliente,
          });
        }
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

const cancelarFactura = async (negocioId, id) => {
  const valida = await facturasRepo.perteneceAlNegocio(id, negocioId);
  if (!valida) throw { status: 404, message: 'Factura no encontrada' };

  const factura = await facturasRepo.findById(id);
  if (factura.estado === 'Cancelada') throw { status: 400, message: 'La factura ya está cancelada' };

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

module.exports = { getFacturas, getFacturaById, crearFactura, cancelarFactura };