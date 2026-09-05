const { pool }                  = require('../../config/db');
const comprasRepo               = require('./compras.repository');
const { calcularCostoPromedio } = require('../../utils/costoPromedio.util');
const variantesRepo             = require('../variantes-producto/variantes-producto.repository');
const { getConfigOrdenes }      = require('../../middlewares/ordenesCompra.middleware');
const { resolverVencimiento }   = require('../../utils/vencimiento.util');
// Una sola respuesta a "¿lo que llegó es lo que se pidió?", compartida con las
// órdenes de compra: si cada módulo la calculara, la misma recepción sería una
// sustitución en un sitio y una entrega normal en el otro.
const { esSustitucion, etiquetaNodo } = require('../../utils/nodoPedido.util');

const getCompras = (sucursalId, negocioId, proveedorIds = null) =>
  comprasRepo.findAll(sucursalId, negocioId, proveedorIds);

// El listado de compras trae ahora el vencimiento y la garantia. Los dos
// estados se resuelven con los MISMOS helpers que la cartera y la procedencia
// (`_estadoPago` de acreedores y `estadoGarantia` de procedencia): tres
// pantallas que pintan el mismo semaforo no pueden calcularlo cada una.
const getComprasPaginadas = async (sucursalId, negocioId, filtros) => {
  const pagina = await comprasRepo.findAllPaginado(sucursalId, negocioId, filtros);

  const { getConfigOrdenes } = require('../../middlewares/ordenesCompra.middleware');
  const { estadoGarantia }   = require('../procedencia/procedencia.service');
  const cfg = await getConfigOrdenes(negocioId);

  const estadoPago = (dias) => {
    if (dias == null) return 'sin_plazo';
    if (dias < 0) return 'vencida';
    if (dias <= cfg.dias_aviso) return 'por_vencer';
    return 'al_dia';
  };

  return {
    ...pagina,
    // Los dos interruptores son independientes: un negocio puede llevar plazos
    // de pago sin reclamar garantias, y al reves.
    garantia_activa: cfg.garantia_activa === true,
    ordenes_activas: cfg.activas === true,
    rows: pagina.rows.map((c) => {
      const dias = c.dias_para_vencer == null ? null : Number(c.dias_para_vencer);
      const gar  = estadoGarantia(c.garantia_hasta, cfg.garantia_dias_aviso);
      return {
        ...c,
        dias_para_vencer:  dias,
        // Una compra sin saldo no vence: ya no le debe nada a nadie.
        estado_pago:       Number(c.saldo) > 0 ? estadoPago(dias) : 'al_dia',
        saldo:             Number(c.saldo || 0),
        estado_garantia:   gar.estado,
        garantia_dias_restantes: gar.dias_restantes,
      };
    }),
  };
};

const getComprasByProveedor = (proveedorId, sucursalId, negocioId) =>
  comprasRepo.findByProveedor(proveedorId, sucursalId, negocioId);

const getCompraById = async (negocioId, id) => {
  const compra = await comprasRepo.findByIdYNegocio(id, negocioId);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };
  const lineas = await comprasRepo.getLineas(id);

  // ── La ficha completa: plazo, deuda y garantía ───────────────────────────
  // Estaban todos guardados, pero repartidos: el plazo vive en el Cargo del
  // acreedor, la garantía en cada línea, y el saldo se deriva. Para verlos
  // había que abrir tres pantallas. Se resuelven con los MISMOS helpers que la
  // cartera y la procedencia — nunca con una cuenta propia.
  const { getConfigOrdenes } = require('../../middlewares/ordenesCompra.middleware');
  const { estadoGarantia }   = require('../procedencia/procedencia.service');
  const cfg = await getConfigOrdenes(negocioId);

  const { rows: cargo } = await pool.query(
    `SELECT m.id, m.valor, m.fecha_vencimiento,
            (m.fecha_vencimiento - CURRENT_DATE)::int AS dias_para_vencer,
            (SELECT COALESCE(SUM(ab.valor), 0) FROM movimientos_acreedor ab
             WHERE ab.cargo_id = m.id AND ab.tipo = 'Abono') AS abonado
     FROM movimientos_acreedor m
     WHERE m.compra_id = $1 AND m.tipo = 'Cargo' LIMIT 1`,
    [id]
  );

  const cg    = cargo[0] || null;
  const dias  = cg?.dias_para_vencer == null ? null : Number(cg.dias_para_vencer);
  const saldo = cg ? Math.max(Number(cg.valor) - Number(cg.abonado), 0) : 0;

  const estadoPago = () => {
    if (!cg) return 'sin_factura';
    if (saldo <= 0) return 'al_dia';       // pagada: conserva fecha pero no vence
    if (dias == null) return 'sin_plazo';
    if (dias < 0) return 'vencida';
    if (dias <= cfg.dias_aviso) return 'por_vencer';
    return 'al_dia';
  };

  // La garantía de la compra es la de la línea que vence PRIMERO: es la que
  // marca hasta cuándo se puede reclamar algo de este envío.
  const fechaCompra = new Date(compra.fecha);
  const vencimientos = lineas
    .filter((l) => l.garantia_dias != null)
    .map((l) => {
      const d = new Date(fechaCompra);
      d.setDate(d.getDate() + Number(l.garantia_dias));
      return d.toISOString().slice(0, 10);
    })
    .sort();

  return {
    ...compra,
    lineas,
    garantia_activa:   cfg.garantia_activa === true,
    cargo_id:          cg?.id ?? null,
    fecha_vencimiento: cg?.fecha_vencimiento ?? null,
    dias_para_vencer:  dias,
    abonado:           cg ? Number(cg.abonado) : 0,
    saldo,
    estado_pago:       estadoPago(),
    garantia_hasta:    vencimientos[0] ?? null,
    ...(vencimientos.length
      ? estadoGarantia(vencimientos[0], cfg.garantia_dias_aviso)
      : { estado: 'sin_garantia', dias_restantes: null }),
  };
};

