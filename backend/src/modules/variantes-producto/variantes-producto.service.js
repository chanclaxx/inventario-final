const repo = require('./variantes-producto.repository');
const { calcularCostoPromedio } = require('../../utils/costoPromedio.util');
const { normalizarCodigo, exigirCodigoLibre, propagarCodigo } = require('../../utils/codigo.util');

// ── Código escaneable del nodo (feature opt-in `codigo_producto_activo`) ─────
// El código identifica lo que se escanea. Con variantes activas eso es el
// atributo o la sub-variante, no el producto. La unicidad se verifica contra
// los TRES niveles de la sucursal: dos nodos con el mismo código dejarían al
// lector sin forma de decidir cuál es.
const _resolverCodigo = async (datos, sucursalId, excluir) => {
  const codigo = normalizarCodigo(datos.codigo);
  if (codigo) await exigirCodigoLibre(null, { sucursalId, codigo, excluir });
  return codigo;
};

// Los índices únicos pueden saltar en una carrera de dos escrituras
// simultáneas; se traduce a un error claro en vez de un 500.
const _traducirCodigoDuplicado = (err) => {
  const c = String(err?.constraint || '');
  if (err?.code === '23505' && (c.includes('uq_atributos_producto_codigo') || c.includes('uq_variantes_atributo_codigo'))) {
    throw { status: 409, message: 'Ese código ya está en uso en esta sucursal' };
  }
  throw err;
};

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

  const codigo = await _resolverCodigo(datos, producto.sucursal_id, {});
  const atributo = await repo.crearAtributo(productoId, producto.sucursal_id, { ...datos, codigo })
    .catch(_traducirCodigoDuplicado);

  await repo.sincronizarStockProducto(productoId);
  await repo.sincronizarCostoProducto(productoId, atributo.costo_unitario);
  if (codigo) {
    const ctx = await repo.contextoAtributo(atributo.id);
    if (ctx) await propagarCodigo(null, { negocioId, identidad: { producto: ctx.producto_nombre, atributo: ctx.valor }, codigo });
  }
  return atributo;
};

const actualizarAtributo = async (negocioId, atributoId, datos) => {
  const atributo = await repo.verificarAtributoNegocio(atributoId, negocioId);
  if (!atributo) throw { status: 404, message: 'Atributo no encontrado' };

  const codigo = await _resolverCodigo(datos, atributo.sucursal_id, { atributo: atributoId });
  const actualizado = await repo.actualizarAtributo(atributoId, { ...datos, codigo })
    .catch(_traducirCodigoDuplicado);
  if (!actualizado) throw { status: 404, message: 'Atributo no encontrado' };

  if (datos.costo_unitario !== undefined) {
    await repo.sincronizarCostoProducto(atributo.producto_id, actualizado.costo_unitario);
  }
  // `undefined` = el cliente no mandó el campo: no se toca ni se propaga.
  if (codigo !== undefined) {
    const ctx = await repo.contextoAtributo(atributoId);
    if (ctx) await propagarCodigo(null, { negocioId, identidad: { producto: ctx.producto_nombre, atributo: ctx.valor }, codigo });
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

  const codigo = await _resolverCodigo(datos, atributo.sucursal_id, {});
  const variante = await repo.crearVariante(atributoId, { ...datos, codigo })
    .catch(_traducirCodigoDuplicado);

  await repo.sincronizarStockProducto(atributo.producto_id);
  await repo.sincronizarCostoProducto(atributo.producto_id, variante.costo_unitario);
  if (codigo) {
    const ctx = await repo.contextoVariante(variante.id);
    if (ctx) await propagarCodigo(null, { negocioId, identidad: { producto: ctx.producto_nombre, atributo: ctx.atributo_valor, variante: ctx.valor }, codigo });
  }
  return variante;
};

const actualizarVariante = async (negocioId, varianteId, datos) => {
  const variante = await repo.verificarVarianteNegocio(varianteId, negocioId);
  if (!variante) throw { status: 404, message: 'Variante no encontrada' };

  const codigo = await _resolverCodigo(datos, variante.sucursal_id, { variante: varianteId });
  const actualizado = await repo.actualizarVariante(varianteId, { ...datos, codigo })
    .catch(_traducirCodigoDuplicado);
  if (!actualizado) throw { status: 404, message: 'Variante no encontrada' };

  if (datos.costo_unitario !== undefined) {
    await repo.sincronizarCostoProducto(variante.producto_id, actualizado.costo_unitario);
  }
  if (codigo !== undefined) {
    const ctx = await repo.contextoVariante(varianteId);
    if (ctx) await propagarCodigo(null, { negocioId, identidad: { producto: ctx.producto_nombre, atributo: ctx.atributo_valor, variante: ctx.valor }, codigo });
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
