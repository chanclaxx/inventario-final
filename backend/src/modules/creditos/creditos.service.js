const { pool } = require('../../config/db');
const repo = require('./creditos.repository');
const moraService = require('../mora/mora.service');
const { repartirAbono } = require('../../utils/mora.util');

// ── Listar créditos ──────────────────────────────────────────────────────────
// `anotarLista` resuelve la mora de todos en UNA consulta. Si ningún crédito
// tiene plazo (negocio sin la feature), no consulta nada y solo agrega un objeto
// `mora` en ceros para que el frontend no tenga que hacer condicionales.
const getCreditos = async (sucursalId, negocioId) => {
  const creditos = await repo.findAll(sucursalId, negocioId);
  return moraService.anotarLista(creditos, 'credito');
};

// ── Detalle con abonos ───────────────────────────────────────────────────────
//
// Incluye `resumen` y `persona` para que la impresión POS (que se arma en el
// navegador) use exactamente las mismas cifras que el PDF, sin recalcular nada.
const getCreditoById = async (negocioId, id) => {
  const { credito, abonos, resumen, persona, lineas, descripcion } =
    await getDocumento(negocioId, id).then((d) => ({ ...d, abonos: d.resumen.abonos }));
  return { ...credito, abonos, resumen, persona, lineas, descripcion };
};

// ── Cierre del crédito: capital, mora E interés en cero ──────────────────────
//
// ÚNICO lugar donde un crédito pasa a 'Saldado'. Lo llaman el abono, el cobro
// de un cargo y la condonación. Antes bastaba con cubrir el capital y la mora
// quedaba colgando de una factura ya cerrada; hoy son TRES deudas y el crédito
// sigue abierto mientras quede cualquiera de ellas.
const cerrarSiPagadoEnTx = async (client, creditoId, negocioId) => {
  const { documento, saldo_capital, mora, interes } = await moraService.estadoDe(
    'credito', creditoId, negocioId, client
  );

  const capitalPendiente = Math.max(0, Math.round(Number(saldo_capital) || 0));
  const moraPendiente    = Math.max(0, Math.round(Number(mora?.pendiente) || 0));
  const interesPendiente = Math.max(0, Math.round(Number(interes?.pendiente) || 0));
  const base = {
    saldado: false, factura_id: null,
    capital_pendiente: capitalPendiente,
    mora_pendiente:    moraPendiente,
    interes_pendiente: interesPendiente,
    cargos_pendientes: moraPendiente + interesPendiente,
  };

  if (documento.estado === 'Saldado' || documento.estado === 'Cancelado') return base;
  if (capitalPendiente > 0 || moraPendiente > 0 || interesPendiente > 0) return base;

  await repo.updateEstado(client, creditoId, 'Saldado');
  return { ...base, saldado: true };
};

// ── Registrar abono ──────────────────────────────────────────────────────────
//
// El abono paga el PRODUCTO: por defecto baja el capital y nada más. La mora se
// cobra aparte (o se condona), y hasta entonces el crédito no queda saldado.
//
// `modo` sigue permitiendo repartirlo desde la misma pantalla:
//   'solo_capital'  → (por defecto) todo a capital; la mora queda PENDIENTE
//   'mora_capital'  → primero la mora (orden del Art. 1653 C.C.), resto a capital
//   'personalizado' → `valor_mora` va a mora, el resto a capital
//
// Si el crédito no tiene plazo, la mora pendiente es 0 y los tres modos se
// comportan igual que antes de existir esta feature.
// ─── Aislamiento por sucursal ────────────────────────────────────────────────
//
// Validar solo por NEGOCIO no alcanza en los caminos que mueven plata. Un
// vendedor tiene su sucursal en el token y la lista que ve esta acotada, pero
// el id de un credito de OTRA sede sigue siendo un numero valido: sin esta
// comprobacion, un abono podia caer en la sucursal equivocada — que es
// exactamente lo que pasa cuando el mismo cliente tiene credito en dos sedes.
//
// La sucursal del request ya viene resuelta y validada por el middleware (para
// un vendedor es la suya; para un admin, la que tiene seleccionada), asi que
// esto no estorba a nadie que este operando donde debe.
//
// `sucursalId` nulo = no hay contexto de sede: no se bloquea, para no romper
// los llamados internos que no pasan por una request.
const exigirMismaSucursal = (documento, sucursalId, etiqueta) => {
  if (!sucursalId) return;
  if (Number(documento.sucursal_id) !== Number(sucursalId)) {
    throw {
      status: 403,
      message: `Este ${etiqueta} es de otra sucursal. Cambia de sucursal para poder registrarlo ahi.`,
    };
  }
};