// ── Helper: fecha local sin desfase UTC ───────────────────────────────────────
const _fechaHoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── Recepción contra una orden de compra ──────────────────────────────────────
// Valida que la orden sea recibible y que ninguna línea reciba de más. Se corre
// DENTRO de la transacción y con FOR UPDATE sobre la orden: sin el lock, dos
// recepciones simultáneas de la misma orden podrían pasar las dos validaciones
// y entre ambas recibir el doble de lo pedido.
//
// Lo recibido se DERIVA de lineas_compra (nunca hay un contador guardado que
// pueda quedar desfasado cuando se cancela o se devuelve una recepción).
const _validarRecepcionContraOrden = async (client, { orden_compra_id, negocio_id, sucursal_id, lineas }) => {
  const { rows: ordenRows } = await client.query(
    `SELECT id, numero, estado, sucursal_id, proveedor_id, fecha_vencimiento
     FROM ordenes_compra
     WHERE id = $1 AND negocio_id = $2
     FOR UPDATE`,
    [orden_compra_id, negocio_id]
  );
  const orden = ordenRows[0];
  if (!orden) throw { status: 404, message: 'Orden de compra no encontrada' };

  if (orden.sucursal_id !== sucursal_id) {
    throw { status: 400, message: 'La orden pertenece a otra sucursal' };
  }
  if (orden.estado === 'Borrador') {
    throw { status: 409, message: `La orden #${orden.numero ?? orden.id} todavía es un borrador. Emítela antes de recibir mercancía.` };
  }
  if (orden.estado !== 'Emitida') {
    throw { status: 409, message: `La orden #${orden.numero ?? orden.id} está ${orden.estado.toLowerCase()}; no admite más recepciones` };
  }

  // Cuánto se ha recibido ya en cada línea pedida (descontando devoluciones y
  // recepciones canceladas).
  // El FILTER es lo que descuenta las recepciones canceladas: el LEFT JOIN no
  // descarta la fila de lineas_compra cuando la compra está cancelada, solo deja
  // `c.*` en NULL, así que sin él una cancelación no devolvería nada a pendiente.
  //
  // Y tiene que ser FILTER y no un WHERE: con un WHERE, una línea cuyas
  // recepciones fueron TODAS canceladas se caería del resultado entero y esta
  // validación la rechazaría como ajena a la orden — justo la línea que hay que
  // poder volver a recibir.
  const { rows: avance } = await client.query(
    `SELECT loc.id,
            loc.nombre_producto,
            loc.cantidad_pedida,
            loc.variante_id,
            loc.atributo_id,
            COALESCE(
              SUM(lc.cantidad - COALESCE(lc.cantidad_devuelta, 0))
                FILTER (WHERE c.id IS NOT NULL),
              0
            ) AS recibida
     FROM      lineas_orden_compra loc
     LEFT JOIN lineas_compra lc ON lc.orden_linea_id = loc.id
     LEFT JOIN compras       c  ON c.id = lc.compra_id AND c.estado <> 'Cancelada'
     WHERE loc.orden_id = $1
     GROUP BY loc.id`,
    [orden_compra_id]
  );
  const porLinea = new Map(avance.map((a) => [Number(a.id), a]));

  // ── Conciliación por NODO ──────────────────────────────────────────────────
  //
  // Hasta ahora esto solo sumaba cantidades por `orden_linea_id` y jamás miraba
  // QUÉ llegó. Si la orden pedía la variante de 25W y el proveedor mandaba la de
  // 20W, la recepción escribía el nodo del 20W, lo atribuía a la línea del 25W y
  // la orden se marcaba cumplida: el inventario quedaba bien y el pedido quedaba
  // mintiendo, sin que nadie se enterara nunca.
  //
  // Los dos desenlaces raros exigen que alguien diga que sí. No se guardan: que
  // la fila exista ya prueba que se confirmaron, porque sin el flag esto
  // responde 409 y no se escribe nada.
  const solicitado  = new Map();   // orden_linea_id -> unidades de esta recepción
  const sustituidas = new Map();   // orden_linea_id -> { pedido, recibido, cantidad }
  const permiteExceso = new Set(); // orden_linea_id que aceptaron el sobrante

  for (const l of lineas) {
    if (l.orden_linea_id == null) continue;
    const id = Number(l.orden_linea_id);
    const pedida = porLinea.get(id);
    if (!pedida) {
      throw { status: 400, message: `Una de las líneas no pertenece a la orden #${orden.numero ?? orden.id}` };
    }

    solicitado.set(id, (solicitado.get(id) || 0) + Number(l.cantidad || 0));
    if (l.excedente_ok === true) permiteExceso.add(id);

    if (!esSustitucion(pedida, l)) continue;

    // Las etiquetas se leen AQUÍ y se congelan: la novedad tiene que seguir
    // diciendo la verdad aunque mañana renombren la talla.
    const [etqPedido, etqRecibido] = await Promise.all([
      etiquetaNodo(client, pedida),
      etiquetaNodo(client, l),
    ]);

    if (l.sustituye !== true) {
      throw {
        status: 409,
        code: 'NODO_DISTINTO',
        message: `De "${pedida.nombre_producto}" pediste ${etqPedido || 'el producto'} `
          + `y está llegando ${etqRecibido || 'el producto sin variante'}. `
          + 'Confirma que aceptas el cambio, o recíbelo como compra aparte.',
        detalle: { orden_linea_id: id, pedido: etqPedido, recibido: etqRecibido },
      };
    }

    const acum = sustituidas.get(id) || { pedido: etqPedido, recibido: etqRecibido, cantidad: 0 };
    acum.cantidad += Number(l.cantidad || 0);
    acum.nombre_producto = pedida.nombre_producto;
    sustituidas.set(id, acum);
  }

  // ── El exceso deja de ser un muro ─────────────────────────────────────────
  //
  // Antes esto era un 400 seco que mandaba a "registrarlas como compra aparte"
  // —mientras la pantalla del bodeguero le prometía que el sobrante "queda
  // anotado en la entrada"—. Ahora es una decisión suya: recibirlo o devolverlo.
  //
  // Recibirlo NO necesita columna: `recibida - cantidad_pedida` ya lo dice, y
  // `AVANCE_POR_ORDEN` ya lo acota con LEAST para que la orden no pase del 100 %.
  const excesos = [];
  for (const [lineaId, cantidad] of solicitado) {
    const linea = porLinea.get(lineaId);
    const pendiente = Number(linea.cantidad_pedida) - Number(linea.recibida);
    if (cantidad <= pendiente) continue;

    const sobra = cantidad - pendiente;
    if (!permiteExceso.has(lineaId)) {
      throw {
        status: 409,
        code: 'EXCESO',
        message: `De ${linea.nombre_producto} solo faltan ${Math.max(pendiente, 0)} de `
          + `${linea.cantidad_pedida} y estás recibiendo ${cantidad}. `
          + 'Confirma que recibes las de más, o devuélveselas al proveedor.',
        detalle: { orden_linea_id: lineaId, pendiente: Math.max(pendiente, 0), recibiendo: cantidad, sobra },
      };
    }
    excesos.push({ orden_linea_id: lineaId, nombre_producto: linea.nombre_producto, cantidad: sobra });
  }

  return { orden, sustituciones: [...sustituidas.entries()].map(([id, v]) => ({ orden_linea_id: id, ...v })), excesos };
};

/**
 * Escribe en `novedades_proveedor` lo que se salió del guion de la orden.
 *
 * NUNCA lanza por sí misma: la tabla es de 20260806 y un negocio que no la
 * tenga no puede quedarse sin poder recibir mercancía por culpa de su bitácora.
 * Se comprueba ANTES de insertar y no con un try/catch alrededor, porque dentro
 * de una transacción abortada atrapar el error no salva lo que viene después —
 * es la misma lección que dejó `movimientos_ubicacion`.
 *
 * Las etiquetas llegan ya congeladas desde la conciliación.
 */
const _registrarNovedadesRecepcion = async (client, {
  negocio_id, proveedor_id, usuario_id, compra_id, orden_id,
  sustituciones = [], excesos = [],
}) => {
  if (!proveedor_id) return;
  if (sustituciones.length === 0 && excesos.length === 0) return;

  const { rows: existe } = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'novedades_proveedor'`
  );
  if (!existe.length) return;

  for (const sub of sustituciones) {
    await client.query(
      `INSERT INTO novedades_proveedor
         (negocio_id, proveedor_id, tipo, orden_id, orden_linea_id, compra_id,
          cantidad, texto, pedido_etiqueta, recibido_etiqueta, usuario_id)
       VALUES ($1, $2, 'sustitucion', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [negocio_id, proveedor_id, orden_id, sub.orden_linea_id, compra_id,
       sub.cantidad,
       `${sub.nombre_producto}: se pidió ${sub.pedido || 'el producto'} y llegó ${sub.recibido || 'otra cosa'}`,
       sub.pedido, sub.recibido, usuario_id]
    );
  }

  for (const ex of excesos) {
    await client.query(
      `INSERT INTO novedades_proveedor
         (negocio_id, proveedor_id, tipo, orden_id, orden_linea_id, compra_id,
          cantidad, texto, usuario_id)
       VALUES ($1, $2, 'exceso', $3, $4, $5, $6, $7, $8)`,
      [negocio_id, proveedor_id, orden_id, ex.orden_linea_id, compra_id,
       ex.cantidad,
       `${ex.nombre_producto}: llegaron ${ex.cantidad} de más y se recibieron`,
       usuario_id]
    );
  }
};

