const { pool } = require('../../config/db');
const repo     = require('./ordenesCompra.repository');

// ─────────────────────────────────────────────────────────────────────────────
// El estado que ve el usuario NO es el que está guardado.
//
// En la BD solo viven las decisiones humanas (Borrador / Emitida / Cerrada /
// Anulada). Si una orden está parcial o completa se calcula aquí, a partir de
// las recepciones — así una cancelación o una devolución la reabren solas, sin
// que nada tenga que acordarse de corregir un contador.
// ─────────────────────────────────────────────────────────────────────────────
const _estadoRecepcion = (pedidas, recibidas) => {
  const p = Number(pedidas || 0);
  const r = Number(recibidas || 0);
  if (p === 0) return 'sin_lineas';
  if (r <= 0)  return 'sin_recibir';
  if (r >= p)  return 'completa';
  return 'parcial';
};

const _hoyBogota = () => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return new Date(`${fmt.format(new Date())}T00:00:00Z`);
};

// `fecha_vencimiento` es DATE (medianoche UTC); el hoy es el de Bogotá. Sin esa
// distinción, "vence hoy" se vuelve "venció ayer" después de las 7 p.m. — es la
// misma confusión de TIMESTAMP vs DATE que ya costó dos veces en mora.service.
const _diasHasta = (fecha) => {
  if (!fecha) return null;
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - _hoyBogota().getTime()) / 86400000);
};

/**
 * Semáforo de la cuenta por pagar. Solo informa: nunca bloquea recibir, comprar
 * ni vender. En el momento en que una orden vencida impida trabajar, el negocio
 * apaga la feature.
 */
const _estadoPago = (orden, diasAviso) => {
  if (!orden.numero_factura && !orden.fecha_vencimiento) return { estado_pago: 'sin_factura', dias_para_vencer: null };
  if (!orden.fecha_vencimiento) return { estado_pago: 'sin_plazo', dias_para_vencer: null };

  const dias = _diasHasta(orden.fecha_vencimiento);
  if (dias == null) return { estado_pago: 'sin_plazo', dias_para_vencer: null };
  if (dias < 0)          return { estado_pago: 'vencida',    dias_para_vencer: dias };
  if (dias <= diasAviso) return { estado_pago: 'por_vencer', dias_para_vencer: dias };
  return { estado_pago: 'al_dia', dias_para_vencer: dias };
};

const _decorar = (orden, cfg) => ({
  ...orden,
  estado_recepcion: _estadoRecepcion(orden.unidades_pedidas, orden.unidades_recibidas),
  ..._estadoPago(orden, cfg.dias_aviso),
});

// El cálculo del vencimiento es compartido con las compras sueltas: si cada uno
// hiciera su cuenta, la misma factura vencería en días distintos según por dónde
// se hubiera registrado.
const { resolverVencimiento: _resolverVencimiento } = require('../../utils/vencimiento.util');

// ── Pedir la VARIANTE, no el producto ────────────────────────────────────────
//
// `variante_id` / `atributo_id` existen en `lineas_orden_compra` desde 20260806
// y hasta ahora ningún frontend los escribía: las columnas estaban, cuatro
// consultas las leían, y siempre llegaban en NULL. Esto es lo que las conecta.
//
// Se valida contra la BD (existe, es de este producto, es una HOJA) porque los
// ids vienen del navegador. Y solo se acepta con la feature encendida: sin ella
// una línea con nodo entraría a una orden que ninguna pantalla sabría pintar.
const { validarNodo, claveNodo } = require('../../utils/nodoPedido.util');

