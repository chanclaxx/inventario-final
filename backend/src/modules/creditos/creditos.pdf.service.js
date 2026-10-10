'use strict';

/**
 * PDF de estado de cuenta de un cliente a crédito.
 *
 * Solo carga datos: el dibujo lo hace utils/estadoCuenta.pdf.js (el mismo que
 * usan los préstamos) y los movimientos los calcula creditos.service, que es la
 * única fuente de verdad del saldo. Por eso el PDF, el Excel y la pantalla no
 * pueden mostrar cifras distintas.
 */

const { pool } = require('../../config/db');
const { configDocumento, encabezadoPara, aplicarDatosSucursal } = require('../../utils/emisor.util');
const { construirPdfEstadoCuenta } = require('../../utils/estadoCuenta.pdf');
const { generarAvisoMora, generarPazYSalvo } = require('../../utils/obligacion.pdf');
const service = require('./creditos.service');
const { formatCOP } = require('../../utils/pdf.base');
const { sqlVarianteTexto, nombreConVariante } = require('../../utils/varianteTexto.util');
const { separarVariante } = require('../../utils/resumenDeuda.pdf');

// Mismos colores que los badges de la pantalla (EstadoCuentaCredito.jsx).
const TIPO_LABEL = {
  credito:          { label: 'Factura',      bg: '#FFFBEB', text: '#D97706' },
  cuota_inicial:    { label: 'Cuota inic.',  bg: '#EFF6FF', text: '#2563EB' },
  abono:            { label: 'Abono',        bg: '#ECFDF5', text: '#059669' },
  devolucion:       { label: 'Devolución',   bg: '#FFF7ED', text: '#EA580C' },
  ajuste:           { label: 'Ajuste',       bg: '#F5F3FF', text: '#7C3AED' },
  mora_cobro:       { label: 'Mora',         bg: '#FEF2F2', text: '#DC2626' },
  mora_condonacion: { label: 'Mora cond.',   bg: '#F3F4F6', text: '#6B7280' },
  interes_cobro:       { label: 'Interés',       bg: '#ECFDF5', text: '#0F766E' },
  interes_condonacion: { label: 'Interés cond.', bg: '#F3F4F6', text: '#6B7280' },
};

