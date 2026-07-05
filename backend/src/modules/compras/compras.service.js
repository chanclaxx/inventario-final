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
        // Solo para productos de cantidad; los seriales se identifican por imei
        producto_id:       linea.imei ? null : (linea.producto_id || null),
      });

      if (linea.imei) {
        if (linea.reactivar_serial_id) {
          const { rows } = await client.query(
            `SELECT s.id, s.vendido, s.prestado FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             WHERE s.id = $1 AND ps.sucursal_id = $2`,
            [linea.reactivar_serial_id, sucursal_id]
          );
          if (!rows.length) {
            throw { status: 400, message: `El serial ${linea.imei} no pertenece a esta sucursal` };
          }
          if (rows[0].prestado) {
            throw { status: 409, code: 'IMEI_PRESTADO', message: `El IMEI ${linea.imei} está prestado. Ve a la pestaña de Préstamos y regístralo como devuelto para que regrese al inventario.` };
          }
          if (!rows[0].vendido) {
            throw { status: 409, message: `El IMEI ${linea.imei} ya está registrado y disponible en el inventario.` };
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
             WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2`,
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
        `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, descripcion, valor, compra_id, sucursal_id)
         VALUES ($1, $2, 'Cargo', $3, $4, $5, $6) RETURNING id`,
        [acreedorId, usuario_id, `Compra #${compra.id} — mercancía`, total, compra.id, sucursal_id]
      );
      const cargoId = cargoRows[0].id;

      // Si hubo pago inmediato (Contado / Transferencia / mezcla), crear Abono vinculado al cargo
      if (totalPagado > 0) {
        const metodoPagoInmediato = pagosEfectivos.map((p) => p.metodo).join('/') || null;
        await client.query(
          `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, descripcion, valor, cargo_id, metodo, registrar_en_caja, sucursal_id)
           VALUES ($1, $2, 'Abono', $3, $4, $5, $6, $7, $8)`,
          [acreedorId, usuario_id, 'Pago al momento de la compra', totalPagado, cargoId, metodoPagoInmediato, registrar_en_caja !== false, sucursal_id]
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

const cancelarCompra = async (negocioId, compraId) => {
  const compra = await comprasRepo.findByIdYNegocio(compraId, negocioId);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };
  if (compra.estado === 'Cancelada') throw { status: 400, message: 'La compra ya está cancelada' };

  const lineas = await comprasRepo.getLineas(compraId);

  // Validar que ningún serial haya sido vendido o prestado antes de cancelar
  const imeisConflictivos = [];
  for (const linea of lineas) {
    if (!linea.imei) continue;
    const { rows } = await pool.query(
      `SELECT s.vendido, s.prestado FROM seriales s
       JOIN productos_serial ps ON ps.id = s.producto_id
       JOIN sucursales       su ON su.id = ps.sucursal_id
       WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
      [linea.imei, negocioId]
    );
    if (rows.length && (rows[0].vendido || rows[0].prestado)) {
      const estado = rows[0].vendido ? 'vendido' : 'prestado';
      imeisConflictivos.push(`${linea.imei} (${estado})`);
    }
  }
  if (imeisConflictivos.length > 0) {
    throw {
      status: 400,
      message: `No se puede cancelar la compra. Los siguientes IMEI ya fueron vendidos o están prestados: ${imeisConflictivos.join(', ')}`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Marcar compra como cancelada
    await comprasRepo.marcarCancelada(client, compraId);

    // 2. Eliminar cargo y abonos del acreedor vinculados a esta compra
    const { rows: cargoRows } = await client.query(
      `SELECT id FROM movimientos_acreedor WHERE compra_id = $1 AND tipo = 'Cargo' LIMIT 1`,
      [compraId]
    );
    if (cargoRows.length) {
      const cargoId = cargoRows[0].id;
      // Abonos que apuntan a este cargo (pagos + devoluciones ligadas al cargo)
      await client.query(
        `DELETE FROM movimientos_acreedor WHERE cargo_id = $1`,
        [cargoId]
      );
      // Notas crédito de devolución que quedaron como saldo a favor (sin cargo)
      await client.query(
        `DELETE FROM movimientos_acreedor WHERE compra_id = $1 AND cargo_id IS NULL AND tipo = 'Abono'`,
        [compraId]
      );
      // Luego el cargo mismo
      await client.query(
        `DELETE FROM movimientos_acreedor WHERE id = $1`,
        [cargoId]
      );
    }

    // 3. Revertir ítems del inventario
    for (const linea of lineas) {
      if (linea.imei) {
        // Serial: eliminar del inventario si aún no fue vendido ni prestado
        // Acotado al negocio: el mismo IMEI puede existir en otros negocios.
        await client.query(
          `DELETE FROM seriales s
           USING productos_serial ps, sucursales su
           WHERE s.producto_id = ps.id
             AND ps.sucursal_id = su.id
             AND su.negocio_id = $2
             AND s.imei = $1
             AND s.vendido = false
             AND s.prestado = false`,
          [linea.imei, negocioId]
        );
      } else if (linea.variante_id) {
        // Producto con variante: restar stock
        await client.query(
          `UPDATE variantes_atributo SET stock = GREATEST(0, stock - $1) WHERE id = $2`,
          [linea.cantidad, linea.variante_id]
        );
        // Sincronizar stock del producto padre
        const { rows: varRows } = await client.query(
          `SELECT producto_id FROM variantes_atributo WHERE id = $1`,
          [linea.variante_id]
        );
        if (varRows.length) {
          await client.query(
            `UPDATE productos_cantidad
             SET stock = (SELECT COALESCE(SUM(stock), 0) FROM variantes_atributo WHERE producto_id = $1)
             WHERE id = $1`,
            [varRows[0].producto_id]
          );
        }
      } else if (linea.atributo_id) {
        // Producto con atributo: restar stock
        await client.query(
          `UPDATE atributos_producto SET stock = GREATEST(0, stock - $1) WHERE id = $2`,
          [linea.cantidad, linea.atributo_id]
        );
        // Sincronizar stock del producto padre
        const { rows: atrRows } = await client.query(
          `SELECT producto_id FROM atributos_producto WHERE id = $1`,
          [linea.atributo_id]
        );
        if (atrRows.length) {
          await client.query(
            `UPDATE productos_cantidad
             SET stock = (SELECT COALESCE(SUM(stock), 0) FROM atributos_producto WHERE producto_id = $1)
             WHERE id = $1`,
            [atrRows[0].producto_id]
          );
        }
      } else if (linea.producto_id) {
        // Producto de cantidad simple (sin variante ni atributo): restar stock directamente
        await client.query(
          `UPDATE productos_cantidad SET stock = GREATEST(0, stock - $1) WHERE id = $2`,
          [linea.cantidad, linea.producto_id]
        );
      }
    }

    await client.query('COMMIT');
    return { id: compraId, estado: 'Cancelada' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Devolución total/parcial de mercancía a proveedor ─────────────────────────
// Revierte el inventario de las líneas indicadas (reusa la misma lógica probada
// de cancelarCompra) y registra una nota crédito en el acreedor: reduce la deuda
// del cargo de la compra y, si ya estaba pagada, el excedente queda como saldo a
// favor. NO afecta caja (es mercancía devuelta, no dinero).
const devolverCompra = async (negocioId, compraId, { lineas: lineasDevol, motivo, usuario_id }) => {
  if (!Array.isArray(lineasDevol) || lineasDevol.length === 0) {
    throw { status: 400, message: 'Debes indicar al menos una línea a devolver' };
  }

  const compra = await comprasRepo.findByIdYNegocio(compraId, negocioId);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };
  if (compra.estado === 'Cancelada') throw { status: 400, message: 'La compra está cancelada; no se puede devolver' };

  const lineasCompra = await comprasRepo.getLineas(compraId);
  const lineasById = new Map(lineasCompra.map((l) => [Number(l.id), l]));

  // Validar y normalizar las solicitudes de devolución
  const solicitudes = [];
  for (const req of lineasDevol) {
    const linea = lineasById.get(Number(req.linea_id));
    if (!linea) throw { status: 400, message: `La línea ${req.linea_id} no pertenece a esta compra` };

    if (linea.imei) {
      solicitudes.push({ linea, cantidad: 1 });
    } else {
      const cant = Number(req.cantidad);
      if (!Number.isInteger(cant) || cant < 1 || cant > Number(linea.cantidad)) {
        throw { status: 400, message: `Cantidad inválida para ${linea.nombre_producto} (entre 1 y ${linea.cantidad})` };
      }
      solicitudes.push({ linea, cantidad: cant });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let valorDevuelto = 0;
    const detalle = [];

    for (const { linea, cantidad } of solicitudes) {
      if (linea.imei) {
        const { rows } = await client.query(
          `SELECT s.id, s.vendido, s.prestado FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           JOIN sucursales       su ON su.id = ps.sucursal_id
           WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
          [linea.imei, negocioId]
        );
        if (!rows.length) throw { status: 400, message: `El equipo ${linea.imei} ya no está en el inventario` };
        if (rows[0].vendido || rows[0].prestado) {
          throw { status: 400, message: `El equipo ${linea.imei} ya fue ${rows[0].vendido ? 'vendido' : 'prestado'} y no se puede devolver` };
        }
        await client.query(`DELETE FROM seriales WHERE id = $1`, [rows[0].id]);

      } else if (linea.variante_id) {
        const { rows } = await client.query(`SELECT stock, producto_id FROM variantes_atributo WHERE id = $1`, [linea.variante_id]);
        if (!rows.length || Number(rows[0].stock) < cantidad) {
          throw { status: 400, message: `Stock insuficiente para devolver ${linea.nombre_producto}` };
        }
        await client.query(`UPDATE variantes_atributo SET stock = stock - $1 WHERE id = $2`, [cantidad, linea.variante_id]);
        await client.query(
          `UPDATE productos_cantidad
           SET stock = (SELECT COALESCE(SUM(stock), 0) FROM variantes_atributo WHERE producto_id = $1)
           WHERE id = $1`,
          [rows[0].producto_id]
        );

      } else if (linea.atributo_id) {
        const { rows } = await client.query(`SELECT stock, producto_id FROM atributos_producto WHERE id = $1`, [linea.atributo_id]);
        if (!rows.length || Number(rows[0].stock) < cantidad) {
          throw { status: 400, message: `Stock insuficiente para devolver ${linea.nombre_producto}` };
        }
        await client.query(`UPDATE atributos_producto SET stock = stock - $1 WHERE id = $2`, [cantidad, linea.atributo_id]);
        await client.query(
          `UPDATE productos_cantidad
           SET stock = (SELECT COALESCE(SUM(stock), 0) FROM atributos_producto WHERE producto_id = $1)
           WHERE id = $1`,
          [rows[0].producto_id]
        );

      } else if (linea.producto_id) {
        const { rows } = await client.query(`SELECT stock FROM productos_cantidad WHERE id = $1`, [linea.producto_id]);
        if (!rows.length || Number(rows[0].stock) < cantidad) {
          throw { status: 400, message: `Stock insuficiente para devolver ${linea.nombre_producto}` };
        }
        await client.query(`UPDATE productos_cantidad SET stock = stock - $1 WHERE id = $2`, [cantidad, linea.producto_id]);
      }

      const sub = cantidad * Number(linea.precio_unitario);
      valorDevuelto += sub;
      detalle.push({ linea_id: linea.id, nombre: linea.nombre_producto, cantidad, valor: sub });
    }

    // ── Nota crédito en el acreedor ─────────────────────────────────────────
    const { rows: cargoRows } = await client.query(
      `SELECT id, acreedor_id, valor FROM movimientos_acreedor
       WHERE compra_id = $1 AND tipo = 'Cargo' LIMIT 1`,
      [compraId]
    );

    if (cargoRows.length && valorDevuelto > 0) {
      const cargo = cargoRows[0];

      // Tope: no se puede devolver más valor del que vale la compra
      const { rows: yaDevRows } = await client.query(
        `SELECT COALESCE(SUM(valor), 0) AS dev FROM movimientos_acreedor
         WHERE compra_id = $1 AND tipo = 'Abono' AND metodo = 'Devolución'`,
        [compraId]
      );
      if (Number(yaDevRows[0].dev) + valorDevuelto > Number(cargo.valor) + 0.001) {
        throw { status: 400, message: 'La devolución supera el valor pendiente de devolver de esta compra' };
      }

      // Saldo pendiente del cargo (lo que aún se debe de esta compra)
      const { rows: abRows } = await client.query(
        `SELECT COALESCE(SUM(valor), 0) AS ab FROM movimientos_acreedor
         WHERE cargo_id = $1 AND tipo = 'Abono'`,
        [cargo.id]
      );
      const saldoPendiente = Math.max(0, Number(cargo.valor) - Number(abRows[0].ab));
      const desc = `Devolución de mercancía — compra #${compraId}${motivo ? ` (${motivo})` : ''}`;

      const abonoAlCargo = Math.min(valorDevuelto, saldoPendiente);
      if (abonoAlCargo > 0) {
        await client.query(
          `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, valor, descripcion, compra_id, cargo_id, metodo, registrar_en_caja, sucursal_id)
           VALUES ($1, $2, 'Abono', $3, $4, $5, $6, 'Devolución', false, $7)`,
          [cargo.acreedor_id, usuario_id || null, abonoAlCargo, desc, compraId, cargo.id, compra.sucursal_id]
        );
      }

      const excedente = valorDevuelto - abonoAlCargo;
      if (excedente > 0) {
        // Ya estaba pagada → el excedente queda como saldo a favor del negocio
        await client.query(
          `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, valor, descripcion, compra_id, cargo_id, metodo, registrar_en_caja, sucursal_id)
           VALUES ($1, $2, 'Abono', $3, $4, $5, NULL, 'Devolución', false, $6)`,
          [cargo.acreedor_id, usuario_id || null, excedente, `${desc} (saldo a favor)`, compraId, compra.sucursal_id]
        );
      }
    }

    await client.query('COMMIT');
    return { compra_id: compraId, valor_devuelto: valorDevuelto, detalle };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { getCompras, getCompraById, getComprasByProveedor, registrarCompra, getComprasPaginadas, cancelarCompra, devolverCompra };