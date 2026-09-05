const { pool } = require('../../config/db');
const repo      = require('./redInterna.pedidos.repository');
const redRepo   = require('./redInterna.repository');
const { avisar } = require('./redInterna.avisos');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');

// ─────────────────────────────────────────────────────────────────────────────
// PEDIDOS INTERNOS — el local le pide a la bodega
//
// El circuito de la red interna nació en una sola dirección: la bodega decide
// qué mandar, despacha, y el local confirma. Funciona mientras alguien en la
// bodega sepa qué le falta a cada local — que es justo lo que deja de ser
// cierto en cuanto hay más de dos locales. Esto cierra el otro sentido:
//
//     el local PIDE → la bodega DESPACHA (o cierra con una razón) → el local RECIBE
//
// ── Lo que este módulo NO hace ──────────────────────────────────────────────
// No mueve inventario, no toca caja y no crea deuda. NADA de eso pasa hasta que
// la bodega despacha, y entonces lo hace el `despachar()` de siempre. El pedido
// es un documento de intención puesto ENCIMA de la remisión: un pedido, N
// remisiones. Es la misma decisión que tomó la orden de compra frente a la
// compra, y por la misma razón — un segundo circuito de mercancía sería una
// segunda verdad sobre el stock.
//
// ── Por qué un VENDEDOR puede pedir ─────────────────────────────────────────
// Recibir una remisión ya lo puede hacer un vendedor, y recibir GENERA LA DEUDA
// del local. Pedir es estrictamente menos poderoso: no compromete un peso y no
// pasa nada hasta que la bodega actúa. Exigir supervisor para pedir y no para
// recibir sería exigir más para lo que menos pesa; además, quien se da cuenta
// de que se acabó algo es quien está en el mostrador.
//
// ── Por qué NO se exige la variante ─────────────────────────────────────────
// Una remisión mueve stock y por eso está obligada a nombrar el nodo hoja
// (`VARIANTE_REQUERIDA`) o el inventario queda descuadrado. Un pedido solo
// DESCRIBE: "mándame correas" es una petición legítima y útil, igual que
// "toda la correa está en el Estante A" lo es para una ubicación. Además el
// catálogo de pedidos ya devuelve nodos hoja, así que la pantalla lleva sola a
// la talla; obligar aquí solo rompería el pedido a texto libre.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LINEAS    = 200;
const MAX_CANTIDAD  = 100000;
const MAX_TEXTO     = 300;

const _num = (v) => Number(v || 0);

const _texto = (v, tope = MAX_TEXTO) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, tope) : null;
};

// El local que pide. La bodega no se pide a sí misma: para eso ya tiene el
// botón de despachar, y un pedido de la bodega a la bodega no tendría quién lo
// atendiera.
const _exigirLocal = (req) => {
  if (req.esBodega) {
    throw {
      status: 403,
      message: 'La bodega no se hace pedidos a sí misma. Usa "Despachar" para mover mercancía.',
    };
  }
};

const _exigirBodega = (req) => {
  if (!req.esBodega) {
    throw { status: 403, message: 'Solo la bodega puede hacer esto' };
  }
};

/**
 * Aislamiento: quién puede ver/tocar qué pedido.
 *
 * La bodega ve todos los que le hicieron A ELLA; un local, solo los suyos. Es
 * la misma regla de `getMovimientosCuenta` y `getConciliacion`, y se comprueba
 * contra las columnas del pedido y no contra el `red_interna_bodega_id` de hoy:
 * la bodega se congela en la fila justamente para que cambiar esa clave en
 * Ajustes no le abra ni le cierre a nadie los pedidos históricos.
 */
