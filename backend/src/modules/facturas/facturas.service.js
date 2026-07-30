const { pool } = require('../../config/db');
const facturasRepo = require('./facturas.repository');
const serialRepo   = require('../productos/productosSerial.repository');
const cantidadRepo = require('../productos/productosCantidad.repository');
const clientesRepo = require('../clientes/clientes.repository');
const cajaRepo     = require('../caja/caja.repository');
const { enviarFactura }      = require('../email/email.service');
const garantiasRepo          = require('../garantias/garantias.repository');
const { calcularCostoPromedio } = require('../../utils/costoPromedio.util');

const ES_COMPANERO = (cedula) => cedula === 'COMPANERO';

const _fechaHoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Normaliza las características de una retoma serial a JSON para la columna
// jsonb de seriales. Solo acepta un objeto plano con al menos un valor no vacío;
// cualquier otra cosa (null, string, array, objeto vacío) devuelve null.
const _caracteristicasRetomaJson = (valor) => {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const limpio = Object.fromEntries(
    Object.entries(valor).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
  );
  return Object.keys(limpio).length ? JSON.stringify(limpio) : null;
};

const _verificarProductoCantidadNegocio = async (client, productoId, negocioId) => {
  const { rows } = await client.query(
    `SELECT pc.id FROM productos_cantidad pc
     JOIN sucursales su ON su.id = pc.sucursal_id
     WHERE pc.id = $1 AND su.negocio_id = $2`,
    [productoId, negocioId]
  );
  if (!rows.length) {
    throw { status: 403, message: 'El producto de retoma no pertenece a este negocio' };
  }
};

