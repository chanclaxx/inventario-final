const { pool }                  = require('../../config/db');
const comprasRepo               = require('./compras.repository');
const { calcularCostoPromedio } = require('../../utils/costoPromedio.util');
const variantesRepo             = require('../variantes-producto/variantes-producto.repository');
const { getConfigOrdenes }      = require('../../middlewares/ordenesCompra.middleware');
const { resolverVencimiento }   = require('../../utils/vencimiento.util');

const getCompras = (sucursalId, negocioId, proveedorIds = null) =>
  comprasRepo.findAll(sucursalId, negocioId, proveedorIds);

const getComprasPaginadas = (sucursalId, negocioId, filtros) =>
  comprasRepo.findAllPaginado(sucursalId, negocioId, filtros);

const getComprasByProveedor = (proveedorId, sucursalId, negocioId) =>
  comprasRepo.findByProveedor(proveedorId, sucursalId, negocioId);

const getCompraById = async (negocioId, id) => {
  const compra = await comprasRepo.findByIdYNegocio(id, negocioId);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };
  const lineas = await comprasRepo.getLineas(id);
  return { ...compra, lineas };
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

  // Se agrupa por línea pedida: una misma línea de la orden puede llegar
  // repartida en varias líneas de la recepción (típico con seriales, donde cada
  // IMEI es su propia fila).
  const solicitado = new Map();
  for (const l of lineas) {
    if (l.orden_linea_id == null) continue;
    const id = Number(l.orden_linea_id);
    solicitado.set(id, (solicitado.get(id) || 0) + Number(l.cantidad || 0));
  }

  for (const [lineaId, cantidad] of solicitado) {
    const linea = porLinea.get(lineaId);
    if (!linea) {
      throw { status: 400, message: `Una de las líneas no pertenece a la orden #${orden.numero ?? orden.id}` };
    }
    const pendiente = Number(linea.cantidad_pedida) - Number(linea.recibida);
    if (cantidad > pendiente) {
      throw {
        status: 400,
        message: `De ${linea.nombre_producto} solo faltan ${pendiente} de ${linea.cantidad_pedida} `
          + `y estás recibiendo ${cantidad}. Si llegaron de más, recíbelas como compra aparte.`,
      };
    }
  }

  return orden;
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
}) => {
  // ── Verificar sucursal pertenece al negocio ──────────────────────────────
  const { rows: sucRows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!sucRows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  // ── Verificar proveedor pertenece al negocio ─────────────────────────────
  const { rows: provRows } = await pool.query(
    `SELECT id, nombre, nit, telefono FROM proveedores
     WHERE id = $1 AND negocio_id = $2 AND activo = true`,
    [proveedor_id, negocio_id]
  );
  if (!provRows.length) throw { status: 403, message: 'Proveedor no válido para este negocio' };
  const prov = provRows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Recepción contra una orden: valida y bloquea la orden antes de tocar nada.
    let ordenDeLaCompra = null;
    if (orden_compra_id) {
      ordenDeLaCompra = await _validarRecepcionContraOrden(client, {
        orden_compra_id, negocio_id, sucursal_id, lineas,
      });
    }

    const total = totalRecibido ||
      lineas.reduce((sum, l) => sum + l.cantidad * l.precio_unitario, 0);

      const metodoPago = pagos.length > 0 ? pagos[0].metodo : null;

    const compra = await comprasRepo.create(client, {
      sucursal_id, proveedor_id, usuario_id, numero_factura, total, notas,
      registrar_en_caja, metodo: metodoPago, orden_compra_id,
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

module.exports = { getCompras, getCompraById, getComprasByProveedor, registrarCompra, getComprasPaginadas, cancelarCompra, devolverCompra, editarPreciosCompra };