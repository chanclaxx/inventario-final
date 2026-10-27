// ─────────────────────────────────────────────────────────────────────────────
// Cobro de una orden de servicio técnico — espejo de servicios.repository
// (SQL_PRECIO_CICLO / precioCiclo). La suite 84 compara las dos copias.
//
// · El precio del ciclo VIGENTE: la reparación, o la garantía si se abrió una
//   (cobrable = su precio; gratis = 0). NULL mientras no se sabe.
// · Se puede abonar en cualquier estado abierto; sin precio no hay tope.
// ─────────────────────────────────────────────────────────────────────────────

export const ESTADOS_ABONO = ['Recibido', 'En_reparacion', 'Listo', 'Pendiente_pago', 'Garantia'];

const _num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export const enGarantia = (o) => o.estado === 'Garantia' || _num(o.precio_garantia) !== null;

/** Lo que se le cobra al cliente en el ciclo vigente (null = aún no se sabe). */
export const precioCiclo = (o) => {
  if (o.precio_ciclo !== undefined) return _num(o.precio_ciclo); // ya calculado por el backend
  if (enGarantia(o)) return o.garantia_cobrable ? _num(o.precio_garantia) : 0;
  return _num(o.precio_final);
};

export const abonado = (o) => Number(o.total_abonado || 0);

/** Saldo del ciclo vigente; null si todavía no hay precio. */
export const saldoCiclo = (o) => {
  const p = precioCiclo(o);
  return p === null ? null : Math.max(0, p - abonado(o));
};

/** ¿Muestra el botón de abono? Una garantía gratis no cobra nada. */
export const puedeAbonar = (o) => {
  if (!ESTADOS_ABONO.includes(o.estado)) return false;
  if (o.estado === 'Garantia' && !o.garantia_cobrable) return false;
  const s = saldoCiclo(o);
  return s === null || s > 0;
};

/** Al fijar el precio: si lo abonado lo supera, cuánto hay que devolver. */
export const devolucionAlFijarPrecio = (abonadoActual, precioNuevo) => {
  const a = Number(abonadoActual || 0);
  const p = Number(precioNuevo || 0);
  return a > p + 0.005 ? Math.round((a - p) * 100) / 100 : 0;
};

/**
 * Los pagos que cuentan en lo abonado: sin anulados y del ciclo vigente (al
 * abrir una garantía cobrable lo abonado vuelve a 0). Los abonos de antes de
 * 20261025 no tienen ciclo y se muestran como siempre. Espejo de
 * servicios.pdf.pagosVigentes.
 */
export const pagosVigentes = (o, abonos = []) => abonos.filter((ab) => !ab.anulado
  && (ab.ciclo === null || ab.ciclo === undefined || o.ciclo === null || o.ciclo === undefined
    || Number(ab.ciclo) === Number(o.ciclo)));

// ─── Corregir equivocaciones (espejo de servicios.correcciones.js) ──────────

export const ESTADOS_CON_PRECIO = ['Listo', 'Pendiente_pago', 'Entregado', 'Sin_reparar'];

/**
 * Qué campos se corrigen en esta orden. En un «sin reparar» el valor es el
 * diagnóstico (precio_final); en una garantía cobrable, el de la garantía.
 */
export const camposCorregibles = (o) => {
  const enG = enGarantia(o) && o.estado !== 'Sin_reparar';
  const gratis = enG && !o.garantia_cobrable;
  return {
    campoPrecio: enG ? 'precio_garantia' : 'precio_final',
    campoCosto: enG ? 'costo_garantia' : 'costo_real',
    etiquetaPrecio: o.estado === 'Sin_reparar' ? 'Cobro por diagnóstico'
      : enG ? 'Precio de la garantía' : 'Precio de la reparación',
    precio: ESTADOS_CON_PRECIO.includes(o.estado) && !gratis,
    costo: o.estado !== 'Sin_reparar' && !gratis,
  };
};

/** Qué pasa con la plata si el precio queda en `nuevo` (null = no cambia). */
export const efectoCorreccion = (o, nuevo) => {
  const pagado = abonado(o);
  const vacio = { devolver: 0, cobrar: 0, pendiente: 0, estado: o.estado };
  if (nuevo === null || nuevo === undefined || nuevo === '') return vacio;
  const p = Number(nuevo);
  const r = (v) => Math.round(v * 100) / 100;
  if (pagado > p + 0.004) {
    return { ...vacio, devolver: r(pagado - p), estado: o.estado === 'Pendiente_pago' ? 'Entregado' : o.estado };
  }
  if (p > pagado + 0.004) {
    if (o.estado === 'Sin_reparar') return { ...vacio, cobrar: r(p - pagado) };
    return { ...vacio, pendiente: r(p - pagado), estado: o.estado === 'Entregado' ? 'Pendiente_pago' : o.estado };
  }
  return { ...vacio, estado: o.estado === 'Pendiente_pago' ? 'Entregado' : o.estado };
};

/** Lo recibido y no devuelto en TODA la orden (todos sus ciclos): lo que deshace anularla. */
export const netoRecibido = (abonos = []) => Math.round(abonos
  .filter((a) => !a.anulado)
  .reduce((s, a) => s + (a.tipo === 'devolucion' ? -1 : 1) * Number(a.valor || 0), 0) * 100) / 100;

/** Sin reparar: el diagnóstico contra lo abonado. */
export const cuentaSinReparar = (o, diagnostico) => {
  const d = Number(diagnostico || 0);
  const a = enGarantia(o) && !o.garantia_cobrable ? 0 : abonado(o);
  return {
    abonado: a,
    diagnostico: d,
    devolver: a > d + 0.005 ? Math.round((a - d) * 100) / 100 : 0,
    cobrar: d > a + 0.005 ? Math.round((d - a) * 100) / 100 : 0,
  };
};
