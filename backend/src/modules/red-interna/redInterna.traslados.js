// ─────────────────────────────────────────────────────────────────────────────
// TRASLADOS ENTRE SEDES PROPIAS (20261030_traslados_internos.sql)
//
// Tesla (oct-2026): la bodega surte a dos locales que le PAGAN lo que reciben
// (Bunny, Camilo) y a su propia tienda, que no le debe nada. Hasta hoy la
// tienda se «pagaba a sí misma» cada envío para que la cuenta cuadrara.
//
// Un traslado es una remisión de tipo 'traslado'. No hay un circuito nuevo de
// mercancía: el documento, la recepción (con o sin confirmar), los faltantes,
// el movimiento por NODO (la talla, no el producto), la referencia que se crea
// en el destino y la reserva de lo que va en camino son los MISMOS del
// despacho. Lo distinto es la plata, y es lo que este archivo cuida:
//
//   · NO genera cuenta. Las líneas van con `valor_interno = 0` —aunque un
//     lector olvidara filtrar por tipo, un traslado sumaría $0 de deuda— y el
//     costo real va en `costo_origen`, que es lo que entra al destino.
//   · NO lleva precio ni costo hacia la pantalla. Lo ve solo el admin, y solo
//     en el detalle: la guía que viaja con la mercancía no tiene un peso.
//   · Un local con cuenta nunca participa (redInterna.traslados.reglas.js).
//
// Quién: TRASLADAR exige el módulo «Traslados» de Ajustes → Usuarios (el que
// ya daba los traslados libres: el supervisor lo trae por defecto, al vendedor
// se le marca). RECIBIR, como una remisión: cualquiera de la sucursal destino
// con el módulo «Bodega». Anular: quien puede trasladar, desde el origen.
// ─────────────────────────────────────────────────────────────────────────────

const { pool } = require('../../config/db');
const repo     = require('./redInterna.repository');
const reglas   = require('./redInterna.traslados.reglas');
const { avisar } = require('./redInterna.avisos');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');
const { exigirNoEnTecnico }      = require('../../utils/serialEnTecnico.util');
const { exigirNoEnGarantia }     = require('../../utils/serialEnGarantia.util');
const { hayTrasladosInternos }   = require('../../config/columnas');

// El service principal se pide al usarlo: él requiere este archivo para avisar
// la recepción, y un require circular en la carga dejaría uno de los dos vacío.
const _service  = () => require('./redInterna.service');
const _internos = () => _service()._internos;

const etiqueta = (r) => `T-${r.numero ?? r.id}`;

// ── Candados ────────────────────────────────────────────────────────────────

const _red = (req) => (hayTrasladosInternos() ? req.red : { ...req.red, sedes_propias: [] });

/** 404 si el negocio no tiene sedes propias (o falta la migración). */
const exigirActivos = (req) => {
  if (!hayTrasladosInternos()) {
    throw { status: 404, message: 'Los traslados entre sedes no están instalados en la base de datos' };
  }
  if (!reglas.trasladosActivos(req.red)) {
    throw { status: 404, message: 'Este negocio no tiene sedes propias configuradas (Ajustes → Bodega)' };
  }
};

const _exigirTipo = (r) => {
  if (!r) throw { status: 404, message: 'Traslado no encontrado' };
  if (r.tipo !== 'traslado') throw { status: 404, message: 'Traslado no encontrado' };
};

// ── Formato sin plata ───────────────────────────────────────────────────────
// Lo que viaja a la pantalla del traslado. Los buscadores del repositorio
// traen costo y precio (los comparte el despacho): aquí se arma el objeto
// campo por campo, así ninguna clave monetaria se cuela por un spread.

const _serialSinValor = (s) => ({
  tipo: 'serial',
  serial_id: Number(s.serial_id),
  imei: s.imei,
  producto_id: Number(s.producto_id),
  nombre: [s.nombre, s.marca, s.modelo].filter(Boolean).join(' '),
  cantidad: 1,
});

const _cantidadSinValor = (p) => ({
  tipo: 'cantidad',
  producto_id: Number(p.producto_id),
  atributo_id: p.atributo_id != null ? Number(p.atributo_id) : null,
  variante_id: p.variante_id != null ? Number(p.variante_id) : null,
  variante_label: p.variante_label ?? null,
  codigo: p.codigo || null,
  nombre: p.variante_label ? `${p.nombre} / ${p.variante_label}` : p.nombre,
  nombre_base: p.nombre,
  unidad_medida: p.unidad_medida || 'unidad',
  stock: Number(p.stock || 0),
  cantidad: 1,
});

/**
 * ¿Una remisión viva le impide a este equipo salir por traslado? La misma
 * regla que aplica `trasladar` (la pantalla no puede descartar lo que el
 * backend dejaría pasar, ni al revés): lo ata cualquier línea pendiente o
 * una entrega recibida, salvo la entrega vieja a ESTA sede si ya es propia.
 */
const _atadoParaTraslado = async (s, origenId, red) => {
  if (!s.ya_remisionado) return false;
  const { rows } = await pool.query(`
    SELECT r.tipo, lr.estado_linea, r.sucursal_destino_id
    FROM lineas_remision lr JOIN remisiones r ON r.id = lr.remision_id
    WHERE lr.serial_id = $1 AND ${repo.SQL_LINEA_VIVA('lr')}
    LIMIT 1
  `, [s.serial_id]);
  const a = rows[0];
  if (!a) return false;
  return !(a.tipo === 'entrega' && a.estado_linea === 'Recibida'
    && Number(a.sucursal_destino_id) === Number(origenId) && reglas.esSedePropia(red, origenId));
};

