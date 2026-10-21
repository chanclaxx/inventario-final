// ─────────────────────────────────────────────────────────────────────────────
// Centro de gastos — reglas.
//
// Un gasto es lo que cuesta OPERAR, nunca mercancía (las compras son costo de
// lo vendido y viven en Proveedores). Se agrupa por MES CONTABLE. Nada se
// borra: se anula con motivo. Proyección lee de aquí (`estimadoMensual`) y el
// estado de resultados toma la utilidad bruta de Reportes → Ventas, sin
// calcularla de nuevo.
// ─────────────────────────────────────────────────────────────────────────────
const repo = require('./gastos.repository');
const util = require('./gastos.util');
const { hayGastos } = require('../../config/columnas');
const { puedeVerReportesCompletos } = require('../../middlewares/role.middleware');

const err = (status, message, code) => ({ status, message, code });

const _texto = (v, max = 200) => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
};
const _textoLargo = (v, max = 1000) => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
};

// ── Catálogo: categorías por defecto + conversión de los gastos fijos ──────
//
// Corre al entrar (resumen, categorías) y desde Proyección. Es idempotente:
// las categorías llevan índice único por nombre y cada gasto fijo viejo se
// convierte UNA vez (`origen_gasto_fijo_id` único). El caché solo ahorra las
// dos consultas de comprobación en las cargas seguidas.
const _asegurados = new Map();
const TTL_CATALOGO = 60 * 1000;

const asegurarCatalogo = async (negocioId) => {
  const hit = _asegurados.get(Number(negocioId));
  if (hit && hit > Date.now()) return;

  if (await repo.contarCategorias(negocioId) === 0) {
    let orden = 0;
    for (const c of util.CATEGORIAS_DEFECTO) {
      await repo.insertarCategoriaSiNoExiste(negocioId, c, orden++);
    }
  }

  if (await repo.existeTablaGastosFijos()) {
    const pendientes = await repo.gastosFijosSinConvertir(negocioId);
    if (pendientes.length) {
      const cats = await repo.listarCategorias(negocioId);
      const porNombre = new Map(cats.map((c) => [c.nombre.toLowerCase(), c]));
      for (const gf of pendientes) {
        const elegida = porNombre.get(util.categoriaPorNombre(gf.nombre).toLowerCase())
          || porNombre.get('otros') || cats[0];
        if (!elegida) continue; // el negocio apagó todas sus categorías: se intenta la próxima vez
        await repo.insertarRecurrente(negocioId, {
          sucursal_id: gf.sucursal_id, categoria_id: elegida.id, nombre: gf.nombre,
          valor: Number(gf.valor), tipo: 'fijo', origen_gasto_fijo_id: gf.id,
        });
      }
    }
  }
  _asegurados.set(Number(negocioId), Date.now() + TTL_CATALOGO);
};

const _olvidarCatalogo = (negocioId) => _asegurados.delete(Number(negocioId));

// ── ¿Está encendido? ────────────────────────────────────────────────────────
const estaActivo = async (negocioId) => hayGastos() && repo.configActivo(negocioId);

const permisosDe = (user, { puedeRegistrar }) => ({
  puede_registrar:   puedeRegistrar,
  puede_administrar: user?.rol === 'admin_negocio',
  ve_resultados:     puedeVerReportesCompletos(user),
});

const _exigirDuenoOAdmin = (user, gasto) => {
  if (user?.rol === 'admin_negocio') return;
  if (Number(gasto.usuario_id) === Number(user?.id)) return;
  throw err(403, 'Solo el administrador o quien registró este gasto puede cambiarlo', 'GASTO_AJENO');
};

// ── Categorías ──────────────────────────────────────────────────────────────
const _normalizarCategoria = (d, actual = {}) => {
  const nombre = _texto(d.nombre ?? actual.nombre, 60);
  if (!nombre) throw err(400, 'La categoría necesita un nombre', 'CATEGORIA_SIN_NOMBRE');
  const tipo = d.tipo ?? actual.tipo ?? 'variable';
  if (!util.TIPOS.includes(tipo)) throw err(400, 'El tipo debe ser fijo o variable', 'TIPO_INVALIDO');
  const color = d.color !== undefined ? _texto(d.color, 20) : (actual.color ?? null);
  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) throw err(400, 'Color inválido', 'COLOR_INVALIDO');
  return {
    nombre, tipo, color,
    icono: d.icono !== undefined ? _texto(d.icono, 30) : (actual.icono ?? null),
    activa: d.activa !== undefined ? d.activa !== false : (actual.activa ?? true),
  };
};

