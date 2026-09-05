const { pool } = require('../../config/db');
const repo     = require('./mora.repository');
const configRepo = require('../config/config.repository');
const {
  leerConfigMora, resolverEstadoMora, normalizarCondicion, hoyBogota,
} = require('../../utils/mora.util');
const {
  leerConfigInteres, resolverEstadoInteres, normalizarPlanInteres,
} = require('../../utils/interes.util');
const { aFecha, aFechaInstante } = require('../../utils/devengo.util');

/**
 * Día desde el que corre el interés de un documento.
 *
 * OJO CON EL TIPO DE COLUMNA — aquí se decide, porque es el único lugar que
 * sabe de qué columna viene cada fecha:
 *   · `interes_desde` es un DATE      → `aFecha` (componentes UTC; el driver de
 *     pg entrega los DATE a medianoche UTC y convertirlos a Bogotá los correría
 *     un día hacia atrás).
 *   · `prestamos.fecha` y `creditos.creado_en` son TIMESTAMP → `aFechaInstante`
 *     (día de calendario en Bogotá). Leerlos en UTC adelanta un día a partir de
 *     las 19:00 de Colombia, y con eso el interés causado sale corto.
 *
 * Confundirlos es el error que ya mordió una vez con la mora.
 */
const _inicioInteres = (documento, campoEmision) =>
  documento.interes_desde
    ? aFecha(documento.interes_desde)
    : aFechaInstante(documento[campoEmision]);

// ─────────────────────────────────────────────────────────────────────────────
// CARGOS FINANCIEROS — lógica de negocio compartida por créditos y préstamos.
//
// Dos cargos, independientes entre sí:
//   · MORA    — sanción por pagar tarde. Ancla: la fecha límite.
//   · INTERÉS — precio del plazo.        Ancla: la entrega del documento.
//
// Se puede tener uno, el otro, los dos o ninguno. Los interruptores son la
// ausencia de datos, no un flag: `fecha_limite IS NULL` ⇒ nunca hay mora,
// `interes_condicion IS NULL` ⇒ nunca hay interés. Por eso la feature es
// aditiva: la cartera que ya existe no cambia al activarla.
//
// Los dos vehículos (crédito y préstamo) tienen la misma forma —un valor, un
// total abonado y un saldo— así que aquí se abstraen como "documento" y la
// diferencia vive solo en DOCS.
//
// Lo pendiente se DERIVA siempre; lo único que se escribe son cobros y
// condonaciones. Un negocio sin las features nunca llega a escribir nada.
// ─────────────────────────────────────────────────────────────────────────────

const DOCS = {
  credito: {
    tabla:    'creditos',
    columna:  'credito_id',
    // El saldo de CAPITAL, que es la base de los dos cargos. No los incluye.
    saldoDe:  (d) => Number(d.valor_total) - Number(d.cuota_inicial || 0) - Number(d.total_abonado || 0),
    // Lo FINANCIADO de origen: el interés con base 'valor_original' se calcula
    // sobre esto. La cuota inicial se pagó de contado, así que no se financia.
    originalDe: (d) => Math.max(0, Number(d.valor_total) - Number(d.cuota_inicial || 0)),
    // Desde cuándo corre el interés. `creado_en` es TIMESTAMP: ver `_inicioInteres`.
    emisionDe:  (d) => _inicioInteres(d, 'creado_en'),
    ownership: `
      SELECT c.*, su.negocio_id, c.sucursal_id
      FROM creditos c JOIN sucursales su ON su.id = c.sucursal_id
      WHERE c.id = $1 AND su.negocio_id = $2`,
  },
  prestamo: {
    tabla:    'prestamos',
    columna:  'prestamo_id',
    saldoDe:  (d) => Number(d.valor_prestamo) - Number(d.total_abonado || 0),
    originalDe: (d) => Math.max(0, Number(d.valor_prestamo)),
    // `fecha` es TIMESTAMP: ver `_inicioInteres`.
    emisionDe:  (d) => _inicioInteres(d, 'fecha'),
    ownership: `
      SELECT p.*, su.negocio_id, p.sucursal_id
      FROM prestamos p JOIN sucursales su ON su.id = p.sucursal_id
      WHERE p.id = $1 AND su.negocio_id = $2`,
  },
};

