const crypto = require('crypto');
const { pool } = require('../../config/db');
const repo          = require('./redInterna.repository');
const trasladosRepo = require('../traslados/traslados.repository');
const tesoreriaRepo = require('../tesoreria/tesoreria.repository');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');
const { calcularCostoPromedio }  = require('../../utils/costoPromedio.util');

// ─────────────────────────────────────────────────────────────────────────────
// RED INTERNA — lógica de negocio
//
// Modelo consignación (ver redInterna.repository.js para el detalle contable):
//   • Despachar mueve el documento, NO el inventario ni la deuda.
//   • Recibir mueve el inventario (reusa el motor de traslados) en UNA
//     transacción. Si algo falla, no queda nada a medias.
//   • La deuda se deriva de las ventas del local. Aquí no se escribe ninguna.
//   • Solo el dinero (remesas, gastos autorizados) se escribe.
// ─────────────────────────────────────────────────────────────────────────────

const ETIQUETAS_ESTADO = {
  'En transito':     'En tránsito',
  'En consignacion': 'En consignación',
  'Por liquidar':    'Vendido — por liquidar',
  'En recaudo':      'Vendido a crédito — en recaudo',
  'En prestamo':     'En préstamo',
  'Devuelta':        'Devuelta a bodega',
  'Faltante':        'No llegó',
  'Movida':          'Movida a otra sucursal',
  'Sin ubicar':      'Sin ubicar',
};

const _num = (v) => Number(v || 0);

// ── Validaciones compartidas ─────────────────────────────────────────────────

