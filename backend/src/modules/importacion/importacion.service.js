const { pool } = require('../../config/db');

const MAX_FILAS = 2000;

const _mensajeSeguro = (err) => {
  if (err.code === '23505') return 'Registro duplicado';
  if (err.code === '23503') return 'Referencia inválida';
  if (err.code === '22P02') return 'Valor con formato incorrecto';
  return 'Error al procesar la fila';
};

const _formatearFecha = (valor) => {
  if (!valor) return new Date().toISOString().split('T')[0];
  const d = valor instanceof Date ? valor : new Date(valor);
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const _parseLista = (valor) => {
  try { return JSON.parse(valor || '[]'); }
  catch { return []; }
};

// Misma normalización que el controller (mantenida en sync)
const _normClave = (s) => s.toLowerCase().replace(/\s+/g, '_');

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

const _resolverLinea = async (client, nombre, negocioId) => {
  if (!nombre?.toString().trim()) return null;
  const nombreLimpio = nombre.toString().trim();
  const { rows: existe } = await client.query(
    `SELECT id FROM lineas_producto WHERE negocio_id = $1 AND LOWER(nombre) = LOWER($2) LIMIT 1`,
    [negocioId, nombreLimpio]
  );
  if (existe.length) return existe[0].id;
  const { rows: nuevo } = await client.query(
    `INSERT INTO lineas_producto(negocio_id, nombre) VALUES($1,$2) RETURNING id`,
    [negocioId, nombreLimpio]
  );
  return nuevo[0].id;
};

const _resolverProductoSerial = async (client, { nombre, marca, modelo, precio, sucursalId, proveedorId, lineaId }) => {
  const { rows: existe } = await client.query(
    `SELECT id FROM productos_serial
     WHERE LOWER(nombre) = LOWER($1) AND sucursal_id = $2 LIMIT 1`,
    [nombre.trim(), sucursalId]
  );

  if (existe.length) {
    if (marca || modelo || proveedorId || precio || lineaId) {
      await client.query(
        `UPDATE productos_serial SET
           marca        = COALESCE(NULLIF($1,''), marca),
           modelo       = COALESCE(NULLIF($2,''), modelo),
           proveedor_id = COALESCE($3, proveedor_id),
           precio       = COALESCE($4, precio),
           linea_id     = COALESCE($5, linea_id)
         WHERE id = $6`,
        [
          marca?.toString().trim() || '',
          modelo?.toString().trim() || '',
          proveedorId,
          precio || null,
          lineaId,
          existe[0].id,
        ]
      );
    }
    return existe[0].id;
  }

  const { rows: nuevo } = await client.query(
    `INSERT INTO productos_serial(sucursal_id, proveedor_id, nombre, marca, modelo, precio, linea_id)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      sucursalId, proveedorId, nombre.trim(),
      marca?.toString().trim()  || null,
      modelo?.toString().trim() || null,
      precio || null,
      lineaId,
    ]
  );
  return nuevo[0].id;
};

// ─────────────────────────────────────────────
// IMPORTAR SERIAL
// ─────────────────────────────────────────────

const importarSerial = async (hojas, sucursalId, negocioId, config = {}) => {
  const totalFilas = hojas.reduce((s, h) => s + h.filas.length, 0);
  if (totalFilas > MAX_FILAS) {
    throw {
      status: 400,
      message: `El archivo tiene ${totalFilas} filas. El máximo permitido es ${MAX_FILAS}.`,
    };
  }

  // ── Leer configuración del negocio ────────────────────────────────────────
  const coloresActivo         = config.colores_serial_activo === '1';
  const caracteristicasActivo = config.caracteristicas_serial_activo === '1';
  // Lista de características con su nombre original (para guardar como clave en JSON)
  // y su forma normalizada (para buscarla en la fila importada)
  const caracteristicasLista  = _parseLista(config.caracteristicas_serial_lista).map((nombre) => ({
    original:    nombre,
    normalizada: _normClave(nombre),
  }));

  const resumenPorProducto = [];

  for (const hoja of hojas) {
    const resultado = {
      producto: hoja.nombreProducto,
      insertados: 0, actualizados: 0, omitidos: 0, errores: [],
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Línea es atributo del producto, no del serial → resolverla una vez por hoja
      const lineaNombre = hoja.filas.find((f) => f.linea?.toString().trim())?.linea?.toString().trim() ?? null;
      const lineaId     = await _resolverLinea(client, lineaNombre, negocioId);

      // Garantizar que el producto existe aunque la hoja no tenga seriales
      if (hoja.filas.length === 0) {
        await _resolverProductoSerial(client, {
          nombre: hoja.nombreProducto,
          marca: null, modelo: null, precio: null,
          sucursalId, proveedorId: null, lineaId,
        });
      }

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

          // Precio de venta para productos_serial
          const precio = fila.precio ? Number(fila.precio) : null;

          const productoId = await _resolverProductoSerial(client, {
            nombre: hoja.nombreProducto,
            marca:  fila.marca,
            modelo: fila.modelo,
            precio,
            sucursalId,
            proveedorId,
            lineaId,
          });

          const fechaEntrada  = _formatearFecha(fila.fecha_entrada);
          const costoCompra   = fila.costo_compra   ? Number(fila.costo_compra)   : null;
          const clienteOrigen = fila.cliente_origen?.toString().trim() || null;

          // Color (solo si la feature está activa)
          const color = coloresActivo
            ? (fila.color?.toString().trim() || null)
            : null;

          // Características: construir JSON con nombre original como clave
          let caracteristicas = null;
          if (caracteristicasActivo && caracteristicasLista.length > 0) {
            const obj = {};
            for (const { original, normalizada } of caracteristicasLista) {
              const valor = fila[normalizada]?.toString().trim();
              if (valor) obj[original] = valor;
            }
            if (Object.keys(obj).length > 0) caracteristicas = obj;
          }

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
                 costo_compra    = COALESCE($1, costo_compra),
                 cliente_origen  = COALESCE($2, cliente_origen),
                 color           = COALESCE($3, color),
                 caracteristicas = COALESCE($4::jsonb, caracteristicas)
               WHERE id = $5`,
              [
                costoCompra,
                clienteOrigen,
                color,
                caracteristicas ? JSON.stringify(caracteristicas) : null,
                serialExiste[0].id,
              ]
            );
            resultado.actualizados++;
          } else {
            await client.query(
              `INSERT INTO seriales
                 (producto_id, imei, fecha_entrada, costo_compra, cliente_origen, color, caracteristicas)
               VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
              [
                productoId, imei, fechaEntrada,
                costoCompra, clienteOrigen,
                color,
                caracteristicas ? JSON.stringify(caracteristicas) : null,
              ]
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
// HELPERS DE VARIANTES (para importarCantidad)
// ─────────────────────────────────────────────

// Crea o actualiza el producto raíz sin tocar su stock (el stock lo manejan atributos/variantes)
const _resolverProductoBase = async (client, { nombre, sucursalId, proveedorId, costoUnit, unidad, clienteOrig, precioVenta, lineaId }) => {
  const { rows } = await client.query(
    `SELECT id FROM productos_cantidad WHERE LOWER(nombre) = LOWER($1) AND sucursal_id = $2 LIMIT 1`,
    [nombre, sucursalId]
  );
  if (rows.length) {
    await client.query(
      `UPDATE productos_cantidad SET
         costo_unitario = COALESCE($1, costo_unitario),
         unidad_medida  = COALESCE(NULLIF($2,''), unidad_medida),
         cliente_origen = COALESCE($3, cliente_origen),
         proveedor_id   = COALESCE($4, proveedor_id),
         precio         = COALESCE($5, precio),
         linea_id       = COALESCE($6, linea_id)
       WHERE id = $7`,
      [costoUnit, unidad, clienteOrig, proveedorId, precioVenta, lineaId, rows[0].id]
    );
    return rows[0].id;
  }
  const { rows: nuevo } = await client.query(
    `INSERT INTO productos_cantidad
       (sucursal_id, proveedor_id, nombre, stock, stock_minimo, costo_unitario, unidad_medida, cliente_origen, precio, linea_id)
     VALUES($1,$2,$3,0,0,$4,$5,$6,$7,$8) RETURNING id`,
    [sucursalId, proveedorId, nombre, costoUnit, unidad, clienteOrig, precioVenta, lineaId]
  );
  return nuevo[0].id;
};

// Busca o crea un atributo para el producto en la sucursal
const _resolverAtributo = async (client, productoId, sucursalId, valor) => {
  const { rows } = await client.query(
    `SELECT id FROM atributos_producto
     WHERE producto_id = $1 AND sucursal_id = $2 AND LOWER(valor) = LOWER($3) AND activo = true LIMIT 1`,
    [productoId, sucursalId, valor]
  );
  if (rows.length) return { id: rows[0].id, nuevo: false };
  const { rows: ins } = await client.query(
    `INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, stock_minimo)
     VALUES($1, $2, $3, 0, 0) RETURNING id`,
    [productoId, sucursalId, valor.trim()]
  );
  return { id: ins[0].id, nuevo: true };
};

// Busca o crea/actualiza una variante dentro de un atributo
const _ajustarVariante = async (client, atributoId, valor, stock, stockMinimo, precioVenta) => {
  const { rows } = await client.query(
    `SELECT id FROM variantes_atributo
     WHERE atributo_id = $1 AND LOWER(valor) = LOWER($2) AND activo = true LIMIT 1`,
    [atributoId, valor]
  );
  if (rows.length) {
    await client.query(
      `UPDATE variantes_atributo SET
         stock        = stock + $1,
         stock_minimo = GREATEST(stock_minimo, $2),
         precio       = COALESCE($3, precio)
       WHERE id = $4`,
      [stock, stockMinimo, precioVenta, rows[0].id]
    );
    return 'actualizado';
  }
  await client.query(
    `INSERT INTO variantes_atributo (atributo_id, valor, stock, stock_minimo, precio)
     VALUES($1, $2, $3, $4, $5)`,
    [atributoId, valor.trim(), stock, stockMinimo, precioVenta]
  );
  return 'insertado';
};

// Recalcula stock en cascada: variantes → atributo → producto
const _recalcularStockProducto = async (client, productoId) => {
  await client.query(
    `UPDATE atributos_producto ap
     SET stock = COALESCE(sub.total, 0)
     FROM (
       SELECT v.atributo_id, SUM(v.stock) AS total
       FROM variantes_atributo v
       WHERE v.activo = true
       GROUP BY v.atributo_id
     ) sub
     WHERE ap.id = sub.atributo_id AND ap.producto_id = $1 AND ap.activo = true`,
    [productoId]
  );
  await client.query(
    `UPDATE productos_cantidad pc
     SET stock = sub.total
     FROM (
       SELECT ap.producto_id, COALESCE(SUM(ap.stock), 0) AS total
       FROM atributos_producto ap
       WHERE ap.activo = true AND ap.producto_id = $1
       GROUP BY ap.producto_id
     ) sub
     WHERE pc.id = sub.producto_id
       AND EXISTS (
         SELECT 1 FROM atributos_producto WHERE producto_id = $1 AND activo = true
       )`,
    [productoId]
  );
};

// ─────────────────────────────────────────────
// IMPORTAR CANTIDAD
// ─────────────────────────────────────────────

const importarCantidad = async (filas, sucursalId, negocioId, config = {}) => {
  const variantesActivo = config.variantes_activo === '1';
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

        const stock       = fila.stock          !== undefined ? Number(fila.stock)         : 0;
        const stockMinimo = fila.stock_minimo    !== undefined ? Number(fila.stock_minimo)  : 0;
        const costoUnit   = fila.costo_unitario  ? Number(fila.costo_unitario) : null;
        const precioVenta = fila.precio_venta    ? Number(fila.precio_venta)   : null;
        const unidad      = fila.unidad_medida?.toString().trim() || 'unidad';
        const clienteOrig = fila.cliente_origen?.toString().trim() || null;
        const proveedorId = await _resolverProveedor(client, fila.proveedor, negocioId);
        const lineaId     = await _resolverLinea(client, fila.linea, negocioId);

        const atributoValor = variantesActivo ? fila.atributo?.toString().trim() || null : null;
        const varianteValor = atributoValor   ? fila.variante?.toString().trim() || null : null;

        if (atributoValor) {
          // ── Con variante: el producto es contenedor, el stock vive en atributo/variante ──
          const productoId = await _resolverProductoBase(client, {
            nombre, sucursalId, proveedorId, costoUnit, unidad, clienteOrig, precioVenta, lineaId,
          });

          const { id: atributoId, nuevo: atrNuevo } = await _resolverAtributo(
            client, productoId, sucursalId, atributoValor
          );

          if (varianteValor) {
            // Stock → variante (nivel 2); luego sincronizar hacia arriba
            const accion = await _ajustarVariante(
              client, atributoId, varianteValor, stock, stockMinimo, precioVenta
            );
            await _recalcularStockProducto(client, productoId);
            accion === 'insertado' ? resultado.insertados++ : resultado.actualizados++;
          } else {
            // Stock → atributo (nivel 1, sin sub-variantes)
            await client.query(
              `UPDATE atributos_producto SET
                 stock        = stock + $1,
                 stock_minimo = GREATEST(stock_minimo, $2),
                 precio       = COALESCE($3, precio)
               WHERE id = $4`,
              [stock, stockMinimo, precioVenta, atributoId]
            );
            await _recalcularStockProducto(client, productoId);
            atrNuevo ? resultado.insertados++ : resultado.actualizados++;
          }
        } else {
          // ── Sin variante: comportamiento original sobre productos_cantidad ──
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
                 precio         = COALESCE($7, precio),
                 linea_id       = COALESCE($8, linea_id)
               WHERE id = $9`,
              [stock, stockMinimo, costoUnit, unidad, clienteOrig, proveedorId, precioVenta, lineaId, existe[0].id]
            );
            resultado.actualizados++;
          } else {
            await client.query(
              `INSERT INTO productos_cantidad
                 (sucursal_id, proveedor_id, nombre, stock, stock_minimo,
                  costo_unitario, unidad_medida, cliente_origen, precio, linea_id)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [sucursalId, proveedorId, nombre, stock, stockMinimo,
               costoUnit, unidad, clienteOrig, precioVenta, lineaId]
            );
            resultado.insertados++;
          }
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
