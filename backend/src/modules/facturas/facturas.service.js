const { pool } = require('../../config/db');
const facturasRepo = require('./facturas.repository');
const serialRepo   = require('../productos/productosSerial.repository');
const cantidadRepo = require('../productos/productosCantidad.repository');
const clientesRepo = require('../clientes/clientes.repository');
const cajaRepo     = require('../caja/caja.repository');
const { enviarFactura }      = require('../email/email.service');
const garantiasRepo          = require('../garantias/garantias.repository');
const { calcularCostoPromedio } = require('../../utils/costoPromedio.util');
const { ingresarSerialRetomado, revertirIngresoSerial, rastroParaRetoma } = require('../../utils/retomaSerial.util');
const precioMinimo = require('../../utils/precioMinimo.util');

// Piso de una línea de factura (feature opt-in `precio_minimo_activo`). La línea
// solo guarda el IMEI de un serial, así que se busca por IMEI dentro de la sede.
// Una línea sin producto (texto libre) no tiene precio escrito y no tiene piso.
const _pisoLineaFactura = (client, regla, linea, sucursalId) => (
  linea.imei
    ? precioMinimo.pisoSerial(client, regla, { imei: linea.imei, sucursalId })
    : precioMinimo.pisoCantidad(client, regla, {
        productoId: linea.producto_id, atributoId: linea.atributo_id, varianteId: linea.variante_id,
      })
);

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