const generarPdfEstadoCuenta = async ({ clave, negocioId, negocioNombre, logoNegocio, sucursalId = null }) => {
  const { persona, movimientos, saldoFinal } =
    await service.getResumenCuenta(negocioId, clave, sucursalId);

  const { rows: configRows } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`,
    [negocioId]
  );
  const configNegocio = {};
  for (const row of configRows) configNegocio[row.clave] = row.valor;
  // Encabezado de la sede de quien lo imprime (sin sede elegida, el negocio).
  const enc = await encabezadoPara(negocioId, sucursalId, { nombre: negocioNombre, logo: logoNegocio });
  const config = aplicarDatosSucursal(configNegocio, enc.datos);
  negocioNombre = enc.nombre; logoNegocio = enc.logo;

  // Lo que no arrastra deuda se lista en gris y sin saldo, con la razon a la
  // vista. Son dos casos distintos y el cliente tiene que poder distinguirlos:
  //   - la FACTURA se cancelo: queda como constancia;
  //   - el ABONO se anulo: se muestra el motivo que escribio la persona.
  // Un movimiento que no suma y no dice por que es justo lo que hacia que el
  // extracto y la deuda total no cuadraran.
  const movsPdf = movimientos.map((m) => {
    const facturaCancelada = m.credito_estado === 'Cancelado';
    const abonoAnulado     = m.anulado === true;
    const nota = abonoAnulado     ? (m.motivo_anulacion || 'Anulado')
               : facturaCancelada ? 'Anulado'
               : null;
    return { ...m, nota, atenuado: facturaCancelada || abonoAnulado };
  });

  return construirPdfEstadoCuenta({
    persona,
    subtitulo: 'Cliente · Facturas a crédito',
    movimientos: await _detallesEstadoCuenta(movsPdf),
    saldoFinal,
    resumenDeuda: await _resumenDeudaCreditos(negocioId, clave, sucursalId, saldoFinal),
    config: { ...config, nombre_negocio: negocioNombre || config.nombre_negocio },
    logoNegocio,
    tipoLabels: TIPO_LABEL,
    negocioNombre,
  });
};

// Misma clave de persona que la pantalla y que el estado de cuenta
// (creditos.repository: COALESCE(cédula, nombre)).
const CLAVE_CLIENTE = `COALESCE(NULLIF(f.cedula, ''), f.nombre_cliente)`;

/**
 * La tabla con que abre el estado de cuenta: cada producto de cada factura a
 * crédito ACTIVA, y la deuda de la factura en su última línea —la deuda es de
 * la factura, no de cada producto: repartirla sería inventar una cifra—.
 * Saldo = valor − cuota inicial − abonado, la regla del service; mora e
 * interés pendientes por `mora.service.anotarLista`, los de la pantalla.
 */
const _resumenDeudaCreditos = async (negocioId, clave, sucursalId, saldoExtracto) => {
  const params = [negocioId, clave];
  let filtro = '';
  if (sucursalId) { params.push(sucursalId); filtro = 'AND c.sucursal_id = $3'; }
  let creditos;
  try {
    ({ rows: creditos } = await pool.query(`
      SELECT c.*, COALESCE(f.numero, f.id) AS factura_numero
        FROM creditos c
        JOIN facturas   f  ON f.id  = c.factura_id
        JOIN sucursales su ON su.id = c.sucursal_id
       WHERE su.negocio_id = $1 AND ${CLAVE_CLIENTE} = $2 AND c.estado = 'Activo' ${filtro}
       ORDER BY c.creado_en, c.id`, params));
  } catch (err) {
    console.warn('[pdf-estado-cuenta-credito] Resumen no incluido:', err.message);
    return null;
  }

  try {
    const moraService = require('../mora/mora.service');
    creditos = await moraService.anotarLista(creditos, 'credito');
  } catch (err) {
    console.warn('[pdf-estado-cuenta-credito] Cargos no incluidos:', err.message);
  }

  let lineas = [];
  if (creditos.length) {
    ({ rows: lineas } = await pool.query(`
      SELECT c.id AS credito_id, lf.id, lf.nombre_producto, lf.imei, lf.cantidad, lf.precio,
             COALESCE(lf.cantidad_devuelta, 0) AS cantidad_devuelta,
             ${sqlVarianteTexto('lf')} AS variante,
             COALESCE(
               (SELECT lp.nombre FROM seriales s
                  JOIN productos_serial ps ON ps.id = s.producto_id
                  JOIN lineas_producto  lp ON lp.id = ps.linea_id
                 WHERE lf.imei IS NOT NULL AND s.imei = lf.imei
                 ORDER BY (ps.sucursal_id = c.sucursal_id) DESC NULLS LAST, s.id LIMIT 1),
               (SELECT lp.nombre FROM productos_cantidad pc
                  JOIN lineas_producto lp ON lp.id = pc.linea_id
                 WHERE pc.id = lf.producto_id)
             ) AS linea_nombre,
             (SELECT s.color FROM seriales s WHERE lf.imei IS NOT NULL AND s.imei = lf.imei
               ORDER BY s.id LIMIT 1) AS serial_color
        FROM creditos c
        JOIN lineas_factura lf ON lf.factura_id = c.factura_id
       WHERE c.id = ANY($1::int[])
       ORDER BY lf.id`, [creditos.map((c) => c.id)]));
  }
  const lineasDe = new Map();
  for (const l of lineas) {
    if (!lineasDe.has(Number(l.credito_id))) lineasDe.set(Number(l.credito_id), []);
    lineasDe.get(Number(l.credito_id)).push(l);
  }

  const num = (v) => Number(v || 0);
  const filas = [];
  const tot = { cantidad: 0, subtotal: 0, abonado: 0, cargos: 0, debeCapital: 0, cobrar: 0 };
  for (const c of creditos) {
    const saldo  = Math.max(0, num(c.valor_total) - num(c.cuota_inicial) - num(c.total_abonado));
    const cargos = num(c.mora?.pendiente) + num(c.interes?.pendiente);
    const vigentes = (lineasDe.get(Number(c.id)) || [])
      .map((l) => ({ l, cant: num(l.cantidad) - num(l.cantidad_devuelta) }))
      .filter(({ cant }) => cant > 0);
    const ref = `Fact. #${String(c.factura_numero).padStart(6, '0')}`;
    vigentes.forEach(({ l, cant }, i) => {
      const { producto, variante } = separarVariante(l.nombre_producto, l.variante);
      filas.push({
        fecha: c.creado_en, referencia: ref, cantidad: cant,
        producto, detalle: l.imei ? `IMEI ${l.imei}` : null,
        variante: variante || (l.serial_color ? `Color: ${l.serial_color}` : null),
        linea: l.linea_nombre || null,
        unitario: num(l.precio), total: cant * num(l.precio),
        debe: i === vigentes.length - 1 ? saldo : null,
      });
      tot.cantidad += cant;
    });
    if (!vigentes.length) {
      filas.push({ fecha: c.creado_en, referencia: ref, cantidad: 0, producto: 'Factura a crédito',
        variante: null, linea: null, unitario: null, total: num(c.valor_total), debe: saldo });
    }
    tot.subtotal    += num(c.valor_total);
    tot.abonado     += num(c.cuota_inicial) + num(c.total_abonado);
    tot.cargos      += cargos;
    tot.debeCapital += saldo;
    tot.cobrar      += saldo + cargos;
  }

  const notas = [];
  if (!creditos.length) notas.push('No tiene facturas a crédito activas: no hay nada por cobrar.');
  else if (Math.abs(num(saldoExtracto) - tot.debeCapital) > 1) {
    notas.push(`El saldo del extracto (${formatCOP(saldoExtracto)}) no coincide con lo que deben las facturas activas `
      + `(${formatCOP(tot.debeCapital)}): la diferencia son movimientos de facturas que ya no están activas.`);
  }

  return {
    titulo: `Resumen · ${creditos.length} factura${creditos.length !== 1 ? 's' : ''} a crédito activa${creditos.length !== 1 ? 's' : ''}`,
    filas,
    totales: { ...tot, abonadoLabel: 'Cuota inicial y abonos' },
    nota: notas.filter(Boolean).join(' ') || null,
  };
};

