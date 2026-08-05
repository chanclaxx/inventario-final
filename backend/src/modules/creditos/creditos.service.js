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
const registrarAbono = async (negocioId, creditoId, {
  usuario_id, valor, metodo, notas, modo = 'solo_capital', valor_mora = 0, valor_interes = 0,
}) => {
  const credito = await repo.findByIdYNegocio(creditoId, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  if (credito.estado === 'Saldado')   throw { status: 400, message: 'El crédito ya está saldado' };
  if (credito.estado === 'Cancelado') throw { status: 400, message: 'El crédito está cancelado' };
  if (!(Number(valor) > 0)) throw { status: 400, message: 'El valor del abono debe ser mayor a 0' };

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

    // El tope es capital + cargos, no solo capital: si no, un pago que los
    // incluye sería rechazado (era el comportamiento anterior, que no los conocía).
    const totalDebido = saldo_capital + cargosPendientes;
    if (reparto.excedente > 0) {
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

  const INFORMATIVOS = new Set(['mora_cobro', 'mora_condonacion']);

  let saldo = 0;
  return rows.map((row) => {
    const cargo = Number(row.cargo || 0);
    const abono = Number(row.abono || 0);
    const anulado    = row.credito_estado === 'Cancelado';
    const fueraDeSaldo = anulado || INFORMATIVOS.has(row.tipo);

    if (!fueraDeSaldo) saldo = saldo + cargo - abono;

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

/**
 * Cobra SOLO un cargo financiero, sin tocar el capital (el cliente vino a pagar
 * los intereses). `concepto` distingue mora de interés; por defecto 'mora' para
 * no cambiarle la conducta a los llamadores anteriores.
 */
const cobrarMora = async (negocioId, creditoId, { valor, metodo, usuario_id, concepto = 'mora' }) => {
  const esInteres = concepto === 'interes';
  const nombre    = esInteres ? 'interés' : 'mora';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { documento, mora, interes } = await moraService.estadoDe('credito', creditoId, negocioId, client);
    const cargo = esInteres ? interes : mora;

    if (!cargo.aplica) {
      throw {
        status: 400,
        message: esInteres
          ? 'Este crédito no tiene interés pactado'
          : 'Este crédito no tiene plazo ni mora pactada',
      };
    }
    if (cargo.pendiente <= 0) throw { status: 400, message: `No hay ${nombre} pendiente por cobrar` };

    const aCobrar = valor == null || valor === '' ? cargo.pendiente : Math.round(Number(valor));
    if (!(aCobrar > 0)) throw { status: 400, message: 'El valor a cobrar debe ser mayor a 0' };
    if (aCobrar > cargo.pendiente) {
      throw { status: 400, message: `No puedes cobrar más de ${esInteres ? 'el interés' : 'la mora'} pendiente ($${cargo.pendiente.toLocaleString('es-CO')})` };
    }

    const mov = await moraService.registrarCobroEnTx(client, {
      tipo: 'credito', documento, negocioId, concepto,
      valor: aCobrar, metodo, usuarioId: usuario_id, estadoMora: cargo,
    });

    // Si con este cobro ya no se debe nada, el crédito queda saldado.
    const cierre = await cerrarSiPagadoEnTx(client, creditoId, negocioId);

    await client.query('COMMIT');

    const despues = await moraService.estadoDe('credito', creditoId, negocioId);
    return {
      movimiento: mov, mora: despues.mora, interes: despues.interes,
      saldado: cierre.saldado,
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
  // Lo usa mora.service para cerrar el crédito cuando se cobra o se condona el
  // último cargo pendiente.
  cerrarSiPagadoEnTx,
};