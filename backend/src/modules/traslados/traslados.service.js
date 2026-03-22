const { pool } = require('../../config/db');
const repo = require('./traslados.repository');

// ─── Validaciones de seguridad ────────────────────────────────────────────────

const _verificarSucursalNegocio = async (sucursalId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursalId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: `Sucursal ${sucursalId} no pertenece a este negocio o está inactiva` };
};

const _verificarSerialDisponible = async (client, serialId, sucursalOrigenId, negocioId) => {
  const { rows } = await client.query(`
    SELECT s.id, s.imei, s.vendido, s.prestado, s.producto_id,
           ps.nombre AS producto_nombre, ps.marca, ps.modelo, ps.sucursal_id
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    JOIN sucursales su ON su.id = ps.sucursal_id
    WHERE s.id = $1 AND su.negocio_id = $2 AND ps.sucursal_id = $3
    FOR UPDATE OF s
  `, [serialId, negocioId, sucursalOrigenId]);

  if (!rows.length) throw { status: 404, message: `Serial ${serialId} no encontrado en la sucursal origen` };
  const serial = rows[0];
  if (serial.vendido)  throw { status: 400, message: `El serial ${serial.imei} está vendido, no se puede trasladar` };
  if (serial.prestado) throw { status: 400, message: `El serial ${serial.imei} está prestado, no se puede trasladar` };
  return serial;
};

const _verificarProductoSerialDestino = async (client, productoDestinoId, sucursalDestinoId, negocioId) => {
  const { rows } = await client.query(`
    SELECT ps.id FROM productos_serial ps
    JOIN sucursales su ON su.id = ps.sucursal_id
    WHERE ps.id = $1 AND ps.sucursal_id = $2 AND su.negocio_id = $3
  `, [productoDestinoId, sucursalDestinoId, negocioId]);
  if (!rows.length) throw { status: 404, message: `Producto serial destino ${productoDestinoId} no existe en la sucursal destino` };
};

const _verificarProductoCantidadOrigen = async (client, productoOrigenId, sucursalOrigenId, negocioId, cantidadSolicitada) => {
  const { rows } = await client.query(`
    SELECT pc.id, pc.stock, pc.nombre, pc.costo_unitario, pc.sucursal_id
    FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE pc.id = $1 AND pc.sucursal_id = $2 AND su.negocio_id = $3 AND pc.activo = true
    FOR UPDATE OF pc
  `, [productoOrigenId, sucursalOrigenId, negocioId]);

  if (!rows.length) throw { status: 404, message: `Producto cantidad origen ${productoOrigenId} no encontrado en sucursal origen` };
  const producto = rows[0];
  if (producto.stock < cantidadSolicitada) {
    throw { status: 400, message: `Stock insuficiente de "${producto.nombre}". Disponible: ${producto.stock}, solicitado: ${cantidadSolicitada}` };
  }
  return producto;
};

const _verificarProductoCantidadDestino = async (client, productoDestinoId, sucursalDestinoId, negocioId) => {
  const { rows } = await client.query(`
    SELECT pc.id, pc.nombre FROM productos_cantidad pc
    JOIN sucursales su ON su.id = pc.sucursal_id
    WHERE pc.id = $1 AND pc.sucursal_id = $2 AND su.negocio_id = $3 AND pc.activo = true
  `, [productoDestinoId, sucursalDestinoId, negocioId]);
  if (!rows.length) throw { status: 404, message: `Producto cantidad destino ${productoDestinoId} no existe en la sucursal destino` };
};

// ─── Búsqueda de equivalentes ─────────────────────────────────────────────────

const buscarEquivalentes = async (negocioId, sucursalDestinoId, items) => {
  await _verificarSucursalNegocio(sucursalDestinoId, negocioId);

  const resultados = [];

  for (const item of items) {
    if (item.tipo === 'serial') {
      const equiv = await repo.buscarEquivalentesSerial(negocioId, sucursalDestinoId, {
        nombre:   item.nombre,
        marca:    item.marca    || null,
        modelo:   item.modelo   || null,
        linea_id: item.linea_id || null,
      });
      resultados.push({
        key:              item.key,
        tipo:             'serial',
        nombre_origen:    item.nombre,
        nivel:            equiv.nivel,
        sugerencias:      equiv.resultados,
        auto_seleccionado: equiv.nivel === 'exacto' && equiv.resultados.length === 1
          ? equiv.resultados[0].id
          : null,
      });
    } else {
      const equiv = await repo.buscarEquivalentesCantidad(negocioId, sucursalDestinoId, {
        nombre:   item.nombre,
        linea_id: item.linea_id || null,
      });
      resultados.push({
        key:              item.key,
        tipo:             'cantidad',
        nombre_origen:    item.nombre,
        nivel:            equiv.nivel,
        sugerencias:      equiv.resultados,
        auto_seleccionado: equiv.nivel === 'exacto' && equiv.resultados.length === 1
          ? equiv.resultados[0].id
          : null,
      });
    }
  }

  return resultados;
};

