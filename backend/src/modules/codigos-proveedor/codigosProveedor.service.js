const { pool } = require('../../config/db');
const repo     = require('./codigosProveedor.repository');

// ─────────────────────────────────────────────────────────────────────────────
// EL RESOLUTOR ES UNO SOLO.
//
// `resolverCodigo` es la única función que traduce una referencia de proveedor a
// un producto. La usan la recepción de mercancía, el importador y el PDF de la
// orden. Si alguna escribiera la suya se desincronizarían y acabarían apuntando
// a productos distintos — ya pasó con `nombreColumnaCaracteristica` en la
// importación, y por eso allá también se compartió.
// ─────────────────────────────────────────────────────────────────────────────

const _verificarProveedor = async (proveedorId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id, nombre FROM proveedores WHERE id = $1 AND negocio_id = $2`,
    [proveedorId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Proveedor no válido para este negocio' };
  return rows[0];
};

const listar = async (negocioId, proveedorId) => {
  await _verificarProveedor(proveedorId, negocioId);
  return repo.findByProveedor(negocioId, proveedorId);
};

/**
 * Traduce la referencia de una remisión al producto de esta sucursal.
 *
 * Tres respuestas posibles, y la diferencia importa para la interfaz:
 *
 *   { estado: 'resuelto'  } → hay equivalencia y el producto existe aquí
 *   { estado: 'sin_producto' } → hay equivalencia pero el producto no está en
 *       esta sucursal (o está inactivo): hay que crearlo aquí, no re-enseñar
 *       la equivalencia
 *   { estado: 'desconocido' } → nadie ha dicho qué es: se le pregunta al
 *       usuario y se aprende
 */
const resolverCodigo = async (negocioId, { proveedor_id, codigo, sucursal_id }) => {
  const texto = String(codigo || '').trim();
  if (!texto) throw { status: 400, message: 'Indica el código del proveedor' };
  if (!sucursal_id) throw { status: 400, message: 'Indica la sucursal donde se recibe' };

  await _verificarProveedor(proveedor_id, negocioId);

  const fila = await repo.resolver(negocioId, proveedor_id, texto, sucursal_id);
  if (!fila) return { estado: 'desconocido', codigo_proveedor: texto };

  if (!fila.producto_id) {
    return {
      estado: 'sin_producto',
      codigo_proveedor: fila.codigo_proveedor,
      codigo_interno:   fila.codigo_interno,
      descripcion_proveedor: fila.descripcion_proveedor,
    };
  }

  return {
    estado: 'resuelto',
    codigo_proveedor:      fila.codigo_proveedor,
    codigo_interno:        fila.codigo_interno,
    descripcion_proveedor: fila.descripcion_proveedor,
    producto: {
      id:             fila.producto_id,
      nombre:         fila.producto_nombre,
      stock:          fila.stock,
      costo_unitario: fila.costo_unitario,
    },
  };
};

/**
 * Aprende una equivalencia. Es el camino normal: nadie se sienta a capturar
 * esta tabla, se llena sola cuando alguien resuelve un código a mano al recibir.
 *
 * Se valida que el código interno exista en el negocio para no guardar
 * equivalencias que apunten al vacío — una equivalencia rota manda mercancía al
 * producto equivocado y corrompe el costo promedio de dos productos a la vez.
 */
const aprender = async (negocioId, {
  proveedor_id, codigo_proveedor, codigo_interno, descripcion_proveedor, usuario_id,
}) => {
  await _verificarProveedor(proveedor_id, negocioId);

  const interno = String(codigo_interno || '').trim();
  if (!interno) throw { status: 400, message: 'Indica el código interno del producto' };

  const producto = await repo.codigoInternoExiste(negocioId, interno);
  if (!producto) {
    throw {
      status: 400,
      message: `Ningún producto de tu inventario tiene el código ${interno}. `
        + 'Asígnaselo primero al producto y vuelve a intentarlo.',
    };
  }

  const client = await pool.connect();
  try {
    const fila = await repo.guardar(client, {
      negocio_id: negocioId, proveedor_id,
      codigo_proveedor, codigo_interno: interno,
      descripcion_proveedor, usuario_id,
    });
    return { ...fila, producto_nombre: producto.nombre };
  } finally {
    client.release();
  }
};

const eliminar = async (negocioId, id) => {
  const ok = await repo.eliminar(negocioId, id);
  if (!ok) throw { status: 404, message: 'Equivalencia no encontrada' };
};

/**
 * Cómo llama cada proveedor a un producto tuyo. Alimenta el PDF de la orden:
 * se imprime con SUS referencias para que la lea sin traducir, que es de donde
 * salen la mitad de los faltantes.
 */
const porCodigoInterno = (negocioId, codigoInterno) =>
  repo.findByCodigoInterno(negocioId, String(codigoInterno || '').trim());

module.exports = { listar, resolverCodigo, aprender, eliminar, porCodigoInterno };
