// src/modules/compras/correccionEntrada.js
// ─────────────────────────────────────────────────────────────────────────────
// CORREGIR UNA ENTRADA SIN REHACERLA
//
// Hasta hoy, si el bodeguero tecleaba la talla equivocada su única salida era
// cancelar la entrada COMPLETA y volver a capturarla entera —treinta IMEI
// incluidos—. Las tres herramientas que existían no sirven para esto:
//
//   · cancelarCompra    — todo o nada
//   · devolverCompra    — le devuelve mercancía al proveedor; un dedazo no es
//                         una devolución, y dejarlo registrado como tal
//                         ensuciaría el historial del proveedor con culpas que
//                         no son suyas
//   · editarPreciosCompra — solo toca plata, y es de admin_negocio
//
// ── La frontera es `factura_confirmada` ─────────────────────────────────────
// Esta bandera ya existía y es exactamente el límite correcto. Mientras esté en
// FALSE, administración todavía no puso los precios reales: lo que hay es stock
// provisional. Después de confirmar, el camino sigue siendo devolución +
// corrección de precios, que ya cascadean a la deuda con su propio circuito.
//
// ── Por qué es seguro tocar el costo aquí ───────────────────────────────────
// Una entrada se valoriza al ÚLTIMO COSTO CONOCIDO del nodo, que es NEUTRO
// (mezclar unidades al mismo costo deja el promedio idéntico). Así que revertir
// una línea con `revertirCostoPromedio` no mueve un peso en el caso normal, y
// solo hace trabajo real cuando la entrada vino de una orden con
// `precio_estimado`, que sí movió el promedio — y ahí lo devuelve EXACTO.
//
// Revertir el stock sin revertir el promedio dejaría el costo del nodo contando
// unidades que ya no están: ese es justo el "corregí algo y se dañó el
// inventario" que esto no puede provocar.
//
// ── Y por qué la bitácora va DENTRO de la transacción ───────────────────────
// Es lo contrario de `movimientos_ubicacion`, a propósito. Allá el log cuelga de
// mover una caja —la operación diaria de un módulo en producción— y por eso se
// consulta la bandera ANTES de insertar, para que la bitácora no pueda tumbar la
// operación. Aquí la operación NUEVA es la corrección entera: una corrección sin
// rastro es peor que no poder corregir, así que sin tabla el endpoint no existe.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../config/db');
const variantesRepo = require('../variantes-producto/variantes-producto.repository');
const { calcularCostoPromedio, revertirCostoPromedio } = require('../../utils/costoPromedio.util');
const { etiquetaNodo, claveNodo, validarNodo } = require('../../utils/nodoPedido.util');

