const { pool }              = require('../../config/db');
const repo                  = require('./productosCantidad.repository');
const { calcularCostoPromedio } = require('../../utils/costoPromedio.util');
const { normalizarUbicacion }   = require('../../utils/ubicacion.util');
const { normalizarCodigo: _normalizarCodigo, exigirCodigoLibre, propagarCodigo } = require('../../utils/codigo.util');
const { asignarAlCrear, asignarEnTransaccion } = require('../../utils/codigoAuto.util');
const variantesRepo = require('../variantes-producto/variantes-producto.repository');

// ── Crear el producto CON sus variantes, de una vez ──────────────────────────
//
// Antes eran pasos inconexos: crear el producto, cerrar, buscarlo, abrir su
// árbol, crear la talla, volver, crear la siguiente… Y si algo fallaba a mitad
// quedaba un producto con la mitad de sus variantes, que es peor que no tenerlo.
// Ahora `POST /productos-cantidad` acepta `variantes` y todo va en UNA
// transacción: o nace el producto con su árbol completo, o no nace nada.
//
// Forma del árbol (la misma de `getArbol`, sin ids):
//   variantes: [{ valor, tipo_id?, precio?, costo_unitario?, codigo?,
//                 variantes?: [{ valor, tipo_id?, precio?, costo_unitario?, codigo? }] }]
//
// NO trae stock, a propósito: lo que entra al inventario tiene que dejar rastro
// (compra, entrada o ajuste con su historial) y las dos pantallas que crean
// productos ya tienen ese paso justo después — con el árbol recién creado
// piden la cantidad por variante.
//
// Sin `variantes` (o vacío) el camino es exactamente el de siempre.
const MAX_HOJAS_AL_CREAR = 200;

const _numeroOpcional = (x, campo) => {
  if (x === undefined || x === null || x === '') return null;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) throw { status: 400, message: `${campo} no es un valor válido` };
  return n;
};

const _limpiarNodoNuevo = (n, donde) => {
  const valor = String(n?.valor ?? '').trim();
  if (!valor) throw { status: 400, message: `Hay una variante sin nombre en ${donde}` };
  return {
    valor,
    tipo_id:        n.tipo_id ? Number(n.tipo_id) : null,
    precio:         _numeroOpcional(n.precio, `El precio de «${valor}»`),
    costo_unitario: _numeroOpcional(n.costo_unitario, `El costo de «${valor}»`),
    codigo:         _normalizarCodigo(n.codigo) ?? null,
  };
};

// Dos «Blanco» en el mismo nivel se sumarían al recibir y nadie sabría después
// cuál es cuál: se rechaza en vez de crear el gemelo.
const _sinRepetidos = (lista, donde) => {
  const vistos = new Set();
  for (const n of lista) {
    const k = n.valor.toLowerCase();
    if (vistos.has(k)) throw { status: 400, message: `«${n.valor}» está repetido en ${donde}` };
    vistos.add(k);
  }
};

const _normalizarArbolNuevo = (variantes, codigoProducto) => {
  if (variantes === undefined || variantes === null) return [];
  if (!Array.isArray(variantes)) throw { status: 400, message: 'Las variantes deben ser una lista' };

  const arbol = variantes.map((a) => ({
    ..._limpiarNodoNuevo(a, 'el producto'),
    variantes: Array.isArray(a?.variantes) ? a.variantes.map((v) => _limpiarNodoNuevo(v, `«${a.valor}»`)) : [],
  }));
  _sinRepetidos(arbol, 'las variantes del producto');
  arbol.forEach((a) => _sinRepetidos(a.variantes, `«${a.valor}»`));

  const hojas = arbol.reduce((s, a) => s + Math.max(1, a.variantes.length), 0);
  if (hojas > MAX_HOJAS_AL_CREAR) {
    throw { status: 400, message: `Un producto puede nacer con hasta ${MAX_HOJAS_AL_CREAR} variantes. Crea el resto desde su árbol.` };
  }

  // Un código escrito a mano repetido DENTRO del mismo árbol no lo ve la
  // verificación contra la base (ninguno existe todavía).
  const codigos = [codigoProducto, ...arbol.map((a) => a.codigo), ...arbol.flatMap((a) => a.variantes.map((v) => v.codigo))]
    .filter(Boolean);
  const repetido = codigos.find((c, i) => codigos.indexOf(c) !== i);
  if (repetido) throw { status: 409, message: `El código ${repetido} está repetido en el producto` };
  return arbol;
};

