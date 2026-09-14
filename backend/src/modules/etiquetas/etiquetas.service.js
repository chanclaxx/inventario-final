const { pool }   = require('../../config/db');
const repo       = require('./etiquetas.repository');
const formatos   = require('./etiquetas.formatos');
const layout     = require('./etiquetas.layout');
const configRepo = require('../config/config.repository');
const codigoAuto = require('../../utils/codigoAuto.util');

// Tope de etiquetas por PDF. No es un límite de negocio: por encima de esto el
// archivo pesa decenas de MB, el navegador que lo abre se atasca y la impresora
// térmica —que lee el PDF con muy poca memoria— lo rechaza. Una bodega de
// verdad imprime por estante o por línea, no el inventario entero de un tirón.
const MAX_ETIQUETAS = 3000;

// Tope de códigos por llamada. El motor resuelve la tanda entera en un puñado
// de consultas, pero la transacción bloquea el contador del negocio mientras
// dura —y con él el alta de productos en todas las sedes—, y axios corta a los
// 30 s. El frontend llama por tandas de 200 y muestra el avance.
const MAX_CODIGOS_POR_TANDA = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Selección
// ─────────────────────────────────────────────────────────────────────────────

const NIVELES = { producto: 'producto_id', atributo: 'atributo_id', variante: 'variante_id' };

