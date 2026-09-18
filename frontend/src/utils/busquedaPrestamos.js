// ─────────────────────────────────────────────────────────────────────────────
// BÚSQUEDA DE PRÉSTAMOS — agrupar por persona y resumir lo encontrado
//
// Lógica pura (sin React) para que la prueba del backend la pueda importar y
// comparar contra la respuesta real: la pantalla no calcula nada de plata por
// su cuenta, solo SUMA lo que el backend ya resolvió en cada préstamo
// (`situacion`, `dias_vencidos`, `mora_pendiente`, `interes_pendiente`,
// `total_a_pagar`), que sale del mismo motor que la ficha y el aviso de cobros.
// ─────────────────────────────────────────────────────────────────────────────

const _norm = (t) => String(t || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim().replace(/\s+/g, ' ');

const _num = (v) => Number(v || 0);
const _activo = (p) => p.estado === 'Activo';

/**
 * Clave de la persona de un préstamo. Es la MISMA que arma la lista de
 * Préstamos (`prestatario_<id>` / `cliente_<id>`), así que sirve para abrir su
 * ficha. Un préstamo sin persona ligada (escrito a mano) se agrupa por el
 * nombre normalizado y no tiene ficha que abrir.
 */
export const claveBusquedaPersona = (p) => {
  if (p.prestatario_id) return `prestatario_${p.prestatario_id}`;
  if (p.cliente_id)     return `cliente_${p.cliente_id}`;
  return `libre_${_norm(p.prestatario) || p.id}`;
};

export const nombrePrestamo = (p) =>
  p.prestatario_nombre || p.cliente_nombre || p.prestatario || 'Sin nombre';

/** Agrupa los préstamos encontrados por persona, con sus totales y alertas. */
export const agruparPorPersona = (prestamos = []) => {
  const mapa = new Map();
  for (const p of prestamos) {
    const clave = claveBusquedaPersona(p);
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        clave,
        tipo:   p.prestatario_id ? 'companero' : p.cliente_id ? 'cliente' : 'libre',
        nombre: nombrePrestamo(p),
        cedula: p.cliente_cedula || p.cedula || null,
        telefono: p.telefono || null,
        prestamos: [],
        n_activos: 0, n_cerrados: 0,
        saldo: 0, mora: 0, interes: 0, total_a_pagar: 0,
        n_vencidos: 0, n_por_vencer: 0,
        dias_vencido_max: 0, dias_para_vencer_min: null,
        ultima_fecha: null,
      });
    }
    const g = mapa.get(clave);
    g.prestamos.push(p);
    if (!g.ultima_fecha || String(p.fecha) > String(g.ultima_fecha)) g.ultima_fecha = p.fecha;

    if (!_activo(p)) { g.n_cerrados += 1; continue; }
    g.n_activos += 1;
    // Solo lo ACTIVO suma deuda: un cerrado no debe nada (y si le quedara mora,
    // seguiría Activo — la obligación no se cierra con cargos pendientes).
    const saldo = Math.max(0, _num(p.saldo_pendiente));
    g.saldo   += saldo;
    g.mora    += _num(p.mora_pendiente);
    g.interes += _num(p.interes_pendiente);
    g.total_a_pagar += p.total_a_pagar != null
      ? _num(p.total_a_pagar)
      : saldo + _num(p.mora_pendiente) + _num(p.interes_pendiente);

    if (p.situacion === 'vencido') {
      g.n_vencidos += 1;
      g.dias_vencido_max = Math.max(g.dias_vencido_max, _num(p.dias_vencidos));
    }
    if (p.situacion === 'por_vencer') {
      g.n_por_vencer += 1;
      const d = _num(p.dias_para_vencer);
      g.dias_para_vencer_min = g.dias_para_vencer_min == null ? d : Math.min(g.dias_para_vencer_min, d);
    }
  }
  return [...mapa.values()];
};