// Mismas dos llaves que ya cuidan crear una variante suelta: la feature
// encendida y `admin_negocio` (la ruta de atributos lo exige). Crear el producto
// lo puede un vendedor, pero sus variantes no — si no, este endpoint sería la
// puerta de atrás de esa regla.
const _exigirPuedeCrearVariantes = async (negocioId, rol, arbol) => {
  const { rows } = await pool.query(
    `SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'variantes_activo'`,
    [negocioId]
  );
  if (rows[0]?.valor !== '1') {
    throw { status: 400, message: 'Activa las variantes en Ajustes para crear productos con variantes.' };
  }
  if (rol !== 'admin_negocio') {
    throw { status: 403, message: 'Solo el administrador del negocio puede crear variantes.' };
  }
  // El tipo (Talla, Color…) se pinta junto al valor en todo el sistema: uno de
  // otro negocio filtraría su nombre.
  const tipos = [...new Set([...arbol.map((a) => a.tipo_id), ...arbol.flatMap((a) => a.variantes.map((v) => v.tipo_id))]
    .filter(Boolean))];
  if (tipos.length) {
    const { rows: propios } = await pool.query(
      'SELECT id FROM tipos_caracteristica WHERE id = ANY($1::int[]) AND negocio_id = $2',
      [tipos, negocioId]
    );
    if (propios.length !== tipos.length) throw { status: 403, message: 'Tipo de característica no válido para este negocio' };
  }
};

const _crearConVariantes = async (negocioId, datos, arbol) => {
  // Los códigos escritos a mano se verifican ANTES de abrir la transacción, con
  // el mismo mensaje que al crear una variante suelta.
  for (const n of [...arbol, ...arbol.flatMap((a) => a.variantes)]) {
    if (n.codigo) await exigirCodigoLibre(null, { sucursalId: datos.sucursal_id, codigo: n.codigo });
  }

  const client = await pool.connect();
  let creado;
  const manuales = [];
  try {
    await client.query('BEGIN');
    // El stock del producto con variantes es un derivado (Σ hojas); nace en 0.
    creado = await repo.create({ ...datos, stock: 0 }, client);

    const nodos = datos.codigo ? [] : [{ nivel: 'producto', id: creado.id }];
    for (const a of arbol) {
      const atr = await variantesRepo.crearAtributo(creado.id, creado.sucursal_id, { ...a, stock: 0 }, client);
      // Una talla con sub-variantes es un CONTENEDOR: lo que existe en el
      // estante es la 38MM Negra, no «la 38MM». Darle código al contenedor
      // gastaría un número en algo que no se etiqueta (mismo criterio que
      // Etiquetas y el despacho de la red interna: se etiqueta la HOJA).
      if (a.codigo)                 manuales.push({ producto: creado.nombre, atributo: atr.valor, codigo: a.codigo });
      else if (!a.variantes.length) nodos.push({ nivel: 'atributo', id: atr.id });

      for (const v of a.variantes) {
        const va = await variantesRepo.crearVariante(atr.id, { ...v, stock: 0 }, client);
        if (v.codigo) manuales.push({ producto: creado.nombre, atributo: atr.valor, variante: va.valor, codigo: v.codigo });
        else          nodos.push({ nivel: 'variante', id: va.id });
      }
    }

    // El producto y cada hoja nacen con su código, en la MISMA transacción: con
    // patrón comparten la numeración de su raíz CAT-PRO, así que salen seguidos.
    const asignados = await asignarEnTransaccion(client, { negocioId, sucursalId: creado.sucursal_id, nodos });
    const delProducto = asignados.find((x) => x.nivel === 'producto');
    if (delProducto) creado.codigo = delProducto.codigo;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505' && String(err.constraint || '').includes('codigo')) {
      throw { status: 409, message: 'Uno de los códigos ya está en uso en esta sucursal' };
    }
    throw err;
  } finally {
    client.release();
  }

  // Después del COMMIT, igual que los caminos sueltos: propagar a otras sedes es
  // best-effort y no puede deshacer lo creado.
  if (datos.codigo) await repo.sincronizarCodigoPorNombre(negocioId, creado.nombre, datos.codigo);
  for (const m of manuales) {
    await propagarCodigo(null, {
      negocioId,
      identidad: { producto: m.producto, atributo: m.atributo, variante: m.variante ?? null },
      codigo: m.codigo,
    });
  }

  creado.arbol = await variantesRepo.getArbol(creado.id, creado.sucursal_id);
  return creado;
};

