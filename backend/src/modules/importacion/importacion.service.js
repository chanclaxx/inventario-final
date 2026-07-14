const { pool } = require('../../config/db');

const MAX_FILAS = 2000;

const _mensajeSeguro = (err) => {
  if (err.code === '23505') return 'Registro duplicado';
  if (err.code === '23503') return 'Referencia inválida';
  if (err.code === '22P02') return 'Valor con formato incorrecto';
  return 'Error al procesar la fila';
};

const _hoyISO = () => new Date().toISOString().split('T')[0];

const _formatearFecha = (valor) => {
  if (valor == null || valor === '') return _hoyISO();

  // Celda de fecha real de Excel (cellDates:true) → objeto Date válido
  if (valor instanceof Date) {
    if (isNaN(valor)) return _hoyISO();
    const year  = valor.getFullYear();
    const month = String(valor.getMonth() + 1).padStart(2, '0');
    const day   = String(valor.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const s = valor.toString().trim();
  if (!s) return _hoyISO();

  // Formato de la plantilla: dd/mm/aaaa (también admite dd-mm-aaaa).
  // OJO: new Date("dd/mm/aaaa") interpreta mm/dd (bug), por eso se parsea a mano.
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const dia = Number(m[1]), mes = Number(m[2]), anio = Number(m[3]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
    return _hoyISO(); // fecha imposible → hoy, sin romper la fila
  }

  // Formato ISO aaaa-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // Cualquier otro texto no reconocido → hoy (nunca "NaN-NaN-NaN")
  return _hoyISO();
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

        const imei = fila.imei?.toString().trim();
        if (!imei) {
          resultado.errores.push({ fila: nFila, error: 'IMEI vacío' });
          resultado.omitidos++;
          continue;
        }

        // Savepoint por fila: si una fila falla, se revierte SOLO esa fila y la
        // hoja continúa. Sin esto, el 1er error aborta toda la transacción de la
        // hoja y el COMMIT hace un ROLLBACK silencioso (se pierde todo).
        await client.query('SAVEPOINT fila_sp');
        try {
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
             WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
            [imei, negocioId]
          );

          if (serialExiste.length) {
            await client.query(
              `UPDATE seriales SET
                 costo_compra    = COALESCE($1, costo_compra),
                 precio          = COALESCE($2, precio),
                 cliente_origen  = COALESCE($3, cliente_origen),
                 color           = COALESCE($4, color),
                 caracteristicas = COALESCE($5::jsonb, caracteristicas)
               WHERE id = $6`,
              [
                costoCompra,
                precio,
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
                 (producto_id, imei, fecha_entrada, costo_compra, precio, cliente_origen, color, caracteristicas)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
              [
                productoId, imei, fechaEntrada,
                costoCompra, precio, clienteOrigen,
                color,
                caracteristicas ? JSON.stringify(caracteristicas) : null,
              ]
            );
            resultado.insertados++;
          }
          await client.query('RELEASE SAVEPOINT fila_sp');
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT fila_sp');
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

// Código único: Excel suele convertir códigos largos (EAN-13) a número y
// mostrarlos en notación científica, o perder ceros a la izquierda. Por eso
// la plantilla pide TEXTO, y aquí se recuperan los casos numéricos comunes.
const _normalizarCodigoImport = (valor) => {
  if (valor === undefined || valor === null) return null;
  let s = String(valor).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.round(n));
  } else if (/^\d+\.0+$/.test(s)) {
    s = s.replace(/\.0+$/, '');
  }
  s = s.toUpperCase();
  if (/\s/.test(s)) throw { message: 'El código no puede contener espacios' };
  if (s.length > 50) throw { message: 'El código no puede superar 50 caracteres' };
  return s;
};

const importarCantidad = async (filas, sucursalId, negocioId, config = {}) => {
  const variantesActivo = config.variantes_activo === '1';
  if (filas.length > MAX_FILAS) {
    throw {
      status: 400,
      message: `El archivo tiene ${filas.length} filas. El máximo permitido es ${MAX_FILAS}.`,
    };
  }

  const resultado = { insertados: 0, actualizados: 0, omitidos: 0, errores: [] };

  // codigo → nombre (lower) ya visto en el archivo, para detectar el mismo
  // código apuntando a dos productos distintos dentro del mismo Excel.
  const codigosArchivo = new Map();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [i, fila] of filas.entries()) {
      const nFila = i + 4;

      const nombre = fila.nombre?.toString().trim();
      if (!nombre) {
        resultado.errores.push({ fila: nFila, error: 'Nombre requerido' });
        resultado.omitidos++;
        continue;
      }

      let codigo = null;
      try {
        // La plantilla usa "Codigo", pero se tolera "Código" escrito a mano
        codigo = _normalizarCodigoImport(fila.codigo ?? fila['código']);
      } catch (e) {
        resultado.errores.push({ fila: nFila, error: e.message });
        resultado.omitidos++;
        continue;
      }
      if (codigo) {
        const nombrePrevio = codigosArchivo.get(codigo);
        if (nombrePrevio && nombrePrevio !== nombre.toLowerCase()) {
          resultado.errores.push({ fila: nFila, error: `El código ${codigo} aparece en el archivo con otro producto` });
          resultado.omitidos++;
          continue;
        }
        codigosArchivo.set(codigo, nombre.toLowerCase());

        const { rows: conflicto } = await client.query(
          `SELECT pc.nombre FROM productos_cantidad pc
           JOIN sucursales su ON su.id = pc.sucursal_id
           WHERE su.negocio_id = $1 AND pc.activo = true
             AND UPPER(pc.codigo) = $2 AND LOWER(pc.nombre) <> LOWER($3)
           LIMIT 1`,
          [negocioId, codigo, nombre]
        );
        if (conflicto.length) {
          resultado.errores.push({ fila: nFila, error: `El código ${codigo} ya está en uso por "${conflicto[0].nombre}"` });
          resultado.omitidos++;
          continue;
        }
      }

      // Savepoint por fila: un error revierte solo esa fila, no toda la importación.
      await client.query('SAVEPOINT fila_sp');
      try {
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

        // Código único: si la fila no trae código pero el producto ya existe con
        // uno en otra sucursal, se hereda (un código = un producto en el negocio).
        let codigoFinal = codigo;
        if (!codigoFinal) {
          const { rows: her } = await client.query(
            `SELECT pc.codigo
             FROM productos_cantidad pc
             JOIN sucursales su ON su.id = pc.sucursal_id
             WHERE su.negocio_id = $1
               AND pc.activo = true
               AND pc.codigo IS NOT NULL
               AND LOWER(pc.nombre) = LOWER($2)
               AND NOT EXISTS (
                 SELECT 1 FROM productos_cantidad x
                 WHERE x.sucursal_id = $3 AND x.activo = true AND x.codigo = pc.codigo
               )
             LIMIT 1`,
            [negocioId, nombre, sucursalId]
          );
          codigoFinal = her[0]?.codigo || null;
        }

        // Se asigna por nombre a TODAS las filas del producto lógico en el negocio
        // (cubre insert, update y producto base de variantes, y mantiene el
        // escaneo funcionando en las demás sucursales).
        if (codigoFinal) {
          await client.query(
            `UPDATE productos_cantidad pc
             SET codigo = $3
             FROM sucursales su
             WHERE su.id = pc.sucursal_id
               AND su.negocio_id = $1
               AND LOWER(pc.nombre) = LOWER($2)
               AND pc.activo = true
               AND pc.codigo IS DISTINCT FROM $3`,
            [negocioId, nombre, codigoFinal]
          );
        }
        await client.query('RELEASE SAVEPOINT fila_sp');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT fila_sp');
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
