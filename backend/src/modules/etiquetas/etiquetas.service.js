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
      // Solo pesa en las etiquetas de una compra (las únicas cuyos items traen
      // `codigo_proveedor`): ausente = sí.
      proveedor:  mostrar.proveedor  !== false,
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
  return {
    ..._plan(formato, op, etiquetas, recortado),
    sinCodigo: sinCodigo.map((n) => ({
      nivel: n.nivel, producto_id: n.producto_id, atributo_id: n.atributo_id, variante_id: n.variante_id,
      nombre: n.nombre, variante_label: n.variante_label,
    })),
  };
};

/**
 * La parte del plan que no depende de DE DÓNDE salieron las etiquetas: la usan
 * la impresión de Inventario y la de una compra. Dos copias de estos avisos
 * acabarían avisando distinto sobre el mismo rollo.
 */
const _plan = (formato, op, etiquetas, recortado) => {
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

// ─────────────────────────────────────────────────────────────────────────────
// Etiquetas de una COMPRA (o una Entrada de bodega, que es una compra)
// ─────────────────────────────────────────────────────────────────────────────
//
// Al recibir mercancía se imprime ahí mismo: es cuando la caja está abierta y
// alguien la va a poner en el estante. Y si la pantalla se cerró sin querer, la
// compra sigue ahí y se reimprime igual — el registro ES la compra.
//
// No es un motor aparte: las etiquetas salen del mismo `_plan`, el mismo
// `layout.planear` y el mismo PDF que las de Inventario, con el formato, el
// diseño y la calibración que ese navegador ya tiene guardados. Lo único nuevo
// es de dónde salen los items (las líneas de la compra) y que cada uno lleva el
// código del proveedor.
//
// Qué lleva el SÍMBOLO no cambia: el código pelado del producto (o el IMEI de un
// equipo), porque el lector es un teclado y `BarraEscaneo` resuelve exactamente
// eso. El código del proveedor va como TEXTO debajo — metido en el símbolo, el
// escáner del punto de venta dejaría de encontrar el producto.

const NIVEL_DE_LINEA = (l) => {
  if (l.variante_id) return { nivel: 'variante', variante_id: Number(l.variante_id) };
  if (l.atributo_id) return { nivel: 'atributo', atributo_id: Number(l.atributo_id) };
  return { nivel: 'producto', producto_id: Number(l.producto_id) };
};

/**
 * La compra, si este usuario puede etiquetarla. Un supervisor solo etiqueta lo
 * que entró en SU sucursal: es la misma frontera que tiene para ver compras.
 */
const _compraEtiquetable = async (negocioId, usuario, compraId) => {
  const id = Number(compraId);
  if (!Number.isInteger(id) || id <= 0) throw { status: 400, message: 'Compra inválida' };

  const compra = await repo.compraParaEtiquetas(negocioId, id);
  if (!compra) throw { status: 404, message: 'Compra no encontrada' };

  if (usuario?.rol !== 'admin_negocio' && usuario?.sucursalId
      && Number(compra.sucursal_id) !== Number(usuario.sucursalId)) {
    throw { status: 403, message: 'Esta compra es de otra sucursal' };
  }
  // Cancelar devolvió el stock: etiquetar mercancía que ya no está en el
  // inventario es pegar un código que el escáner no va a encontrar.
  if (compra.estado === 'Cancelada') {
    throw { status: 409, code: 'COMPRA_CANCELADA', message: 'Esta compra está cancelada: su mercancía ya no está en el inventario.' };
  }
  return compra;
};

/**
 * Cada línea de la compra, lista para etiquetar.
 *
 * `cantidad` es lo que entró MENOS lo ya devuelto al proveedor: reimprimir no
 * puede sacar etiquetas de unidades que se fueron. `problema` dice por qué una
 * línea no puede salir, para que la pantalla lo muestre en vez de sacar un PDF
 * con menos etiquetas sin explicación:
 *   · sin_codigo  → el nodo existe pero no tiene código (se genera en Inventario)
 *   · sin_nodo    → la talla ya no existe, o el producto ganó variantes después
 *   · sin_unidad  → el equipo ya no está en esa sucursal
 */
const _lineasEtiquetables = async (negocioId, compra) => {
  const lineas = await repo.lineasCompra(compra.id);

  const deCantidad = lineas.filter((l) => !l.imei && l.producto_id);
  const nodos = await repo.nodosPorSeleccion(negocioId, compra.sucursal_id,
    _sanearSeleccion(deCantidad.map(NIVEL_DE_LINEA)));
  const porNodo = new Map(nodos.map((n) => [`${n.nivel}:${n[NIVELES[n.nivel]]}`, n]));

  const seriales = await repo.serialesDeCompra(compra.sucursal_id,
    lineas.filter((l) => l.imei).map((l) => l.imei));
  const porImei = new Map(seriales.map((s) => [s.clave, s]));

  return lineas.map((l) => {
    const base = {
      linea_id: l.id,
      nombre:   l.nombre_producto,
      variante_label: null,
      codigo:   null,
      precio:   null,
      cantidad: Math.max(0, Number(l.cantidad || 0) - Number(l.cantidad_devuelta || 0)),
      problema: null,
    };

    if (l.imei) {
      const s = porImei.get(String(l.imei).trim().toUpperCase());
      if (!s) return { ...base, tipo: 'serial', codigo: String(l.imei).trim(), problema: 'sin_unidad' };
      return {
        ...base, tipo: 'serial',
        nombre: s.nombre || l.nombre_producto,
        variante_label: s.color || null,
        codigo: String(s.imei).trim(),
        precio: s.precio,
        vendido: !!s.vendido,
      };
    }

    const sel = NIVEL_DE_LINEA(l);
    const n = l.producto_id ? porNodo.get(`${sel.nivel}:${sel[NIVELES[sel.nivel]]}`) : null;
    if (!n) return { ...base, tipo: 'cantidad', problema: 'sin_nodo' };
    const codigo = n.codigo && String(n.codigo).trim() ? String(n.codigo).trim() : null;
    return {
      ...base, tipo: 'cantidad',
      nombre: n.nombre,
      variante_label: n.variante_label,
      codigo,
      precio: n.precio,
      problema: codigo ? null : 'sin_codigo',
    };
  });
};

/**
 * Líneas → etiquetas físicas. `cantidades` es `{ [linea_id]: n }` y lo que no
 * trae se imprime completo: la pantalla solo manda lo que el usuario cambió (una
 * etiqueta rota se reimprime sola, sin sacar la caja entera otra vez).
 */
const _expandirCompra = (lineas, cantidades, codigoProveedor) => {
  const pedidas = cantidades && typeof cantidades === 'object' ? cantidades : {};
  const etiquetas = [];
  let recortado = false;

  for (const l of lineas) {
    if (l.problema) continue;
    const raw = pedidas[l.linea_id];
    const n = raw === undefined || raw === null || raw === '' ? l.cantidad : Math.floor(Number(raw));
    const cant = Math.max(0, Math.min(Number.isFinite(n) ? n : l.cantidad, MAX_ETIQUETAS));

    const item = {
      nombre: l.nombre, variante_label: l.variante_label, codigo: l.codigo, precio: l.precio,
      codigo_proveedor: codigoProveedor || null,
    };
    for (let k = 0; k < cant; k += 1) {
      if (etiquetas.length >= MAX_ETIQUETAS) { recortado = true; break; }
      etiquetas.push(item);
    }
    if (recortado) break;
  }
  return { etiquetas, recortado };
};

const _cabecera = (compra) => ({
  id: compra.id,
  numero: compra.numero ?? compra.id,
  sucursal_id: compra.sucursal_id,
  proveedor_id: compra.proveedor_id,
  proveedor_nombre: compra.proveedor_nombre || null,
  codigo_proveedor: compra.codigo_proveedor || null,
});

/** Qué se puede etiquetar de esta compra. */
const lineasDeCompra = async (negocioId, usuario, compraId) => {
  const compra = await _compraEtiquetable(negocioId, usuario, compraId);
  const lineas = await _lineasEtiquetables(negocioId, compra);
  return { compra: _cabecera(compra), lineas };
};

const _prepararCompra = async (negocioId, usuario, compraId, body) => {
  const compra = await _compraEtiquetable(negocioId, usuario, compraId);
  const lineas = await _lineasEtiquetables(negocioId, compra);
  const { formato, op } = await _base(negocioId, compra.sucursal_id, body);
  const { etiquetas, recortado } = _expandirCompra(lineas, body.cantidades, compra.codigo_proveedor);
  return { compra, lineas, formato, op, etiquetas, recortado };
};

const planearCompra = async (negocioId, usuario, compraId, body) => {
  const { compra, lineas, formato, op, etiquetas, recortado } = await _prepararCompra(negocioId, usuario, compraId, body);
  return {
    ..._plan(formato, op, etiquetas, recortado),
    compra: _cabecera(compra),
    conProblema: lineas.filter((l) => l.problema)
      .map((l) => ({ linea_id: l.linea_id, nombre: l.nombre, problema: l.problema })),
  };
};

const construirPdfCompra = async (negocioId, usuario, compraId, body, res) => {
  const { generarPdfEtiquetas } = require('./etiquetas.pdf');
  const { compra, formato, op, etiquetas } = await _prepararCompra(negocioId, usuario, compraId, body);
  const limite = Number(body.limite) > 0 ? Math.floor(Number(body.limite)) : null;
  generarPdfEtiquetas({
    etiquetas: limite ? etiquetas.slice(0, limite) : etiquetas,
    formato, opciones: op, res,
    nombreArchivo: `etiquetas-compra-${compra.numero ?? compra.id}.pdf`,
  });
};

module.exports = {
  listarFormatos, catalogo, listar, planear, construirPdf, generarCodigos,
  lineasDeCompra, planearCompra, construirPdfCompra,
  MAX_ETIQUETAS, MAX_CODIGOS_POR_TANDA,
};
