const { pool } = require('../../config/db');

const MAX_FILAS = 2000;

const _mensajeSeguro = (err) => {
  if (err.code === '23505') return 'Registro duplicado';
  if (err.code === '23503') return 'Referencia inválida';
  if (err.code === '22P02') return 'Valor con formato incorrecto';
  return 'Error al procesar la fila';
};

// ── Fix timezone: evita desfase UTC al convertir fechas de Excel ─────────────
const _formatearFecha = (valor) => {
  if (!valor) return new Date().toISOString().split('T')[0];
  const d = valor instanceof Date ? valor : new Date(valor);
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const _resolverProveedor = async (client, nombre, negocioId) => {
  if (!nombre?.toString().trim()) return null;
  const nombreLimpio = nombre.toString().trim();

  const { rows: existe } = await client.query(
    `SELECT id FROM proveedores
     WHERE negocio_id = $1 AND LOWER(nombre) = LOWER($2) LIMIT 1`,
    [negocioId, nombreLimpio]
  );
  if (existe.length) return existe[0].id;

  const { rows: nuevo } = await client.query(
    `INSERT INTO proveedores(negocio_id, nombre) VALUES($1, $2) RETURNING id`,
    [negocioId, nombreLimpio]
  );
  return nuevo[0].id;
};

const _resolverProductoSerial = async (client, { nombre, marca, modelo, sucursalId, proveedorId }) => {
  const { rows: existe } = await client.query(
    `SELECT id FROM productos_serial
     WHERE LOWER(nombre) = LOWER($1) AND sucursal_id = $2 LIMIT 1`,
    [nombre.trim(), sucursalId]
  );

  if (existe.length) {
    if (marca || modelo || proveedorId) {
      await client.query(
        `UPDATE productos_serial SET
           marca        = COALESCE(NULLIF($1,''), marca),
           modelo       = COALESCE(NULLIF($2,''), modelo),
           proveedor_id = COALESCE($3, proveedor_id)
         WHERE id = $4`,
        [marca?.toString().trim() || '', modelo?.toString().trim() || '', proveedorId, existe[0].id]
      );
    }
    return existe[0].id;
  }

  const { rows: nuevo } = await client.query(
    `INSERT INTO productos_serial(sucursal_id, proveedor_id, nombre, marca, modelo)
     VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [
      sucursalId, proveedorId, nombre.trim(),
      marca?.toString().trim()  || null,
      modelo?.toString().trim() || null,
    ]
  );
  return nuevo[0].id;
};

// ─────────────────────────────────────────────
// IMPORTAR SERIAL
// ─────────────────────────────────────────────

const importarSerial = async (hojas, sucursalId, negocioId) => {
  const totalFilas = hojas.reduce((s, h) => s + h.filas.length, 0);
  if (totalFilas > MAX_FILAS) {
    throw {
      status: 400,
      message: `El archivo tiene ${totalFilas} filas. El máximo permitido es ${MAX_FILAS}.`,
    };
  }

  const resumenPorProducto = [];

  for (const hoja of hojas) {
    const resultado = {
      producto: hoja.nombreProducto,
      insertados: 0, actualizados: 0, omitidos: 0, errores: [],
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const [i, fila] of hoja.filas.entries()) {
        const nFila = i + 4;
        try {
          const imei = fila.imei?.toString().trim();
          if (!imei) {
            resultado.errores.push({ fila: nFila, error: 'IMEI vacío' });
            resultado.omitidos++;
            continue;
          }

          const proveedorId = await _resolverProveedor(client, fila.proveedor, negocioId);
          const productoId  = await _resolverProductoSerial(client, {
            nombre: hoja.nombreProducto,
            marca:  fila.marca,
            modelo: fila.modelo,
            sucursalId,
            proveedorId,
          });

          // ── Usar _formatearFecha para evitar desfase de timezone ──
          const fechaEntrada  = _formatearFecha(fila.fecha_entrada);
          const costoCompra   = fila.costo_compra   ? Number(fila.costo_compra)   : null;
          const clienteOrigen = fila.cliente_origen?.toString().trim() || null;

          const { rows: serialExiste } = await client.query(
            `SELECT s.id FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             JOIN sucursales       su ON su.id = ps.sucursal_id
             WHERE s.imei = $1 AND su.negocio_id = $2 LIMIT 1`,
            [imei, negocioId]
          );

          if (serialExiste.length) {
            await client.query(
              `UPDATE seriales SET
                 costo_compra   = COALESCE($1, costo_compra),
                 cliente_origen = COALESCE($2, cliente_origen)
               WHERE id = $3`,
              [costoCompra, clienteOrigen, serialExiste[0].id]
            );
            resultado.actualizados++;
          } else {
            await client.query(
              `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, cliente_origen)
               VALUES($1,$2,$3,$4,$5)`,
              [productoId, imei, fechaEntrada, costoCompra, clienteOrigen]
            );
            resultado.insertados++;
          }
        } catch (err) {
          resultado.errores.push({ fila: nFila, error: _mensajeSeguro(err) });
          resultado.omitidos++;
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      resultado.errores.push({ fila: 0, error: `Error general en hoja: ${_mensajeSeguro(err)}` });
    } finally {
      client.release();
    }

    resumenPorProducto.push(resultado);
  }

  const totales = resumenPorProducto.reduce(
    (acc, r) => ({
      insertados:   acc.insertados   + r.insertados,
      actualizados: acc.actualizados + r.actualizados,
      omitidos:     acc.omitidos     + r.omitidos,
    }),
    { insertados: 0, actualizados: 0, omitidos: 0 }
  );

  return { ...totales, detalle: resumenPorProducto };
};

// ─────────────────────────────────────────────
// IMPORTAR CANTIDAD
// ─────────────────────────────────────────────

const importarCantidad = async (filas, sucursalId, negocioId) => {
  if (filas.length > MAX_FILAS) {
    throw {
      status: 400,
      message: `El archivo tiene ${filas.length} filas. El máximo permitido es ${MAX_FILAS}.`,
    };
  }

  const resultado = { insertados: 0, actualizados: 0, omitidos: 0, errores: [] };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [i, fila] of filas.entries()) {
      const nFila = i + 4;
      try {
        const nombre = fila.nombre?.toString().trim();
        if (!nombre) {
          resultado.errores.push({ fila: nFila, error: 'Nombre requerido' });
          resultado.omitidos++;
          continue;
        }

        const stock       = fila.stock         !== undefined ? Number(fila.stock)         : 0;
        const stockMinimo = fila.stock_minimo   !== undefined ? Number(fila.stock_minimo)  : 0;
        const costoUnit   = fila.costo_unitario ? Number(fila.costo_unitario) : null;
        const precioVenta = fila.precio_venta   ? Number(fila.precio_venta)   : null; // ← agregar
        const unidad      = fila.unidad_medida?.toString().trim() || 'unidad';
        const clienteOrig = fila.cliente_origen?.toString().trim() || null;
        const proveedorId = await _resolverProveedor(client, fila.proveedor, negocioId);

        const { rows: existe } = await client.query(
          `SELECT id FROM productos_cantidad
           WHERE LOWER(nombre) = LOWER($1) AND sucursal_id = $2 LIMIT 1`,
          [nombre, sucursalId]
        );

        if (existe.length) {
          await client.query(
            `UPDATE productos_cantidad SET
               stock          = stock + $1,
               stock_minimo   = GREATEST(stock_minimo, $2),
               costo_unitario = COALESCE($3, costo_unitario),
               unidad_medida  = COALESCE(NULLIF($4,''), unidad_medida),
               cliente_origen = COALESCE($5, cliente_origen),
               proveedor_id   = COALESCE($6, proveedor_id),
               precio         = COALESCE($7, precio)
             WHERE id = $8`,
            [stock, stockMinimo, costoUnit, unidad, clienteOrig, proveedorId, precioVenta, existe[0].id]
          );
          resultado.actualizados++;
        } else {
          await client.query(
            `INSERT INTO productos_cantidad
               (sucursal_id, proveedor_id, nombre, stock, stock_minimo,
                costo_unitario, unidad_medida, cliente_origen, precio)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [sucursalId, proveedorId, nombre, stock, stockMinimo,
             costoUnit, unidad, clienteOrig, precioVenta]
          );
          resultado.insertados++;
        }
      } catch (err) {
        resultado.errores.push({ fila: nFila, error: _mensajeSeguro(err) });
        resultado.omitidos++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw { status: 500, message: 'Error general en la importación de cantidad' };
  } finally {
    client.release();
  }

  return resultado;
};

module.exports = { importarSerial, importarCantidad };