const resolverClienteId = async (client, negocioId, { cedula, nombre, celular, email, direccion }) => {
  if (ES_COMPANERO(cedula)) return null;
  const { rows } = await client.query(
    `SELECT id FROM clientes WHERE cedula = $1 AND negocio_id = $2`,
    [cedula, negocioId]
  );
  if (rows.length) return rows[0].id;
  const { rows: nuevos } = await client.query(
    `INSERT INTO clientes (negocio_id, nombre, cedula, celular, email, direccion)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [negocioId, nombre, cedula, celular || null, email || null, direccion || null]
  );
  return nuevos[0].id;
};

const _leerStockYCosto = async (client, productoId) => {
  const { rows } = await client.query(
    'SELECT stock, costo_unitario FROM productos_cantidad WHERE id = $1',
    [productoId]
  );
  return rows[0] || null;
};

// ── Consultas ─────────────────────────────────────────────────────────────────

const getFacturas = (sucursalId, negocioId) =>
  facturasRepo.findAll(sucursalId, negocioId);

const getFacturasRecientes = (sucursalId, negocioId, { cursor, dias }) =>
  facturasRepo.findRecientes(sucursalId, negocioId, { cursor, dias });

const buscarFacturas = (sucursalId, negocioId, { q, desde, hasta, limit, offset }) =>
  facturasRepo.buscar(sucursalId, negocioId, { q, desde, hasta, limit, offset });

const getFacturaById = async (negocioId, id) => {
  const factura = await facturasRepo.findByIdYNegocio(id, negocioId);
  if (!factura) throw { status: 404, message: 'Factura no encontrada' };

  const domiciliariosRepo = require('../domiciliarios/domiciliarios.repository');

  const [lineas, pagos, retomas, entrega] = await Promise.all([
    facturasRepo.getLineas(id, negocioId),
    facturasRepo.getPagos(id),
    facturasRepo.getRetomas(id),
    domiciliariosRepo.findEntregaByFacturaId(id, negocioId),
  ]);

  // El crédito asociado, con su estado de mora ya resuelto. Lo necesitan la
  // pantalla de cancelación (para preguntar si se revierte la mora cobrada) y el
  // PDF (para imprimir las condiciones pactadas).
  // Va en try/catch: la migración de mora puede no estar aplicada, y el detalle
  // de la factura no puede fallar por eso.
  let credito = null;
  try {
    const { rows } = await pool.query(`SELECT * FROM creditos WHERE factura_id = $1`, [id]);
    if (rows.length) {
      const moraService = require('../mora/mora.service');
      credito = await moraService.anotarDocumento(rows[0], 'credito');
    }
  } catch (err) {
    console.warn('[facturas] Crédito no incluido en el detalle:', err.message);
  }

  return { ...factura, lineas, pagos, retomas, domicilio: entrega || null, credito };
};

// ── Crear factura ─────────────────────────────────────────────────────────────

const crearFactura = async ({
  negocio_id, sucursal_id, usuario_id, vendedor_id,
  nombre_cliente, cedula, celular, email, direccion, notas,
  lineas, pagos, retomas = [],
  domicilio,
  es_credito, cuota_inicial,
  // Plazo de pago y condición de mora (feature opt-in `mora_activa`). Sin fecha,
  // el crédito no tiene mora — que es el comportamiento de siempre.
  fecha_limite, mora_condicion_id,
}) => {
  const { pool }             = require('../../config/db');
  const facturasRepo         = require('./facturas.repository');
  const { enviarFactura }    = require('../email/email.service');
  const garantiasRepo        = require('../garantias/garantias.repository');
  const domiciliariosService = require('../domiciliarios/domiciliarios.service');
  const creditosRepo         = require('../creditos/creditos.repository');
  const vendedoresRepo       = require('../vendedores/vendedores.repository');

  const ES_COMPANERO = (c) => c === 'COMPANERO';
  const _fechaHoy = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const _verificarProductoCantidadNegocio = async (client, productoId, nId) => {
    const { rows } = await client.query(
      `SELECT pc.id FROM productos_cantidad pc
       JOIN sucursales su ON su.id = pc.sucursal_id
       WHERE pc.id = $1 AND su.negocio_id = $2`,
      [productoId, nId]
    );
    if (!rows.length) throw { status: 403, message: 'El producto de retoma no pertenece a este negocio' };
  };
  const resolverClienteId = async (client, nId, { cedula: ced, nombre, celular: cel, email: em, direccion: dir }) => {
    if (ES_COMPANERO(ced)) return null;
    const { rows } = await client.query(
      `SELECT id FROM clientes WHERE cedula = $1 AND negocio_id = $2`, [ced, nId]
    );
    if (rows.length) return rows[0].id;
    const { rows: nuevos } = await client.query(
      `INSERT INTO clientes(negocio_id, nombre, cedula, celular, email, direccion)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [nId, nombre, ced, cel || null, em || null, dir || null]
    );
    return nuevos[0].id;
  };

  const { rows: sucRows } = await pool.query(
    `SELECT id FROM sucursales WHERE id = $1 AND negocio_id = $2 AND activa = true`,
    [sucursal_id, negocio_id]
  );
  if (!sucRows.length) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  // ── Vendedor (opcional / obligatorio según config del negocio) ────────────
  // Si `vendedores_activo` está encendido, la factura DEBE llevar un vendedor de
  // la sucursal. Si está apagado, se ignora por completo (comportamiento actual).
  const { rows: cfgVend } = await pool.query(
    `SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'vendedores_activo'`,
    [negocio_id]
  );
  const vendedoresActivo = cfgVend[0]?.valor === '1';
  const vendedorFinal    = vendedoresActivo ? (vendedor_id || null) : null;
  if (vendedoresActivo && !vendedorFinal) {
    throw { status: 400, message: 'Debes seleccionar el vendedor que realizó la venta' };
  }

  const tieneRetomas   = Array.isArray(retomas) && retomas.length > 0;
  const tieneDomicilio = !!(domicilio?.domiciliario_id);
  if (tieneRetomas && tieneDomicilio) {
    throw {
      status: 400,
      message: 'Una factura no puede tener retoma y pedido a domicilio al mismo tiempo.',
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cliente_id = await resolverClienteId(client, negocio_id, {
      cedula, nombre: nombre_cliente, celular, email, direccion,
    });

    // Validar que el vendedor pertenezca al negocio y a la sucursal, y esté activo.
    if (vendedorFinal) {
      const vendedorValido = await vendedoresRepo.validarEnSucursalTx(
        client, vendedorFinal, negocio_id, sucursal_id
      );
      if (!vendedorValido) {
        throw { status: 400, message: 'El vendedor no pertenece a esta sucursal o está inactivo' };
      }
    }

    const factura = await facturasRepo.create(client, {
  sucursal_id, usuario_id, cliente_id, vendedor_id: vendedorFinal,
  nombre_cliente, cedula, celular, notas,
  estado: es_credito ? 'Credito' : 'Activa',
});

    let totalLineas = 0;

    for (const linea of lineas) {
      const lineaInsertada = await facturasRepo.insertarLinea(client, {
        factura_id:      factura.id,
        nombre_producto: linea.nombre_producto,
        imei:            linea.imei        || null,
        cantidad:        linea.cantidad,
        precio:          linea.precio,
        producto_id:     linea.imei ? null : (linea.producto_id || null),
        atributo_id:     linea.atributo_id || null,
        variante_id:     linea.variante_id || null,
      });
      totalLineas += Number(lineaInsertada.subtotal || 0);

      if (linea.imei) {
        // FOR UPDATE bloquea el serial durante la venta para evitar doble venta concurrente.
        const { rows: serialRows } = await client.query(
          `SELECT s.id, s.vendido, s.prestado FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           WHERE s.imei = $1 AND ps.sucursal_id = $2
           FOR UPDATE OF s`,
          [linea.imei, sucursal_id]
        );
        if (!serialRows.length) {
          throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
        }
        if (serialRows[0].vendido) {
          throw { status: 400, message: `El equipo ${linea.imei} ya fue vendido` };
        }
        if (serialRows[0].prestado) {
          throw { status: 400, message: `El equipo ${linea.imei} está prestado y no se puede vender` };
        }
        await client.query(
          'UPDATE seriales SET vendido = true, fecha_salida = CURRENT_DATE WHERE id = $1',
          [serialRows[0].id]
        );
      } else if (linea.producto_id) {
        if (linea.variante_id) {
          // Nivel variante (árbol nivel 2)
          const { rows: varRows } = await client.query(
            `SELECT v.stock FROM variantes_atributo v
             JOIN atributos_producto ap ON ap.id = v.atributo_id
             WHERE v.id = $1 AND ap.sucursal_id = $2`,
            [linea.variante_id, sucursal_id]
          );
          if (!varRows.length) throw { status: 400, message: `Variante de ${linea.nombre_producto} no encontrada` };
          if (varRows[0].stock < linea.cantidad) {
            throw { status: 400, message: `Stock insuficiente para ${linea.nombre_producto}` };
          }
          await facturasRepo.ajustarStockVarianteEnTx(client, linea.variante_id, -linea.cantidad);
          await facturasRepo.sincronizarStockArbolEnTx(client, linea.producto_id);
        } else if (linea.atributo_id) {
          // Nivel atributo (árbol nivel 1)
          const { rows: atrRows } = await client.query(
            `SELECT stock FROM atributos_producto WHERE id = $1 AND sucursal_id = $2`,
            [linea.atributo_id, sucursal_id]
          );
          if (!atrRows.length) throw { status: 400, message: `Atributo de ${linea.nombre_producto} no encontrado` };
          if (atrRows[0].stock < linea.cantidad) {
            throw { status: 400, message: `Stock insuficiente para ${linea.nombre_producto}` };
          }
          await facturasRepo.ajustarStockAtributoEnTx(client, linea.atributo_id, -linea.cantidad);
          await facturasRepo.sincronizarStockArbolEnTx(client, linea.producto_id);
        } else {
          // Flujo original (sin árbol)
          const { rows: prodRows } = await client.query(
            `SELECT id, stock, sucursal_id FROM productos_cantidad WHERE id = $1`,
            [linea.producto_id]
          );
          const producto = prodRows[0];
          if (!producto) throw { status: 404, message: `Producto ${linea.nombre_producto} no encontrado` };
          if (producto.sucursal_id !== sucursal_id) {
            throw { status: 400, message: `El producto ${linea.nombre_producto} no pertenece a esta sucursal` };
          }
          if (producto.stock < linea.cantidad) {
            throw { status: 400, message: `Stock insuficiente para ${linea.nombre_producto}` };
          }
          await facturasRepo.ajustarStockCantidad(client, linea.producto_id, -linea.cantidad);
        }
      }
    }

    if (pagos?.length) {
      for (const pago of pagos) {
        if (pago.valor > 0) {
          await facturasRepo.insertarPago(client, {
            factura_id: factura.id,
            metodo:     pago.metodo,
            valor:      pago.valor,
          });
        }
      }
    }

    for (const retoma of retomas) {
      const colorRetoma           = retoma.tipo_retoma === 'serial' ? (retoma.color_retoma || null) : null;
      const caracteristicasRetoma = retoma.tipo_retoma === 'serial'
        ? _caracteristicasRetomaJson(retoma.caracteristicas_retoma)
        : null;

      await facturasRepo.insertarRetoma(client, {
        factura_id:         factura.id,
        descripcion:        retoma.descripcion,
        valor_retoma:       retoma.valor_retoma,
        ingreso_inventario: retoma.ingreso_inventario || false,
        nombre_producto:    retoma.nombre_producto    || null,
        imei:               retoma.imei               || null,
        cantidad_retoma:    retoma.cantidad_retoma     || 1,
        color:              colorRetoma,
      });

      if (retoma.ingreso_inventario && retoma.tipo_retoma === 'serial' && retoma.imei) {
        const { rows: existeRows } = await client.query(
          `SELECT s.id, s.prestado, s.vendido FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           JOIN sucursales       su ON su.id = ps.sucursal_id
           WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
          [retoma.imei, negocio_id]
        );
        const existeSerial = existeRows[0] || null;

        if (retoma.reactivar_serial_id) {
          const { rows: serialCheck } = await client.query(
            `SELECT s.id, s.vendido, s.prestado FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             JOIN sucursales       su ON su.id = ps.sucursal_id
             WHERE s.id = $1 AND su.negocio_id = $2`,
            [retoma.reactivar_serial_id, negocio_id]
          );
          if (!serialCheck.length) throw { status: 403, message: 'El serial a reactivar no pertenece a este negocio' };
          if (serialCheck[0].prestado) {
            throw { status: 409, code: 'IMEI_PRESTADO', message: `El IMEI ${retoma.imei} está prestado. Ve a la pestaña de Préstamos y regístralo como devuelto para que regrese al inventario; no se puede ingresar como retoma.` };
          }
          if (!serialCheck[0].vendido) {
            throw { status: 409, message: `El IMEI ${retoma.imei} ya está registrado y disponible en el inventario.` };
          }
          await client.query(
            `UPDATE seriales SET vendido = false, prestado = false,
             fecha_salida = NULL, cliente_origen = $1,
             color = COALESCE($2, color),
             caracteristicas = COALESCE($3::jsonb, caracteristicas)
             WHERE id = $4`,
            [nombre_cliente, colorRetoma, caracteristicasRetoma, retoma.reactivar_serial_id]
          );
        } else if (existeSerial) {
          if (existeSerial.prestado) {
            throw { status: 409, code: 'IMEI_PRESTADO', message: `El IMEI ${retoma.imei} está prestado. Ve a la pestaña de Préstamos y regístralo como devuelto para que regrese al inventario; no se puede ingresar como retoma.` };
          }
          if (!existeSerial.vendido) {
            throw { status: 409, message: `El IMEI ${retoma.imei} ya está registrado y disponible en el inventario.` };
          }
          // Solo se reactiva un serial VENDIDO que regresa (IMEI único por negocio).
          await client.query(
            `UPDATE seriales SET vendido = false, prestado = false,
             fecha_salida = NULL, cliente_origen = $1,
             color = COALESCE($2, color),
             caracteristicas = COALESCE($3::jsonb, caracteristicas)
             WHERE id = $4`,
            [nombre_cliente, colorRetoma, caracteristicasRetoma, existeSerial.id]
          );
        } else if (retoma.producto_serial_id) {
          const { rows: psCheck } = await client.query(
            `SELECT ps.id FROM productos_serial ps
             JOIN sucursales su ON su.id = ps.sucursal_id
             WHERE ps.id = $1 AND su.negocio_id = $2`,
            [retoma.producto_serial_id, negocio_id]
          );
          if (!psCheck.length) throw { status: 403, message: 'El producto de retoma no pertenece a este negocio' };
          await client.query(
            `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, cliente_origen, color, caracteristicas)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
            [retoma.producto_serial_id, retoma.imei, _fechaHoy(), retoma.valor_retoma, nombre_cliente,
             colorRetoma, caracteristicasRetoma]
          );
        }
      }

      if (retoma.ingreso_inventario && retoma.tipo_retoma === 'cantidad' && retoma.producto_cantidad_id) {
        await _verificarProductoCantidadNegocio(client, retoma.producto_cantidad_id, negocio_id);
        const productoActual = await _leerStockYCosto(client, retoma.producto_cantidad_id);
        await facturasRepo.ajustarStockCantidad(client, retoma.producto_cantidad_id, Number(retoma.cantidad_retoma || 1));

        if (productoActual && Number(retoma.valor_retoma) > 0) {
          const cantRetoma = Number(retoma.cantidad_retoma || 1);
          const costoUnitarioRetoma = Number(retoma.valor_retoma) / cantRetoma;
          const costoPromedio = calcularCostoPromedio(
            productoActual.stock, productoActual.costo_unitario, cantRetoma, costoUnitarioRetoma,
          );
          await facturasRepo.actualizarCostoPromedio(client, retoma.producto_cantidad_id, costoPromedio);
        }
      }
    }

    if (domicilio?.domiciliario_id) {
      await domiciliariosService.crearEntregaEnTransaccion(client, {
        facturaId:        factura.id,
        domiciliarioId:   domicilio.domiciliario_id,
        negocioId:        negocio_id,
        usuarioId:        usuario_id,
        valorTotal:       totalLineas,
        direccionEntrega: domicilio.direccion_entrega || null,
        notas:            domicilio.notas             || null,
      });
    }

    // ── Crear crédito si la venta es a crédito ──────────────────────────────
    if (es_credito) {
      // La condición de mora se CONGELA en el crédito: si el negocio sube la
      // tasa mañana, no puede aplicarla a lo ya otorgado. Devuelve nulos si la
      // feature está apagada o si no se pidió plazo.
      const moraService = require('../mora/mora.service');
      const datosMora = await moraService.datosParaNuevoDocumento(negocio_id, {
        fecha_limite, mora_condicion_id,
      });

      await creditosRepo.create(client, {
        factura_id:    factura.id,
        cliente_id:    cliente_id,
        sucursal_id:   sucursal_id,
        valor_total:   totalLineas,
        cuota_inicial: Number(cuota_inicial || 0),
        ...datosMora,
      });
    }

    await client.query('COMMIT');

    if (email) {
      (async () => {
        try {
          const { rows: configRows } = await pool.query(
            `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`, [negocio_id]
          );
          const configMap = {};
          for (const row of configRows) configMap[row.clave] = row.valor;
          if (configMap.campo_email_cliente === '1') {
            const [lineasEmail, pagosEmail, retomasEmail, garantiasEmail] = await Promise.all([
              facturasRepo.getLineas(factura.id, negocio_id),
              facturasRepo.getPagos(factura.id),
              facturasRepo.getRetomas(factura.id),
              garantiasRepo.findPorFactura(factura.id),
            ]);
            await enviarFactura(
              { ...factura, lineas: lineasEmail, pagos: pagosEmail, retomas: retomasEmail, garantias: garantiasEmail, email },
              configMap
            );
          }
        } catch (err) {
          console.warn('[email] Error al enviar factura:', err?.message || err);
        }
      })();
    }

    return factura;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Cancelar factura ──────────────────────────────────────────────────────────

