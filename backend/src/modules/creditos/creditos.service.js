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
const getCreditoById = async (negocioId, id) => {
  const credito = await repo.findByIdYNegocio(id, negocioId);
  if (!credito) throw { status: 404, message: 'Crédito no encontrado' };
  const abonos = await repo.getAbonos(id);
  const conMora = await moraService.anotarDocumento(credito, 'credito');
  return { ...conMora, abonos };
};

// ── Registrar abono ──────────────────────────────────────────────────────────
//
// `modo` decide cómo se reparte el pago entre mora y capital:
//   'mora_capital'  → primero la mora (orden del Art. 1653 C.C.), resto a capital
//   'solo_capital'  → todo a capital; la mora queda PENDIENTE, no condonada
//   'personalizado' → `valor_mora` va a mora, el resto a capital
//
// Si el crédito no tiene plazo, la mora pendiente es 0 y los tres modos se
// comportan igual que antes de existir esta feature.
const registrarAbono = async (negocioId, creditoId, {
  usuario_id, valor, metodo, notas, modo = 'mora_capital', valor_mora = 0,
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
    const { documento, saldo_capital, mora } = await moraService.estadoDe(
      'credito', creditoId, negocioId, client
    );

    const reparto = repartirAbono({
      valor,
      mora_pendiente: mora.pendiente,
      saldo_capital,
      modo,
      valor_mora,
    });

    // El tope es capital + mora, no solo capital: si no, un pago que incluye la
    // mora sería rechazado (era el comportamiento anterior, que no la conocía).
    const totalDebido = saldo_capital + mora.pendiente;
    if (reparto.excedente > 0) {
      throw {
        status: 400,
        message: `El abono supera lo que se debe. Capital $${Math.round(saldo_capital).toLocaleString('es-CO')}`
          + (mora.pendiente > 0 ? ` + mora $${mora.pendiente.toLocaleString('es-CO')}` : '')
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
        tipo: 'credito', documento, negocioId,
        valor: reparto.a_mora, metodo: metodo || 'Efectivo', usuarioId: usuario_id,
        estadoMora: mora, abonoCreditoId: resultado.abono_id,
      });
    }

    // Se cierra solo cuando el CAPITAL queda en cero. La mora pendiente no
    // impide saldar el crédito: es una deuda aparte y visible.
    const nuevoSaldo = Number(resultado.valor_total) - Number(resultado.cuota_inicial) - Number(resultado.total_abonado);
    if (nuevoSaldo <= 0) {
      await repo.updateEstado(client, creditoId, 'Saldado');
    }

    await client.query('COMMIT');

    const despues = await moraService.estadoDe('credito', creditoId, negocioId);
    return {
      ...resultado,
      sucursal_id:  documento.sucursal_id,
      saldo:        Math.max(0, nuevoSaldo),
      abonado_capital: reparto.a_capital,
      abonado_mora:    reparto.a_mora,
      movimiento_mora: movimientoMora,
      mora:            despues.mora,
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

// ── Mora ─────────────────────────────────────────────────────────────────────
// Delegan en el servicio compartido: la misma lógica sirve para préstamos.

/** Fija, cambia o quita el plazo de pago (permite usar la feature con cartera vieja). */
const fijarPlazo = (negocioId, creditoId, datos) =>
  moraService.fijarPlazo(negocioId, 'credito', creditoId, datos);

/** Condona mora, total o parcial. Solo admin, con motivo y PIN. */
const condonarMora = (negocioId, creditoId, datos) =>
  moraService.condonar(negocioId, 'credito', creditoId, datos);

/** Cobra SOLO mora, sin tocar el capital (el cliente vino a pagar los intereses). */
const cobrarMora = async (negocioId, creditoId, { valor, metodo, usuario_id }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { documento, mora } = await moraService.estadoDe('credito', creditoId, negocioId, client);

    if (!mora.aplica)         throw { status: 400, message: 'Este crédito no tiene plazo ni mora pactada' };
    if (mora.pendiente <= 0)  throw { status: 400, message: 'No hay mora pendiente por cobrar' };

    const aCobrar = valor == null || valor === '' ? mora.pendiente : Math.round(Number(valor));
    if (!(aCobrar > 0)) throw { status: 400, message: 'El valor a cobrar debe ser mayor a 0' };
    if (aCobrar > mora.pendiente) {
      throw { status: 400, message: `No puedes cobrar más de la mora pendiente ($${mora.pendiente.toLocaleString('es-CO')})` };
    }

    const mov = await moraService.registrarCobroEnTx(client, {
      tipo: 'credito', documento, negocioId,
      valor: aCobrar, metodo, usuarioId: usuario_id, estadoMora: mora,
    });
    await client.query('COMMIT');

    const despues = await moraService.estadoDe('credito', creditoId, negocioId);
    return { movimiento: mov, mora: despues.mora };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getCreditos, getCreditoById, registrarAbono, saldarCredito, cancelarCredito,
  getEstadoCuenta, getResumenCuenta,
  fijarPlazo, condonarMora, cobrarMora,
};