const _choqueNombre = (e) => {
  if (e?.code === '23505') throw err(409, 'Ya existe una categoría con ese nombre', 'CATEGORIA_DUPLICADA');
  throw e;
};

const listarCategorias = async (negocioId, { incluirInactivas = false } = {}) => {
  await asegurarCatalogo(negocioId);
  return repo.listarCategorias(negocioId, { incluirInactivas });
};

const crearCategoria = async (negocioId, datos) => {
  await asegurarCatalogo(negocioId);
  try { return await repo.crearCategoria(negocioId, _normalizarCategoria(datos)); }
  catch (e) { return _choqueNombre(e); }
};

const actualizarCategoria = async (negocioId, id, datos) => {
  const actual = await repo.findCategoria(negocioId, id);
  if (!actual) throw err(404, 'Categoría no encontrada', 'CATEGORIA_NO_EXISTE');
  try { return await repo.actualizarCategoria(negocioId, id, _normalizarCategoria(datos, actual)); }
  catch (e) { return _choqueNombre(e); }
};

const _categoriaActiva = async (negocioId, id) => {
  const c = await repo.findCategoria(negocioId, Number(id));
  if (!c || !c.activa) throw err(400, 'Elige una categoría válida', 'CATEGORIA_NO_EXISTE');
  return c;
};

// ── Recurrentes (los gastos que llegan cada mes) ────────────────────────────
const _normalizarRecurrente = async (negocioId, d, actual = {}) => {
  const nombre = _texto(d.nombre ?? actual.nombre, 80);
  if (!nombre) throw err(400, 'El gasto fijo necesita un nombre', 'RECURRENTE_SIN_NOMBRE');
  const cat = await _categoriaActiva(negocioId, d.categoria_id ?? actual.categoria_id);
  const valor = Number(d.valor ?? actual.valor);
  if (!Number.isFinite(valor) || valor < 0) throw err(400, 'El valor no es válido', 'GASTO_NUMERO_INVALIDO');
  const tipo = d.tipo ?? actual.tipo ?? 'fijo';
  if (!util.TIPOS.includes(tipo)) throw err(400, 'El tipo debe ser fijo o variable', 'TIPO_INVALIDO');
  const diaRaw = d.dia_pago !== undefined ? d.dia_pago : actual.dia_pago;
  const dia = diaRaw === null || diaRaw === '' || diaRaw === undefined ? null : Number(diaRaw);
  if (dia !== null && (!Number.isInteger(dia) || dia < 1 || dia > 31)) {
    throw err(400, 'El día de pago va de 1 a 31', 'DIA_INVALIDO');
  }
  return {
    nombre, categoria_id: cat.id, valor, tipo, dia_pago: dia,
    tercero:    d.tercero    !== undefined ? _texto(d.tercero, 120)  : (actual.tercero ?? null),
    medio_pago: d.medio_pago !== undefined ? _texto(d.medio_pago, 40) : (actual.medio_pago ?? null),
    activo:     d.activo     !== undefined ? d.activo !== false        : (actual.activo ?? true),
  };
};

const listarRecurrentes = async (ctx, { incluirInactivos = false } = {}) => {
  await asegurarCatalogo(ctx.negocioId);
  return repo.listarRecurrentes(ctx.negocioId, ctx.sucursalId, { incluirInactivos });
};

const crearRecurrente = async (ctx, datos) => {
  await asegurarCatalogo(ctx.negocioId);
  const r = await _normalizarRecurrente(ctx.negocioId, datos);
  const id = await repo.insertarRecurrente(ctx.negocioId, { ...r, sucursal_id: ctx.sucursalId });
  return repo.findRecurrente(ctx.negocioId, id);
};

const actualizarRecurrente = async (ctx, id, datos) => {
  const actual = await repo.findRecurrente(ctx.negocioId, id);
  if (!actual || actual.sucursal_id !== ctx.sucursalId) throw err(404, 'Gasto fijo no encontrado', 'RECURRENTE_NO_EXISTE');
  const r = await _normalizarRecurrente(ctx.negocioId, datos, actual);
  await repo.actualizarRecurrente(ctx.negocioId, id, r);
  return repo.findRecurrente(ctx.negocioId, id);
};

