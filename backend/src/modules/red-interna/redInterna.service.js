const crypto = require('crypto');
const { pool } = require('../../config/db');
const repo          = require('./redInterna.repository');
const referencias   = require('./redInterna.referencias');
const trasladosRepo = require('../traslados/traslados.repository');
const variantesRepo = require('../variantes-producto/variantes-producto.repository');
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

// Pesos con separador de miles, para el texto de los avisos push.
const _dinero = (v) => '$' + Math.round(_num(v)).toLocaleString('es-CO');

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

// Lo monetario del resumen por envío que NO puede ver un vendedor.
//
// `cargo`, `abonado` y `saldo` NO están aquí: desde el cambio de modelo son la
// deuda de ese envío, o sea la plata que el vendedor tiene que entregar. Sin
// verlos no podría pagar. Lo que sigue oculto es la valorización de la
// mercancía por estado —de ahí se deduce el costo unidad por unidad— y el
// valor de cada línea.
const CLAVES_VALOR_ENVIO = [
  'valor_total', 'valor_recibido',
  'disponibles_valor', 'vendidas_valor', 'prestadas_valor', 'sin_ubicar_valor',
  'accesorios_valor',
];

/**
 * Recorta un estado de cuenta / panel para un vendedor.
 *
 * QUÉ SOBREVIVE: unidades, estados, fechas, documentos y todo lo que sea DEUDA
 *   (la del local y la de cada envío). Es su trabajo: recibir mercancía y
 *   entregar plata, y no puede hacerlo a ciegas.
 * QUÉ SE BORRA: el costo de cada equipo y la valorización de la mercancía por
 *   estado, que es de donde se deduce el costo unidad por unidad.
 *
 * El recorte va en el BACKEND. Si solo se escondiera en la pantalla el dato
 * viajaría igual y se vería en la consola del navegador — por eso cada campo
 * monetario nuevo hay que decidirlo aquí, no allá.
 */
