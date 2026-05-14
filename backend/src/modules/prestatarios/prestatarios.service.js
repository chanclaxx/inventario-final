const { pool } = require('../../config/db');
const repo = require('./prestatarios.repository');

const getPrestatarios = (negocioId) => repo.findAll(negocioId);

const crearPrestatario = ({ negocio_id, nombre, telefono }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  return repo.create({ negocio_id, nombre: nombre.trim(), telefono });
};

const getEmpleados = async (negocioId, prestatarioId) => {
  const prestatario = await repo.findById(prestatarioId, negocioId);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };
  return repo.getEmpleados(prestatarioId);
};

const crearEmpleado = async (negocioId, { prestatario_id, nombre }) => {
  if (!nombre?.trim()) throw { status: 400, message: 'El nombre es requerido' };
  const prestatario = await repo.findById(prestatario_id, negocioId);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };
  return repo.createEmpleado({ prestatario_id, nombre: nombre.trim() });
};

// ─── Signo por tipo ───────────────────────────────────────────────────────────
// +1 → prestatario te debe más | -1 → prestatario te debe menos
const SIGNO_POR_TIPO = {
  entrega_producto: 1,
  recibo_producto:  -1,
  pago_recibido:    -1,
  pago_enviado:     -1,
};

// ─── Helpers de inventario (reusan lógica de prestamos.service.js) ────────────

const _stockOutSerial = async (client, imei, sucursalId, nombreProducto) => {
  const { rows } = await client.query(`
    SELECT s.id FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    WHERE s.imei = $1 AND ps.sucursal_id = $2 AND s.vendido = false AND s.prestado = false
  `, [imei, sucursalId]);
  if (!rows.length) throw { status: 400, message: `El IMEI ${imei} no está disponible en inventario` };
  await client.query('UPDATE seriales SET prestado = true WHERE id = $1', [rows[0].id]);
};

const _stockOutCantidad = async (client, productoId, cantidad, sucursalId) => {
  const { rows } = await client.query(
    'SELECT id, stock, sucursal_id FROM productos_cantidad WHERE id = $1',
    [productoId]
  );
  const prod = rows[0];
  if (!prod) throw { status: 404, message: 'Producto no encontrado' };
  if (prod.sucursal_id !== sucursalId) throw { status: 400, message: 'Producto no pertenece a esta sucursal' };
  if (prod.stock < cantidad) throw { status: 400, message: `Stock insuficiente (disponible: ${prod.stock})` };
  await client.query('UPDATE productos_cantidad SET stock = stock - $1 WHERE id = $2', [cantidad, productoId]);
};

const _stockInSerial = async (client, { productoId, imei, costo, color, nombrePrestatario }) => {
  const { rows: dup } = await client.query(
    'SELECT id FROM seriales WHERE imei = $1 AND vendido = false',
    [imei]
  );
  if (dup.length) throw { status: 400, message: `El IMEI ${imei} ya existe en inventario` };
  await client.query(`
    INSERT INTO seriales(producto_id, imei, costo_compra, color, cliente_origen, prestado, vendido)
    VALUES ($1, $2, $3, $4, $5, false, false)
  `, [productoId, imei, costo || 0, color || null, nombrePrestatario || null]);
};

const _stockInCantidad = async (client, { productoId, cantidad, sucursalId, costo, nombrePrestatario }) => {
  await client.query('UPDATE productos_cantidad SET stock = stock + $1 WHERE id = $2', [cantidad, productoId]);
  await client.query(`
    INSERT INTO historial_stock_cantidad(producto_id, sucursal_id, cantidad, costo_unitario, tipo, cliente_origen)
    VALUES ($1, $2, $3, $4, 'recibo_prestatario', $5)
  `, [productoId, sucursalId, cantidad, costo || null, nombrePrestatario || null]);
};

const _revertirStockSerial = async (client, imei, sucursalId) => {
  await client.query(`
    UPDATE seriales s SET prestado = false
    FROM productos_serial ps
    WHERE s.imei = $1 AND ps.id = s.producto_id AND ps.sucursal_id = $2
  `, [imei, sucursalId]);
};

const _revertirStockInSerial = async (client, imei) => {
  const { rows } = await client.query(
    'SELECT id, vendido FROM seriales WHERE imei = $1 AND vendido = false',
    [imei]
  );
  if (!rows.length) throw { status: 400, message: `El IMEI ${imei} ya fue vendido, no se puede anular` };
  await client.query('DELETE FROM seriales WHERE id = $1', [rows[0].id]);
};

// ─── Cuenta corriente: registrar movimiento ───────────────────────────────────

