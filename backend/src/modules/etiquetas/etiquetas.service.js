const { pool }   = require('../../config/db');
const repo       = require('./etiquetas.repository');
const formatos   = require('./etiquetas.formatos');
const layout     = require('./etiquetas.layout');
const configRepo = require('../config/config.repository');
const {
  normalizarCodigo, buscarCodigoEnUso, propagarCodigo, heredarCodigo, MAX_CODIGO,
} = require('../../utils/codigo.util');

// Tope de etiquetas por PDF. No es un límite de negocio: por encima de esto el
// archivo pesa decenas de MB, el navegador que lo abre se atasca y la impresora
// térmica —que lee el PDF con muy poca memoria— lo rechaza. Una bodega de
// verdad imprime por estante o por línea, no el inventario entero de un tirón.
const MAX_ETIQUETAS = 3000;

// Tope de códigos por llamada. Cada nodo cuesta varias consultas (heredar,
// verificar, escribir, propagar) y axios corta a los 30 s: pasado ese punto el
// usuario ve "no se pudo" sobre una operación que en realidad estaba a medias.
// El frontend llama por tandas y muestra el avance.
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
  if (op.encabezadoTexto) return String(op.encabezadoTexto).slice(0, 60);
  return ctx?.negocio_nombre || ctx?.sucursal_nombre || null;
};

const _opciones = (body, ctx) => {
  const mostrar = body.mostrar || {};
  const op = {
    simbologia: body.simbologia === 'qr' ? 'qr' : 'barras',
    mostrar: {
      nombre:     mostrar.nombre     !== false,
      variante:   mostrar.variante   !== false,
      precio:     mostrar.precio     === true,
      encabezado: mostrar.encabezado === true,
    },
    marco:  body.marco === true,
    desde:  Number(body.desde) || 1,
    ajuste: { x: Number(body.ajuste?.x) || 0, y: Number(body.ajuste?.y) || 0 },
  };
  op.encabezado = _encabezado(ctx, { ...op, encabezadoTexto: body.encabezadoTexto });
  return op;
};

/** Resuelve todo lo que comparten la vista previa y el PDF. */
const _preparar = async (negocioId, sucursalId, body) => {
  const seleccion = _sanearSeleccion(body.seleccion);
  const formato   = formatos.resolver(body.formato, body.personalizado);
  const ctx       = await repo.contextoImpresion(negocioId, sucursalId);
  if (!ctx) throw { status: 403, message: 'Sucursal no válida para este negocio' };

  const op    = _opciones(body, ctx);
  const nodos = await repo.nodosPorSeleccion(negocioId, sucursalId, seleccion);
  const { etiquetas, sinCodigo, recortado } = _expandir(nodos, seleccion, body.cantidadModo);

  return { formato, op, nodos, etiquetas, sinCodigo, recortado, ctx };
};

// ─────────────────────────────────────────────────────────────────────────────
// API del módulo
// ─────────────────────────────────────────────────────────────────────────────

const listarFormatos = () => formatos.FORMATOS;

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
 * Vista previa: qué va a salir, cuántas hojas y qué puede salir mal.
 *
 * Corre el MISMO `layout.planear` que el PDF —no una estimación— sobre el
 * código más largo de la selección, que es el caso peor: es el que da la barra
 * más estrecha y el que primero deja de escanear. Un aviso aquí le ahorra al
 * usuario la plancha entera.
 */
const planear = async (negocioId, sucursalId, body) => {
  const { formato, op, etiquetas, sinCodigo, recortado } = await _preparar(negocioId, sucursalId, body);

  const porPagina = formato.columnas * formato.filas;
  const saltar    = Math.max(0, Math.min(porPagina - 1, (Number(op.desde) || 1) - 1));

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
  };
};

/**
 * El PDF.
 *
 * `limite` sirve a la vista previa de la pantalla, que pide UNA página con el
 * mismo endpoint. Es lo que permite que la previa sea el PDF de verdad y no un
 * dibujo aparte que se desincroniza: lo que el usuario ve en el recuadro es
 * literalmente lo que va a salir por la impresora.
 */