/**
 * Cuántos hay en cada situación, para las tarjetas de arriba. Cuenta PERSONAS
 * además de préstamos: «3 personas con vencidos» es a quién hay que llamar.
 */
export const resumenBusqueda = (prestamos = []) => {
  const r = {
    total: prestamos.length,
    personas: new Set(prestamos.map(claveBusquedaPersona)).size,
    vencido:     { n: 0, personas: 0 },
    por_vencer:  { n: 0, personas: 0 },
    al_dia:      { n: 0, personas: 0 },
    sin_plazo:   { n: 0, personas: 0 },
    con_mora:    { n: 0, valor: 0 },
    con_interes: { n: 0, valor: 0 },
    saldo: 0,
  };
  const personas = { vencido: new Set(), por_vencer: new Set(), al_dia: new Set(), sin_plazo: new Set() };
  for (const p of prestamos) {
    if (!_activo(p)) continue;
    r.saldo += Math.max(0, _num(p.saldo_pendiente));
    if (r[p.situacion]) {
      r[p.situacion].n += 1;
      personas[p.situacion].add(claveBusquedaPersona(p));
    }
    if (_num(p.mora_pendiente) > 0)    { r.con_mora.n    += 1; r.con_mora.valor    += _num(p.mora_pendiente); }
    if (_num(p.interes_pendiente) > 0) { r.con_interes.n += 1; r.con_interes.valor += _num(p.interes_pendiente); }
  }
  for (const k of Object.keys(personas)) r[k].personas = personas[k].size;
  return r;
};

export const ORDENES_BUSQUEDA = [
  { id: 'urgencia', label: 'Más urgente' },
  { id: 'deuda',    label: 'Mayor deuda' },
  { id: 'reciente', label: 'Más reciente' },
  { id: 'nombre',   label: 'Nombre A → Z' },
];

/**
 * Orden de los grupos. «Más urgente» pone arriba al más atrasado, después a
 * quien vence antes, y dentro de lo mismo a quien debe más: es el orden en que
 * hay que llamar.
 */
export const ordenarGrupos = (grupos, criterio = 'urgencia') => {
  const lista = [...grupos];
  const rango = (g) => (g.n_vencidos > 0 ? 0 : g.n_por_vencer > 0 ? 1 : g.n_activos > 0 ? 2 : 3);
  lista.sort((a, b) => {
    if (criterio === 'deuda')    return b.total_a_pagar - a.total_a_pagar;
    if (criterio === 'nombre')   return a.nombre.localeCompare(b.nombre, 'es');
    if (criterio === 'reciente') return String(b.ultima_fecha).localeCompare(String(a.ultima_fecha));
    return (rango(a) - rango(b))
      || (b.dias_vencido_max - a.dias_vencido_max)
      || ((a.dias_para_vencer_min ?? 9999) - (b.dias_para_vencer_min ?? 9999))
      || (b.total_a_pagar - a.total_a_pagar);
  });
  return lista;
};

/** Mismo criterio para la vista de préstamos sueltos. */
export const ordenarPrestamos = (prestamos, criterio = 'urgencia') => {
  const lista = [...prestamos];
  const rango = (p) => (!_activo(p) ? 3
    : p.situacion === 'vencido' ? 0 : p.situacion === 'por_vencer' ? 1 : 2);
  lista.sort((a, b) => {
    if (criterio === 'deuda')    return _num(b.total_a_pagar ?? b.saldo_pendiente) - _num(a.total_a_pagar ?? a.saldo_pendiente);
    if (criterio === 'nombre')   return nombrePrestamo(a).localeCompare(nombrePrestamo(b), 'es');
    if (criterio === 'reciente') return String(b.fecha).localeCompare(String(a.fecha));
    return (rango(a) - rango(b))
      || (_num(b.dias_vencidos) - _num(a.dias_vencidos))
      || ((a.dias_para_vencer ?? 9999) - (b.dias_para_vencer ?? 9999))
      || (_num(b.saldo_pendiente) - _num(a.saldo_pendiente));
  });
  return lista;
};