const _fechaDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : null);

/**
 * Lo que la cuadrícula de la pantalla no muestra y el PDF sí: debajo de cada
 * factura sus productos (cantidad, variante, IMEI, precio y lo devuelto) y
 * quién vendió; debajo de cada abono quién lo registró, y de un pago total a
 * qué facturas se repartió. Una consulta por tabla y por ids: los movimientos
 * ya vienen acotados a la persona y a la sede por el service.
 */
const _detallesEstadoCuenta = async (movimientos) => {
  const idsCredito = new Set();
  const idsAbono   = new Set();
  const idsTotal   = new Set();
  const idsMora    = new Set();
  for (const m of movimientos) {
    if (m.credito_id) idsCredito.add(Number(m.credito_id));
    if (m.tipo === 'abono' && !m.es_pago_total) idsAbono.add(Number(m.referencia_id));
    if (m.tipo === 'abono' && m.es_pago_total) {
      idsTotal.add(Number(m.referencia_id));
      for (const d of (m.detalle || [])) idsCredito.add(Number(d.credito_id));
    }
    if (/^(mora|interes)_/.test(m.tipo)) idsMora.add(Number(m.referencia_id));
  }
  const arr = (s) => [...s].filter((n) => Number.isInteger(n) && n > 0);
  const consultar = async (ids, sql) => {
    if (!ids.length) return [];
    try {
      return (await pool.query(sql, [ids])).rows;
    } catch (err) {
      // El detalle es un extra: el estado de cuenta sale aunque falte.
      console.warn('[pdf-estado-cuenta-credito] Detalle no incluido:', err.message);
      return [];
    }
  };

  const [creditos, lineas, abonos, totales, moras] = await Promise.all([
    consultar(arr(idsCredito), `
      SELECT c.id, c.fecha_limite, c.cuota_inicial,
             COALESCE(f.numero, f.id) AS factura_numero,
             u.nombre AS usuario_nombre, vd.nombre AS vendedor_nombre, su.nombre AS sucursal_nombre
        FROM creditos c
        JOIN facturas f   ON f.id  = c.factura_id
        JOIN sucursales su ON su.id = c.sucursal_id
        LEFT JOIN usuarios   u  ON u.id  = f.usuario_id
        LEFT JOIN vendedores vd ON vd.id = f.vendedor_id
       WHERE c.id = ANY($1::int[])`),
    consultar(arr(idsCredito), `
      SELECT c.id AS credito_id, lf.nombre_producto, lf.imei, lf.cantidad, lf.precio,
             COALESCE(lf.cantidad_devuelta, 0) AS cantidad_devuelta,
             ${sqlVarianteTexto('lf')} AS variante
        FROM creditos c
        JOIN lineas_factura lf ON lf.factura_id = c.factura_id
       WHERE c.id = ANY($1::int[])
       ORDER BY lf.id`),
    consultar(arr(idsAbono), `
      SELECT ac.id, u.nombre AS usuario_nombre
        FROM abonos_credito ac LEFT JOIN usuarios u ON u.id = ac.usuario_id
       WHERE ac.id = ANY($1::int[])`),
    consultar(arr(idsTotal), `
      SELECT at.id, at.valor_total, u.nombre AS usuario_nombre
        FROM abonos_totales at LEFT JOIN usuarios u ON u.id = at.usuario_id
       WHERE at.id = ANY($1::int[])`),
    consultar(arr(idsMora), `
      SELECT mm.id, u.nombre AS usuario_nombre
        FROM movimientos_mora mm LEFT JOIN usuarios u ON u.id = mm.usuario_id
       WHERE mm.id = ANY($1::bigint[])`),
  ]);

  const porId = (rows, k = 'id') => new Map(rows.map((r) => [Number(r[k]), r]));
  const mCred = porId(creditos);
  const mAbono = porId(abonos);
  const mTotal = porId(totales);
  const mMora = porId(moras);
  const lineasDe = new Map();
  for (const l of lineas) {
    const k = Number(l.credito_id);
    if (!lineasDe.has(k)) lineasDe.set(k, []);
    lineasDe.get(k).push(l);
  }

  return movimientos.map((m) => {
    const detalles = [];
    const c = mCred.get(Number(m.credito_id));
    if (m.tipo === 'credito') {
      for (const l of (lineasDe.get(Number(m.credito_id)) || [])) {
        const cant = Number(l.cantidad) || 0;
        const dev  = Number(l.cantidad_devuelta) || 0;
        detalles.push([
          `${cant} × ${nombreConVariante(l.nombre_producto, l.variante)}`,
          l.imei ? `IMEI ${l.imei}` : null,
          `${formatCOP(l.precio)} c/u`,
          dev > 0 ? (dev >= cant ? 'devuelto' : `${dev} devuelta(s)`) : null,
        ].filter(Boolean).join(' · '));
      }
      if (c) {
        const quien = [
          c.vendedor_nombre ? `Vendedor: ${c.vendedor_nombre}` : null,
          c.usuario_nombre ? `Registró: ${c.usuario_nombre}` : null,
          c.sucursal_nombre ? `Sede: ${c.sucursal_nombre}` : null,
          c.fecha_limite ? `Vence: ${_fechaDate(c.fecha_limite)}` : null,
        ].filter(Boolean).join(' · ');
        if (quien) detalles.push(quien);
      }
      // Los productos van uno por renglón debajo: el concepto queda corto.
      if (detalles.length && m.factura_numero) {
        m = { ...m, concepto: `Factura #${String(m.factura_numero).padStart(6, '0')} a crédito` };
      }
    } else if (m.tipo === 'abono' && !m.es_pago_total) {
      const ab = mAbono.get(Number(m.referencia_id));
      if (ab?.usuario_nombre) detalles.push(`Registró: ${ab.usuario_nombre}`);
    } else if (m.tipo === 'abono' && m.es_pago_total) {
      const t = mTotal.get(Number(m.referencia_id));
      if (m.descripcion) detalles.push(`Nota: ${m.descripcion}`);
      if (t?.usuario_nombre) detalles.push(`Registró: ${t.usuario_nombre}`);
      for (const d of (m.detalle || [])) {
        detalles.push(`${formatCOP(d.valor)} a la factura #${String(d.factura).padStart(6, '0')}`
          + (d.anulado ? ` (anulado${d.motivo_anulacion ? `: ${d.motivo_anulacion}` : ''})` : ''));
      }
    } else if (/^(mora|interes)_/.test(m.tipo)) {
      const mm = mMora.get(Number(m.referencia_id));
      if (mm?.usuario_nombre) detalles.push(`Registró: ${mm.usuario_nombre}`);
    }
    return { ...m, detalles };
  });
};