// ─────────────────────────────────────────────────────────────────────────────
// PREPARAR — del carrito (o el escáner) a las líneas del traslado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo mismo que hace el despacho con el carrito, pero desde la sucursal en la
 * que se está (puede ser la bodega o una sede propia) y sin un peso en la
 * respuesta. Lo que no se puede trasladar vuelve en `descartados` con su razón;
 * un producto con tallas sin talla elegida vuelve en `sin_variante`, para que
 * la pantalla la pida en la misma línea.
 */
const resolver = async (req, items) => {
  exigirActivos(req);
  if (!Array.isArray(items) || !items.length) throw { status: 400, message: 'No hay productos para trasladar' };
  const negocioId  = req.user.negocio_id;
  const sucursalId = Number(req.sucursal_id);

  const resueltos = [], descartados = [], sinVariante = [];
  for (const it of items) {
    if (it.tipo === 'serial' && it.serial_id) {
      const s = await repo.findSerialById(negocioId, sucursalId, Number(it.serial_id));
      if (!s)               { descartados.push({ nombre: it.nombre || 'Equipo', motivo: 'no está en esta sucursal' }); continue; }
      if (s.vendido)        { descartados.push({ nombre: s.imei, motivo: 'ya fue vendido' }); continue; }
      if (s.prestado)       { descartados.push({ nombre: s.imei, motivo: 'está prestado' }); continue; }
      if (await _atadoParaTraslado(s, sucursalId, _red(req))) {
        descartados.push({ nombre: s.imei, motivo: 'va en camino o está en la cuenta de un local' });
        continue;
      }
      resueltos.push(_serialSinValor(s));
    } else if (it.tipo === 'cantidad' && it.producto_id) {
      const p = await repo.findNodoCantidadById(negocioId, sucursalId, {
        productoId: Number(it.producto_id),
        atributoId: it.atributo_id ? Number(it.atributo_id) : null,
        varianteId: it.variante_id ? Number(it.variante_id) : null,
      });
      if (!p) { descartados.push({ nombre: it.nombre || 'Producto', motivo: 'no está en esta sucursal' }); continue; }
      const pedida = Math.max(1, Number(it.cantidad) || 1);
      if (p.tiene_variantes) {
        sinVariante.push({ producto_id: Number(p.producto_id), nombre: p.nombre, cantidad: pedida });
        continue;
      }
      if (Number(p.stock) <= 0) {
        descartados.push({ nombre: p.variante_label ? `${p.nombre} / ${p.variante_label}` : p.nombre, motivo: 'sin stock' });
        continue;
      }
      resueltos.push({ ..._cantidadSinValor(p), cantidad: Math.min(pedida, Number(p.stock)) });
    } else {
      descartados.push({ nombre: it.nombre || 'Producto', motivo: 'tipo no reconocido' });
    }
  }
  return { items: resueltos, descartados, sin_variante: sinVariante };
};

/**
 * Un solo campo para el lector y para escribir. Un IMEI o un código exacto
 * devuelven `item` (se agrega de una); un texto devuelve `opciones` (nodos con
 * stock, ya en la HOJA: un contenedor con tallas no se traslada).
 */
const buscar = async (req, texto) => {
  exigirActivos(req);
  const q = String(texto || '').trim();
  if (q.length < 2) throw { status: 400, message: 'Escribe al menos 2 caracteres' };
  const negocioId  = req.user.negocio_id;
  const sucursalId = Number(req.sucursal_id);

  const [s, p] = await Promise.all([
    repo.buscarSerialDisponible(negocioId, sucursalId, q),
    repo.buscarCantidadPorCodigo(negocioId, sucursalId, q),
  ]);
  const atado = s ? await _atadoParaTraslado(s, sucursalId, _red(req)) : false;
  if (s && !s.vendido && !s.prestado && !atado) return { item: _serialSinValor(s) };
  if (p && Number(p.stock) > 0) return { item: _cantidadSinValor(p) };
  if (s) {
    const motivo = s.vendido ? 'ya fue vendido' : s.prestado ? 'está prestado' : 'va en camino o está en la cuenta de un local';
    throw { status: 409, message: `El equipo ${s.imei} ${motivo}` };
  }
  if (p) throw { status: 409, message: `"${p.nombre}" no tiene stock en esta sucursal` };

  const opciones = (await repo.buscarCantidadDisponible(negocioId, sucursalId, q)).map(_cantidadSinValor);
  return { opciones };
};

/**
 * ¿A qué producto del destino va cada línea? La MISMA revisión del despacho
 * (`referencias.resolver`: código → nombre igual → nombre PARECIDO), para no
 * duplicar el catálogo de la otra sede: lo que no se empareja con seguridad se
 * le pregunta al usuario antes de trasladar, y su respuesta viaja en
 * `producto_destino_id`. Solo lee; no trae ni costo ni precio.
 */