/**
 * Estado de los DOS cargos de un documento, en un solo lugar.
 *
 * Se resuelven juntos a propósito: el interés necesita saber la fecha límite
 * (con la política 'sustituye' deja de correr al vencerse), así que separarlos
 * obligaría a pasar el mismo dato dos veces y a que dos llamadores lo hicieran
 * distinto.
 */
const _resolverCargos = (cfg, documento, movimientos, abonos) => {
  const saldo = cfg.saldoDe(documento);

  const mora = resolverEstadoMora({
    saldo,
    fecha_limite: documento.fecha_limite,
    condicion:    documento.mora_condicion,
    movimientos,
    abonos,
  });

  const interes = resolverEstadoInteres({
    saldo,
    valor_original: cfg.originalDe(documento),
    fecha_inicio:   cfg.emisionDe(documento),
    fecha_limite:   documento.fecha_limite,
    condicion:      documento.interes_condicion,
    movimientos,
    abonos,
  });

  // Lo que el cliente debe HOY, completo. Las tres cubetas se muestran siempre
  // juntas porque la obligación no se cierra mientras quede cualquiera de ellas.
  const capital = Math.max(0, Math.round(Number(saldo) || 0));
  const cargos  = mora.pendiente + interes.pendiente;

  return {
    mora,
    interes,
    saldo_capital: capital,
    total_a_pagar: capital + cargos,
    // El producto ya está pagado pero quedan cargos: el documento sigue abierto
    // y no procede el paz y salvo.
    solo_faltan_cargos: capital <= 0 && cargos > 0,
  };
};

const _doc = (tipo) => {
  const d = DOCS[tipo];
  if (!d) throw new Error(`Tipo de documento de crédito no soportado: ${tipo}`);
  return d;
};

/** Config de mora del negocio (cacheada por request no hace falta: es una fila). */
const getConfigNegocio = async (negocioId) => leerConfigMora(await configRepo.getMap(negocioId));

/** Config de interés corriente del negocio. Independiente de la de mora. */
const getConfigInteres = async (negocioId) => leerConfigInteres(await configRepo.getMap(negocioId));

/** Las dos de una vez, con una sola lectura de `config_negocio`. */
const getConfigCargos = async (negocioId) => {
  const map = await configRepo.getMap(negocioId);
  return { mora: leerConfigMora(map), interes: leerConfigInteres(map) };
};

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
  // Los abonos a capital hacen falta para acumular los cargos por tramos: sin
  // ellos, pagar el capital borraría lo ya causado.
  const { movimientos, abonos } = await _movimientosYAbonos(client, clave);

  const cargos = _resolverCargos(cfg, documento, movimientos, abonos);

  return {
    ...documento,
    mora:    cargos.mora,
    interes: cargos.interes,
    total_a_pagar:      cargos.total_a_pagar,
    solo_faltan_cargos: cargos.solo_faltan_cargos,
    // Nombre histórico: la tabla guarda los dos cargos, pero el frontend y los
    // PDF ya consumen esta clave.
    mora_movimientos: movimientos,
  };
};

/**
 * Adjunta el estado de mora a una LISTA. Una sola consulta para todos los
 * documentos: al listar los 1.793 préstamos activos de un negocio, hacerlo
 * documento por documento serían 1.793 consultas.
 */