const _verificarSucursal = async (client, sucursalId, negocioId) => {
  const { rows } = await (client || pool).query(
    `SELECT id, nombre FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursalId, negocioId]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };
  return rows[0];
};

const _exigirBodega = (req) => {
  if (!req.esBodega) {
    throw { status: 403, message: 'Solo la bodega puede realizar esta acción' };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolución del producto equivalente en la sucursal destino
//
// El catálogo es POR SUCURSAL: el mismo modelo de teléfono es una fila distinta
// en cada sede. El flujo viejo de traslados obliga al usuario a emparejarlos a
// mano; aquí se resuelve solo para que recibir sea un solo toque:
//   1. busca un producto equivalente en el destino,
//   2. si no existe, lo crea copiando nombre/marca/modelo/precio/línea.
// La línea de producto (`linea_id`) es del negocio, así que viaja tal cual.
//
// El precio de venta del destino NO se toca si el producto ya existía: cada
// local manda sobre su propio precio.
// ─────────────────────────────────────────────────────────────────────────────

// Normalización equivalente a `_norm` de traslados.repository.js, pero en SQL:
// minúsculas, sin tildes, guiones y guiones bajos como espacio, espacios
// internos colapsados y recortada. Sin esto, "Galaxy  A54 " y "Galaxy A54"
// se ven como productos distintos y el local termina con el catálogo duplicado.
const NORM = (col) => `
  regexp_replace(
    trim(
      translate(
        lower(COALESCE(${col}, '')),
        'áàäâãéèëêíìïîóòöôõúùüûñç-_',
        'aaaaaeeeeiiiiooooouuuunc  '
      )
    ),
    '[[:space:]]+', ' ', 'g'
  )
`;

const _resolverProductoSerialDestino = async (client, productoOrigenId, sucursalDestinoId) => {
  const { rows: orig } = await client.query(
    `SELECT nombre, marca, modelo, precio, linea_id FROM productos_serial WHERE id = $1`,
    [productoOrigenId]
  );
  if (!orig.length) throw { status: 404, message: 'Producto de origen no encontrado' };
  const o = orig[0];

  const { rows: match } = await client.query(`
    SELECT id FROM productos_serial
    WHERE sucursal_id = $1
      AND ${NORM('nombre')} = ${NORM('$2')}
      AND ${NORM('marca')}  = ${NORM('$3')}
      AND ${NORM('modelo')} = ${NORM('$4')}
    ORDER BY id LIMIT 1
  `, [sucursalDestinoId, o.nombre, o.marca, o.modelo]);
  if (match.length) return match[0].id;

  const { rows: nuevo } = await client.query(`
    INSERT INTO productos_serial (nombre, marca, modelo, precio, sucursal_id, linea_id)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
  `, [o.nombre, o.marca, o.modelo, o.precio, sucursalDestinoId, o.linea_id]);
  return nuevo[0].id;
};

const _resolverProductoCantidadDestino = async (client, productoOrigenId, sucursalDestinoId) => {
  const { rows: orig } = await client.query(
    `SELECT nombre, unidad_medida, precio, costo_unitario, linea_id, stock_minimo
     FROM productos_cantidad WHERE id = $1`,
    [productoOrigenId]
  );
  if (!orig.length) throw { status: 404, message: 'Producto de origen no encontrado' };
  const o = orig[0];

  const { rows: match } = await client.query(`
    SELECT id FROM productos_cantidad
    WHERE sucursal_id = $1 AND activo = true
      AND ${NORM('nombre')} = ${NORM('$2')}
    ORDER BY id LIMIT 1
  `, [sucursalDestinoId, o.nombre]);
  if (match.length) return match[0].id;

  const { rows: nuevo } = await client.query(`
    INSERT INTO productos_cantidad
      (nombre, stock, stock_minimo, unidad_medida, costo_unitario, precio, sucursal_id, linea_id)
    VALUES ($1, 0, $2, $3, $4, $5, $6, $7) RETURNING id
  `, [o.nombre, o.stock_minimo || 0, o.unidad_medida || 'unidad',
      o.costo_unitario, o.precio, sucursalDestinoId, o.linea_id]);
  return nuevo[0].id;
};

// ─────────────────────────────────────────────────────────────────────────────
// DESPACHAR — la bodega emite la remisión
// No mueve inventario ni deuda: solo crea el documento y lo pone en tránsito.
// ─────────────────────────────────────────────────────────────────────────────

const despachar = async (req, { sucursal_destino_id, lineas, notas, clave_idempotencia }) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;
  const origenId  = Number(req.sucursal_id);
  const destinoId = Number(sucursal_destino_id);

  if (!destinoId)                throw { status: 400, message: 'Falta la sucursal destino' };
  if (destinoId === origenId)    throw { status: 400, message: 'La bodega no puede despacharse a sí misma' };
  if (!Array.isArray(lineas) || !lineas.length) {
    throw { status: 400, message: 'Agrega al menos un producto' };
  }
  await _verificarSucursal(null, destinoId, negocioId);

  // Idempotencia: un segundo POST con la misma clave devuelve la original.
  if (clave_idempotencia) {
    const previa = await repo.findRemisionPorClave(clave_idempotencia);
    if (previa) return { ...previa, repetido: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const remision = await repo.crearRemision(client, {
      negocio_id: negocioId, tipo: 'entrega',
      sucursal_origen_id: origenId, sucursal_destino_id: destinoId,
      usuario_emisor_id: req.user.id, clave_idempotencia, notas,
      estado: 'En transito',
    });

    for (const l of lineas) {
      if (l.tipo === 'serial') {
        // FOR UPDATE: bloquea el serial durante el despacho para que no lo
        // vendan ni lo despachen a otro local al mismo tiempo.
        const { rows } = await client.query(`
          SELECT s.id, s.imei, s.vendido, s.prestado, COALESCE(s.costo_compra, 0) AS costo_compra,
                 ps.id AS producto_id, ps.nombre, ps.marca, ps.modelo
          FROM seriales s
          JOIN productos_serial ps ON ps.id = s.producto_id
          WHERE s.id = $1 AND ps.sucursal_id = $2
          FOR UPDATE OF s
        `, [l.serial_id, origenId]);

        if (!rows.length) throw { status: 404, message: `El equipo no está en la bodega` };
        const s = rows[0];
        if (s.vendido)  throw { status: 400, message: `El equipo ${s.imei} ya fue vendido` };
        if (s.prestado) throw { status: 400, message: `El equipo ${s.imei} está prestado` };

        const { rows: dup } = await client.query(`
          SELECT lr.id FROM lineas_remision lr
          WHERE lr.serial_id = $1 AND lr.estado_linea IN ('Pendiente', 'Recibida')
        `, [s.id]);
        if (dup.length) {
          throw { status: 409, message: `El equipo ${s.imei} ya está en otra remisión activa` };
        }

        // MODO A (a costo): el valor interno es el costo real del negocio.
        // `seriales.costo_compra` NUNCA se modifica — es la verdad del costo
        // para los reportes, aquí solo se fotografía.
        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'serial',
          serial_id: s.id, imei: s.imei,
          producto_origen_id: s.producto_id,
          valor_interno: _num(s.costo_compra),
          estado_linea: 'Pendiente',
          nombre_producto: [s.nombre, s.marca, s.modelo].filter(Boolean).join(' '),
        });

      } else if (l.tipo === 'cantidad') {
        const cant = Number(l.cantidad);
        if (!cant || cant < 1) throw { status: 400, message: 'Cantidad inválida' };

        const { rows } = await client.query(`
          SELECT id, nombre, stock, COALESCE(costo_unitario, 0) AS costo_unitario
          FROM productos_cantidad
          WHERE id = $1 AND sucursal_id = $2 AND activo = true
          FOR UPDATE
        `, [l.producto_id, origenId]);
        if (!rows.length) throw { status: 404, message: 'Producto no encontrado en la bodega' };
        const p = rows[0];
        if (p.stock < cant) {
          throw { status: 400, message: `Stock insuficiente de "${p.nombre}". Hay ${p.stock}, pides ${cant}` };
        }

        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'cantidad',
          producto_origen_id: p.id, cantidad: cant,
          valor_interno: _num(p.costo_unitario),
          estado_linea: 'Pendiente',
          nombre_producto: p.nombre,
        });
      } else {
        throw { status: 400, message: `Tipo de línea inválido: ${l.tipo}` };
      }
    }

    await repo.actualizarTotalRemision(client, remision.id);
    await asignarNumeroDocumento(client, {
      tipo: 'remision', docId: remision.id, negocioId,
    });

    // Si el negocio no exige confirmación, se recibe en la MISMA transacción:
    // o queda todo hecho, o no queda nada.
    let final = await repo.findRemisionById(negocioId, remision.id, client);
    if (!req.red.confirmar_recepcion) {
      const lineasR = await client.query(
        `SELECT * FROM lineas_remision WHERE remision_id = $1 ORDER BY id`, [remision.id]
      );
      await _ejecutarRecepcion(client, {
        negocioId, remision: final,
        lineas: lineasR.rows,
        recibidasIds: lineasR.rows.map((x) => Number(x.id)),
        cantidadesRecibidas: {},
        usuarioId: req.user.id,
      });
      final = await repo.findRemisionById(negocioId, remision.id, client);
    }

    await client.query('COMMIT');
    return final;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && clave_idempotencia) {
      const previa = await repo.findRemisionPorClave(clave_idempotencia);
      if (previa) return { ...previa, repetido: true };
    }
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RECEPCIÓN — núcleo transaccional compartido
//
// Mueve el inventario reusando el motor de traslados (mismo `serial_id`: el
// IMEI nunca se duplica) y deja registro en `traslados` para que el historial
// de movimientos del negocio siga siendo uno solo.
//
// Lo NO marcado como recibido queda 'Faltante': no se mueve, no se cobra, y
// sigue siendo inventario de la bodega. Es el default seguro.
// ─────────────────────────────────────────────────────────────────────────────

const _ejecutarRecepcion = async (client, {
  negocioId, remision, lineas, recibidasIds, cantidadesRecibidas, usuarioId,
}) => {
  const setRecibidas = new Set(recibidasIds.map(Number));
  const origenId  = remision.sucursal_origen_id;
  const destinoId = remision.sucursal_destino_id;

  const traslado = await trasladosRepo.crearTraslado(client, {
    negocio_id: negocioId,
    sucursal_origen_id:  origenId,
    sucursal_destino_id: destinoId,
    usuario_id: usuarioId,
    notas: `Remisión #${remision.numero ?? remision.id}`,
  });

  const idsOk = [], idsFaltante = [];
  const idsCant = [], cantsOk = [];

  for (const l of lineas) {
    const id = Number(l.id);
    if (!setRecibidas.has(id)) { idsFaltante.push(id); continue; }

    if (l.tipo === 'serial') {
      const { rows } = await client.query(`
        SELECT s.id, s.imei, s.vendido, s.prestado, s.producto_id
        FROM seriales s
        JOIN productos_serial ps ON ps.id = s.producto_id
        WHERE s.id = $1 AND ps.sucursal_id = $2
        FOR UPDATE OF s
      `, [l.serial_id, origenId]);
      if (!rows.length) {
        throw { status: 409, message: `El equipo ${l.imei || ''} ya no está en la bodega. Actualiza y vuelve a intentar.` };
      }
      const s = rows[0];
      if (s.vendido)  throw { status: 409, message: `El equipo ${s.imei} fue vendido en la bodega; no se puede recibir` };
      if (s.prestado) throw { status: 409, message: `El equipo ${s.imei} está prestado; no se puede recibir` };

      const productoDestinoId = await _resolverProductoSerialDestino(client, s.producto_id, destinoId);
      await trasladosRepo.moverSerial(client, s.id, productoDestinoId);
      await trasladosRepo.insertarLineaTraslado(client, {
        traslado_id: traslado.id, tipo: 'serial',
        serial_id: s.id,
        producto_serial_origen_id:  s.producto_id,
        producto_serial_destino_id: productoDestinoId,
        imei: s.imei, nombre_producto: l.nombre_producto,
      });
      await client.query(
        `UPDATE lineas_remision SET producto_destino_id = $2, cantidad_recibida = 1 WHERE id = $1`,
        [id, productoDestinoId]
      );
      idsOk.push(id);

    } else {
      const pedida = Number(l.cantidad);
      const recibida = Math.min(
        pedida,
        Math.max(0, Number(cantidadesRecibidas?.[id] ?? pedida))
      );
      if (recibida <= 0) { idsFaltante.push(id); continue; }

      const { rows } = await client.query(
        `SELECT id, nombre, stock, COALESCE(costo_unitario, 0) AS costo_unitario
         FROM productos_cantidad WHERE id = $1 FOR UPDATE`,
        [l.producto_origen_id]
      );
      if (!rows.length) throw { status: 404, message: `Producto "${l.nombre_producto}" ya no existe en la bodega` };
      if (rows[0].stock < recibida) {
        throw { status: 409, message: `Stock insuficiente de "${rows[0].nombre}" en la bodega (hay ${rows[0].stock})` };
      }

      const productoDestinoId = await _resolverProductoCantidadDestino(client, l.producto_origen_id, destinoId);

      // Costo promedio ponderado en el destino. El flujo viejo de traslados NO
      // hace esto y desvía el costo del destino; aquí se hace bien porque de
      // ese costo depende la utilidad que reportará el local.
      const { rows: dest } = await client.query(
        `SELECT stock, COALESCE(costo_unitario, 0) AS costo_unitario
         FROM productos_cantidad WHERE id = $1 FOR UPDATE`,
        [productoDestinoId]
      );
      const nuevoCosto = calcularCostoPromedio(
        Number(dest[0].stock), Number(dest[0].costo_unitario),
        recibida, _num(l.valor_interno)
      );

      await trasladosRepo.ajustarStockEnTransaccion(client, l.producto_origen_id, -recibida);
      await trasladosRepo.ajustarStockEnTransaccion(client, productoDestinoId,     recibida);
      await client.query(
        `UPDATE productos_cantidad SET costo_unitario = $2 WHERE id = $1`,
        [productoDestinoId, nuevoCosto]
      );

      await trasladosRepo.insertarHistorialEnTransaccion(client, {
        producto_id: l.producto_origen_id, sucursal_id: origenId,
        cantidad: -recibida, costo_unitario: _num(l.valor_interno),
        notas: `Remisión #${remision.numero ?? remision.id} → ${destinoId}`,
      });
      await trasladosRepo.insertarHistorialEnTransaccion(client, {
        producto_id: productoDestinoId, sucursal_id: destinoId,
        cantidad: recibida, costo_unitario: _num(l.valor_interno),
        notas: `Remisión #${remision.numero ?? remision.id} ← bodega`,
      });
      await trasladosRepo.insertarLineaTraslado(client, {
        traslado_id: traslado.id, tipo: 'cantidad',
        producto_cantidad_origen_id:  l.producto_origen_id,
        producto_cantidad_destino_id: productoDestinoId,
        cantidad: recibida, nombre_producto: l.nombre_producto,
      });
      await client.query(
        `UPDATE lineas_remision SET producto_destino_id = $2 WHERE id = $1`,
        [id, productoDestinoId]
      );
      idsCant.push(id); cantsOk.push(recibida);
    }
  }

  if (idsOk.length)       await repo.marcarLineas(client, idsOk, 'Recibida');
  if (idsCant.length)     await repo.marcarLineas(client, idsCant, 'Recibida', cantsOk);
  if (idsFaltante.length) await repo.marcarLineas(client, idsFaltante, 'Faltante');

  const hubo = idsOk.length + idsCant.length;
  if (hubo === 0) {
    throw { status: 400, message: 'No marcaste ningún producto como recibido' };
  }

  await repo.marcarRemisionRecibida(client, {
    remisionId: remision.id,
    usuarioId,
    estado: idsFaltante.length ? 'Parcial' : 'Recibida',
    trasladoId: traslado.id,
  });
  await repo.actualizarTotalRemision(client, remision.id);

  return { traslado_id: traslado.id, recibidas: hubo, faltantes: idsFaltante.length };
};

