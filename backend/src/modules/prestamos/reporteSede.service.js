// src/modules/prestamos/reporteSede.service.js
// ─────────────────────────────────────────────────────────────────────────────
// REPORTE POR SEDE — el mes de una sucursal entera (oct-2026): qué se vendió y
// prestó de CADA LÍNEA de producto (iPhone, Samsung, Accesorios…), cuántas
// unidades siguen PENDIENTES y cuántas ya se PAGARON, y cuánta plata entró y
// cuánta se debe todavía. Repartido por línea, por tipo (contado, crédito,
// préstamo a cliente, a compañero), mes a mes y por empleado.
//
// Es el hermano del reporte por empleado y sale de LAS MISMAS consultas y la
// MISMA clasificación (`reporteEmpleado.service`): una sede = la suma de sus
// empleados, y si cada documento contara a su manera no cuadrarían. La prueba
// (`72-reporte-sede`) lo exige.
//
// Reglas:
//   · Fecha = la de la operación (venta o préstamo); estado = el de HOY.
//   · Línea = la de la unidad en el inventario (`SQL_LINEA` del reporte por
//     empleado); sin línea, «Sin línea». Pedido del negocio en vez de «equipos
//     / accesorios»: «que la gente sepa qué se vendió de cada una».
//   · Unidades: cada fila con su `cantidad`, en el grupo de su estado (Pagados /
//     Pendientes / Dev. parcial / Devueltos / Cancelados), igual que el reporte
//     por empleado.
//   · PLATA (este reporte sí suma, pedido del negocio):
//       contado  → valor = pagado = precio × (cantidad − devuelta); debe 0.
//       crédito  → por CRÉDITO, no por línea: valor = valor_total (la
//                  devolución ya lo rebajó), pagado = cuota inicial + abonos,
//                  debe = valor − pagado mientras esté Activo.
//       préstamo → valor = valor_prestamo, pagado = abonado, debe = valor −
//                  abonado mientras esté Activo.
//     Lo CANCELADO y lo DEVUELTO no suma plata: no se vendió. Es CAPITAL: la
//     mora y el interés son ingreso financiero y van aparte (como en reportes).
//   · La plata de un crédito con productos de VARIAS líneas se reparte entre
//     ellas en proporción al valor de cada producto (lo que no se devolvió),
//     y el último pedazo se lleva el redondeo: la suma por línea da exacto el
//     total.
//   · Fuera, igual que en el de empleado: la factura que genera un préstamo
//     saldado (duplicaría el equipo) y los ajustes de deuda.
// ─────────────────────────────────────────────────────────────────────────────
const { pool } = require('../../config/db');
const emp = require('./reporteEmpleado.service');

const SIN_LINEA = 'Sin línea';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const _num = (v) => Number(v) || 0;
const _round = (n) => Math.round(n * 100) / 100;

const lineaDe = (nombre) => String(nombre ?? '').trim() || SIN_LINEA;

const etiquetaMes = (mes) => {
  const [a, m] = String(mes || '').split('-').map(Number);
  return a && m ? `${MESES[m - 1]} ${a}` : String(mes || '');
};

// ─── Acumuladores ───────────────────────────────────────────────────────────

const nuevasUnidades = () => Object.fromEntries([...emp.GRUPOS.map((g) => [g.id, 0]), ['total', 0]]);

const nuevoTotal = () => ({
  unidades: nuevasUnidades(),
  // Documentos: facturas (contado/crédito) y préstamos, para leer «cuántos».
  documentos: 0, activos: 0, saldados: 0,
  valor: 0, pagado: 0, debe: 0,
  // Cerrado (Saldado) sin que el abono quedara registrado: valor − pagado de
  // lo saldado. Sin esta cifra «valor = pagado + debe» no cuadra y parece un
  // error del reporte; es un dato real (créditos «Saldado» de antes del
  // botón «Pagar todo»). Se muestra aparte, nunca se esconde.
  cerrado_sin_pago: 0,
});

const sumarUnidades = (t, grupo, cantidad) => {
  t.unidades[grupo] += cantidad;
  t.unidades.total  += cantidad;
};