// ── Verifica que linea_id pertenece al negocio ────────────────────────────
const _verificarLineaNegocio = async (lineaId, negocioId) => {
  const { rows } = await pool.query(
    `SELECT id FROM lineas_producto WHERE id = $1 AND negocio_id = $2`,
    [lineaId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'La línea no pertenece a este negocio' };
};

// ── Código único de producto (feature opt-in tipo supermercado) ──────────
// La normalización vive en utils/codigo.util.js, compartida con los atributos
// y sub-variantes: el mismo código escrito en dos sitios distintos tiene que
// quedar idéntico en la BD o el lector no lo encuentra.
//
// Son DOS reglas, y las dos hacen falta:
//   1. un código = un solo nombre de producto dentro del NEGOCIO
//      (el mismo producto en dos sedes comparte código a propósito);
//   2. un código = un solo nodo escaneable dentro de la SUCURSAL, contando
//      productos, atributos y variantes — si no, el lector no sabría si el
//      código es del producto o de la talla 38MM de otro.
const _validarCodigoUnico = async (negocioId, sucursalId, codigo, nombre, excluirId = null) => {
  const conflicto = await repo.codigoEnConflicto(negocioId, codigo, nombre, excluirId);
  if (conflicto) {
    throw {
      status: 409,
      message: `El código ${codigo} ya está en uso por "${conflicto.nombre}" (${conflicto.sucursal_nombre})`,
    };
  }
  await exigirCodigoLibre(null, { sucursalId, codigo, excluir: { producto: excluirId ?? undefined } });
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

const crearProducto = async (negocioId, datos, { rol } = {}) => {
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [datos.sucursal_id, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  if (!datos.linea_id) throw { status: 400, message: 'La línea es requerida' };
  await _verificarLineaNegocio(datos.linea_id, negocioId);

  const arbol = _normalizarArbolNuevo(datos.variantes, _normalizarCodigo(datos.codigo));
  if (arbol.length) await _exigirPuedeCrearVariantes(negocioId, rol, arbol);

  let codigo = _normalizarCodigo(datos.codigo);
  if (codigo) {
    await _validarCodigoUnico(negocioId, datos.sucursal_id, codigo, datos.nombre);
  } else {
    // Mismo producto (mismo nombre) ya creado en otra sucursal → hereda su código,
    // para que el escaneo funcione igual en todas las sucursales del negocio.
    codigo = await repo.codigoHeredado(negocioId, datos.nombre, datos.sucursal_id);
  }

  // A diferencia del código, la ubicación NO se hereda de otra sucursal:
  // describe un lugar físico y el "Estante A-3" de una sede no existe en otra.
  const ubicacion = normalizarUbicacion(datos.ubicacion);

  if (arbol.length) {
    const { variantes: _omit, ...resto } = datos;
    return _crearConVariantes(negocioId, { ...resto, codigo, ubicacion }, arbol);
  }

  const creado = await repo.create({ ...datos, codigo, ubicacion }).catch(_traducirCodigoDuplicado);
  if (codigo) {
    await repo.sincronizarCodigoPorNombre(negocioId, creado.nombre, codigo);
  } else {
    // Ni escrito ni heredado: con el código automático encendido nace con el
    // siguiente del negocio (utils/codigoAuto.util.js). Después de crear y no
    // antes, porque asignar el código nunca puede impedir que el producto
    // exista: si falla, queda sin código y se le genera desde Etiquetas.
    const automatico = await asignarAlCrear({
      negocioId, sucursalId: creado.sucursal_id, nivel: 'producto', id: creado.id,
    });
    if (automatico) creado.codigo = automatico;
  }
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
    await _validarCodigoUnico(negocioId, producto.sucursal_id, codigo, datos.nombre ?? producto.nombre, producto.id);
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