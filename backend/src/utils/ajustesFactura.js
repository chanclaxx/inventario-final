'use strict';

/**
 * AJUSTES DE UNA FACTURA A CRÉDITO, contados para el cliente.
 *
 * Cuando una factura se edita o se corrige a mano, el cliente recibe un PDF con
 * cifras que ya no son las de la venta original, y sin explicación eso parece
 * un error (o una trampa). Este módulo lee lo que quedó en `auditoria` y lo
 * cuenta en una frase: qué valor se editó, de cuánto a cuánto, y —si ya había
 * abonos— si lo aplicado subió o bajó.
 *
 * Deliberadamente NO dice «descuento» ni interpreta el porqué: dice lo que hizo
 * el programa. El porqué lo sabe el negocio, no el sistema.
 *
 * Solo cuenta lo que tiene cifras: los registros de «Venta editada» anteriores
 * al 14-sep-2026 guardaban `valor: 0` y no dicen nada, así que se omiten en vez
 * de inventar un cambio.
 *
 * Es texto puro (sin PDFKit) para que se pueda probar sin renderizar.
 */

const peso = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;

const leer = (detalle) => {
  if (detalle && typeof detalle === 'object') return detalle;
  try { return JSON.parse(detalle); } catch { return null; }
};

// ── Corrección manual (scripts/corregir-*.js) ────────────────────────────────
const _correccion = (d, { abonos, lineas }) => {
  if (d.tipo === 'cliente') {
    const antes = d.cliente_antes || {};
    const despues = d.cliente_despues || {};
    return `El crédito quedó a nombre de ${despues.nombre}${despues.cedula ? ` (C.C. ${despues.cedula})` : ''}, `
      + `que es el cliente de esta factura; antes seguía a nombre de ${antes.nombre}. Los valores no cambiaron.`;
  }

  const partes = [];
  const antes = d.credito_antes || {};

  if (d.credito_despues) {
    partes.push(`Se ajustó el valor del crédito de ${peso(antes.valor_total)} a `
      + `${peso(d.credito_despues.valor_total)} para que coincida con el valor editado de la factura.`);
  }

  const cambios = (d.lineas || []).filter((l) => Number(l.antes) !== Number(l.despues));
  if (cambios.length) {
    const facturaAntes = Number(d.factura_antes) || 0;
    const facturaDespues = facturaAntes + cambios.reduce(
      (s, l) => s + (Number(l.despues) - Number(l.antes)) * Number(l.cantidad || 1), 0);
    const detalle = cambios.map((l) => {
      const nombre = lineas.find((x) => Number(x.id) === Number(l.id))?.nombre_producto;
      const quien = nombre ? `«${String(nombre).trim()}»` : 'un producto';
      return `${quien} pasó de ${peso(l.antes)} a ${peso(l.despues)}${Number(l.cantidad) > 1 ? ' cada uno' : ''}`;
    }).join('; ');
    partes.push(`Se ajustó el valor de la factura de ${peso(facturaAntes)} a ${peso(facturaDespues)} `
      + `para que coincida con el valor del crédito: ${detalle}.`);
  }

  if (d.abono_anulado) {
    const abono = abonos.find((x) => Number(x.id) === Number(d.abono_anulado.abono));
    const registrado = Number(abono?.valor ?? antes.total_abonado ?? 0);
    const quitado = Number(d.abono_anulado.valor) || 0;
    partes.push(`Como ya había un abono de ${peso(registrado)}, el valor aplicado de ese abono bajó a `
      + `${peso(registrado - quitado)}: ${peso(quitado)} no se aplican a la deuda.`);
  } else if (Number(antes.total_abonado) > 0) {
    partes.push(`Lo abonado (${peso(antes.total_abonado)}) no cambió.`);
  }

  return partes.join(' ') || null;
};

// ── Edición desde Facturas (facturas.controller.editarFactura) ───────────────
const _edicion = (d) => {
  if (d.valor_anterior == null) return null;
  const antes = Number(d.valor_anterior);
  const despues = Number(d.valor);
  const c = d.credito;
  const partes = [];

  if (Math.abs(antes - despues) >= 1) {
    partes.push(`Se editó el valor de la factura de ${peso(antes)} a ${peso(despues)}.`);
  }
  if (c && Math.abs(Number(c.valor_nuevo) - Number(c.valor_anterior)) >= 1) {
    const sube = Number(c.valor_nuevo) > Number(c.valor_anterior);
    const cierre = c.estado === 'Saldado' && Number(c.saldo_nuevo) <= 0
      ? ' y el crédito quedó pagado.'
      : ` y el saldo quedó en ${peso(c.saldo_nuevo)}.`;
    partes.push(`Por eso el valor del crédito ${sube ? 'subió' : 'bajó'} de ${peso(c.valor_anterior)} `
      + `a ${peso(c.valor_nuevo)}${cierre}`);
  }
  return partes.join(' ') || null;
};

/**
 * @param {Array} filas  — filas de `auditoria` de la factura, en orden cronológico
 * @param {object} ctx
 * @param {Array} ctx.abonos — abonos del crédito tal como salen de la BD (valor registrado)
 * @param {Array} ctx.lineas — líneas de la factura (para nombrar los productos)
 * @returns {Array<{ fecha, texto }>}
 */
const describirAjustes = (filas = [], { abonos = [], lineas = [] } = {}) => filas
  .map((f) => {
    const d = leer(f.detalle);
    if (!d) return null;
    let texto = null;
    if (f.accion === 'Corrección manual de crédito') texto = _correccion(d, { abonos, lineas });
    else if (f.accion === 'Venta editada')           texto = _edicion(d);
    return texto ? { fecha: f.fecha, texto } : null;
  })
  .filter(Boolean);

module.exports = { describirAjustes };