const sumarPlata = (t, { valor, pagado, debe, cerrado_sin_pago = 0 }) => {
  t.valor  = _round(t.valor  + valor);
  t.pagado = _round(t.pagado + pagado);
  t.debe   = _round(t.debe   + debe);
  t.cerrado_sin_pago = _round(t.cerrado_sin_pago + cerrado_sin_pago);
};

/** Unidades que siguen VIGENTES (lo que de verdad salió): sin canceladas ni devueltas. */
const vigentes = (t) => t.unidades.pagado + t.unidades.pendiente + t.unidades.devuelto_parcial;

// ─── Del dato crudo a documentos con su plata ───────────────────────────────

/**
 * Convierte las líneas y los préstamos (los MISMOS que lee el reporte por
 * empleado) en «unidades» —fila por fila, con su línea de producto— y en
 * «documentos» —la plata—. Separadas porque un crédito con tres productos son
 * tres filas de unidades pero UNA deuda. Cada documento lleva sus `partes`
 * (línea y peso) para repartir esa plata entre las líneas.
 */
const normalizar = ({ lineas = [], prestamos = [] }) => {
  const unidades = [];
  const documentos = new Map();

  for (const l of lineas) {
    const tipo = l.credito_id || l.factura_estado === 'Credito' ? 'credito' : 'contado';
    const grupo = emp.clasificarLineaFactura(l);
    const cantidad = _num(l.cantidad);
    const devuelta = Math.min(cantidad, _num(l.cantidad_devuelta));
    const obsequio = l.obsequio === true || l.obsequio === 'true';
    const linea = lineaDe(l.linea_nombre);
    unidades.push({
      tipo, grupo, linea, mes: l.mes, usuario_id: l.usuario_id ?? null, usuario_nombre: l.usuario_nombre,
      cantidad, obsequio,
    });

    // La plata de un crédito vive en el CRÉDITO; la de contado, en la línea.
    const clave = tipo === 'credito' && l.credito_id ? `c-${l.credito_id}` : `f-${l.factura_id}`;
    if (!documentos.has(clave)) {
      documentos.set(clave, {
        clave, tipo, mes: l.mes, fecha: l.fecha_txt,
        usuario_id: l.usuario_id ?? null, usuario_nombre: l.usuario_nombre,
        documento: `F-${l.numero ?? l.factura_id}`,
        persona: l.nombre_cliente || 'Cliente',
        persona_extra: l.cedula && l.cedula !== 'COMPANERO' ? `CC ${l.cedula}` : '',
        productos: [],
        partes: [],
        cancelado: l.factura_estado === 'Cancelada' || l.credito_estado === 'Cancelado',
        credito_id: l.credito_id || null,
        credito_estado: l.credito_estado || null,
        valor_total: _num(l.valor_total), cuota_inicial: _num(l.cuota_inicial), total_abonado: _num(l.total_abonado),
        valor_lineas: 0,
      });
    }
    const d = documentos.get(clave);
    d.productos.push(l.imei ? `${l.nombre_producto} (IMEI ${l.imei})` : `${l.nombre_producto}${cantidad > 1 ? ` × ${cantidad}` : ''}`);
    const neto = obsequio ? 0 : _num(l.precio) * Math.max(0, cantidad - devuelta);
    d.valor_lineas += neto;
    d.partes.push({ linea, peso: neto });
  }

  for (const p of prestamos) {
    const tipo = p.cliente_id ? 'prestamo_cliente' : 'prestamo_companero';
    const grupo = emp.clasificarPrestamo(p);
    const cantidad = _num(p.cantidad_prestada) || 1;
    const linea = lineaDe(p.linea_nombre);
    unidades.push({
      tipo, grupo, linea, mes: p.mes, usuario_id: p.usuario_id ?? null, usuario_nombre: p.usuario_nombre,
      cantidad, obsequio: false,
    });
    const esCliente = !!p.cliente_id;
    documentos.set(`p-${p.id}`, {
      clave: `p-${p.id}`, tipo, mes: p.mes, fecha: p.fecha_txt,
      usuario_id: p.usuario_id ?? null, usuario_nombre: p.usuario_nombre,
      documento: `P-${p.numero ?? p.id}`,
      persona: esCliente ? (p.cliente_nombre || p.prestatario || 'Cliente')
        : (p.prestatario_nombre || p.prestatario || 'Compañero'),
      persona_extra: esCliente
        ? (p.cedula && !['COMPANERO', 'AJUSTE'].includes(p.cedula) ? `CC ${p.cedula}` : '')
        : (p.empleado_nombre ? `Recibió: ${p.empleado_nombre}` : ''),
      productos: [p.imei ? `${p.nombre_producto} (IMEI ${p.imei})`
        : `${p.nombre_producto}${cantidad > 1 ? ` × ${cantidad}` : ''}`],
      partes: [{ linea, peso: 1 }],
      estado_prestamo: p.estado,
      valor_prestamo: _num(p.valor_prestamo), total_abonado: _num(p.total_abonado),
    });
  }

  return { unidades, documentos: [...documentos.values()].map(plataDe) };
};