// ── Revertir el efecto de una línea sobre el inventario ─────────────────────
//
// Espeja lo que hace `devolverCompra` con el stock, y agrega lo que aquella NO
// hace: devolver el promedio. Aquella puede permitírselo porque una devolución
// al proveedor es un hecho comercial que ya se acredita en la deuda; esto es
// borrar algo que nunca debió escribirse.
const _revertirLinea = async (client, { linea, cantidad, negocioId }) => {
  if (linea.imei) {
    const { rows } = await client.query(
      `SELECT s.id, s.vendido, s.prestado FROM seriales s
       JOIN productos_serial ps ON ps.id = s.producto_id
       JOIN sucursales       su ON su.id = ps.sucursal_id
       WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
      [linea.imei, negocioId]
    );
    if (!rows.length) {
      throw { status: 409, message: `El equipo ${linea.imei} ya no está en el inventario: no se puede corregir esta línea.` };
    }
    // Se vendió mientras estaba mal capturado. Corregirlo ahora dejaría la venta
    // apuntando a un equipo que dejó de existir — y esa venta ya es historia.
    if (rows[0].vendido || rows[0].prestado) {
      throw {
        status: 409,
        code: 'UNIDAD_CON_MOVIMIENTO',
        message: `El equipo ${linea.imei} ya fue ${rows[0].vendido ? 'vendido' : 'prestado'}. `
          + 'Corrígelo con una devolución al proveedor, no aquí.',
      };
    }
    await client.query('DELETE FROM seriales WHERE id = $1', [rows[0].id]);
    return;
  }

  const precio = Number(linea.precio_unitario || 0);

  if (linea.variante_id) {
    const { rows } = await client.query(
      'SELECT stock, costo_unitario, producto_id FROM variantes_atributo WHERE id = $1',
      [linea.variante_id]
    );
    if (!rows.length || Number(rows[0].stock) < cantidad) {
      throw {
        status: 409,
        code: 'STOCK_INSUFICIENTE',
        message: `Ya no quedan ${cantidad} unidades de ${linea.nombre_producto} para corregir: `
          + 'se vendieron o se movieron. Ajústalo desde el inventario.',
      };
    }
    const anterior = revertirCostoPromedio(rows[0].stock, rows[0].costo_unitario, cantidad, precio);
    await client.query('UPDATE variantes_atributo SET stock = stock - $1 WHERE id = $2',
      [cantidad, linea.variante_id]);
    if (anterior != null) {
      await variantesRepo.actualizarCostoVarianteEnTx(client, linea.variante_id, anterior);
    }
    await variantesRepo.sincronizarStockProductoEnTx(client, rows[0].producto_id);
    return;
  }

  if (linea.atributo_id) {
    const { rows } = await client.query(
      'SELECT stock, costo_unitario, producto_id FROM atributos_producto WHERE id = $1',
      [linea.atributo_id]
    );
    if (!rows.length || Number(rows[0].stock) < cantidad) {
      throw {
        status: 409,
        code: 'STOCK_INSUFICIENTE',
        message: `Ya no quedan ${cantidad} unidades de ${linea.nombre_producto} para corregir: `
          + 'se vendieron o se movieron. Ajústalo desde el inventario.',
      };
    }
    const anterior = revertirCostoPromedio(rows[0].stock, rows[0].costo_unitario, cantidad, precio);
    await client.query('UPDATE atributos_producto SET stock = stock - $1 WHERE id = $2',
      [cantidad, linea.atributo_id]);
    if (anterior != null) {
      await variantesRepo.actualizarCostoAtributoEnTx(client, linea.atributo_id, anterior);
    }
    await variantesRepo.sincronizarStockProductoEnTx(client, rows[0].producto_id);
    return;
  }

  if (linea.producto_id) {
    const { rows } = await client.query(
      'SELECT stock, costo_unitario FROM productos_cantidad WHERE id = $1',
      [linea.producto_id]
    );
    if (!rows.length || Number(rows[0].stock) < cantidad) {
      throw {
        status: 409,
        code: 'STOCK_INSUFICIENTE',
        message: `Ya no quedan ${cantidad} unidades de ${linea.nombre_producto} para corregir: `
          + 'se vendieron o se movieron. Ajústalo desde el inventario.',
      };
    }
    const anterior = revertirCostoPromedio(rows[0].stock, rows[0].costo_unitario, cantidad, precio);
    await client.query(
      `UPDATE productos_cantidad
       SET stock = stock - $1, costo_unitario = COALESCE($2, costo_unitario)
       WHERE id = $3`,
      [cantidad, anterior, linea.producto_id]
    );
  }
};

// ── Aplicar el efecto de una línea sobre el inventario ──────────────────────
//
// Deliberadamente idéntico a lo que hace `registrarCompra`: el stock se mueve en
// la HOJA y el producto se recalcula después. Escribir arriba lo infla y la
// siguiente sincronización lo borra — el error que ya costó corregir en las
// remisiones por variante.
const _aplicarLinea = async (client, { linea, cantidad, sucursalId, negocioId, proveedorId }) => {
  if (linea.imei) {
    const { rows: existente } = await client.query(
      `SELECT s.id FROM seriales s
       JOIN productos_serial ps ON ps.id = s.producto_id
       JOIN sucursales       su ON su.id = ps.sucursal_id
       WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2`,
      [linea.imei, negocioId]
    );
    if (existente.length) {
      throw { status: 409, message: `El IMEI ${linea.imei} ya existe en el inventario` };
    }
    const { rows: ps } = await client.query(
      'SELECT id FROM productos_serial WHERE id = $1 AND sucursal_id = $2',
      [linea.producto_id, sucursalId]
    );
    if (!ps.length) {
      throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
    }
    await client.query(
      `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, proveedor_id, color, caracteristicas)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6)`,
      [linea.producto_id, linea.imei, Number(linea.precio_unitario || 0) || null,
       proveedorId || null, linea.color || null,
       linea.caracteristicas ? JSON.stringify(linea.caracteristicas) : null]
    );
    return;
  }

  const precio = Number(linea.precio_unitario || 0);

  if (linea.variante_id) {
    const { rows } = await client.query(
      'SELECT stock, costo_unitario FROM variantes_atributo WHERE id = $1', [linea.variante_id]);
    await variantesRepo.ajustarStockVarianteEnTx(client, linea.variante_id, cantidad);
    if (precio > 0) {
      const promedio = calcularCostoPromedio(rows[0]?.stock, rows[0]?.costo_unitario, cantidad, precio);
      await variantesRepo.actualizarCostoVarianteEnTx(client, linea.variante_id, promedio);
    }
    await variantesRepo.sincronizarStockProductoEnTx(client, linea.producto_id);
    return;
  }

  if (linea.atributo_id) {
    const { rows } = await client.query(
      'SELECT stock, costo_unitario FROM atributos_producto WHERE id = $1', [linea.atributo_id]);
    await variantesRepo.ajustarStockAtributoEnTx(client, linea.atributo_id, cantidad);
    if (precio > 0) {
      const promedio = calcularCostoPromedio(rows[0]?.stock, rows[0]?.costo_unitario, cantidad, precio);
      await variantesRepo.actualizarCostoAtributoEnTx(client, linea.atributo_id, promedio);
    }
    await variantesRepo.sincronizarStockProductoEnTx(client, linea.producto_id);
    return;
  }

  const { rows } = await client.query(
    'SELECT stock, costo_unitario, sucursal_id FROM productos_cantidad WHERE id = $1',
    [linea.producto_id]
  );
  if (!rows.length) throw { status: 404, message: `Producto ${linea.nombre_producto} no encontrado` };
  if (Number(rows[0].sucursal_id) !== Number(sucursalId)) {
    throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
  }
  const promedio = precio > 0
    ? calcularCostoPromedio(rows[0].stock, rows[0].costo_unitario, cantidad, precio)
    : null;
  await client.query(
    `UPDATE productos_cantidad
     SET stock = stock + $1, costo_unitario = COALESCE($2, costo_unitario)
     WHERE id = $3`,
    [cantidad, promedio, linea.producto_id]
  );
};

// ── El nodo hoja es obligatorio, igual que al registrar la entrada ──────────
// Si el producto tiene atributos activos, el stock vive abajo. Dejar corregir
// hacia el producto reintroduciría por la puerta de atrás justo el descuadre que
// `VARIANTE_REQUERIDA` cierra al recibir.
const _exigirNodoSiHayArbol = async (client, { producto_id, variante_id, atributo_id, nombre }) => {
  if (variante_id || atributo_id) return;
  const { rows } = await client.query(
    'SELECT 1 FROM atributos_producto WHERE producto_id = $1 AND activo = true LIMIT 1',
    [producto_id]
  );
  if (rows.length) {
    throw {
      status: 400,
      code: 'VARIANTE_REQUERIDA',
      message: `"${nombre}" se maneja por variantes. Indica cuál antes de corregir.`,
    };
  }
};

/**
 * Corrige lo que se capturó mal en una entrada todavía sin confirmar.
 *
 * Cada operación es reversa + reaplicación dentro de UNA transacción. Nunca un
 * UPDATE a pelo sobre `lineas_compra`: eso cambiaría el papel y dejaría el stock
 * donde estaba, que es la forma más silenciosa de descuadrar un inventario.
 */
const corregirEntrada = async (negocioId, compraId, { operaciones, motivo, usuario_id }) => {
  const { hayCorreccionesEntrada } = require('../../config/columnas');
  if (!hayCorreccionesEntrada()) {
    throw {
      status: 503,
      message: 'La corrección de entradas aún no está disponible en este servidor. '
        + 'Puedes cancelar la entrada y volver a registrarla.',
    };
  }
  if (!Array.isArray(operaciones) || operaciones.length === 0) {
    throw { status: 400, message: 'No indicaste ninguna corrección' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE: dos correcciones simultáneas sobre la misma entrada podrían
    // revertir las dos el mismo stock.
    const { rows: compraRows } = await client.query(
      `SELECT c.id, c.numero, c.sucursal_id, c.proveedor_id, c.estado,
              c.factura_confirmada, c.es_entrada, c.orden_compra_id, c.total
       FROM compras c
       JOIN sucursales s ON s.id = c.sucursal_id
       WHERE c.id = $1 AND s.negocio_id = $2
       FOR UPDATE OF c`,
      [compraId, negocioId]
    );
    const compra = compraRows[0];
    if (!compra) throw { status: 404, message: 'Entrada no encontrada' };
    if (compra.estado === 'Cancelada') {
      throw { status: 409, message: 'La entrada está cancelada' };
    }
    if (!compra.es_entrada) {
      throw {
        status: 409,
        message: 'Esto es una compra registrada por administración, no una entrada de bodega. '
          + 'Corrígela con la devolución o la edición de precios.',
      };
    }
    // La frontera. Después de confirmar hay deuda, pagos y costos reales
    // colgando: corregir ahí es devolver o editar precios, cada uno con su
    // circuito y su rastro en la cuenta del proveedor.
    if (compra.factura_confirmada) {
      throw {
        status: 409,
        code: 'ENTRADA_CONFIRMADA',
        message: `La entrada #${compra.numero ?? compraId} ya fue confirmada por administración. `
          + 'Para cambiarla usa la devolución al proveedor o la corrección de precios.',
      };
    }

    const { rows: lineas } = await client.query(
      `SELECT id, nombre_producto, producto_id, variante_id, atributo_id, imei,
              cantidad, precio_unitario, cantidad_devuelta, orden_linea_id, garantia_dias
       FROM lineas_compra WHERE compra_id = $1`,
      [compraId]
    );
    const porId = new Map(lineas.map((l) => [Number(l.id), l]));

    const bitacora = [];

    for (const op of operaciones) {
      // ── AGREGAR: llegó algo que no se capturó ────────────────────────────
      if (op.agregar === true) {
        const cantidad = Number(op.cantidad);
        if (!Number.isInteger(cantidad) || cantidad < 1) {
          throw { status: 400, message: 'La línea que agregas necesita una cantidad válida' };
        }
        if (!op.producto_id) {
          throw {
            status: 400,
            code: 'PRODUCTO_NO_EXISTE',
            message: 'Bodega no crea productos. Pídele a administración que lo cree primero.',
          };
        }
        if (op.variante_id || op.atributo_id) {
          await validarNodo(client, {
            producto_id: op.producto_id, variante_id: op.variante_id,
            atributo_id: op.atributo_id, sucursal_id: compra.sucursal_id,
          });
        }
        if (!op.imei) {
          await _exigirNodoSiHayArbol(client, {
            producto_id: op.producto_id, variante_id: op.variante_id,
            atributo_id: op.atributo_id, nombre: op.nombre_producto,
          });
        }

        // El precio sale del MISMO resolvedor que usa la entrada original: el
        // bodeguero no teclea plata ni cuando corrige.
        const { precioProvisional } = require('./compras.service');
        const nueva = {
          producto_id: op.producto_id,
          nombre_producto: op.nombre_producto,
          variante_id: op.variante_id || null,
          atributo_id: op.atributo_id || null,
          imei: op.imei || null,
          cantidad,
          precio_unitario: await precioProvisional(client, op, null),
        };

        await _aplicarLinea(client, {
          linea: nueva, cantidad, sucursalId: compra.sucursal_id,
          negocioId, proveedorId: compra.proveedor_id,
        });

        const { rows: ins } = await client.query(
          `INSERT INTO lineas_compra
             (compra_id, nombre_producto, producto_id, variante_id, atributo_id, imei,
              cantidad, precio_unitario)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [compraId, nueva.nombre_producto, nueva.imei ? null : nueva.producto_id,
           nueva.variante_id, nueva.atributo_id, nueva.imei, cantidad, nueva.precio_unitario]
        );

        bitacora.push({
          linea_id: ins[0].id, accion: 'agregar',
          producto_id: nueva.producto_id, nombre_producto: nueva.nombre_producto,
          antes_cantidad: null, despues_cantidad: cantidad,
          despues_variante_id: nueva.variante_id, despues_atributo_id: nueva.atributo_id,
          despues_etiqueta: await etiquetaNodo(client, nueva),
          despues_imei: nueva.imei,
        });
        continue;
      }

      const linea = porId.get(Number(op.linea_id));
      if (!linea) throw { status: 400, message: `La línea ${op.linea_id} no pertenece a esta entrada` };
      // Una línea ya devuelta tiene su propio circuito y su nota crédito: dejar
      // que la corrección la pise contaría la baja dos veces.
      if (Number(linea.cantidad_devuelta || 0) > 0) {
        throw {
          status: 409,
          message: `"${linea.nombre_producto}" tiene una devolución registrada y ya no se puede corregir aquí.`,
        };
      }

      const etqAntes = await etiquetaNodo(client, linea);

      // ── QUITAR: no llegó, se capturó de más ──────────────────────────────
      if (op.quitar === true) {
        await _revertirLinea(client, { linea, cantidad: Number(linea.cantidad), negocioId });
        await client.query('DELETE FROM lineas_compra WHERE id = $1', [linea.id]);
        bitacora.push({
          linea_id: null, accion: 'quitar',
          producto_id: linea.producto_id, nombre_producto: linea.nombre_producto,
          antes_cantidad: Number(linea.cantidad), despues_cantidad: 0,
          antes_variante_id: linea.variante_id, antes_atributo_id: linea.atributo_id,
          antes_etiqueta: etqAntes, antes_imei: linea.imei,
        });
        continue;
      }

      // ── CAMBIAR IMEI ─────────────────────────────────────────────────────
      if (linea.imei) {
        const imeiNuevo = String(op.imei || '').trim();
        if (!imeiNuevo) throw { status: 400, message: 'Escribe el IMEI corregido' };
        if (imeiNuevo.toUpperCase() === String(linea.imei).toUpperCase()) continue;

        const nueva = { ...linea, imei: imeiNuevo };
        await _revertirLinea(client, { linea, cantidad: 1, negocioId });
        await _aplicarLinea(client, {
          linea: nueva, cantidad: 1, sucursalId: compra.sucursal_id,
          negocioId, proveedorId: compra.proveedor_id,
        });
        await client.query('UPDATE lineas_compra SET imei = $1 WHERE id = $2', [imeiNuevo, linea.id]);

        bitacora.push({
          linea_id: linea.id, accion: 'imei',
          producto_id: linea.producto_id, nombre_producto: linea.nombre_producto,
          antes_cantidad: 1, despues_cantidad: 1,
          antes_imei: linea.imei, despues_imei: imeiNuevo,
        });
        continue;
      }

      // ── CAMBIAR CANTIDAD Y/O NODO ────────────────────────────────────────
      //
      // Van juntos porque en la vida real vienen juntos: "me equivoqué de talla
      // y además eran ocho, no diez". Partirlos en dos peticiones obligaría a
      // pasar por un estado intermedio que nadie quiso.
      const cambiaNodo = ('variante_id' in op) || ('atributo_id' in op);
      const nuevoVariante = cambiaNodo ? (op.variante_id || null) : linea.variante_id;
      const nuevoAtributo = cambiaNodo ? (op.atributo_id || null) : linea.atributo_id;
      const nuevaCantidad = op.cantidad != null ? Number(op.cantidad) : Number(linea.cantidad);

      if (!Number.isInteger(nuevaCantidad) || nuevaCantidad < 1) {
        throw {
          status: 400,
          message: `Cantidad inválida para ${linea.nombre_producto}. `
            + 'Si no llegó nada, quita la línea.',
        };
      }

      const mismoNodo = claveNodo({ variante_id: nuevoVariante, atributo_id: nuevoAtributo })
        === claveNodo(linea);
      if (mismoNodo && nuevaCantidad === Number(linea.cantidad)) continue;   // nada que hacer

      if (!mismoNodo && (nuevoVariante || nuevoAtributo)) {
        await validarNodo(client, {
          producto_id: linea.producto_id, variante_id: nuevoVariante,
          atributo_id: nuevoAtributo, sucursal_id: compra.sucursal_id,
        });
      }
      await _exigirNodoSiHayArbol(client, {
        producto_id: linea.producto_id, variante_id: nuevoVariante,
        atributo_id: nuevoAtributo, nombre: linea.nombre_producto,
      });

      const destino = { ...linea, variante_id: nuevoVariante, atributo_id: nuevoAtributo };

      if (mismoNodo) {
        // Mismo nodo: solo el delta. Revertir y reaplicar entero pasaría por un
        // stock intermedio más bajo del real y podría chocar contra su propia
        // validación de "ya no quedan unidades".
        const delta = nuevaCantidad - Number(linea.cantidad);
        if (delta > 0) {
          await _aplicarLinea(client, {
            linea: destino, cantidad: delta, sucursalId: compra.sucursal_id,
            negocioId, proveedorId: compra.proveedor_id,
          });
        } else {
          await _revertirLinea(client, { linea, cantidad: -delta, negocioId });
        }
      } else {
        await _revertirLinea(client, { linea, cantidad: Number(linea.cantidad), negocioId });
        await _aplicarLinea(client, {
          linea: destino, cantidad: nuevaCantidad, sucursalId: compra.sucursal_id,
          negocioId, proveedorId: compra.proveedor_id,
        });
      }

      await client.query(
        `UPDATE lineas_compra SET cantidad = $1, variante_id = $2, atributo_id = $3 WHERE id = $4`,
        [nuevaCantidad, nuevoVariante, nuevoAtributo, linea.id]
      );

      bitacora.push({
        linea_id: linea.id,
        accion: mismoNodo ? 'cantidad' : 'nodo',
        producto_id: linea.producto_id, nombre_producto: linea.nombre_producto,
        antes_cantidad: Number(linea.cantidad), despues_cantidad: nuevaCantidad,
        antes_variante_id: linea.variante_id, antes_atributo_id: linea.atributo_id,
        despues_variante_id: nuevoVariante, despues_atributo_id: nuevoAtributo,
        antes_etiqueta: etqAntes,
        despues_etiqueta: await etiquetaNodo(client, destino),
      });
    }

    if (bitacora.length === 0) {
      await client.query('ROLLBACK');
      return { compra_id: compraId, sin_cambios: true, correcciones: [] };
    }

    // La entrada no puede quedarse sin líneas: eso es cancelarla, y cancelar
    // tiene su propio endpoint que además marca el estado.
    const { rows: quedan } = await client.query(
      'SELECT COUNT(*)::int AS n FROM lineas_compra WHERE compra_id = $1', [compraId]);
    if (quedan[0].n === 0) {
      throw {
        status: 409,
        message: 'Quitaste todas las líneas. Si no llegó nada, cancela la entrada.',
      };
    }

    // El total se RECALCULA desde las líneas, igual que en editarPreciosCompra:
    // llevarlo a mano sumando deltas acaba desfasado a la primera excepción.
    const { rows: tot } = await client.query(
      `UPDATE compras SET total = sub.t
       FROM (SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS t
             FROM lineas_compra WHERE compra_id = $1) sub
       WHERE compras.id = $1
       RETURNING compras.total`,
      [compraId]
    );
    const totalNuevo = Number(tot[0].total);

    // Si la entrada vino de una orden, ya tiene proveedor y por tanto ya generó
    // su Cargo al recibir. Corregir las unidades cambia lo que se le debe.
    // (Una entrada SIN orden no tiene proveedor todavía: su Cargo nace al
    // confirmar, con el total ya corregido, y aquí no hay nada que actualizar.)
    await client.query(
      `UPDATE movimientos_acreedor SET valor = $1 WHERE compra_id = $2 AND tipo = 'Cargo'`,
      [totalNuevo, compraId]
    );

    for (const b of bitacora) {
      await client.query(
        `INSERT INTO correcciones_entrada
           (negocio_id, compra_id, linea_id, accion, producto_id, nombre_producto,
            antes_cantidad, despues_cantidad,
            antes_variante_id, antes_atributo_id, despues_variante_id, despues_atributo_id,
            antes_etiqueta, despues_etiqueta, antes_imei, despues_imei,
            motivo, usuario_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [negocioId, compraId, b.linea_id ?? null, b.accion,
         b.producto_id ?? null, b.nombre_producto ?? null,
         b.antes_cantidad ?? null, b.despues_cantidad ?? null,
         b.antes_variante_id ?? null, b.antes_atributo_id ?? null,
         b.despues_variante_id ?? null, b.despues_atributo_id ?? null,
         b.antes_etiqueta ?? null, b.despues_etiqueta ?? null,
         b.antes_imei ?? null, b.despues_imei ?? null,
         motivo || null, usuario_id || null]
      );
    }

    await client.query('COMMIT');
    return {
      compra_id: compraId,
      numero: compra.numero ?? compraId,
      total_anterior: Number(compra.total),
      total_nuevo: totalNuevo,
      correcciones: bitacora.map((b) => ({
        accion: b.accion, nombre_producto: b.nombre_producto,
        antes: b.antes_etiqueta ?? b.antes_imei ?? null,
        despues: b.despues_etiqueta ?? b.despues_imei ?? null,
        antes_cantidad: b.antes_cantidad, despues_cantidad: b.despues_cantidad,
      })),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/** El historial de correcciones de una entrada, lo más reciente primero. */
const getCorrecciones = async (negocioId, compraId) => {
  const { hayCorreccionesEntrada } = require('../../config/columnas');
  if (!hayCorreccionesEntrada()) return [];

  const { rows } = await pool.query(
    `SELECT ce.*, u.nombre AS usuario_nombre
     FROM      correcciones_entrada ce
     LEFT JOIN usuarios u ON u.id = ce.usuario_id
     WHERE ce.compra_id = $1 AND ce.negocio_id = $2
     ORDER BY ce.fecha DESC, ce.id DESC`,
    [compraId, negocioId]
  );
  return rows;
};

module.exports = { corregirEntrada, getCorrecciones };