const _validarNodosDeLineas = async (client, lineas, { sucursal_id, detalleNodo }) => {
  for (const l of lineas) {
    if (!l.variante_id && !l.atributo_id) continue;

    if (!detalleNodo) {
      throw {
        status: 400,
        message: 'El pedido por variante no está activado en este negocio. '
          + 'Actívalo en Ajustes o pide el producto completo.',
      };
    }
    // Un serial se pide por MODELO y cantidad: el IMEI —y con él el color y las
    // características de esa unidad— solo se conoce al abrir la caja. Bajar a un
    // nodo aquí prometería un detalle que la recepción no puede honrar.
    if (l.tipo === 'serial') {
      throw {
        status: 400,
        message: `"${l.nombre_producto}" se maneja por IMEI: se pide por modelo y cantidad. `
          + 'El detalle de cada unidad se captura al recibir, que es cuando se conoce.',
      };
    }

    const { etiqueta } = await validarNodo(client, {
      producto_id: l.producto_id,
      variante_id: l.variante_id,
      atributo_id: l.atributo_id,
      sucursal_id,
    });
    l.nodo_etiqueta = etiqueta;
  }

  // Dos líneas al MISMO nodo son un error de captura, no un pedido de dos
  // tandas: al recibir, el bodeguero no tendría cómo decidir a cuál imputar lo
  // que llegó y el avance de las dos quedaría a merced del orden de los ids.
  //
  // Ojo: la clave incluye el producto, porque `claveNodo` de una línea SIN nodo
  // es 'p' para todas — sin el producto delante, dos productos distintos pedidos
  // completos chocarían entre sí.
  const vistas = new Set();
  for (const l of lineas) {
    const clave = `${l.tipo}-${l.producto_id}-${claveNodo(l)}`;
    if (l.producto_id && vistas.has(clave)) {
      throw {
        status: 400,
        message: `"${l.nombre_producto}"${l.nodo_etiqueta ? ` (${l.nodo_etiqueta})` : ''} `
          + 'está repetido en la orden. Súmalo en una sola línea.',
      };
    }
    if (l.producto_id) vistas.add(clave);
  }

  return lineas;
};

const _validarLineas = (lineas) => {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw { status: 400, message: 'La orden necesita al menos un producto' };
  }
  return lineas.map((l, idx) => {
    const cantidad = Number(l.cantidad_pedida);
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      throw { status: 400, message: `Cantidad inválida en "${l.nombre_producto || `línea ${idx + 1}`}"` };
    }
    if (!l.nombre_producto || !String(l.nombre_producto).trim()) {
      throw { status: 400, message: `La línea ${idx + 1} no tiene producto` };
    }
    const tipo = l.tipo === 'serial' ? 'serial' : 'cantidad';
    return {
      tipo,
      // Los seriales NO se pueden pedir por IMEI: el IMEI solo se conoce cuando
      // se abre la caja. La orden pide modelo + cantidad y la recepción captura
      // los IMEI con la cuadrícula que ya existe.
      producto_id:     l.producto_id     || null,
      nombre_producto: String(l.nombre_producto).trim(),
      variante_id:     l.variante_id     || null,
      atributo_id:     l.atributo_id     || null,
      cantidad_pedida: cantidad,
      precio_estimado: l.precio_estimado != null && l.precio_estimado !== '' ? Number(l.precio_estimado) : null,
      garantia_dias:   l.garantia_dias   != null && l.garantia_dias   !== '' ? Number(l.garantia_dias)   : null,
      notas:           l.notas || null,
      orden:           idx,
    };
  });
};