/** La plata de un documento según las reglas de arriba. */
const plataDe = (d) => {
  let valor = 0; let pagado = 0; let debe = 0; let activo = false; let saldado = false;
  if (d.tipo === 'contado') {
    if (!d.cancelado) { valor = d.valor_lineas; pagado = valor; saldado = valor > 0; }
  } else if (d.tipo === 'credito') {
    if (!d.cancelado) {
      if (d.credito_id) {
        valor  = d.valor_total;
        pagado = d.cuota_inicial + d.total_abonado;
        activo = d.credito_estado === 'Activo';
        saldado = d.credito_estado === 'Saldado';
        debe   = activo ? Math.max(0, valor - pagado) : 0;
      } else {
        // Factura marcada a crédito sin su fila de crédito: no hay abonos que
        // leer, así que se debe entera. No existe en producción (oct-2026).
        valor = d.valor_lineas; debe = valor; activo = valor > 0;
      }
    }
  } else if (d.estado_prestamo !== 'Devuelto') {
    valor  = d.valor_prestamo;
    pagado = d.total_abonado;
    activo = d.estado_prestamo !== 'Saldado';
    saldado = d.estado_prestamo === 'Saldado';
    debe   = activo ? Math.max(0, valor - pagado) : 0;
  }
  const cerrado_sin_pago = saldado ? Math.max(0, valor - pagado) : 0;
  return {
    ...d, valor: _round(valor), pagado: _round(pagado), debe: _round(debe),
    cerrado_sin_pago: _round(cerrado_sin_pago), activo, saldado,
  };
};

const CAMPOS_PLATA = ['valor', 'pagado', 'debe', 'cerrado_sin_pago'];

/**
 * Reparte la plata de un documento entre sus líneas de producto, en
 * proporción al peso de cada parte (el valor no devuelto). Las partes de la
 * misma línea se juntan, y la última se lleva el redondeo: la suma da EXACTO
 * lo del documento. Sin peso (todo devuelto u obsequio), a partes iguales.
 */
const repartirPorLinea = (d) => {
  const pesos = new Map();
  for (const p of d.partes || []) pesos.set(p.linea, (pesos.get(p.linea) || 0) + p.peso);
  const lineas = [...pesos.keys()];
  if (!lineas.length) return [];
  const totalPeso = [...pesos.values()].reduce((a, b) => a + b, 0);
  const restante = Object.fromEntries(CAMPOS_PLATA.map((k) => [k, d[k]]));
  return lineas.map((linea, i) => {
    const frac = totalPeso > 0 ? pesos.get(linea) / totalPeso : 1 / lineas.length;
    const parte = { linea };
    for (const k of CAMPOS_PLATA) {
      parte[k] = i === lineas.length - 1 ? _round(restante[k]) : _round(d[k] * frac);
      restante[k] -= parte[k];
    }
    return parte;
  });
};

// ─── Armar la sede ──────────────────────────────────────────────────────────