const construirPdf = async (negocioId, sucursalId, body, res) => {
  const { formato, op, etiquetas } = await _preparar(negocioId, sucursalId, body);
  const { generarPdfEtiquetas } = require('./etiquetas.pdf');

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
// Sin esto la impresión masiva no sirve de nada: un negocio que acaba de
// encender la feature tiene cientos de nodos con `codigo` en NULL, y asignarlos
// a mano uno por uno en el modal de cada variante no lo va a hacer nadie.
//
// Tres decisiones que no son negociables:
//
//  1. NUNCA se pisa un código existente. Un código ya impreso está pegado a la
//     mercancía en el estante; cambiarlo en la base convierte esas etiquetas en
//     basura silenciosa —siguen escaneando, pero contra nada—.
//
//  2. Se HEREDA antes de inventar. El mismo nodo lógico en otra sede lleva el
//     mismo código a propósito (así el lector funciona en las dos), y después de
//     asignar se PROPAGA. Es la regla que ya aplican el importador y el módulo
//     de variantes, con sus mismos helpers: una tercera implementación se
//     desincronizaría.
//
//  3. Los códigos generados son DÍGITOS. No es estética: Code 128 codifica los
//     dígitos de dos en dos (juego C) y un código numérico de 6 cifras ocupa
//     casi la mitad que uno alfanumérico. En una etiqueta de 38 mm eso es la
//     diferencia entre escanear y no escanear.

const PREFIJO_OK = /^[A-Z0-9-]{0,8}$/;

/** El mayor código puramente numérico que ya usa el negocio. */
const _semilla = async (client, negocioId, prefijo) => {
  const patron = prefijo ? `^${prefijo}[0-9]{1,9}$` : '^[0-9]{1,9}$';
  const corte  = prefijo ? prefijo.length + 1 : 1;

  const { rows } = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(codigo FROM $2::int)::bigint), 0) AS maximo
     FROM (
       SELECT pc.codigo FROM productos_cantidad pc
         JOIN sucursales su ON su.id = pc.sucursal_id
        WHERE su.negocio_id = $1 AND pc.codigo ~ $3
       UNION ALL
       SELECT ap.codigo FROM atributos_producto ap
         JOIN sucursales su ON su.id = ap.sucursal_id
        WHERE su.negocio_id = $1 AND ap.codigo ~ $3
       UNION ALL
       SELECT v.codigo FROM variantes_atributo v
         JOIN atributos_producto ap ON ap.id = v.atributo_id
         JOIN sucursales su ON su.id = ap.sucursal_id
        WHERE su.negocio_id = $1 AND v.codigo ~ $3
     ) t`,
    [negocioId, corte, patron]
  );
  return Number(rows[0]?.maximo || 0);
};

/**
 * Reserva un bloque de `cuantos` números de una sola vez.
 *
 * Mismo mecanismo que `asignarNumeroDocumento`: un INSERT … ON CONFLICT DO
 * UPDATE … RETURNING es atómico, el lock de fila serializa a dos usuarios
 * generando a la vez, y si la transacción hace ROLLBACK el contador vuelve
 * atrás con ella. `contadores_documento.tipo` es TEXT libre, así que un tipo
 * nuevo no necesita migración.
 *
 * El `GREATEST` contra la semilla es lo que hace esto reparable: si alguien
 * importó códigos numéricos por fuera, el contador se pone por encima solo, en
 * vez de repartir números que ya existen y morir contra el índice único.
 */
const _reservarBloque = async (client, negocioId, semilla, cuantos) => {
  const { rows } = await client.query(
    `INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
     VALUES ($1, 'codigo_producto', GREATEST($2::int, 0) + $3)
     ON CONFLICT (negocio_id, tipo)
     DO UPDATE SET ultimo_numero = GREATEST(contadores_documento.ultimo_numero, $2::int) + $3
     RETURNING ultimo_numero`,
    [negocioId, semilla, cuantos]
  );
  const fin = Number(rows[0].ultimo_numero);
  return fin - cuantos + 1;   // primer número del bloque
};

const TABLA_NIVEL = {
  producto: { tabla: 'productos_cantidad', campo: 'producto_id' },
  atributo: { tabla: 'atributos_producto', campo: 'atributo_id' },
  variante: { tabla: 'variantes_atributo', campo: 'variante_id' },
};

/**
 * Asigna código a los nodos seleccionados que no tienen.
 *
 * @returns {{ asignados: number, omitidos: number, detalle: object[] }}
 */
const generarCodigos = async (negocioId, sucursalId, body) => {
  const config = await configRepo.getMap(negocioId);
  if (config.codigo_producto_activo !== '1') {
    throw { status: 400, message: 'Activa el código único de producto en Ajustes antes de generar códigos.' };
  }

  const prefijo = String(body.prefijo || '').trim().toUpperCase();
  if (!PREFIJO_OK.test(prefijo)) {
    throw { status: 400, message: 'El prefijo solo admite letras, números y guiones (máximo 8).' };
  }
  const longitud = Math.max(4, Math.min(10, Math.floor(Number(body.longitud) || 6)));
  if (prefijo.length + longitud > MAX_CODIGO) {
    throw { status: 400, message: `El código no puede superar ${MAX_CODIGO} caracteres` };
  }

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
  if (!pendientes.length) return { asignados: 0, omitidos: nodos.length, detalle: [] };

  // Con una sola sucursal no hay de quién heredar ni a quién propagar, y
  // saltarse las dos consultas por nodo es lo que mantiene la tanda dentro del
  // tiempo de espera del navegador. Es la situación de la mayoría de negocios.
  const { rows: [{ n: sucursales }] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sucursales WHERE negocio_id = $1 AND activa = true`,
    [negocioId]
  );
  const variasSedes = sucursales > 1;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const semilla  = await _semilla(client, negocioId, prefijo);
    const bloque   = await _reservarBloque(client, negocioId, semilla, pendientes.length);

    let siguiente = bloque;
    const detalle = [];

    for (const nodo of pendientes) {
      // Identidad LÓGICA, tal como la esperan `heredarCodigo` y `propagarCodigo`:
      // los ids son distintos en cada sede, el nombre y los valores no.
      const identidad = {
        producto: nodo.nombre,
        atributo: nodo.atributo_valor || null,
        variante: nodo.variante_valor || null,
      };

      // 1) ¿Ya existe este mismo nodo con código en otra sede?
      let codigo = null;
      if (variasSedes) {
        const { codigo: heredado } = await heredarCodigo(client, { negocioId, sucursalId, identidad });
        codigo = heredado;
      }

      // 2) Si no, se toma del bloque reservado. El bucle salta los números que
      //    ya estuvieran ocupados por un código escrito a mano que la semilla no
      //    reconoció (por ejemplo con otro prefijo).
      if (!codigo) {
        for (let intento = 0; intento < 50 && !codigo; intento += 1) {
          const propuesto = normalizarCodigo(prefijo + String(siguiente).padStart(longitud, '0'));
          siguiente += 1;
          const [ocupado] = await buscarCodigoEnUso(client, { sucursalId, codigo: propuesto });
          if (!ocupado) codigo = propuesto;
        }
      }
      if (!codigo) continue;   // 50 intentos ocupados: se salta el nodo, no se rompe la tanda

      const { tabla, campo } = TABLA_NIVEL[nodo.nivel];
      await client.query(`UPDATE ${tabla} SET codigo = $1 WHERE id = $2`, [codigo, nodo[campo]]);

      if (variasSedes) await propagarCodigo(client, { negocioId, identidad, codigo });

      detalle.push({
        nivel: nodo.nivel, id: nodo[campo],
        nombre: nodo.nombre, variante_label: nodo.variante_label, codigo,
      });
    }

    await client.query('COMMIT');
    return { asignados: detalle.length, omitidos: nodos.length - pendientes.length, detalle };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  listarFormatos, listar, planear, construirPdf, generarCodigos,
  MAX_ETIQUETAS, MAX_CODIGOS_POR_TANDA,
};