// `revertirMora`: si la factura es a crédito y ya se le cobró mora, anula esos
// movimientos. Se pregunta al usuario en vez de decidirlo solo, porque las dos
// respuestas son válidas: si al cliente se le devuelve toda la plata hay que
// revertirla (o quedaría inflando los ingresos), pero si el negocio se queda con
// los intereses ya causados, no.
const cancelarFactura = async (negocioId, id, eliminarRetoma = false, _desdeDevolucion = false, revertirMora = false) => {
  const factura = await facturasRepo.findByIdYNegocio(id, negocioId);
  if (!factura) throw { status: 404, message: 'Factura no encontrada' };
  if (factura.estado === 'Cancelada') throw { status: 400, message: 'La factura ya está cancelada' };

  if (!_desdeDevolucion) {
    const domiciliariosRepo = require('../domiciliarios/domiciliarios.repository');
    const entregaPendiente  = await domiciliariosRepo.findEntregaByFacturaId(id, negocioId);
    if (entregaPendiente && entregaPendiente.estado === 'Pendiente') {
      throw {
        status: 400,
        message: `Esta factura tiene un pedido a domicilio activo asignado a "${entregaPendiente.domiciliario_nombre}". Para cancelarla, primero registra la devolución desde el módulo de Domiciliarios.`,
      };
    }
  }

  const pagos = await facturasRepo.getPagos(id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lineas = await facturasRepo.getLineas(id, negocioId);
    for (const linea of lineas) {
      if (linea.imei) {
        const { rows: serialRows } = await client.query(
          `SELECT s.id FROM seriales s
           JOIN productos_serial ps ON ps.id = s.producto_id
           JOIN facturas          f  ON f.sucursal_id = ps.sucursal_id
           WHERE s.imei = $1 AND f.id = $2`,
          [linea.imei, id]
        );
        if (serialRows.length) {
          await client.query(
            'UPDATE seriales SET vendido = false, fecha_salida = NULL WHERE id = $1',
            [serialRows[0].id]
          );
        }
      } else if (linea.producto_id) {
        if (linea.variante_id) {
          await facturasRepo.ajustarStockVarianteEnTx(client, linea.variante_id, linea.cantidad);
          await facturasRepo.sincronizarStockArbolEnTx(client, linea.producto_id);
        } else if (linea.atributo_id) {
          await facturasRepo.ajustarStockAtributoEnTx(client, linea.atributo_id, linea.cantidad);
          await facturasRepo.sincronizarStockArbolEnTx(client, linea.producto_id);
        } else {
          await facturasRepo.ajustarStockCantidad(client, linea.producto_id, linea.cantidad);
        }
      }
    }

    if (eliminarRetoma) {
      const retomas = await facturasRepo.getRetomas(id);
      for (const retoma of retomas) {
        if (!retoma.ingreso_inventario) continue;
        if (retoma.imei) {
          const { rows: serialRows } = await client.query(
            `SELECT s.id FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             JOIN sucursales       su ON su.id = ps.sucursal_id
             WHERE s.imei = $1 AND su.negocio_id = $2 AND s.vendido = false LIMIT 1`,
            [retoma.imei, negocioId]
          );
          if (serialRows.length) {
            await client.query('DELETE FROM seriales WHERE id = $1', [serialRows[0].id]);
          }
        } else if (retoma.nombre_producto) {
          const { rows: prodRows } = await client.query(
            `SELECT pc.id FROM productos_cantidad pc
             WHERE pc.nombre ILIKE $1 AND pc.sucursal_id = $2 LIMIT 1`,
            [retoma.nombre_producto, factura.sucursal_id]
          );
          if (prodRows.length) {
            const cantidadRevertir = -Math.abs(Number(retoma.cantidad_retoma) || 1);
            await facturasRepo.ajustarStockCantidad(client, prodRows[0].id, cantidadRevertir);
          }
        }
      }
    }

    await facturasRepo.cancelar(client, id);

    // ── Mora cobrada en el crédito de esta factura ─────────────────────────
    // Se anula (no se borra) para que quede la traza de la reversión. Con la
    // feature apagada no hay filas y esto no hace nada.
    let moraRevertida = 0;
    if (revertirMora) {
      try {
        const { rows: cr } = await client.query(
          `SELECT id FROM creditos WHERE factura_id = $1`, [id]
        );
        if (cr.length) {
          const { rows: anulados } = await client.query(`
            UPDATE movimientos_mora SET anulado = TRUE
            WHERE credito_id = $1 AND NOT anulado
            RETURNING valor, tipo
          `, [cr[0].id]);
          moraRevertida = anulados
            .filter((m) => m.tipo === 'Cobro')
            .reduce((s, m) => s + Number(m.valor || 0), 0);
        }
      } catch (err) {
        // La tabla puede no existir si la migración de mora no se aplicó: la
        // cancelación no puede fallar por eso.
        console.warn('[facturas] Mora no revertida al cancelar:', err.message);
      }
    }

    // ── Devolución en caja ────────────────────────────────────────────────
    // Modelo de cierre congelado: la caja del día en que entró el dinero es la
    // que lo contabilizó. Por eso solo se registra un EGRESO de devolución por
    // el efectivo que se cobró en cajas ANTERIORES (ya cerradas): factura.fecha
    // o abono.fecha < apertura de la caja actual. El efectivo cobrado en la
    // caja abierta actual NO se devuelve como egreso: al quedar la factura
    // 'Cancelada', las queries de caja (pf y ac) ya lo excluyen del resumen en
    // vivo, así que sumar un egreso lo descontaría dos veces.
    // Se devuelve TODO lo cobrado en efectivo: cuota inicial (pagos) + abonos
    // de crédito. Los pagos con método 'Credito' no son efectivo → no se tocan.
    const METODOS_NO_CAJA = ['Credito'];
    const cajaActiva = await cajaRepo.findCajaAbierta(factura.sucursal_id);

    // Las facturas con domicilio NO entran en caja por sus pagos (el dinero
    // entra vía abono_domicilio). Devolver sus pagos crearía un egreso por
    // dinero que nunca entró, así que se omite la devolución para ellas.
    const { rows: entregaRows } = await client.query(
      `SELECT 1 FROM entregas_domicilio WHERE factura_id = $1 LIMIT 1`,
      [id]
    );
    const tieneDomicilio = entregaRows.length > 0;

    if (cajaActiva && !tieneDomicilio) {
      const apertura = new Date(cajaActiva.fecha_apertura);
      let totalDevolucion = 0;

      // Cuota inicial / pagos en efectivo (contados en pf a la fecha de la factura)
      if (new Date(factura.fecha) < apertura) {
        totalDevolucion += pagos
          .filter((p) => !METODOS_NO_CAJA.includes(p.metodo))
          .reduce((s, p) => s + Number(p.valor || 0), 0);
      }

      // Abonos de crédito ya cobrados en efectivo, cada uno según su fecha
      const creditosRepo = require('../creditos/creditos.repository');
      const credito = await creditosRepo.findByFacturaId(client, id);
      if (credito) {
        const abonos = await creditosRepo.getAbonos(credito.id);
        totalDevolucion += abonos
          .filter((a) => !METODOS_NO_CAJA.includes(a.metodo) && new Date(a.fecha) < apertura)
          .reduce((s, a) => s + Number(a.valor || 0), 0);
      }

      if (totalDevolucion > 0) {
        await client.query(
          `INSERT INTO movimientos_caja(caja_id, tipo, concepto, valor, referencia_id, referencia_tipo)
           VALUES ($1, 'Egreso', $2, $3, $4, 'factura_cancelada')`,
          [
            cajaActiva.id,
            `Devolución factura #${String(factura.numero ?? id).padStart(6, '0')} — ${factura.nombre_cliente}`,
            totalDevolucion,
            id,
          ]
        );
      }
    }

    await client.query('COMMIT');
    return { mora_revertida: moraRevertida };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Editar factura ────────────────────────────────────────────────────────────

const editarFactura = async (negocioId, id, {
  nombre_cliente, cedula, celular, email, direccion, notas,
  lineas, pagos, retoma, vendedor_id,
}) => {
  const vendedoresRepo = require('../vendedores/vendedores.repository');

  const facturaActual = await facturasRepo.findByIdYNegocio(id, negocioId);
  if (!facturaActual) throw { status: 404, message: 'Factura no encontrada' };
  if (facturaActual.estado === 'Cancelada') {
    throw { status: 400, message: 'No se puede editar una factura cancelada' };
  }

  // El vendedor solo se puede cambiar si la config del negocio lo tiene activo.
  // Si está apagado, se ignora el vendedor_id recibido (no toca la columna).
  const { rows: cfgVend } = await pool.query(
    `SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'vendedores_activo'`,
    [negocioId]
  );
  const vendedoresActivo = cfgVend[0]?.valor === '1';
  const vendedorFinal    = (vendedoresActivo && vendedor_id) ? vendedor_id : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validar el vendedor contra la sucursal de la factura antes de asignarlo.
    if (vendedorFinal) {
      const vendedorValido = await vendedoresRepo.validarEnSucursalTx(
        client, vendedorFinal, negocioId, facturaActual.sucursal_id
      );
      if (!vendedorValido) {
        throw { status: 400, message: 'El vendedor no pertenece a esta sucursal o está inactivo' };
      }
    }

    const cliente_id = await resolverClienteId(client, negocioId, {
      cedula, nombre: nombre_cliente, celular, email, direccion,
    });

    await client.query(
      `UPDATE facturas
       SET nombre_cliente = $1, cedula = $2, celular = $3, notas = $4, cliente_id = $5,
           vendedor_id = COALESCE($6, vendedor_id)
       WHERE id = $7`,
      [nombre_cliente, cedula, celular, notas, cliente_id, vendedorFinal, id]
    );

    for (const linea of lineas) {
      await client.query(
        `UPDATE lineas_factura SET precio = $1, cantidad = $2
         WHERE id = $3 AND factura_id = $4`,
        [linea.precio, linea.cantidad, linea.id, id]
      );
    }

    await client.query('DELETE FROM pagos_factura WHERE factura_id = $1', [id]);
    for (const pago of pagos) {
      if (Number(pago.valor) > 0) {
        await facturasRepo.insertarPago(client, {
          factura_id: id,
          metodo:     pago.metodo,
          valor:      Number(pago.valor),
        });
      }
    }

    if (retoma) {
      const colorRetoma           = retoma.tipo_retoma === 'serial' ? (retoma.color_retoma || null) : null;
      const caracteristicasRetoma = retoma.tipo_retoma === 'serial'
        ? _caracteristicasRetomaJson(retoma.caracteristicas_retoma)
        : null;

      await facturasRepo.insertarRetoma(client, {
        factura_id:         id,
        descripcion:        retoma.descripcion,
        valor_retoma:       retoma.valor_retoma,
        ingreso_inventario: retoma.ingreso_inventario || false,
        nombre_producto:    retoma.nombre_producto    || null,
        imei:               retoma.imei               || null,
        cantidad_retoma:    retoma.cantidad_retoma     || 1,
        color:              colorRetoma,
      });

      if (retoma.ingreso_inventario) {
        if (retoma.tipo_retoma === 'serial' && retoma.imei) {
          const { rows: existeRows } = await client.query(
            `SELECT s.id, s.prestado, s.vendido FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             JOIN sucursales       su ON su.id = ps.sucursal_id
             WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2 LIMIT 1`,
            [retoma.imei, negocioId]
          );
          const existeSerial = existeRows[0] || null;

          if (retoma.producto_serial_id) {
            if (existeSerial) {
              if (existeSerial.prestado) {
                throw { status: 409, code: 'IMEI_PRESTADO', message: `El IMEI ${retoma.imei} está prestado. Ve a la pestaña de Préstamos y regístralo como devuelto para que regrese al inventario; no se puede ingresar como retoma.` };
              }
              if (!existeSerial.vendido) {
                throw { status: 409, message: `El IMEI ${retoma.imei} ya está registrado y disponible en el inventario.` };
              }
              await client.query(
                `UPDATE seriales
                 SET vendido = false, prestado = false, fecha_salida = NULL, cliente_origen = $1,
                     color = COALESCE($2, color),
                     caracteristicas = COALESCE($3::jsonb, caracteristicas)
                 WHERE id = $4`,
                [nombre_cliente, colorRetoma, caracteristicasRetoma, existeSerial.id]
              );
            } else {
              const { rows: psCheck } = await client.query(
                `SELECT ps.id FROM productos_serial ps
                 JOIN sucursales su ON su.id = ps.sucursal_id
                 WHERE ps.id = $1 AND su.negocio_id = $2`,
                [retoma.producto_serial_id, negocioId]
              );
              if (!psCheck.length) {
                throw { status: 403, message: 'El producto de retoma no pertenece a este negocio' };
              }
              await client.query(
                `INSERT INTO seriales(producto_id, imei, fecha_entrada, costo_compra, cliente_origen, color, caracteristicas)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
                [retoma.producto_serial_id, retoma.imei,
                 _fechaHoy(), retoma.valor_retoma, nombre_cliente,
                 colorRetoma, caracteristicasRetoma]
              );
            }
          }
        }

        if (retoma.tipo_retoma === 'cantidad' && retoma.producto_cantidad_id) {
          await _verificarProductoCantidadNegocio(client, retoma.producto_cantidad_id, negocioId);
          const productoActual = await _leerStockYCosto(client, retoma.producto_cantidad_id);

          await facturasRepo.ajustarStockCantidad(
            client, retoma.producto_cantidad_id, Number(retoma.cantidad_retoma || 1)
          );

          if (productoActual && Number(retoma.valor_retoma) > 0) {
            const cantRetoma = Number(retoma.cantidad_retoma || 1);
            const costoUnitarioRetoma = Number(retoma.valor_retoma) / cantRetoma;
            const costoPromedio = calcularCostoPromedio(
              productoActual.stock, productoActual.costo_unitario, cantRetoma, costoUnitarioRetoma,
            );
            await facturasRepo.actualizarCostoPromedio(client, retoma.producto_cantidad_id, costoPromedio);
          }
        }
      }
    }

    await client.query('COMMIT');
    return await facturasRepo.findByIdYNegocio(id, negocioId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Devolución parcial de líneas en una factura a crédito ─────────────────────
// lineasDevolver: [{ linea_id: Number, cantidad_devolver: Number }]

const devolverLineasCredito = async (negocioId, facturaId, lineasDevolver) => {
  const creditosRepo = require('../creditos/creditos.repository');

  const factura = await facturasRepo.findByIdYNegocio(facturaId, negocioId);
  if (!factura) throw { status: 404, message: 'Factura no encontrada' };
  if (factura.estado === 'Cancelada') throw { status: 400, message: 'La factura ya está cancelada' };
  if (factura.estado !== 'Credito') throw { status: 400, message: 'Solo se pueden hacer devoluciones parciales en facturas a crédito' };
  if (!Array.isArray(lineasDevolver) || lineasDevolver.length === 0) {
    throw { status: 400, message: 'Debes seleccionar al menos un producto para devolver' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const credito = await creditosRepo.findByFacturaId(client, facturaId);
    if (!credito) throw { status: 404, message: 'Crédito asociado no encontrado' };
    if (credito.estado === 'Cancelado') throw { status: 400, message: 'El crédito ya está cancelado' };

    const todasLineas = await facturasRepo.getLineasConDevolucion(client, facturaId);

    let totalDevuelto = 0;

    for (const { linea_id, cantidad_devolver } of lineasDevolver) {
      const linea = todasLineas.find((l) => l.id === Number(linea_id));
      if (!linea) throw { status: 404, message: `Línea ${linea_id} no encontrada en esta factura` };

      const cantDisponible = Number(linea.cantidad) - Number(linea.cantidad_devuelta || 0);
      if (cantidad_devolver <= 0 || cantidad_devolver > cantDisponible) {
        throw {
          status: 400,
          message: `Cantidad inválida para "${linea.nombre_producto}" (disponible para devolver: ${cantDisponible})`,
        };
      }

      // Restaurar stock / serial
      if (linea.imei) {
        await client.query(
          `UPDATE seriales SET vendido = false, fecha_salida = NULL
           WHERE imei = $1
             AND producto_id IN (
               SELECT ps.id FROM productos_serial ps
               JOIN sucursales su ON su.id = ps.sucursal_id
               WHERE su.id = $2
             )`,
          [linea.imei, factura.sucursal_id]
        );
      } else if (linea.producto_id) {
        if (linea.variante_id) {
          await facturasRepo.ajustarStockVarianteEnTx(client, linea.variante_id, cantidad_devolver);
          await facturasRepo.sincronizarStockArbolEnTx(client, linea.producto_id);
        } else if (linea.atributo_id) {
          await facturasRepo.ajustarStockAtributoEnTx(client, linea.atributo_id, cantidad_devolver);
          await facturasRepo.sincronizarStockArbolEnTx(client, linea.producto_id);
        } else {
          await facturasRepo.ajustarStockCantidad(client, linea.producto_id, cantidad_devolver);
        }
      }

      await facturasRepo.marcarLineaDevuelta(client, linea.id, cantidad_devolver);
      totalDevuelto += Number(linea.precio) * cantidad_devolver;
    }

    // Reducir el valor total del crédito
    const creditoActualizado = await creditosRepo.reducirValorTotal(client, credito.id, totalDevuelto);
    const nuevoValorTotal = Number(creditoActualizado.valor_total);
    const cuotaInicial    = Number(creditoActualizado.cuota_inicial || 0);
    const totalAbonado    = Number(creditoActualizado.total_abonado || 0);

    // Verificar si queda completamente pagado con lo ya abonado
    const nuevoSaldo = nuevoValorTotal - cuotaInicial - totalAbonado;

    // Recargar líneas para verificar si todas están devueltas
    const lineasActualizadas = await facturasRepo.getLineasConDevolucion(client, facturaId);
    const todasDevueltas = lineasActualizadas.every(
      (l) => Number(l.cantidad_devuelta || 0) >= Number(l.cantidad)
    );

    if (todasDevueltas) {
      // Cancelar factura y crédito completos
      await facturasRepo.cancelar(client, facturaId);
      await client.query(`UPDATE creditos SET estado = 'Cancelado' WHERE id = $1`, [credito.id]);
    } else if (nuevoSaldo <= 0 && creditoActualizado.estado === 'Activo') {
      await client.query(`UPDATE creditos SET estado = 'Saldado' WHERE id = $1`, [credito.id]);
    }

    await client.query('COMMIT');

    return {
      total_devuelto:    totalDevuelto,
      cancelada:         todasDevueltas,
      credito_saldado:   !todasDevueltas && nuevoSaldo <= 0,
      nuevo_valor_total: nuevoValorTotal,
      nuevo_saldo:       Math.max(0, nuevoSaldo),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getFacturas, getFacturasRecientes, buscarFacturas,
  getFacturaById, crearFactura, cancelarFactura, editarFactura,
  devolverLineasCredito,
};