const _acumular = (unidades, documentos, claveDe) => {
  const mapa = new Map();
  const de = (k) => {
    if (!mapa.has(k)) mapa.set(k, nuevoTotal());
    return mapa.get(k);
  };
  for (const u of unidades) sumarUnidades(de(claveDe(u)), u.grupo, u.cantidad);
  for (const d of documentos) {
    const t = de(claveDe(d));
    t.documentos += 1;
    if (d.activo)  t.activos  += 1;
    if (d.saldado) t.saldados += 1;
    sumarPlata(t, d);
  }
  return mapa;
};

const _total = (lista) => {
  const t = nuevoTotal();
  for (const x of lista) {
    for (const k of Object.keys(t.unidades)) t.unidades[k] += x.unidades[k];
    t.documentos += x.documentos; t.activos += x.activos; t.saldados += x.saldados;
    sumarPlata(t, x);
  }
  return t;
};

const _ordenLineas = (a, b) => ((a.nombre === SIN_LINEA) - (b.nombre === SIN_LINEA))
  || (b.valor - a.valor) || (vigentes(b) - vigentes(a)) || a.nombre.localeCompare(b.nombre, 'es');

/**
 * Por línea de producto: unidades (de cada fila) y plata (repartida). Cada
 * línea trae además su desglose por tipo, que es lo que dice «de iPhone se
 * vendieron 12 de contado y se prestaron 30».
 */
const _porLinea = (unidades, documentos) => {
  const lineas = new Map();
  const de = (linea) => {
    if (!lineas.has(linea)) lineas.set(linea, { ...nuevoTotal(), tipos: new Map() });
    return lineas.get(linea);
  };
  const deTipo = (linea, tipo) => {
    const l = de(linea);
    if (!l.tipos.has(tipo)) l.tipos.set(tipo, nuevoTotal());
    return l.tipos.get(tipo);
  };
  for (const u of unidades) {
    sumarUnidades(de(u.linea), u.grupo, u.cantidad);
    sumarUnidades(deTipo(u.linea, u.tipo), u.grupo, u.cantidad);
  }
  for (const d of documentos) {
    for (const parte of repartirPorLinea(d)) {
      sumarPlata(de(parte.linea), parte);
      sumarPlata(deTipo(parte.linea, d.tipo), parte);
    }
  }
  return [...lineas.entries()]
    .map(([nombre, t]) => ({
      nombre, ...t,
      tipos: emp.TIPOS
        .filter((x) => t.tipos.has(x.id))
        .map((x) => ({ id: x.id, titulo: x.titulo, color: x.color, ...t.tipos.get(x.id) })),
    }))
    // La que más vendió arriba; «Sin línea» al final.
    .sort(_ordenLineas);
};

/**
 * Función PURA: de las filas crudas de UNA sede a su reporte.
 * `incluirPendientes` agrega la lista de lo que se debe, documento por
 * documento (lo único que hace largo el PDF).
 */
const armarSede = ({ lineas = [], prestamos = [], incluirPendientes = true }) => {
  const { unidades, documentos } = normalizar({ lineas, prestamos });

  const porTipo = _acumular(unidades, documentos, (x) => x.tipo);
  const tipos = emp.TIPOS.map((t) => ({ id: t.id, titulo: t.titulo, color: t.color, ...(porTipo.get(t.id) || nuevoTotal()) }));
  const total = _total(tipos);

  const porMes = _acumular(unidades, documentos, (x) => x.mes);
  const meses = [...porMes.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([mes, t]) => ({ mes, etiqueta: etiquetaMes(mes), ...t }));

  const nombres = new Map();
  for (const x of [...unidades, ...documentos]) {
    if (!nombres.has(x.usuario_id)) nombres.set(x.usuario_id, String(x.usuario_nombre || '').trim());
  }
  const porEmpleado = _acumular(unidades, documentos, (x) => x.usuario_id);
  const empleados = [...porEmpleado.entries()]
    .map(([id, t]) => ({
      usuario_id: id,
      nombre: nombres.get(id) || (id ? `Usuario #${id}` : 'Sin usuario registrado'),
      ...t,
    }))
    // Quien más movió arriba; sin usuario al final.
    .sort((a, b) => ((a.usuario_id == null) - (b.usuario_id == null))
      || (b.valor - a.valor) || a.nombre.localeCompare(b.nombre, 'es'));

  const pendientes = incluirPendientes
    ? emp.TIPOS.filter((t) => t.id !== 'contado').map((t) => {
      const docs = documentos
        .filter((d) => d.tipo === t.id && d.debe > 0)
        .sort((a, b) => b.debe - a.debe)
        .map((d) => ({
          documento: d.documento, fecha: d.fecha, persona: d.persona, persona_extra: d.persona_extra,
          productos: d.productos.join(' · '),
          empleado: nombres.get(d.usuario_id) || (d.usuario_id ? `Usuario #${d.usuario_id}` : '—'),
          valor: d.valor, pagado: d.pagado, debe: d.debe,
        }));
      return {
        id: t.id, titulo: t.titulo, color: t.color, documentos: docs,
        valor:  _round(docs.reduce((s, d) => s + d.valor, 0)),
        pagado: _round(docs.reduce((s, d) => s + d.pagado, 0)),
        debe:   _round(docs.reduce((s, d) => s + d.debe, 0)),
      };
    }).filter((g) => g.documentos.length > 0)
    : null;

  return {
    lineas: _porLinea(unidades, documentos),
    tipos, total, meses, empleados, pendientes, vacio: unidades.length === 0,
  };
};