const anotarLista = async (documentos, tipo, { client = null } = {}) => {
  if (!Array.isArray(documentos) || !documentos.length) return documentos;
  const cfg = _doc(tipo);

  // Si ninguno tiene cargos pactados, no hace falta ni consultar. Es el caso de
  // un negocio que no usa ninguna de las dos features: cero consultas extra.
  const conCargos = documentos.filter((d) => d.fecha_limite || d.interes_condicion);
  if (!conCargos.length) {
    return documentos.map((d) => ({
      ...d,
      mora:    resolverEstadoMora({}),
      interes: resolverEstadoInteres({}),
    }));
  }

  const ids = conCargos.map((d) => Number(d.id));
  const esCredito = tipo === 'credito';
  // Dos consultas en lote (movimientos de mora y abonos a capital) en vez de
  // dos por documento: con 1.793 préstamos activos la diferencia es brutal.
  //
  // Con `client` van SECUENCIALES y por la conexión de la transacción: un client
  // de pg atiende una consulta a la vez (lanzarlas en paralelo es el patrón que
  // pg marca como deprecado), y pedirle una segunda conexión al pool mientras se
  // tiene una tomada es como se agota el pool bajo carga.
  const claves = {
    creditoIds:  esCredito ? ids : [],
    prestamoIds: esCredito ? [] : ids,
  };
  const [movs, abos] = client
    ? [await repo.findPorDocumentos(claves, client),
       await repo.findAbonosCapitalPorDocumentos(claves, client)]
    : await Promise.all([
        repo.findPorDocumentos(claves),
        repo.findAbonosCapitalPorDocumentos(claves),
      ]);
  const mapaMov = esCredito ? movs.creditos : movs.prestamos;
  const mapaAbo = esCredito ? abos.creditos : abos.prestamos;

  return documentos.map((d) => {
    const cargos = _resolverCargos(
      cfg, d,
      mapaMov.get(Number(d.id)) || [],
      mapaAbo.get(Number(d.id)) || [],
    );
    return {
      ...d,
      mora:               cargos.mora,
      interes:            cargos.interes,
      total_a_pagar:      cargos.total_a_pagar,
      solo_faltan_cargos: cargos.solo_faltan_cargos,
    };
  });
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
  const cargos = _resolverCargos(cfg, doc, movimientos, abonos);
  return {
    documento: doc,
    saldo_capital: cargos.saldo_capital,
    mora:          cargos.mora,
    interes:       cargos.interes,
    total_a_pagar: cargos.total_a_pagar,
    solo_faltan_cargos: cargos.solo_faltan_cargos,
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
 * Registra un COBRO de un cargo financiero dentro de una transacción ya abierta.
 *
 * Lo usan los abonos (cuando parte del pago va a mora o a interés) y el cobro
 * del cargo solo. Nunca toca `total_abonado`: el capital lo mueve el llamador,
 * y meter aquí un peso lo convertiría en margen del producto en los reportes.
 *
 * `concepto` decide de cuál de los dos cargos se trata. Por defecto 'mora',
 * para que los llamadores que existían antes del interés no cambien.
 */
const registrarCobroEnTx = async (client, {
  tipo, documento, negocioId, valor, metodo, usuarioId,
  concepto = 'mora', estadoMora, abonoCreditoId = null, abonoPrestamoId = null,
}) => {
  if (!(valor > 0)) return null;
  const cfg = _doc(tipo);
  const esInteres = concepto === 'interes';

  return repo.insertar(client, {
    negocio_id:  negocioId,
    sucursal_id: documento.sucursal_id,
    credito_id:  tipo === 'credito'  ? documento.id : null,
    prestamo_id: tipo === 'prestamo' ? documento.id : null,
    concepto,
    tipo:        'Cobro',
    valor,
    // Foto del cálculo: en mora son los días de atraso; en interés no aplica
    // (el interés no depende de un atraso), así que queda nulo.
    dias_mora:   esInteres ? null : (estadoMora?.dias_vencidos ?? null),
    saldo_base:  cfg.saldoDe(documento),
    condicion:   estadoMora?.condicion
                 ?? (esInteres ? documento.interes_condicion : documento.mora_condicion)
                 ?? null,
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
//
// `concepto` elige qué se condona: la mora o el interés corriente. Son deudas
// distintas y se perdonan por separado — es común perdonar la sanción por el
// atraso y seguir cobrando el interés que sí se pactó por financiar.
//
// `quitar_plazo` aplica a la mora e `quitar_interes` al interés: los dos apagan
// el cargo hacia adelante, porque condonar NO lo detiene (la deuda sigue viva y
// mañana vuelve a causarse).
const condonar = async (negocioId, tipo, id, {
  valor, motivo, usuario_id, pin, rol,
  concepto = 'mora', quitar_plazo = false, quitar_interes = false,
}) => {
  const esInteres = concepto === 'interes';
  const etiqueta  = esInteres ? 'el interés' : 'la mora';

  if (rol !== 'admin_negocio') {
    throw { status: 403, message: `Solo el administrador del negocio puede condonar ${etiqueta}` };
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

    const { documento, mora, interes } = await estadoDe(tipo, id, negocioId, client);
    const cargo = esInteres ? interes : mora;

    if (!cargo.aplica) {
      throw {
        status: 400,
        message: esInteres
          ? 'Este documento no tiene interés pactado'
          : 'Este documento no tiene plazo ni mora pactada',
      };
    }
    if (cargo.pendiente <= 0) {
      throw { status: 400, message: `No hay ${esInteres ? 'interés' : 'mora'} pendiente por condonar` };
    }

    // Sin valor = condonar todo lo pendiente.
    const aCondonar = valor == null || valor === ''
      ? cargo.pendiente
      : Math.round(Number(valor));

    if (!(aCondonar > 0)) {
      throw { status: 400, message: 'El valor a condonar debe ser mayor a 0' };
    }
    if (aCondonar > cargo.pendiente) {
      throw {
        status: 400,
        message: `No puedes condonar más de ${esInteres ? 'el interés' : 'la mora'} pendiente `
          + `($${cargo.pendiente.toLocaleString('es-CO')})`,
      };
    }

    const cfg = _doc(tipo);
    const mov = await repo.insertar(client, {
      negocio_id:  negocioId,
      sucursal_id: documento.sucursal_id,
      credito_id:  tipo === 'credito'  ? documento.id : null,
      prestamo_id: tipo === 'prestamo' ? documento.id : null,
      concepto,
      tipo:        'Condonacion',
      valor:       aCondonar,
      dias_mora:   esInteres ? null : mora.dias_vencidos,
      saldo_base:  cfg.saldoDe(documento),
      condicion:   cargo.condicion,
      motivo:      motivoLimpio,
      usuario_id:  usuario_id ?? null,
    });

    // Se apaga el cargo en la MISMA transacción: si la condonación queda pero el
    // pacto no se borra, mañana vuelve a causarse y el admin creería que ya
    // resolvió el caso.
    let plazoQuitado = false;
    if (quitar_plazo) {
      await client.query(
        `UPDATE ${cfg.tabla} SET fecha_limite = NULL, mora_condicion = NULL WHERE id = $1`,
        [id]
      );
      plazoQuitado = true;
    }
    let interesQuitado = false;
    if (quitar_interes) {
      await client.query(
        `UPDATE ${cfg.tabla} SET interes_condicion = NULL WHERE id = $1`,
        [id]
      );
      interesQuitado = true;
    }

    // Condonar es una forma de terminar de pagar: si el capital ya estaba
    // cubierto y esta condonación deja los cargos en cero, el documento se
    // cierra aquí mismo (y el préstamo genera su factura).
    const cierre = await cerrarSiPagadoEnTx(client, tipo, id, negocioId, {});

    await client.query('COMMIT');

    const despues = await estadoDe(tipo, id, negocioId);
    return {
      movimiento: mov,
      mora:    despues.mora,
      interes: despues.interes,
      plazo_quitado:   plazoQuitado,
      interes_quitado: interesQuitado,
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
const datosParaNuevoDocumento = async (negocioId, { fecha_limite, mora_condicion_id, interes_plan_id }) => {
  // El interés es independiente del plazo: un documento puede causar interés sin
  // tener fecha límite (deuda abierta) y tener plazo sin causar interés.
  const interes = await _datosInteresNuevo(negocioId, interes_plan_id);

  if (!fecha_limite) return { fecha_limite: null, mora_condicion: null, ...interes };

  const conf = await getConfigNegocio(negocioId);
  if (!conf.activa) return { fecha_limite: null, mora_condicion: null, ...interes };

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
  return { fecha_limite: fecha, mora_condicion: condicion, ...interes };
};

// ── Interés corriente ────────────────────────────────────────────────────────

/**
 * Resuelve el plan de interés a CONGELAR en un documento nuevo.
 *
 * Se copia el plan completo, no una referencia: si mañana el negocio sube la
 * tasa en Ajustes, no puede aplicarla a lo ya otorgado. Devuelve null si la
 * feature está apagada o el id no existe (→ el documento nace sin interés).
 */
const resolverPlanPactado = (configInteres, planId) => {
  if (!configInteres?.activa) return null;
  const elegido = planId
    ? configInteres.planes.find((p) => p.id === planId)
    : configInteres.planes.find((p) => p.id === configInteres.default_id);
  return normalizarPlanInteres(elegido || null);
};

/**
 * Datos de interés para un documento que se está CREANDO.
 *
 * A diferencia de la mora, aquí NO se lanza si el plan no existe: el interés es
 * opcional en cada venta y no tenerlo es una decisión válida (y la más común).
 * `interes_desde` queda nulo y el cálculo usa la fecha de emisión del documento.
 */
const _datosInteresNuevo = async (negocioId, planId) => {
  if (!planId) return { interes_condicion: null, interes_desde: null };

  const conf = await getConfigInteres(negocioId);
  const plan = resolverPlanPactado(conf, planId);
  return { interes_condicion: plan, interes_desde: null };
};

/**
 * Fija o cambia el plan de interés de un documento ya existente.
 *
 * Es lo que permite usar la feature con la cartera vieja. El interés corre
 * SIEMPRE desde `desde` (por defecto hoy) hacia adelante, nunca hacia atrás:
 * ponerle interés a un préstamo de hace ocho meses no puede cobrar esos ocho
 * meses de golpe — sería una deuda que aparece de la nada y que el cliente
 * nunca pactó.
 *
 * Pasar `plan_id: null` quita el interés y, con él, lo que se causaría en
 * adelante. Lo ya causado se conserva: para borrarlo está la condonación.
 */
const fijarInteres = async (negocioId, tipo, id, { plan_id, desde, rol }) => {
  if (rol !== 'admin_negocio' && rol !== 'supervisor') {
    throw { status: 403, message: 'No tienes permiso para cambiar el interés' };
  }
  const cfg = _doc(tipo);
  await cargarDocumento(tipo, id, negocioId);   // ownership

  if (!plan_id) {
    const { rows } = await pool.query(
      `UPDATE ${cfg.tabla} SET interes_condicion = NULL WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!rows.length) throw { status: 404, message: 'Documento no encontrado' };
    return { interes_condicion: null, interes_desde: null };
  }

  const conf = await getConfigInteres(negocioId);
  if (!conf.activa) {
    throw { status: 400, message: 'El interés no está activado en la configuración del negocio' };
  }
  const plan = resolverPlanPactado(conf, plan_id);
  if (!plan) throw { status: 400, message: 'Selecciona un plan de interés válido' };

  const fecha = desde ? String(desde).slice(0, 10) : hoyBogota();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw { status: 400, message: 'La fecha de inicio del interés debe tener el formato AAAA-MM-DD' };
  }
  // Hacia atrás no: generaría de golpe meses de interés que nadie pactó.
  if (fecha < hoyBogota()) {
    throw { status: 400, message: 'El interés no puede empezar antes de hoy' };
  }

  const { rows } = await pool.query(
    `UPDATE ${cfg.tabla} SET interes_condicion = $2::jsonb, interes_desde = $3
     WHERE id = $1 RETURNING interes_condicion, interes_desde`,
    [id, JSON.stringify(plan), fecha]
  );
  if (!rows.length) throw { status: 404, message: 'Documento no encontrado' };
  return rows[0];
};

module.exports = {
  DOCS, getConfigNegocio, getConfigInteres, getConfigCargos,
  anotarDocumento, anotarLista, cargarDocumento, estadoDe, cerrarSiPagadoEnTx,
  registrarCobroEnTx, condonar, anularMovimiento, fijarPlazo, fijarInteres,
  resolverCondicionPactada, resolverPlanPactado, datosParaNuevoDocumento,
};
