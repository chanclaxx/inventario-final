const { pool }     = require('../../config/db');
const repo         = require('./prestamos.repository');
const moraService  = require('../mora/mora.service');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');
const { repartirAbono } = require('../../utils/mora.util');

// ─── Helpers privados ─────────────────────────────────────────────────────────

const _verificarSucursal = async (sucursal_id, negocio_id) => {
  const { rows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!rows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };
};

const _verificarCliente = async (cliente_id, negocio_id) => {
  if (!cliente_id) return;
  const { rows } = await pool.query(
    'SELECT id FROM clientes WHERE id = $1 AND negocio_id = $2',
    [cliente_id, negocio_id]
  );
  if (!rows.length) throw { status: 403, message: 'El cliente no pertenece a este negocio' };
};

const _verificarPrestatario = async (prestatario_id, negocio_id) => {
  if (!prestatario_id) return;
  const { rows } = await pool.query(
    'SELECT id FROM prestatarios WHERE id = $1 AND negocio_id = $2',
    [prestatario_id, negocio_id]
  );
  if (!rows.length) throw { status: 403, message: 'El prestatario no pertenece a este negocio' };
};

const _procesarItemPrestamo = async (client, {
  imei, producto_id, nombre_producto, cantidad_prestada, sucursal_id,
  atributo_id, variante_id, prestamo_id,
}) => {
  if (imei) {
    const { rows } = await client.query(
      `SELECT s.id, s.prestado FROM seriales s
       JOIN productos_serial ps ON ps.id = s.producto_id
       WHERE s.imei = $1 AND ps.sucursal_id = $2`,
      [imei, sucursal_id]
    );
    if (!rows.length) {
      throw { status: 400, message: `El producto ${nombre_producto} no pertenece a esta sucursal` };
    }
    if (rows[0].prestado) {
      throw { status: 400, message: `El equipo ${imei} ya tiene un préstamo activo. Devuélvelo antes de crear uno nuevo.` };
    }
    // Excluye el préstamo recién insertado en esta misma transacción:
    // repo.create() corre ANTES de esta validación, así que sin el filtro
    // el chequeo se encontraría a sí mismo y bloquearía todo préstamo.
    const { rows: activoRows } = await client.query(
      `SELECT id FROM prestamos
       WHERE imei = $1 AND estado = 'Activo' AND sucursal_id = $2 AND id <> $3`,
      [imei, sucursal_id, prestamo_id ?? 0]
    );
    if (activoRows.length) {
      throw { status: 400, message: `Ya existe un préstamo activo con el equipo ${imei} (préstamo #${activoRows[0].id}). Devuélvelo antes de crear uno nuevo.` };
    }
    // prestado = false en el WHERE cierra la ventana de carrera si llegan
    // dos requests simultáneos que leyeron el mismo estado del serial
    const { rowCount } = await client.query(
      'UPDATE seriales SET prestado = true WHERE id = $1 AND prestado = false',
      [rows[0].id]
    );
    if (!rowCount) {
      throw { status: 400, message: `El equipo ${imei} ya tiene un préstamo activo. Devuélvelo antes de crear uno nuevo.` };
    }
  } else if (producto_id) {
    if (variante_id) {
      const { rows: varRows } = await client.query(
        `SELECT v.stock FROM variantes_atributo v
         JOIN atributos_producto ap ON ap.id = v.atributo_id
         WHERE v.id = $1 AND ap.sucursal_id = $2`,
        [variante_id, sucursal_id]
      );
      if (!varRows.length) throw { status: 400, message: `Variante de ${nombre_producto} no encontrada` };
      if (varRows[0].stock < cantidad_prestada) {
        throw { status: 400, message: `Stock insuficiente para ${nombre_producto}` };
      }
      await repo.ajustarStockVarianteEnTx(client, variante_id, -cantidad_prestada);
      await repo.sincronizarStockArbolEnTx(client, producto_id);
    } else if (atributo_id) {
      const { rows: atrRows } = await client.query(
        `SELECT stock FROM atributos_producto WHERE id = $1 AND sucursal_id = $2`,
        [atributo_id, sucursal_id]
      );
      if (!atrRows.length) throw { status: 400, message: `Atributo de ${nombre_producto} no encontrado` };
      if (atrRows[0].stock < cantidad_prestada) {
        throw { status: 400, message: `Stock insuficiente para ${nombre_producto}` };
      }
      await repo.ajustarStockAtributoEnTx(client, atributo_id, -cantidad_prestada);
      await repo.sincronizarStockArbolEnTx(client, producto_id);
    } else {
      const { rows: prodRows } = await client.query(
        `SELECT id, stock, sucursal_id FROM productos_cantidad WHERE id = $1`,
        [producto_id]
      );
      const producto = prodRows[0];
      if (!producto) throw { status: 404, message: `Producto ${nombre_producto} no encontrado` };
      if (producto.sucursal_id !== sucursal_id) {
        throw { status: 400, message: `El producto ${nombre_producto} no pertenece a esta sucursal` };
      }
      if (producto.stock < cantidad_prestada) {
        throw { status: 400, message: `Stock insuficiente para ${nombre_producto}` };
      }
      await repo.ajustarStock(client, producto_id, -cantidad_prestada);
    }
  }
};

// ─── Helper: crear factura desde un préstamo saldado ─────────────────────────
// Se ejecuta dentro de la transacción del abono para garantizar atomicidad.