const _verificarProveedor = async (client, proveedorId, negocioId) => {
  const { rows } = await client.query(
    `SELECT id, nombre, nit, telefono, garantia_dias_default FROM proveedores
     WHERE id = $1 AND negocio_id = $2 AND activo = true`,
    [proveedorId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Proveedor no válido para este negocio' };
  return rows[0];
};

const _verificarSucursal = async (client, sucursalId, negocioId) => {
  const { rows } = await client.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursalId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };
};

// ─────────────────────────────────────────────────────────────────────────────
// Lecturas
// ─────────────────────────────────────────────────────────────────────────────
const listar = async (negocioId, cfg, filtros) => {
  const res = await repo.findAll(negocioId, filtros);
  return { ...res, rows: res.rows.map((o) => _decorar(o, cfg)) };
};

const obtener = async (negocioId, cfg, id) => {
  const orden = await repo.findById(negocioId, id);
  if (!orden) throw { status: 404, message: 'Orden de compra no encontrada' };

  const [lineas, recepciones] = await Promise.all([
    repo.getLineas(id),
    repo.getRecepciones(id),
  ]);

  return { ..._decorar(orden, cfg), lineas, recepciones };
};

// ─────────────────────────────────────────────────────────────────────────────
// Escrituras
// ─────────────────────────────────────────────────────────────────────────────
const crear = async ({
  negocio_id, sucursal_id, usuario_id, proveedor_id,
  lineas, emitir = false, clave_idempotencia = null,
  fecha_esperada, numero_factura, fecha_factura, dias_plazo, fecha_vencimiento,
  notas, detalleNodo = false,
}) => {
  const lineasOk = _validarLineas(lineas);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await _verificarSucursal(client, sucursal_id, negocio_id);
    const proveedor = await _verificarProveedor(client, proveedor_id, negocio_id);
    await _validarNodosDeLineas(client, lineasOk, { sucursal_id, detalleNodo });

    // La garantía por defecto del proveedor se copia AHORA a cada línea que no
    // traiga la suya. Copiar y no referenciar es deliberado: subir después el
    // default en Ajustes no puede cambiar lo ya pactado.
    const conGarantia = lineasOk.map((l) => ({
      ...l,
      garantia_dias: l.garantia_dias ?? proveedor.garantia_dias_default ?? null,
    }));

    const totalEstimado = conGarantia.reduce(
      (s, l) => s + l.cantidad_pedida * Number(l.precio_estimado || 0), 0
    );

    const orden = await repo.create(client, {
      negocio_id, sucursal_id, proveedor_id, usuario_id,
      estado: emitir ? 'Emitida' : 'Borrador',
      fecha_esperada, numero_factura, fecha_factura, dias_plazo,
      fecha_vencimiento: _resolverVencimiento({ fecha_factura, dias_plazo, fecha_vencimiento }),
      total_estimado: totalEstimado,
      notas, clave_idempotencia,
    });

    for (const l of conGarantia) {
      await repo.insertarLinea(client, { ...l, orden_id: orden.id });
    }

    // Si nace con factura y el negocio cobra por orden, la deuda nace con ella.
    await _sincronizarCargoDeOrden(client, { orden, negocio_id, usuario_id, proveedor });

    await client.query('COMMIT');
    return orden;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Reemplaza las líneas de una orden. Solo mientras sea BORRADOR: una vez
 * emitida, cambiar lo pedido reescribiría la historia contra la que ya se está
 * recibiendo, y el pendiente de cada línea dejaría de significar nada.
 */
const editar = async (negocioId, id, { lineas, usuario_id, detalleNodo = false, ...cabecera }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orden = await repo.findParaActualizar(client, negocioId, id);
    if (!orden) throw { status: 404, message: 'Orden de compra no encontrada' };
    if (orden.estado === 'Anulada' || orden.estado === 'Cerrada') {
      throw { status: 409, message: `La orden está ${orden.estado.toLowerCase()} y ya no se puede editar` };
    }

    let totalEstimado = Number(orden.total_estimado);

    if (lineas !== undefined) {
      if (orden.estado !== 'Borrador') {
        throw {
          status: 409,
          message: 'La orden ya fue emitida: no se pueden cambiar los productos pedidos. '
            + 'Si el proveedor cambió el pedido, ciérrala y crea una nueva.',
        };
      }
      const lineasOk = _validarLineas(lineas);
      const proveedor = await _verificarProveedor(client, orden.proveedor_id, negocioId);
      await _validarNodosDeLineas(client, lineasOk, {
        sucursal_id: orden.sucursal_id, detalleNodo,
      });
      const conGarantia = lineasOk.map((l) => ({
        ...l,
        garantia_dias: l.garantia_dias ?? proveedor.garantia_dias_default ?? null,
      }));

      await repo.borrarLineas(client, id);
      for (const l of conGarantia) {
        await repo.insertarLinea(client, { ...l, orden_id: id });
      }
      totalEstimado = conGarantia.reduce(
        (s, l) => s + l.cantidad_pedida * Number(l.precio_estimado || 0), 0
      );
    }

    const campos = {};
    for (const k of ['fecha_esperada', 'numero_factura', 'fecha_factura', 'dias_plazo', 'notas']) {
      if (cabecera[k] !== undefined) campos[k] = cabecera[k] || null;
    }
    if (cabecera.fecha_factura !== undefined || cabecera.dias_plazo !== undefined
        || cabecera.fecha_vencimiento !== undefined) {
      campos.fecha_vencimiento = _resolverVencimiento({
        fecha_factura:     cabecera.fecha_factura     ?? orden.fecha_factura,
        dias_plazo:        cabecera.dias_plazo        ?? orden.dias_plazo,
        fecha_vencimiento: cabecera.fecha_vencimiento,
      });
    }
    if (lineas !== undefined) campos.total_estimado = totalEstimado;

    const actualizada = await repo.actualizarCabecera(client, id, campos) || orden;

    const proveedor = await _verificarProveedor(client, orden.proveedor_id, negocioId);
    await _sincronizarCargoDeOrden(client, {
      orden: actualizada, negocio_id: negocioId, usuario_id, proveedor,
    });

    await client.query('COMMIT');
    return actualizada;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Emitir: el borrador pasa a ser un pedido en firme. A partir de aquí se puede
 * recibir contra él y ya no se pueden cambiar las líneas.
 */
const emitir = async (negocioId, id, { usuario_id }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orden = await repo.findParaActualizar(client, negocioId, id);
    if (!orden) throw { status: 404, message: 'Orden de compra no encontrada' };
    if (orden.estado === 'Emitida') {
      await client.query('COMMIT');
      return orden; // idempotente: emitir dos veces no es un error
    }
    if (orden.estado !== 'Borrador') {
      throw { status: 409, message: `La orden está ${orden.estado.toLowerCase()} y no se puede emitir` };
    }

    const lineas = await repo.getLineas(id);
    if (!lineas.length) throw { status: 400, message: 'La orden no tiene productos' };

    const actualizada = await repo.actualizarCabecera(client, id, { estado: 'Emitida' });

    const proveedor = await _verificarProveedor(client, orden.proveedor_id, negocioId);
    await _sincronizarCargoDeOrden(client, {
      orden: actualizada, negocio_id: negocioId, usuario_id, proveedor,
    });

    await client.query('COMMIT');
    return actualizada;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * "Ya no va a llegar": cierra la orden dejando el saldo sin recibir.
 * NO toca inventario ni deuda — lo que llegó ya se registró como recepción, y
 * lo que no llegó nunca generó nada.
 */
const cerrar = async (negocioId, id, { motivo, usuario_id }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orden = await repo.findParaActualizar(client, negocioId, id);
    if (!orden) throw { status: 404, message: 'Orden de compra no encontrada' };
    if (orden.estado === 'Cerrada') {
      await client.query('COMMIT');
      return orden;
    }
    if (orden.estado === 'Anulada') {
      throw { status: 409, message: 'La orden está anulada' };
    }

    const cerrada = await repo.cerrar(client, id, { motivo, usuario_id });

    if (motivo) {
      await client.query(`
        INSERT INTO novedades_proveedor(negocio_id, proveedor_id, tipo, orden_id, texto, usuario_id, resuelta_en)
        VALUES ($1, $2, 'cierre', $3, $4, $5, NOW())
      `, [negocioId, orden.proveedor_id, id, motivo, usuario_id || null]);
    }

    await client.query('COMMIT');
    return cerrada;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Anular: la orden nunca debió existir. Solo si no ha recibido nada — si ya
 * entró mercancía hay inventario y deuda de por medio, y esas recepciones
 * quedarían huérfanas. En ese caso el camino es cerrar, no anular.
 */
const anular = async (negocioId, id, { motivo, usuario_id }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orden = await repo.findParaActualizar(client, negocioId, id);
    if (!orden) throw { status: 404, message: 'Orden de compra no encontrada' };
    if (orden.estado === 'Anulada') {
      await client.query('COMMIT');
      return orden;
    }

    if (await repo.tieneRecepciones(client, id)) {
      throw {
        status: 409,
        message: 'Esta orden ya tiene mercancía recibida. Si el pedido se cayó, '
          + 'ciérrala con el motivo en vez de anularla: lo que ya llegó no se puede deshacer desde aquí.',
      };
    }

    // Si la deuda había nacido con la orden (modo 'orden'), se va con ella.
    // Solo puede pasar aquí, donde no hay recepciones: con mercancía recibida
    // la anulación está prohibida arriba.
    const cargo = await repo.cargoDeLaOrden(client, id);
    if (cargo) {
      await client.query(`DELETE FROM movimientos_acreedor WHERE cargo_id = $1`, [cargo.id]);
      await client.query(`DELETE FROM movimientos_acreedor WHERE id = $1`, [cargo.id]);
    }

    const anulada = await repo.anular(client, id, { motivo, usuario_id });

    await client.query('COMMIT');
    return anulada;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// El cargo al acreedor en modo 'orden'
//
// Con `ordenes_compra_modo_cargo = 'orden'`, la deuda nace al FACTURAR la orden
// —antes de que llegue nada— y las recepciones no crean cargo propio. Este
// helper es el único sitio que lo escribe, y es idempotente: se puede llamar en
// cada guardado sin duplicar.
//
// En modo 'recepcion' (el default, y el comportamiento de siempre) no hace nada:
// cada compra sigue creando su cargo como hasta ahora.
// ─────────────────────────────────────────────────────────────────────────────
const { getConfigOrdenes } = require('../../middlewares/ordenesCompra.middleware');

const _resolverAcreedor = async (client, negocioId, proveedor) => {
  let { rows } = await client.query(
    `SELECT id FROM acreedores WHERE negocio_id = $1 AND proveedor_id = $2 LIMIT 1`,
    [negocioId, proveedor.id]
  );
  if (rows.length) return rows[0].id;

  if (proveedor.nit) {
    const { rows: porCedula } = await client.query(
      `SELECT id FROM acreedores WHERE negocio_id = $1 AND cedula = $2 LIMIT 1`,
      [negocioId, proveedor.nit]
    );
    if (porCedula.length) {
      await client.query(
        `UPDATE acreedores SET proveedor_id = $1 WHERE id = $2 AND proveedor_id IS NULL`,
        [proveedor.id, porCedula[0].id]
      );
      return porCedula[0].id;
    }
  }

  const { rows: nuevo } = await client.query(
    `INSERT INTO acreedores(negocio_id, nombre, cedula, telefono, proveedor_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [negocioId, proveedor.nombre, proveedor.nit || `prov-${proveedor.id}`, proveedor.telefono || '', proveedor.id]
  );
  return nuevo[0].id;
};

const _sincronizarCargoDeOrden = async (client, { orden, negocio_id, usuario_id, proveedor }) => {
  const { modo_cargo } = await getConfigOrdenes(negocio_id);
  if (modo_cargo !== 'orden') return null;

  // Sin factura no hay deuda: una orden es un pedido, no un pasivo.
  if (!orden.numero_factura) return null;
  if (orden.estado !== 'Emitida') return null;

  const valor = Number(orden.total_estimado || 0);
  if (!(valor > 0)) return null;

  const existente = await repo.cargoDeLaOrden(client, orden.id);

  if (existente) {
    // Actualizar el valor solo si nadie ha abonado todavía: si ya hay pagos, el
    // saldo del proveedor está construido sobre este número y cambiarlo por
    // detrás descuadraría su estado de cuenta.
    const { rows: abonos } = await client.query(
      `SELECT COALESCE(SUM(valor), 0) AS ab FROM movimientos_acreedor
       WHERE cargo_id = $1 AND tipo = 'Abono'`,
      [existente.id]
    );
    if (Number(abonos[0].ab) === 0 && Number(existente.valor) !== valor) {
      await client.query(
        `UPDATE movimientos_acreedor SET valor = $1, fecha_vencimiento = $2 WHERE id = $3`,
        [valor, orden.fecha_vencimiento || null, existente.id]
      );
    } else {
      await client.query(
        `UPDATE movimientos_acreedor SET fecha_vencimiento = $1 WHERE id = $2`,
        [orden.fecha_vencimiento || null, existente.id]
      );
    }
    return existente.id;
  }

  const acreedorId = await _resolverAcreedor(client, negocio_id, proveedor);
  const { rows } = await client.query(`
    INSERT INTO movimientos_acreedor(
      acreedor_id, usuario_id, tipo, descripcion, valor,
      orden_compra_id, sucursal_id, fecha_vencimiento
    )
    VALUES ($1, $2, 'Cargo', $3, $4, $5, $6, $7)
    RETURNING id
  `, [
    acreedorId, usuario_id || null,
    `Orden de compra #${orden.numero ?? orden.id}${orden.numero_factura ? ` — factura ${orden.numero_factura}` : ''}`,
    valor, orden.id, orden.sucursal_id, orden.fecha_vencimiento || null,
  ]);
  return rows[0].id;
};

module.exports = { listar, obtener, crear, editar, emitir, cerrar, anular };