const previsualizar = async (req, { sucursal_destino_id, lineas }) => {
  exigirActivos(req);
  const negocioId = req.user.negocio_id;
  const origenId  = Number(req.sucursal_id);
  const destinoId = Number(sucursal_destino_id);
  const invalida = reglas.motivoRutaInvalida(_red(req), origenId, destinoId);
  if (invalida) throw { status: 409, code: 'RUTA_TRASLADO', message: invalida };
  if (!Array.isArray(lineas) || !lineas.length) throw { status: 400, message: 'No hay productos para revisar' };
  if (lineas.length > 400) throw { status: 400, message: 'Un traslado admite hasta 400 líneas' };
  await _internos().verificarSucursal(null, destinoId, negocioId);

  // Solo lo que de verdad está en esta sucursal: sin esto, un id ajeno haría
  // que la revisión devolviera el nombre de un producto de otra sede.
  const seriales  = lineas.filter((l) => l.tipo === 'serial').map((l) => Number(l.serial_id)).filter(Boolean);
  const productos = lineas.filter((l) => l.tipo !== 'serial').map((l) => Number(l.producto_id)).filter(Boolean);
  const [{ rows: sOk }, { rows: pOk }] = await Promise.all([
    pool.query(`SELECT s.id FROM seriales s JOIN productos_serial ps ON ps.id = s.producto_id
                WHERE ps.sucursal_id = $1 AND s.id = ANY($2::int[])`, [origenId, seriales]),
    pool.query(`SELECT id FROM productos_cantidad WHERE sucursal_id = $1 AND id = ANY($2::int[])`, [origenId, productos]),
  ]);
  const okS = new Set(sOk.map((r) => Number(r.id)));
  const okP = new Set(pOk.map((r) => Number(r.id)));
  const validas = lineas.filter((l) => (l.tipo === 'serial' ? okS.has(Number(l.serial_id)) : okP.has(Number(l.producto_id))));
  if (!validas.length) throw { status: 404, message: 'Ninguno de los productos está en esta sucursal' };
  return _internos().previsualizarLineas(negocioId, destinoId, validas.map((l) => ({
    tipo: l.tipo === 'serial' ? 'serial' : 'cantidad',
    serial_id: l.serial_id || null, producto_id: l.producto_id || null,
    cantidad: l.cantidad || 1, nombre: l.nombre || null,
  })));
};

/**
 * «Buscar otra» de la revisión: el catálogo del DESTINO para elegir a mano.
 * Solo de un destino válido para este traslado, y sin plata (id, nombre,
 * código, stock y línea, lo mismo que ya lee la revisión del despacho).
 */
const referenciasDestino = async (req, { sucursalId, tipo, q }) => {
  exigirActivos(req);
  const destinoId = Number(sucursalId);
  const invalida = reglas.motivoRutaInvalida(_red(req), Number(req.sucursal_id), destinoId);
  if (invalida) throw { status: 409, code: 'RUTA_TRASLADO', message: invalida };
  await _internos().verificarSucursal(null, destinoId, req.user.negocio_id);
  return repo.buscarReferencias(req.user.negocio_id, destinoId, tipo === 'serial' ? 'serial' : 'cantidad', q || '');
};

// ─────────────────────────────────────────────────────────────────────────────
// TRASLADAR — emite el documento y, sin confirmación, lo recibe ahí mismo
// ─────────────────────────────────────────────────────────────────────────────

