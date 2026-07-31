const { pool } = require('../../config/db');
const repo     = require('./mora.repository');
const configRepo = require('../config/config.repository');
const {
  leerConfigMora, resolverEstadoMora, normalizarCondicion, hoyBogota,
} = require('../../utils/mora.util');

// ─────────────────────────────────────────────────────────────────────────────
// MORA — lógica de negocio compartida por créditos y préstamos.
//
// Los dos vehículos tienen la misma forma (un valor, un total abonado y un
// saldo), así que aquí se abstraen como "documento" y se evita duplicar la
// lógica. La diferencia vive solo en DOCS.
//
// La mora pendiente se DERIVA siempre; lo único que se escribe son cobros y
// condonaciones. Un negocio sin `mora_activa` nunca llega a escribir nada.
// ─────────────────────────────────────────────────────────────────────────────

const DOCS = {
  credito: {
    tabla:    'creditos',
    columna:  'credito_id',
    // El saldo de CAPITAL, que es la base de la mora. No incluye mora.
    saldoDe:  (d) => Number(d.valor_total) - Number(d.cuota_inicial || 0) - Number(d.total_abonado || 0),
    ownership: `
      SELECT c.*, su.negocio_id, c.sucursal_id
      FROM creditos c JOIN sucursales su ON su.id = c.sucursal_id
      WHERE c.id = $1 AND su.negocio_id = $2`,
  },
  prestamo: {
    tabla:    'prestamos',
    columna:  'prestamo_id',
    saldoDe:  (d) => Number(d.valor_prestamo) - Number(d.total_abonado || 0),
    ownership: `
      SELECT p.*, su.negocio_id, p.sucursal_id
      FROM prestamos p JOIN sucursales su ON su.id = p.sucursal_id
      WHERE p.id = $1 AND su.negocio_id = $2`,
  },
};

const _doc = (tipo) => {
  const d = DOCS[tipo];
  if (!d) throw new Error(`Tipo de documento de crédito no soportado: ${tipo}`);
  return d;
};

/** Config de mora del negocio (cacheada por request no hace falta: es una fila). */
const getConfigNegocio = async (negocioId) => leerConfigMora(await configRepo.getMap(negocioId));

/**
 * Movimientos de mora + abonos a capital de un documento.
 *
 * Con `client` (dentro de una transacción) van en serie: un client de pg atiende
 * una consulta a la vez. Sin él, cada consulta toma su propia conexión del pool
 * y sí pueden ir en paralelo.
 */
const _movimientosYAbonos = async (client, clave) => {
  if (client) {
    const movimientos = await repo.findPorDocumento(client, clave);
    const abonos      = await repo.findAbonosCapital(client, clave);
    return { movimientos, abonos };
  }
  const [movimientos, abonos] = await Promise.all([
    repo.findPorDocumento(null, clave),
    repo.findAbonosCapital(null, clave),
  ]);
  return { movimientos, abonos };
};

// ── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Adjunta el estado de mora a UN documento ya cargado.
 * Devuelve el documento con una clave `mora`. Si el documento no tiene plazo,
 * `mora.aplica` es false y todos los valores son 0 — así el frontend puede
 * pintar sin condicionales por todos lados.
 */
const anotarDocumento = async (documento, tipo, { client = null } = {}) => {
  if (!documento) return documento;
  const cfg = _doc(tipo);

  const clave = {
    credito_id:  tipo === 'credito'  ? documento.id : null,
    prestamo_id: tipo === 'prestamo' ? documento.id : null,
  };
  // Los abonos a capital hacen falta para acumular la mora por tramos: sin
  // ellos, pagar el capital borraría la mora ya causada.
  const { movimientos, abonos } = await _movimientosYAbonos(client, clave);

  const mora = resolverEstadoMora({
    saldo:        cfg.saldoDe(documento),
    fecha_limite: documento.fecha_limite,
    condicion:    documento.mora_condicion,
    movimientos,
    abonos,
  });

  return { ...documento, mora, mora_movimientos: movimientos };
};

/**
 * Adjunta el estado de mora a una LISTA. Una sola consulta para todos los
 * documentos: al listar los 1.793 préstamos activos de un negocio, hacerlo
 * documento por documento serían 1.793 consultas.
 */
