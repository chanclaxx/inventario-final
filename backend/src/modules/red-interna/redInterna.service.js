const crypto = require('crypto');
const { pool } = require('../../config/db');
const repo          = require('./redInterna.repository');
const referencias   = require('./redInterna.referencias');
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

// ─────────────────────────────────────────────────────────────────────────────
// ¿A DÓNDE FUE EL EQUIPO?
//
// El estado dice QUÉ pasó; el destino dice A QUIÉN. Sin el destino, "vendido"
// y "prestado" son igual de opacos para quien tiene que responderle a la
// bodega. Se arma aquí, en un solo lugar, para que todas las pantallas digan
// lo mismo con las mismas palabras.
// ─────────────────────────────────────────────────────────────────────────────
const _destinoUnidad = (u) => {
  switch (u.estado_unidad) {
    case 'Por liquidar':
    case 'En recaudo':
      return {
        tipo: 'venta',
        quien: u.nombre_cliente || 'Cliente sin nombre',
        documento: u.factura_numero != null ? `Factura #${u.factura_numero}` : null,
        fecha: u.factura_fecha || null,
        nota: u.estado_unidad === 'En recaudo' ? 'Se liquida a medida que cobras' : null,
      };
    case 'En prestamo':
      return {
        tipo: 'prestamo',
        // Un préstamo sin prestatario resuelto no es un error: pudo prestarse
        // a un empleado o el cruce por IMEI no encontró uno vivo.
        quien: u.prestatario_nombre || 'Sin registrar',
        documento: u.prestamo_numero != null ? `Préstamo #${u.prestamo_numero}` : null,
        fecha: u.prestamo_fecha || null,
        nota: 'Fuera del local, todavía no genera deuda',
      };
    case 'Devuelta':
      return {
        tipo: 'devolucion',
        quien: 'Bodega',
        documento: u.devolucion_numero != null ? `Devolución #${u.devolucion_numero}` : null,
        fecha: u.fecha_devolucion || null,
        nota: 'Ya no responde por él',
      };
    case 'En consignacion':
      return { tipo: 'vitrina', quien: null, documento: null, fecha: null,
               nota: 'Disponible para vender' };
    case 'En transito':
      return { tipo: 'transito', quien: null, documento: null, fecha: null,
               nota: 'Todavía no lo has recibido' };
    case 'Faltante':
      return { tipo: 'faltante', quien: null, documento: null, fecha: null,
               nota: 'No llegó en el envío' };
    default: // Sin ubicar · Movida
      return { tipo: 'alerta', quien: null, documento: null, fecha: null,
               nota: 'No está en tu inventario y no aparece vendido' };
  }
};

// Compara el nombre con el que la bodega despachó contra el que tiene el
// producto en el local. Se ignoran mayúsculas, tildes y espacios de más: solo
// interesa la diferencia REAL, la que delata un despacho equivocado.
const _normalizarNombre = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tildes fuera
  .toLowerCase().replace(/\s+/g, ' ').trim();

const _referenciaDifiere = (enBodega, enLocal) => {
  if (!enBodega || !enLocal) return false;
  return _normalizarNombre(enBodega) !== _normalizarNombre(enLocal);
};

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
// COSTOS OCULTOS PARA VENDEDORES
//
// El costo al que la bodega compró cada equipo es información comercial: un
// vendedor no tiene por qué saberlo. Pero SÍ necesita confirmar las entregas y
// entregar el dinero, así que el TOTAL a remitir se conserva — sin él no podría
// hacer su trabajo.
//
// El recorte va aquí, en el backend, y no en la pantalla: si solo se escondiera
// en el frontend el dato viajaría igual y se vería en la consola del navegador.
// ─────────────────────────────────────────────────────────────────────────────

const _puedeVerCostos = (req) =>
  req.user?.rol !== 'vendedor' || req.red?.ocultar_costos === false;

// Quita las claves de valor de un objeto, dejando el resto intacto.
const _sinValores = (obj, claves) => {
  if (!obj) return obj;
  const copia = { ...obj };
  for (const k of claves) if (k in copia) copia[k] = null;
  return copia;
};

const CLAVES_VALOR_UNIDAD = [
  'valor_interno', 'liquidable', 'subtotal_linea', 'recaudado_prorrateado',
];

// Lo monetario del resumen por envío. Los conteos por estado NO están aquí a
// propósito: el vendedor necesita saber qué vendió y qué le queda.
const CLAVES_VALOR_ENVIO = [
  'valor_total', 'valor_recibido', 'deuda_generada', 'deuda_pendiente',
  'disponibles_valor', 'vendidas_valor', 'prestadas_valor', 'sin_ubicar_valor',
  'accesorios_valor',
];

/**
 * Recorta un estado de cuenta / panel para un vendedor.
 * Se conserva: unidades, estados, fechas, documentos y el TOTAL a remitir.
 * Se borra: costos unitarios, valores de mercancía y el detalle monetario
 * de los movimientos.
 */