const registrarAbono = async (negocioId, creditoId, {
  usuario_id, valor, metodo, notas, modo = 'solo_capital', valor_mora = 0, valor_interes = 0,
  sucursal_id = null,
}) => {
  const credito = await repo.findByIdYNegocio(creditoId, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  exigirMismaSucursal(credito, sucursal_id, 'crédito');
  if (credito.estado === 'Saldado')   throw { status: 400, message: 'El crédito ya está saldado' };
  if (credito.estado === 'Cancelado') throw { status: 400, message: 'El crédito está cancelado' };
  if (!(Number(valor) > 0)) throw { status: 400, message: 'El valor del abono debe ser mayor a 0' };

  // Baranda contra el doble clic — la misma que en préstamos. Un abono idéntico
  // (mismo crédito, mismo valor, mismo método) dentro de la ventana no es un
  // segundo pago: es el formulario enviándose dos veces. En préstamos eso dejó
  // 45 pagos duplicados por $106.887.760 antes de que nadie lo notara.
  const { rows: gemelo } = await pool.query(`
    SELECT id FROM abonos_credito
     WHERE credito_id = $1 AND valor = $2
       AND COALESCE(metodo, '') = COALESCE($3, '')
       AND NOT anulado
       AND fecha > NOW() - INTERVAL '90 seconds'
     LIMIT 1
  `, [creditoId, valor, metodo || null]);
  if (gemelo.length) {
    throw {
      status: 409,
      message: 'Este mismo abono ya se registró hace un momento. Si de verdad son dos pagos distintos, espera un minuto y vuelve a intentarlo.',
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Se resuelve DENTRO de la transacción: si entran dos abonos a la vez, cada
    // uno ve el saldo y la mora ya actualizados por el otro.
    const { documento, saldo_capital, mora, interes } = await moraService.estadoDe(
      'credito', creditoId, negocioId, client
    );

    // Con el capital ya cubierto lo único que queda por pagar son los cargos: el
    // abono se imputa entero ahí en vez de rebotar por "excedente".
    const cargosPendientes = mora.pendiente + interes.pendiente;
    const modoEfectivo = (saldo_capital <= 0 && cargosPendientes > 0) ? 'mora_capital' : modo;

    const reparto = repartirAbono({
      valor,
      mora_pendiente:    mora.pendiente,
      interes_pendiente: interes.pendiente,
      saldo_capital,
      modo: modoEfectivo,
      valor_mora,
      valor_interes,
    });

    // El tope depende del modo, y el mensaje tiene que decir POR QUÉ sobró.
    // Ver la nota equivalente en prestamos.service.
    const totalDebido = saldo_capital + cargosPendientes;
    if (reparto.excedente > 0) {
      if (modoEfectivo === 'solo_capital') {
        throw {
          status: 400,
          message: `El abono supera el saldo de la venta ($${Math.round(saldo_capital).toLocaleString('es-CO')}).`
            + (cargosPendientes > 0
              ? ` Los intereses ($${Math.round(cargosPendientes).toLocaleString('es-CO')}) se cobran con el botón de cobrar del crédito.`
              : ''),
        };
      }
      throw {
        status: 400,
        message: `El abono supera lo que se debe. Capital $${Math.round(saldo_capital).toLocaleString('es-CO')}`
          + (mora.pendiente    > 0 ? ` + mora $${mora.pendiente.toLocaleString('es-CO')}` : '')
          + (interes.pendiente > 0 ? ` + interés $${interes.pendiente.toLocaleString('es-CO')}` : '')
          + ` = $${Math.round(totalDebido).toLocaleString('es-CO')}`,
      };
    }

    let resultado = {
      valor_total:   documento.valor_total,
      cuota_inicial: documento.cuota_inicial,
      total_abonado: documento.total_abonado,
      abono_id:      null,
    };

    // El abono de capital solo se inserta si hay capital que abonar: un pago que
    // va enteramente a mora no debe dejar una fila de abono en $0.
    if (reparto.a_capital > 0) {
      resultado = await repo.insertarAbono(client, {
        credito_id: creditoId,
        usuario_id,
        valor:  reparto.a_capital,
        metodo: metodo || 'Efectivo',
        notas:  notas  || null,
      });
    }

    let movimientoMora = null;
    if (reparto.a_mora > 0) {
      movimientoMora = await moraService.registrarCobroEnTx(client, {
        tipo: 'credito', documento, negocioId, concepto: 'mora',
        valor: reparto.a_mora, metodo: metodo || 'Efectivo', usuarioId: usuario_id,
        estadoMora: mora, abonoCreditoId: resultado.abono_id,
      });
    }

    let movimientoInteres = null;
    if (reparto.a_interes > 0) {
      movimientoInteres = await moraService.registrarCobroEnTx(client, {
        tipo: 'credito', documento, negocioId, concepto: 'interes',
        valor: reparto.a_interes, metodo: metodo || 'Efectivo', usuarioId: usuario_id,
        estadoMora: interes, abonoCreditoId: resultado.abono_id,
      });
    }

    // Se cierra solo si no queda NADA por cobrar: capital, mora e interés en cero.
    const nuevoSaldo = Number(resultado.valor_total) - Number(resultado.cuota_inicial) - Number(resultado.total_abonado);
    const cierre = await cerrarSiPagadoEnTx(client, creditoId, negocioId);

    await client.query('COMMIT');

    const despues = await moraService.estadoDe('credito', creditoId, negocioId);
    return {
      ...resultado,
      sucursal_id:  documento.sucursal_id,
      saldo:        Math.max(0, nuevoSaldo),
      saldado:      cierre.saldado,
      // Producto pagado pero con cargos debiéndose: la pantalla lo usa para
      // ofrecer el cobro en vez de dar la deuda por cerrada.
      solo_falta_mora: !cierre.saldado && cierre.capital_pendiente <= 0 && cierre.cargos_pendientes > 0,
      abonado_capital: reparto.a_capital,
      abonado_mora:    reparto.a_mora,
      abonado_interes: reparto.a_interes,
      movimiento_mora:    movimientoMora,
      movimiento_interes: movimientoInteres,
      mora:            despues.mora,
      interes:         despues.interes,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Saldar manualmente (marcar como saldado sin abono) ───────────────────────
const saldarCredito = async (negocioId, creditoId) => {
  const credito = await repo.findByIdYNegocio(creditoId, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  if (credito.estado === 'Saldado') throw { status: 400, message: 'El crédito ya está saldado' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.updateEstado(client, creditoId, 'Saldado');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Cancelar crédito (cancela crédito + factura + devuelve stock) ─────────────
const cancelarCredito = async (negocioId, creditoId) => {
  const credito = await repo.findByIdYNegocio(creditoId, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  if (credito.estado === 'Cancelado') throw { status: 400, message: 'El crédito ya está cancelado' };

  // Reutilizar la lógica existente de cancelar factura
  const facturasService = require('../facturas/facturas.service');
  await facturasService.cancelarFactura(negocioId, credito.factura_id, false);

  // Marcar el crédito como cancelado
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repo.updateEstado(client, creditoId, 'Cancelado');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Documento de un crédito (factura, aviso de mora, paz y salvo) ────────────
//
// Devuelve el RESUMEN de la obligación calculado por utils/obligacion.js. Es la
// única fuente de verdad para los tres documentos y para el ticket POS: ninguno
// vuelve a deducir un saldo, un estado ni el saldo que quedó tras cada abono.
const getDocumento = async (negocioId, creditoId) => {
  const credito = await repo.findByIdYNegocio(creditoId, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };

  const conMora = await moraService.anotarDocumento(credito, 'credito');
  const abonos  = await repo.getAbonos(creditoId);

  // Productos y devoluciones de la factura: describen la obligación y permiten
  // reconstruir su valor original.
  const { rows: lineas } = await pool.query(`
    SELECT nombre_producto, imei, cantidad, COALESCE(cantidad_devuelta, 0) AS cantidad_devuelta, precio
    FROM lineas_factura WHERE factura_id = $1 ORDER BY id
  `, [credito.factura_id]);

  const devuelto = lineas.reduce(
    (s, l) => s + Number(l.cantidad_devuelta || 0) * Number(l.precio), 0);

  const { resumirObligacion } = require('../../utils/obligacion');
  const resumen = resumirObligacion({
    tipo: 'credito',
    documento: conMora,
    abonos,
    mora:    conMora.mora    || null,
    interes: conMora.interes || null,
    devuelto,
  });

  const descripcion = lineas
    .filter((l) => Number(l.cantidad) - Number(l.cantidad_devuelta) > 0)
    .map((l) => `${l.nombre_producto}${l.imei ? ` (IMEI ${l.imei})` : ''}`)
    .join(', ');

  return {
    credito: conMora,
    persona: {
      nombre:  credito.nombre_cliente,
      cedula:  credito.cedula,
      celular: credito.celular,
    },
    resumen,
    lineas,
    descripcion: descripcion || null,
  };
};

// ── Estado de cuenta del cliente ─────────────────────────────────────────────
//
// ÚNICA fuente de verdad del saldo acumulado: la usan la pantalla, el Excel y
// el PDF. Ninguno vuelve a sumar por su cuenta (el PDF de préstamos sí lo hacía
// y era un riesgo de que la exportación mostrara otro número que la pantalla).
//
// Un crédito Cancelado se muestra en gris y queda FUERA del acumulado: la
// factura se anuló y el stock volvió, así que no hay deuda que arrastrar. Es el
// mismo trato que reciben los préstamos devueltos.
const getEstadoCuenta = async (negocioId, clave, sucursalId = null) => {
  const rows = await repo.getEstadoCuenta(negocioId, clave, sucursalId);

  // Los cargos financieros NO participan del saldo de capital. Olvidar aquí
  // un tipo nuevo hace que entre al acumulado y la cuenta salga mal.
  const INFORMATIVOS = new Set([
    'mora_cobro', 'mora_condonacion',
    'interes_cobro', 'interes_condonacion',
  ]);

  let saldo = 0;
  return rows.map((row) => {
    const cargo = Number(row.cargo || 0);
    const abono = Number(row.abono || 0);
    const facturaCancelada = row.credito_estado === 'Cancelado';
    // Un abono ANULADO sigue en la lista, pero no baja la deuda: por eso queda
    // fuera del saldo corrido igual que una factura cancelada. Contarlo seria
    // volver al descuadre entre el extracto y la deuda total.
    //
    // Un PAGO TOTAL viene colapsado y puede estar anulado solo EN PARTE (se
    // canceló una de las facturas del reparto). En ese caso el movimiento sigue
    // contando, pero solo por lo que quedó vigente: sacarlo entero borraría del
    // saldo lo que se abonó a las facturas vivas.
    // Cuánto de este movimiento dejó de contar. Viene SUMADO de la columna
    // `valor_anulado`, no derivado del reparto: un abono suelto anulado solo en
    // PARTE no tiene reparto del cual derivarlo, y calcularlo así lo dejaba en
    // cero — esos pesos seguían restando en el extracto sin restar en la deuda.
    const reparto = Array.isArray(row.detalle) ? row.detalle : [];
    const abonoAnulado   = row.anulado === true;
    const anuladoParcial = Number(row.valor_anulado || 0);
    const abonoVigente   = Math.max(0, abono - anuladoParcial);
    const fueraDeSaldo = facturaCancelada || abonoAnulado || INFORMATIVOS.has(row.tipo);

    if (!fueraDeSaldo) saldo = saldo + cargo - abonoVigente;

    return {
      fecha:          row.fecha,
      tipo:           row.tipo,
      concepto:       row.concepto,
      cargo:          cargo || null,
      abono:          abono || null,
      saldo:          fueraDeSaldo ? null : saldo,
      referencia_id:  Number(row.referencia_id),
      credito_id:     row.credito_id ? Number(row.credito_id) : null,
      factura_numero: row.factura_numero ? Number(row.factura_numero) : null,
      credito_estado: row.credito_estado || null,
      anulable:       row.anulable,
      // Nota libre del usuario sobre el pago; viaja en columna propia para que
      // la pantalla, el PDF y el Excel la muestren sin parsear el concepto.
      descripcion:     row.descripcion || null,
      abono_total_id:  row.abono_total_id ? Number(row.abono_total_id) : null,
      pago_total_valor: row.pago_total_valor != null ? Number(row.pago_total_valor) : null,
      anulado:          abonoAnulado || anuladoParcial > 0,
      // Cuanto de este movimiento dejo de contar. El Excel y el PDF lo usan
      // para no sumarlo en los totales: una fila que se ve pero no cuenta.
      anulado_total:    abonoAnulado,
      valor_anulado:    anuladoParcial,
      motivo_anulacion: row.motivo_anulacion || null,
      // Un pago total se muestra como UN movimiento; `detalle` es el reparto
      // que la pantalla despliega (a qué facturas fue y cuánto a cada una).
      es_pago_total:    row.es_pago_total === true,
      detalle:          reparto,
    };
  });
};

/** Identidad del cliente + saldo final, para encabezados de PDF/Excel. */
const getResumenCuenta = async (negocioId, clave, sucursalId = null) => {
  const persona = await repo.findPersonaPorClave(negocioId, clave, sucursalId);
  if (!persona) throw { status: 404, message: 'Cliente sin créditos registrados' };

  const movimientos = await getEstadoCuenta(negocioId, clave, sucursalId);
  const conSaldo    = movimientos.filter((m) => m.saldo != null);
  const saldoFinal  = conSaldo.length ? conSaldo[conSaldo.length - 1].saldo : 0;

  return { persona, movimientos, saldoFinal };
};

// ── Cargos financieros (mora e interés) ──────────────────────────────────────
// Delegan en el servicio compartido: la misma lógica sirve para préstamos.

/** Fija, cambia o quita el plazo de pago (permite usar la feature con cartera vieja). */
const fijarPlazo = (negocioId, creditoId, datos) =>
  moraService.fijarPlazo(negocioId, 'credito', creditoId, datos);

/** Fija, cambia o quita el plan de interés. Corre desde hoy, nunca hacia atrás. */
const fijarInteres = (negocioId, creditoId, datos) =>
  moraService.fijarInteres(negocioId, 'credito', creditoId, datos);

/** Condona mora o interés, total o parcial. Solo admin, con motivo y PIN. */
const condonarMora = (negocioId, creditoId, datos) =>
  moraService.condonar(negocioId, 'credito', creditoId, datos);

/** Ver `prestamos.service`: la misma regla para los dos vehículos. */
const _cargosObjetivo = (concepto, mora, interes) => {
  const vivos = [
    { concepto: 'mora',    cargo: mora },
    { concepto: 'interes', cargo: interes },
  ].filter((o) => o.cargo?.aplica && o.cargo.pendiente > 0);
  if (concepto === 'todos') return vivos;
  return vivos.filter((o) => o.concepto === concepto);
};

const _mensajeSinCargo = (concepto, mora, interes) => {
  if (concepto === 'interes') {
    return interes?.aplica ? 'No hay interés pendiente por cobrar'
      : 'Este crédito no tiene interés pactado';
  }
  if (concepto === 'mora') {
    return mora?.aplica ? 'No hay mora pendiente por cobrar'
      : 'Este crédito no tiene plazo ni mora pactada';
  }
  return 'No hay intereses ni mora pendientes por cobrar';
};

/**
 * Cobra cargos financieros (mora, interés o los dos) sin tocar el capital.
 * `concepto`: 'mora' (por defecto) · 'interes' · 'todos'.
 */
const cobrarMora = async (negocioId, creditoId, { valor, metodo, usuario_id, concepto = 'mora' }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { documento, mora, interes } = await moraService.estadoDe('credito', creditoId, negocioId, client);

    const objetivos = _cargosObjetivo(concepto, mora, interes);
    if (!objetivos.length) {
      throw { status: 400, message: _mensajeSinCargo(concepto, mora, interes) };
    }

    const totalPendiente = objetivos.reduce((s, o) => s + o.cargo.pendiente, 0);
    const aCobrar = valor == null || valor === '' ? totalPendiente : Math.round(Number(valor));
    if (!(aCobrar > 0)) throw { status: 400, message: 'El valor a cobrar debe ser mayor a 0' };
    if (aCobrar > totalPendiente) {
      throw {
        status: 400,
        message: `No puedes cobrar más de lo pendiente ($${totalPendiente.toLocaleString('es-CO')})`,
      };
    }

    // Mora antes que interés, y todo en la MISMA transacción.
    let restante = aCobrar;
    const movimientos = [];
    for (const { concepto: conc, cargo } of objetivos) {
      const parte = Math.min(cargo.pendiente, restante);
      if (parte <= 0) continue;
      restante -= parte;
      movimientos.push(await moraService.registrarCobroEnTx(client, {
        tipo: 'credito', documento, negocioId, concepto: conc,
        valor: parte, metodo, usuarioId: usuario_id, estadoMora: cargo,
      }));
    }

    // Si con este cobro ya no se debe nada, el crédito queda saldado.
    const cierre = await cerrarSiPagadoEnTx(client, creditoId, negocioId);

    await client.query('COMMIT');

    const despues = await moraService.estadoDe('credito', creditoId, negocioId);
    return {
      movimiento: movimientos[0] ?? null, movimientos,
      cobrado: aCobrar,
      mora: despues.mora, interes: despues.interes,
      saldado: cierre.saldado,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};


// ─── Pago total: un solo pago repartido entre los créditos del cliente ───────
//
// Espejo del de préstamos, y con las mismas reglas — que no son cosméticas:
//
//   · **Por sucursal.** Un pago hecho en una sede no baja la deuda de otra, o
//     la cartera de cada una deja de cuadrar. Es lo que confundió al usuario en
//     préstamos: veía préstamos pendientes que el pago "no tocaba".
//   · **FIFO**, del crédito más viejo al más nuevo, llenando cada uno.
//   · **Baranda contra el doble clic**: un pago idéntico dentro de la ventana no
//     es un segundo pago, es el formulario enviándose dos veces. En préstamos
//     eso dejó 45 pagos duplicados por $106.887.760 antes de que nadie lo viera.
//   · **Tope**: no puede superar lo que la persona debe en esa sucursal. Se
//     rechaza con el monto exacto en el mensaje, en vez de dejar plata suelta.
//   · **Descripción** libre, tope 200, que viaja en columna propia y no pegada
//     al concepto.
const registrarAbonoTotalCredito = async (
  negocioId, clienteId, valorTotal, metodo, usuarioId, sucursalId, { descripcion = null } = {},
) => {
  const valor = Math.round(Number(valorTotal));
  if (!(valor > 0)) throw { status: 400, message: 'El valor del pago debe ser mayor a 0' };
  if (!sucursalId)  throw { status: 400, message: 'Debes indicar la sucursal del pago' };

  const gemelo = await repo.buscarAbonoTotalCreditoGemelo(pool, {
    cliente_id: clienteId, valor_total: valor, metodo,
  });
  if (gemelo) {
    throw {
      status: 409,
      message: 'Este mismo pago total ya se registró hace un momento. Revisa el estado de cuenta antes de volver a intentarlo.',
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const activos = await repo.findCreditosActivosDeCliente(client, clienteId, negocioId, sucursalId);
    if (!activos.length) {
      throw { status: 400, message: 'Este cliente no tiene créditos activos en esta sucursal' };
    }

    // El tope incluye los cargos pendientes: si solo se contara el capital, un
    // pago que cubre los intereses sería rechazado por "excedente".
    const conCargos = await moraService.anotarLista(activos, 'credito');
    const totalDebido = conCargos.reduce((s, c) => {
      const cargos = Number(c.mora?.pendiente || 0) + Number(c.interes?.pendiente || 0);
      return s + Math.max(0, Number(c.saldo_pendiente)) + cargos;
    }, 0);

    if (valor > Math.round(totalDebido)) {
      throw {
        status: 400,
        message: `El pago supera lo que el cliente debe en esta sucursal ($${Math.round(totalDebido).toLocaleString('es-CO')}).`,
      };
    }

    const cabecera = await repo.insertarAbonoTotalCredito(client, {
      cliente_id: clienteId, sucursal_id: sucursalId, valor_total: valor,
      metodo: metodo || 'Efectivo', usuario_id: usuarioId, descripcion,
    });

    let restante = valor;
    const distribucion = [];
    for (const credito of activos) {
      if (restante <= 0) break;
      const pendiente = Math.max(0, Number(credito.saldo_pendiente));
      if (pendiente <= 0) continue;

      const monto = Math.min(restante, pendiente);
      await repo.insertarAbonoDeTotal(client, {
        credito_id: credito.id, usuario_id: usuarioId, valor: monto,
        metodo: metodo || 'Efectivo', abono_total_id: cabecera.id,
      });
      restante -= monto;

      // Cerrar el crédito pasa por el MISMO camino que un abono normal: no se
      // marca 'Saldado' a mano. Ese helper exige que capital, mora e interés
      // estén los tres en cero — cerrar con un cargo vivo dejaría la deuda
      // huérfana y generaría la factura antes de tiempo.
      // Devuelve un objeto con el detalle del cierre; hacia afuera se expone
      // como un booleano, que es lo que la pantalla necesita.
      const cierre = await cerrarSiPagadoEnTx(client, credito.id, negocioId);
      distribucion.push({
        credito_id:  credito.id,
        factura:     credito.factura_numero,
        abonado:     monto,
        saldado:     cierre?.saldado === true,
        factura_id:  cierre?.factura_id ?? null,
      });
    }

    await client.query('COMMIT');
    return {
      abono_total_id: cabecera.id,
      fecha:          cabecera.fecha,
      valor_total:    valor,
      sobrante:       restante,
      distribucion,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Anular un abono de crédito ──────────────────────────────────────────────
//
// El abono NO se borra: queda marcado con su motivo, y por eso el extracto
// puede explicar por qué la cuenta cambió. Borrarlo cuadraría el número y
// destruiría la evidencia — que es justo lo que deja a un negocio sin con qué
// responderle a un cliente meses después.
//
// Tres efectos que hay que resolver juntos, o la cuenta queda a medias:
//   1. `total_abonado` baja por lo que ese abono aportaba.
//   2. Si el crédito estaba 'Saldado' y deja de estarlo, **vuelve a Activo**.
//      Sin esto la deuda no reaparece: un saldado no cuenta por más que le
//      falte plata. Es el mismo paso que hizo falta al corregir los duplicados.
//   3. La MORA que se haya cobrado dentro de ese abono se anula en cascada, o
//      el cliente queda con la mora "pagada" después de revertirse el pago.
const anularAbonoCredito = async (negocioId, abonoId, { motivo, usuario_id, sucursal_id = null } = {}) => {
  const razon = String(motivo || '').trim();
  if (razon.length < 3) {
    throw { status: 400, message: 'Escribe el motivo de la anulación (mínimo 3 caracteres)' };
  }

  const abono = await repo.findAbonoCreditoById(pool, abonoId, negocioId);
  if (!abono) throw { status: 404, message: 'Abono no encontrado' };
  exigirMismaSucursal(abono, sucursal_id, 'abono');
  if (abono.anulado) throw { status: 400, message: 'Este abono ya está anulado' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await repo.anularAbonoCredito(client, abonoId, abono.credito_id,
      `Anulado: ${razon}`);
    if (!res) throw { status: 400, message: 'Este abono ya está anulado' };

    // 3. La mora cobrada dentro de este abono se anula con él.
    const moraRepo = require('../mora/mora.repository');
    const moraAnulada = await moraRepo.anularPorAbono(client, { abono_credito_id: abonoId });

    // 2. Si dejó de estar cubierto, el crédito vuelve a Activo.
    const { rows: [cr] } = await client.query(`
      SELECT valor_total, cuota_inicial, total_abonado, estado FROM creditos WHERE id = $1
    `, [abono.credito_id]);
    const saldo = Number(cr.valor_total) - Number(cr.cuota_inicial) - Number(cr.total_abonado);
    let reabierto = false;
    if (cr.estado === 'Saldado' && saldo > 0) {
      await client.query(`UPDATE creditos SET estado = 'Activo' WHERE id = $1`, [abono.credito_id]);
      reabierto = true;
    }

    await client.query('COMMIT');
    return {
      abono_id:    abonoId,
      credito_id:  abono.credito_id,
      valor:       res.valor,
      motivo:      razon,
      reabierto,
      mora_anulada: Array.isArray(moraAnulada) ? moraAnulada.length : 0,
      saldo_actual: Math.max(0, saldo),
      usuario_id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};


// ─── Anular un PAGO TOTAL completo ───────────────────────────────────────────
//
// Un pedazo suelto de un pago total NO se puede anular: dejaría el pago a
// medias y el extracto mostrando un reparto que ya no cuadra. Lo que sí tiene
// sentido es deshacer el pago ENTERO — que es lo que pasa cuando alguien se
// equivoca digitando el monto o lo registra en la persona que no era.
//
// Se anulan todos sus pedazos en UNA transacción: o se deshace el pago
// completo, o no se toca nada. Anular la mitad dejaría al cliente debiendo una
// cifra que no sale de ninguna parte.
//
// Los pedazos que YA estaban anulados (porque se canceló esa factura) se dejan
// como están: volver a restarlos bajaría la deuda dos veces.
const anularAbonoTotalCredito = async (negocioId, abonoTotalId, { motivo, usuario_id, sucursal_id = null } = {}) => {
  const razon = String(motivo || '').trim();
  if (razon.length < 3) {
    throw { status: 400, message: 'Escribe el motivo de la anulación (mínimo 3 caracteres)' };
  }

  const pago = await repo.findAbonoTotalCreditoById(pool, abonoTotalId, negocioId);
  if (!pago) throw { status: 404, message: 'Pago total no encontrado' };
  exigirMismaSucursal(pago, sucursal_id, 'pago');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pedazos = await repo.findPedazosDeAbonoTotalCredito(client, abonoTotalId);
    const vigentes = pedazos.filter((p) => !p.anulado);
    if (!vigentes.length) {
      throw { status: 400, message: 'Este pago total ya está anulado' };
    }

    const moraRepo = require('../mora/mora.repository');
    const detalle = [];
    let totalAnulado = 0;

    for (const pedazo of vigentes) {
      const res = await repo.anularAbonoCredito(client, pedazo.id, pedazo.credito_id,
        `Anulado: ${razon}`);
      if (!res) continue;

      // La mora cobrada dentro de ese pedazo se anula con él.
      await moraRepo.anularPorAbono(client, { abono_credito_id: pedazo.id });

      // Si el crédito dejó de estar cubierto, vuelve a Activo. Sin esto la
      // deuda no reaparece: un saldado no cuenta por más que le falte plata.
      const { rows: [cr] } = await client.query(`
        SELECT valor_total, cuota_inicial, total_abonado, estado, factura_id
          FROM creditos WHERE id = $1
      `, [pedazo.credito_id]);
      const saldo = Number(cr.valor_total) - Number(cr.cuota_inicial) - Number(cr.total_abonado);
      let reabierto = false;
      if (cr.estado === 'Saldado' && saldo > 0) {
        await client.query(`UPDATE creditos SET estado = 'Activo' WHERE id = $1`, [pedazo.credito_id]);
        reabierto = true;
      }

      totalAnulado += Number(res.valor);
      detalle.push({
        abono_id:   pedazo.id,
        credito_id: pedazo.credito_id,
        valor:      Number(res.valor),
        reabierto,
      });
    }

    await client.query('COMMIT');
    return {
      abono_total_id: Number(abonoTotalId),
      valor:          totalAnulado,
      motivo:         razon,
      pedazos:        detalle.length,
      reabiertos:     detalle.filter((d) => d.reabierto).length,
      detalle,
      usuario_id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getCreditos, getCreditoById, registrarAbono, saldarCredito, cancelarCredito,
  getEstadoCuenta, getResumenCuenta, getDocumento,
  fijarPlazo, fijarInteres, condonarMora, cobrarMora,
  registrarAbonoTotalCredito, anularAbonoCredito, anularAbonoTotalCredito,
  // Lo usa mora.service para cerrar el crédito cuando se cobra o se condona el
  // último cargo pendiente.
  cerrarSiPagadoEnTx,
};