/** Limpia la selección que llega del cliente y la deja en la forma del repo. */
const _sanearSeleccion = (raw) => {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set();
  const out = [];
  for (const s of raw) {
    const campo = NIVELES[s?.nivel];
    if (!campo) continue;
    const id = Number(s[campo]);
    if (!Number.isInteger(id) || id <= 0) continue;
    const clave = `${s.nivel}:${id}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({ nivel: s.nivel, [campo]: id, cantidad: s.cantidad });
  }
  return out;
};

/**
 * Selección → lista EXPANDIDA de etiquetas físicas (una entrada por etiqueta).
 *
 * Tres modos de cantidad, y los tres se usan de verdad:
 *   · `uno`    → una etiqueta por producto. Es la etiqueta de estante.
 *   · `stock`  → una por unidad existente. Es la que se pega en la mercancía
 *                al recibir un pedido, y es la razón de ser de la impresión
 *                masiva: nadie va a escribir "37" a mano 400 veces.
 *   · `manual` → la cantidad que mandó la pantalla, nodo por nodo.
 *
 * Los nodos SIN CÓDIGO no se expanden: no hay nada que imprimir en ellos. Se
 * devuelven aparte para que la pantalla ofrezca generárselos en vez de sacar un
 * PDF con huecos que nadie nota hasta tener las etiquetas pegadas.
 */
const _expandir = (nodos, seleccion, modo) => {
  const cantidadDe = new Map(seleccion.map((s) => [`${s.nivel}:${s[NIVELES[s.nivel]]}`, s.cantidad]));

  const etiquetas = [];
  const sinCodigo = [];
  let recortado = false;

  for (const n of nodos) {
    if (!n.codigo || !String(n.codigo).trim()) { sinCodigo.push(n); continue; }

    let cant;
    if (modo === 'stock')       cant = Math.floor(Number(n.stock) || 0);
    else if (modo === 'manual') cant = Math.floor(Number(cantidadDe.get(`${n.nivel}:${n[NIVELES[n.nivel]]}`)) || 1);
    else                        cant = 1;

    cant = Math.max(0, Math.min(cant, MAX_ETIQUETAS));
    for (let k = 0; k < cant; k += 1) {
      if (etiquetas.length >= MAX_ETIQUETAS) { recortado = true; break; }
      etiquetas.push(n);
    }
    if (recortado) break;
  }

  return { etiquetas, sinCodigo, recortado };
};

/** Encabezado opcional de la etiqueta: el nombre del negocio, o el de la sede. */
const _encabezado = (ctx, op) => {
  if (!op?.mostrar?.encabezado) return null;
  if (op.encabezadoTexto && String(op.encabezadoTexto).trim()) return String(op.encabezadoTexto).trim().slice(0, 60);
  return ctx?.negocio_nombre || ctx?.sucursal_nombre || null;
};

/** Número dentro de un rango, o null si no vino. Lo que no se entiende no se aplica. */
const _enRango = (v, min, max) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

// Resoluciones que se aceptan. No es una lista cerrada de modelos: son las
// tres densidades que existen en impresoras de etiquetas y recibos (8, 12 y 24
// puntos por milímetro), más los rangos de las de oficina.
const DPI = { min: 100, max: 1200 };

/**
 * La petición → opciones saneadas. Todo campo nuevo es OPCIONAL y su ausencia
 * se comporta como siempre: un navegador con el bundle viejo en caché sigue
 * mandando `{ simbologia, mostrar, marco, ajuste, desde }` y recibe el mismo
 * PDF de antes.
 */
const _opciones = (body, ctx) => {
  const mostrar = body.mostrar || {};
  const d   = body.diseno || {};
  const imp = body.impresora || {};
  const D   = layout.DISENO;
  const A   = layout.AJUSTE_MAX;

  const dpi = _enRango(imp.dpi ?? body.dpi, DPI.min, DPI.max);
  const op = {
    simbologia: body.simbologia === 'qr' ? 'qr' : 'barras',
    mostrar: {
      nombre:     mostrar.nombre     !== false,
      variante:   mostrar.variante   !== false,
      precio:     mostrar.precio     === true,
      encabezado: mostrar.encabezado === true,
      pie:        mostrar.pie        === true,
    },
    diseno: {
      alinear:        d.alinear === 'izquierda' ? 'izquierda' : 'centro',
      escalaTexto:    _enRango(d.escalaTexto, D.escalaTexto.min, D.escalaTexto.max) ?? D.escalaTexto.defecto,
      lineasNombre:   Math.round(_enRango(d.lineasNombre, D.lineasNombre.min, D.lineasNombre.max) ?? D.lineasNombre.defecto),
      margenInterior: _enRango(d.margenInterior, D.margenInterior.min, D.margenInterior.max),
      altoSimbolo:    _enRango(d.altoSimbolo, D.altoSimbolo.min, D.altoSimbolo.max),
    },
    marco:  body.marco === true,
    desde:  Math.max(1, Math.floor(Number(body.desde) || 1)),
    ajuste: { x: _enRango(body.ajuste?.x, -A, A) ?? 0, y: _enRango(body.ajuste?.y, -A, A) ?? 0 },
    impresora: {
      rotacion: layout.ROTACIONES.includes(Number(imp.rotacion)) ? Number(imp.rotacion) : 0,
      escala:   _enRango(imp.escala, layout.ESCALA.min, layout.ESCALA.max) ?? 100,
      dpi:      dpi === null ? null : Math.round(dpi),
    },
  };
  op.dpi = op.impresora.dpi;
  op.encabezado = _encabezado(ctx, { ...op, encabezadoTexto: body.encabezadoTexto });
  op.pie = op.mostrar.pie ? String(body.pieTexto ?? '').trim().slice(0, 60) : '';
  return op;
};

/** Formato, contexto y opciones: lo que necesitan TODAS las salidas, incluida la hoja de prueba. */
const _base = async (negocioId, sucursalId, body) => {
  const formato = formatos.resolver(body.formato, body.personalizado);
  const ctx     = await repo.contextoImpresion(negocioId, sucursalId);
  if (!ctx) throw { status: 403, message: 'Sucursal no válida para este negocio' };
  return { formato, ctx, op: _opciones(body, ctx) };
};

/** Resuelve todo lo que comparten la vista previa y el PDF. */
const _preparar = async (negocioId, sucursalId, body) => {
  const seleccion = _sanearSeleccion(body.seleccion);
  const { formato, ctx, op } = await _base(negocioId, sucursalId, body);

  const nodos = await repo.nodosPorSeleccion(negocioId, sucursalId, seleccion);
  const { etiquetas, sinCodigo, recortado } = _expandir(nodos, seleccion, body.cantidadModo);

  return { formato, op, nodos, etiquetas, sinCodigo, recortado, ctx };
};

// ─────────────────────────────────────────────────────────────────────────────
// API del módulo
// ─────────────────────────────────────────────────────────────────────────────

// `/formatos` sigue devolviendo el ARREGLO de siempre: Vercel y Railway se
// despliegan por separado, y un frontend viejo contra este backend tiene que
// seguir pintando su selector. Lo nuevo (papeles, topes) va en `/catalogo`.
const listarFormatos = () => formatos.FORMATOS;
const catalogo = () => formatos.catalogo();

const listar = async (negocioId, sucursalId, filtros) => {
  const nodos = await repo.listarNodos(negocioId, sucursalId, filtros);
  return {
    nodos,
    resumen: {
      total:     nodos.length,
      conCodigo: nodos.filter((n) => n.codigo && String(n.codigo).trim()).length,
      unidades:  nodos.reduce((s, n) => s + Math.max(0, Math.floor(Number(n.stock) || 0)), 0),
    },
  };
};

/**
 * Vista previa: qué va a salir, cuántas hojas, cómo es la retícula y qué puede
 * salir mal.
 *
 * Corre el MISMO `layout.planear` que el PDF —no una estimación— sobre el
 * código más largo de la selección, que es el caso peor: es el que da la barra
 * más estrecha y el que primero deja de escanear. Un aviso aquí le ahorra al
 * usuario la plancha entera.
 *
 * Responde también SIN selección: el editor de formato necesita la geometría
 * (y los errores de «no cabe») mientras el usuario todavía está midiendo su
 * rollo, antes de haber marcado un solo producto.
 */
const planear = async (negocioId, sucursalId, body) => {
  const { formato, op, etiquetas, sinCodigo, recortado } = await _preparar(negocioId, sucursalId, body);

  const porPagina = formato.columnas * formato.filas;
  const saltar    = Math.max(0, Math.min(porPagina - 1, (Number(op.desde) || 1) - 1));
  const geometria = layout.geometria(formato, op, { desde: op.desde });

  let muestra = null;
  const avisos = new Set();
  if (etiquetas.length) {
    const peor = etiquetas.reduce((a, b) => (String(b.codigo).length > String(a.codigo).length ? b : a));
    muestra = layout.planear(
      formato.etiqueta.ancho * formatos.MM,
      formato.etiqueta.alto  * formatos.MM,
      peor, op,
    );
    for (const a of muestra.avisos) avisos.add(a);
  }
  // Las térmicas de 4 pulgadas —casi todas— no imprimen más allá de 104–108
  // mm: lo que caiga fuera del cabezal simplemente no sale.
  if (formato.medio === 'rollo' && formato.pagina.ancho > formatos.LIMITES.anchoTermica4) avisos.add('rollo_ancho');
  // Varias filas por página en un rollo con sensor de hueco: la impresora
  // cuenta CADA fila troquelada como una etiqueta, así que una página de 3
  // filas le llega como una etiqueta de 75 mm sobre un troquel de 25 — imprime
  // corrido y después avanza filas en blanco. Reportado con una DIG T451B
  // (3 × 3 de 30 × 25 en un rollo de 100). Varias filas solo sirven con papel
  // continuo o con un rollo que no traiga hueco entre filas.
  if (formato.medio === 'rollo' && formato.filas > 1 && !formato.rollo?.incluirSeparacion) avisos.add('rollo_varias_filas');
  if (geometria.fuera) avisos.add('calibracion_fuera');

  return {
    formato,
    total:     etiquetas.length,
    paginas:   etiquetas.length ? Math.ceil((etiquetas.length + saltar) / porPagina) : 0,
    porPagina,
    recortado,
    maximo:    MAX_ETIQUETAS,
    sinCodigo: sinCodigo.map((n) => ({
      nivel: n.nivel, producto_id: n.producto_id, atributo_id: n.atributo_id, variante_id: n.variante_id,
      nombre: n.nombre, variante_label: n.variante_label,
    })),
    avisos:   [...avisos],
    moduloMm: muestra ? Number(muestra.moduloMm.toFixed(3)) : null,
    minimoMm: muestra ? muestra.minimoMm : null,
    puntosModulo: muestra ? muestra.puntosModulo : null,
    geometria,
    // Cuánto mide la regla que trae la hoja de prueba: con la medida real, la
    // pantalla calcula la escala que corrige la impresora.
    reglaMm: layout.largoRegla(formato.etiqueta.ancho),
  };
};

/**
 * El PDF.
 *
 * `limite` sirve a la vista previa de la pantalla, que pide UNA página con el
 * mismo endpoint. Es lo que permite que la previa sea el PDF de verdad y no un
 * dibujo aparte que se desincroniza: lo que el usuario ve en el recuadro es
 * literalmente lo que va a salir por la impresora.
 *
 * `prueba` imprime la hoja de alineación con el mismo formato y la misma
 * calibración, sin necesitar productos: se imprime ANTES de gastar el rollo.
 */
const construirPdf = async (negocioId, sucursalId, body, res) => {
  const { generarPdfEtiquetas, generarPdfPrueba } = require('./etiquetas.pdf');

  if (body.prueba === true) {
    const { formato, op } = await _base(negocioId, sucursalId, body);
    generarPdfPrueba({ formato, opciones: op, res, nombreArchivo: 'prueba-alineacion.pdf' });
    return;
  }

  const { formato, op, etiquetas } = await _preparar(negocioId, sucursalId, body);
  const limite = Number(body.limite) > 0 ? Math.floor(Number(body.limite)) : null;

  generarPdfEtiquetas({
    etiquetas: limite ? etiquetas.slice(0, limite) : etiquetas,
    formato, opciones: op, res,
    nombreArchivo: `etiquetas-${new Date().toISOString().slice(0, 10)}.pdf`,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Generación masiva de códigos
// ─────────────────────────────────────────────────────────────────────────────
//
// Sin esto la impresión masiva no sirve de nada para lo que se creó ANTES de
// encender el código automático: esos nodos siguen con `codigo` en NULL y
// asignarlos a mano uno por uno no lo va a hacer nadie.
//
// El algoritmo NO vive aquí: es el mismo motor que asigna el código al crear un
// producto y al importar (`utils/codigoAuto.util.js`). Esta pantalla tenía su
// propia copia y ya se había separado en un punto que duele: cuando la herencia
// estaba bloqueada inventaba un código nuevo y lo propagaba ENCIMA del que la
// otra sede ya tenía impreso. Las reglas —no pisar, heredar antes de inventar,
// no partir la identidad entre sedes, propagar solo a los vacíos, dígitos puros—
// están documentadas allá, una sola vez.

const NIVEL_ID = { producto: 'producto_id', atributo: 'atributo_id', variante: 'variante_id' };

/**
 * Asigna código a los nodos seleccionados que no tienen.
 *
 * Sin prefijo ni dígitos en la petición se usan los de Ajustes, que son los del
 * código automático: los códigos que se generan en masa y los que nacen solos
 * tienen que verse igual en el estante.
 *
 * @returns {{ asignados: number, omitidos: number, detalle: object[], bloqueados: object[] }}
 */
const generarCodigos = async (negocioId, sucursalId, body) => {
  const config = await configRepo.getMap(negocioId);
  if (config.codigo_producto_activo !== '1') {
    throw { status: 400, message: 'Activa el código único de producto en Ajustes antes de generar códigos.' };
  }

  const auto = codigoAuto.configCodigoAuto(config);
  const prefijo = body.prefijo !== undefined ? codigoAuto.validarPrefijo(body.prefijo) : auto.prefijo;
  const longitud = body.longitud !== undefined && body.longitud !== ''
    ? Math.max(4, Math.min(10, Math.floor(Number(body.longitud) || 6)))
    : auto.digitos;
  codigoAuto.validarLargo(prefijo, longitud);

  const seleccion = _sanearSeleccion(body.seleccion);
  if (!seleccion.length) throw { status: 400, message: 'No hay productos seleccionados' };
  if (seleccion.length > MAX_CODIGOS_POR_TANDA) {
    throw {
      status: 400,
      message: `Puedes generar hasta ${MAX_CODIGOS_POR_TANDA} códigos por tanda. Divide la selección.`,
    };
  }

  const nodos = await repo.nodosPorSeleccion(negocioId, sucursalId, seleccion);
  const pendientes = nodos.filter((n) => !n.codigo || !String(n.codigo).trim());
  if (!pendientes.length) return { asignados: 0, omitidos: nodos.length, detalle: [], bloqueados: [] };

  const porClave = new Map(nodos.map((n) => [`${n.nivel}:${n[NIVEL_ID[n.nivel]]}`, n]));
  const describir = (a) => {
    const n = porClave.get(`${a.nivel}:${a.id}`);
    return { nivel: a.nivel, id: a.id, nombre: n?.nombre, variante_label: n?.variante_label, codigo: a.codigo };
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await codigoAuto.asignarCodigos(client, {
      negocioId, sucursalId,
      nodos: pendientes.map((n) => ({ nivel: n.nivel, id: n[NIVEL_ID[n.nivel]] })),
      prefijo, digitos: longitud,
      // Con patrón, prefijo y dígitos no aplican: lo que se genera en masa y lo
      // que nace solo tiene que verse igual en el estante.
      formato: auto.formato,
    });
    await client.query('COMMIT');

    return {
      asignados: r.asignados.length,
      omitidos:  nodos.length - pendientes.length,
      detalle:   r.asignados.map((a) => ({ ...describir(a), origen: a.origen })),
      // Heredaban un código que en esta sede ya tiene otro producto. No se les
      // inventa uno distinto (partiría su identidad entre sedes): la pantalla
      // dice cuáles son y quién tiene el código, para que alguien lo resuelva.
      bloqueados: r.bloqueados.map((b) => ({ ...describir(b), bloqueadoPor: b.bloqueadoPor })),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  listarFormatos, catalogo, listar, planear, construirPdf, generarCodigos,
  MAX_ETIQUETAS, MAX_CODIGOS_POR_TANDA,
};
