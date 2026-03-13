const { pool } = require('../../config/db');
const comprasRepo  = require('./compras.repository');
const cantidadRepo = require('../productos/productosCantidad.repository');

const getCompras = (sucursalId, negocioId) =>
  comprasRepo.findAll(sucursalId, negocioId);

const getComprasByProveedor = (proveedorId, sucursalId, negocioId) =>
  comprasRepo.findByProveedor(proveedorId, sucursalId, negocioId);

const getCompraById = async (negocioId, id) => {
  const valida = await comprasRepo.perteneceAlNegocio(id, negocioId);
  if (!valida) throw { status: 404, message: 'Compra no encontrada' };
  const compra = await comprasRepo.findById(id);
  const lineas = await comprasRepo.getLineas(id);
  return { ...compra, lineas };
};

const registrarCompra = async ({
  negocio_id, sucursal_id, usuario_id, proveedor_id,
  numero_factura, notas, lineas,
  total: totalRecibido, pagos = [], agregarComoAcreedor = false,
}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const total = totalRecibido ||
      lineas.reduce((sum, l) => sum + l.cantidad * l.precio_unitario, 0);

    const compra = await comprasRepo.create(client, {
      sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas,
    });

    for (const linea of lineas) {
      await comprasRepo.insertarLinea(client, {
        compra_id:         compra.id,
        nombre_producto:   linea.nombre_producto,
        imei:              linea.imei              || null,
        cantidad:          linea.cantidad,
        precio_unitario:   linea.precio_unitario,
        precio_usd:        linea.precio_usd        || null,
        factor_conversion: linea.factor_conversion || null,
        valor_traida:      linea.valor_traida      || null,
      });

      if (linea.imei) {
        if (linea.reactivar_serial_id) {
          // Reactivar serial existente — verificar que pertenezca a esta sucursal
          const { rows } = await client.query(
            `SELECT s.id FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             WHERE s.id = $1 AND ps.sucursal_id = $2`,
            [linea.reactivar_serial_id, sucursal_id]
          );
          if (!rows.length) {
            throw { status: 400, message: `El serial ${linea.imei} no pertenece a esta sucursal` };
          }
          await client.query(
            `UPDATE seriales
             SET vendido      = false,
                 prestado     = false,
                 fecha_salida = NULL,
                 costo_compra = $1,
                 proveedor_id = COALESCE($2, proveedor_id)
             WHERE id = $3`,
            [linea.precio_unitario, proveedor_id || null, linea.reactivar_serial_id]
          );

        } else {
          // Serial nuevo — verificar que no exista antes de insertar
          const { rows: existente } = await client.query(
            'SELECT id FROM seriales WHERE imei = $1',
            [linea.imei]
          );
          if (existente.length) {
            throw { status: 409, message: `El IMEI ${linea.imei} ya existe en el inventario` };
          }

          // ── FIX: verificar que producto_serial pertenezca a esta sucursal ──
          if (linea.producto_id) {
            const { rows: psRows } = await client.query(
              'SELECT id FROM productos_serial WHERE id = $1 AND sucursal_id = $2',
              [linea.producto_id, sucursal_id]
            );
            if (!psRows.length) {
              throw {
                status: 400,
                message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal`,
              };
            }
          }

          await client.query(
            `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, proveedor_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              linea.producto_id,
              linea.imei,
              new Date().toISOString().split('T')[0],
              linea.precio_unitario,
              proveedor_id || null,
            ]
          );
        }

      } else if (linea.producto_id) {
        // ── FIX: verificar que producto_cantidad pertenezca a esta sucursal ──
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

        await cantidadRepo.ajustarStock(linea.producto_id, linea.cantidad);

        if (proveedor_id) {
          await client.query(
            `UPDATE productos_cantidad
             SET proveedor_id = $1
             WHERE id = $2 AND proveedor_id IS NULL`,
            [proveedor_id, linea.producto_id]
          );
        }
      }
    }

    if (agregarComoAcreedor && proveedor_id) {
      const totalPagado = pagos
        .filter(p => p.metodo !== 'Credito' && p.metodo !== 'Fiado')
        .reduce((s, p) => s + Number(p.valor || 0), 0);
      const montoCargo = total - totalPagado;

      if (montoCargo > 0) {
        const { rows: provRows } = await client.query(
          'SELECT nombre, nit, telefono FROM proveedores WHERE id = $1',
          [proveedor_id]
        );
        const prov = provRows[0];

        let { rows: acrRows } = await client.query(
          `SELECT id FROM acreedores
           WHERE negocio_id = $1 AND proveedor_id = $2
           LIMIT 1`,
          [negocio_id, proveedor_id]
        );

        if (acrRows.length === 0 && prov?.nit) {
          const { rows: acrPorCedula } = await client.query(
            `SELECT id FROM acreedores
             WHERE negocio_id = $1 AND cedula = $2
             LIMIT 1`,
            [negocio_id, prov.nit]
          );
          if (acrPorCedula.length) {
            acrRows = acrPorCedula;
            await client.query(
              `UPDATE acreedores SET proveedor_id = $1
               WHERE id = $2 AND proveedor_id IS NULL`,
              [proveedor_id, acrPorCedula[0].id]
            );
          }
        }

        let acreedorId;
        if (acrRows.length) {
          acreedorId = acrRows[0].id;
        } else {
          const cedulaFinal = prov?.nit || `prov-${proveedor_id}`;
          const { rows: nuevoRows } = await client.query(
            `INSERT INTO acreedores(negocio_id, nombre, cedula, telefono, proveedor_id)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [negocio_id, prov?.nombre, cedulaFinal, prov?.telefono || '', proveedor_id]
          );
          acreedorId = nuevoRows[0].id;
        }

        await client.query(
          `INSERT INTO movimientos_acreedor(acreedor_id, tipo, descripcion, valor)
           VALUES ($1, 'Cargo', $2, $3)`,
          [acreedorId, `Compra #${compra.id} — mercancía`, montoCargo]
        );
      }
    }

    await client.query('COMMIT');
    return compra;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { getCompras, getCompraById, getComprasByProveedor, registrarCompra };