// ── Gastos ──────────────────────────────────────────────────────────────────
const _armarGasto = async (negocioId, d) => {
  const cat = await _categoriaActiva(negocioId, d.categoria_id);
  const fecha = d.fecha ? String(d.fecha) : util.hoyBogota();
  if (!util.esFechaValida(fecha)) throw err(400, 'La fecha no es válida', 'FECHA_INVALIDA');
  const mes = util.mesContableDe(d.mes_contable || fecha);
  if (!mes) throw err(400, 'El mes contable no es válido', 'MES_INVALIDO');
  const tipo = d.tipo && util.TIPOS.includes(d.tipo) ? d.tipo : cat.tipo;
  return {
    categoria_id: cat.id, tipo, fecha, mes_contable: mes,
    ...util.calcularValores(d),
    nombre:         _texto(d.nombre, 120),
    descripcion:    _textoLargo(d.descripcion, 500),
    tercero:        _texto(d.tercero, 120),
    numero_soporte: _texto(d.numero_soporte, 60),
    unidad:         _texto(d.unidad, 30),
    medio_pago:     _texto(d.medio_pago, 40),
    observaciones:  _textoLargo(d.observaciones, 1000),
  };
};

const registrarGasto = async (ctx, datos) => {
  await asegurarCatalogo(ctx.negocioId);
  const clave = _texto(datos.clave_idempotencia, 80);
  if (clave) {
    const previo = await repo.findGastoPorClave(ctx.negocioId, clave);
    if (previo) return repo.findGasto(ctx.negocioId, previo);
  }
  const g = await _armarGasto(ctx.negocioId, datos);
  try {
    const id = await repo.insertarGasto(ctx, { ...g, clave_idempotencia: clave });
    return repo.findGasto(ctx.negocioId, id);
  } catch (e) {
    // Dos clics a la vez con la misma clave: gana el primero y se devuelve ese.
    if (e?.code === '23505' && clave) {
      const previo = await repo.findGastoPorClave(ctx.negocioId, clave);
      if (previo) return repo.findGasto(ctx.negocioId, previo);
    }
    throw e;
  }
};

const _gastoDeLaSede = async (ctx, id) => {
  const g = await repo.findGasto(ctx.negocioId, Number(id));
  if (!g || g.sucursal_id !== ctx.sucursalId) throw err(404, 'Gasto no encontrado', 'GASTO_NO_EXISTE');
  return g;
};

// Editar reemplaza los campos editables con lo que llega (la pantalla manda el
// formulario completo). Un gasto que salió de un recurrente sigue ligado a él.
const editarGasto = async (ctx, user, id, datos) => {
  const actual = await _gastoDeLaSede(ctx, id);
  _exigirDuenoOAdmin(user, actual);
  if (actual.anulado) throw err(409, 'Este gasto está anulado', 'GASTO_ANULADO');
  const g = await _armarGasto(ctx.negocioId, { ...datos, categoria_id: datos.categoria_id ?? actual.categoria_id });
  try {
    await repo.actualizarGasto(ctx.negocioId, actual.id, g);
  } catch (e) {
    if (e?.code === '23505') {
      throw err(409, 'Ese gasto fijo ya está registrado en ese mes', 'RECURRENTE_YA_PAGADO');
    }
    throw e;
  }
  return repo.findGasto(ctx.negocioId, actual.id);
};

const anularGasto = async (ctx, user, id, motivo) => {
  const actual = await _gastoDeLaSede(ctx, id);
  _exigirDuenoOAdmin(user, actual);
  const m = _texto(motivo, 300);
  if (!m || m.length < 3) throw err(400, 'Escribe por qué se anula', 'MOTIVO_REQUERIDO');
  const ok = await repo.anularGasto(ctx.negocioId, actual.id, m, ctx.usuarioId);
  if (!ok) throw err(409, 'Este gasto ya estaba anulado', 'GASTO_ANULADO');
  return repo.findGasto(ctx.negocioId, actual.id);
};