const _recortarParaVendedor = (data) => {
  const t = data.totales || {};
  const totales = {
      // La deuda y lo que hay que pagar sobreviven: ya no son "la suma de los
      // costos de la mercancía" sino la obligación del local, que el vendedor
      // necesita conocer para entregar el dinero.
      deuda_total:         t.deuda_total,
      saldo_a_favor:       t.saldo_a_favor,
      saldo_por_liquidar:  t.saldo_por_liquidar,
      neto:                t.neto,
      cargo_total:         t.cargo_total,
      abonado_total:       t.abonado_total,
      cargos_sueltos:      t.cargos_sueltos,
      envios_abiertos:     t.envios_abiertos,
      envios_total:        t.envios_total,
      remesado_recibido:   t.remesado_recibido,
      remesas_en_transito: t.remesas_en_transito,
      gastos_autorizados:  t.gastos_autorizados,
      ajustes:             t.ajustes,
      en_consignacion_unidades: t.en_consignacion_unidades,
      en_recaudo_unidades:      t.en_recaudo_unidades,
      sin_ubicar_unidades:      t.sin_ubicar_unidades,
      vendido_unidades:         t.vendido_unidades,
      // Valorización de la mercancía por estado: fuera.
      vendido_valor:         null,
      en_vitrina_valor:      null,
      prestado_valor:        null,
      valor_en_poder:        null,
      liquidable_total:      null,
      en_consignacion_valor: null,
      en_recaudo_valor:      null,
      sin_ubicar_valor:      null,
  };

  return {
    ...data,
    costos_ocultos: true,
    totales,
    por_estado: Object.fromEntries(
      Object.entries(data.por_estado || {}).map(([k, v]) => [
        k, { ...v, valor_interno: null, liquidable: null },
      ])
    ),
    cantidad_consignada: undefined,
    extracto: (data.extracto || []).map((e) => ({
      ...e,
      // Los cargos y abonos son la cuenta: se ven. Lo informativo (una venta)
      // lleva el valor de la mercancía, y ese no.
      valor: e.clase === 'info' ? 0 : e.valor,
      saldo: e.saldo,
    })),
    mercancia: data.mercancia && {
      ...data.mercancia,
      valor_total: null, liquidable_total: null,
      items: data.mercancia.items.map((u) => _sinValores(u, CLAVES_VALOR_UNIDAD)),
    },
    remisiones: (data.remisiones || []).map((r) => ({ ...r, valor_total: null })),
    // El cargo es deuda: su valor y su saldo se ven (hay que pagarlos). No hay
    // valorización de mercancía que esconder aquí.
    cargos: data.cargos,
    envios: (data.envios || []).map((e) => ({
      ..._sinValores(e, CLAVES_VALOR_ENVIO),
      // Las líneas del envío llevan el costo de cada equipo: se ven los
      // productos y su estado, nunca su valor.
      lineas: (e.lineas || []).map((l) => _sinValores(l, ['valor_interno', 'subtotal'])),
    })),
    // El desglose se recalcula sobre los totales YA RECORTADOS. Antes se
    // colaba entero, con los mismos valores que este recorte acaba de poner en
    // null: bastaba abrir la pestaña de red del navegador para leerlos.
    // Por eso se le pasa `totales` y no `t`.
    desglose: data.desglose && _desgloseSaldo(totales, data.remesas || []),
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

// ─────────────────────────────────────────────────────────────────────────────
// EL NODO QUE SE MUEVE — LEER ANTES DE TOCAR EL STOCK DE CANTIDAD
//
// Con la feature "Variantes" activa, el stock de un producto NO vive en
// `productos_cantidad.stock`: vive en sus `atributos_producto` (talla, color) y,
// un nivel más abajo, en `variantes_atributo`. `productos_cantidad.stock` pasa a
// ser un DERIVADO — la suma de sus hijos, que `sincronizarStockProducto`
// recalcula cada vez que alguien toca una variante.
//
// La red interna se escribió antes de esa feature y movía el stock en el nivel
// del producto. En un catálogo por variantes eso dejaba el inventario
// descuadrado en las dos sedes y, peor, el primer ajuste sobre cualquier
// variante recalculaba el producto y BORRABA lo recibido, mientras el local
// seguía debiendo la mercancía.
//
// Regla: el stock se mueve SIEMPRE en la hoja (variante > atributo > producto)
// y el producto se recalcula después. Si el producto tiene variantes activas,
// la línea está OBLIGADA a decir cuál — antes se aceptaba en silencio y de ahí
// salía el descuadre.
// ─────────────────────────────────────────────────────────────────────────────

const _etiquetaNodo = (nombre, atributoValor, varianteValor) =>
  [nombre, atributoValor, varianteValor].filter(Boolean).join(' / ');

/**
 * Valida el nodo que la línea quiere mover en el ORIGEN y devuelve su stock,
 * su costo (resuelto con COALESCE hacia arriba, como hace la pantalla del
 * árbol) y su etiqueta.
 */
const _resolverNodoOrigen = async (client, { productoId, atributoId, varianteId, sucursalId }) => {
  const { rows: prod } = await client.query(
    `SELECT id, nombre, stock, COALESCE(costo_unitario, 0) AS costo_unitario
     FROM productos_cantidad
     WHERE id = $1 AND sucursal_id = $2 AND activo = true
     FOR UPDATE`,
    [productoId, sucursalId]
  );
  if (!prod.length) throw { status: 404, message: 'Producto no encontrado en la bodega' };
  const p = prod[0];

  const { rows: hijos } = await client.query(
    `SELECT count(*)::int AS n FROM atributos_producto
     WHERE producto_id = $1 AND sucursal_id = $2 AND activo = true`,
    [productoId, sucursalId]
  );
  const tieneVariantes = hijos[0].n > 0;

  if (varianteId) {
    const { rows } = await client.query(
      `SELECT v.id, v.valor, v.stock,
              COALESCE(v.costo_unitario, ap.costo_unitario, pc.costo_unitario, 0) AS costo,
              ap.id AS atributo_id, ap.valor AS atributo_valor
       FROM variantes_atributo v
       JOIN atributos_producto ap ON ap.id = v.atributo_id
       JOIN productos_cantidad pc ON pc.id = ap.producto_id
       WHERE v.id = $1 AND ap.producto_id = $2 AND ap.sucursal_id = $3
         AND v.activo = true AND ap.activo = true
       FOR UPDATE OF v`,
      [varianteId, productoId, sucursalId]
    );
    if (!rows.length) throw { status: 404, message: 'La variante no existe en este producto' };
    const v = rows[0];
    return {
      productoId, atributoId: v.atributo_id, varianteId: v.id,
      nombreProducto: p.nombre, atributoValor: v.atributo_valor, varianteValor: v.valor,
      stock: Number(v.stock), costo: Number(v.costo),
      etiqueta: _etiquetaNodo(p.nombre, v.atributo_valor, v.valor),
    };
  }

  if (atributoId) {
    const { rows } = await client.query(
      `SELECT ap.id, ap.valor, ap.stock,
              COALESCE(ap.costo_unitario, pc.costo_unitario, 0) AS costo,
              (SELECT count(*)::int FROM variantes_atributo v
               WHERE v.atributo_id = ap.id AND v.activo = true) AS n_variantes
       FROM atributos_producto ap
       JOIN productos_cantidad pc ON pc.id = ap.producto_id
       WHERE ap.id = $1 AND ap.producto_id = $2 AND ap.sucursal_id = $3 AND ap.activo = true
       FOR UPDATE OF ap`,
      [atributoId, productoId, sucursalId]
    );
    if (!rows.length) throw { status: 404, message: 'La variante no existe en este producto' };
    const a = rows[0];
    if (a.n_variantes > 0) {
      throw {
        status: 400,
        message: `"${_etiquetaNodo(p.nombre, a.valor)}" tiene sub-variantes: elige cuál vas a despachar`,
      };
    }
    return {
      productoId, atributoId: a.id, varianteId: null,
      nombreProducto: p.nombre, atributoValor: a.valor, varianteValor: null,
      stock: Number(a.stock), costo: Number(a.costo),
      etiqueta: _etiquetaNodo(p.nombre, a.valor),
    };
  }

  // Sin nodo: solo vale si el producto de verdad no tiene variantes.
  if (tieneVariantes) {
    throw {
      status: 400,
      message: `"${p.nombre}" se maneja por variantes: elige cuál vas a despachar`,
      codigo: 'VARIANTE_REQUERIDA',
    };
  }
  return {
    productoId, atributoId: null, varianteId: null,
    nombreProducto: p.nombre, atributoValor: null, varianteValor: null,
    stock: Number(p.stock), costo: Number(p.costo_unitario),
    etiqueta: p.nombre,
  };
};

/**
 * Encuentra —o crea— el mismo nodo bajo el producto del DESTINO. La identidad
 * entre sedes es el VALOR (el texto "38MM"), nunca el id: cada sucursal tiene
 * los suyos. Se crea con stock 0 y sin costo; el costo lo pone la recepción con
 * el valor interno, que es lo que el local debe.
 */
const _resolverNodoDestino = async (client, { productoDestinoId, sucursalDestinoId, atributoValor, varianteValor }) => {
  if (!atributoValor) return { atributoId: null, varianteId: null };

  const { rows: ex } = await client.query(
    `SELECT id FROM atributos_producto
     WHERE producto_id = $1 AND sucursal_id = $2 AND LOWER(valor) = LOWER($3) AND activo = true
     ORDER BY id LIMIT 1`,
    [productoDestinoId, sucursalDestinoId, atributoValor]
  );
  let atributoId = ex[0]?.id;
  if (!atributoId) {
    const { rows } = await client.query(
      `INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, stock_minimo)
       VALUES ($1, $2, $3, 0, 0) RETURNING id`,
      [productoDestinoId, sucursalDestinoId, String(atributoValor).trim()]
    );
    atributoId = rows[0].id;
  }

  if (!varianteValor) return { atributoId, varianteId: null };

  const { rows: exv } = await client.query(
    `SELECT id FROM variantes_atributo
     WHERE atributo_id = $1 AND LOWER(valor) = LOWER($2) AND activo = true
     ORDER BY id LIMIT 1`,
    [atributoId, varianteValor]
  );
  let varianteId = exv[0]?.id;
  if (!varianteId) {
    const { rows } = await client.query(
      `INSERT INTO variantes_atributo (atributo_id, valor, stock, stock_minimo)
       VALUES ($1, $2, 0, 0) RETURNING id`,
      [atributoId, String(varianteValor).trim()]
    );
    varianteId = rows[0].id;
  }
  return { atributoId, varianteId };
};

/** Mueve stock en la HOJA correcta y deja el producto recalculado. */
const _moverStockNodo = async (client, { productoId, atributoId, varianteId }, delta) => {
  if (varianteId) {
    await client.query('UPDATE variantes_atributo SET stock = stock + $1 WHERE id = $2', [delta, varianteId]);
  } else if (atributoId) {
    await client.query('UPDATE atributos_producto SET stock = stock + $1 WHERE id = $2', [delta, atributoId]);
  } else {
    await trasladosRepo.ajustarStockEnTransaccion(client, productoId, delta);
    return;
  }
  await variantesRepo.sincronizarStockProductoEnTx(client, productoId);
};

/** Escribe el costo del valor interno en la hoja, y lo refleja en el padre. */
const _fijarCostoNodo = async (client, { productoId, atributoId, varianteId }, costo) => {
  if (varianteId) {
    await client.query('UPDATE variantes_atributo SET costo_unitario = $1 WHERE id = $2', [costo, varianteId]);
  } else if (atributoId) {
    await client.query('UPDATE atributos_producto SET costo_unitario = $1 WHERE id = $2', [costo, atributoId]);
  }
  // El producto refleja el último costo conocido, igual que hace el módulo de
  // variantes: sirve de base cuando alguien mira el producto sin abrir el árbol.
  await client.query('UPDATE productos_cantidad SET costo_unitario = $1 WHERE id = $2', [costo, productoId]);
};

/** Stock actual de la hoja, para el costo promedio ponderado del destino. */
const _stockYCostoNodo = async (client, { productoId, atributoId, varianteId }) => {
  if (varianteId) {
    const { rows } = await client.query(
      `SELECT stock, COALESCE(costo_unitario, 0) AS costo FROM variantes_atributo WHERE id = $1 FOR UPDATE`,
      [varianteId]);
    return { stock: Number(rows[0]?.stock ?? 0), costo: Number(rows[0]?.costo ?? 0) };
  }
  if (atributoId) {
    const { rows } = await client.query(
      `SELECT stock, COALESCE(costo_unitario, 0) AS costo FROM atributos_producto WHERE id = $1 FOR UPDATE`,
      [atributoId]);
    return { stock: Number(rows[0]?.stock ?? 0), costo: Number(rows[0]?.costo ?? 0) };
  }
  const { rows } = await client.query(
    `SELECT stock, COALESCE(costo_unitario, 0) AS costo FROM productos_cantidad WHERE id = $1 FOR UPDATE`,
    [productoId]);
  return { stock: Number(rows[0]?.stock ?? 0), costo: Number(rows[0]?.costo ?? 0) };
};

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

const despachar = async (req, {
  sucursal_destino_id, lineas, notas, clave_idempotencia, permitir_valor_cero,
}) => {
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

  // Los productos que terminen valiendo $0 se recogen dentro del bucle y se
  // revisan al final: hay que mirar el valor RESUELTO, no el que llegó del
  // navegador. El caso peligroso es justamente el que no manda valor — un
  // equipo sin costo registrado, que sale en 0 sin que nadie lo escriba.
  const enCero = [];

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
        const valorSerial = _valorLinea(s.costo_compra, l.valor_interno);
        if (valorSerial === 0) enCero.push(s.imei || s.nombre);
        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'serial',
          serial_id: s.id, imei: s.imei,
          producto_origen_id: s.producto_id,
          producto_destino_id: destinoSerial,
          valor_interno: valorSerial,
          estado_linea: 'Pendiente',
          nombre_producto: [s.nombre, s.marca, s.modelo].filter(Boolean).join(' '),
        });

      } else if (l.tipo === 'cantidad') {
        const cant = Number(l.cantidad);
        if (!cant || cant < 1) throw { status: 400, message: 'Cantidad inválida' };

        // El stock y el costo salen del NODO, no del producto: con variantes
        // activas `productos_cantidad.stock` es un derivado y descontarlo ahí
        // deja el inventario descuadrado contra sus propias variantes.
        const nodo = await _resolverNodoOrigen(client, {
          productoId: l.producto_id, atributoId: l.atributo_id,
          varianteId: l.variante_id, sucursalId: origenId,
        });
        if (nodo.stock < cant) {
          throw { status: 400, message: `Stock insuficiente de "${nodo.etiqueta}". Hay ${nodo.stock}, pides ${cant}` };
        }

        const destinoCantidad = await _destinoElegido(client, {
          tipo: 'cantidad', productoOrigenId: nodo.productoId,
          sucursalDestinoId: destinoId, eleccionUsuario: l.producto_destino_id,
        });

        const valorCantidad = _valorLinea(nodo.costo, l.valor_interno);
        if (valorCantidad === 0) enCero.push(nodo.etiqueta);
        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'cantidad',
          producto_origen_id: nodo.productoId, cantidad: cant,
          producto_destino_id: destinoCantidad,
          atributo_origen_id: nodo.atributoId,
          variante_origen_id: nodo.varianteId,
          valor_interno: valorCantidad,
          estado_linea: 'Pendiente',
          // Con la variante en el nombre: es lo que ve quien recibe y quien
          // revisa el envío, y sin ella dos líneas del mismo producto en tallas
          // distintas se ven idénticas.
          nombre_producto: nodo.etiqueta,
        });
      } else {
        throw { status: 400, message: `Tipo de línea inválido: ${l.tipo}` };
      }
    }

    // ── Nada sale en $0 por descuido ──────────────────────────────────────
    // El valor de la línea ES lo que el local va a deber por ese producto. Un 0
    // le regala la mercancía y deja el envío cobrando de menos para siempre:
    // corregirlo después exige una nota de corrección. Se puede hacer a
    // propósito (una muestra, un obsequio), pero hay que decirlo — por eso la
    // pantalla pide confirmar en vez de dejarlo pasar en silencio.
    // El ROLLBACK del catch deshace las líneas que ya se insertaron.
    if (enCero.length && !permitir_valor_cero) {
      throw {
        status: 400,
        message: `${enCero.length} producto(s) saldrían en $0 (${enCero.slice(0, 3).join(', ')}`
          + `${enCero.length > 3 ? '…' : ''}). Escribe su valor o confirma que los entregas sin cobro.`,
        codigo: 'VALOR_CERO',
        productos: enCero,
      };
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

    // El local se entera de que viene mercancía sin tener que estar mirando.
    _avisar({
      negocioId, sucursalId: destinoId,
      titulo: `Envío #${final.numero ?? final.id} en camino`,
      cuerpo: `${lineas.length} producto(s) por ${_dinero(final.valor_total)}`,
    });

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

      // El nodo que salió de la bodega. La línea lo guardó al despachar; una
      // línea vieja (sin nodo) sigue significando "el producto entero".
      const nodoOrigen = await _resolverNodoOrigen(client, {
        productoId: l.producto_origen_id, atributoId: l.atributo_origen_id,
        varianteId: l.variante_origen_id, sucursalId: origenId,
      });
      if (nodoOrigen.stock < recibida) {
        throw { status: 409, message: `Stock insuficiente de "${nodoOrigen.etiqueta}" en la bodega (hay ${nodoOrigen.stock})` };
      }

      const productoDestinoId = await _resolverProductoCantidadDestino(
        client, l.producto_origen_id, destinoId, negocioId, l.producto_destino_id
      );
      // El mismo nodo bajo el producto del destino; se crea si no existía.
      const nodoDestino = {
        productoId: productoDestinoId,
        ...(await _resolverNodoDestino(client, {
          productoDestinoId, sucursalDestinoId: destinoId,
          atributoValor: nodoOrigen.atributoValor, varianteValor: nodoOrigen.varianteValor,
        })),
      };

      // Costo promedio ponderado EN EL NODO del destino. El flujo viejo de
      // traslados no lo hace y desvía el costo; aquí importa doble, porque de
      // ese costo salen la utilidad que reporta el local y la base de su tarifa.
      const previo = await _stockYCostoNodo(client, nodoDestino);
      const nuevoCosto = calcularCostoPromedio(
        previo.stock, previo.costo, recibida, _num(l.valor_interno)
      );

      await _moverStockNodo(client, nodoOrigen, -recibida);
      await _moverStockNodo(client, nodoDestino,  recibida);
      await _fijarCostoNodo(client, nodoDestino, nuevoCosto);

      await client.query(
        `UPDATE lineas_remision
         SET atributo_destino_id = $2, variante_destino_id = $3
         WHERE id = $1`,
        [id, nodoDestino.atributoId, nodoDestino.varianteId]
      );

      await trasladosRepo.insertarHistorialEnTransaccion(client, {
        producto_id: l.producto_origen_id, sucursal_id: origenId,
        atributo_id: nodoOrigen.atributoId, variante_id: nodoOrigen.varianteId,
        cantidad: -recibida, costo_unitario: _num(l.valor_interno),
        notas: `Remisión #${remision.numero ?? remision.id} → ${destinoId}`,
      });
      await trasladosRepo.insertarHistorialEnTransaccion(client, {
        producto_id: productoDestinoId, sucursal_id: destinoId,
        atributo_id: nodoDestino.atributoId, variante_id: nodoDestino.varianteId,
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

  // El envío acaba de nacer con saldo. Si el local traía crédito a favor (pagó
  // de más antes, o devolvió algo que ya había pagado) se le aplica aquí
  // mismo: es lo que el cliente pidió, "que se descuente del siguiente envío".
  // Va dentro de esta transacción para que dos recepciones al tiempo no se
  // repartan el mismo crédito.
  const favor = await _aplicarSaldoAFavor(client, {
    negocioId,
    sucursalId: Number(remision.sucursal_destino_id),
    usuarioId,
  });

  return {
    traslado_id: traslado.id, recibidas: hubo, faltantes: idsFaltante.length,
    saldo_favor_aplicado: favor.aplicado,
  };
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
    const recibida = { ...(await repo.findRemisionById(negocioId, remisionId)), ...res };

    // Recibir GENERA LA DEUDA desde el cambio de modelo, y lo puede hacer un
    // vendedor. Que la deuda nazca en silencio sería el peor de los descuidos:
    // se avisa al supervisor del local y a la bodega, con el valor.
    _avisar({
      negocioId, sucursalId: Number(remision.sucursal_destino_id),
      roles: ['admin_negocio', 'supervisor'],
      titulo: `Envío #${recibida.numero ?? remisionId} recibido`,
      cuerpo: `${res.recibidas} producto(s) por ${_dinero(recibida.valor_total)}`
        + (res.faltantes ? ` · ${res.faltantes} reportados como no llegados` : ''),
    });
    _avisar({
      negocioId, sucursalId: Number(remision.sucursal_origen_id),
      titulo: `${remision.sucursal_destino_nombre || 'El local'} recibió el envío #${recibida.numero ?? remisionId}`,
      cuerpo: res.faltantes
        ? `${res.faltantes} producto(s) no llegaron`
        : `${res.recibidas} producto(s) por ${_dinero(recibida.valor_total)}`,
    });

    return recibida;
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

/**
 * ¿Este accesorio vino de la bodega?
 *
 * Un accesorio es fungible: no hay forma de saber si ESTA unidad concreta salió
 * de un envío. Pero sí se sabe cuántas le mandó la bodega y cuántas devolvió, y
 * mientras queden pendientes lo razonable es asumir que sí — es lo que pasa
 * casi siempre, y ahora la respuesta mueve plata: desde el cambio de modelo un
 * accesorio de bodega devuelto tiene que generarle crédito al local, o
 * devolvería 20 vidrios y los seguiría debiendo.
 *
 * Devuelve el valor con el que se los cargaron (promedio ponderado de los
 * envíos), no el costo del local: es lo que hay que acreditarle.
 */
const _origenUnidadCantidad = async (client, productoLocalId, sucursalId, negocioId) => {
  const { rows } = await client.query(`
    SELECT
      COALESCE(SUM(COALESCE(lr.cantidad_recibida, 0)), 0)::int AS entregado,
      CASE WHEN SUM(COALESCE(lr.cantidad_recibida, 0)) > 0
        THEN SUM(lr.valor_interno * COALESCE(lr.cantidad_recibida, 0))
             / SUM(COALESCE(lr.cantidad_recibida, 0))
        ELSE 0 END AS valor_unitario
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE r.negocio_id = $1 AND r.sucursal_destino_id = $2
      AND r.tipo = 'entrega' AND r.estado <> 'Anulada'
      AND lr.tipo = 'cantidad' AND lr.estado_linea = 'Recibida'
      AND lr.producto_destino_id = $3
  `, [negocioId, sucursalId, productoLocalId]);
  const { rows: dev } = await client.query(`
    SELECT COALESCE(SUM(COALESCE(lr.cantidad_recibida, lr.cantidad, 0)), 0)::int AS devuelto
    FROM lineas_remision lr
    JOIN remisiones r ON r.id = lr.remision_id
    WHERE r.negocio_id = $1 AND r.sucursal_origen_id = $2
      AND r.tipo = 'devolucion' AND r.estado <> 'Anulada'
      AND lr.tipo = 'cantidad' AND lr.producto_origen_id = $3
  `, [negocioId, sucursalId, productoLocalId]);

  const pendiente = Number(rows[0].entregado) - Number(dev[0].devuelto);
  return {
    de_bodega: pendiente > 0,
    pendiente: Math.max(0, pendiente),
    valor_unitario: _num(rows[0].valor_unitario),
  };
};

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
        // Se devuelve el NODO que el carrito trae (una talla), no el producto:
        // el stock que se puede devolver es el de esa talla.
        let nodo;
        try {
          nodo = await _resolverNodoOrigen(client, {
            productoId: l.producto_id, atributoId: l.atributo_id,
            varianteId: l.variante_id, sucursalId: origenId,
          });
        } catch (e) {
          items.push({ ...l, error: e.message || 'No está en este local' });
          continue;
        }
        // Fungible: no se sabe si ESTA unidad vino de bodega, pero sí si quedan
        // unidades pendientes de las que la bodega mandó. Con eso se propone un
        // origen; el usuario puede cambiarlo. El valor que se ofrece es el de
        // la remisión (lo que le cobraron), no el costo del local.
        const cant = await _origenUnidadCantidad(client, nodo.productoId, origenId, negocioId);
        items.push({
          tipo: 'cantidad', producto_id: nodo.productoId,
          atributo_id: nodo.atributoId, variante_id: nodo.varianteId,
          nombre: nodo.etiqueta, codigo: null,
          cantidad: Math.min(Number(l.cantidad) || 1, nodo.stock),
          stock: nodo.stock,
          origen: cant.de_bodega ? 'bodega' : 'propio',
          pendiente_de_bodega: cant.pendiente,
          valor_interno: cant.de_bodega ? cant.valor_unitario : nodo.costo,
          bloqueado: nodo.stock <= 0 ? 'Sin stock' : null,
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
const devolver = async (req, { lineas, notas, clave_idempotencia, motivo }) => {
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
      // 'faltante' = nunca llegó (el local tocó "Recibí todo" de más). Hace lo
      // mismo con la cuenta y con el inventario que una devolución, pero
      // contarlo bien importa: un faltante es un problema de despacho.
      motivo: motivo === 'faltante' ? 'faltante' : 'devolucion',
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
        // Se devuelve un NODO, igual que se despachó uno: con variantes activas
        // el local tiene que decir qué talla está devolviendo.
        const nodo = await _resolverNodoOrigen(client, {
          productoId: l.producto_id, atributoId: l.atributo_id,
          varianteId: l.variante_id, sucursalId: origenId,
        });
        if (nodo.stock < cant) {
          throw { status: 400, message: `Stock insuficiente de "${nodo.etiqueta}". Hay ${nodo.stock}` };
        }
        const rows = [{ id: nodo.productoId, nombre: nodo.etiqueta, costo_unitario: nodo.costo }];

        // Si el usuario no dice de dónde viene, se resuelve con lo que la
        // bodega le mandó y todavía no le ha devuelto. Antes el default era
        // 'propio' a secas, y con el modelo nuevo eso significaba devolver
        // mercancía de bodega sin que le bajara la deuda.
        const cantOrigen = await _origenUnidadCantidad(client, l.producto_id, origenId, negocioId);
        const origenUnidad = l.origen_unidad
          ? (l.origen_unidad === 'bodega' ? 'bodega' : 'propio')
          : (cantOrigen.de_bodega ? 'bodega' : 'propio');
        // Lo que la bodega le cobró, no lo que al local le costó: es lo que hay
        // que acreditarle al recibirlo de vuelta.
        const base = origenUnidad === 'bodega' && cantOrigen.valor_unitario > 0
          ? cantOrigen.valor_unitario
          : rows[0].costo_unitario;

        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'cantidad',
          producto_origen_id: nodo.productoId, cantidad: cant,
          atributo_origen_id: nodo.atributoId,
          variante_origen_id: nodo.varianteId,
          valor_interno: _valorLinea(base, l.valor_interno),
          estado_linea: 'Pendiente',
          origen_unidad: origenUnidad,
          genera_saldo_favor: l.genera_saldo_favor === true,
          nombre_producto: nodo.etiqueta,
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
    // Un reclamo por faltante y una devolución hacen LO MISMO con la cuenta y
    // con el inventario: la línea de entrega queda 'Devuelta' y su envío deja
    // de cobrarla.
    //
    // Y la línea queda 'Devuelta' en los dos casos a propósito. 'Faltante'
    // significa otra cosa —NUNCA entró al cargo, porque el local lo rechazó al
    // recibir— y usarlo aquí encogía hacia atrás el cargo original del envío
    // además de generar la nota de crédito: la baja se contaba dos veces y el
    // extracto dejaba de cuadrar con la deuda.
    //
    // El "nunca llegó" no se pierde: vive en `remisiones.motivo`, que es de
    // donde lo leen la pantalla y el historial.
    const esFaltante = remision.motivo === 'faltante';

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
        // La mercancía vuelve desde el mismo NODO del que salió (la línea de la
        // devolución lo guardó al crearse), no desde el producto entero.
        const nodoOrigen = await _resolverNodoOrigen(client, {
          productoId: l.producto_origen_id, atributoId: l.atributo_origen_id,
          varianteId: l.variante_origen_id, sucursalId: localId,
        });
        if (nodoOrigen.stock < cant) {
          throw { status: 409, message: `Stock insuficiente de "${nodoOrigen.etiqueta}" en el local (hay ${nodoOrigen.stock})` };
        }
        const productoDestinoId = await _resolverProductoCantidadDestino(
          client, l.producto_origen_id, bodegaId, negocioId
        );
        const nodoDestino = {
          productoId: productoDestinoId,
          ...(await _resolverNodoDestino(client, {
            productoDestinoId, sucursalDestinoId: bodegaId,
            atributoValor: nodoOrigen.atributoValor, varianteValor: nodoOrigen.varianteValor,
          })),
        };

        // Costo promedio ponderado en la bodega al recibir de vuelta.
        const previo = await _stockYCostoNodo(client, nodoDestino);
        const nuevoCosto = calcularCostoPromedio(
          previo.stock, previo.costo, cant, _num(l.valor_interno)
        );

        await _moverStockNodo(client, nodoOrigen, -cant);
        await _moverStockNodo(client, nodoDestino,  cant);
        await _fijarCostoNodo(client, nodoDestino, nuevoCosto);

        await trasladosRepo.insertarHistorialEnTransaccion(client, {
          producto_id: l.producto_origen_id, sucursal_id: localId,
          atributo_id: nodoOrigen.atributoId, variante_id: nodoOrigen.varianteId,
          cantidad: -cant, costo_unitario: _num(l.valor_interno),
          notas: `Devolución #${remision.numero ?? remision.id} → bodega`,
        });
        await trasladosRepo.insertarHistorialEnTransaccion(client, {
          producto_id: productoDestinoId, sucursal_id: bodegaId,
          atributo_id: nodoDestino.atributoId, variante_id: nodoDestino.varianteId,
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
          `UPDATE lineas_remision
           SET producto_destino_id = $2, cantidad_recibida = $3,
               atributo_destino_id = $4, variante_destino_id = $5
           WHERE id = $1`,
          [id, productoDestinoId, cant, nodoDestino.atributoId, nodoDestino.varianteId]
        );
      }

      // ── Qué de esta devolución le baja la deuda al local ──────────────────
      //
      // SERIAL DE BODEGA: nada que hacer aquí. Su línea de entrega quedó
      //   'Devuelta' unas líneas más arriba, y el cargo de ese envío deja de
      //   contarla solo. Acreditarlo además sería cobrárselo dos veces al revés.
      //
      // ACCESORIO DE BODEGA: sí hay que acreditarlo. Es fungible, no tiene
      //   línea de entrega propia que marcar, así que el cargo de su envío no
      //   se entera. Sin este abono el local devolvería 5 cargadores y los
      //   seguiría debiendo.
      //
      // MERCANCÍA PROPIA: solo si la bodega decidió comprársela.
      const unidades = l.tipo === 'cantidad' ? Number(l.cantidad) : 1;
      if (l.tipo === 'cantidad' && l.origen_unidad === 'bodega') {
        saldoAFavor += _num(l.valor_interno) * unidades;
      } else if (l.genera_saldo_favor) {
        saldoAFavor += _num(l.valor_interno) * unidades;
      }
      idsOk.push(id);
    }

    if (idsOk.length)       await repo.marcarLineas(client, idsOk, 'Devuelta');
    if (idsFaltante.length) await repo.marcarLineas(client, idsFaltante, 'Faltante');
    if (!idsOk.length) throw { status: 400, message: 'No marcaste ningún producto como recibido' };

    // El crédito baja lo que el local debe: es un Ajuste positivo, y se imputa
    // a sus envíos abiertos con el mismo FIFO que un pago. Lo que sobre le
    // queda a favor y se aplicará solo cuando llegue el próximo envío.
    if (saldoAFavor > 0) {
      const mov = await repo.insertarMovimientoCuenta(client, {
        negocio_id: negocioId, sucursal_id: localId,
        tipo: 'Ajuste', valor: Math.round(saldoAFavor * 100) / 100,
        concepto: `Devolución #${remision.numero ?? remision.id} recibida en bodega`,
        usuario_id: req.user.id,
      });
      await _imputarFIFO(client, {
        negocioId, sucursalId: localId, valor: mov.valor, origen: 'ajuste',
        movimientoId: mov.id, usuarioId: req.user.id, notas: mov.concepto,
      });
    }

    // Devolver mercancía ya pagada deja crédito. Se aplica de inmediato a lo que
    // siga abierto —otros envíos, cargos— en vez de quedarse esperando a que
    // llegue un envío nuevo.
    await _aplicarSaldoAFavor(client, {
      negocioId, sucursalId: localId, usuarioId: req.user.id,
    });

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

// ═════════════════════════════════════════════════════════════════════════════
// IMPUTACIÓN — a qué envío entra cada peso
//
// Es lo ÚNICO del lado del dinero que no se puede derivar: qué envío paga un
// billete es una decisión de una persona, no un hecho que se pueda leer de
// otra tabla. Por eso se escribe (`abonos_remision`) y por eso pasa por un
// solo motor: el pago del local, el gasto que hizo por cuenta de la bodega, el
// ajuste que le abonan y el saldo a favor que se le aplica entran todos por
// aquí. Cuatro caminos, una sola regla de reparto.
//
// REGLA: del envío más viejo al más nuevo. Si el pago viene dirigido a un
// envío concreto, ese va primero y lo que sobre sigue la fila.
// ═════════════════════════════════════════════════════════════════════════════

const _centavos = (v) => Math.round(_num(v) * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// AVISOS — la cuenta no cambia en silencio
//
// Toda acción de un lado que le mueve la cuenta al otro manda un aviso. Es la
// pieza que faltaba para que "no pueda modificar cuentas y la bodega no se
// entere": el control no es solo poder deshacer, es enterarse a tiempo.
//
// NUNCA lanza ni se espera: quien llamó estaba despachando, recibiendo o
// pagando, y eso tiene que terminar bien aunque el aviso falle. Es la misma
// regla del módulo de notificaciones.
// ─────────────────────────────────────────────────────────────────────────────
const _avisar = ({ negocioId, sucursalId = null, roles = null, titulo, cuerpo, url = '/bodega' }) => {
  try {
    const notif = require('../notificaciones/notificaciones.service');
    notif.enviar({
      negocio_id: negocioId, sucursal_id: sucursalId, roles,
      titulo, cuerpo, url, tag: 'red-interna', tipo: 'red_interna',
    }).catch(() => {});
  } catch { /* sin módulo de notificaciones, el circuito sigue igual */ }
};

const _imputarFIFO = async (client, {
  negocioId, sucursalId, valor, origen,
  remesaId = null, movimientoId = null, usuarioId = null, notas = null,
  remisionId = null, cargoId = null,
}) => {
  let resto = _centavos(valor);
  const reparto = [];

  // La cola es TODO lo que el local debe: envíos y cargos, del más viejo al más
  // nuevo. Dejar los cargos fuera era lo que los volvía impagables — el dinero
  // pasaba de largo y se convertía en saldo a favor mientras el cargo seguía.
  const cola = [];

  if (remisionId) {
    const e = await repo.getSaldoEnvio(client, negocioId, remisionId);
    if (!e) throw { status: 404, message: 'Envío no encontrado' };
    if (Number(e.sucursal_destino_id) !== Number(sucursalId)) {
      throw { status: 403, message: 'Ese envío es de otra sucursal' };
    }
    if (_num(e.saldo) <= 0) {
      throw { status: 409, message: `El envío #${e.numero ?? remisionId} ya está pagado` };
    }
    cola.push({ tipo: 'envio', remision_id: Number(remisionId), etiqueta: e.numero,
                saldo: _num(e.saldo) });
  }

  if (cargoId) {
    const c = await repo.getSaldoCargo(client, negocioId, cargoId);
    if (!c) throw { status: 404, message: 'Cargo no encontrado' };
    if (Number(c.sucursal_id) !== Number(sucursalId)) {
      throw { status: 403, message: 'Ese cargo es de otra sucursal' };
    }
    if (_num(c.saldo) <= 0) throw { status: 409, message: 'Ese cargo ya está pagado' };
    cola.push({ tipo: 'cargo', cargo_id: Number(cargoId), etiqueta: c.concepto,
                saldo: _num(c.saldo) });
  }

  for (const d of await repo.getEnviosAbiertos(client, negocioId, sucursalId)) {
    if (remisionId && Number(d.remision_id) === Number(remisionId)) continue;
    if (cargoId    && Number(d.cargo_id)    === Number(cargoId))    continue;
    cola.push({
      tipo: d.tipo,
      remision_id: d.remision_id != null ? Number(d.remision_id) : null,
      cargo_id:    d.cargo_id    != null ? Number(d.cargo_id)    : null,
      etiqueta: d.etiqueta, saldo: _num(d.saldo),
    });
  }

  for (const e of cola) {
    if (resto <= 0) break;
    const aplica = _centavos(Math.min(resto, e.saldo));
    if (aplica <= 0) continue;
    await repo.insertarAbonoRemision(client, {
      negocio_id: negocioId, sucursal_id: sucursalId,
      remision_id: e.remision_id ?? null,
      cargo_id:    e.cargo_id ?? null,
      origen, remesa_id: remesaId, movimiento_id: movimientoId,
      valor: aplica, usuario_id: usuarioId, notas,
    });
    reparto.push({
      tipo: e.tipo, remision_id: e.remision_id ?? null, cargo_id: e.cargo_id ?? null,
      numero: e.tipo === 'envio' ? e.etiqueta : null,
      concepto: e.tipo === 'cargo' ? e.etiqueta : null,
      valor: aplica,
    });
    resto = _centavos(resto - aplica);
  }

  // Lo que sobra NO se escribe: queda como saldo a favor derivado (plata
  // recibida menos plata imputada). Guardarlo sería un segundo lado que
  // mantener sincronizado, justo lo que este módulo evita.
  return { reparto, sobrante: resto };
};

/**
 * Aplica el crédito que el local tenga a favor contra un envío recién llegado.
 *
 * Corre dentro de la transacción de la recepción, que es el único momento en
 * que un envío nace con saldo: hacerlo aquí evita que dos recepciones
 * simultáneas se repartan el mismo crédito.
 */
const _aplicarSaldoAFavor = async (client, { negocioId, sucursalId, usuarioId }) => {
  const t = await repo.getTotalesEnvios(negocioId, sucursalId, client);
  const disponible = Math.max(0,
    _num(t.excedente) + _num(t.cargos_excedente) + _num(t.sin_imputar) - _num(t.favor_usado));
  if (disponible <= 0) return { aplicado: 0, reparto: [] };

  // Se reparte entre TODO lo abierto —envíos y cargos— con el mismo FIFO.
  //
  // Antes solo se aplicaba al envío que se acababa de recibir, y por eso podían
  // convivir "$830.000 de cargos" y "$586.010 a tu favor": el crédito esperaba
  // un envío que quizá no llegaba nunca mientras el cargo seguía sin pagar.
  const { reparto } = await _imputarFIFO(client, {
    negocioId, sucursalId, valor: disponible, origen: 'saldo_favor',
    usuarioId, notas: 'Saldo a favor aplicado automáticamente',
  });
  return { aplicado: reparto.reduce((s, r) => s + r.valor, 0), reparto };
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

/**
 * El local paga.
 *
 * `remision_id` dirige el pago a un envío concreto (el botón "Abonar" de la
 * tarjeta de ese envío). Sin él, el pago se reparte entre los envíos abiertos
 * del más viejo al más nuevo — el botón "Pagar" de la cabecera. Lo que sobre
 * en cualquiera de los dos casos queda como saldo a favor.
 */
const enviarRemesa = async (req, {
  valor, notas, clave_idempotencia, cuenta_origen_id, metodo, remision_id, cargo_id,
}) => {
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

    // A qué envío(s) va esta plata. Se decide y se guarda AHORA, aunque la
    // remesa todavía tenga que confirmarse: así el local no tiene que volver a
    // elegir, y la reserva impide que un segundo pago tape el mismo envío.
    const { reparto, sobrante } = await _imputarFIFO(client, {
      negocioId, sucursalId: origenId, valor: monto, origen: 'remesa',
      remesaId: remesa.id, usuarioId: req.user.id,
      remisionId: remision_id ? Number(remision_id) : null,
      cargoId:    cargo_id    ? Number(cargo_id)    : null,
      notas: notas || null,
    });

    await client.query('COMMIT');
    return { ...(await repo.findRemesaById(negocioId, remesa.id)), reparto, sobrante };
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
    if (remesa.estado === 'Anulada') {
      throw { status: 409, message: 'Esa remesa ya está anulada' };
    }
    // EN TRÁNSITO la anula cualquiera de los dos: nadie ha dado nada por
    // recibido. YA CONFIRMADA solo la bodega, porque es ella la que dijo que la
    // tenía y la única que puede desdecirse. Antes esto no se podía deshacer y
    // el único arreglo era un ajuste suelto, que dejaba la lectura descuadrada.
    if (remesa.estado === 'Recibida' && !req.esBodega) {
      throw {
        status: 403,
        message: 'La bodega ya confirmó este pago. Solo ella puede revertirlo.',
      };
    }
    if (remesa.estado === 'En transito'
        && Number(remesa.sucursal_origen_id) !== Number(req.sucursal_id) && !req.esBodega) {
      throw { status: 403, message: 'Solo el local que la envió o la bodega pueden anularla' };
    }

    // Los movimientos de dinero NO se borran: se desactivan. El extracto de
    // tesorería conserva la huella de lo que pasó.
    // El espejo en caja guarda el id del movimiento de dinero en
    // `referencia_id` con `referencia_tipo='tesoreria'` (ver
    // tesoreria.repository.insertarEspejoCaja) — por ahí se desactiva.
    // Al revertir una remesa CONFIRMADA hay que tumbar también las dos patas
    // que creó la confirmación (salida de tránsito + entrada a la bodega). La
    // salida de tránsito no se guarda en ninguna columna, pero comparte
    // `grupo_traslado` con la entrada: por ahí se alcanza.
    if (remesa.mov_entrada_id) {
      await client.query(`
        UPDATE movimientos_dinero SET activo = FALSE
        WHERE grupo_traslado = (SELECT grupo_traslado FROM movimientos_dinero WHERE id = $1)
          AND grupo_traslado IS NOT NULL
      `, [remesa.mov_entrada_id]);
      await client.query(`
        UPDATE movimientos_caja SET activo = FALSE
        WHERE referencia_tipo = 'tesoreria' AND referencia_id IN (
          SELECT id FROM movimientos_dinero
          WHERE grupo_traslado = (SELECT grupo_traslado FROM movimientos_dinero WHERE id = $1)
            AND grupo_traslado IS NOT NULL
        )
      `, [remesa.mov_entrada_id]);
    }

    for (const movId of [remesa.mov_salida_id, remesa.mov_transito_id, remesa.mov_entrada_id]) {
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
    // Y su imputación se cae con ella: los envíos que estaba tapando vuelven a
    // quedar abiertos. Se marca anulada en vez de borrarse para que el envío
    // conserve el rastro de que hubo un pago y se deshizo.
    await repo.anularAbonosDeRemesa(client, remesaId);

    await client.query('COMMIT');

    _avisar({
      negocioId,
      sucursalId: req.esBodega ? Number(remesa.sucursal_origen_id) : Number(req.red.bodega_id),
      titulo: 'Pago anulado',
      cuerpo: `${_dinero(remesa.valor)} — los envíos que cubría vuelven a quedar abiertos`,
    });

    return { id: remesaId, estado: 'Anulada' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Gasto autorizado: el local paga algo con plata de la bodega ──────────────

/**
 * El local paga algo con plata de la bodega.
 *
 * `cuenta_origen_id` dice DE DÓNDE sale: efectivo, Nequi, banco… Antes se
 * asumía siempre la caja de efectivo, así que un gasto pagado por transferencia
 * descuadraba la caja física del local. La cuenta se valida contra la sucursal
 * como en `enviarRemesa` — nunca se confía en el id que llega del navegador.
 */
const registrarGastoAutorizado = async (req, { valor, concepto, cuenta_origen_id }) => {
  const negocioId = req.user.negocio_id;
  const sucursalId = Number(req.sucursal_id);
  const monto = Number(valor);
  if (!(monto > 0))  throw { status: 400, message: 'El valor debe ser mayor a 0' };
  if (!concepto?.trim()) throw { status: 400, message: 'Escribe en qué se gastó' };
  if (req.esBodega) throw { status: 400, message: 'La bodega registra sus gastos en Tesorería' };

  let cuenta;
  if (cuenta_origen_id) {
    const c = await tesoreriaRepo.findCuentaById(Number(cuenta_origen_id), negocioId);
    if (!c || !c.activa) throw { status: 404, message: 'Cuenta no encontrada o inactiva' };
    if (Number(c.sucursal_id) !== sucursalId) {
      throw { status: 403, message: 'Esa cuenta pertenece a otra sucursal' };
    }
    if ((c.moneda || 'COP') !== 'COP') {
      throw { status: 400, message: 'El gasto debe salir de una cuenta en pesos' };
    }
    if (c.tipo === 'transito') {
      throw { status: 400, message: 'No se puede gastar desde una cuenta de tránsito' };
    }
    cuenta = c;
  } else {
    cuenta = await _cuentaEfectivo(negocioId, sucursalId);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mov = await tesoreriaRepo.insertarMovimiento(client, {
      cuenta_id: cuenta.id, tipo: 'salida', categoria: 'gasto',
      valor: monto, concepto: `[Por cuenta de bodega] ${concepto.trim()}`,
      usuario_id: req.user.id,
    });
    // El espejo en caja solo si la plata salió de la caja física: una
    // transferencia o un Nequi no pasan por ahí.
    const esEfectivo = cuenta.tipo === 'efectivo'
      || (cuenta.metodos_pago || []).includes('Efectivo');
    if (esEfectivo) await _espejarCaja(client, sucursalId, mov, req.user.id, concepto.trim());

    // Espejo en la cuenta interna. Nace POR APROBAR: la plata ya salió de la
    // caja del local (eso es un hecho suyo), pero la deuda con la bodega no
    // baja hasta que la bodega lo acepte. Antes bajaba sola, así que un local
    // podía rebajarse la deuda y la bodega solo se enteraba si entraba a mirar.
    const movCuenta = await repo.insertarMovimientoCuenta(client, {
      negocio_id: negocioId, sucursal_id: sucursalId,
      tipo: 'GastoAutorizado', valor: monto,
      mov_dinero_id: mov.id, concepto: concepto.trim(), usuario_id: req.user.id,
      estado: 'Por aprobar',
    });
    // La imputación se escribe YA aunque todavía no cuente, igual que la de una
    // remesa en tránsito: así el local no tiene que volver a decidir nada y la
    // reserva impide que otro pago tape el mismo envío.
    const { reparto, sobrante } = await _imputarFIFO(client, {
      negocioId, sucursalId, valor: monto, origen: 'gasto',
      movimientoId: movCuenta.id, usuarioId: req.user.id, notas: concepto.trim(),
    });

    await client.query('COMMIT');

    _avisar({
      negocioId, sucursalId: Number(req.red.bodega_id), roles: ['admin_negocio', 'supervisor'],
      titulo: 'Gasto por aprobar',
      cuerpo: `${req.user.nombre || 'Un local'} registró ${_dinero(monto)}: ${concepto.trim()}`,
    });

    return { ...movCuenta, reparto, sobrante };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * La bodega decide sobre un gasto que el local le pasó.
 *
 * Aprobar lo vuelve efectivo (sus abonos empiezan a contar y la deuda baja);
 * rechazar lo deja como constancia y tumba su imputación. En los dos casos el
 * dinero YA salió de la caja del local: eso no se toca, porque pasó de verdad.
 */
const decidirGasto = async (req, movimientoId, { aprobar, motivo }) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mov = await repo.findMovimientoCuentaById(negocioId, movimientoId, client);
    if (!mov) throw { status: 404, message: 'Movimiento no encontrado' };
    if (mov.anulado) throw { status: 409, message: 'Ese movimiento está anulado' };
    if (mov.estado !== 'Por aprobar') {
      throw { status: 409, message: `Ese gasto ya está "${mov.estado}"` };
    }

    const estado = aprobar ? 'Aprobado' : 'Rechazado';
    const actualizado = await repo.decidirMovimientoCuenta(client, {
      id: movimientoId, estado, usuarioId: req.user.id,
    });
    if (!aprobar) {
      // Su imputación se cae y los envíos que reservaba vuelven a quedar
      // abiertos. La PLATA no se devuelve: el local la gastó de verdad, y al
      // rechazarlo se la come él. Lo que sí se corrige es el concepto en
      // tesorería, que si no seguiría diciendo que era por cuenta de la bodega.
      await repo.anularAbonosDeMovimiento(client, movimientoId);
      if (mov.mov_dinero_id) {
        await client.query(`
          UPDATE movimientos_dinero
          SET concepto = $2
          WHERE id = $1
        `, [mov.mov_dinero_id,
            `[Gasto propio — la bodega lo rechazó] ${mov.concepto || ''}`.slice(0, 200)]);
      }
    }

    await client.query('COMMIT');

    _avisar({
      negocioId, sucursalId: Number(mov.sucursal_id),
      titulo: aprobar ? 'Gasto aprobado' : 'Gasto rechazado',
      cuerpo: aprobar
        ? `La bodega aprobó ${_dinero(mov.valor)}: ${mov.concepto || ''}`
        : `La bodega rechazó ${_dinero(mov.valor)}${motivo ? ` — ${motivo}` : ''}. Tu deuda no bajó.`,
    });

    return actualizado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Anular un gasto o un ajuste mal registrado.
 *
 * La columna `anulado` existía desde la primera migración y ningún código la
 * ponía en TRUE: un ajuste con un cero de más se quedaba ahí para siempre. Se
 * marca en vez de borrarse para que quede el rastro de que existió y se
 * deshizo, y su imputación se cae con él.
 *
 * Puede la BODEGA siempre; el LOCAL solo su propio gasto y solo mientras nadie
 * lo haya aprobado — después ya es un acuerdo entre los dos.
 */
const anularMovimientoCuenta = async (req, movimientoId, { motivo } = {}) => {
  const negocioId = req.user.negocio_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mov = await repo.findMovimientoCuentaById(negocioId, movimientoId, client);
    if (!mov) throw { status: 404, message: 'Movimiento no encontrado' };
    if (mov.anulado) throw { status: 409, message: 'Ese movimiento ya está anulado' };

    if (!req.esBodega) {
      if (Number(mov.sucursal_id) !== Number(req.sucursal_id)) {
        throw { status: 403, message: 'Ese movimiento es de otra sucursal' };
      }
      if (mov.tipo !== 'GastoAutorizado') {
        throw { status: 403, message: 'Solo la bodega puede anular un ajuste' };
      }
      if (mov.estado === 'Aprobado') {
        throw {
          status: 409,
          message: 'La bodega ya aprobó este gasto. Pídele que lo anule ella.',
        };
      }
    }

    await repo.anularMovimientoCuenta(client, movimientoId);
    await repo.anularAbonosDeMovimiento(client, movimientoId);

    // El movimiento de dinero también se desactiva: la plata vuelve a la
    // cuenta de donde salió, y con ella su espejo en caja.
    if (mov.mov_dinero_id) {
      await client.query(
        `UPDATE movimientos_dinero SET activo = FALSE WHERE id = $1`, [mov.mov_dinero_id]
      );
      await client.query(
        `UPDATE movimientos_caja SET activo = FALSE
         WHERE referencia_tipo = 'tesoreria' AND referencia_id = $1`, [mov.mov_dinero_id]
      );
    }

    await client.query('COMMIT');

    _avisar({
      negocioId,
      sucursalId: req.esBodega ? Number(mov.sucursal_id) : Number(req.red.bodega_id),
      titulo: mov.tipo === 'Ajuste' ? 'Ajuste anulado' : 'Gasto anulado',
      cuerpo: `${_dinero(mov.valor)} — ${mov.concepto || ''}${motivo ? ` · ${motivo}` : ''}`,
    });

    return { id: movimientoId, anulado: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Mueve un abono de un envío a otro.
 *
 * Es el arreglo del pago que entró a la tarjeta equivocada: la plata estaba
 * bien contada en el total y mal en el detalle, y no había forma de corregirlo.
 * No toca tesorería ni la caja — solo a qué envío se aplica.
 */
const moverAbono = async (req, abonoId, { remision_id, cargo_id }) => {
  const negocioId = req.user.negocio_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const abono = await repo.findAbonoById(negocioId, abonoId, client);
    if (!abono) throw { status: 404, message: 'Abono no encontrado' };
    if (abono.anulado) throw { status: 409, message: 'Ese abono está anulado' };
    if (!req.esBodega && Number(abono.sucursal_id) !== Number(req.sucursal_id)) {
      throw { status: 403, message: 'Ese abono es de otra sucursal' };
    }
    if (!remision_id && !cargo_id) {
      throw { status: 400, message: 'Falta el documento al que se mueve' };
    }
    if (remision_id && Number(abono.remision_id) === Number(remision_id)) {
      throw { status: 400, message: 'El abono ya está en ese envío' };
    }
    if (cargo_id && Number(abono.cargo_id) === Number(cargo_id)) {
      throw { status: 400, message: 'El abono ya está en ese cargo' };
    }

    if (remision_id) {
      const destino = await repo.getSaldoEnvio(client, negocioId, Number(remision_id));
      if (!destino) throw { status: 404, message: 'Envío no encontrado' };
      if (Number(destino.sucursal_destino_id) !== Number(abono.sucursal_id)) {
        throw { status: 403, message: 'Ese envío es de otra sucursal' };
      }
    } else {
      const destino = await repo.getSaldoCargo(client, negocioId, Number(cargo_id));
      if (!destino) throw { status: 404, message: 'Cargo no encontrado' };
      if (Number(destino.sucursal_id) !== Number(abono.sucursal_id)) {
        throw { status: 403, message: 'Ese cargo es de otra sucursal' };
      }
    }

    const movido = await repo.moverAbono(client, {
      abonoId, negocioId,
      remisionId: remision_id ? Number(remision_id) : null,
      cargoId:    cargo_id    ? Number(cargo_id)    : null,
    });
    await client.query('COMMIT');
    return movido;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Ajuste de la bodega sobre la cuenta de un local.
 *
 *   POSITIVO → le abona: se reparte entre los envíos abiertos como cualquier
 *              pago, y lo que sobre le queda a favor.
 *   NEGATIVO → le cobra (una rotura, un faltante). NO cuelga de ningún envío
 *              —no vino de uno—, así que suma aparte en la deuda del local.
 */
const registrarAjuste = async (req, { sucursal_id, valor, concepto, remision_id }) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;
  const monto = Number(valor);
  if (!Number.isFinite(monto) || monto === 0) {
    throw { status: 400, message: 'El ajuste debe ser distinto de 0' };
  }
  if (!concepto?.trim()) throw { status: 400, message: 'Explica el motivo del ajuste' };
  await _verificarSucursal(null, sucursal_id, negocioId);
  const sucursalId = Number(sucursal_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mov = await repo.insertarMovimientoCuenta(client, {
      negocio_id: negocioId, sucursal_id: sucursalId,
      tipo: 'Ajuste', valor: monto,
      concepto: concepto.trim(), usuario_id: req.user.id,
    });

    let reparto = [], sobrante = 0;
    if (monto > 0) {
      ({ reparto, sobrante } = await _imputarFIFO(client, {
        negocioId, sucursalId, valor: monto, origen: 'ajuste',
        movimientoId: mov.id, usuarioId: req.user.id, notas: concepto.trim(),
        remisionId: remision_id ? Number(remision_id) : null,
      }));
    } else {
      // El cargo acaba de abrir una deuda. Si el local traía saldo a favor, se
      // le aplica YA: tener crédito y deber al mismo tiempo era justo lo que se
      // veía en pantalla ("$830.000 de cargos" y "$586.010 a tu favor").
      await _aplicarSaldoAFavor(client, { negocioId, sucursalId, usuarioId: req.user.id });
    }

    await client.query('COMMIT');

    _avisar({
      negocioId, sucursalId,
      titulo: monto > 0 ? 'La bodega te abonó' : 'La bodega te hizo un cargo',
      cuerpo: `${_dinero(Math.abs(monto))} — ${concepto.trim()}`,
    });

    return { ...mov, reparto, sobrante };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LECTURAS — todo derivado
// ─────────────────────────────────────────────────────────────────────────────

// Estados en los que la mercancía sigue bajo responsabilidad del local: la
// tiene, la vendió o no aparece. Fuera quedan 'En transito' (no ha llegado),
// 'Faltante' (nunca llegó) y 'Devuelta' (volvió a la bodega).
const ESTADOS_EN_PODER = [
  'En consignacion', 'Por liquidar', 'En recaudo', 'En prestamo',
  'Sin ubicar', 'Movida',
];

// ─────────────────────────────────────────────────────────────────────────────
// EL SALDO — desde agosto 2026, la deuda es la de los ENVÍOS
//
// Antes el local solo debía lo vendido y la deuda salía de cruzar las unidades
// contra las ventas. Ahora debe todo lo que recibió, y la cuenta la llevan los
// envíos: cada uno tiene su cargo (derivado de sus líneas) y sus abonos
// (escritos, porque a qué envío se imputa un pago lo decide una persona).
//
// El cruce contra las ventas SIGUE CORRIENDO, pero ya no toca un peso: sirve
// para contarle al local qué vendió y qué le queda en vitrina. Cuando algo
// aquí diga "informativo", quiere decir exactamente eso.
// ─────────────────────────────────────────────────────────────────────────────
const _armarSaldo = ({ resumen, cantidad, remesado, movimientos, envios }) => {
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

  const recibido   = _num(remesado?.recibido);
  const enTransito = _num(remesado?.en_transito);
  const gastos     = _num(movimientos?.gastos);
  const ajustes    = _num(movimientos?.ajustes);

  // Valor de envío de la mercancía que el local todavía tiene sin vender. Es
  // informativo: la debe igual, pero le dice de dónde va a salir la plata.
  const enVitrina = porEstado['En consignacion']?.valor_interno || 0;
  const prestado  = porEstado['En prestamo']?.valor_interno     || 0;
  const vendido   = (porEstado['Por liquidar']?.valor_interno || 0)
                  + (porEstado['En recaudo']?.valor_interno   || 0);

  const valorEnPoder =
    ESTADOS_EN_PODER.reduce((s, e) => s + (porEstado[e]?.valor_interno || 0), 0)
    + cantidad.reduce((s, c) =>
        s + (_num(c.entregado) - _num(c.devuelto)) * _num(c.valor_unitario), 0);

  // ── La cuenta ──────────────────────────────────────────────────────────────
  const deudaEnvios   = _num(envios?.deuda);
  // Lo que queda debiendo por cargos sueltos: su SALDO, no su valor. Desde v5
  // un cargo es un documento que se paga como cualquier envío, así que contar
  // su valor entero mostraría deuda ya saldada.
  const cargosSueltos = _num(envios?.cargos_sueltos);
  // Crédito del local: lo que pagó de más en documentos que después encogieron
  // por una devolución, más la plata que llegó sin imputarse a nada, menos lo
  // que ya se consumió.
  const aFavor = Math.max(0,
    _num(envios?.excedente) + _num(envios?.cargos_excedente)
    + _num(envios?.sin_imputar) - _num(envios?.favor_usado));

  const deudaTotal = deudaEnvios + cargosSueltos;

  return {
    por_estado: porEstado,
    cantidad_consignada: cantidad,
    totales: {
      // ── LO QUE DEBE ────────────────────────────────────────────────────────
      // DEUDA TOTAL: la suma de los saldos de sus envíos. Sube al RECIBIR
      // mercancía y baja al pagar o al devolver. Es exigible completa: el
      // local paga lo que le entregan, esté vendido o no.
      deuda_total:        Math.round(deudaTotal),
      saldo_a_favor:      Math.round(aFavor),
      // Lo que tiene que entregar de verdad hoy, ya descontado su crédito.
      // Conserva el nombre viejo porque lo leen el Dashboard y los reportes.
      //
      // NUNCA NEGATIVO, y es una decisión, no un descuido: si el crédito del
      // local supera su deuda, la bodega no le queda debiendo plata — le queda
      // debiendo MERCANCÍA. El excedente vive en `saldo_a_favor` y se aplica
      // solo cuando llegue el próximo envío.
      saldo_por_liquidar: Math.max(0, Math.round(deudaTotal - aFavor)),
      // La posición neta con signo, para cuadrar el extracto (que sí puede
      // quedar en negativo). No se muestra como "lo que debe".
      neto:               Math.round(deudaTotal - aFavor),

      cargo_total:        Math.round(_num(envios?.cargo_total)),
      abonado_total:      Math.round(_num(envios?.abonado_total)),
      cargos_sueltos:     Math.round(cargosSueltos),
      envios_abiertos:    Number(envios?.envios_abiertos || 0),
      envios_total:       Number(envios?.envios_total    || 0),
      cargos_abiertos:    Number(envios?.cargos_abiertos || 0),
      cargos_valor:       Math.round(_num(envios?.cargos_valor)),
      cargos_abonado:     Math.round(_num(envios?.cargos_abonado)),

      remesado_recibido:  Math.round(recibido),
      remesas_en_transito:Math.round(enTransito),
      gastos_autorizados: Math.round(gastos),
      ajustes:            Math.round(ajustes),

      // ── INFORMATIVO: dónde está la mercancía que ya debe ───────────────────
      // Ninguno de estos entra en la deuda. Responden "¿de dónde sale la plata
      // para pagarla?": lo vendido ya la tiene, lo demás todavía no.
      vendido_valor:            Math.round(vendido),
      vendido_unidades:         (porEstado['Por liquidar']?.unidades || 0)
                              + (porEstado['En recaudo']?.unidades   || 0),
      en_vitrina_valor:         Math.round(enVitrina),
      prestado_valor:           Math.round(prestado),
      valor_en_poder:           Math.round(valorEnPoder),
      liquidable_total:         Math.round(totalLiquidable),
      en_consignacion_valor:    enVitrina,
      en_consignacion_unidades: porEstado['En consignacion']?.unidades || 0,
      en_recaudo_valor:         porEstado['En recaudo']?.valor_interno || 0,
      en_recaudo_unidades:      porEstado['En recaudo']?.unidades      || 0,
      sin_ubicar_unidades:      porEstado['Sin ubicar']?.unidades      || 0,
      sin_ubicar_valor:         porEstado['Sin ubicar']?.valor_interno || 0,
    },
  };
};

const getEstadoLocal = async (negocioId, sucursalId) => {
  const [resumen, cantidad, remesado, movimientos, envios] = await Promise.all([
    repo.getResumenUnidades(negocioId, sucursalId),
    repo.getCantidadConsignada(negocioId, sucursalId),
    repo.getTotalRemesado(negocioId, sucursalId),
    repo.getTotalMovimientosCuenta(negocioId, sucursalId),
    repo.getTotalesEnvios(negocioId, sucursalId),
  ]);
  return _armarSaldo({
    resumen, cantidad, envios,
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

  const [remesasPorConfirmar, enTransito, devolucionesPorConfirmar, gastosPorAprobar] =
    await Promise.all([
    repo.findRemesas(negocioId, { sucursalId: bodegaId, rol: 'destino', estado: 'En transito', limit: 50 }),
    repo.findRemisiones(negocioId, { sucursalId: bodegaId, rol: 'origen', estado: 'En transito', limit: 50 }),
    // Mercancía que los locales están devolviendo y espera revisión de la bodega.
    repo.findRemisiones(negocioId, {
      sucursalId: bodegaId, rol: 'destino', estado: 'En transito', tipo: 'devolucion', limit: 50,
    }),
    // Gastos que los locales pagaron por cuenta de la bodega y esperan visto
    // bueno. Sin esta bandeja, aprobar dependería de que alguien se acordara.
    repo.findMovimientosPorAprobar(negocioId),
  ]);

  const totales = locales.reduce((acc, l) => ({
    // Lo que la red le debe a la bodega, sumando local por local.
    deuda:              acc.deuda              + l.totales.saldo_por_liquidar,
    saldo_a_favor:      acc.saldo_a_favor      + l.totales.saldo_a_favor,
    envios_abiertos:    acc.envios_abiertos    + l.totales.envios_abiertos,
    // Se conserva con el nombre viejo por si alguna pantalla lo lee todavía.
    saldo_por_liquidar: acc.saldo_por_liquidar + l.totales.saldo_por_liquidar,
    en_consignacion:    acc.en_consignacion    + l.totales.en_consignacion_valor,
    sin_ubicar:         acc.sin_ubicar         + l.totales.sin_ubicar_unidades,
  }), { deuda: 0, saldo_a_favor: 0, envios_abiertos: 0,
        saldo_por_liquidar: 0, en_consignacion: 0, sin_ubicar: 0 });

  return {
    es_bodega: true, sucursal_id: bodegaId,
    locales, totales,
    remesas_por_confirmar: remesasPorConfirmar,
    remisiones_en_transito: enTransito,
    devoluciones_por_confirmar: devolucionesPorConfirmar,
    gastos_por_aprobar: gastosPorAprobar,
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
  const salida = {
    sucursal_id: objetivo,
    ...estado,
    liquidaciones: detalle.map((d) => ({ ...d, liquidable: _num(d.liquidable) })),
    unidades: unidades.map((u) => ({
      ...u,
      etiqueta_estado: ETIQUETAS_ESTADO[u.estado_unidad] || u.estado_unidad,
      liquidable: _num(u.liquidable),
    })),
  };

  // Esta lectura también se recorta. Le faltaba: sus rutas no exigen nivel, así
  // que un vendedor podía pedirla y recibir el `valor_interno` de cada equipo
  // —justo lo que el recorte del estado de cuenta esconde— por la puerta de al
  // lado. El recorte tiene que estar en TODAS las salidas, no en la principal.
  if (_puedeVerCostos(req)) return salida;
  const recortado = _recortarParaVendedor(salida);
  return {
    ...recortado,
    liquidaciones: salida.liquidaciones.map((d) => _sinValores(d, CLAVES_VALOR_UNIDAD)),
    unidades:      salida.unidades.map((u) => _sinValores(u, CLAVES_VALOR_UNIDAD)),
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

  const [totales, extracto, mercancia, remisiones, remesas, movimientos, porEnvio,
         abonos, lineasEnvios, cargos] = await Promise.all([
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
      repo.findAbonosLocal(negocioId, objetivo, 300),
      // Las líneas de todos los envíos, juntas: la tarjeta las muestra sin
      // desplegar nada y pedirlas una por una serían N consultas por pantalla.
      repo.getLineasDeEnvios(negocioId, objetivo, { limit: 600 }),
      // Los cargos sueltos, como documentos con su cuenta: se muestran junto a
      // los envíos para que se vea qué se está pagando.
      repo.getCargosCuenta(negocioId, objetivo),
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
    // Los abonos, con el envío al que se imputó cada uno. Es lo que permite
    // contar el pago como lo hizo el usuario ("pagué $2M y taparon 3 envíos")
    // en vez de como una cifra suelta.
    abonos: abonos.map((a) => ({ ...a, valor: _num(a.valor) })),
    // Los cargos que no vienen de un envío, con su saldo y sus abonos.
    cargos: cargos.map((c) => ({
      ...c,
      cargo:     Math.round(_num(c.cargo)),
      abonado:   Math.round(_num(c.abonado)),
      saldo:     Math.round(_num(c.saldo)),
      excedente: Math.round(_num(c.excedente)),
      pagado:    _num(c.saldo) <= 0,
    })),
    // Envío por envío: su cuenta y, aparte, qué se vendió y qué queda.
    ...(_armarEnvios(porEnvio, totales.totales, lineasEnvios)),
    // Por qué debe lo que debe, en una línea por concepto.
    desglose: _desgloseSaldo(totales.totales, remesas),
  };

  return _puedeVerCostos(req) ? salida : _recortarParaVendedor(salida);
};

// ─────────────────────────────────────────────────────────────────────────────
// ENVÍOS — cada uno es una cuenta, como una factura a crédito de un cliente
//
// Dos capas en la misma tarjeta, y no conviene mezclarlas:
//   LA CUENTA      cargo · abonado · saldo. Es la plata, y es lo que se paga.
//   LA MERCANCÍA   cuántos vendió, prestó y le quedan. Es INFORMATIVO: el
//                  local debe el envío completo desde que lo recibe, venda o no.
//
// INVARIANTE: Σ saldo de los envíos + ajustes en contra = deuda_total.
// Los accesorios ya no quedan fuera del reparto: cuelgan de su envío como
// cualquier otra línea, porque ahora valen cantidad × valor, no una estimación
// contra el stock. Verificado en 11-envios-por-remision.
// ─────────────────────────────────────────────────────────────────────────────
const _armarEnvios = (filas, t, lineas = []) => {
  // Las líneas llegan en una sola consulta para toda la pantalla; aquí se
  // reparten a su envío.
  const porEnvio = new Map();
  for (const l of lineas) {
    const k = Number(l.remision_id);
    if (!porEnvio.has(k)) porEnvio.set(k, []);
    porEnvio.get(k).push({
      linea_id:        Number(l.linea_id),
      tipo:            l.tipo,
      imei:            l.imei,
      nombre_producto: l.nombre_producto,
      cantidad:        Number(l.cantidad),
      valor_interno:   Math.round(_num(l.valor_interno)),
      subtotal:        Math.round(_num(l.valor_interno) * (l.tipo === 'cantidad' ? Number(l.cantidad) : 1)),
      estado_linea:    l.estado_linea,
      estado_unidad:   l.estado_unidad,
      etiqueta_estado: ETIQUETAS_ESTADO[l.estado_unidad] || l.estado_unidad || l.estado_linea,
      factura_numero:  l.factura_numero,
      nombre_cliente:  l.nombre_cliente,
    });
  }

  const envios = filas.map((e) => ({
    ...e,
    lineas: porEnvio.get(Number(e.id)) || [],
    unidades:          Number(e.unidades),
    // ── La cuenta del envío ──
    cargo:             Math.round(_num(e.cargo)),
    abonado:           Math.round(_num(e.abonado)),
    saldo:             Math.round(_num(e.saldo)),
    excedente:         Math.round(_num(e.excedente)),
    pagado:            _num(e.cargo) > 0 && _num(e.saldo) <= 0,
    // ── La mercancía (informativo) ──
    valor_recibido:    Math.round(_num(e.valor_recibido)),
    disponibles_valor: Math.round(_num(e.disponibles_valor)),
    vendidas_valor:    Math.round(_num(e.vendidas_valor)),
    prestadas_valor:   Math.round(_num(e.prestadas_valor)),
    sin_ubicar_valor:  Math.round(_num(e.sin_ubicar_valor)),
    accesorios_valor:  Math.round(_num(e.accesorios_valor)),
    valor_total:       _num(e.valor_total),
  }));

  return {
    envios,
    envios_resumen: {
      total:    envios.length,
      abiertos: envios.filter((e) => e.saldo > 0).length,
      // Se toman de los totales del local, no de la suma de esta lista: la
      // lista viene topada y sumarla daría menos deuda de la que hay.
      saldo_total:    Math.max(0, _num(t.deuda_total) - _num(t.cargos_sueltos)),
      cargos_sueltos: _num(t.cargos_sueltos),
      saldo_a_favor:  _num(t.saldo_a_favor),
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
      clave: 'envios',
      etiqueta: `Mercancía que la bodega le entregó${t.envios_total ? ` (${t.envios_total} envío/s)` : ''}`,
      detalle: 'lo devuelto ya está descontado',
      valor: _num(t.cargo_total),
      signo: '+',
    },
    {
      clave: 'pagos',
      etiqueta: 'Lo que ya le pagó',
      detalle: recibidas.length ? `${recibidas.length} remesa(s), gastos y abonos` : null,
      valor: -_num(t.abonado_total),
      signo: '−',
      medios: porMedio,
      ultima_fecha: ultima?.fecha_recepcion || null,
    },
  ];
  if (_num(t.cargos_sueltos) > 0) {
    lineas.push({
      clave: 'cargos_sueltos',
      etiqueta: 'Cargos que la bodega le hizo aparte',
      detalle: 'roturas, faltantes u otros ajustes en contra',
      valor: _num(t.cargos_sueltos), signo: '+',
    });
  }
  if (_num(t.saldo_a_favor) > 0) {
    lineas.push({
      clave: 'favor',
      etiqueta: 'Saldo a favor sin usar',
      detalle: 'se aplica solo cuando llegue el próximo envío',
      valor: -_num(t.saldo_a_favor), signo: '−',
    });
  }

  return {
    lineas,
    saldo: _num(t.saldo_por_liquidar),
    // De lo que debe, de dónde va a salir la plata. Es informativo y es la
    // duda más común del local ahora que paga todo lo que recibe.
    respaldo: {
      etiqueta: 'De esa deuda, esto todavía está en vitrina',
      unidades: t.en_consignacion_unidades,
      valor:    t.en_vitrina_valor,
      vendido:  t.vendido_valor,
      vendido_unidades: t.vendido_unidades,
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

  const [lineas, correcciones, abonos] = await Promise.all([
    repo.getLineasDetalladas(negocioId, id, sucursalUnidades),
    repo.getCorreccionesRemision(negocioId, id),
    // Los abonos que ha recibido este envío: son su estado de cuenta.
    repo.getAbonosDeEnvio(negocioId, id),
  ]);

  const resumen = lineas.reduce((acc, l) => {
    const unidades = l.tipo === 'cantidad' ? Number(l.cantidad_recibida ?? l.cantidad ?? 0) : 1;
    const valor    = _num(l.valor_interno) * unidades;
    if (l.estado_linea === 'Faltante') { acc.no_llego += valor; return acc; }
    if (l.estado_linea === 'Devuelta') { acc.devuelto += valor; return acc; }
    acc.enviado += valor;
    // El CARGO del envío: lo recibido y no devuelto. Es la deuda que generó.
    if (l.estado_linea === 'Recibida') acc.cargo += valor;
    acc.liquidable += _num(l.liquidable);
    if (l.estado_unidad === 'En consignacion') acc.en_vitrina += valor;
    return acc;
  }, { enviado: 0, cargo: 0, liquidable: 0, en_vitrina: 0, no_llego: 0, devuelto: 0 });

  const abonadoEfectivo = abonos
    .filter((a) => !a.anulado && (a.origen !== 'remesa' || a.remesa_estado === 'Recibida'))
    .reduce((s, a) => s + _num(a.valor), 0);

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
    abonos: abonos.map((a) => ({ ...a, valor: _num(a.valor) })),
    resumen: {
      enviado:    Math.round(resumen.enviado),
      // La cuenta del envío, calculada con las MISMAS reglas que el listado:
      // cargo = líneas 'Recibida'; abono efectivo = el que ya confirmó bodega.
      cargo:      Math.round(resumen.cargo),
      abonado:    Math.round(abonadoEfectivo),
      saldo:      Math.max(0, Math.round(resumen.cargo - abonadoEfectivo)),
      devuelto:   Math.round(resumen.devuelto),
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
    // La CUENTA del envío sobrevive: es la plata que el vendedor tiene que
    // entregar. Lo que se va es la valorización de la mercancía, que revela el
    // costo de cada equipo.
    resumen: {
      cargo:      salida.resumen.cargo,
      abonado:    salida.resumen.abonado,
      saldo:      salida.resumen.saldo,
      enviado:    null, devuelto: null, liquidable: null,
      en_vitrina: null, no_llego: null,
    },
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

// El buscador devuelve NODOS. `variante_label` viene con la talla cuando la hay;
// el `nombre` la incluye para que dos tallas del mismo producto no se vean
// idénticas en la lista del despacho.
const _formatoCantidad = (p) => ({
  tipo: 'cantidad',
  producto_id: p.producto_id,
  atributo_id: p.atributo_id ?? null,
  variante_id: p.variante_id ?? null,
  variante_label: p.variante_label ?? null,
  codigo: p.codigo || null,
  nombre: p.variante_label ? `${p.nombre} / ${p.variante_label}` : p.nombre,
  nombre_base: p.nombre,
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
      // El carrito ya sabe qué talla eligió el usuario: hay que conservarla.
      // Resolver solo por producto la perdía, y el despacho volvía a pedirla
      // (VARIANTE_REQUERIDA) mostrando además el producto sin la talla.
      const p = await repo.findNodoCantidadById(negocioId, sucursalId, {
        productoId: Number(it.producto_id),
        atributoId: it.atributo_id ? Number(it.atributo_id) : null,
        varianteId: it.variante_id ? Number(it.variante_id) : null,
      });
      if (!p) { descartados.push({ nombre: it.nombre || 'Producto', motivo: 'no está en la bodega' }); continue; }
      // Producto por variantes sin variante elegida: se descarta con un motivo
      // claro en vez de dejar que reviente al despachar.
      if (p.tiene_variantes) {
        descartados.push({ nombre: p.nombre, motivo: 'se maneja por variantes: elige la talla en el inventario' });
        continue;
      }
      const pedida = Math.max(1, Number(it.cantidad) || 1);
      if (Number(p.stock) <= 0) {
        descartados.push({
          nombre: p.variante_label ? `${p.nombre} / ${p.variante_label}` : p.nombre,
          motivo: 'sin stock',
        });
        continue;
      }
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
  decidirGasto, anularMovimientoCuenta, moverAbono,
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