const trasladar = async (req, { sucursal_destino_id, lineas, notas, clave_idempotencia }) => {
  exigirActivos(req);
  const red       = _red(req);
  const negocioId = req.user.negocio_id;
  const origenId  = Number(req.sucursal_id);
  const destinoId = Number(sucursal_destino_id);
  const I = _internos();

  const invalida = reglas.motivoRutaInvalida(red, origenId, destinoId);
  if (invalida) throw { status: 409, code: 'RUTA_TRASLADO', message: invalida };
  if (!Array.isArray(lineas) || !lineas.length) throw { status: 400, message: 'Agrega al menos un producto' };
  if (lineas.length > 400) throw { status: 400, message: 'Un traslado admite hasta 400 líneas: pártelo en dos' };
  await I.verificarSucursal(null, origenId, negocioId);
  await I.verificarSucursal(null, destinoId, negocioId);

  // Un mismo IMEI dos veces en la lista lo frenaría el índice único con un
  // error de base de datos; se dice antes y con el IMEI.
  const vistos = new Set();
  for (const l of lineas) {
    if (l.tipo !== 'serial') continue;
    const k = Number(l.serial_id);
    if (vistos.has(k)) throw { status: 400, message: 'El mismo equipo está dos veces en el traslado' };
    vistos.add(k);
  }

  if (clave_idempotencia) {
    const previa = await repo.findRemisionPorClave(clave_idempotencia);
    if (previa) return { ...previa, repetido: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const remision = await repo.crearRemision(client, {
      negocio_id: negocioId, tipo: 'traslado',
      sucursal_origen_id: origenId, sucursal_destino_id: destinoId,
      usuario_emisor_id: req.user.id, clave_idempotencia, notas,
      estado: 'En transito',
    });

    let unidades = 0;
    const liberadas = [];   // equipos que salen de un envío viejo (ver abajo)
    for (const l of lineas) {
      if (l.tipo === 'serial') {
        const { rows } = await client.query(`
          SELECT s.id, s.imei, s.vendido, s.prestado, s.costo_compra,
                 ps.id AS producto_id, ps.nombre, ps.marca, ps.modelo
          FROM seriales s
          JOIN productos_serial ps ON ps.id = s.producto_id
          WHERE s.id = $1 AND ps.sucursal_id = $2
          FOR UPDATE OF s
        `, [l.serial_id, origenId]);
        if (!rows.length) throw { status: 404, message: 'Uno de los equipos ya no está en esta sucursal. Actualiza y vuelve a intentar.' };
        const s = rows[0];
        if (s.vendido)  throw { status: 400, message: `El equipo ${s.imei} ya fue vendido` };
        if (s.prestado) throw { status: 400, message: `El equipo ${s.imei} está prestado` };
        await exigirNoEnTecnico(client, s.id, s.imei);
        await exigirNoEnGarantia(client, s.id, s.imei);

        // ¿Lo ata otra remisión? Una que va en camino, siempre. Una ENTREGA
        // recibida significa que el equipo está en la cuenta de un local: sacarlo
        // por traslado lo sacaría de esa cuenta sin devolución.
        const { rows: atado } = await client.query(`
          SELECT r.tipo, lr.id AS linea_id, lr.estado_linea, lr.valor_interno,
                 r.sucursal_destino_id,
                 COALESCE(r.numero, r.id) AS numero, sd.nombre AS destino
          FROM lineas_remision lr
          JOIN remisiones r  ON r.id  = lr.remision_id
          JOIN sucursales sd ON sd.id = r.sucursal_destino_id
          WHERE lr.serial_id = $1 AND ${repo.SQL_LINEA_VIVA('lr')}
          LIMIT 1
        `, [s.id]);
        // El único caso que se deja pasar: el equipo llegó por DESPACHO a esta
        // sede cuando todavía era un local, y la sede ya es propia (su cuenta
        // se cerró en $0). Sin esto quedaría atado a ese envío para siempre: la
        // sede propia no devuelve por la cuenta, y la bodega no lo podría volver
        // a despachar. Se libera la línea vieja y se compensa abajo para que
        // la cuenta NO se mueva.
        const a0 = atado[0];
        if (a0 && a0.tipo === 'entrega' && a0.estado_linea === 'Recibida'
            && Number(a0.sucursal_destino_id) === origenId && reglas.esSedePropia(red, origenId)) {
          await client.query(`UPDATE lineas_remision SET estado_linea = 'Devuelta' WHERE id = $1`, [a0.linea_id]);
          liberadas.push({ imei: s.imei, envio: a0.numero, valor: Number(a0.valor_interno || 0) });
          atado.length = 0;
        }
        if (atado.length) {
          const a = atado[0];
          throw {
            status: 409,
            message: a.estado_linea === 'Pendiente'
              ? `El equipo ${s.imei} ya va en camino (${a.tipo === 'traslado' ? `traslado T-${a.numero}` : `${a.tipo === 'devolucion' ? 'devolución' : 'envío'} #${a.numero}`})`
              : `El equipo ${s.imei} está en la cuenta de ${a.destino} por el envío #${a.numero}: vuelve a la bodega con «Devolver», no por traslado`,
          };
        }

        const destinoSerial = await I.destinoElegido(client, {
          tipo: 'serial', productoOrigenId: s.producto_id,
          sucursalDestinoId: destinoId, eleccionUsuario: l.producto_destino_id,
        });
        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'serial',
          serial_id: s.id, imei: s.imei,
          producto_origen_id: s.producto_id,
          producto_destino_id: destinoSerial,
          // Sin cuenta: el valor de la línea es 0 a propósito. El costo del
          // equipo viaja con él (`seriales.costo_compra` no se toca).
          valor_interno: 0,
          costo_origen: s.costo_compra ?? null,
          estado_linea: 'Pendiente',
          nombre_producto: [s.nombre, s.marca, s.modelo].filter(Boolean).join(' '),
        });
        unidades += 1;

      } else if (l.tipo === 'cantidad') {
        const cant = Number(l.cantidad);
        if (!Number.isInteger(cant) || cant < 1) throw { status: 400, message: 'Cantidad inválida' };

        // El stock se mueve en la HOJA: con tallas, el del producto es un
        // derivado (lo mismo que exige el despacho).
        const nodo = await I.resolverNodoOrigen(client, {
          productoId: l.producto_id, atributoId: l.atributo_id,
          varianteId: l.variante_id, sucursalId: origenId,
        });
        if (nodo.stock < cant) {
          throw { status: 400, message: `Stock insuficiente de "${nodo.etiqueta}". Hay ${nodo.stock}, pides ${cant}` };
        }
        // Lo que ya va en otro envío o traslado sin recibir sigue contado en
        // `stock`: se resta, igual que al despachar.
        const comprometido = await I.comprometidoSinRecibir(client, { sucursalOrigenId: origenId, nodo });
        if (nodo.stock - comprometido.unidades < cant) {
          const libres = Math.max(0, nodo.stock - comprometido.unidades);
          throw {
            status: 400, code: 'STOCK_COMPROMETIDO',
            message: `Stock insuficiente de "${nodo.etiqueta}". Hay ${nodo.stock}, pero ${comprometido.unidades} `
              + `ya ${comprometido.unidades === 1 ? 'va' : 'van'} en camino: quedan ${libres} y pides ${cant}`,
          };
        }

        const destinoCantidad = await I.destinoElegido(client, {
          tipo: 'cantidad', productoOrigenId: nodo.productoId,
          sucursalDestinoId: destinoId, eleccionUsuario: l.producto_destino_id,
        });
        if (destinoCantidad) {
          await I.exigirFormaCompatible(client, {
            productoDestinoId: destinoCantidad, sucursalDestinoId: destinoId,
            atributoValor: nodo.atributoValor, varianteValor: nodo.varianteValor,
          });
        }
        await repo.insertarLineaRemision(client, {
          remision_id: remision.id, tipo: 'cantidad',
          producto_origen_id: nodo.productoId, cantidad: cant,
          producto_destino_id: destinoCantidad,
          atributo_origen_id: nodo.atributoId,
          variante_origen_id: nodo.varianteId,
          valor_interno: 0,
          // El costo del nodo HOY: es un promedio que se mueve con cada compra,
          // y es lo que entra al promedio del destino al recibir.
          costo_origen: nodo.costo ?? null,
          estado_linea: 'Pendiente',
          nombre_producto: nodo.etiqueta,
        });
        unidades += cant;
      } else {
        throw { status: 400, message: `Tipo de línea inválido: ${l.tipo}` };
      }
    }

    // Consecutivo PROPIO: un traslado no consume números de los envíos.
    await asignarNumeroDocumento(client, { tipo: 'traslado_interno', docId: remision.id, negocioId });

    // Liberar la línea vieja de un envío baja su cargo (cuenta solo lo
    // 'Recibida'), o sea que le dejaría a la sede un saldo a favor que nadie
    // pidió. Un cargo por lo mismo, que ese saldo consume en el acto, deja la
    // cuenta exactamente donde estaba —en $0— con el rastro de por qué.
    const valorLiberado = Math.round(liberadas.reduce((acc, x) => acc + x.valor, 0) * 100) / 100;
    if (valorLiberado > 0) {
      const numeroT = (await repo.findRemisionById(negocioId, remision.id, client)).numero ?? remision.id;
      await repo.insertarMovimientoCuenta(client, {
        negocio_id: negocioId, sucursal_id: origenId, tipo: 'Ajuste', valor: -valorLiberado,
        concepto: `Traslado T-${numeroT}: ${liberadas.length} equipo(s) que llegaron por despacho salen ahora por `
          + `traslado (${liberadas.map((x) => `${x.imei} del envío #${x.envio}`).join(', ').slice(0, 300)}). `
          + 'Compensa la línea liberada: la cuenta no cambia.',
        usuario_id: req.user.id,
      });
      await I.aplicarSaldoAFavor(client, { negocioId, sucursalId: origenId, usuarioId: req.user.id });
    }

    let final = await repo.findRemisionById(negocioId, remision.id, client);
    let recepcion = null;
    // Sin confirmación (el defecto), entra al destino en la MISMA transacción:
    // o queda todo hecho, o no queda nada.
    if (!red.traslados_confirmar) {
      const { rows: lineasR } = await client.query(
        `SELECT * FROM lineas_remision WHERE remision_id = $1 ORDER BY id`, [remision.id]
      );
      recepcion = await I.ejecutarRecepcion(client, {
        negocioId, remision: final, lineas: lineasR,
        recibidasIds: lineasR.map((x) => Number(x.id)),
        cantidadesRecibidas: {}, usuarioId: req.user.id,
      });
      final = await repo.findRemisionById(negocioId, remision.id, client);
    }

    await client.query('COMMIT');

    avisar({
      negocioId, sucursalId: destinoId,
      titulo: recepcion
        ? `Traslado ${etiqueta(final)} recibido de ${final.sucursal_origen_nombre}`
        : `Traslado ${etiqueta(final)} en camino`,
      cuerpo: recepcion
        ? `${unidades} unidad(es) ya están en tu inventario`
        : `${unidades} unidad(es) desde ${final.sucursal_origen_nombre} · revisa y confirma al llegar`,
    });

    return { ...final, unidades, recibido_directo: !!recepcion };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && clave_idempotencia) {
      const previa = await repo.findRemisionPorClave(clave_idempotencia);
      if (previa) return { ...previa, repetido: true };
    }
    if (err.code === '23505') {
      throw { status: 409, message: 'Uno de los equipos ya va en otro traslado. Actualiza y vuelve a intentar.' };
    }
    throw err;
  } finally {
    client.release();
  }
};