// Confirmar el pago de un recurrente en un mes: crea su gasto. Una vez por
// mes (índice único); anularlo lo vuelve a dejar pendiente.
const confirmarRecurrente = async (ctx, id, datos = {}) => {
  await asegurarCatalogo(ctx.negocioId);
  const r = await repo.findRecurrente(ctx.negocioId, Number(id));
  if (!r || r.sucursal_id !== ctx.sucursalId || !r.activo) {
    throw err(404, 'Gasto fijo no encontrado', 'RECURRENTE_NO_EXISTE');
  }
  const hoy = util.hoyBogota();
  const mes = util.mesContableDe(datos.mes || hoy);
  if (!mes) throw err(400, 'El mes no es válido', 'MES_INVALIDO');

  // La fecha por defecto: hoy si hoy cae en ese mes; si el mes ya pasó, el día
  // en que vencía (o el último del mes); si es un mes que viene, el día 1.
  let fecha = datos.fecha;
  if (!fecha) {
    if (hoy.slice(0, 7) === mes.slice(0, 7)) fecha = hoy;
    else if (mes < `${hoy.slice(0, 7)}-01`) fecha = util.estadoRecurrente(r, mes, hoy).vence || util.ultimoDia(mes);
    else fecha = mes;
  }

  const clave = _texto(datos.clave_idempotencia, 80);
  if (clave) {
    const previo = await repo.findGastoPorClave(ctx.negocioId, clave);
    if (previo) return repo.findGasto(ctx.negocioId, previo);
  }
  const g = await _armarGasto(ctx.negocioId, {
    categoria_id: r.categoria_id, tipo: r.tipo, fecha, mes_contable: mes.slice(0, 7),
    valor_total: datos.valor !== undefined && datos.valor !== '' ? datos.valor : r.valor,
    nombre: r.nombre, tercero: r.tercero,
    medio_pago: datos.medio_pago || r.medio_pago,
    observaciones: datos.observaciones,
  });
  try {
    const gid = await repo.insertarGasto(ctx, { ...g, recurrente_id: r.id, clave_idempotencia: clave });
    return repo.findGasto(ctx.negocioId, gid);
  } catch (e) {
    if (e?.code === '23505') {
      if (clave) {
        const previo = await repo.findGastoPorClave(ctx.negocioId, clave);
        if (previo) return repo.findGasto(ctx.negocioId, previo);
      }
      throw err(409, `«${r.nombre}» ya está registrado en ese mes`, 'RECURRENTE_YA_PAGADO');
    }
    throw e;
  }
};

const listarGastos = async (ctx, mes, { incluirAnulados = false } = {}) => {
  const mes01 = util.mesContableDe(mes || util.hoyBogota());
  if (!mes01) throw err(400, 'El mes no es válido', 'MES_INVALIDO');
  return repo.listarGastosMes(ctx.negocioId, ctx.sucursalId, mes01, { incluirAnulados });
};

// ── El resumen del mes: todo lo que pinta la pestaña, en una petición ──────
const MESES_SERIE = 6;
const MESES_PROMEDIO = 3;

