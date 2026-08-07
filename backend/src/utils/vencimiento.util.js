// ─── Vencimiento de una factura de proveedor ─────────────────────────────────
//
// El plazo y el vencimiento son dos formas de decir lo mismo, y el usuario
// escribe la que tenga a mano: unos negocios saben "son 30 días", otros leen la
// fecha impresa en la factura. Esta función resuelve las dos.
//
// Vive aquí y no dentro de un módulo porque la usan las órdenes de compra Y las
// compras sueltas. Si cada una hiciera su cuenta, la misma factura vencería en
// días distintos según por dónde se hubiera registrado.
//
// TODO se maneja como DATE en UTC (`YYYY-MM-DD`), nunca como TIMESTAMP: sumarle
// días a una fecha con hora arrastra el desfase de la zona horaria y corre el
// vencimiento un día. Es la confusión que ya costó dos veces en
// `mora.service._inicioInteres`.

/**
 * @param {object} datos
 * @param {string|Date|null} datos.fecha_factura     — fecha impresa en la factura
 * @param {number|string|null} datos.dias_plazo      — días de crédito pactados
 * @param {string|Date|null} datos.fecha_vencimiento — fecha explícita, si la hay
 * @returns {string|null} 'YYYY-MM-DD', o null si no hay con qué calcularlo
 */
const resolverVencimiento = ({ fecha_factura, dias_plazo, fecha_vencimiento } = {}) => {
  // Una fecha explícita SIEMPRE manda sobre el plazo: el negocio pudo pactar
  // algo distinto al plazo nominal del proveedor, y ese acuerdo no se puede
  // pisar con una cuenta automática.
  if (fecha_vencimiento) return String(fecha_vencimiento).slice(0, 10);

  const dias = Number(dias_plazo);
  if (!fecha_factura || !Number.isInteger(dias)) return null;

  const base = new Date(`${String(fecha_factura).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;

  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
};

module.exports = { resolverVencimiento };