/** La recepción la hace `service.recibir` (la de siempre); aquí solo el aviso. */
const avisarRecibido = (negocioId, remision, res) => {
  avisar({
    negocioId, sucursalId: Number(remision.sucursal_origen_id),
    titulo: `${remision.sucursal_destino_nombre || 'El destino'} recibió el traslado ${etiqueta(remision)}`,
    cuerpo: res.faltantes
      ? `${res.recibidas} producto(s) llegaron · ${res.faltantes} no llegaron y siguen en tu inventario`
      : `${res.recibidas} producto(s) llegaron completos`,
  });
};

const anular = async (req, id) => {
  exigirActivos(req);
  const r = await repo.findRemisionById(req.user.negocio_id, id);
  _exigirTipo(r);
  if (Number(r.sucursal_origen_id) !== Number(req.sucursal_id)) {
    throw { status: 403, message: 'Solo la sucursal que lo envió puede anular el traslado' };
  }
  const res = await _service().anularRemision(req, id);
  avisar({
    negocioId: req.user.negocio_id, sucursalId: Number(r.sucursal_destino_id),
    titulo: `Traslado ${etiqueta(r)} anulado`,
    cuerpo: `${r.sucursal_origen_nombre} lo anuló antes de que llegara: no recibas esa mercancía`,
  });
  return res;
};