const registrarCompra = async ({
  negocio_id, sucursal_id, usuario_id, proveedor_id,
  numero_factura, notas, lineas,
  total: totalRecibido, pagos = [],
  registrar_en_caja = true,
  orden_compra_id = null,
  // Compromiso de pago de una compra SUELTA (sin orden). Se le olvidó a alguien
  // crear la orden, o el negocio no las usa, pero la factura del proveedor
  // igual vence: sin esto esa deuda no saldría nunca en el semáforo ni en el
  // aviso de la mañana.
  fecha_factura = null,
  dias_plazo = null,
  fecha_vencimiento = null,
  // Una Entrada de bodega nace sin confirmar; todo lo demas nace confirmado.
  factura_confirmada = true,
  es_entrada = false,
}) => {
  // ── Verificar sucursal pertenece al negocio ──────────────────────────────
  const { rows: sucRows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!sucRows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  // ── Verificar proveedor pertenece al negocio ─────────────────────────────
  // Una Entrada de bodega sin orden previa llega SIN proveedor: lo asigna
  // administración al confirmar la factura. Todo el cuerpo de abajo ya lo
  // trataba como opcional (`if (proveedor_id)` alrededor del bloque del
  // acreedor); lo único que lo impedía era esta verificación y el validador de
  // la ruta.
  let prov = null;
  if (proveedor_id) {
    const { rows: provRows } = await pool.query(
      `SELECT id, nombre, nit, telefono FROM proveedores
       WHERE id = $1 AND negocio_id = $2 AND activo = true`,
      [proveedor_id, negocio_id]
    );
    if (!provRows.length) throw { status: 403, message: 'Proveedor no válido para este negocio' };
    prov = provRows[0];
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Recepción contra una orden: valida y bloquea la orden antes de tocar nada.
    let ordenDeLaCompra = null;
    let novedadesOrden  = { sustituciones: [], excesos: [] };
    if (orden_compra_id) {
      const conciliacion = await _validarRecepcionContraOrden(client, {
        orden_compra_id, negocio_id, sucursal_id, lineas,
      });
      ordenDeLaCompra = conciliacion.orden;
      novedadesOrden  = conciliacion;
    }

    const total = totalRecibido ||
      lineas.reduce((sum, l) => sum + l.cantidad * l.precio_unitario, 0);

      const metodoPago = pagos.length > 0 ? pagos[0].metodo : null;

    const compra = await comprasRepo.create(client, {
      sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas,
      registrar_en_caja, metodo: metodoPago, orden_compra_id, factura_confirmada,
      es_entrada,
    });

    for (const linea of lineas) {
      await comprasRepo.insertarLinea(client, {
        compra_id:         compra.id,
        nombre_producto:   linea.nombre_producto,
        imei:              linea.imei              || null,
        cantidad:          linea.cantidad,
        precio_unitario:   linea.precio_unitario,
        precio_usd:        linea.precio_usd        || null,
        factor_conversion: linea.factor_conversion || null,
        valor_traida:      linea.valor_traida      || null,
        variante_id:       linea.variante_id       || null,
        atributo_id:       linea.atributo_id       || null,
        // Solo para productos de cantidad; los seriales se identifican por imei
        producto_id:       linea.imei ? null : (linea.producto_id || null),
        orden_linea_id:    linea.orden_linea_id    || null,
        // El plazo se CONGELA aquí: el reloj de la garantía arranca cuando la
        // mercancía entra, y cambiar después el default del proveedor no puede
        // alterar una garantía ya otorgada.
        garantia_dias:     linea.garantia_dias     ?? null,
      });

      if (linea.imei) {
        if (linea.reactivar_serial_id) {
          const { rows } = await client.query(
            `SELECT s.id, s.vendido, s.prestado FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             WHERE s.id = $1 AND ps.sucursal_id = $2`,
            [linea.reactivar_serial_id, sucursal_id]
          );
          if (!rows.length) {
            throw { status: 400, message: `El serial ${linea.imei} no pertenece a esta sucursal` };
          }
          if (rows[0].prestado) {
            throw { status: 409, code: 'IMEI_PRESTADO', message: `El IMEI ${linea.imei} está prestado. Ve a la pestaña de Préstamos y regístralo como devuelto para que regrese al inventario.` };
          }
          if (!rows[0].vendido) {
            throw { status: 409, message: `El IMEI ${linea.imei} ya está registrado y disponible en el inventario.` };
          }
          // COALESCE preserva el color/caracteristicas existente si no viene uno nuevo
          await client.query(
            `UPDATE seriales
             SET vendido         = false,
                 prestado        = false,
                 fecha_salida    = NULL,
                 costo_compra    = $1,
                 proveedor_id    = COALESCE($2, proveedor_id),
                 color           = COALESCE($3, color),
                 caracteristicas = COALESCE($4, caracteristicas)
             WHERE id = $5`,
            [
              linea.precio_unitario,
              proveedor_id || null,
              linea.color || null,
              linea.caracteristicas ? JSON.stringify(linea.caracteristicas) : null,
              linea.reactivar_serial_id,
            ]
          );
        } else {
          const { rows: existente } = await client.query(
            `SELECT s.id FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             JOIN sucursales       su ON su.id = ps.sucursal_id
             WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2`,
            [linea.imei, negocio_id]
          );
          if (existente.length) {
            throw { status: 409, message: `El IMEI ${linea.imei} ya existe en el inventario` };
          }

          if (linea.producto_id) {
            const { rows: psRows } = await client.query(
              'SELECT id FROM productos_serial WHERE id = $1 AND sucursal_id = $2',
              [linea.producto_id, sucursal_id]
            );
            if (!psRows.length) {
              throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
            }
          }

          await client.query(
            `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, proveedor_id, color, caracteristicas)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              linea.producto_id,
              linea.imei,
              _fechaHoy(),
              linea.precio_unitario,
              proveedor_id || null,
              linea.color  || null,
              linea.caracteristicas ? JSON.stringify(linea.caracteristicas) : null,
            ]
          );
        }

      } else if (linea.producto_id) {
        const { rows: prodRows } = await client.query(
          `SELECT id, stock, costo_unitario, sucursal_id FROM productos_cantidad WHERE id = $1`,
          [linea.producto_id]
        );
        const producto = prodRows[0];
        if (!producto) throw { status: 404, message: `Producto ${linea.nombre_producto} no encontrado` };
        if (producto.sucursal_id !== sucursal_id) {
          throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
        }

        if (linea.variante_id) {
          const { rows: varRows } = await client.query(
            'SELECT stock, costo_unitario FROM variantes_atributo WHERE id = $1',
            [linea.variante_id]
          );
          const variante = varRows[0];
          await variantesRepo.ajustarStockVarianteEnTx(client, linea.variante_id, linea.cantidad);
          await variantesRepo.sincronizarStockProductoEnTx(client, linea.producto_id);
          if (linea.precio_unitario != null && linea.precio_unitario > 0) {
            const costoPromedio = calcularCostoPromedio(
              variante.stock, variante.costo_unitario,
              linea.cantidad, linea.precio_unitario,
            );
            await variantesRepo.actualizarCostoVarianteEnTx(client, linea.variante_id, costoPromedio);
            await variantesRepo.sincronizarCostoProductoEnTx(client, linea.producto_id, costoPromedio);
          }
        } else if (linea.atributo_id) {
          const { rows: atrRows } = await client.query(
            'SELECT stock, costo_unitario FROM atributos_producto WHERE id = $1',
            [linea.atributo_id]
          );
          const atributo = atrRows[0];
          await variantesRepo.ajustarStockAtributoEnTx(client, linea.atributo_id, linea.cantidad);
          await variantesRepo.sincronizarStockProductoEnTx(client, linea.producto_id);
          if (linea.precio_unitario != null && linea.precio_unitario > 0) {
            const costoPromedio = calcularCostoPromedio(
              atributo.stock, atributo.costo_unitario,
              linea.cantidad, linea.precio_unitario,
            );
            await variantesRepo.actualizarCostoAtributoEnTx(client, linea.atributo_id, costoPromedio);
            await variantesRepo.sincronizarCostoProductoEnTx(client, linea.producto_id, costoPromedio);
          }
        } else {
          await comprasRepo.ajustarStockCantidad(client, linea.producto_id, linea.cantidad);
          if (linea.precio_unitario != null && linea.precio_unitario > 0) {
            const costoPromedio = calcularCostoPromedio(
              producto.stock, producto.costo_unitario,
              linea.cantidad, linea.precio_unitario,
            );
            await comprasRepo.actualizarCostoPromedio(client, linea.producto_id, costoPromedio);
          }
        }

        if (proveedor_id) {
          await client.query(
            `UPDATE productos_cantidad SET proveedor_id = $1
             WHERE id = $2 AND proveedor_id IS NULL`,
            [proveedor_id, linea.producto_id]
          );
        }
      }
    }

    // ── Acreedor ───────────────────────────────────────────────────────────
    let acreedorIdCompra = null;
    let cargoIdCompra    = null;
    if (proveedor_id) {
      // 'Divisa' se maneja aparte: sale de la cuenta Divisa (USD) de Tesorería
      // con su propio abono espejo, no del abono de caja.
      const pagosEfectivos = pagos.filter((p) => !['Credito', 'Fiado', 'Divisa'].includes(p.metodo));
      const totalPagado    = pagosEfectivos.reduce((s, p) => s + Number(p.valor || 0), 0);

      let { rows: acrRows } = await client.query(
        `SELECT id FROM acreedores WHERE negocio_id = $1 AND proveedor_id = $2 LIMIT 1`,
        [negocio_id, proveedor_id]
      );

      if (acrRows.length === 0 && prov?.nit) {
        const { rows: acrPorCedula } = await client.query(
          `SELECT id FROM acreedores WHERE negocio_id = $1 AND cedula = $2 LIMIT 1`,
          [negocio_id, prov.nit]
        );
        if (acrPorCedula.length) {
          acrRows = acrPorCedula;
          await client.query(
            `UPDATE acreedores SET proveedor_id = $1 WHERE id = $2 AND proveedor_id IS NULL`,
            [proveedor_id, acrPorCedula[0].id]
          );
        }
      }

      let acreedorId;
      if (acrRows.length) {
        acreedorId = acrRows[0].id;
      } else {
        const cedulaFinal = prov?.nit || `prov-${proveedor_id}`;
        const { rows: nuevoRows } = await client.query(
          `INSERT INTO acreedores(negocio_id, nombre, cedula, telefono, proveedor_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [negocio_id, prov?.nombre, cedulaFinal, prov?.telefono || '', proveedor_id]
        );
        acreedorId = nuevoRows[0].id;
      }

      // ── ¿Cuándo nace la deuda? ────────────────────────────────────────────
      // Dos modos, configurables por negocio en Ajustes:
      //
      //   'recepcion' (default) → cada recepción crea su propio Cargo. Es el
      //       comportamiento de siempre y el único que existe sin órdenes. Sirve
      //       cuando el proveedor factura cada entrega, que es lo normal en
      //       distribución.
      //
      //   'orden' → el Cargo nació al registrar la factura de la orden, antes de
      //       que llegara nada, y las recepciones NO crean cargo propio. Sirve
      //       cuando el proveedor factura el pedido completo por adelantado.
      //
      // Solo se consulta el modo si esta compra viene de una orden: una compra
      // suelta siempre crea su cargo, sin importar la configuración.
      let cargoId = null;

      if (orden_compra_id) {
        const { modo_cargo } = await getConfigOrdenes(negocio_id);
        if (modo_cargo === 'orden') {
          const { rows: cargoOrden } = await client.query(
            `SELECT id FROM movimientos_acreedor
             WHERE orden_compra_id = $1 AND tipo = 'Cargo' LIMIT 1`,
            [orden_compra_id]
          );
          if (!cargoOrden.length) {
            // Sin cargo en la orden, esta recepción metería mercancía sin deuda
            // asociada. Crear uno aquí produciría doble cobro cuando se registre
            // la factura, así que se para y se dice qué falta.
            throw {
              status: 409,
              code: 'ORDEN_SIN_FACTURA',
              message: 'Tu negocio registra la deuda al facturar la orden completa, '
                + 'y esta orden todavía no tiene factura. Regístrala antes de recibir la mercancía.',
            };
          }
          cargoId = cargoOrden[0].id;
        }
      }

      if (!cargoId) {
        // Vencimiento del cargo, en este orden:
        //   1. el que se registró en ESTA compra (una compra suelta con plazo)
        //   2. el de la orden, si viene de una — la factura del proveedor vence
        //      el mismo día llegue la mercancía en una entrega o en tres
        //   3. ninguno: no todas las compras tienen plazo, y eso está bien
        const vencimientoPropio = resolverVencimiento({
          fecha_factura, dias_plazo, fecha_vencimiento,
        });

        const { rows: cargoRows } = await client.query(
          `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, descripcion, valor, compra_id, sucursal_id, orden_compra_id, fecha_vencimiento)
           VALUES ($1, $2, 'Cargo', $3, $4, $5, $6, $7, $8) RETURNING id`,
          [acreedorId, usuario_id, `Compra #${compra.numero ?? compra.id} — mercancía`, total, compra.id, sucursal_id, orden_compra_id,
           vencimientoPropio || ordenDeLaCompra?.fecha_vencimiento || null]
        );
        cargoId = cargoRows[0].id;
      }

      acreedorIdCompra = acreedorId;
      cargoIdCompra    = cargoId;

      // Si hubo pago inmediato (Contado / Transferencia / mezcla), crear Abono
      // vinculado al cargo. Lleva compra_id además de cargo_id porque en modo
      // 'orden' el cargo es de la orden y es compartido: sin compra_id, cancelar
      // esta recepción no sabría cuál de los abonos borrar.
      if (totalPagado > 0) {
        const metodoPagoInmediato = pagosEfectivos.map((p) => p.metodo).join('/') || null;
        await client.query(
          `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, descripcion, valor, cargo_id, compra_id, metodo, registrar_en_caja, sucursal_id)
           VALUES ($1, $2, 'Abono', $3, $4, $5, $6, $7, $8, $9)`,
          [acreedorId, usuario_id, 'Pago al momento de la compra', totalPagado, cargoId, compra.id, metodoPagoInmediato, registrar_en_caja !== false, sucursal_id]
        );
      }
    }

    // ── Pago en divisa (US$) vía Tesorería ────────────────────────────────
    // La salida se registra EN DÓLARES en la cuenta Divisa de la sucursal
    // (se crea si no existe) con la tasa implícita del pago. Si hay cargo de
    // acreedor, un abono espejo (registrar_en_caja = FALSE) salda esa parte
    // de la deuda sin doble descuento en caja/tesorería.
    const pagoDivisa = pagos.find((p) => p.metodo === 'Divisa' && Number(p.valor) > 0);
    if (pagoDivisa) {
      const valorCop = Number(pagoDivisa.valor);
      const valorUsd = Number(pagoDivisa.valor_usd);
      if (!(valorUsd > 0)) {
        throw { status: 400, message: 'Indica cuántos dólares se entregaron en el pago con divisa' };
      }

      let { rows: divisaRows } = await client.query(
        `SELECT id FROM cuentas_dinero
         WHERE negocio_id = $1 AND sucursal_id = $2 AND moneda = 'USD' AND activa
         ORDER BY id LIMIT 1`,
        [negocio_id, sucursal_id]
      );
      if (!divisaRows.length) {
        const { rows: nueva } = await client.query(
          `INSERT INTO cuentas_dinero (negocio_id, sucursal_id, nombre, tipo, moneda)
           VALUES ($1, $2, 'Divisa (USD)', 'divisa', 'USD') RETURNING id`,
          [negocio_id, sucursal_id]
        );
        divisaRows = nueva;
      }

      // Si el usuario escribió la tasa (modo "Por tasa"), se conserva EXACTA;
      // si no, se deriva de los montos (pesos abonados ÷ dólares entregados).
      const tasaInput = Number(pagoDivisa.tasa);
      const tasa = tasaInput > 0 ? tasaInput : Math.round((valorCop / valorUsd) * 10000) / 10000;
      const { rows: movRows } = await client.query(
        `INSERT INTO movimientos_dinero
           (cuenta_id, tipo, categoria, valor, concepto, usuario_id, tasa_cambio, proveedor_id, compra_id)
         VALUES ($1, 'salida', 'mercancia', $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [divisaRows[0].id, valorUsd,
         `Pago compra #${compra.numero ?? compra.id}${prov?.nombre ? ` — ${prov.nombre}` : ''} (US$ ${valorUsd})`,
         usuario_id, tasa, proveedor_id || null, compra.id]
      );

      if (cargoIdCompra) {
        await client.query(
          `INSERT INTO movimientos_acreedor
             (acreedor_id, usuario_id, tipo, descripcion, valor, cargo_id, metodo,
              registrar_en_caja, sucursal_id, mov_dinero_id)
           VALUES ($1, $2, 'Abono', $3, $4, $5, 'Divisa', FALSE, $6, $7)`,
          [acreedorIdCompra, usuario_id,
           `Pago en divisa al momento de la compra (US$ ${valorUsd})`,
           valorCop, cargoIdCompra, sucursal_id, movRows[0].id]
        );
      }
    }

    // ── La bitácora del proveedor ─────────────────────────────────────────
    // Va DENTRO de la transacción y a propósito: una sustitución aceptada que
    // no quedara registrada es exactamente el silencio que este trabajo vino a
    // romper — el inventario quedaría bien y nadie sabría nunca que el
    // proveedor mandó otra cosa.
    //
    // Cuelga del PROVEEDOR y no de la orden (novedades_proveedor ya era así):
    // "este proveedor siempre me cambia las características" es la pregunta que
    // de verdad importa, y con la bitácora dentro de la orden esa historia
    // quedaría partida en pedazos.
    await _registrarNovedadesRecepcion(client, {
      negocio_id, proveedor_id, usuario_id, compra_id: compra.id,
      orden_id: orden_compra_id, ...novedadesOrden,
    });

    await client.query('COMMIT');
    return compra;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const cancelarCompra = async (negocioId, compraId) => {
  const compra = await comprasRepo.findByIdYNegocio(compraId, negocioId);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };
  if (compra.estado === 'Cancelada') throw { status: 400, message: 'La compra ya está cancelada' };

  const lineas = await comprasRepo.getLineas(compraId);

  // Validar que ningún serial haya sido vendido o prestado antes de cancelar
  const imeisConflictivos = [];
  for (const linea of lineas) {
    if (!linea.imei) continue;
    const { rows } = await pool.query(
      `SELECT s.vendido, s.prestado FROM seriales s
       JOIN productos_serial ps ON ps.id = s.producto_id
       JOIN sucursales       su ON su.id = ps.sucursal_id
       WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
      [linea.imei, negocioId]
    );
    if (rows.length && (rows[0].vendido || rows[0].prestado)) {
      const estado = rows[0].vendido ? 'vendido' : 'prestado';
      imeisConflictivos.push(`${linea.imei} (${estado})`);
    }
  }
  if (imeisConflictivos.length > 0) {
    throw {
      status: 400,
      message: `No se puede cancelar la compra. Los siguientes IMEI ya fueron vendidos o están prestados: ${imeisConflictivos.join(', ')}`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Marcar compra como cancelada
    await comprasRepo.marcarCancelada(client, compraId);

    // 2. Eliminar cargo y abonos del acreedor vinculados a esta compra.
    //
    // Los abonos se borran SIEMPRE por compra_id, no solo cuando hay cargo
    // propio: en modo de cargo 'orden' esta compra es una recepción sin cargo
    // suyo, y sus pagos y notas crédito cuelgan del cargo compartido de la
    // orden. Sin esta rama, cancelar la recepción dejaría vivos unos abonos que
    // seguirían saldando una deuda de la que ya no hay mercancía.
    await client.query(
      `DELETE FROM movimientos_acreedor WHERE compra_id = $1 AND tipo = 'Abono'`,
      [compraId]
    );

    const { rows: cargoRows } = await client.query(
      `SELECT id FROM movimientos_acreedor WHERE compra_id = $1 AND tipo = 'Cargo' LIMIT 1`,
      [compraId]
    );
    if (cargoRows.length) {
      const cargoId = cargoRows[0].id;
      // Abonos que apuntan a este cargo sin llevar compra_id (los históricos, y
      // los pagos hechos después desde la cuenta del proveedor).
      await client.query(
        `DELETE FROM movimientos_acreedor WHERE cargo_id = $1`,
        [cargoId]
      );
      // Luego el cargo mismo
      await client.query(
        `DELETE FROM movimientos_acreedor WHERE id = $1`,
        [cargoId]
      );
    }

    // 3. Revertir ítems del inventario
    for (const linea of lineas) {
      if (linea.imei) {
        // Serial: eliminar del inventario si aún no fue vendido ni prestado
        // Acotado al negocio: el mismo IMEI puede existir en otros negocios.
        await client.query(
          `DELETE FROM seriales s
           USING productos_serial ps, sucursales su
           WHERE s.producto_id = ps.id
             AND ps.sucursal_id = su.id
             AND su.negocio_id = $2
             AND s.imei = $1
             AND s.vendido = false
             AND s.prestado = false`,
          [linea.imei, negocioId]
        );
      } else if (linea.variante_id) {
        // Producto con variante: restar stock
        await client.query(
          `UPDATE variantes_atributo SET stock = GREATEST(0, stock - $1) WHERE id = $2`,
          [linea.cantidad, linea.variante_id]
        );
        // Sincronizar stock del producto padre
        const { rows: varRows } = await client.query(
          `SELECT producto_id FROM variantes_atributo WHERE id = $1`,
          [linea.variante_id]
        );
        if (varRows.length) {
          await client.query(
            `UPDATE productos_cantidad
             SET stock = (SELECT COALESCE(SUM(stock), 0) FROM variantes_atributo WHERE producto_id = $1)
             WHERE id = $1`,
            [varRows[0].producto_id]
          );
        }
      } else if (linea.atributo_id) {
        // Producto con atributo: restar stock
        await client.query(
          `UPDATE atributos_producto SET stock = GREATEST(0, stock - $1) WHERE id = $2`,
          [linea.cantidad, linea.atributo_id]
        );
        // Sincronizar stock del producto padre
        const { rows: atrRows } = await client.query(
          `SELECT producto_id FROM atributos_producto WHERE id = $1`,
          [linea.atributo_id]
        );
        if (atrRows.length) {
          await client.query(
            `UPDATE productos_cantidad
             SET stock = (SELECT COALESCE(SUM(stock), 0) FROM atributos_producto WHERE producto_id = $1)
             WHERE id = $1`,
            [atrRows[0].producto_id]
          );
        }
      } else if (linea.producto_id) {
        // Producto de cantidad simple (sin variante ni atributo): restar stock directamente
        await client.query(
          `UPDATE productos_cantidad SET stock = GREATEST(0, stock - $1) WHERE id = $2`,
          [linea.cantidad, linea.producto_id]
        );
      }
    }

    await client.query('COMMIT');
    return { id: compraId, estado: 'Cancelada' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Devolución total/parcial de mercancía a proveedor ─────────────────────────
// Revierte el inventario de las líneas indicadas (reusa la misma lógica probada
// de cancelarCompra) y registra una nota crédito en el acreedor: reduce la deuda
// del cargo de la compra y, si ya estaba pagada, el excedente queda como saldo a
// favor. NO afecta caja (es mercancía devuelta, no dinero).
const devolverCompra = async (negocioId, compraId, { lineas: lineasDevol, motivo, usuario_id }) => {
  if (!Array.isArray(lineasDevol) || lineasDevol.length === 0) {
    throw { status: 400, message: 'Debes indicar al menos una línea a devolver' };
  }

  const compra = await comprasRepo.findByIdYNegocio(compraId, negocioId);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };
  if (compra.estado === 'Cancelada') throw { status: 400, message: 'La compra está cancelada; no se puede devolver' };

  const lineasCompra = await comprasRepo.getLineas(compraId);
  const lineasById = new Map(lineasCompra.map((l) => [Number(l.id), l]));

  // Validar y normalizar las solicitudes de devolución.
  //
  // El tope es lo que queda SIN devolver, no la cantidad original: de lo
  // contrario dos devoluciones parciales de 30 sobre una línea de 40 pasarían
  // las dos y se le descontarían 60 unidades al proveedor.
  const solicitudes = [];
  for (const req of lineasDevol) {
    const linea = lineasById.get(Number(req.linea_id));
    if (!linea) throw { status: 400, message: `La línea ${req.linea_id} no pertenece a esta compra` };

    const yaDevuelta = Number(linea.cantidad_devuelta || 0);
    const pendiente  = Number(linea.cantidad) - yaDevuelta;

    if (pendiente <= 0) {
      throw {
        status: 400,
        message: `${linea.nombre_producto} ya fue devuelto en su totalidad en esta compra`,
      };
    }

    if (linea.imei) {
      solicitudes.push({ linea, cantidad: 1 });
    } else {
      const cant = Number(req.cantidad);
      if (!Number.isInteger(cant) || cant < 1 || cant > pendiente) {
        throw {
          status: 400,
          message: `Cantidad inválida para ${linea.nombre_producto} (entre 1 y ${pendiente}`
            + `${yaDevuelta > 0 ? `; ya devolviste ${yaDevuelta} de ${linea.cantidad}` : ''})`,
        };
      }
      solicitudes.push({ linea, cantidad: cant });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let valorDevuelto = 0;
    const detalle = [];

    for (const { linea, cantidad } of solicitudes) {
      if (linea.imei) {
        const { rows } = await client.query(
          `SELECT s.id, s.vendido, s.prestado FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           JOIN sucursales       su ON su.id = ps.sucursal_id
           WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
          [linea.imei, negocioId]
        );
        if (!rows.length) throw { status: 400, message: `El equipo ${linea.imei} ya no está en el inventario` };
        if (rows[0].vendido || rows[0].prestado) {
          throw { status: 400, message: `El equipo ${linea.imei} ya fue ${rows[0].vendido ? 'vendido' : 'prestado'} y no se puede devolver` };
        }
        await client.query(`DELETE FROM seriales WHERE id = $1`, [rows[0].id]);

      } else if (linea.variante_id) {
        const { rows } = await client.query(`SELECT stock, producto_id FROM variantes_atributo WHERE id = $1`, [linea.variante_id]);
        if (!rows.length || Number(rows[0].stock) < cantidad) {
          throw { status: 400, message: `Stock insuficiente para devolver ${linea.nombre_producto}` };
        }
        await client.query(`UPDATE variantes_atributo SET stock = stock - $1 WHERE id = $2`, [cantidad, linea.variante_id]);
        await client.query(
          `UPDATE productos_cantidad
           SET stock = (SELECT COALESCE(SUM(stock), 0) FROM variantes_atributo WHERE producto_id = $1)
           WHERE id = $1`,
          [rows[0].producto_id]
        );

      } else if (linea.atributo_id) {
        const { rows } = await client.query(`SELECT stock, producto_id FROM atributos_producto WHERE id = $1`, [linea.atributo_id]);
        if (!rows.length || Number(rows[0].stock) < cantidad) {
          throw { status: 400, message: `Stock insuficiente para devolver ${linea.nombre_producto}` };
        }
        await client.query(`UPDATE atributos_producto SET stock = stock - $1 WHERE id = $2`, [cantidad, linea.atributo_id]);
        await client.query(
          `UPDATE productos_cantidad
           SET stock = (SELECT COALESCE(SUM(stock), 0) FROM atributos_producto WHERE producto_id = $1)
           WHERE id = $1`,
          [rows[0].producto_id]
        );

      } else if (linea.producto_id) {
        const { rows } = await client.query(`SELECT stock FROM productos_cantidad WHERE id = $1`, [linea.producto_id]);
        if (!rows.length || Number(rows[0].stock) < cantidad) {
          throw { status: 400, message: `Stock insuficiente para devolver ${linea.nombre_producto}` };
        }
        await client.query(`UPDATE productos_cantidad SET stock = stock - $1 WHERE id = $2`, [cantidad, linea.producto_id]);
      }

      // Dejar registrado en la LÍNEA qué unidades volvieron. Antes esto solo
      // existía como texto libre en la descripción del movimiento del acreedor,
      // y eso rompía dos cosas: el avance de una orden marcaba 100/100 después
      // de devolver 40 unidades, y la procedencia le atribuía a un proveedor
      // unidades que ya le habían regresado — el peor error posible en una
      // pantalla cuyo propósito es señalar responsables.
      await client.query(
        `UPDATE lineas_compra
         SET cantidad_devuelta = COALESCE(cantidad_devuelta, 0) + $1
         WHERE id = $2`,
        [cantidad, linea.id]
      );

      const sub = cantidad * Number(linea.precio_unitario);
      valorDevuelto += sub;
      detalle.push({ linea_id: linea.id, nombre: linea.nombre_producto, cantidad, valor: sub });
    }

    // ── Nota crédito en el acreedor ─────────────────────────────────────────
    // El cargo contra el que se abona depende del modo de cargo del negocio:
    //   'recepcion' → cada compra tiene el suyo (lo normal, y lo único que
    //                 existía antes de las órdenes)
    //   'orden'     → la compra es una recepción sin cargo propio; la deuda
    //                 nació al facturar la orden, y ahí va la nota crédito
    // Se busca en ese orden para que el modo 'recepcion' ni se entere.
    const { rows: cargoRows } = await client.query(
      `SELECT id, acreedor_id, valor FROM movimientos_acreedor
       WHERE compra_id = $1 AND tipo = 'Cargo' LIMIT 1`,
      [compraId]
    );
    if (!cargoRows.length && compra.orden_compra_id) {
      const { rows: cargoOrden } = await client.query(
        `SELECT id, acreedor_id, valor FROM movimientos_acreedor
         WHERE orden_compra_id = $1 AND tipo = 'Cargo' LIMIT 1`,
        [compra.orden_compra_id]
      );
      cargoRows.push(...cargoOrden);
    }

    if (cargoRows.length && valorDevuelto > 0) {
      const cargo = cargoRows[0];

      // Tope: no se puede devolver más valor del que vale la compra
      const { rows: yaDevRows } = await client.query(
        `SELECT COALESCE(SUM(valor), 0) AS dev FROM movimientos_acreedor
         WHERE compra_id = $1 AND tipo = 'Abono' AND metodo = 'Devolución'`,
        [compraId]
      );
      if (Number(yaDevRows[0].dev) + valorDevuelto > Number(cargo.valor) + 0.001) {
        throw { status: 400, message: 'La devolución supera el valor pendiente de devolver de esta compra' };
      }

      // Saldo pendiente del cargo (lo que aún se debe de esta compra)
      const { rows: abRows } = await client.query(
        `SELECT COALESCE(SUM(valor), 0) AS ab FROM movimientos_acreedor
         WHERE cargo_id = $1 AND tipo = 'Abono'`,
        [cargo.id]
      );
      const saldoPendiente = Math.max(0, Number(cargo.valor) - Number(abRows[0].ab));
      const desc = `Devolución de mercancía — compra #${compra.numero ?? compraId}${motivo ? ` (${motivo})` : ''}`;

      const abonoAlCargo = Math.min(valorDevuelto, saldoPendiente);
      if (abonoAlCargo > 0) {
        await client.query(
          `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, valor, descripcion, compra_id, cargo_id, metodo, registrar_en_caja, sucursal_id)
           VALUES ($1, $2, 'Abono', $3, $4, $5, $6, 'Devolución', false, $7)`,
          [cargo.acreedor_id, usuario_id || null, abonoAlCargo, desc, compraId, cargo.id, compra.sucursal_id]
        );
      }

      const excedente = valorDevuelto - abonoAlCargo;
      if (excedente > 0) {
        // Ya estaba pagada → el excedente queda como saldo a favor del negocio
        await client.query(
          `INSERT INTO movimientos_acreedor(acreedor_id, usuario_id, tipo, valor, descripcion, compra_id, cargo_id, metodo, registrar_en_caja, sucursal_id)
           VALUES ($1, $2, 'Abono', $3, $4, $5, NULL, 'Devolución', false, $6)`,
          [cargo.acreedor_id, usuario_id || null, excedente, `${desc} (saldo a favor)`, compraId, compra.sucursal_id]
        );
      }
    }

    await client.query('COMMIT');
    return { compra_id: compraId, valor_devuelto: valorDevuelto, detalle };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Ajuste de costo promedio ante una corrección de precio ────────────────────
// Reparte el delta de precio (nuevo − viejo) de la línea sobre el stock ACTUAL.
// Tope: nunca corrige más de |deltaUnit| por unidad (usa min(cantidad, stock)),
// de modo que una venta previa no sobre-corrija el promedio. Si no hay stock,
// devuelve null (no hay inventario que revaluar). Nunca produce costo negativo.
const _ajustarCostoPromedioDelta = (stockActual, costoActual, cantidad, deltaUnit) => {
  const stock = Math.max(0, Number(stockActual) || 0);
  if (stock === 0) return null;
  const unidades = Math.min(Math.max(0, Number(cantidad) || 0), stock);
  const nuevo = Number(costoActual || 0) + (deltaUnit * unidades) / stock;
  return Math.max(0, Math.round(nuevo));
};

// ── Corrección del precio de una o varias líneas de una compra ────────────────
// Caso de uso: alguien registró un precio equivocado y hay que corregirlo sin
// rehacer la compra. Cascada CONGRUENTE en una sola transacción:
//   1. lineas_compra.precio_unitario  (SET absoluto → idempotente)
//   2. costo del inventario:
//        · serial   → seriales.costo_compra (fila en inventario, o la más reciente)
//        · cantidad → costo_unitario ajustado por delta (variante/atributo/producto)
//   3. compras.total  (recalculado desde las líneas)
//   4. movimientos_acreedor Cargo.valor  (= nuevo total → recalcula la deuda)
// Idempotente: las líneas cuyo precio no cambia se omiten; en una segunda
// ejecución el delta es 0 y los SET quedan iguales.
const editarPreciosCompra = async (negocioId, compraId, { lineas: cambios, motivo, usuario_id }) => {
  if (!Array.isArray(cambios) || cambios.length === 0) {
    throw { status: 400, message: 'Debes indicar al menos una línea a editar' };
  }

  const compra = await comprasRepo.findByIdYNegocio(compraId, negocioId);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };
  if (compra.estado === 'Cancelada') {
    throw { status: 400, message: 'La compra está cancelada; no se pueden editar precios' };
  }

  const lineasCompra = await comprasRepo.getLineas(compraId);
  const lineasById = new Map(lineasCompra.map((l) => [Number(l.id), l]));

  // Validar y normalizar las solicitudes de cambio
  const solicitudes = [];
  for (const req of cambios) {
    const linea = lineasById.get(Number(req.linea_id));
    if (!linea) throw { status: 400, message: `La línea ${req.linea_id} no pertenece a esta compra` };
    const nuevo = Number(req.precio_unitario);
    if (!Number.isFinite(nuevo) || nuevo <= 0) {
      throw { status: 400, message: `Precio inválido para ${linea.nombre_producto}` };
    }
    solicitudes.push({ linea, precioNuevo: Math.round(nuevo) });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const editadas = [];
    const costoNoAjustado = [];

    for (const { linea, precioNuevo } of solicitudes) {
      const precioViejo = Math.round(Number(linea.precio_unitario));
      if (precioNuevo === precioViejo) continue;      // no-op → idempotente
      const deltaUnit = precioNuevo - precioViejo;

      // 1) Actualizar la línea de compra
      await client.query(
        `UPDATE lineas_compra SET precio_unitario = $1 WHERE id = $2 AND compra_id = $3`,
        [precioNuevo, linea.id, compraId]
      );

      // 2) Cascada al costo del inventario
      if (linea.imei) {
        // Serial: costo exacto por unidad. Se ancla al negocio por sucursal y se
        // prefiere la fila que sigue en inventario (no vendida/prestada); si ya
        // salió, la más reciente de ese IMEI. No se agrega por IMEI (fan-out).
        const { rows } = await client.query(
          `SELECT s.id FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND ps.sucursal_id = $2
           ORDER BY (s.vendido OR s.prestado) ASC, s.id DESC
           LIMIT 1`,
          [linea.imei, compra.sucursal_id]
        );
        if (rows.length) {
          await client.query(`UPDATE seriales SET costo_compra = $1 WHERE id = $2`, [precioNuevo, rows[0].id]);
        }

      } else if (linea.variante_id) {
        const { rows } = await client.query(
          `SELECT stock, costo_unitario, producto_id FROM variantes_atributo WHERE id = $1`,
          [linea.variante_id]
        );
        if (rows.length) {
          const nuevoCosto = _ajustarCostoPromedioDelta(rows[0].stock, rows[0].costo_unitario, linea.cantidad, deltaUnit);
          if (nuevoCosto == null) costoNoAjustado.push(linea.nombre_producto);
          else {
            await variantesRepo.actualizarCostoVarianteEnTx(client, linea.variante_id, nuevoCosto);
            await variantesRepo.sincronizarCostoProductoEnTx(client, rows[0].producto_id, nuevoCosto);
          }
        }

      } else if (linea.atributo_id) {
        const { rows } = await client.query(
          `SELECT stock, costo_unitario, producto_id FROM atributos_producto WHERE id = $1`,
          [linea.atributo_id]
        );
        if (rows.length) {
          const nuevoCosto = _ajustarCostoPromedioDelta(rows[0].stock, rows[0].costo_unitario, linea.cantidad, deltaUnit);
          if (nuevoCosto == null) costoNoAjustado.push(linea.nombre_producto);
          else {
            await variantesRepo.actualizarCostoAtributoEnTx(client, linea.atributo_id, nuevoCosto);
            await variantesRepo.sincronizarCostoProductoEnTx(client, rows[0].producto_id, nuevoCosto);
          }
        }

      } else if (linea.producto_id) {
        const { rows } = await client.query(
          `SELECT stock, costo_unitario FROM productos_cantidad WHERE id = $1`,
          [linea.producto_id]
        );
        if (rows.length) {
          const nuevoCosto = _ajustarCostoPromedioDelta(rows[0].stock, rows[0].costo_unitario, linea.cantidad, deltaUnit);
          if (nuevoCosto == null) costoNoAjustado.push(linea.nombre_producto);
          else await comprasRepo.actualizarCostoPromedio(client, linea.producto_id, nuevoCosto);
        }
      }

      editadas.push({
        linea_id:        linea.id,
        nombre:          linea.nombre_producto,
        imei:            linea.imei || null,
        precio_anterior: precioViejo,
        precio_nuevo:    precioNuevo,
      });
    }

    // 3) Recalcular el total de la compra desde sus líneas
    const { rows: totRows } = await client.query(
      `UPDATE compras SET total = sub.t
       FROM (SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS t
             FROM lineas_compra WHERE compra_id = $1) sub
       WHERE compras.id = $1
       RETURNING compras.total`,
      [compraId]
    );
    const totalNuevo = Number(totRows[0].total);

    // 4) Ajustar la deuda con el proveedor: el Cargo del acreedor pasa a valer el
    //    nuevo total. El saldo (por compra y global) se deriva de Cargo − Abonos;
    //    si lo pagado supera el total corregido, queda como saldo a favor.
    if (editadas.length > 0) {
      await client.query(
        `UPDATE movimientos_acreedor SET valor = $1 WHERE compra_id = $2 AND tipo = 'Cargo'`,
        [totalNuevo, compraId]
      );
    }

    await client.query('COMMIT');
    return {
      compra_id:         compraId,
      sucursal_id:       compra.sucursal_id,
      numero:            compra.numero ?? compraId,
      total_anterior:    Number(compra.total),
      total_nuevo:       totalNuevo,
      lineas_editadas:   editadas,
      costo_no_ajustado: costoNoAjustado,
      motivo:            motivo || null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// -----------------------------------------------------------------------------
// ENTRADAS DE BODEGA
//
// El bodeguero cuenta lo que llego. No teclea precios, no elige proveedor y no
// los recibe en la respuesta. Todo lo demas lo hace `registrarCompra()`, que ya
// mete inventario, mueve el costo promedio, crea el cargo al acreedor, ata la
// recepcion a la orden y sabe revertirse. Esto es una capa delgada encima que
// RESUELVE lo que el bodeguero no ve, no un ciclo de compra paralelo.
// -----------------------------------------------------------------------------

// El precio provisional de una linea.
//
// Ojo con la tentacion de dejarlo en 0 "y que administracion lo ponga despues":
// no es reversible. `editarPreciosCompra` reparte el delta sobre el stock ACTUAL
// y desde 0 da una cifra equivocada.
//
// El ultimo costo conocido, en cambio, es NEUTRO: mezclar unidades al mismo
// costo que el nodo ya tenia deja el promedio identico, y la correccion
// posterior aterriza exactamente donde habria quedado una compra al precio real.
// Es una identidad algebraica:
//
//     C + (R-C)*cant/(stock+cant)  ==  (stock*C + cant*R)/(stock+cant)
//
// Orden: lo pedido en la orden -> el ultimo costo conocido del nodo -> nada.
// "Nada" (0) es el caso honesto de un producto que nunca tuvo costo: entra sin
// costo y sale en el panel de productos sin costo de Reportes. No se inventa.
const _precioProvisional = async (client, linea, estimadoOrden) => {
  if (estimadoOrden != null && Number(estimadoOrden) > 0) return Number(estimadoOrden);

  // El costo vive en el NODO que recibe, no en el producto: con variantes
  // activas el del producto es la suma de sus hijos y no dice nada de esta talla.
  if (linea.variante_id) {
    const { rows } = await client.query(
      'SELECT costo_unitario FROM variantes_atributo WHERE id = $1', [linea.variante_id]);
    if (Number(rows[0]?.costo_unitario) > 0) return Number(rows[0].costo_unitario);
  }
  if (linea.atributo_id) {
    const { rows } = await client.query(
      'SELECT costo_unitario FROM atributos_producto WHERE id = $1', [linea.atributo_id]);
    if (Number(rows[0]?.costo_unitario) > 0) return Number(rows[0].costo_unitario);
  }
  if (linea.imei) {
    // Un serial nuevo no tiene costo propio todavia: se toma el de la ultima
    // unidad registrada de esa misma referencia. Da igual si no es exacto: al
    // confirmar la factura, la correccion de un serial SOBREESCRIBE el valor
    // (no es un promedio), asi que aterriza exacto de todos modos.
    const { rows } = await client.query(
      `SELECT s.costo_compra FROM seriales s
       WHERE s.producto_id = $1 AND s.costo_compra IS NOT NULL
       ORDER BY s.id DESC LIMIT 1`, [linea.producto_id]);
    if (Number(rows[0]?.costo_compra) > 0) return Number(rows[0].costo_compra);
    return 0;
  }
  if (linea.producto_id) {
    const { rows } = await client.query(
      'SELECT costo_unitario FROM productos_cantidad WHERE id = $1', [linea.producto_id]);
    if (Number(rows[0]?.costo_unitario) > 0) return Number(rows[0].costo_unitario);
  }
  return 0;
};

/**
 * Registra una Entrada: que llego y cuanto. Sin proveedor ni precios en el
 * cuerpo; si vienen, se IGNORAN a proposito. Este endpoint existe justo para
 * quien no debe decidir plata, asi que no se le cree nada de eso al cliente.
 */
const registrarEntrada = async ({
  negocio_id, sucursal_id, usuario_id, lineas, orden_compra_id = null, notas = null,
}) => {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    throw { status: 400, message: 'La entrada necesita al menos un producto' };
  }

  const client = await pool.connect();
  let proveedorId = null;
  let estimados = new Map();   // orden_linea_id -> precio_estimado
  let garantias = new Map();   // orden_linea_id -> garantia_dias
  let garantiaProveedor = null;
  let conPrecio = [];
  try {
    // El proveedor y los estimados salen de la ORDEN, nunca del cuerpo.
    if (orden_compra_id) {
      const { rows: ord } = await client.query(
        `SELECT o.id, o.proveedor_id, o.sucursal_id
         FROM ordenes_compra o WHERE o.id = $1 AND o.negocio_id = $2`,
        [orden_compra_id, negocio_id]
      );
      if (!ord.length) throw { status: 404, message: 'Orden de compra no encontrada' };
      if (Number(ord[0].sucursal_id) !== Number(sucursal_id)) {
        throw { status: 400, message: 'La orden pertenece a otra sucursal' };
      }
      proveedorId = ord[0].proveedor_id;

      // Plazo por defecto del proveedor, para las lineas que la orden no
      // especifica. Se lee una sola vez.
      if (proveedorId) {
        const { rows: pv } = await client.query(
          'SELECT garantia_dias_default FROM proveedores WHERE id = $1', [proveedorId]
        );
        garantiaProveedor = pv[0]?.garantia_dias_default ?? null;
      }

      const { rows: lin } = await client.query(
        'SELECT id, precio_estimado, garantia_dias FROM lineas_orden_compra WHERE orden_id = $1',
        [orden_compra_id]
      );
      estimados = new Map(lin.map((l) => [Number(l.id), l.precio_estimado]));
      garantias = new Map(lin.map((l) => [Number(l.id), l.garantia_dias]));
    }

    for (const l of lineas) {
      const cantidad = Number(l.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw { status: 400, message: `Cantidad invalida en ${l.nombre_producto || 'una linea'}` };
      }
      // Bodega no crea productos: si no esta en el catalogo, no se recibe. Es
      // deliberado, y el mensaje dice que hacer en vez de solo negarse.
      if (!l.producto_id) {
        throw {
          status: 400,
          code: 'PRODUCTO_NO_EXISTE',
          message: `"${l.nombre_producto || 'Ese producto'}" no esta en el catalogo. `
            + 'Pidele a administracion que lo cree y vuelve a intentarlo.',
        };
      }
      // ── El stock se mueve en la HOJA, nunca en el producto ─────────────
      // Con variantes activas, el stock del producto es la SUMA de sus hijos y
      // se recalcula solo. Escribir ahí arriba lo infla y deja el arbol
      // descuadrado: el producto diria 5 y sus tallas sumarian 0. Es el mismo
      // error que costo corregir en las remisiones por variante, asi que aqui
      // se rechaza en vez de aceptarlo en silencio.
      if (!l.imei && !l.variante_id && !l.atributo_id) {
        const { rows: hijos } = await client.query(
          `SELECT 1 FROM atributos_producto
           WHERE producto_id = $1 AND activo = true LIMIT 1`,
          [l.producto_id]
        );
        if (hijos.length) {
          throw {
            status: 400,
            code: 'VARIANTE_REQUERIDA',
            message: `"${l.nombre_producto || 'Ese producto'}" se maneja por variantes. `
              + 'Indica cual llego (talla, color...) antes de registrar la entrada.',
          };
        }
      }

      // ── La garantía del proveedor se CONGELA aquí ──────────────────────
      // El reloj arranca cuando la mercancía entra, y `lineas_compra.garantia_dias`
      // es de donde se deriva el vencimiento. Una entrada que lo dejaba en NULL
      // metía la mercancía sin garantía que reclamar, en silencio.
      //
      // No lo decide el bodeguero: el plazo se pacta al comprar. Sale de la
      // línea de la orden y, si no lo dice, del default del proveedor.
      const garantiaLinea = l.orden_linea_id
        ? (garantias.get(Number(l.orden_linea_id)) ?? garantiaProveedor)
        : garantiaProveedor;

      conPrecio.push({
        ...l,
        cantidad,
        garantia_dias: garantiaLinea ?? null,
        precio_unitario: await _precioProvisional(
          client, l, l.orden_linea_id ? estimados.get(Number(l.orden_linea_id)) : null,
        ),
      });
    }
  } finally {
    client.release();
  }

  // De aqui en adelante es el camino de siempre, con su propia transaccion.
  return registrarCompra({
    negocio_id, sucursal_id, usuario_id,
    proveedor_id: proveedorId,
    lineas: conPrecio,
    notas,
    orden_compra_id,
    pagos: [],
    registrar_en_caja: false,     // una entrada no toca caja: nadie pago nada
    factura_confirmada: false,    // queda esperando la factura
    es_entrada: true,             // y es lo que la pantalla de bodega lista
  });
};

// -- Acreedor de un proveedor: lo encuentra o lo crea -----------------------
// Mismo criterio que usa `registrarCompra`: primero por proveedor_id, luego por
// el NIT (hay acreedores viejos creados a mano antes de que existiera el enlace
// al proveedor), y si no, se crea. Vive aparte porque ahora lo necesitan dos
// caminos: la compra normal y la confirmacion de una entrada que llego sin orden.
const _acreedorDe = async (client, negocioId, proveedorId) => {
  const { rows: prov } = await client.query(
    'SELECT id, nombre, nit, telefono FROM proveedores WHERE id = $1 AND negocio_id = $2',
    [proveedorId, negocioId]
  );
  const p = prov[0];

  let { rows } = await client.query(
    'SELECT id FROM acreedores WHERE negocio_id = $1 AND proveedor_id = $2 LIMIT 1',
    [negocioId, proveedorId]
  );
  if (rows.length) return rows[0].id;

  if (p?.nit) {
    const { rows: porNit } = await client.query(
      'SELECT id FROM acreedores WHERE negocio_id = $1 AND cedula = $2 LIMIT 1',
      [negocioId, p.nit]
    );
    if (porNit.length) {
      await client.query(
        'UPDATE acreedores SET proveedor_id = $1 WHERE id = $2 AND proveedor_id IS NULL',
        [proveedorId, porNit[0].id]
      );
      return porNit[0].id;
    }
  }

  const { rows: nuevo } = await client.query(
    `INSERT INTO acreedores(negocio_id, nombre, cedula, telefono, proveedor_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [negocioId, p?.nombre, p?.nit || `prov-${proveedorId}`, p?.telefono || '', proveedorId]
  );
  return nuevo[0].id;
};

const getOrdenesParaRecibir = (sucursalId, negocioId) =>
  comprasRepo.findOrdenesParaRecibir(sucursalId, negocioId);

const getEntradas = (sucursalId, negocioId) =>
  comprasRepo.findEntradas(sucursalId, negocioId);

// El detalle de una entrada, con el semaforo de garantia ya resuelto. Se usa el
// MISMO helper que la procedencia y la busqueda por IMEI: si cada pantalla
// calculara su estado, la misma unidad saldria "vigente" en una y "por vencer"
// en otra.
const getEntradaDetalle = async (compraId, negocioId) => {
  const detalle = await comprasRepo.findEntradaDetalle(compraId, negocioId);
  if (!detalle) throw { status: 404, message: 'Entrada no encontrada' };

  const { estadoGarantia } = require('../procedencia/procedencia.service');
  const { getConfigOrdenes } = require('../../middlewares/ordenesCompra.middleware');
  const cfg = await getConfigOrdenes(negocioId);

  return {
    ...detalle,
    // La feature de garantia es opt-in: si el negocio no la encendio, la
    // pantalla no pinta el semaforo (pero el plazo sigue guardado).
    garantia_activa: cfg.garantia_activa === true,
    lineas: detalle.lineas.map((l) => ({
      ...l,
      ...estadoGarantia(l.garantia_hasta, cfg.garantia_dias_aviso),
    })),
  };
};

const getPorConfirmar = (sucursalId, negocioId) =>
  comprasRepo.findPorConfirmar(sucursalId, negocioId);

/**
 * Administracion cierra la entrada contra la factura del proveedor.
 * Los precios se corrigen con `editarPreciosCompra`, que ya cascadea al costo
 * promedio, al costo de cada serial, al total de la compra y a la deuda con el
 * acreedor, todo en una sola transaccion.
 */
// Saldo vivo de una compra. MISMA definicion que `acreedores.getComprasConSaldo`
// (cargo - abonos atados a ese cargo). Calcularlo distinto aqui haria que la
// bandeja y el estado de cuenta del proveedor discrepen sobre la misma compra.
const _saldoDeCompra = async (client, compraId) => {
  const { rows } = await client.query(
    `SELECT m.id, m.valor,
            (SELECT COALESCE(SUM(a.valor), 0) FROM movimientos_acreedor a
             WHERE a.cargo_id = m.id AND a.tipo = 'Abono') AS abonado
     FROM movimientos_acreedor m
     WHERE m.compra_id = $1 AND m.tipo = 'Cargo' LIMIT 1`,
    [compraId]
  );
  if (!rows.length) return null;
  const valor   = Number(rows[0].valor);
  const abonado = Number(rows[0].abonado);
  return { cargoId: rows[0].id, valor, abonado, saldo: Math.max(valor - abonado, 0) };
};

const confirmarEntrada = async (negocioId, compraId, {
  proveedor_id, lineas, numero_factura, usuario_id,
  fecha_factura = null, dias_plazo = null, fecha_vencimiento = null,
  pago = null,
}) => {
  const compra = await comprasRepo.findByIdYNegocio(compraId, negocioId);
  if (!compra) throw { status: 404, message: 'Entrada no encontrada' };
  if (compra.estado === 'Cancelada') {
    throw { status: 400, message: 'La entrada esta cancelada' };
  }
  if (compra.factura_confirmada) {
    throw { status: 409, message: 'Esta entrada ya fue confirmada' };
  }
  if (!compra.proveedor_id && !proveedor_id) {
    throw { status: 400, message: 'Indica de que proveedor vino esta entrada' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!compra.proveedor_id && proveedor_id) {
      const { rows } = await client.query(
        'SELECT id FROM proveedores WHERE id = $1 AND negocio_id = $2 AND activo = true',
        [proveedor_id, negocioId]
      );
      if (!rows.length) throw { status: 400, message: 'Proveedor no valido para este negocio' };
      await comprasRepo.asignarProveedor(client, compraId, proveedor_id);

      // ── EL AGUJERO QUE ESTO TAPA ──────────────────────────────────────────
      // Una entrada sin orden llega sin proveedor, asi que `registrarCompra` se
      // salta entero el bloque del acreedor: no hay Cargo. Y `editarPreciosCompra`
      // solo ACTUALIZA el cargo existente (`UPDATE ... WHERE compra_id`), no lo
      // crea. Resultado: la mercancia entraba al inventario y el proveedor nunca
      // quedaba con su cuenta por pagar. El cargo nace aqui, que es el momento
      // en que por fin se sabe a quien se le debe.
      const { rows: yaHay } = await client.query(
        `SELECT id FROM movimientos_acreedor WHERE compra_id = $1 AND tipo = 'Cargo' LIMIT 1`,
        [compraId]
      );
      if (!yaHay.length) {
        const acreedorId = await _acreedorDe(client, negocioId, proveedor_id);
        // El valor sale del total VIGENTE de la compra (el provisional). Si los
        // precios cambian a continuacion, `editarPreciosCompra` recalcula el
        // total y pone el cargo al dia: por eso este INSERT va antes.
        await client.query(
          `INSERT INTO movimientos_acreedor
             (acreedor_id, usuario_id, tipo, descripcion, valor, compra_id, sucursal_id)
           VALUES ($1, $2, 'Cargo', $3, $4, $5, $6)`,
          [acreedorId, usuario_id || null,
           `Entrada #${compra.numero ?? compraId} — mercancia`,
           compra.total, compraId, compra.sucursal_id]
        );
      }
    }
    if (numero_factura) {
      await client.query('UPDATE compras SET numero_factura = $1 WHERE id = $2',
        [numero_factura, compraId]);
    }

    // ── Cuando vence la factura del proveedor ────────────────────────────
    // El plazo y la fecha son dos formas de decir lo mismo y el usuario
    // escribe la que tenga a mano; `resolverVencimiento` decide (una fecha
    // explicita siempre manda sobre el plazo). Es lo que alimenta el semaforo
    // de cartera y el aviso de las 8:00 — sin esto, la deuda de una entrada
    // nunca aparece como proxima a vencer.
    const vence = resolverVencimiento({ fecha_factura, dias_plazo, fecha_vencimiento });
    if (vence) {
      await client.query(
        `UPDATE movimientos_acreedor SET fecha_vencimiento = $1::date
         WHERE compra_id = $2 AND tipo = 'Cargo'`,
        [vence, compraId]
      );
    }

    await comprasRepo.marcarConfirmada(client, compraId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Fuera de la transaccion de arriba: `editarPreciosCompra` abre la suya y es
  // idempotente (una linea cuyo precio no cambia se omite). Si no vienen
  // precios, la entrada queda confirmada a su valor provisional, que es una
  // decision valida: el estimado era el correcto.
  let resultado = { compra_id: compraId, confirmada: true, lineas_editadas: [] };
  if (Array.isArray(lineas) && lineas.length > 0) {
    resultado = await editarPreciosCompra(negocioId, compraId, {
      lineas, usuario_id, motivo: 'Confirmacion de la factura del proveedor',
    });
  }

  // ── El pago va DESPUES de corregir los precios ─────────────────────────────
  // `editarPreciosCompra` recalcula el total y pone el Cargo al dia. Si el abono
  // se registrara antes, se compararia contra un saldo que esta por cambiar y se
  // podria abonar de mas o de menos.
  //
  // El abono se admite PARCIAL a proposito: casi nunca se paga todo de una, y
  // obligar a "todo o nada" empujaria a registrar pagos que no ocurrieron.
  // Nunca supera el saldo: pagar de mas no es un abono, es un saldo a favor, y
  // ese tiene su propio circuito en Acreedores.
  if (pago && Number(pago.valor) > 0) {
    const cliente = await pool.connect();
    try {
      const estado = await _saldoDeCompra(cliente, compraId);
      if (!estado) {
        throw { status: 400, message: 'Esta entrada no tiene deuda registrada: asignale un proveedor primero' };
      }
      if (estado.saldo <= 0) {
        throw { status: 409, code: 'YA_SALDADA', message: 'Esta compra ya esta saldada' };
      }
      const valor = Math.min(Math.round(Number(pago.valor)), estado.saldo);

      // Sin `fecha`: la columna toma NOW(). El dinero sale HOY, no el dia en que
      // se recibio la mercancia — para la caja, la fecha del movimiento es la
      // fecha en que ocurrio.
      await cliente.query(
        `INSERT INTO movimientos_acreedor
           (acreedor_id, usuario_id, tipo, descripcion, valor, cargo_id, compra_id,
            metodo, registrar_en_caja, sucursal_id)
         SELECT m.acreedor_id, $2, 'Abono', $3, $4, m.id, $1, $5, $6, $7
         FROM movimientos_acreedor m WHERE m.id = $8`,
        [compraId, usuario_id || null,
         valor >= estado.saldo ? 'Pago de la factura' : 'Abono a la factura',
         valor, pago.metodo || null, pago.registrar_en_caja !== false,
         compra.sucursal_id, estado.cargoId]
      );

      const despues = await _saldoDeCompra(cliente, compraId);
      resultado.pago = {
        valor,
        saldo_anterior: estado.saldo,
        saldo_restante: despues?.saldo ?? 0,
        estado_pago: (despues?.saldo ?? 0) <= 0 ? 'Saldada' : 'Parcial',
      };
    } finally {
      cliente.release();
    }
  }

  return resultado;
};

// `precioProvisional` sale exportado para que la CORRECCIÓN de una entrada
// resuelva el precio con exactamente el mismo criterio que la entrada original.
// Copiarlo allá haría que corregir la talla cambiara además el costo, que es la
// clase de efecto secundario invisible que este trabajo vino a eliminar.
const { corregirEntrada, getCorrecciones } = require('./correccionEntrada');

module.exports = { getCompras, getCompraById, getComprasByProveedor, registrarCompra, getComprasPaginadas, cancelarCompra, devolverCompra, editarPreciosCompra, registrarEntrada, getEntradas, getEntradaDetalle, getOrdenesParaRecibir, getPorConfirmar, confirmarEntrada, corregirEntrada, getCorrecciones, precioProvisional: _precioProvisional };