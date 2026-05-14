const repo = require('./variantes-producto.repository');

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
  return atributo;
};

const actualizarAtributo = async (negocioId, atributoId, datos) => {
  const atributo = await repo.verificarAtributoNegocio(atributoId, negocioId);
  if (!atributo) throw { status: 404, message: 'Atributo no encontrado' };
  const actualizado = await repo.actualizarAtributo(atributoId, datos);
  if (!actualizado) throw { status: 404, message: 'Atributo no encontrado' };
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
  return variante;
};

const actualizarVariante = async (negocioId, varianteId, datos) => {
  const variante = await repo.verificarVarianteNegocio(varianteId, negocioId);
  if (!variante) throw { status: 404, message: 'Variante no encontrada' };
  const actualizado = await repo.actualizarVariante(varianteId, datos);
  if (!actualizado) throw { status: 404, message: 'Variante no encontrada' };
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
  await repo.ajustarStockAtributo(
    atributoId, cantidad, atributo.producto_id, atributo.sucursal_id, opciones
  );
  await repo.sincronizarStockProducto(atributo.producto_id);
};

const ajustarStockVariante = async (negocioId, varianteId, cantidad, opciones = {}) => {
  const variante = await repo.verificarVarianteNegocio(varianteId, negocioId);
  if (!variante) throw { status: 404, message: 'Variante no encontrada' };
  if (cantidad < 0 && (variante.stock + cantidad) < 0) {
    throw { status: 400, message: `Stock insuficiente. Stock actual: ${variante.stock}` };
  }
  await repo.ajustarStockVariante(
    varianteId, variante.atributo_id, cantidad,
    variante.producto_id, variante.sucursal_id, opciones
  );
  await repo.sincronizarStockProducto(variante.producto_id);
};

module.exports = {
  getArbol,
  crearAtributo, actualizarAtributo, eliminarAtributo,
  crearVariante, actualizarVariante, eliminarVariante,
  ajustarStockAtributo, ajustarStockVariante,
};