// ─────────────────────────────────────────────────────────────────────────────
// LECTURAS
// ─────────────────────────────────────────────────────────────────────────────

const _sqlLista = `
  SELECT r.id, r.numero, r.tipo, r.estado, r.notas,
         r.sucursal_origen_id, r.sucursal_destino_id,
         r.fecha_emision, r.fecha_recepcion,
         so.nombre AS sucursal_origen_nombre, sd.nombre AS sucursal_destino_nombre,
         ue.nombre AS usuario_emisor_nombre, ur.nombre AS usuario_receptor_nombre,
         COALESCE(li.lineas, 0)::int AS lineas,
         COALESCE(li.unidades, 0)::int AS unidades,
         COALESCE(li.recibidas, 0)::int AS unidades_recibidas,
         COALESCE(li.faltantes, 0)::int AS lineas_faltantes,
         li.productos
  FROM remisiones r
  JOIN sucursales so    ON so.id = r.sucursal_origen_id
  JOIN sucursales sd    ON sd.id = r.sucursal_destino_id
  LEFT JOIN usuarios ue ON ue.id = r.usuario_emisor_id
  LEFT JOIN usuarios ur ON ur.id = r.usuario_receptor_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS lineas,
           SUM(CASE WHEN lr.tipo = 'serial' THEN 1 ELSE lr.cantidad END) AS unidades,
           SUM(CASE WHEN lr.estado_linea <> 'Recibida' THEN 0
                    WHEN lr.tipo = 'serial' THEN 1
                    ELSE COALESCE(lr.cantidad_recibida, lr.cantidad) END) AS recibidas,
           COUNT(*) FILTER (WHERE lr.estado_linea = 'Faltante') AS faltantes,
           STRING_AGG(lr.nombre_producto, ', ' ORDER BY lr.id) AS productos
    FROM lineas_remision lr WHERE lr.remision_id = r.id
  ) li ON TRUE
  WHERE r.negocio_id = $1 AND r.tipo = 'traslado'`;

