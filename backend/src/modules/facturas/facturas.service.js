const { pool } = require('../../config/db');
const facturasRepo = require('./facturas.repository');
const serialRepo   = require('../productos/productosSerial.repository');
const cantidadRepo = require('../productos/productosCantidad.repository');
const clientesRepo = require('../clientes/clientes.repository');
const cajaRepo     = require('../caja/caja.repository');
const { enviarFactura } = require('../email/email.service');

const ES_COMPANERO = (cedula) => cedula === 'COMPANERO';

const _fechaHoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── Verifica que un producto_cantidad_id pertenece al negocio ─────────────────
const _verificarProductoCantidadNegocio = async (client, productoId, negocioId) => {
  const { rows } = await client.query(
    `SELECT pc.id FROM productos_cantidad pc
     JOIN sucursales su ON su.id = pc.sucursal_id
     WHERE pc.id = $1 AND su.negocio_id = $2`,
    [productoId, negocioId]
  );
  if (!rows.length) {
    throw { status: 403, message: 'El producto de retoma no pertenece a este negocio' };
  }
};

const resolverClienteId = async (client, negocioId, { cedula, nombre, celular, email, direccion }) => {
  if (ES_COMPANERO(cedula)) return null;
  const { rows } = await client.query(
    `SELECT id FROM clientes WHERE cedula = $1 AND negocio_id = $2`,
    [cedula, negocioId]
  );
  if (rows.length) return rows[0].id;
  const { rows: nuevos } = await client.query(
    `INSERT INTO clientes (negocio_id, nombre, cedula, celular, email, direccion)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [negocioId, nombre, cedula, celular || null, email || null, direccion || null]
  );
  return nuevos[0].id;
};

const getFacturas = (sucursalId, negocioId) =>
  facturasRepo.findAll(sucursalId, negocioId);

const getFacturaById = async (negocioId, id) => {
  const factura = await facturasRepo.findByIdYNegocio(id, negocioId);
  if (!factura) throw { status: 404, message: 'Factura no encontrada' };
  const [lineas, pagos, retomas] = await Promise.all([
    facturasRepo.getLineas(id),
    facturasRepo.getPagos(id),
    facturasRepo.getRetomas(id),
  ]);
  return { ...factura, lineas, pagos, retomas };
};

const crearFactura = async ({
  negocio_id, sucursal_id, usuario_id,
  nombre_cliente, cedula, celular, email, direccion, notas,
  lineas, pagos, retomas = [],
}) => {
  const { rows: sucRows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!sucRows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cliente_id = await resolverClienteId(client, negocio_id, {
      cedula, nombre: nombre_cliente, celular, email, direccion,
    });

    const factura = await facturasRepo.create(client, {
      sucursal_id, usuario_id, cliente_id,
      nombre_cliente, cedula, celular, notas,
    });

    for (const linea of lineas) {
      await facturasRepo.insertarLinea(client, {
        factura_id:      factura.id,
        nombre_producto: linea.nombre_producto,
        imei:            linea.imei        || null,
        cantidad:        linea.cantidad,
        precio:          linea.precio,
        producto_id:     linea.producto_id || null,
      });

      if (linea.imei) {
        const { rows: serialRows } = await client.query(
          `SELECT s.id FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           WHERE s.imei = $1 AND ps.sucursal_id = $2`,
          [linea.imei, sucursal_id]
        );
        if (!serialRows.length) {
          throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
        }
        await client.query(
          'UPDATE seriales SET vendido = true, fecha_salida = CURRENT_DATE WHERE id = $1',
          [serialRows[0].id]
        );
      } else if (linea.producto_id) {
        const { rows: prodRows } = await client.query(
          `SELECT id, stock, sucursal_id FROM productos_cantidad WHERE id = $1`,
          [linea.producto_id]
        );
        const producto = prodRows[0];
        if (!producto) throw { status: 404, message: `Producto ${linea.nombre_producto} no encontrado` };
        if (producto.sucursal_id !== sucursal_id) {
          throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
        }
        if (producto.stock < linea.cantidad) {
          throw { status: 400, message: `Stock insuficiente para ${linea.nombre_producto}` };
        }
        await facturasRepo.ajustarStockCantidad(client, linea.producto_id, -linea.cantidad);
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

    for (const retoma of retomas) {
      await facturasRepo.insertarRetoma(client, {
        factura_id:         factura.id,
        descripcion:        retoma.descripcion,
        valor_retoma:       retoma.valor_retoma,
        ingreso_inventario: retoma.ingreso_inventario || false,
        nombre_producto:    retoma.nombre_producto    || null,
        imei:               retoma.imei               || null,
      });

      if (retoma.ingreso_inventario && retoma.tipo_retoma === 'serial' && retoma.imei) {
        const { rows: existeRows } = await client.query(
          `SELECT s.id FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           JOIN sucursales       su ON su.id = ps.sucursal_id
           WHERE s.imei = $1 AND su.negocio_id = $2 LIMIT 1`,
          [retoma.imei, negocio_id]
        );
        const existeSerial = existeRows[0] || null;

        if (retoma.reactivar_serial_id) {
          const { rows: serialCheck } = await client.query(
            `SELECT s.id FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             JOIN sucursales       su ON su.id = ps.sucursal_id
             WHERE s.id = $1 AND su.negocio_id = $2`,
            [retoma.reactivar_serial_id, negocio_id]
          );
          if (!serialCheck.length) {
            throw { status: 403, message: 'El serial a reactivar no pertenece a este negocio' };
          }
          await client.query(
            `UPDATE seriales SET vendido = false, prestado = false,
             fecha_salida = NULL, cliente_origen = $1 WHERE id = $2`,
            [nombre_cliente, retoma.reactivar_serial_id]
          );
        } else if (existeSerial) {
          if (retoma.producto_serial_id) {
            await client.query(
              `UPDATE seriales SET vendido = false, prestado = false,
               fecha_salida = NULL, cliente_origen = $1 WHERE id = $2`,
              [nombre_cliente, existeSerial.id]
            );
          }
        } else if (retoma.producto_serial_id) {
          const { rows: psCheck } = await client.query(
            `SELECT ps.id FROM productos_serial ps
             JOIN sucursales su ON su.id = ps.sucursal_id
             WHERE ps.id = $1 AND su.negocio_id = $2`,
            [retoma.producto_serial_id, negocio_id]
          );
          if (!psCheck.length) {
            throw { status: 403, message: 'El producto de retoma no pertenece a este negocio' };
          }
          await client.query(
            `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, cliente_origen)
             VALUES ($1, $2, $3, $4, $5)`,
            [retoma.producto_serial_id, retoma.imei,
             _fechaHoy(), retoma.valor_retoma, nombre_cliente]
          );
        }
      }

      if (retoma.ingreso_inventario && retoma.tipo_retoma === 'cantidad' && retoma.producto_cantidad_id) {
        await _verificarProductoCantidadNegocio(client, retoma.producto_cantidad_id, negocio_id);
        await facturasRepo.ajustarStockCantidad(
          client, retoma.producto_cantidad_id, Number(retoma.cantidad_retoma || 1)
        );
      }
    }

    await client.query('COMMIT');

    // ── Enviar factura por email — fire and forget, nunca bloquea ────────────
    if (email) {
      (async () => {
        try {
          const { rows: configRows } = await pool.query(
            `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`,
            [negocio_id]
          );
          const configMap = {};
          for (const row of configRows) configMap[row.clave] = row.valor;

          if (configMap.campo_email_cliente === '1') {
            const [lineasEmail, pagosEmail, retomasEmail] = await Promise.all([
              facturasRepo.getLineas(factura.id),
              facturasRepo.getPagos(factura.id),
              facturasRepo.getRetomas(factura.id),
            ]);
            await enviarFactura(
              { ...factura, lineas: lineasEmail, pagos: pagosEmail, retomas: retomasEmail, email },
              configMap
            );
          }
        } catch (err) {
          console.warn('[email] Error al enviar factura:', err?.message || err);
        }
      })();
    }

    return factura;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const cancelarFactura = async (negocioId, id) => {
  const factura = await facturasRepo.findByIdYNegocio(id, negocioId);
  if (!factura) throw { status: 404, message: 'Factura no encontrada' };
  if (factura.estado === 'Cancelada') throw { status: 400, message: 'La factura ya está cancelada' };

  // ── Obtener pagos antes de cancelar para saber cuánto devolver en caja ───
  const pagos = await facturasRepo.getPagos(id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lineas = await facturasRepo.getLineas(id);
    for (const linea of lineas) {
      if (linea.imei) {
        const { rows: serialRows } = await client.query(
          `SELECT s.id FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           JOIN facturas          f  ON f.sucursal_id = ps.sucursal_id
           WHERE s.imei = $1 AND f.id = $2`,
          [linea.imei, id]
        );
        if (serialRows.length) {
          await client.query(
            'UPDATE seriales SET vendido = false, fecha_salida = NULL WHERE id = $1',
            [serialRows[0].id]
          );
        }
      } else if (linea.producto_id) {
        await facturasRepo.ajustarStockCantidad(client, linea.producto_id, linea.cantidad);
      }
    }

    await facturasRepo.cancelar(client, id);

    // ── Registrar egreso en caja si hay caja abierta ─────────────────────────
    // Solo se devuelven los métodos que movieron caja física (excluye Crédito).
    // Se hace dentro de la transacción para que si falla la caja, se revierta todo.
    const METODOS_NO_CAJA = ['Credito'];
    const totalDevolucion = pagos
      .filter((p) => !METODOS_NO_CAJA.includes(p.metodo))
      .reduce((s, p) => s + Number(p.valor || 0), 0);

    if (totalDevolucion > 0) {
      const caja = await cajaRepo.findCajaAbierta(factura.sucursal_id);
      if (caja) {
        await client.query(
          `INSERT INTO movimientos_caja(caja_id, tipo, concepto, valor, referencia_id, referencia_tipo)
           VALUES ($1, 'Egreso', $2, $3, $4, 'factura_cancelada')`,
          [
            caja.id,
            `Devolución factura #${String(id).padStart(6, '0')} — ${factura.nombre_cliente}`,
            totalDevolucion,
            id,
          ]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const editarFactura = async (negocioId, id, {
  nombre_cliente, cedula, celular, email, direccion, notas,
  lineas, pagos, retoma,
}) => {
  const facturaActual = await facturasRepo.findByIdYNegocio(id, negocioId);
  if (!facturaActual) throw { status: 404, message: 'Factura no encontrada' };
  if (facturaActual.estado === 'Cancelada') {
    throw { status: 400, message: 'No se puede editar una factura cancelada' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cliente_id = await resolverClienteId(client, negocioId, {
      cedula, nombre: nombre_cliente, celular, email, direccion,
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
          const { rows: existeRows } = await client.query(
            `SELECT s.id FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             JOIN sucursales       su ON su.id = ps.sucursal_id
             WHERE s.imei = $1 AND su.negocio_id = $2 LIMIT 1`,
            [retoma.imei, negocioId]
          );
          const existeSerial = existeRows[0] || null;

          if (retoma.producto_serial_id) {
            if (existeSerial) {
              await client.query(
                `UPDATE seriales
                 SET vendido = false, fecha_salida = NULL, cliente_origen = $1
                 WHERE id = $2`,
                [nombre_cliente, existeSerial.id]
              );
            } else {
              const { rows: psCheck } = await client.query(
                `SELECT ps.id FROM productos_serial ps
                 JOIN sucursales su ON su.id = ps.sucursal_id
                 WHERE ps.id = $1 AND su.negocio_id = $2`,
                [retoma.producto_serial_id, negocioId]
              );
              if (!psCheck.length) {
                throw { status: 403, message: 'El producto de retoma no pertenece a este negocio' };
              }
              await client.query(
                `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, cliente_origen)
                 VALUES ($1, $2, $3, $4, $5)`,
                [retoma.producto_serial_id, retoma.imei,
                 _fechaHoy(), retoma.valor_retoma, nombre_cliente]
              );
            }
          }
        }

        if (retoma.tipo_retoma === 'cantidad' && retoma.producto_cantidad_id) {
          await _verificarProductoCantidadNegocio(client, retoma.producto_cantidad_id, negocioId);
          await facturasRepo.ajustarStockCantidad(
            client, retoma.producto_cantidad_id, Number(retoma.cantidad_retoma || 1)
          );
        }
      }
    }

    await client.query('COMMIT');
    return await facturasRepo.findByIdYNegocio(id, negocioId);
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