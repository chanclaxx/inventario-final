const { pool }                  = require('../../config/db');
const comprasRepo               = require('./compras.repository');
const { calcularCostoPromedio } = require('../../utils/costoPromedio.util');
const variantesRepo             = require('../variantes-producto/variantes-producto.repository');

const getCompras = (sucursalId, negocioId, proveedorIds = null) =>
  comprasRepo.findAll(sucursalId, negocioId, proveedorIds);

const getComprasPaginadas = (sucursalId, negocioId, filtros) =>
  comprasRepo.findAllPaginado(sucursalId, negocioId, filtros);

const getComprasByProveedor = (proveedorId, sucursalId, negocioId) =>
  comprasRepo.findByProveedor(proveedorId, sucursalId, negocioId);

const getCompraById = async (negocioId, id) => {
  const compra = await comprasRepo.findByIdYNegocio(id, negocioId);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };
  const lineas = await comprasRepo.getLineas(id);
  return { ...compra, lineas };
};

// ── Helper: fecha local sin desfase UTC ───────────────────────────────────────
const _fechaHoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const registrarCompra = async ({
  negocio_id, sucursal_id, usuario_id, proveedor_id,
  numero_factura, notas, lineas,
  total: totalRecibido, pagos = [],
  registrar_en_caja = true,
}) => {
  // ── Verificar sucursal pertenece al negocio ──────────────────────────────
  const { rows: sucRows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!sucRows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  // ── Verificar proveedor pertenece al negocio ─────────────────────────────
  const { rows: provRows } = await pool.query(
    `SELECT id, nombre, nit, telefono FROM proveedores
     WHERE id = $1 AND negocio_id = $2 AND activo = true`,
    [proveedor_id, negocio_id]
  );
  if (!provRows.length) throw { status: 403, message: 'Proveedor no válido para este negocio' };
  const prov = provRows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const total = totalRecibido ||
      lineas.reduce((sum, l) => sum + l.cantidad * l.precio_unitario, 0);

      const metodoPago = pagos.length > 0 ? pagos[0].metodo : null;

    const compra = await comprasRepo.create(client, {
      sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas,
      registrar_en_caja, metodo: metodoPago,
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
        variante_id:       linea.variante_id       || null,
        atributo_id:       linea.atributo_id       || null,
      });

      if (linea.imei) {
        if (linea.reactivar_serial_id) {
          const { rows } = await client.query(
            `SELECT s.id FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             WHERE s.id = $1 AND ps.sucursal_id = $2`,
            [linea.reactivar_serial_id, sucursal_id]
          );
          if (!rows.length) {
            throw { status: 400, message: `El serial ${linea.imei} no pertenece a esta sucursal` };
          }
          // COALESCE preserva el color/caracteristicas existente si no viene uno nuevo
          await client.query(
            `UPDATE seriales
             SET vendido         = false,
                 prestado        = false,
                 fecha_salida    = NULL,
                 costo_compra    = $1,
                 proveedor_id    = COALESCE($2, proveedor_id),
                 color           = COALESCE($3, color),
                 caracteristicas = COALESCE($4, caracteristicas)
             WHERE id = $5`,
            [
              linea.precio_unitario,
              proveedor_id || null,
              linea.color || null,
              linea.caracteristicas ? JSON.stringify(linea.caracteristicas) : null,
              linea.reactivar_serial_id,
            ]
          );
        } else {
          const { rows: existente } = await client.query(
            `SELECT s.id FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             JOIN sucursales       su ON su.id = ps.sucursal_id
             WHERE s.imei = $1 AND su.negocio_id = $2`,
            [linea.imei, negocio_id]
          );
          if (existente.length) {
            throw { status: 409, message: `El IMEI ${linea.imei} ya existe en el inventario` };
          }

          if (linea.producto_id) {
            const { rows: psRows } = await client.query(
              'SELECT id FROM productos_serial WHERE id = $1 AND sucursal_id = $2',
              [linea.producto_id, sucursal_id]
            );
            if (!psRows.length) {
              throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
            }
          }

          await client.query(
            `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, proveedor_id, color, caracteristicas)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              linea.producto_id,
              linea.imei,
              _fechaHoy(),
              linea.precio_unitario,
              proveedor_id || null,
              linea.color  || null,
              linea.caracteristicas ? JSON.stringify(linea.caracteristicas) : null,
            ]
          );
        }

      } else if (linea.producto_id) {
        const { rows: prodRows } = await client.query(
          `SELECT id, stock, costo_unitario, sucursal_id FROM productos_cantidad WHERE id = $1`,
          [linea.producto_id]
        );
        const producto = prodRows[0];
        if (!producto) throw { status: 404, message: `Producto ${linea.nombre_producto} no encontrado` };
        if (producto.sucursal_id !== sucursal_id) {
          throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
        }

        if (linea.variante_id) {
          const { rows: varRows } = await client.query(
            'SELECT stock, costo_unitario FROM variantes_atributo WHERE id = $1',
            [linea.variante_id]
          );
          const variante = varRows[0];
          await variantesRepo.ajustarStockVarianteEnTx(client, linea.variante_id, linea.cantidad);
          await variantesRepo.sincronizarStockProductoEnTx(client, linea.producto_id);
          if (linea.precio_unitario != null && linea.precio_unitario > 0) {
            const costoPromedio = calcularCostoPromedio(
              variante.stock, variante.costo_unitario,
              linea.cantidad, linea.precio_unitario,
            );
            await variantesRepo.actualizarCostoVarianteEnTx(client, linea.variante_id, costoPromedio);
            await variantesRepo.sincronizarCostoProductoEnTx(client, linea.producto_id, costoPromedio);
          }
        } else if (linea.atributo_id) {
          const { rows: atrRows } = await client.query(
            'SELECT stock, costo_unitario FROM atributos_producto WHERE id = $1',
            [linea.atributo_id]
          );
          const atributo = atrRows[0];
          await variantesRepo.ajustarStockAtributoEnTx(client, linea.atributo_id, linea.cantidad);
          await variantesRepo.sincronizarStockProductoEnTx(client, linea.producto_id);
          if (linea.precio_unitario != null && linea.precio_unitario > 0) {
            const costoPromedio = calcularCostoPromedio(
              atributo.stock, atributo.costo_unitario,
              linea.cantidad, linea.precio_unitario,
            );
            await variantesRepo.actualizarCostoAtributoEnTx(client, linea.atributo_id, costoPromedio);
            await variantesRepo.sincronizarCostoProductoEnTx(client, linea.producto_id, costoPromedio);
          }
        } else {
          await comprasRepo.ajustarStockCantidad(client, linea.producto_id, linea.cantidad);
          if (linea.precio_unitario != null && linea.precio_unitario > 0) {
            const costoPromedio = calcularCostoPromedio(
              producto.stock, producto.costo_unitario,
              linea.cantidad, linea.precio_unitario,
            );
            await comprasRepo.actualizarCostoPromedio(client, linea.producto_id, costoPromedio);
          }
        }

        if (proveedor_id) {
          await client.query(
            `UPDATE productos_cantidad SET proveedor_id = $1
             WHERE id = $2 AND proveedor_id IS NULL`,
            [proveedor_id, linea.producto_id]
          );
        }
      }
    }

    // ── Acreedor ───────────────────────────────────────────────────────────
    if (proveedor_id) {
      const pagosEfectivos = pagos.filter((p) => p.metodo !== 'Credito' && p.metodo !== 'Fiado');
      const totalPagado    = pagosEfectivos.reduce((s, p) => s + Number(p.valor || 0), 0);

      let { rows: acrRows } = await client.query(
        `SELECT id FROM acreedores WHERE negocio_id = $1 AND proveedor_id = $2 LIMIT 1`,
        [negocio_id, proveedor_id]
      );

      if (acrRows.length === 0 && prov?.nit) {
        const { rows: acrPorCedula } = await client.query(
          `SELECT id FROM acreedores WHERE negocio_id = $1 AND cedula = $2 LIMIT 1`,
          [negocio_id, prov.nit]
        );
        if (acrPorCedula.length) {
          acrRows = acrPorCedula;
          await client.query(
            `UPDATE acreedores SET proveedor_id = $1 WHERE id = $2 AND proveedor_id IS NULL`,
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

      // Cargo siempre por el total completo de la compra
      const { rows: cargoRows } = await client.query(
        `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, descripcion, valor, compra_id)
         VALUES ($1, $2, 'Cargo', $3, $4, $5) RETURNING id`,
        [acreedorId, usuario_id, `Compra #${compra.id} — mercancía`, total, compra.id]
      );
      const cargoId = cargoRows[0].id;

      // Si hubo pago inmediato (Contado / Transferencia / mezcla), crear Abono vinculado al cargo
      if (totalPagado > 0) {
        const metodoPagoInmediato = pagosEfectivos.map((p) => p.metodo).join('/') || null;
        await client.query(
          `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, descripcion, valor, cargo_id, metodo, registrar_en_caja)
           VALUES ($1, $2, 'Abono', $3, $4, $5, $6, $7)`,
          [acreedorId, usuario_id, 'Pago al momento de la compra', totalPagado, cargoId, metodoPagoInmediato, registrar_en_caja !== false]
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

module.exports = { getCompras, getCompraById, getComprasByProveedor, registrarCompra, getComprasPaginadas };