// ── Ingreso al inventario de una retoma por CANTIDAD ─────────────────────────
//
// Con la feature «Variantes» activa el stock vive en la HOJA
// (variante > atributo) y el del producto es un DERIVADO. Escribir arriba —lo
// que hacía este bloque— deja el producto diciendo 5 con sus tallas en 0, y el
// primer ajuste sobre cualquier variante dispara `sincronizarStockProducto`,
// que recalcula producto = Σ variantes y BORRA lo retomado. Es el mismo error
// que ya costó corregir en la red interna y en el código escaneable.
//
// El costo promedio se pondera contra el stock del MISMO nodo: el del producto
// es la suma de todas las tallas y no dice nada de esta.
const _ingresarRetomaCantidad = async (client, negocioId, retoma) => {
  await _verificarProductoCantidadNegocio(client, retoma.producto_cantidad_id, negocioId);

  const cantidad = Number(retoma.cantidad_retoma || 1);
  const varianteId = retoma.variante_id ? Number(retoma.variante_id) : null;
  const atributoId = retoma.atributo_id ? Number(retoma.atributo_id) : null;

  // Qué nodo recibe y de dónde se lee su costo actual.
  let leerNodo;
  if (varianteId) {
    leerNodo = ['SELECT stock, costo_unitario FROM variantes_atributo WHERE id = $1', varianteId];
  } else if (atributoId) {
    leerNodo = ['SELECT stock, costo_unitario FROM atributos_producto WHERE id = $1', atributoId];
  } else {
    leerNodo = ['SELECT stock, costo_unitario FROM productos_cantidad WHERE id = $1', retoma.producto_cantidad_id];
  }

  const { rows: nodoRows } = await client.query(leerNodo[0], [leerNodo[1]]);
  const nodo = nodoRows[0] || null;
  if (!nodo) throw { status: 404, message: 'El nodo de la retoma no existe' };

  if (varianteId) {
    await facturasRepo.ajustarStockVarianteEnTx(client, varianteId, cantidad);
  } else if (atributoId) {
    await facturasRepo.ajustarStockAtributoEnTx(client, atributoId, cantidad);
  } else {
    await facturasRepo.ajustarStockCantidad(client, retoma.producto_cantidad_id, cantidad);
  }

  if (Number(retoma.valor_retoma) > 0) {
    const costoPromedio = calcularCostoPromedio(
      nodo.stock, nodo.costo_unitario, cantidad, Number(retoma.valor_retoma) / cantidad,
    );
    if (varianteId) {
      await client.query('UPDATE variantes_atributo SET costo_unitario = $1 WHERE id = $2', [costoPromedio, varianteId]);
    } else if (atributoId) {
      await client.query('UPDATE atributos_producto SET costo_unitario = $1 WHERE id = $2', [costoPromedio, atributoId]);
    } else {
      await facturasRepo.actualizarCostoPromedio(client, retoma.producto_cantidad_id, costoPromedio);
    }
  }

  // El producto se recalcula DESPUÉS, nunca se escribe a mano.
  if (varianteId || atributoId) {
    await facturasRepo.sincronizarStockArbolEnTx(client, retoma.producto_cantidad_id);
  }
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

  // El crédito asociado, con su mora resuelta, sus abonos y el RESUMEN de la
  // obligación (estado, saldo, plazo, historial con saldo corrido).
  //
  // El resumen se calcula aquí, en el servidor, y de él beben por igual el PDF,
  // el ticket POS y la pantalla: es lo que garantiza que los tres muestren
  // exactamente las mismas cifras. Ver utils/obligacion.js.
  //
  // Va en try/catch: la migración de mora puede no estar aplicada, y el detalle
  // de la factura no puede fallar por eso.
  let credito = null;
  try {
    const { rows } = await pool.query(`SELECT * FROM creditos WHERE factura_id = $1`, [id]);
    if (rows.length) {
      const moraService  = require('../mora/mora.service');
      const creditosRepo = require('../creditos/creditos.repository');
      const { resumirObligacion } = require('../../utils/obligacion');

      credito = await moraService.anotarDocumento(rows[0], 'credito');
      const abonos = await creditosRepo.getAbonos(credito.id);

      const devuelto = lineas.reduce(
        (s, l) => s + Number(l.cantidad_devuelta || 0) * Number(l.precio), 0);

      credito.abonos  = abonos;
      credito.resumen = resumirObligacion({
        tipo: 'credito',
        documento: { ...credito, factura_numero: factura.numero, factura_id: factura.id },
        abonos,
        mora:    credito.mora    || null,
        interes: credito.interes || null,
        devuelto,
      });
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
  // Plan de interés corriente (feature opt-in `interes_activa`), independiente
  // del plazo: un crédito puede causar interés sin tener fecha límite.
  interes_plan_id,
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

    // Precio mínimo (opt-in). Con la clave apagada `regla` es null y no corre
    // una sola consulta más por línea.
    const reglaPrecio = await precioMinimo.leerRegla(client, negocio_id);

    for (const linea of lineas) {
      if (reglaPrecio) {
        precioMinimo.exigirNoBajoMinimo({
          valor:  linea.precio,
          piso:   await _pisoLineaFactura(client, reglaPrecio, linea, sucursal_id),
          nombre: linea.nombre_producto,
        });
      }
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
      const esSerial    = retoma.tipo_retoma === 'serial';
      const colorRetoma = esSerial ? (retoma.color_retoma || null) : null;

      // El ingreso va ANTES de grabar la retoma, y no al reves: hasta ahora la
      // fila se escribia diciendo `ingreso_inventario = true` y despues se
      // intentaba ingresar, asi que si el ingreso no ocurria (sin referencia
      // elegida) la retoma quedaba mintiendo. Ahora se graba lo que de verdad
      // paso, con el rastro para poder deshacerlo.
      let rastro = null;

      if (retoma.ingreso_inventario && esSerial && retoma.imei) {
        rastro = await ingresarSerialRetomado(client, {
          negocioId:         negocio_id,
          sucursalId:        sucursal_id,
          imei:              retoma.imei,
          productoSerialId:  retoma.producto_serial_id || null,
          valorRetoma:       retoma.valor_retoma,
          precioVenta:       retoma.precio_venta ?? null,
          clienteOrigen:     nombre_cliente,
          color:             colorRetoma,
          caracteristicas:   retoma.caracteristicas_retoma,
          reactivarSerialId: retoma.reactivar_serial_id || null,
        });
      }

      if (retoma.ingreso_inventario && !esSerial && retoma.producto_cantidad_id) {
        await _ingresarRetomaCantidad(client, negocio_id, retoma);
        rastro = { ingresado: true };
      }

      await facturasRepo.insertarRetoma(client, {
        factura_id:         factura.id,
        descripcion:        retoma.descripcion,
        valor_retoma:       retoma.valor_retoma,
        ingreso_inventario: !!(retoma.ingreso_inventario && rastro?.ingresado),
        nombre_producto:    retoma.nombre_producto    || null,
        imei:               retoma.imei               || null,
        cantidad_retoma:    retoma.cantidad_retoma     || 1,
        color:              colorRetoma,
        ...rastroParaRetoma(rastro),
      });
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
      // El pacto (mora e interés) se CONGELA en el crédito: si el negocio sube
      // la tasa mañana, no puede aplicarla a lo ya otorgado. Devuelve nulos si
      // las features están apagadas o si no se pidieron.
      const moraService = require('../mora/mora.service');
      const datosMora = await moraService.datosParaNuevoDocumento(negocio_id, {
        fecha_limite, mora_condicion_id, interes_plan_id,
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

    // Deshacer el ingreso de la retoma. Antes esto era un `DELETE FROM seriales`
    // a secas: sobre una REACTIVACIÓN eso no borraba lo que la retoma creó,
    // borraba la unidad ORIGINAL —con su costo, su proveedor y su vínculo con la
    // compra— y dejaba la línea de la factura que la vendió apuntando a un
    // serial inexistente. `revertirIngresoSerial` la devuelve a como estaba.
    if (eliminarRetoma) {
      const retomas = await facturasRepo.getRetomas(id);
      for (const retoma of retomas) {
        if (!retoma.ingreso_inventario) continue;
        if (retoma.imei) {
          await revertirIngresoSerial(client, {
            negocioId,
            imei:           retoma.imei,
            serialId:       retoma.serial_id ?? null,
            reactivado:     !!retoma.reactivado,
            estadoAnterior: retoma.estado_anterior ?? null,
          });
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
      void credito;

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

    // Cancelar la factura saca el cobro de la cuenta del cliente. Sus abonos se
    // quedaban vivos restando contra nada — el mismo error que tenía préstamos
    // al devolver un producto abonado, y que dejaba el estado de cuenta por
    // debajo de la deuda real. Se anulan con el motivo a la vista.
    {
      const creditosRepoCancel = require('../creditos/creditos.repository');
      const creditoCancel = await creditosRepoCancel.findByFacturaId(client, id);
      if (creditoCancel) {
        await creditosRepoCancel.anularAbonosDeCredito(
          client, creditoCancel.id,
          `Anulado: se canceló la factura #${String(factura.numero ?? id).padStart(6, '0')}`,
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
//
// Una factura a CRÉDITO tiene su valor escrito DOS veces: en `lineas_factura`
// (lo que pinta la factura y su PDF) y en `creditos.valor_total` (lo que leen el
// saldo, el abono, el estado de cuenta y el bloque del crédito en el PDF).
// Editar solo cambiaba las líneas: una venta de $3.940.000 rebajada a
// $3.790.000 seguía debiendo $3.940.000, el abono aceptaba esa cifra y el PDF
// mostraba las dos a la vez.
//
// El ajuste es por DIFERENCIA (lo que ESTA edición cambió), no un recálculo:
// así una edición que solo corrige la cédula no toca el crédito, y la cuota
// inicial sigue la misma regla con los pagos. Se mide sobre la cantidad VIGENTE
// (cantidad − devuelta) porque la devolución ya rebajó `valor_total` al precio
// de ese momento: con eso, cargo del extracto = valor_total + devuelto sigue
// dando el valor original con el precio nuevo.

const _valorVigente = (lineas) => lineas.reduce((s, l) =>
  s + Number(l.precio || 0) * Math.max(0, Number(l.cantidad || 0) - Number(l.cantidad_devuelta || 0)), 0);

const _sumaPagos = async (client, facturaId) => {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(valor), 0) AS total FROM pagos_factura WHERE factura_id = $1`, [facturaId]);
  return Number(rows[0].total);
};

const _ajustarCreditoEditado = async (client, negocioId, credito, { lineasAntes, pagosAntes }) => {
  const lineasDespues = await facturasRepo.getLineasConDevolucion(client, credito.factura_id);
  const deltaValor = _valorVigente(lineasDespues) - _valorVigente(lineasAntes);
  const deltaCuota = (await _sumaPagos(client, credito.factura_id)) - pagosAntes;
  if (Math.abs(deltaValor) < 0.01 && Math.abs(deltaCuota) < 0.01) return null;

  const valorAntes = Number(credito.valor_total);
  const cuotaAntes = Number(credito.cuota_inicial || 0);
  const abonado    = Number(credito.total_abonado || 0);
  const valorNuevo = valorAntes + deltaValor;
  const cuotaNueva = cuotaAntes + deltaCuota;
  const saldoNuevo = valorNuevo - cuotaNueva - abonado;

  // Bajar por debajo de lo ya pagado dejaría plata sin nada a qué aplicarse, y
  // el sistema no puede saber si se le devuelve al cliente o se le deja a favor.
  // Lo decide una persona ANTES: anular el abono que sobra, o devolver producto.
  if (saldoNuevo < -0.5) {
    const fmt = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;
    throw {
      status: 409,
      code: 'CREDITO_PAGADO_DE_MAS',
      message: `El cliente ya pagó ${fmt(cuotaNueva + abonado)} de este crédito y el nuevo total `
        + `sería ${fmt(valorNuevo)}. Anula primero el abono que sobra desde el estado de cuenta, `
        + `y después aplica el descuento.`,
    };
  }

  await client.query(
    `UPDATE creditos SET valor_total = $1, cuota_inicial = $2 WHERE id = $3`,
    [valorNuevo, cuotaNueva, credito.id],
  );

  // Subir el precio de un crédito ya saldado lo vuelve a abrir; bajarlo hasta lo
  // pagado lo cierra — por el mismo camino que un abono (mora e interés cuentan).
  let estado = credito.estado;
  if (credito.estado === 'Saldado' && saldoNuevo > 0.5) {
    await client.query(`UPDATE creditos SET estado = 'Activo' WHERE id = $1`, [credito.id]);
    estado = 'Activo';
  } else if (credito.estado === 'Activo') {
    const { cerrarSiPagadoEnTx } = require('../creditos/creditos.service');
    const r = await cerrarSiPagadoEnTx(client, credito.id, negocioId);
    if (r.saldado) estado = 'Saldado';
  }

  return {
    credito_id:     credito.id,
    valor_anterior: valorAntes, valor_nuevo: valorNuevo,
    cuota_anterior: cuotaAntes, cuota_nueva: cuotaNueva,
    saldo_nuevo:    Math.max(0, saldoNuevo),
    estado,
  };
};

// ── Qué NO se puede editar en una factura a crédito ──────────────────────────
//
// El precio sí: `_ajustarCreditoEditado` lo lleva al crédito. Lo que se bloquea
// es lo que descuadra la cuenta y no tiene cómo ajustarse solo:
//   · CÉDULA (y cambiar a compañero, que la vuelve 'COMPANERO'): es la clave que
//     agrupa el estado de cuenta (`COALESCE(cedula, nombre)`). Cambiarla muda el
//     crédito a la cuenta de otra persona, y `creditos.cliente_id` —el que usa
//     el pago total— se queda en la vieja. Sin cédula, el NOMBRE es la clave.
//   · CUOTA INICIAL (los pagos): es plata que entró a la caja el día de la venta;
//     reescribirla cambia una caja ya cerrada.
//   · RETOMA: crear una venta a crédito no la admite, y el crédito no la resta.
//   · CANTIDAD: no mueve stock; para quitar productos está la devolución.
//   · PRECIO de una línea con unidades DEVUELTAS: la devolución quedó en la
//     auditoría con el precio de ese día y el extracto la resta con ese valor;
//     bajar el precio después baja el cargo y no la devolución.
// Va en el backend y no solo en la pantalla: el bundle viejo en caché, o
// cualquier llamada directa, siguen pudiendo mandarlos.
const _texto = (v) => String(v ?? '').trim();

const _exigirEditableEnCredito = async (client, facturaActual, lineasAntes, { cedula, nombre_cliente, lineas, pagos, retoma }) => {
  const bloqueado = (message) => { throw { status: 409, code: 'CREDITO_CAMPO_BLOQUEADO', message }; };

  if (_texto(cedula) !== _texto(facturaActual.cedula)) {
    bloqueado('La cédula de una factura a crédito no se puede cambiar: es la que une el crédito con el estado '
      + 'de cuenta del cliente. Si la venta quedó a nombre de otra persona, cancela la factura y vuelve a hacerla.');
  }
  if (!_texto(facturaActual.cedula) && _texto(nombre_cliente) !== _texto(facturaActual.nombre_cliente)) {
    bloqueado('Esta factura a crédito no tiene cédula, así que el nombre es lo que identifica la cuenta del cliente: no se puede cambiar.');
  }
  if (retoma) {
    bloqueado('Una factura a crédito no admite retoma: el crédito no la descuenta y el estado de cuenta quedaría descuadrado.');
  }

  for (const l of lineas || []) {
    const actual = lineasAntes.find((x) => x.id === Number(l.id));
    if (!actual) continue;
    if (Number(l.cantidad) !== Number(actual.cantidad)) {
      bloqueado(`La cantidad de "${actual.nombre_producto}" no se puede cambiar. Para quitar productos usa la devolución.`);
    }
    if (Number(actual.cantidad_devuelta || 0) > 0 && Math.abs(Number(l.precio) - Number(actual.precio)) >= 0.01) {
      bloqueado(`El precio de "${actual.nombre_producto}" no se puede cambiar: ya tiene unidades devueltas y esa `
        + 'devolución quedó registrada con este precio en el estado de cuenta.');
    }
  }

  const porMetodo = (filas) => filas.reduce((m, p) => {
    if (Number(p.valor) > 0) m[p.metodo] = (m[p.metodo] || 0) + Number(p.valor);
    return m;
  }, {});
  const { rows: pagosActuales } = await client.query(
    `SELECT metodo, valor FROM pagos_factura WHERE factura_id = $1`, [facturaActual.id]);
  const antes = porMetodo(pagosActuales);
  const despues = porMetodo(pagos || []);
  const metodos = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  if ([...metodos].some((m) => Math.abs((antes[m] || 0) - (despues[m] || 0)) >= 0.5)) {
    bloqueado('La cuota inicial de una factura a crédito no se puede editar: es plata que entró a la caja el día de la venta.');
  }
};

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

    // La foto de ANTES: el ajuste del crédito se calcula contra ella. FOR UPDATE
    // para que un abono simultáneo no lea el valor viejo a mitad de la edición.
    const lineasAntes = await facturasRepo.getLineasConDevolucion(client, id);
    const pagosAntes  = await _sumaPagos(client, id);
    const credito = facturaActual.estado === 'Credito'
      ? (await client.query(`SELECT * FROM creditos WHERE factura_id = $1 FOR UPDATE`, [id])).rows[0] || null
      : null;
    if (credito) {
      await _exigirEditableEnCredito(client, facturaActual, lineasAntes, {
        cedula, nombre_cliente, lineas, pagos, retoma,
      });
    }

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

    // Precio mínimo (opt-in): sin esto bastaba con facturar al precio completo y
    // bajarlo después editando. Solo se mira la línea cuyo precio BAJA: una
    // factura vieja, hecha antes de encender el candado, se sigue pudiendo
    // corregir en todo lo demás sin que la detenga un precio que ya tenía.
    const reglaPrecio = await precioMinimo.leerRegla(client, negocioId);
    if (reglaPrecio) {
      const antesPorId = new Map(lineasAntes.map((l) => [Number(l.id), l]));
      for (const linea of lineas) {
        const antes = antesPorId.get(Number(linea.id));
        if (!antes || Number(linea.precio) >= Number(antes.precio)) continue;
        precioMinimo.exigirNoBajoMinimo({
          valor:  linea.precio,
          piso:   await _pisoLineaFactura(client, reglaPrecio, antes, facturaActual.sucursal_id),
          nombre: antes.nombre_producto,
          accion: 'dejar',
        });
      }
    }

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

    const creditoAjuste = credito && credito.estado !== 'Cancelado'
      ? await _ajustarCreditoEditado(client, negocioId, credito, { lineasAntes, pagosAntes })
      : null;

    if (retoma) {
      const esSerial    = retoma.tipo_retoma === 'serial';
      const colorRetoma = esSerial ? (retoma.color_retoma || null) : null;
      let   rastro      = null;

      if (retoma.ingreso_inventario && esSerial && retoma.imei) {
        rastro = await ingresarSerialRetomado(client, {
          negocioId:         negocioId,
          sucursalId:        facturaActual.sucursal_id,
          imei:              retoma.imei,
          productoSerialId:  retoma.producto_serial_id || null,
          valorRetoma:       retoma.valor_retoma,
          precioVenta:       retoma.precio_venta ?? null,
          clienteOrigen:     nombre_cliente,
          color:             colorRetoma,
          caracteristicas:   retoma.caracteristicas_retoma,
          reactivarSerialId: retoma.reactivar_serial_id || null,
        });
      }

      if (retoma.ingreso_inventario && !esSerial && retoma.producto_cantidad_id) {
        await _ingresarRetomaCantidad(client, negocioId, retoma);
        rastro = { ingresado: true };
      }

      await facturasRepo.insertarRetoma(client, {
        factura_id:         id,
        descripcion:        retoma.descripcion,
        valor_retoma:       retoma.valor_retoma,
        ingreso_inventario: !!(retoma.ingreso_inventario && rastro?.ingresado),
        nombre_producto:    retoma.nombre_producto    || null,
        imei:               retoma.imei               || null,
        cantidad_retoma:    retoma.cantidad_retoma     || 1,
        color:              colorRetoma,
        ...rastroParaRetoma(rastro),
      });
    }

    const lineasDespues = await facturasRepo.getLineasConDevolucion(client, id);

    await client.query('COMMIT');
    const factura = await facturasRepo.findByIdYNegocio(id, negocioId);
    return {
      ...factura,
      total:          _valorVigente(lineasDespues),
      total_anterior: _valorVigente(lineasAntes),
      credito_ajuste: creditoAjuste,
    };
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
      // Cancelar factura y crédito completos. Los abonos se anulan: ya no hay
      // cobro contra el cual pagar.
      await facturasRepo.cancelar(client, facturaId);
      await client.query(`UPDATE creditos SET estado = 'Cancelado' WHERE id = $1`, [credito.id]);
      await creditosRepo.anularAbonosDeCredito(
        client, credito.id, 'Anulado: se devolvió toda la venta',
      );
    } else {
      // Devolución PARCIAL: el crédito bajó de valor y lo ya pagado puede quedar
      // por encima. Ese sobrante se anula, o el crédito mostraría más pagado de
      // lo que vale — el mismo descuadre que dejan los pagos duplicados.
      const sobrante = (cuotaInicial + totalAbonado) - nuevoValorTotal;
      if (sobrante > 0) {
        await creditosRepo.anularSobranteDeAbonosCredito(
          client, credito.id, sobrante,
          `Anulado: se devolvieron productos y el crédito bajó a ${nuevoValorTotal}`,
        );
      }
      if (nuevoSaldo <= 0 && creditoActualizado.estado === 'Activo') {
        await client.query(`UPDATE creditos SET estado = 'Saldado' WHERE id = $1`, [credito.id]);
      }
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