const _crearFacturaDesdePrestamo = async (client, prestamo, metodo, negocioId) => {
  // Cedula: si es compañero o no tiene cédula real → 'COMPANERO'
  const esCompanero = !prestamo.cedula || prestamo.cedula === 'COMPANERO';
  const cedula      = esCompanero ? 'COMPANERO' : prestamo.cedula;
  const celular     = !prestamo.telefono || prestamo.telefono === '0000000000'
    ? '0000000000'
    : prestamo.telefono;

  // Resolver cliente_id si existe
  const clienteId = prestamo.cliente_id || null;

  // Insertar factura
  const { rows: facturaRows } = await client.query(`
    INSERT INTO facturas(
      sucursal_id, usuario_id, cliente_id,
      nombre_cliente, cedula, celular,
      notas, estado
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'Activa')
    RETURNING id
  `, [
    prestamo.sucursal_id,
    null,                        // no hay usuario en este contexto, se deja null
    clienteId,
    prestamo.prestatario || '',
    cedula,
    celular,
    `Factura generada por saldo de préstamo #${prestamo.numero ?? prestamo.id}`,
  ]);

  const facturaId = facturaRows[0].id;

  await asignarNumeroDocumento(client, {
    tipo: 'factura', docId: facturaId, negocioId,
  });

  // Insertar línea del producto.
  // OJO: `valor_prestamo` es el valor TOTAL del préstamo (no el unitario) y
  // `lineas_factura.subtotal` es una columna generada = cantidad * precio.
  // Por eso `precio` debe ser el valor UNITARIO; de lo contrario el subtotal
  // queda multiplicado por la cantidad y el reporte muestra valor_prestamo × cantidad.
  const cantidadLinea  = prestamo.imei ? 1 : Number(prestamo.cantidad_prestada || 1);
  const valorTotal     = Number(prestamo.valor_prestamo);
  const precioUnitario = cantidadLinea > 0 ? valorTotal / cantidadLinea : valorTotal;

  await client.query(`
    INSERT INTO lineas_factura(
      factura_id, nombre_producto, imei,
      cantidad, precio, producto_id, atributo_id, variante_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    facturaId,
    prestamo.nombre_producto,
    prestamo.imei     || null,
    cantidadLinea,
    precioUnitario,
    prestamo.imei ? null : (prestamo.producto_id || null),
    prestamo.atributo_id || null,
    prestamo.variante_id || null,
  ]);

  // Insertar pago con el método del abono
  await client.query(`
    INSERT INTO pagos_factura(factura_id, metodo, valor)
    VALUES ($1, $2, $3)
  `, [
    facturaId,
    metodo || 'Efectivo',
    Number(prestamo.valor_prestamo),
  ]);

  // Marcar serial como vendido si aplica
  if (prestamo.imei) {
    await client.query(`
      UPDATE seriales s
      SET vendido      = true,
          prestado     = false,
          fecha_salida = CURRENT_DATE
      FROM productos_serial ps
      WHERE s.imei         = $1
        AND ps.id          = s.producto_id
        AND ps.sucursal_id = $2
    `, [prestamo.imei, prestamo.sucursal_id]);
  }

  return facturaId;
};

// ─── Servicio: obtener ────────────────────────────────────────────────────────

// `anotarLista` resuelve la mora de todos en UNA consulta; con 1.793 préstamos
// activos, hacerlo uno por uno serían 1.793 viajes a la base. Si ninguno tiene
// plazo (negocio sin la feature) no consulta nada.
const getPrestamos = async (sucursalId, negocioId) => {
  const prestamos = await repo.findAll(sucursalId, negocioId);
  return moraService.anotarLista(prestamos, 'prestamo');
};

const getPrestamoById = async (negocioId, id) => {
  const prestamo = await repo.findByIdYNegocio(id, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  const [abonos, retomas] = await Promise.all([
    repo.getAbonos(id),
    repo.getRetomasPorPrestamo(id),
  ]);
  const conMora = await moraService.anotarDocumento(prestamo, 'prestamo');
  return { ...conMora, abonos, retomas };
};

// ─── Mora ─────────────────────────────────────────────────────────────────────
// Delegan en el servicio compartido con créditos.

/** Fija, cambia o quita el plazo de pago de un préstamo ya existente. */
const fijarPlazo = (negocioId, prestamoId, datos) =>
  moraService.fijarPlazo(negocioId, 'prestamo', prestamoId, datos);

/** Condona mora, total o parcial. Solo admin, con motivo y PIN. */
const condonarMora = (negocioId, prestamoId, datos) =>
  moraService.condonar(negocioId, 'prestamo', prestamoId, datos);

/** Cobra SOLO mora, sin tocar el capital. */
const cobrarMora = async (negocioId, prestamoId, { valor, metodo, usuario_id }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { documento, mora } = await moraService.estadoDe('prestamo', prestamoId, negocioId, client);

    if (!mora.aplica)        throw { status: 400, message: 'Este préstamo no tiene plazo ni mora pactada' };
    if (mora.pendiente <= 0) throw { status: 400, message: 'No hay mora pendiente por cobrar' };

    const aCobrar = valor == null || valor === '' ? mora.pendiente : Math.round(Number(valor));
    if (!(aCobrar > 0)) throw { status: 400, message: 'El valor a cobrar debe ser mayor a 0' };
    if (aCobrar > mora.pendiente) {
      throw { status: 400, message: `No puedes cobrar más de la mora pendiente ($${mora.pendiente.toLocaleString('es-CO')})` };
    }

    const mov = await moraService.registrarCobroEnTx(client, {
      tipo: 'prestamo', documento, negocioId,
      valor: aCobrar, metodo, usuarioId: usuario_id, estadoMora: mora,
    });
    await client.query('COMMIT');

    const despues = await moraService.estadoDe('prestamo', prestamoId, negocioId);
    return { movimiento: mov, mora: despues.mora };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: crear un préstamo ──────────────────────────────────────────────

const crearPrestamo = async ({
  sucursal_id, usuario_id, negocio_id,
  prestatario, cedula, telefono,
  nombre_producto, imei, producto_id, cantidad_prestada, valor_prestamo,
  prestatario_id, empleado_id, cliente_id,
  atributo_id, variante_id, atributo_label, variante_label,
}) => {
  await _verificarSucursal(sucursal_id, negocio_id);
  await _verificarCliente(cliente_id, negocio_id);
  await _verificarPrestatario(prestatario_id, negocio_id);

  const esSerial   = !!imei;
  const productoId = esSerial ? null : (producto_id || null);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prestamo = await repo.create(client, {
      sucursal_id, usuario_id, prestatario, cedula, telefono,
      nombre_producto, imei: imei || null,
      producto_id:       productoId,
      cantidad_prestada: esSerial ? 1 : (cantidad_prestada || 1),
      valor_prestamo,
      prestatario_id:    prestatario_id || null,
      empleado_id:       empleado_id   || null,
      cliente_id:        cliente_id    || null,
      atributo_id:       atributo_id   || null,
      variante_id:       variante_id   || null,
      atributo_label:    atributo_label || null,
      variante_label:    variante_label || null,
    });

    await _procesarItemPrestamo(client, {
      imei, producto_id: productoId,
      nombre_producto,
      cantidad_prestada: esSerial ? 1 : (cantidad_prestada || 1),
      sucursal_id,
      atributo_id: atributo_id || null,
      variante_id: variante_id || null,
      prestamo_id: prestamo.id,
    });

    await client.query('COMMIT');
    return prestamo;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: crear múltiples préstamos ──────────────────────────────────────

const crearPrestamos = async ({
  sucursal_id, usuario_id, negocio_id,
  prestatario, cedula, telefono,
  prestatario_id, empleado_id, cliente_id,
  items,
  aplicar_saldo_favor = false,
  // Plazo y condición de mora del pacto. Aplican a TODOS los ítems del mismo
  // préstamo: es un solo acuerdo con la persona, aunque se lleve varios equipos.
  fecha_limite, mora_condicion_id,
}) => {
  if (!items?.length) throw { status: 400, message: 'Se requiere al menos un ítem para el préstamo' };

  await _verificarSucursal(sucursal_id, negocio_id);
  await _verificarCliente(cliente_id, negocio_id);
  await _verificarPrestatario(prestatario_id, negocio_id);

  // Se resuelve ANTES de abrir la transacción: si la fecha es inválida, mejor
  // fallar sin haber tocado inventario.
  const datosMora = await moraService.datosParaNuevoDocumento(negocio_id, {
    fecha_limite, mora_condicion_id,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prestamosCreados = [];

    for (const item of items) {
      const esSerial   = !!item.imei;
      const productoId = esSerial ? null : (item.producto_id || null);

      const prestamo = await repo.create(client, {
        sucursal_id, usuario_id, prestatario, cedula, telefono,
        nombre_producto:   item.nombre_producto,
        imei:              item.imei || null,
        producto_id:       productoId,
        cantidad_prestada: esSerial ? 1 : (item.cantidad_prestada || 1),
        valor_prestamo:    item.valor_prestamo,
        prestatario_id:    prestatario_id || null,
        empleado_id:       empleado_id   || null,
        cliente_id:        cliente_id    || null,
        atributo_id:       item.atributo_id  || null,
        variante_id:       item.variante_id  || null,
        atributo_label:    item.atributo_label || null,
        variante_label:    item.variante_label || null,
        ...datosMora,
      });

      await _procesarItemPrestamo(client, {
        imei:              item.imei,
        producto_id:       productoId,
        nombre_producto:   item.nombre_producto,
        cantidad_prestada: esSerial ? 1 : (item.cantidad_prestada || 1),
        sucursal_id,
        atributo_id:       item.atributo_id  || null,
        variante_id:       item.variante_id  || null,
        prestamo_id:       prestamo.id,
      });

      prestamosCreados.push(prestamo);
    }

    // ── Aplicar saldo a favor dentro de la misma transacción ─────────────────
    if (aplicar_saldo_favor && (prestatario_id || cliente_id)) {
      const tipo      = prestatario_id ? 'prestatario' : 'cliente';
      const personaId = prestatario_id || cliente_id;

      let saldoRestante = await repo.getSaldoAFavorPersona(client, tipo, personaId);

      if (saldoRestante > 0) {
        for (const prestamo of prestamosCreados) {
          if (saldoRestante <= 0) break;

          const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
          if (saldoPendiente <= 0) continue;

          const montoAbono = Math.min(saldoRestante, saldoPendiente);
          const resultado  = await repo.insertarAbono(client, {
            prestamo_id: prestamo.id,
            valor:       montoAbono,
            metodo:      'Saldo a favor',
          });
          saldoRestante -= montoAbono;

          if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
            await repo.updateEstado(client, prestamo.id, 'Saldado');
            if (prestamo.imei) {
              await repo.salarSerial(client, prestamo.imei, sucursal_id);
            }
          }
        }

        await repo.setearSaldoAFavorPersona(client, tipo, personaId, saldoRestante);
      }
    }

    await client.query('COMMIT');
    return prestamosCreados;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: registrar/actualizar saldo a favor de una persona ──────────────

const registrarSaldoAFavor = async (negocioId, tipo, personaId, monto, sucursalId = null, usuarioId = null) => {
  if (tipo === 'prestatario') {
    await _verificarPrestatario(personaId, negocioId);
  } else {
    await _verificarCliente(personaId, negocioId);
  }

  await repo.setearSaldoAFavorPersona(pool, tipo, personaId, monto);

  if (sucursalId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const anterior = await repo.getSaldoSucursal(client, tipo, personaId, sucursalId);
      await repo.setSaldoSucursal(client, tipo, personaId, sucursalId, monto);
      const delta = monto - anterior;
      await repo.registrarMovSaldoSucursal(client, {
        tipo_persona:    tipo,
        persona_id:      personaId,
        sucursal_id:     sucursalId,
        concepto:        'Actualización manual de saldo a favor',
        monto:           Math.abs(delta),
        tipo_movimiento: delta >= 0 ? 'credito' : 'debito',
        referencia_id:   null,
        usuario_id:      usuarioId,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return { saldo_a_favor: monto };
};

// ─── Servicio: registrar abono ────────────────────────────────────────────────

// `modo` y `valorMora` solo importan si el préstamo tiene plazo pactado:
//   'mora_capital'  → primero la mora, resto a capital (orden del Art. 1653 C.C.)
//   'solo_capital'  → todo a capital; la mora queda PENDIENTE, no condonada
//   'personalizado' → `valorMora` a mora, el resto a capital
// Sin plazo, la mora pendiente es 0 y los tres se comportan como siempre.
const registrarAbono = async (
  negocioId, prestamoId, valor, metodo, usuarioId, color,
  { modo = 'mora_capital', valorMora = 0 } = {},
) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  if (prestamo.estado !== 'Activo') throw { status: 400, message: 'El préstamo no está activo' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Dentro de la transacción: si entran dos abonos a la vez, cada uno ve el
    // saldo y la mora que dejó el otro.
    const { documento, saldo_capital, mora } = await moraService.estadoDe(
      'prestamo', prestamoId, negocioId, client
    );

    const reparto = repartirAbono({
      valor, mora_pendiente: mora.pendiente, saldo_capital, modo, valor_mora: valorMora,
    });

    // El tope ahora es capital + mora: antes rechazaba cualquier pago que
    // incluyera los intereses, porque no los conocía.
    if (reparto.excedente > 0) {
      const total = saldo_capital + mora.pendiente;
      throw {
        status: 400,
        message: `El abono supera lo que se debe. Capital $${Math.round(saldo_capital).toLocaleString('es-CO')}`
          + (mora.pendiente > 0 ? ` + mora $${mora.pendiente.toLocaleString('es-CO')}` : '')
          + ` = $${Math.round(total).toLocaleString('es-CO')}`,
      };
    }

    let resultado = {
      valor_prestamo: documento.valor_prestamo,
      total_abonado:  documento.total_abonado,
      abono_id:       null,
    };
    if (reparto.a_capital > 0) {
      resultado = await repo.insertarAbono(client, {
        prestamo_id: prestamoId, valor: reparto.a_capital, metodo, usuario_id: usuarioId || null,
      });
    }

    let movimientoMora = null;
    if (reparto.a_mora > 0) {
      movimientoMora = await moraService.registrarCobroEnTx(client, {
        tipo: 'prestamo', documento, negocioId,
        valor: reparto.a_mora, metodo, usuarioId, estadoMora: mora,
        abonoPrestamoId: resultado.abono_id ?? null,
      });
    }

    if (color && prestamo.imei) {
      await client.query(
        `UPDATE seriales SET color = $1 WHERE imei = $2`,
        [color, prestamo.imei],
      );
    }

    let saldado    = false;
    let factura_id = null;

    // Se salda cuando el CAPITAL queda cubierto. Una mora pendiente no bloquea
    // el cierre: es una deuda aparte que sigue visible en el estado de cuenta.
    if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
      saldado = true;
      await repo.updateEstado(client, prestamoId, 'Saldado');

      // Crear factura automáticamente al saldar
      factura_id = await _crearFacturaDesdePrestamo(client, prestamo, metodo, negocioId);
    }

    await client.query('COMMIT');

    const despues = await moraService.estadoDe('prestamo', prestamoId, negocioId);
    return {
      ...resultado,
      saldado,
      factura_id,
      abonado_capital: reparto.a_capital,
      abonado_mora:    reparto.a_mora,
      movimiento_mora: movimientoMora,
      mora:            despues.mora,
      sucursal_id:     prestamo.sucursal_id     ?? null,
      prestatario:     prestamo.prestatario     ?? null,
      nombre_producto: prestamo.nombre_producto ?? null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: devolver préstamo completo ─────────────────────────────────────

const devolverPrestamo = async (negocioId, prestamoId) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  if (prestamo.estado === 'Devuelto') throw { status: 400, message: 'El préstamo ya fue devuelto' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (prestamo.imei) {
      const { rows: serialRows } = await client.query(
        `SELECT s.id FROM seriales s
         JOIN productos_serial ps ON ps.id = s.producto_id
         JOIN prestamos         p  ON p.sucursal_id = ps.sucursal_id
         WHERE s.imei = $1 AND p.id = $2`,
        [prestamo.imei, prestamoId]
      );
      if (serialRows.length) {
        await client.query(
          'UPDATE seriales SET prestado = false WHERE id = $1',
          [serialRows[0].id]
        );
      }
    } else if (prestamo.producto_id) {
      if (prestamo.variante_id) {
        await repo.ajustarStockVarianteEnTx(client, prestamo.variante_id, Number(prestamo.cantidad_prestada));
        await repo.sincronizarStockArbolEnTx(client, prestamo.producto_id);
      } else if (prestamo.atributo_id) {
        await repo.ajustarStockAtributoEnTx(client, prestamo.atributo_id, Number(prestamo.cantidad_prestada));
        await repo.sincronizarStockArbolEnTx(client, prestamo.producto_id);
      } else {
        await repo.ajustarStock(client, prestamo.producto_id, prestamo.cantidad_prestada);
      }
    }

    await repo.updateEstado(client, prestamoId, 'Devuelto');
    await client.query('COMMIT');

    return {
      id:              prestamo.id,
      sucursal_id:     prestamo.sucursal_id       ?? null,
      prestatario:     prestamo.prestatario       ?? null,
      nombre_producto: prestamo.nombre_producto   ?? null,
      imei:            prestamo.imei              ?? null,
      cantidad:        prestamo.cantidad_prestada ?? null,
      valor_prestamo:  prestamo.valor_prestamo    ?? null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: devolución parcial ─────────────────────────────────────────────

const devolverParcial = async (negocioId, prestamoId, cantidad_devuelta) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  if (prestamo.estado === 'Devuelto') throw { status: 400, message: 'El préstamo ya fue devuelto' };
  if (prestamo.imei) throw { status: 400, message: 'La devolución parcial solo aplica a productos por cantidad' };
  if (!prestamo.producto_id) throw { status: 400, message: 'El préstamo no tiene producto asociado' };

  const cantidadActual = Number(prestamo.cantidad_prestada);
  if (cantidad_devuelta < 1 || cantidad_devuelta > cantidadActual) {
    throw {
      status: 400,
      message: `La cantidad a devolver debe estar entre 1 y ${cantidadActual}`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (prestamo.variante_id) {
      await repo.ajustarStockVarianteEnTx(client, prestamo.variante_id, cantidad_devuelta);
      await repo.sincronizarStockArbolEnTx(client, prestamo.producto_id);
    } else if (prestamo.atributo_id) {
      await repo.ajustarStockAtributoEnTx(client, prestamo.atributo_id, cantidad_devuelta);
      await repo.sincronizarStockArbolEnTx(client, prestamo.producto_id);
    } else {
      await repo.ajustarStock(client, prestamo.producto_id, cantidad_devuelta);
    }

    if (cantidad_devuelta === cantidadActual) {
      await repo.updateEstado(client, prestamoId, 'Devuelto');
    } else {
      const valorTotal       = Number(prestamo.valor_prestamo);
      const cantidadRestante = cantidadActual - cantidad_devuelta;
      const precioUnitario   = valorTotal / cantidadActual;
      const nuevoValor       = Math.round(precioUnitario * cantidadRestante);

      await repo.actualizarCantidadYValor(client, prestamoId, cantidadRestante, nuevoValor);

      if (Number(prestamo.total_abonado) >= nuevoValor) {
        await repo.updateEstado(client, prestamoId, 'Saldado');
      }
    }

    await client.query('COMMIT');
    return {
      devuelto:        cantidad_devuelta,
      pendiente:       cantidadActual - cantidad_devuelta,
      sucursal_id:     prestamo.sucursal_id     ?? null,
      prestatario:     prestamo.prestatario     ?? null,
      nombre_producto: prestamo.nombre_producto ?? null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: intercambio — pago con producto (retoma) ───────────────────────
// El prestatario entrega un producto en vez de pagar en efectivo.
// El producto retomado ingresa al inventario y su valor se aplica como abono
// sobre el préstamo existente (no se crea un préstamo nuevo).

const intercambiarPrestamo = async (negocioId, prestamoId, {
  usuario_id,
  tipo_retoma = 'serial',    // 'serial' | 'cantidad'

  // Retoma serial
  imei_retoma,               // IMEI del equipo que entrega el prestatario
  producto_serial_id,        // FK a productos_serial (tipo/línea del equipo)
  color_retoma,
  caracteristicas_retoma,

  // Retoma cantidad
  producto_cantidad_id,      // FK a productos_cantidad
  cantidad_retoma = 1,

  // Comunes
  valor_retoma,
  descripcion,
  ingreso_inventario = true, // si false: solo aplica el valor como abono, sin tocar inventario
}) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };
  if (prestamo.estado !== 'Activo') {
    throw { status: 400, message: 'Solo se pueden aplicar intercambios a préstamos activos' };
  }

  const sucursalId     = prestamo.sucursal_id;
  const nombrePersona  = prestamo.prestatario || '';
  const tipoPers       = prestamo.prestatario_id ? 'prestatario' : 'cliente';
  const personaId      = prestamo.prestatario_id || prestamo.cliente_id;
  const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolver nombre del producto retomado
    let nombreProductoRetoma = descripcion || 'Producto retomado';
    if (tipo_retoma === 'serial' && producto_serial_id) {
      const { rows } = await client.query(
        'SELECT nombre FROM productos_serial WHERE id = $1',
        [producto_serial_id],
      );
      nombreProductoRetoma = rows[0]?.nombre || nombreProductoRetoma;
    } else if (tipo_retoma === 'cantidad' && producto_cantidad_id) {
      const { rows } = await client.query(
        'SELECT nombre FROM productos_cantidad WHERE id = $1',
        [producto_cantidad_id],
      );
      nombreProductoRetoma = rows[0]?.nombre || nombreProductoRetoma;
    }

    // 2. Ingresar producto retomado al inventario (si aplica)
    let retomaIngresoReal = false;

    if (ingreso_inventario) {
      if (tipo_retoma === 'serial' && imei_retoma && producto_serial_id) {
        const { rows: psRows } = await client.query(
          'SELECT id FROM productos_serial WHERE id = $1 AND sucursal_id = $2',
          [producto_serial_id, sucursalId],
        );
        if (!psRows.length) {
          throw { status: 400, message: 'El producto serial no pertenece a esta sucursal' };
        }
        // IMEI único por negocio: si ya existe se REACTIVA (equipo vendido que regresa);
        // si está en préstamo activo se bloquea; si no existe se inserta.
        const { rows: exRows } = await client.query(
          `SELECT s.id, s.prestado, s.vendido FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           JOIN sucursales       su ON su.id = ps.sucursal_id
           WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
          [imei_retoma.trim(), negocioId],
        );
        if (exRows.length) {
          if (exRows[0].prestado) {
            throw { status: 409, code: 'IMEI_PRESTADO', message: `El IMEI ${imei_retoma.trim()} está prestado. Ve a la pestaña de Préstamos y regístralo como devuelto para que regrese al inventario; no se puede ingresar como retoma.` };
          }
          if (!exRows[0].vendido) {
            throw { status: 409, message: `El IMEI ${imei_retoma.trim()} ya está registrado y disponible en el inventario.` };
          }
          await client.query(
            `UPDATE seriales
             SET vendido = false, prestado = false, fecha_salida = NULL,
                 precio          = COALESCE($1, precio),
                 color           = COALESCE($2, color),
                 cliente_origen  = $3,
                 caracteristicas = COALESCE($4::jsonb, caracteristicas)
             WHERE id = $5`,
            [
              Number(valor_retoma) || null,
              color_retoma || null,
              nombrePersona,
              caracteristicas_retoma != null ? JSON.stringify(caracteristicas_retoma) : null,
              exRows[0].id,
            ],
          );
        } else {
          await repo.insertarSerialParaRetoma(client, {
            producto_id:     producto_serial_id,
            imei:            imei_retoma.trim(),
            precio:          Number(valor_retoma),
            color:           color_retoma || null,
            cliente_origen:  nombrePersona,
            caracteristicas: caracteristicas_retoma || null,
          });
        }
        retomaIngresoReal = true;

      } else if (tipo_retoma === 'cantidad' && producto_cantidad_id) {
        const { rows: pcRows } = await client.query(
          'SELECT sucursal_id FROM productos_cantidad WHERE id = $1',
          [producto_cantidad_id],
        );
        if (!pcRows.length || pcRows[0].sucursal_id !== sucursalId) {
          throw { status: 400, message: 'El producto no pertenece a esta sucursal' };
        }
        await repo.ajustarStockConHistorialEnTx(client, {
          producto_id:    producto_cantidad_id,
          sucursal_id:    sucursalId,
          cantidad:       Number(cantidad_retoma || 1),
          costo_unitario: Number(valor_retoma) || null,
          cliente_origen: nombrePersona,
          tipo:           'retoma',
        });
        retomaIngresoReal = true;
      }
    }

    // 3. Registrar la retoma en la tabla retomas
    await repo.insertarRetoma(client, {
      prestamo_id:         prestamoId,
      nombre_producto:     nombreProductoRetoma,
      imei:                tipo_retoma === 'serial' ? (imei_retoma || null) : null,
      valor_retoma:        Number(valor_retoma),
      cantidad_retoma:     tipo_retoma === 'cantidad' ? Number(cantidad_retoma || 1) : 1,
      descripcion:         descripcion || `Retoma de ${nombreProductoRetoma} — ${nombrePersona}`,
      ingreso_inventario:  retomaIngresoReal,
      tipo_retoma,
      producto_serial_id:   tipo_retoma === 'serial'   ? (producto_serial_id   || null) : null,
      producto_cantidad_id: tipo_retoma === 'cantidad' ? (producto_cantidad_id || null) : null,
      color:               color_retoma || null,
    });

    // 4. Aplicar el valor de retoma como abono sobre el préstamo existente
    const montoAbono = Math.min(Number(valor_retoma), saldoPendiente);
    const resultado  = await repo.insertarAbono(client, {
      prestamo_id: prestamoId,
      valor:       montoAbono,
      metodo:      'Intercambio',
      usuario_id:  usuario_id || null,
    });

    let saldado       = false;
    let factura_id    = null;
    let saldo_a_favor = 0;

    if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
      saldado    = true;
      await repo.updateEstado(client, prestamoId, 'Saldado');
      factura_id = await _crearFacturaDesdePrestamo(client, prestamo, 'Intercambio', negocioId);
    }

    if (Number(valor_retoma) > saldoPendiente && personaId) {
      const excess      = Number(valor_retoma) - saldoPendiente;
      const saldoActual = await repo.getSaldoAFavorPersona(client, tipoPers, personaId);
      await repo.setearSaldoAFavorPersona(client, tipoPers, personaId, saldoActual + excess);
      saldo_a_favor = excess;

      const saldoSucActual = await repo.getSaldoSucursal(client, tipoPers, personaId, sucursalId);
      await repo.setSaldoSucursal(client, tipoPers, personaId, sucursalId, saldoSucActual + excess);
      await repo.registrarMovSaldoSucursal(client, {
        tipo_persona:    tipoPers,
        persona_id:      personaId,
        sucursal_id:     sucursalId,
        concepto:        `Excedente de intercambio — ${nombreProductoRetoma || 'producto'}`,
        monto:           excess,
        tipo_movimiento: 'credito',
        referencia_id:   prestamoId,
        usuario_id:      usuario_id || null,
      });
    }

    await client.query('COMMIT');

    return {
      prestamo_id:     prestamoId,
      valor_retoma:    Number(valor_retoma),
      montoAbono,
      saldado,
      factura_id,
      saldo_a_favor,
      saldo_pendiente: saldado ? 0 : Math.max(0, saldoPendiente - montoAbono),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: retoma directa — recibir producto sin préstamo activo ──────────
// El prestatario/cliente entrega un producto que se convierte en saldo a favor.

const retomaDirecta = async (negocioId, {
  sucursal_id, usuario_id,
  tipo, persona_id,
  tipo_retoma = 'serial',
  imei_retoma,
  producto_serial_id,
  color_retoma,
  caracteristicas_retoma,
  producto_cantidad_id,
  cantidad_retoma = 1,
  valor_retoma,
  descripcion,
  ingreso_inventario = true,
}) => {
  await _verificarSucursal(sucursal_id, negocioId);

  if (tipo === 'prestatario') {
    await _verificarPrestatario(persona_id, negocioId);
  } else {
    await _verificarCliente(persona_id, negocioId);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolver nombre del producto y de la persona
    let nombreProducto = descripcion || 'Producto retomado';
    if (tipo_retoma === 'serial' && producto_serial_id) {
      const { rows } = await client.query(
        'SELECT nombre FROM productos_serial WHERE id = $1', [producto_serial_id]
      );
      nombreProducto = rows[0]?.nombre || nombreProducto;
    } else if (tipo_retoma === 'cantidad' && producto_cantidad_id) {
      const { rows } = await client.query(
        'SELECT nombre FROM productos_cantidad WHERE id = $1', [producto_cantidad_id]
      );
      nombreProducto = rows[0]?.nombre || nombreProducto;
    }

    const tabla = tipo === 'prestatario' ? 'prestatarios' : 'clientes';
    const { rows: personaRows } = await client.query(
      `SELECT nombre FROM ${tabla} WHERE id = $1`, [persona_id]
    );
    const nombrePersona = personaRows[0]?.nombre || null;

    // 2. Ingresar al inventario si corresponde
    let retomaIngresoReal = false;
    if (ingreso_inventario) {
      if (tipo_retoma === 'serial' && imei_retoma && producto_serial_id) {
        const { rows: psRows } = await client.query(
          'SELECT id FROM productos_serial WHERE id = $1 AND sucursal_id = $2',
          [producto_serial_id, sucursal_id]
        );
        if (!psRows.length) throw { status: 400, message: 'El producto serial no pertenece a esta sucursal' };
        // IMEI único por negocio: si ya existe se REACTIVA (equipo vendido que regresa);
        // si está en préstamo activo se bloquea; si no existe se inserta.
        const { rows: exRows } = await client.query(
          `SELECT s.id, s.prestado, s.vendido FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           JOIN sucursales       su ON su.id = ps.sucursal_id
           WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
          [imei_retoma.trim(), negocioId]
        );
        if (exRows.length) {
          if (exRows[0].prestado) throw { status: 409, code: 'IMEI_PRESTADO', message: `El IMEI ${imei_retoma.trim()} está prestado. Ve a la pestaña de Préstamos y regístralo como devuelto para que regrese al inventario; no se puede ingresar como retoma.` };
          if (!exRows[0].vendido) throw { status: 409, message: `El IMEI ${imei_retoma.trim()} ya está registrado y disponible en el inventario.` };
          await client.query(
            `UPDATE seriales
             SET vendido = false, prestado = false, fecha_salida = NULL,
                 precio          = COALESCE($1, precio),
                 color           = COALESCE($2, color),
                 cliente_origen  = $3,
                 caracteristicas = COALESCE($4::jsonb, caracteristicas)
             WHERE id = $5`,
            [
              Number(valor_retoma) || null,
              color_retoma || null,
              nombrePersona,
              caracteristicas_retoma != null ? JSON.stringify(caracteristicas_retoma) : null,
              exRows[0].id,
            ]
          );
        } else {
          await repo.insertarSerialParaRetoma(client, {
            producto_id:     producto_serial_id,
            imei:            imei_retoma.trim(),
            precio:          Number(valor_retoma),
            color:           color_retoma || null,
            cliente_origen:  nombrePersona,
            caracteristicas: caracteristicas_retoma || null,
          });
        }
        retomaIngresoReal = true;
      } else if (tipo_retoma === 'cantidad' && producto_cantidad_id) {
        const { rows: pcRows } = await client.query(
          'SELECT sucursal_id FROM productos_cantidad WHERE id = $1', [producto_cantidad_id]
        );
        if (!pcRows.length || pcRows[0].sucursal_id !== sucursal_id) {
          throw { status: 400, message: 'El producto no pertenece a esta sucursal' };
        }
        await repo.ajustarStockConHistorialEnTx(client, {
          producto_id:    producto_cantidad_id,
          sucursal_id,
          cantidad:       Number(cantidad_retoma || 1),
          costo_unitario: Number(valor_retoma) || null,
          cliente_origen: nombrePersona,
          tipo:           'retoma',
        });
        retomaIngresoReal = true;
      }
    }

    // 3. Registrar la retoma
    await repo.insertarRetomaDirecta(client, {
      tipo_persona:        tipo,
      persona_id,
      sucursal_id,
      nombre_producto:     nombreProducto,
      imei:                tipo_retoma === 'serial' ? (imei_retoma || null) : null,
      valor_retoma:        Number(valor_retoma),
      cantidad_retoma:     tipo_retoma === 'cantidad' ? Number(cantidad_retoma || 1) : 1,
      descripcion:         descripcion || `Retoma directa — ${nombreProducto}`,
      ingreso_inventario:  retomaIngresoReal,
      tipo_retoma,
      producto_serial_id:  tipo_retoma === 'serial'   ? (producto_serial_id   || null) : null,
      producto_cantidad_id: tipo_retoma === 'cantidad' ? (producto_cantidad_id || null) : null,
      color:               color_retoma || null,
    });

    // 4. Acreditar el valor como saldo a favor (global + por sucursal)
    const saldoActual  = await repo.getSaldoAFavorPersona(client, tipo, persona_id);
    const saldoNuevo   = saldoActual + Number(valor_retoma);
    await repo.setearSaldoAFavorPersona(client, tipo, persona_id, saldoNuevo);

    const saldoSucActual = await repo.getSaldoSucursal(client, tipo, persona_id, sucursal_id);
    await repo.setSaldoSucursal(client, tipo, persona_id, sucursal_id, saldoSucActual + Number(valor_retoma));
    await repo.registrarMovSaldoSucursal(client, {
      tipo_persona:    tipo,
      persona_id,
      sucursal_id,
      concepto:        `Compra de artículo — ${nombreProducto}`,
      monto:           Number(valor_retoma),
      tipo_movimiento: 'credito',
      referencia_id:   null,
      usuario_id:      usuario_id || null,
    });

    await client.query('COMMIT');
    return { saldo_a_favor_nuevo: saldoNuevo, valor_retoma: Number(valor_retoma) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: aplicar saldo a favor a préstamos activos (FIFO) ───────────────

const aplicarSaldoAPrestamos = async (negocioId, tipo, personaId) => {
  if (tipo === 'prestatario') {
    await _verificarPrestatario(personaId, negocioId);
  } else {
    await _verificarCliente(personaId, negocioId);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let saldoRestante = await repo.getSaldoAFavorPersona(client, tipo, personaId);
    if (saldoRestante <= 0) {
      throw { status: 400, message: 'La persona no tiene saldo a favor disponible' };
    }

    const activos = await repo.findActivosPorPersona(client, tipo, personaId, negocioId);
    if (!activos.length) {
      throw { status: 400, message: 'No hay préstamos activos a los que aplicar el saldo' };
    }

    const prestamosAfectados = [];
    const deduccionesPorSucursal = {}; // { sucursalId: totalDeducido }

    for (const prestamo of activos) {
      if (saldoRestante <= 0) break;

      const saldoPendiente = Number(prestamo.saldo_pendiente);
      if (saldoPendiente <= 0) continue;

      const montoAbono = Math.min(saldoRestante, saldoPendiente);
      const resultado  = await repo.insertarAbono(client, {
        prestamo_id: prestamo.id,
        valor:       montoAbono,
        metodo:      'Saldo a favor',
        usuario_id:  null,
      });
      saldoRestante -= montoAbono;

      const sid = prestamo.sucursal_id;
      deduccionesPorSucursal[sid] = (deduccionesPorSucursal[sid] || 0) + montoAbono;

      let saldado    = false;
      let factura_id = null;

      if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
        saldado = true;
        await repo.updateEstado(client, prestamo.id, 'Saldado');
        factura_id = await _crearFacturaDesdePrestamo(client, prestamo, 'Saldo a favor', negocioId);
      }

      prestamosAfectados.push({
        id:           prestamo.id,
        nombre:       prestamo.nombre_producto,
        abono_aplicado: montoAbono,
        saldado,
        factura_id,
      });
    }

    await repo.setearSaldoAFavorPersona(client, tipo, personaId, saldoRestante);

    for (const [sucId, totalDeducido] of Object.entries(deduccionesPorSucursal)) {
      const sucursalId = Number(sucId);
      const saldoSuc   = await repo.getSaldoSucursal(client, tipo, personaId, sucursalId);
      const nuevoSuc   = Math.max(0, saldoSuc - totalDeducido);
      await repo.setSaldoSucursal(client, tipo, personaId, sucursalId, nuevoSuc);
      await repo.registrarMovSaldoSucursal(client, {
        tipo_persona:    tipo,
        persona_id:      personaId,
        sucursal_id:     sucursalId,
        concepto:        'Saldo aplicado a préstamos activos',
        monto:           totalDeducido,
        tipo_movimiento: 'debito',
        referencia_id:   null,
        usuario_id:      null,
      });
    }

    await client.query('COMMIT');
    return { prestamos_afectados: prestamosAfectados, saldo_restante: saldoRestante };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: ajuste de deuda (cargo artificial) ─────────────────────────────

const crearAjusteDeuda = async (negocioId, { tipo, persona_id, valor, descripcion, sucursal_id, usuario_id }) => {
  if (!['prestatario', 'cliente'].includes(tipo))
    throw { status: 400, message: "tipo debe ser 'prestatario' o 'cliente'" };
  if (!valor || Number(valor) <= 0)
    throw { status: 400, message: 'El valor del ajuste debe ser mayor a 0' };

  await _verificarSucursal(sucursal_id, negocioId);

  const result = await repo.crearAjusteDeuda({
    tipo, persona_id: Number(persona_id),
    valor: Number(valor), descripcion,
    sucursal_id, usuario_id, negocio_id: negocioId,
  });
  if (!result) throw { status: 404, message: 'Persona no encontrada' };
  return result;
};

// ─── Servicio: resumen de cartera de una persona ──────────────────────────────

const getResumenCartera = async (negocioId, tipo, personaId, sucursalId = null) => {
  if (tipo === 'prestatario') {
    await _verificarPrestatario(personaId, negocioId);
  } else {
    await _verificarCliente(personaId, negocioId);
  }

  const [resumen, activos] = await Promise.all([
    repo.getResumenPersona(pool, negocioId, tipo, personaId, sucursalId),
    repo.findActivosPorPersona(pool, tipo, personaId, negocioId, sucursalId),
  ]);

  return {
    total_activos:   Number(resumen?.total_activos  ?? 0),
    total_deuda:     Number(resumen?.total_deuda    ?? 0),
    total_pendiente: Number(resumen?.total_pendiente ?? 0),
    saldo_a_favor:   Number(resumen?.saldo_a_favor  ?? 0),
    prestamos_activos: activos,
  };
};

// ─── Servicio: anular abono ───────────────────────────────────────────────────
// retomaId: solo aplica cuando el abono tiene metodo='Intercambio'

const anularAbono = async (negocioId, prestamoId, abonoId, retomaId = null) => {
  const prestamo = await repo.findByIdYNegocio(prestamoId, negocioId);
  if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const abono = await repo.findAbonoById(client, abonoId, prestamoId);
    if (!abono) throw { status: 404, message: 'Abono no encontrado' };

    // Si el abono es de intercambio, primero revertir la retoma
    if (abono.metodo === 'Intercambio' && retomaId) {
      const retoma = await repo.findRetomaPorId(client, retomaId);
      if (retoma && retoma.prestamo_id === Number(prestamoId)) {
        if (retoma.ingreso_inventario) {
          if (retoma.tipo_retoma === 'serial' && retoma.imei) {
            const serial = await repo.findSerialEnInventario(client, retoma.imei);
            if (!serial) {
              throw { status: 400, message: `El equipo ${retoma.imei} ya fue vendido. Anula la venta primero.` };
            }
            if (serial.prestado) {
              throw { status: 400, message: `El equipo ${retoma.imei} está actualmente prestado. Devuelve el préstamo primero.` };
            }
            await repo.eliminarSerial(client, serial.id);
          } else if (retoma.tipo_retoma === 'cantidad' && retoma.producto_cantidad_id) {
            await client.query(
              'UPDATE productos_cantidad SET stock = GREATEST(0, stock - $1) WHERE id = $2',
              [retoma.cantidad_retoma, retoma.producto_cantidad_id]
            );
          }
        }
        await repo.eliminarRetoma(client, retomaId);
      }
    }

    // La mora que se cobró DENTRO de este abono se anula en cascada: si no, el
    // cliente quedaría con la mora "pagada" después de revertirse el pago.
    // Se anula (no se borra) para que quede la traza de la reversión.
    const moraRepo = require('../mora/mora.repository');
    const moraAnulada = await moraRepo.anularPorAbono(client, { abono_prestamo_id: abonoId });

    // Eliminar el abono y ajustar total_abonado
    await repo.eliminarAbono(client, abonoId);
    const prestamoDespues = await repo.restarTotalAbonado(client, prestamoId, Number(abono.valor));

    let saldado_revertido = false;
    let factura_cancelada_id = null;

    // Si el préstamo estaba Saldado y ya no lo está → revertir
    if (prestamo.estado === 'Saldado' &&
        Number(prestamoDespues.total_abonado) < Number(prestamoDespues.valor_prestamo)) {
      await repo.updateEstado(client, prestamoId, 'Activo');
      saldado_revertido = true;

      // Cancelar la factura generada por este préstamo
      factura_cancelada_id = await repo.cancelarFacturaDePrestamo(client, prestamoId);

      // Revertir serial de vendido → prestado
      if (prestamo.imei) {
        await repo.revertirSerialVendido(client, prestamo.imei, prestamo.sucursal_id);
      }
    }

    // Si el abono era 'Saldo a favor', devolver el monto a la persona
    if (abono.metodo === 'Saldo a favor') {
      const tipo      = prestamo.prestatario_id ? 'prestatario' : 'cliente';
      const personaId = prestamo.prestatario_id || prestamo.cliente_id;
      if (personaId) {
        const saldoActual = await repo.getSaldoAFavorPersona(client, tipo, personaId);
        await repo.setearSaldoAFavorPersona(client, tipo, personaId, saldoActual + Number(abono.valor));

        const sucursalId     = prestamo.sucursal_id;
        const saldoSucActual = await repo.getSaldoSucursal(client, tipo, personaId, sucursalId);
        await repo.setSaldoSucursal(client, tipo, personaId, sucursalId, saldoSucActual + Number(abono.valor));
        await repo.registrarMovSaldoSucursal(client, {
          tipo_persona:    tipo,
          persona_id:      personaId,
          sucursal_id:     sucursalId,
          concepto:        `Anulación de abono — ${prestamo.nombre_producto}`,
          monto:           Number(abono.valor),
          tipo_movimiento: 'credito',
          referencia_id:   prestamoId,
          usuario_id:      null,
        });
      }
    }

    await client.query('COMMIT');
    return {
      saldado_revertido, factura_cancelada_id,
      mora_anulada: moraAnulada.reduce((s, m) => s + Number(m.valor || 0), 0),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: anular retoma directa ─────────────────────────────────────────

const anularRetomaDirecta = async (negocioId, retomaId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const retoma = await repo.findRetomaPorId(client, retomaId);
    if (!retoma) throw { status: 404, message: 'Retoma no encontrada' };
    if (retoma.prestamo_id !== null) throw { status: 400, message: 'Esta retoma está ligada a un préstamo. Anula el abono desde el historial.' };

    // Verificar que pertenece a este negocio
    if (retoma.sucursal_id) {
      const { rows } = await client.query(
        'SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2',
        [retoma.sucursal_id, negocioId]
      );
      if (!rows.length) throw { status: 403, message: 'No autorizado' };
    }

    // Revertir inventario
    if (retoma.ingreso_inventario) {
      if (retoma.tipo_retoma === 'serial' && retoma.imei) {
        const serial = await repo.findSerialEnInventario(client, retoma.imei);
        if (!serial) {
          throw { status: 400, message: `El equipo ${retoma.imei} ya fue vendido. Anula la venta primero.` };
        }
        if (serial.prestado) {
          throw { status: 400, message: `El equipo ${retoma.imei} está actualmente prestado. Devuelve el préstamo primero.` };
        }
        await repo.eliminarSerial(client, serial.id);
      } else if (retoma.tipo_retoma === 'cantidad' && retoma.producto_cantidad_id) {
        await client.query(
          'UPDATE productos_cantidad SET stock = GREATEST(0, stock - $1) WHERE id = $2',
          [retoma.cantidad_retoma, retoma.producto_cantidad_id]
        );
      }
    }

    // Reducir saldo a favor (global + por sucursal)
    if (retoma.tipo_persona && retoma.persona_id) {
      const saldoActual = await repo.getSaldoAFavorPersona(client, retoma.tipo_persona, retoma.persona_id);
      const saldoNuevo  = Math.max(0, saldoActual - Number(retoma.valor_retoma));
      await repo.setearSaldoAFavorPersona(client, retoma.tipo_persona, retoma.persona_id, saldoNuevo);

      if (retoma.sucursal_id) {
        const saldoSucActual = await repo.getSaldoSucursal(client, retoma.tipo_persona, retoma.persona_id, retoma.sucursal_id);
        await repo.setSaldoSucursal(client, retoma.tipo_persona, retoma.persona_id, retoma.sucursal_id, Math.max(0, saldoSucActual - Number(retoma.valor_retoma)));
        await repo.registrarMovSaldoSucursal(client, {
          tipo_persona:    retoma.tipo_persona,
          persona_id:      retoma.persona_id,
          sucursal_id:     retoma.sucursal_id,
          concepto:        `Anulación de compra — ${retoma.nombre_producto || 'artículo'}`,
          monto:           Number(retoma.valor_retoma),
          tipo_movimiento: 'debito',
          referencia_id:   retomaId,
          usuario_id:      null,
        });
      }
    }

    await repo.eliminarRetoma(client, retomaId);

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: listar retomas directas de una persona ─────────────────────────

const getRetomasDirectas = async (negocioId, tipo, personaId, sucursalId = null) => {
  if (tipo === 'prestatario') {
    await _verificarPrestatario(personaId, negocioId);
  } else {
    await _verificarCliente(personaId, negocioId);
  }
  return repo.findRetomasDirectasPorPersona(pool, tipo, personaId, negocioId, sucursalId);
};

const getEstadoCuenta = async (negocioId, tipo, personaId, sucursalId = null) => {
  if (tipo === 'prestatario') {
    await _verificarPrestatario(personaId, negocioId);
  } else {
    await _verificarCliente(personaId, negocioId);
  }

  const rows = await repo.getEstadoCuenta(pool, negocioId, tipo, personaId, sucursalId);

  let saldoDeuda = 0;
  return rows.map((row) => {
    const cargo = Number(row.cargo || 0);
    const abono = Number(row.abono || 0);
    const esDevuelto = row.tipo === 'prestamo' && row.prestamo_estado === 'Devuelto';
    if (row.tipo !== 'compra_directa' && !esDevuelto) {
      saldoDeuda = saldoDeuda + cargo - abono;
    }
    return {
      fecha:           row.fecha,
      tipo:            row.tipo,
      concepto:        row.concepto,
      cargo:           cargo || null,
      abono:           abono || null,
      saldo:           (row.tipo === 'compra_directa' || esDevuelto) ? null : saldoDeuda,
      referencia_id:   Number(row.referencia_id),
      prestamo_id:     row.prestamo_id ? Number(row.prestamo_id) : null,
      anulable:        row.anulable,
      prestamo_estado: row.prestamo_estado || null,
    };
  });
};

// ─── Aplicar saldo a un préstamo específico ───────────────────────────────────

const aplicarSaldoAPrestamo = async (negocioId, prestamoId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prestamo = await repo.getPrestamoActivoById(client, prestamoId, negocioId);
    if (!prestamo) throw { status: 404, message: 'Préstamo no encontrado o no está activo' };

    const tipo      = prestamo.tipo_persona;
    const personaId = Number(prestamo.persona_id);

    const saldoAFavor = await repo.getSaldoAFavorPersona(client, tipo, personaId);
    if (saldoAFavor <= 0) throw { status: 400, message: 'La persona no tiene saldo a favor disponible' };

    const saldoPendiente = Number(prestamo.saldo_pendiente);
    if (saldoPendiente <= 0) throw { status: 400, message: 'El préstamo ya está saldado' };

    const montoAbono = Math.min(saldoAFavor, saldoPendiente);
    const resultado  = await repo.insertarAbono(client, {
      prestamo_id: prestamoId,
      valor:       montoAbono,
      metodo:      'Saldo a favor',
      usuario_id:  null,
    });

    let saldado    = false;
    let factura_id = null;
    if (Number(resultado.total_abonado) >= Number(resultado.valor_prestamo)) {
      saldado    = true;
      await repo.updateEstado(client, prestamoId, 'Saldado');
      factura_id = await _crearFacturaDesdePrestamo(client, prestamo, 'Saldo a favor', negocioId);
    }

    const saldoRestante = Math.max(0, saldoAFavor - montoAbono);
    await repo.setearSaldoAFavorPersona(client, tipo, personaId, saldoRestante);

    const sucursalId    = prestamo.sucursal_id;
    const saldoSucActual = await repo.getSaldoSucursal(client, tipo, personaId, sucursalId);
    await repo.setSaldoSucursal(client, tipo, personaId, sucursalId, Math.max(0, saldoSucActual - montoAbono));
    await repo.registrarMovSaldoSucursal(client, {
      tipo_persona:    tipo,
      persona_id:      personaId,
      sucursal_id:     sucursalId,
      concepto:        `Saldo aplicado — ${prestamo.nombre_producto}`,
      monto:           montoAbono,
      tipo_movimiento: 'debito',
      referencia_id:   prestamoId,
      usuario_id:      null,
    });

    await client.query('COMMIT');
    return {
      prestamo_id:     prestamoId,
      nombre_producto: prestamo.nombre_producto,
      abono_aplicado:  montoAbono,
      saldado,
      factura_id,
      saldo_restante:  saldoRestante,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const getSaldoSucursalPersona = async (negocioId, tipo, personaId, sucursalId) => {
  if (tipo === 'prestatario') {
    await _verificarPrestatario(personaId, negocioId);
  } else {
    await _verificarCliente(personaId, negocioId);
  }
  const saldo = await repo.getSaldoSucursalPublico(tipo, personaId, sucursalId);
  return { saldo };
};

const getHistorialSaldoSucursalPersona = async (negocioId, tipo, personaId, sucursalId) => {
  if (tipo === 'prestatario') {
    await _verificarPrestatario(personaId, negocioId);
  } else {
    await _verificarCliente(personaId, negocioId);
  }
  return repo.getHistorialSaldoSucursal(tipo, personaId, sucursalId);
};

const editarValorPrestamo = async (negocioId, prestamoId, nuevoValor) => {
  const pertenece = await repo.perteneceAlNegocio(prestamoId, negocioId);
  if (!pertenece) throw { status: 404, message: 'Préstamo no encontrado' };

  const prestamo = await repo.findById(prestamoId);
  if (prestamo.estado !== 'Activo') {
    throw { status: 400, message: 'Solo se pueden editar préstamos activos' };
  }
  if (Number(nuevoValor) < Number(prestamo.total_abonado)) {
    throw {
      status: 400,
      message: `El nuevo valor no puede ser menor al total ya abonado (${Number(prestamo.total_abonado).toLocaleString('es-CO')})`,
    };
  }

  return repo.updateValorPrestamo(prestamoId, nuevoValor);
};

// ─── Servicio: registrar abono total (FIFO) ───────────────────────────────────
// Distribuye un pago único entre los préstamos activos más antiguos primero.
// No genera facturas individuales — un solo entry en estado de cuenta.

// `modo` aplica DENTRO de cada préstamo; el recorrido entre préstamos siempre es
// del más viejo al más nuevo. `distribucion_manual` permite que el vendedor
// ajuste cuánto va a cada préstamo (el negocio pidió poder pactarlo con el
// cliente en el momento del pago para evitar inconvenientes).
const registrarAbonoTotal = async (
  negocioId, tipo, personaId, valorTotal, metodo, usuarioId, sucursalId,
  { modo = 'mora_capital', distribucion_manual = null } = {},
) => {
  if (tipo === 'prestatario') await _verificarPrestatario(personaId, negocioId);
  else await _verificarCliente(personaId, negocioId);

  const prestamosActivos = await repo.getPrestamoActivosPorPersona(pool, tipo, personaId, negocioId, sucursalId);
  if (!prestamosActivos.length) throw { status: 400, message: 'Esta persona no tiene préstamos activos en esta sucursal' };

  // El tope incluye la mora pendiente de cada préstamo: si solo se contara el
  // capital, un pago que cubre los intereses sería rechazado.
  const conMora = await moraService.anotarLista(prestamosActivos, 'prestamo');
  const moraPorPrestamo = new Map(conMora.map((p) => [Number(p.id), p.mora]));

  const totalPendiente = conMora.reduce(
    (s, p) => s + Number(p.valor_prestamo) - Number(p.total_abonado) + Number(p.mora?.pendiente || 0), 0
  );
  if (valorTotal > totalPendiente) {
    throw { status: 400, message: `El abono (${valorTotal}) supera el saldo total pendiente (${totalPendiente.toFixed(2)})` };
  }

  // Distribución elegida en pantalla: { [prestamo_id]: valor }. Se valida que
  // sume el abono y que ningún préstamo reciba más de lo que debe.
  let planManual = null;
  if (distribucion_manual && typeof distribucion_manual === 'object') {
    planManual = new Map();
    let suma = 0;
    for (const p of conMora) {
      const v = Math.max(0, Math.round(Number(distribucion_manual[p.id] ?? 0)));
      if (!v) continue;
      const debe = Number(p.valor_prestamo) - Number(p.total_abonado) + Number(p.mora?.pendiente || 0);
      if (v > debe) {
        throw {
          status: 400,
          message: `Al préstamo #${p.numero ?? p.id} le asignaste $${v.toLocaleString('es-CO')} `
            + `pero solo debe $${Math.round(debe).toLocaleString('es-CO')}`,
        };
      }
      planManual.set(Number(p.id), v);
      suma += v;
    }
    if (Math.round(suma) !== Math.round(valorTotal)) {
      throw {
        status: 400,
        message: `La distribución suma $${suma.toLocaleString('es-CO')} y el abono es `
          + `$${Math.round(valorTotal).toLocaleString('es-CO')}. Deben coincidir.`,
      };
    }
  }

  const sucId = sucursalId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const abonoTotal = await repo.insertarAbonoTotal(client, {
      tipo_persona: tipo,
      persona_id:   personaId,
      sucursal_id:  sucId,
      valor_total:  valorTotal,
      metodo,
      usuario_id:   usuarioId || null,
    });

    let remaining = valorTotal;
    const distribucion = [];

    for (const prestamo of prestamosActivos) {
      if (remaining <= 0) break;

      const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
      const mora           = moraPorPrestamo.get(Number(prestamo.id)) || { pendiente: 0 };
      const debeEste       = saldoPendiente + Number(mora.pendiente || 0);
      if (debeEste <= 0) continue;

      // Con plan manual, este préstamo recibe exactamente lo asignado; si no,
      // se le da todo lo que quepa (FIFO del más viejo).
      const paraEste = planManual
        ? Math.min(planManual.get(Number(prestamo.id)) || 0, remaining)
        : Math.min(remaining, debeEste);
      if (paraEste <= 0) continue;

      // El reparto interno mora/capital usa la MISMA función que el abono
      // individual, así los dos caminos no pueden divergir.
      const reparto = repartirAbono({
        valor: paraEste,
        mora_pendiente: Number(mora.pendiente || 0),
        saldo_capital:  saldoPendiente,
        modo,
      });

      let abonoId = null;
      let upd = [{ valor_prestamo: prestamo.valor_prestamo, total_abonado: prestamo.total_abonado }];

      if (reparto.a_capital > 0) {
        const { rows: ab } = await client.query(
          `INSERT INTO abonos_prestamo(prestamo_id, valor, metodo, usuario_id, abono_total_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [prestamo.id, reparto.a_capital, metodo, usuarioId || null, abonoTotal.id]
        );
        abonoId = ab[0].id;

        ({ rows: upd } = await client.query(
          `UPDATE prestamos SET total_abonado = total_abonado + $1
           WHERE id = $2 RETURNING valor_prestamo, total_abonado`,
          [reparto.a_capital, prestamo.id]
        ));
      }

      if (reparto.a_mora > 0) {
        await moraService.registrarCobroEnTx(client, {
          tipo: 'prestamo', documento: prestamo, negocioId,
          valor: reparto.a_mora, metodo, usuarioId,
          estadoMora: mora, abonoPrestamoId: abonoId,
        });
      }

      const saldado = Number(upd[0].total_abonado) >= Number(upd[0].valor_prestamo);
      if (saldado) {
        await repo.updateEstado(client, prestamo.id, 'Saldado');
        if (prestamo.imei) {
          await client.query(
            `UPDATE seriales s
             SET vendido = true, prestado = false, fecha_salida = CURRENT_DATE
             FROM productos_serial ps
             WHERE s.imei = $1 AND ps.id = s.producto_id AND ps.sucursal_id = $2`,
            [prestamo.imei, prestamo.sucursal_id]
          );
        }
      }

      distribucion.push({
        prestamo_id:     prestamo.id,
        nombre_producto: prestamo.nombre_producto,
        abono:           paraEste,
        abono_capital:   reparto.a_capital,
        abono_mora:      reparto.a_mora,
        saldado,
      });
      remaining -= paraEste;
    }

    await client.query('COMMIT');
    return { abonoTotal, distribucion };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Servicio: modificar abono total ─────────────────────────────────────────
// Revierte todos los abonos individuales del total y re-distribuye con el nuevo valor.

const modificarAbonoTotal = async (negocioId, abonoTotalId, nuevoValor, metodo) => {
  const abonoTotal = await repo.getAbonoTotalById(abonoTotalId, negocioId);
  if (!abonoTotal) throw { status: 404, message: 'Abono total no encontrado' };

  if (nuevoValor >= Number(abonoTotal.valor_total)) {
    throw { status: 400, message: 'Solo se puede reducir el valor de un abono total. Para aumentar, registra un nuevo abono.' };
  }

  const { tipo_persona: tipo, persona_id: personaId } = abonoTotal;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Obtener abonos individuales de este total (FIFO)
    const abonosExistentes = await repo.getAbonosPorTotal(client, abonoTotalId);
    if (!abonosExistentes.length) throw { status: 400, message: 'No hay abonos asociados a este pago total' };

    // Calcular máximo modificable (saldo pendiente real + lo que ya se pagó con este total)
    const totalDisponible = abonosExistentes.reduce(
      (s, a) => s + (Number(a.valor_prestamo) - Number(a.total_abonado)) + Number(a.valor), 0
    );
    if (nuevoValor > totalDisponible) {
      throw { status: 400, message: `El nuevo valor supera el saldo disponible (${totalDisponible.toFixed(2)})` };
    }

    // 2. Revertir cada abono individual
    const moraRepo = require('../mora/mora.repository');
    for (const abono of abonosExistentes) {
      // La mora cobrada dentro de este abono se anula antes de revertir el
      // capital: si no, quedaría "pagada" sobre un abono que ya no existe. La
      // redistribución de más abajo la vuelve a causar y cobrar si corresponde.
      await moraRepo.anularPorAbono(client, { abono_prestamo_id: abono.id });

      await client.query(
        'UPDATE prestamos SET total_abonado = total_abonado - $1 WHERE id = $2',
        [abono.valor, abono.prestamo_id]
      );
      // Si el préstamo estaba Saldado y ahora no alcanza, restaurar a Activo
      const { rows: pRows } = await client.query(
        'SELECT total_abonado, valor_prestamo, estado FROM prestamos WHERE id = $1',
        [abono.prestamo_id]
      );
      const p = pRows[0];
      if (p.estado === 'Saldado' && Number(p.total_abonado) < Number(p.valor_prestamo)) {
        await repo.updateEstado(client, abono.prestamo_id, 'Activo');
        if (abono.imei) {
          await client.query(
            `UPDATE seriales s
             SET vendido = false, prestado = true, fecha_salida = NULL
             FROM productos_serial ps, sucursales su
             WHERE s.producto_id = ps.id
               AND ps.sucursal_id = su.id
               AND su.negocio_id = $2
               AND s.imei = $1`,
            [abono.imei, negocioId]
          );
        }
      }
      await client.query('DELETE FROM abonos_prestamo WHERE id = $1', [abono.id]);
    }

    // 3. Re-distribuir FIFO con nuevo valor — usa client para ver los préstamos restaurados en esta transacción
    const prestamosActivos = await repo.getPrestamoActivosPorPersona(client, tipo, personaId, negocioId, abonoTotal.sucursal_id);
    let remaining = nuevoValor;

    for (const prestamo of prestamosActivos) {
      if (remaining <= 0) break;
      const saldoPendiente = Number(prestamo.valor_prestamo) - Number(prestamo.total_abonado);
      if (saldoPendiente <= 0) continue;

      const abonoEste = Math.min(remaining, saldoPendiente);

      await client.query(
        `INSERT INTO abonos_prestamo(prestamo_id, valor, metodo, usuario_id, abono_total_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [prestamo.id, abonoEste, metodo || abonoTotal.metodo, null, abonoTotalId]
      );

      const { rows: upd } = await client.query(
        `UPDATE prestamos SET total_abonado = total_abonado + $1
         WHERE id = $2 RETURNING valor_prestamo, total_abonado`,
        [abonoEste, prestamo.id]
      );

      if (Number(upd[0].total_abonado) >= Number(upd[0].valor_prestamo)) {
        await repo.updateEstado(client, prestamo.id, 'Saldado');
        if (prestamo.imei) {
          await client.query(
            `UPDATE seriales s
             SET vendido = true, prestado = false, fecha_salida = CURRENT_DATE
             FROM productos_serial ps
             WHERE s.imei = $1 AND ps.id = s.producto_id AND ps.sucursal_id = $2`,
            [prestamo.imei, prestamo.sucursal_id]
          );
        }
      }
      remaining -= abonoEste;
    }

    // 4. Actualizar registro maestro
    await client.query(
      'UPDATE abonos_totales SET valor_total = $1, metodo = $2 WHERE id = $3',
      [nuevoValor, metodo || abonoTotal.metodo, abonoTotalId]
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getPrestamos, getPrestamoById,
  crearPrestamo, crearPrestamos,
  registrarAbono,
  devolverPrestamo, devolverParcial,
  registrarSaldoAFavor,
  intercambiarPrestamo,
  retomaDirecta, aplicarSaldoAPrestamos, aplicarSaldoAPrestamo, getResumenCartera,
  anularAbono, anularRetomaDirecta, getRetomasDirectas,
  getEstadoCuenta, crearAjusteDeuda, editarValorPrestamo,
  getSaldoSucursalPersona, getHistorialSaldoSucursalPersona,
  registrarAbonoTotal, modificarAbonoTotal,
  fijarPlazo, condonarMora, cobrarMora,
};