const resumenMes = async (ctx, user, mes, { puedeRegistrar }) => {
  await asegurarCatalogo(ctx.negocioId);
  const hoy = util.hoyBogota();
  const mes01 = util.mesContableDe(mes || hoy);
  if (!mes01) throw err(400, 'El mes no es válido', 'MES_INVALIDO');
  const desde01 = util.sumarMeses(mes01, -(MESES_SERIE - 1));

  const [porMes, porCat, categorias, recurrentes, pagados, usos] = await Promise.all([
    repo.totalesPorMes(ctx.negocioId, ctx.sucursalId, desde01, mes01),
    repo.totalesPorCategoria(ctx.negocioId, ctx.sucursalId, desde01, mes01),
    repo.listarCategorias(ctx.negocioId, { incluirInactivas: true }),
    repo.listarRecurrentes(ctx.negocioId, ctx.sucursalId),
    repo.recurrentesPagadosMes(ctx.negocioId, ctx.sucursalId, mes01),
    repo.usoCategorias(ctx.negocioId, ctx.sucursalId),
  ]);

  // Serie de 6 meses, con los vacíos en cero.
  const mapaMes = new Map(porMes.map((m) => [m.mes, m]));
  const serie = [];
  for (let i = 0; i < MESES_SERIE; i++) {
    const m = util.sumarMeses(desde01, i).slice(0, 7);
    const f = mapaMes.get(m);
    serie.push({ mes: m, fijos: f?.fijos ?? 0, variables: f?.variables ?? 0,
      total: (f?.fijos ?? 0) + (f?.variables ?? 0), cantidad: f?.cantidad ?? 0 });
  }
  const actual = serie[serie.length - 1];

  // El promedio de referencia: los meses ANTERIORES (hasta 3) en que se
  // registró algo. Un mes sin un solo gasto no es «gasté 0», es «no anoté».
  const previos = serie.slice(-1 - MESES_PROMEDIO, -1).filter((m) => m.cantidad > 0);
  const promedio = previos.length ? previos.reduce((s, m) => s + m.total, 0) / previos.length : null;
  const variacion = (valor, prom) => (prom && prom > 0 ? Math.round(((valor - prom) / prom) * 100) : null);

  // Por categoría: lo del mes, el promedio en esos mismos meses previos, y lo
  // que se espera de los recurrentes (el «presupuesto»).
  const mesesPrevios = new Set(previos.map((m) => m.mes));
  const presupuesto = new Map();
  for (const r of recurrentes) presupuesto.set(r.categoria_id, (presupuesto.get(r.categoria_id) || 0) + r.valor);
  const usosPor = new Map(usos.map((u) => [u.categoria_id, u.usos]));

  const porCategoria = categorias.map((c) => {
    const filas = porCat.filter((f) => f.categoria_id === c.id);
    const delMes = filas.find((f) => f.mes === actual.mes);
    const prevTotal = filas.filter((f) => mesesPrevios.has(f.mes)).reduce((s, f) => s + f.total, 0);
    const prom = previos.length ? prevTotal / previos.length : null;
    const total = delMes?.total ?? 0;
    return {
      categoria_id: c.id, nombre: c.nombre, tipo: c.tipo, color: c.color, icono: c.icono, activa: c.activa,
      total, cantidad: delMes?.cantidad ?? 0,
      promedio: prom, variacion_pct: total > 0 || prom ? variacion(total, prom) : null,
      presupuesto: presupuesto.get(c.id) ?? null,
    };
  }).filter((c) => c.total > 0 || c.presupuesto)
    .sort((a, b) => b.total - a.total);

  // Pendientes del mes: cada recurrente activo, pagado o no.
  const pagadoDe = new Map(pagados.map((p) => [p.recurrente_id, p]));
  const pendientes = recurrentes.map((r) => {
    const pago = pagadoDe.get(r.id);
    const est = util.estadoRecurrente({ dia_pago: r.dia_pago, pagado: !!pago }, mes01, hoy);
    return {
      recurrente_id: r.id, nombre: r.nombre, valor: r.valor, tipo: r.tipo, dia_pago: r.dia_pago,
      categoria_id: r.categoria_id, categoria_nombre: r.categoria_nombre,
      categoria_color: r.categoria_color, categoria_icono: r.categoria_icono,
      tercero: r.tercero, medio_pago: r.medio_pago,
      ...est, gasto_id: pago?.gasto_id ?? null, valor_pagado: pago?.valor_total ?? null,
    };
  });
  const ordenEstado = { vencido: 0, por_vencer: 1, pendiente: 2, pagado: 3 };
  pendientes.sort((a, b) => (ordenEstado[a.estado] - ordenEstado[b.estado])
    || String(a.vence || '9').localeCompare(String(b.vence || '9')));

  return {
    mes: actual.mes,
    es_mes_actual: actual.mes === hoy.slice(0, 7),
    total: actual.total, fijos: actual.fijos, variables: actual.variables, cantidad: actual.cantidad,
    promedio, variacion_pct: variacion(actual.total, promedio), meses_promedio: previos.length,
    por_categoria: porCategoria,
    pendientes,
    recurrentes_resumen: {
      total: pendientes.length,
      pagados: pendientes.filter((p) => p.estado === 'pagado').length,
      valor_esperado: pendientes.reduce((s, p) => s + p.valor, 0),
      valor_pagado: pendientes.reduce((s, p) => s + (p.valor_pagado || 0), 0),
    },
    serie,
    categorias: categorias.filter((c) => c.activa)
      .map((c) => ({ ...c, usos: usosPor.get(c.id) || 0 })),
    permisos: permisosDe(user, { puedeRegistrar }),
  };
};

