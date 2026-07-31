const { pool }              = require('../../config/db');
const repo                  = require('./productosCantidad.repository');
const { calcularCostoPromedio } = require('../../utils/costoPromedio.util');
const { normalizarUbicacion }   = require('../../utils/ubicacion.util');

// ── Verifica que linea_id pertenece al negocio ────────────────────────────
const _verificarLineaNegocio = async (lineaId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id FROM lineas_producto WHERE id = $1 AND negocio_id = $2`,
    [lineaId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'La línea no pertenece a este negocio' };
};

// ── Código único de producto (feature opt-in tipo supermercado) ──────────
// undefined → no tocar (clientes que no envían el campo no notan nada);
// ''/null   → limpiar; texto → trim + mayúsculas (el lector siempre manda
// la misma cadena; la entrada manual puede variar en mayúsculas).
const _normalizarCodigo = (codigo) => {
  if (codigo === undefined) return undefined;
  const limpio = String(codigo ?? '').trim().toUpperCase();
  if (!limpio) return null;
  if (/\s/.test(limpio)) throw { status: 400, message: 'El código no puede contener espacios' };
  if (limpio.length > 50) throw { status: 400, message: 'El código no puede superar 50 caracteres' };
  return limpio;
};

const _validarCodigoUnico = async (negocioId, codigo, nombre, excluirId = null) => {
  const conflicto = await repo.codigoEnConflicto(negocioId, codigo, nombre, excluirId);
  if (conflicto) {
    throw {
      status: 409,
      message: `El código ${codigo} ya está en uso por "${conflicto.nombre}" (${conflicto.sucursal_nombre})`,
    };
  }
};

// El índice único (sucursal_id, codigo) puede saltar en una carrera de dos
// escrituras simultáneas; se traduce a un error claro en vez de un 500.
const _traducirCodigoDuplicado = (err) => {
  if (err?.code === '23505' && String(err.constraint || '').includes('uq_productos_cantidad_codigo')) {
    throw { status: 409, message: 'Ese código ya está en uso por otro producto de la sucursal' };
  }
  throw err;
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

  let codigo = _normalizarCodigo(datos.codigo);
  if (codigo) {
    await _validarCodigoUnico(negocioId, codigo, datos.nombre);
  } else {
    // Mismo producto (mismo nombre) ya creado en otra sucursal → hereda su código,
    // para que el escaneo funcione igual en todas las sucursales del negocio.
    codigo = await repo.codigoHeredado(negocioId, datos.nombre, datos.sucursal_id);
  }

  // A diferencia del código, la ubicación NO se hereda de otra sucursal:
  // describe un lugar físico y el "Estante A-3" de una sede no existe en otra.
  const ubicacion = normalizarUbicacion(datos.ubicacion);

  const creado = await repo.create({ ...datos, codigo, ubicacion }).catch(_traducirCodigoDuplicado);
  if (codigo) await repo.sincronizarCodigoPorNombre(negocioId, creado.nombre, codigo);
  return creado;
};

const actualizarProducto = async (negocioId, id, datos) => {
  const producto = await repo.findByIdYNegocio(id, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };

  if (datos.linea_id) {
    await _verificarLineaNegocio(datos.linea_id, negocioId);
  }

  const codigo = _normalizarCodigo(datos.codigo);
  // Solo se valida cuando el código realmente cambia: reguardar un producto con
  // el código que ya tenía no debe fallar (no está tomando el código de nadie).
  if (codigo && codigo !== producto.codigo) {
    await _validarCodigoUnico(negocioId, codigo, datos.nombre ?? producto.nombre, producto.id);
  }

  const ubicacion = normalizarUbicacion(datos.ubicacion);

  const actualizado = await repo.update(id, { ...datos, codigo, ubicacion }).catch(_traducirCodigoDuplicado);
  if (!actualizado) throw { status: 404, message: 'Producto no encontrado' };
  if (codigo !== undefined) {
    await repo.sincronizarCodigoPorNombre(negocioId, actualizado.nombre, codigo);
  }
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

  // Promedio ponderado móvil — solo en entradas con costo conocido
  const costoAjustado = (cantidad > 0 && costo_unitario != null && Number(costo_unitario) > 0)
    ? calcularCostoPromedio(producto.stock, producto.costo_unitario, cantidad, costo_unitario)
    : (costo_unitario > 0 ? costo_unitario : null);

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