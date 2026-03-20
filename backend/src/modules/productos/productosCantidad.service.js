const { pool } = require('../../config/db');
const repo     = require('./productosCantidad.repository');

// ── Verifica que linea_id pertenece al negocio ────────────────────────────
const _verificarLineaNegocio = async (lineaId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id FROM lineas_producto WHERE id = $1 AND negocio_id = $2`,
    [lineaId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'La línea no pertenece a este negocio' };
};

// ── Promedio ponderado móvil ───────────────────────────────────────────────
// Solo se calcula cuando hay una entrada de stock (cantidad > 0) con costo.
// Fórmula: (stock_actual × costo_actual + cantidad_nueva × costo_nuevo)
//          ÷ (stock_actual + cantidad_nueva)
// Si stock_actual = 0 o costo_actual es null, el nuevo costo se usa directo.
const _calcularCostoPromedio = (stockActual, costoActual, cantidadNueva, costoNuevo) => {
  const stock  = Math.max(0, stockActual  || 0);
  const costo  = Number(costoActual  || 0);
  const cantN  = Number(cantidadNueva);
  const costoN = Number(costoNuevo);

  if (stock === 0) return costoN;
  return Math.round((stock * costo + cantN * costoN) / (stock + cantN));
};

const getProductos = (sucursalId, negocioId, lineaId) =>
  repo.findAll(sucursalId, negocioId, lineaId);

const getProductoById = async (negocioId, id) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return producto;
};

const crearProducto = async (negocioId, datos) => {
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [datos.sucursal_id, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  if (!datos.linea_id) throw { status: 400, message: 'La línea es requerida' };
  await _verificarLineaNegocio(datos.linea_id, negocioId);

  return repo.create(datos);
};

const actualizarProducto = async (negocioId, id, datos) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  if (datos.linea_id) {
    await _verificarLineaNegocio(datos.linea_id, negocioId);
  }

  const actualizado = await repo.update(id, datos);
  if (!actualizado) throw { status: 404, message: 'Producto no encontrado' };
  return actualizado;
};

const ajustarStock = async (
  negocioId, id, cantidad,
  { costo_unitario, proveedor_id, cliente_origen, cedula_cliente, tipo, notas } = {}
) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  if (cantidad < 0 && (producto.stock + cantidad) < 0) {
    throw { status: 400, message: `Stock insuficiente. Stock actual: ${producto.stock}` };
  }

  // ── Promedio ponderado móvil ───────────────────────────────────────────
  // Solo aplica cuando es una ENTRADA de stock (cantidad > 0) con costo.
  // Ventas, devoluciones y ajustes sin costo no modifican el promedio.
  const costoAjustado = (cantidad > 0 && costo_unitario != null)
    ? _calcularCostoPromedio(
        producto.stock,
        producto.costo_unitario,
        cantidad,
        costo_unitario,
      )
    : costo_unitario;

  const actualizado = await repo.ajustarStock(id, cantidad, {
    costo_unitario: costoAjustado,
    proveedor_id,
    cliente_origen,
  });

  const tipoMovimiento = tipo
    || (cliente_origen ? 'compra_cliente'
    : proveedor_id     ? 'compra_proveedor'
    :                    'ajuste');

  await repo.insertarHistorial({
    producto_id:    id,
    sucursal_id:    producto.sucursal_id,
    cantidad,
    costo_unitario: costoAjustado ?? null,
    tipo:           tipoMovimiento,
    cliente_origen: cliente_origen || null,
    cedula_cliente: cedula_cliente || null,
    proveedor_id:   proveedor_id   || null,
    notas:          notas          || null,
  });

  return actualizado;
};

const eliminarProducto = async (negocioId, id) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  await repo.eliminar(id);
};

const getHistorialStock = (negocioId, q) =>
  repo.getHistorialStock(negocioId, q || '');

module.exports = {
  getProductos, getProductoById, crearProducto,
  actualizarProducto, ajustarStock, eliminarProducto, getHistorialStock,
};