/**
 * `sucursalId` null = todas las sedes del negocio (solo admin), una por hoja y
 * con un consolidado al principio. El rango se valida con la misma función
 * del reporte por empleado.
 */
const obtenerReporteSede = async ({ negocioId, sucursalId, usuario, desde, hasta, incluirPendientes = true }) => {
  emp.validarRango(desde, hasta);
  if (usuario.rol === 'vendedor') {
    throw { status: 403, message: 'El reporte por sede es para administradores y supervisores' };
  }
  // Un supervisor solo ve la suya, pida lo que pida.
  const todas = usuario.rol === 'admin_negocio' && sucursalId == null;
  // Sin sede y sin ser admin no es «todas»: es un error, nunca el negocio entero.
  if (!todas && sucursalId == null) throw { status: 400, message: 'Indica la sucursal' };
  const { rows: sedes } = await pool.query(`
    SELECT id, nombre FROM sucursales
     WHERE negocio_id = $1 AND activa = true AND ($2::int IS NULL OR id = $2)
     ORDER BY id
  `, [negocioId, todas ? null : sucursalId]);
  if (!sedes.length) throw { status: 404, message: 'Sucursal no encontrada' };

  // Una sede a la vez: cada una ya son dos consultas grandes en Cellsite y la
  // base es compartida con todos los negocios.
  const resultado = [];
  for (const s of sedes) {
    const filtros = { sucursalId: s.id, desde, hasta, usuarioId: null, soloEquipos: false };
    const [lineas, prestamos] = await Promise.all([emp.consultarLineas(filtros), emp.consultarPrestamos(filtros)]);
    resultado.push({ sucursal_id: s.id, nombre: s.nombre, ...armarSede({ lineas, prestamos, incluirPendientes }) });
  }

  // Con varias sedes, el consolidado del negocio, también por línea: la misma
  // línea en dos sedes se suma (es el mismo nombre en el inventario).
  let consolidado = null;
  let lineasConsolidadas = null;
  if (todas) {
    consolidado = _total(resultado.map((s) => s.total));
    const mapa = new Map();
    for (const s of resultado) {
      for (const l of s.lineas) {
        if (!mapa.has(l.nombre)) mapa.set(l.nombre, []);
        mapa.get(l.nombre).push(l);
      }
    }
    lineasConsolidadas = [...mapa.entries()]
      .map(([nombre, ls]) => ({ nombre, ..._total(ls) }))
      .sort(_ordenLineas);
  }

  return {
    desde, hasta, todas,
    incluye_pendientes: !!incluirPendientes,
    sedes: resultado,
    consolidado,
    lineas_consolidadas: lineasConsolidadas,
  };
};

module.exports = {
  SIN_LINEA, lineaDe, etiquetaMes, vigentes, nuevoTotal,
  normalizar, plataDe, repartirPorLinea, armarSede, obtenerReporteSede,
};