// ── Estado de resultados del mes ────────────────────────────────────────────
const estadoResultados = async (ctx, mes) => {
  const hoy = util.hoyBogota();
  const mes01 = util.mesContableDe(mes || hoy);
  if (!mes01) throw err(400, 'El mes no es válido', 'MES_INVALIDO');
  if (mes01 > `${hoy.slice(0, 7)}-01`) throw err(400, 'Ese mes todavía no empieza', 'MES_FUTURO');
  const fin = util.ultimoDia(mes01);
  const hasta = fin < hoy ? fin : hoy;
  // Import perezoso: reportes.service también requiere este módulo (Proyección).
  const reportes = require('../reportes/reportes.service');
  const [ventasRango, [delMes]] = await Promise.all([
    reportes.getVentasRango(ctx.sucursalId, mes01, hasta),
    repo.totalesPorMes(ctx.negocioId, ctx.sucursalId, mes01, mes01),
  ]);
  return {
    mes: mes01.slice(0, 7), desde: mes01, hasta, parcial: hasta < fin,
    ...util.armarEstadoResultados({ ventasRango, gastos: delMes || { fijos: 0, variables: 0 } }),
  };
};

// ── Para Proyección ─────────────────────────────────────────────────────────
//
// Lo que se espera gastar en un mes = los recurrentes activos de la sede (lo
// que se sabe que llega) + el promedio de los demás gastos —los que no salen
// de una plantilla— en los meses de la ventana en que se registró algo.
// Apagado o sin tablas: `activo: false` y cero, y Proyección no resta nada.
const estimadoMensual = async (sucursalId, desde, hasta) => {
  const negocioId = await repo.negocioDeSucursal(sucursalId);
  if (!negocioId || !(await estaActivo(negocioId))) {
    return { activo: false, lista: [], total: 0, plantillas_total: 0, otros_promedio: 0, meses_otros: 0 };
  }
  await asegurarCatalogo(negocioId);
  const recurrentes = await repo.listarRecurrentes(negocioId, sucursalId);
  const lista = recurrentes.map((r) => ({ id: r.id, nombre: r.nombre, valor: r.valor }));
  const plantillas = lista.reduce((s, r) => s + r.valor, 0);

  let otros = 0;
  let meses = 0;
  const d01 = util.mesContableDe(desde);
  const h01 = util.mesContableDe(hasta);
  if (d01 && h01 && d01 <= h01) {
    const filas = (await repo.totalesPorMes(negocioId, sucursalId, d01, h01, { soloSinPlantilla: true }))
      .filter((f) => f.cantidad > 0);
    meses = filas.length;
    otros = meses ? filas.reduce((s, f) => s + f.fijos + f.variables, 0) / meses : 0;
  }
  if (otros > 0) {
    lista.push({ id: 'otros', nombre: `Otros gastos (promedio de ${meses} mes${meses === 1 ? '' : 'es'})`, valor: otros });
  }
  return { activo: true, lista, total: plantillas + otros, plantillas_total: plantillas, otros_promedio: otros, meses_otros: meses };
};

// ── Para Análisis: los gastos de un rango de días ───────────────────────────
// Cada mes contable aporta su total en proporción a los días del rango que
// caen en él (un rango del 15 al 31 de octubre se lleva medio octubre).
const totalPeriodo = async (ctx, desde, hasta) => {
  if (!util.esFechaValida(desde) || !util.esFechaValida(hasta) || desde > hasta) {
    throw err(400, 'Rango de fechas inválido', 'RANGO_INVALIDO');
  }
  const d01 = util.mesContableDe(desde);
  const h01 = util.mesContableDe(hasta);
  const filas = await repo.totalesPorMes(ctx.negocioId, ctx.sucursalId, d01, h01);
  const porMes = new Map(filas.map((f) => [f.mes, f.fijos + f.variables]));
  let total = 0;
  const meses = [];
  for (let m = d01; m <= h01; m = util.sumarMeses(m, 1)) {
    const ini = m < desde ? desde : m;
    const finMes = util.ultimoDia(m);
    const fin = finMes > hasta ? hasta : finMes;
    const fraccion = (util.diasEntre(ini, fin) + 1) / util.diasDelMes(m);
    const delMes = porMes.get(m.slice(0, 7)) || 0;
    total += delMes * fraccion;
    meses.push({ mes: m.slice(0, 7), total_mes: delMes, fraccion });
  }
  return { total: Math.round(total), meses };
};

module.exports = {
  asegurarCatalogo, _olvidarCatalogo, estaActivo, permisosDe,
  listarCategorias, crearCategoria, actualizarCategoria,
  listarRecurrentes, crearRecurrente, actualizarRecurrente, confirmarRecurrente,
  registrarGasto, editarGasto, anularGasto, listarGastos,
  resumenMes, estadoResultados, estimadoMensual, totalPeriodo,
};