// ─── Ejecutar traslado ────────────────────────────────────────────────────────

const ejecutarTraslado = async (negocioId, usuarioId, {
  sucursal_origen_id, sucursal_destino_id, notas, lineas,
}) => {
  // Validar sucursales antes de la transacción
  await _verificarSucursalNegocio(sucursal_origen_id, negocioId);
  await _verificarSucursalNegocio(sucursal_destino_id, negocioId);

  if (sucursal_origen_id === sucursal_destino_id) {
    throw { status: 400, message: 'La sucursal origen y destino no pueden ser la misma' };
  }

  if (!lineas || lineas.length === 0) {
    throw { status: 400, message: 'Debes incluir al menos un producto para trasladar' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Crear el traslado
    const traslado = await repo.crearTraslado(client, {
      negocio_id: negocioId,
      sucursal_origen_id,
      sucursal_destino_id,
      usuario_id: usuarioId,
      notas,
    });

    for (const linea of lineas) {
      if (linea.tipo === 'serial') {
        // ── Trasladar serial ──────────────────────────────────────
        const serial = await _verificarSerialDisponible(
          client, linea.serial_id, sucursal_origen_id, negocioId
        );
        await _verificarProductoSerialDestino(
          client, linea.producto_destino_id, sucursal_destino_id, negocioId
        );

        // Mover el serial al producto destino
        await repo.moverSerial(client, linea.serial_id, linea.producto_destino_id);

        // Registrar la línea de traslado
        await repo.insertarLineaTraslado(client, {
          traslado_id:                 traslado.id,
          tipo:                        'serial',
          serial_id:                   linea.serial_id,
          producto_serial_origen_id:   serial.producto_id,
          producto_serial_destino_id:  linea.producto_destino_id,
          imei:                        serial.imei,
          nombre_producto:             serial.producto_nombre,
        });

      } else if (linea.tipo === 'cantidad') {
        // ── Trasladar cantidad ────────────────────────────────────
        const cantidad = Number(linea.cantidad);
        if (!cantidad || cantidad < 1) {
          throw { status: 400, message: `Cantidad inválida para "${linea.nombre_producto || 'producto'}"` };
        }

        const productoOrigen = await _verificarProductoCantidadOrigen(
          client, linea.producto_origen_id, sucursal_origen_id, negocioId, cantidad
        );
        await _verificarProductoCantidadDestino(
          client, linea.producto_destino_id, sucursal_destino_id, negocioId
        );

        // Restar stock en origen
        await repo.ajustarStockEnTransaccion(client, linea.producto_origen_id, -cantidad);

        // Sumar stock en destino
        await repo.ajustarStockEnTransaccion(client, linea.producto_destino_id, cantidad);

        // Historial en origen (salida)
        await repo.insertarHistorialEnTransaccion(client, {
          producto_id:    linea.producto_origen_id,
          sucursal_id:    sucursal_origen_id,
          cantidad:       -cantidad,
          costo_unitario: productoOrigen.costo_unitario,
          notas:          `Traslado #${traslado.id} → sucursal destino`,
        });

        // Historial en destino (entrada)
        await repo.insertarHistorialEnTransaccion(client, {
          producto_id:    linea.producto_destino_id,
          sucursal_id:    sucursal_destino_id,
          cantidad:       cantidad,
          costo_unitario: productoOrigen.costo_unitario,
          notas:          `Traslado #${traslado.id} ← sucursal origen`,
        });

        // Registrar la línea de traslado
        await repo.insertarLineaTraslado(client, {
          traslado_id:                  traslado.id,
          tipo:                         'cantidad',
          producto_cantidad_origen_id:  linea.producto_origen_id,
          producto_cantidad_destino_id: linea.producto_destino_id,
          cantidad,
          nombre_producto:              productoOrigen.nombre,
        });

      } else {
        throw { status: 400, message: `Tipo de línea inválido: "${linea.tipo}"` };
      }
    }

    await client.query('COMMIT');
    return traslado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Consultas ────────────────────────────────────────────────────────────────

const getTraslados = (negocioId) => repo.findAll(negocioId);

const getTrasladoById = async (negocioId, id) => {
  const traslado = await repo.findById(negocioId, id);
  if (!traslado) throw { status: 404, message: 'Traslado no encontrado' };
  const lineasData = await repo.getLineas(id);
  return { ...traslado, lineas: lineasData };
};

module.exports = {
  buscarEquivalentes, ejecutarTraslado,
  getTraslados, getTrasladoById,
};