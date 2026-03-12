const { pool } = require('../../config/db');
const comprasRepo  = require('./compras.repository');
const cantidadRepo = require('../productos/productosCantidad.repository');

const getCompras            = (sucursalId) => comprasRepo.findAll(sucursalId);
const getComprasByProveedor = (proveedorId, sucursalId) => comprasRepo.findByProveedor(proveedorId, sucursalId);

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
      console.log('registrarCompra payload:', JSON.stringify({ proveedor_id, agregarComoAcreedor, pagos, total }));

      if (linea.imei) {
        const { rows: existente } = await client.query(
          'SELECT id FROM seriales WHERE imei = $1',
          [linea.imei]
        );
        if (existente.length > 0) {
          throw { status: 409, message: `El IMEI ${linea.imei} ya existe en el inventario` };
        }
        await client.query(
          `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra)
           VALUES ($1, $2, $3, $4)`,
          [linea.producto_id, linea.imei, new Date().toISOString().split('T')[0], linea.precio_unitario]
        );
      } else if (linea.producto_id) {
        await cantidadRepo.ajustarStock(linea.producto_id, linea.cantidad);
      }
    }

    if (agregarComoAcreedor && proveedor_id) {
  const totalPagado = pagos
    .filter((p) => p.metodo !== 'Credito' && p.metodo !== 'Fiado')
    .reduce((s, p) => s + Number(p.valor || 0), 0);
  const montoCargo = total - totalPagado;

  if (montoCargo > 0) {
    const { rows: provRows } = await client.query(
      'SELECT nombre, nit, telefono FROM proveedores WHERE id = $1',
      [proveedor_id]
    );
    const prov = provRows[0];

    // Buscar acreedor vinculado directamente por proveedor_id (más robusto)
    // Si no existe, buscarlo por cedula/nit como fallback
    // Si tampoco existe, crearlo y vincularlo
    const { rows: acrRows } = await client.query(
      `SELECT id FROM acreedores 
       WHERE negocio_id = $1 
         AND (proveedor_id = $2 OR cedula = $3)
       LIMIT 1`,
      [negocio_id, proveedor_id, prov?.nit || '000000']
    );

    let acreedorId;
    if (acrRows.length > 0) {
      acreedorId = acrRows[0].id;

      // Si lo encontró por cedula pero sin proveedor_id vinculado, vincularlo ahora
      await client.query(
        `UPDATE acreedores SET proveedor_id = $1 
         WHERE id = $2 AND proveedor_id IS NULL`,
        [proveedor_id, acreedorId]
      );
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