const listar = async (req, { estado, limit, sentido } = {}) => {
  exigirActivos(req);
  const params = [req.user.negocio_id, Number(req.sucursal_id)];
  let cond = sentido === 'entrada' ? ' AND r.sucursal_destino_id = $2'
    : sentido === 'salida' ? ' AND r.sucursal_origen_id = $2'
      : ' AND (r.sucursal_origen_id = $2 OR r.sucursal_destino_id = $2)';
  if (['En transito', 'Recibida', 'Parcial', 'Anulada'].includes(estado)) {
    params.push(estado); cond += ` AND r.estado = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 30, 1), 200));
  const { rows } = await pool.query(
    `${_sqlLista}${cond} ORDER BY r.fecha_emision DESC, r.id DESC LIMIT $${params.length}`, params
  );
  return rows;
};

/** Lo que la pantalla de la sucursal necesita de un vistazo. */
const panel = async (req) => {
  exigirActivos(req);
  const [porRecibir, enCamino, recientes] = await Promise.all([
    listar(req, { estado: 'En transito', sentido: 'entrada', limit: 50 }),
    listar(req, { estado: 'En transito', sentido: 'salida', limit: 50 }),
    listar(req, { limit: 15 }),
  ]);
  return {
    sucursal_id: Number(req.sucursal_id),
    confirmar: !!_red(req).traslados_confirmar,
    por_recibir: porRecibir,
    en_camino: enCamino,
    recientes,
  };
};

const detalle = async (req, id) => {
  exigirActivos(req);
  const negocioId = req.user.negocio_id;
  const r = await repo.findRemisionById(negocioId, id);
  _exigirTipo(r);
  const esAdmin = req.user.rol === 'admin_negocio';
  const mias = [Number(r.sucursal_origen_id), Number(r.sucursal_destino_id)];
  if (!esAdmin && !mias.includes(Number(req.sucursal_id))) {
    throw { status: 403, message: 'Este traslado no es de tu sucursal' };
  }
  const { rows } = await pool.query(`
    SELECT lr.id, lr.tipo, lr.serial_id, lr.imei, lr.nombre_producto, lr.cantidad,
           lr.cantidad_recibida, lr.estado_linea, lr.costo_origen,
           lr.producto_origen_id, lr.atributo_origen_id, lr.variante_origen_id,
           COALESCE(v.codigo, ap.codigo, pc.codigo) AS codigo
    FROM lineas_remision lr
    LEFT JOIN productos_cantidad pc ON pc.id = lr.producto_origen_id AND lr.tipo = 'cantidad'
    LEFT JOIN atributos_producto ap ON ap.id = lr.atributo_origen_id
    LEFT JOIN variantes_atributo v  ON v.id  = lr.variante_origen_id
    WHERE lr.remision_id = $1
    ORDER BY lr.id
  `, [id]);

  // El costo de lo trasladado es del admin y de nadie más (la misma regla del
  // costo de la bodega en un envío). Se arma campo por campo: sin admin, la
  // clave ni siquiera viaja.
  const lineas = rows.map((l) => ({
    id: Number(l.id), tipo: l.tipo, serial_id: l.serial_id, imei: l.imei,
    nombre_producto: l.nombre_producto, codigo: l.codigo,
    cantidad: Number(l.cantidad), cantidad_recibida: l.cantidad_recibida,
    estado_linea: l.estado_linea,
    ...(esAdmin ? { costo_origen: l.costo_origen == null ? null : Number(l.costo_origen) } : {}),
  }));
  const valorCosto = esAdmin
    ? lineas.reduce((s, l) => s + (l.costo_origen ?? 0) * (l.tipo === 'serial' ? 1 : l.cantidad), 0)
    : null;
  return {
    id: Number(r.id), numero: r.numero, tipo: r.tipo, estado: r.estado, notas: r.notas,
    sucursal_origen_id: r.sucursal_origen_id, sucursal_destino_id: r.sucursal_destino_id,
    sucursal_origen_nombre: r.sucursal_origen_nombre, sucursal_destino_nombre: r.sucursal_destino_nombre,
    usuario_emisor_nombre: r.usuario_emisor_nombre, usuario_receptor_nombre: r.usuario_receptor_nombre,
    fecha_emision: r.fecha_emision, fecha_recepcion: r.fecha_recepcion,
    lineas,
    unidades: lineas.reduce((s, l) => s + (l.tipo === 'serial' ? 1 : l.cantidad), 0),
    ...(esAdmin ? { valor_costo: valorCosto } : {}),
    es_destino: Number(r.sucursal_destino_id) === Number(req.sucursal_id),
    es_origen:  Number(r.sucursal_origen_id) === Number(req.sucursal_id),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// PASAR UNA SEDE A «PROPIA» — su cuenta con la bodega se cierra en $0
// ─────────────────────────────────────────────────────────────────────────────

const NOTA_CIERRE = 'Cuenta cerrada en $0: por decisión de diseño esta sucursal pasó a ser sede propia y '
  + 'desde ahora recibe TRASLADOS (sin cuenta) en vez de despachos.';

/** Lo que impide (o no) que una sede pase a ser propia, sin escribir nada. */
const _estadoParaPropia = async (negocioId, sucursalId) => {
  const I = _internos();
  const [{ estado }, env, pend] = await Promise.all([
    I.estadoLocal(negocioId, sucursalId),
    // Las cifras EXACTAS (con centavos): los totales de la pantalla vienen
    // redondeados, y un ajuste por la cifra redondeada dejaría $0,50 colgando.
    repo.getTotalesEnvios(negocioId, sucursalId),
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM remisiones
          WHERE negocio_id = $1 AND estado = 'En transito' AND tipo IN ('entrega', 'devolucion')
            AND (sucursal_origen_id = $2 OR sucursal_destino_id = $2))::int AS remisiones_en_camino,
        (SELECT COUNT(*) FROM remesas
          WHERE negocio_id = $1 AND estado = 'En transito' AND sucursal_origen_id = $2)::int AS remesas_en_camino,
        (SELECT COUNT(*) FROM movimientos_cuenta_interna
          WHERE negocio_id = $1 AND sucursal_id = $2 AND estado = 'Por aprobar'
            AND NOT COALESCE(anulado, FALSE))::int AS gastos_por_aprobar
    `, [negocioId, sucursalId]),
  ]);
  const t = estado.totales || {};
  const p = pend.rows[0];
  const n = (v) => Number(v || 0);
  const r2 = (v) => Math.round(n(v) * 100) / 100;
  // La misma aritmética de `_armarSaldo`, sin redondear a pesos.
  const deuda  = n(env?.deuda) + n(env?.cargos_sueltos);
  const aFavor = Math.max(0, n(env?.excedente) + n(env?.cargos_excedente) + n(env?.sin_imputar) - n(env?.favor_usado));
  const mora   = n(t.mora_pendiente);
  const out = {
    sucursal_id: sucursalId,
    total_a_pagar: r2(Math.max(0, deuda + mora - aFavor)),
    deuda: r2(deuda),
    mora_pendiente: r2(mora),
    saldo_a_favor: r2(Math.max(0, aFavor - deuda - mora)),
    remisiones_en_camino: p.remisiones_en_camino,
    remesas_en_camino: p.remesas_en_camino,
    gastos_por_aprobar: p.gastos_por_aprobar,
  };
  out.pendientes = [
    out.remisiones_en_camino ? `${out.remisiones_en_camino} envío(s) o devolución(es) en camino` : null,
    out.remesas_en_camino ? `${out.remesas_en_camino} pago(s) en camino a la bodega` : null,
    out.gastos_por_aprobar ? `${out.gastos_por_aprobar} gasto(s) por aprobar` : null,
  ].filter(Boolean);
  out.cuenta_en_cero = out.total_a_pagar < 0.01 && out.saldo_a_favor < 0.01;
  out.lista = out.cuenta_en_cero && !out.pendientes.length;
  return out;
};

/** Para Ajustes: cada sucursal (menos la bodega), si es propia y si puede serlo. */
const estadoSedes = async (req) => {
  const red = _red(req);
  const negocioId = req.user.negocio_id;
  const bodegaId = Number(red.bodega_id);
  const todas = (await repo.getSucursales(negocioId)).filter((s) => Number(s.id) !== bodegaId);
  const sedes = [];
  for (const s of todas) {
    sedes.push({
      ...(await _estadoParaPropia(negocioId, Number(s.id))),
      nombre: s.nombre,
      es_propia: reglas.esSedePropia(red, s.id),
    });
  }
  return { instalado: hayTrasladosInternos(), bodega_id: bodegaId, sedes };
};