// ── Recibir (lo llama el local; un vendedor puede hacerlo) ───────────────────

const recibir = async (req, remisionId, { lineas_recibidas, cantidades } = {}) => {
  const negocioId = req.user.negocio_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const remision = await repo.findRemisionById(negocioId, remisionId, client);
    if (!remision) throw { status: 404, message: 'Remisión no encontrada' };
    if (Number(remision.sucursal_destino_id) !== Number(req.sucursal_id)) {
      throw { status: 403, message: 'Esta remisión es para otra sucursal' };
    }
    if (remision.estado !== 'En transito') {
      throw { status: 409, message: `Esta remisión ya está en estado "${remision.estado}"` };
    }

    const { rows: lineas } = await client.query(
      `SELECT * FROM lineas_remision WHERE remision_id = $1 ORDER BY id`, [remisionId]
    );

    // Default amable: si no mandan lista, se reciben todas.
    const recibidasIds = Array.isArray(lineas_recibidas) && lineas_recibidas.length
      ? lineas_recibidas
      : lineas.map((l) => Number(l.id));

    const res = await _ejecutarRecepcion(client, {
      negocioId, remision, lineas, recibidasIds,
      cantidadesRecibidas: cantidades || {},
      usuarioId: req.user.id,
    });

    await client.query('COMMIT');
    return { ...(await repo.findRemisionById(negocioId, remisionId)), ...res };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Anular remisión — SOLO si nada se movió todavía ──────────────────────────

const anularRemision = async (req, remisionId) => {
  const negocioId = req.user.negocio_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const remision = await repo.findRemisionById(negocioId, remisionId, client);
    if (!remision) throw { status: 404, message: 'Remisión no encontrada' };
    if (remision.estado !== 'En transito') {
      throw {
        status: 409,
        message: 'Solo se puede anular una remisión que sigue en tránsito. Si el local ya la recibió, usa una devolución.',
      };
    }
    if (Number(remision.sucursal_origen_id) !== Number(req.sucursal_id)) {
      throw { status: 403, message: 'Solo la bodega que la emitió puede anularla' };
    }
    await repo.marcarRemisionAnulada(client, remisionId);
    // Libera los seriales del índice de "remisión activa".
    await client.query(
      `UPDATE lineas_remision SET estado_linea = 'Devuelta' WHERE remision_id = $1`,
      [remisionId]
    );
    await client.query('COMMIT');
    return { id: remisionId, estado: 'Anulada' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DEVOLUCIÓN — el local regresa mercancía a la bodega
// Se recibe de inmediato (el equipo va en la mano de quien la registra) y las
// unidades devueltas dejan de contar en la consignación del local.
// ─────────────────────────────────────────────────────────────────────────────

const devolver = async (req, { lineas, notas }) => {
  const negocioId = req.user.negocio_id;
  const origenId  = Number(req.sucursal_id);          // el local
  const destinoId = Number(req.red.bodega_id);        // la bodega

  if (origenId === destinoId) throw { status: 400, message: 'La bodega no se devuelve a sí misma' };
  if (!Array.isArray(lineas) || !lineas.length) {
    throw { status: 400, message: 'Selecciona al menos un producto para devolver' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const remision = await repo.crearRemision(client, {
      negocio_id: negocioId, tipo: 'devolucion',
      sucursal_origen_id: origenId, sucursal_destino_id: destinoId,
      usuario_emisor_id: req.user.id, notas, estado: 'En transito',
    });

    const traslado = await trasladosRepo.crearTraslado(client, {
      negocio_id: negocioId,
      sucursal_origen_id: origenId, sucursal_destino_id: destinoId,
      usuario_id: req.user.id,
      notas: `Devolución a bodega — remisión #${remision.id}`,
    });

    for (const l of lineas) {
      if (l.tipo === 'serial') {
        const { rows } = await client.query(`
          SELECT s.id, s.imei, s.vendido, s.prestado, s.producto_id,
                 COALESCE(s.costo_compra, 0) AS costo_compra
          FROM seriales s
          JOIN productos_serial ps ON ps.id = s.producto_id
          WHERE s.id = $1 AND ps.sucursal_id = $2
          FOR UPDATE OF s
        `, [l.serial_id, origenId]);
        if (!rows.length) throw { status: 404, message: 'El equipo no está en este local' };
        const s = rows[0];
        if (s.vendido)  throw { status: 400, message: `El equipo ${s.imei} ya fue vendido` };
        if (s.prestado) throw { status: 400, message: `El equipo ${s.imei} está prestado` };

        const productoDestinoId = await _resolverProductoSerialDestino(client, s.producto_id, destinoId);
        await trasladosRepo.moverSerial(client, s.id, productoDestinoId);
        await trasladosRepo.insertarLineaTraslado(client, {
          traslado_id: traslado.id, tipo: 'serial', serial_id: s.id,
          producto_serial_origen_id: s.producto_id,
          producto_serial_destino_id: productoDestinoId,
          imei: s.imei, nombre_producto: l.nombre_producto || s.imei,
        });

        // ORDEN IMPORTANTE: primero se cierra la línea de ENTREGA (la unidad
        // sale de la consignación del local) y solo después se inserta la de
        // devolución. El índice `uq_lineas_remision_serial_viva` solo admite
        // una línea viva por serial, así que al revés chocaría.
        await client.query(`
          UPDATE lineas_remision lr SET estado_linea = 'Devuelta'
          FROM remisiones r
          WHERE lr.remision_id = r.id AND r.tipo = 'entrega' AND r.negocio_id = $2
            AND lr.serial_id = $1 AND lr.estado_linea IN ('Pendiente', 'Recibida')
        `, [s.id, negocioId]);

        // La línea de la devolución nace 'Devuelta': es un estado terminal y
        // deja el serial libre para que la bodega lo pueda volver a despachar.
        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'serial', serial_id: s.id, imei: s.imei,
          producto_origen_id: s.producto_id, producto_destino_id: productoDestinoId,
          valor_interno: _num(s.costo_compra), cantidad_recibida: 1,
          estado_linea: 'Devuelta', nombre_producto: l.nombre_producto || s.imei,
        });

      } else {
        const cant = Number(l.cantidad);
        if (!cant || cant < 1) throw { status: 400, message: 'Cantidad inválida' };
        const { rows } = await client.query(
          `SELECT id, nombre, stock, COALESCE(costo_unitario, 0) AS costo_unitario
           FROM productos_cantidad WHERE id = $1 AND sucursal_id = $2 FOR UPDATE`,
          [l.producto_id, origenId]
        );
        if (!rows.length) throw { status: 404, message: 'Producto no encontrado en este local' };
        if (rows[0].stock < cant) {
          throw { status: 400, message: `Stock insuficiente de "${rows[0].nombre}"` };
        }
        const productoDestinoId = await _resolverProductoCantidadDestino(client, l.producto_id, destinoId);

        await trasladosRepo.ajustarStockEnTransaccion(client, l.producto_id, -cant);
        await trasladosRepo.ajustarStockEnTransaccion(client, productoDestinoId, cant);
        await trasladosRepo.insertarHistorialEnTransaccion(client, {
          producto_id: l.producto_id, sucursal_id: origenId,
          cantidad: -cant, costo_unitario: _num(rows[0].costo_unitario),
          notas: `Devolución a bodega #${remision.id}`,
        });
        await trasladosRepo.insertarHistorialEnTransaccion(client, {
          producto_id: productoDestinoId, sucursal_id: destinoId,
          cantidad: cant, costo_unitario: _num(rows[0].costo_unitario),
          notas: `Devolución desde local #${remision.id}`,
        });
        await trasladosRepo.insertarLineaTraslado(client, {
          traslado_id: traslado.id, tipo: 'cantidad',
          producto_cantidad_origen_id: l.producto_id,
          producto_cantidad_destino_id: productoDestinoId,
          cantidad: cant, nombre_producto: rows[0].nombre,
        });
        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'cantidad',
          producto_origen_id: l.producto_id, producto_destino_id: productoDestinoId,
          cantidad: cant, cantidad_recibida: cant,
          valor_interno: _num(rows[0].costo_unitario),
          estado_linea: 'Devuelta', nombre_producto: rows[0].nombre,
        });
      }
    }

    await repo.actualizarTotalRemision(client, remision.id);
    await asignarNumeroDocumento(client, { tipo: 'remision', docId: remision.id, negocioId });
    await repo.marcarRemisionRecibida(client, {
      remisionId: remision.id, usuarioId: req.user.id,
      estado: 'Recibida', trasladoId: traslado.id,
    });

    await client.query('COMMIT');
    return repo.findRemisionById(negocioId, remision.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REMESAS — el efectivo del local vuelve a la bodega
//
// Reusa el motor de Tesorería (movimientos_dinero + espejo en caja + saldos
// derivados). El paso por una cuenta de TRÁNSITO evita que el dinero que va
// físicamente en camino desaparezca del total del negocio.
// ─────────────────────────────────────────────────────────────────────────────

const _asegurarCuentaTransito = async (negocioId, bodegaId) => {
  const { rows } = await pool.query(`
    SELECT * FROM cuentas_dinero
    WHERE negocio_id = $1 AND sucursal_id = $2 AND tipo = 'transito' AND activa
    ORDER BY id LIMIT 1
  `, [negocioId, bodegaId]);
  if (rows.length) return rows[0];

  // Sin métodos de pago: no captura ventas, solo recibe traslados. Así no
  // interfiere con la derivación de saldos de las demás cuentas.
  const { rows: nueva } = await pool.query(`
    INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, metodos_pago, moneda)
    VALUES ($1, $2, 'Remesas en tránsito', 'transito', ARRAY[]::text[], 'COP')
    RETURNING *
  `, [negocioId, bodegaId]);
  return nueva[0];
};

const _cuentaEfectivo = async (negocioId, sucursalId) => {
  await tesoreriaRepo.asegurarCuentaEfectivo(negocioId, sucursalId);
  const cuentas = await tesoreriaRepo.findCuentas(negocioId, sucursalId);
  const efectivo = cuentas.find(
    (c) => c.tipo === 'efectivo' || (c.metodos_pago || []).includes('Efectivo')
  );
  if (!efectivo) throw { status: 409, message: 'La sucursal no tiene cuenta de efectivo' };
  return efectivo;
};

const _espejarCaja = async (client, sucursalId, mov, usuarioId, etiqueta) => {
  const caja = await tesoreriaRepo.findCajaAbierta(client, sucursalId);
  if (!caja) return; // sin caja abierta el saldo de tesorería sigue mandando
  await tesoreriaRepo.insertarEspejoCaja(client, {
    caja_id: caja.id, usuario_id: usuarioId,
    tipo: mov.tipo === 'entrada' ? 'Ingreso' : 'Egreso',
    concepto: `[Red interna] ${etiqueta}`,
    valor: mov.valor, movimiento_dinero_id: mov.id,
  });
};

const enviarRemesa = async (req, { valor, notas, clave_idempotencia }) => {
  const negocioId = req.user.negocio_id;
  const origenId  = Number(req.sucursal_id);
  const bodegaId  = Number(req.red.bodega_id);

  const monto = Number(valor);
  if (!(monto > 0)) throw { status: 400, message: 'El valor debe ser mayor a 0' };
  if (origenId === bodegaId) throw { status: 400, message: 'La bodega no se envía remesas a sí misma' };

  if (clave_idempotencia) {
    const previa = await repo.findRemesaPorClave(clave_idempotencia);
    if (previa) return { ...previa, repetido: true };
  }

  const [cuentaOrigen, cuentaTransito] = await Promise.all([
    _cuentaEfectivo(negocioId, origenId),
    _asegurarCuentaTransito(negocioId, bodegaId),
  ]);

  const confirmar = req.red.confirmar_remesa;
  const grupo = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const concepto = `Remesa a bodega${notas ? ` — ${notas}` : ''}`;

    const salida = await tesoreriaRepo.insertarMovimiento(client, {
      cuenta_id: cuentaOrigen.id, tipo: 'salida', categoria: 'traslado',
      valor: monto, concepto, grupo_traslado: grupo,
      usuario_id: req.user.id, clave_idempotencia,
    });
    await _espejarCaja(client, origenId, salida, req.user.id, concepto);

    let movTransito = null, movEntrada = null, cuentaDestino = null;

    if (confirmar) {
      // La plata queda en la cuenta de tránsito de la bodega hasta que la
      // confirmen. Nunca desaparece del total del negocio.
      movTransito = await tesoreriaRepo.insertarMovimiento(client, {
        cuenta_id: cuentaTransito.id, tipo: 'entrada', categoria: 'traslado',
        valor: monto, concepto, grupo_traslado: grupo, usuario_id: req.user.id,
      });
    } else {
      cuentaDestino = await _cuentaEfectivo(negocioId, bodegaId);
      movEntrada = await tesoreriaRepo.insertarMovimiento(client, {
        cuenta_id: cuentaDestino.id, tipo: 'entrada', categoria: 'traslado',
        valor: monto, concepto, grupo_traslado: grupo, usuario_id: req.user.id,
      });
      await _espejarCaja(client, bodegaId, movEntrada, req.user.id, concepto);
    }

    const remesa = await repo.crearRemesa(client, {
      negocio_id: negocioId,
      sucursal_origen_id: origenId, sucursal_destino_id: bodegaId,
      cuenta_origen_id: cuentaOrigen.id,
      cuenta_transito_id: confirmar ? cuentaTransito.id : null,
      cuenta_destino_id: cuentaDestino?.id || null,
      valor: monto, metodo: 'Efectivo',
      estado: confirmar ? 'En transito' : 'Recibida',
      mov_salida_id: salida.id,
      mov_transito_id: movTransito?.id || null,
      mov_entrada_id: movEntrada?.id || null,
      usuario_envia_id: req.user.id,
      clave_idempotencia, notas,
    });
    await asignarNumeroDocumento(client, { tipo: 'remesa', docId: remesa.id, negocioId });

    await client.query('COMMIT');
    return repo.findRemesaById(negocioId, remesa.id);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && clave_idempotencia) {
      const previa = await repo.findRemesaPorClave(clave_idempotencia);
      if (previa) return { ...previa, repetido: true };
    }
    throw err;
  } finally {
    client.release();
  }
};

const confirmarRemesa = async (req, remesaId) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;
  const bodegaId  = Number(req.sucursal_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const remesa = await repo.findRemesaById(negocioId, remesaId, client);
    if (!remesa) throw { status: 404, message: 'Remesa no encontrada' };
    if (remesa.estado !== 'En transito') {
      throw { status: 409, message: `La remesa ya está en estado "${remesa.estado}"` };
    }
    if (Number(remesa.sucursal_destino_id) !== bodegaId) {
      throw { status: 403, message: 'Esta remesa es para otra sucursal' };
    }

    const cuentaDestino = await _cuentaEfectivo(negocioId, bodegaId);
    const grupo    = crypto.randomUUID();
    const concepto = `Remesa recibida de ${remesa.sucursal_origen_nombre}`;

    // Tránsito → efectivo de la bodega: dos patas, saldo total intacto.
    const salidaTransito = await tesoreriaRepo.insertarMovimiento(client, {
      cuenta_id: remesa.cuenta_transito_id, tipo: 'salida', categoria: 'traslado',
      valor: remesa.valor, concepto, grupo_traslado: grupo, usuario_id: req.user.id,
    });
    const entrada = await tesoreriaRepo.insertarMovimiento(client, {
      cuenta_id: cuentaDestino.id, tipo: 'entrada', categoria: 'traslado',
      valor: remesa.valor, concepto, grupo_traslado: grupo, usuario_id: req.user.id,
    });
    await _espejarCaja(client, bodegaId, entrada, req.user.id, concepto);

    await client.query(
      `UPDATE remesas SET cuenta_destino_id = $2, mov_transito_id = COALESCE(mov_transito_id, $3) WHERE id = $1`,
      [remesaId, cuentaDestino.id, salidaTransito.id]
    );
    await repo.marcarRemesaRecibida(client, {
      remesaId, usuarioId: req.user.id, movEntradaId: entrada.id,
    });

    await client.query('COMMIT');
    return repo.findRemesaById(negocioId, remesaId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const anularRemesa = async (req, remesaId) => {
  const negocioId = req.user.negocio_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const remesa = await repo.findRemesaById(negocioId, remesaId, client);
    if (!remesa) throw { status: 404, message: 'Remesa no encontrada' };
    if (remesa.estado !== 'En transito') {
      throw {
        status: 409,
        message: 'Solo se puede anular una remesa que sigue en tránsito. Si la bodega ya la recibió, registra un ajuste.',
      };
    }
    if (Number(remesa.sucursal_origen_id) !== Number(req.sucursal_id) && !req.esBodega) {
      throw { status: 403, message: 'Solo el local que la envió o la bodega pueden anularla' };
    }

    // Los movimientos de dinero NO se borran: se desactivan. El extracto de
    // tesorería conserva la huella de lo que pasó.
    // El espejo en caja guarda el id del movimiento de dinero en
    // `referencia_id` con `referencia_tipo='tesoreria'` (ver
    // tesoreria.repository.insertarEspejoCaja) — por ahí se desactiva.
    for (const movId of [remesa.mov_salida_id, remesa.mov_transito_id]) {
      if (movId) {
        await client.query(
          `UPDATE movimientos_dinero SET activo = FALSE WHERE id = $1`, [movId]
        );
        await client.query(
          `UPDATE movimientos_caja SET activo = FALSE
           WHERE referencia_tipo = 'tesoreria' AND referencia_id = $1`, [movId]
        );
      }
    }
    await repo.marcarRemesaAnulada(client, remesaId);

    await client.query('COMMIT');
    return { id: remesaId, estado: 'Anulada' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Gasto autorizado: el local paga algo con plata de la bodega ──────────────

const registrarGastoAutorizado = async (req, { valor, concepto }) => {
  const negocioId = req.user.negocio_id;
  const sucursalId = Number(req.sucursal_id);
  const monto = Number(valor);
  if (!(monto > 0))  throw { status: 400, message: 'El valor debe ser mayor a 0' };
  if (!concepto?.trim()) throw { status: 400, message: 'Escribe en qué se gastó' };
  if (req.esBodega) throw { status: 400, message: 'La bodega registra sus gastos en Tesorería' };

  const cuenta = await _cuentaEfectivo(negocioId, sucursalId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mov = await tesoreriaRepo.insertarMovimiento(client, {
      cuenta_id: cuenta.id, tipo: 'salida', categoria: 'gasto',
      valor: monto, concepto: `[Por cuenta de bodega] ${concepto.trim()}`,
      usuario_id: req.user.id,
    });
    await _espejarCaja(client, sucursalId, mov, req.user.id, concepto.trim());

    // Espejo en la cuenta interna: descuenta de lo que el local debe liquidar.
    const movCuenta = await repo.insertarMovimientoCuenta(client, {
      negocio_id: negocioId, sucursal_id: sucursalId,
      tipo: 'GastoAutorizado', valor: monto,
      mov_dinero_id: mov.id, concepto: concepto.trim(), usuario_id: req.user.id,
    });

    await client.query('COMMIT');
    return movCuenta;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const registrarAjuste = async (req, { sucursal_id, valor, concepto }) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;
  const monto = Number(valor);
  if (!Number.isFinite(monto) || monto === 0) {
    throw { status: 400, message: 'El ajuste debe ser distinto de 0' };
  }
  if (!concepto?.trim()) throw { status: 400, message: 'Explica el motivo del ajuste' };
  await _verificarSucursal(null, sucursal_id, negocioId);

  return repo.insertarMovimientoCuenta(null, {
    negocio_id: negocioId, sucursal_id: Number(sucursal_id),
    tipo: 'Ajuste', valor: monto,
    concepto: concepto.trim(), usuario_id: req.user.id,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// LECTURAS — todo derivado
// ─────────────────────────────────────────────────────────────────────────────

const _armarSaldo = ({ resumen, cantidad, remesado, movimientos }) => {
  const porEstado = {};
  let liquidableSerial = 0;
  for (const r of resumen) {
    porEstado[r.estado] = {
      estado:        r.estado,
      etiqueta:      ETIQUETAS_ESTADO[r.estado] || r.estado,
      unidades:      Number(r.unidades),
      valor_interno: _num(r.valor_interno),
      liquidable:    _num(r.liquidable),
    };
    liquidableSerial += _num(r.liquidable);
  }
  const liquidableCantidad = cantidad.reduce((s, c) => s + _num(c.liquidable), 0);

  const totalLiquidable = liquidableSerial + liquidableCantidad;
  const recibido    = _num(remesado?.recibido);
  const enTransito  = _num(remesado?.en_transito);
  const gastos      = _num(movimientos?.gastos);
  const ajustes     = _num(movimientos?.ajustes);

  return {
    por_estado: porEstado,
    cantidad_consignada: cantidad,
    totales: {
      liquidable_total:   Math.round(totalLiquidable),
      remesado_recibido:  Math.round(recibido),
      remesas_en_transito:Math.round(enTransito),
      gastos_autorizados: Math.round(gastos),
      ajustes:            Math.round(ajustes),
      // Lo que el local todavía le debe entregar a la bodega.
      saldo_por_liquidar: Math.round(totalLiquidable - recibido - gastos - ajustes),
      // Informativo, NO exigible: mercancía que sigue en vitrina.
      en_consignacion_valor:    porEstado['En consignacion']?.valor_interno || 0,
      en_consignacion_unidades: porEstado['En consignacion']?.unidades      || 0,
      en_recaudo_valor:         porEstado['En recaudo']?.valor_interno      || 0,
      en_recaudo_unidades:      porEstado['En recaudo']?.unidades           || 0,
      sin_ubicar_unidades:      porEstado['Sin ubicar']?.unidades           || 0,
      sin_ubicar_valor:         porEstado['Sin ubicar']?.valor_interno      || 0,
    },
  };
};

const getEstadoLocal = async (negocioId, sucursalId) => {
  const [resumen, cantidad, remesado, movimientos] = await Promise.all([
    repo.getResumenUnidades(negocioId, sucursalId),
    repo.getCantidadConsignada(negocioId, sucursalId),
    repo.getTotalRemesado(negocioId, sucursalId),
    repo.getTotalMovimientosCuenta(negocioId, sucursalId),
  ]);
  return _armarSaldo({
    resumen, cantidad,
    remesado:    remesado[0],
    movimientos: movimientos[0],
  });
};

// Vista del local: lo suyo + lo que tiene pendiente por recibir.
const getPanelLocal = async (req) => {
  const negocioId  = req.user.negocio_id;
  const sucursalId = Number(req.sucursal_id);
  const [estado, porRecibir, remesas] = await Promise.all([
    getEstadoLocal(negocioId, sucursalId),
    repo.findRemisiones(negocioId, { sucursalId, rol: 'destino', estado: 'En transito', limit: 20 }),
    repo.findRemesas(negocioId, { sucursalId, rol: 'origen', limit: 10 }),
  ]);
  return { es_bodega: false, sucursal_id: sucursalId, ...estado, por_recibir: porRecibir, remesas };
};

// Vista de la bodega: todos los locales + bandejas de confirmación.
const getPanelBodega = async (req) => {
  const negocioId = req.user.negocio_id;
  const bodegaId  = Number(req.red.bodega_id);

  const sucursales = (await repo.getSucursales(negocioId)).filter((s) => s.id !== bodegaId);
  const locales = await Promise.all(sucursales.map(async (s) => ({
    sucursal_id: s.id, sucursal_nombre: s.nombre,
    ...(await getEstadoLocal(negocioId, s.id)),
  })));

  const [remesasPorConfirmar, enTransito] = await Promise.all([
    repo.findRemesas(negocioId, { sucursalId: bodegaId, rol: 'destino', estado: 'En transito', limit: 50 }),
    repo.findRemisiones(negocioId, { sucursalId: bodegaId, rol: 'origen', estado: 'En transito', limit: 50 }),
  ]);

  const totales = locales.reduce((acc, l) => ({
    saldo_por_liquidar: acc.saldo_por_liquidar + l.totales.saldo_por_liquidar,
    en_consignacion:    acc.en_consignacion    + l.totales.en_consignacion_valor,
    sin_ubicar:         acc.sin_ubicar         + l.totales.sin_ubicar_unidades,
  }), { saldo_por_liquidar: 0, en_consignacion: 0, sin_ubicar: 0 });

  return {
    es_bodega: true, sucursal_id: bodegaId,
    locales, totales,
    remesas_por_confirmar: remesasPorConfirmar,
    remisiones_en_transito: enTransito,
  };
};

const getConciliacion = async (req, sucursalId) => {
  const negocioId = req.user.negocio_id;
  const objetivo = Number(sucursalId || req.sucursal_id);
  // Un local solo puede ver lo suyo; la bodega ve cualquiera.
  if (!req.esBodega && objetivo !== Number(req.sucursal_id)) {
    throw { status: 403, message: 'Solo puedes ver la conciliación de tu sucursal' };
  }
  const [detalle, estado, unidades] = await Promise.all([
    repo.getConciliacion(negocioId, objetivo),
    getEstadoLocal(negocioId, objetivo),
    repo.getUnidades(negocioId, objetivo),
  ]);
  return {
    sucursal_id: objetivo,
    ...estado,
    liquidaciones: detalle.map((d) => ({ ...d, liquidable: _num(d.liquidable) })),
    unidades: unidades.map((u) => ({
      ...u,
      etiqueta_estado: ETIQUETAS_ESTADO[u.estado_unidad] || u.estado_unidad,
      liquidable: _num(u.liquidable),
    })),
  };
};

const getSalud = async (req) => {
  _exigirBodega(req);
  const chequeos = await repo.getChequeosSalud(req.user.negocio_id);
  const problemas =
    chequeos.sin_ubicar.length + chequeos.transito_vencido.length +
    chequeos.remesas_huerfanas.length + chequeos.imeis_duplicados.length +
    chequeos.movidas.length;
  return { ok: problemas === 0, problemas, ...chequeos };
};

const getRemision = async (req, id) => {
  const remision = await repo.findRemisionById(req.user.negocio_id, id);
  if (!remision) throw { status: 404, message: 'Remisión no encontrada' };
  const mias = [Number(remision.sucursal_origen_id), Number(remision.sucursal_destino_id)];
  if (!req.esBodega && !mias.includes(Number(req.sucursal_id))) {
    throw { status: 403, message: 'Esta remisión no es de tu sucursal' };
  }
  const lineas = await repo.getLineasRemision(id);
  return { ...remision, lineas };
};

const listarRemisiones = (req, { estado, limit } = {}) =>
  repo.findRemisiones(req.user.negocio_id, {
    sucursalId: Number(req.sucursal_id),
    rol: req.esBodega ? 'origen' : 'destino',
    estado, limit,
  });

const listarRemesas = (req, { estado, limit } = {}) =>
  repo.findRemesas(req.user.negocio_id, {
    sucursalId: Number(req.sucursal_id),
    rol: req.esBodega ? 'destino' : 'origen',
    estado, limit,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Búsqueda para despacho — UN SOLO campo para el lector.
//
// El operario no debería tener que decidir si lo que va a escanear es un IMEI o
// un código de accesorio: se prueban ambos. Primero serial (IMEI exacto) y
// luego producto de cantidad por código único.
// ─────────────────────────────────────────────────────────────────────────────

const _formatoSerial = (s) => ({
  tipo: 'serial',
  serial_id: s.serial_id,
  imei: s.imei,
  nombre: [s.nombre, s.marca, s.modelo].filter(Boolean).join(' '),
  valor_interno: _num(s.costo_compra),
  sin_costo: _num(s.costo_compra) === 0,
  cantidad: 1,
});

const _formatoCantidad = (p) => ({
  tipo: 'cantidad',
  producto_id: p.producto_id,
  codigo: p.codigo || null,
  nombre: p.nombre,
  unidad_medida: p.unidad_medida || 'unidad',
  stock: Number(p.stock || 0),
  valor_interno: _num(p.costo_unitario),
  sin_costo: _num(p.costo_unitario) === 0,
  cantidad: 1,
});

const buscarParaDespacho = async (req, texto) => {
  _exigirBodega(req);
  const q = String(texto || '').trim();
  if (q.length < 3) {
    throw { status: 400, message: 'Escribe al menos 3 caracteres' };
  }
  const negocioId  = req.user.negocio_id;
  const sucursalId = Number(req.sucursal_id);

  // 1) ¿Es un IMEI?
  const s = await repo.buscarSerialDisponible(negocioId, sucursalId, q);
  if (s) {
    if (s.vendido)        throw { status: 409, message: `El equipo ${s.imei} ya fue vendido` };
    if (s.prestado)       throw { status: 409, message: `El equipo ${s.imei} está prestado` };
    if (s.ya_remisionado) throw { status: 409, message: `El equipo ${s.imei} ya está en una remisión activa` };
    return _formatoSerial(s);
  }

  // 2) ¿Es un código único de accesorio?
  const p = await repo.buscarCantidadPorCodigo(negocioId, sucursalId, q);
  if (p) {
    if (Number(p.stock) <= 0) {
      throw { status: 409, message: `"${p.nombre}" está sin stock en la bodega` };
    }
    return _formatoCantidad(p);
  }

  throw { status: 404, message: `"${q}" no está en la bodega (ni como IMEI ni como código)` };
};

// Catálogo de accesorios de la bodega, para elegir a mano los que no tienen
// código impreso.
const catalogoCantidad = async (req, q) => {
  _exigirBodega(req);
  const filas = await repo.buscarCantidadDisponible(
    req.user.negocio_id, Number(req.sucursal_id), q
  );
  return filas.map((p) => ({ ..._formatoCantidad(p), linea_nombre: p.linea_nombre || null }));
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolver ítems que vienen del carrito de inventario.
//
// El carrito guarda el PRECIO DE VENTA, que no sirve aquí: el despacho va al
// costo. Se re-resuelve todo contra la base (y de paso se valida propiedad,
// stock y que nada esté vendido o ya remisionado) en vez de confiar en lo que
// mande el navegador.
// ─────────────────────────────────────────────────────────────────────────────
const resolverItems = async (req, items) => {
  _exigirBodega(req);
  if (!Array.isArray(items) || !items.length) {
    throw { status: 400, message: 'No hay productos para despachar' };
  }
  const negocioId  = req.user.negocio_id;
  const sucursalId = Number(req.sucursal_id);

  const resueltos = [];
  const descartados = [];

  for (const it of items) {
    if (it.tipo === 'serial' && it.serial_id) {
      const s = await repo.findSerialById(negocioId, sucursalId, Number(it.serial_id));
      if (!s)                   { descartados.push({ nombre: it.nombre || 'Equipo', motivo: 'no está en la bodega' }); continue; }
      if (s.vendido)            { descartados.push({ nombre: s.imei, motivo: 'ya fue vendido' }); continue; }
      if (s.prestado)           { descartados.push({ nombre: s.imei, motivo: 'está prestado' }); continue; }
      if (s.ya_remisionado)     { descartados.push({ nombre: s.imei, motivo: 'ya está en otra remisión' }); continue; }
      resueltos.push(_formatoSerial(s));

    } else if (it.tipo === 'cantidad' && it.producto_id) {
      const p = await repo.findCantidadById(negocioId, sucursalId, Number(it.producto_id));
      if (!p) { descartados.push({ nombre: it.nombre || 'Producto', motivo: 'no está en la bodega' }); continue; }
      const pedida = Math.max(1, Number(it.cantidad) || 1);
      if (Number(p.stock) <= 0) { descartados.push({ nombre: p.nombre, motivo: 'sin stock' }); continue; }
      // Se recorta al stock disponible en vez de fallar: el usuario ve cuánto
      // quedó y decide.
      resueltos.push({ ..._formatoCantidad(p), cantidad: Math.min(pedida, Number(p.stock)) });

    } else {
      descartados.push({ nombre: it.nombre || 'Producto', motivo: 'tipo no reconocido' });
    }
  }

  return { items: resueltos, descartados };
};

const getSucursalesRed = async (req) => {
  const bodegaId = Number(req.red.bodega_id);
  const todas = await repo.getSucursales(req.user.negocio_id);
  return todas.map((s) => ({ ...s, es_bodega: s.id === bodegaId }));
};

// Contexto liviano para pantallas que solo necesitan saber "dónde estoy".
// Lo consume el carrito de inventario para decidir qué botón mostrar sin
// depender del store de sucursal del navegador (que para un vendedor puede no
// coincidir con su sucursal real: el backend la resuelve desde el token).
const getContexto = async (req) => {
  const bodegaId  = Number(req.red.bodega_id);
  const sucursalId = Number(req.sucursal_id);
  const todas = await repo.getSucursales(req.user.negocio_id);
  return {
    activa:      true,
    sucursal_id: sucursalId,
    bodega_id:   bodegaId,
    es_bodega:   sucursalId === bodegaId,
    bodega_nombre: todas.find((s) => s.id === bodegaId)?.nombre || 'Bodega',
    locales:     todas.filter((s) => s.id !== bodegaId),
  };
};

const getMovimientosCuenta = async (req, sucursalId) => {
  const objetivo = Number(sucursalId || req.sucursal_id);
  if (!req.esBodega && objetivo !== Number(req.sucursal_id)) {
    throw { status: 403, message: 'Solo puedes ver los movimientos de tu sucursal' };
  }
  return repo.findMovimientosCuenta(req.user.negocio_id, objetivo);
};

module.exports = {
  despachar, recibir, anularRemision, devolver,
  enviarRemesa, confirmarRemesa, anularRemesa,
  registrarGastoAutorizado, registrarAjuste,
  getPanelLocal, getPanelBodega, getConciliacion, getSalud,
  getRemision, listarRemisiones, listarRemesas,
  buscarParaDespacho, catalogoCantidad, resolverItems,
  getSucursalesRed, getContexto, getMovimientosCuenta,
  ETIQUETAS_ESTADO,
};