const anotarLista = async (documentos, tipo) => {
  if (!Array.isArray(documentos) || !documentos.length) return documentos;
  const cfg = _doc(tipo);

  // Si ninguno tiene plazo, no hace falta ni consultar.
  const conPlazo = documentos.filter((d) => d.fecha_limite);
  if (!conPlazo.length) {
    return documentos.map((d) => ({ ...d, mora: resolverEstadoMora({}) }));
  }

  const ids = conPlazo.map((d) => Number(d.id));
  const esCredito = tipo === 'credito';
  // Dos consultas en lote (movimientos de mora y abonos a capital) en vez de
  // dos por documento: con 1.793 préstamos activos la diferencia es brutal.
  const [movs, abos] = await Promise.all([
    repo.findPorDocumentos({
      creditoIds:  esCredito ? ids : [],
      prestamoIds: esCredito ? [] : ids,
    }),
    repo.findAbonosCapitalPorDocumentos({
      creditoIds:  esCredito ? ids : [],
      prestamoIds: esCredito ? [] : ids,
    }),
  ]);
  const mapaMov = esCredito ? movs.creditos : movs.prestamos;
  const mapaAbo = esCredito ? abos.creditos : abos.prestamos;

  return documentos.map((d) => ({
    ...d,
    mora: resolverEstadoMora({
      saldo:        cfg.saldoDe(d),
      fecha_limite: d.fecha_limite,
      condicion:    d.mora_condicion,
      movimientos:  mapaMov.get(Number(d.id)) || [],
      abonos:       mapaAbo.get(Number(d.id)) || [],
    }),
  }));
};

/** Carga un documento validando que pertenezca al negocio. */
const cargarDocumento = async (tipo, id, negocioId, client = null) => {
  const cfg = _doc(tipo);
  const ejecutor = client || pool;
  const { rows } = await ejecutor.query(cfg.ownership, [id, negocioId]);
  if (!rows.length) {
    throw { status: 404, message: tipo === 'credito' ? 'Crédito no encontrado' : 'Préstamo no encontrado' };
  }
  return rows[0];
};

/** Estado de mora de un documento, resuelto desde cero. Uso interno y en tx. */
const estadoDe = async (tipo, id, negocioId, client = null) => {
  const cfg = _doc(tipo);
  const doc = await cargarDocumento(tipo, id, negocioId, client);
  const clave = {
    credito_id:  tipo === 'credito'  ? id : null,
    prestamo_id: tipo === 'prestamo' ? id : null,
  };
  // Secuencial cuando va dentro de una transacción: un client de pg atiende una
  // consulta a la vez, y lanzarlas en paralelo sobre el mismo client es un
  // patrón que pg ya marca como deprecado.
  const { movimientos, abonos } = await _movimientosYAbonos(client, clave);
  return {
    documento: doc,
    saldo_capital: cfg.saldoDe(doc),
    mora: resolverEstadoMora({
      saldo:        cfg.saldoDe(doc),
      fecha_limite: doc.fecha_limite,
      condicion:    doc.mora_condicion,
      movimientos,
      abonos,
    }),
    movimientos,
  };
};

/**
 * Cierra el documento si ya no se debe NADA — capital en cero Y mora en cero.
 *
 * Es el único lugar que decide que una obligación quedó saldada, y lo llaman
 * los tres caminos por los que puede terminar de pagarse: el abono (baja el
 * capital), el cobro de mora y la condonación. Antes bastaba con cubrir el
 * capital, y un préstamo con intereses sin cobrar se cerraba dejando la mora
 * huérfana; ahora se cierra —y se genera su factura— justo cuando el cliente
 * termina de pagar todo.
 *
 * Delega en el service de cada módulo (que es el que sabe crear la factura del
 * préstamo). El `require` va dentro para no crear un ciclo al cargar.
 */
const cerrarSiPagadoEnTx = async (client, tipo, id, negocioId, opciones = {}) => {
  const modulo = tipo === 'credito'
    ? require('../creditos/creditos.service')
    : require('../prestamos/prestamos.service');
  return modulo.cerrarSiPagadoEnTx(client, id, negocioId, opciones);
};

// ── Escritura ────────────────────────────────────────────────────────────────

/**
 * Registra un COBRO de mora dentro de una transacción ya abierta.
 * Lo usan los abonos (cuando parte del pago va a mora) y el cobro de mora sola.
 * Nunca toca `total_abonado`: el capital lo mueve el llamador.
 */
const registrarCobroEnTx = async (client, {
  tipo, documento, negocioId, valor, metodo, usuarioId,
  estadoMora, abonoCreditoId = null, abonoPrestamoId = null,
}) => {
  if (!(valor > 0)) return null;
  const cfg = _doc(tipo);

  return repo.insertar(client, {
    negocio_id:  negocioId,
    sucursal_id: documento.sucursal_id,
    credito_id:  tipo === 'credito'  ? documento.id : null,
    prestamo_id: tipo === 'prestamo' ? documento.id : null,
    tipo:        'Cobro',
    valor,
    dias_mora:   estadoMora?.dias_vencidos ?? null,
    saldo_base:  cfg.saldoDe(documento),
    condicion:   estadoMora?.condicion ?? documento.mora_condicion ?? null,
    metodo:      metodo || 'Efectivo',
    usuario_id:  usuarioId ?? null,
    abono_credito_id:  abonoCreditoId,
    abono_prestamo_id: abonoPrestamoId,
  });
};