const _recortarParaVendedor = (data) => {
  const t = data.totales || {};
  return {
    ...data,
    costos_ocultos: true,
    totales: {
      // Lo único monetario que sobrevive: cuánto hay que entregarle a la bodega.
      saldo_por_liquidar:  t.saldo_por_liquidar,
      remesado_recibido:   t.remesado_recibido,
      remesas_en_transito: t.remesas_en_transito,
      gastos_autorizados:  t.gastos_autorizados,
      en_consignacion_unidades: t.en_consignacion_unidades,
      en_recaudo_unidades:      t.en_recaudo_unidades,
      sin_ubicar_unidades:      t.sin_ubicar_unidades,
      // Valores de mercancía: fuera.
      en_consignacion_valor: null,
      en_recaudo_valor:      null,
      sin_ubicar_valor:      null,
      liquidable_total:      null,
      ajustes:               t.ajustes,
    },
    por_estado: Object.fromEntries(
      Object.entries(data.por_estado || {}).map(([k, v]) => [
        k, { ...v, valor_interno: null, liquidable: null },
      ])
    ),
    cantidad_consignada: undefined,
    extracto: (data.extracto || []).map((e) => ({
      ...e,
      // El movimiento se ve (qué pasó y cuándo), el monto no.
      valor: e.clase === 'info' ? 0 : null,
      saldo: null,
    })),
    mercancia: data.mercancia && {
      ...data.mercancia,
      valor_total: null, liquidable_total: null,
      items: data.mercancia.items.map((u) => _sinValores(u, CLAVES_VALOR_UNIDAD)),
    },
    remisiones: (data.remisiones || []).map((r) => ({ ...r, valor_total: null })),
    // Por envío sobreviven los CONTEOS (cuántos vendió, prestó y le quedan:
    // eso lo tiene que saber para trabajar) pero ningún valor en pesos.
    envios: (data.envios || []).map((e) => _sinValores(e, CLAVES_VALOR_ENVIO)),
    envios_resumen: data.envios_resumen && {
      total: data.envios_resumen.total,
      accesorios_pendiente: null,
      pendiente_en_envios:  null,
    },
  };
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

// La cascada de resolución vive en `redInterna.referencias.js`. Estos dos
// envoltorios mantienen la firma que ya usaban recepción y devolución.
//
// `preferido` es la referencia que el usuario eligió al despachar (guardada en
// `lineas_remision.producto_destino_id`): se respeta si sigue siendo válida.
const _resolverProductoSerialDestino = async (client, productoOrigenId, sucursalDestinoId, negocioId, preferido = null) =>
  (await referencias.obtenerODcrear(client, {
    tipo: 'serial', productoOrigenId, sucursalDestinoId, negocioId, preferido,
  })).producto_id;

const _resolverProductoCantidadDestino = async (client, productoOrigenId, sucursalDestinoId, negocioId, preferido = null) =>
  (await referencias.obtenerODcrear(client, {
    tipo: 'cantidad', productoOrigenId, sucursalDestinoId, negocioId, preferido,
  })).producto_id;

/**
 * Valor con el que sale una línea de la remisión.
 *
 * Por defecto es el COSTO real (modo "a costo"): es lo que el local tendrá que
 * liquidar cuando venda. Pero la bodega puede ajustarlo desde la pantalla —
 * hace falta, por ejemplo, cuando el equipo entró sin costo registrado y saldría
 * en $0, o cuando se acuerda otro valor para esa entrega.
 *
 * El override es explícito y por línea: si no viene, manda el costo.
 */
const _valorLinea = (costoReal, override) => {
  if (override === undefined || override === null || override === '') return _num(costoReal);
  const v = Number(override);
  if (!Number.isFinite(v) || v < 0) {
    throw { status: 400, message: 'El valor de la línea no puede ser negativo' };
  }
  return Math.round(v * 100) / 100;
};

/**
 * Referencia de destino que se guarda en la línea al DESPACHAR.
 *
 *   • Si el usuario eligió una en la pantalla, esa manda (validando que sea de
 *     la sucursal destino — nunca se confía en el id que llega del navegador).
 *   • Si no, se guarda la que la cascada resuelva con confianza alta.
 *   • Con confianza baja o sin match se deja NULL: la recepción volverá a
 *     resolver y, solo entonces, creará la referencia si de verdad no existe.
 *
 * No crea nada: despachar no debe tocar el catálogo del destino, porque la
 * remisión todavía se puede anular.
 */
const _destinoElegido = async (client, {
  tipo, productoOrigenId, sucursalDestinoId, eleccionUsuario,
}) => {
  const tabla = tipo === 'serial' ? 'productos_serial' : 'productos_cantidad';

  if (eleccionUsuario) {
    const { rows } = await client.query(
      `SELECT id FROM ${tabla} WHERE id = $1 AND sucursal_id = $2`,
      [Number(eleccionUsuario), sucursalDestinoId]
    );
    if (!rows.length) {
      throw { status: 400, message: 'La referencia de destino elegida no es de esa sucursal' };
    }
    return rows[0].id;
  }

  const r = await referencias.resolver(client, { tipo, productoOrigenId, sucursalDestinoId });
  return referencias.esSeguro(r.nivel) && r.destino ? r.destino.id : null;
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

        // A qué referencia del destino va. Se decide AQUÍ, no al recibir:
        // quien conoce el catálogo es el de la bodega. Si el usuario eligió
        // una, manda; si no, se usa la que la cascada resuelva con confianza.
        // Sin match seguro queda NULL y se resuelve/crea en la recepción.
        const destinoSerial = await _destinoElegido(client, {
          tipo: 'serial', productoOrigenId: s.producto_id,
          sucursalDestinoId: destinoId, eleccionUsuario: l.producto_destino_id,
        });

        // MODO A (a costo): el valor interno es el costo real del negocio.
        // `seriales.costo_compra` NUNCA se modifica — es la verdad del costo
        // para los reportes, aquí solo se fotografía.
        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'serial',
          serial_id: s.id, imei: s.imei,
          producto_origen_id: s.producto_id,
          producto_destino_id: destinoSerial,
          valor_interno: _valorLinea(s.costo_compra, l.valor_interno),
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

        const destinoCantidad = await _destinoElegido(client, {
          tipo: 'cantidad', productoOrigenId: p.id,
          sucursalDestinoId: destinoId, eleccionUsuario: l.producto_destino_id,
        });

        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'cantidad',
          producto_origen_id: p.id, cantidad: cant,
          producto_destino_id: destinoCantidad,
          valor_interno: _valorLinea(p.costo_unitario, l.valor_interno),
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

      const productoDestinoId = await _resolverProductoSerialDestino(
        client, s.producto_id, destinoId, negocioId, l.producto_destino_id
      );
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

      const productoDestinoId = await _resolverProductoCantidadDestino(
        client, l.producto_origen_id, destinoId, negocioId, l.producto_destino_id
      );

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
//
// SIMÉTRICA AL DESPACHO: el local la emite y queda EN TRÁNSITO; el inventario
// se mueve cuando la bodega CONFIRMA que la recibió. Antes se autoconfirmaba y
// la bodega se enteraba con la mercancía ya adentro, sin poder revisarla.
//
// ORIGEN DE CADA UNIDAD — no todo lo que hay en un local vino de bodega:
//   'bodega' → llegó en una remisión. Devolverla cancela su consignación.
//   'propio' → es del local (retoma, compra propia, inventario inicial).
//              La bodega la recibe igual, pero NO toca la cuenta salvo que se
//              pida explícitamente `genera_saldo_favor` (la bodega se la compra).
//
// Nada financiero ocurre en silencio: el saldo a favor se pide línea por línea.
// ─────────────────────────────────────────────────────────────────────────────

// ¿Esta unidad está viva en una consignación de este local?
const _origenUnidadSerial = async (client, serialId, negocioId) => {
  const { rows } = await client.query(`
    SELECT lr.id, lr.valor_interno, r.numero AS remision_numero
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE lr.serial_id = $1 AND r.negocio_id = $2
      AND r.tipo = 'entrega' AND lr.estado_linea IN ('Pendiente', 'Recibida')
    ORDER BY lr.id DESC LIMIT 1
  `, [serialId, negocioId]);
  return rows[0] || null;
};

/**
 * Previsualiza una devolución: para cada unidad dice de dónde viene, para que
 * la pantalla pueda mostrarlo y pedir la decisión solo donde hace falta.
 */
const previsualizarDevolucion = async (req, { lineas }) => {
  const negocioId = req.user.negocio_id;
  const origenId  = Number(req.sucursal_id);
  if (!Array.isArray(lineas) || !lineas.length) {
    throw { status: 400, message: 'Selecciona al menos un producto' };
  }

  const client = await pool.connect();
  try {
    const items = [];
    for (const l of lineas) {
      if (l.tipo === 'serial') {
        const { rows } = await client.query(`
          SELECT s.id, s.imei, s.vendido, s.prestado,
                 COALESCE(s.costo_compra, 0) AS costo_compra,
                 ps.nombre, ps.marca, ps.modelo
          FROM seriales s
          JOIN productos_serial ps ON ps.id = s.producto_id
          WHERE s.id = $1 AND ps.sucursal_id = $2
        `, [l.serial_id, origenId]);
        if (!rows.length) {
          items.push({ ...l, error: 'No está en este local' });
          continue;
        }
        const s = rows[0];
        const consignada = await _origenUnidadSerial(client, s.id, negocioId);
        items.push({
          tipo: 'serial', serial_id: s.id, imei: s.imei,
          nombre: [s.nombre, s.marca, s.modelo].filter(Boolean).join(' '),
          origen: consignada ? 'bodega' : 'propio',
          remision_numero: consignada?.remision_numero ?? null,
          valor_interno: _num(consignada?.valor_interno ?? s.costo_compra),
          bloqueado: s.vendido ? 'Ya fue vendido' : s.prestado ? 'Está prestado' : null,
        });
      } else {
        const { rows } = await client.query(
          `SELECT id, nombre, codigo, stock, COALESCE(costo_unitario, 0) AS costo_unitario
           FROM productos_cantidad WHERE id = $1 AND sucursal_id = $2 AND activo = true`,
          [l.producto_id, origenId]
        );
        if (!rows.length) { items.push({ ...l, error: 'No está en este local' }); continue; }
        const p = rows[0];
        // Los productos de cantidad son fungibles: no se puede saber si esta
        // unidad concreta vino de bodega. Se ofrecen las dos opciones.
        items.push({
          tipo: 'cantidad', producto_id: p.id, nombre: p.nombre, codigo: p.codigo,
          cantidad: Math.min(Number(l.cantidad) || 1, Number(p.stock)),
          stock: Number(p.stock), origen: 'indeterminado',
          valor_interno: _num(p.costo_unitario),
          bloqueado: Number(p.stock) <= 0 ? 'Sin stock' : null,
        });
      }
    }
    const propios = items.filter((i) => i.origen === 'propio' || i.origen === 'indeterminado');
    return { items, requiere_decision: propios.length > 0, propios: propios.length };
  } finally {
    client.release();
  }
};

/**
 * El local emite la devolución. NO mueve inventario: queda en tránsito hasta
 * que la bodega confirme.
 */
const devolver = async (req, { lineas, notas, clave_idempotencia }) => {
  const negocioId = req.user.negocio_id;
  const origenId  = Number(req.sucursal_id);          // el local
  const destinoId = Number(req.red.bodega_id);        // la bodega

  if (origenId === destinoId) throw { status: 400, message: 'La bodega no se devuelve a sí misma' };
  if (!Array.isArray(lineas) || !lineas.length) {
    throw { status: 400, message: 'Selecciona al menos un producto para devolver' };
  }
  if (clave_idempotencia) {
    const previa = await repo.findRemisionPorClave(clave_idempotencia);
    if (previa) return { ...previa, repetido: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const remision = await repo.crearRemision(client, {
      negocio_id: negocioId, tipo: 'devolucion',
      sucursal_origen_id: origenId, sucursal_destino_id: destinoId,
      usuario_emisor_id: req.user.id, notas, clave_idempotencia,
      estado: 'En transito',
    });

    for (const l of lineas) {
      if (l.tipo === 'serial') {
        // FOR UPDATE: nadie puede venderlo mientras va en camino.
        const { rows } = await client.query(`
          SELECT s.id, s.imei, s.vendido, s.prestado, s.producto_id,
                 COALESCE(s.costo_compra, 0) AS costo_compra,
                 ps.nombre, ps.marca, ps.modelo
          FROM seriales s
          JOIN productos_serial ps ON ps.id = s.producto_id
          WHERE s.id = $1 AND ps.sucursal_id = $2
          FOR UPDATE OF s
        `, [l.serial_id, origenId]);
        if (!rows.length) throw { status: 404, message: 'El equipo no está en este local' };
        const s = rows[0];
        if (s.vendido)  throw { status: 400, message: `El equipo ${s.imei} ya fue vendido` };
        if (s.prestado) throw { status: 400, message: `El equipo ${s.imei} está prestado` };

        const consignada = await _origenUnidadSerial(client, s.id, negocioId);
        const origenUnidad = consignada ? 'bodega' : 'propio';
        // El saldo a favor solo aplica a mercancía propia y solo si se pide.
        const saldoFavor = origenUnidad === 'propio' && l.genera_saldo_favor === true;

        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'serial', serial_id: s.id, imei: s.imei,
          producto_origen_id: s.producto_id,
          valor_interno: _valorLinea(consignada?.valor_interno ?? s.costo_compra, l.valor_interno),
          estado_linea: 'Pendiente',
          origen_unidad: origenUnidad,
          genera_saldo_favor: saldoFavor,
          nombre_producto: l.nombre_producto
            || [s.nombre, s.marca, s.modelo].filter(Boolean).join(' ') || s.imei,
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
          throw { status: 400, message: `Stock insuficiente de "${rows[0].nombre}". Hay ${rows[0].stock}` };
        }

        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'cantidad',
          producto_origen_id: l.producto_id, cantidad: cant,
          valor_interno: _valorLinea(rows[0].costo_unitario, l.valor_interno),
          estado_linea: 'Pendiente',
          origen_unidad: l.origen_unidad === 'bodega' ? 'bodega' : 'propio',
          genera_saldo_favor: l.genera_saldo_favor === true,
          nombre_producto: rows[0].nombre,
        });
      }
    }

    await repo.actualizarTotalRemision(client, remision.id);
    await asignarNumeroDocumento(client, { tipo: 'remision', docId: remision.id, negocioId });

    await client.query('COMMIT');
    return repo.findRemisionById(negocioId, remision.id);
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

/**
 * La bodega confirma la devolución: aquí sí se mueve el inventario, se cierra
 * la consignación de lo que vino de bodega y se abona el saldo a favor de lo
 * propio que la bodega decidió comprar.
 *
 * Lo NO marcado como recibido queda 'Faltante': no se mueve y sigue en el local.
 */
const confirmarDevolucion = async (req, remisionId, { lineas_recibidas } = {}) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const remision = await repo.findRemisionById(negocioId, remisionId, client);
    if (!remision) throw { status: 404, message: 'Devolución no encontrada' };
    if (remision.tipo !== 'devolucion') {
      throw { status: 400, message: 'Ese documento no es una devolución' };
    }
    if (remision.estado !== 'En transito') {
      throw { status: 409, message: `Esta devolución ya está en estado "${remision.estado}"` };
    }
    if (Number(remision.sucursal_destino_id) !== Number(req.sucursal_id)) {
      throw { status: 403, message: 'Esta devolución es para otra sucursal' };
    }

    const { rows: lineas } = await client.query(
      `SELECT * FROM lineas_remision WHERE remision_id = $1 ORDER BY id`, [remisionId]
    );
    const setOk = new Set(
      (Array.isArray(lineas_recibidas) && lineas_recibidas.length
        ? lineas_recibidas
        : lineas.map((l) => l.id)).map(Number)
    );

    const localId  = remision.sucursal_origen_id;
    const bodegaId = remision.sucursal_destino_id;

    const traslado = await trasladosRepo.crearTraslado(client, {
      negocio_id: negocioId,
      sucursal_origen_id: localId, sucursal_destino_id: bodegaId,
      usuario_id: req.user.id,
      notas: `Devolución #${remision.numero ?? remision.id} desde ${remision.sucursal_origen_nombre}`,
    });

    const idsOk = [], idsFaltante = [];
    let saldoAFavor = 0;

    for (const l of lineas) {
      const id = Number(l.id);
      if (!setOk.has(id)) { idsFaltante.push(id); continue; }

      if (l.tipo === 'serial') {
        const { rows } = await client.query(`
          SELECT s.id, s.imei, s.vendido, s.prestado, s.producto_id
          FROM seriales s
          JOIN productos_serial ps ON ps.id = s.producto_id
          WHERE s.id = $1 AND ps.sucursal_id = $2
          FOR UPDATE OF s
        `, [l.serial_id, localId]);
        if (!rows.length) {
          throw { status: 409, message: `El equipo ${l.imei || ''} ya no está en el local. Actualiza y vuelve a intentar.` };
        }
        const s = rows[0];
        if (s.vendido)  throw { status: 409, message: `El equipo ${s.imei} fue vendido antes de llegar; no se puede recibir` };
        if (s.prestado) throw { status: 409, message: `El equipo ${s.imei} está prestado` };

        const productoDestinoId = await _resolverProductoSerialDestino(
          client, s.producto_id, bodegaId, negocioId
        );
        await trasladosRepo.moverSerial(client, s.id, productoDestinoId);
        await trasladosRepo.insertarLineaTraslado(client, {
          traslado_id: traslado.id, tipo: 'serial', serial_id: s.id,
          producto_serial_origen_id: s.producto_id,
          producto_serial_destino_id: productoDestinoId,
          imei: s.imei, nombre_producto: l.nombre_producto,
        });

        // Si venía de bodega, su consignación se cierra. ORDEN IMPORTANTE:
        // primero la línea de entrega, luego la de devolución — el índice
        // `uq_lineas_remision_serial_viva` solo admite una viva por serial.
        if (l.origen_unidad === 'bodega') {
          await client.query(`
            UPDATE lineas_remision lr SET estado_linea = 'Devuelta'
            FROM remisiones r
            WHERE lr.remision_id = r.id AND r.tipo = 'entrega' AND r.negocio_id = $2
              AND lr.serial_id = $1 AND lr.estado_linea IN ('Pendiente', 'Recibida')
          `, [s.id, negocioId]);
        }
        await client.query(
          `UPDATE lineas_remision SET producto_destino_id = $2, cantidad_recibida = 1 WHERE id = $1`,
          [id, productoDestinoId]
        );

      } else {
        const cant = Number(l.cantidad);
        const { rows } = await client.query(
          `SELECT id, nombre, stock, COALESCE(costo_unitario, 0) AS costo_unitario
           FROM productos_cantidad WHERE id = $1 FOR UPDATE`,
          [l.producto_origen_id]
        );
        if (!rows.length) throw { status: 404, message: `"${l.nombre_producto}" ya no existe en el local` };
        if (rows[0].stock < cant) {
          throw { status: 409, message: `Stock insuficiente de "${rows[0].nombre}" en el local (hay ${rows[0].stock})` };
        }
        const productoDestinoId = await _resolverProductoCantidadDestino(
          client, l.producto_origen_id, bodegaId, negocioId
        );

        // Costo promedio ponderado en la bodega al recibir de vuelta.
        const { rows: dest } = await client.query(
          `SELECT stock, COALESCE(costo_unitario, 0) AS costo_unitario
           FROM productos_cantidad WHERE id = $1 FOR UPDATE`, [productoDestinoId]
        );
        const nuevoCosto = calcularCostoPromedio(
          Number(dest[0].stock), Number(dest[0].costo_unitario), cant, _num(l.valor_interno)
        );

        await trasladosRepo.ajustarStockEnTransaccion(client, l.producto_origen_id, -cant);
        await trasladosRepo.ajustarStockEnTransaccion(client, productoDestinoId, cant);
        await client.query(
          `UPDATE productos_cantidad SET costo_unitario = $2 WHERE id = $1`,
          [productoDestinoId, nuevoCosto]
        );
        await trasladosRepo.insertarHistorialEnTransaccion(client, {
          producto_id: l.producto_origen_id, sucursal_id: localId,
          cantidad: -cant, costo_unitario: _num(l.valor_interno),
          notas: `Devolución #${remision.numero ?? remision.id} → bodega`,
        });
        await trasladosRepo.insertarHistorialEnTransaccion(client, {
          producto_id: productoDestinoId, sucursal_id: bodegaId,
          cantidad: cant, costo_unitario: _num(l.valor_interno),
          notas: `Devolución #${remision.numero ?? remision.id} ← ${remision.sucursal_origen_nombre}`,
        });
        await trasladosRepo.insertarLineaTraslado(client, {
          traslado_id: traslado.id, tipo: 'cantidad',
          producto_cantidad_origen_id: l.producto_origen_id,
          producto_cantidad_destino_id: productoDestinoId,
          cantidad: cant, nombre_producto: l.nombre_producto,
        });
        await client.query(
          `UPDATE lineas_remision SET producto_destino_id = $2, cantidad_recibida = $3 WHERE id = $1`,
          [id, productoDestinoId, cant]
        );
      }

      // Mercancía propia que la bodega decidió comprar → saldo a favor del local.
      if (l.genera_saldo_favor) {
        const unidades = l.tipo === 'cantidad' ? Number(l.cantidad) : 1;
        saldoAFavor += _num(l.valor_interno) * unidades;
      }
      idsOk.push(id);
    }

    if (idsOk.length)       await repo.marcarLineas(client, idsOk, 'Devuelta');
    if (idsFaltante.length) await repo.marcarLineas(client, idsFaltante, 'Faltante');
    if (!idsOk.length) throw { status: 400, message: 'No marcaste ningún producto como recibido' };

    // El saldo a favor baja lo que el local debe: es un Ajuste positivo, la
    // misma convención que usa `_armarSaldo` (saldo = liquidable − ajustes).
    if (saldoAFavor > 0) {
      await repo.insertarMovimientoCuenta(client, {
        negocio_id: negocioId, sucursal_id: localId,
        tipo: 'Ajuste', valor: Math.round(saldoAFavor * 100) / 100,
        concepto: `Mercancía propia comprada por bodega — devolución #${remision.numero ?? remision.id}`,
        usuario_id: req.user.id,
      });
    }

    await repo.marcarRemisionRecibida(client, {
      remisionId, usuarioId: req.user.id,
      estado: idsFaltante.length ? 'Parcial' : 'Recibida',
      trasladoId: traslado.id,
    });
    await repo.actualizarTotalRemision(client, remisionId);

    await client.query('COMMIT');
    return {
      ...(await repo.findRemisionById(negocioId, remisionId)),
      recibidas: idsOk.length, faltantes: idsFaltante.length,
      saldo_a_favor: Math.round(saldoAFavor),
    };
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

/**
 * Cuenta de la bodega donde debe aterrizar una remesa.
 *
 * Se busca la que maneje ese método (si el local remitió por Nequi, entra a la
 * cuenta Nequi de la bodega). Si la bodega no tiene una cuenta para ese método,
 * cae al efectivo: el dinero no puede quedarse sin destino, y un arqueo lo
 * corrige. Es la misma política que ya usa Tesorería con los pagos sin método.
 */
const _cuentaDestinoRemesa = async (negocioId, bodegaId, metodo) => {
  const cuentas = await tesoreriaRepo.findCuentas(negocioId, bodegaId);
  const porMetodo = cuentas.find(
    (c) => (c.moneda || 'COP') === 'COP' && (c.metodos_pago || []).includes(metodo)
  );
  if (porMetodo) return porMetodo;
  return _cuentaEfectivo(negocioId, bodegaId);
};

// Cuentas desde las que un local puede remitir (efectivo, Nequi, banco…).
// Se excluyen las de divisa: la red interna mueve pesos.
const getCuentasParaRemesa = async (req) => {
  const negocioId  = req.user.negocio_id;
  const sucursalId = Number(req.sucursal_id);
  await tesoreriaRepo.asegurarCuentaEfectivo(negocioId, sucursalId);
  const cuentas = await tesoreriaRepo.findCuentas(negocioId, sucursalId);
  return cuentas
    .filter((c) => (c.moneda || 'COP') === 'COP' && c.tipo !== 'transito')
    .map((c) => ({
      id: c.id, nombre: c.nombre, tipo: c.tipo,
      es_efectivo: c.tipo === 'efectivo' || (c.metodos_pago || []).includes('Efectivo'),
      metodo_sugerido: (c.metodos_pago || [])[0]
        || (c.tipo === 'efectivo' ? 'Efectivo' : c.nombre),
    }));
};

const enviarRemesa = async (req, { valor, notas, clave_idempotencia, cuenta_origen_id, metodo }) => {
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

  // Si el local eligió una cuenta (Nequi, banco…), se usa esa. Sin elección,
  // el default sigue siendo el efectivo — el caso más común.
  let cuentaOrigen;
  if (cuenta_origen_id) {
    const c = await tesoreriaRepo.findCuentaById(Number(cuenta_origen_id), negocioId);
    if (!c || !c.activa) throw { status: 404, message: 'Cuenta no encontrada o inactiva' };
    if (Number(c.sucursal_id) !== origenId) {
      throw { status: 403, message: 'Esa cuenta pertenece a otra sucursal' };
    }
    if ((c.moneda || 'COP') !== 'COP') {
      throw { status: 400, message: 'La remesa debe salir de una cuenta en pesos' };
    }
    if (c.tipo === 'transito') {
      throw { status: 400, message: 'No se puede remitir desde una cuenta de tránsito' };
    }
    cuentaOrigen = c;
  } else {
    cuentaOrigen = await _cuentaEfectivo(negocioId, origenId);
  }

  const metodoFinal = String(metodo || '').trim()
    || (cuentaOrigen.metodos_pago || [])[0]
    || (cuentaOrigen.tipo === 'efectivo' ? 'Efectivo' : cuentaOrigen.nombre);

  const cuentaTransito = await _asegurarCuentaTransito(negocioId, bodegaId);

  const confirmar = req.red.confirmar_remesa;
  const grupo = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const concepto = `Remesa a bodega (${metodoFinal})${notas ? ` — ${notas}` : ''}`;

    const salida = await tesoreriaRepo.insertarMovimiento(client, {
      cuenta_id: cuentaOrigen.id, tipo: 'salida', categoria: 'traslado',
      valor: monto, concepto, grupo_traslado: grupo,
      usuario_id: req.user.id, clave_idempotencia,
    });
    // El espejo en caja solo tiene sentido si el dinero salió de la caja
    // física. Una transferencia o un Nequi no pasan por ahí.
    const origenEsEfectivo = cuentaOrigen.tipo === 'efectivo'
      || (cuentaOrigen.metodos_pago || []).includes('Efectivo');
    if (origenEsEfectivo) {
      await _espejarCaja(client, origenId, salida, req.user.id, concepto);
    }

    let movTransito = null, movEntrada = null, cuentaDestino = null;

    if (confirmar) {
      // La plata queda en la cuenta de tránsito de la bodega hasta que la
      // confirmen. Nunca desaparece del total del negocio.
      movTransito = await tesoreriaRepo.insertarMovimiento(client, {
        cuenta_id: cuentaTransito.id, tipo: 'entrada', categoria: 'traslado',
        valor: monto, concepto, grupo_traslado: grupo, usuario_id: req.user.id,
      });
    } else {
      cuentaDestino = await _cuentaDestinoRemesa(negocioId, bodegaId, metodoFinal);
      movEntrada = await tesoreriaRepo.insertarMovimiento(client, {
        cuenta_id: cuentaDestino.id, tipo: 'entrada', categoria: 'traslado',
        valor: monto, concepto, grupo_traslado: grupo, usuario_id: req.user.id,
      });
      const destinoEsEfectivo = cuentaDestino.tipo === 'efectivo'
        || (cuentaDestino.metodos_pago || []).includes('Efectivo');
      if (destinoEsEfectivo) {
        await _espejarCaja(client, bodegaId, movEntrada, req.user.id, concepto);
      }
    }

    const remesa = await repo.crearRemesa(client, {
      negocio_id: negocioId,
      sucursal_origen_id: origenId, sucursal_destino_id: bodegaId,
      cuenta_origen_id: cuentaOrigen.id,
      cuenta_transito_id: confirmar ? cuentaTransito.id : null,
      cuenta_destino_id: cuentaDestino?.id || null,
      valor: monto, metodo: metodoFinal,
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

    // La remesa aterriza en la cuenta que maneje su método (Nequi → Nequi).
    const cuentaDestino = await _cuentaDestinoRemesa(negocioId, bodegaId, remesa.metodo);
    const grupo    = crypto.randomUUID();
    const concepto = `Remesa recibida de ${remesa.sucursal_origen_nombre}`
      + (remesa.metodo && remesa.metodo !== 'Efectivo' ? ` (${remesa.metodo})` : '');

    // Tránsito → efectivo de la bodega: dos patas, saldo total intacto.
    const salidaTransito = await tesoreriaRepo.insertarMovimiento(client, {
      cuenta_id: remesa.cuenta_transito_id, tipo: 'salida', categoria: 'traslado',
      valor: remesa.valor, concepto, grupo_traslado: grupo, usuario_id: req.user.id,
    });
    const entrada = await tesoreriaRepo.insertarMovimiento(client, {
      cuenta_id: cuentaDestino.id, tipo: 'entrada', categoria: 'traslado',
      valor: remesa.valor, concepto, grupo_traslado: grupo, usuario_id: req.user.id,
    });
    // Solo se espeja en caja si el dinero entra a la caja física.
    const destinoEsEfectivo = cuentaDestino.tipo === 'efectivo'
      || (cuentaDestino.metodos_pago || []).includes('Efectivo');
    if (destinoEsEfectivo) {
      await _espejarCaja(client, bodegaId, entrada, req.user.id, concepto);
    }

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
  const salida = { es_bodega: false, sucursal_id: sucursalId, ...estado,
                   por_recibir: porRecibir, remesas };
  return _puedeVerCostos(req) ? salida : _recortarParaVendedor(salida);
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

  const [remesasPorConfirmar, enTransito, devolucionesPorConfirmar] = await Promise.all([
    repo.findRemesas(negocioId, { sucursalId: bodegaId, rol: 'destino', estado: 'En transito', limit: 50 }),
    repo.findRemisiones(negocioId, { sucursalId: bodegaId, rol: 'origen', estado: 'En transito', limit: 50 }),
    // Mercancía que los locales están devolviendo y espera revisión de la bodega.
    repo.findRemisiones(negocioId, {
      sucursalId: bodegaId, rol: 'destino', estado: 'En transito', tipo: 'devolucion', limit: 50,
    }),
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
    devoluciones_por_confirmar: devolucionesPorConfirmar,
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

// Referencias duplicadas que YA existen en el catálogo. Solo señala; corregir
// (fusionar stock e historial) es decisión de una persona, no del sistema.
const getReferenciasDuplicadas = async (req) => {
  _exigirBodega(req);
  return repo.getReferenciasDuplicadas(req.user.negocio_id);
};

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO DE CUENTA de un local — todo lo que hay que saber en una sola llamada.
//
// Estructura de extracto bancario: saldo, movimientos con saldo corrido,
// mercancía rastreable unidad por unidad, y los documentos de respaldo.
// ─────────────────────────────────────────────────────────────────────────────
const getEstadoCuenta = async (req, sucursalId, filtros = {}) => {
  const negocioId = req.user.negocio_id;
  const objetivo  = Number(sucursalId || req.sucursal_id);

  // Un local solo ve lo suyo; la bodega ve cualquiera.
  if (!req.esBodega && objetivo !== Number(req.sucursal_id)) {
    throw { status: 403, message: 'Solo puedes ver el estado de cuenta de tu sucursal' };
  }
  const sucursal = await _verificarSucursal(null, objetivo, negocioId);

  const { desde = null, hasta = null, q = '', estado = null, limit = 100, offset = 0 } = filtros;

  const [totales, extracto, mercancia, remisiones, remesas, movimientos, porEnvio] =
    await Promise.all([
      getEstadoLocal(negocioId, objetivo),
      repo.getExtracto(negocioId, objetivo, { desde, hasta }),
      repo.buscarUnidades(negocioId, objetivo, {
        estado: estado || null, q, desde, hasta,
        limit: Math.min(Number(limit) || 100, 500),
        offset: Math.max(Number(offset) || 0, 0),
      }),
      repo.findRemisiones(negocioId, { sucursalId: objetivo, rol: 'destino', limit: 100 }),
      repo.findRemesas(negocioId,    { sucursalId: objetivo, rol: 'origen',  limit: 100 }),
      repo.findMovimientosCuenta(negocioId, objetivo, 100),
      repo.getResumenPorRemision(negocioId, objetivo, { limit: 100 }),
    ]);

  const salida = {
    sucursal: { id: sucursal.id, nombre: sucursal.nombre },
    ...totales,
    extracto: extracto.map((e) => ({
      ...e,
      valor: Number(e.valor),
      saldo: Number(e.saldo),
    })),
    mercancia: {
      ...mercancia,
      items: mercancia.items.map((u) => ({
        ...u,
        etiqueta_estado: ETIQUETAS_ESTADO[u.estado_unidad] || u.estado_unidad,
        valor_interno:   _num(u.valor_interno),
        liquidable:      _num(u.liquidable),
        destino:         _destinoUnidad(u),
        // Bandera, no error: puede ser que el local lo escriba distinto o que
        // el despacho se haya equivocado de referencia. Decide una persona.
        referencia_difiere: _referenciaDifiere(u.nombre_producto_bodega, u.nombre_producto_local),
      })),
    },
    // Conteo por estado, para pintar los filtros con su número.
    conteo_estados: Object.fromEntries(
      Object.entries(totales.por_estado).map(([k, v]) => [k, v.unidades])
    ),
    remisiones, remesas, movimientos_cuenta: movimientos,
    // Envío por envío: qué se vendió, qué se prestó y qué sigue disponible.
    ...(_armarEnvios(porEnvio, totales.totales)),
    // Por qué debe lo que debe, en una línea por concepto.
    desglose: _desgloseSaldo(totales.totales, remesas),
  };

  return _puedeVerCostos(req) ? salida : _recortarParaVendedor(salida);
};

// ─────────────────────────────────────────────────────────────────────────────
// ENVÍOS — la pregunta que el local hace de verdad:
// "de lo que me mandaron en este envío, ¿qué vendí, qué presté y qué me queda?"
//
// La deuda pendiente por envío la imputa el FIFO del repositorio. Lo que queda
// sin atribuir son los accesorios (su liquidación se ancla en el stock global,
// no en un envío concreto), así que se devuelven aparte como un residuo — nunca
// repartidos a ojo entre envíos.
//
// INVARIANTE: Σ deuda_pendiente + accesorios_pendiente = saldo_por_liquidar
// cuando el saldo es positivo (si es negativo el local pagó de más y no queda
// nada pendiente). Está verificado en las pruebas 11-envios-por-remision.
// ─────────────────────────────────────────────────────────────────────────────
const _armarEnvios = (filas, t) => {
  const envios = filas.map((e) => ({
    ...e,
    unidades:          Number(e.unidades),
    valor_recibido:    Math.round(_num(e.valor_recibido)),
    deuda_generada:    Math.round(_num(e.deuda_generada)),
    deuda_pendiente:   Math.round(_num(e.deuda_pendiente)),
    disponibles_valor: Math.round(_num(e.disponibles_valor)),
    vendidas_valor:    Math.round(_num(e.vendidas_valor)),
    prestadas_valor:   Math.round(_num(e.prestadas_valor)),
    sin_ubicar_valor:  Math.round(_num(e.sin_ubicar_valor)),
    accesorios_valor:  Math.round(_num(e.accesorios_valor)),
    valor_total:       _num(e.valor_total),
  }));

  const pendienteSerial = envios.reduce((s, e) => s + e.deuda_pendiente, 0);
  const saldo = _num(t.saldo_por_liquidar);

  return {
    envios,
    envios_resumen: {
      total: envios.length,
      // Deuda que no cuelga de ningún envío: accesorios (fungibles) y, si los
      // hubiera, redondeos. Se muestra como una línea aparte, no se reparte.
      accesorios_pendiente: Math.max(0, Math.round(saldo) - pendienteSerial),
      pendiente_en_envios:  pendienteSerial,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// DESGLOSE — por qué el local debe lo que debe, en lenguaje llano.
// Cada renglón suma o resta hasta llegar al saldo, para que nadie tenga que
// reconstruirlo mentalmente desde el extracto.
// ─────────────────────────────────────────────────────────────────────────────
const _desgloseSaldo = (t, remesas = []) => {
  const recibidas = remesas.filter((r) => r.estado === 'Recibida');
  const porMedio  = recibidas.reduce((acc, r) => {
    const m = r.metodo || 'Efectivo';
    acc[m] = (acc[m] || 0) + Number(r.valor || 0);
    return acc;
  }, {});
  const ultima = recibidas
    .slice()
    .sort((a, b) => new Date(b.fecha_recepcion) - new Date(a.fecha_recepcion))[0];

  const lineas = [
    {
      clave: 'vendido',
      etiqueta: 'Productos vendidos que aún no ha liquidado',
      valor: _num(t.liquidable_total),
      signo: '+',
    },
    {
      clave: 'remesas',
      etiqueta: `Remesas recibidas${recibidas.length ? ` (${recibidas.length})` : ''}`,
      valor: -_num(t.remesado_recibido),
      signo: '−',
      medios: porMedio,
      ultima_fecha: ultima?.fecha_recepcion || null,
    },
  ];
  if (_num(t.gastos_autorizados) > 0) {
    lineas.push({
      clave: 'gastos',
      etiqueta: 'Gastos que pagó por cuenta de la bodega',
      valor: -_num(t.gastos_autorizados), signo: '−',
    });
  }
  if (_num(t.ajustes) !== 0) {
    lineas.push({
      clave: 'ajustes',
      etiqueta: 'Ajustes y saldos a favor',
      valor: -_num(t.ajustes), signo: _num(t.ajustes) > 0 ? '−' : '+',
    });
  }

  return {
    lineas,
    saldo: _num(t.saldo_por_liquidar),
    // Lo que NO debe, dicho explícitamente: es la duda más común del local.
    no_debe: {
      etiqueta: 'Mercancía en vitrina — solo se liquida al venderla',
      unidades: t.en_consignacion_unidades,
      valor:    t.en_consignacion_valor,
    },
    en_transito: _num(t.remesas_en_transito),
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
  const negocioId = req.user.negocio_id;
  const remision = await repo.findRemisionById(negocioId, id);
  if (!remision) throw { status: 404, message: 'Remisión no encontrada' };
  const mias = [Number(remision.sucursal_origen_id), Number(remision.sucursal_destino_id)];
  if (!req.esBodega && !mias.includes(Number(req.sucursal_id))) {
    throw { status: 403, message: 'Esta remisión no es de tu sucursal' };
  }

  // Detalle enriquecido: código, cantidad, estado ACTUAL de cada línea y
  // cuánto de ese envío ya se convirtió en deuda del local.
  // La sucursal del LOCAL: en una entrega es el destino, en una devolución es
  // de donde salió. Es la que el motor de estados necesita para ubicar las
  // unidades de esta remisión.
  const sucursalUnidades = remision.tipo === 'devolucion'
    ? remision.sucursal_origen_id
    : remision.sucursal_destino_id;

  const [lineas, correcciones] = await Promise.all([
    repo.getLineasDetalladas(negocioId, id, sucursalUnidades),
    repo.getCorreccionesRemision(negocioId, id),
  ]);

  const resumen = lineas.reduce((acc, l) => {
    const unidades = l.tipo === 'cantidad' ? Number(l.cantidad_recibida ?? l.cantidad ?? 0) : 1;
    const valor    = _num(l.valor_interno) * unidades;
    if (l.estado_linea === 'Faltante') { acc.no_llego += valor; return acc; }
    acc.enviado += valor;
    acc.liquidable += _num(l.liquidable);
    if (l.estado_unidad === 'En consignacion') acc.en_vitrina += valor;
    return acc;
  }, { enviado: 0, liquidable: 0, en_vitrina: 0, no_llego: 0 });

  const salida = {
    ...remision,
    lineas: lineas.map((l) => ({
      ...l,
      etiqueta_estado: ETIQUETAS_ESTADO[l.estado_unidad] || l.estado_unidad || l.estado_linea,
      valor_interno: _num(l.valor_interno),
      liquidable:    _num(l.liquidable),
      subtotal: _num(l.valor_interno) *
        (l.tipo === 'cantidad' ? Number(l.cantidad_recibida ?? l.cantidad ?? 0) : 1),
      destino: _destinoUnidad(l),
      referencia_difiere: _referenciaDifiere(l.nombre_producto_bodega, l.nombre_producto_local),
    })),
    correcciones,
    resumen: {
      enviado:    Math.round(resumen.enviado),
      liquidable: Math.round(resumen.liquidable),
      en_vitrina: Math.round(resumen.en_vitrina),
      no_llego:   Math.round(resumen.no_llego),
    },
    // Con la remisión en tránsito el valor se edita directo; ya recibida, solo
    // por nota de corrección (nunca se reescribe la historia en silencio).
    puede_editar_valores: remision.estado === 'En transito' && req.esBodega,
    puede_corregir:       remision.estado !== 'En transito' && req.esBodega,
  };

  if (_puedeVerCostos(req)) return salida;
  return {
    ...salida,
    costos_ocultos: true,
    valor_total: null,
    resumen: null,
    correcciones: [],
    lineas: salida.lineas.map((l) => _sinValores(l, [...CLAVES_VALOR_UNIDAD, 'subtotal'])),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// CORREGIR EL VALOR DE UNA LÍNEA
//
// Dos caminos según dónde esté la remisión:
//   • EN TRÁNSITO — nada se movió: se edita el valor directamente.
//   • YA RECIBIDA — se registra una NOTA DE CORRECCIÓN con el valor anterior,
//     el nuevo, quién y por qué. El valor efectivo cambia (es lo que el local
//     debe liquidar) pero queda el rastro completo de que se corrigió.
// ─────────────────────────────────────────────────────────────────────────────
const corregirValorLinea = async (req, lineaId, { valor_nuevo, motivo }) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;
  const nuevo = Number(valor_nuevo);
  if (!Number.isFinite(nuevo) || nuevo < 0) {
    throw { status: 400, message: 'El valor no puede ser negativo' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      SELECT lr.*, r.estado AS remision_estado, r.negocio_id,
             r.sucursal_destino_id, r.sucursal_origen_id, r.tipo AS remision_tipo,
             r.numero AS remision_numero
      FROM lineas_remision lr
      JOIN remisiones r ON r.id = lr.remision_id
      WHERE lr.id = $1 AND r.negocio_id = $2
      FOR UPDATE OF lr
    `, [lineaId, negocioId]);
    if (!rows.length) throw { status: 404, message: 'Línea no encontrada' };
    const l = rows[0];

    if (l.remision_estado === 'Anulada') {
      throw { status: 409, message: 'La remisión está anulada' };
    }
    const anterior = _num(l.valor_interno);
    if (Math.abs(anterior - nuevo) < 0.01) {
      throw { status: 400, message: 'El valor es el mismo que ya tenía' };
    }

    // En tránsito: edición limpia, sin nota (nada se ha movido ni liquidado).
    if (l.remision_estado === 'En transito') {
      await client.query(
        `UPDATE lineas_remision SET valor_interno = $2 WHERE id = $1`, [lineaId, nuevo]
      );
      await repo.actualizarTotalRemision(client, l.remision_id);
      await client.query('COMMIT');
      return { linea_id: lineaId, valor_anterior: anterior, valor_nuevo: nuevo, con_nota: false };
    }

    // Ya recibida: se corrige Y queda la nota.
    if (!motivo?.trim()) {
      throw { status: 400, message: 'Explica el motivo de la corrección' };
    }
    const sucursalLocal = l.remision_tipo === 'devolucion'
      ? l.sucursal_origen_id
      : l.sucursal_destino_id;

    await client.query(`
      UPDATE lineas_remision
      SET valor_interno  = $2,
          valor_original = COALESCE(valor_original, $3)
      WHERE id = $1
    `, [lineaId, nuevo, anterior]);

    const nota = await repo.insertarCorreccion(client, {
      negocio_id: negocioId, sucursal_id: sucursalLocal, linea_id: lineaId,
      valor_anterior: anterior, valor_nuevo: nuevo, diferencia: nuevo - anterior,
      motivo: motivo.trim(), usuario_id: req.user.id,
    });
    await repo.actualizarTotalRemision(client, l.remision_id);

    await client.query('COMMIT');
    return {
      linea_id: lineaId, valor_anterior: anterior, valor_nuevo: nuevo,
      con_nota: true, correccion: nota,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

  // Se consultan LAS DOS pistas antes de decidir. Si se cortara en la primera,
  // un código de accesorio que coincide con el IMEI de un equipo ya vendido
  // devolvería "ese equipo ya fue vendido" y el accesorio nunca se encontraría.
  const [s, p] = await Promise.all([
    repo.buscarSerialDisponible(negocioId, sucursalId, q),
    repo.buscarCantidadPorCodigo(negocioId, sucursalId, q),
  ]);

  const serialUsable   = s && !s.vendido && !s.prestado && !s.ya_remisionado;
  const cantidadUsable = p && Number(p.stock) > 0;

  // Primero lo que SÍ se puede despachar.
  if (serialUsable)   return _formatoSerial(s);
  if (cantidadUsable) return _formatoCantidad(p);

  // Nada usable. Si el texto coincide con las dos cosas (un código de accesorio
  // y el IMEI de un equipo), se explican AMBAS: quedarse con una sola manda al
  // usuario a buscar un problema que no era el suyo.
  const motivos = [];
  if (s) {
    if (s.vendido)        motivos.push(`el equipo ${s.imei} ya fue vendido`);
    if (s.prestado)       motivos.push(`el equipo ${s.imei} está prestado`);
    if (s.ya_remisionado) motivos.push(`el equipo ${s.imei} ya está en una remisión activa`);
  }
  if (p) motivos.push(`"${p.nombre}" está sin stock en la bodega`);

  if (motivos.length) {
    const texto = motivos.length === 1
      ? motivos[0]
      : `${motivos.slice(0, -1).join(', ')} y ${motivos[motivos.length - 1]}`;
    throw { status: 409, message: `No se puede despachar: ${texto}.` };
  }

  throw { status: 404, message: `"${q}" no está en la bodega (ni como IMEI ni como código)` };
};

// ─────────────────────────────────────────────────────────────────────────────
// PREVISUALIZAR — a qué referencia del destino va cada producto.
//
// Deja ver, ANTES de despachar, cuáles se resuelven solos y cuáles necesitan
// que alguien decida. Es lo que evita que el sistema invente referencias
// duplicadas a espaldas del usuario.
// ─────────────────────────────────────────────────────────────────────────────
const previsualizarDestino = async (req, { sucursal_destino_id, lineas }) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;
  const destinoId = Number(sucursal_destino_id);
  if (!destinoId) throw { status: 400, message: 'Falta la sucursal destino' };
  if (destinoId === Number(req.sucursal_id)) {
    throw { status: 400, message: 'La bodega no puede despacharse a sí misma' };
  }
  await _verificarSucursal(null, destinoId, negocioId);
  if (!Array.isArray(lineas) || !lineas.length) {
    throw { status: 400, message: 'No hay productos para revisar' };
  }

  const client = await pool.connect();
  try {
    const salida = [];
    for (const l of lineas) {
      const tipo = l.tipo === 'serial' ? 'serial' : 'cantidad';
      // El id del producto de origen: para seriales viene del serial.
      let productoOrigenId = l.producto_id || null;
      if (tipo === 'serial' && l.serial_id) {
        const { rows } = await client.query(
          `SELECT producto_id FROM seriales WHERE id = $1`, [l.serial_id]
        );
        productoOrigenId = rows[0]?.producto_id || null;
      }
      if (!productoOrigenId) {
        salida.push({ ...l, nivel: 'nuevo', destino: null, seguro: false });
        continue;
      }

      const r = await referencias.resolver(client, {
        tipo, productoOrigenId, sucursalDestinoId: destinoId,
      });
      salida.push({
        tipo,
        serial_id:   l.serial_id   || null,
        producto_id: productoOrigenId,
        cantidad:    l.cantidad    || 1,
        nombre_origen: r.origen?.nombre || l.nombre || null,
        codigo_origen: r.origen?.codigo || null,
        nivel:       r.nivel,
        seguro:      referencias.esSeguro(r.nivel),
        destino:     r.destino || null,
        sugerencias: r.sugerencias || (r.destino ? [r.destino] : []),
      });
    }

    const dudosos = salida.filter((s) => !s.seguro).length;
    return {
      sucursal_destino_id: destinoId,
      items: salida,
      dudosos,
      // La UI solo interrumpe si hay algo que decidir.
      requiere_confirmacion: dudosos > 0,
    };
  } finally {
    client.release();
  }
};

// Catálogo de referencias de una sucursal, para que el usuario elija a mano
// cuando la cascada no está segura.
const catalogoReferencias = async (req, { sucursalId, tipo, q }) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;
  await _verificarSucursal(null, Number(sucursalId), negocioId);
  return repo.buscarReferencias(negocioId, Number(sucursalId), tipo === 'serial' ? 'serial' : 'cantidad', q || '');
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

  // El precio que el usuario puso en el carrito es un PRECIO DE VENTA, no un
  // costo: usarlo como valor de la remisión le cobraría de más al local. Se
  // devuelve aparte, como sugerencia, para que la pantalla lo ofrezca con un
  // toque si de verdad quiere despachar por ese valor.
  const sugerido = (it) => {
    const p = Number(it.precio_carrito ?? it.precio);
    return Number.isFinite(p) && p > 0 ? Math.round(p) : null;
  };

  for (const it of items) {
    if (it.tipo === 'serial' && it.serial_id) {
      const s = await repo.findSerialById(negocioId, sucursalId, Number(it.serial_id));
      if (!s)                   { descartados.push({ nombre: it.nombre || 'Equipo', motivo: 'no está en la bodega' }); continue; }
      if (s.vendido)            { descartados.push({ nombre: s.imei, motivo: 'ya fue vendido' }); continue; }
      if (s.prestado)           { descartados.push({ nombre: s.imei, motivo: 'está prestado' }); continue; }
      if (s.ya_remisionado)     { descartados.push({ nombre: s.imei, motivo: 'ya está en otra remisión' }); continue; }
      resueltos.push({ ..._formatoSerial(s), precio_carrito: sugerido(it) });

    } else if (it.tipo === 'cantidad' && it.producto_id) {
      const p = await repo.findCantidadById(negocioId, sucursalId, Number(it.producto_id));
      if (!p) { descartados.push({ nombre: it.nombre || 'Producto', motivo: 'no está en la bodega' }); continue; }
      const pedida = Math.max(1, Number(it.cantidad) || 1);
      if (Number(p.stock) <= 0) { descartados.push({ nombre: p.nombre, motivo: 'sin stock' }); continue; }
      // Se recorta al stock disponible en vez de fallar: el usuario ve cuánto
      // quedó y decide.
      resueltos.push({
        ..._formatoCantidad(p),
        cantidad: Math.min(pedida, Number(p.stock)),
        precio_carrito: sugerido(it),
      });

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

// ─────────────────────────────────────────────────────────────────────────────
// BASE DE COSTO PARA LAS TARIFAS PORCENTUALES (feature opt-in `tarifas_*`)
//
// En un LOCAL de la red, la tarifa no puede calcularse sobre `costo_compra`:
// ese es el costo de la BODEGA. El costo del local es el `valor_interno` de la
// remisión — lo que debe liquidar al vender.
//
// Los productos por cantidad ya lo tienen resuelto: al recibir la remisión,
// `recibir()` reescribe `productos_cantidad.costo_unitario` del destino con el
// costo promedio ponderado sobre `valor_interno`. Los seriales no, porque
// `moverSerial` solo cambia `producto_id` y `costo_compra` se conserva a
// propósito. Este helper cubre justamente ese hueco.
//
// Devuelve la lista SIN TOCAR (ni una clave nueva) cuando no aplica: negocio
// sin red, infraestructura ausente, o la sucursal es la propia bodega. En esos
// casos el frontend cae a `costo_compra`, que es lo correcto.
//
// Cuando sí aplica, cada serial recibe:
//   origen_red   → 'bodega' (consignada) | 'propio' (retoma, compra del local…)
//   costo_tarifa → valor_interno, o null si es propia
//
// Las unidades propias devuelven null a propósito: en un local no tienen un
// costo comparable con el de la mercancía consignada, así que no admiten
// tarifa y el vendedor debe poner el precio a mano.
// ─────────────────────────────────────────────────────────────────────────────
const anotarConsignacionSeriales = async (seriales, { negocioId, sucursalId }) => {
  if (!Array.isArray(seriales) || !seriales.length || !sucursalId) return seriales;

  const { getConfigRed } = require('../../middlewares/redInterna.middleware');

  let config;
  try {
    config = await getConfigRed(negocioId);
  } catch {
    return seriales;                       // config ilegible → comportamiento de siempre
  }
  if (!config.activa || !config.bodega_id) return seriales;
  if (Number(sucursalId) === Number(config.bodega_id)) return seriales;  // la bodega usa su costo

  let filas;
  try {
    filas = await repo.getValorConsignacionSeriales(
      negocioId, sucursalId, seriales.map((s) => Number(s.id)).filter(Number.isInteger)
    );
  } catch (err) {
    // La migración de la red va en try/catch y puede no haberse aplicado. Un
    // fallo aquí no puede tumbar el listado de inventario.
    console.warn('[red-interna] No se pudo resolver el valor de consignación:', err.message);
    return seriales;
  }

  const porSerial = new Map(filas.map((f) => [Number(f.serial_id), Number(f.valor_interno)]));

  return seriales.map((s) => {
    const valor = porSerial.get(Number(s.id));
    const esDeBodega = valor !== undefined && valor > 0;
    return {
      ...s,
      origen_red:   esDeBodega ? 'bodega' : 'propio',
      costo_tarifa: esDeBodega ? valor : null,
    };
  });
};

module.exports = {
  anotarConsignacionSeriales,
  despachar, recibir, anularRemision,
  devolver, previsualizarDevolucion, confirmarDevolucion,
  enviarRemesa, confirmarRemesa, anularRemesa,
  registrarGastoAutorizado, registrarAjuste,
  getPanelLocal, getPanelBodega, getConciliacion, getEstadoCuenta, getSalud,
  // Lo usa el Dashboard para mostrarle la deuda al local sin duplicar la
  // fórmula del saldo (ver _armarSaldo).
  getEstadoLocal,
  getReferenciasDuplicadas,
  getRemision, corregirValorLinea, listarRemisiones, listarRemesas,
  getCuentasParaRemesa,
  buscarParaDespacho, catalogoCantidad, resolverItems,
  previsualizarDestino, catalogoReferencias,
  getSucursalesRed, getContexto, getMovimientosCuenta,
  ETIQUETAS_ESTADO,
};