// ─── Documentos por crédito: aviso de mora y paz y salvo ─────────────────────
//
// Los dos salen del MISMO resumen que imprime la factura y muestra la pantalla
// (creditos.service.getDocumento), así que las cifras no pueden divergir.

const _configNegocio = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT clave, valor FROM config_negocio WHERE negocio_id = $1`, [negocioId]);
  const config = {};
  for (const row of rows) config[row.clave] = row.valor;
  return config;
};

/**
 * Un renglón por producto, con cantidad, variante, IMEI, precio y lo devuelto.
 * La descripción de una línea que trae el service es la del ticket POS (corta);
 * el PDF tiene espacio para decirlo todo.
 */
const _descripcionDetallada = (lineas, descripcion) => {
  if (!Array.isArray(lineas) || !lineas.length) return descripcion;
  return lineas.map((l) => {
    const cant = Number(l.cantidad) || 0;
    const dev  = Number(l.cantidad_devuelta) || 0;
    return [
      `${cant} × ${nombreConVariante(l.nombre_producto, l.variante)}`,
      l.imei ? `IMEI ${l.imei}` : null,
      `${formatCOP(l.precio)} c/u`,
      dev > 0 ? (dev >= cant ? 'devuelto' : `${dev} devuelta(s)`) : null,
    ].filter(Boolean).join(' · ');
  }).join('\n');
};

const generarPdfAvisoMora = async ({ creditoId, negocioId }) => {
  const doc = await service.getDocumento(negocioId, creditoId);
  const { credito, persona, resumen } = doc;
  const descripcion = _descripcionDetallada(doc.lineas, doc.descripcion);

  if (!resumen.vencido) {
    throw { status: 400, message: 'Esta factura no está vencida: no procede un aviso de mora' };
  }

  // Con los datos de la sede que vendió a crédito.
  const config = await configDocumento(negocioId, credito.sucursal_id, await _configNegocio(negocioId));
  return generarAvisoMora({ config, persona, resumen, descripcion });
};

const generarPdfPazYSalvo = async ({ creditoId, negocioId }) => {
  const doc = await service.getDocumento(negocioId, creditoId);
  const { credito, persona, resumen } = doc;
  const descripcion = _descripcionDetallada(doc.lineas, doc.descripcion);

  if (!resumen.pagada) {
    throw { status: 400, message: 'La factura aún tiene saldo pendiente: no se puede expedir paz y salvo' };
  }

  // Con los datos de la sede que vendió a crédito.
  const config = await configDocumento(negocioId, credito.sucursal_id, await _configNegocio(negocioId));
  return generarPazYSalvo({ config, persona, resumen, descripcion });
};

module.exports = {
  generarPdfEstadoCuenta, generarPdfAvisoMora, generarPdfPazYSalvo, TIPO_LABEL,
  // Para las pruebas: el detalle y la descripción sin dibujar.
  _detallesEstadoCuenta, _descripcionDetallada,
};
