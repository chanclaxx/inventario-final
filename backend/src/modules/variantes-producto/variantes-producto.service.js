const repo = require('./variantes-producto.repository');
const { calcularCostoPromedio } = require('../../utils/costoPromedio.util');

const getArbol = async (negocioId, productoId, sucursalId) => {
  const producto = await repo.verificarProductoNegocio(productoId, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  return repo.getArbol(productoId, sucursalId || producto.sucursal_id);
};

const crearAtributo = async (negocioId, productoId, datos) => {
  const producto = await repo.verificarProductoNegocio(productoId, negocioId);
  if (!producto) throw { status: 404, message: 'Producto no encontrado' };
  if (!datos.valor?.trim()) throw { status: 400, message: 'El valor es requerido' };
  if (Number(datos.stock || 0) < 0) throw { status: 400, message: 'El stock inicial no puede ser negativo' };
  const atributo = await repo.crearAtributo(productoId, producto.sucursal_id, datos);
  await repo.sincronizarStockProducto(productoId);
  await repo.sincronizarCostoProducto(productoId, atributo.costo_unitario);
  return atributo;
};

const actualizarAtributo = async (negocioId, atributoId, datos) => {
  const atributo = await repo.verificarAtributoNegocio(atributoId, negocioId);
  if (!atributo) throw { status: 404, message: 'Atributo no encontrado' };
  const actualizado = await repo.actualizarAtributo(atributoId, datos);
  if (!actualizado) throw { status: 404, message: 'Atributo no encontrado' };
  if (datos.costo_unitario !== undefined) {
    await repo.sincronizarCostoProducto(atributo.producto_id, actualizado.costo_unitario);
  }
  return actualizado;
};

const eliminarAtributo = async (negocioId, atributoId) => {
  const atributo = await repo.verificarAtributoNegocio(atributoId, negocioId);
  if (!atributo) throw { status: 404, message: 'Atributo no encontrado' };
  if (atributo.stock > 0) {
    throw { status: 409, message: `No se puede eliminar: el atributo tiene stock (${atributo.stock}). Ajústalo a 0 primero.` };
  }
  await repo.eliminarAtributo(atributoId);
  await repo.sincronizarStockProducto(atributo.producto_id);
};

const crearVariante = async (negocioId, atributoId, datos) => {
  const atributo = await repo.verificarAtributoNegocio(atributoId, negocioId);
  if (!atributo) throw { status: 404, message: 'Atributo no encontrado' };
  if (!datos.valor?.trim()) throw { status: 400, message: 'El valor es requerido' };
  if (Number(datos.stock || 0) < 0) throw { status: 400, message: 'El stock inicial no puede ser negativo' };
  const variante = await repo.crearVariante(atributoId, datos);
  await repo.sincronizarStockProducto(atributo.producto_id);
  await repo.sincronizarCostoProducto(atributo.producto_id, variante.costo_unitario);
  return variante;
};

const actualizarVariante = async (negocioId, varianteId, datos) => {
  const variante = await repo.verificarVarianteNegocio(varianteId, negocioId);
  if (!variante) throw { status: 404, message: 'Variante no encontrada' };
  const actualizado = await repo.actualizarVariante(varianteId, datos);
  if (!actualizado) throw { status: 404, message: 'Variante no encontrada' };
  if (datos.costo_unitario !== undefined) {
    await repo.sincronizarCostoProducto(variante.producto_id, actualizado.costo_unitario);
  }
  return actualizado;
};

const eliminarVariante = async (negocioId, varianteId) => {
  const variante = await repo.verificarVarianteNegocio(varianteId, negocioId);
  if (!variante) throw { status: 404, message: 'Variante no encontrada' };
  if (variante.stock > 0) {
    throw { status: 409, message: `No se puede eliminar: la variante tiene stock (${variante.stock}). Ajústalo a 0 primero.` };
  }
  await repo.eliminarVariante(varianteId);
  await repo.sincronizarStockProducto(variante.producto_id);
};

const ajustarStockAtributo = async (negocioId, atributoId, cantidad, opciones = {}) => {
  const atributo = await repo.verificarAtributoNegocio(atributoId, negocioId);
  if (!atributo) throw { status: 404, message: 'Atributo no encontrado' };
  if (cantidad < 0 && (atributo.stock + cantidad) < 0) {
    throw { status: 400, message: `Stock insuficiente. Stock actual: ${atributo.stock}` };
  }
  if (cantidad > 0 && opciones.costo_unitario != null && Number(opciones.costo_unitario) > 0) {
    opciones._costo_nuevo = calcularCostoPromedio(
      atributo.stock, atributo.costo_unitario, cantidad, opciones.costo_unitario
    );
  }
  await repo.ajustarStockAtributo(
    atributoId, cantidad, atributo.producto_id, atributo.sucursal_id, opciones
  );
  await repo.sincronizarStockProducto(atributo.producto_id);
  await repo.sincronizarCostoProducto(atributo.producto_id, opciones._costo_nuevo ?? null);
};

const ajustarStockVariante = async (negocioId, varianteId, cantidad, opciones = {}) => {
  const variante = await repo.verificarVarianteNegocio(varianteId, negocioId);
  if (!variante) throw { status: 404, message: 'Variante no encontrada' };
  if (cantidad < 0 && (variante.stock + cantidad) < 0) {
    throw { status: 400, message: `Stock insuficiente. Stock actual: ${variante.stock}` };
  }
  if (cantidad > 0 && opciones.costo_unitario != null && Number(opciones.costo_unitario) > 0) {
    opciones._costo_nuevo = calcularCostoPromedio(
      variante.stock, variante.costo_unitario, cantidad, opciones.costo_unitario
    );
  }
  await repo.ajustarStockVariante(
    varianteId, variante.atributo_id, cantidad,
    variante.producto_id, variante.sucursal_id, opciones
  );
  await repo.sincronizarStockProducto(variante.producto_id);
  await repo.sincronizarCostoProducto(variante.producto_id, opciones._costo_nuevo ?? null);
};

module.exports = {
  getArbol,
  crearAtributo, actualizarAtributo, eliminarAtributo,
  crearVariante, actualizarVariante, eliminarVariante,
  ajustarStockAtributo, ajustarStockVariante,
};