const registrarMovimiento = async (negocioId, prestatarioId, datos, usuarioId) => {
  const {
    tipo, valor, descripcion,
    metodo, registrar_en_caja,
    nombre_producto, imei, producto_serial_id, producto_cantidad_id,
    cantidad, color, ingreso_inventario, costo_producto,
    sucursal_id,
    signo: signoManual,  // solo para ajuste_manual
  } = datos;

  if (!tipo) throw { status: 400, message: 'El tipo de movimiento es requerido' };
  if (!valor || Number(valor) <= 0) throw { status: 400, message: 'El valor debe ser mayor a cero' };
  if (!sucursal_id) throw { status: 400, message: 'La sucursal es requerida' };

  // Verificar que el prestatario pertenece al negocio
  const prestatario = await repo.findById(prestatarioId, negocioId);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };

  // Verificar que la sucursal pertenece al negocio
  const { rows: sucRows } = await pool.query(
    'SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true',
    [sucursal_id, negocioId]
  );
  if (!sucRows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  const signo = tipo === 'ajuste_manual'
    ? (signoManual === 1 || signoManual === -1 ? signoManual : (() => { throw { status: 400, message: 'El campo signo es requerido para ajuste_manual (1 o -1)' }; })())
    : SIGNO_POR_TIPO[tipo];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Efectos en inventario
    if (tipo === 'entrega_producto') {
      if (imei) {
        await _stockOutSerial(client, imei, sucursal_id, nombre_producto);
      } else if (producto_cantidad_id) {
        await _stockOutCantidad(client, producto_cantidad_id, cantidad || 1, sucursal_id);
      }
    } else if (tipo === 'recibo_producto' && ingreso_inventario) {
      if (imei && producto_serial_id) {
        await _stockInSerial(client, {
          productoId: producto_serial_id, imei, costo: costo_producto,
          color, nombrePrestatario: prestatario.nombre,
        });
      } else if (producto_cantidad_id) {
        await _stockInCantidad(client, {
          productoId: producto_cantidad_id, cantidad: cantidad || 1,
          sucursalId: sucursal_id, costo: costo_producto,
          nombrePrestatario: prestatario.nombre,
        });
      }
    }

    // Insertar movimiento
    const mov = await repo.insertarMovimiento(client, {
      prestatario_id: prestatarioId, sucursal_id, usuario_id: usuarioId,
      tipo, signo, valor: Number(valor), descripcion,
      metodo, registrar_en_caja: registrar_en_caja ?? false,
      nombre_producto, imei, producto_serial_id, producto_cantidad_id,
      cantidad: cantidad || 1, color, ingreso_inventario: ingreso_inventario ?? false,
      costo_producto,
    });

    // Registrar en caja si aplica
    if (registrar_en_caja && (tipo === 'pago_recibido' || tipo === 'pago_enviado')) {
      const caja = await repo.findCajaAbierta(client, sucursal_id);
      if (caja) {
        await repo.insertarMovimientoCaja(client, {
          caja_id:      caja.id,
          usuario_id:   usuarioId,
          tipo:         tipo === 'pago_recibido' ? 'Ingreso' : 'Egreso',
          concepto:     `${tipo === 'pago_recibido' ? 'Pago de' : 'Pago a'} prestatario: ${prestatario.nombre}`,
          valor:        Number(valor),
          referencia_id: mov.id,
          metodo,
        });
      }
    }

    await client.query('COMMIT');

    const saldo = await repo.getSaldo(prestatarioId, negocioId);
    return { movimiento: mov, saldo };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Cuenta corriente: anular movimiento ──────────────────────────────────────

const anularMovimiento = async (negocioId, prestatarioId, movimientoId, usuarioId, motivo) => {
  // Verificar que el prestatario pertenece al negocio
  const prestatario = await repo.findById(prestatarioId, negocioId);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mov = await repo.findMovimientoById(client, movimientoId);
    if (!mov) throw { status: 404, message: 'Movimiento no encontrado' };
    if (mov.prestatario_id !== Number(prestatarioId)) throw { status: 403, message: 'El movimiento no pertenece a este prestatario' };
    if (mov.anulado) throw { status: 400, message: 'Este movimiento ya fue anulado' };

    // Revertir inventario según tipo
    if (mov.tipo === 'entrega_producto') {
      if (mov.imei) {
        await _revertirStockSerial(client, mov.imei, mov.sucursal_id);
      } else if (mov.producto_cantidad_id) {
        await client.query(
          'UPDATE productos_cantidad SET stock = stock + $1 WHERE id = $2',
          [mov.cantidad || 1, mov.producto_cantidad_id]
        );
      }
    } else if (mov.tipo === 'recibo_producto' && mov.ingreso_inventario) {
      if (mov.imei) {
        await _revertirStockInSerial(client, mov.imei);
      } else if (mov.producto_cantidad_id) {
        await client.query(
          'UPDATE productos_cantidad SET stock = GREATEST(0, stock - $1) WHERE id = $2',
          [mov.cantidad || 1, mov.producto_cantidad_id]
        );
      }
    }

    // Revertir caja si había movimiento vinculado
    await repo.desactivarMovimientoCaja(client, movimientoId);

    // Soft delete
    const anulado = await repo.anularMovimiento(client, movimientoId, usuarioId, motivo);

    await client.query('COMMIT');

    const saldo = await repo.getSaldo(prestatarioId, negocioId);
    return { movimiento: anulado, saldo };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Cuenta corriente: consultas ─────────────────────────────────────────────

const getMovimientos = async (negocioId, prestatarioId) => {
  const prestatario = await repo.findById(prestatarioId, negocioId);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };
  return repo.getMovimientos(prestatarioId, negocioId);
};

const getSaldo = async (negocioId, prestatarioId) => {
  const prestatario = await repo.findById(prestatarioId, negocioId);
  if (!prestatario) throw { status: 404, message: 'Prestatario no encontrado' };
  return repo.getSaldo(prestatarioId, negocioId);
};

const getResumen = async (negocioId, prestatarioId) => {
  const resumen = await repo.getResumen(prestatarioId, negocioId);
  if (!resumen) throw { status: 404, message: 'Prestatario no encontrado' };
  return resumen;
};

module.exports = {
  getPrestatarios, crearPrestatario, getEmpleados, crearEmpleado,
  // Cuenta corriente
  registrarMovimiento, anularMovimiento, getMovimientos, getSaldo, getResumen,
};