/**
 * CONDONAR mora — total o parcial.
 *
 * Solo admin_negocio, exige motivo y PIN (decisión del negocio: es una decisión
 * de plata que no puede quedar sin dueño). Queda como movimiento propio, así que
 * el reporte puede mostrar "cuánto dejé de cobrar" sin que eso toque la utilidad
 * del producto ni cuente como ingreso.
 */
// `quitar_plazo`: además de condonar, borra la fecha límite del documento.
//
// Existe porque condonar NO detiene la mora futura: la deuda sigue vencida, así
// que al día siguiente vuelve a causarse. Si lo que el negocio quiere es "a este
// cliente no le cobro mora nunca más", hay que quitarle el plazo — y hacerlo en
// dos pasos separados es fácil de olvidar.
const condonar = async (negocioId, tipo, id, { valor, motivo, usuario_id, pin, rol, quitar_plazo = false }) => {
  if (rol !== 'admin_negocio') {
    throw { status: 403, message: 'Solo el administrador del negocio puede condonar la mora' };
  }
  const motivoLimpio = String(motivo || '').trim();
  if (motivoLimpio.length < 3) {
    throw { status: 400, message: 'Escribe el motivo de la condonación (queda registrado)' };
  }

  const configService = require('../config/config.service');
  const pinValido = await configService.verificarPin(negocioId, pin);
  if (!pinValido) {
    throw { status: 403, message: 'PIN incorrecto' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { documento, mora } = await estadoDe(tipo, id, negocioId, client);
    if (!mora.aplica) {
      throw { status: 400, message: 'Este documento no tiene plazo ni mora pactada' };
    }
    if (mora.pendiente <= 0) {
      throw { status: 400, message: 'No hay mora pendiente por condonar' };
    }

    // Sin valor = condonar todo lo pendiente.
    const aCondonar = valor == null || valor === ''
      ? mora.pendiente
      : Math.round(Number(valor));

    if (!(aCondonar > 0)) {
      throw { status: 400, message: 'El valor a condonar debe ser mayor a 0' };
    }
    if (aCondonar > mora.pendiente) {
      throw {
        status: 400,
        message: `No puedes condonar más de la mora pendiente ($${mora.pendiente.toLocaleString('es-CO')})`,
      };
    }

    const cfg = _doc(tipo);
    const mov = await repo.insertar(client, {
      negocio_id:  negocioId,
      sucursal_id: documento.sucursal_id,
      credito_id:  tipo === 'credito'  ? documento.id : null,
      prestamo_id: tipo === 'prestamo' ? documento.id : null,
      tipo:        'Condonacion',
      valor:       aCondonar,
      dias_mora:   mora.dias_vencidos,
      saldo_base:  cfg.saldoDe(documento),
      condicion:   mora.condicion,
      motivo:      motivoLimpio,
      usuario_id:  usuario_id ?? null,
    });

    // Se quita el plazo en la MISMA transacción: si la condonación queda pero el
    // plazo no se borra, mañana vuelve a haber mora y el admin creería que ya
    // resolvió el caso.
    let plazoQuitado = false;
    if (quitar_plazo) {
      await client.query(
        `UPDATE ${cfg.tabla} SET fecha_limite = NULL, mora_condicion = NULL WHERE id = $1`,
        [id]
      );
      plazoQuitado = true;
    }

    // Condonar es una forma de terminar de pagar: si el capital ya estaba
    // cubierto y esta condonación deja la mora en cero, el documento se cierra
    // aquí mismo (y el préstamo genera su factura).
    const cierre = await cerrarSiPagadoEnTx(client, tipo, id, negocioId, {});

    await client.query('COMMIT');

    const despues = await estadoDe(tipo, id, negocioId);
    return {
      movimiento: mov, mora: despues.mora, plazo_quitado: plazoQuitado,
      saldado: !!cierre?.saldado, factura_id: cierre?.factura_id ?? null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/** Anula un movimiento de mora (deshacer un cobro o una condonación). */
const anularMovimiento = async (negocioId, movimientoId, { rol }) => {
  if (rol !== 'admin_negocio') {
    throw { status: 403, message: 'Solo el administrador del negocio puede anular un movimiento de mora' };
  }
  const mov = await repo.findByIdYNegocio(movimientoId, negocioId);
  if (!mov) throw { status: 404, message: 'Movimiento de mora no encontrado' };
  if (mov.anulado) throw { status: 400, message: 'El movimiento ya está anulado' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const anulado = await repo.anular(client, movimientoId);
    await client.query('COMMIT');
    return anulado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Fija o cambia el plazo y la condición de mora de un documento ya existente.
 *
 * Es lo que permite usar la feature con la cartera vieja: un crédito que nació
 * sin plazo puede recibirlo después, y la mora corre desde esa fecha — nunca
 * hacia atrás, porque `calcularMoraCausada` solo mira de `fecha_limite` en
 * adelante.
 *
 * Pasar `fecha_limite: null` quita el plazo y, con él, la mora futura.
 */
const fijarPlazo = async (negocioId, tipo, id, { fecha_limite, condicion_id, rol }) => {
  if (rol !== 'admin_negocio' && rol !== 'supervisor') {
    throw { status: 403, message: 'No tienes permiso para cambiar el plazo de pago' };
  }
  const cfg  = _doc(tipo);
  const conf = await getConfigNegocio(negocioId);
  if (!conf.activa) {
    throw { status: 400, message: 'El cobro de mora no está activado en la configuración del negocio' };
  }

  await cargarDocumento(tipo, id, negocioId);   // ownership

  // Quitar el plazo: se limpia también la condición para no dejar basura.
  if (!fecha_limite) {
    const { rows } = await pool.query(
      `UPDATE ${cfg.tabla} SET fecha_limite = NULL, mora_condicion = NULL WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!rows.length) throw { status: 404, message: 'Documento no encontrado' };
    return { fecha_limite: null, mora_condicion: null };
  }

  const fecha = String(fecha_limite).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw { status: 400, message: 'La fecha límite debe tener el formato AAAA-MM-DD' };
  }

  const condicion = resolverCondicionPactada(conf, condicion_id);
  if (!condicion) {
    throw { status: 400, message: 'Selecciona una condición de mora válida' };
  }

  const { rows } = await pool.query(
    `UPDATE ${cfg.tabla} SET fecha_limite = $2, mora_condicion = $3::jsonb
     WHERE id = $1 RETURNING fecha_limite, mora_condicion`,
    [id, fecha, JSON.stringify(condicion)]
  );
  if (!rows.length) throw { status: 404, message: 'Documento no encontrado' };
  return rows[0];
};

/**
 * Resuelve la condición a CONGELAR en un documento nuevo.
 *
 * Se copia la condición completa, no una referencia: si mañana el negocio sube
 * la tasa en Ajustes, no puede aplicarla a lo ya otorgado. Devuelve null si la
 * feature está apagada o el id no existe (→ el documento queda sin mora).
 */
const resolverCondicionPactada = (configMora, condicionId) => {
  if (!configMora?.activa) return null;
  const elegida = condicionId
    ? configMora.condiciones.find((c) => c.id === condicionId)
    : configMora.condiciones.find((c) => c.id === configMora.default_id);
  return normalizarCondicion(elegida || null);
};

/**
 * Datos de mora para un documento que se está CREANDO.
 * Devuelve `{ fecha_limite, mora_condicion }` listos para el INSERT, o nulos si
 * no aplica. Centralizado para que factura y préstamo se comporten igual.
 */
const datosParaNuevoDocumento = async (negocioId, { fecha_limite, mora_condicion_id }) => {
  if (!fecha_limite) return { fecha_limite: null, mora_condicion: null };

  const conf = await getConfigNegocio(negocioId);
  if (!conf.activa) return { fecha_limite: null, mora_condicion: null };

  const fecha = String(fecha_limite).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw { status: 400, message: 'La fecha límite de pago debe tener el formato AAAA-MM-DD' };
  }
  // Un plazo en el pasado casi siempre es un error de dedo; y aceptarlo haría
  // nacer el documento ya con mora causada, que es difícil de explicarle al cliente.
  if (fecha < hoyBogota()) {
    throw { status: 400, message: 'La fecha límite de pago no puede ser anterior a hoy' };
  }

  const condicion = resolverCondicionPactada(conf, mora_condicion_id);
  if (!condicion) {
    throw { status: 400, message: 'Selecciona la condición de mora para este plazo' };
  }
  return { fecha_limite: fecha, mora_condicion: condicion };
};

module.exports = {
  DOCS, getConfigNegocio,
  anotarDocumento, anotarLista, cargarDocumento, estadoDe, cerrarSiPagadoEnTx,
  registrarCobroEnTx, condonar, anularMovimiento, fijarPlazo,
  resolverCondicionPactada, datosParaNuevoDocumento,
};