/**
 * Deja la cuenta de una sede en $0 con UN ajuste que lo explica. Es la única
 * escritura sobre la cuenta, y la hace el admin con un botón: nada se borra,
 * los envíos y abonos de antes siguen ahí, y el ajuste se puede anular como
 * cualquier otro (Bodega → la cuenta del local).
 */
const cerrarCuenta = async (req, sucursalId, { nota } = {}) => {
  if (req.user.rol !== 'admin_negocio') throw { status: 403, message: 'Solo el administrador cierra una cuenta' };
  const negocioId = req.user.negocio_id;
  const sid = Number(sucursalId);
  if (sid === Number(req.red.bodega_id)) throw { status: 400, message: 'La bodega no tiene cuenta' };
  const I = _internos();
  await I.verificarSucursal(null, sid, negocioId);

  const antes = await _estadoParaPropia(negocioId, sid);
  if (antes.pendientes.length) {
    throw {
      status: 409, code: 'CUENTA_CON_PENDIENTES',
      message: `Antes de cerrar la cuenta hay que resolver: ${antes.pendientes.join(', ')}.`,
      detalle: antes,
    };
  }
  if (antes.cuenta_en_cero) return { ...antes, ajuste: null, ya_estaba: true };

  const concepto = nota && String(nota).trim()
    ? `${NOTA_CIERRE} ${String(nota).trim().slice(0, 300)}`
    : NOTA_CIERRE;

  const client = await pool.connect();
  let mov;
  try {
    await client.query('BEGIN');
    if (antes.total_a_pagar > 0) {
      // Lo que se debe (capital y mora) se cubre con un ajuste A FAVOR, por el
      // mismo motor que reparte cualquier pago: queda imputado envío por envío.
      mov = await repo.insertarMovimientoCuenta(client, {
        negocio_id: negocioId, sucursal_id: sid, tipo: 'Ajuste',
        valor: antes.total_a_pagar, concepto, usuario_id: req.user.id,
      });
      await I.imputarFIFO(client, {
        negocioId, sucursalId: sid, valor: antes.total_a_pagar, origen: 'ajuste',
        movimientoId: mov.id, usuarioId: req.user.id, notas: concepto,
      });
    } else if (antes.saldo_a_favor > 0) {
      // Al revés: la bodega le debía mercancía. Un cargo por lo mismo, que el
      // saldo a favor consume en el acto.
      mov = await repo.insertarMovimientoCuenta(client, {
        negocio_id: negocioId, sucursal_id: sid, tipo: 'Ajuste',
        valor: -antes.saldo_a_favor, concepto, usuario_id: req.user.id,
      });
      await I.aplicarSaldoAFavor(client, { negocioId, sucursalId: sid, usuarioId: req.user.id });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const despues = await _estadoParaPropia(negocioId, sid);
  return { ...despues, ajuste: mov ? { id: Number(mov.id), valor: Number(mov.valor), concepto } : null };
};

/**
 * Valida la lista que llega de Ajustes. Una sede que ENTRA a la lista tiene
 * que llegar con la cuenta en $0 y sin nada en camino; las que ya estaban no
 * se vuelven a revisar (su cuenta ya no se mueve). Sacar una sede de la lista
 * siempre se puede: vuelve a ser un local y la siguiente vez se le despacha.
 */
const validarSedesPropias = async (negocioId, raw, { bodegaId, actuales = [] }) => {
  let lista;
  try { lista = JSON.parse(String(raw ?? '[]')); } catch { lista = null; }
  if (!Array.isArray(lista)) throw { status: 400, message: 'La lista de sedes propias no es válida' };
  const ids = [...new Set(lista.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw { status: 400, message: 'La lista de sedes propias no es válida' };
  if (!ids.length) return '[]';
  if (bodegaId && ids.includes(Number(bodegaId))) {
    throw { status: 400, message: 'La bodega no puede ser una sede propia: es la que traslada' };
  }
  const { rows } = await pool.query(
    'SELECT id, nombre FROM sucursales WHERE negocio_id = $1 AND activa = true AND id = ANY($2::int[])',
    [negocioId, ids],
  );
  if (rows.length !== ids.length) throw { status: 400, message: 'Una de las sedes propias no es de este negocio o está inactiva' };
  const ya = new Set((actuales || []).map(Number));
  for (const s of rows) {
    if (ya.has(Number(s.id))) continue;
    const e = await _estadoParaPropia(negocioId, Number(s.id));
    if (!e.lista) {
      throw {
        status: 409, code: 'SEDE_CON_CUENTA',
        message: `«${s.nombre}» todavía tiene cuenta con la bodega`
          + (e.pendientes.length ? ` (${e.pendientes.join(', ')})` : ` (${e.total_a_pagar > 0 ? 'debe' : 'tiene a favor'} $${Math.round(e.total_a_pagar || e.saldo_a_favor).toLocaleString('es-CO')})`)
          + '. Ciérrala en $0 con el botón de esa sede antes de guardarla como propia.',
      };
    }
  }
  return JSON.stringify(ids.sort((a, b) => a - b));
};

module.exports = {
  exigirActivos, resolver, buscar, previsualizar, referenciasDestino, trasladar, anular, avisarRecibido,
  listar, panel, detalle, estadoSedes, cerrarCuenta, validarSedesPropias,
  NOTA_CIERRE, etiqueta,
};