const _exigirAcceso = (req, pedido) => {
  const mio = Number(pedido.sucursal_id) === Number(req.sucursal_id);
  const paraMi = req.esBodega
    && Number(pedido.sucursal_bodega_id) === Number(req.sucursal_id);
  if (!mio && !paraMi) {
    throw { status: 403, message: 'Ese pedido no es de tu sucursal' };
  }
  // Un borrador es un papel a medio escribir: la bodega no tiene por qué verlo
  // hasta que lo envíen. Sin esto, la bandeja mostraría pedidos que su autor
  // todavía está armando.
  if (pedido.estado === 'Borrador' && !mio) {
    throw { status: 404, message: 'Pedido no encontrado' };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// VALIDACIÓN DE LAS LÍNEAS
//
// El `producto_id` que llega del navegador NO se cree: se comprueba contra la
// tabla que le corresponde a su `tipo` y contra la sucursal BODEGA. Sin eso, un
// local podría pedir —y dejar escrito en la ficha del pedido— el nombre de un
// producto de otra sede o de otro negocio.
// ─────────────────────────────────────────────────────────────────────────────
const _validarLinea = async (client, l, { bodegaId, negocioId, orden }) => {
  const tipo = l.tipo === 'serial' ? 'serial' : 'cantidad';
  const cantidad = Math.trunc(Number(l.cantidad_pedida ?? l.cantidad));
  if (!Number.isFinite(cantidad) || cantidad < 1) {
    throw { status: 400, message: 'Cada línea necesita una cantidad de al menos 1' };
  }
  if (cantidad > MAX_CANTIDAD) {
    throw { status: 400, message: `La cantidad máxima por línea es ${MAX_CANTIDAD}` };
  }

  const base = {
    tipo, cantidad_pedida: cantidad, orden,
    notas: _texto(l.notas, 200),
    producto_id: null, atributo_id: null, variante_id: null,
    nombre_producto: _texto(l.nombre_producto ?? l.nombre, 200),
  };

  // Pedido a TEXTO LIBRE: el local necesita algo que la bodega todavía no tiene
  // en su catálogo. Se acepta con el nombre y ya; la bodega lo resuelve a mano
  // al despachar. Sin esta puerta, el pedido solo serviría para reponer lo que
  // ya existe, que es la mitad del problema.
  if (!l.producto_id) {
    if (!base.nombre_producto) {
      throw { status: 400, message: 'Escribe qué producto necesitas' };
    }
    return base;
  }

  const productoId = Number(l.producto_id);

  if (tipo === 'serial') {
    const { rows } = await client.query(`
      SELECT ps.id, ps.nombre, ps.marca, ps.modelo
      FROM productos_serial ps
      JOIN sucursales su ON su.id = ps.sucursal_id
      WHERE ps.id = $1 AND ps.sucursal_id = $2 AND su.negocio_id = $3
    `, [productoId, bodegaId, negocioId]);
    if (!rows.length) {
      throw { status: 400, message: 'Ese equipo no está en el catálogo de la bodega' };
    }
    const p = rows[0];
    return {
      ...base,
      producto_id: p.id,
      // El nombre se CONGELA al pedir, como `lineas_remision.nombre_producto` y
      // por la misma razón: si mañana renombran el producto, el pedido tiene
      // que seguir diciendo lo que se pidió.
      nombre_producto: base.nombre_producto
        || [p.nombre, p.marca, p.modelo].filter(Boolean).join(' '),
    };
  }

  // Cantidad: se valida el nodo COMPLETO (producto → atributo → variante) y que
  // toda la cadena sea de la bodega. Un atributo de otro producto colaría una
  // talla que no existe bajo ese nombre.
  const { rows } = await client.query(`
    SELECT pc.id AS producto_id, pc.nombre,
           ap.id AS atributo_id, ap.valor AS atributo_valor,
           va.id AS variante_id, va.valor AS variante_valor
    FROM      productos_cantidad pc
    JOIN      sucursales su          ON su.id = pc.sucursal_id
    LEFT JOIN atributos_producto ap  ON ap.id = $4 AND ap.producto_id = pc.id
    LEFT JOIN variantes_atributo va  ON va.id = $5 AND va.atributo_id = ap.id
    WHERE pc.id = $1 AND pc.sucursal_id = $2 AND su.negocio_id = $3
  `, [productoId, bodegaId, negocioId, l.atributo_id || null, l.variante_id || null]);

  if (!rows.length) {
    throw { status: 400, message: 'Ese producto no está en el catálogo de la bodega' };
  }
  const n = rows[0];
  if (l.atributo_id && !n.atributo_id) {
    throw { status: 400, message: `Esa variante no pertenece a "${n.nombre}"` };
  }
  if (l.variante_id && !n.variante_id) {
    throw { status: 400, message: `Esa variante no pertenece a "${n.nombre}"` };
  }

  const etiqueta = [n.nombre, n.atributo_valor, n.variante_valor].filter(Boolean).join(' / ');
  return {
    ...base,
    producto_id: n.producto_id,
    atributo_id: n.atributo_id,
    variante_id: n.variante_id,
    nombre_producto: base.nombre_producto || etiqueta,
  };
};

const _escribirLineas = async (client, pedidoId, lineas, { bodegaId, negocioId }) => {
  if (!Array.isArray(lineas) || !lineas.length) {
    throw { status: 400, message: 'Agrega al menos un producto al pedido' };
  }
  if (lineas.length > MAX_LINEAS) {
    throw { status: 400, message: `Un pedido no puede tener más de ${MAX_LINEAS} líneas` };
  }
  let orden = 0;
  for (const l of lineas) {
    const limpia = await _validarLinea(client, l, { bodegaId, negocioId, orden: orden++ });
    await repo.insertarLinea(client, { ...limpia, pedido_id: pedidoId });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CREAR
//
// `enviar: true` (el default de la pantalla) crea y envía en un solo paso: para
// la mayoría de los pedidos el borrador es un trámite de más. El borrador
// existe para el pedido que se arma a lo largo del día.
// ─────────────────────────────────────────────────────────────────────────────
const crear = async (req, { lineas, notas, prioridad, enviar = true, clave_idempotencia }) => {
  _exigirLocal(req);
  const negocioId  = req.user.negocio_id;
  const sucursalId = Number(req.sucursal_id);
  const bodegaId   = Number(req.red.bodega_id);

  if (clave_idempotencia) {
    const previo = await repo.findPorClave(clave_idempotencia);
    if (previo) return { ...(await _leer(negocioId, previo.id)), repetido: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pedido = await repo.crear(client, {
      negocio_id: negocioId, sucursal_id: sucursalId, sucursal_bodega_id: bodegaId,
      usuario_id: req.user.id,
      estado: enviar === false ? 'Borrador' : 'Enviado',
      prioridad: prioridad === 'urgente' ? 'urgente' : 'normal',
      notas: _texto(notas),
      clave_idempotencia: clave_idempotencia || null,
    });

    await _escribirLineas(client, pedido.id, lineas, { bodegaId, negocioId });

    // El consecutivo se asigna al CREAR, no al enviar: un borrador que ya tiene
    // número se puede nombrar por teléfono, y el hueco que deja un borrador
    // descartado no le importa a nadie — esto no es un documento fiscal. Mismo
    // criterio que la orden de compra.
    pedido.numero = await asignarNumeroDocumento(client, {
      tipo: 'pedido_interno', docId: pedido.id, negocioId,
    });

    await client.query('COMMIT');

    const final = await _leer(negocioId, pedido.id);
    if (final.estado === 'Enviado') _avisarNuevo(negocioId, final, lineas.length);
    return final;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && clave_idempotencia) {
      const previo = await repo.findPorClave(clave_idempotencia);
      if (previo) return { ...(await _leer(negocioId, previo.id)), repetido: true };
    }
    throw err;
  } finally {
    client.release();
  }
};

// El nombre del local sale de la fila ya leída (`_select` lo une), no de `req`:
// el request no lo trae, y pedirlo aparte costaría una consulta para pintar un
// aviso.
const _avisarNuevo = (negocioId, pedido, nLineas) => {
  avisar({
    negocioId,
    sucursalId: Number(pedido.sucursal_bodega_id),
    titulo: pedido.prioridad === 'urgente'
      ? `Pedido URGENTE #${pedido.numero ?? pedido.id}`
      : `Pedido #${pedido.numero ?? pedido.id}`,
    cuerpo: `${pedido.sucursal_nombre || 'Un local'} pide ${nLineas} producto(s)`,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// EDITAR un borrador
//
// Las líneas se reemplazan en bloque: es un borrador, nada cuelga de ellas
// todavía. En cuanto el pedido sale (o le despachan algo) deja de ser editable
// — `lineas_remision.pedido_linea_id` apunta a estas filas y borrarlas
// rompería el vínculo en silencio, con el avance quedándose corto para siempre.
// ─────────────────────────────────────────────────────────────────────────────
const editar = async (req, pedidoId, { lineas, notas, prioridad }) => {
  const negocioId = req.user.negocio_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pedido = await repo.findParaEscribir(client, negocioId, pedidoId);
    if (!pedido) throw { status: 404, message: 'Pedido no encontrado' };
    _exigirAcceso(req, pedido);
    if (Number(pedido.sucursal_id) !== Number(req.sucursal_id)) {
      throw { status: 403, message: 'Solo quien hizo el pedido puede editarlo' };
    }
    if (pedido.estado !== 'Borrador') {
      throw {
        status: 409,
        codigo: 'PEDIDO_NO_EDITABLE',
        message: 'Un pedido ya enviado no se edita. Anúlalo y haz uno nuevo, o pide lo que falte en otro pedido.',
      };
    }

    await repo.actualizarCabecera(client, pedido.id, {
      prioridad: prioridad === 'urgente' ? 'urgente'
               : prioridad === 'normal'  ? 'normal' : null,
      notas: _texto(notas),
    });

    if (lineas !== undefined) {
      await repo.borrarLineas(client, pedido.id);
      await _escribirLineas(client, pedido.id, lineas, {
        bodegaId: Number(pedido.sucursal_bodega_id), negocioId,
      });
    }

    await client.query('COMMIT');
    return _leer(negocioId, pedido.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Enviar: el borrador entra a la bandeja de la bodega ─────────────────────
const enviar = async (req, pedidoId) => {
  const negocioId = req.user.negocio_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pedido = await repo.findParaEscribir(client, negocioId, pedidoId);
    if (!pedido) throw { status: 404, message: 'Pedido no encontrado' };
    _exigirAcceso(req, pedido);
    if (Number(pedido.sucursal_id) !== Number(req.sucursal_id)) {
      throw { status: 403, message: 'Solo quien hizo el pedido puede enviarlo' };
    }
    if (pedido.estado !== 'Borrador') {
      throw { status: 409, message: 'Ese pedido ya fue enviado' };
    }
    const lineas = await repo.getLineas(pedido.id);
    if (!lineas.length) {
      throw { status: 400, message: 'El pedido está vacío' };
    }
    await repo.marcarEnviado(client, pedido.id);
    await client.query('COMMIT');

    const final = await _leer(negocioId, pedido.id);
    _avisarNuevo(negocioId, final, lineas.length);
    return final;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ANULAR — lo hace el LOCAL, y solo mientras no haya salido nada
//
// Con mercancía ya despachada no se anula: esa remisión existe, movió stock y
// va a generar deuda. Anular el pedido dejaría la remisión colgando de un
// documento anulado y el local creyendo que canceló algo que viene en camino.
// Para eso está CERRAR, que deja el pendiente sin atender pero no niega lo que
// ya salió.
// ─────────────────────────────────────────────────────────────────────────────
const anular = async (req, pedidoId, { motivo } = {}) => {
  const negocioId = req.user.negocio_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pedido = await repo.findParaEscribir(client, negocioId, pedidoId);
    if (!pedido) throw { status: 404, message: 'Pedido no encontrado' };
    _exigirAcceso(req, pedido);
    if (Number(pedido.sucursal_id) !== Number(req.sucursal_id)) {
      throw { status: 403, message: 'Solo quien hizo el pedido puede anularlo' };
    }
    if (pedido.estado === 'Anulado') {
      throw { status: 409, message: 'Ese pedido ya está anulado' };
    }
    if (await repo.tieneRemisionesVivas(client, pedido.id)) {
      throw {
        status: 409,
        codigo: 'PEDIDO_CON_ENVIOS',
        message: 'La bodega ya despachó parte de este pedido. Pídele que lo cierre en vez de anularlo.',
      };
    }

    const actualizado = await repo.marcarCerrado(client, pedido.id, {
      estado: 'Anulado', respuesta: _texto(motivo), usuarioId: req.user.id,
    });
    await client.query('COMMIT');

    // La bodega puede tenerlo abierto en su bandeja ahora mismo.
    if (pedido.estado === 'Enviado') {
      avisar({
        negocioId, sucursalId: Number(pedido.sucursal_bodega_id),
        titulo: `Pedido #${actualizado.numero ?? actualizado.id} anulado`,
        cuerpo: _texto(motivo) || 'El local ya no lo necesita',
      });
    }
    return _leer(negocioId, pedido.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CERRAR — lo hace la BODEGA: "esto no va a salir" o "ya está completo"
//
// La `respuesta` no es decorativa: sin ella, cerrar un pedido se ve desde el
// local exactamente igual que ignorarlo, y la siguiente vez el local vuelve a
// pedir lo mismo. Es la misma pieza que el motivo de un abono anulado.
// ─────────────────────────────────────────────────────────────────────────────
const cerrar = async (req, pedidoId, { respuesta } = {}) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pedido = await repo.findParaEscribir(client, negocioId, pedidoId);
    if (!pedido) throw { status: 404, message: 'Pedido no encontrado' };
    _exigirAcceso(req, pedido);
    if (pedido.estado !== 'Enviado') {
      throw { status: 409, message: `No se puede cerrar un pedido en estado "${pedido.estado}"` };
    }

    const actualizado = await repo.marcarCerrado(client, pedido.id, {
      estado: 'Cerrado', respuesta: _texto(respuesta), usuarioId: req.user.id,
    });
    await client.query('COMMIT');

    avisar({
      negocioId, sucursalId: Number(pedido.sucursal_id),
      titulo: `Pedido #${actualizado.numero ?? actualizado.id} cerrado`,
      cuerpo: _texto(respuesta) || 'La bodega dio por atendido tu pedido',
    });
    return _leer(negocioId, pedido.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Deshacer el cierre. Todo error tiene salida: es la misma regla con la que se
// anula un gasto, se revierte una remesa o se mueve un abono al envío correcto.
const reabrir = async (req, pedidoId) => {
  _exigirBodega(req);
  const negocioId = req.user.negocio_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pedido = await repo.findParaEscribir(client, negocioId, pedidoId);
    if (!pedido) throw { status: 404, message: 'Pedido no encontrado' };
    _exigirAcceso(req, pedido);
    if (pedido.estado !== 'Cerrado') {
      throw { status: 409, message: 'Solo se reabre un pedido cerrado' };
    }
    await repo.reabrir(client, pedido.id);
    await client.query('COMMIT');
    return _leer(negocioId, pedido.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LECTURA
// ─────────────────────────────────────────────────────────────────────────────

/** El avance derivado, en las palabras del usuario. No se guarda en ninguna
 *  columna: se calcula cada vez que se lee, para que anular una remisión o
 *  reportar un faltante lo devuelvan solos a "parcial". */
const _avance = (p) => {
  const pedidas     = _num(p.unidades_pedidas);
  const despachadas = _num(p.unidades_despachadas);
  if (!pedidas)                  return 'Vacío';
  if (despachadas <= 0)          return 'Sin despachar';
  if (despachadas >= pedidas)    return 'Despachado';
  return 'Parcial';
};

const _decorar = (p) => ({
  ...p,
  unidades_pedidas:     _num(p.unidades_pedidas),
  unidades_despachadas: _num(p.unidades_despachadas),
  unidades_pendientes:  Math.max(0, _num(p.unidades_pedidas) - _num(p.unidades_despachadas)),
  avance: _avance(p),
});

// TODA salida del módulo pasa por aquí: las escrituras devuelven el pedido con
// la misma forma que las lecturas. Sin esto, la pantalla que crea un pedido
// recibía uno sin `avance` ni `unidades_pendientes` y la que lo listaba sí —
// dos contratos para el mismo objeto es exactamente como se rompe una UI.
const _leer = async (negocioId, pedidoId) => _decorar(await repo.findById(negocioId, pedidoId));

const listar = async (req, { estado, sucursal, abiertos, q, limit } = {}) => {
  const negocioId = req.user.negocio_id;
  const tope = Math.min(Number(limit) || 50, 200);

  // Aislamiento en la CONSULTA, no en el filtro de después: un local nunca
  // pide la lista de otro, ni "sin querer" con un query param.
  const base = req.esBodega
    ? { bodegaId: Number(req.sucursal_id),
        sucursalId: sucursal ? Number(sucursal) : null }
    : { sucursalId: Number(req.sucursal_id) };

  // "Abiertos" = lo que de verdad espera acción: enviado y con algo pendiente.
  // Es lo que hace que la bandeja de la bodega se vacíe sola al despachar y
  // vuelva a llenarse si esa remisión se anula o el local reporta un faltante.
  //
  // El borrador de un local no existe para la bodega: `findAll` filtra por
  // `sucursal_bodega_id`, así que sí los traería — es `estados` quien los deja
  // fuera cuando quien pregunta no es su autor.
  const filas = await repo.findAll(negocioId, {
    ...base,
    ...(abiertos
      ? { estado: 'Enviado', soloConPendiente: true }
      : { estado: estado || null,
          estados: req.esBodega ? ['Enviado', 'Cerrado', 'Anulado'] : null }),
    busqueda: q ? String(q).slice(0, 60) : null,
    limit: tope,
  });

  return filas.map(_decorar);
};

const getPedido = async (req, pedidoId) => {
  const negocioId = req.user.negocio_id;
  const pedido = await repo.findById(negocioId, pedidoId);
  if (!pedido) throw { status: 404, message: 'Pedido no encontrado' };
  _exigirAcceso(req, pedido);

  const [lineas, remisiones] = await Promise.all([
    repo.getLineas(pedido.id),
    repo.getRemisiones(negocioId, pedido.id),
  ]);

  return {
    ..._decorar(pedido),
    lineas: lineas.map((l) => ({
      ...l,
      despachada: _num(l.despachada),
      pendiente:  _num(l.pendiente),
      // La etiqueta del nodo se arma con lo que hay HOY (la talla puede haberse
      // renombrado); `nombre_producto` es lo que se pidió y no se toca.
      nodo_label: [l.atributo_valor, l.variante_valor].filter(Boolean).join(' / ') || null,
    })),
    // Las remisiones traen `valor_total`, que es la valorización de la
    // mercancía. Aquí NO se recorta a propósito: es la misma cifra que el local
    // ya ve en su cuenta —es su deuda por ese envío, no el costo de la bodega—
    // y `_recortarParaVendedor` la conserva por esa misma razón.
    remisiones,
  };
};

/**
 * Catálogo de la bodega, para que el local arme el pedido.
 *
 * SIN COSTOS. El costo de la bodega es justo lo que `red_interna_ocultar_costos`
 * y `costos_solo_admin` esconden, y aquí ni siquiera se selecciona: recortarlo
 * después es lo que deja el dato viajando en el JSON. Ver `_sqlNodosCantidad`.
 *
 * Los seriales se piden por REFERENCIA (modelo + cuántos), nunca por IMEI:
 * quién tiene los IMEI es la bodega y el local no puede saber cuál le van a
 * mandar — igual que una orden de compra pide modelo y la recepción captura las
 * unidades reales.
 */
const catalogo = async (req, q = '') => {
  _exigirLocal(req);
  const negocioId = req.user.negocio_id;
  const bodegaId  = Number(req.red.bodega_id);
  const texto     = String(q || '').trim();

  const [seriales, cantidad] = await Promise.all([
    redRepo.buscarReferencias(negocioId, bodegaId, 'serial', texto),
    redRepo.buscarCantidadParaPedido(negocioId, bodegaId, texto),
  ]);

  return [
    ...seriales.map((s) => ({
      tipo: 'serial',
      producto_id: s.id,
      atributo_id: null, variante_id: null, variante_label: null,
      nombre: [s.nombre, s.marca, s.modelo].filter(Boolean).join(' '),
      nombre_base: s.nombre,
      codigo: null,
      // Cuántas hay hoy en la bodega. Es información de disponibilidad, no un
      // costo: sirve para saber si hay que esperar, y por eso sí viaja.
      disponibles: Number(s.disponibles || 0),
      linea_nombre: s.linea_nombre || null,
    })),
    ...cantidad.map((p) => ({
      tipo: 'cantidad',
      producto_id: p.producto_id,
      atributo_id: p.atributo_id ?? null,
      variante_id: p.variante_id ?? null,
      variante_label: p.variante_label ?? null,
      nombre: p.variante_label ? `${p.nombre} / ${p.variante_label}` : p.nombre,
      nombre_base: p.nombre,
      codigo: p.codigo || null,
      disponibles: Number(p.stock || 0),
      unidad_medida: p.unidad_medida || 'unidad',
      linea_nombre: p.linea_nombre || null,
    })),
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
// ATRIBUCIÓN AL DESPACHAR — lo llama `redInterna.service.despachar`
//
// Une cada línea que sale con la línea del pedido que la pedía. Se hace en el
// BACKEND y no en la pantalla a propósito: el despacho puede salir desde el
// modal del pedido, desde el carrito de inventario o desde el escáner, y las
// tres tienen que atribuir igual. Una pantalla que se olvide de mandar el
// vínculo dejaría el pedido pidiendo para siempre algo que ya salió.
//
// Cascada, de lo más específico a lo más general:
//   1. el `pedido_linea_id` que mandó la pantalla (validado contra el pedido);
//   2. el mismo NODO exacto (producto + atributo + variante);
//   3. el mismo PRODUCTO cuando el pedido no bajó a la talla — se pidió "la
//      correa" y la bodega despacha la 38MM, que es la respuesta correcta.
//
// La capacidad pendiente se consume a medida que se reparte, para que dos
// líneas del despacho no se coman la misma línea del pedido. Cuando ya no queda
// pendiente se atribuye igual a la primera que calce: despachar de más es
// legítimo, y dejar esa línea huérfana haría que el pedido siguiera abierto.
// ─────────────────────────────────────────────────────────────────────────────
const abrirAtribucion = async (client, { negocioId, pedidoId, destinoId, bodegaId }) => {
  const pedido = await repo.findParaEscribir(client, negocioId, pedidoId);
  if (!pedido) throw { status: 404, message: 'Pedido no encontrado' };
  if (Number(pedido.sucursal_bodega_id) !== Number(bodegaId)) {
    throw { status: 403, message: 'Ese pedido no es para esta bodega' };
  }
  if (Number(pedido.sucursal_id) !== Number(destinoId)) {
    throw {
      status: 400,
      message: 'El pedido es de otro local. Despacha al local que lo pidió, o despacha sin pedido.',
    };
  }
  if (pedido.estado === 'Anulado') {
    throw { status: 409, message: 'Ese pedido está anulado' };
  }
  if (pedido.estado === 'Borrador') {
    throw { status: 409, message: 'Ese pedido todavía no se ha enviado' };
  }

  const pendientes = (await repo.getLineasPendientes(client, pedido.id))
    .map((l) => ({ ...l, restante: Number(l.pendiente) }));

  const _calza = (l, { tipo, productoId, atributoId, varianteId }) => {
    if (l.tipo !== tipo) return false;
    if (l.producto_id == null) return false;          // texto libre: no se atribuye solo
    if (Number(l.producto_id) !== Number(productoId)) return false;
    if (tipo === 'serial') return true;
    // Nodo exacto, o el pedido pidió el nivel de arriba.
    const mismoAtributo = l.atributo_id == null
      || Number(l.atributo_id) === Number(atributoId ?? -1);
    const mismaVariante = l.variante_id == null
      || Number(l.variante_id) === Number(varianteId ?? -1);
    return mismoAtributo && mismaVariante;
  };

  return {
    pedido,
    /**
     * Devuelve el `pedido_linea_id` de una línea que sale, o null si no la
     * pedía nadie (la bodega agregó algo de su cosecha, que es legítimo).
     */
    atribuir({ tipo, productoId, atributoId = null, varianteId = null, unidades = 1, explicita = null }) {
      if (explicita != null) {
        const l = pendientes.find((x) => Number(x.id) === Number(explicita));
        if (!l) throw { status: 400, message: 'Esa línea no pertenece a este pedido' };
        l.restante = Math.max(0, l.restante - unidades);
        return l.id;
      }
      const candidatos = pendientes.filter((l) => _calza(l, { tipo, productoId, atributoId, varianteId }));
      if (!candidatos.length) return null;
      const elegida = candidatos.find((l) => l.restante > 0) || candidatos[0];
      elegida.restante = Math.max(0, elegida.restante - unidades);
      return elegida.id;
    },
  };
};

/**
 * "Responde al pedido #N", para la ficha de una remisión.
 *
 * Devuelve null ante cualquier problema en vez de lanzar: es un rótulo. Que la
 * migración de pedidos no haya llegado a aplicarse no puede dejar sin abrir el
 * detalle de un envío, que es una pantalla que ya existía.
 */
const etiquetaDe = async (negocioId, pedidoId) => {
  if (!pedidoId) return null;
  try {
    return await repo.findEtiqueta(negocioId, pedidoId);
  } catch {
    return null;
  }
};

module.exports = {
  crear, editar, enviar, anular, cerrar, reabrir,
  listar, getPedido, catalogo, etiquetaDe,
  abrirAtribucion,
  contarPendientes: repo.contarPendientes,
};
